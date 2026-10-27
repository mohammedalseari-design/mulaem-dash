// تحسين صور البروشور (enhance.ts) بلا شبكة ولا مخزن: ما يُختار ويُترك وبأي أولوية، والنسبة، وجسم النداء وتعليماته، وقراءة الجواب،
// والنداء بمزوّد مزيّف (نجاح، خطأ، مهلة)، وفحص الأمانة (نجاح، رفض، جواب لا يُقرأ، مهلة)، والتشغيل: ثلاث صور معاً بحد، وسقف اليوم
// باحتياطيه، والوقت، وحفظ القراءة قبل أول نداء مدفوع واستئناف محاولة توقفت أثناء التحسين، وكل فشل يُسجَّل ويُبقي الأصل.
// التشغيل: deno test --allow-read --allow-env supabase/functions/agent-run/
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding@1/base64";
import { chat, ChatError, type ChatResult, defaultTiers } from "../_shared/effort-router/mod.ts";
import type { BrochureGroup, BrochurePage, BrochureResult } from "./brochure.ts";
import {
  ENHANCE_INTERRUPTED_AR, ENHANCE_SAVE_FAILED_AR, type EnhanceDeps, type Enhanced, enhanceHeroes, enhanceImage, enhanceNotes,
  enhancingRecord, finishReading, type HeroCall, heroPaths, heroPrompt, ImageError, imageFromResponse, imageRequestBody, imageSize,
  type Inline, nearestRatio, OPENROUTER_CHAT_URL, pickHeroes, planHeroes, QA_SCHEMA, QA_SYSTEM_PROMPT, qaPasses, qaRequest, qaTier,
  qaVerdict, RESTORE_RULE, savedReading, SIGN_RULE, withEnhancement,
} from "./enhance.ts";
import type { Fetch } from "./fetch.ts";

const ID = "0f6c2a9e-1111-4222-8333-944455556666";
const OTHER_ID = "1f6c2a9e-1111-4222-8333-944455556666";
const MODEL = "google/gemini-3-pro-image";
const GENERAL = defaultTiers(() => undefined).general!;

// PNG بترويسة IHDR (عرض، ارتفاع) وبايت أخير يميّزها
const png = (w: number, h: number, k = 0) =>
  new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 2, 0, 0, 0, k,
  ]);
// JPEG بإطار SOF0 (عرض، ارتفاع) وبايت أخير يميّزها؛ app: مقطع APP0 قبل الإطار
const jpeg = (k: number, w = 1600, h = 900, app = false) =>
  new Uint8Array([
    0xff, 0xd8,
    ...(app ? [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0] : []),
    0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9, k,
  ]);

// صورة media رقم k (img-0k) وأين ظهرت: [[صفحة، رقم مصغّرتها]]
const shot = (k: number, on: [number, number][], extra: Record<string, unknown> = {}) => ({
  url: `https://x.supabase.co/storage/v1/object/public/project-images/brochures/${ID}/img-${String(k).padStart(2, "0")}.jpg`,
  page: on[0]?.[0] ?? 1, w: 1600, h: 900, kind: "photo", tone: "dark", tall: false, on: on.map(([page, n]) => ({ page, n })), ...extra,
});
// صفحة في القراءة وأدوار صورها: [[رقم المصغّرة، الدور]]
const page = (n: number, role: string, images: [number, string][] = [], extra: Record<string, unknown> = {}) => ({
  page: n, role, title: null, subtitle: null, body: null, bullets: [] as string[], model: null as unknown,
  images: images.map(([k, r]) => ({ n: k, role: r, caption: null })), ...extra,
});
const reading = (...pages: ReturnType<typeof page>[]) =>
  ({ version: 2, project: {}, pages, missing: [] as number[], conflicts: [], dropped: 0 }) as unknown as BrochureResult;

/* ===================== ما يُختار ===================== */

Deno.test("pickHeroes: the cover, then photos/other pages (interiors first, 3 a page), then one photo of about, amenities and contact", () => {
  const media = {
    images: [
      shot(1, [[1, 1]]), // 0 الغلاف
      shot(2, [[2, 1]]), // 1 عن المشروع
      shot(3, [[3, 1]]), // 2 صفحة صور: واجهة رابعة، تخرج بحد الثلاث (الداخلية أولاً)
      shot(4, [[3, 2]]), // 3 داخلية
      shot(5, [[3, 3]]), // 4 داخلية
      shot(6, [[3, 4]]), // 5 داخلية
      shot(7, [[4, 1]]), // 6 صفحة موقع: لا
      shot(8, [[5, 1]]), // 7 مزايا بنقاط
      shot(9, [[6, 1]]), // 8 جوّ: لا
      shot(10, [[6, 2]], { kind: "plan" }), // 9 صنّفها الاستخراج مخططاً: لا
      shot(11, [[6, 3]]), // 10 plan3d: لا
      shot(12, [[6, 4]]), // 11 صفحة «أخرى»: داخلية
      shot(13, [[7, 1]]), // 12 تواصل في الوسط
      shot(14, [[8, 1]]), // 13 صفحة نموذج: لا
      shot(15, [[9, 1]]), // 14 آخر صفحة تواصل = الغلاف الخلفي: لا
    ],
  };
  const result = reading(
    page(1, "cover", [[1, "exterior"]]),
    page(2, "about", [[1, "interior"]]),
    page(3, "photos", [[1, "exterior"], [2, "interior"], [3, "interior"], [4, "interior"]]),
    page(4, "location", [[1, "aerial"]]),
    page(5, "amenities", [[1, "interior"]], { bullets: ["مسبح"] }),
    page(6, "other", [[1, "aerial"], [2, "exterior"], [3, "plan3d"], [4, "interior"]]),
    page(7, "contact", [[1, "exterior"]]),
    page(8, "model", [[1, "interior"]], { model: { name: "A" } }),
    page(9, "contact", [[1, "exterior"]]),
  );
  assertEquals(pickHeroes(result, media, ID, 20), [0, 3, 4, 5, 11, 1, 7, 12]);
  assertEquals(pickHeroes(result, media, ID, 6), [0, 3, 4, 5, 11, 1]);
  assertEquals(pickHeroes(result, media, ID, 0), []);
  assertEquals(pickHeroes(result, { images: "x" }, ID, 6), []);
  assertEquals(pickHeroes({}, media, ID, 6), []);
});

