// اختبار نسب «جهات التمويل» (rates.ts): الاستخراج من نص الصفحة، واختيار نسبة العقار، ومن يُفحص، والفحص بلا شبكة.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { UrlError } from "./fetch.ts";
import {
  checkRates, dueEntities, type Entity, MAX_PER_SWEEP, MIN_RATE_MS, mergeProposals, pickHomeRate, type Proposal,
  rateCandidates, STALE_DAYS,
} from "./rates.ts";

// من صفحة إعادة التمويل العقاري في مصرف الراجحي كما قرأها المساعد في 2026-10-29
const RAJHI = "إعادة التمويل العقاري\nقسط ميسر يبدأ من 400 SAR خلال فترة الإنشاء\nمعدل نسبة سنوي يبدأ من 7.75%\nراتب يبدأ من 5,000 SAR.";

Deno.test("rates: the published APR is taken from the page text with its own sentence", () => {
  const c = rateCandidates(RAJHI);
  assertEquals(c, [{ rate: 7.75, quote: "معدل نسبة سنوي يبدأ من 7.75%" }]);
  assertEquals(pickHomeRate(c).pick?.rate, 7.75);
});

Deno.test("rates: Arabic digits, the Arabic percent sign and a sign before the number all read the same", () => {
  assertEquals(rateCandidates("معدل النسبة السنوي: ٦٫٥٪ للتمويل العقاري").map((c) => c.rate), [6.5]);
  assertEquals(rateCandidates("Home finance APR from 5.25%").map((c) => c.rate), [5.25]);
  assertEquals(rateCandidates("هامش الربح السنوي يبدأ من %4.9 للمسكن").map((c) => c.rate), [4.9]);
  assertEquals(rateCandidates("8.12% معدل النسبة السنوي").map((c) => c.rate), [8.12]);
});

Deno.test("rates: no number without the phrase, and no deduction or financing percentages", () => {
  assertEquals(rateCandidates("دفعة أولى 10% ونسبة الاستقطاع 55% من الراتب"), []);
  assertEquals(rateCandidates("تمويل حتى 90% من قيمة العقار"), []);
  assertEquals(rateCandidates("معدل النسبة السنوي يظهر في العرض"), []);
  assertEquals(rateCandidates("معدل النسبة السنوي 45%"), []); // خارج المعقول
  assertEquals(rateCandidates(""), []);
});

Deno.test("rates: personal and car finance lines are set aside; real estate lines win", () => {
  const text = "التمويل الشخصي: معدل النسبة السنوي يبدأ من 9.5%\nالتمويل العقاري: معدل النسبة السنوي يبدأ من 6.25%\nتمويل السيارات APR 11%";
  const { pick, list } = pickHomeRate(rateCandidates(text));
  assertEquals(pick?.rate, 6.25);
  assertEquals(list.length, 1);
});

Deno.test("rates: two different real estate rates go to the admin to choose", () => {
  const text = "تمويل الوحدات الجاهزة: معدل النسبة السنوي 6.5%\nالبناء الذاتي للمسكن: معدل النسبة السنوي 7.1%";
  const { pick, list } = pickHomeRate(rateCandidates(text));
  assertEquals(pick, null);
  assertEquals(list.map((c) => c.rate), [6.5, 7.1]);
});

Deno.test("rates: a page with the same rate twice is one proposal, and a long sentence is cut around the phrase", () => {
  const long = "أ".repeat(400) + " معدل النسبة السنوي يبدأ من 5.5% " + "ب".repeat(400);
  const c = rateCandidates(long + "\n" + long);
  assertEquals(c.length, 1);
  assert(c[0].quote.length <= 200 && c[0].quote.includes("5.5%"), c[0].quote);
});

