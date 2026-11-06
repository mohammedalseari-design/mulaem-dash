// نظام ملائم العقاري — الربط مع Zoho CRM: منطق وظيفة zoho-link بلا قاعدة ولا خادم، فيُختبر كله بلا شبكة.
//
// ما يخرج من هنا إلى المتصفح أو القاعدة هو Check وLink وحدهما: أعداد وأسماء موظفين. ولا يخرج سر أبداً: Client ID وClient Secret والرمز ومفتاح
// التجديد لا تذهب إلا إلى Zoho نفسه في جسم نموذج (وترويسة Basic في الإبطال كما يطلبه توثيقه)، ولا تظهر في رابط أبداً. مفتاح الوصول يبقى في الذاكرة.
//
// النطاقان مكتوبان هنا ولا يؤخذان من رد أبداً: api_domain في رد Zoho إشارة تُقرأ فقط ولا يُرسل إليه شيء. ولا كتابة في Zoho من هذا الملف:
// الكتابة الوحيدة هي POST /crm/v8/Notes في notes.ts، وZohoSession يرفض أي طريق آخر.
//
// ما لم يُر بعد على منشأة حقيقية (لا يمكن إثباته بلا مفتاح): api_domain الفعلي، ورموز الخطأ من نقطة الرموز، وعدّ المستخدمين. لذلك لا يُسقط
// الربط إلا ما وُثّق وتأكد، ويسجَّل شكل كل رد (بلا جسمه) ليحسم أول ربط حي الباقي.
import { basicAuth, keyHint, MAX_REQUEST_BYTES, parseRequestBody, readCapped } from "../maqsam-link/core.ts";

export { keyHint, MAX_REQUEST_BYTES, parseRequestBody, readCapped };

export const ACCOUNTS_ORIGIN = "https://accounts.zoho.sa";
export const API_ORIGIN = "https://www.zohoapis.sa";
export const CRM_ORIGIN = "https://crm.zoho.sa";
export const ORG_DOMAIN = "org150000145002";
export const ORG_ZGID = "150000145002";
export const REQUIRED_PROFILE = "Administrator";

// نص الصلاحيات تعرضه الصفحة مع زر نسخ (crm/js/zoho-link-model.js). الخادم لا يراه: رد Zoho لا يذكر الصلاحيات، فيكشف الفحص نقص القراءة وقت الربط،
// وnotes.CREATE لا يُفحص لأن فحصها كتابة، فيظهر نقصها عند أول ملاحظة.

export const TOKEN_MAX_BYTES = 256 * 1024;
export const API_MAX_BYTES = 8 * 1024 * 1024;
export const CALL_TIMEOUT_MS = 12_000;
export const REVOKE_TIMEOUT_MS = 6_000;
export const WINDOW_DAYS = 7;

const TOKEN_URL = `${ACCOUNTS_ORIGIN}/oauth/v2/token`;
const REVOKE_URL = `${ACCOUNTS_ORIGIN}/oauth/v2/revoke/token`;
const MS_PER_DAY = 86_400_000;
const RIYADH_OFFSET_MS = 3 * 3_600_000;
const MAX_CLIENT_ID = 256;
const MAX_CLIENT_SECRET = 512;
const MAX_CODE = 1024;
const MAX_TOKEN = 4096;
const MAX_NAME = 100;
const MAX_ORG_NAME = 200;
const MAX_OWNERS = 50;
const LONG_ENOUGH_SECONDS = 30;
// Zoho لا يذكر كم يبقى الحظر: بقية نافذة 10 دقائق، فنفترض أسوأها
export const DENIED_WAIT_SECONDS = 600;

export type CheckCode =
  | "ok"
  | "invalid_client"
  | "invalid_code"
  | "throttled"
  | "no_refresh_token"
  | "wrong_environment"
  | "wrong_org"
  | "not_admin"
  | "token_revoked"
  | "scope_mismatch"
  | "no_permission"
  | "inactive_user"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server_error"
  | "bad_response";

export const CHECK_CODES: readonly string[] = [
  "ok",
  "invalid_client",
  "invalid_code",
  "throttled",
  "no_refresh_token",
  "wrong_environment",
  "wrong_org",
  "not_admin",
  "token_revoked",
  "scope_mismatch",
  "no_permission",
  "inactive_user",
  "rate_limited",
  "timeout",
  "network",
  "server_error",
  "bad_response",
];

// هذه الرموز لا يصلحها إلا مدير: الدورة تقف وتُرفع علامة needs_reconnect حتى ينجح فحص أو ربط جديد
export const RECONNECT_CODES: readonly string[] = [
  "invalid_client",
  "token_revoked",
  "scope_mismatch",
  "no_permission",
  "inactive_user",
  "wrong_environment",
  "wrong_org",
  "not_admin",
];

