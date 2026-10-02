// اختبارات Jev بلا شبكة ولا مفتاح: النداء (الإعادة، المهلة، تصنيف الأخطاء، التكلفة)، والأسئلة لكل مجموعة،
// والحكم بكل فروعه واشتقاق الثقة، وشكل التخزين، وفحص الأرقام قبل الإرسال. كل النصوص مصطنعة (المستودع عام).
// التشغيل: deno test --allow-read --allow-env supabase/functions/_shared/jev/
import { assert, assertAlmostEquals, assertEquals, assertFalse, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { Redactor } from "../effort-router/redact.ts";
import { OPENROUTER_URL } from "../effort-router/tiers.ts";
import {
  buildJevBody, callJev, type ChoiceQuestion, classifyJevHttp, DEFAULT_JEV_MODEL, JevError, type JevQuestion, parseAnswer,
  retryAfterMs,
} from "./client.ts";
import { DISTRICTS_VERSION } from "./districts.ts";
import {
  buildRequest, capRuns, CITIES, DEFAULT_QSET, GROUP_MAX, INTENTS, isCurrentQset, KINDS, MESSAGE_MAX, QSETS, RUN_MAX,
  scrubPhones,
} from "./questions.ts";
import {
  type Answers, compactAnswers, confidenceFrom, decide, normalizeChoice, noulOf, readStored, THRESHOLDS, topOf,
} from "./verdict.ts";

/* ===================== النداء ===================== */

interface Reply {
  status: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
}
interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// مثل fakeFetch في router.test.ts: ردود بالترتيب، وكل طلب يُسجَّل (الرابط والترويسات والجسم)
function fakeFetch(replies: (Reply | Error)[], seen: Seen[] = []): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    seen.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: JSON.parse(String(init?.body)) });
    const r = replies.shift();
    if (!r) return Promise.reject(new Error("no reply left"));
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers }));
  }) as typeof fetch;
}

const sleeper = (slept: number[]) => (ms: number) => {
  slept.push(ms);
  return Promise.resolve();
};

const intentQ: ChoiceQuestion = { type: "choice", instructions: "What?", criteria: { sale_offer: "Sale", other: null } };
const questions: Record<string, JevQuestion> = { intent: intentQ, multiple: { type: "noul", instructions: "Many?" } };

const okBody = (over: Record<string, unknown> = {}) => ({
  id: "gen-dec-1",
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    intent: { type: "choice", choice: "sale_offer", probabilities: { sale_offer: 0.9, other: 0.1 }, confidence: 0.8 },
    multiple: { type: "noul", noul: 0.12 },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
  ...over,
});

const call = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof callJev>[0]> = {}) =>
  callJev({ apiKey: "k", state: { message: "شقة للبيع" }, questions, fetchImpl, sleep: sleeper([]), ...extra });

Deno.test("client: POST to OpenRouter /systemone with the key, X-Title and Jev pinned to its only provider", async () => {
  const seen: Seen[] = [];
  await call(fakeFetch([{ status: 200, body: okBody() }], seen));
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, `${OPENROUTER_URL}/systemone`);
  assertEquals(seen[0].headers.Authorization, "Bearer k");
  assertEquals(seen[0].headers["X-Title"], "mulaem-triage");
  assertEquals(seen[0].headers["Content-Type"], "application/json");
  assertEquals(seen[0].body, {
    model: "typesafe/jev-1.13",
    state: { message: "شقة للبيع" },
    questions,
    provider: { only: ["typesafe"], allow_fallbacks: false, data_collection: "deny" },
  });
  assertEquals(DEFAULT_JEV_MODEL, "typesafe/jev-1.13");
  // لا require_parameters، والنموذج من البيئة إن مُرِّر
  assertFalse("require_parameters" in (buildJevBody({ state: "x", questions }).provider as Record<string, unknown>));
  assertEquals(buildJevBody({ model: " typesafe/jev-1.14 ", state: "x", questions }).model, "typesafe/jev-1.14");
  assertEquals(buildJevBody({ model: "  ", state: "x", questions }).model, DEFAULT_JEV_MODEL);
});

Deno.test("client: answers, the answering model, provider, id and usage.cost come back", async () => {
  const res = await call(fakeFetch([{ status: 200, body: okBody() }]));
  assertEquals(res.model, "typesafe/jev-1.13-20260917");
  assertEquals([res.provider, res.id], ["TypeSafe", "gen-dec-1"]);
  assertEquals(res.answers.intent, {
    type: "choice", choice: "sale_offer", probabilities: { sale_offer: 0.9, other: 0.1 }, confidence: 0.8,
  });
  assertEquals(res.answers.multiple, { type: "noul", noul: 0.12 });
  assertEquals(res.usage, { input_tokens: 476, output_tokens: 70, cost_usd: 0.000019992 });
  assert(res.ms >= 0);
});

Deno.test("client: without a finite usage.cost the cost is input_tokens × price per million (default 0.042)", async () => {
  const usage = (u: Record<string, unknown>) => okBody({ usage: u });
  const a = await call(fakeFetch([{ status: 200, body: usage({ input_tokens: 1000, output_tokens: 5 }) }]));
  assertAlmostEquals(a.usage.cost_usd, 0.000042, 1e-12);
  const b = await call(fakeFetch([{ status: 200, body: usage({ input_tokens: 1000, output_tokens: 5, cost: "0.5" }) }]));
  assertAlmostEquals(b.usage.cost_usd, 0.000042, 1e-12);
  const c = await call(fakeFetch([{ status: 200, body: usage({ input_tokens: 2_000_000, cost: null }) }]), { usdPerMtok: 0.1 });
  assertAlmostEquals(c.usage.cost_usd, 0.2, 1e-12);
  // بلا usage أصلاً: صفر رموز وصفر تكلفة، والنموذج المطلوب إن لم يُذكر في الرد
  const d = await call(fakeFetch([{ status: 200, body: okBody({ usage: undefined, model: undefined }) }]), { model: "jev-x" });
  assertEquals([d.usage, d.model], [{ input_tokens: 0, output_tokens: 0, cost_usd: 0 }, "jev-x"]);
});

