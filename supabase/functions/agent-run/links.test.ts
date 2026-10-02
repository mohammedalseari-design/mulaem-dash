// اختبارات تسلسل فتح الروابط (links.ts) بلا شبكة ولا قاعدة: ما يُفتح وما يُتخطى، وما يُحفظ ويُسجَّل، ومتى يُعاد الطلب.
// التشغيل: deno test supabase/functions/agent-run/
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { type FetchedPage, LINK_BUDGET_MS, UrlError } from "./fetch.ts";
import { type LinkDeps, LinkRetry, openLinks } from "./links.ts";
import { loadSources, type SourceRow } from "./sources.ts";

const link = (id: string, extra: Partial<SourceRow> = {}): SourceRow =>
  ({ id, kind: "url", storage_path: null, url: `https://site.example/${id}`, bytes: null, pages: null, sha256: null, ...extra });
const text = (body: string, title: string | null = "عنوان"): FetchedPage =>
  ({ kind: "text", bytes: new TextEncoder().encode(body), text: body, title, finalUrl: "https://site.example/x", contentType: "text/html" });
const pdf = (): FetchedPage =>
  ({ kind: "pdf", bytes: new TextEncoder().encode("%PDF-1.4 x"), text: null, title: null, finalUrl: "https://site.example/b.pdf", contentType: "application/pdf" });

function world(pages: Record<string, FetchedPage | Error>, over: Partial<LinkDeps> = {}) {
  const fetched: [string, number][] = [];
  const stored = new Map<string, { bytes: Uint8Array; type: string }>();
  const saved: [string, Record<string, unknown>][] = [];
  const deps: LinkDeps = {
    fetchPage: (url, budgetMs) => {
      fetched.push([url, budgetMs]);
      const page = pages[url];
      return page instanceof Error ? Promise.reject(page) : Promise.resolve(page);
    },
    store: (path, bytes, type) => {
      stored.set(path, { bytes, type });
      return Promise.resolve(true);
    },
    save: (id, patch) => {
      saved.push([id, patch]);
      return Promise.resolve(true);
    },
    countPages: () => Promise.resolve(3),
    left: () => 100_000,
    now: () => new Date("2026-10-02T09:00:00Z"),
    ...over,
  };
  return { deps, fetched, stored, saved };
}

Deno.test("links: an unread link is fetched once, stored under the request's folder and recorded; the next run fetches nothing", async () => {
  const rows = [link("aaaaaaaa-1111"), { ...link("t"), kind: "text" as const, storage_path: "req/1.txt" }];
  const w = world({ "https://site.example/aaaaaaaa-1111": text("السعر 900 ألف") });
  assertEquals(await openLinks("req", rows, w.deps), 1);
  assertEquals(w.fetched, [["https://site.example/aaaaaaaa-1111", LINK_BUDGET_MS]]);
  assertEquals([...w.stored.keys()], ["req/url-aaaaaaaa.txt"]);
  assertEquals(w.stored.get("req/url-aaaaaaaa.txt")!.type, "text/plain;charset=utf-8");
  const [id, patch] = w.saved[0];
  assertEquals(id, "aaaaaaaa-1111");
  assertEquals(patch.storage_path, "req/url-aaaaaaaa.txt");
  assertEquals(patch.title, "عنوان");
  assertEquals(patch.fetched_at, "2026-10-02T09:00:00.000Z");
  assertEquals(patch.fetch_error, null);
  assertEquals(patch.pages, null);
  assertEquals(String(patch.sha256).length, 64);
  // الصف نفسه صار مقروءاً: loadSources يقرأ المحفوظ وبصمته تطابق، والتشغيل التالي لا يطرق الموقع
  const loaded = await loadSources([rows[0]], (path) => Promise.resolve(w.stored.get(path)!.bytes));
  assertStringIncludes(loaded.srcs[0].text!, "السعر 900 ألف");
  assertEquals(await openLinks("req", rows, w.deps), 0);
  assertEquals(w.fetched.length, 1);
});

Deno.test("links: a final refusal is recorded on the source, nothing is stored, and the link is not tried again", async () => {
  const rows = [link("b1"), link("b2")];
  const w = world({
    "https://site.example/b1": new UrlError("الموقع يمنع القراءة الآلية (403)"),
    "https://site.example/b2": text("نص الصفحة الثانية"),
  });
  assertEquals(await openLinks("req", rows, w.deps), 1);
  assertEquals(w.saved[0], ["b1", { fetch_error: "الموقع يمنع القراءة الآلية (403)", fetched_at: "2026-10-02T09:00:00.000Z" }]);
  assertEquals(rows[0].fetch_error, "الموقع يمنع القراءة الآلية (403)");
  assertEquals(rows[0].storage_path, null);
  assertEquals([...w.stored.keys()], ["req/url-b2.txt"]);
  assertEquals(await openLinks("req", rows, w.deps), 0);
  assertEquals(w.fetched.length, 2);
});

Deno.test("links: transient failures re-queue the request and record nothing on the source", async () => {
  const busy = world({ "https://site.example/c": new UrlError("الموقع لا يستجيب الآن", true) });
  await assertRejects(() => openLinks("req", [link("c")], busy.deps), LinkRetry, "لا يستجيب");
  assertEquals(busy.saved, []);
  const noStore = world({ "https://site.example/c": text("نص") }, { store: () => Promise.resolve(false) });
  await assertRejects(() => openLinks("req", [link("c")], noStore.deps), LinkRetry, "المخزن");
  assertEquals(noStore.saved, []);
  const noSave = world({ "https://site.example/c": text("نص") }, { save: () => Promise.resolve(false) });
  const row = link("c");
  await assertRejects(() => openLinks("req", [row], noSave.deps), LinkRetry, "تسجيل");
  assertEquals(row.storage_path, null);
  // خطأ غير متوقع لا يُبتلع
  const broken = world({ "https://site.example/c": new TypeError("boom") });
  await assertRejects(() => openLinks("req", [link("c")], broken.deps), TypeError);
});

Deno.test("links: no time left means the request waits; the link budget never exceeds what is left", async () => {
  const late = world({ "https://site.example/d": text("نص") }, { left: () => 29_000 });
  await assertRejects(() => openLinks("req", [link("d")], late.deps), LinkRetry, "وقت التشغيل");
  assertEquals(late.fetched, []);
  const tight = world({ "https://site.example/d": text("نص") }, { left: () => 41_000 });
  await openLinks("req", [link("d")], tight.deps);
  assertEquals(tight.fetched[0][1], 41_000);
});

Deno.test("links: a PDF link keeps the page limit — within it the file is stored with its page count, over it or unreadable is a final refusal", async () => {
  const ok = world({ "https://site.example/e": pdf() });
  const row = link("e");
  assertEquals(await openLinks("req", [row], ok.deps), 1);
  assertEquals(ok.stored.get("req/url-e.pdf")!.type, "application/pdf");
  assertEquals(row.pages, 3);
  const long = world({ "https://site.example/e": pdf() }, { countPages: () => Promise.resolve(21) });
  const tooLong = link("e");
  assertEquals(await openLinks("req", [tooLong], long.deps), 0);
  assertStringIncludes(tooLong.fetch_error!, "21 صفحة");
  assertEquals(long.stored.size, 0);
  const bad = world({ "https://site.example/e": pdf() }, { countPages: () => Promise.reject(new Error("encrypted")) });
  const unreadable = link("e");
  assertEquals(await openLinks("req", [unreadable], bad.deps), 0);
  assertStringIncludes(unreadable.fetch_error!, "تعذّرت قراءة ملف PDF");
  assert(bad.stored.size === 0);
});
