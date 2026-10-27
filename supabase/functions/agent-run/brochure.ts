// تقييم قراءة «بروشور» (036): نواتج مجموعات الصفحات ← نتيجة نظيفة تُحفظ في agent_requests.result لاستوديو البروشورات.
//
// كل صفحة من بروشور المطوّر تصير صفحة في بروشور ملائم بالعدد نفسه، فالنتيجة صفحاتٌ بترتيبها: دورها ونصوصها كما طُبعت
// ونموذجها وأدوار صورها المرقّمة. الصفحات تُقرأ مجموعاتٍ متوازية (index.ts readBrochure)، وما قُرئ يُحفظ مجموعةً مجموعة
// فتُكمل الدورة التالية الباقي. لا مسودة ولا اعتماد: البروشور تصميم لا سجلٌ في المخزون. والقاعدة كما في validate.ts:
// الصفحة من صفحات الطلب، والأرقام في مداها، والنص بطوله المسموح، وما لا يصح يُترك ويُعدّ (dropped).

import { BROCHURE_IMAGE_ROLES, BROCHURE_PAGE_ROLES } from "./schema.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export interface BrochureModel {
  name: string | null;
  type: string | null;
  orientation: string | null;
  rooms: number | null;
  bathrooms: number | null;
  area: number | null;
  price: number | null;
  sold: boolean;
  parts: string[];
  plan_label: string | null;
}

export interface BrochurePage {
  page: number;
  role: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  bullets: string[];
  model: BrochureModel | null;
  images: { n: number; role: string; caption: string | null }[]; // n: رقم المصغّرة تحت الصفحة (1…)
}

// ناتج مجموعة واحدة بعد التنظيف: أول صفحاتها (لترتيب بيانات المشروع)، وما رأته من بيانات المشروع، وصفحاتها
export interface BrochureGroup {
  first: number;
  project: Record<string, string>;
  pages: BrochurePage[];
  dropped: number;
}

export interface BrochureResult {
  version: 2;
  project: Record<string, string>;
  pages: BrochurePage[];
  missing: number[]; // صفحات لم تُقرأ: تُصمَّم من صورها وحدها
  conflicts: { field: string; values: string[]; pages: number[]; note: string }[];
  dropped: number;
  enhanced?: Record<string, string>; // فهرس صورة media ← رابط نسختها المحسّنة (enhance.ts)، لما اجتاز فحص الأمانة فقط
  enhance_notes?: string[]; // ملاحظات التحسين للمدير بالعربية: ما رُفض أو لم يُحسَّن، وكله بقي بصورته الأصلية
}

