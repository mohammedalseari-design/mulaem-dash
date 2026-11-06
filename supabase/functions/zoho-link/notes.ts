// نظام ملائم العقاري — نقل ملخص مقسم إلى ملاحظة في Zoho: قراءة المكالمة، وبناء الملاحظة، والبحث عن العميل، والكتابة بالحجز. تستعمله المعاينة
// وكتابة الملاحظة الواحدة ودورة المُجدوِل معاً، فلا تختلف الملاحظة بينها.
//
// ما يمر هنا ولا يبقى: رقم العميل واسمه والملخص والتفريغ في الذاكرة فقط أثناء بناء الملاحظة، ولا تذهب إلا إلى Zoho (وإلى المدير في المعاينة). لا تُحفظ
// ولا تُسجَّل، وما يُحفظ رقم المكالمة وحالتها ومعرّفات Zoho. التفريغ لا يُقرأ أصلاً: parseCall يتركه مع كل حقل لا تحتاجه الملاحظة.
//
// نص الملخص كلام عميل مرّ بذكاء صناعي، فهو بيانات لا أوامر: يُنظَّف ويبقى نصاً، ولا يدخل استعلاماً أبداً، ولا يقرر شيئاً.
import { basicAuth, classifyStatus, type CheckCode as MaqsamCode, isAllowedHost, MAX_RESPONSE_BYTES, parseCallsBody, readCapped } from "../maqsam-link/core.ts";
import { type ApiFail, CRM_ORIGIN, cleanName, coql, isRecord, type Net, ORG_DOMAIN, type ZohoSession } from "./core.ts";

export const PAGE_CALLS = 100;
export const MAX_SUMMARY_CHARS = 6_000;
export const STALE_MINUTES = 30;
const RIYADH_OFFSET_MS = 3 * 3_600_000;
const MAX_AGENTS = 5;
const MAX_CALL_ID_DIGITS = 15;
const MAQSAM_TIMEOUT_MS = 15_000;
const MAX_DATE_MS = 8.64e15;

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/* ===================== قراءة المكالمة ===================== */

export interface ParsedCall {
  id: number;
  atMs: number;
  state: string;
  direction: "outbound" | "inbound";
  duration: number;
  // 12 خانة تبدأ بـ 966، أو null
  number: string | null;
  agents: string[];
  summary: string | null;
}

export function parseCallId(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 && String(n).length <= MAX_CALL_ID_DIGITS ? n : null;
}

// بالثواني؛ وما فوق 1e12 فبالميلي ثانية
function timestampMs(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return ms <= MAX_DATE_MS ? ms : null;
}

// الرقم كما رأيناه من مقسم: 12 خانة تبدأ بـ 966. ما عداه لا يدخل استعلام Zoho أبداً، فلا رقم مزعوم ولا نص.
export function customerNumber(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string") return null;
  const digits = text.trim().replace(/^\+/, "");
  return /^966\d{9}$/.test(digits) ? digits : null;
}

// كل صيغة وُجدت في Leads عند Zoho: +966 و966 و05، وبلا صفر احتياطاً
export function numberForms(number: string): string[] {
  if (!/^966\d{9}$/.test(number)) throw new Error("number is not in the expected form");
  const local = number.slice(3);
  return [`+966${local}`, `966${local}`, `0${local}`, local];
}

// نص حر من مقسم: بلا رموز تحكم ولا علامات اتجاه خفية ولا وسوم، وبلا أسطر، فتبقى الملاحظة ثلاثة أسطر مهما كان فيه
export function cleanSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb<>]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const chars = Array.from(text);
  return chars.length > MAX_SUMMARY_CHARS ? `${chars.slice(0, MAX_SUMMARY_CHARS).join("")}…` : text;
}

function summaryOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return cleanSummary(value.ar) ?? cleanSummary(value.en);
}

function agentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = cleanName(item.name) ?? cleanName(item.email);
    if (name !== null) names.add(name);
  }
  return [...names].slice(0, MAX_AGENTS);
}

// حقول الملاحظة وحدها، فما عداها من رد مقسم لا يتجاوز هذه الدالة. null: مكالمة لا يُعرف رقمها أو وقتها أو اتجاهها.
export function parseCall(raw: unknown): ParsedCall | null {
  if (!isRecord(raw)) return null;
  const id = parseCallId(raw.id);
  const atMs = timestampMs(raw.timestamp);
  const direction = typeof raw.direction === "string" ? raw.direction.trim().toLowerCase() : "";
  if (id === null || atMs === null || (direction !== "outbound" && direction !== "inbound")) return null;
  const duration = typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : 0;
  return {
    id,
    atMs,
    state: typeof raw.state === "string" ? raw.state.trim().toLowerCase() : "",
    direction,
    duration,
    number: customerNumber(direction === "outbound" ? raw.calleeNumber : raw.callerNumber),
    agents: agentNames(raw.agents),
    summary: summaryOf(raw.summary),
  };
}