Deno.test("pickHeroes: the cover is the browser's (page 1's first wide photo, else its first, else the first exterior); none if page 1 is unread", () => {
  // العريضة قبل الطويلة ولو جاءت بعدها
  const wide = { images: [shot(1, [[1, 1]], { tall: true }), shot(2, [[1, 2]])] };
  assertEquals(pickHeroes(reading(page(1, "cover", [[1, "exterior"], [2, "interior"]])), wide, ID, 6), [1]);
  // لا عريضة: أولى صورها
  const tall = { images: [shot(1, [[1, 1]], { tall: true })] };
  assertEquals(pickHeroes(reading(page(1, "cover", [[1, "exterior"]])), tall, ID, 6), [0]);
  // غلاف بلا صورة: أول واجهة بترتيب الصفحات (وإن طُبعت صفحتها غلافاً خلفياً)، ثم صورة «عن المشروع»
  const borrowed = { images: [shot(1, [[2, 1]]), shot(2, [[3, 1]], { tall: true })] };
  const plain = reading(page(1, "cover"), page(2, "about", [[1, "interior"]]), page(3, "photos", [[1, "exterior"]]));
  assertEquals(pickHeroes(plain, borrowed, ID, 6), [1, 0]);
  // غلاف المتصفح صورة جوّ: لا يُحسَّن ولا يُستبدل بالواجهة الطويلة التي لا يطبعها
  const aerial = { images: [shot(1, [[1, 1]]), shot(2, [[1, 2]], { tall: true }), shot(3, [[2, 1]])] };
  const aerialCover = reading(page(1, "cover", [[1, "aerial"], [2, "exterior"]]), page(2, "about", [[1, "interior"]]), page(3, "contact"));
  assertEquals(pickHeroes(aerialCover, aerial, ID, 6), [2]);
  // الصفحة الأولى لم تُقرأ: لا خطوة غلاف (أدوار صورها مجهولة)
  const unread = { images: [shot(1, [[1, 1]]), shot(2, [[2, 1]])] };
  const noCover = { ...reading(page(2, "photos", [[1, "exterior"]]), page(3, "contact")), missing: [1] } as BrochureResult;
  assertEquals(pickHeroes(noCover, unread, ID, 6), [1]);
});

Deno.test("pickHeroes: a non-photo role anywhere, a location page, a plan, an unread page or another request's folder excludes the image", () => {
  const media = {
    images: [
      shot(1, [[1, 1]], { kind: "plan" }), // 0 الاستخراج صنّفها مخططاً: لا، ولو قالت القراءة واجهة
      shot(2, [[2, 1], [5, 1]]), // 1 واجهة في صفحة وشعار في أخرى: لا
      shot(3, [[2, 2]]), // 2 plan3d
      shot(4, [[2, 3], [6, 1]]), // 3 داخلية في صفحة وفي صفحة موقع: لا
      shot(5, [[2, 4], [4, 2]]), // 4 واجهة هنا وجوّ هناك: لا
      shot(6, [[9, 1]]), // 5 صفحة لم تُقرأ: لا دور لها
      shot(7, [[2, 5], [4, 1]]), // 6 داخلية في صفحتين: مرة واحدة
      { ...shot(8, [[4, 3]]), url: shot(8, []).url.replace(ID, OTHER_ID) }, // 7 مجلد طلب آخر: لا
      { url: null, on: [{ page: 2, n: 6 }] }, // 8 بلا رابط: لا
    ],
  };
  const result = reading(
    page(1, "cover", [[1, "exterior"]]),
    page(2, "photos", [[1, "exterior"], [2, "plan3d"], [3, "interior"], [4, "exterior"], [5, "interior"], [6, "interior"]]),
    page(4, "photos", [[1, "interior"], [2, "aerial"], [3, "exterior"]]),
    page(5, "other", [[1, "logo"]]),
    page(6, "location", [[1, "map"]]),
    page(10, "contact"),
  );
  assertEquals(pickHeroes(result, media, ID, 6), [6]);
});

Deno.test("heroPaths: only this brochure's extracted images are read, and the improved copy lands beside them", () => {
  const url = (rest: string) => `https://x.supabase.co/storage/v1/object/public/project-images/${rest}`;
  assertEquals(heroPaths(url(`brochures/${ID}/img-07.jpg`), ID), { source: `brochures/${ID}/img-07.jpg`, target: `brochures/${ID}/enh-07.png` });
  assertEquals(heroPaths(url(`brochures/${ID}/img-12.png?x=1`), ID), { source: `brochures/${ID}/img-12.png`, target: `brochures/${ID}/enh-12.png` });
  const bad = [
    url(`brochures/${OTHER_ID}/img-07.jpg`), url(`brochures/${ID}/media.json`), url(`brochures/${ID}/enh-07.png`),
    url(`brochures/${ID}/img-7.jpg`), url(`brochures/${ID}/x/../../other/img-07.jpg`), url(`projects/${ID}/img-07.jpg`),
    `http://x.supabase.co/storage/v1/object/public/project-images/brochures/${ID}/img-07.jpg`, "not a url", null,
  ];
  for (const u of bad) assertEquals(heroPaths(u, ID), null, String(u));
});

/* ===================== النسبة ===================== */

Deno.test("nearestRatio: the supported ratio nearest the source's own shape; a square stays 1:1, never a forced 16:9", () => {
  const cases: [number, number, string][] = [
    [1303, 1303, "1:1"], [1600, 900, "16:9"], [900, 1600, "9:16"], [1200, 1600, "3:4"], [1000, 1500, "2:3"], [1500, 1000, "3:2"],
    [2560, 1080, "21:9"], [1000, 800, "5:4"], [800, 1000, "4:5"], [1100, 800, "4:3"], [2000, 1000, "16:9"],
  ];
  for (const [w, h, ratio] of cases) assertEquals(nearestRatio(w, h), ratio, `${w}x${h}`);
  for (const [w, h] of [[0, 10], [10, 0], [NaN, 1], [Infinity, 1], [-5, 5]]) assertEquals(nearestRatio(w, h), null);
});

Deno.test("imageSize: width and height from a PNG header or a JPEG frame; anything else is null", () => {
  assertEquals(imageSize(png(2752, 1536)), { w: 2752, h: 1536 });
  assertEquals(imageSize(jpeg(1, 1303, 1303)), { w: 1303, h: 1303 });
  assertEquals(imageSize(jpeg(1, 900, 1600, true)), { w: 900, h: 1600 });
  assertEquals(imageSize(new TextEncoder().encode("<html>not an image</html>")), null);
  assertEquals(imageSize(png(2752, 1536).slice(0, 20)), null);
});