const PAGE_ROLES = new Set(BROCHURE_PAGE_ROLES);
const IMAGE_ROLES = new Set(BROCHURE_IMAGE_ROLES);
export const MAX_PAGE_IMAGES = 12;
const PROJECT_FIELDS: Record<string, number> = { name: 80, name_latin: 60, developer: 80, city: 40, district: 60, tagline: 120, license: 120 };
const RANGES: Record<string, [number, number]> = {
  rooms: [0, 30], bathrooms: [0, 30], area: [10, 100_000], price: [10_000, 1_000_000_000],
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function inRange(value: unknown, key: string): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\s*[\d.,٬٫]+\s*$/.test(value) ? Number(value.replace(/[,٬\s]/g, "").replace("٫", ".")) : NaN;
  const [lo, hi] = RANGES[key];
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function list(value: unknown, max: number, len = 120): string[] {
  return (Array.isArray(value) ? value : []).map((v) => text(v, len)).filter((v): v is string => Boolean(v)).slice(0, max);
}

function cleanModel(m: Any, count: () => void): BrochureModel | null {
  if (!m || typeof m !== "object") return null;
  const num = (key: string) => {
    const v = inRange(m[key], key);
    if (v === null && m[key] !== null && m[key] !== undefined) count();
    return v;
  };
  const model: BrochureModel = {
    name: text(m.name, 60), type: text(m.type, 40), orientation: text(m.orientation, 60),
    rooms: num("rooms"), bathrooms: num("bathrooms"), area: num("area"), price: num("price"),
    sold: m.sold === true, parts: list(m.parts, 16, 80), plan_label: text(m.plan_label, 160),
  };
  return model.name || model.area || model.price || model.rooms || model.parts.length ? model : null;
}

// ناتج مجموعة ← صفحاتها النظيفة. pageOf: معرّف المصدر («S3») ← رقم صفحته، أو null لمعرّف لا يخص هذا الطلب فيُترك
export function cleanGroup(out: Any, pageOf: (source: unknown) => number | null): BrochureGroup {
  let dropped = 0;
  const count = () => { dropped++; };
  const seen = new Set<number>();
  const pages: BrochurePage[] = [];
  for (const p of Array.isArray(out?.pages) ? out.pages : []) {
    const page = pageOf(p?.source);
    if (page === null || seen.has(page)) { dropped++; continue; }
    seen.add(page);
    const ns = new Set<number>();
    const images = (Array.isArray(p.images) ? p.images : []).filter((im: Any) => {
      const ok = Number.isInteger(im?.n) && im.n >= 1 && im.n <= MAX_PAGE_IMAGES && IMAGE_ROLES.has(im.role) && !ns.has(im.n);
      if (ok) ns.add(im.n);
      else dropped++;
      return ok;
    }).map((im: Any) => ({ n: im.n as number, role: im.role as string, caption: text(im.caption, 60) }));
    pages.push({
      page,
      role: PAGE_ROLES.has(p.role) ? p.role : "other",
      title: text(p.title, 120),
      subtitle: text(p.subtitle, 120),
      body: text(p.body, 600),
      bullets: list(p.bullets, 12),
      model: p.role === "model" ? cleanModel(p.model, count) : null,
      images,
    });
  }
  pages.sort((a, b) => a.page - b.page);
  const project: Record<string, string> = {};
  for (const [key, max] of Object.entries(PROJECT_FIELDS)) {
    const v = text(out?.project?.[key], max);
    if (v) project[key] = v;
  }
  return { first: pages.length ? pages[0].page : 9999, project, pages, dropped };
}

// أرقام الصفحات التي قرأتها المجموعات (المحفوظة من دورة سابقة)
export function readPages(groups: BrochureGroup[]): Set<number> {
  return new Set(groups.flatMap((g) => g.pages.map((p) => p.page)));
}

const norm = (s: string) => s.replace(/[\sـ«»"'().،,-]/g, "").toLowerCase();

// المجموعات ← النتيجة. expected: أرقام صفحات الطلب كلها. بيانات المشروع من أول مجموعة ذكرتها بترتيب الصفحات، واسمان
// مختلفان للمشروع تناقضٌ يُذكر ولا يُحسم
export function evaluatePages(groups: BrochureGroup[], expected: number[]): { result: BrochureResult; empty: boolean } {
  const ordered = [...groups].sort((a, b) => a.first - b.first);
  const byPage = new Map<number, BrochurePage>();
  for (const g of ordered) for (const p of g.pages) if (!byPage.has(p.page)) byPage.set(p.page, p);
  const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
  const project: Record<string, string> = {};
  const conflicts: BrochureResult["conflicts"] = [];
  for (const key of Object.keys(PROJECT_FIELDS)) {
    const found = ordered.filter((g) => g.project[key]).map((g) => ({ value: g.project[key], page: g.first }));
    if (!found.length) continue;
    project[key] = found[0].value;
    const other = found.find((f) => norm(f.value) !== norm(found[0].value));
    if (key === "name" && other) {
      conflicts.push({ field: "project.name", values: [found[0].value, other.value], pages: [found[0].page, other.page], note: "اسم المشروع مكتوب بصيغتين في البروشور" });
    }
  }
  const missing = expected.filter((n) => !byPage.has(n)).sort((a, b) => a - b);
  const dropped = groups.reduce((s, g) => s + g.dropped, 0);
  const empty = !pages.some((p) => p.title || p.body || p.bullets.length || p.model || p.images.length) && !project.name;
  return { result: { version: 2, project, pages, missing, conflicts, dropped }, empty };
}

// مسار مصدر الصفحة كما يرفعه الاستوديو («<الطلب>/3-p03.jpg») ← رقم الصفحة في البروشور. لمسار بلا رقم صفحة: ترتيب المصدر.
// ورقة المصغّرات القديمة («…-sheet01.jpg») ليست صفحة: null
export function pageFromPath(path: string | null | undefined, order: number): number | null {
  const name = String(path ?? "");
  if (/sheet\d+\.(?:jpe?g|png|webp)$/i.test(name)) return null;
  const m = /p(\d{1,3})\.(?:jpe?g|png|webp)$/i.exec(name);
  return m ? Number(m[1]) : order;
}
