// سلّم التصعيد: أي طبقة لكل محاولة، ومتى نتوقف ونترك الطلب لإنسان.
//
//   المحاولة الأولى: طلب «تفكير عميق» → الاستدلالية؛ مصدر PDF أو صورة → العامة؛
//                    غير ذلك → السريعة، والتفكير بحسب درجة الجهد.
//   الثانية: فشلت السريعة → السريعة مرة أخرى بالتفكير وبرسالة إصلاح.
//   الثالثة: فشلت الثانية → الاستدلالية لفشل استدلالي، والعامة لغيره.
//   بعدها: فشل محاولة مصعّدة (أو أولى على طبقة ثقيلة) يُنهي الطلب؛ ملاحظات المدقق تبقى لإنسان.
//
// ثلاث محاولات نموذج على الأكثر في الطلب، منفصلة عن إعادة المحاولة لأخطاء البنية: إن أُعيد الطلب إلى
// الانتظار (مهلة، انقطاع، انتهاء وقت التشغيل) بعد أن تجاوز السلّم خطوته الأولى، يُستأنف من الخطوة نفسها
// برسالة إصلاحها (resumeLadder) بدل البدء من السريعة.
import type { FailureClass } from "./classify.ts";
import type { TierId } from "./tiers.ts";

export const MAX_MODEL_ATTEMPTS = 3;

export interface Step {
  attempt: number; // 1..3
  tier: TierId;
  reasoning: boolean;
  repair: boolean; // رسالة الإصلاح (ملاحظات المدقق) مع المحاولة
  escalation: boolean; // تُحسب في سقف التصعيد اليومي (تصعيد أو طلب عميق)
}

export interface FirstStepInput {
  deep: boolean; // الموظف اختار «تفكير عميق»
  hasFiles: boolean; // في المصادر PDF أو صورة
  reasoning: boolean; // قرار درجة الجهد للطبقة السريعة
  available?: TierId[]; // بعد سياسة localOnly؛ الغياب = كل الطبقات
}

const has = (available: TierId[] | undefined, id: TierId) => !available || available.includes(id);

// الطبقة الثقيلة المطلوبة، أو الأخرى إن لم تتوفر (والعامة وحدها تقرأ الملفات هنا)
function heavy(wanted: "reason" | "general", available: TierId[] | undefined): TierId | null {
  if (has(available, wanted)) return wanted;
  const other = wanted === "reason" ? "general" : "reason";
  return has(available, other) ? other : null;
}

// «تفكير عميق» لطلب جديد (غير مستأنف) يُصعَّد فقط إن بقي في سقف التصعيد اليومي المشترك متسع؛ وإلا يبدأ
// بالمسار العادي ولا يفشل، وfellBack تُخبر الموظف بذلك على الطلب. الطلب المستأنف تقرّره خطوته المحفوظة.
export function deepStart(wanted: boolean, resumed: boolean, roomToEscalate: boolean): { deep: boolean; fellBack: boolean } {
  const asked = wanted && !resumed;
  return { deep: asked && roomToEscalate, fellBack: asked && !roomToEscalate };
}

export function firstStep(input: FirstStepInput): Step | null {
  if (input.hasFiles) {
    // الملفات لا تُخفى منها الأرقام، فلا تذهب إلا للطبقة العامة
    if (!has(input.available, "general")) return null;
    return { attempt: 1, tier: "general", reasoning: true, repair: false, escalation: input.deep };
  }
  if (input.deep) {
    const tier = heavy("reason", input.available);
    return tier ? { attempt: 1, tier, reasoning: true, repair: false, escalation: true } : null;
  }
  if (!has(input.available, "fast")) {
    const tier = heavy("general", input.available);
    return tier ? { attempt: 1, tier, reasoning: true, repair: false, escalation: false } : null;
  }
  return { attempt: 1, tier: "fast", reasoning: input.reasoning, repair: false, escalation: false };
}

export function nextStep(prev: Step, failure: FailureClass, available?: TierId[]): Step | null {
  if (prev.attempt >= MAX_MODEL_ATTEMPTS) return null;
  if (prev.tier !== "fast") return null; // فشلت طبقة ثقيلة: إلى إنسان
  if (prev.attempt === 1) {
    return { attempt: 2, tier: "fast", reasoning: true, repair: true, escalation: false };
  }
  const tier = heavy(failure === "reasoning" ? "reason" : "general", available);
  return tier ? { attempt: prev.attempt + 1, tier, reasoning: true, repair: true, escalation: true } : null;
}

// انتهت مهلة نداء على السريعة: الناتج أطول مما تكتبه في المهلة (مشروع بنماذج كثيرة، أو مزوّد بطيء الآن)،
// فإعادته عليها تنتهي مثلها. الخطوة التالية العامة بلا تفكير (أسرع كتابةً)، تُحفظ على الطلب ويُستأنف منها.
// طبقة ثقيلة انتهت مهلتها: null، فيُعاد الطلب إلى الخطوة نفسها كما كان.
export function afterTimeout(step: Step, available?: TierId[]): Step | null {
  if (step.tier !== "fast") return null;
  const tier = heavy("general", available);
  if (!tier) return null;
  // محاولة إصلاح انتهت مهلتها تبقى إصلاحاً: ملاحظات المدقق تذهب مع الطبقة العامة
  return { attempt: Math.min(step.attempt + 1, MAX_MODEL_ATTEMPTS), tier, reasoning: false, repair: step.repair, escalation: true };
}

/* ===================== الاستئناف ===================== */

// موضع السلّم كما يُحفظ على الطلب (agent_requests.ladder): الخطوة التالية وملاحظات المدقق لرسالة إصلاحها
export interface SavedLadder {
  step: Step;
  notes: string[];
}

// يُحفظ قبل كل خطوة بعد الأولى؛ الأولى تُحسب من جديد بلا خسارة
export function shouldSaveLadder(step: Step): boolean {
  return step.attempt > 1;
}

// الموضع المحفوظ إن كان سليماً وطبقته متاحة وتناسب مصادر الطلب، وإلا null فيبدأ السلّم من أوله.
// ما في القاعدة لا يُوثق به أعمى: كل حقل يُفحص، والملفات لا تذهب إلا للعامة.
export function resumeLadder(saved: unknown, input: { available?: TierId[]; hasFiles?: boolean } = {}): SavedLadder | null {
  // deno-lint-ignore no-explicit-any
  const s = saved as any;
  const step = s?.step;
  if (!step || typeof step !== "object") return null;
  const tier = step.tier as TierId;
  if (!Number.isInteger(step.attempt) || step.attempt < 2 || step.attempt > MAX_MODEL_ATTEMPTS) return null;
  if (!["fast", "reason", "general"].includes(tier) || !has(input.available, tier)) return null;
  if (input.hasFiles && tier !== "general") return null;
  if (![step.reasoning, step.repair, step.escalation].every((v) => typeof v === "boolean")) return null;
  const notes = Array.isArray(s.notes) ? s.notes.filter((n: unknown) => typeof n === "string").slice(0, 50) : [];
  return {
    step: { attempt: step.attempt, tier, reasoning: step.reasoning, repair: step.repair, escalation: step.escalation },
    notes,
  };
}
