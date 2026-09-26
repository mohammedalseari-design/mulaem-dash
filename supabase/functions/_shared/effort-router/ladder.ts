// سلّم التصعيد: أي طبقة لكل محاولة، ومتى نتوقف ونترك الطلب لإنسان.
//
//   المحاولة الأولى: طلب «تفكير عميق» → الاستدلالية؛ مصدر PDF أو صورة → العامة؛
//                    غير ذلك → السريعة، والتفكير بحسب درجة الجهد.
//   الثانية: فشلت السريعة → السريعة مرة أخرى بالتفكير وبرسالة إصلاح.
//   الثالثة: فشلت الثانية → الاستدلالية لفشل استدلالي، والعامة لغيره.
//   بعدها: فشل محاولة مصعّدة (أو أولى على طبقة ثقيلة) يُنهي الطلب؛ ملاحظات المدقق تبقى لإنسان.
//
// ثلاث محاولات نموذج على الأكثر في التشغيل الواحد، منفصلة عن إعادة المحاولة لأخطاء البنية.
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