Deno.test("client: missing probabilities or confidence are tolerated; malformed and unknown answers are dropped", async () => {
  const res = await call(fakeFetch([{
    status: 200,
    body: okBody({
      answers: {
        intent: { type: "choice", choice: "other" },
        kind: { type: "choice", choice: "villa", probabilities: { villa: 0.7, land: "x", floor: 1.2 } },
        city: { type: "choice", choice: 7 },
        multiple: { type: "noul", noul: "high" },
        urgency: { type: "score", score: 1.2, confidence: 0.9 },
        later: { type: "ranking", order: [] },
        bare: { choice: "jeddah", confidence: 0.6 },
      },
    }),
  }]));
  assertEquals(res.answers.intent, { type: "choice", choice: "other", probabilities: null, confidence: null });
  // الاحتمال غير الرقمي يسقط، وما تجاوز 1 يُقصر عليه
  assertEquals(res.answers.kind, { type: "choice", choice: "villa", probabilities: { villa: 0.7, floor: 1 }, confidence: null });
  assertEquals(res.answers.urgency, { type: "score", score: 1.2, probabilities: null, confidence: 0.9 });
  assertEquals(res.answers.bare, { type: "choice", choice: "jeddah", probabilities: null, confidence: 0.6 });
  assertEquals(Object.keys(res.answers).sort(), ["bare", "intent", "kind", "urgency"]);
  assertEquals(parseAnswer(null), null);
  assertEquals(parseAnswer({ type: "noul", noul: 0.3 }), { type: "noul", noul: 0.3 });
});

Deno.test("client: HTTP errors are typed like the router's classifyHttp; only infrastructure errors are retryable", () => {
  const cases: [number, string, boolean][] = [
    [401, "auth", false], [403, "auth", false], [402, "credits", false], [404, "no_route", false], [413, "too_large", false],
    [429, "rate_limit", true], [408, "timeout", true], [504, "timeout", true], [524, "timeout", true], [500, "server", true],
    [502, "server", true], [503, "server", true], [529, "server", true], [400, "bad_request", false], [422, "bad_request", false],
  ];
  for (const [status, kind, retryable] of cases) {
    const e = classifyJevHttp(status, "x");
    assertEquals([status, e.kind, e.retryable, e.status], [status, kind, retryable, status]);
  }
});

Deno.test("client: a non-retryable error is thrown at once; a retryable one is retried once only", async () => {
  for (const status of [400, 401, 402, 404, 413, 422]) {
    const seen: Seen[] = [];
    const e = await assertRejects(() => call(fakeFetch([{ status, body: { error: { message: "no" } } }], seen)), JevError);
    assertEquals([status, e.retryable, seen.length], [status, false, 1]);
  }
  for (const status of [408, 429, 500, 502, 503, 504, 524, 529]) {
    const seen: Seen[] = [];
    const slept: number[] = [];
    const e = await assertRejects(
      () =>
        call(fakeFetch([{ status, body: {} }, { status, body: {} }, { status: 200, body: okBody() }], seen), {
          sleep: sleeper(slept),
        }),
      JevError,
    );
    // محاولتان فقط، وبينهما 600 م.ث
    assertEquals([status, e.status, seen.length, slept], [status, status, 2, [600]]);
  }
});

Deno.test("client: one retry after 600 ms, then the answer", async () => {
  const slept: number[] = [];
  const seen: Seen[] = [];
  const res = await call(fakeFetch([{ status: 503, body: { error: { message: "busy" } } }, { status: 200, body: okBody() }], seen), {
    sleep: sleeper(slept),
  });
  assertEquals([res.answers.intent.type, seen.length, slept], ["choice", 2, [600]]);
  // الطلب نفسه في المحاولتين
  assertEquals(seen[0].body, seen[1].body);
});

Deno.test("client: retry-after-ms / Retry-After up to 3 s is waited; longer falls back to 600 ms", async () => {
  const waits = async (headers: Record<string, string>) => {
    const slept: number[] = [];
    await call(fakeFetch([{ status: 429, body: {}, headers }, { status: 200, body: okBody() }]), { sleep: sleeper(slept) });
    return slept;
  };
  assertEquals(await waits({ "retry-after-ms": "1500" }), [1500]);
  assertEquals(await waits({ "Retry-After": "2" }), [2000]);
  assertEquals(await waits({ "retry-after-ms": "250", "Retry-After": "2" }), [250]);
  assertEquals(await waits({ "Retry-After": "3" }), [3000]);
  assertEquals(await waits({ "Retry-After": "10" }), [600]);
  assertEquals(await waits({ "retry-after-ms": "4000" }), [600]);
  assertEquals(await waits({ "Retry-After": "soon" }), [600]);
  assertEquals(await waits({}), [600]);
  const now = Date.parse("2026-10-02T10:00:00Z");
  assertEquals(retryAfterMs(new Headers({ "Retry-After": "Fri, 02 Oct 2026 10:00:02 GMT" }), now), 2000);
  assertEquals(retryAfterMs(new Headers({ "Retry-After": "-1" }), now), null);
});

Deno.test("client: an attempt that outlives its timeout is aborted, retried once, then fails as a timeout", async () => {
  let started = 0;
  const hanging = ((_url: string, init?: RequestInit) => {
    started++;
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The signal has been aborted", "AbortError")));
    });
  }) as typeof fetch;
  const slept: number[] = [];
  const e = await assertRejects(() => call(hanging, { timeoutMs: 20, sleep: sleeper(slept) }), JevError);
  assertEquals([e.kind, e.status, e.retryable, started, slept], ["timeout", null, true, 2, [600]]);
});

