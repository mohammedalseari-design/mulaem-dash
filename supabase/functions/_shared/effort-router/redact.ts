// إخفاء الجوالات والبريد من النص قبل أي نداء نموذج، وإعادتها بعده.
//
// الرقم نفسه (مهما اختلفت كتابته: مسافات، شرطات، +966 أو 05، أرقام عربية) يأخذ رقم العنصر
// النائب نفسه في كل المصادر، فيبقى النموذج قادراً على ربط "الرقم في الرسالة" بـ"الرقم في
// التوقيع". كل كتابة مختلفة للرقم نفسه تأخذ فرعاً ([PHONE_1] ثم [PHONE_1.2]) فتعود حرفياً كما
// كُتبت، ويبقى الاقتباس المعروض للمدير مطابقاً للمصدر. الخريطة في الذاكرة فقط.
import { asciiDigits } from "./digits.ts";

// سلسلة أرقام (لاتينية أو عربية) بفواصل مسافة أو شرطة أو نقطة أو أقواس، وقد تبدأ بـ + أو 00
const PHONE_CANDIDATE = /(?:\+|00)?[\d٠-٩۰-۹(](?:[\d٠-٩۰-۹]|[\s\-.()](?=[\s\-.()]?[\d٠-٩۰-۹(])){6,24}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// المفتاح الموحّد للرقم، أو null إن لم يكن جوالاً/هاتفاً بصيغة معروفة
export function phoneKey(candidate: string): string | null {
  const raw = asciiDigits(candidate).trim();
  const intl = raw.startsWith("+") || raw.startsWith("00");
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  // السعودية: 9665XXXXXXXX، 05XXXXXXXX، 5XXXXXXXX، أرضي 01X، 800، 9200
  if (/^9665\d{8}$/.test(d)) return "966" + d.slice(3);
  if (/^05\d{8}$/.test(d)) return "966" + d.slice(1);
  if (/^5\d{8}$/.test(d) && !intl) return "966" + d;
  if (/^9661\d{7,8}$/.test(d)) return d;
  if (/^01\d{7,8}$/.test(d)) return "966" + d.slice(1);
  if (/^800\d{7}$/.test(d) || /^9200\d{5}$/.test(d)) return d;
  // دولي صريح: + أو 00 ثم 8–15 رقماً
  if (intl && d.length >= 8 && d.length <= 15) return d;
  return null;
}

export class Redactor {
  // العنصر النائب → النص الأصلي كما كُتب
  private originals = new Map<string, string>();
  // مفتاح القيمة الموحّد → رقمها، وكتاباتها المعروفة → عنصرها النائب
  private numbers = new Map<string, number>();
  private spellings = new Map<string, string[]>();
  private phones = 0;
  private emails = 0;

  // عدد القيم المختلفة (لا الكتابات)
  get size(): number {
    return this.numbers.size;
  }

  private placeholder(kind: "PHONE" | "EMAIL", key: string, original: string): string {
    const id = kind + ":" + key;
    let n = this.numbers.get(id);
    if (n === undefined) {
      n = kind === "PHONE" ? ++this.phones : ++this.emails;
      this.numbers.set(id, n);
      this.spellings.set(id, []);
    }
    const seen = this.spellings.get(id)!;
    let i = seen.indexOf(original);
    if (i < 0) {
      seen.push(original);
      i = seen.length - 1;
    }
    const ph = i === 0 ? `[${kind}_${n}]` : `[${kind}_${n}.${i + 1}]`;
    this.originals.set(ph, original);
    return ph;
  }

  redact(text: string): string {
    if (!text) return text;
    const out = text.replace(EMAIL, (m) => this.placeholder("EMAIL", m.toLowerCase(), m));
    return out.replace(PHONE_CANDIDATE, (m) => this.phonesIn(m));
  }

  // سلسلة الأرقام قد تضم أكثر من رقم متجاور ("950000 0551234567"): نبحث داخلها عن أطول
  // تتابع كلمات يكوّن رقماً معروفاً، ونترك الباقي كما هو.
  private phonesIn(run: string): string {
    const parts = run.split(/(\s+)/); // كلمات وفواصل بالتناوب
    const words = parts.filter((_, i) => i % 2 === 0);
    const gaps = parts.filter((_, i) => i % 2 === 1);
    const join = (a: number, b: number) => {
      let s = words[a];
      for (let k = a + 1; k <= b; k++) s += gaps[k - 1] + words[k];
      return s;
    };
    let out = "";
    let i = 0;
    while (i < words.length) {
      let matched = -1;
      for (let j = Math.min(words.length - 1, i + 5); j >= i; j--) {
        const core = join(i, j).replace(/^[\-.()]+|[\-.()]+$/g, "");
        if (core && phoneKey(core)) {
          matched = j;
          break;
        }
      }
      if (matched < 0) {
        out += words[i] + (i < gaps.length ? gaps[i] : "");
        i++;
        continue;
      }
      const whole = join(i, matched);
      const lead = whole.match(/^[\-.()]*/)![0];
      const trail = whole.match(/[\-.()]*$/)![0];
      const core = whole.slice(lead.length, whole.length - trail.length);
      out += lead + this.placeholder("PHONE", phoneKey(core)!, core) + trail + (matched < gaps.length ? gaps[matched] : "");
      i = matched + 1;
    }
    return out;
  }

  restore(text: string): string {
    if (!text || !this.originals.size) return text;
    return text.replace(/\[(?:PHONE|EMAIL)_\d+(?:\.\d+)?\]/g, (ph) => this.originals.get(ph) ?? ph);
  }

  // النصوص داخل أي بنية (ناتج النموذج كاملاً مثلاً)
  restoreDeep<T>(value: T): T {
    if (typeof value === "string") return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.restoreDeep(v);
      return out as T;
    }
    return value;
  }
}

// هل بقي في النص رقم جوال ظاهر؟ للتحقق من الحمولة الصادرة: مُخفٍ جديد يعدّ ما سيخفيه.
export function rawPhones(text: string): string[] {
  const probe = new Redactor();
  probe.redact(text.replace(EMAIL, " "));
  return [...Array(probe.size).keys()].map((i) => probe.restore(`[PHONE_${i + 1}]`));
}
