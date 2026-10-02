// اختبارات فتح الروابط بلا شبكة: حارس الرابط، ومحلّل الأسماء، وrobots.txt، وتحويل HTML إلى نص، والجلب بمزوّد مزيّف.
// التشغيل: deno test supabase/functions/agent-run/
import { assert, assertEquals, assertFalse, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import {
  decodeEntities, type Fetch, fetchUrlSource, guardUrl, htmlToText, MAX_HTML_BYTES, MAX_PAGE_CHARS, pageTitle, robotsAllows, UrlError,
  USER_AGENT,
} from "./fetch.ts";

const publicDns = () => Promise.resolve(["203.0.113.10"]);

/* ===================== الرابط ===================== */

Deno.test("guardUrl: public http(s) links pass; the fragment and a trailing dot in the host are dropped", () => {
  assertEquals(guardUrl("https://example.com/p?x=1#top"), "https://example.com/p?x=1");
  assertEquals(guardUrl("  http://aqar.example.sa/ad/123 "), "http://aqar.example.sa/ad/123");
  assertEquals(guardUrl("https://Example.COM./p"), "https://example.com/p");
});

Deno.test("guardUrl: local, private and reserved addresses are refused before any connection", () => {
  const bad = [
    "ftp://example.com/x", "javascript:alert(1)", "https://user:pw@example.com/", "https://example.com:8443/", "http://example.com:443/",
    "http://localhost/", "http://localhost./", "http://intranet/", "http://db.internal/", "http://db.internal./", "http://printer.local/",
    "https://niykzsspdehexphewlxa.supabase.co/rest/v1/", "https://x.supabase.co./rest/v1/",
    "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.1.1/", "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data",
    "http://0x7f.0.0.1/", "http://2130706433/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[::ffff:10.0.0.1]/",
    "http://100.64.0.1/", "http://224.0.0.1/", "http://./", "",
  ];
  for (const url of bad) assertThrows(() => guardUrl(url), UrlError, undefined, url);
});

/* ===================== robots.txt ===================== */

const ROBOTS = `
User-agent: *
Disallow: /private/
Disallow: /ads/*/print
Allow: /private/public-note

User-agent: MulaemAssistant
Disallow: /only-for-us/

User-agent: OtherBot
Disallow: /
`;

Deno.test("robots: our own group wins over *, longest match wins, Allow beats Disallow on a tie", () => {
  assert(robotsAllows(ROBOTS, "/only-for-us/x") === false);
  assert(robotsAllows(ROBOTS, "/private/x")); // مجموعتنا لا تمنعها، ومجموعة * لا تُطبَّق معها
  assertFalse(robotsAllows(ROBOTS, "/only-for-us/"));
  assert(robotsAllows(ROBOTS, "/"));
  // بلا مجموعة خاصة بنا: مجموعة *
  const star = ROBOTS.replace(/User-agent: MulaemAssistant\nDisallow: \/only-for-us\/\n/, "");
  assertFalse(robotsAllows(star, "/private/x"));
  assert(robotsAllows(star, "/private/public-note"));
  assertFalse(robotsAllows(star, "/ads/12/print"));
  assert(robotsAllows(star, "/ads/12"));
  assert(robotsAllows(star, "/only-for-us/x"));
  // اسم الوكيل في الملف بادئة لاسمنا (كما تفعل المحركات)؛ اسم آخر لا يلتقطنا
  assertFalse(robotsAllows("User-agent: mulaem\nDisallow: /\n", "/x"));
  assert(robotsAllows("User-agent: mulaemassistant-images\nDisallow: /\n", "/x"));
});

Deno.test("robots: no file, empty Disallow, comments and anchors", () => {
  assert(robotsAllows("", "/anything"));
  assert(robotsAllows("User-agent: *\nDisallow:\n", "/x"));
  assertFalse(robotsAllows("User-agent: * # all\nDisallow: /x$ # exact\n", "/x"));
  assert(robotsAllows("User-agent: *\nDisallow: /x$\n", "/xy"));
  assertFalse(robotsAllows("user-agent: *\ndisallow: /\n", "/"));
});

Deno.test("robots: an Arabic path written raw in the file matches the percent-encoded pathname, whatever the hex case", () => {
  assertFalse(robotsAllows("User-agent: *\nDisallow: /عقار/\n", "/%D8%B9%D9%82%D8%A7%D8%B1/1"));
  assertFalse(robotsAllows("User-agent: *\nDisallow: /%d8%b9%d9%82%d8%a7%d8%b1/\n", "/%D8%B9%D9%82%D8%A7%D8%B1/1"));
  assert(robotsAllows("User-agent: *\nDisallow: /عقار/\n", "/%D8%A8%D9%8A%D8%AA/1"));
  assertFalse(robotsAllows("User-agent: *\nDisallow: /*/طباعة$\n", "/ad/9/%D8%B7%D8%A8%D8%A7%D8%B9%D8%A9"));
});

/* ===================== HTML ===================== */

Deno.test("entities: numeric and named, unknown ones are left alone", () => {
  assertEquals(decodeEntities("&amp;&lt;&#1601;&#x641;&nbsp;x&bogus;"), "&<فف x&bogus;");
});

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title> فيلا للبيع — حي السامر </title>
<meta name="description" content="فيلا دورين في حي السامر، 650م">
<script type="application/ld+json">{"@type":"Offer","price":"2700000","priceCurrency":"SAR","name":"&#x641;&#x64A;&#x644;&#x627;"}</script>
<style>.x{display:none}</style><script>window.__data = {price: 1}</script></head>
<body><nav><a href="/">الرئيسية</a><a href="/ads">إعلانات</a></nav>
<svg class="icon" viewBox="0 0 1 1"/><h1>فيلا للبيع في حي السامر</h1><p>السعر <b>2,700,000</b>&nbsp;ريال</p>
<table><tr><th>المساحة</th><td>650 م²</td></tr><tr><th>الغرف</th><td>5</td></tr></table>
<ul><li>مسبح</li><li>مصعد</li></ul><!-- تعليق --><select><option>الكل</option></select>
<aside>سعر المتر 4,150 ريال</aside><footer>جوال المكتب [PHONE]</footer></body></html>`;

Deno.test("htmlToText: scripts and styles go; headings, cells, lists, side boxes and footers stay readable", () => {
  const text = htmlToText(PAGE);
  assertStringIncludes(text, "الوصف: فيلا دورين في حي السامر، 650م");
  assertStringIncludes(text, '"price": "2700000"');
  assertStringIncludes(text, '"name": "فيلا"'); // كيانات داخل JSON-LD تُفك
  assertStringIncludes(text, "فيلا للبيع في حي السامر");
  assertStringIncludes(text, "السعر 2,700,000 ريال");
  assertStringIncludes(text, "المساحة | 650 م²");
  assertStringIncludes(text, "مسبح\nمصعد");
  assertStringIncludes(text, "سعر المتر 4,150 ريال"); // صندوق جانبي لا يُحذف
  assertStringIncludes(text, "جوال المكتب"); // ولا التذييل
  assertStringIncludes(text, "الرئيسية"); // القوائم تبقى نصاً عادياً
  assertFalse(text.includes("window.__data"));
  assertFalse(text.includes("display:none"));
  assertFalse(text.includes("الكل"));
  assertFalse(text.includes("تعليق"));
  assertFalse(/\n\n/.test(text.slice(text.indexOf("فيلا للبيع في حي السامر")))); // سطر لكل عنصر، بلا أسطر فارغة
  assertEquals(pageTitle(PAGE), "فيلا للبيع — حي السامر");
  assertEquals(pageTitle('<meta property="og:title" content="عنوان og">'), "عنوان og");
  assertEquals(pageTitle("<p>no title</p>"), null);
});

Deno.test("htmlToText: a self-closed <svg/> does not swallow the content after it; an inline <svg>…</svg> does go", () => {
  assertStringIncludes(htmlToText('<p>قبل</p><svg viewBox="0 0 1 1"/><p>السعر 500</p><svg><path d="M0"/></svg><p>بعد</p>'), "قبل\nالسعر 500\nبعد");
  assertFalse(htmlToText('<svg><text>مخفي</text></svg><p>ظاهر</p>').includes("مخفي"));
});

/* ===================== الجلب ===================== */

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function fake(routes: Record<string, Route>): { fetch: Fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetch = (url, init) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return Promise.resolve(new Response("nope", { status: 404 }));
    return Promise.resolve(route(url, init));
  };
  return { fetch, calls };
}

const html = (body: string, status = 200, type = "text/html; charset=utf-8") =>
  new Response(body, { status, headers: { "content-type": type } });
const CHALLENGE = '<html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div><p>Checking your browser</p></body></html>';

Deno.test("fetch: a public page is read after robots.txt, with our own user agent and no redirect following by default", async () => {
  const { fetch, calls } = fake({
    "https://site.example/robots.txt": () => new Response("User-agent: *\nDisallow: /private/\n"),
    "https://site.example/ad/1": (_u, init) => {
      assertEquals((init.headers as Record<string, string>)["User-Agent"], USER_AGENT);
      assertEquals(init.redirect, "manual");
      return html(PAGE);
    },
  });
  const page = await fetchUrlSource("https://site.example/ad/1#x", fetch, { resolve: publicDns });
  assertEquals(calls, ["https://site.example/robots.txt", "https://site.example/ad/1"]);
  assertEquals(page.kind, "text");
  assertEquals(page.title, "فيلا للبيع — حي السامر");
  assertEquals(page.finalUrl, "https://site.example/ad/1");
  assertStringIncludes(page.text!, "السعر 2,700,000 ريال");
  assertFalse(page.text!.includes("الرابط بعد التحويل"));
  assertEquals(new TextDecoder().decode(page.bytes), page.text);
});

Deno.test("fetch: a public name that resolves to a private address is refused before any request; a failing resolver does not block", async () => {
  const { fetch, calls } = fake({ "https://meta.example/p": () => html(PAGE) });
  await assertRejects(() => fetchUrlSource("https://meta.example/p", fetch, { resolve: () => Promise.resolve(["169.254.169.254"]) }), UrlError, "داخلي");
  await assertRejects(() => fetchUrlSource("https://meta.example/p", fetch, { resolve: () => Promise.resolve(["2001:db8::1", "::ffff:a00:1"]) }), UrlError, "داخلي");
  assertEquals(calls, []);
  const page = await fetchUrlSource("https://meta.example/p", fetch, { resolve: () => Promise.reject(new Error("dns down")) });
  assertEquals(page.kind, "text");
});

Deno.test("fetch: robots.txt disallow stops before the page is requested", async () => {
  const { fetch, calls } = fake({
    "https://site.example/robots.txt": () => new Response("User-agent: *\nDisallow: /ad/\n"),
    "https://site.example/ad/1": () => html(PAGE),
  });
  await assertRejects(() => fetchUrlSource("https://site.example/ad/1", fetch, { resolve: publicDns }), UrlError, "robots.txt");
  assertEquals(calls, ["https://site.example/robots.txt"]);
});

Deno.test("fetch: a missing robots.txt means no restrictions; an unreachable or rate-limited one is a transient failure", async () => {
  const ok = fake({ "https://a.example/p": () => html(PAGE) });
  assertEquals((await fetchUrlSource("https://a.example/p", ok.fetch, { resolve: publicDns })).kind, "text");
  for (const status of [503, 429]) {
    const down = fake({ "https://b.example/robots.txt": () => new Response("x", { status }), "https://b.example/p": () => html(PAGE) });
    const e = await assertRejects(() => fetchUrlSource("https://b.example/p", down.fetch, { resolve: publicDns }), UrlError);
    assert(e.retry, String(status));
    assertEquals(down.calls, ["https://b.example/robots.txt"]);
  }
});

Deno.test("fetch: robots.txt that redirects to a private address makes the site unreadable; a public redirect is followed", async () => {
  const inward = fake({
    "https://r.example/robots.txt": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/robots.txt" } }),
    "https://r.example/p": () => html(PAGE),
  });
  const e = await assertRejects(() => fetchUrlSource("https://r.example/p", inward.fetch, { resolve: publicDns }), UrlError, "robots.txt");
  assertFalse(e.retry);
  assertEquals(inward.calls, ["https://r.example/robots.txt"]);
  const moved = fake({
    "https://s.example/robots.txt": () => new Response(null, { status: 301, headers: { location: "https://cdn.example/s-robots.txt" } }),
    "https://cdn.example/s-robots.txt": () => new Response("User-agent: *\nDisallow: /p\n"),
    "https://s.example/p": () => html(PAGE),
  });
  await assertRejects(() => fetchUrlSource("https://s.example/p", moved.fetch, { resolve: publicDns }), UrlError, "robots.txt");
  assertEquals(moved.calls, ["https://s.example/robots.txt", "https://cdn.example/s-robots.txt"]);
});

Deno.test("fetch: login walls, rate limits, challenge pages and missing pages are final; plain server errors retry", async () => {
  const cases: [Response, string, boolean][] = [
    [html("x", 403), "تسجيل الدخول", false],
    [html("x", 401), "تسجيل الدخول", false],
    [html("x", 429), "429", false],
    [html("x", 404), "غير موجودة", false],
    [html("x", 502), "مؤقتاً", true],
    [html("x", 503), "مؤقتاً", true],
    [html(CHALLENGE), "تحقق", false],
    [html(CHALLENGE, 503), "تحقق", false], // تحدٍّ خلف 503: نهائي، لا يُطرق الباب ثلاث مرات
    [html(CHALLENGE, 403), "تحقق", false],
    [html(CHALLENGE, 429), "تحقق", false],
    [html("<html><body><script>app()</script></body></html>"), "بلا نص", false],
    [new Response("binary", { status: 200, headers: { "content-type": "image/png" } }), "ليس صفحة", false],
  ];
  for (const [res, needle, retry] of cases) {
    const { fetch } = fake({ "https://c.example/p": () => res });
    const e = await assertRejects(() => fetchUrlSource("https://c.example/p", fetch, { resolve: publicDns }), UrlError, needle);
    assertEquals(e.retry, retry, needle);
  }
});

Deno.test("fetch: a body that stops arriving (abort during read) is a transient failure with the Arabic timeout message", async () => {
  const stalled = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html><body><p>بداية"));
          controller.error(new DOMException("aborted", "TimeoutError"));
        },
      }),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  const { fetch } = fake({ "https://t.example/p": stalled });
  const e = await assertRejects(() => fetchUrlSource("https://t.example/p", fetch, { resolve: publicDns }), UrlError, "مهلة");
  assert(e.retry);
});

Deno.test("fetch: the whole link shares one budget — an exhausted budget stops before any request", async () => {
  const { fetch, calls } = fake({ "https://u.example/p": () => html(PAGE) });
  let t = 0;
  const now = () => t;
  const e = await assertRejects(
    () => fetchUrlSource("https://u.example/p", fetch, { resolve: publicDns, budgetMs: 1000, now: () => (t += 2000) }),
    UrlError, "مهلة",
  );
  assert(e.retry);
  assertEquals(calls, []);
  assertEquals((await fetchUrlSource("https://u.example/p", fetch, { resolve: publicDns, budgetMs: 1000, now })).kind, "text");
});

Deno.test("fetch: redirects are followed by hand, each hop guarded, resolved and checked against its own robots.txt", async () => {
  const { fetch, calls } = fake({
    "https://short.example/x": () => new Response(null, { status: 301, headers: { location: "https://long.example/ad/9" } }),
    "https://long.example/robots.txt": () => new Response("User-agent: *\nDisallow: /secret/\n"),
    "https://long.example/ad/9": () => html(PAGE),
  });
  const page = await fetchUrlSource("https://short.example/x", fetch, { resolve: publicDns });
  assertEquals(page.finalUrl, "https://long.example/ad/9");
  assert(page.text!.startsWith("الرابط بعد التحويل: https://long.example/ad/9\n\n"));
  assertEquals(calls, ["https://short.example/robots.txt", "https://short.example/x", "https://long.example/robots.txt", "https://long.example/ad/9"]);

  const inward = fake({ "https://short.example/y": () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) });
  await assertRejects(() => fetchUrlSource("https://short.example/y", inward.fetch, { resolve: publicDns }), UrlError, "داخلي");

  // الوجهة اسم عام يشير إلى عنوان داخلي
  const dns = (host: string) => Promise.resolve(host === "inner.example" ? ["10.0.0.9"] : ["203.0.113.10"]);
  const viaName = fake({
    "https://short.example/z": () => new Response(null, { status: 302, headers: { location: "https://inner.example/" } }),
    "https://inner.example/": () => html(PAGE),
  });
  await assertRejects(() => fetchUrlSource("https://short.example/z", viaName.fetch, { resolve: dns }), UrlError, "داخلي");
  assertFalse(viaName.calls.includes("https://inner.example/"));

  const loop = fake({ "https://short.example/w": () => new Response(null, { status: 302, headers: { location: "https://short.example/w" } }) });
  await assertRejects(() => fetchUrlSource("https://short.example/w", loop.fetch, { resolve: publicDns }), UrlError, "أكثر من اللازم");
});

Deno.test("fetch: a PDF link is kept as a PDF file, judged by its bytes", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 fake");
  const { fetch } = fake({
    "https://d.example/brochure": () => new Response(pdf, { status: 200, headers: { "content-type": "application/octet-stream" } }),
  });
  await assertRejects(() => fetchUrlSource("https://d.example/brochure", fetch, { resolve: publicDns }), UrlError, "ليس صفحة");
  const typed = fake({ "https://d.example/brochure.pdf": () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }) });
  const page = await fetchUrlSource("https://d.example/brochure.pdf", typed.fetch, { resolve: publicDns });
  assertEquals(page.kind, "pdf");
  assertEquals(page.bytes, pdf);
  // صفحة HTML تحمل ملف PDF فعلاً: يُحكم بالمحتوى
  const sniffed = fake({ "https://d.example/odd": () => new Response(pdf, { status: 200, headers: { "content-type": "text/html" } }) });
  assertEquals((await fetchUrlSource("https://d.example/odd", sniffed.fetch, { resolve: publicDns })).kind, "pdf");
});

Deno.test("fetch: size caps are enforced while streaming, never by silent truncation", async () => {
  const big = new Uint8Array(MAX_HTML_BYTES + 1);
  const { fetch } = fake({ "https://e.example/big": () => new Response(big, { status: 200, headers: { "content-type": "text/html" } }) });
  await assertRejects(() => fetchUrlSource("https://e.example/big", fetch, { resolve: publicDns }), UrlError, "أكبر من الحد (3 ميغابايت)");
  const long = "<p>" + "كلمة ".repeat(MAX_PAGE_CHARS / 4) + "</p>";
  const { fetch: fetch2 } = fake({ "https://e.example/long": () => html(long) });
  await assertRejects(() => fetchUrlSource("https://e.example/long", fetch2, { resolve: publicDns }), UrlError, "أطول من الحد");
});

Deno.test("fetch: plain text and windows-1256 pages decode correctly", async () => {
  const { fetch } = fake({ "https://f.example/t.txt": () => new Response("عرض فيلا في حي الصفا بسعر 900 ألف", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }) });
  const plain = await fetchUrlSource("https://f.example/t.txt", fetch, { resolve: publicDns });
  assertEquals(plain.text, "عرض فيلا في حي الصفا بسعر 900 ألف");
  assertEquals(plain.title, null);
  const cp1256 = new Uint8Array([0xc7, 0xe1, 0xd5, 0xdd, 0xc7]); // «الصفا» بترميز windows-1256
  const body = new Uint8Array([...new TextEncoder().encode("<html><head><title>x</title></head><body><p>district "), ...cp1256, ...new TextEncoder().encode(" villa for sale, new and big</p></body></html>")]);
  const legacy = fake({ "https://f.example/old": () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=windows-1256" } }) });
  const page = await fetchUrlSource("https://f.example/old", legacy.fetch, { resolve: publicDns });
  assertStringIncludes(page.text!, "الصفا");
});

Deno.test("hostile input: many wildcards in robots.txt and thousands of unclosed tags finish fast and keep the visible text", () => {
  const started = performance.now();
  const rule = `User-agent: *\nDisallow: /${"*a".repeat(40)}$\n`;
  assertFalse(robotsAllows(rule, "/" + "a".repeat(60)));
  assert(robotsAllows(rule, "/" + "a".repeat(60) + "b"));
  assertStringIncludes(htmlToText("<svg ".repeat(50_000) + "<p>السعر 500</p>"), "السعر 500");
  assertStringIncludes(htmlToText("<svg>".repeat(50_000) + "<p>ظاهر</p>"), "ظاهر");
  assertStringIncludes(htmlToText("<!-- ".repeat(50_000) + "<p>نص</p>"), "نص");
  assertStringIncludes(htmlToText("<".repeat(100_000) + "<p>آخر</p>"), "آخر");
  assertStringIncludes(htmlToText('<script type="application/ld+json">'.repeat(20_000) + "<p>ذيل</p>"), "ذيل");
  assertEquals(pageTitle("<title>".repeat(20_000) + "x"), null);
  assert(performance.now() - started < 5_000, `took ${Math.round(performance.now() - started)} ms`);
});
