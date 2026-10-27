// تقييم قراءة «بروشور» صفحةً صفحة (brochure.ts): الصفحة من صفحات الطلب، والأرقام في مداها، والنص بطوله، والمجموعات
// المحفوظة من دورة سابقة تُكمَّل ولا تُعاد، والصفحة الناقصة تُذكر.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { cleanGroup, evaluatePages, pageFromPath, readPages } from "./brochure.ts";

const PAGES: Record<string, number> = { S1: 1, S2: 2, S3: 3, S4: 4, S5: 5, S14: 14 };
const pageOf = (s: unknown) => (typeof s === "string" && s in PAGES ? PAGES[s] : null);
const page = (source: string, role: string, extra: Record<string, unknown> = {}) => ({
  source, role, title: null, subtitle: null, body: null, bullets: [], model: null, images: [], ...extra,
});
const project = (extra: Record<string, unknown> = {}) => ({
  name: null, name_latin: null, developer: null, city: null, district: null, tagline: null, license: null, ...extra,
});

Deno.test("brochure: a group keeps its pages in order with their printed text", () => {
  const g = cleanGroup({
    project: project({ name: " لامير   سيرين ", name_latin: "LAMER SERIN", city: "جدة" }),
    pages: [
      page("S2", "about", { title: "عن المشروع", body: "يقوم المشروع على فكرة التوازن بين الداخل والخارج.", bullets: ["دخول ذكي", "", "مواقف خاصة"] }),
      page("S1", "cover", { title: "لامير سيرين", images: [{ n: 1, role: "exterior", caption: null }] }),
    ],
  }, pageOf);
  assertEquals(g.pages.map((p) => p.page), [1, 2]);
  assertEquals(g.first, 1);
  assertEquals(g.project, { name: "لامير سيرين", name_latin: "LAMER SERIN", city: "جدة" });
  assertEquals(g.pages[1].bullets, ["دخول ذكي", "مواقف خاصة"]);
  assertEquals(g.pages[0].images, [{ n: 1, role: "exterior", caption: null }]);
});

Deno.test("brochure: unknown pages, repeated pages, bad roles and bad image numbers are dropped and counted", () => {
  const g = cleanGroup({
    project: project(),
    pages: [
      page("S9", "about"),
      page("S3", "nonsense", { images: [{ n: 0, role: "exterior" }, { n: 2, role: "selfie" }, { n: 3, role: "plan", caption: "مخطط" }, { n: 3, role: "plan" }] }),
      page("S3", "photos"),
    ],
  }, pageOf);
  assertEquals(g.pages.length, 1);
  assertEquals(g.pages[0].role, "other");
  assertEquals(g.pages[0].images, [{ n: 3, role: "plan", caption: "مخطط" }]);
  assertEquals(g.dropped, 5);
});

Deno.test("brochure: a model page keeps its numbers in range; other pages carry no model", () => {
  const g = cleanGroup({
    project: project(),
    pages: [
      page("S14", "model", {
        model: { name: "شقة 1", type: null, orientation: "داخلية شمالي", rooms: 2, bathrooms: 99, area: 97, price: 639000, sold: false, parts: ["غرفة نوم ماستر", "مطبخ"], plan_label: "نموذج شقة (1) مساحتها : 97 م2" },
      }),
      page("S4", "about", { model: { name: "شقة 9", type: null, orientation: null, rooms: 1, bathrooms: 1, area: 50, price: 100000, sold: false, parts: [], plan_label: null } }),
      page("S5", "model", { model: { name: null, type: null, orientation: null, rooms: null, bathrooms: null, area: 3, price: 5, sold: true, parts: [], plan_label: null } }),
    ],
  }, pageOf);
  const [about, empty, model] = g.pages;
  assertEquals(model.model, { name: "شقة 1", type: null, orientation: "داخلية شمالي", rooms: 2, bathrooms: null, area: 97, price: 639000, sold: false, parts: ["غرفة نوم ماستر", "مطبخ"], plan_label: "نموذج شقة (1) مساحتها : 97 م2" });
  assertEquals(about.model, null);
  assertEquals(empty.model, null); // مساحة 3 وسعر 5 خارج المدى: لا يبقى من النموذج شيء
  assertEquals(g.dropped, 3);
});

Deno.test("brochure: groups merge in page order, the project from the earliest page, a second name is a conflict", () => {
  const a = cleanGroup({ project: project({ developer: "لامير العقارية", name: "LAMER SERIN" }), pages: [page("S5", "contact")] }, pageOf);
  const b = cleanGroup({ project: project({ name: "لامير سيرين", city: "جدة" }), pages: [page("S1", "cover"), page("S2", "about")] }, pageOf);
  const { result, empty } = evaluatePages([a, b], [1, 2, 3, 4, 5]);
  assert(!empty);
  assertEquals(result.version, 2);
  assertEquals(result.pages.map((p) => p.page), [1, 2, 5]);
  assertEquals(result.project, { name: "لامير سيرين", developer: "لامير العقارية", city: "جدة" });
  assertEquals(result.missing, [3, 4]);
  assertEquals(result.conflicts.map((c) => c.field), ["project.name"]);
});

Deno.test("brochure: groups saved by an earlier run are not read again", () => {
  const saved = [cleanGroup({ project: project(), pages: [page("S1", "cover"), page("S2", "about")] }, pageOf)];
  // ما يُحفظ في result يمرّ بـ JSON ثم يُقرأ في الدورة التالية
  const back = JSON.parse(JSON.stringify(saved));
  assertEquals([...readPages(back)].sort(), [1, 2]);
  const later = cleanGroup({ project: project({ name: "لامير سيرين" }), pages: [page("S3", "photos"), page("S4", "photos")] }, pageOf);
  const { result } = evaluatePages([...back, later], [1, 2, 3, 4]);
  assertEquals(result.pages.map((p) => p.page), [1, 2, 3, 4]);
  assertEquals(result.missing, []);
});

Deno.test("brochure: nothing usable is empty", () => {
  const g = cleanGroup({ project: project(), pages: [page("S1", "other")] }, pageOf);
  assert(evaluatePages([g], [1]).empty);
  assert(evaluatePages([], [1, 2]).empty);
});

Deno.test("brochure: page number from the studio's file name, else the source order", () => {
  assertEquals(pageFromPath("req/3-p03.jpg", 3), 3);
  assertEquals(pageFromPath("req/14-p14.jpg", 1), 14);
  assertEquals(pageFromPath("req/x.jpg", 7), 7);
  assertEquals(pageFromPath("req/33-sheet01.jpg", 33), null);
});

Deno.test("brochure: headline figures keep their printed value and label; incomplete ones are dropped", () => {
  const g = cleanGroup({
    project: project(),
    pages: [page("S1", "about", { figures: [{ value: "+700", label: "عملاء" }, { value: " +300,000 م² ", label: "مساحة مطوّرة" }, { value: "", label: "مشروع" }, { value: "50", label: null }] })],
  }, pageOf);
  assertEquals(g.pages[0].figures, [{ value: "+700", label: "عملاء" }, { value: "+300,000 م²", label: "مساحة مطوّرة" }]);
  assertEquals(cleanGroup({ project: project(), pages: [page("S2", "about")] }, pageOf).pages[0].figures, []);
});
