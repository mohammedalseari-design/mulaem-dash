// أسئلة Jev لفرز رسائل واتساب، والحالة التي تُرسل معها (docs/JEV.md، المواصفة §3).
//
// مجموعة الأسئلة (QSET) كود: الأحكام تُحفظ في wa_triage بمفتاح (بصمة النص، QSET) ولا تُعاد، فأي تغيير في نص
// سؤال أو خياراته أو في الحالة يوجب اسماً جديداً (wa-2 …). وكل مجموعة مكتوبة لقائمة أحياء بعينها: districts
// يُكتب نصاً لا استيراداً، فإن تغيّر DISTRICTS_VERSION (districts.ts) صارت المجموعة غير صالحة (isCurrentQset)
// وتوقف الفرز بها حتى تُضاف مجموعة جديدة، ولا يُخلط حكمٌ بقائمة قديمة بحكمٍ بقائمة جديدة تحت الاسم نفسه.
//
// الخصوصية: buildRequest يفحص ما يُرسل (نص الكتلة واسم المجموعة بعد الإخفاء) ويستبدل x بأرقام أي جوال بقي
// ظاهراً (scrubPhones). الإخفاء نفسه (Redactor، واحد لكل كتلة) في الوظيفة، بعد capRuns.
import type { ChoiceQuestion, JevQuestion, NoulQuestion } from "./client.ts";
import { DISTRICTS_VERSION, findDistrictCandidates, JEDDAH_DISTRICTS, MAX_DISTRICT_CANDIDATES } from "./districts.ts";
import { asciiDigits } from "../effort-router/digits.ts";
import { phoneKey, rawPhones } from "../effort-router/redact.ts";

export const MESSAGE_MAX = 6000; // ما يُرسل من نص الكتلة (الرأس)؛ الباقي يُقطع ويُعلَّم truncated
export const GROUP_MAX = 200; // اسم المجموعة اسم ملف قصير؛ حدٌّ يمنع اسماً شاذاً من ملء السياق

// مفاتيح الخيارات تُرسل إلى النموذج، وهي نفسها في كل المجموعات وفي الصفحة والقاعدة
export const INTENTS = ["sale_offer", "rent_offer", "status_update", "wanted", "not_property", "other"] as const;
export type Intent = typeof INTENTS[number];
export const KINDS = ["apartment", "villa", "floor", "building", "land", "commercial", "rest_house", "other", "none"] as const;
export const CITIES = ["jeddah", "makkah", "madinah", "riyadh", "other_city", "not_stated"] as const;
export const DISTRICT_NONE = "none";

export interface QSet {
  name: string;
  districts: string; // DISTRICTS_VERSION الذي كُتبت له المجموعة
  version: string; // الاسم وقائمة الأحياء معاً: wa-1+jed-2026-10-02
  withGroup: boolean; // الحالة { message, group } أو { message }
  questions: { intent: ChoiceQuestion; kind: ChoiceQuestion; city: ChoiceQuestion; multiple: NoulQuestion };
  district: { instructions: string; none: string }; // سؤال الحي يُبنى لكل رسالة من مرشّحيها
}

interface Texts {
  intent: { instructions: string; criteria: Record<Intent, string> };
  kind: { instructions: string; criteria: Record<typeof KINDS[number], string> };
  city: { instructions: string; criteria: Record<typeof CITIES[number], string> };
  district: { instructions: string; none: string };
  multiple: { instructions: string; true: string; false: string };
}

