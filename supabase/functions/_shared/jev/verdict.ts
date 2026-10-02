// حكم الفرز من إجابات Jev (المواصفة §6): send «مقترح للإرسال» / review «يحتاج نظرك» / skip «مستبعد» وأسبابه.
// دوال صافية بلا شبكة ولا قاعدة، والعتبات في مكان واحد (THRESHOLDS). أداة التقييم تنسخ القواعد نفسها
// (scripts/jev-eval/report.mjs)؛ أي تغيير هنا يُنقل إليها.
//
// الثقة: confidence كما أعادها Jev، وإن غابت ووُجدت الاحتمالات فهي (n·pmax − 1)/(n − 1) حيث n عدد الخيارات،
// وإن غابتا فهي null وتُعامل منخفضة: لا تبلغ أي عتبة.
import { INTENTS } from "./questions.ts";

export const THRESHOLDS = Object.freeze({ send: 0.75, skip: 0.75, city: 0.6, multiple: 0.6 });
export interface Thresholds {
  send: number; // ثقة النية لاقتراح الإرسال (sale_offer / status_update)
  skip: number; // ثقة النية للاستبعاد (not_property / wanted / rent_offer)
  city: number; // ثقة المدينة لاعتبار العرض خارج جدة
  multiple: number; // احتمال «عدة عقارات منفصلة» لإحالة العرض إلى المالك
}

export type Verdict = "send" | "review" | "skip";

// إجابة اختيار بعد التطبيع. by: "code" حين لم يُسأل Jev (الحي بلا مرشّحين)
export interface Choice {
  choice: string;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  by?: "code";
}

export interface Answers {
  intent?: Choice | null;
  kind?: Choice | null;
  city?: Choice | null;
  district?: Choice | null;
  multiple?: number | null; // noul: احتمال «نعم»
}

