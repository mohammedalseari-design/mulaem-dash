// نظام ملائم العقاري — وظيفة فرز رسائل واتساب wa-triage بـ Jev (docs/JEV.md)
//
// ثلاثة أفعال، والمتصل يُتحقق منه قبل قراءة الجسم:
//   status — للمدير: هل الفرز مفعّل (السر OPENROUTER_API_KEY، ووضع الفرز wa_triage_mode، وترحيل 026)، والنموذج
//            ومجموعة الأسئلة، وإنفاق اليوم وسقفه. لا ترمي: أي تعذّر = غير مفعّل برسالة عربية.
//   triage — للمدير (صفحة #/whatsapp) أو لأداة التقييم بتذكرة (x-triage-ticket): حتى 25 كتلة. لكل كتلة بصمة النص،
//            ثم الحكم المحفوظ إن وُجد، أو حكم الكود للمستند وحده، أو سؤال Jev (ستة نداءات معاً على الأكثر).
//            يعيد التسميات فقط: الحكم وأسبابه وإجابات Jev. لا يُبدأ نداء بعد 50 ث، ولا يتجاوز نداءٌ 55 ث.
//   label  — للمدير: تصحيح نية Jev على أحدث صف لبصمة النص.
//
// ما لا تفعله أبداً: الكتابة في agent_requests / agent_drafts / projects / clients، أو إرسال شيء للمساعد.
// تكتب wa_triage (الأحكام، للصفحة وحدها) و wa_triage_calls (سطر لكل نداء) فقط. Jev يقترح، والإرسال بضغطة المالك.
//
// الخصوصية: إلى Jev نص الكتلة واسم المجموعة فقط (لا المرسل ولا سطور الرأس)، بعد إخفاء الجوالات والبريد (Redactor،
// واحد لكل كتلة) وفحص ما بقي من أرقام (scrubPhones). لا يُحفظ نص رسالة ولا يُسجَّل: المفتاح sha256 للنص الأصلي بعد
// trim، والقاعدة تحفظ البصمات والتسميات والاحتمالات. رسائل الخطأ للمتصل عربية، بلا نص SQL ولا نص المزوّد.
// المفتاح يُقرأ من أسرار Supabase ولا يغادر هذه الوظيفة إلا إلى OpenRouter، ولا يُطبع ولا يُسجَّل.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Redactor } from "../_shared/effort-router/redact.ts";
import { callJev, type ChoiceQuestion, DEFAULT_JEV_MODEL, DEFAULT_USD_PER_MTOK, JevError } from "../_shared/jev/client.ts";
import { buildRequest, capRuns, DEFAULT_QSET, INTENTS, isCurrentQset, QSETS, scrubPhones } from "../_shared/jev/questions.ts";
import { type Answers, compactAnswers, decide, normalizeChoice, noulOf, readStored, type Verdict } from "../_shared/jev/verdict.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const fail = (message: string, status = 400) => json({ status: "error", message }, status);

/* ===================== الإعدادات ===================== */

const MAX_ITEMS = 25; // عناصر النداء الواحد
const MAX_TEXT = 20_000; // نص أطول يُقطع قبل أي شيء (البصمة نفسها على المقطوع)
const MAX_GROUP = 500;
const MAX_REF = 200;
const MAX_SHAS = 50; // بصمات نسخ الكتلة في العنصر الواحد
const MAX_TICKET = 512;
const CONCURRENCY = 6; // نداءات Jev معاً
// حد تشغيل الوظيفة 150 ث، والصفحة تنتظر 70 ث: لا نداء يبدأ بعد 50 ث، ولا نداء يتجاوز 55 ث من بدء الطلب
const START_CUTOFF_MS = 50_000;
const DEADLINE_MS = 55_000;
const SHA = /^[0-9a-f]{64}$/;
const REGEX_KIND = /^[a-z_]{1,20}$/;
const MODES = ["off", "suggest", "preselect"] as const;
type Mode = typeof MODES[number];
const INTENT_SET = new Set<string>(INTENTS);