// wa-1: النص الإنجليزي كما في المواصفة §3 حرفياً
const EN: Texts = {
  intent: {
    instructions:
      "`message` is a post from a Saudi real-estate WhatsApp group, usually written in Arabic. What is its author mainly doing?",
    criteria: {
      sale_offer:
        "Offers one or more specific properties or project units for sale: describes the property (type, area, rooms, district) and/or gives a sale price, payment plan, or says للبيع.",
      rent_offer: "Offers a specific property for rent (للإيجار): gives a monthly or yearly rent or says it is for rent.",
      status_update:
        "Reports a change to properties already offered: units sold or reserved (تم البيع، محجوز), a new or reduced price (تخفيض، السعر الجديد), what remains available (المتبقي), or new commission terms.",
      wanted:
        "Looks for a property instead of offering one: a buyer or tenant request, or a broker saying a client wants something (مطلوب، عندي عميل يبحث).",
      not_property:
        "Not about a specific property: greetings, religious or national-day messages, market news or prices per metre in general, ads for services, questions, or group administration.",
      other: "None of the above fits.",
    },
  },
  kind: {
    instructions: "What type of property does `message` offer or discuss? If it covers several types, pick the main one.",
    criteria: {
      apartment: "شقة — an apartment, including roof (روف), annex (ملحق), studio or penthouse units.",
      villa: "فيلا / فلة — a villa, including duplex or townhouse villas (دوبلكس، تاون هاوس).",
      floor: "دور — one floor of a building sold on its own.",
      building: "عمارة — a whole residential or commercial building.",
      land: "أرض — a plot of land or a farm.",
      commercial: "محل، معرض، مكتب، مستودع — a shop, showroom, office or warehouse.",
      rest_house: "استراحة أو شاليه — a rest house or chalet.",
      other: "A property type not listed above.",
      none: "`message` is not about any property.",
    },
  },
  city: {
    instructions: "In which city is the property in `message`? Choose not_stated when `message` names no city.",
    criteria: {
      jeddah: "جدة — Jeddah is named, or the text says the property is in Jeddah.",
      makkah: "مكة المكرمة — Makkah.",
      madinah: "المدينة المنورة — Madinah.",
      riyadh: "الرياض as a city (not حي الرياض, which is a Jeddah district).",
      other_city: "Another Saudi city or region, e.g. الطائف، الأحساء، الدمام، أبها.",
      not_stated: "No city is named.",
    },
  },
  district: {
    instructions: "In which Jeddah district (حي) is the offered property located?",
    none: "None of these districts is where the property is (they are only mentioned nearby or in passing).",
  },
  multiple: {
    instructions: "Does `message` offer two or more separate properties that are not units of the same project or building?",
    true: "It lists separate properties, e.g. a villa in one place and a plot of land in another.",
    false: "It is about one property, or several units or models of one project or building.",
  },
};

// wa-1-ar: المعنى نفسه بالعربية، والمفاتيح كما هي. `message` مسار في الحالة فيبقى كما هو.
const AR: Texts = {
  intent: {
    instructions: "`message` منشور في مجموعة واتساب عقارية سعودية، ويُكتب غالباً بالعربية. ما الذي يفعله كاتبه أساساً؟",
    criteria: {
      sale_offer:
        "يعرض للبيع عقاراً محدداً أو أكثر أو وحدات في مشروع: يصف العقار (النوع، المساحة، الغرف، الحي) و/أو يذكر سعر بيع أو خطة دفع، أو يقول «للبيع».",
      rent_offer: "يعرض عقاراً محدداً للإيجار: يذكر إيجاراً شهرياً أو سنوياً، أو يقول إنه «للإيجار».",
      status_update:
        "يبلّغ عن تغيّر في عقارات سبق عرضها: وحدات بيعت أو حُجزت (تم البيع، محجوز)، أو سعر جديد أو مخفّض (تخفيض، السعر الجديد)، أو ما بقي متاحاً (المتبقي)، أو شروط عمولة جديدة.",
      wanted:
        "يبحث عن عقار بدل أن يعرضه: طلب مشترٍ أو مستأجر، أو وسيط يقول إن لديه عميلاً يريد شيئاً (مطلوب، عندي عميل يبحث).",
      not_property:
        "لا يتعلق بعقار محدد: تحيات، أو رسائل دينية أو بمناسبة اليوم الوطني، أو أخبار السوق أو أسعار المتر عموماً، أو إعلانات خدمات، أو أسئلة، أو إدارة المجموعة.",
      other: "لا ينطبق عليه شيء مما سبق.",
    },
  },
  kind: {
    instructions: "ما نوع العقار الذي يعرضه `message` أو يتحدث عنه؟ إن شمل أكثر من نوع فاختر النوع الرئيسي.",
    criteria: {
      apartment: "شقة — وتشمل وحدات الروف والملحق والاستوديو والبنتهاوس.",
      villa: "فيلا / فلة — وتشمل فلل الدوبلكس والتاون هاوس.",
      floor: "دور — طابق واحد من مبنى يُباع وحده.",
      building: "عمارة — مبنى سكني أو تجاري كامل.",
      land: "أرض — قطعة أرض أو مزرعة.",
      commercial: "محل أو معرض أو مكتب أو مستودع.",
      rest_house: "استراحة أو شاليه.",
      other: "نوع عقار غير مذكور أعلاه.",
      none: "`message` لا يتعلق بأي عقار.",
    },
  },
  city: {
    instructions: "في أي مدينة يقع العقار المذكور في `message`؟ اختر not_stated إذا لم يذكر `message` أي مدينة.",
    criteria: {
      jeddah: "جدة — ذُكرت جدة، أو يقول النص إن العقار في جدة.",
      makkah: "مكة المكرمة.",
      madinah: "المدينة المنورة.",
      riyadh: "الرياض بوصفها مدينة (لا «حي الرياض»، فهو حي في جدة).",
      other_city: "مدينة أو منطقة سعودية أخرى، مثل الطائف، الأحساء، الدمام، أبها.",
      not_stated: "لم تُذكر أي مدينة.",
    },
  },
  district: {
    instructions: "في أي حي من أحياء جدة يقع العقار المعروض؟",
    none: "لا يقع العقار في أيٍّ من هذه الأحياء (ذُكرت لأنها قريبة منه أو عَرَضاً فقط).",
  },
  multiple: {
    instructions: "هل يعرض `message` عقارين منفصلين أو أكثر، ليست وحداتٍ في مشروع واحد أو مبنى واحد؟",
    true: "يذكر عقارات منفصلة، مثل فيلا في مكان وأرض في مكان آخر.",
    false: "يتعلق بعقار واحد، أو بعدة وحدات أو نماذج من مشروع واحد أو مبنى واحد.",
  },
};

