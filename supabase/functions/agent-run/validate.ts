// التحقق المستقل من ناتج النموذج وتحويله إلى مسودات.
//
// هذا الملف هو الفحص الحقيقي، لا "ثقة" النموذج: كل قيمة تمرّ هنا على نوعها ومداها،
// وعلى وجود اقتباس من مصدر معروف، وعلى أن الاقتباس موجود فعلاً في النص (حين يكون المصدر
// نصاً يمكن قراءته)، والجوال على normalize_phone في القاعدة. ما يسقط هنا يذهب إلى
// missing أو conflicts ولا يدخل المقترح.
//
// لا شبكة ولا قاعدة هنا: الدوال نقية (تطبيع الجوال يُمرَّر من الخارج) لتُختبر بلا مفتاح.
//
// الإخفاء: النموذج يرى الجوالات والبريد عناصر نائبة ([PHONE_1]). الاقتباس يُطابَق مع النص
// المُخفى كما رآه النموذج، ثم تُعاد القيم الأصلية (restore) قبل فحص القيمة وقبل الحفظ.
import { asciiDigits } from "../_shared/effort-router/digits.ts";

export { asciiDigits };

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
  suggested?: string; // اسم وصفي اقترحه المساعد لعرض بلا اسم؛ الواجهة تعلّمه ما دام الاسم هو نفسه
  stated?: boolean; // الاسم المقترح هو اسم ذكره المصدر ولم يُتحقق من اقتباسه (يبقى دليل هوية في فحص المكرر)
}

// code: سبب آلي ثابت يقرؤه مصنّف الفشل في الموجّه (classify.ts) بدل الملاحظة العربية
export interface Conflict {
  field?: string;
  value?: unknown;
  quote?: string | null;
  note: string;
  code?: string;
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
  stats: Stats; // لا يُحفظ: يقرؤه الموجّه ليقرر هل فشلت المحاولة
}

// ما أعاده النموذج بقيمة (غير المستنتج) وما رفضه المدقق منه، ورموز الرفض
export interface Stats {
  returned: number;
  rejected: number;
  rejections: string[];
}

export type PhoneNormalizer = (raw: string) => Promise<string | null>;
export type Restore = (text: string) => string;
const same: Restore = (text) => text;

/* ===================== تطبيع النص للمقارنة ===================== */

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