const DISABLED_AR = "فرز Jev غير مفعّل — لم يُضبط السر OPENROUTER_API_KEY في أسرار Supabase بعد.";
const OFF_AR = "فرز Jev متوقف";
const CAP_AR = "بلغ فرز Jev سقفه اليومي";
const NOT_READY_AR = "فرز Jev غير مهيّأ بعد — لم يُطبَّق ترحيل قاعدة البيانات 026_wa_triage.";
const STALE_AR = "تغيّرت قائمة أحياء جدة ولم تُحدَّث مجموعة أسئلة الفرز — فرز Jev متوقف حتى تُحدَّث.";
const SETTINGS_AR = "تعذّر قراءة إعدادات فرز Jev";
const STATUS_AR = "تعذّر قراءة حالة فرز Jev";
const OVERRIDE_AR = "الأسئلة المخصّصة (override) غير مدعومة في هذه النسخة من الوظيفة";

// المعتمِدات: قاعدة Supabase بمفتاح الخدمة، والبيئة، والشبكة والوقت (تُستبدل في الاختبارات)
export interface Deps {
  db: SupabaseClient;
  env: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now: () => number;
}

const apiKey = (env: Deps["env"]) => (env("OPENROUTER_API_KEY") ?? "").trim();
const triageModel = (env: Deps["env"]) => (env("AGENT_TRIAGE_MODEL") ?? "").trim() || DEFAULT_JEV_MODEL;
// سعر المليون رمز للتكلفة حين لا يعيدها OpenRouter: AGENT_TRIAGE_USD_PER_MTOK إن ضُبط رقماً غير سالب
function usdPerMtok(env: Deps["env"]): number {
  const raw = (env("AGENT_TRIAGE_USD_PER_MTOK") ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_USD_PER_MTOK;
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ===================== أدوات ===================== */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// الدالة أو الجدول غير موجود (الترحيل لم يُطبَّق): PGRST202/42883 للدالة، PGRST205/42P01 للجدول
const missing = (error: { code?: string | null } | null | undefined): boolean =>
  ["PGRST202", "42883", "PGRST205", "42P01"].includes(error?.code ?? "");

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => ({}));
  return isObject(body) ? body : {};
}