function qset(name: string, districts: string, withGroup: boolean, t: Texts): QSet {
  const choice = (q: { instructions: string; criteria: Record<string, string> }): ChoiceQuestion =>
    Object.freeze({ type: "choice", instructions: q.instructions, criteria: Object.freeze({ ...q.criteria }) });
  return Object.freeze({
    name,
    districts,
    version: `${name}+${districts}`,
    withGroup,
    questions: Object.freeze({
      intent: choice(t.intent),
      kind: choice(t.kind),
      city: choice(t.city),
      multiple: Object.freeze({
        type: "noul" as const,
        instructions: t.multiple.instructions,
        criteria: Object.freeze({ true: t.multiple.true, false: t.multiple.false }),
      }),
    }),
    district: Object.freeze({ ...t.district }),
  });
}

// المجموعات الثلاث مكتوبة لقائمة الأحياء jed-2026-10-02. الصفحة تستعمل DEFAULT_QSET وحدها؛ أداة التقييم
// (بتذكرة) تختار أياً منها.
export const QSETS: Readonly<Record<string, QSet>> = Object.freeze({
  "wa-1": qset("wa-1", "jed-2026-10-02", true, EN),
  "wa-1-ar": qset("wa-1-ar", "jed-2026-10-02", true, AR),
  "wa-1-nogroup": qset("wa-1-nogroup", "jed-2026-10-02", false, EN),
});

export const DEFAULT_QSET = "wa-1";

// صالحة للفرز: معروفة ومكتوبة لقائمة الأحياء الحالية
export function isCurrentQset(name: string): boolean {
  const q = Object.hasOwn(QSETS, name) ? QSETS[name] : undefined;
  return q !== undefined && q.districts === DISTRICTS_VERSION;
}

/* ===================== فحص الأرقام قبل الإرسال ===================== */

// سلسلة أرقام (أي خط: لاتينية، عربية، فارسية، عريضة…) يصل بين مجموعاتها حتى ثلاثة فواصل كما يُكتب الجوال
// («055 - 123 - 4567»): مسافة غير السطر الجديد، وأي شرطة (\p{Pd}) أو علامة الطرح أو التطويل، وعلامات التنسيق الخفية
// (\p{Cf}: اتجاه النص، الوصل والفصل) والعلامات المركّبة (\p{M}: أرقام الإيموجي 0 + U+FE0F + U+20E3)، و / _ . , ، ٫ ٬ ( ). السطر الجديد
// يفصل السلاسل (سعر في سطر وجوال في الذي بعده ليسا رقماً واحداً)
const JOINER =
  "[\\t\\v\\f \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000\\p{Pd}\\u2212\\u0640\\p{Cf}\\p{M}/_.,\\u060c\\u066b\\u066c()]";
