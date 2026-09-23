// قراءة المصادر من المخزن الخاص وتحويلها إلى كتل رسالة للنموذج.
//
// الحدود المعلنة في المتصفح (عشرة ملفات، عشرة ميغابايت، عشرون صفحة) يُعاد فرضها هنا
// على الملف الفعلي لا على ما صرّح به المتصفح: الحجم من البايتات، والصفحات من قراءة الـPDF،
// والبصمة sha256 من المحتوى.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { Src, SourceKind } from "./validate.ts";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
export const MAX_TEXT_CHARS = 300_000;

export class SourceError extends Error {}

export interface SourceRow {
  id: string;
  kind: SourceKind;
  storage_path: string | null;
  url: string | null;
  bytes: number | null;
  pages: number | null;
  sha256: string | null;
}

// deno-lint-ignore no-explicit-any
export type Block = any;

export interface Loaded {
  blocks: Block[];
  srcs: Src[];
  pages: Map<string, number>; // عدد الصفحات الفعلي لكل PDF لتحديث agent_sources
}

export type Download = (path: string) => Promise<Uint8Array>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const isPdf = (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

async function pdfPages(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("npm:pdf-lib@1.17.1");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

async function sheetText(bytes: Uint8Array, name: string): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return new TextDecoder("utf-8").decode(bytes);
  // SheetJS من توزيعته الرسمية (نسخة npm قديمة عليها ثغرات معروفة عند قراءة ملفات غير موثوقة)
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const book = XLSX.read(bytes, { type: "array", cellFormula: false, cellHTML: false });
  const parts: string[] = [];
  for (const sheet of book.SheetNames.slice(0, 10)) {
    parts.push(`# ${sheet}\n` + XLSX.utils.sheet_to_csv(book.Sheets[sheet], { blankrows: false }));
  }
  return parts.join("\n\n");
}

// الوسم حول المصدر يُهرَّب من داخل النص، فلا يستطيع ملف أن يغلق وسمه ويكتب "خارجه".
function wrapText(label: string, kind: string, text: string): string {
  const safe = text.replace(/<\/?\s*(source|employee_request)\b[^>]*>/gi, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
  return `<source id="${label}" kind="${kind}">\n${safe}\n</source>`;
}

export async function loadSources(rows: SourceRow[], download: Download): Promise<Loaded> {
  if (rows.length > MAX_FILES) throw new SourceError(`حد المرفقات ${MAX_FILES} ملفات للطلب الواحد`);
  const blocks: Block[] = [];
  const srcs: Src[] = [];
  const pages = new Map<string, number>();
  let textChars = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = "S" + (i + 1);

    if (row.kind === "url") {
      // الروابط لا تُفتح في هذه الجولة (الجولة C): تُذكر للنموذج كمرجع فقط، ولا يُستخرج منها شيء.
      blocks.push({ type: "text", text: wrapText(label, "url", `رابط سجّله الموظف ولم يُفتح: ${row.url ?? ""}\n(لا تستخرج أي قيمة من هذا المصدر)`) });
      srcs.push({ label, id: row.id, kind: "url", text: "" });
      continue;
    }
    if (!row.storage_path) throw new SourceError("مصدر بلا ملف");

    const bytes = await download(row.storage_path);
    const name = row.storage_path.split("/").pop() ?? "";
    if (bytes.byteLength > MAX_FILE_BYTES) throw new SourceError(`الملف «${name}» يتجاوز عشرة ميغابايت`);
    if (row.sha256 && (await sha256Hex(bytes)) !== row.sha256.toLowerCase()) {
      throw new SourceError(`محتوى الملف «${name}» لا يطابق بصمته عند الرفع`);
    }

    if (row.kind === "pdf") {
      if (!isPdf(bytes)) throw new SourceError(`الملف «${name}» ليس PDF صالحاً`);
      let count: number;
      try {
        count = await pdfPages(bytes);
      } catch {
        throw new SourceError(`تعذّرت قراءة ملف PDF «${name}»`);
      }
      if (count > MAX_PDF_PAGES) throw new SourceError(`الملف «${name}» فيه ${count} صفحة، والحد ${MAX_PDF_PAGES}`);
      pages.set(row.id, count);
      blocks.push({ type: "text", text: `<source id="${label}" kind="pdf" pages="${count}"> (the PDF document that follows)` });
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } });
      blocks.push({ type: "text", text: `</source>` });
      srcs.push({ label, id: row.id, kind: "pdf" });
      continue;
    }

    if (row.kind === "image") {
      const media = imageType(bytes);
      if (!media) throw new SourceError(`الصورة «${name}» ليست PNG أو JPEG أو WEBP`);
      blocks.push({ type: "text", text: `<source id="${label}" kind="image"> (the image that follows)` });
      blocks.push({ type: "image", source: { type: "base64", media_type: media, data: encodeBase64(bytes) } });
      blocks.push({ type: "text", text: `</source>` });
      srcs.push({ label, id: row.id, kind: "image" });
      continue;
    }

    let text: string;
    if (row.kind === "sheet") {
      if (!name.toLowerCase().endsWith(".csv") && !isZip(bytes) && !name.toLowerCase().endsWith(".xls")) {
        throw new SourceError(`الجدول «${name}» بصيغة غير مدعومة`);
      }
      try {
        text = await sheetText(bytes, name);
      } catch {
        throw new SourceError(`تعذّرت قراءة الجدول «${name}»`);
      }
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      // لا اقتطاع صامت: مصدر أطول من الحد يُرفض برسالة واضحة
      throw new SourceError("النصوص المرفقة أطول من الحد المسموح للطلب الواحد — قسّمها على أكثر من طلب");
    }
    blocks.push({ type: "text", text: wrapText(label, row.kind, text) });
    srcs.push({ label, id: row.id, kind: row.kind, text });
  }

  return { blocks, srcs, pages };
}
