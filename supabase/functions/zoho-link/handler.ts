// نظام ملائم العقاري — الربط مع Zoho CRM: معالج طلبات zoho-link، والمعتمِدات كلها تُحقن فيُختبر بلا شبكة ولا قاعدة.
//
// الأفعال للمدير غير الموقوف وحده: status وsave وtest وdisconnect وpreview وwrite_one وsync_start وsync_stop.
//
// الرمز الذي يلصقه المدير لمرة واحدة ولو فشل، فلا يصلح هنا نموذج مقسم «جرّب ثم احفظ»: يُستعمل مرة واحدة فقط، ثم أي فشل بعده (ومنه فشل القاعدة) يبطل
// مفتاح التجديد الجديد عند Zoho ويطلب رمزاً جديداً. الربط القائم يبقى حتى ينجح الجديد، ثم يُبطل القديم بقيم عميله القديم.
//
// ما لا يحدث أبداً: Client ID كاملاً أو Client Secret أو الرمز أو أي مفتاح في رد أو سطر سجل أو رسالة خطأ أو جدول. ولا جسم رد من Zoho أو مقسم في أي
// مكان، ولا رقم عميل. لذلك لا تُسجَّل رسالة أي خطأ: السجل يحمل المرحلة والرمز وشكل الرد فقط، فنص الخطأ من القاعدة أو الشبكة قد يحمل قيمة مُرِّرت إليها.
// والكتابة الوحيدة في Zoho هي write_one بعد ضغطة مدير، ودورة maqsam-sync وهو مفعّل.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  apiDomainSignal,
  type ApiFail,
  Budget,
  type Check,
  type CheckCode,
  cleanClientId,
  cleanClientSecret,
  cleanCode,
  type ClientValues,
  DENIED_WAIT_SECONDS,
  emptyLink,
  emptySync,
  exchangeCode,
  keyHint,
  type Link,
  linkFromRow,
  type LinkRow,
  MAX_REQUEST_BYTES,
  type Net,
  parseRequestBody,
  readCapped,
  RECONNECT_CODES,
  revokeToken,
  type Stats,
  type Sync,
  syncFromRow,
  verifyConnection,
  ZohoSession,
} from "./core.ts";
import {
  buildNote,
  hasSummary,
  isCandidate,
  lookupCustomer,
  type MaqsamFail,
  type Match,
  parseCall,
  parseCallId,
  type ParsedCall,
  readCall,
  readCallsPage,
  recordUrl,
  writeWithClaim,
} from "./notes.ts";
import { safeTag, type Store, StoreError, supabaseStore } from "./store.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://dash.mulaem.sa",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MS_PER_DAY = 86_400_000;
const SAVE_BUDGET_MS = 60_000;
const TEST_BUDGET_MS = 60_000;
const PREVIEW_BUDGET_MS = 60_000;
const WRITE_BUDGET_MS = 40_000;
const PREVIEW_DAYS = 7;
const PREVIEW_SAMPLES = 5;
// ضغطة مزدوجة أو إعادة طلب: الرمز نفسه يعود بـ invalid_code بعد نجاح الأول مباشرة
const DOUBLE_SUBMIT_MS = 120_000;

type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "bad_request"
  | "invalid_client_id"
  | "invalid_client_secret"
  | "invalid_code"
  | "not_connected"
  | "maqsam_not_connected"
  | "no_match"
  | "server_error";

const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  unauthenticated: { status: 401, message: "يلزم تسجيل الدخول" },
  forbidden: { status: 403, message: "هذه الصفحة للمدير فقط" },
  bad_request: { status: 400, message: "طلب غير صالح" },
  invalid_client_id: { status: 400, message: "قيمة Client ID غير صحيحة: انسخها كما تظهر في Zoho، بلا مسافات" },
  invalid_client_secret: { status: 400, message: "قيمة Client Secret غير صحيحة: انسخها كما تظهر في Zoho، بلا مسافات" },
  invalid_code: { status: 400, message: "الرمز غير صحيح: انسخه كاملاً كما يظهر في Zoho، بلا مسافات" },
  not_connected: { status: 409, message: "لا يوجد ربط محفوظ مع Zoho" },
  maqsam_not_connected: { status: 409, message: "لا يوجد ربط محفوظ مع مقسم. اربطه أولاً من تبويب «مقسم»." },
  no_match: { status: 409, message: "لم نجد عميلاً بهذا الرقم في Zoho، فلم تُكتب ملاحظة." },
  server_error: { status: 500, message: "تعذّر إكمال العملية. جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام." },
};