// مكالمة تكلم فيها طرفان: ما عداها لا ملخص يُنتظر لها ولا صف
export const isCandidate = (call: ParsedCall): boolean => (call.state === "completed" || call.state === "serviced") && call.duration > 0;

/* ===================== الملاحظة ===================== */

export interface Note {
  title: string;
  text: string;
}

// 5 نوفمبر 4:51 م. الرياض بلا توقيت صيفي، فلا يتوقف الناتج على إعدادات الخادم
export function riyadhLabel(ms: number): string {
  const d = new Date(ms + RIYADH_OFFSET_MS);
  const hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hours % 12 || 12}:${minutes} ${hours < 12 ? "ص" : "م"}`;
}

// 3 د 12 ث
export function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} ث`;
  return rest === 0 ? `${minutes} د` : `${minutes} د ${rest} ث`;
}

export const noteTitle = (callId: number): string => `مكالمة مقسم #${callId}`;

// الصيغة التي رآها المالك بنصها. summary مطلوب: لا ملاحظة بلا ملخص
export function buildNote(call: ParsedCall & { summary: string }): Note {
  return {
    title: noteTitle(call.id),
    text: [
      `مكالمة مقسم: ${riyadhLabel(call.atMs)}، ${call.direction === "outbound" ? "صادرة" : "واردة"}، ${durationLabel(call.duration)}`,
      `الموظف: ${call.agents.length ? call.agents.join("، ") : "بلا موظف"}`,
      `الملخص: ${call.summary}`,
    ].join("\n"),
  };
}

export const hasSummary = (call: ParsedCall): call is ParsedCall & { summary: string } => call.summary !== null;

export const recordUrl = (module: string, id: string): string => `${CRM_ORIGIN}/crm/${ORG_DOMAIN}/tab/${module}/${id}`;

/* ===================== مقسم ===================== */

export interface MaqsamCredentials {
  host: string;
  key_id: string;
  secret: string;
  connected_at: string;
}

export type MaqsamFail = Exclude<MaqsamCode, "ok">;

