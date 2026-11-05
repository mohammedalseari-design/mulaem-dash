// نظام ملائم العقاري — الربط مع مقسم: منطق وظيفة maqsam-link بلا قاعدة ولا خادم، فيُختبر كله بلا شبكة.
//
// ما يخرج من هنا إلى المتصفح أو القاعدة هو Stats وحدها: أعداد وبريد الموظفين. أرقام العملاء وأسماؤهم ونص الملخص والتفريغ
// تُقرأ لتُعدّ فقط، فلا تُرجع ولا تُحفظ ولا تُسجَّل. والمفتاحان لا يذهبان إلا إلى مقسم نفسه في ترويسة Basic.
//
// كل ما نعرفه عن مقسم من توثيق https://portal.av.maqsam.com/docs/v2/calls وحده. صيغة base_url وشكل agents وsummary
// وcallTranscription غير موثقة، فتُقرأ بحذر: الشكل غير المتوقع يُعدّ غياباً ولا يُسقط الفحص.

export const ALLOWED_DOMAIN = "maqsam.com";
export const MAX_REQUEST_BYTES = 8 * 1024;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const PROBE_TIMEOUT_MS = 15_000;
export const WINDOW_DAYS = 7;

const SECONDS_PER_DAY = 86_400;
const PAGE_CALLS = 100; // أقصى ما يعيده مقسم في الصفحة
const MAX_AGENTS = 50;
const LONG_ENOUGH_SECONDS = 30;
const MAX_HOST = 253;
const MAX_KEY_ID = 256;
const MAX_SECRET = 512;
const MIN_KEY_FOR_HINT = 8;
const HINT_LENGTH = 4;
const MAX_EMAIL = 254;
const MAX_DATE_MS = 8.64e15; // أكبر ما يقبله Date

export type CheckCode =
  | "ok"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server_error"
  | "bad_response";

const CHECK_CODES: readonly string[] = [
  "ok",
  "unauthorized",
  "not_found",
  "rate_limited",
  "timeout",
  "network",
  "server_error",
  "bad_response",
];

export interface AgentCount {
  email: string;
  calls: number;
}

export interface Stats {
  window_days: typeof WINDOW_DAYS;
  calls: number;
  capped: boolean;
  talked: number;
  long_enough: number;
  with_summary: number;
  with_transcript: number;
  latest_at: string | null;
  agents: AgentCount[];
  no_agent: number;
}

export interface Check {
  ok: boolean;
  code: CheckCode;
  at: string;
  stats: Stats | null;
}

export interface Link {
  connected: boolean;
  host: string | null;
  key_hint: string | null;
  connected_at: string | null;
  connected_by_name: string | null;
  check: Check | null;
}

// كما تعيدها public.maqsam_link_credentials()
export interface Credentials {
  host: string;
  key_id: string;
  secret: string;
  connected_at: string;
}