// بعد استعمال الرمز: لا إعادة بالرمز نفسه أبداً
const NEW_CODE_NEEDED = "تعذّر إكمال الربط. الربط السابق، إن وُجد، باقٍ كما كان. أنشئ رمزاً جديداً في Zoho وجرّب مرة ثانية.";

// الجدول أو الدالة غير موجودين: الوظيفة نُشرت قبل تطبيق 042، فتعرف الصفحة السبب بدل الخطأ العام
const NOT_MIGRATED_CODES = ["PGRST205", "PGRST202", "42P01", "42883"];
const NOT_MIGRATED_MESSAGE = "الربط لم يُفعَّل بعد في قاعدة البيانات (التحديث 042). وافق على تشغيل migrate في GitHub.";

// ما حدث وما يُفعل، لفشل Zoho أثناء المعاينة أو كتابة الملاحظة. هذان الفعلان لا يعيدان Check، فالرسالة هي الجواب
const ZOHO_FAILURE: Record<string, string> = {
  invalid_client: "رفض Zoho قيم الربط المحفوظة. اربط من جديد من تبويب «Zoho CRM».",
  token_revoked: "انقطع الربط مع Zoho: المفتاح لم يعد صالحاً. اربط من جديد من تبويب «Zoho CRM».",
  scope_mismatch: "صلاحيات المفتاح في Zoho ناقصة. أنشئ رمزاً جديداً بالصلاحيات الموجودة في الصفحة واربط من جديد.",
  no_permission: "مستخدم Zoho المربوط لا يملك الصلاحية لهذا. اربط بمستخدم ملفه Administrator.",
  inactive_user: "مستخدم Zoho المربوط موقوف. فعّله في Zoho أو اربط بمستخدم آخر.",
  wrong_environment: "هذا المفتاح ليس من بيئة Production في Zoho. اربط من جديد واختر المنشأة تحت Production.",
  rate_limited: "طلب Zoho التمهّل. جرّب بعد دقائق.",
  timeout: "لم يرد Zoho في الوقت المحدد. جرّب مرة ثانية بعد قليل.",
  network: "تعذّر الوصول إلى Zoho. جرّب مرة ثانية بعد قليل.",
  server_error: "عند Zoho خطأ مؤقت. جرّب بعد قليل.",
  bad_response: "رد Zoho بصيغة غير متوقعة. جرّب مرة ثانية. إذا تكرر فأخبر مسؤول النظام.",
};