Deno.test("client: a network error is retried; a body that breaks while read is a timeout, not an empty answer", async () => {
  const seen: Seen[] = [];
  const res = await call(fakeFetch([new TypeError("connection reset"), { status: 200, body: okBody() }], seen));
  assertEquals([res.id, seen.length], ["gen-dec-1", 2]);
  const twice = await assertRejects(() => call(fakeFetch([new TypeError("dns"), new TypeError("dns")])), JevError);
  assertEquals([twice.kind, twice.retryable], ["network", true]);
  const aborting = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{"));
            c.error(new DOMException("The signal has been aborted", "AbortError"));
          },
        }),
        { status: 200 },
      ),
    )) as typeof fetch;
  assertEquals((await assertRejects(() => call(aborting), JevError)).kind, "timeout");
});

Deno.test("client: a 200 carrying an OpenRouter error, a non-JSON 200 or a 200 without answers is an error", async () => {
  const wrapped = await assertRejects(
    () => call(fakeFetch([{ status: 200, body: { error: { code: 402, message: "Insufficient credits" } } }])),
    JevError,
  );
  assertEquals([wrapped.kind, wrapped.status], ["credits", 402]);
  const noCode = await assertRejects(
    () => call(fakeFetch([{ status: 200, body: { error: { message: "x" } } }, { status: 200, body: { error: { message: "x" } } }])),
    JevError,
  );
  assertEquals([noCode.kind, noCode.status], ["server", 502]);
  const garbled = await assertRejects(
    () => call(fakeFetch([{ status: 200, raw: "<html>502</html>" }, { status: 200, raw: "<html>502</html>" }])),
    JevError,
  );
  assertEquals([garbled.kind, garbled.retryable], ["server", true]);
  const empty = await assertRejects(() => call(fakeFetch([{ status: 200, body: { model: "m" } }, { status: 200, body: { answers: [] } }])), JevError);
  assertEquals([empty.kind, empty.message], ["server", "empty response"]);
});

Deno.test("client: the overall deadline caps each attempt and blocks a retry that cannot finish in time", async () => {
  // الوقت ثابت: يبقى 500 م.ث، والإعادة تحتاج 600 + 1000
  const seen: Seen[] = [];
  const slept: number[] = [];
  const e = await assertRejects(
    () =>
      call(fakeFetch([{ status: 503, body: {} }, { status: 200, body: okBody() }], seen), {
        now: () => 10_000, deadline: 10_500, sleep: sleeper(slept),
      }),
    JevError,
  );
  assertEquals([e.kind, seen.length, slept], ["server", 1, []]);
  // بعد الموعد: لا نداء أصلاً
  const late: Seen[] = [];
  const gone = await assertRejects(() => call(fakeFetch([{ status: 200, body: okBody() }], late), { now: () => 10_000, deadline: 9_000 }), JevError);
  assertEquals([gone.kind, gone.retryable, late.length], ["timeout", false, 0]);
  // متسع: الإعادة تمضي
  const ok = await call(fakeFetch([{ status: 503, body: {} }, { status: 200, body: okBody() }]), { now: () => 10_000, deadline: 20_000 });
  assertEquals(ok.id, "gen-dec-1");
});

Deno.test("client: the error names the provider and keeps OpenRouter's message, never the provider's raw body", async () => {
  const e = await assertRejects(
    () =>
      call(fakeFetch([{
        status: 400,
        body: {
          error: {
            code: 400,
            message: "Provider returned error",
            metadata: { provider_name: "TypeSafe", error_type: "invalid_request", raw: '{"input":{"message":"فيلا للبيع 0551234567"}}' },
          },
        },
      }])),
    JevError,
  );
  assertEquals([e.kind, e.provider], ["bad_request", "TypeSafe"]);
  assert(e.message.includes("Provider returned error") && e.message.includes("invalid_request"), e.message);
  assertFalse(e.message.includes("فيلا") || e.message.includes("0551234567"), e.message);
  // بلا جسم مفهوم: حالة HTTP فقط، والمفتاح لا يظهر في أي رسالة
  const plain = await assertRejects(() => call(fakeFetch([{ status: 401, raw: "denied for key k-secret" }]), { apiKey: "k-secret" }), JevError);
  assertEquals(plain.kind, "auth");
  assertFalse(plain.message.includes("k-secret"));
});

/* ===================== الأسئلة ===================== */

const keysOf = (q: JevQuestion | undefined) => Object.keys((q as ChoiceQuestion).criteria);

Deno.test("questions: every QSET asks intent, kind and city with the spec's option keys, and multiple as a noul", () => {
  assertEquals(Object.keys(QSETS).sort(), ["wa-1", "wa-1-ar", "wa-1-nogroup"]);
  for (const [name, q] of Object.entries(QSETS)) {
    assertEquals(q.name, name);
    assertEquals(keysOf(q.questions.intent), [...INTENTS], name);
    assertEquals(keysOf(q.questions.kind), [...KINDS], name);
    assertEquals(keysOf(q.questions.city), [...CITIES], name);
    assertEquals(q.questions.multiple.type, "noul");
    for (const question of [q.questions.intent, q.questions.kind, q.questions.city, q.questions.multiple]) {
      assert(typeof question.instructions === "string" && question.instructions.length > 10, name);
    }
    for (const question of [q.questions.intent, q.questions.kind, q.questions.city]) {
      for (const [key, text] of Object.entries(question.criteria)) assert(typeof text === "string" && text.length > 5, `${name} ${key}`);
    }
    // OpenRouter يشترط في noul الوصفين معاً
    const noul = q.questions.multiple.criteria!;
    assert((noul.true as string).length > 5 && (noul.false as string).length > 5, name);
    assert(q.district.instructions.length > 10 && q.district.none.length > 10, name);
  }
  assertEquals(INTENTS, ["sale_offer", "rent_offer", "status_update", "wanted", "not_property", "other"]);
  assertEquals(KINDS, ["apartment", "villa", "floor", "building", "land", "commercial", "rest_house", "other", "none"]);
  assertEquals(CITIES, ["jeddah", "makkah", "madinah", "riyadh", "other_city", "not_stated"]);
});

