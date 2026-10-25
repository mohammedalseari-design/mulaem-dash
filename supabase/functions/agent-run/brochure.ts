// تقييم قراءة «بروشور» (036): ناتج النموذج ← نتيجة نظيفة تُحفظ في agent_requests.result لاستوديو البروشورات.
//
// لا مسودة ولا اعتماد: البروشور تصميم لا سجلٌ في المخزون، والمدير يراجع القراءة في الاستوديو قبل التصميم. لكن القاعدة
// نفسها كما في validate.ts: لا قيمة بلا مصدرها (صفحة موجودة)، والمستنتج لا يُكتب، والأرقام في مداها، والتناقض يُذكر
// ولا يُحسم. القيمة المرفوضة تُعدّ (dropped) فيظهر للمدير أن شيئاً لم يُقرأ بثقة.

// deno-lint-ignore no-explicit-any
type Any = any;

export interface BrochureResult {
  version: 1;
  project: Record<string, string | number | string[]>;
  evidence: Record<string, number>; // الحقل ← رقم الصفحة
  models: BrochureModel[];
  pages: { page: number; role: string }[];
  images: { n: number; role: string; model: string | null; caption: string | null }[]; // n: رقم المصغّرة (1…)
  conflicts: { field: string; values: string[]; pages: number[]; note: string }[];
  suspicious: { quote: string; page: number | null; reason: string }[];
  dropped: number;
}

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
  page: number | null;
  plan_label: string | null;
}

