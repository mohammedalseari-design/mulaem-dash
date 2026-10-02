// نداء Jev (TypeSafe System One) عبر OpenRouter: حالة واحدة وأسئلة مصنّفة في نداء واحد، بـ fetch فقط.
// بلا Supabase ولا Deno، مثل نداء chat في موجّه الجهد (_shared/effort-router/client.ts): fetchImpl يُمرَّر
// للاختبار، والأخطاء مصنّفة بالنوع نفسه تقريباً. الفرق: مهلة 10 ث لكل محاولة، وإعادة واحدة على الأكثر لأخطاء
// البنية (مشغول، 5xx، انقطاع، مهلة) بعد 600 م.ث أو بعد ما يطلبه الخادم إن لم يتجاوز 3 ث.
//
// المفتاح يُرسل في الترويسة فقط، ولا يُطبع ولا يدخل رسالة خطأ. رسالة الخطأ تحمل رسالة OpenRouter واسم المزوّد
// ونوع الخطأ فقط، لا جسم المزوّد الخام (metadata.raw)، لأنه قد يردّد حالة الطلب (نص الرسالة).
import { OPENROUTER_URL } from "../effort-router/tiers.ts";

// خط Jev 1.13 على OpenRouter (تثبيت الإصدار الفرعي؛ الرد يذكر اللقطة المؤرخة التي أجابت)
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";
export const JEV_ATTEMPT_MS = 10_000; // مهلة المحاولة الواحدة
export const JEV_RETRY_MS = 600; // انتظار الإعادة الوحيدة
export const JEV_MAX_RETRY_AFTER_MS = 3_000; // Retry-After أطول من هذا لا يُنتظر (تُعاد بعد 600 م.ث)
export const JEV_MIN_ATTEMPT_MS = 1_000; // لا تبدأ إعادة لا يبقى لها هذا من المهلة الكلية
export const DEFAULT_USD_PER_MTOK = 0.042; // سعر Jev لكل مليون رمز مُدخل (الناتج مجاني)

// نص إرشاد في سؤال: نص، أو كائن أو مصفوفة إرشاد منظّم
export type Guidance = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion {
  type: "choice";
  instructions: Guidance;
  criteria: Record<string, Guidance | null>; // الخيار → وصفه (null: يُقرأ اسم الخيار وحده)
}

export interface NoulQuestion {
  type: "noul";
  instructions: Guidance;
  criteria?: { true: Guidance; false: Guidance };
}

export interface ScoreQuestion {
  type: "score";
  instructions: Guidance;
  criteria: Guidance[];
}

export type JevQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

// الإجابات كما تعود، بعد التحقق من شكلها. OpenRouter قد يُسقط probabilities و confidence: تبقيان null هنا،
// والثقة تُشتق في verdict.ts (normalizeChoice).
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number> | null;
  confidence: number | null;
}

export interface NoulAnswer {
  type: "noul";
  noul: number; // احتمال «نعم» من 0 إلى 1
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number> | null;
  confidence: number | null;
}

