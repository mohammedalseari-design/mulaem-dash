// طبقات النماذج: السريعة الرخيصة، والاستدلالية، والعامة (تقرأ PDF والصور).
//
// لا شيء هنا خاص بـ Supabase أو Deno: البيئة تُمرَّر دالةً (Deno.env.get أو process.env)،
// فتعمل الملفات نفسها لاحقاً في Node على محطة الذكاء المحلية.

export type TierId = "fast" | "reason" | "general";
export type ReasoningStyle = "openrouter" | "ollama" | "llamacpp" | "vllm";
export type Location = "cloud" | "local";
export type Env = (name: string) => string | undefined;

// تفضيلات توجيه OpenRouter (provider routing)
export interface ProviderPrefs {
  order?: string[];
  allow_fallbacks?: boolean;
  data_collection?: "allow" | "deny";
  require_parameters?: boolean;
}

// شكل التفكير حين يُشغَّل: جهد (effort) أو ميزانية رموز (max_tokens)
export interface ReasoningOn {
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  max_tokens?: number;
}

export interface Tier {
  id: TierId;
  model: string;
  baseUrl: string;
  apiKeyEnv: string | null; // اسم متغير المفتاح، لا المفتاح نفسه؛ null لخادم محلي بلا مفتاح
  reasoningStyle: ReasoningStyle;
  supportsFiles: boolean; // يقرأ PDF والصور
  location: Location;
  provider?: ProviderPrefs;
  reasoning: ReasoningOn;
}

export type Tiers = Partial<Record<TierId, Tier>>;

export const OPENROUTER_URL = "https://openrouter.ai/api/v1";

// مزوّدو DeepSeek V4.1 Flash على OpenRouter من الشركات الأمريكية التي تقبل json_schema
// والتفكير، مرتبة بالسعر (فُحصت 2026-09-27 من /models/deepseek/deepseek-v4.1-flash/endpoints).
// Baseten أمريكية لكنها لا تقبل response_format فخرجت. لا نقطة DeepSeek نفسها ولا مزوّد صيني.
export const FAST_PROVIDERS = ["deepinfra", "fireworks", "together"];

// مزوّدو Opus 5.5: واجهة Anthropic نفسها فقط (Claude Platform on AWS ثم Anthropic)، تقرأ PDF أصلياً وتقبل
// structured_outputs. بلا تثبيت يوزّع OpenRouter النداء على 11 نقطة من 5 مزوّدين؛ Bedrock منها لا يقبل
// structured_outputs، وملف PDF رُفض مرتين في اختبار 2026-09-26 ثم قرأه claude-on-aws بالطلب نفسه.
// الاسم الأساسي "anthropic" لا يشمل نقطة anthropic/fast (ضعف السعر): نقاط فئة الخدمة تحتاج اسمها الكامل.
export const GENERAL_PROVIDERS = ["claude-on-aws", "anthropic"];

export const DEFAULT_MODELS: Record<TierId, string> = {
  fast: "deepseek/deepseek-v4.1-flash",
  reason: "openai/gpt-6-astra",
  general: "anthropic/claude-opus-5.5",
};

const list = (value: string | undefined) =>
  (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function defaultTiers(env: Env): Tiers {
  const cloud = (id: TierId, envName: string, extra: Partial<Tier>): Tier => ({
    id,
    model: (env(envName) ?? "").trim() || DEFAULT_MODELS[id],
    baseUrl: OPENROUTER_URL,
    apiKeyEnv: "OPENROUTER_API_KEY",
    reasoningStyle: "openrouter",
    supportsFiles: false,
    location: "cloud",
    reasoning: { effort: "medium" },
    ...extra,
  });
  // قائمة مزوّدين مثبّتة: لا بديل خارجها، ولا مزوّد يجمع البيانات، ولا من يتجاهل معاملاً من الطلب
  const pinned = (envName: string, fallback: string[]): ProviderPrefs => {
    const order = list(env(envName));
    return { order: order.length ? order : fallback, allow_fallbacks: false, data_collection: "deny", require_parameters: true };
  };
  return {
    fast: cloud("fast", "AGENT_MODEL_FAST", { provider: pinned("AGENT_FAST_PROVIDERS", FAST_PROVIDERS) }),
    // Astra يقرأ الملفات، لكن PDF والصور لا تُخفى منها الأرقام، فلا تذهب إلا للعامة
    reason: cloud("reason", "AGENT_MODEL_REASON", { reasoning: { effort: "high" } }),
    general: cloud("general", "AGENT_MODEL_GENERAL", {
      supportsFiles: true,
      reasoning: { max_tokens: 8_000 },
      provider: pinned("AGENT_GENERAL_PROVIDERS", GENERAL_PROVIDERS),
    }),
  };
}

export interface Policy {
  localOnly?: boolean; // بيانات لا تغادر الجهاز: تُحذف كل طبقة سحابية
}

export function applyPolicy(tiers: Tiers, policy: Policy = {}): Tiers {
  if (!policy.localOnly) return tiers;
  const out: Tiers = {};
  for (const [id, tier] of Object.entries(tiers) as [TierId, Tier | undefined][]) {
    if (tier && tier.location === "local") out[id] = tier;
  }
  return out;
}
