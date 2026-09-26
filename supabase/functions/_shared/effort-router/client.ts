// نداء chat متوافق مع OpenAI عبر fetch فقط: OpenRouter في السحابة، أو خادم محلي
// (Ollama / llama.cpp / vLLM) بالواجهة نفسها.
import type { Tier } from "./tiers.ts";

export interface ChatPart {
  type: "text" | "image_url" | "file";
  text?: string;
  image_url?: { url: string };
  file?: { filename: string; file_data: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
}

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatRequest {
  tier: Tier;
  apiKey: string | null;
  messages: ChatMessage[];
  reasoning: boolean;
  maxTokens: number; // سقف الناتج المرئي؛ يُرفع تلقائياً بقدر التفكير
  schema?: JsonSchemaFormat;
  plugins?: unknown[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatUsage {
  prompt: number;
  completion: number;
  reasoning: number;
  costUsd: number | null;
}

export interface ChatResult {
  text: string;
  finishReason: string | null;
  usage: ChatUsage;
  jsonMode: "json_schema" | "json_object" | "none";
  provider: string | null;
}

// خطأ من الخدمة أو الشبكة. retryable: خطأ بنية (مشغول، انقطاع، 5xx) يستحق إعادة الطلب لاحقاً.
// provider: المزوّد الذي رفض النداء إن سمّاه OpenRouter (metadata.provider_name)، ليُسجَّل مع النداء.
export class ChatError extends Error {
  status: number | null;
  retryable: boolean;
  kind: "auth" | "credits" | "rate_limit" | "bad_request" | "schema" | "no_route" | "timeout" | "network" | "server" | "refusal";
  provider: string | null;
  constructor(message: string, kind: ChatError["kind"], status: number | null, retryable: boolean, provider: string | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.provider = provider;
  }
}

// هامش التفكير حين لا تحدد الطبقة ميزانية: رموز التفكير تُحسب من max_tokens
export const REASONING_ALLOWANCE = 16_000;

export function outputBudget(tier: Tier, reasoning: boolean, maxTokens: number): number {
  if (!reasoning) return maxTokens;
  return maxTokens + (tier.reasoning.max_tokens ?? REASONING_ALLOWANCE);
}

export function reasoningParams(tier: Tier, on: boolean): Record<string, unknown> {
  switch (tier.reasoningStyle) {
    case "openrouter":
      if (!on) return { reasoning: { enabled: false } };
      return { reasoning: tier.reasoning.max_tokens ? { max_tokens: tier.reasoning.max_tokens } : { effort: tier.reasoning.effort ?? "medium" } };
    // خوادم محلية — لم تُجرَّب حياً بعد؛ راجع docs/ROUTER.md ووثائق كل خادم قبل الاعتماد عليها.
    // Ollama على /v1/chat/completions: التفكير بـ reasoning_effort و"none" يطفئه (think لواجهته الأصلية /api/chat فقط)
    case "ollama":
      return { reasoning_effort: on ? tier.reasoning.effort ?? "medium" : "none" };
    case "llamacpp":
    case "vllm":
      return { chat_template_kwargs: { enable_thinking: on } };
  }
}

export function buildBody(req: ChatRequest, jsonMode: "json_schema" | "json_object"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.tier.model,
    messages: req.messages,
    max_tokens: outputBudget(req.tier, req.reasoning, req.maxTokens),
    ...reasoningParams(req.tier, req.reasoning),
  };
  if (req.schema) {
    body.response_format = jsonMode === "json_schema"
      ? { type: "json_schema", json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } }
      : { type: "json_object" };
  }
  if (req.tier.provider) body.provider = req.tier.provider;
  if (req.plugins?.length) body.plugins = req.plugins;
  return body;
}

// json_object: المخطط يُلحق نصاً بآخر رسالة مستخدم، والمدقق يلتقط ما يخالفه
function withSchemaInPrompt(messages: ChatMessage[], schema: JsonSchemaFormat): ChatMessage[] {
  const note = `\n\nReturn one JSON object only, matching this JSON Schema exactly (no prose, no code fences):\n${JSON.stringify(schema.schema)}`;
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;
    const c = out[i].content;
    out[i].content = typeof c === "string" ? c + note : [...c, { type: "text", text: note }];
    break;
  }
  return out;
}