export type JevAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface JevRequest {
  apiKey: string;
  baseUrl?: string; // الافتراضي OPENROUTER_URL (ينتهي بـ /api/v1)
  model?: string; // الافتراضي DEFAULT_JEV_MODEL
  state: unknown; // نص، أو كائن بأجزاء مسمّاة (`message`، `group`)
  questions: Record<string, JevQuestion>;
  timeoutMs?: number; // مهلة كل محاولة، الافتراضي 10 ث
  deadline?: number; // وقت مطلق (ms): لا محاولة تتجاوزه، ولا إعادة تبدأ إن لم يتسع لها
  usdPerMtok?: number; // للتكلفة حين لا يعيدها OpenRouter
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface JevResult {
  model: string; // ما أجاب فعلاً، مثل typesafe/jev-1.13-20260917
  provider: string | null;
  id: string | null; // gen-dec-… من OpenRouter
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
  ms: number; // زمن النداء كله بالمحاولتين
}

export type JevErrorKind =
  | "auth"
  | "credits"
  | "rate_limit"
  | "no_route"
  | "too_large"
  | "timeout"
  | "server"
  | "network"
  | "bad_request";

// خطأ من الخدمة أو الشبكة. retryable: خطأ بنية يستحق الإعادة. retryAfterMs: ما طلبه الخادم (retry-after-ms أو
// Retry-After) إن وُجد. provider: المزوّد الذي رفض النداء إن سمّاه OpenRouter.
export class JevError extends Error {
  kind: JevErrorKind;
  status: number | null;
  retryable: boolean;
  provider: string | null;
  retryAfterMs: number | null;
  constructor(
    message: string, kind: JevErrorKind, status: number | null, retryable: boolean,
    provider: string | null = null, retryAfterMs: number | null = null,
  ) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

// تصنيف HTTP كما في موجّه الجهد، ومعه 413 (الطلب أكبر من السياق) و524/529 من OpenRouter
export function classifyJevHttp(
  status: number, message: string, provider: string | null = null, retryAfterMs: number | null = null,
): JevError {
  const error = (kind: JevErrorKind, retryable: boolean) => new JevError(message, kind, status, retryable, provider, retryAfterMs);
  if (status === 401 || status === 403) return error("auth", false);
  if (status === 402) return error("credits", false);
  if (status === 404) return error("no_route", false);
  if (status === 413) return error("too_large", false);
  if (status === 429) return error("rate_limit", true);
  if (status === 408 || status === 504 || status === 524) return error("timeout", true);
  if (status >= 500) return error("server", true); // ومنها 529: المزوّد مثقل
  return error("bad_request", false);
}

// retry-after-ms أولاً ثم Retry-After (ثوانٍ أو تاريخ HTTP)، أو null
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const ms = (headers.get("retry-after-ms") ?? "").trim();
  if (ms !== "") {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const raw = (headers.get("retry-after") ?? "").trim();
  if (raw === "") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

// جسم الطلب: مزوّد Jev الوحيد، بلا بديل، ولا مزوّد يجمع البيانات. لا require_parameters (لم يُجرَّب مع systemone)
export function buildJevBody(req: Pick<JevRequest, "model" | "state" | "questions">): Record<string, unknown> {
  return {
    model: (req.model ?? "").trim() || DEFAULT_JEV_MODEL,
    state: req.state,
    questions: req.questions,
    provider: { only: ["typesafe"], allow_fallbacks: false, data_collection: "deny" },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const unit = (v: unknown): number | null => {
  const n = finite(v);
  return n === null ? null : Math.min(1, Math.max(0, n));
};
const count = (v: unknown): number => {
  const n = finite(v);
  return n === null || n < 0 ? 0 : Math.round(n);
};
const text = (v: unknown): string | null => typeof v === "string" && v ? v : null;

function probabilities(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, p] of Object.entries(v)) {
    const n = unit(p);
    if (n !== null) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

// إجابة واحدة بعد التحقق، أو null لما لا يُفهم (يُتجاهل كما يفعل SDK مع الأنواع المجهولة)
export function parseAnswer(raw: unknown): JevAnswer | null {
  if (!isObject(raw)) return null;
  const type = raw.type ?? (typeof raw.choice === "string" ? "choice" : typeof raw.noul === "number" ? "noul" : null);
  if (type === "choice") {
    const choice = text(raw.choice);
    if (!choice) return null;
    return { type: "choice", choice, probabilities: probabilities(raw.probabilities), confidence: unit(raw.confidence) };
  }
  if (type === "noul") {
    const noul = unit(raw.noul);
    return noul === null ? null : { type: "noul", noul };
  }
  if (type === "score") {
    const score = finite(raw.score);
    if (score === null) return null;
    return { type: "score", score, probabilities: probabilities(raw.probabilities), confidence: unit(raw.confidence) };
  }
  return null;
}

// محاولة واحدة. الجسم يُقرأ داخل المهلة نفسها: مهلة أو انقطاع أثناء قراءته خطأ بنية يُعاد، لا رد فارغ.
async function attempt(req: JevRequest, body: string, timeoutMs: number, now: () => number): Promise<Record<string, unknown>> {
  const doFetch = req.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Title": "mulaem-triage" };
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
  try {
    const res = await doFetch(`${(req.baseUrl ?? OPENROUTER_URL).replace(/\/$/, "")}/systemone`, {
      method: "POST", headers, body, signal: controller.signal,
    });
    const raw = await res.text();
    let data: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        data = isObject(parsed) ? parsed : {};
      } catch {
        if (res.ok) throw new JevError("invalid response body", "server", res.status, true);
      }
    }
    const err = isObject(data.error) ? data.error : null;
    const meta = err && isObject(err.metadata) ? err.metadata : {};
    const provider = text(meta.provider_name);
    const reason = [meta.error_type, meta.provider_code].filter((v) => typeof v === "string" && v).join(" ");
    const detail = (msg: string) => (msg + (reason ? " — " + reason : "")).slice(0, 400);
    const wait = retryAfterMs(res.headers, now());
    if (!res.ok) {
      throw classifyJevHttp(res.status, detail(text(err?.message) ?? (res.statusText || `HTTP ${res.status}`)), provider, wait);
    }
    // OpenRouter قد يعيد 200 وفيه خطأ من المزوّد
    if (err) throw classifyJevHttp(Number(err.code) || 502, detail(text(err.message) ?? "provider error"), provider, wait);
    // 200 بلا answers ولا خطأ ليس جواباً
    if (!isObject(data.answers)) throw new JevError("empty response", "server", res.status, true);
    return data;
  } catch (e) {
    if (e instanceof JevError) throw e;
    if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      throw new JevError("timeout", "timeout", null, true);
    }
    throw new JevError(String((e as Error)?.message ?? e).slice(0, 200), "network", null, true);
  } finally {
    clearTimeout(timer);
  }
}

// المحاولة الأولى، ثم إعادة واحدة لخطأ بنية إن اتسعت لها المهلة الكلية
async function withRetry(req: JevRequest, body: string, now: () => number): Promise<Record<string, unknown>> {
  const sleep = req.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const per = req.timeoutMs ?? JEV_ATTEMPT_MS;
  for (let n = 1; ; n++) {
    const left = req.deadline === undefined ? Infinity : req.deadline - now();
    if (left <= 0) throw new JevError("deadline", "timeout", null, false);
    try {
      return await attempt(req, body, Math.min(per, left), now);
    } catch (e) {
      const err = e instanceof JevError ? e : new JevError(String((e as Error)?.message ?? e), "network", null, true);
      if (n >= 2 || !err.retryable) throw err;
      const wait = err.retryAfterMs !== null && err.retryAfterMs <= JEV_MAX_RETRY_AFTER_MS ? err.retryAfterMs : JEV_RETRY_MS;
      if (req.deadline !== undefined && now() + wait + JEV_MIN_ATTEMPT_MS > req.deadline) throw err;
      await sleep(wait);
    }
  }
}

// نداء Jev بإعادة واحدة على الأكثر. يرمي JevError، ولا يعيد خطأً غير قابل للإعادة (مفتاح، رصيد، طلب مرفوض).
export async function callJev(req: JevRequest): Promise<JevResult> {
  const now = req.now ?? Date.now;
  const model = (req.model ?? "").trim() || DEFAULT_JEV_MODEL;
  const started = now();
  const data = await withRetry(req, JSON.stringify(buildJevBody({ ...req, model })), now);

  const answers: Record<string, JevAnswer> = {};
  for (const [id, raw] of Object.entries(data.answers as Record<string, unknown>)) {
    const answer = parseAnswer(raw);
    if (answer) answers[id] = answer;
  }
  const usage = isObject(data.usage) ? data.usage : {};
  const inputTokens = count(usage.input_tokens);
  const price = finite(req.usdPerMtok) ?? DEFAULT_USD_PER_MTOK;
  const cost = finite(usage.cost) ?? inputTokens * (price / 1e6);
  return {
    model: text(data.model) ?? model,
    provider: text(data.provider),
    id: text(data.id),
    answers,
    usage: { input_tokens: inputTokens, output_tokens: count(usage.output_tokens), cost_usd: cost },
    ms: Math.max(0, now() - started),
  };
}
