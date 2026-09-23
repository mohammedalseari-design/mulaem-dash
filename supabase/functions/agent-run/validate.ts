// التحقق المستقل من ناتج النموذج وتحويله إلى مسودات.
//
// هذا الملف هو الفحص الحقيقي، لا "ثقة" النموذج: كل قيمة تمرّ هنا على نوعها ومداها،
// وعلى وجود اقتباس من مصدر معروف، وعلى أن الاقتباس موجود فعلاً في النص (حين يكون المصدر
// نصاً يمكن قراءته)، والجوال على normalize_phone في القاعدة. ما يسقط هنا يذهب إلى
// missing أو conflicts ولا يدخل المقترح.
//
// لا شبكة ولا قاعدة هنا: الدوال نقية (تطبيع الجوال يُمرَّر من الخارج) لتُختبر بلا مفتاح.

export type SourceKind = "text" | "pdf" | "image" | "sheet" | "url";

export interface Src {
  label: string; // S1, S2 ... كما يراها النموذج
  id: string; // agent_sources.id
  kind: SourceKind;
  text?: string; // النص المقروء (نص/جدول)؛ PDF والصور لا نص لها هنا
}

export interface Field<T = unknown> {
  value: T | null;
  quote: string | null;
  page: number | null;
  source: string | null;
  inferred: boolean;
}

export interface Evidence {
  quote: string;
  page: number | null;
  source_id: string | null;
  verified: boolean; // الاقتباس وُجد حرفياً في نص المصدر
  before?: unknown;
  reason?: string | null;
}

export interface Conflict {
  field?: string;
  value?: unknown;
  quote?: string | null;
  note: string;
}

export interface Suspicious {
  quote: string;
  source_id: string | null;
  reason: string;
}

export interface DraftSpec {
  target_kind: "project" | "unit" | "client" | "requirement";
  target_id: string | null;
  proposed: Record<string, unknown>;
  evidence: Record<string, Evidence>;
  missing: string[];
  conflicts: Conflict[];
  duplicates: unknown[];
  suspicious: Suspicious[];
  baseline_hash: string | null;
}

export type PhoneNormalizer = (raw: string) => Promise<string | null>;

/* ===================== تطبيع النص للمقارنة ===================== */

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = AR_DIGITS.indexOf(d);
    return String(i >= 0 ? i : FA_DIGITS.indexOf(d));
  });
}

// نفس فكرة agent_norm_name في القاعدة: الهمزات والتاء المربوطة والتشكيل والترقيم لا تفرّق.
export function normText(text: string): string {
  return asciiDigits(String(text ?? ""))
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9ء-ي@.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_WORDS: [RegExp, number][] = [
  [/(^|\s)(واحد|واحدة)(?=\s|$)/, 1], [/(غرفتين|غرفتان|دورتين|دورتان|اثنين|اثنان|اثنتين)/, 2],
  [/(^|\s)(ثلاث|ثلاثة)(?=\s|$)/, 3], [/(^|\s)(اربع|اربعة)(?=\s|$)/, 4], [/(^|\s)(خمس|خمسة)(?=\s|$)/, 5],
  [/(^|\s)(ست|ستة)(?=\s|$)/, 6], [/(^|\s)(سبع|سبعة)(?=\s|$)/, 7], [/(^|\s)(ثمان|ثماني|ثمانية)(?=\s|$)/, 8],
  [/(^|\s)(تسع|تسعة)(?=\s|$)/, 9], [/(^|\s)(عشر|عشرة)(?=\s|$)/, 10],
];

// كل رقم يمكن قراءته من الاقتباس: بفواصل الآلاف أو بدونها، مع "ألف" و"مليون"، وكلمات الأعداد الصغيرة.
export function numbersIn(quote: string): number[] {
  const text = asciiDigits(String(quote ?? "")).replace(/[٬،]/g, ",").replace(/٫/g, ".");
  const out: number[] = [];
  const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(مليون|ملايين|million|m\b|ألف|الف|آلاف|الاف|k\b)?/gi;
  for (const m of text.matchAll(re)) {
    const base = Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : ""));
    if (!Number.isFinite(base)) continue;
    out.push(base);
    const unit = (m[3] ?? "").toLowerCase();
    if (/^(مليون|ملايين|million|m)$/.test(unit)) out.push(base * 1_000_000);
    else if (unit) out.push(base * 1_000);
  }
  if (/(^|\s)(مليون)(?=\s|$)/.test(text) && !/\d\s*مليون/.test(text)) out.push(1_000_000);
  const words = normText(text);
  for (const [re2, n] of NUMBER_WORDS) if (re2.test(words)) out.push(n);
  return out;
}

