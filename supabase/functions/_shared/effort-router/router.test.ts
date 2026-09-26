// اختبارات الموجّه بلا شبكة ولا مفتاح: الدرجة، والسلّم، والتصنيف، والإخفاء، وشكل النداء.
// التشغيل: deno test supabase/functions/_shared/effort-router/
import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import {
  applyPolicy, buildBody, chat, ChatError, classifyFailure, defaultTiers, firstStep, isFailure, nextStep,
  outputBudget, parseJson, rawPhones, reasoningFor, Redactor, scoreEffort, type Step, type Tier,
} from "./mod.ts";

const env = (vars: Record<string, string> = {}) => (name: string) => vars[name];
const tiers = defaultTiers(env());

/* ===================== درجة الجهد ===================== */

Deno.test("effort: a short WhatsApp offer scores 0 and stays without reasoning", () => {
  const e = scoreEffort({ kind: "project", sources: [{ kind: "text", text: "شقة للبيع في حي الشاطئ 3 غرف بسعر 950 ألف" }] });
  assertEquals(e.score, 0);
  assertFalse(reasoningFor(e));
});

Deno.test("effort: each signal adds its weight and names itself", () => {
  const numbers = Array.from({ length: 45 }, (_, i) => String(i * 7)).join(" ");
  const units = "نموذج أ، نموذج ب، شقة، فيلا، وحدة";
  const e = scoreEffort({
    kind: "update",
    sources: [{ kind: "text", text: `${numbers}\nالدفعة الأولى 10%\n${units}\n` + "x".repeat(16_000) }],
  });
  // تحديث 2 + نص 15k 1 + أرقام 40 1 + خطة دفع 1 + وحدات 1
  assertEquals(e.score, 6);
  assertEquals(e.reasons.length, 5);
  assert(reasoningFor(e));
  assertFalse(reasoningFor(e, 7));
});

Deno.test("effort: the larger length and number tiers replace the smaller ones", () => {
  const many = Array.from({ length: 160 }, (_, i) => String(i)).join(" ");
  const e = scoreEffort({ kind: "project", sources: [{ kind: "text", text: many + "y".repeat(61_000) }] });
  assertEquals(e.score, 4); // نص 60k: 2، أرقام 150: 2
});

Deno.test("effort: Arabic-Indic digits count as numbers; PDF sources add no text", () => {
  const e = scoreEffort({
    kind: "project",
    sources: [{ kind: "text", text: Array.from({ length: 41 }, () => "١٢٣").join(" ") }, { kind: "pdf" }],
  });
  assertEquals(e.score, 1);
});

/* ===================== السلّم ===================== */

Deno.test("ladder: fast → fast with reasoning → reason on a reasoning failure → stop", () => {
  const s1 = firstStep({ deep: false, hasFiles: false, reasoning: false })!;
  assertEquals([s1.tier, s1.reasoning, s1.repair, s1.escalation], ["fast", false, false, false]);
  const s2 = nextStep(s1, "reasoning")!;
  assertEquals([s2.attempt, s2.tier, s2.reasoning, s2.repair, s2.escalation], [2, "fast", true, true, false]);
  const s3 = nextStep(s2, "reasoning")!;
  assertEquals([s3.attempt, s3.tier, s3.escalation], [3, "reason", true]);
  assertEquals(nextStep(s3, "reasoning"), null);
});

Deno.test("ladder: format and evidence failures escalate to the general tier", () => {
  const s2 = nextStep(firstStep({ deep: false, hasFiles: false, reasoning: true })!, "format")!;
  assertEquals(nextStep(s2, "format")!.tier, "general");
  assertEquals(nextStep(s2, "evidence")!.tier, "general");
});

Deno.test("ladder: deep goes to reason, files go to general, and a failed heavy attempt stops", () => {
  const deep = firstStep({ deep: true, hasFiles: false, reasoning: false })!;
  assertEquals([deep.tier, deep.escalation], ["reason", true]);
  assertEquals(nextStep(deep, "format"), null);
  const pdf = firstStep({ deep: false, hasFiles: true, reasoning: false })!;
  assertEquals([pdf.tier, pdf.escalation], ["general", false]);
  assertEquals(nextStep(pdf, "evidence"), null);
  // PDF لا يذهب إلى الاستدلالية حتى مع «تفكير عميق»، لكنه يُحسب تصعيداً
  const both = firstStep({ deep: true, hasFiles: true, reasoning: false })!;
  assertEquals([both.tier, both.escalation], ["general", true]);
});