Deno.test("planHeroes: each picked image with its role, its storage paths and its media.json size", () => {
  const media = { images: [shot(1, [[1, 1]], { w: 1303, h: 1303 }), shot(2, [[2, 1]], { w: 900, h: 1600 }), shot(3, [[2, 2]], { w: 0 })] };
  const result = reading(page(1, "cover", [[1, "exterior"]]), page(2, "photos", [[1, "interior"], [2, "exterior"]]), page(3, "contact"));
  assertEquals(planHeroes(result, media, ID, 6), [
    { i: 0, role: "exterior", source: `brochures/${ID}/img-01.jpg`, target: `brochures/${ID}/enh-01.png`, size: { w: 1303, h: 1303 } },
    { i: 1, role: "interior", source: `brochures/${ID}/img-02.jpg`, target: `brochures/${ID}/enh-02.png`, size: { w: 900, h: 1600 } },
    { i: 2, role: "exterior", source: `brochures/${ID}/img-03.jpg`, target: `brochures/${ID}/enh-03.png`, size: null },
  ]);
});

/* ===================== جسم النداء وتعليماته والجواب ===================== */

type Body = Record<string, unknown> & { messages: { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] }[] };

Deno.test("imageRequestBody: an image answer at the source's ratio in 2K, no data collection, the original as a data URL after the prompt", () => {
  const body = imageRequestBody(MODEL, "image/jpeg", "AAAA", "exterior", "1:1") as Body;
  assertEquals(body.model, MODEL);
  assertEquals(body.modalities, ["image", "text"]);
  assertEquals(body.image_config, { aspect_ratio: "1:1", image_size: "2K" });
  assertEquals(body.provider, { data_collection: "deny" });
  assertEquals(body.messages.length, 1);
  assertEquals(body.messages[0].role, "user");
  const [text, image] = body.messages[0].content;
  assertEquals(text, { type: "text", text: heroPrompt("exterior") });
  assertEquals(image, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
  assertEquals((imageRequestBody(MODEL, "image/png", "AAAA", "interior", "9:16") as Body).image_config, { aspect_ratio: "9:16", image_size: "2K" });
});

Deno.test("heroPrompt: restoration of the same frame, the sign and lettering rule word for word, the photo's own colours, per role", () => {
  for (const role of ["exterior", "interior", "aerial"] as const) {
    const prompt = heroPrompt(role);
    assertStringIncludes(prompt, SIGN_RULE);
    assertStringIncludes(prompt, RESTORE_RULE);
    for (const words of ["edge to edge", "Never crop", "never invent", "own colours", "not beautification", "if it is blurry, leave it blurry"]) {
      assertStringIncludes(prompt, words);
    }
    // لا نسبة مفروضة ولا ألوان ملائم ولا تدرّج «فاخر»
    assert(!/16:9|navy|brand|premium|gold(?!en hour)/i.test(prompt), role);
  }
  assertStringIncludes(SIGN_RULE, "Do not redraw, retype, restyle or correct any existing sign, logo or lettering");
  assertStringIncludes(SIGN_RULE, "Do not add any new text, letters, numbers, logos or watermarks.");
  for (const words of ["no golden hour", "No characters on licence plates", "add no texture, coursing, veining or warmth", "swap people, vehicles"]) {
    assertStringIncludes(RESTORE_RULE, words);
  }
  for (const words of ["building", "facade", "windows", "materials"]) assertStringIncludes(heroPrompt("exterior"), words);
  for (const words of ["room", "furniture", "layout"]) assertStringIncludes(heroPrompt("interior"), words);
  assert(!heroPrompt("interior").includes("facade"));
  assertStringIncludes(heroPrompt("aerial"), "every building");
});

const dataUrl = (bytes: Uint8Array, mime = "image/png") => `data:${mime};base64,${encodeBase64(bytes)}`;
const answerWith = (images: unknown[], extra: Record<string, unknown> = {}) => ({ choices: [{ message: { role: "assistant", content: "", images } }], ...extra });

Deno.test("imageFromResponse: the first real image in the answer as base64, its type from its bytes; no image is null", () => {
  const PNG = png(2752, 1536);
  assertEquals(imageFromResponse(answerWith([{ type: "image_url", image_url: { url: dataUrl(PNG) } }])), { mime: "image/png", base64: encodeBase64(PNG) });
  // يُتخطى ما ليس صورة (رابط عادي، نص، base64 تالف، بايتات ليست صورة) إلى أول صورة صالحة؛ والنوع من البايتات لا من الرابط
  const picked = imageFromResponse(answerWith([
    { image_url: { url: "https://cdn.example/x.png" } },
    { image_url: { url: "data:text/plain;base64,aGVsbG8=" } },
    { image_url: { url: "data:image/png;base64,@@@" } },
    { image_url: { url: dataUrl(new TextEncoder().encode("hello")) } },
    { image_url: { url: dataUrl(jpeg(3), "image/png") } },
  ]));
  assertEquals(picked, { mime: "image/jpeg", base64: encodeBase64(jpeg(3)) });
  const b64 = encodeBase64(PNG);
  assertEquals(imageFromResponse(answerWith([{ image_url: { url: `data:image/png;base64,${b64.slice(0, 4)}\n${b64.slice(4)}` } }])), { mime: "image/png", base64: b64 });
  for (const none of [null, undefined, {}, { choices: [] }, { choices: [{ message: { content: "I cannot edit this image." } }] }, answerWith([]), answerWith([{}])]) {
    assertEquals(imageFromResponse(none), null);
  }
});

/* ===================== نداء الصورة ===================== */

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BODY = imageRequestBody(MODEL, "image/jpeg", "AAAA", "exterior", "16:9");

Deno.test("enhanceImage: posts the body to OpenRouter with the key and returns the image, its cost and provider", async () => {
  const PNG = png(2752, 1536);
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn: Fetch = (url, init) => {
    seen.push({ url, init });
    return Promise.resolve(reply(answerWith([{ type: "image_url", image_url: { url: dataUrl(PNG) } }], {
      provider: "Google", usage: { prompt_tokens: 1290, completion_tokens: 1120, cost: 0.139 },
    })));
  };
  const out = await enhanceImage(fetchFn, "sk-test", BODY, 5_000);
  assertEquals([out.mime, out.base64, out.costUsd, out.provider], ["image/png", encodeBase64(PNG), 0.139, "Google"]);
  assertEquals(out.tokens, { prompt: 1290, completion: 1120 });
  assert(out.ms >= 0);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, OPENROUTER_CHAT_URL);
  assertEquals(seen[0].init.method, "POST");
  assertEquals((seen[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  assertEquals(JSON.parse(String(seen[0].init.body)), BODY);
  assert(seen[0].init.signal instanceof AbortSignal);
});

Deno.test("enhanceImage: an HTTP error, an error inside a 200 and an answer without an image throw with status and message", async () => {
  const once = (body: unknown, status = 200): Fetch => () => Promise.resolve(reply(body, status));
  const limited = await assertRejects(() =>
    enhanceImage(once({ error: { code: 429, message: "Rate limit exceeded", metadata: { provider_name: "Google", raw: "quota" } } }, 429), "k", BODY, 5_000), ImageError);
  assertEquals([limited.status, limited.kind, limited.provider], [429, "http", "Google"]);
  assertStringIncludes(limited.message, "Rate limit exceeded");
  assertStringIncludes(limited.message, "quota");
  const inside = await assertRejects(() => enhanceImage(once({ error: { code: 502, message: "Provider returned error" } }), "k", BODY, 5_000), ImageError);
  assertEquals([inside.status, inside.kind], [502, "http"]);
  const bare = await assertRejects(() => enhanceImage(() => Promise.resolve(new Response("busy", { status: 503 })), "k", BODY, 5_000), ImageError);
  assertEquals([bare.status, bare.kind], [503, "http"]);
  // جواب نموذج بلا صورة: فُوتر، فتبقى تكلفته وسببه للسجل
  const textOnly = await assertRejects(() =>
    enhanceImage(once({ provider: "Google", choices: [{ finish_reason: "stop", native_finish_reason: "IMAGE_SAFETY", message: { content: "no" } }], usage: { cost: 0.02 } }), "k", BODY, 5_000), ImageError);
  assertEquals([textOnly.status, textOnly.kind, textOnly.costUsd, textOnly.provider], [200, "format", 0.02, "Google"]);
  assertStringIncludes(textOnly.message, "IMAGE_SAFETY");
});

const hanging: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The signal has been aborted", "AbortError")));
  });

Deno.test("enhanceImage: our timeout aborts the call and throws a timeout without a status; a dropped connection is a network error", async () => {
  const started = Date.now();
  const timeout = await assertRejects(() => enhanceImage(hanging, "k", BODY, 30), ImageError);
  assertEquals([timeout.status, timeout.kind], [null, "timeout"]);
  assert(Date.now() - started < 2_000);
  const dropped = await assertRejects(() => enhanceImage(() => Promise.reject(new TypeError("connection reset")), "k", BODY, 5_000), ImageError);
  assertEquals([dropped.status, dropped.kind], [null, "network"]);
});

/* ===================== الفحص ===================== */

const ORIGINAL: Inline = { mime: "image/jpeg", base64: encodeBase64(jpeg(1)) };
const IMPROVED: Inline = { mime: "image/png", base64: encodeBase64(png(2752, 1536)) };
const PASS = { same_subject: true, signs_or_text_changed: false, cropped_or_extended: false, issues: [] };

Deno.test("qaRequest through chat(): the general tier at the minimum reasoning, a strict schema, the original then the enhanced image", async () => {
  assertEquals(GENERAL.model, "anthropic/claude-opus-5.5");
  assertEquals(qaTier(GENERAL), { ...GENERAL, reasoning: { max_tokens: 1024 } });
  const seen: { url: string; body: Body }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)) });
    return Promise.resolve(reply({
      provider: "Anthropic", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(PASS) } }],
      usage: { prompt_tokens: 9200, completion_tokens: 420, cost: 0.0452, completion_tokens_details: { reasoning_tokens: 310 } },
    }));
  }) as unknown as typeof fetch;
  const res = await chat({ ...qaRequest(GENERAL, "sk-test", ORIGINAL, IMPROVED, 5_000), fetchImpl });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, "https://openrouter.ai/api/v1/chat/completions");
  const body = seen[0].body;
  assertEquals(body.model, "anthropic/claude-opus-5.5");
  // Opus 5.5 لا يقبل إطفاء التفكير: أقل ميزانية، والناتج نحو 800 فوقها
  assertEquals(body.reasoning, { max_tokens: 1024 });
  assertEquals(body.max_tokens, 800 + 1024);
  assertEquals(body.response_format, { type: "json_schema", json_schema: { name: "fidelity", strict: true, schema: QA_SCHEMA } });
  assertEquals(body.provider, GENERAL.provider);
  assertEquals(body.messages[0], { role: "system", content: QA_SYSTEM_PROMPT } as unknown as Body["messages"][0]);
  const parts = body.messages[1].content;
  assertEquals(parts.map((p) => p.type), ["text", "image_url", "text", "text", "image_url", "text", "text"]);
  assertStringIncludes(parts[0].text!, `<source id="original" kind="image">`);
  assertEquals(parts[1].image_url!.url, `data:image/jpeg;base64,${ORIGINAL.base64}`);
  assertStringIncludes(parts[3].text!, `<source id="enhanced" kind="image">`);
  assertEquals(parts[4].image_url!.url, `data:image/png;base64,${IMPROVED.base64}`);
  assertEquals([parts[2].text, parts[5].text], ["</source>", "</source>"]);
  assertEquals(qaVerdict(res), PASS);
  assertEquals([res.usage.costUsd, res.usage.reasoning, res.provider], [0.0452, 310, "Anthropic"]);
  for (const words of ["fidelity auditor", "real-estate brochure", "When unsure, fail", "letter by letter", "golden hour", "licence plates", "untrusted data"]) {
    assertStringIncludes(QA_SYSTEM_PROMPT, words);
  }
  assertEquals(QA_SCHEMA.required, ["same_subject", "signs_or_text_changed", "cropped_or_extended", "issues"]);
  assertEquals(QA_SCHEMA.additionalProperties, false);
});