Deno.test("questions: wa-1 carries the spec's English text; wa-1-nogroup the same questions; wa-1-ar Arabic, same keys", () => {
  const en = QSETS["wa-1"];
  assertEquals(
    en.questions.intent.instructions,
    "`message` is a post from a Saudi real-estate WhatsApp group, usually written in Arabic. What is its author mainly doing?",
  );
  assertEquals(en.questions.intent.criteria.other, "None of the above fits.");
  assertEquals(en.questions.city.criteria.riyadh, "الرياض as a city (not حي الرياض, which is a Jeddah district).");
  assertEquals(en.questions.kind.criteria.none, "`message` is not about any property.");
  assertEquals(en.district.instructions, "In which Jeddah district (حي) is the offered property located?");
  assertEquals(
    en.questions.multiple.criteria!.false,
    "It is about one property, or several units or models of one project or building.",
  );
  assertEquals(QSETS["wa-1-nogroup"].questions, en.questions);
  assertEquals(QSETS["wa-1-nogroup"].district, en.district);
  const ar = QSETS["wa-1-ar"];
  const arabic = /[ء-ي]{3}/;
  for (const id of ["intent", "kind", "city"] as const) {
    assert(arabic.test(ar.questions[id].instructions as string), id);
    assert((ar.questions[id].instructions as string).includes("`message`"), id);
    for (const text of Object.values(ar.questions[id].criteria)) assert(arabic.test(text as string), String(text));
    // لا نص إنجليزي في الترجمة إلا مفتاح الخيار not_stated في تعليمة المدينة
    assertFalse(/\b(?:the|is|of|or)\b/i.test(JSON.stringify(ar.questions[id])), id);
  }
  assert(arabic.test(ar.questions.multiple.instructions as string) && arabic.test(ar.district.none));
  assert((ar.questions.city.instructions as string).includes("not_stated"));
});

Deno.test("questions: the state is { message, group } (or { message } for wa-1-nogroup) and nothing else", () => {
  const input = { message: "فيلا للبيع في حي السامر", group: "عروض جدة", districtCandidates: [] };
  assertEquals(buildRequest("wa-1", input).state, { message: "فيلا للبيع في حي السامر", group: "عروض جدة" });
  assertEquals(buildRequest("wa-1-ar", input).state, { message: "فيلا للبيع في حي السامر", group: "عروض جدة" });
  assertEquals(buildRequest("wa-1-nogroup", input).state, { message: "فيلا للبيع في حي السامر" });
  assertEquals(buildRequest("wa-1", { message: "نص" }).state, { message: "نص", group: "" });
  assertThrows(() => buildRequest("wa-9", input), Error, "unknown qset");
  assertThrows(() => buildRequest("toString", input), Error, "unknown qset");
});

Deno.test("questions: a district question only when the message names a Jeddah district; keys are canonical names plus none", () => {
  const withDistrict = buildRequest("wa-1", { message: "شقة للبيع في حي المروه، قريبة من الحمرا", group: "" });
  assertEquals(Object.keys(withDistrict.questions), ["intent", "kind", "city", "district", "multiple"]);
  assertEquals(withDistrict.districtCandidates, ["المروة", "الحمراء"]);
  assertEquals(withDistrict.questions.district, {
    type: "choice",
    instructions: "In which Jeddah district (حي) is the offered property located?",
    // الوصف أسماؤه البديلة، أو null
    criteria: {
      "المروة": null,
      "الحمراء": "الحمرا",
      none: "None of these districts is where the property is (they are only mentioned nearby or in passing).",
    },
  });
  const ar = buildRequest("wa-1-ar", { message: "أرض في الزهرا", group: "" }).questions.district as ChoiceQuestion;
  assertEquals(keysOf(ar), ["الزهراء", "none"]);
  assertEquals(ar.criteria["الزهراء"], "الزهرا، الزهرة");
  assertEquals(ar.criteria.none, QSETS["wa-1-ar"].district.none);
  // بلا حي: لا سؤال
  const plain = buildRequest("wa-1", { message: "صباح الخير يا جماعة", group: "" });
  assertEquals(Object.keys(plain.questions), ["intent", "kind", "city", "multiple"]);
  assertEquals(plain.districtCandidates, []);
});

Deno.test("questions: candidates passed in are used as given — unique, at most 12, never «none»", () => {
  const many = ["الصفا", "الصفا", "none", "", "الروضة", ...Array.from({ length: 15 }, (_, i) => `حي${i}`)];
  const built = buildRequest("wa-1", { message: "نص بلا أحياء", districtCandidates: many });
  assertEquals(built.districtCandidates.length, 12);
  assertEquals(built.districtCandidates.slice(0, 3), ["الصفا", "الروضة", "حي0"]);
  const keys = keysOf(built.questions.district);
  assertEquals([keys.length, keys.at(-1), keys.filter((k) => k === "none").length], [13, "none", 1]);
  assertEquals((built.questions.district as ChoiceQuestion).criteria["حي0"], null);
});

Deno.test("questions: the message keeps its first 6000 characters and is marked truncated; the group is capped", () => {
  const long = "أ".repeat(MESSAGE_MAX - 3) + "حي الصفا" + "ب".repeat(500);
  const built = buildRequest("wa-1", { message: long, group: "ج".repeat(GROUP_MAX + 50) });
  assertEquals(built.state.message.length, MESSAGE_MAX);
  assert(long.startsWith(built.state.message));
  assertEquals(built.truncated, true);
  assertEquals(built.state.group!.length, GROUP_MAX);
  // الحي بعد موضع القطع لا يراه Jev، فلا يُسأل عنه
  assertEquals(built.districtCandidates, []);
  assertEquals(buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX) }).truncated, false);
  // لا يُقطع حرف مركّب (زوج UTF-16) من نصفه
  const emoji = buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX - 1) + "🏠" + "ب" });
  assertEquals([emoji.state.message.length, emoji.truncated], [MESSAGE_MAX - 1, true]);
});

