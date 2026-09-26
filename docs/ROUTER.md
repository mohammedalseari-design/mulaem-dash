# موجّه الجهد (effort-router)

الموجّه يقرر لكل طلب استخراج: أي نموذج يبدأ، وهل يعمل التفكير، ومتى يُصعَّد إلى نموذج أغلى، ومتى يتوقف ويترك
الطلب لإنسان. الكود في `supabase/functions/_shared/effort-router/` — TypeScript و`fetch` فقط، بلا Supabase وبلا
واجهات Deno — تستعمله اليوم وظيفة `agent-run`، ويعمل كما هو في Node على محطة الذكاء المحلية لاحقاً (القسم 2).
المواصفة وقرارات المالك (27 سبتمبر 2026) في `docs/TASK_ROUTER.md`.

## 1. كيف يعمل في agent-run اليوم

### الطبقات
كل النداءات عبر OpenRouter بالسر `OPENROUTER_API_KEY` في أسرار Supabase (Edge Function Secrets). المفتاح لا يُكتب في
أي ملف ولا رسالة commit ولا سجل، ولا يُرسل في محادثة.

| الطبقة | النموذج | التفكير | متى |
|---|---|---|---|
| `fast` | `deepseek/deepseek-v4.1-flash` | متوقف أو `effort: medium` | البداية لكل طلب نصي |
| `reason` | `openai/gpt-6-astra` | `effort: high` | فشل استدلالي بعد محاولتي Flash، أو «تفكير عميق» |
| `general` | `anthropic/claude-opus-5.5` | `max_tokens: 8000` | كل طلب فيه PDF أو صورة، وباقي حالات الفشل |

الطبقة السريعة مقيّدة بمزوّدين أمريكيين يقبلون `json_schema` (`deepinfra`, `fireworks`, `together`)، مع
`allow_fallbacks: false` و`data_collection: "deny"`؛ لا نقطة DeepSeek نفسها ولا أي مزوّد مستضاف في الصين.

طبقة Opus مقيّدة بالطريقة نفسها بواجهة Anthropic نفسها: `claude-on-aws` (Claude Platform on AWS) ثم `anthropic`، تقرآن
PDF أصلياً وتقبلان `structured_outputs`. بلا تقييد يوزّع OpenRouter نداء Opus على 11 نقطة من خمسة مزوّدين، ونقاط Bedrock
لا تقبل `structured_outputs`. في اختبار 2026-09-26 رُفض الكتيّب مرتين بخطأ عام ثم قرأه `claude-on-aws` بالطلب نفسه.
الاسم `anthropic` لا يشمل نقطة `anthropic/fast` (ضعف السعر). من يغيّر `AGENT_MODEL_GENERAL` إلى نموذج غير Claude يغيّر
معه `AGENT_GENERAL_PROVIDERS`، وإلا لا يجد النداء مزوّداً.

### السلّم
1. «تفكير عميق» ← `reason` مباشرة. مصدر PDF أو صورة ← `general` (الملفات لا تُخفى منها الأرقام، فلا تذهب لغيرها).
   غير ذلك ← `fast`، والتفكير يعمل إن بلغت **درجة الجهد** `AGENT_REASONING_THRESHOLD` (افتراضياً 3).
2. فشلت `fast` ← `fast` مرة أخرى بالتفكير ومعها ملاحظات المدقق (رسالة إصلاح).
3. فشلت الثانية ← `reason` إن كان الفشل استدلالياً، وإلا `general`.
4. فشلت محاولة مصعّدة ← يفشل الطلب وتبقى ملاحظات المدقق في رسالته لمراجعة يدوية.