// نص خطأ من المزوّد أو القاعدة قبل تسجيله أو حفظه: الجوالات والبريد مُخفاة، وما بقي من أرقام طويلة x، والنص العربي
// (ما قد يردّده المزوّد من الرسالة نفسها) محذوف، والطول محدود
const ARABIC_RUN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g;
export function safeErrorText(text: string, max = 300): string {
  return scrubPhones(new Redactor().redact(capRuns(String(text ?? ""))))
    .replace(ARABIC_RUN, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function logDb(tag: string, error: { code?: string | null; message?: string | null }) {
  console.error("wa-triage", tag, error.code ?? "", safeErrorText(error.message ?? "", 200));
}

/* ===================== الدخول ===================== */

export async function handler(req: Request, deps: Partial<Deps> = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("طلب غير مدعوم", 405);

  try {
    const ctx: Deps = {
      db: deps.db ?? service(),
      env: deps.env ?? ((name: string) => Deno.env.get(name)),
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
      now: deps.now ?? Date.now,
    };
    const t0 = ctx.now();

    // أداة التقييم (scripts/jev-eval): تذكرة بدل جلسة مدير، يُتحقق منها قبل قراءة الجسم، ثم تُحجز منها عناصره قبل
    // أي عمل آخر. لا ذاكرة تُقرأ ولا تُكتب، والرد بالاحتمالات كاملة.
    const ticket = req.headers.get("x-triage-ticket");
    if (ticket !== null) return await evalCall(ctx, req, ticket, t0);

    // المدير: رمز جلسة صالح لحساب مدير غير موقوف، قبل قراءة الجسم
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("غير مصرح", 401);
    const { data: caller, error: callerErr } = await ctx.db.auth.getUser(token);
    if (callerErr || !caller?.user) return fail("غير مصرح", 401);
    const { data: me } = await ctx.db.from("profiles").select("id, role, is_blocked").eq("id", caller.user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.is_blocked) return fail("هذه العملية للمدير فقط", 403);

    const body = await readBody(req);
    const action = String(body.action ?? "");
    if (action === "status") return json(await status(ctx));
    if (action === "triage") {
      const parsed = parseTriage(body, "page");
      if ("error" in parsed) return fail(parsed.error, parsed.status);
      return await triage(ctx, parsed, { purpose: "page", userId: String(me.id) }, t0);
    }
    if (action === "label") return await label(ctx, body, String(me.id));
    return fail("إجراء غير معروف");
  } catch (e) {
    console.error("wa-triage", safeErrorText(String((e as Error)?.message ?? e)));
    return fail("خطأ داخلي", 500);
  }
}

// التذكرة على ثلاث خطوات: (1) صلاحيتها قبل قراءة الجسم — p_items = 0 يتحقق ولا يحجز شيئاً (026)، فلا يُقرأ جسم ولا
// يُردّ بخطأ تحقق لمن لا يحمل تذكرة صالحة؛ (2) الجسم والتحقق منه؛ (3) حجز عناصره، وقد نفدت التذكرة بينهما فيُرفض.
async function evalCall(ctx: Deps, req: Request, ticket: string, t0: number): Promise<Response> {
  if (!ticket || ticket.length > MAX_TICKET) return fail("غير مصرح", 401);
  const hash = await sha256Hex(ticket);
  const valid = await takeTicket(ctx.db, hash, 0);
  if (valid) return valid;
  const body = await readBody(req);
  if (String(body.action ?? "") !== "triage") return fail("غير مسموح", 403);
  const parsed = parseTriage(body, "eval");
  if ("error" in parsed) return fail(parsed.error, parsed.status);
  const taken = await takeTicket(ctx.db, hash, parsed.items.length);
  if (taken) return taken;
  return await triage(ctx, parsed, { purpose: "eval", userId: null }, t0);
}

// يحجز items عنصراً من التذكرة (0: تحقق فقط). null إن قُبلت، وإلا الرد: 401 لتذكرة مرفوضة، وتخطٍّ برسالة إن لم
// يُطبَّق الترحيل، و500 لتعذّر القاعدة بلا نصها
async function takeTicket(db: SupabaseClient, hash: string, items: number): Promise<Response | null> {
  const { data, error } = await db.rpc("wa_triage_take_ticket", { p_hash: hash, p_items: items });
  if (error) {
    if (missing(error)) return json({ status: "skipped", message: NOT_READY_AR });
    logDb("ticket", error);
    return fail("تعذّر التحقق من التذكرة", 500);
  }
  return isObject(data) && data.ok === true ? null : fail("غير مصرح", 401);
}

/* ===================== status ===================== */

async function readMode(db: SupabaseClient): Promise<Mode | null> {
  const { data, error } = await db.from("crm_settings").select("value").eq("key", "wa_triage_mode").maybeSingle();
  if (error) {
    logDb("settings", error);
    return null;
  }
  const value = data?.value;
  // غياب الصف، أو قيمة غير معروفة: suggest
  return typeof value === "string" && (MODES as readonly string[]).includes(value) ? value as Mode : "suggest";
}

// إنفاق الفرز اليوم وسقفه. "missing": الدالة غير موجودة (الترحيل لم يُطبَّق)؛ null: تعذّرت القراءة
async function readBudget(db: SupabaseClient): Promise<{ spent: number; cap: number } | "missing" | null> {
  const { data, error } = await db.rpc("wa_triage_budget");
  if (error) {
    if (missing(error)) return "missing";
    logDb("budget", error);
    return null;
  }
  const spent = Number(isObject(data) ? data.spent_usd : NaN);
  const cap = Number(isObject(data) ? data.cap_usd : NaN);
  return Number.isFinite(spent) && Number.isFinite(cap) ? { spent, cap } : null;
}

async function status(ctx: Deps): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    status: "success", enabled: false, mode: "suggest", model: triageModel(ctx.env), qset: DEFAULT_QSET,
    spent_today_usd: null, cap_usd: null, message: null,
  };
  try {
    const mode = await readMode(ctx.db);
    if (mode === null) return { ...out, message: SETTINGS_AR };
    out.mode = mode;
    const budget = await readBudget(ctx.db);
    if (budget === "missing") return { ...out, message: NOT_READY_AR };
    if (budget) {
      out.spent_today_usd = round6(budget.spent);
      out.cap_usd = budget.cap;
    }
    if (!apiKey(ctx.env)) return { ...out, message: DISABLED_AR };
    if (mode === "off") return { ...out, message: OFF_AR };
    if (!isCurrentQset(DEFAULT_QSET)) return { ...out, message: STALE_AR };
    return { ...out, enabled: true };
  } catch (e) {
    console.error("wa-triage status", safeErrorText(String((e as Error)?.message ?? e)));
    return { ...out, enabled: false, message: STATUS_AR };
  }
}