Deno.test("qaRequest through chat(): our timeout is a ChatError timeout without a status", async () => {
  const err = await assertRejects(() => chat({ ...qaRequest(GENERAL, "k", ORIGINAL, IMPROVED, 30), fetchImpl: hanging as unknown as typeof fetch }), ChatError);
  assertEquals([err.kind, err.status], ["timeout", null]);
});

Deno.test("qaVerdict and qaPasses: kept only for the same subject, unchanged signs and the same framing; unreadable answers are null", () => {
  const verdict = (v: unknown, finishReason: string | null = "stop") => qaVerdict({ text: typeof v === "string" ? v : JSON.stringify(v), finishReason });
  assertEquals(verdict(PASS), PASS);
  assert(qaPasses(verdict(PASS)!));
  assert(!qaPasses(verdict({ ...PASS, signs_or_text_changed: true })!));
  assert(!qaPasses(verdict({ ...PASS, same_subject: false })!));
  assert(!qaPasses(verdict({ ...PASS, cropped_or_extended: true })!));
  // ملاحظات نظيفة قصيرة، وأسوار ```json تُزال
  assertEquals(verdict("```json\n" + JSON.stringify({ ...PASS, issues: ["  sign   rewritten ", 7, ""] }) + "\n```")!.issues, ["sign rewritten"]);
  assertEquals(verdict({ ...PASS, issues: "x" })!.issues, []);
  for (const bad of ["not json", JSON.stringify({ ...PASS, same_subject: "yes" }), JSON.stringify({ issues: [] }), "null", "[]"]) {
    assertEquals(verdict(bad), null, bad);
  }
  assertEquals(verdict(PASS, "length"), null);
});