Deno.test("ladder: never more than three model attempts", () => {
  const s: Step = { attempt: 3, tier: "fast", reasoning: true, repair: true, escalation: false };
  assertEquals(nextStep(s, "reasoning"), null);
});

Deno.test("ladder: a missing tier falls back to the other heavy tier, or stops", () => {
  const s2: Step = { attempt: 2, tier: "fast", reasoning: true, repair: true, escalation: false };
  assertEquals(nextStep(s2, "reasoning", ["fast", "general"])!.tier, "general");
  assertEquals(nextStep(s2, "reasoning", ["fast"]), null);
  assertEquals(firstStep({ deep: false, hasFiles: true, reasoning: false, available: ["fast", "reason"] }), null);
});

/* ===================== التصنيف ===================== */

Deno.test("classify: hard failures are format; rejections go to the class with most codes", () => {
  assertEquals(classifyFailure({ hard: "parse", returned: 0, rejected: 0, rejections: [] }), "format");
  assertEquals(classifyFailure({ hard: "truncated", returned: 5, rejected: 0, rejections: [] }), "format");
  assertEquals(classifyFailure({ returned: 4, rejected: 2, rejections: ["cross_field", "cross_field"] }), "reasoning");
  assertEquals(classifyFailure({ returned: 4, rejected: 3, rejections: ["no_quote", "quote_not_found", "range"] }), "evidence");
  assertEquals(classifyFailure({ returned: 4, rejected: 2, rejections: ["type", "number_not_in_quote"] }), "evidence");
  assertEquals(classifyFailure({ returned: 4, rejected: 2, rejections: ["range", "no_quote"] }), "reasoning"); // تعادل
  assertEquals(classifyFailure({ returned: 4, rejected: 2, rejections: ["bad_date", "unknown_value"] }), "format");
});

Deno.test("classify: failure is hard, or rejected above the ratio of returned fields", () => {
  assert(isFailure({ hard: "empty", returned: 0, rejected: 0, rejections: [] }));
  assertFalse(isFailure({ returned: 10, rejected: 3, rejections: [] })); // 0.3 بالضبط ليس فشلاً
  assert(isFailure({ returned: 10, rejected: 4, rejections: [] }));
  assert(isFailure({ returned: 10, rejected: 2, rejections: [] }, 0.1));
  assertFalse(isFailure({ returned: 0, rejected: 0, rejections: [] }));
});

/* ===================== الإخفاء ===================== */

Deno.test("redact: phones in every common form become one stable placeholder and come back", () => {
  const r = new Redactor();
  const text = "للتواصل 0551234567 أو +966 55 123 4567 أو ٠٥٥١٢٣٤٥٦٧ أو 055-123-4567، والمكتب 0126543210";
  const red = r.redact(text);
  assertEquals(rawPhones(red), []);
  // الرقم نفسه بأربع كتابات: رقم واحد وأربعة فروع، يعود كلٌّ منها حرفياً
  assertEquals(red.match(/\[PHONE_1(?:\.\d)?\]/g), ["[PHONE_1]", "[PHONE_1.2]", "[PHONE_1.3]", "[PHONE_1.4]"]);
  assert(red.includes("[PHONE_2]"));
  assertEquals(r.size, 2);
  assertEquals(r.restore(red), text);
  assertEquals(r.redact("مرة أخرى 055-123-4567"), "مرة أخرى [PHONE_1.4]"); // ثابت عبر المصادر
});

Deno.test("redact: e-mails, international numbers and adjacent prices", () => {
  const r = new Redactor();
  const text = "السعر 950000 0551234567 — Sales@Example.com / sales@example.com — UK +44 20 7946 0958";
  const red = r.redact(text);
  assert(red.startsWith("السعر 950000 [PHONE_1]"), red);
  assertEquals(red.match(/\[EMAIL_1(?:\.\d)?\]/g), ["[EMAIL_1]", "[EMAIL_1.2]"]);
  assert(red.includes("[PHONE_2]"));
  assertEquals(r.restore(red), text);
});

Deno.test("redact: prices, areas, dates and percentages are left alone", () => {
  const r = new Redactor();
  const text = "السعر 1,200,000 ريال، المساحة 150 م، التسليم 2026-09-27، الدفعة 10%، سعر المتر 7000، الرمز 12345";
  assertEquals(r.redact(text), text);
});