Deno.test("questions: every QSET is bound to the current district list; DEFAULT_QSET is wa-1", () => {
  assertEquals(DEFAULT_QSET, "wa-1");
  for (const [name, q] of Object.entries(QSETS)) {
    // تغيّر DISTRICTS_VERSION يُفشل هذا الاختبار: أضف مجموعة جديدة (wa-2 …) مكتوبة للقائمة الجديدة
    assertEquals(q.districts, DISTRICTS_VERSION, `${name} was written for districts ${q.districts}`);
    assertEquals(q.version, `${name}+${DISTRICTS_VERSION}`);
    assert(isCurrentQset(name));
  }
  assertFalse(isCurrentQset("wa-0"));
  assertFalse(isCurrentQset("constructor"));
});

Deno.test("scrubPhones: phones left visible and phone-like runs of 8+ digits become x; prices, areas and dates stay", () => {
  const cases: [string, string][] = [
    ["للتواصل 0551234567", "للتواصل xxxxxxxxxx"],
    ["واتساب ٠٥٥١٢٣٤٥٦٧", "واتساب xxxxxxxxxx"],
    ["UK +44 20 7946 0958", "UK +xx xx xxxx xxxx"],
    ["رقم مصري 01012345678", "رقم مصري xxxxxxxxxxx"],
    ["الهاتف (012) 345-6789", "الهاتف (xxx) xxx-xxxx"],
    ["الرقم 12345678", "الرقم xxxxxxxx"],
    ["رخصة الإعلان 7200123456", "رخصة الإعلان xxxxxxxxxx"],
  ];
  for (const [text, want] of cases) assertEquals(scrubPhones(text), want, text);
  const kept = [
    "السعر 950000 ريال، المساحة 450 م2، 3 غرف",
    "السعر 1,200,000 ريال",
    "السعر 12.500.000 ريال",
    "التسليم 2026-09-27 أو 27.09.2026",
    "الدفعة 10% والقسط 1234567",
    "[PHONE_1] و [EMAIL_2] و [PHONE_3.2]",
    "السعر 950000\n0551234",
    "",
  ];
  for (const text of kept) assertEquals(scrubPhones(text), text, text);
});

// الأشكال التي فاتت الفحص الأول (مراجعة B-1): أي شرطة، والشرطة بين مسافتين، والشرطة المائلة والشرطة السفلية والفاصلة،
// وثلاث مسافات، وعلامة اتجاه النص بين المجموعات، والأرقام العربية. لا Redactor يعرفها ولا rawPhones.
const SEPARATED_PHONES: [string, string][] = [
  ["055 - 123 - 4567", "xxx - xxx - xxxx"],
  ["055 – 123 – 4567", "xxx – xxx – xxxx"],
  ["055–123–4567", "xxx–xxx–xxxx"],
  ["055—123—4567", "xxx—xxx—xxxx"],
  ["055/123/4567", "xxx/xxx/xxxx"],
  ["055_123_4567", "xxx_xxx_xxxx"],
  ["055,123,4567", "xxx,xxx,xxxx"],
  ["055   123   4567", "xxx   xxx   xxxx"],
  ["055 / 1234567", "xxx / xxxxxxx"],
  ["0 5 5 - 1 2 3 - 4 5 6 7", "x x x - x x x - x x x x"],
  ["+966 55 – 123 – 4567", "+xxx xx – xxx – xxxx"],
  ["٠٥٥ - ١٢٣ - ٤٥٦٧", "xxx - xxx - xxxx"],
  ["055\u200f1234567", "xxx\u200fxxxxxxx"],
];

Deno.test("scrubPhones: a phone split by any dash, slash, underscore, comma, up to three spaces or a bidi mark becomes x", () => {
  for (const [phone, want] of SEPARATED_PHONES) {
    assertEquals(scrubPhones(`للتواصل ${phone} شكراً`), `للتواصل ${want} شكراً`, phone);
  }
  // علامة الطرح والتطويل والمسافة غير القاطعة وعلامات الاتجاه حول الرقم، وأرقام الإيموجي والأرقام العريضة
  const more: [string, string][] = [
    ["055\u2212123\u22124567", "xxx\u2212xxx\u2212xxxx"],
    ["055ـ123ـ4567", "xxxـxxxـxxxx"],
    ["055\u00a0-\u00a0123\u00a0-\u00a04567", "xxx\u00a0-\u00a0xxx\u00a0-\u00a0xxxx"],
    ["\u202a055 - 123 - 4567\u202c", "\u202axxx - xxx - xxxx\u202c"],
    ["0\ufe0f\u20e35\ufe0f\u20e35\ufe0f\u20e31\ufe0f\u20e32\ufe0f\u20e33\ufe0f\u20e34\ufe0f\u20e35\ufe0f\u20e36\ufe0f\u20e37\ufe0f\u20e3",
      "x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3x\ufe0f\u20e3"],
    ["０５５１２３４５６７", "xxxxxxxxxx"],
    ["𝟎𝟓𝟓 𝟏𝟐𝟑 𝟒𝟓𝟔𝟕", "xxx xxx xxxx"],
    // رقم غير سعودي بلا + ولا 00، بجزء قصير: رقم واحد
    ["010 - 1234 - 5678", "xxx - xxxx - xxxx"],
  ];
  for (const [phone, want] of more) assertEquals(scrubPhones(`جوال ${phone}`), `جوال ${want}`, phone);
});