/* ===================== triage ===================== */

interface Item {
  ref: string;
  text: string; // مقطوع إلى MAX_TEXT
  group: string;
  regexKind: string | null;
  shas: string[];
}

interface Parsed {
  qset: string;
  items: Item[];
}

interface Caller {
  purpose: "page" | "eval";
  userId: string | null;
}

// جسم triage بعد التحقق، أو رسالة الرفض. الصفحة لا تختار مجموعة أسئلة غير الافتراضية؛ التقييم يختار أياً منها
function parseTriage(body: Record<string, unknown>, purpose: Caller["purpose"]): Parsed | { error: string; status: number } {
  if (body.override !== undefined) return purpose === "page" ? { error: "غير مسموح", status: 403 } : { error: OVERRIDE_AR, status: 400 };
  const list = body.items;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ITEMS) return { error: "عدد العناصر غير صالح", status: 400 };
  let qset = DEFAULT_QSET;
  if (body.qset !== undefined && body.qset !== null && body.qset !== DEFAULT_QSET) {
    if (purpose !== "eval") return { error: "غير مسموح", status: 403 };
    if (typeof body.qset !== "string" || !Object.hasOwn(QSETS, body.qset)) return { error: "مجموعة أسئلة غير معروفة", status: 400 };
    qset = body.qset;
  }
  const items: Item[] = [];
  const refs = new Set<string>();
  for (const raw of list) {
    if (!isObject(raw) || typeof raw.ref !== "string" || !raw.ref || raw.ref.length > MAX_REF || refs.has(raw.ref)) {
      return { error: "عنصر غير صالح", status: 400 };
    }
    if (typeof raw.text !== "string") return { error: "عنصر غير صالح", status: 400 };
    refs.add(raw.ref);
    const shas = Array.isArray(raw.source_shas) ? raw.source_shas.filter((s): s is string => typeof s === "string" && SHA.test(s)) : [];
    items.push({
      ref: raw.ref,
      text: raw.text.slice(0, MAX_TEXT),
      group: typeof raw.group === "string" ? raw.group.slice(0, MAX_GROUP) : "",
      regexKind: typeof raw.regex_kind === "string" && REGEX_KIND.test(raw.regex_kind) ? raw.regex_kind : null,
      shas: [...new Set(shas)].slice(0, MAX_SHAS),
    });
  }
  return { qset, items };
}

type UnitResult =
  | { ok: true; cached: boolean; verdict: Verdict; reasons: string[]; answers: Answers; truncated: boolean; ownerLabel: string | null }
  | { ok: false; error: string };

// وحدة العمل: نص واحد. للصفحة تتوحد العناصر ذات البصمة الواحدة (نداء واحد وصف واحد)؛ للتقييم كل عنصر وحده
interface Unit {
  key: string;
  text: string;
  group: string;
  regexKind: string | null;
  shas: string[];
  result?: UnitResult;
  row?: Record<string, unknown>; // صف wa_triage الجديد (للصفحة)
  hitShas?: string[]; // بصمات صف محفوظ قبل الدمج
}