function digitsOnly(text: string): string {
  return asciiDigits(String(text ?? "")).replace(/\D/g, "");
}

/* ===================== قواعد الحقول ===================== */

export type Rule =
  | { kind: "string"; max?: number }
  | { kind: "number"; min: number; max: number }
  | { kind: "int"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "date" }
  | { kind: "email" }
  | { kind: "phone" }
  | { kind: "strings"; max?: number };

// حدود معقولة لسوق جدة. خارجها القيمة خطأ قراءة (فاصلة ضائعة أو صفر زائد) لا صفقة.
export const PRICE = { kind: "number", min: 10_000, max: 500_000_000 } as const;
export const AREA = { kind: "number", min: 10, max: 1_000_000 } as const;
export const ROOMS = { kind: "int", min: 0, max: 50 } as const;
export const COUNT = { kind: "int", min: 1, max: 10_000 } as const;
export const LAT = { kind: "number", min: 16, max: 33 } as const; // حدود المملكة تقريباً
export const LNG = { kind: "number", min: 34, max: 56 } as const;
export const TEXT = { kind: "string", max: 300 } as const;
export const LONG_TEXT = { kind: "string", max: 3000 } as const;
export const DATE = { kind: "date" } as const;

const PHONE_OK = /^\+(9665\d{8}|9661\d{7,8}|9668\d{8,9}|[1-8]\d{7,14})$/;

/* ===================== المدقق ===================== */

export class Checker {
  evidence: Record<string, Evidence> = {};
  missing: string[] = [];
  conflicts: Conflict[] = [];
  private byLabel = new Map<string, Src>();

  constructor(sources: Src[], private normalizePhone: PhoneNormalizer) {
    for (const s of sources) this.byLabel.set(s.label.toUpperCase(), s);
  }

  source(label: string | null | undefined): Src | null {
    if (!label) return null;
    return this.byLabel.get(String(label).trim().toUpperCase()) ?? null;
  }

  private miss(key: string) {
    if (!this.missing.includes(key)) this.missing.push(key);
  }

  // يعيد القيمة المقبولة أو undefined. أي رفض يُسجَّل بسببه.
  async take(key: string, f: Field | null | undefined, rule: Rule): Promise<unknown> {
    if (!f || f.value === null || f.value === undefined || f.value === "") {
      this.miss(key);
      return undefined;
    }
    const quote = typeof f.quote === "string" ? f.quote.trim() : "";

    if (f.inferred) {
      this.conflicts.push({ field: key, value: f.value, quote: quote || null, note: "قيمة مستنتجة لا يذكرها المصدر نصاً — لم تُدرج في المقترح" });
      this.miss(key);
      return undefined;
    }
    const src = this.source(f.source);
    if (!quote || !src) {
      this.conflicts.push({ field: key, value: f.value, note: "قيمة بلا اقتباس من مصدر معروف — لم تُدرج في المقترح" });
      this.miss(key);
      return undefined;
    }

    // الاقتباس يُطابَق مع النص حين نملك نصه؛ PDF والصور لا نقرأ نصها هنا فتبقى "غير متحقَّق منها"
    let verified = false;
    if (src.text !== undefined) {
      verified = normText(src.text).includes(normText(quote));
      if (!verified) {
        this.conflicts.push({ field: key, value: f.value, quote, note: "الاقتباس غير موجود في نص المصدر — لم تُدرج القيمة" });
        this.miss(key);
        return undefined;
      }
    }

    const checked = await this.check(key, f.value, rule, quote);
    if (checked === undefined) {
      this.miss(key);
      return undefined;
    }

    this.evidence[key] = {
      quote,
      page: src.kind === "pdf" && Number.isInteger(f.page) && (f.page as number) > 0 ? f.page : null,
      source_id: src.id,
      verified,
    };
    return checked;
  }

  private reject(key: string, value: unknown, note: string): undefined {
    this.conflicts.push({ field: key, value, note });
    return undefined;
  }