ثلاث محاولات نموذج على الأكثر في الطلب، منفصلة عن إعادة المحاولة لأخطاء البنية (انقطاع، 5xx، ازدحام، مهلة).
قبل كل خطوة بعد الأولى يُحفظ موضع السلّم (الخطوة وملاحظات المدقق) في `agent_requests.ladder`؛ فإن عاد الطلب إلى الانتظار
(مهلة نداء مصعّد، انقطاع، توقف الوظيفة في منتصفه) يستأنفه المُجدوِل من الخطوة نفسها بدل البدء من Flash. أي نهاية أخرى
(مسودة، فشل، سؤال الموظف) تمسح الموضع.

**درجة الجهد** (`effort.ts`) قاعدة ثابتة بلا نداء نموذج: طلب تحديث +2، نص فوق 15/60 ألف حرف +1/+2، أكثر من 40/150
رقماً +1/+2، كلمات خطة دفع أو سعر متر أو نسبة +1، خمسة ذكور أو أكثر لوحدات أو نماذج +1. الأسباب تُسجَّل مع كل نداء
ليُضبط الحد من نتائج حقيقية.

**الفشل** (`classify.ts`): فشل صلب (JSON غير صالح، ناتج مقطوع، شكل لا يطابق المخطط، لا حقل واحد بدليل)، أو رفض
المدقق أكثر من `AGENT_MAX_REJECT_RATIO` (افتراضياً 0.3) مما أعاده النموذج. القيم المستنتجة والحقول الناقصة ليست فشلاً.
الفئة تُقرأ من رمز الرفض (`code`) لا من الملاحظة العربية: شكل، أو دليل (اقتباس غائب أو غير موجود في المصدر ← Opus)، أو
استدلال (← Astra): قيمة لا تطابق اقتباسها — رقم أو جوال أو بريد لا يظهر فيه، أي من حساب النموذج لا من المصدر — أو خارج
المدى، أو تعارض سببه قراءة النموذج، أو هدف تحديث مبهم.

**المصدر المتناقض ليس فشلاً** (قرار المالك 2026-09-27): سعر إجمالي لا يساوي المساحة × سعر المتر، وكل اقتباس من الثلاثة
في نص المصدر حرفياً، وكل رقم فيه رقماً كاملاً (لا «200,000» داخل «1,200,000»)، ولا قراءة أخرى لأرقام الاقتباسات تتسق —
فالمصدر نفسه متناقض لا النموذج: تُنشأ المسودة من النداء الأول بلا السعر وسعر المتر (المساحة تبقى)، والتعارض ملاحظة للمدير
برمز `source_contradiction` واقتباساته، ولا إعادة ولا تصعيد. يبقى رفضاً استدلالياً يُعاد بسببه: رقم أخذه النموذج من غير
موضعه في سطر يحمل أكثر من رقم، وحد أدنى أكبر من الأعلى (تبديل الطرفين يفسّره)، والتعارض المقروء من PDF أو صورة (لا نقرأ
نصهما)، وقيمتان مختلفتان لحقل واحد في طلب تحديث (الغالب «السعر السابق … والجديد …»، والأولى كانت ستبقى في المقترح).

### الإخفاء
قبل أي نداء تُستبدل الجوالات والبريد في النصوص بعناصر نائبة (`[PHONE_1]`، `[EMAIL_1]`؛ والكتابة المختلفة للرقم نفسه
`[PHONE_1.2]`). المدقق يطابق الاقتباس على النص المُخفى كما رآه النموذج، ثم تُعاد القيم الأصلية قبل الحفظ. الخريطة في
الذاكرة فقط.

### السقفان اليوميان
في `crm_settings`، بتوقيت الرياض، وتفحصهما الوظيفة قبل كل نداء:

| المفتاح | الافتراضي | المعنى |
|---|---|---|
| `agent_daily_usd_cap` | `2` | إنفاق اليوم بالدولار على كل النداءات |
| `agent_daily_escalations` | `10` | المحاولات المصعّدة + الطلبات العميقة |

التعديل من SQL Editor في Supabase، مثلاً: `update crm_settings set value = '5' where key = 'agent_daily_usd_cap';`
والوضع الحالي: `select public.agent_router_budget();`