// صف public.maqsam_link كما يقرؤه الخادم
export interface LinkRow {
  host: string;
  key_hint: string | null;
  connected_at: string | null;
  connected_by: string | null;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_check_code: string | null;
  last_check_stats: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* ===================== النطاق ===================== */

// ما يعلق بأطراف اللصق: مسافات، وعلامات اتجاه خفية تأتي من الصفحات العربية. في وسط القيمة تبقى مرفوضة.
const PASTE_EDGES = /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+$/g;
const trimPaste = (value: string): string => value.replace(PASTE_EDGES, "");

const HOST_SHAPE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*maqsam\.com$/;

// قائمة السماح: maqsam.com ونطاقاته الفرعية لا غيرها، مطابقة تامة على الاسم بعد تحليله. تُفحص قبل كل طلب خارج، ومنها نطاق محفوظ.
export function isAllowedHost(host: unknown): host is string {
  if (typeof host !== "string" || host.length === 0 || host.length > MAX_HOST) return false;
  if (!HOST_SHAPE.test(host)) return false;
  let parsed: URL;
  try {
    parsed = new URL(`https://${host}/`);
  } catch {
    return false;
  }
  if (parsed.hostname !== host || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") return false;
  return host === ALLOWED_DOMAIN || host.endsWith(`.${ALLOWED_DOMAIN}`);
}

// يحوّل ما لصقه المدير إلى النطاق الذي يأتي بعد «api.»، أو null إن لم يكن مقبولاً. صيغة base_url غير موثقة، فيقبل النطاق وحده أو
// رابطاً كاملاً (http أو https مع مسار)، ويسقط أول مقطع portal أو api. أي رمز من @ \ % ? # أو مسافة في أي موضع يرفض القيمة كلها.
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const pasted = trimPaste(raw);
  if (pasted === "") return null;
  if (/[^\x21-\x7e]/.test(pasted) || /[@\\%?#]/.test(pasted)) return null;
  let host = pasted.toLowerCase().replace(/^https?:\/\//, "");
  const slash = host.indexOf("/");
  if (slash !== -1) host = host.slice(0, slash);
  host = host.replace(/^(?:portal|api)\./, "");
  return isAllowedHost(host) ? host : null;
}

/* ===================== المفتاحان ===================== */

export function cleanKeyId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = trimPaste(raw);
  if (value.length < 1 || value.length > MAX_KEY_ID) return null;
  return /^[\x21-\x7e]+$/.test(value) && !value.includes(":") ? value : null;
}

export function cleanSecret(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = trimPaste(raw);
  if (value.length < 1 || value.length > MAX_SECRET) return null;
  return /^[\x20-\x7e]+$/.test(value) ? value : null;
}

// التلميح الوحيد الذي يغادر الخادم: آخر 4 خانات من مفتاح طوله 8 فأكثر
export function keyHint(keyId: string): string | null {
  return keyId.length >= MIN_KEY_FOR_HINT ? keyId.slice(-HINT_LENGTH) : null;
}

export function basicAuth(keyId: string, secret: string): string {
  return `Basic ${btoa(`${keyId}:${secret}`)}`;
}

// رابط مكالمات آخر 7 أيام. https دائماً، والنطاق يُفحص هنا أيضاً فلا يُبنى رابط لغير مقسم. page غير مرسل: الصفحة الأولى وحدها،
// وترقيم الصفحات عند مقسم غير موثق.
export function callsUrl(host: string, nowMs: number): string {
  if (!isAllowedHost(host)) throw new Error("host is not allowed");
  const end = Math.floor(nowMs / 1000);
  const url = new URL(`https://api.${host}/v2/calls`);
  url.searchParams.set("start_time", String(end - WINDOW_DAYS * SECONDS_PER_DAY));
  url.searchParams.set("end_time", String(end));
  return url.toString();
}

/* ===================== قراءة رد مقسم ===================== */

// null يعني أن الحالة 200 والحكم للجسم
export function classifyStatus(status: number): CheckCode | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "server_error";
  return "bad_response";
}

// يقرأ بحد أقصى، وnull إن تجاوزه (ويُلغى الباقي فلا يُقرأ)
export async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

// جسم طلب الصفحة: كائن JSON، وnull لأي شيء غير ذلك
export function parseRequestBody(bytes: Uint8Array): Record<string, unknown> | null {
  const parsed = parseJson(bytes);
  return isRecord(parsed) ? parsed : null;
}

// قائمة المكالمات من 200 {"result":"success","message":[...]}، وnull لأي شيء غير ذلك
export function parseCallsBody(bytes: Uint8Array): unknown[] | null {
  const parsed = parseJson(bytes);
  if (!isRecord(parsed) || parsed.result !== "success" || !Array.isArray(parsed.message)) return null;
  return parsed.message;
}

/* ===================== الملخص ===================== */

// نصوص تعني «لا شيء»: تصل أحياناً من خادم يكتب القيمة الفارغة نصاً
const EMPTY_WORDS = /^(?:null|none|nil|undefined|n\/?a|\[\s*\]|\{\s*\})$/i;
const MAX_FILLED_DEPTH = 8;

// فيه كلام فعلاً: نص غير فارغ، أو قائمة أو كائن فيهما نص كهذا. الشكل غير موثق، فلا يُعدّ غلاف فارغ مثل {"text":""} نصاً موجوداً،
// لئلا تقول الصفحة إن النصوص موجودة وهي ليست كذلك. الأرقام والقيم المنطقية لا تُعدّ محتوى. والعمق محدود: الجسم يصل 20 م.ب.
function isFilled(value: unknown, depth = 0): boolean {
  if (typeof value === "string") {
    const text = value.trim();
    return text !== "" && !EMPTY_WORDS.test(text);
  }
  if (depth >= MAX_FILLED_DEPTH) return false;
  if (Array.isArray(value)) return value.some((item) => isFilled(item, depth + 1));
  if (isRecord(value)) return Object.values(value).some((item) => isFilled(item, depth + 1));
  return false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

// بالثواني؛ وما فوق 1e12 فبالميلي ثانية. وما لا يمثّله Date يُهمل، فلا يُسقط الملخص كله بقيمة واحدة غريبة.
function timestampMs(value: unknown): number | null {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return ms <= MAX_DATE_MS ? ms : null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL) return null;
  return /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) ? email : null;
}

// الأشكال المقبولة: قائمة كائنات فيها email، أو كائن واحد، أو قائمة نصوص. وما عداها لا موظف فيه.
function agentEmails(value: unknown): Set<string> {
  const emails = new Set<string>();
  const add = (candidate: unknown) => {
    const email = cleanEmail(candidate);
    if (email) emails.add(email);
  };
  if (Array.isArray(value)) {
    for (const item of value) add(isRecord(item) ? item.email : item);
  } else if (isRecord(value)) {
    add(value.email);
  }
  return emails;
}

export function computeStats(calls: unknown[]): Stats {
  let talked = 0;
  let longEnough = 0;
  let withSummary = 0;
  let withTranscript = 0;
  let noAgent = 0;
  let latest: number | null = null;
  const perAgent = new Map<string, number>();

  for (const raw of calls) {
    const call = isRecord(raw) ? raw : {};
    const state = typeof call.state === "string" ? call.state.trim().toLowerCase() : "";
    const duration = toNumber(call.duration);
    if ((state === "completed" || state === "serviced") && duration !== null && duration > 0) {
      talked++;
      if (duration >= LONG_ENOUGH_SECONDS) longEnough++;
    }
    if (isFilled(call.summary)) withSummary++;
    if (isFilled(call.callTranscription)) withTranscript++;

    const at = timestampMs(call.timestamp);
    if (at !== null && (latest === null || at > latest)) latest = at;

    const emails = agentEmails(call.agents);
    if (emails.size === 0) noAgent++;
    for (const email of emails) perAgent.set(email, (perAgent.get(email) ?? 0) + 1);
  }

  return {
    window_days: WINDOW_DAYS,
    calls: calls.length,
    capped: calls.length >= PAGE_CALLS,
    talked,
    long_enough: longEnough,
    with_summary: withSummary,
    with_transcript: withTranscript,
    latest_at: latest === null ? null : new Date(latest).toISOString(),
    agents: [...perAgent]
      .map(([email, count]) => ({ email, calls: count }))
      .sort((a, b) => b.calls - a.calls || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
      .slice(0, MAX_AGENTS),
    no_agent: noAgent,
  };
}

const toCount = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// حقول Stats وحدها من قيمة محفوظة: أي حقل آخر في الصف لا يصل المتصفح
export function pickStats(value: unknown): Stats | null {
  if (!isRecord(value)) return null;
  const agents = (Array.isArray(value.agents) ? value.agents : [])
    .filter(isRecord)
    .flatMap((item) => {
      const email = cleanEmail(item.email);
      return email ? [{ email, calls: toCount(item.calls) }] : [];
    })
    .slice(0, MAX_AGENTS);
  return {
    window_days: WINDOW_DAYS,
    calls: toCount(value.calls),
    capped: value.capped === true,
    talked: toCount(value.talked),
    long_enough: toCount(value.long_enough),
    with_summary: toCount(value.with_summary),
    with_transcript: toCount(value.with_transcript),
    latest_at: toIso(value.latest_at),
    agents,
    no_agent: toCount(value.no_agent),
  };
}

export function emptyLink(): Link {
  return { connected: false, host: null, key_hint: null, connected_at: null, connected_by_name: null, check: null };
}

export function linkFromRow(row: LinkRow | null, connectedByName: string | null): Link {
  if (!row) return emptyLink();
  const at = toIso(row.last_check_at);
  const code = CHECK_CODES.includes(row.last_check_code ?? "") ? row.last_check_code as CheckCode : "bad_response";
  const ok = code === "ok" && row.last_check_ok === true;
  return {
    connected: true,
    host: row.host,
    key_hint: row.key_hint,
    connected_at: toIso(row.connected_at),
    connected_by_name: connectedByName,
    check: at === null ? null : { ok, code, at, stats: ok ? pickStats(row.last_check_stats) : null },
  };
}

/* ===================== الفحص ===================== */

export interface ProbeDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  timeoutMs?: number;
  // حالة HTTP وحدها للسجل، فلا يحتاج التشخيص إلى الجسم
  onStatus?: (status: number) => void;
}

const isAbortError = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError" || name === "TimeoutError";
};