const DAY = 86_400_000;
const NOW = new Date("2026-10-29T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

Deno.test("rates: due = never checked, link changed, or a week old; inactive and link-less are skipped; oldest first", () => {
  const entities: Entity[] = [
    { id: "a", url: "https://a.example/p" },
    { id: "b", url: "https://b.example/new" },
    { id: "c", url: "https://c.example/p" },
    { id: "d", url: "https://d.example/p" },
    { id: "e", url: "https://e.example/p", active: false },
    { id: "f", url: null },
    { id: "g", url: "http://insecure.example/p" },
  ];
  const proposals: Record<string, Proposal> = {
    b: { checkedAt: at(1), url: "https://b.example/old" },
    c: { checkedAt: at(STALE_DAYS + 1), url: "https://c.example/p" },
    d: { checkedAt: at(1), url: "https://d.example/p" },
  };
  assertEquals(dueEntities(entities, proposals, NOW, { force: false, max: 10 }).map((e) => e.id), ["a", "c", "b"]);
  assertEquals(dueEntities(entities, proposals, NOW, { force: false, max: MAX_PER_SWEEP }).length, 2);
  assertEquals(dueEntities(entities, proposals, NOW, { force: true, max: 10 }).map((e) => e.id).sort(), ["a", "b", "c", "d"]);
  assertEquals(dueEntities(null as unknown as Entity[], {}, NOW, { force: true, max: 10 }), []);
});

Deno.test("rates: checkRates records a rate, a choice, a clear miss, a refusal and an unexpected failure", async () => {
  const pages: Record<string, string | Error> = {
    "https://one.example/": RAJHI,
    "https://two.example/": "الوحدات الجاهزة: معدل النسبة السنوي 6.5%\nالبناء الذاتي للمسكن: معدل النسبة السنوي 7.1%",
    "https://none.example/": "صفحة بلا نسب",
    "https://blocked.example/": new UrlError("هذا الموقع لا يسمح للمساعد بقراءة الصفحة (robots.txt)"),
    "https://broken.example/": new TypeError("x is undefined"),
  };
  const out = await checkRates(Object.keys(pages).map((url, i) => ({ id: "e" + i, url })), {
    fetchText: (url) => {
      const p = pages[url];
      return p instanceof Error ? Promise.reject(p) : Promise.resolve(p);
    },
    left: () => 120_000,
    now: () => NOW,
  });
  assertEquals(out.e0, { checkedAt: NOW.toISOString(), url: "https://one.example/", rate: 7.75, quote: "معدل نسبة سنوي يبدأ من 7.75%" });
  assertEquals(out.e1.candidates?.map((c) => c.rate), [6.5, 7.1]);
  assert(out.e2.error?.includes("لم أجد"), out.e2.error);
  assertEquals(out.e3.error, "هذا الموقع لا يسمح للمساعد بقراءة الصفحة (robots.txt)");
  assert(out.e4.error?.startsWith("تعذّرت قراءة الصفحة"), out.e4.error); // لا رسالة إنجليزية داخلية أمام المدير
});

Deno.test("rates: no link is started when the run is almost out of time", async () => {
  let calls = 0;
  const out = await checkRates([{ id: "a", url: "https://a.example/" }], {
    fetchText: () => { calls++; return Promise.resolve(RAJHI); },
    left: () => MIN_RATE_MS - 1,
  });
  assertEquals(calls, 0);
  assertEquals(out, {});
});

Deno.test("rates: merge keeps older proposals, replaces re-checked ones, and drops deleted entities", () => {
  const saved = { a: { checkedAt: at(3), url: "u", rate: 6 }, gone: { checkedAt: at(3), url: "u" } };
  const found = { b: { checkedAt: at(0), url: "v", rate: 7 } };
  const merged = mergeProposals(saved, found, [{ id: "a" }, { id: "b" }]);
  assertEquals(Object.keys(merged).sort(), ["a", "b"]);
  assertEquals(merged.b.rate, 7);
  assertEquals(mergeProposals([1, 2], {}, [{ id: "a" }]), {});
});