const DIGIT_RUN = new RegExp(`\\p{Nd}(?:${JOINER}{0,3}\\p{Nd})*`, "gu");
const DIGIT = /\p{Nd}/gu;

// شكل السلسلة للفحص: أرقام لاتينية (ما لا يُحوَّل من الخطوط الأخرى لا يطابق شكلاً فيُستبدل)، بلا علامات خفية أو
// مركّبة، كل شرطة «-»، الفاصلة العربية وفاصل الآلاف العربي «,»، الفاصلة العشرية العربية «.»، وكل مسافة « »
const shapeOf = (run: string) =>
  asciiDigits(run)
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/[\p{Pd}−ـ]/gu, "-")
    .replace(/[،٬]/g, ",")
    .replace(/٫/g, ".")
    .replace(/\s/g, " ");

// ما ليس جوالاً ولو بلغ 8 أرقام: تاريخ (2026-09-27، 27/09/2026)، وعدد مجمّع بفاصل آلاف واحد لا يبدأ بصفر (12,500,000،
// 12.500.000، ١٢٬٥٠٠٬٠٠٠)، وعدد بكسر عشري (950000.50)، وقائمة أو مدى منها أو من أعداد بأربعة إلى سبعة أرقام لا تبدأ
// بصفر (950000 - 1000000، 1200 / 1500)
const DATE = /^(?:\d{4} ?[-./] ?\d{1,2} ?[-./] ?\d{1,2}|\d{1,2} ?[-./] ?\d{1,2} ?[-./] ?\d{4})$/;
const GROUPED = /^[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*(?:[.,]\d{1,2})?$/;
const DECIMAL = /^[1-9]\d{0,6}[.,]\d{1,2}$/;
const PLAIN = /^[1-9]\d{3,6}$/;
const NUMBER = (part: string) => DATE.test(part) || GROUPED.test(part) || DECIMAL.test(part) || PLAIN.test(part);

// أجزاء السلسلة: تفصلها فاصلة فيها مسافة (« - »، «، »، « / »، مسافتان). جزء ليس عدداً قائماً بنفسه (055 - 123 - 4567)
// يجعل السلسلة كلها رقماً واحداً
function partsOf(shape: string): string[] {
  const pieces = shape.split(/(\D+)/); // أرقام وفواصل بالتناوب
  const parts: string[] = [];
  let part = pieces[0];
  for (let i = 1; i < pieces.length; i += 2) {
    if (pieces[i].length >= 2 && pieces[i].includes(" ")) {
      parts.push(part);
      part = pieces[i + 1];
    } else {
      part += pieces[i] + pieces[i + 1];
    }
  }
  parts.push(part);
  return parts;
}

// المستثنى يُفحص أيضاً: مجموعات متتالية تبدأ من أول جزء ما (حتى 15 رقماً) أرقامها جوال يعرفه phoneKey (سعودي، أو دولي
// بـ + أو 00) — «966,551,234,567»، «+966551 - 234567». لا يبدأ الفحص من وسط عدد («1,250,000,000» ليس «00…»)
function hidesPhone(parts: string[], plus: boolean): boolean {
  const groups: string[] = [];
  const starts: number[] = [];
  for (const part of parts) {
    starts.push(groups.length);
    groups.push(...(part.match(/\d+/g) ?? []));
  }
  for (const i of starts) {
    let digits = "";
    for (let j = i; j < groups.length && digits.length + groups[j].length <= 15; j++) {
      digits += groups[j];
      if (digits.length >= 8 && phoneKey((plus && i === 0 ? "+" : "") + digits)) return true;
    }
  }
  return false;
}

const xDigits = (s: string) => s.replace(DIGIT, "x");

// ما بقي ظاهراً بعد الإخفاء: كل جوال يعرفه rawPhones، ثم كل سلسلة شبيهة بالجوال من 8 أرقام فأكثر، تُستبدل
// أرقامها x. الأسعار والمساحات والتواريخ وقوائمها تبقى، ما لم تخفِ جوالاً.
export function scrubPhones(text: string): string {
  let out = String(text ?? "");
  if (!out) return out;
  for (const phone of rawPhones(out)) {
    if (phone) out = out.split(phone).join(xDigits(phone));
  }
  return out.replace(DIGIT_RUN, (run: string, at: number, whole: string) => {
    if ((run.match(DIGIT)?.length ?? 0) < 8) return run;
    const shape = shapeOf(run);
    const parts = partsOf(shape);
    const exempt = DATE.test(shape) || GROUPED.test(shape) || DECIMAL.test(shape) || (parts.length > 1 && parts.every(NUMBER));
    return exempt && !hidesPhone(parts, whole[at - 1] === "+") ? run : xDigits(run);
  });
}

// سلسلة طويلة من حروف البريد ([A-Za-z0-9._%+-]) بلا @ تجعل نمط البريد في Redactor تربيعياً (وحدّ المعالج ثانيتان لكل
// نداء)، ولا بريد ولا جوال بطولها: الوظيفة تقصر كل سلسلة على أول RUN_MAX حرفاً قبل الإخفاء. البصمة على النص الأصلي.
export const RUN_MAX = 64;
export function capRuns(text: string): string {
  return String(text ?? "").replace(/[A-Za-z0-9._%+-]+/g, (run) => run.length > RUN_MAX ? run.slice(0, RUN_MAX) : run);
}

/* ===================== الطلب ===================== */

const ALIASES = new Map(JEDDAH_DISTRICTS.map((d) => [d.name, d.aliases.join("، ") || null]));

// الرأس حتى max، بلا نصف حرف مركّب (زوج UTF-16) في آخره
function head(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// يُفحص الرأس الذي قد يُرسل وحده (نص الكتلة قد يبلغ 20000 حرف)، ومعه هامش يتسع لأي جوال يبدأ قبل الحد: 15 رقماً
// بينها حتى ثلاثة فواصل أقل من 64 حرفاً، فيُرى كاملاً ولا يبقى منه نصف ظاهر
const SCRUB_MARGIN = 64;
const scrubbedHead = (text: string, max: number) => {
  const window = head(text, max + SCRUB_MARGIN);
  const scrubbed = scrubPhones(window);
  const out = head(scrubbed, max);
  return { out, truncated: text.length > window.length || scrubbed.length > out.length };
};

export interface RequestInput {
  message: string; // نص الكتلة بعد الإخفاء
  group?: string; // اسم المجموعة بعد الإخفاء
  districtCandidates?: string[]; // يُستخرج من الرسالة إن لم يُمرَّر
}

export interface BuiltRequest {
  state: { message: string; group?: string };
  questions: Record<string, JevQuestion>;
  truncated: boolean;
  districtCandidates: string[];
}

// الحالة والأسئلة لرسالة واحدة. سؤال الحي لا يُطرح إلا إن وُجد في الرسالة (كما تُرسل) حيٌّ من القائمة: خيار لكل
// مرشّح (الاسم المعتمد، ووصفه أسماؤه البديلة) و none. بلا مرشّحين يبقى الحي not_stated بالكود (verdict.ts).
export function buildRequest(qsetName: string, input: RequestInput): BuiltRequest {
  const q = Object.hasOwn(QSETS, qsetName) ? QSETS[qsetName] : undefined;
  if (!q) throw new Error(`unknown qset: ${qsetName}`);
  const { out: message, truncated } = scrubbedHead(String(input.message ?? ""), MESSAGE_MAX);
  const state: BuiltRequest["state"] = { message };
  if (q.withGroup) state.group = scrubbedHead(String(input.group ?? ""), GROUP_MAX).out;

  const given = input.districtCandidates ?? findDistrictCandidates(message);
  const candidates = [...new Set(given.filter((c) => typeof c === "string" && c.trim() && c !== DISTRICT_NONE))]
    .slice(0, MAX_DISTRICT_CANDIDATES);

  const questions: Record<string, JevQuestion> = {
    intent: q.questions.intent,
    kind: q.questions.kind,
    city: q.questions.city,
  };
  if (candidates.length) {
    const criteria: Record<string, string | null> = {};
    for (const name of candidates) criteria[name] = ALIASES.get(name) ?? null;
    criteria[DISTRICT_NONE] = q.district.none;
    questions.district = { type: "choice", instructions: q.district.instructions, criteria };
  }
  questions.multiple = q.questions.multiple;
  return { state, questions, truncated, districtCandidates: candidates };
}