const discardBody = (res: Response): void => {
  res.body?.cancel().catch(() => {});
};

// يطلب مكالمات آخر 7 أيام (الصفحة الأولى) ويحوّل الرد إلى Check. لا يرمي بسبب مقسم أبداً: كل فشل له رمز.
// المهلة تشمل الاتصال وقراءة الجسم كله، والجسم لا يُعاد ولا يُسجَّل.
export async function probe(creds: Omit<Credentials, "connected_at">, deps: ProbeDeps): Promise<Check> {
  const nowMs = deps.now();
  const at = new Date(nowMs).toISOString();
  const failed = (code: CheckCode): Check => ({ ok: false, code, at, stats: null });

  if (!isAllowedHost(creds.host)) return failed("network");
  const url = callsUrl(creds.host, nowMs);
  const authorization = basicAuth(creds.key_id, creds.secret);
  const controller = new AbortController();
  const lost = (error: unknown): Check => failed(controller.signal.aborted || isAbortError(error) ? "timeout" : "network");

  const attempt = async (): Promise<Check> => {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      return lost(error);
    }
    deps.onStatus?.(res.status);
    const refused = classifyStatus(res.status);
    if (refused !== null) {
      discardBody(res);
      return failed(refused);
    }
    if (Number(res.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      discardBody(res);
      return failed("bad_response");
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res.body, MAX_RESPONSE_BYTES);
    } catch (error) {
      return lost(error);
    }
    const calls = bytes === null ? null : parseCallsBody(bytes);
    if (calls === null) return failed("bad_response");
    return { ok: true, code: "ok", at, stats: computeStats(calls) };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Check>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(failed("timeout"));
    }, deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([attempt(), expired]);
  } finally {
    clearTimeout(timer);
  }
}
