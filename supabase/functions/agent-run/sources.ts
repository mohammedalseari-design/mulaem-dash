// قراءة المصادر من المخزن الخاص، ثم تحويلها إلى أجزاء رسالة متوافقة مع OpenAI للنموذج.
//
// الحدود المعلنة في المتصفح (عشرة ملفات، عشرة ميغابايت، عشرون صفحة) يُعاد فرضها هنا
// على الملف الفعلي لا على ما صرّح به المتصفح: الحجم من البايتات، والصفحات من قراءة الـPDF،
// والبصمة sha256 من المحتوى.
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { ChatPart } from "../_shared/effort-router/client.ts";
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

// ملف PDF أو صورة كما يُرسل: لا نص له هنا، ولا يمكن إخفاء الجوالات منه
export interface LoadedFile {
  label: string;
  kind: "pdf" | "image";
  name: string;
  mime: string;
  base64: string;
  bytes: number;
  pages?: number;
}

export interface Loaded {
  srcs: Src[]; // بترتيب المصادر؛ النص الأصلي للنصوص والجداول
  files: LoadedFile[];
  urls: Map<string, string>; // S1 → الرابط المسجّل
  pages: Map<string, number>; // عدد الصفحات الفعلي لكل PDF لتحديث agent_sources
}

export const hasFiles = (loaded: Loaded) => loaded.files.length > 0;

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
  const srcs: Src[] = [];
  const files: LoadedFile[] = [];
  const urls = new Map<string, string>();
  const pages = new Map<string, number>();
  let textChars = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = "S" + (i + 1);

    if (row.kind === "url") {
      // الروابط لا تُفتح في هذه الجولة (الجولة C): تُذكر للنموذج كمرجع فقط، ولا يُستخرج منها شيء.
      urls.set(label, row.url ?? "");
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
      files.push({ label, kind: "pdf", name, mime: "application/pdf", base64: encodeBase64(bytes), bytes: bytes.byteLength, pages: count });
      srcs.push({ label, id: row.id, kind: "pdf" });
      continue;
    }

    if (row.kind === "image") {
      const media = imageType(bytes);
      if (!media) throw new SourceError(`الصورة «${name}» ليست PNG أو JPEG أو WEBP`);
      files.push({ label, kind: "image", name, mime: media, base64: encodeBase64(bytes), bytes: bytes.byteLength });
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
    srcs.push({ label, id: row.id, kind: row.kind, text });
  }

  return { srcs, files, urls, pages };
}

// أجزاء الرسالة بترتيب المصادر. seen: المصادر كما سيراها النموذج (نصها بعد الإخفاء)، وهي
// نفسها التي يطابق المدقق الاقتباس عليها. الملفات لا تُرسل إلا لطبقة تقبلها (العامة).
export function buildParts(loaded: Loaded, seen: Src[], allowFiles: boolean): ChatPart[] {
  const parts: ChatPart[] = [];
  const byLabel = new Map(seen.map((s) => [s.label, s]));
  for (const src of loaded.srcs) {
    if (src.kind === "url") {
      parts.push({ type: "text", text: wrapText(src.label, "url", `رابط سجّله الموظف ولم يُفتح: ${loaded.urls.get(src.label) ?? ""}\n(لا تستخرج أي قيمة من هذا المصدر)`) });
      continue;
    }
    const file = loaded.files.find((f) => f.label === src.label);
    if (file) {
      if (!allowFiles) throw new SourceError("هذه الطبقة لا تقرأ الملفات — الطلب يحتاج الطبقة العامة");
      const dataUrl = `data:${file.mime};base64,${file.base64}`;
      if (file.kind === "pdf") {
        parts.push({ type: "text", text: `<source id="${src.label}" kind="pdf" pages="${file.pages}"> (the PDF document that follows)` });
        parts.push({ type: "file", file: { filename: file.name, file_data: dataUrl } });
      } else {
        parts.push({ type: "text", text: `<source id="${src.label}" kind="image"> (the image that follows)` });
        parts.push({ type: "image_url", image_url: { url: dataUrl } });
      }
      parts.push({ type: "text", text: "</source>" });
      continue;
    }
    parts.push({ type: "text", text: wrapText(src.label, src.kind, byLabel.get(src.label)?.text ?? src.text ?? "") });
  }
  return parts;
}

// تقدير الرموز قبل الإنفاق (عدّ الرموز الدقيق خاص بـ Anthropic): النص بالحروف ÷ 3، وتقدير
// ثابت لكل صفحة PDF ولكل صورة. الرقم الحقيقي (prompt_tokens) يُسجَّل بعد النداء.
export const TOKENS_PER_PDF_PAGE = 1_600;
export const TOKENS_PER_IMAGE = 1_600;

export function estimateTokens(parts: ChatPart[], loaded: Loaded, extraText = ""): number {
  let chars = extraText.length;
  for (const p of parts) if (p.type === "text") chars += (p.text ?? "").length;
  let fixed = 0;
  if (parts.some((p) => p.type !== "text")) {
    for (const f of loaded.files) fixed += f.kind === "pdf" ? (f.pages ?? 1) * TOKENS_PER_PDF_PAGE : TOKENS_PER_IMAGE;
  }
  return Math.ceil(chars / 3) + fixed;
}
