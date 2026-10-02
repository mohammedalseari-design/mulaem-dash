// فتح روابط الطلب التي لم تُفتح بعد (fetch.ts) وحفظ ما قُرئ في المخزن الخاص تحت مجلد الطلب: نصاً، أو ملف PDF
// كما وصل. يحدث مرة واحدة للرابط: في المحاولات التالية يُقرأ المحفوظ، فتبقى الاقتباسات ثابتة ولا يُطرق الموقع
// مرتين. الرفض النهائي (robots.txt، تسجيل دخول، صفحة فارغة، PDF أطول من الحد…) يُسجَّل على المصدر ويُعرض
// للموظف، ويكمل الطلب بمصادره الأخرى إن وُجدت؛ التعذّر العابر (الموقع لا يستجيب، المخزن لا يكتب) يعيد الطلب
// إلى الانتظار.
//
// لا قاعدة ولا شبكة هنا: الجلب والحفظ والتسجيل تُمرَّر من index.ts، فيُختبر التسلسل كله بلا اتصال.
import { type FetchedPage, LINK_BUDGET_MS, UrlError } from "./fetch.ts";
import { MAX_PDF_PAGES, sha256Hex, type SourceRow } from "./sources.ts";

// تعذّر عابر: الطلب يعود إلى الانتظار ويُعاد لاحقاً
export class LinkRetry extends Error {}

export interface LinkDeps {
  fetchPage: (url: string, budgetMs: number) => Promise<FetchedPage>;
  store: (path: string, bytes: Uint8Array, contentType: string) => Promise<boolean>; // false: تعذّر الحفظ
  save: (sourceId: string, patch: Record<string, unknown>) => Promise<boolean>; // false: تعذّر التسجيل
  countPages: (bytes: Uint8Array) => Promise<number>;
  left: () => number; // ما بقي للروابط من وقت التشغيل بعد حجز نداء النموذج، بالميلي ثانية
  now?: () => Date;
}

export const MIN_LINK_MS = 30_000;

// يعيد عدد الروابط التي فُتحت في هذا التشغيل (صفر: لا رابط جديد، أو كلها رُفضت)
export async function openLinks(requestId: string, rows: SourceRow[], deps: LinkDeps): Promise<number> {
  let opened = 0;
  for (const row of rows) {
    if (row.kind !== "url" || row.storage_path || row.fetch_error) continue;
    // للرابط مهلته الكلية (تحويلات وrobots.txt) داخل ما بقي من وقت التشغيل
    const left = deps.left();
    if (left < MIN_LINK_MS) throw new LinkRetry("انتهى وقت التشغيل قبل فتح الروابط");
    const fetched_at = (deps.now?.() ?? new Date()).toISOString();
    try {
      const page = await deps.fetchPage(row.url ?? "", Math.min(LINK_BUDGET_MS, left));
      // ملف PDF من رابط يخضع لحد الصفحات نفسه؛ الأطول منه أو التالف رفضٌ للرابط لا فشلٌ للطلب، ولا يُحفظ
      let pages: number | null = null;
      if (page.kind === "pdf") {
        try {
          pages = await deps.countPages(page.bytes);
        } catch {
          throw new UrlError("تعذّرت قراءة ملف PDF الذي يشير إليه الرابط — ارفعه ملفاً أو الصق نصه");
        }
        if (pages > MAX_PDF_PAGES) {
          throw new UrlError(`ملف PDF الذي يشير إليه الرابط فيه ${pages} صفحة، والحد ${MAX_PDF_PAGES} — ارفع الصفحات المطلوبة ملفاً`);
        }
      }
      const pdf = page.kind === "pdf";
      const path = `${requestId}/url-${row.id.slice(0, 8)}.${pdf ? "pdf" : "txt"}`;
      if (!await deps.store(path, page.bytes, pdf ? "application/pdf" : "text/plain;charset=utf-8")) {
        throw new LinkRetry("تعذّر حفظ الصفحة المقروءة في المخزن");
      }
      const patch = {
        storage_path: path, bytes: page.bytes.byteLength, pages, sha256: await sha256Hex(page.bytes), title: page.title, fetched_at,
        fetch_error: null,
      };
      if (!await deps.save(row.id, patch)) throw new LinkRetry("تعذّر تسجيل الصفحة المقروءة");
      Object.assign(row, patch);
      opened++;
    } catch (e) {
      if (!(e instanceof UrlError)) throw e;
      if (e.retry) throw new LinkRetry(e.message);
      // فشل تسجيل الرفض لا يوقف الطلب (يُقرأ من مصادره الأخرى)؛ الرابط سيُطرق مرة أخرى في المحاولة التالية فقط
      await deps.save(row.id, { fetch_error: e.message, fetched_at });
      row.fetch_error = e.message;
    }
  }
  return opened;
}
