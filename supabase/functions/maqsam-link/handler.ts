// نظام ملائم العقاري — الربط مع مقسم: معالج طلبات maqsam-link، والمعتمِدات كلها تُحقن فيُختبر بلا شبكة ولا قاعدة.
//
// أربعة أفعال للمدير غير الموقوف وحده: status وsave وtest وdisconnect. الحفظ يجرّب القيم على مقسم أولاً ولا يكتب شيئاً إن فشلت.
//
// ما لا يحدث أبداً: المفتاحان في رد أو سطر سجل أو رسالة خطأ، أو جسم رد مقسم في أي مكان. لذلك لا تُسجَّل رسالة أي خطأ:
// السجل يحمل المرحلة ورمز الخطأ وحالة HTTP فقط، فنص الخطأ من القاعدة أو الشبكة قد يحمل قيمة مُرِّرت إليها.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type Check,
  cleanKeyId,
  cleanSecret,
  type Credentials,
  emptyLink,
  isAllowedHost,
  keyHint,
  type Link,
  linkFromRow,
  type LinkRow,
  MAX_REQUEST_BYTES,
  normalizeHost,
  parseRequestBody,
  probe,
  type ProbeDeps,
  readCapped,
  type Stats,
} from "./core.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://dash.mulaem.sa",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "bad_request"
  | "invalid_host"
  | "invalid_key_id"
  | "invalid_secret"
  | "not_connected"
  | "server_error";

const ERRORS: Record<ErrorCode, { status: number; message: string }> = {
  unauthenticated: { status: 401, message: "يلزم تسجيل الدخول" },
  forbidden: { status: 403, message: "هذه الصفحة للمدير فقط" },
  bad_request: { status: 400, message: "طلب غير صالح" },
  invalid_host: { status: 400, message: "قيمة base_url غير صحيحة: انسخها كما تظهر في مقسم، ويجب أن تكون على نطاق maqsam.com" },
  invalid_key_id: { status: 400, message: "قيمة access_key_id غير صحيحة: انسخها كما تظهر في مقسم، بلا مسافات ولا نقطتين" },
  invalid_secret: { status: 400, message: "قيمة access_secret غير صحيحة: انسخها كما تظهر في مقسم" },
  not_connected: { status: 409, message: "لا يوجد ربط محفوظ مع مقسم" },
  server_error: { status: 500, message: "تعذّر إكمال العملية. جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام." },
};

// الجدول أو الدالة غير موجودين: الوظيفة نُشرت قبل تطبيق 041، فتعرف الصفحة السبب بدل الخطأ العام
const NOT_MIGRATED_CODES = ["PGRST205", "PGRST202", "42P01", "42883"];
const NOT_MIGRATED_MESSAGE = "الربط لم يُفعَّل بعد في قاعدة البيانات (التحديث 041). وافق على تشغيل migrate في GitHub.";

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
  host: string;
  key_id: string;
  secret: string;
  key_hint: string | null;
  by: string;
  stats: Stats;
}

export interface AuditRow {
  action: string;
  user_id: number | null;
  user_name: string | null;
}

export interface Deps {
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (id: string) => Promise<Profile | null>;
  readRow: () => Promise<LinkRow | null>;
  nameOf: (id: string) => Promise<string | null>;
  connect: (input: ConnectInput) => Promise<void>;
  credentials: () => Promise<Credentials | null>;
  // false: لم يعد هذا الربط هو القائم (رُبط من جديد أو فُصل أثناء الفحص)، فلا يُكتب شيء
  recordCheck: (check: Check, connectedAt: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  audit: (row: AuditRow) => Promise<void>;
  fetch: ProbeDeps["fetch"];
  now: () => number;
  timeoutMs?: number;
}

/* ===================== السجل ===================== */

// خطأ بلا نص القاعدة: رسالتها قد تحمل قيمة مُرِّرت إليها، فلا يبقى منها إلا الرمز (مثل 23514 أو PGRST202)
class StoreError extends Error {
  readonly code: string;
  constructor(stage: string, source: { code?: unknown }) {
    super(`maqsam-link store failure: ${stage}`);
    this.name = "StoreError";
    this.code = typeof source.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(source.code) ? source.code : "unknown";
  }
}

// رمز الخطأ أو اسم نوعه، لا رسالته
function safeTag(error: unknown): string {
  if (error instanceof StoreError) return error.code;
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z]{1,32}$/.test(name) ? name : "unknown";
}