Deno.test("scrubPhones: grouped, decimal and dated numbers and their lists stay — unless they hide a phone", () => {
  const kept = [
    "السعر 12,500,000 ريال",
    "السعر ١٢٬٥٠٠٬٠٠٠ ريال",
    "السعر ١٢،٥٠٠،٠٠٠ ريال",
    "السعر 1,250,000,000 ريال", // «000» في وسط العدد ليس «00» دولياً
    "السعر 1,250,000.50 ريال",
    "Total 1234567.89 SAR",
    "السعر ١٢٣٤٥٦٧٫٥٠ ريال",
    "من 950000 - 1000000 ريال",
    "من 1,200,000 – 1,350,000 ريال",
    "سعر المتر 2500 / 2800 / 3000",
    "التسليم 27/09/2026 أو 1448/03/15",
    "من 2026-09-27 – 2026-10-01",
    "قطع 1234، 1235، 1236",
  ];
  for (const text of kept) assertEquals(scrubPhones(text), text, text);
  const hidden: [string, string][] = [
    ["الرقم 966,551,234,567", "الرقم xxx,xxx,xxx,xxx"],
    ["الرقم 551,234,567", "الرقم xxx,xxx,xxx"], // كما يخفي Redactor «551.234.567»
    ["الرقم +966551 - 234567", "الرقم +xxxxxx - xxxxxx"],
    // + قبل السلسلة يجعلها دولية: جوال بريطاني (نطاق Ofcom المحجوز للأمثلة) بفاصل في وسطه
    ["UK +447700 - 900123", "UK +xxxxxx - xxxxxx"],
    ["الرقم 5512 - 34567", "الرقم xxxx - xxxxx"],
    // الجوال المعروف يُستبدل أولاً (rawPhones)، فيبقى السعر بجانبه
    ["السعر 950000 - 0551234567", "السعر 950000 - xxxxxxxxxx"],
    ["السعر 950000 - 055 - 123 - 4567", "السعر xxxxxx - xxx - xxx - xxxx"],
    // جزء ليس عدداً قائماً بنفسه يجعل القائمة رقماً واحداً
    ["الأدوار 101 - 102 - 103", "الأدوار xxx - xxx - xxx"],
    // العدد المجمّع لا يبدأ بصفر، والمسافة الواحدة تصل الرقم ولا تفصل قائمة (جوال بريطاني بلا +44)
    ["الرقم 055,123,456", "الرقم xxx,xxx,xxx"],
    ["UK 7700 900123", "UK xxxx xxxxxx"],
  ];
  for (const [text, want] of hidden) assertEquals(scrubPhones(text), want, text);
});

Deno.test("questions: every separated phone leaves no digit in what reaches Jev (Redactor, then buildRequest)", () => {
  for (const [phone] of SEPARATED_PHONES) {
    const redactor = new Redactor();
    const built = buildRequest("wa-1", {
      message: redactor.redact(capRuns(`شقة للبيع، للتواصل ${phone}`)),
      group: redactor.redact(capRuns(`عروض ${phone}`)),
    });
    assertFalse(/\p{Nd}/u.test(built.state.message + built.state.group), `${phone} → ${JSON.stringify(built.state)}`);
  }
});

Deno.test("questions: only the head that can be sent is scrubbed, and a phone across the 6000 cut leaves no digit", () => {
  const pad = "أ".repeat(MESSAGE_MAX - 6);
  const built = buildRequest("wa-1", { message: pad + " 055 - 123 - 4567 شكراً" });
  assertEquals(built.state.message, pad + " xxx -");
  assertEquals(built.truncated, true);
  // ما بعد الهامش لا يُفحص ولا يُرسل؛ الأطول من الهامش يبقى مقطوعاً
  const long = buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX) + " 0551234567" + "ج".repeat(20_000) });
  assertEquals([long.state.message, long.truncated], ["ب".repeat(MESSAGE_MAX), true]);
  // الهامش لا يغيّر حكم القطع: نص أقصر من الحد كما هو، ونص أطول منه بحرف مقطوع
  assertEquals(buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX) }).truncated, false);
  assertEquals(buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX + 1) }).truncated, true);
  assertEquals(buildRequest("wa-1", { message: "ب".repeat(MESSAGE_MAX + 100) }).truncated, true);
  // أرقام من خارج BMP (زوجان لكل رقم) تصير x واحدة: الرأس المفحوص يقصر عن الحد، والباقي المحذوف يبقى قطعاً
  const astral = buildRequest("wa-1", { message: "𝟏".repeat(3_100) });
  assertEquals([astral.state.message, astral.truncated], ["x".repeat((MESSAGE_MAX + 64) / 2), true]);
  // واسم المجموعة كذلك
  const group = buildRequest("wa-1", { message: "نص", group: "م".repeat(GROUP_MAX - 4) + " 055 – 123 – 4567" });
  assertEquals(group.state.group, "م".repeat(GROUP_MAX - 4) + " xxx");
});

Deno.test("capRuns: a long run of e-mail characters is cut to RUN_MAX; ordinary text, e-mails and phones are untouched", () => {
  assertEquals(RUN_MAX, 64);
  assertEquals(capRuns("1.".repeat(10_000)), "1.".repeat(32));
  assertEquals(capRuns("عرض\n" + "-".repeat(3000) + "\nشقة"), "عرض\n" + "-".repeat(RUN_MAX) + "\nشقة");
  const ordinary = "للتواصل sales.team+jed@example.com أو 0551234567 https://example.com/p/123?x=1 السعر 1,250,000";
  assertEquals(capRuns(ordinary), ordinary);
  assertEquals(capRuns(""), "");
  // بريد بجزء محلي أطول من الحد: يُقصر ويبقى مخفياً كله
  const redacted = new Redactor().redact(capRuns("راسلنا " + "x".repeat(100) + "@example.com"));
  assertEquals(redacted, "راسلنا [EMAIL_1]");
});