  private async check(key: string, value: unknown, rule: Rule, quote: string): Promise<unknown> {
    switch (rule.kind) {
      case "string": {
        if (typeof value !== "string") return this.reject(key, value, "نوع غير صحيح — المتوقع نص");
        const text = value.replace(/\s+/g, " ").trim();
        if (!text) return undefined;
        if (text.length > (rule.max ?? 300)) return this.reject(key, value, "نص أطول من المسموح");
        return text;
      }
      case "number":
      case "int": {
        const n = typeof value === "number" ? value : Number(asciiDigits(String(value)).replace(/[,\s٬]/g, ""));
        if (!Number.isFinite(n)) return this.reject(key, value, "ليست رقماً");
        if (rule.kind === "int" && !Number.isInteger(n)) return this.reject(key, value, "المتوقع عدد صحيح");
        if (n < rule.min || n > rule.max) {
          return this.reject(key, value, `خارج المدى المعقول (${rule.min.toLocaleString("en")}–${rule.max.toLocaleString("en")})`);
        }
        // الرقم نفسه يجب أن يُقرأ من الاقتباس: اقتباس حقيقي لا يحمل رقماً مؤلَّفاً
        if (!numbersIn(quote).some((q) => Math.abs(q - n) <= Math.max(0.5, Math.abs(n) * 0.005))) {
          return this.reject(key, value, "الرقم لا يظهر في الاقتباس");
        }
        return n;
      }
      case "enum":
        if (typeof value !== "string" || !rule.values.includes(value)) return this.reject(key, value, "قيمة غير معروفة");
        return value;
      case "date": {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return this.reject(key, value, "تاريخ غير صالح");
        const d = new Date(value + "T00:00:00Z");
        const year = d.getUTCFullYear();
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value || year < 2000 || year > 2100) {
          return this.reject(key, value, "تاريخ غير صالح");
        }
        return value;
      }
      case "email": {
        const email = String(value).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return this.reject(key, value, "بريد غير صالح");
        if (!quote.toLowerCase().includes(email)) return this.reject(key, value, "البريد لا يظهر في الاقتباس");
        return email;
      }
      case "phone": {
        const raw = asciiDigits(String(value));
        // الأرقام نفسها يجب أن تظهر في الاقتباس: لا رقم مؤلَّف من خارج المصدر
        const digits = digitsOnly(raw).replace(/^(00966|966|0)/, "");
        if (digits.length < 8 || !digitsOnly(quote).includes(digits)) {
          return this.reject(key, value, "أرقام الجوال لا تظهر في الاقتباس");
        }
        const normalized = await this.normalizePhone(raw);
        if (!normalized || !PHONE_OK.test(normalized)) return this.reject(key, value, "رقم جوال غير صالح بعد التطبيع");
        return normalized;
      }
      case "strings": {
        if (!Array.isArray(value)) return this.reject(key, value, "المتوقع قائمة");
        const items = value.map((v) => String(v ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
        if (!items.length) return undefined;
        if (items.length > 30 || items.some((v) => v.length > (rule.max ?? 80))) return this.reject(key, value, "قائمة غير معقولة");
        return [...new Set(items)];
      }
    }
  }
}

/* ===================== المحتوى المريب ===================== */

// فحص مستقل عن النموذج: أنماط أوامر موجّهة للوكيل داخل نص المصدر. ما يُلتقط هنا يُقتبس
// في المسودة ويُتجاهل، سواء لاحظه النموذج أم لا.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompts?)/i,
  /disregard\s+(the\s+|all\s+|your\s+)?(instructions|rules|above)/i,
  /\byou\s+are\s+now\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(auto[- ]?)?approve\s+(this|the|all|immediately)\b/i,
  /\bset\s+(the\s+)?status\b/i,
  /\bgrant\s+(yourself|admin|me)\b/i,
  /\b(admin|administrator)\s+(role|access|rights|privileges)\b/i,
  /\bnew\s+instructions?\b/i,
  /تجاهل\s+(كل\s+|جميع\s+)?(التعليمات|الأوامر|ما\s+سبق|القواعد)/,
  /اعتمد\s+(هذ|المسود|الطلب|فور|مباشر|تلقائي)/,
  /(وافق|موافقة)\s+(على\s+)?(هذ|الطلب|المسود)\S*\s*(فور|مباشر|تلقائي)/,
  /أنت\s+الآن/,
  /غي[ّ]?ر\s+مهمتك/,
  /(صلاحي(ة|ات)|دور)\s+(المدير|الإدارة|الأدمن)/,
  /امنح\s+(نفسك|نفسكَ|لنفسك)/,
  /تعليمات\s+(جديدة|للنظام|للمساعد|للذكاء)/,
];