const MAQSAM_FAILURE: Record<MaqsamFail, string> = {
  unauthorized: "رفض مقسم القيم المحفوظة. افحص الربط من تبويب «مقسم».",
  not_found: "لم نجد هذه المكالمة في مقسم.",
  rate_limited: "طلب مقسم التمهّل. جرّب بعد دقيقة.",
  timeout: "لم يرد مقسم في الوقت المحدد. جرّب مرة ثانية بعد قليل.",
  network: "تعذّر الوصول إلى مقسم. جرّب مرة ثانية بعد قليل.",
  server_error: "عند مقسم خطأ مؤقت. جرّب بعد قليل.",
  bad_response: "رد مقسم بصيغة غير متوقعة. جرّب مرة ثانية.",
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const ok = (payload: Record<string, unknown>): Response => json({ status: "ok", ...payload });

const fail = (code: ErrorCode, status = ERRORS[code].status, message = ERRORS[code].message): Response =>
  json({ status: "error", code, message }, status);

const badMethod = () => fail("bad_request", 405, "طلب غير مدعوم");
const tooLarge = () => fail("bad_request", 413, "حجم الطلب أكبر من المسموح");

/* ===================== المعتمِدات ===================== */

export interface Profile {
  id: string;
  role: string | null;
  is_blocked: boolean | null;
  legacy_id: number | null;
  fullname: string | null;
  username: string | null;
}

export interface ConnectInput {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  client_hint: string | null;
  org_name: string | null;
  user_name: string | null;
  user_profile: string | null;
  by: string;
  stats: Stats;
}

export interface AuditRow {
  action: string;
  user_id: number | null;
  user_name: string | null;
}

export interface AttemptGate {
  allowed: boolean;
  reason: string;
  wait_seconds: number;
}

export interface Deps extends Store {
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (id: string) => Promise<Profile | null>;
  readRow: () => Promise<LinkRow | null>;
  nameOf: (id: string) => Promise<string | null>;
  connect: (input: ConnectInput) => Promise<void>;
  // false: لم يعد هذا الربط هو القائم (رُبط من جديد أو فُصل أثناء الفحص)، فلا يُكتب شيء
  recordCheck: (check: Check, connectedAt: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  audit: (row: AuditRow) => Promise<void>;
  attemptBegin: () => Promise<AttemptGate>;
  attemptEnd: () => Promise<void>;
  noteTokens: (input: { minted: number; revoke_failed: number }) => Promise<void>;
  syncStart: (startFrom: string, by: string) => Promise<string>;
  syncStop: () => Promise<boolean>;
  fetch: Net["fetch"];
  now: () => number;
  callTimeoutMs?: number;
  revokeTimeoutMs?: number;
  budgetMs?: number;
}

/* ===================== السجل ===================== */

function logFailure(stage: string, error: unknown): void {
  console.error("zoho-link", stage, safeTag(error));
}

/* ===================== الطلب ===================== */

type BodyResult = { kind: "ok"; value: Record<string, unknown> } | { kind: "too_large" } | { kind: "bad" };

// بعد التحقق من المتصل فقط: لا يُقرأ جسم من لا يملك الصلاحية
async function readBody(req: Request): Promise<BodyResult> {
  if (Number(req.headers.get("content-length")) > MAX_REQUEST_BYTES) return { kind: "too_large" };
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(req.body, MAX_REQUEST_BYTES);
  } catch {
    return { kind: "bad" };
  }
  if (bytes === null) return { kind: "too_large" };
  const value = parseRequestBody(bytes);
  return value ? { kind: "ok", value } : { kind: "bad" };
}

const bearer = (req: Request): string | null => /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") ?? "")?.[1] ?? null;

/* ===================== مساعدات ===================== */

async function currentLink(deps: Deps): Promise<Link> {
  const row = await deps.readRow();
  if (!row) return linkFromRow(null, null);
  return linkFromRow(row, row.connected_by ? await deps.nameOf(row.connected_by) : null);
}

async function currentSync(deps: Deps): Promise<Sync> {
  const row = await deps.syncStatus();
  if (!row) return emptySync();
  return syncFromRow(row, row.started_by ? await deps.nameOf(row.started_by) : null);
}

function netOf(deps: Deps, action: string): Net {
  return {
    fetch: deps.fetch,
    callTimeoutMs: deps.callTimeoutMs,
    revokeTimeoutMs: deps.revokeTimeoutMs,
    // شكل الرد فقط: الأعمدة كلها أرقام ورموز من قائمة مغلقة
    onShape: (shape) => console.info("zoho-link", action, JSON.stringify(shape)),
  };
}

const budgetOf = (deps: Deps, ms: number): Budget => new Budget(deps.now, deps.budgetMs ?? ms);

function sessionOf(deps: Deps, client: ClientValues, refreshToken: string, budget: Budget, action: string, access: string | null = null): ZohoSession {
  return new ZohoSession(client, refreshToken, {
    net: netOf(deps, action),
    refreshBegin: deps.refreshBegin,
    tokenDenied: deps.tokenDenied,
  }, budget, access);
}

// سطر في «سجل النشاطات» باسم الفعل وحده. لا يُفشل العملية التي تمت.
async function writeAudit(deps: Deps, me: Profile, action: string): Promise<void> {
  try {
    await deps.audit({ action, user_id: me.legacy_id ?? null, user_name: me.fullname || me.username || null });
  } catch (error) {
    logFailure("audit", error);
  }
}

// عدّاد تشخيص: فشله لا يغيّر شيئاً مما حدث
async function noteTokens(deps: Deps, minted: number, revokeFailed: number): Promise<void> {
  try {
    await deps.noteTokens({ minted, revoke_failed: revokeFailed });
  } catch (error) {
    logFailure("note-tokens", error);
  }
}

// قال Zoho «Access Denied»: لا طلب حتى تنقضي نافذته. فشل الحفظ لا يغيّر ما يقال للمدير
async function noteDenied(deps: Deps): Promise<void> {
  try {
    await deps.tokenDenied();
  } catch (error) {
    logFailure("token-denied", error);
  }
}

const atIso = (deps: Deps): string => new Date(deps.now()).toISOString();
const failedCheck = (deps: Deps, code: CheckCode): Check => ({ ok: false, code, at: atIso(deps), stats: null });

const needsReconnect = (code: string): boolean => RECONNECT_CODES.includes(code);

// فشل Zoho في المعاينة أو كتابة ملاحظة: يُرفع ما يخص الربط ويقال السبب بالعربي. الحد الزمني يقال بدقائقه
async function zohoFailure(deps: Deps, code: ApiFail, session: ZohoSession, connectedAt: string): Promise<Response> {
  if (needsReconnect(code)) {
    try {
      await deps.setReconnect(connectedAt, true);
    } catch (error) {
      logFailure("set-reconnect", error);
    }
  }
  if (code === "throttled") {
    const minutes = Math.max(1, Math.ceil(session.waitSeconds / 60));
    return fail("server_error", 502, `طلب Zoho التمهّل. جرّب بعد ${minutes} دقيقة.`);
  }
  return fail("server_error", 502, ZOHO_FAILURE[code] ?? ZOHO_FAILURE.bad_response);
}

/* ===================== save ===================== */

async function save(body: Record<string, unknown>, me: Profile, deps: Deps): Promise<Response> {
  const clientId = cleanClientId(body.client_id);
  if (!clientId) return fail("invalid_client_id");
  const clientSecret = cleanClientSecret(body.client_secret);
  if (!clientSecret) return fail("invalid_client_secret");
  const code = cleanCode(body.code);
  if (!code) return fail("invalid_code");

  const gate = await deps.attemptBegin();
  if (!gate.allowed) {
    return ok({ saved: false, check: failedCheck(deps, "throttled"), wait_seconds: gate.wait_seconds, link: await currentLink(deps), sync: await currentSync(deps) });
  }
  try {
    return await saveAttempt({ client_id: clientId, client_secret: clientSecret }, code, me, deps);
  } finally {
    try {
      await deps.attemptEnd();
    } catch (error) {
      logFailure("attempt-end", error);
    }
  }
}

async function saveAttempt(client: ClientValues, code: string, me: Profile, deps: Deps): Promise<Response> {
  const net = netOf(deps, "save");
  const budget = budgetOf(deps, SAVE_BUDGET_MS);
  const refused = async (reason: CheckCode, extra: Record<string, unknown> = {}): Promise<Response> =>
    ok({ saved: false, check: failedCheck(deps, reason), ...extra, link: await currentLink(deps), sync: await currentSync(deps) });

  const exchanged = await exchangeCode(client, code, net, budget);

  // مرة واحدة مهما تعددت الطرق إلى الفشل، ولا شيء يُبطل قبل أن يصدر مفتاح
  let revokedNew = false;
  const revokeNew = async () => {
    if (revokedNew || !exchanged.ok || exchanged.refresh_token === null) return;
    revokedNew = true;
    await revokeOnce(deps, client, exchanged.refresh_token, "refresh_token", net);
  };

  let old: { client_id: string; client_secret: string; refresh_token: string } | null = null;
  let stats: Stats;
  let identity: { org_name: string | null; user_name: string | null; user_profile: string | null };
  let refreshToken: string;
  try {
    if (!exchanged.ok) {
      console.info("zoho-link", "save", exchanged.code);
      if (exchanged.code === "throttled") {
        await noteDenied(deps);
        return await refused("throttled", { wait_seconds: DENIED_WAIT_SECONDS });
      }
      if (exchanged.code === "invalid_code") {
        // الرمز نفسه أُرسل مرتين ونجح الأول قبل لحظات: النتيجة التي تهم المدير هي الأولى
        const link = await currentLink(deps);
        const connectedMs = link.connected_at === null ? NaN : Date.parse(link.connected_at);
        const hint = keyHint(client.client_id);
        if (link.connected && hint !== null && link.client_hint === hint && deps.now() - connectedMs <= DOUBLE_SUBMIT_MS) {
          return ok({ saved: true, check: link.check, link, sync: await currentSync(deps) });
        }
      }
      return await refused(exchanged.code);
    }

    await noteTokens(deps, 1, 0);

    if (exchanged.refresh_token === null) {
      // لا مفتاح دائم نبطله، فيُبطل مفتاح الوصول الذي صدر معه
      await revokeOnce(deps, client, exchanged.access_token, "access_token", net);
      return await refused("no_refresh_token");
    }
    refreshToken = exchanged.refresh_token;

    // api_domain إشارة فقط: كل النداءات إلى النطاق المكتوب في core.ts
    if (apiDomainSignal(exchanged.api_domain) === "wrong_environment") {
      console.info("zoho-link", "save", "wrong_environment");
      await revokeNew();
      return await refused("wrong_environment");
    }
    const session = sessionOf(deps, client, refreshToken, budget, "save", exchanged.access_token);
    const verified = await verifyConnection(session, deps.now());
    console.info("zoho-link", "save", verified.ok ? "ok" : verified.code);
    if (!verified.ok) {
      await revokeNew();
      return await refused(verified.code);
    }
    stats = verified.stats;
    identity = verified.identity;
    old = await deps.credentials();
    await deps.connect({
      ...client,
      refresh_token: refreshToken,
      client_hint: keyHint(client.client_id),
      org_name: identity.org_name,
      user_name: identity.user_name,
      user_profile: identity.user_profile,
      by: me.id,
      stats,
    });
  } catch (error) {
    logFailure("save-store", error);
    await revokeNew();
    if (error instanceof StoreError && NOT_MIGRATED_CODES.includes(error.code)) return fail("server_error", 500, NOT_MIGRATED_MESSAGE);
    return fail("server_error", 500, NEW_CODE_NEEDED);
  }

  // الربط الجديد صار القائم: لا شيء بعد هذا يُقال فشلاً
  await writeAudit(deps, me, "ربط Zoho");

  let oldRevoked: boolean | undefined;
  if (old) {
    // العميل القديم قد يكون لشخص آخر، فيُبطل بقيمه هو
    oldRevoked = old.refresh_token === refreshToken ? true : await revokeOnce(deps, old, old.refresh_token, "refresh_token", net);
  }

  const check: Check = { ok: true, code: "ok", at: atIso(deps), stats };
  let link: Link;
  let sync: Sync;
  try {
    link = await currentLink(deps);
    sync = await currentSync(deps);
  } catch (error) {
    logFailure("save-readback", error);
    link = {
      connected: true,
      ...identity,
      client_hint: keyHint(client.client_id),
      connected_at: check.at,
      connected_by_name: me.fullname || me.username || null,
      check,
    };
    sync = emptySync();
  }
  return ok({ saved: true, check, ...(oldRevoked === undefined ? {} : { old_revoked: oldRevoked }), link, sync });
}

async function revokeOnce(deps: Deps, client: ClientValues, token: string, kind: "refresh_token" | "access_token", net: Net): Promise<boolean> {
  const done = await revokeToken(client, token, kind, net);
  console.info("zoho-link", "revoke", done ? "ok" : "failed");
  if (!done) await noteTokens(deps, 0, 1);
  return done;
}

/* ===================== test ===================== */

async function test(deps: Deps): Promise<Response> {
  const creds = await deps.credentials();
  if (!creds) return fail("not_connected");
  const budget = budgetOf(deps, TEST_BUDGET_MS);
  const session = sessionOf(deps, creds, creds.refresh_token, budget, "test");
  const verified = await verifyConnection(session, deps.now());
  console.info("zoho-link", "test", verified.ok ? "ok" : verified.code);
  const check: Check = verified.ok ? { ok: true, code: "ok", at: atIso(deps), stats: verified.stats } : failedCheck(deps, verified.code);

  // حد عندنا أو عند Zoho ليس عيباً في الربط: لا يُكتب فوق آخر فحص، ويقال كم ينتظر
  if (check.code === "throttled") {
    return ok({ check, wait_seconds: session.waitSeconds, link: await currentLink(deps), sync: await currentSync(deps) });
  }

  const recorded = await deps.recordCheck(check, creds.connected_at);
  if (recorded) {
    if (check.ok || needsReconnect(check.code)) await deps.setReconnect(creds.connected_at, !check.ok);
    return ok({ check, link: await currentLink(deps), sync: await currentSync(deps) });
  }
  // تغيّر الربط أثناء الفحص: نتيجة المفتاح القديم لا تُكتب ولا تُعرض، ويُعرض ما هو قائم الآن
  const link = await currentLink(deps);
  return link.connected ? ok({ check: link.check, link, sync: await currentSync(deps) }) : fail("not_connected");
}

/* ===================== disconnect ===================== */

// يبطل المفتاح عند Zoho أولاً (200 وحدها تُعدّ إبطالاً)، ثم يمسح هنا في كل حال: revoked = false تعني أن على المدير حذفه من Zoho يدوياً.
async function disconnect(me: Profile, deps: Deps): Promise<Response> {
  const before = await deps.syncStatus();
  const creds = await deps.credentials();
  const revoked = creds ? await revokeOnce(deps, creds, creds.refresh_token, "refresh_token", netOf(deps, "disconnect")) : false;
  await deps.disconnect();
  await writeAudit(deps, me, "فصل Zoho");
  if (before?.enabled) await writeAudit(deps, me, "إيقاف نقل الملخصات");
  let sync: Sync;
  try {
    sync = await currentSync(deps);
  } catch (error) {
    // الفصل تم: قراءة فاشلة بعده لا تجعله يبدو أنه لم يتم
    logFailure("disconnect-readback", error);
    sync = { ...syncFromRow(before, null), enabled: false, needs_reconnect: false };
  }
  return ok({ revoked, link: emptyLink(), sync });
}

/* ===================== preview ===================== */

async function preview(deps: Deps): Promise<Response> {
  const zoho = await deps.credentials();
  if (!zoho) return fail("not_connected");
  const maqsam = await deps.maqsamCredentials();
  if (!maqsam) return fail("maqsam_not_connected");

  const budget = budgetOf(deps, PREVIEW_BUDGET_MS);
  const net = netOf(deps, "preview");
  const nowMs = deps.now();
  const nowSec = Math.floor(nowMs / 1000);
  const page = await readCallsPage(maqsam, nowSec - PREVIEW_DAYS * 86_400, nowSec, 1, net, budget.left());
  if (!page.ok) {
    console.info("zoho-link", "preview", "maqsam", page.code);
    return fail("server_error", 502, MAQSAM_FAILURE[page.code]);
  }

  const calls = page.calls.map(parseCall).filter((call): call is ParsedCall => call !== null);
  const known = await deps.knownCalls(calls.map((call) => call.id));
  const summarized = calls.filter(isCandidate).filter(hasSummary);
  const alreadyWritten = calls.filter((call) => known.get(call.id)?.status === "written").length;
  const pending = summarized.filter((call) => known.get(call.id)?.status !== "written").sort((a, b) => b.atMs - a.atMs).slice(0, PREVIEW_SAMPLES);

  // لا تجديد مفتاح إن لم يكن هناك ما يُبحث عنه
  const session = sessionOf(deps, zoho, zoho.refresh_token, budget, "preview");
  const found = new Map<string, Match | null>();
  const samples = [];
  let matched = 0;
  let noMatch = 0;
  let ambiguous = 0;
  for (const call of pending) {
    let match: Match | null = null;
    if (call.number !== null) {
      if (found.has(call.number)) {
        match = found.get(call.number) ?? null;
      } else {
        const lookup = await lookupCustomer(session, call.number);
        if (!lookup.ok) {
          console.info("zoho-link", "preview", "lookup", lookup.code);
          return await zohoFailure(deps, lookup.code === "refused" || lookup.code === "not_found" ? "bad_response" : lookup.code, session, zoho.connected_at);
        }
        match = lookup.match;
        found.set(call.number, match);
      }
    }
    if (match) matched++;
    else noMatch++;
    if (match?.ambiguous) ambiguous++;
    const note = buildNote(call);
    samples.push({
      call_id: call.id,
      at: new Date(call.atMs).toISOString(),
      direction: call.direction,
      duration: call.duration,
      agent: call.agents.length ? call.agents.join("، ") : "بلا موظف",
      note_title: note.title,
      note_text: note.text,
      match: match ? { module: match.module, id: match.id, url: recordUrl(match.module, match.id) } : null,
      ambiguous: match?.ambiguous === true,
    });
  }
  console.info("zoho-link", "preview", "ok", calls.length, samples.length);
  return ok({
    preview: {
      counts: { calls: page.calls.length, with_summary: summarized.length, already_written: alreadyWritten, matched, no_match: noMatch, ambiguous },
      samples,
    },
    sync: await currentSync(deps),
  });
}

/* ===================== write_one ===================== */

function writtenView(noteId: string, module: string, recordId: string) {
  return { note_id: noteId, module, record_id: recordId, url: recordUrl(module, recordId) };
}

async function writeOne(body: Record<string, unknown>, me: Profile, deps: Deps): Promise<Response> {
  const callId = parseCallId(body.call_id);
  if (callId === null) return fail("bad_request");

  // كُتبت من قبل: النتيجة السابقة بلا أي نداء خارجي
  const earlier = (await deps.knownCalls([callId])).get(callId);
  if (earlier?.status === "written" && earlier.zoho_note_id && earlier.zoho_module && earlier.zoho_record_id) {
    return ok({ written: writtenView(earlier.zoho_note_id, earlier.zoho_module, earlier.zoho_record_id), sync: await currentSync(deps) });
  }

  const zoho = await deps.credentials();
  if (!zoho) return fail("not_connected");
  const maqsam = await deps.maqsamCredentials();
  if (!maqsam) return fail("maqsam_not_connected");

  const budget = budgetOf(deps, WRITE_BUDGET_MS);
  const read = await readCall(maqsam, callId, netOf(deps, "write_one"), budget.left());
  if (!read.ok) {
    console.info("zoho-link", "write_one", "maqsam", read.code);
    return read.code === "not_found" ? fail("bad_request", 404, MAQSAM_FAILURE.not_found) : fail("server_error", 502, MAQSAM_FAILURE[read.code]);
  }
  const call = parseCall(read.call);
  if (call === null || call.id !== callId) return fail("server_error", 502, MAQSAM_FAILURE.bad_response);
  if (!isCandidate(call) || !hasSummary(call)) return fail("bad_request", 409, "هذه المكالمة ليس فيها ملخص بعد، فلا ملاحظة تُكتب لها.");
  if (call.number === null) return fail("no_match");

  const session = sessionOf(deps, zoho, zoho.refresh_token, budget, "write_one");
  const lookup = await lookupCustomer(session, call.number);
  if (!lookup.ok) {
    console.info("zoho-link", "write_one", "lookup", lookup.code);
    return await zohoFailure(deps, lookup.code === "refused" || lookup.code === "not_found" ? "bad_response" : lookup.code, session, zoho.connected_at);
  }
  if (!lookup.match) return fail("no_match");

  const outcome = await writeWithClaim(session, deps, call, lookup.match, false);
  console.info("zoho-link", "write_one", outcome.kind);
  switch (outcome.kind) {
    case "written":
      if (outcome.fresh) await writeAudit(deps, me, "كتابة ملاحظة واحدة في Zoho");
      return ok({ written: writtenView(outcome.note_id, outcome.module, outcome.record_id), sync: await currentSync(deps) });
    case "busy":
      return fail("bad_request", 409, "تُكتب ملاحظة هذه المكالمة الآن. انتظر قليلاً ثم حدّث الصفحة.");
    case "refused":
      return fail("server_error", 502, "رفض Zoho هذه الملاحظة، ولم تُكتب. إذا تكرر فأخبر مسؤول النظام.");
    case "stop":
      return await zohoFailure(deps, outcome.code, session, zoho.connected_at);
    case "disabled":
      // لا يصل هنا: الكتابة الواحدة لا تشترط تشغيل النقل
      return fail("server_error");
  }
}

/* ===================== تشغيل النقل وإيقافه ===================== */

async function syncStart(body: Record<string, unknown>, me: Profile, deps: Deps): Promise<Response> {
  if (body.from !== "now" && body.from !== "days30") return fail("bad_request");
  const nowMs = deps.now();
  const startFrom = new Date(body.from === "now" ? nowMs : nowMs - 30 * MS_PER_DAY).toISOString();
  const outcome = await deps.syncStart(startFrom, me.id);
  console.info("zoho-link", "sync_start", outcome);
  if (outcome === "not_connected") return fail("not_connected", 409, "لا يبدأ النقل قبل ربط مقسم وZoho معاً.");
  if (outcome === "needs_reconnect") return fail("not_connected", 409, "الربط مع Zoho يحتاج إعادة ربط قبل تشغيل النقل. افحص الربط أو اربط من جديد.");
  if (outcome === "started") await writeAudit(deps, me, "تشغيل نقل الملخصات");
  return ok({ sync: await currentSync(deps) });
}

async function syncStop(me: Profile, deps: Deps): Promise<Response> {
  const wasOn = await deps.syncStop();
  console.info("zoho-link", "sync_stop", wasOn);
  if (wasOn) await writeAudit(deps, me, "إيقاف نقل الملخصات");
  return ok({ sync: await currentSync(deps) });
}

/* ===================== المعالج ===================== */

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return badMethod();

  let stage = "auth";
  try {
    const token = bearer(req);
    if (!token) return fail("unauthenticated");
    const user = await deps.getUser(token);
    if (!user) return fail("unauthenticated");
    const me = await deps.getProfile(user.id);
    if (!me || me.role !== "admin" || me.is_blocked) return fail("forbidden");

    stage = "body";
    const body = await readBody(req);
    if (body.kind === "too_large") return tooLarge();
    if (body.kind === "bad") return fail("bad_request");

    switch (body.value.action) {
      case "status":
        stage = "status";
        return ok({ link: await currentLink(deps), sync: await currentSync(deps) });
      case "save":
        stage = "save";
        return await save(body.value, me, deps);
      case "test":
        stage = "test";
        return await test(deps);
      case "disconnect":
        stage = "disconnect";
        return await disconnect(me, deps);
      case "preview":
        stage = "preview";
        return await preview(deps);
      case "write_one":
        stage = "write_one";
        return await writeOne(body.value, me, deps);
      case "sync_start":
        stage = "sync_start";
        return await syncStart(body.value, me, deps);
      case "sync_stop":
        stage = "sync_stop";
        return await syncStop(me, deps);
      default:
        return fail("bad_request");
    }
  } catch (error) {
    logFailure(stage, error);
    if (error instanceof StoreError && NOT_MIGRATED_CODES.includes(error.code)) return fail("server_error", 500, NOT_MIGRATED_MESSAGE);
    return fail("server_error");
  }
}