/* ===================== التشغيل ===================== */

// رقم الصورة الأصلية من بايتها الأخير (الأصل المزيّف jpeg، والمحسّنة png بالرقم نفسه)
const lastByte = (base64: string) => decodeBase64(base64).at(-1)!;
const sourceOf = (body: Record<string, unknown>) => lastByte((body as Body).messages[0].content[1].image_url!.url.split(",")[1]);
const verdictResult = (v: unknown, cost: number | null = 0.045): ChatResult => ({
  text: typeof v === "string" ? v : JSON.stringify(v), finishReason: "stop",
  usage: { prompt: 9200, completion: 420, reasoning: 310, costUsd: cost }, jsonMode: "json_schema", provider: "Anthropic",
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// بروشور فيه غلاف (img-01، 16:9) وصفحات صور فيها count صورة داخلية طويلة (img-02…، 9:16) ثلاثاً ثلاثاً، وغلاف خلفي بلا صورة
function rig(count: number, over: Partial<EnhanceDeps> = {}) {
  const inner = Array.from({ length: count }, (_, j) => j + 2);
  const at = (j: number): [number, number] => [2 + Math.floor(j / 3), (j % 3) + 1];
  const media = { version: 2, images: [shot(1, [[1, 1]]), ...inner.map((k, j) => shot(k, [at(j)], { tall: true, w: 900, h: 1600 }))] };
  const photoPages = Array.from({ length: Math.ceil(count / 3) }, (_, p) =>
    page(2 + p, "photos", inner.slice(p * 3, p * 3 + 3).map((_k, n) => [n + 1, "interior"] as [number, string])));
  const result = reading(page(1, "cover", [[1, "exterior"]]), ...photoPages, page(2 + photoPages.length, "contact"));
  const events: string[] = [];
  const calls: { k: number; body: Record<string, unknown>; timeoutMs: number }[] = [];
  const audits: { k: number; original: Inline; enhanced: Inline; timeoutMs: number }[] = [];
  const uploads: { path: string; type: string; bytes: Uint8Array }[] = [];
  const logs: HeroCall[] = [];
  const notes: string[] = [];
  const good = (k: number): Enhanced => ({
    mime: "image/png", base64: encodeBase64(png(2752, 1536, k)), costUsd: 0.139, provider: "Google", ms: 5, tokens: { prompt: 1290, completion: 1120 },
  });
  const deps: EnhanceDeps = {
    requestId: ID, model: MODEL, costBound: 0.15, deadline: Date.now() + 30_000,
    limits: { minLeftMs: 1_000, callMarginMs: 1_000, callMinMs: 1_000, qaMinMs: 1_000, stopMarginMs: 500 },
    readMedia: () => Promise.resolve(media),
    budget: () => Promise.resolve({ spent_usd: 0, usd_cap: 10 }),
    save: () => {
      events.push("save");
      return Promise.resolve(true);
    },
    download: (path) => {
      const k = Number(/img-(\d+)/.exec(path)![1]);
      return Promise.resolve(k === 1 ? jpeg(k) : jpeg(k, 900, 1600));
    },
    upload: (path, bytes, type) => {
      events.push(`upload ${path.split("/").pop()}`);
      uploads.push({ path, type, bytes });
      return Promise.resolve(`https://cdn.example/${path}`);
    },
    call: (body, timeoutMs) => {
      const k = sourceOf(body);
      events.push(`call ${k}`);
      calls.push({ k, body, timeoutMs });
      return Promise.resolve(good(k));
    },
    audit: (original, enhanced, timeoutMs) => {
      const k = lastByte(original.base64);
      events.push(`audit ${k}`);
      audits.push({ k, original, enhanced, timeoutMs });
      return Promise.resolve(verdictResult(PASS));
    },
    log: (c) => {
      events.push(`log ${c.kind}`);
      logs.push(c);
      return Promise.resolve();
    },
    note: (m) => notes.push(m),
    ...over,
  };
  return { deps, result, events, calls, audits, uploads, logs, notes, good };
}
const url = (k: number) => `https://cdn.example/brochures/${ID}/enh-${String(k).padStart(2, "0")}.png`;

Deno.test("enhanceHeroes: save, then each image is called, logged, checked against its original and logged, and only then uploaded", async () => {
  const r = rig(0);
  const done = await enhanceHeroes(r.result, r.deps);
  assertEquals(done, { enhanced: { "0": url(1) }, notes: [] });
  assertEquals(r.events, ["save", "call 1", "log image", "audit 1", "log qa", "upload enh-01.png"]);
  assertEquals(r.uploads[0].type, "image/png");
  assertEquals(r.uploads[0].bytes, png(2752, 1536, 1));
  // الأصل المرسل للفحص هو نفسه المرسل للتحسين، والمحسّنة كما عادت
  assertEquals(r.audits[0].original, { mime: "image/jpeg", base64: encodeBase64(jpeg(1)) });
  assertEquals(r.audits[0].enhanced.base64, encodeBase64(png(2752, 1536, 1)));
  assert(r.audits[0].timeoutMs <= 45_000 && r.audits[0].timeoutMs >= 1_000);
  const [image, qa] = r.logs;
  assertEquals(image, { kind: "image", outcome: "ok", failure: null, provider: "Google", error: null, costUsd: 0.139, tokens: { prompt: 1290, completion: 1120, reasoning: 0 } });
  assertEquals([qa.kind, qa.outcome, qa.failure, qa.provider, qa.costUsd], ["qa", "ok", null, "Anthropic", 0.045]);
  assertEquals(qa.tokens, { prompt: 9200, completion: 420, reasoning: 310 });
  assertEquals(qa.error, "qa img-01.jpg: pass");
});

Deno.test("enhanceHeroes: each call asks for the source's own ratio in 2K, with a timeout that leaves room for the check", async () => {
  const r = rig(1);
  const done = await enhanceHeroes(r.result, r.deps);
  assertEquals(done.enhanced, { "0": url(1), "1": url(2) });
  const config = (k: number) => r.calls.find((c) => c.k === k)!.body.image_config;
  assertEquals([config(1), config(2)], [{ aspect_ratio: "16:9", image_size: "2K" }, { aspect_ratio: "9:16", image_size: "2K" }]);
  assert(r.calls.every((c) => c.body.model === MODEL && (c.body.provider as { data_collection: string }).data_collection === "deny"));
  // 30 ث باقية: النداء يترك هامش الفحص (1 ث) والرفع (1 ث)
  assert(r.calls.every((c) => c.timeoutMs <= 28_000 && c.timeoutMs > 25_000));
  // صورة بلا أبعاد في ترويستها: أبعاد media.json (1600×900)
  const headerless = rig(0, { download: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1])) });
  await enhanceHeroes(headerless.result, headerless.deps);
  assertEquals(headerless.calls[0].body.image_config, { aspect_ratio: "16:9", image_size: "2K" });
});