### السجل
كل نداء صف في `agent_model_calls`: الطبقة، النموذج، المزوّد الذي خدمه فعلاً (أو رفضه إن سمّاه OpenRouter)، التفكير، هل
هو تصعيد، درجة الجهد وأسبابها، الرموز، التكلفة (من ردّ OpenRouter نفسه)، النتيجة (`ok` / `invalid` / `error`) وفئة الفشل،
ومع الخطأ سببه كما ردّه المزوّد (`error`، والجوالات والبريد مُخفاة). المدير يرى المحاولات ومزوّدها وتكلفتها في صفحة الطلب،
ومجموع الطلب في `agent_requests.cost_usd`.

### إعدادات اختيارية (أسرار Supabase)
`AGENT_MODEL_FAST` / `AGENT_MODEL_REASON` / `AGENT_MODEL_GENERAL` لتغيير النموذج، `AGENT_FAST_PROVIDERS` و
`AGENT_GENERAL_PROVIDERS` (قائمة بفواصل) لتغيير مزوّدي الطبقة السريعة وطبقة Opus، `AGENT_REASONING_THRESHOLD`، `AGENT_MAX_REJECT_RATIO`، `AGENT_MAX_INPUT_TOKENS`،
و`AGENT_PDF_ENGINE` لفرض محرّك قراءة PDF في OpenRouter بدل القراءة الأصلية في النموذج (`cloudflare-ai` مجاني — اسمه
القديم `pdf-text` — أو `mistral-ocr`). نداء `sweep` من المُجدوِل يعيد أسماء الإعدادات المضبوطة فقط، لا قيمها.

## 2. التشغيل خارج Supabase (محطة الذكاء المحلية)

### ما يلزم
- انسخ مجلد `supabase/functions/_shared/effort-router/` كما هو؛ لا اعتماديات. الدخول من `mod.ts`.
- Node يشغّل ملفات `.ts` مباشرة بإزالة الأنواع (جُرّب على Node 24.21: تحميل الوحدات، سياسة `localOnly`، السلّم، الإخفاء،
  وشكل جسم النداء لكل خادم). اكتب برنامجك بملف `.mts` (أو `.ts` مع `"type": "module"`).
- `validate.ts` والمخططات خاصة بـ `agent-run`؛ برنامجك يقدّم تحققه الخاص ويعيد `AttemptOutcome`
  (`returned`، `rejected`، `rejections` برموز من `CODE_CLASS`، و`hard` للفشل الصلب).

### نقاط الخوادم المحلية
كلها بواجهة OpenAI (`/v1/chat/completions`)؛ الطبقة تشير إليها بـ `baseUrl`:

| الخادم | `baseUrl` (المنفذ الافتراضي) | `reasoningStyle` |
|---|---|---|
| Ollama | `http://<host>:11434/v1` | `ollama` |
| LM Studio | `http://<host>:1234/v1` | لا مفتاح مخصص — انظر أدناه |
| llama.cpp (`llama-server`) | `http://<host>:8080/v1` | `llamacpp` |
| vLLM | `http://<host>:8000/v1` | `vllm` |

طبقة محلية: `location: "local"`، `apiKeyEnv: null` (ويُمرَّر `apiKey: null` إلى `chat`)، بلا `provider`.

### السياسة: `localOnly: true`
`applyPolicy(tiers, { localOnly: true })` يحذف كل طبقة سحابية، فلا يخرج شيء من الجهاز حتى لو بقيت طبقة OpenRouter في
الإعداد. السلّم يعمل على ما تبقّى: طبقة ثقيلة غائبة تُستبدل بالأخرى، ولا ثقيلة أصلاً ← إلى إنسان مباشرة.

### التصعيد يبقى محلياً
نموذج صغير ← النموذج نفسه بالتفكير ← نموذج محلي أكبر ← إنسان:

