// تصنيف فشل المحاولة: شكل (format) أم دليل (evidence) أم استدلال (reasoning).
// التصنيف يقرأ رموز المدقق (code) لا ملاحظاته العربية، فتغيير صياغة ملاحظة لا يغيّر السلوك.

export type FailureClass = "format" | "evidence" | "reasoning";

// كل رمز يسجّله المدقق مع رفض قيمة. الرموز غير المذكورة هنا (ملاحظات لا ترفض شيئاً،
// كالمكرّرات والقيم المستنتجة) لا تدخل التصنيف.
export const CODE_CLASS: Record<string, FailureClass> = {
  // الشكل: نوع أو صيغة القيمة نفسها
  type: "format",
  too_long: "format",
  unknown_value: "format",
  bad_date: "format",
  bad_email: "format",
  bad_phone: "format",
  bad_list: "format",
  unsupported_field: "format",
  // الدليل: الاقتباس غائب أو لا يطابق المصدر أو لا يحمل القيمة
  no_quote: "evidence",
  quote_not_found: "evidence",
  number_not_in_quote: "evidence",
  email_not_in_quote: "evidence",
  phone_not_in_quote: "evidence",
  // الاستدلال: قيمة خارج المعقول، أو تعارض بين الحقول أو المصادر، أو هدف تحديث مبهم
  range: "reasoning",
  cross_field: "reasoning",
  source_conflict: "reasoning",
  phone_role: "reasoning",
  unit_ambiguous: "reasoning",
};

export interface AttemptOutcome {
  // فشل صلب: JSON غير صالح، أو ناتج مقطوع (finish_reason = length)، أو شكل غير مطابق،
  // أو لا حقل واحد مدعوم بدليل
  hard?: "parse" | "truncated" | "schema" | "empty";
  returned: number; // حقول أعاد لها النموذج قيمة (غير المستنتجة)
  rejected: number; // منها ما رفضه المدقق
  rejections: string[]; // رموز الرفض
}

export const DEFAULT_MAX_REJECT_RATIO = 0.3;

// المستنتج والناقص ليسا فشلاً؛ الفشل صلب، أو رفض أكثر من النسبة مما أعاده النموذج.
export function isFailure(o: AttemptOutcome, maxRejectRatio = DEFAULT_MAX_REJECT_RATIO): boolean {
  if (o.hard) return true;
  return o.returned > 0 && o.rejected / o.returned > maxRejectRatio;
}

// الفشل الصلب شكلٌ دائماً. غير ذلك: الفئة الأكثر رموزاً، والتعادل للاستدلال ثم الدليل،
// لأن نموذج الاستدلال أغلى وخطأ الحساب أخطر من اقتباس ناقص.
export function classifyFailure(o: AttemptOutcome): FailureClass {
  if (o.hard) return "format";
  const count: Record<FailureClass, number> = { format: 0, evidence: 0, reasoning: 0 };
  for (const code of o.rejections) {
    const cls = CODE_CLASS[code];
    if (cls) count[cls]++;
  }
  if (count.reasoning > 0 && count.reasoning >= count.evidence && count.reasoning >= count.format) return "reasoning";
  if (count.evidence > 0 && count.evidence >= count.format) return "evidence";
  return "format";
}