interface CacheRow {
  key: string;
  verdict: Verdict;
  reasons: unknown;
  answers: unknown;
  source_shas: unknown;
  owner_label: unknown;
}

async function readCache(db: SupabaseClient, qset: string, keys: string[]): Promise<Map<string, CacheRow>> {
  const out = new Map<string, CacheRow>();
  if (!keys.length) return out;
  const { data, error } = await db.from("wa_triage").select("key, verdict, reasons, answers, source_shas, owner_label")
    .eq("qset", qset).in("key", keys);
  if (error) {
    logDb("cache", error); // بلا ذاكرة هذه المرة: يُسأل Jev
    return out;
  }
  for (const row of (data ?? []) as CacheRow[]) {
    if (row && typeof row.key === "string" && ["send", "review", "skip"].includes(row.verdict)) out.set(row.key, row);
  }
  return out;
}

const shaList = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

interface Stats {
  jevCalls: number;
  cached: number;
  errors: number;
  inputTokens: number;
  cost: number;
  model: string | null;
  provider: string | null;
  errorKinds: Map<string, number>;
  firstError: string | null;
}

async function triage(ctx: Deps, parsed: Parsed, caller: Caller, t0: number): Promise<Response> {
  const page = caller.purpose === "page";
  const { qset } = parsed;
  const stats: Stats = {
    jevCalls: 0, cached: 0, errors: 0, inputTokens: 0, cost: 0, model: null, provider: null,
    errorKinds: new Map(), firstError: null,
  };
  // سطر wa_triage_calls واحد لكل نداء، ومعه سبب التخطي إن تُخطّي
  const logCall = async (error: string | null) => {
    const { error: insErr } = await ctx.db.from("wa_triage_calls").insert({
      purpose: caller.purpose,
      requested_by: caller.userId,
      model: stats.model,
      provider: stats.provider,
      items: parsed.items.length,
      jev_calls: stats.jevCalls,
      cached: stats.cached,
      errors: stats.errors,
      input_tokens: stats.inputTokens,
      cost_usd: round6(stats.cost),
      duration_ms: Math.max(0, Math.round(ctx.now() - t0)),
      error: error ? error.slice(0, 500) : null,
    });
    if (insErr) logDb("calls", insErr);
  };
  const skipped = async (message: string, code: string) => {
    await logCall("skipped: " + code);
    return json({ status: "skipped", message });
  };

  // 1) الوضع والسر ومجموعة الأسئلة والسقف (السقف يوقف الصفحة وحدها؛ للتذكرة سقف عناصرها)
  const mode = await readMode(ctx.db);
  if (mode === null) {
    await logCall("error: settings_unreadable");
    return fail(SETTINGS_AR, 500);
  }
  if (mode === "off") return await skipped(OFF_AR, "mode_off");
  const key = apiKey(ctx.env);
  if (!key) return await skipped(DISABLED_AR, "disabled");
  if (!isCurrentQset(qset)) return await skipped(STALE_AR, "qset_stale");
  const budget = await readBudget(ctx.db);
  if (budget === "missing") return json({ status: "skipped", message: NOT_READY_AR });
  if (page && budget === null) {
    await logCall("error: budget_unreadable");
    return fail("تعذّر قراءة سقف الفرز اليومي", 500);
  }
  if (page && budget && budget.spent >= budget.cap) return await skipped(CAP_AR, "budget_reached");

  // 2) البصمات والوحدات
  const keys = await Promise.all(parsed.items.map((it) => sha256Hex(it.text.trim())));
  const units: Unit[] = [];
  const unitOf: Unit[] = [];
  const byKey = new Map<string, Unit>();
  parsed.items.forEach((it, i) => {
    let unit = page ? byKey.get(keys[i]) : undefined;
    if (unit) {
      for (const sha of it.shas) if (!unit.shas.includes(sha)) unit.shas.push(sha);
    } else {
      unit = { key: keys[i], text: it.text, group: it.group, regexKind: it.regexKind, shas: [...it.shas] };
      units.push(unit);
      if (page) byKey.set(unit.key, unit);
    }
    unitOf.push(unit);
  });

  // 3) الذاكرة (للصفحة)، ثم ما لا يحتاج Jev
  const cache = page ? await readCache(ctx.db, qset, [...byKey.keys()]) : new Map<string, CacheRow>();
  const queue: Unit[] = [];
  const nowIso = () => new Date(ctx.now()).toISOString();
  for (const unit of units) {
    const hit = cache.get(unit.key);
    if (!unit.text.trim()) {
      unit.result = { ok: false, error: "empty" };
    } else if (hit) {
      const stored = readStored(hit.answers);
      unit.result = {
        ok: true, cached: true, verdict: hit.verdict,
        reasons: Array.isArray(hit.reasons) ? hit.reasons.filter((r): r is string => typeof r === "string") : [],
        answers: stored.answers, truncated: stored.truncated,
        ownerLabel: typeof hit.owner_label === "string" && INTENT_SET.has(hit.owner_label) ? hit.owner_label : null,
      };
      unit.hitShas = shaList(hit.source_shas);
    } else if (unit.regexKind === "document") {
      // ملف فقط: حكم الكود بلا نداء، ويُحفظ
      const { verdict, reasons } = decide({}, "document");
      unit.result = { ok: true, cached: false, verdict, reasons, answers: {}, truncated: false, ownerLabel: null };
      unit.row = rowOf(unit, qset, "code", verdict, reasons, {}, false, null, null, caller.userId, nowIso());
    } else {
      queue.push(unit);
    }
  }

  // 4) Jev: ستة نداءات معاً، ولا نداء يبدأ بعد START_CUTOFF_MS
  const model = triageModel(ctx.env);
  const price = usdPerMtok(ctx.env);
  const deadline = t0 + DEADLINE_MS;
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const unit = queue[next++];
      if (ctx.now() - t0 >= START_CUTOFF_MS) {
        unit.result = { ok: false, error: "deadline" };
        continue;
      }
      stats.jevCalls++;
      try {
        await askJev(ctx, unit, qset, key, model, price, deadline, stats, caller.userId, nowIso);
      } catch (e) {
        const err = e instanceof JevError ? e : null;
        const kind = err ? err.kind : "internal";
        unit.result = { ok: false, error: kind };
        const tag = err?.status ? `${kind} ${err.status}` : kind;
        stats.errorKinds.set(tag, (stats.errorKinds.get(tag) ?? 0) + 1);
        stats.firstError ??= safeErrorText(
          err ? (err.provider ? `${err.provider}: ` : "") + err.message : String((e as Error)?.message ?? e), 200,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  // 5) النتائج بترتيب الطلب
  const items = parsed.items.map((it, i) => {
    const unit = unitOf[i];
    const result = unit.result ?? { ok: false as const, error: "deadline" };
    if (result.ok && result.cached) stats.cached++;
    if (!result.ok) stats.errors++;
    return itemView(it.ref, unit.key, result, !page);
  });
  // ما لم يُسأل عنه Jev أصلاً: نص فارغ، أو لم يتسع له الوقت
  for (const kind of ["empty", "deadline"]) {
    const n = units.filter((u) => u.result?.ok === false && u.result.error === kind).length;
    if (n) stats.errorKinds.set(kind, n);
  }

  // 6) الكتابة (للصفحة): الأحكام الجديدة، ودمج بصمات النسخ في المحفوظ. فشل الكتابة لا يغيّر الرد
  if (page) await writeRows(ctx.db, qset, units, nowIso());
  const summary = stats.errorKinds.size
    ? [...stats.errorKinds].map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(", ") + (stats.firstError ? ": " + stats.firstError : "")
    : null;
  if (summary) console.error("wa-triage jev", caller.purpose, summary.slice(0, 500));
  await logCall(summary);

  return json({
    status: "success",
    model: stats.model ?? model,
    qset,
    items,
    usage: {
      jev_calls: stats.jevCalls, cached: stats.cached, errors: stats.errors,
      input_tokens: stats.inputTokens, cost_usd: round6(stats.cost),
    },
    spent_today_usd: budget ? round6(budget.spent + stats.cost) : null,
    cap_usd: budget ? budget.cap : null,
  });
}

// نداء Jev لوحدة واحدة: الإخفاء (Redactor واحد لنص الكتلة واسم مجموعتها)، ثم الأسئلة، ثم الحكم. السلاسل الطويلة من
// حروف البريد تُقصر قبل الإخفاء (capRuns: نمط البريد تربيعي عليها)، والبصمة unit.key على النص الأصلي
async function askJev(
  ctx: Deps, unit: Unit, qset: string, key: string, model: string, price: number, deadline: number,
  stats: Stats, userId: string | null, nowIso: () => string,
) {
  const redactor = new Redactor();
  const text = unit.text.trim();
  const capped = capRuns(text);
  const built = buildRequest(qset, { message: redactor.redact(capped), group: redactor.redact(capRuns(unit.group)) });
  // لم يرَ Jev الرسالة كاملة: قُطع رأسها، أو قُصرت فيها سلسلة طويلة
  const truncated = built.truncated || capped.length < text.length;
  const res = await callJev({
    apiKey: key, model, state: built.state, questions: built.questions, deadline, usdPerMtok: price,
    fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, now: ctx.now,
  });
  stats.inputTokens += res.usage.input_tokens;
  stats.cost += res.usage.cost_usd;
  stats.model ??= res.model;
  stats.provider ??= res.provider;

  const options = (id: string) => {
    const q = built.questions[id];
    return q && q.type === "choice" ? Object.keys((q as ChoiceQuestion).criteria) : [];
  };
  const answers: Answers = {
    intent: normalizeChoice(res.answers.intent, options("intent")),
    kind: normalizeChoice(res.answers.kind, options("kind")),
    city: normalizeChoice(res.answers.city, options("city")),
    // بلا حيٍّ من القائمة في الرسالة لا يُسأل Jev: الحي not_stated بالكود
    district: built.questions.district
      ? normalizeChoice(res.answers.district, options("district"))
      : { choice: "not_stated", confidence: null, probabilities: null, by: "code" },
    multiple: noulOf(res.answers.multiple),
  };
  const { verdict, reasons } = decide(answers, unit.regexKind);
  unit.result = { ok: true, cached: false, verdict, reasons, answers, truncated, ownerLabel: null };
  // حكم «تعذّر» (إجابة النية غائبة) لا يُحفظ: يُسأل Jev عنه مرة أخرى في التحميل القادم
  if (!reasons.includes("error")) {
    unit.row = rowOf(unit, qset, res.model, verdict, reasons, answers, truncated, res.usage.input_tokens, res.usage.cost_usd, userId, nowIso());
  }
}

function rowOf(
  unit: Unit, qset: string, model: string, verdict: Verdict, reasons: string[], answers: Answers, truncated: boolean,
  inputTokens: number | null, cost: number | null, userId: string | null, at: string,
): Record<string, unknown> {
  return {
    key: unit.key,
    qset,
    model,
    verdict,
    reasons,
    answers: compactAnswers(answers, { truncated }),
    regex_kind: unit.regexKind,
    source_shas: unit.shas,
    input_tokens: inputTokens,
    cost_usd: cost === null ? null : round6(cost),
    created_by: userId,
    updated_at: at,
  };
}

// ItemResult كما في المواصفة §7: الإجابات { choice, confidence }، والتقييم يزيد probabilities
function itemView(ref: string, key: string, result: UnitResult, withProbabilities: boolean): Record<string, unknown> {
  if (!result.ok) return { ref, key, ok: false, error: result.error };
  const view = (c: Answers["intent"]) => {
    if (!c) return null;
    return withProbabilities
      ? { choice: c.choice, confidence: c.confidence, probabilities: c.probabilities ?? null }
      : { choice: c.choice, confidence: c.confidence };
  };
  const a = result.answers;
  return {
    ref, key, ok: true, cached: result.cached, verdict: result.verdict, reasons: result.reasons, truncated: result.truncated,
    intent: view(a.intent), kind: view(a.kind), city: view(a.city), district: view(a.district),
    multiple: typeof a.multiple === "number" ? a.multiple : null,
    owner_label: result.ownerLabel,
  };
}

// الأحكام الجديدة تُدرج إن لم يسبقها صف (ON CONFLICT DO NOTHING: الحكم الأول يبقى ثابتاً، وتصحيح المالك لا يُمس)،
// ثم تُدمج بصمات النسخ الجديدة في الصفوف المحفوظة (ذاكرةٌ أصابت، أو صفٌّ كتبه نداء متزامن)
async function writeRows(db: SupabaseClient, qset: string, units: Unit[], at: string) {
  const fresh = units.filter((u) => u.row);
  const merges: { key: string; shas: string[]; known: string[] | null }[] = [];
  if (fresh.length) {
    const { data, error } = await db.from("wa_triage")
      .upsert(fresh.map((u) => u.row!), { onConflict: "key,qset", ignoreDuplicates: true }).select("key");
    if (error) logDb("write", error);
    else {
      const inserted = new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
      for (const u of fresh) if (!inserted.has(u.key) && u.shas.length) merges.push({ key: u.key, shas: u.shas, known: null });
    }
  }
  for (const u of units) {
    if (u.hitShas && u.shas.some((s) => !u.hitShas!.includes(s))) merges.push({ key: u.key, shas: u.shas, known: u.hitShas });
  }
  await Promise.all(merges.map((m) => mergeShas(db, qset, m.key, m.shas, m.known, at)));
}

async function mergeShas(db: SupabaseClient, qset: string, key: string, shas: string[], known: string[] | null, at: string) {
  let current = known;
  if (current === null) {
    const { data, error } = await db.from("wa_triage").select("source_shas").eq("key", key).eq("qset", qset).maybeSingle();
    if (error || !data) {
      if (error) logDb("shas", error);
      return;
    }
    current = shaList(data.source_shas);
  }
  const merged = [...current, ...shas.filter((s) => !current!.includes(s))];
  if (merged.length === current.length) return;
  const { error } = await db.from("wa_triage").update({ source_shas: merged, updated_at: at }).eq("key", key).eq("qset", qset);
  if (error) logDb("shas", error);
}

/* ===================== label ===================== */

// تصحيح المالك لنية Jev على أحدث صف لبصمة النص (أي مجموعة أسئلة)
async function label(ctx: Deps, body: Record<string, unknown>, userId: string): Promise<Response> {
  const key = typeof body.key === "string" ? body.key : "";
  const value = typeof body.label === "string" ? body.label : "";
  if (!SHA.test(key)) return fail("مفتاح غير صالح");
  if (!INTENT_SET.has(value)) return fail("تصنيف غير صالح");
  const { data: row, error } = await ctx.db.from("wa_triage").select("qset").eq("key", key)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (missing(error)) return fail(NOT_READY_AR, 503);
    logDb("label", error);
    return fail("تعذّر حفظ التصحيح", 500);
  }
  if (!row) return fail("غير موجود", 404);
  const at = new Date(ctx.now()).toISOString();
  const { data: updated, error: upErr } = await ctx.db.from("wa_triage")
    .update({ owner_label: value, owner_label_at: at, owner_label_by: userId, updated_at: at })
    .eq("key", key).eq("qset", row.qset).select("key");
  if (upErr) {
    logDb("label", upErr);
    return fail("تعذّر حفظ التصحيح", 500);
  }
  if (!updated || !updated.length) return fail("غير موجود", 404);
  return json({ status: "success" });
}

// نقطة الدخول: في Supabase (EdgeRuntime معرّف) أو عند تشغيل الملف مباشرة. الاختبارات تستورد handler فلا يبدأ خادم
if (import.meta.main || "EdgeRuntime" in globalThis) Deno.serve((req) => handler(req));