Deno.test("enhanceHeroes: the fidelity check keeps only faithful images; rejected, unreadable and timed-out checks keep the original", async () => {
  const r = rig(5);
  r.deps.audit = (original, enhanced, timeoutMs) => {
    const k = lastByte(original.base64);
    r.audits.push({ k, original, enhanced, timeoutMs });
    if (k === 2) return Promise.resolve(verdictResult({ ...PASS, signs_or_text_changed: true, issues: ["the developer sign reads SERIN in the original and SFRIM here"] }));
    if (k === 3) return Promise.resolve(verdictResult({ ...PASS, same_subject: false, issues: ["a person was added"] }));
    if (k === 4) return Promise.resolve(verdictResult({ ...PASS, cropped_or_extended: true }));
    if (k === 5) return Promise.resolve(verdictResult("I think it looks fine", null));
    if (k === 6) return Promise.reject(new ChatError("timeout", "timeout", null, true));
    return Promise.resolve(verdictResult(PASS));
  };
  const done = await enhanceHeroes(r.result, r.deps);
  assertEquals(done.enhanced, { "0": url(1) });
  assertEquals(r.uploads.map((u) => u.path), [`brochures/${ID}/enh-01.png`]);
  assertEquals(r.audits.length, 6);
  const qa = (name: string) => r.logs.find((l) => l.kind === "qa" && (l.error ?? "").startsWith(`qa ${name}:`))!;
  assertEquals(r.logs.filter((l) => l.kind === "image").length, 6);
  assertEquals([qa("img-02.jpg").outcome, qa("img-02.jpg").failure, qa("img-02.jpg").costUsd], ["ok", null, 0.045]);
  assertStringIncludes(qa("img-02.jpg").error!, "reject (signs_or_text_changed)");
  assertStringIncludes(qa("img-02.jpg").error!, "SERIN");
  assertStringIncludes(qa("img-03.jpg").error!, "reject (different_subject)");
  assertStringIncludes(qa("img-04.jpg").error!, "reject (cropped_or_extended)");
  // جواب لا يُقرأ: invalid بصنف format، وتكلفته تقديرية لأن المزوّد لم يذكرها
  assertEquals([qa("img-05.jpg").outcome, qa("img-05.jpg").failure, qa("img-05.jpg").costUsd], ["invalid", "format", 0.05]);
  assertStringIncludes(qa("img-05.jpg").error!, "qa img-05.jpg: parse — تكلفة تقديرية");
  // مهلتنا: خطأ بتكلفة تقديرية
  assertEquals([qa("img-06.jpg").outcome, qa("img-06.jpg").failure, qa("img-06.jpg").costUsd], ["error", null, 0.05]);
  assertStringIncludes(qa("img-06.jpg").error!, "تكلفة تقديرية");
  assertEquals(done.notes, [
    "رُفضت صورة محسّنة واحدة لأن التحسين غيّر لافتة أو شعاراً أو كتابة، فبقيت الصورة الأصلية.",
    "رُفضت صورة محسّنة واحدة لأن التحسين غيّر شيئاً في المشهد نفسه، فبقيت الصورة الأصلية.",
    "رُفضت صورة محسّنة واحدة لأن التحسين قصّ الصورة أو مدّها خارج حدودها، فبقيت الصورة الأصلية.",
    "لم تُستعمل صورتان محسّنتان لأن فحصها بنموذج القراءة تعذّر، فبقيت الصورتان الأصليتان.",
  ]);
});