/* ===================== القاعدة الحقيقية ===================== */

const ROW_COLUMNS = "org_name, user_name, user_profile, client_hint, connected_at, connected_by, last_check_at, last_check_ok, last_check_code, last_check_stats";

export function supabaseDeps(db: SupabaseClient): Deps {
  return {
    ...supabaseStore(db),
    getUser: async (token) => {
      const { data, error } = await db.auth.getUser(token);
      return error || !data?.user ? null : { id: data.user.id };
    },
    getProfile: async (id) => {
      const { data, error } = await db.from("profiles")
        .select("id, role, is_blocked, legacy_id, fullname, username").eq("id", id).maybeSingle();
      if (error) throw new StoreError("profile", error);
      return data as Profile | null;
    },
    readRow: async () => {
      const { data, error } = await db.from("zoho_link").select(ROW_COLUMNS).eq("id", true).maybeSingle();
      if (error) throw new StoreError("read", error);
      return data as LinkRow | null;
    },
    nameOf: async (id) => {
      const { data, error } = await db.from("profiles").select("fullname, username").eq("id", id).maybeSingle();
      if (error) throw new StoreError("name", error);
      return data?.fullname || data?.username || null;
    },
    connect: async (input) => {
      const { error } = await db.rpc("zoho_link_connect", {
        p_client_id: input.client_id,
        p_client_secret: input.client_secret,
        p_refresh_token: input.refresh_token,
        p_client_hint: input.client_hint,
        p_org_name: input.org_name,
        p_user_name: input.user_name,
        p_user_profile: input.user_profile,
        p_by: input.by,
        p_stats: input.stats,
      });
      if (error) throw new StoreError("connect", error);
    },
    recordCheck: async (check, connectedAt) => {
      const { data, error } = await db.from("zoho_link").update({
        last_check_at: check.at,
        last_check_ok: check.ok,
        last_check_code: check.code,
        last_check_stats: check.stats,
      }).eq("id", true).eq("connected_at", connectedAt).select("id");
      if (error) throw new StoreError("record", error);
      return Array.isArray(data) && data.length > 0;
    },
    disconnect: async () => {
      const { error } = await db.rpc("zoho_link_disconnect");
      if (error) throw new StoreError("disconnect", error);
    },
    audit: async (row) => {
      const { error } = await db.from("activities").insert(row);
      if (error) throw new StoreError("audit", error);
    },
    attemptBegin: async () => {
      const { data, error } = await db.rpc("zoho_link_attempt_begin");
      if (error) throw new StoreError("attempt-begin", error);
      return { allowed: data?.allowed === true, reason: typeof data?.reason === "string" ? data.reason : "unknown", wait_seconds: typeof data?.wait_seconds === "number" ? data.wait_seconds : 0 };
    },
    attemptEnd: async () => {
      const { error } = await db.rpc("zoho_link_attempt_end");
      if (error) throw new StoreError("attempt-end", error);
    },
    noteTokens: async (input) => {
      const { error } = await db.rpc("zoho_link_note_tokens", { p_minted: input.minted, p_revoke_failed: input.revoke_failed });
      if (error) throw new StoreError("note-tokens", error);
    },
    syncStart: async (startFrom, by) => {
      const { data, error } = await db.rpc("maqsam_sync_start", { p_start_from: startFrom, p_by: by });
      if (error) throw new StoreError("sync-start", error);
      return typeof data === "string" ? data : "unknown";
    },
    syncStop: async () => {
      const { data, error } = await db.rpc("maqsam_sync_stop");
      if (error) throw new StoreError("sync-stop", error);
      return data === true;
    },
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  };
}