export function scanSuspicious(sources: Src[]): Suspicious[] {
  const found: Suspicious[] = [];
  for (const s of sources) {
    if (!s.text) continue;
    const lines = s.text.split(/\r?\n|(?<=[.!؟?])\s+/);
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      if (INJECTION_PATTERNS.some((re) => re.test(text))) {
        found.push({ quote: text.slice(0, 500), source_id: s.id, reason: "نص في المصدر يشبه أمراً موجّهاً للمساعد — تم تجاهله" });
      }
      if (found.length >= 20) return found;
    }
  }
  return found;
}

interface ModelSuspicious {
  quote: string;
  source: string | null;
  reason: string;
}

export function mergeSuspicious(checker: Checker, fromModel: ModelSuspicious[] | undefined, scanned: Suspicious[]): Suspicious[] {
  const out: Suspicious[] = [];
  const seen = new Set<string>();
  const add = (s: Suspicious) => {
    const key = normText(s.quote);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const s of scanned) add(s);
  for (const s of fromModel ?? []) {
    if (!s || typeof s.quote !== "string") continue;
    add({
      quote: s.quote.slice(0, 500),
      source_id: checker.source(s.source)?.id ?? null,
      reason: String(s.reason || "نص مريب في المصدر").slice(0, 300),
    });
  }
  return out.slice(0, 30);
}

/* ===================== أرقام الهواتف وأدوارها ===================== */

interface PhoneFound {
  number: string;
  role: string;
  quote: string;
  source: string | null;
}

// رقم وُصف بأنه لمرسل الرسالة أو لجهة تواصل في كتيّب لا يصير جوال العميل.
function foreignRole(phone: string, found: PhoneFound[] | undefined): string | null {
  const digits = digitsOnly(phone).slice(-9);
  for (const p of found ?? []) {
    if (p.role === "client") continue;
    if (digitsOnly(p.number).slice(-9) === digits) return p.role;
  }
  return null;
}

const ROLE_AR: Record<string, string> = {
  message_sender: "رقم مرسل الرسالة",
  brochure_contact: "رقم تواصل مطبوع في الكتيّب أو الإعلان",
  developer: "رقم المطوّر",
  other: "رقم لا يخص العميل",
};

/* ===================== العميل ===================== */

// deno-lint-ignore no-explicit-any
type Json = any;