Deno.test("enhanceHeroes: failed image calls are logged with their cost; a lost upload only adds a note; unusable sources are skipped", async () => {
  const r = rig(5);
  r.deps.call = (body, timeoutMs) => {
    const k = sourceOf(body);
    r.calls.push({ k, body, timeoutMs });
    if (k === 2) return Promise.reject(new ImageError("Rate limit exceeded", 429, "http", "Google"));
    if (k === 3) return Promise.reject(new ImageError("no image in the answer (stop/IMAGE_SAFETY)", 200, "format", "Google", 0.02));
    if (k === 4) return Promise.reject(new ImageError("timeout after 52000 ms", null, "timeout"));
    if (k === 5) return Promise.reject(new Error("socket hang up"));
    return Promise.resolve(r.good(k));
  };
  const upload = r.deps.upload;
  r.deps.upload = (path, bytes, type) => path.endsWith("enh-06.png") ? Promise.reject(new Error("Payload too large")) : upload(path, bytes, type);
  const done = await enhanceHeroes(r.result, r.deps);
  assertEquals(done.enhanced, { "0": url(1) });
  const by = (needle: string) => r.logs.find((l) => (l.error ?? "").includes(needle))!;
  assertEquals([by("429").outcome, by("429").failure, by("429").costUsd], ["error", null, null]);
  assertEquals([by("IMAGE_SAFETY").outcome, by("IMAGE_SAFETY").failure, by("IMAGE_SAFETY").costUsd], ["invalid", "format", 0.02]);
  assertEquals([by("timeout").outcome, by("timeout").costUsd], ["error", 0.15]);
  assertStringIncludes(by("timeout").error!, "تكلفة تقديرية");
  assertEquals([by("socket").outcome, by("socket").costUsd], ["error", null]);
  // الصورتان اللتان عادتا (1 و6): سطر صورة وسطر فحص لكل منهما، ولا سطر للرفع الفاشل
  assertEquals(r.logs.filter((l) => l.outcome === "ok").map((l) => l.kind).sort(), ["image", "image", "qa", "qa"]);
  assertEquals(r.logs.length, 8);
  assert(!r.logs.some((l) => (l.error ?? "").includes("Payload")));
  assert(r.notes.some((n) => n.includes("enh-06.png") && n.includes("Payload too large")));
  assertEquals(done.notes, [
    "لم تُحفظ صورة محسّنة واحدة في المخزن، فبقيت الصورة الأصلية.",
    "لم تُحسَّن 4 صور لخطأ من خدمة الصور، فبقيت الصور الأصلية.",
  ]);

  // أصل لا يُقرأ من المخزن، وملف ليس صورة، وأصل أكبر من 3 ميغابايت: لا نداء ولا سطر سجل
  const big = jpeg(3);
  const huge = new Uint8Array(3 * 1024 * 1024 + 1);
  huge.set(big.slice(0, -1));
  const s = rig(2, {
    download: (path) =>
      path.endsWith("img-01.jpg") ? Promise.reject(new Error("Object not found"))
      : path.endsWith("img-02.jpg") ? Promise.resolve(new TextEncoder().encode("<html>"))
      : Promise.resolve(huge),
  });
  const skipped = await enhanceHeroes(s.result, s.deps);
  assertEquals(skipped.enhanced, {});
  assertEquals([s.calls.length, s.logs.length], [0, 0]);
  assert(s.notes.some((n) => n.includes("img-01.jpg") && n.includes("Object not found")));
  assert(s.notes.some((n) => n.includes("img-02.jpg") && n.includes("not an image")));
  assert(s.notes.some((n) => n.includes("img-03.jpg") && n.includes("larger than 3145728 bytes")));
  assertEquals(skipped.notes, ["لم تُحسَّن 3 صور (ملف لا يُقرأ أو أكبر من 3 ميغابايت)، فبقيت الصور الأصلية."]);
});

Deno.test("enhanceHeroes: at most 3 images are in flight at once, and every planned image still runs", async () => {
  let active = 0;
  let peak = 0;
  const r = rig(5);
  const download = r.deps.download;
  r.deps.download = (path) => {
    active++;
    peak = Math.max(peak, active);
    return download(path);
  };
  const call = r.deps.call;
  r.deps.call = async (body, timeoutMs) => {
    await wait(10);
    return call(body, timeoutMs);
  };
  const upload = r.deps.upload;
  r.deps.upload = async (path, bytes, type) => {
    await wait(5);
    active--;
    return upload(path, bytes, type);
  };
  const done = await enhanceHeroes(r.result, r.deps);
  assertEquals(Object.keys(done.enhanced).length, 6);
  assertEquals(peak, 3);
  assertEquals(r.calls.length, 6);
  // بحد ست صور: صورة سابعة تُترك
  const seven = rig(6);
  assertEquals(Object.keys((await enhanceHeroes(seven.result, seven.deps)).enhanced), ["0", "1", "2", "3", "4", "5"]);
  assertEquals(seven.calls.length, 6);
});

Deno.test("enhanceHeroes: images and checks fit what is left of the daily cap after a reserve of max(0.5, a quarter of the cap)", async () => {
  const fits = async (spent_usd: number, usd_cap: number, over: Partial<EnhanceDeps> = {}) => {
    const r = rig(5, { budget: () => Promise.resolve({ spent_usd, usd_cap }), ...over });
    const done = await enhanceHeroes(r.result, r.deps);
    return { r, done, called: r.calls.map((c) => c.k).sort((a, b) => a - b) };
  };
  // 2 − 0.4 − 0.5 = 1.1 ← خمس صور بـ 0.15 + 0.05
  const five = await fits(0.4, 2);
  assertEquals(five.called, [1, 2, 3, 4, 5]);
  assert(five.r.notes.some((n) => n.includes("daily cap: 5 of 6")));
  assertEquals(five.done.notes, ["لم تُحسَّن صورة واحدة لأن ما بقي من سقف الإنفاق اليومي لا يكفي، فبقيت الصورة الأصلية."]);
  // 10 − 7 − 2.5 = 0.5 ← صورتان (الاحتياطي ربع السقف)
  assertEquals((await fits(7, 10)).called, [1, 2]);
  // 2 − 0.5 − 0.5 = 1 ← خمس بالضبط
  assertEquals((await fits(0.5, 2)).called, [1, 2, 3, 4, 5]);
  // تقدير أعلى للصورة وفحصها: 2 − 0 − 0.5 = 1.5 ← ثلاث بـ 0.3 + 0.1
  assertEquals((await fits(0, 2, { costBound: 0.3, qaCostBound: 0.1 })).called, [1, 2, 3]);
  // 2 − 1.4 − 0.5 = 0.1 ← لا شيء، ولا تُحفظ القراءة لتحسين لن يبدأ
  const none = await fits(1.4, 2);
  assertEquals([none.called.length, none.r.events.includes("save")], [0, false]);
  assertEquals(none.done, { enhanced: {}, notes: ["لم تُحسَّن 6 صور لأن ما بقي من سقف الإنفاق اليومي لا يكفي، فبقيت الصور الأصلية."] });
  // السقف بلغ حدّه (checkBudget يرمي)
  const reached = await fits(0, 2, { budget: () => Promise.reject(new Error("بلغ إنفاق المساعد اليوم سقفه")) });
  assertEquals([reached.called.length, reached.r.logs.length], [0, 0]);
  assert(reached.r.notes.some((n) => n.includes("budget:")));
});