const INTENT_SET = new Set<string>(INTENTS);
const SKIP_INTENTS = new Set(["not_property", "wanted"]);
const SEND_INTENTS = new Set(["sale_offer", "status_update"]);
const OUTSIDE_JEDDAH = new Set(["makkah", "madinah", "riyadh", "other_city"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const unit = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;

function probabilitiesOf(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, p] of Object.entries(v)) {
    const n = unit(p);
    if (n !== null) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

// (n·pmax − 1)/(n − 1): 1 حين يتركز الاحتمال كله في خيار، و0 حين يتوزع بالتساوي. n عدد خيارات السؤال إن عُرف،
// وإلا عدد الاحتمالات المعادة
export function confidenceFrom(probabilities: Record<string, number> | null | undefined, n?: number): number | null {
  if (!probabilities) return null;
  const values = Object.values(probabilities).filter((p) => Number.isFinite(p));
  const size = n !== undefined && n >= 2 ? n : values.length;
  if (!values.length || size < 2) return null;
  const pmax = Math.max(...values);
  return Math.min(1, Math.max(0, (size * pmax - 1) / (size - 1)));
}

// إجابة اختيار من Jev (أو من القاعدة) بعد التحقق: الخيار من خيارات السؤال إن مُرّرت (وإلا فهي غائبة: null)،
// والثقة كما أعيدت أو مشتقة من الاحتمالات
export function normalizeChoice(answer: unknown, options?: readonly string[]): Choice | null {
  if (!isObject(answer)) return null;
  if (answer.type !== undefined && answer.type !== "choice") return null;
  const choice = typeof answer.choice === "string" ? answer.choice : "";
  if (!choice || (options && !options.includes(choice))) return null;
  const probabilities = probabilitiesOf(answer.probabilities);
  const confidence = unit(answer.confidence) ?? confidenceFrom(probabilities, options?.length);
  return { choice, confidence, probabilities };
}

// احتمال noul، أو null
export function noulOf(answer: unknown): number | null {
  if (typeof answer === "number") return unit(answer);
  if (!isObject(answer) || (answer.type !== undefined && answer.type !== "noul")) return null;
  return unit(answer.noul);
}

export interface Decision {
  verdict: Verdict;
  reasons: string[];
}

// الحكم بالترتيب (أول قاعدة تنطبق):
//   1. مستند فقط (تصنيف المحلّل document) → review [document_only]، بلا نداء لـ Jev أصلاً
//   2. نية غائبة أو غير صالحة → review [error]
//   3. ليس عرضاً أو طلب، بثقة ≥ skip → skip [النية]
//   4. عرض إيجار بثقة ≥ skip → skip [rent] (المخزون كله بيع)
//   5. عرض بيع أو تحديث بثقة ≥ send: عدة عقارات (noul ≥ multiple) → review [multiple]؛ مدينة غير جدة بثقة
//      ≥ city → review [outside_jeddah]؛ وإلا send [النية]
//   6. غير ذلك → review [low_confidence]
export function decide(answers: Answers, regexKind: string | null | undefined, thresholds: Thresholds = THRESHOLDS): Decision {
  const review = (reason: string): Decision => ({ verdict: "review", reasons: [reason] });
  if (regexKind === "document") return review("document_only");
  const intent = answers?.intent;
  if (!intent || typeof intent.choice !== "string" || !INTENT_SET.has(intent.choice)) return review("error");
  const conf = typeof intent.confidence === "number" && Number.isFinite(intent.confidence) ? intent.confidence : null;
  const atLeast = (t: number) => conf !== null && conf >= t;

  if (SKIP_INTENTS.has(intent.choice) && atLeast(thresholds.skip)) return { verdict: "skip", reasons: [intent.choice] };
  if (intent.choice === "rent_offer" && atLeast(thresholds.skip)) return { verdict: "skip", reasons: ["rent"] };
  if (SEND_INTENTS.has(intent.choice) && atLeast(thresholds.send)) {
    const multiple = answers.multiple;
    if (typeof multiple === "number" && Number.isFinite(multiple) && multiple >= thresholds.multiple) return review("multiple");
    const city = answers.city;
    const cityConf = city && typeof city.confidence === "number" && Number.isFinite(city.confidence) ? city.confidence : null;
    if (city && OUTSIDE_JEDDAH.has(city.choice) && cityConf !== null && cityConf >= thresholds.city) {
      return review("outside_jeddah");
    }
    return { verdict: "send", reasons: [intent.choice] };
  }
  return review("low_confidence");
}

/* ===================== التخزين (wa_triage.answers) ===================== */

// شكل answers في القاعدة (المواصفة §8، وتقرير wa_triage_report يقرأ intent منه):
//   intent و city: { choice, confidence, probabilities } باحتمالاتها كاملة
//   kind و district: { choice, confidence, top: [[المفتاح، الاحتمال]، …] } بأعلى ثلاثة، و by: "code" للحي بالكود
//   multiple: { noul }
//   truncated: true حين قُطعت الرسالة قبل الإرسال
// الإجابة الغائبة null. لا نص رسالة هنا: مفاتيح واحتمالات فقط (أسماء الأحياء مفاتيح خيارات).
export interface StoredChoice {
  choice: string;
  confidence: number | null;
  probabilities?: Record<string, number> | null;
  top?: [string, number][];
  by?: "code";
}

export interface StoredAnswers {
  intent: StoredChoice | null;
  city: StoredChoice | null;
  kind: StoredChoice | null;
  district: StoredChoice | null;
  multiple: { noul: number } | null;
  truncated?: true;
}

export function topOf(probabilities: Record<string, number> | null | undefined, n = 3): [string, number][] {
  if (!probabilities) return [];
  return Object.entries(probabilities)
    .filter(([, p]) => Number.isFinite(p))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}

export function compactAnswers(answers: Answers, options: { truncated?: boolean } = {}): StoredAnswers {
  const full = (c: Choice | null | undefined): StoredChoice | null =>
    c ? { choice: c.choice, confidence: c.confidence, probabilities: c.probabilities ?? null } : null;
  const short = (c: Choice | null | undefined): StoredChoice | null => {
    if (!c) return null;
    const out: StoredChoice = { choice: c.choice, confidence: c.confidence, top: topOf(c.probabilities) };
    if (c.by) out.by = c.by;
    return out;
  };
  const stored: StoredAnswers = {
    intent: full(answers.intent),
    city: full(answers.city),
    kind: short(answers.kind),
    district: short(answers.district),
    multiple: typeof answers.multiple === "number" && Number.isFinite(answers.multiple) ? { noul: answers.multiple } : null,
  };
  if (options.truncated) stored.truncated = true;
  return stored;
}

// العكس للذاكرة: answers كما خُزّنت → إجابات (احتمالات kind/district أعلى ثلاثة فقط) وعلامة القطع
export function readStored(stored: unknown): { answers: Answers; truncated: boolean } {
  const s = isObject(stored) ? stored : {};
  const choiceOf = (v: unknown): Choice | null => {
    if (!isObject(v) || typeof v.choice !== "string" || !v.choice) return null;
    let probabilities = probabilitiesOf(v.probabilities);
    if (!probabilities && Array.isArray(v.top)) {
      const pairs = v.top.filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === "string" && unit(x[1]) !== null);
      probabilities = pairs.length ? Object.fromEntries(pairs.map(([k, p]) => [k, unit(p)!])) : null;
    }
    const out: Choice = { choice: v.choice, confidence: unit(v.confidence), probabilities };
    if (v.by === "code") out.by = "code";
    return out;
  };
  return {
    answers: {
      intent: choiceOf(s.intent),
      kind: choiceOf(s.kind),
      city: choiceOf(s.city),
      district: choiceOf(s.district),
      multiple: noulOf(isObject(s.multiple) ? { type: "noul", noul: s.multiple.noul } : s.multiple),
    },
    truncated: s.truncated === true,
  };
}