function classifyHttp(status: number, message: string, provider: string | null = null): ChatError {
  const error = (kind: ChatError["kind"], retryable: boolean) => new ChatError(message, kind, status, retryable, provider);
  if (status === 401 || status === 403) return error("auth", false);
  if (status === 402) return error("credits", false);
  if (status === 429) return error("rate_limit", true);
  if (status === 404 && /no endpoints|no allowed providers|provider/i.test(message)) return error("no_route", false);
  // المزوّد رفض المخطط نفسه (تعقيد، أو ميزة لا يدعمها): يُعاد النداء بوضع json_object
  if (status === 400 && /schema|response_format|output_format|output_config|structured|too complex|union|anyof/i.test(message)) {
    return error("schema", false);
  }
  if (status === 408 || status === 504) return error("timeout", true);
  if (status >= 500) return error("server", true);
  return error("bad_request", false);
}

async function post(req: ChatRequest, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const doFetch = req.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 110_000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req.apiKey) headers.Authorization = `Bearer ${req.apiKey}`;
  if (req.tier.baseUrl.includes("openrouter.ai")) headers["X-Title"] = "mulaem-agent";
  try {
    const res = await doFetch(`${req.tier.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
    });
    // الجسم يُقرأ داخل المهلة نفسها: مهلة أو انقطاع أثناء قراءته يصلان إلى catch خطأَ بنية يُعاد
    // (فيُستأنف السلّم من خطوته)، لا ردّاً فارغاً يُحسب فشلاً في شكل الناتج
    const raw = await res.text();
    let data: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch {
        if (res.ok) throw new ChatError("invalid response body", "server", res.status, true);
      }
    }
    // deno-lint-ignore no-explicit-any
    const err = (data as any)?.error;
    // OpenRouter يلفّ خطأ المزوّد برسالة عامة ("Provider returned error"): اسم المزوّد والسبب الفعلي
    // في metadata (provider_name و raw، أو error_type و provider_code في الصيغة الأحدث)
    const meta = err?.metadata ?? {};
    const provider = typeof meta.provider_name === "string" ? meta.provider_name : null;
    const reason = [meta.error_type, meta.provider_code, meta.raw]
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map((v) => typeof v === "string" ? v : JSON.stringify(v)).join(" ");
    const detail = (msg: string) => msg + (reason ? " — " + reason.slice(0, 600) : "");
    if (!res.ok) throw classifyHttp(res.status, detail(String(err?.message ?? res.statusText ?? "HTTP " + res.status)), provider);
    // OpenRouter قد يعيد 200 وفيه خطأ من المزوّد
    if (err) throw classifyHttp(Number(err.code) || 502, detail(String(err.message ?? "provider error")), provider);
    // 200 بلا choices ولا خطأ ليس جواب نموذج
    if (!Array.isArray(data.choices)) throw new ChatError("empty response", "server", res.status, true);
    return data;
  } catch (e) {
    if (e instanceof ChatError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") throw new ChatError("timeout", "timeout", null, true);
    throw new ChatError(String((e as Error)?.message ?? e), "network", null, true);
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  let jsonMode: ChatResult["jsonMode"] = req.schema ? "json_schema" : "none";
  let data: Record<string, unknown>;
  try {
    data = await post(req, buildBody(req, "json_schema"));
  } catch (e) {
    // لا مزوّد مسموح يقبل json_schema (الطبقة السريعة مقيدة بمزوّدين)، أو رفض المزوّد المخطط نفسه:
    // نعود إلى json_object والمخطط في نص الرسالة، والمدقق يلتقط ما يخالفه
    if (!(e instanceof ChatError && (e.kind === "no_route" || e.kind === "schema") && req.schema)) throw e;
    jsonMode = "json_object";
    const retry = { ...req, messages: withSchemaInPrompt(req.messages, req.schema) };
    data = await post(retry, buildBody(retry, "json_object"));
  }

  // deno-lint-ignore no-explicit-any
  const d = data as any;
  const choice = d?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  if (typeof message.refusal === "string" && message.refusal) {
    throw new ChatError(message.refusal, "refusal", 200, false);
  }
  const content = message.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text ?? "").join("") : "";
  const u = d?.usage ?? {};
  return {
    text,
    finishReason: choice.finish_reason ?? choice.native_finish_reason ?? null,
    usage: {
      prompt: Number(u.prompt_tokens ?? 0),
      completion: Number(u.completion_tokens ?? 0),
      reasoning: Number(u.completion_tokens_details?.reasoning_tokens ?? 0),
      costUsd: typeof u.cost === "number" ? u.cost : null,
    },
    jsonMode,
    provider: typeof d?.provider === "string" ? d.provider : null,
  };
}

// بعض النماذج في وضع json_object تلفّ الناتج بأسوار ```json؛ نأخذ الكائن نفسه.
export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new SyntaxError("not JSON");
  }
}