export async function buildClientDraft(out: Json, sources: Src[], normalizePhone: PhoneNormalizer): Promise<DraftSpec> {
  const c = new Checker(sources, normalizePhone);
  const client = out?.client ?? {};
  const proposed: Record<string, unknown> = {};

  const put = async (key: string, f: Field, rule: Rule) => {
    const v = await c.take(key, f, rule);
    if (v !== undefined) proposed[key] = v;
  };

  await put("full_name", client.full_name, TEXT);
  await put("phone", client.phone, { kind: "phone" });
  await put("phone_alt", client.phone_alt, { kind: "phone" });
  await put("email", client.email, { kind: "email" });
  await put("city", client.city, TEXT);
  await put("client_type", client.client_type, { kind: "enum", values: ["buy", "rent", "sell", "invest"] });
  await put("notes", client.notes, LONG_TEXT);

  // جوال العميل لا يُؤخذ من رقم وصفه النموذج نفسه بأنه لغيره
  for (const key of ["phone", "phone_alt"]) {
    const raw = client[key]?.value;
    if (proposed[key] === undefined || typeof raw !== "string") continue;
    const role = foreignRole(raw, out?.phones_found);
    if (role) {
      c.conflicts.push({ field: key, value: raw, note: (ROLE_AR[role] ?? "رقم لا يخص العميل") + " — لا يُعتمد جوالاً للعميل" });
      delete proposed[key];
      delete c.evidence[key];
      if (!c.missing.includes(key)) c.missing.push(key);
    }
  }
  if (proposed.phone === undefined && proposed.phone_alt !== undefined) {
    proposed.phone = proposed.phone_alt;
    c.evidence.phone = c.evidence.phone_alt;
    delete proposed.phone_alt;
    delete c.evidence.phone_alt;
    c.missing = c.missing.filter((k) => k !== "phone");
  }
  if (proposed.phone !== undefined && proposed.phone === proposed.phone_alt) {
    delete proposed.phone_alt;
    delete c.evidence.phone_alt;
  }

  // الطلب العقاري يُرفق بالعميل ويُكتب معه في معاملة الاعتماد نفسها
  const r = out?.requirement;
  if (r && typeof r === "object") {
    const req: Record<string, unknown> = {};
    const putReq = async (key: string, f: Field, rule: Rule) => {
      const v = await c.take("requirement." + key, f, rule);
      if (v !== undefined) req[key] = v;
    };
    await putReq("purpose", r.purpose, { kind: "enum", values: ["sale", "rent"] });
    await putReq("property_type", r.property_type, { kind: "string", max: 60 });
    await putReq("city", r.city, TEXT);
    await putReq("districts", r.districts, { kind: "strings" });
    await putReq("budget_min", r.budget_min, PRICE);
    await putReq("budget_max", r.budget_max, PRICE);
    await putReq("area_min", r.area_min, AREA);
    await putReq("area_max", r.area_max, AREA);
    await putReq("rooms_min", r.rooms_min, ROOMS);
    await putReq("financing_type", r.financing_type, { kind: "string", max: 60 });
    await putReq("delivery_before", r.delivery_before, DATE);
    await putReq("notes", r.notes, LONG_TEXT);

    for (const [lo, hi] of [["budget_min", "budget_max"], ["area_min", "area_max"]]) {
      if (typeof req[lo] === "number" && typeof req[hi] === "number" && (req[lo] as number) > (req[hi] as number)) {
        c.conflicts.push({ field: "requirement." + lo, value: [req[lo], req[hi]], note: "الحد الأدنى أكبر من الأعلى — لم يُدرج أيٌّ منهما" });
        for (const k of [lo, hi]) {
          delete req[k];
          delete c.evidence["requirement." + k];
          c.missing.push("requirement." + k);
        }
      }
    }

    if (req.purpose && req.property_type) {
      proposed.requirement = req;
    } else if (Object.keys(req).length) {
      c.conflicts.push({ field: "requirement", note: "المصدر يذكر مطلباً عقارياً دون الغرض أو نوع العقار — لم يُرفق الطلب بالمسودة" });
    }
  }

  return {
    target_kind: "client",
    target_id: null,
    proposed,
    evidence: c.evidence,
    missing: c.missing,
    conflicts: c.conflicts,
    duplicates: [],
    suspicious: mergeSuspicious(c, out?.suspicious, scanSuspicious(sources)),
    baseline_hash: null,
  };
}

/* ===================== المشروع ===================== */