Deno.test("questions: what goes to Jev is leak-checked — message and group alike", () => {
  const built = buildRequest("wa-1", { message: "فيلا للبيع 0551234567 السعر 2 مليون", group: "مجموعة 966551234567" });
  assertEquals(built.state.message, "فيلا للبيع xxxxxxxxxx السعر 2 مليون");
  assertEquals(built.state.group, "مجموعة xxxxxxxxxxxx");
  assertFalse(/\d{8}/.test(JSON.stringify(built.state)));
});

/* ===================== الحكم ===================== */

const ch = (choice: string, confidence: number | null = 0.9) => ({ choice, confidence, probabilities: null });

Deno.test("verdict: thresholds live in one frozen place", () => {
  assertEquals({ ...THRESHOLDS }, { send: 0.75, skip: 0.75, city: 0.6, multiple: 0.6 });
  assert(Object.isFrozen(THRESHOLDS));
});

Deno.test("verdict: confidence is (n·pmax − 1)/(n − 1) when Jev omits it — the docs' examples", () => {
  assertAlmostEquals(confidenceFrom({ a: 0.61, b: 0.35, c: 0.04 })!, 0.415, 1e-9);
  assertAlmostEquals(confidenceFrom({ a: 0.4, b: 0.3, c: 0.2, d: 0.1 })!, 0.2, 1e-9);
  assertAlmostEquals(confidenceFrom({ a: 0.74, b: 0.1, c: 0.1, d: 0.05, e: 0.01 })!, 0.675, 1e-9);
  assertEquals(confidenceFrom({ a: 1, b: 0 }), 1);
  assertEquals(confidenceFrom({ a: 0.5, b: 0.5 }), 0);
  // n من خيارات السؤال إن عُرفت، لا من الاحتمالات المعادة وحدها
  assertAlmostEquals(confidenceFrom({ a: 0.6, b: 0.4 }, 6)!, (6 * 0.6 - 1) / 5, 1e-9);
  assertEquals(confidenceFrom(null), null);
  assertEquals(confidenceFrom({}), null);
  assertEquals(confidenceFrom({ a: 1 }), null);
  assertEquals(confidenceFrom({ a: 0.1, b: 0.1, c: 0.1 }), 0); // لا تنزل تحت الصفر
});

Deno.test("verdict: normalizeChoice keeps Jev's confidence, derives a missing one, and rejects what is not an option", () => {
  const probs = { sale_offer: 0.88, rent_offer: 0.02, status_update: 0.05, wanted: 0.01, not_property: 0.03, other: 0.01 };
  assertEquals(normalizeChoice({ type: "choice", choice: "sale_offer", probabilities: probs, confidence: 0.81 }, INTENTS), {
    choice: "sale_offer", confidence: 0.81, probabilities: probs,
  });
  const derived = normalizeChoice({ type: "choice", choice: "sale_offer", probabilities: { sale_offer: 0.88, other: 0.12 } }, INTENTS)!;
  assertAlmostEquals(derived.confidence!, (6 * 0.88 - 1) / 5, 1e-9);
  const noOptions = normalizeChoice({ choice: "x", probabilities: { x: 0.75, y: 0.25 } })!;
  assertAlmostEquals(noOptions.confidence!, 0.5, 1e-9);
  assertEquals(normalizeChoice({ type: "choice", choice: "wanted" }, INTENTS), { choice: "wanted", confidence: null, probabilities: null });
  assertEquals(normalizeChoice({ type: "choice", choice: "other", confidence: 1.4 }, INTENTS)!.confidence, 1);
  assertEquals(normalizeChoice({ type: "choice", choice: "buy" }, INTENTS), null);
  assertEquals(normalizeChoice({ type: "noul", noul: 0.4 }), null);
  assertEquals(normalizeChoice({ type: "choice", choice: "" }), null);
  assertEquals(normalizeChoice(undefined), null);
  assertEquals([noulOf({ type: "noul", noul: 0.7 }), noulOf(0.2), noulOf({ type: "choice" }), noulOf(null)], [0.7, 0.2, null, null]);
});

Deno.test("verdict: a document-only block is review «document_only» whatever the answers", () => {
  assertEquals(decide({}, "document"), { verdict: "review", reasons: ["document_only"] });
  assertEquals(decide({ intent: ch("sale_offer", 1) }, "document"), { verdict: "review", reasons: ["document_only"] });
});

Deno.test("verdict: a missing or invalid intent is review «error»", () => {
  for (const answers of [{}, { intent: null }, { intent: ch("buy_now") }, { intent: { choice: 3 } } as unknown as Answers]) {
    assertEquals(decide(answers, "offer"), { verdict: "review", reasons: ["error"] });
  }
});

Deno.test("verdict: not_property and wanted at ≥ 0.75 are skipped under their own name; rent_offer as «rent»", () => {
  assertEquals(decide({ intent: ch("not_property", 0.75) }, "other"), { verdict: "skip", reasons: ["not_property"] });
  assertEquals(decide({ intent: ch("wanted", 0.9) }, "wanted"), { verdict: "skip", reasons: ["wanted"] });
  assertEquals(decide({ intent: ch("rent_offer", 0.8) }, "offer"), { verdict: "skip", reasons: ["rent"] });
  for (const intent of ["not_property", "wanted", "rent_offer"]) {
    assertEquals(decide({ intent: ch(intent, 0.7499) }, "offer"), { verdict: "review", reasons: ["low_confidence"] }, intent);
  }
});