Deno.test("redact: placeholders inside a model's JSON output are restored deeply", () => {
  const r = new Redactor();
  const red = r.redact("العميل أحمد جواله 0551234567");
  const out = { client: { phone: { value: "[PHONE_1]", quote: "جواله [PHONE_1]" } }, list: ["[PHONE_1]", 3] };
  assertEquals(r.restoreDeep(out), { client: { phone: { value: "0551234567", quote: "جواله 0551234567" } }, list: ["0551234567", 3] });
  assert(red.includes("[PHONE_1]"));
  assertEquals(r.restore("[PHONE_9]"), "[PHONE_9]"); // عنصر لم يصدر عنّا يبقى كما هو
});

/* ===================== الطبقات والنداء ===================== */

Deno.test("tiers: defaults, env overrides and the localOnly policy", () => {
  assertEquals(tiers.fast!.model, "deepseek/deepseek-v4.1-flash");
  assertEquals(tiers.fast!.provider, {
    order: ["deepinfra", "fireworks", "together"], allow_fallbacks: false, data_collection: "deny", require_parameters: true,
  });
  assertEquals(tiers.reason!.model, "openai/gpt-6-astra");
  assertEquals(tiers.general!.model, "anthropic/claude-opus-5.5");
  const custom = defaultTiers(env({ AGENT_MODEL_FAST: "x/y", AGENT_FAST_PROVIDERS: "fireworks" }));
  assertEquals([custom.fast!.model, custom.fast!.provider!.order], ["x/y", ["fireworks"]]);
  assertEquals(applyPolicy(tiers, { localOnly: true }), {});
  const local: Tier = { ...tiers.fast!, location: "local", reasoningStyle: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKeyEnv: null };
  assertEquals(Object.keys(applyPolicy({ ...tiers, fast: local }, { localOnly: true })), ["fast"]);
});

Deno.test("client: request body per tier, reasoning switch and output budget", () => {
  const schema = { name: "project", schema: { type: "object" } };
  const off = buildBody({ tier: tiers.fast!, apiKey: "k", messages: [], reasoning: false, maxTokens: 16_000, schema }, "json_schema");
  assertEquals(off.reasoning, { enabled: false });
  assertEquals(off.max_tokens, 16_000);
  assertEquals((off.response_format as { type: string }).type, "json_schema");
  assertEquals((off.provider as { order: string[] }).order[0], "deepinfra");
  const on = buildBody({ tier: tiers.reason!, apiKey: "k", messages: [], reasoning: true, maxTokens: 16_000, schema }, "json_schema");
  assertEquals(on.reasoning, { effort: "high" });
  assertEquals(on.max_tokens, 32_000);
  assertEquals(on.provider, undefined);
  const gen = buildBody({ tier: tiers.general!, apiKey: "k", messages: [], reasoning: true, maxTokens: 16_000 }, "json_schema");
  assertEquals(gen.reasoning, { max_tokens: 8_000 });
  // الخوادم المحلية: مفتاح التفكير بصيغة كل خادم، ولا provider
  const ollama: Tier = { ...tiers.fast!, location: "local", reasoningStyle: "ollama", provider: undefined, reasoning: {} };
  const vllm: Tier = { ...ollama, reasoningStyle: "vllm" };
  assertEquals(buildBody({ tier: ollama, apiKey: null, messages: [], reasoning: false, maxTokens: 100 }, "json_object").reasoning_effort, "none");
  assertEquals(buildBody({ tier: ollama, apiKey: null, messages: [], reasoning: true, maxTokens: 100 }, "json_object").reasoning_effort, "medium");
  assertEquals(buildBody({ tier: vllm, apiKey: null, messages: [], reasoning: true, maxTokens: 100 }, "json_object").chat_template_kwargs, { enable_thinking: true });
  assertEquals(outputBudget(tiers.general!, true, 16_000), 24_000);
  assertEquals(gen.response_format, undefined);
});

function fakeFetch(responses: { status: number; body: unknown }[], seen: Record<string, unknown>[]): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)));
    const r = responses.shift()!;
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  }) as typeof fetch;
}

const okBody = (text: string) => ({
  provider: "DeepInfra",
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 }, cost: 0.000123 },
});

Deno.test("client: usage and cost come back from the response", async () => {
  const seen: Record<string, unknown>[] = [];
  const res = await chat({
    tier: tiers.fast!, apiKey: "k", reasoning: false, maxTokens: 100,
    messages: [{ role: "user", content: "hi" }], schema: { name: "t", schema: { type: "object" } },
    fetchImpl: fakeFetch([{ status: 200, body: okBody('{"a":1}') }], seen),
  });
  assertEquals(res.text, '{"a":1}');
  assertEquals(res.usage, { prompt: 100, completion: 20, reasoning: 5, costUsd: 0.000123 });
  assertEquals([res.jsonMode, res.provider, res.finishReason], ["json_schema", "DeepInfra", "stop"]);
});