export async function buildProjectDraft(out: Json, sources: Src[], normalizePhone: PhoneNormalizer): Promise<DraftSpec> {
  const c = new Checker(sources, normalizePhone);
  const p = out?.project ?? {};
  const proposed: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};

  const put = async (target: Record<string, unknown>, key: string, evKey: string, f: Field, rule: Rule) => {
    const v = await c.take(evKey, f, rule);
    if (v !== undefined) target[key] = v;
  };

  await put(proposed, "name", "name", p.name, TEXT);
  await put(proposed, "type", "type", p.type, { kind: "string", max: 60 });
  await put(proposed, "purpose", "purpose", p.purpose, { kind: "enum", values: ["sale", "rent"] });
  await put(proposed, "city", "city", p.city, { kind: "string", max: 60 });
  await put(proposed, "district", "district", p.district, { kind: "string", max: 80 });
  await put(proposed, "address", "address", p.address, TEXT);
  // سعر البداية للمشروع وحده؛ أسعار الوحدات في models
  await put(proposed, "price", "price", p.starting_price, PRICE);
  await put(proposed, "area", "area", p.area, AREA);
  await put(proposed, "latitude", "latitude", p.latitude, LAT);
  await put(proposed, "longitude", "longitude", p.longitude, LNG);
  await put(proposed, "delivery_date", "delivery_date", p.delivery_date, DATE);
  await put(proposed, "availability", "availability", p.availability, { kind: "enum", values: ["available", "sold_out"] });
  await put(details, "developer", "details.developer", p.developer, TEXT);
  await put(details, "construction_status", "details.construction_status", p.construction_status, { kind: "string", max: 60 });
  await put(details, "units_count", "details.units_count", p.units_count, COUNT);
  await put(details, "description", "details.description", p.description, LONG_TEXT);

  if ((proposed.latitude === undefined) !== (proposed.longitude === undefined)) {
    c.conflicts.push({ field: "latitude", note: "إحداثية واحدة دون الأخرى — لم يُدرج الموقع" });
    for (const k of ["latitude", "longitude"]) {
      delete proposed[k];
      delete c.evidence[k];
    }
  }

  const models: Record<string, unknown>[] = [];
  const units: Json[] = Array.isArray(out?.units) ? out.units.slice(0, 200) : [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i] ?? {};
    const m: Record<string, unknown> = {};
    const base = `units.${i}.`;
    await put(m, "name", base + "name", u.name, { kind: "string", max: 80 });
    await put(m, "type", base + "type", u.type, { kind: "string", max: 60 });
    await put(m, "rooms", base + "rooms", u.rooms, ROOMS);
    await put(m, "bathrooms", base + "bathrooms", u.bathrooms, ROOMS);
    await put(m, "area", base + "area", u.area, AREA);
    await put(m, "price", base + "price", u.price, PRICE);
    await put(m, "count", base + "count", u.count, COUNT);
    await put(m, "status", base + "status", u.status, { kind: "enum", values: ["available", "sold", "reserved"] });
    if (!Object.keys(m).length) continue;
    if (!m.name) m.name = "نموذج " + (models.length + 1);
    priceSanity(c, base, m.price, m.area);
    models.push(m);
  }
  // الناقص من حقول الوحدات كثير بطبيعته؛ يكفي ذكره مجمّعاً لا حقلاً حقلاً
  c.missing = c.missing.filter((k) => !k.startsWith("units."));

  if (models.length) details.models = models;
  if (Object.keys(details).length) proposed.details = details;

  // سعر البداية يجب ألا يزيد على أرخص وحدة مذكورة
  const unitPrices = models.map((m) => m.price).filter((v): v is number => typeof v === "number");
  if (typeof proposed.price === "number" && unitPrices.length) {
    const cheapest = Math.min(...unitPrices);
    if ((proposed.price as number) > cheapest) {
      c.conflicts.push({ field: "price", value: proposed.price, note: `سعر البداية أعلى من أرخص وحدة (${cheapest.toLocaleString("en")}) — راجع أيهما الصحيح` });
    }
  }
  priceSanity(c, "", proposed.price, undefined);

  return {
    target_kind: "project",
    target_id: null,
    proposed,
    evidence: c.evidence,
    missing: c.missing,
    conflicts: c.conflicts,
    duplicates: [],
    suspicious: mergeSuspicious(c, out?.suspicious, scanSuspicious(sources)),
    baseline_hash: null,
  };
}

// سعر المتر خارج 500–100,000 ريال علامة على خطأ قراءة. لا يُسقط القيمة: يُعرض تعارضاً.
function priceSanity(c: Checker, base: string, price: unknown, area: unknown) {
  if (typeof price !== "number" || typeof area !== "number" || area <= 0) return;
  const perM = price / area;
  if (perM < 500 || perM > 100_000) {
    c.conflicts.push({ field: base + "price", value: price, note: `سعر المتر ${Math.round(perM).toLocaleString("en")} ريال غير معقول — تحقق من السعر والمساحة` });
  }
}

/* ===================== التحديث ===================== */

export interface UpdateTarget {
  project_name?: string;
  district?: string;
  unit_name?: string;
}

export function updateTarget(out: Json): UpdateTarget {
  const t = out?.target ?? {};
  const val = (f: Field | undefined) =>
    f && !f.inferred && typeof f.value === "string" && f.value.trim() ? f.value.trim() : undefined;
  return { project_name: val(t.project_name), district: val(t.district), unit_name: val(t.unit_name) };
}

const PROJECT_RULES: Record<string, { key: string; rule: Rule }> = {
  price: { key: "price", rule: PRICE },
  area: { key: "area", rule: AREA },
  availability: { key: "availability", rule: { kind: "enum", values: ["available", "sold_out"] } },
  delivery_date: { key: "delivery_date", rule: DATE },
  address: { key: "address", rule: TEXT },
  construction_status: { key: "details.construction_status", rule: { kind: "string", max: 60 } },
  units_count: { key: "details.units_count", rule: COUNT },
  description: { key: "details.description", rule: LONG_TEXT },
  developer: { key: "details.developer", rule: TEXT },
};

