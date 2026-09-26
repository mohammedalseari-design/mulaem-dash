// الأرقام العربية الهندية والفارسية إلى أرقام لاتينية. يستعملها المدقق (مطابقة الاقتباس)
// وإخفاء الجوالات (رقم مكتوب بأي من الصيغتين هو الرقم نفسه).
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = AR_DIGITS.indexOf(d);
    return String(i >= 0 ? i : FA_DIGITS.indexOf(d));
  });
}