async function maqsamGet(creds: MaqsamCredentials, url: string, net: Net, left: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: MaqsamFail }> {
  if (left <= 0) return { ok: false, code: "timeout" };
  const controller = new AbortController();
  const attempt = async (): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: MaqsamFail }> => {
    let res: Response;
    const lost = (error: unknown): { ok: false; code: MaqsamFail } => {
      const name = (error as { name?: unknown } | null | undefined)?.name;
      return { ok: false, code: controller.signal.aborted || name === "AbortError" || name === "TimeoutError" ? "timeout" : "network" };
    };
    try {
      res = await net.fetch(url, {
        method: "GET",
        headers: { Authorization: basicAuth(creds.key_id, creds.secret), Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      return lost(error);
    }
    const refused = classifyStatus(res.status);
    if (refused !== null) {
      res.body?.cancel().catch(() => {});
      return { ok: false, code: refused as MaqsamFail };
    }
    if (Number(res.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      res.body?.cancel().catch(() => {});
      return { ok: false, code: "bad_response" };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res.body, MAX_RESPONSE_BYTES);
    } catch (error) {
      return lost(error);
    }
    return bytes === null ? { ok: false, code: "bad_response" } : { ok: true, bytes };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<{ ok: false; code: MaqsamFail }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, code: "timeout" });
    }, Math.min(net.callTimeoutMs ?? MAQSAM_TIMEOUT_MS, left));
  });
  try {
    return await Promise.race([attempt(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

// صفحة من مكالمات نافذة زمنية. الأولى page = 1 (جُرّب على حساب ملائم). القائمة تُفحص قبل كل طلب وقيمتها محفوظة.
export async function readCallsPage(
  creds: MaqsamCredentials,
  startSec: number,
  endSec: number,
  page: number,
  net: Net,
  left: number,
): Promise<{ ok: true; calls: unknown[] } | { ok: false; code: MaqsamFail }> {
  if (!isAllowedHost(creds.host)) return { ok: false, code: "network" };
  const url = new URL(`https://api.${creds.host}/v2/calls`);
  url.searchParams.set("start_time", String(Math.floor(startSec)));
  url.searchParams.set("end_time", String(Math.floor(endSec)));
  url.searchParams.set("page", String(page));
  const reply = await maqsamGet(creds, url.toString(), net, left);
  if (!reply.ok) return reply;
  const calls = parseCallsBody(reply.bytes);
  return calls === null ? { ok: false, code: "bad_response" } : { ok: true, calls };
}

function parseOneCall(bytes: Uint8Array): unknown {
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(parsed) && parsed.result === "success" && isRecord(parsed.message) ? parsed.message : null;
  } catch {
    return null;
  }
}

// مكالمة واحدة: {"result":"success","message":{...}}
export async function readCall(creds: MaqsamCredentials, callId: number, net: Net, left: number): Promise<{ ok: true; call: unknown } | { ok: false; code: MaqsamFail }> {
  if (!isAllowedHost(creds.host) || parseCallId(callId) === null) return { ok: false, code: "network" };
  const reply = await maqsamGet(creds, `https://api.${creds.host}/v2/calls/${callId}`, net, left);
  if (!reply.ok) return reply;
  const call = parseOneCall(reply.bytes);
  return call === null ? { ok: false, code: "bad_response" } : { ok: true, call };
}

/* ===================== العميل في Zoho ===================== */

export type ZohoModule = "Leads" | "Contacts";

export interface Match {
  module: ZohoModule;
  id: string;
  ambiguous: boolean;
}

export type LookupResult = { ok: true; match: Match | null } | { ok: false; code: ApiFail };

// كما يقبلها جدول maqsam_sync_calls: أرقام طويلة، فلا يمر رقم جوال ولا نص
const validId = (value: unknown): value is string => typeof value === "string" && /^\d{13,40}$/.test(value);

// الأحدث تعديلاً أولاً مهما كان ترتيب الرد: أكثر من صف لا يعني أكثر من ملاحظة أبداً
function pickRow(rows: Record<string, unknown>[], module: ZohoModule): Match | null {
  const valid = rows.filter((row) => validId(row.id));
  if (valid.length === 0) return null;
  const when = (row: Record<string, unknown>) => {
    const ms = typeof row.Modified_Time === "string" ? Date.parse(row.Modified_Time) : NaN;
    return Number.isNaN(ms) ? 0 : ms;
  };
  const newest = [...valid].sort((a, b) => when(b) - when(a))[0];
  return { module, id: newest.id as string, ambiguous: valid.length > 1 };
}

// الاستعلامان بالصيغة التي جُرّبت على المنشأة. الأرقام خانات فقط (numberForms)، فلا شيء من رد مقسم يدخل الاستعلام كما هو.
export async function lookupCustomer(session: ZohoSession, number: string): Promise<LookupResult> {
  const list = numberForms(number).map((form) => `'${form}'`).join(", ");
  const leads = await coql(
    session,
    `select id, Modified_Time from Leads where (Mobile in (${list}) or Phone in (${list})) and Converted__s = false order by Modified_Time desc limit 5`,
  );
  if (!leads.ok) return leads;
  const lead = pickRow(leads.rows, "Leads");
  if (lead) return { ok: true, match: lead };
  const contacts = await coql(
    session,
    `select id, Modified_Time from Contacts where Mobile in (${list}) or Phone in (${list}) order by Modified_Time desc limit 5`,
  );
  if (!contacts.ok) return contacts;
  return { ok: true, match: pickRow(contacts.rows, "Contacts") };
}

/* ===================== الكتابة ===================== */

export type CreateResult =
  | { kind: "created"; note_id: string }
  // مؤكد أنه لم يُكتب: رفض Zoho هذه الملاحظة بعينها
  | { kind: "refused" }
  // مؤكد أنه لم يُكتب: سبب عام يوقف الدورة
  | { kind: "not_written"; code: ApiFail }
  // لا نعرف: انقطع الرد، فيبقى الحجز حتى يفصل البحث بالعنوان
  | { kind: "unknown"; code: ApiFail };

// الكتابة الوحيدة في Zoho
export async function createNote(session: ZohoSession, note: Note, match: Match): Promise<CreateResult> {
  const reply = await session.request("POST", "/crm/v8/Notes", {
    data: [{ Note_Title: note.title, Note_Content: note.text, Parent_Id: { id: match.id, module: { api_name: match.module } } }],
  });
  if (!reply.ok) {
    if (reply.code === "refused" || reply.code === "not_found") return { kind: "refused" };
    if (reply.code === "timeout" || reply.code === "network" || reply.code === "server_error" || reply.code === "bad_response") return { kind: "unknown", code: reply.code };
    return { kind: "not_written", code: reply.code };
  }
  const first = Array.isArray(reply.body?.data) ? reply.body.data[0] : null;
  if (isRecord(first)) {
    if (first.status === "error") return { kind: "refused" };
    const details = first.details;
    if (first.status === "success" && isRecord(details) && validId(details.id)) return { kind: "created", note_id: details.id };
  }
  return { kind: "unknown", code: "bad_response" };
}

export type FindResult = { ok: true; note_id: string | null } | { ok: false; code: ApiFail };

// البحث بالعنوان بنصه قبل إعادة كتابة انقطع ردها. العنوان ثابت ورقم مكالمة، فلا شيء من الخارج يدخل الاستعلام.
export async function findNoteByTitle(session: ZohoSession, callId: number): Promise<FindResult> {
  if (parseCallId(callId) === null) throw new Error("call id is not in the expected form");
  const rows = await coql(session, `select id from Notes where Note_Title = '${noteTitle(callId)}' limit 5`);
  if (!rows.ok) return rows;
  const found = rows.rows.find((row) => validId(row.id));
  return { ok: true, note_id: found ? found.id as string : null };
}

export interface ClaimRow {
  outcome: "claimed" | "written" | "busy" | "stale" | "disabled";
  zoho_module?: string | null;
  zoho_record_id?: string | null;
  zoho_note_id?: string | null;
}

export interface ClaimStore {
  claim: (input: { call_id: number; module: string; record_id: string; require_enabled: boolean; takeover: boolean }) => Promise<ClaimRow>;
  written: (input: { call_id: number; note_id: string; module: string; record_id: string; ambiguous?: boolean }) => Promise<void>;
  release: (input: { call_id: number; count: boolean }) => Promise<string | null>;
}

export type WriteOutcome =
  // fresh: كُتبت الآن. false: كانت مكتوبة، فلا تُحسب ولا تُسجَّل
  | { kind: "written"; note_id: string; module: string; record_id: string; fresh: boolean }
  // يكتبها غيرك الآن
  | { kind: "busy" }
  // النقل أُوقف بعد أن بدأت الدورة
  | { kind: "disabled" }
  // رفض Zoho هذه الملاحظة: أُعيدت إلى الانتظار أو صارت failed
  | { kind: "refused"; status: string | null }
  // سبب عام: لا تكمل
  | { kind: "stop"; code: ApiFail };

// حجز ثم كتابة ثم حفظ المعرّفات. فشل الحفظ بعد الكتابة يرمي ويترك الحجز، فيجد البحث بالعنوان الملاحظة بعد 30 دقيقة ولا تتكرر.
export async function writeWithClaim(
  session: ZohoSession,
  store: ClaimStore,
  call: ParsedCall & { summary: string },
  match: Match,
  requireEnabled: boolean,
): Promise<WriteOutcome> {
  const ask = (takeover: boolean) =>
    store.claim({ call_id: call.id, module: match.module, record_id: match.id, require_enabled: requireEnabled, takeover });

  let claim = await ask(false);
  if (claim.outcome === "stale") {
    const found = await findNoteByTitle(session, call.id);
    if (!found.ok) return { kind: "stop", code: found.code };
    if (found.note_id !== null) {
      const module = claim.zoho_module ?? match.module;
      const recordId = claim.zoho_record_id ?? match.id;
      await store.written({ call_id: call.id, note_id: found.note_id, module, record_id: recordId, ambiguous: match.ambiguous });
      return { kind: "written", note_id: found.note_id, module, record_id: recordId, fresh: false };
    }
    claim = await ask(true);
  }
  if (claim.outcome === "written") {
    return { kind: "written", note_id: claim.zoho_note_id ?? "", module: claim.zoho_module ?? match.module, record_id: claim.zoho_record_id ?? match.id, fresh: false };
  }
  if (claim.outcome === "disabled") return { kind: "disabled" };
  if (claim.outcome !== "claimed") return { kind: "busy" };

  // بحث قبل كل كتابة: لو ضاع سجل المطالبة (استرجاع قاعدة، أو رد ضاع ثم تأخر الملخص) لا تتكرر الملاحظة
  const landed = await findNoteByTitle(session, call.id);
  if (!landed.ok) {
    await store.release({ call_id: call.id, count: false });
    return { kind: "stop", code: landed.code };
  }
  if (landed.note_id !== null) {
    await store.written({ call_id: call.id, note_id: landed.note_id, module: match.module, record_id: match.id, ambiguous: match.ambiguous });
    return { kind: "written", note_id: landed.note_id, module: match.module, record_id: match.id, fresh: false };
  }

  const created = await createNote(session, buildNote(call), match);
  switch (created.kind) {
    case "created":
      await store.written({ call_id: call.id, note_id: created.note_id, module: match.module, record_id: match.id, ambiguous: match.ambiguous });
      return { kind: "written", note_id: created.note_id, module: match.module, record_id: match.id, fresh: true };
    case "refused":
      return { kind: "refused", status: await store.release({ call_id: call.id, count: true }) };
    case "not_written":
      await store.release({ call_id: call.id, count: false });
      return { kind: "stop", code: created.code };
    case "unknown":
      return { kind: "stop", code: created.code };
  }
}