const UNIT_RULES: Record<string, Rule> = {
  price: PRICE,
  area: AREA,
  rooms: ROOMS,
  bathrooms: ROOMS,
  count: COUNT,
  status: { kind: "enum", values: ["available", "sold", "reserved"] },
  type: { kind: "string", max: 60 },
};

export function hasUnitChanges(out: Json): boolean {
  return (Array.isArray(out?.changes) ? out.changes : []).some((ch: Json) => ch?.scope === "unit");
}

export function hasProjectChanges(out: Json): boolean {
  return (Array.isArray(out?.changes) ? out.changes : []).some((ch: Json) => ch?.scope === "project");
}

// current: الصف الهدف كما قُرئ مع بصمته؛ before لكل حقل يُسجَّل في الدليل.
export async function buildUpdateDraft(
  out: Json,
  sources: Src[],
  normalizePhone: PhoneNormalizer,
  scope: "project" | "unit",
  targetId: string,
  current: Record<string, unknown>,
  baselineHash: string,
): Promise<DraftSpec | null> {
  const c = new Checker(sources, normalizePhone);
  const proposed: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  const changes: Json[] = (Array.isArray(out?.changes) ? out.changes : []).filter((ch: Json) => ch?.scope === scope);
  if (!changes.length) return null;

  for (const ch of changes) {
    const f: Field = { value: ch.value, quote: ch.quote, page: ch.page, source: ch.source, inferred: Boolean(ch.inferred) };
    let evKey: string;
    let rule: Rule;
    if (scope === "project") {
      const spec = PROJECT_RULES[ch.field];
      if (!spec) {
        c.conflicts.push({ field: String(ch.field), value: ch.value, note: "حقل لا يُحدَّث على مستوى المشروع" });
        continue;
      }
      evKey = spec.key;
      rule = spec.rule;
    } else {
      const r = UNIT_RULES[ch.field];
      if (!r) {
        c.conflicts.push({ field: String(ch.field), value: ch.value, note: "حقل لا يُحدَّث على مستوى الوحدة" });
        continue;
      }
      evKey = ch.field;
      rule = r;
    }
    if (c.evidence[evKey]) {
      c.conflicts.push({ field: evKey, value: ch.value, quote: ch.quote, note: "المصدر يذكر قيمتين لهذا الحقل — أُخذت الأولى" });
      continue;
    }
    const v = await c.take(evKey, f, rule);
    if (v === undefined) continue;

    const before = evKey.startsWith("details.")
      ? (current.details as Record<string, unknown> | undefined)?.[evKey.slice(8)]
      : current[evKey];
    c.evidence[evKey].before = before ?? null;
    c.evidence[evKey].reason = typeof ch.reason === "string" ? ch.reason.slice(0, 300) : null;
    if (evKey.startsWith("details.")) details[evKey.slice(8)] = v;
    else proposed[evKey] = v;
  }
  if (Object.keys(details).length) proposed.details = details;
  // في التحديث الناقص هو كل ما لم يُذكر، ولا معنى لسرده
  c.missing = [];

  if (scope === "unit") priceSanity(c, "", proposed.price ?? current.price, proposed.area ?? current.area);

  return {
    target_kind: scope,
    target_id: targetId,
    proposed,
    evidence: c.evidence,
    missing: c.missing,
    conflicts: c.conflicts,
    duplicates: [],
    suspicious: mergeSuspicious(c, out?.suspicious, scanSuspicious(sources)),
    baseline_hash: baselineHash,
  };
}

// الوحدة المقصودة داخل مشروع: تطابق الاسم بعد التطبيع، وإلا فلا جزم.
export function matchUnit(models: unknown, unitName: string | undefined): { ord: number | null; candidates: { ord: number; name: string }[] } {
  const list = Array.isArray(models) ? models : [];
  const candidates = list.map((m, i) => ({ ord: i + 1, name: String((m as Json)?.name ?? "وحدة " + (i + 1)) }));
  if (!unitName) return { ord: candidates.length === 1 ? 1 : null, candidates };
  const want = normText(unitName);
  const exact = candidates.filter((c) => normText(c.name) === want);
  if (exact.length === 1) return { ord: exact[0].ord, candidates };
  return { ord: null, candidates };
}