Deno.test("client: no provider for json_schema → json_object with the schema in the prompt", async () => {
  const seen: Record<string, unknown>[] = [];
  const res = await chat({
    tier: tiers.fast!, apiKey: "k", reasoning: false, maxTokens: 100,
    messages: [{ role: "system", content: "s" }, { role: "user", content: [{ type: "text", text: "src" }] }],
    schema: { name: "t", schema: { type: "object", properties: { zzz: {} } } },
    fetchImpl: fakeFetch([
      { status: 404, body: { error: { message: "No endpoints found that can handle the requested parameters." } } },
      { status: 200, body: okBody('```json\n{"a":2}\n```') },
    ], seen),
  });
  assertEquals(res.jsonMode, "json_object");
  assertEquals((seen[1].response_format as { type: string }).type, "json_object");
  assert(JSON.stringify(seen[1].messages).includes("zzz"));
  assertEquals(parseJson(res.text), { a: 2 });
});

Deno.test("client: HTTP errors are typed; only infrastructure errors are retryable", async () => {
  const call = (status: number) =>
    chat({
      tier: tiers.general!, apiKey: "k", reasoning: true, maxTokens: 10, messages: [],
      fetchImpl: fakeFetch([{ status, body: { error: { message: "x" } } }], []),
    });
  const e402 = await assertRejects(() => call(402), ChatError);
  assertEquals([e402.kind, e402.retryable], ["credits", false]);
  const e429 = await assertRejects(() => call(429), ChatError);
  assertEquals([e429.kind, e429.retryable], ["rate_limit", true]);
  const e401 = await assertRejects(() => call(401), ChatError);
  assertEquals(e401.kind, "auth");
  const e503 = await assertRejects(() => call(503), ChatError);
  assert(e503.retryable);
});

Deno.test("client: parseJson takes the object out of fences or stray prose", () => {
  assertEquals(parseJson('{"x":1}'), { x: 1 });
  assertEquals(parseJson('Here it is:\n{"x":[1,2]}\nThanks'), { x: [1, 2] });
});

Deno.test("client: a provider that rejects the schema itself (400) also falls back to json_object", async () => {
  const seen: Record<string, unknown>[] = [];
  const res = await chat({
    tier: tiers.general!, apiKey: "k", reasoning: true, maxTokens: 100,
    messages: [{ role: "user", content: "src" }], schema: { name: "t", schema: { type: "object" } },
    fetchImpl: fakeFetch([
      { status: 400, body: { error: { message: "output_format.schema: Schema is too complex for compilation" } } },
      { status: 200, body: okBody('{"b":1}') },
    ], seen),
  });
  assertEquals(res.jsonMode, "json_object");
  assertEquals((seen[1].response_format as { type: string }).type, "json_object");
  // 400 لا علاقة له بالمخطط يبقى خطأً لا يُعاد
  const e = await assertRejects(() =>
    chat({
      tier: tiers.general!, apiKey: "k", reasoning: true, maxTokens: 10, messages: [], schema: { name: "t", schema: {} },
      fetchImpl: fakeFetch([{ status: 400, body: { error: { message: "invalid file data" } } }], []),
    }), ChatError);
  assertEquals(e.kind, "bad_request");
});

Deno.test("client: the provider's own reason (metadata.raw) is read, so a wrapped schema error still falls back", async () => {
  const seen: Record<string, unknown>[] = [];
  const res = await chat({
    tier: tiers.general!, apiKey: "k", reasoning: true, maxTokens: 100,
    messages: [{ role: "user", content: "src" }], schema: { name: "t", schema: { type: "object" } },
    fetchImpl: fakeFetch([
      { status: 400, body: { error: { code: 400, message: "Provider returned error", metadata: { raw: '{"type":"error","error":{"message":"output_format.schema: too many union types"}}', provider_name: "Anthropic" } } } },
      { status: 200, body: okBody('{"c":1}') },
    ], seen),
  });
  assertEquals(res.jsonMode, "json_object");
  const e = await assertRejects(() =>
    chat({
      tier: tiers.general!, apiKey: "k", reasoning: true, maxTokens: 10, messages: [],
      fetchImpl: fakeFetch([{ status: 400, body: { error: { message: "Provider returned error", metadata: { raw: "invalid pdf" } } } }], []),
    }), ChatError);
  assertEquals(e.kind, "bad_request");
  assert(e.message.includes("invalid pdf"));
});