```ts
import {
  applyPolicy, chat, classifyFailure, firstStep, isFailure, nextStep, type ChatMessage, type TierId, type Tiers,
} from "./effort-router/mod.ts";

const tiers: Tiers = applyPolicy({
  fast: {
    id: "fast", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434/v1", apiKeyEnv: null,
    reasoningStyle: "ollama", supportsFiles: false, location: "local", reasoning: { effort: "medium", max_tokens: 4000 },
  },
  reason: {
    id: "reason", model: "Qwen/Qwen3-32B", baseUrl: "http://127.0.0.1:8000/v1", apiKeyEnv: null,
    reasoningStyle: "vllm", supportsFiles: false, location: "local", reasoning: { max_tokens: 8000 },
  },
}, { localOnly: true });
const available = Object.keys(tiers) as TierId[];

async function extract(messages: ChatMessage[], schema: Record<string, unknown>) {
  let step = firstStep({ deep: false, hasFiles: false, reasoning: false, available });
  while (step) {
    const result = await chat({
      tier: tiers[step.tier]!, apiKey: null, messages, reasoning: step.reasoning, maxTokens: 4000,
      schema: { name: "offer", schema },
    });
    const outcome = evaluate(result); // تحققك أنت ← AttemptOutcome
    if (!isFailure(outcome)) return result;
    step = nextStep(step, classifyFailure(outcome), available);
  }
  return null; // إلى إنسان
}
```

- ملفات PDF والصور لا تذهب إلا لطبقة `general` بـ `supportsFiles: true`. محلياً: عرّف `general` بنموذج رؤية إن أردتها،
  وإلا فطلب فيه ملف يذهب لإنسان مباشرة.
- `reasoning.max_tokens` في الطبقة يُضاف إلى `max_tokens` حين يعمل التفكير (وإلا يُضاف 16,000). النماذج المحلية سياقها
  أصغر، فحدّده صراحة.
- دعم `json_schema` يختلف بين الخوادم والنماذج. `chat` تعود إلى `json_object` مع المخطط في نص الرسالة فقط حين يرفض الخادم
  المخطط برسالة واضحة؛ جرّب نموذجك قبل الاعتماد عليه.

### مفتاح التفكير يختلف بين الخوادم
| `reasoningStyle` | ما يُرسل | ملاحظة |
|---|---|---|
| `openrouter` | `reasoning: { enabled: false }` أو `{ effort }` أو `{ max_tokens }` | مجرَّب حياً |
| `ollama` | `reasoning_effort`: الجهد، أو `"none"` لإطفائه | من وثائق Ollama لواجهة OpenAI (2026-09-27). الحقل `think` لواجهته الأصلية `/api/chat` وليس لـ `/v1/chat/completions` |
| `llamacpp`، `vllm` | `chat_template_kwargs: { enable_thinking }` | لنماذج عائلة Qwen3؛ نماذج أخرى تستعمل قوالب مختلفة |

LM Studio: لا مفتاح مخصص في الموجّه؛ التفكير يُضبط من إعدادات النموذج في التطبيق. **كل هذه الأنماط المحلية لم تُجرَّب
على خادم حي بعد** — الاختبار يغطي شكل جسم النداء فقط. راجع وثائق الخادم والنموذج، وتأكد من سجل الخادم أن التفكير عمل
أو توقف فعلاً قبل الاعتماد.

### الأمان
- **لا تعرّض هذه الخوادم للإنترنت أبداً.** Ollama وllama.cpp وvLLM وLM Studio بلا مصادقة افتراضياً: من يصل المنفذ يشغّل
  النموذج ويقرأ ما يُرسل إليه.
- اربطها بـ `127.0.0.1`، أو بالشبكة المحلية فقط إن احتاجها جهاز آخر، مع جدار الحماية. لا توجيه منافذ في الراوتر، ولا نفق
  عام (ngrok وأشباهه).
- مع `localOnly: true` لا يلزم مفتاح OpenRouter على المحطة أصلاً؛ لا تضعه في إعداداتها إلا إن قررت طبقة سحابية.