Deno.test("enhanceHeroes: work that outlives the run is left behind, nothing new starts after the stop, and too little time skips it all", async () => {
  const r = rig(2, {
    deadline: Date.now() + 400,
    limits: { minLeftMs: 100, callMarginMs: 0, callMinMs: 1, qaMinMs: 1, stopMarginMs: 150 },
  });
  const upload = r.deps.upload;
  // رفعٌ عالق، وصورة تصل من المخزن بعد الموعد
  r.deps.upload = (path, bytes, type) => path.endsWith("enh-02.png") ? new Promise<string>(() => {}) : upload(path, bytes, type);
  const download = r.deps.download;
  r.deps.download = async (path) => {
    if (path.endsWith("img-03.jpg")) await wait(330);
    return download(path);
  };
  const started = Date.now();
  const done = await enhanceHeroes(r.result, r.deps);
  const took = Date.now() - started;
  assertEquals(done.enhanced, { "0": url(1) });
  assert(took >= 150 && took < 1_000, `took ${took} ms`);
  await wait(250); // تصل الصورة المتأخرة بعد الموعد: لا نداء لها
  assertEquals(r.calls.map((c) => c.k).sort(), [1, 2]);
  assert(r.notes.some((n) => n.includes("img-03.jpg") && n.includes("no time")));
  assertEquals(done.notes, ["لم تُحسَّن صورتان لانتهاء وقت التشغيل، فبقيت الصورتان الأصليتان."]);

  // أقل من 45 ثانية باقية: لا حفظ ولا نداء
  const late = rig(2, { deadline: Date.now() + 40_000, limits: {} });
  const skipped = await enhanceHeroes(late.result, late.deps);
  assertEquals([late.calls.length, late.events.includes("save")], [0, false]);
  assertEquals(skipped.notes, ["لم تُحسَّن 3 صور لانتهاء وقت التشغيل، فبقيت الصور الأصلية."]);
});

Deno.test("enhanceHeroes: the paid reading is saved once before the first paid call; a cancelled request or a failed save improves nothing", async () => {
  const r = rig(2);
  await enhanceHeroes(r.result, r.deps);
  assertEquals(r.events.filter((e) => e === "save").length, 1);
  assertEquals(r.events[0], "save");

  const cancelled = rig(2, { save: () => Promise.resolve(false) });
  assertEquals(await enhanceHeroes(cancelled.result, cancelled.deps), { enhanced: {}, notes: [] });
  assertEquals([cancelled.calls.length, cancelled.logs.length], [0, 0]);

  const broken = rig(2, { save: () => Promise.reject(new Error("connection lost")) });
  assertEquals(await enhanceHeroes(broken.result, broken.deps), { enhanced: {}, notes: [ENHANCE_SAVE_FAILED_AR] });
  assertEquals(broken.calls.length, 0);

  // لا صورة تُحسَّن، أو لا media.json: لا حفظ ولا نداء ولا ملاحظة للمدير
  const nothing = rig(0, { readMedia: () => Promise.resolve({ images: [] }) });
  assertEquals(await enhanceHeroes(nothing.result, nothing.deps), { enhanced: {}, notes: [] });
  assertEquals(nothing.events, []);
  const missing = rig(2, { readMedia: () => Promise.reject(new Error("Object not found")) });
  assertEquals(await enhanceHeroes(missing.result, missing.deps), { enhanced: {}, notes: [] });
  assert(missing.notes.some((n) => n.includes("media.json")));
  assertEquals(missing.events, []);
});

/* ===================== القراءة المحفوظة والاستئناف ===================== */

const GROUPS: BrochureGroup[] = [{ first: 1, project: { name: "سيرين" }, pages: [page(1, "cover", [[1, "exterior"]]) as unknown as BrochurePage], dropped: 0 }];

Deno.test("enhancingRecord and savedReading: a run that stopped while enhancing is resumed as finished reading with no new reading", () => {
  const record = enhancingRecord(GROUPS);
  assertEquals(record, { version: 2, partial: true, groups: GROUPS, enhancing: true });
  assertEquals(savedReading(JSON.parse(JSON.stringify(record))), { groups: GROUPS, interrupted: true });
  // قراءة جزئية عادية: تُكمل الدورة التالية الباقي
  assertEquals(savedReading({ version: 2, partial: true, groups: GROUPS }), { groups: GROUPS, interrupted: false });
  for (const none of [null, undefined, {}, { version: 2, pages: [] }, { partial: true, groups: "x", enhancing: true }]) {
    assertEquals(savedReading(none), { groups: [], interrupted: false });
  }
});

Deno.test("finishReading: interrupted finishes with the original photos and a note and never enhances; plain stays as read; errors never fail it", async () => {
  const result = reading(page(1, "cover", [[1, "exterior"]]));
  let runs = 0;
  const run = () => {
    runs++;
    return Promise.resolve({ enhanced: { "0": url(1) }, notes: ["ملاحظة"] });
  };
  const interrupted = await finishReading(result, "interrupted", run);
  assertEquals(interrupted, { ...result, enhance_notes: [ENHANCE_INTERRUPTED_AR] });
  assert(!("enhanced" in interrupted));
  assertEquals(await finishReading(result, "plain", run), result);
  assertEquals(runs, 0);
  assertEquals(await finishReading(result, "enhance", run), { ...result, enhanced: { "0": url(1) }, enhance_notes: ["ملاحظة"] });
  assertEquals(runs, 1);
  const logged: string[] = [];
  assertEquals(await finishReading(result, "enhance", () => Promise.reject(new Error("boom")), (m) => logged.push(m)), result);
  assertStringIncludes(logged[0], "boom");
  // لا مفاتيح فارغة في result
  assertEquals(withEnhancement(result, { enhanced: {}, notes: [] }), result);
});

Deno.test("enhanceNotes: Arabic notes for the admin, counted, every one keeping the original", () => {
  assertEquals(enhanceNotes(["done", "done"]), []);
  assertEquals(enhanceNotes(["text"]), ["رُفضت صورة محسّنة واحدة لأن التحسين غيّر لافتة أو شعاراً أو كتابة، فبقيت الصورة الأصلية."]);
  assertEquals(enhanceNotes(["text", "text", "subject", "late", "late", "late"]), [
    "رُفضت صورتان محسّنتان لأن التحسين غيّر لافتة أو شعاراً أو كتابة، فبقيت الصورتان الأصليتان.",
    "رُفضت صورة محسّنة واحدة لأن التحسين غيّر شيئاً في المشهد نفسه، فبقيت الصورة الأصلية.",
    "لم تُحسَّن 3 صور لانتهاء وقت التشغيل، فبقيت الصور الأصلية.",
  ]);
  assertEquals(enhanceNotes(Array(11).fill("capped")), ["لم تُحسَّن 11 صورة لأن ما بقي من سقف الإنفاق اليومي لا يكفي، فبقيت الصور الأصلية."]);
});