// تُطابَق على النص بعد normText: التاء المربوطة صارت هاءً («خمسه»)، وقد تسبقها «ال» («الخمس غرف»)
const NUMBER_WORDS: [RegExp, number][] = [
  [/(^|\s)(ال)?(واحد|واحده)(?=\s|$)/, 1], [/(غرفتين|غرفتان|دورتين|دورتان|اثنين|اثنان|اثنتين)/, 2],
  [/(^|\s)(ال)?(ثلاث|ثلاثه)(?=\s|$)/, 3], [/(^|\s)(ال)?(اربع|اربعه)(?=\s|$)/, 4], [/(^|\s)(ال)?(خمس|خمسه)(?=\s|$)/, 5],
  [/(^|\s)(ال)?(ست|سته)(?=\s|$)/, 6], [/(^|\s)(ال)?(سبع|سبعه)(?=\s|$)/, 7], [/(^|\s)(ال)?(ثمان|ثماني|ثمانيه)(?=\s|$)/, 8],
  [/(^|\s)(ال)?(تسع|تسعه)(?=\s|$)/, 9], [/(^|\s)(ال)?(عشر|عشره)(?=\s|$)/, 10],
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
  if (/مليونين|مليونان/.test(text)) out.push(2_000_000);
  // المبالغ المركّبة في عروض واتساب: «2 مليون و 700» و«مليون و 200 ألف» و«مليونين و300» — ما بعد الواو
  // آلاف إن كان أقل من ألف أو تلته «ألف»، وإلا فهو الرقم نفسه («1 مليون و 250,000»)
  // بلا واو («12مليون 500 الف») لا يُقرأ إلا إن تلا الباقيَ «ألف» أو كان ألفاً فأكثر، فلا يلتصق به عدد لاحق («مليون 5 غرف»)
  const compound = /(\d+(?:\.\d+)?)?\s*(مليونين|مليونان|مليون|ملايين)\s*(و)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(ألف|الف|آلاف|الاف)?/g;
  for (const m of text.matchAll(compound)) {
    const millions = /^مليون(ين|ان)$/.test(m[2]) ? 2 : m[1] ? Number(m[1]) : 1;
    const rest = Number(m[4].replace(/,/g, ""));
    if (!m[3] && !m[5] && rest < 1000) continue;
    out.push(millions * 1_000_000 + (m[5] || rest < 1000 ? rest * 1000 : rest));
  }
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
  stats: Stats = { returned: 0, rejected: 0, rejections: [] };
  restore: Restore;
  private byLabel = new Map<string, Src>();

  // sources: كما رآها النموذج (نصها مُخفى إن طُبّق الإخفاء)
  constructor(sources: Src[], private normalizePhone: PhoneNormalizer, restore: Restore = same) {
    for (const s of sources) this.byLabel.set(s.label.toUpperCase(), s);
    this.restore = restore;
  }

  source(label: string | null | undefined): Src | null {
    if (!label) return null;
    return this.byLabel.get(String(label).trim().toUpperCase()) ?? null;
  }

  // القيمة كما كانت قبل الإخفاء (نصوص داخل قائمة أيضاً)
  original(value: unknown): unknown {
    if (typeof value === "string") return this.restore(value);
    if (Array.isArray(value)) return value.map((v) => typeof v === "string" ? this.restore(v) : v);
    return value;
  }

  private miss(key: string) {
    if (!this.missing.includes(key)) this.missing.push(key);
  }

  // يعيد القيمة المقبولة أو undefined. أي رفض يُسجَّل بسببه ورمزه.
  async take(key: string, f: Field | null | undefined, rule: Rule): Promise<unknown> {
    if (!f || f.value === null || f.value === undefined || f.value === "") {
      this.miss(key);
      return undefined;
    }
    const seenQuote = typeof f.quote === "string" ? f.quote.trim() : ""; // كما كتبه النموذج
    const quote = this.restore(seenQuote);
    const value = this.original(f.value);

    // المستنتج ليس فشلاً: يُعرض ولا يُحفظ، ولا يدخل في نسبة الرفض
    if (f.inferred) {
      this.conflicts.push({ field: key, value, quote: quote || null, note: "قيمة مستنتجة لا يذكرها المصدر نصاً — لم تُدرج في المقترح", code: "inferred" });
      this.miss(key);
      return undefined;
    }
    this.stats.returned++;
    const src = this.source(f.source);
    if (!seenQuote || !src) {
      this.miss(key);
      return this.reject(key, value, "قيمة بلا اقتباس من مصدر معروف — لم تُدرج في المقترح", "no_quote");
    }

    // الاقتباس يُطابَق مع النص حين نملك نصه؛ PDF والصور لا نقرأ نصها هنا فتبقى "غير متحقَّق منها"
    let verified = false;
    if (src.text !== undefined) {
      verified = normText(src.text).includes(normText(seenQuote));
      if (!verified) {
        this.miss(key);
        return this.reject(key, value, "الاقتباس غير موجود في نص المصدر — لم تُدرج القيمة", "quote_not_found", quote);
      }
    }

    const checked = await this.check(key, value, rule, quote);
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

  private reject(key: string, value: unknown, note: string, code: string, quote?: string): undefined {
    this.stats.rejected++;
    this.stats.rejections.push(code);
    this.conflicts.push(quote === undefined ? { field: key, value, note, code } : { field: key, value, quote, note, code });
    return undefined;
  }

  // رفض قيمة قُبلت ثم تبيّن تعارضها مع غيرها: تخرج من الدليل ومن المقترح (يحذفها المنادي)
  drop(key: string, value: unknown, note: string, code: string) {
    delete this.evidence[key];
    this.miss(key);
    this.reject(key, value, note, code);
  }

  // رفض عدة قيم متعارضة معاً بملاحظة واحدة؛ كل قيمة تُحسب رفضاً
  dropAll(keys: string[], conflict: Conflict & { code: string }) {
    for (const key of keys) {
      delete this.evidence[key];
      this.miss(key);
      this.stats.rejected++;
      this.stats.rejections.push(conflict.code);
    }
    this.conflicts.push(conflict);
  }

  // ملاحظة لا ترفض شيئاً: تُعرض للمدير ولا تدخل نسبة الرفض
  note(conflict: Conflict) {
    this.conflicts.push(conflict);
  }

  // كل قيمة قُبلت واقتباسها وُجد حرفياً في نص المصدر. PDF والصور لا نقرأ نصها فلا تُعدّ متحقَّقاً منها.
  verified(keys: string[]): boolean {
    return keys.every((k) => this.evidence[k]?.verified === true);
  }

  quotes(keys: string[]): string {
    return [...new Set(keys.map((k) => this.evidence[k]?.quote).filter(Boolean))].join(" | ");
  }

  // الرقم نفسه في نص مصدره رقماً كاملاً، لا جزءاً من رقم أطول: مطابقة الاقتباس تمرّر «200,000» داخل «1,200,000»
  wholeNumberInSource(key: string, n: number): boolean {
    const id = this.evidence[key]?.source_id;
    const src = [...this.byLabel.values()].find((s) => s.id === id);
    return src?.text !== undefined && numbersIn(src.text).some((q) => Math.abs(q - n) <= Math.max(0.5, Math.abs(n) * 0.005));
  }

  // المصدر نفسه متناقض وكل قيمة مقتبسة منه حرفياً: ليس خطأ نموذج، فلا يُحسب رفضاً (لا إعادة ولا تصعيد).
  // القيم تخرج من المقترح والتعارض يُعرض للمدير باقتباساته، ولا تُذكر في «الناقص» لأن المصدر ذكرها.
  sourceContradiction(keys: string[], conflict: Conflict) {
    for (const key of keys) delete this.evidence[key];
    this.conflicts.push({ ...conflict, code: "source_contradiction" });
  }

  private async check(key: string, value: unknown, rule: Rule, quote: string): Promise<unknown> {
    switch (rule.kind) {
      case "string": {
        if (typeof value !== "string") return this.reject(key, value, "نوع غير صحيح — المتوقع نص", "type");
        const text = value.replace(/\s+/g, " ").trim();
        if (!text) return undefined;
        if (text.length > (rule.max ?? 300)) return this.reject(key, value, "نص أطول من المسموح", "too_long");
        return text;
      }
      case "number":
      case "int": {
        const n = typeof value === "number" ? value : Number(asciiDigits(String(value)).replace(/[,\s٬]/g, ""));
        if (!Number.isFinite(n)) return this.reject(key, value, "ليست رقماً", "type");
        if (rule.kind === "int" && !Number.isInteger(n)) return this.reject(key, value, "المتوقع عدد صحيح", "type");
        if (n < rule.min || n > rule.max) {
          return this.reject(key, value, `خارج المدى المعقول (${rule.min.toLocaleString("en")}–${rule.max.toLocaleString("en")})`, "range");
        }
        // الرقم نفسه يجب أن يُقرأ من الاقتباس: اقتباس حقيقي لا يحمل رقماً مؤلَّفاً
        if (!numbersIn(quote).some((q) => Math.abs(q - n) <= Math.max(0.5, Math.abs(n) * 0.005))) {
          return this.reject(key, value, "الرقم لا يظهر في الاقتباس", "number_not_in_quote");
        }
        return n;
      }
      case "enum":
        if (typeof value !== "string" || !rule.values.includes(value)) return this.reject(key, value, "قيمة غير معروفة", "unknown_value");
        return value;
      case "date": {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return this.reject(key, value, "تاريخ غير صالح", "bad_date");
        const d = new Date(value + "T00:00:00Z");
        const year = d.getUTCFullYear();
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value || year < 2000 || year > 2100) {
          return this.reject(key, value, "تاريخ غير صالح", "bad_date");
        }
        return value;
      }
      case "email": {
        const email = String(value).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return this.reject(key, value, "بريد غير صالح", "bad_email");
        if (!quote.toLowerCase().includes(email)) return this.reject(key, value, "البريد لا يظهر في الاقتباس", "email_not_in_quote");
        return email;
      }
      case "phone": {
        const raw = asciiDigits(String(value));
        // الأرقام نفسها يجب أن تظهر في الاقتباس: لا رقم مؤلَّف من خارج المصدر
        const digits = digitsOnly(raw).replace(/^(00966|966|0)/, "");
        if (digits.length < 8 || !digitsOnly(quote).includes(digits)) {
          return this.reject(key, value, "أرقام الجوال لا تظهر في الاقتباس", "phone_not_in_quote");
        }
        const normalized = await this.normalizePhone(raw);
        if (!normalized || !PHONE_OK.test(normalized)) return this.reject(key, value, "رقم جوال غير صالح بعد التطبيع", "bad_phone");
        return normalized;
      }
      case "strings": {
        if (!Array.isArray(value)) return this.reject(key, value, "المتوقع قائمة", "bad_list");
        const items = value.map((v) => String(v ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
        if (!items.length) return undefined;
        if (items.length > 30 || items.some((v) => v.length > (rule.max ?? 80))) return this.reject(key, value, "قائمة غير معقولة", "bad_list");
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
  for (const s of scanned) add({ ...s, quote: checker.restore(s.quote) });
  for (const s of fromModel ?? []) {
    if (!s || typeof s.quote !== "string") continue;
    add({
      quote: checker.restore(s.quote).slice(0, 500),
      source_id: checker.source(s.source)?.id ?? null,
      reason: checker.restore(String(s.reason || "نص مريب في المصدر")).slice(0, 300),
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
function foreignRole(phone: string, found: PhoneFound[] | undefined, restore: Restore): string | null {
  const digits = digitsOnly(restore(phone)).slice(-9);
  for (const p of found ?? []) {
    if (p.role === "client") continue;
    if (digitsOnly(restore(String(p.number ?? ""))).slice(-9) === digits) return p.role;
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

export async function buildClientDraft(out: Json, sources: Src[], normalizePhone: PhoneNormalizer, restore: Restore = same): Promise<DraftSpec> {
  const c = new Checker(sources, normalizePhone, restore);
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
    const role = foreignRole(raw, out?.phones_found, c.restore);
    if (role) {
      c.drop(key, c.restore(raw), (ROLE_AR[role] ?? "رقم لا يخص العميل") + " — لا يُعتمد جوالاً للعميل", "phone_role");
      delete proposed[key];
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

    // حد أدنى أكبر من الأعلى يبقى رفضاً استدلالياً حتى مع اقتباسين حرفيين: تبديل الطرفين يجعله متسقاً،
    // فالأرجح أن النموذج قرأ «من … إلى …» بالعكس (خطأ النموذج نفسه)، لا أن المصدر متناقض
    for (const [lo, hi] of [["budget_min", "budget_max"], ["area_min", "area_max"]]) {
      if (typeof req[lo] === "number" && typeof req[hi] === "number" && (req[lo] as number) > (req[hi] as number)) {
        c.dropAll(["requirement." + lo, "requirement." + hi], {
          field: "requirement." + lo, value: [req[lo], req[hi]], note: "الحد الأدنى أكبر من الأعلى — لم يُدرج أيٌّ منهما", code: "cross_field",
        });
        for (const k of [lo, hi]) delete req[k];
      }
    }

    if (req.purpose && req.property_type) {
      proposed.requirement = req;
    } else if (Object.keys(req).length) {
      c.note({ field: "requirement", note: "المصدر يذكر مطلباً عقارياً دون الغرض أو نوع العقار — لم يُرفق الطلب بالمسودة", code: "requirement_incomplete" });
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
    stats: c.stats,
  };
}

/* ===================== المشروع ===================== */

export async function buildProjectDraft(out: Json, sources: Src[], normalizePhone: PhoneNormalizer, restore: Restore = same): Promise<DraftSpec> {
  const c = new Checker(sources, normalizePhone, restore);
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
  const perM: Record<string, unknown> = {};
  await put(perM, "price_per_m", "price_per_m", p.price_per_m, PRICE_PER_M);
  const wording = priceWording(c, p.price_text);

  if ((proposed.latitude === undefined) !== (proposed.longitude === undefined)) {
    const present = proposed.latitude !== undefined ? "latitude" : "longitude";
    c.dropAll([present], { field: "latitude", note: "إحداثية واحدة دون الأخرى — لم يُدرج الموقع", code: "cross_field" });
    delete proposed[present];
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
    await put(m, "price_per_m", base + "price_per_m", u.price_per_m, PRICE_PER_M);
    totalVsPerMetre(c, base, m);
    if (!Object.keys(m).length) continue;
    if (!m.name) m.name = "نموذج " + (models.length + 1);
    priceSanity(c, base, m.price, m.area);
    models.push(m);
  }
  // عرض وحدة واحدة بلا نماذج: السعر والمساحة وسعر المتر على مستوى المشروع
  if (!models.length) {
    const offer = { price: proposed.price, area: proposed.area, price_per_m: perM.price_per_m };
    totalVsPerMetre(c, "", offer);
    if (offer.price === undefined) delete proposed.price;
    perM.price_per_m = offer.price_per_m;
  }
  // سعر المتر يُحفظ كما ذكره المصدر («سعر المتر 3,500» أو «سعر المتر يبدأ من …» مع نماذج)
  if (perM.price_per_m !== undefined) {
    details.price_per_m = perM.price_per_m;
    c.evidence["details.price_per_m"] = c.evidence.price_per_m;
  }
  delete c.evidence.price_per_m;
  c.missing = c.missing.filter((k) => k !== "price_per_m");
  // عرض بنموذج واحد مسعّر ولا سعر للمشروع: سعر النموذج هو سعر العرض نفسه، فيُحفظ في حقل السعر
  // (اللوحة تقرأ سعر غير الشقق من حقل السعر وحده)
  if (proposed.price === undefined && models.length === 1 && typeof models[0].price === "number") {
    const unitKey = Object.keys(c.evidence).find((k) => /^units\.\d+\.price$/.test(k));
    proposed.price = models[0].price;
    if (unitKey) c.evidence.price = c.evidence[unitKey];
    c.missing = c.missing.filter((k) => k !== "price");
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
      c.note({ field: "price", value: proposed.price, note: `سعر البداية أعلى من أرخص وحدة (${cheapest.toLocaleString("en")}) — راجع أيهما الصحيح`, code: "price_order" });
    }
  }
  priceSanity(c, "", proposed.price, undefined);
  priceGuard(c, sources, proposed, details, models, wording);
  suggestName(c, sources, proposed, models, p.name, p.suggested_name);

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
    stats: c.stats,
  };
}

// سعر المتر كما يذكره المصدر: يُحفظ (details.price_per_m أو في النموذج)، ولا يُحسب منه إجمالي أبداً
const PRICE_PER_M = { kind: "number", min: 100, max: 200_000 } as const;

// الإجمالي يساوي حاصل ضرب الآخرَين بهامش 3%
const agrees = (total: number, a: number, b: number) => Math.abs(total - a * b) <= Math.abs(total) * 0.03;

// أرقام الاقتباسات تتسق بقراءة ما (سعر في مداه = مساحة × سعر متر): المصدر متسق، والنموذج أخذ رقماً من غير موضعه
// في سطر يحمل أكثر من رقم («المساحة 150 م، سعر المتر 7,000» ← مساحة 7,000)
function consistentReading(quotes: string[]): boolean {
  const nums = [...new Set(quotes.flatMap((q) => numbersIn(q)))];
  const within = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;
  return nums.some((p) => within(p, PRICE) &&
    nums.some((a) => within(a, AREA) && nums.some((m) => within(m, PRICE_PER_M) && agrees(p, a, m))));
}

// السعر الإجمالي والمساحة وسعر المتر معاً في المصدر: إن لم يتفقوا فلا يُدرج السعر ولا سعر المتر ويُعرض
// التناقض للمدير، والمساحة تبقى. من المسؤول عن التناقض:
//   - المصدر: كل اقتباس في نص المصدر حرفياً، وكل رقم فيه رقماً كاملاً، ولا قراءة أخرى لأرقام الاقتباسات
//     تتسق → المسودة تُنشأ والتعارض ملاحظة للمدير، بلا إعادة ولا تصعيد.
//   - النموذج: رقم من غير موضعه أو جزء من رقم أطول، أو اقتباس لا نتحقق منه (PDF أو صورة) → رفض استدلالي
//     كما كان. والرقم الذي لا يظهر في اقتباسه (من حساب النموذج) رُفض قبل هذا في take().
function totalVsPerMetre(c: Checker, base: string, m: Record<string, unknown>) {
  const { price, area, price_per_m: perM } = m as { price?: unknown; area?: unknown; price_per_m?: unknown };
  if (typeof price === "number" && typeof area === "number" && typeof perM === "number" && area > 0) {
    if (!agrees(price, area, perM)) {
      const fmt = (n: number) => n.toLocaleString("en");
      const sum = `السعر الإجمالي ${fmt(price)} لا يساوي المساحة × سعر المتر (${fmt(area)} × ${fmt(perM)} = ${fmt(Math.round(area * perM))})`;
      const value = { price, area, price_per_m: perM };
      const keys = [base + "price", base + "area", base + "price_per_m"];
      const fromSource = c.verified(keys) &&
        [price, area, perM].every((n, i) => c.wholeNumberInSource(keys[i], n)) &&
        !consistentReading(keys.map((k) => c.evidence[k].quote));
      if (fromSource) {
        c.sourceContradiction([base + "price", base + "price_per_m"], {
          field: base + "price",
          value,
          quote: c.quotes(keys),
          note: `المصدر نفسه متناقض: ${sum} — كل رقم مقتبس منه حرفياً، فلم يُدرج السعر ولا سعر المتر والحسم للمدير`,
        });
      } else {
        c.dropAll([base + "price", base + "price_per_m"], {
          field: base + "price",
          value,
          note: `${sum} — لم يُدرج السعر ولا سعر المتر`,
          code: "cross_field",
        });
      }
      delete m.price;
      delete m.price_per_m;
    }
  }
}

/* ===================== الاسم المقترح ===================== */

// التشكيل والتطويل والرموز (الإيموجي و«📍») تُحذف من القيمة قبل أن يُبنى منها اسم
function clean(value: string): string {
  return value.replace(/[ً-ْٰـ]/g, "")
    .replace(/[\p{Extended_Pictographic}\p{So}️‍]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

// كلمات القيمة بعد التطبيع، بلا ترقيم على أطرافها («السامر.» ← السامر)
function tokens(value: string): string[] {
  return normText(value).split(" ").map((w) => w.replace(/^[.@+]+|[.@+]+$/g, "")).filter(Boolean);
}

// صيغ كلمة المصدر بلا حروف العطف والجر والتعريف الملتصقة: «وفلل» ← فلل، «للياسمين» ← الياسمين، «بالسامر» ← السامر
function sourceForms(word: string): string[] {
  const out = new Set([word]);
  const bases = /^[وف]/.test(word) && word.length > 3 ? [word, word.slice(1)] : [word];
  for (const b of bases) {
    out.add(b);
    const m = b.match(/^(بال|كال|لل|ال|ب|ل|ك)(.{2,})$/);
    if (m) {
      out.add(m[2]);
      out.add("ال" + m[2]);
    }
  }
  return [...out];
}

const nameForms = (word: string) => [word, word.replace(/^ال(?=..)/, "")];

// كلمات ربط لا تُطلب في المصدر: «حي» يضيفها قالب الاسم نفسه
const NAME_GLUE = new Set(["حي", "في", "و"]);

// كل كلمات القيمة (والأرقام أيضاً) في النصوص. null: لا نص يُتحقق عليه (PDF أو صورة)
function grounded(value: string, texts: string[]): boolean | null {
  if (!texts.length) return null;
  const pool = new Set(texts.flatMap((t) => tokens(t).flatMap(sourceForms)));
  const words = tokens(value).filter((w) => !NAME_GLUE.has(w));
  return words.length > 0 && words.every((w) => nameForms(w).some((x) => pool.has(x)));
}

// نصوص المصدر الذي يستشهد به الحقل، أو كل نصوص الطلب إن لم يسمِّ مصدراً
function textsFor(c: Checker, sources: Src[], label: string | null | undefined): string[] {
  const src = c.source(label);
  if (src) return src.text === undefined ? [] : [src.text];
  return sources.filter((s) => s.text !== undefined).map((s) => s.text as string);
}

const PLACEHOLDER = /\[(PHONE|EMAIL)_/;

// كلمات لا تجعل النص اسماً: نوع العقار، ووصف الإعلان، والربط، والمدن. تُطابَق بصيغها بلا سوابق («بجدة»، «وملحق»).
const PROPERTY = new Set([
  "فيلا", "فيله", "فلل", "فله", "فلتين", "شقه", "شقق", "شقتين", "ارض", "اراضي", "قطعه", "دور", "ادوار", "دوبلكس",
  "دبلكس", "دوبليكس", "عماره", "عمائر", "عمارتين", "محل", "محلات", "مكتب", "مكاتب", "معرض", "مستودع", "استراحه",
  "شاليه", "بيت", "منزل", "قصر", "تاون", "هاوس", "روف", "ملحق", "مبني", "مجمع", "عقار", "وحده", "وحدات", "برج",
  "هدد", "محطه", "فندق", "فندقي",
]);
const SALE = new Set(["للبيع", "للايجار", "للتاجير"]);
const DESCRIPTIVE = new Set([
  ...SALE, "عرض", "تمليك", "سكني", "سكنيه", "تجاري", "تجاريه", "استثماري", "استثماريه", "للاستثمار", "مميز", "مميزه",
  "فاخر", "فاخره", "فخم", "فخمه", "راقي", "راقيه", "مودرن", "جديد", "جديده", "قديم", "قديمه", "نظيف", "نظيفه", "فرصه",
  "لقطه", "جاهز", "جاهزه", "مستقل", "مستقله", "اماميه", "زاويه", "ركنيه", "مؤثثه", "موثثه", "مفروشه", "سنوي", "السنوي",
  "شهري", "غرف", "غرفه", "غرفتين", "دورين", "مساحه", "بسعر", "مغري", "خام", "زراعيه", "كاش", "افراغ", "فوري",
  "شمال", "جنوب", "شرق", "غرب", "شمالي", "جنوبي", "شرقي", "غربي", "شارع", "شارعين", "طريق",
]);
const GLUE = new Set(["في", "ف", "حي", "بحي", "الحي", "ب", "مدينه", "بمدينه", "مخطط", "و", "من", "على", "مع", "قرب", "بجوار", "خلف", "امام"]);
const CITIES = new Set(["جده", "الرياض", "مكه", "المكرمه", "المدينه", "المنوره", "الدمام", "الخبر", "الطائف", "الاحساء", "ابها", "تبوك", "ينبع", "رابغ"]);
// كلمات تبدأ بها أسماء حقيقية («برج الروضة»، «عمارة النخبة»، «مجمع الياسمين السكني»)
const NAMED = new Set(["برج", "ابراج", "مجمع", "مشروع", "عماره", "فندق", "مركز"]);

const inSet = (set: Set<string>, word: string) => sourceForms(word).some((x) => set.has(x));

// عنوان إعلان لا اسم. مع علامة البيع («للبيع/للإيجار»): عنوان إلا أن يكون قصيراً بلا «في/حي» وفيه كلمة تسمّي
// («عمارة النخبة للبيع» اسم؛ «شقة 5 غرف للبيع»، «فيلا للبيع في حي السامر» عنوانان). بلا علامة: عنوان إن بدأ بنوع
// عقار أو وصف ثم جاء «في/حي» أو لم يبقَ ما يسمّي («شقة حي الشاطئ»، «فيلا شمال جدة»، «شقه تمليك جده حي المروه»).
// «برج/مجمع/عمارة/مشروع» + كلمة أو كلمتان اسم، ونوعٌ ثم رقم اسم. ما بدأ بنوع أو وصف وزاد على ست كلمات وصفٌ لا اسم.
function isHeadline(name: string, location: string[]): boolean {
  const loc = new Set(location.flatMap((l) => tokens(l)).flatMap(sourceForms));
  const words = tokens(clean(name));
  if (!words.length) return false;
  const after = (i: number) => i > 0 && ["حي", "بحي", "الحي"].includes(words[i - 1]);
  const isLoc = (w: string, i: number) => inSet(CITIES, w) || sourceForms(w).some((x) => loc.has(x)) || after(i);
  const glue = words.some((w) => ["في", "ف", "حي", "بحي", "الحي"].includes(w));
  const proper = words.filter((w, i) => !/^\d/.test(w) && !inSet(PROPERTY, w) && !inSet(DESCRIPTIVE, w) && !GLUE.has(w) && !isLoc(w, i));
  if (words.some((w) => inSet(SALE, w))) {
    return glue || words.filter((w) => !inSet(SALE, w)).length > 3 || proper.length === 0;
  }
  if (NAMED.has(words[0]) && words.length <= 3 && !glue) return false;
  // نوع ثم رقم أو رمز اسمٌ («المنزل 104»، «عمارة F14»، «عمارة 499 – حي الواحة»)، إلا أن يتلوه وصف («شقة 4 غرف»)
  if (words.length > 1 && /\d/.test(words[1]) && !(words[2] && inSet(DESCRIPTIVE, words[2]))) return false;
  if (!inSet(PROPERTY, words[0]) && !inSet(DESCRIPTIVE, words[0])) return false;
  return words.length > 6 || glue || proper.length === 0;
}

// علامة البيع أو الإيجار تُحذف من الاسم مع ما حولها من ترقيم («جوهرة الصفا - للبيع» ← جوهرة الصفا)
function stripSale(name: string): string {
  return name.replace(/ـ/g, "")
    .replace(/(^|[\s\-–—(\[،,:])لل(بيع|إيجار|ايجار|تأجير|تاجير)(?=$|[\s\-–—)\].!،,:])[)\].!]*/g, " ")
    .replace(/\s+/g, " ").replace(/[\s\-–—:،,(\[]+$/, "").replace(/^[\s\-–—:،,)\]]+/, "").trim();
}

// الاسم كما يُعرض: بلا رموز ولا علامة بيع، ولا ذيل وصفي بعد شرطة («برج الندى - شقق للبيع 🔥» ← برج الندى)
function stripName(name: string): string {
  let v = stripSale(clean(name));
  const m = v.match(/^(.*\S)\s*[\-–—|]\s*([^\-–—|]+)$/);
  if (m && tokens(m[2]).length && tokens(m[2]).every((w) => inSet(PROPERTY, w) || inSet(DESCRIPTIVE, w))) v = m[1];
  return v.replace(/[\s.،,!:\-–—|]+$/, "").trim();
}

// نوع العقار للاسم: بلا «للبيع» و«عرض» ولا ما بعد «في/حي» من موقع («فيلا للبيع في حي السامر» ← فيلا)
function kindOf(raw: string): string {
  const words = clean(raw).split(" ");
  const out: string[] = [];
  for (const word of words) {
    const t = tokens(word)[0] ?? "";
    if (["في", "حي", "بحي", "بمدينه", "مدينه"].includes(t) || inSet(CITIES, t)) break;
    if (t && !inSet(SALE, t) && !(t === "عرض" && out.length === 0)) out.push(word);
  }
  return out.join(" ").replace(/[\s.،,!\-–—:]+$/, "").replace(/^[\s\-–—:،,]+/, "").trim();
}

// اسم الحي أو المدينة بلا «في» و«حي/الحي/بحي» و«مدينة» في أوله، ولا ترقيم في آخره («📍 في حيّ:السامر.» ← السامر)
function placeOf(raw: string): string {
  let v = clean(raw).replace(/^[\s\-–—:،,.]+/, "");
  v = v.replace(/^(?:في\s+)?(?:ال)?[بف]?ح[يى](?=$|[\s:：\-–—/،,])[\s:：\-–—/،,]*/, "");
  v = v.replace(/^(?:بمدينة|مدينة|بمدينه|مدينه|في)\s+/, "");
  return v.replace(/[\s.،,!:\-–—/]+$/, "").trim();
}

// اسم للعرض حين لا يذكر المصدر اسماً، حتى لا يتعطل الاعتماد (الاسم إلزامي) ولا يعدّله المدير في كل مسودة:
//   1) اسم حقيقي مقبول يبقى (وتُحذف منه علامة «للبيع»). عنوان الإعلان ليس اسماً.
//   2) اسم أعاده النموذج ورُفض (اقتباس لا يطابق، أو «مستنتج») لا يُستبدل باسم عام: يُقترح هو نفسه إن كانت كل
//      كلماته وأرقامه في نص مصدره، وإلا (أو كان مصدره PDF لا نص له) يبقى الاسم ناقصاً ليكتبه المدير.
//   3) لا اسم: «<النوع> – حي <الحي>» (أو المدينة) من الحقول المقبولة، وإلا اقتراح النموذج إن كانت كلماته في المصدر
//      ويوافق الحقول المقبولة، وإلا «عقار – حي <الحي>».
// يُعلَّم في الدليل (suggested؛ و stated حين يكون الاسم المذكور نفسه) وبملاحظة «name_suggested» صادقة السبب.
// لا يدخل إحصاء الرفض: لا إعادة ولا تصعيد بسببه.
function suggestName(
  c: Checker, sources: Src[], proposed: Record<string, unknown>, models: Record<string, unknown>[],
  given: Field | null | undefined, f: Field | null | undefined,
) {
  const district = typeof proposed.district === "string" ? placeOf(proposed.district) : "";
  const city = typeof proposed.city === "string" ? placeOf(proposed.city) : "";
  const location = [district, city].filter(Boolean);

  let headline: string | null = null;
  let headlineEv: Evidence | undefined;
  if (typeof proposed.name === "string" && proposed.name) {
    headlineEv = c.evidence.name;
    if (!isHeadline(proposed.name, location)) {
      const shown = stripName(proposed.name);
      if (shown) proposed.name = shown;
      return;
    }
    headline = proposed.name;
  }
  const said = !headline && given && typeof given.value === "string" ? given.value.replace(/\s+/g, " ").trim() : "";
  if (said && isHeadline(c.restore(said), location)) {
    headline = c.restore(said);
  } else if (said) {
    if (PLACEHOLDER.test(said) || said.length > 80 || grounded(said, textsFor(c, sources, given?.source)) !== true) return;
    const name = stripName(c.restore(said)) || c.restore(said);
    // «مستنتج»: صاغه المساعد من كلمات المصدر فهو اقتراح لا هوية؛ غيره ذكره المصدر ورُفض اقتباسه فيبقى هوية للمكرر
    return given?.inferred
      ? setSuggested(c, proposed, name, "", c.source(given?.source)?.id ?? null, false,
        "الاسم «" + name + "» استنتجه المساعد من كلمات المصدر ولا يذكره المصدر نصاً — اسم مقترح، راجعه قبل الاعتماد")
      : setSuggested(c, proposed, name, "", c.source(given?.source)?.id ?? null, true,
        "الاسم «" + name + "» كلماته في المصدر لكن اقتباسه لم يُتحقق منه — اسم مقترح، راجعه قبل الاعتماد");
  }

  const reason = headline ? "«" + headline + "» عنوان إعلان لا اسم" : "المصدر لا يذكر اسماً للعرض";
  // نوع المشروع، أو نوع وحداته إن اتفقت كلها («شقة» لمشروع فيه شقق وفلل لا تصح)
  const unitKinds = [...new Set(models.map((m) => typeof m.type === "string" ? kindOf(m.type) : "").filter(Boolean))];
  const ownKind = typeof proposed.type === "string" ? kindOf(proposed.type) : "";
  const unitKind = unitKinds.length === 1 && models.every((m) => typeof m.type === "string") ? unitKinds[0] : "";
  // لا نوع في الحقول: كلمة النوع في العنوان نفسه («شقة حي الشاطئ» ← شقة)
  const headKind = headline ? clean(headline).split(" ").find((w) => inSet(PROPERTY, tokens(w)[0] ?? "")) ?? "" : "";
  const kind = ownKind || unitKind || headKind;
  const kindEv = ownKind ? c.evidence.type
    : unitKind ? c.evidence[Object.keys(c.evidence).find((k) => /^units\.\d+\.type$/.test(k)) ?? ""]
    : headKind ? headlineEv : undefined;
  const partsEv = (withKind: boolean) => {
    const ev = [withKind ? kindEv : undefined, district ? c.evidence.district : c.evidence.city].filter((e): e is Evidence => Boolean(e));
    const ids = [...new Set(ev.map((e) => e.source_id))];
    return { quote: [...new Set(ev.map((e) => e.quote))].join(" | "), id: ids.length === 1 ? ids[0] : null };
  };
  const place = district ? "حي " + district : city;

  if (kind && place && (kind + " – " + place).length <= 80) {
    const q = partsEv(true);
    return setSuggested(c, proposed, kind + " – " + place, q.quote, q.id, false,
      reason + " — اسم مقترح من نوع العقار و" + (district ? "حيّه" : "مدينته") + " كما استُخرجا منه، راجعه قبل الاعتماد");
  }

  const src = f ? c.source(f.source) : null;
  const offered = f && typeof f.value === "string" && src ? f.value.replace(/\s+/g, " ").trim() : "";
  if (src && offered && !PLACEHOLDER.test(offered) && offered.length <= 80) {
    const shown = stripName(c.restore(offered));
    const check = grounded(offered, textsFor(c, sources, f?.source));
    // يوافق الحقول المقبولة: كل كلمة من النوع والحي أو المدينة المقبولة موجودة في الاقتراح
    const pool = new Set(tokens(shown).flatMap(sourceForms));
    const agrees = [kind, district || city].filter(Boolean).every((v) => tokens(v).every((w) => nameForms(w).some((x) => pool.has(x))));
    if (shown && check !== false && agrees) {
      const q = typeof f?.quote === "string" ? f.quote.trim() : "";
      const quoted = q !== "" && tokens(q).length > 0 && src.text !== undefined && normText(src.text).includes(normText(q));
      return setSuggested(c, proposed, shown, quoted ? c.restore(q) : "", src.id, false,
        reason + (check === null
          ? " — اسم مقترح من المساعد من ملف لم يُتحقق من كلماته آلياً، راجعه قبل الاعتماد"
          : " — اسم مقترح من المساعد بكلمات المصدر، راجعه قبل الاعتماد"));
    }
  }

  if (district && ("عقار – " + place).length <= 80) {
    const q = partsEv(false);
    return setSuggested(c, proposed, "عقار – " + place, q.quote, q.id, false,
      reason + " — اسم مقترح من الحي كما استُخرج منه، راجعه قبل الاعتماد");
  }
  // لا شيء يُبنى منه اسم: يبقى العنوان إن كان هو «الاسم» (أفضل من لا اسم)، وإلا يبقى الاسم ناقصاً
}

function setSuggested(
  c: Checker, proposed: Record<string, unknown>, name: string, quote: string, sourceId: string | null, stated: boolean, note: string,
) {
  proposed.name = name;
  c.evidence.name = { quote, page: null, source_id: sourceId, verified: false, suggested: name, ...(stated ? { stated: true } : {}) };
  c.missing = c.missing.filter((k) => k !== "name");
  c.note({ field: "name", value: name, note, code: "name_suggested" });
}

/* ===================== السعر لا يضيع بصمت ===================== */

// نص السعر كما نقله النموذج (price_text): يُقبل إن وُجد اقتباسه في نص المصدر، أو كان مصدره PDF أو صورة
// لا نقرأ نصها. لا يدخل إحصاء الرفض: غرضه أن يُحفظ نص السعر حين لا يُفهم رقماً، لا أن يُعاد الطلب بسببه.
function priceWording(c: Checker, f: Field | null | undefined): string | undefined {
  if (!f || f.inferred || typeof f.value !== "string" || !f.value.trim()) return undefined;
  const src = c.source(f.source);
  if (!src) return undefined;
  const quote = typeof f.quote === "string" && f.quote.trim() ? f.quote.trim() : f.value.trim();
  if (src.text !== undefined && !normText(src.text).includes(normText(quote))) return undefined;
  return quote;
}

export const isPriceField = (field: string | undefined) => /(^|\.)(price|price_per_m)$/.test(String(field ?? ""));

// كلمات السعر. «ألف/مليون» وحدهما لا تكفيان في سطر فيه مساحة («3 آلاف متر»).
const PRICE_WORD = /(سعر|اسعار|ريال|ر\.س|﷼|sar|price|سوم|بالخاص)/;
const AMOUNT_WORD = /(^| |\d)(الف|الاف|مليون|ملايين|k)( |$)/;
const AREA_WORD = /(متر|م2|م²|m2|sqm)/;
const NO_NUMBER_PRICE = /(سوم|بالخاص|عند التواصل)/;

// أسطر نص المصدر التي تذكر سعراً — فحص مستقل عن النموذج. الجوال والبريد يبقيان عنصراً نائباً
// (النص كما رآه النموذج) فلا يُنسخ رقم أحد إلى ملاحظات المشروع.
export function priceLines(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (!s.text) continue;
    for (const raw of s.text.split(/\r?\n/)) {
      const line = raw.replace(/\[(PHONE|EMAIL)_\d+\]/g, "…").replace(/\s+/g, " ").trim();
      if (!line) continue;
      // المطبَّع يوحّد الهمزات والأرقام، والأصلي يحفظ «﷼» و«م²» اللذين يحذفهما التطبيع
      const t = normText(line) + " | " + asciiDigits(line).toLowerCase();
      const hasDigit = /\d/.test(t);
      const priced = PRICE_WORD.test(t) || (AMOUNT_WORD.test(t) && !AREA_WORD.test(t));
      if (priced && (hasDigit || (PRICE_WORD.test(t) && NO_NUMBER_PRICE.test(t)))) out.push(line.slice(0, 200));
      if (out.length >= 3) return out;
    }
  }
  return out;
}

// المصدر يذكر سعراً ولم يُحفظ منه شيء (لا سعر ولا سعر متر في المشروع أو نماذجه): نص السعر يُحفظ في
// الملاحظات، وتنبيه للمدير. سعر المتر وحده بلا إجمالي يُحفظ ويُنبَّه إلى أن حقل السعر فارغ.
function priceGuard(
  c: Checker, sources: Src[], proposed: Record<string, unknown>, details: Record<string, unknown>,
  models: Record<string, unknown>[], wording: string | undefined,
) {
  const hasTotal = typeof proposed.price === "number" || models.some((m) => typeof m.price === "number");
  const hasPerM = typeof details.price_per_m === "number" || models.some((m) => typeof m.price_per_m === "number");
  if (hasTotal) return;
  if (hasPerM) {
    c.note({ field: "price", note: "المصدر يذكر سعر المتر فقط — حُفظ في «سعر المتر» وبقي حقل السعر فارغاً", code: "price_per_m_only" });
    return;
  }
  const lines = priceLines(sources);
  const texts = [...new Set([...(wording ? [wording.replace(/\[(PHONE|EMAIL)_\d+\]/g, "…")] : []), ...lines])];
  // سطر يحوي نص النموذج نفسه لا يُكرَّر
  const said = texts.filter((t, i) => !texts.some((o, j) => j !== i && o.length > t.length && normText(o).includes(normText(t))));
  if (!said.length) return;
  const note = "السعر كما ورد في المصدر: " + said.map((t) => "«" + t + "»").join(" — ");
  proposed.notes = typeof proposed.notes === "string" && proposed.notes ? proposed.notes + "\n" + note : note;
  // سعر أُسقط بتعارض ظاهر للمدير (تناقض المصدر، رقم لا يطابق اقتباسه…) له تنبيهه؛ لا يُكرَّر
  if (c.conflicts.some((x) => isPriceField(x.field))) return;
  c.note({
    field: "price",
    quote: said.join(" | "),
    note: "المصدر يذكر سعراً لم يُستخرج رقماً — نصه محفوظ في الملاحظات، راجعه وأدخل السعر قبل الاعتماد",
    code: "price_unread",
  });
}

// سعر المتر خارج 500–100,000 ريال علامة على خطأ قراءة. لا يُسقط القيمة: يُعرض تعارضاً.
function priceSanity(c: Checker, base: string, price: unknown, area: unknown) {
  if (typeof price !== "number" || typeof area !== "number" || area <= 0) return;
  const perM = price / area;
  if (perM < 500 || perM > 100_000) {
    c.note({ field: base + "price", value: price, note: `سعر المتر ${Math.round(perM).toLocaleString("en")} ريال غير معقول — تحقق من السعر والمساحة`, code: "price_sanity" });
  }
}

/* ===================== التحديث ===================== */

export interface UpdateTarget {
  project_name?: string;
  district?: string;
  unit_name?: string;
}

export function updateTarget(out: Json, restore: Restore = same): UpdateTarget {
  const t = out?.target ?? {};
  const val = (f: Field | undefined) =>
    f && !f.inferred && typeof f.value === "string" && f.value.trim() ? restore(f.value.trim()) : undefined;
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
  restore: Restore = same,
): Promise<DraftSpec | null> {
  const c = new Checker(sources, normalizePhone, restore);
  const proposed: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  const changes: Json[] = (Array.isArray(out?.changes) ? out.changes : []).filter((ch: Json) => ch?.scope === scope);
  if (!changes.length) return null;

  for (const ch of changes) {
    const f: Field = { value: ch.value, quote: ch.quote, page: ch.page, source: ch.source, inferred: Boolean(ch.inferred) };
    let evKey: string;
    let rule: Rule;
    const hasValue = ch.value !== null && ch.value !== undefined && ch.value !== "" && !ch.inferred;
    const refuse = (key: string, note: string, code: string, quote?: string) => {
      if (hasValue) {
        c.stats.returned++;
        c.stats.rejected++;
        c.stats.rejections.push(code);
      }
      c.note({ field: key, value: c.original(ch.value), ...(quote === undefined ? {} : { quote }), note, code });
    };
    if (scope === "project") {
      const spec = PROJECT_RULES[ch.field];
      if (!spec) {
        refuse(String(ch.field), "حقل لا يُحدَّث على مستوى المشروع", "unsupported_field");
        continue;
      }
      evKey = spec.key;
      rule = spec.rule;
    } else {
      const r = UNIT_RULES[ch.field];
      if (!r) {
        refuse(String(ch.field), "حقل لا يُحدَّث على مستوى الوحدة", "unsupported_field");
        continue;
      }
      evKey = ch.field;
      rule = r;
    }
    if (c.evidence[evKey]) {
      // المصدر يكرر القيمة نفسها (تُفحص على مدقق منفصل لا يمسّ دليل الأولى): لا تعارض
      const probe = new Checker(sources, normalizePhone, restore);
      const second = await probe.take(evKey, f, rule);
      const first = evKey.startsWith("details.") ? details[evKey.slice(8)] : proposed[evKey];
      if (second !== undefined && JSON.stringify(second) === JSON.stringify(first)) continue;
      // قيمتان مختلفتان لحقل واحد في طلب تحديث تبقيان رفضاً يُعاد بسببه، حتى باقتباسين حرفيين: الغالب
      // «السعر السابق … والجديد …» أخذ النموذجُ منهما القديم، والأولى تبقى في المقترح فلا تُعتمد بنقرة خطأً
      refuse(evKey, "المصدر يذكر قيمتين لهذا الحقل — أُخذت الأولى", "source_conflict", c.restore(String(ch.quote ?? "")));
      continue;
    }
    const v = await c.take(evKey, f, rule);
    if (v === undefined) continue;

    const before = evKey.startsWith("details.")
      ? (current.details as Record<string, unknown> | undefined)?.[evKey.slice(8)]
      : current[evKey];
    c.evidence[evKey].before = before ?? null;
    c.evidence[evKey].reason = typeof ch.reason === "string" ? c.restore(ch.reason).slice(0, 300) : null;
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
    stats: c.stats,
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