export interface OwnerCount {
  name: string;
  calls: number;
}

export interface Stats {
  window_days: typeof WINDOW_DAYS;
  calls: number | null;
  calls_linked: number | null;
  long_enough: number | null;
  by_owner: OwnerCount[];
  leads_new: number | null;
  active_users: number | null;
}

export interface Check {
  ok: boolean;
  code: CheckCode;
  at: string;
  stats: Stats | null;
}

export interface Link {
  connected: boolean;
  org_name: string | null;
  user_name: string | null;
  user_profile: string | null;
  client_hint: string | null;
  connected_at: string | null;
  connected_by_name: string | null;
  check: Check | null;
}

export interface Sync {
  enabled: boolean;
  started_at: string | null;
  start_from: string | null;
  started_by_name: string | null;
  last_run_at: string | null;
  last_run_code: string | null;
  written_total: number;
  written_7d: number;
  no_match_total: number;
  waiting: number;
  failed_total: number;
  ambiguous_total: number;
  needs_reconnect: boolean;
}

// كما تعيدها public.zoho_link_credentials()
export interface Credentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  connected_at: string;
}

// صف public.zoho_link كما يقرؤه الخادم
export interface LinkRow {
  org_name: string | null;
  user_name: string | null;
  user_profile: string | null;
  client_hint: string | null;
  connected_at: string | null;
  connected_by: string | null;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_check_code: string | null;
  last_check_stats: unknown;
}

// كما تعيدها public.maqsam_sync_status()
export interface SyncRow {
  enabled: boolean | null;
  started_at: string | null;
  start_from: string | null;
  started_by: string | null;
  last_run_at: string | null;
  last_run_code: string | null;
  needs_reconnect: boolean | null;
  written_total: number | null;
  written_7d: number | null;
  no_match_total: number | null;
  waiting: number | null;
  failed_total: number | null;
  ambiguous_total: number | null;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* ===================== ما يلصقه المدير ===================== */

// ما يعلق بأطراف اللصق: مسافات، وعلامات اتجاه خفية تأتي من الصفحات العربية. في وسط القيمة تبقى مرفوضة، فالمسافة الزائدة عند Zoho invalid_client
const PASTE_EDGES = /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]+$/g;

// القيم عند Zoho غير موثقة الشكل، فلا يُفرض إلا ما يصدّ الخطأ قبل أن يضيع رمز: نص مطبوع بلا مسافات
function cleanOpaque(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(PASTE_EDGES, "");
  if (value.length < 1 || value.length > max) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

// بلا نقطتين: ترويسة Basic في الإبطال تفصل بها
export function cleanClientId(raw: unknown): string | null {
  const value = cleanOpaque(raw, MAX_CLIENT_ID);
  return value !== null && !value.includes(":") ? value : null;
}

export const cleanClientSecret = (raw: unknown): string | null => cleanOpaque(raw, MAX_CLIENT_SECRET);
export const cleanCode = (raw: unknown): string | null => cleanOpaque(raw, MAX_CODE);

/* ===================== الشبكة ===================== */

// شكل رد واحد للسجل، بلا جسمه: يحسم أول ربط حي ما لا نعرفه عن Zoho، ولا يمكن أن يحمل سراً
export interface Shape {
  stage: string;
  status: number | null;
  content_type: string | null;
  is_json: boolean;
  code: string | null;
  has_access_token?: boolean;
  has_refresh_token?: boolean;
  has_scope?: boolean;
  api_domain?: string | null;
  expires_in?: number | null;
}

export interface Net {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  callTimeoutMs?: number;
  revokeTimeoutMs?: number;
  onShape?: (shape: Shape) => void;
}

// ميزانية الوقت كله لسلسلة نداءات. نداء بلا وقت باقٍ لا يبدأ، ومهلة كل نداء لا تتجاوز الباقي.
export class Budget {
  private readonly deadline: number;
  constructor(private readonly now: () => number, ms: number) {
    this.deadline = now() + ms;
  }
  left(): number {
    return this.deadline - this.now();
  }
}

type Sent =
  | { kind: "lost"; code: "timeout" | "network" }
  // text = null: أكبر من الحد أو ليس UTF-8، فلا يُقبل
  | { kind: "reply"; status: number; contentType: string | null; text: string | null };

const isAbortError = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === "AbortError" || name === "TimeoutError";
};

const discardBody = (res: Response): void => {
  res.body?.cancel().catch(() => {});
};