const ROLES = new Set(["cover", "about", "exterior", "interior", "aerial", "map", "plan", "model", "amenities", "guarantees", "contact", "other"]);
const IMAGE_ROLES = new Set(["exterior", "interior", "aerial", "map", "plan", "plan3d", "logo", "texture", "people", "other"]);
export const MAX_IMAGES = 160;
const TEXT_FIELDS: Record<string, number> = {
  name: 80, name_latin: 60, tagline: 100, developer: 80, type: 40, city: 40, district: 60, address: 160,
  description: 600, construction_status: 60, license: 80,
};
const RANGES: Record<string, [number, number]> = {
  units_count: [1, 5000], rooms: [0, 30], bathrooms: [0, 30], area: [10, 100_000], price: [10_000, 1_000_000_000],
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

function list(value: unknown, max = 12): string[] {
  return (Array.isArray(value) ? value : []).map((v) => text(v, 90)).filter((v): v is string => Boolean(v)).slice(0, max);
}

// pageOf: معرّف المصدر («S3») ← رقم صفحته في البروشور، أو null لمعرّف لا يخص هذا الطلب
export function evaluateBrochure(out: Any, pageOf: (source: unknown) => number | null): { result: BrochureResult; empty: boolean } {
  let dropped = 0;
  const project: BrochureResult["project"] = {};
  const evidence: BrochureResult["evidence"] = {};

  // حقل مستخرج { value, source, inferred }: يُقبل بمصدر صفحة موجودة وغير مستنتج، وإلا يُعدّ مرفوضاً
  const take = (f: Any, read: (v: unknown) => string | number | string[] | null): { value: string | number | string[]; page: number } | null => {
    if (!f || typeof f !== "object" || f.value === null || f.value === undefined) return null;
    const page = pageOf(f.source);
    const value = read(f.value);
    if (page === null || f.inferred === true || value === null || (Array.isArray(value) && !value.length)) {
      dropped++;
      return null;
    }
    return { value, page };
  };

  const p = out?.project ?? {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const got = take(p[key], (v) => text(v, max));
    if (got) { project[key] = got.value; evidence[key] = got.page; }
  }
  const purpose = take(p.purpose, (v) => (v === "sale" || v === "rent" ? v : null));
  if (purpose) { project.purpose = purpose.value; evidence.purpose = purpose.page; }
  const delivery = take(p.delivery_date, (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));
  if (delivery) { project.delivery_date = delivery.value; evidence.delivery_date = delivery.page; }
  const units = take(p.units_count, (v) => inRange(v, "units_count"));
  if (units) { project.units_count = units.value; evidence.units_count = units.page; }
  for (const key of ["landmarks", "amenities"]) {
    const got = take(p[key], (v) => list(v));
    if (got) { project[key] = got.value; evidence[key] = got.page; }
  }

  const models: BrochureModel[] = (Array.isArray(out?.models) ? out.models : []).slice(0, 16).map((m: Any) => {
    const val = (f: Any, read: (v: unknown) => string | number | string[] | null) => take(f, read)?.value ?? null;
    const status = take(m?.status, (v) => (v === "sold" || v === "available" ? v : null));
    return {
      name: val(m?.name, (v) => text(v, 40)) as string | null,
      type: val(m?.type, (v) => text(v, 30)) as string | null,
      orientation: val(m?.orientation, (v) => text(v, 50)) as string | null,
      rooms: val(m?.rooms, (v) => inRange(v, "rooms")) as number | null,
      bathrooms: val(m?.bathrooms, (v) => inRange(v, "bathrooms")) as number | null,
      area: val(m?.area, (v) => inRange(v, "area")) as number | null,
      price: val(m?.price, (v) => inRange(v, "price")) as number | null,
      sold: status?.value === "sold",
      parts: (val(m?.parts, (v) => list(v)) as string[] | null) ?? [],
      page: pageOf(m?.page_source),
      plan_label: text(m?.plan_label, 160),
    };
  }).filter((m: BrochureModel) => m.name || m.area || m.price);

  const seen = new Set<number>();
  const pages = (Array.isArray(out?.pages) ? out.pages : [])
    .map((x: Any) => ({ page: pageOf(x?.source), role: ROLES.has(x?.role) ? x.role : "other" }))
    .filter((x: { page: number | null }) => x.page !== null && !seen.has(x.page) && seen.add(x.page))
    .sort((a: { page: number }, b: { page: number }) => a.page - b.page) as { page: number; role: string }[];

  const conflicts = (Array.isArray(out?.conflicts) ? out.conflicts : []).slice(0, 30).map((c: Any) => ({
    field: text(c?.field, 60) ?? "",
    values: list(c?.values, 6),
    pages: (Array.isArray(c?.sources) ? c.sources : []).map(pageOf).filter((n: number | null): n is number => n !== null),
    note: text(c?.note, 240) ?? "",
  })).filter((c: { note: string; values: string[] }) => c.note || c.values.length);

  const taken = new Set<number>();
  const images = (Array.isArray(out?.images) ? out.images : []).map((x: Any) => ({
    n: Number.isInteger(x?.number) && x.number >= 1 && x.number <= MAX_IMAGES ? x.number : 0,
    role: IMAGE_ROLES.has(x?.role) ? x.role : "other",
    model: text(x?.model, 40),
    caption: text(x?.caption, 40),
  })).filter((x: { n: number }) => x.n > 0 && !taken.has(x.n) && taken.add(x.n))
    .sort((a: { n: number }, b: { n: number }) => a.n - b.n) as BrochureResult["images"];

  const suspicious = (Array.isArray(out?.suspicious) ? out.suspicious : []).slice(0, 20).map((s: Any) => ({
    quote: text(s?.quote, 200) ?? "", page: pageOf(s?.source), reason: text(s?.reason, 200) ?? "",
  })).filter((s: { quote: string }) => s.quote);

  const result: BrochureResult = { version: 1, project, evidence, models, pages, images, conflicts, suspicious, dropped };
  return { result, empty: !project.name && !models.length };
}

// مسار مصدر الصفحة كما يرفعه الاستوديو («<الطلب>/3-p03.jpg») ← رقم الصفحة في البروشور. لمسار بلا رقم صفحة: ترتيب المصدر.
// ورقة المصغّرات («…-sheet01.jpg») ليست صفحة: null
export function pageFromPath(path: string | null | undefined, order: number): number | null {
  const name = String(path ?? "");
  if (/sheet\d+\.(?:jpe?g|png|webp)$/i.test(name)) return null;
  const m = /p(\d{1,3})\.(?:jpe?g|png|webp)$/i.exec(name);
  return m ? Number(m[1]) : order;
}