function logFailure(stage: string, error: unknown): void {
  console.error("maqsam-link", stage, safeTag(error));
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

/* ===================== الأفعال ===================== */

async function currentLink(deps: Deps): Promise<Link> {
  const row = await deps.readRow();
  if (!row) return linkFromRow(null, null);
  return linkFromRow(row, row.connected_by ? await deps.nameOf(row.connected_by) : null);
}

function probeDeps(deps: Deps, action: string): ProbeDeps {
  return {
    fetch: deps.fetch,
    now: deps.now,
    timeoutMs: deps.timeoutMs,
    onStatus: (status) => console.info("maqsam-link", action, "http", status),
  };
}

// سطر في «سجل النشاطات» باسم الفعل وحده. لا يُفشل العملية التي تمت: الربط أو الفصل حدث فعلاً.
async function writeAudit(deps: Deps, me: Profile, action: string): Promise<void> {
  try {
    await deps.audit({ action, user_id: me.legacy_id ?? null, user_name: me.fullname || me.username || null });
  } catch (error) {
    logFailure("audit", error);
  }
}

async function save(body: Record<string, unknown>, me: Profile, deps: Deps): Promise<Response> {
  const host = normalizeHost(body.base_url);
  if (!host) return fail("invalid_host");
  const keyId = cleanKeyId(body.access_key_id);
  if (!keyId) return fail("invalid_key_id");
  const secret = cleanSecret(body.access_secret);
  if (!secret) return fail("invalid_secret");

  const check = await probe({ host, key_id: keyId, secret }, probeDeps(deps, "save"));
  console.info("maqsam-link", "save", check.code);
  if (!check.ok || !check.stats) return ok({ saved: false, check, link: await currentLink(deps) });

  await deps.connect({ host, key_id: keyId, secret, key_hint: keyHint(keyId), by: me.id, stats: check.stats });
  await writeAudit(deps, me, "ربط مقسم");
  // الربط تم فعلاً: فشل القراءة بعده لا يُقال فشلاً، فالمفتاحان الجديدان صارا هما القائمين
  let link: Link;
  try {
    link = await currentLink(deps);
  } catch (error) {
    logFailure("save-readback", error);
    link = { connected: true, host, key_hint: keyHint(keyId), connected_at: check.at, connected_by_name: me.fullname || me.username || null, check };
  }
  return ok({ saved: true, check, link });
}

async function test(deps: Deps): Promise<Response> {
  const creds = await deps.credentials();
  if (!creds) return fail("not_connected");
  // القاعدة تمنعه بقيد، وهذا خط ثانٍ: نطاق محفوظ خارج القائمة لا يأخذ المفتاحين إليه، ويعيد المدير الربط
  if (!isAllowedHost(creds.host)) return fail("invalid_host");
  const check = await probe(creds, probeDeps(deps, "test"));
  console.info("maqsam-link", "test", check.code);
  const recorded = await deps.recordCheck(check, creds.connected_at);
  const link = await currentLink(deps);
  if (recorded) return ok({ check, link });
  // تغيّر الربط أثناء الفحص: نتيجة المفتاح القديم لا تُكتب ولا تُعرض، ويُعرض ما هو قائم الآن
  return link.connected ? ok({ check: link.check, link }) : fail("not_connected");
}

async function disconnect(me: Profile, deps: Deps): Promise<Response> {
  await deps.disconnect();
  await writeAudit(deps, me, "فصل مقسم");
  return ok({ link: emptyLink() });
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
        return ok({ link: await currentLink(deps) });
      case "save":
        stage = "save";
        return await save(body.value, me, deps);
      case "test":
        stage = "test";
        return await test(deps);
      case "disconnect":
        stage = "disconnect";
        return await disconnect(me, deps);
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

const ROW_COLUMNS = "host, key_hint, connected_at, connected_by, last_check_at, last_check_ok, last_check_code, last_check_stats";

export function supabaseDeps(db: SupabaseClient): Deps {
  return {
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
      const { data, error } = await db.from("maqsam_link").select(ROW_COLUMNS).eq("id", true).maybeSingle();
      if (error) throw new StoreError("read", error);
      return data as LinkRow | null;
    },
    nameOf: async (id) => {
      const { data, error } = await db.from("profiles").select("fullname, username").eq("id", id).maybeSingle();
      if (error) throw new StoreError("name", error);
      return data?.fullname || data?.username || null;
    },
    connect: async (input) => {
      const { error } = await db.rpc("maqsam_link_connect", {
        p_host: input.host,
        p_key_id: input.key_id,
        p_secret: input.secret,
        p_key_hint: input.key_hint,
        p_by: input.by,
        p_stats: input.stats,
      });
      if (error) throw new StoreError("connect", error);
    },
    credentials: async () => {
      const { data, error } = await db.rpc("maqsam_link_credentials");
      if (error) throw new StoreError("credentials", error);
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { host: row.host, key_id: row.key_id, secret: row.secret, connected_at: row.connected_at } : null;
    },
    recordCheck: async (check, connectedAt) => {
      const { data, error } = await db.from("maqsam_link").update({
        last_check_at: check.at,
        last_check_ok: check.ok,
        last_check_code: check.code,
        last_check_stats: check.stats,
      }).eq("id", true).eq("connected_at", connectedAt).select("id");
      if (error) throw new StoreError("record", error);
      return Array.isArray(data) && data.length > 0;
    },
    disconnect: async () => {
      const { error } = await db.rpc("maqsam_link_disconnect");
      if (error) throw new StoreError("disconnect", error);
    },
    audit: async (row) => {
      const { error } = await db.from("activities").insert(row);
      if (error) throw new StoreError("audit", error);
    },
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  };
}