// نوع الرد للسجل فقط: الحكم للحالة والجسم، فمقسم وZoho يقدمان JSON أحياناً بنوع text/html
function contentTypeOf(res: Response): string | null {
  const value = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return /^[a-z]+\/[a-z0-9.+-]{1,60}$/.test(value) ? value : null;
}

// https بلا تحويل، بمهلة تشمل قراءة الجسم كله، وبحد للحجم. الجسم يُقرأ نصاً أولاً ولا يُسجَّل ولا يُعاد. لا يرمي بسبب الشبكة أبداً.
async function send(url: string, init: RequestInit, net: Net, cap: number, timeoutMs: number): Promise<Sent> {
  const controller = new AbortController();
  const lost = (error: unknown): Sent => ({ kind: "lost", code: controller.signal.aborted || isAbortError(error) ? "timeout" : "network" });

  const attempt = async (): Promise<Sent> => {
    let res: Response;
    try {
      res = await net.fetch(url, { ...init, redirect: "error", signal: controller.signal });
    } catch (error) {
      return lost(error);
    }
    const contentType = contentTypeOf(res);
    if (res.status === 204) {
      discardBody(res);
      return { kind: "reply", status: 204, contentType, text: "" };
    }
    if (Number(res.headers.get("content-length")) > cap) {
      discardBody(res);
      return { kind: "reply", status: res.status, contentType, text: null };
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(res.body, cap);
    } catch (error) {
      return lost(error);
    }
    if (bytes === null) return { kind: "reply", status: res.status, contentType, text: null };
    try {
      return { kind: "reply", status: res.status, contentType, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      return { kind: "reply", status: res.status, contentType, text: null };
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Sent>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "lost", code: "timeout" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([attempt(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (text === null || text === "") return null;
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/* ===================== نقطة الرموز ===================== */

export type TokenOk = {
  ok: true;
  access_token: string;
  refresh_token: string | null;
  api_domain: string | null;
  expires_in: number | null;
};

export type TokenFail = { ok: false; code: "invalid_client" | "invalid_code" | "throttled" | "timeout" | "network" | "server_error" | "bad_response" };

export type TokenResult = TokenOk | TokenFail;

// قيمة error المعروفة وحدها تدخل السجل
const TOKEN_ERRORS = ["invalid_client", "invalid_client_secret", "invalid_code", "access_denied", "invalid_redirect_uri", "invalid_request"];

function normalizeError(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
}

const validToken = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= MAX_TOKEN && /^[\x21-\x7e]+$/.test(value);

// الحكم لشكل الجسم لا للحالة وحدها: الأخطاء تأتي بـ 200 JSON، وأحياناً صفحة HTML. لا نجاح إلا 200 فيها مفتاح وصول.
export function classifyToken(status: number, text: string | null): TokenResult {
  const body = parseObject(text);
  if (body) {
    if (status === 200 && validToken(body.access_token)) {
      return {
        ok: true,
        access_token: body.access_token,
        refresh_token: validToken(body.refresh_token) ? body.refresh_token : null,
        api_domain: typeof body.api_domain === "string" ? body.api_domain : null,
        expires_in: typeof body.expires_in === "number" ? body.expires_in : null,
      };
    }
    const error = normalizeError(body.error);
    if (error === "invalid_client" || error === "invalid_client_secret") return { ok: false, code: "invalid_client" };
    if (error === "invalid_code") return { ok: false, code: "invalid_code" };
    if (error === "access_denied") return { ok: false, code: "throttled" };
  }
  if (status === 429) return { ok: false, code: "throttled" };
  // صفحة الحظر (Roadblock) بأي حالة، بنصها الموثق
  if (!body && text && /access denied|maximum request limit|too many requests/i.test(text)) return { ok: false, code: "throttled" };
  if (status >= 500 && status <= 599) return { ok: false, code: "server_error" };
  return { ok: false, code: "bad_response" };
}

function tokenShape(stage: string, sent: Extract<Sent, { kind: "reply" }>): Shape {
  const body = parseObject(sent.text);
  const error = normalizeError(body?.error);
  const domain = body?.api_domain;
  return {
    stage,
    status: sent.status,
    content_type: sent.contentType,
    is_json: body !== null,
    code: error === null ? null : TOKEN_ERRORS.includes(error) ? error : "other",
    has_access_token: validToken(body?.access_token),
    has_refresh_token: validToken(body?.refresh_token),
    has_scope: body !== null && "scope" in body,
    api_domain: typeof domain === "string" && /^https:\/\/[a-z0-9.-]{1,200}$/.test(domain) ? domain : null,
    expires_in: typeof body?.expires_in === "number" ? body.expires_in : null,
  };
}

async function tokenRequest(stage: string, form: Record<string, string>, net: Net, budget: Budget): Promise<TokenResult> {
  const left = budget.left();
  if (left <= 0) return { ok: false, code: "timeout" };
  const sent = await send(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    },
    net,
    TOKEN_MAX_BYTES,
    Math.min(net.callTimeoutMs ?? CALL_TIMEOUT_MS, left),
  );
  if (sent.kind === "lost") {
    net.onShape?.({ stage, status: null, content_type: null, is_json: false, code: sent.code });
    return { ok: false, code: sent.code };
  }
  net.onShape?.(tokenShape(stage, sent));
  return classifyToken(sent.status, sent.text);
}

export interface ClientValues {
  client_id: string;
  client_secret: string;
}

// مرة واحدة دائماً: الرمز لمرة واحدة ولو فشل استعماله، ومهلة بلا رد قد تكون أكلته. لا إعادة محاولة هنا ولا عند من يناديها.
export function exchangeCode(client: ClientValues, code: string, net: Net, budget: Budget): Promise<TokenResult> {
  return tokenRequest(
    "exchange",
    { client_id: client.client_id, client_secret: client.client_secret, grant_type: "authorization_code", code },
    net,
    budget,
  );
}

export function refreshAccess(client: ClientValues, refreshToken: string, net: Net, budget: Budget): Promise<TokenResult> {
  return tokenRequest(
    "refresh",
    { client_id: client.client_id, client_secret: client.client_secret, grant_type: "refresh_token", refresh_token: refreshToken },
    net,
    budget,
  );
}

// الإبطال: true لـ HTTP 200 وحده كما وثّقه Zoho. مرة واحدة بمهلة قصيرة خاصة به، فهو يعمل ولو انتهت ميزانية الباقي، ولا يرمي أبداً.
export async function revokeToken(
  client: ClientValues,
  token: string,
  kind: "refresh_token" | "access_token",
  net: Net,
): Promise<boolean> {
  let authorization: string;
  try {
    authorization = basicAuth(client.client_id, client.client_secret);
  } catch {
    // قيمة محفوظة لا تُرمَّز: لا إبطال، وهذا ما يقال، لا خطأ يُسقط ما تم
    return false;
  }
  const sent = await send(
    REVOKE_URL,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ token, token_type: kind }).toString(),
    },
    net,
    TOKEN_MAX_BYTES,
    net.revokeTimeoutMs ?? REVOKE_TIMEOUT_MS,
  );
  if (sent.kind === "lost") {
    net.onShape?.({ stage: "revoke", status: null, content_type: null, is_json: false, code: sent.code });
    return false;
  }
  net.onShape?.({ stage: "revoke", status: sent.status, content_type: sent.contentType, is_json: parseObject(sent.text) !== null, code: null });
  return sent.status === 200;
}

// api_domain إشارة لا عنوان: sandbox أو developer أو نطاق خارج .sa يعني بيئة أو مركز بيانات خطأ. وما عداها يترك لـ /org أن يحكم، فلا يضيع رمز بسبب قيمة لم يرها أحد بعد.
export function apiDomainSignal(value: string | null): "ok" | "wrong_environment" {
  if (value === null) return "ok";
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return "ok";
  }
  if (host.startsWith("sandbox.") || host.startsWith("developer.")) return "wrong_environment";
  return host === "zoho.sa" || host.endsWith(".sa") ? "ok" : "wrong_environment";
}

/* ===================== واجهة Zoho ===================== */

export type ApiFail =
  | "invalid_client"
  | "wrong_environment"
  | "throttled"
  | "token_revoked"
  | "scope_mismatch"
  | "no_permission"
  | "inactive_user"
  | "rate_limited"
  | "timeout"
  | "network"
  | "server_error"
  | "bad_response"
  // رفض Zoho الطلب نفسه (INVALID_QUERY وINVALID_DATA...): مؤكد أنه لم يكتب شيئاً
  | "refused"
  | "not_found";

export type ApiResult = { ok: true; status: number; body: Record<string, unknown> | null } | { ok: false; code: ApiFail };

const REAUTH_CODES = ["INVALID_TOKEN", "INVALID_OAUTHTOKEN", "AUTHENTICATION_FAILURE", "AUTHENTICATION_FAILED"];

// الرموز المعروفة وحدها تدخل السجل
const API_CODES = [
  ...REAUTH_CODES,
  "OAUTH_SCOPE_MISMATCH",
  "NO_PERMISSION",
  "INACTIVE_USER",
  "AUTHORIZATION_FAILED",
  "NOT_ALLOWED",
  "INVALID_QUERY",
  "SYNTAX_ERROR",
  "INVALID_DATA",
  "LIMIT_EXCEEDED",
  "INVALID_MODULE",
  "INVALID_URL_PATTERN",
  "INVALID_REQUEST_METHOD",
  "MANDATORY_NOT_FOUND",
  "EXPECTED_FIELD_MISSING",
  "TOO_MANY_REQUESTS",
  "RATE_LIMIT_EXCEEDED",
  "INTERNAL_ERROR",
  "SUCCESS",
];

// الرمز في أعلى الجسم، وفي عملية كتابة قد يكون في data[0]
function apiCode(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.code === "string") return body.code;
  const first = Array.isArray(body.data) ? body.data[0] : null;
  return isRecord(first) && typeof first.code === "string" ? first.code : null;
}

// reauth: مفتاح الوصول انتهى، ويستحق تجديداً واحداً. غيره لا يصلحه تجديد: رمز 401 له معانٍ عدة فالفرع على الرمز لا على الحالة.
export function classifyApi(status: number, text: string | null): ApiResult | { ok: false; code: "reauth" } {
  const body = parseObject(text);
  const code = apiCode(body);
  if (status === 204) return { ok: true, status, body: null };
  if (status >= 200 && status <= 299) return body ? { ok: true, status, body } : { ok: false, code: "bad_response" };
  if (status === 401) {
    if (code !== null && REAUTH_CODES.includes(code)) return { ok: false, code: "reauth" };
    if (code === "OAUTH_SCOPE_MISMATCH") return { ok: false, code: "scope_mismatch" };
    return { ok: false, code: "token_revoked" };
  }
  if (status === 403) return { ok: false, code: code === "INACTIVE_USER" ? "inactive_user" : "no_permission" };
  if (status === 400) {
    if (code === "AUTHORIZATION_FAILED") return { ok: false, code: "no_permission" };
    return { ok: false, code: code === null ? "bad_response" : "refused" };
  }
  if (status === 404) return { ok: false, code: "not_found" };
  if (status === 429) return { ok: false, code: "rate_limited" };
  if (status >= 500 && status <= 599) return { ok: false, code: "server_error" };
  return { ok: false, code: "bad_response" };
}

function apiShape(stage: string, sent: Extract<Sent, { kind: "reply" }>): Shape {
  const body = parseObject(sent.text);
  const code = apiCode(body);
  return {
    stage,
    status: sent.status,
    content_type: sent.contentType,
    is_json: body !== null,
    code: code === null ? null : API_CODES.includes(code) ? code : "other",
  };
}

// الكتابة الوحيدة في Zoho، وCOQL قراءة في صورة POST. أي طريق أو فعل غيرهما يُرفض هنا قبل أن يخرج.
const ALLOWED_POST = ["/crm/v8/coql", "/crm/v8/Notes"];

export interface SessionDeps {
  net: Net;
  // من القاعدة: Zoho يحظر بعد عشرة تجديدات في 10 دقائق، والوظائف بلا حالة
  refreshBegin: () => Promise<{ allowed: boolean; wait_seconds: number }>;
  tokenDenied: () => Promise<void>;
}

// جلسة نداءات بمفتاح وصول في الذاكرة. يُطلب المفتاح عند أول حاجة، فلا تجديد إن لم يكن هناك ما يُفعل، ويُجدد مرة واحدة إن قال Zoho إنه انتهى.
export class ZohoSession {
  private access: string | null;
  private reauthorized = false;
  // كم ينتظر، إن كان آخر فشل حظراً
  waitSeconds = 0;

  constructor(
    private readonly client: ClientValues,
    private readonly refreshToken: string,
    private readonly deps: SessionDeps,
    private readonly budget: Budget,
    access: string | null = null,
  ) {
    this.access = access;
  }

  private async renew(): Promise<ApiFail | null> {
    const gate = await this.deps.refreshBegin();
    if (!gate.allowed) {
      this.waitSeconds = gate.wait_seconds;
      return "throttled";
    }
    const token = await refreshAccess(this.client, this.refreshToken, this.deps.net, this.budget);
    if (!token.ok) {
      if (token.code === "throttled") {
        await this.deps.tokenDenied();
        this.waitSeconds = DENIED_WAIT_SECONDS;
        return "throttled";
      }
      // invalid_code في التجديد معناه أن مفتاح التجديد نفسه مات
      return token.code === "invalid_code" ? "token_revoked" : token.code;
    }
    if (apiDomainSignal(token.api_domain) === "wrong_environment") return "wrong_environment";
    this.access = token.access_token;
    return null;
  }

  private async once(method: "GET" | "POST", path: string, payload: unknown): Promise<ApiResult | { ok: false; code: "reauth" }> {
    const left = this.budget.left();
    if (left <= 0) return { ok: false, code: "timeout" };
    const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${this.access}`, Accept: "application/json" };
    const init: RequestInit = { method, headers };
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload);
    }
    const net = this.deps.net;
    const sent = await send(`${API_ORIGIN}${path}`, init, net, API_MAX_BYTES, Math.min(net.callTimeoutMs ?? CALL_TIMEOUT_MS, left));
    const stage = path.split("?")[0].replace(/^\/crm\/v8\//, "");
    if (sent.kind === "lost") {
      net.onShape?.({ stage, status: null, content_type: null, is_json: false, code: sent.code });
      return { ok: false, code: sent.code };
    }
    net.onShape?.(apiShape(stage, sent));
    return classifyApi(sent.status, sent.text);
  }

  async request(method: "GET" | "POST", path: string, payload?: unknown): Promise<ApiResult> {
    if (!path.startsWith("/crm/v8/") || (method === "POST" && !ALLOWED_POST.includes(path))) {
      throw new Error("zoho: this request is not allowed");
    }
    if (this.access === null) {
      const failure = await this.renew();
      if (failure !== null) return { ok: false, code: failure };
    }
    const first = await this.once(method, path, payload);
    if (first.ok || first.code !== "reauth") return first as ApiResult;
    if (this.reauthorized) return { ok: false, code: "token_revoked" };
    this.reauthorized = true;
    const failure = await this.renew();
    if (failure !== null) return { ok: false, code: failure };
    const second = await this.once(method, path, payload);
    return second.ok || second.code !== "reauth" ? second as ApiResult : { ok: false, code: "token_revoked" };
  }
}

export type RowsResult = { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: ApiFail };

// 204 يعني لا صفوف، بجسم فارغ
export async function coql(session: ZohoSession, query: string): Promise<RowsResult> {
  const res = await session.request("POST", "/crm/v8/coql", { select_query: query });
  if (!res.ok) return res;
  if (res.body === null) return { ok: true, rows: [] };
  if (!Array.isArray(res.body.data)) return { ok: false, code: "bad_response" };
  return { ok: true, rows: res.body.data.filter(isRecord) };
}

/* ===================== الفحص ===================== */

// نص قصير من Zoho يُحفظ أو يُعرض: اسم منشأة أو موظف، بلا رموز تحكم
export function cleanName(value: unknown, max = MAX_NAME): string | null {
  if (typeof value !== "string") return null;
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, " ").replace(/\s+/g, " ").trim();
  return text === "" ? null : Array.from(text).slice(0, max).join("");
}

// تاريخ COQL بتوقيت الرياض، بالصيغة التي جُرّبت على المنشأة الحقيقية
export function riyadhIso(ms: number): string {
  return `${new Date(ms + RIYADH_OFFSET_MS).toISOString().slice(0, 19)}+03:00`;
}

const toCount = (value: unknown): number | null => {
  const n = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

// القيمة بمفتاح COUNT(id) كما رأيناها، وإلا القيمة العددية الوحيدة في الصف
function rowCount(row: Record<string, unknown>): number | null {
  const named = toCount(row["COUNT(id)"]);
  if (named !== null) return named;
  const numbers = Object.values(row).map(toCount).filter((n): n is number => n !== null);
  return numbers.length === 1 ? numbers[0] : null;
}

// لا صفوف (204) صفر. صف لا يُقرأ عدده يجعل العدد كله غير معروف، فلا يُقدَّم رقم ناقص
function sumRows(rows: Record<string, unknown>[]): number | null {
  let total = 0;
  for (const row of rows) {
    const n = rowCount(row);
    if (n === null) return null;
    total += n;
  }
  return total;
}

export function ownerCounts(rows: Record<string, unknown>[]): OwnerCount[] {
  return rows
    .flatMap((row) => {
      const owner = row.Owner;
      const name = isRecord(owner) ? cleanName(owner.name) : null;
      const calls = rowCount(row);
      return name !== null && calls !== null ? [{ name, calls }] : [];
    })
    .sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_OWNERS);
}

export interface Identity {
  org_name: string | null;
  user_name: string | null;
  user_profile: string | null;
}

export type Verified = { ok: true; identity: Identity; stats: Stats } | { ok: false; code: CheckCode };

// ما يقف عند الفحص: «رُفض الطلب» أو «غير موجود» على طريق ثابت لا يصلحه مدير، فهو رد غير متوقع
function checkCodeOf(code: ApiFail): CheckCode {
  return code === "refused" || code === "not_found" ? "bad_response" : code;
}

// بوابة الحفظ: /org والمستخدم الحالي. كل ما فيها موثق أو جُرّب، فلا يضيع رمز بسبب قيمة لم يرها أحد.
async function identityOf(session: ZohoSession): Promise<{ ok: true; identity: Identity } | { ok: false; code: CheckCode }> {
  const orgReply = await session.request("GET", "/crm/v8/org");
  if (!orgReply.ok) return { ok: false, code: checkCodeOf(orgReply.code) };
  const org = Array.isArray(orgReply.body?.org) ? orgReply.body.org[0] : null;
  if (!isRecord(org) || typeof org.type !== "string") return { ok: false, code: "bad_response" };
  if (org.type !== "production") return { ok: false, code: "wrong_environment" };
  if (String(org.zgid ?? "") !== ORG_ZGID && String(org.domain_name ?? "") !== ORG_DOMAIN) return { ok: false, code: "wrong_org" };

  const userReply = await session.request("GET", "/crm/v8/users?type=CurrentUser");
  if (!userReply.ok) return { ok: false, code: checkCodeOf(userReply.code) };
  const user = Array.isArray(userReply.body?.users) ? userReply.body.users[0] : null;
  if (!isRecord(user)) return { ok: false, code: "bad_response" };
  // مستخدم بملف أضيق يرى عدداً أقل بلا أي خطأ، فلا يُقبل
  const profile = isRecord(user.profile) && typeof user.profile.name === "string" ? user.profile.name.trim() : "";
  if (profile !== REQUIRED_PROFILE) return { ok: false, code: "not_admin" };
  return {
    ok: true,
    identity: { org_name: cleanName(org.company_name, MAX_ORG_NAME), user_name: cleanName(user.full_name), user_profile: REQUIRED_PROFILE },
  };
}

// الفشل الذي يُسقط الربط من بين الأعداد: مفتاح بصلاحيات ناقصة يصلحه رمز جديد، وعدد لم يُقرأ لا يصلحه شيء فلا يمنع الحفظ
const fatalCount = (code: ApiFail): boolean => code === "scope_mismatch" || code === "no_permission";
// لا فائدة من طلب بعد هذين، والأعداد الباقية تبقى null
const stopCounting = (code: ApiFail): boolean => code === "rate_limited" || code === "timeout" || code === "throttled";

async function activeUsers(session: ZohoSession): Promise<{ count: number | null; code?: ApiFail }> {
  const reply = await session.request("GET", "/crm/v8/users/actions/count?type=ActiveUsers");
  if (reply.ok) return { count: reply.body === null ? 0 : toCount(reply.body.count) };
  if (reply.code !== "not_found") return { count: null, code: reply.code };
  // النقطة لم تُجرَّب على .sa: عند 404 تُعدّ القائمة (الأسماء لا تُقرأ ولا تُحفظ)
  const list = await session.request("GET", "/crm/v8/users?type=ActiveUsers&per_page=200");
  if (!list.ok) return { count: null, code: list.code };
  if (list.body === null) return { count: 0 };
  return { count: Array.isArray(list.body.users) ? list.body.users.length : null };
}

async function statsOf(session: ZohoSession, nowMs: number): Promise<{ ok: true; stats: Stats } | { ok: false; code: CheckCode }> {
  const since = riyadhIso(nowMs - WINDOW_DAYS * MS_PER_DAY);
  const stats: Stats = { window_days: WINDOW_DAYS, calls: null, calls_linked: null, long_enough: null, by_owner: [], leads_new: null, active_users: null };

  // كل صيغة هنا جُرّبت على المنشأة الحقيقية يوم 2026-11-06
  // needed: النقل يعتمد عليها، فنقص صلاحيتها يوقف الحفظ. أعداد المكالمات للعرض فقط، فنقصها يبقي الرقم فارغاً ولا يحرق رمزاً.
  const queries: [string, (rows: Record<string, unknown>[]) => void, boolean][] = [
    [
      `select Owner, COUNT(id) from Calls where Call_Start_Time >= '${since}' group by Owner`,
      (rows) => {
        stats.calls = sumRows(rows);
        stats.by_owner = ownerCounts(rows);
      },
      false,
    ],
    [
      `select Owner, COUNT(id) from Calls where Call_Start_Time >= '${since}' and What_Id is not null group by Owner`,
      (rows) => (stats.calls_linked = sumRows(rows)),
      false,
    ],
    [
      `select COUNT(id) from Calls where Call_Start_Time >= '${since}' and Call_Duration_in_seconds >= ${LONG_ENOUGH_SECONDS}`,
      (rows) => (stats.long_enough = sumRows(rows)),
      false,
    ],
    [`select COUNT(id) from Leads where Created_Time >= '${since}'`, (rows) => (stats.leads_new = sumRows(rows)), true],
    // لا تدخل الأرقام: تكشف نقص صلاحية القراءة في Contacts وNotes الآن لا عند أول ملاحظة
    ["select COUNT(id) from Contacts where id is not null", () => {}, true],
    ["select COUNT(id) from Notes where Note_Title = 'mulaem-check'", () => {}, true],
  ];

  for (const [query, read, needed] of queries) {
    const reply = await coql(session, query);
    if (reply.ok) {
      read(reply.rows);
      continue;
    }
    if (fatalCount(reply.code)) {
      if (needed) return { ok: false, code: reply.code as CheckCode };
      continue;
    }
    if (stopCounting(reply.code)) return { ok: true, stats };
  }

  const users = await activeUsers(session);
  stats.active_users = users.count;
  return { ok: true, stats };
}

// الفحص كله، للحفظ وللزر. لا يكتب شيئاً في Zoho. فشله يصف السبب برمز، ولا يرمي بسبب Zoho.
export async function verifyConnection(session: ZohoSession, nowMs: number): Promise<Verified> {
  const who = await identityOf(session);
  if (!who.ok) return who;
  const counted = await statsOf(session, nowMs);
  if (!counted.ok) return counted;
  return { ok: true, identity: who.identity, stats: counted.stats };
}

/* ===================== ما يُعرض ===================== */

function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// حقول Stats وحدها من قيمة محفوظة: أي حقل آخر في الصف لا يصل المتصفح
export function pickStats(value: unknown): Stats | null {
  if (!isRecord(value)) return null;
  const owners = (Array.isArray(value.by_owner) ? value.by_owner : [])
    .filter(isRecord)
    .flatMap((item) => {
      const name = cleanName(item.name);
      const calls = toCount(item.calls);
      return name !== null && calls !== null ? [{ name, calls }] : [];
    })
    .slice(0, MAX_OWNERS);
  return {
    window_days: WINDOW_DAYS,
    calls: toCount(value.calls),
    calls_linked: toCount(value.calls_linked),
    long_enough: toCount(value.long_enough),
    by_owner: owners,
    leads_new: toCount(value.leads_new),
    active_users: toCount(value.active_users),
  };
}

export function emptyLink(): Link {
  return { connected: false, org_name: null, user_name: null, user_profile: null, client_hint: null, connected_at: null, connected_by_name: null, check: null };
}

export function linkFromRow(row: LinkRow | null, connectedByName: string | null): Link {
  if (!row) return emptyLink();
  const at = toIso(row.last_check_at);
  const code = CHECK_CODES.includes(row.last_check_code ?? "") ? row.last_check_code as CheckCode : "bad_response";
  const ok = code === "ok" && row.last_check_ok === true;
  return {
    connected: true,
    org_name: row.org_name,
    user_name: row.user_name,
    user_profile: row.user_profile,
    client_hint: row.client_hint,
    connected_at: toIso(row.connected_at),
    connected_by_name: connectedByName,
    check: at === null ? null : { ok, code, at, stats: ok ? pickStats(row.last_check_stats) : null },
  };
}

export function emptySync(): Sync {
  return {
    enabled: false,
    started_at: null,
    start_from: null,
    started_by_name: null,
    last_run_at: null,
    last_run_code: null,
    written_total: 0,
    written_7d: 0,
    no_match_total: 0,
    waiting: 0,
    failed_total: 0,
    ambiguous_total: 0,
    needs_reconnect: false,
  };
}

export function syncFromRow(row: SyncRow | null, startedByName: string | null): Sync {
  if (!row) return emptySync();
  return {
    enabled: row.enabled === true,
    started_at: toIso(row.started_at),
    start_from: toIso(row.start_from),
    started_by_name: startedByName,
    last_run_at: toIso(row.last_run_at),
    last_run_code: typeof row.last_run_code === "string" && /^[a-z_]{1,40}$/.test(row.last_run_code) ? row.last_run_code : null,
    written_total: toCount(row.written_total) ?? 0,
    written_7d: toCount(row.written_7d) ?? 0,
    no_match_total: toCount(row.no_match_total) ?? 0,
    waiting: toCount(row.waiting) ?? 0,
    failed_total: toCount(row.failed_total) ?? 0,
    ambiguous_total: toCount(row.ambiguous_total) ?? 0,
    needs_reconnect: row.needs_reconnect === true,
  };
}