Deno.test("verdict: sale_offer and status_update at ≥ 0.75 are sent, unless several properties or outside Jeddah", () => {
  const base = { city: ch("jeddah", 0.9), multiple: 0.1 };
  assertEquals(decide({ intent: ch("sale_offer", 0.75), ...base }, "offer"), { verdict: "send", reasons: ["sale_offer"] });
  assertEquals(decide({ intent: ch("status_update", 0.95), ...base }, "update"), { verdict: "send", reasons: ["status_update"] });
  assertEquals(decide({ intent: ch("sale_offer", 0.74), ...base }, "offer"), { verdict: "review", reasons: ["low_confidence"] });
  // عدة عقارات: noul ≥ 0.6
  assertEquals(decide({ intent: ch("sale_offer"), ...base, multiple: 0.6 }, "offer"), { verdict: "review", reasons: ["multiple"] });
  assertEquals(decide({ intent: ch("sale_offer"), ...base, multiple: 0.59 }, "offer").verdict, "send");
  assertEquals(decide({ intent: ch("sale_offer"), city: base.city, multiple: null }, "offer").verdict, "send");
  // خارج جدة بثقة ≥ 0.6
  for (const city of ["makkah", "madinah", "riyadh", "other_city"]) {
    assertEquals(decide({ intent: ch("sale_offer"), city: ch(city, 0.6) }, "offer"), { verdict: "review", reasons: ["outside_jeddah"] }, city);
    assertEquals(decide({ intent: ch("sale_offer"), city: ch(city, 0.59) }, "offer").verdict, "send", city);
    assertEquals(decide({ intent: ch("sale_offer"), city: ch(city, null) }, "offer").verdict, "send", city);
  }
  for (const city of ["jeddah", "not_stated"]) assertEquals(decide({ intent: ch("sale_offer"), city: ch(city, 1) }, "offer").verdict, "send");
  assertEquals(decide({ intent: ch("sale_offer") }, "offer").verdict, "send");
  // عدة عقارات قبل المدينة
  assertEquals(decide({ intent: ch("sale_offer"), city: ch("makkah", 1), multiple: 0.9 }, "offer").reasons, ["multiple"]);
});

Deno.test("verdict: «other», a low or missing confidence, are review «low_confidence»; thresholds can be passed", () => {
  assertEquals(decide({ intent: ch("other", 0.99) }, "offer"), { verdict: "review", reasons: ["low_confidence"] });
  assertEquals(decide({ intent: ch("sale_offer", null) }, "offer"), { verdict: "review", reasons: ["low_confidence"] });
  assertEquals(decide({ intent: ch("wanted", null) }, "wanted"), { verdict: "review", reasons: ["low_confidence"] });
  // regex_kind لا يغيّر الحكم إلا للمستند
  assertEquals(decide({ intent: ch("sale_offer") }, null).verdict, "send");
  const strict = { send: 0.95, skip: 0.95, city: 0.3, multiple: 0.9 };
  assertEquals(decide({ intent: ch("sale_offer", 0.9) }, "offer", strict).reasons, ["low_confidence"]);
  assertEquals(decide({ intent: ch("sale_offer", 0.96), city: ch("riyadh", 0.31) }, "offer", strict).reasons, ["outside_jeddah"]);
  assertEquals(decide({ intent: ch("sale_offer", 0.96), multiple: 0.8 }, "offer", strict).verdict, "send");
});

Deno.test("verdict: stored answers keep intent/city in full, kind/district top-3, multiple as {noul}, and read back", () => {
  const intentProbs = { sale_offer: 0.8, rent_offer: 0.05, status_update: 0.1, wanted: 0.02, not_property: 0.02, other: 0.01 };
  const kindProbs = { apartment: 0.7, villa: 0.2, floor: 0.05, building: 0.03, land: 0.02 };
  const answers: Answers = {
    intent: { choice: "sale_offer", confidence: 0.76, probabilities: intentProbs },
    city: { choice: "jeddah", confidence: 0.64, probabilities: { jeddah: 0.7, not_stated: 0.3 } },
    kind: { choice: "apartment", confidence: 0.63, probabilities: kindProbs },
    district: { choice: "المروة", confidence: 0.9, probabilities: { "المروة": 0.95, none: 0.05 } },
    multiple: 0.08,
  };
  const stored = compactAnswers(answers, { truncated: true });
  assertEquals(stored, {
    intent: { choice: "sale_offer", confidence: 0.76, probabilities: intentProbs },
    city: { choice: "jeddah", confidence: 0.64, probabilities: { jeddah: 0.7, not_stated: 0.3 } },
    kind: { choice: "apartment", confidence: 0.63, top: [["apartment", 0.7], ["villa", 0.2], ["floor", 0.05]] },
    district: { choice: "المروة", confidence: 0.9, top: [["المروة", 0.95], ["none", 0.05]] },
    multiple: { noul: 0.08 },
    truncated: true,
  });
  // كما يعود من jsonb
  const back = readStored(JSON.parse(JSON.stringify(stored)));
  assertEquals(back.truncated, true);
  assertEquals(back.answers.intent, answers.intent);
  assertEquals(back.answers.kind, { choice: "apartment", confidence: 0.63, probabilities: { apartment: 0.7, villa: 0.2, floor: 0.05 } });
  assertEquals(back.answers.multiple, 0.08);
  assertEquals(decide(back.answers, "offer"), decide(answers, "offer"));
  // الحي بالكود وإجابات غائبة
  const code = compactAnswers({ intent: null, district: { choice: "not_stated", confidence: null, probabilities: null, by: "code" } });
  assertEquals(code, {
    intent: null, city: null, kind: null, multiple: null,
    district: { choice: "not_stated", confidence: null, top: [], by: "code" },
  });
  assertEquals(readStored(code).answers.district, { choice: "not_stated", confidence: null, probabilities: null, by: "code" });
  assertEquals(readStored(null), { answers: { intent: null, kind: null, city: null, district: null, multiple: null }, truncated: false });
  assertEquals(topOf({ b: 0.2, a: 0.2, c: 0.6 }), [["c", 0.6], ["a", 0.2], ["b", 0.2]]);
});
