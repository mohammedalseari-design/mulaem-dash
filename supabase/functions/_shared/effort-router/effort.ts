// درجة الجهد: قاعدة ثابتة بلا نداء نموذج، تقرر هل يُشغَّل التفكير في الطبقة السريعة.
// الأسباب تُعاد مع الدرجة لتُسجَّل مع كل نداء، فيُضبط الحد من نتائج حقيقية لا من التخمين.
import { asciiDigits } from "./digits.ts";

export interface EffortSource {
  kind: string; // text | sheet | pdf | image | url
  text?: string; // النص المقروء؛ PDF والصور بلا نص هنا
}

export interface EffortInput {
  kind: string; // client | project | update
  sources: EffortSource[];
}

export interface Effort {
  score: number;
  reasons: string[];
}

export const DEFAULT_REASONING_THRESHOLD = 3;

// خطة دفع: دفعة/دفعات، أقساط، سعر المتر، نسبة مئوية
const PAYMENT_PLAN = /(دفع[ةه]|دفعات|اقساط|أقساط|قسط|سعر\s*المتر|%|٪)/;
// ذكر نموذج أو وحدة: كل ذكر يُعدّ، والعتبة خمسة
const UNIT_MENTION = /(نموذج|نماذج|موديل|وحد[ةه]|وحدات|شق[ةه]|شقق|فيل[اه]|فلل|دوبلكس|تاون\s*هاوس|بنتهاوس|روف|ملحق|\bmodel\b|\btype\s+[a-z0-9])/gi;
const NUMBER = /\d+(?:[.,٫٬]\d+)*/g;

export function scoreEffort(input: EffortInput): Effort {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${reason} +${points}`);
  };

  const text = input.sources.map((s) => s.text ?? "").join("\n");
  const plain = asciiDigits(text);
  const numbers = (plain.match(NUMBER) ?? []).length;
  const units = (plain.match(UNIT_MENTION) ?? []).length;

  if (input.kind === "update") add(2, "طلب تحديث");
  if (text.length > 60_000) add(2, "نص أطول من 60 ألف حرف");
  else if (text.length > 15_000) add(1, "نص أطول من 15 ألف حرف");
  if (numbers > 150) add(2, `${numbers} رقماً`);
  else if (numbers > 40) add(1, `${numbers} رقماً`);
  if (PAYMENT_PLAN.test(plain)) add(1, "خطة دفع أو سعر متر أو نسبة");
  if (units >= 5) add(1, `${units} ذكراً لوحدات أو نماذج`);

  return { score, reasons };
}

export function reasoningFor(effort: Effort, threshold = DEFAULT_REASONING_THRESHOLD): boolean {
  return effort.score >= threshold;
}
