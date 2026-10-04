// فتح رابط سجّله الموظف كمصدر (الجولة C من docs/TASK_AGENT.md): صفحة عامة تُقرأ كما يقرؤها أي زائر.
//
// السلوك الأمين فقط: لا تسجيل دخول، ولا تجاوز لحماية ضد الروبوتات، ولا انتحال متصفح. الوظيفة تعرّف
// نفسها باسمها في User-Agent، وتحترم robots.txt، وتقف عند أول رفض برسالة تطلب من الموظف لصق النص بدل الرابط:
// على الصفحة 401/403/429 أو صفحة تحدٍّ؛ وعلى robots.txt نفسه 401/403 أو صفحة تحدٍّ (فلا تُطلب الصفحة من موقع يرفض
// قراءة قواعده). أما 429 و5xx العادية على robots.txt فتعذّر عابر يُعاد الطلب بعده. ما يُقرأ يُحفظ في المخزن الخاص مرة واحدة (index.ts)، فتبقى
// الاقتباسات ثابتة مهما تغيّرت الصفحة بعد ذلك، ولا يُفتح الرابط مرتين للطلب الواحد.
//
// لا قاعدة ولا شبكة مباشرة هنا: الجلب ومحلّل الأسماء يُمرَّران من الخارج لتُختبر الدوال كلها بلا اتصال.
import { MAX_FILE_BYTES, MAX_PDF_PAGES } from "./sources.ts";

export const USER_AGENT = "MulaemAssistant/1.0 (+https://github.com/mohammedalseari-design/mulaem-dash)";
export const MAX_HTML_BYTES = 3 * 1024 * 1024;
export const MAX_PAGE_CHARS = 200_000;
export const FETCH_TIMEOUT_MS = 20_000; // النداء الواحد (صفحة أو تحويلة)
export const ROBOTS_TIMEOUT_MS = 8_000;
export const LINK_BUDGET_MS = 60_000; // الرابط الواحد بكل تحويلاته وملفات robots.txt التي يمر بها
const MAX_REDIRECTS = 5;
const ROBOTS_REDIRECTS = 3;
const ROBOTS_MAX_BYTES = 256 * 1024;
const CHALLENGE_PEEK_BYTES = 64 * 1024;
const MIN_TEXT_CHARS = 20;
const MAX_JSON_LD_CHARS = 20_000;

// retry: خطأ عابر (الموقع أو robots.txt غير متاح الآن) يعيد الطلب إلى الانتظار؛ غيره نهائي لهذا الطلب
export class UrlError extends Error {
  constructor(message: string, readonly retry = false) {
    super(message);
  }
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
// محلّل أسماء: عناوين المضيف (A وAAAA) ليُرفض اسم عام يشير إلى عنوان داخلي قبل الاتصال؛ فشله لا يمنع (الجلب نفسه سيفشل)
export type Resolve = (host: string) => Promise<string[]>;

export interface FetchOptions {
  resolve?: Resolve;
  budgetMs?: number;
  now?: () => number;
}

export interface FetchedPage {
  kind: "text" | "pdf";
  bytes: Uint8Array; // ما يُحفظ في المخزن: نص الصفحة UTF-8، أو ملف PDF كما وصل
  text: string | null; // نص الصفحة (text فقط)
  title: string | null;
  finalUrl: string; // بعد التحويلات
  contentType: string;
}

/* ===================== الرابط نفسه ===================== */

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".supabase.co", ".supabase.in"];

function privateIpv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function privateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true; // ULA وlink-local
  // الصيغة المعيّنة لـIPv4: ::ffff:10.0.0.1 أو كما يسلسلها محلّل URL: ::ffff:a00:1
  const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateIpv4(dotted[1]);
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return privateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

const isLiteral = (host: string) => host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
const privateAddress = (addr: string) => privateIpv4(addr) || privateIpv6(addr);

// الرابط العام الوحيد المقبول: http/https، بلا بيانات دخول ولا منفذ صريح، إلى مضيف باسم عام.
// العناوين الداخلية والمحلية تُرفض هنا قبل أي اتصال (الصيغ الرقمية الملتوية يوحّدها محلّل URL أولاً،
// والنقطة الختامية في الاسم تُحذف حتى لا تلتف على القوائم).
export function guardUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new UrlError("الرابط غير صالح");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlError("الرابط يجب أن يبدأ بـ http:// أو https://");
  if (u.username || u.password) throw new UrlError("الرابط يحمل بيانات دخول — لا تُفتح روابط بحسابات");
  if (u.port) throw new UrlError("الرابط على منفذ غير قياسي");
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) throw new UrlError("الرابط غير صالح");
  const blocked = isLiteral(host)
    ? privateAddress(host)
    : host === "localhost" || !host.includes(".") || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s));
  if (blocked) throw new UrlError("الرابط يشير إلى عنوان داخلي أو محلي — لا يُفتح");
  u.hostname = host;
  u.hash = "";
  return u.toString();
}

// اسم عام يشير إلى عنوان داخلي (سجل DNS يملكه الغير): يُرفض قبل الاتصال. تعذّر التحليل لا يمنع.
async function refuseIfPrivate(url: URL, resolve: Resolve): Promise<void> {
  if (isLiteral(url.hostname)) return;
  let addrs: string[];
  try {
    addrs = await resolve(url.hostname);
  } catch {
    return;
  }
  if (addrs.some(privateAddress)) throw new UrlError("الرابط يشير إلى عنوان داخلي أو محلي — لا يُفتح");
}

// المحلّل الحقيقي: Deno.resolveDns إن أتاحته بيئة التشغيل، وإلا لا شيء (يبقى حارس الاسم والعنوان الحرفي)
export const dnsResolve: Resolve = async (host) => {
  if (typeof Deno === "undefined" || typeof Deno.resolveDns !== "function") return [];
  const results = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  return results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
};

/* ===================== robots.txt ===================== */

// RFC 9309: المسار والنمط يُقارنان بعد توحيد الترميز: غير ASCII يُرمَّز بالنسبة المئوية (UTF-8)، والترميز
// القائم يُوحَّد إلى أحرف كبيرة؛ * و$ تبقيان كما هما.
function robotsNormalize(s: string): string {
  return s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase()).replace(/[\u0080-\u{10FFFF}]+/gu, (run) => encodeURIComponent(run));
}

// تطبيق قياسي مصغّر: مجموعة وكيلنا إن وُجدت (اسمها في robots.txt بادئة لاسمنا) وإلا مجموعة *،
// والقاعدة الأطول مطابقةً تحكم، وAllow تغلب عند التساوي. لا مجموعة ولا قاعدة مطابقة = مسموح. Disallow فارغة = مسموح.
export function robotsAllows(robotsTxt: string, path: string, agent = "mulaemassistant"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: typeof groups[number] | null = null;
  let collectingAgents = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      if (!current) continue;
      collectingAgents = false;
      current.rules.push({ allow: key === "allow", pattern: robotsNormalize(value) });
    } else {
      collectingAgents = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.startsWith(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  const target = robotsNormalize(path);
  let best: { allow: boolean; length: number } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!r.pattern) continue; // Disallow: (فارغة) = كل شيء مسموح
      if (!patternMatches(r.pattern, target)) continue;
      if (!best || r.pattern.length > best.length || (r.pattern.length === best.length && r.allow)) {
        best = { allow: r.allow, length: r.pattern.length };
      }
    }
  }
  return best ? best.allow : true;
}

// مطابقة خطية بلا تعبير نمطي يكتبه الموقع (نجوم كثيرة تجعل التعبير أُسّي الزمن): الأجزاء بين النجوم تُبحث
// بالتتابع من اليسار، و$ تثبّت الجزء الأخير في نهاية المسار.
function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(parts[0])) return false;
  let at = parts[0].length;
  if (parts.length === 1) return !anchored || at === path.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (anchored && i === parts.length - 1) return path.length - part.length >= at && path.endsWith(part);
    const found = path.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return true;
}

/* ===================== HTML إلى نص ===================== */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", laquo: "«", raquo: "»",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
  times: "×", trade: "™", zwnj: "", zwj: "", rlm: "", lrm: "", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const known = ENTITIES[body.toLowerCase()];
    return known === undefined ? m : known;
  });
}

// ما لا يُعرض أصلاً يُحذف بمحتواه؛ الوسم المغلق ذاتياً (<svg …/>) لا يبدأ كتلة. القوائم والتذييل تبقى:
// صندوق السعر وجوال المكتب يكونان فيها أحياناً، ولا يُحذف نص ظاهر بصمت
const DROP_NAME = /<(script|style|noscript|template|svg|iframe|canvas|video|audio|select)\b/gi;
const MAX_TAG_CHARS = 4000; // وسم فتح أطول من هذا ليس وسماً حقيقياً
const BLOCK_TAGS = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|table|thead|tbody|section|article|header|footer|nav|aside|main|dl|dd|dt|blockquote|pre|hr|figure|figcaption|address|details|summary)\b[^<>]*>/gi;
const CELL_TAGS = /<\/?(td|th)\b[^<>]*>/gi;

// مسح خطي (صفحة معادية بآلاف الوسوم غير المغلقة لا تُعلّق الوظيفة): لكل وسم فتح يُبحث عن إغلاقه مرة واحدة،
// والوسم الذي لا إغلاق له في الصفحة لا يُبحث له ثانية ويبقى ما بعده نصاً.
function dropBlocks(html: string): string {
  const name = new RegExp(DROP_NAME.source, "gi");
  const unclosed = new Set<string>();
  let out = "";
  let at = 0;
  let gt = -1; // أقرب «>» معروف بعد الموضع الحالي؛ يُعاد استعماله فلا يُمسح النص نفسه مرتين
  let m: RegExpExecArray | null;
  while ((m = name.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const afterName = name.lastIndex;
    if (gt < afterName) {
      gt = html.indexOf(">", afterName);
      if (gt < 0) break;
    }
    // وسم مغلق ذاتياً (<svg …/>) لا يبدأ كتلة
    if (gt - afterName > MAX_TAG_CHARS || html[gt - 1] === "/" || unclosed.has(tag)) continue;
    const closer = new RegExp(`</${tag}\\s*>`, "gi");
    closer.lastIndex = gt + 1;
    const end = closer.exec(html);
    if (!end) {
      unclosed.add(tag);
      continue;
    }
    out += html.slice(at, m.index) + " ";
    at = end.index + end[0].length;
    name.lastIndex = at;
  }
  return out + html.slice(at);
}

// تعليقات HTML: مسح خطي كذلك؛ تعليق بلا إغلاق يُترك كما هو
function dropComments(html: string): string {
  let out = "";
  let at = 0;
  while (true) {
    const start = html.indexOf("<!--", at);
    if (start < 0) break;
    const end = html.indexOf("-->", start + 4);
    if (end < 0) break;
    out += html.slice(at, start) + " ";
    at = end + 3;
  }
  return out + html.slice(at);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function collapse(s: string): string {
  return decodeEntities(s).replace(/[ \t\f\v ]+/g, " ").trim();
}

// عنوان الصفحة ووصفها: <title> ثم og:title؛ الوصف من description أو og:description
export function pageTitle(html: string): string | null {
  const t = html.match(/<title\b[^<>]*>([\s\S]{0,2000}?)<\/title\s*>/i);
  const title = t ? collapse(t[1].replace(/<[^<>]+>/g, " ")) : "";
  if (title) return title.slice(0, 300);
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    if ((attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase() === "og:title") {
      const c = collapse(attr(tag, "content") ?? "");
      if (c) return c.slice(0, 300);
    }
  }
  return null;
}

function metaDescription(html: string): string | null {
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    const key = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (key === "description" || key === "og:description") {
      const c = collapse(attr(tag, "content") ?? "");
      if (c) return c.slice(0, 2000);
    }
  }
  return null;
}

// البيانات المنظّمة (schema.org) التي تنشرها بوابات العقار في الصفحة نفسها: تُؤخذ كما هي قبل حذف السكربتات
function jsonLd(html: string): string {
  const out: string[] = [];
  let total = 0;
  // فتحٌ ثم بحث واحد عن الإغلاق (سكربت بلا إغلاق ينهي البحث كله): زمن خطي مهما كتبت الصفحة
  const opener = /<script\b[^<>]{0,1000}\btype\s*=\s*["']?application\/ld\+json["']?[^<>]{0,1000}>/gi;
  const closer = /<\/script\s*>/gi;
  while (opener.exec(html) !== null) {
    closer.lastIndex = opener.lastIndex;
    const end = closer.exec(html);
    if (!end) break;
    let body = html.slice(opener.lastIndex, end.index).trim();
    opener.lastIndex = end.index + end[0].length;
    try {
      body = JSON.stringify(JSON.parse(body), null, 1);
    } catch { /* نص غير صالح يبقى كما هو */ }
    if (!body) continue;
    if (total + body.length > MAX_JSON_LD_CHARS) break;
    total += body.length;
    out.push(decodeEntities(body)); // بعض المواقع تكتب العربية داخل JSON بكيانات HTML (&#x627;…)
  }
  return out.join("\n");
}

// نص مقروء من صفحة HTML: بلا سكربتات ولا أنماط ولا إطارات، والعناصر الكتلية سطوراً، والخلايا بفواصل.
// كل نص ظاهر يبقى (القوائم والتذييل أيضاً)؛ النص المخفي بالتنسيق قد يبقى، والمدقق وscanSuspicious يتعاملان معه.
export function htmlToText(html: string): string {
  const description = metaDescription(html);
  const structured = jsonLd(html);
  let s = dropBlocks(dropComments(html));
  s = s.replace(CELL_TAGS, " | ").replace(BLOCK_TAGS, "\n").replace(/<[^<>]+>/g, " ");
  s = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").replace(/(\s*\|\s*)+/g, " | ").replace(/^ \| /, "").replace(/ \| $/, "").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n") // سطر واحد لكل عنصر كتلي؛ الأسطر الفارغة بين الإغلاق والفتح لا تحمل معنى
    .trim();
  const head: string[] = [];
  if (description) head.push("الوصف: " + description);
  if (structured) head.push("بيانات منظّمة (JSON-LD):\n" + structured);
  return (head.length ? head.join("\n\n") + "\n\n" : "") + s;
}

// صفحة تحدٍّ (Cloudflare وأمثالها)، تعود بـ200 أحياناً وبـ403/503 غالباً: علامات صفحة التحقق نفسها ونص قصير. لا نحاول
// تجاوزها. العلامات خاصة بصفحة التحقق: لا «challenge-platform» ولا «cf_chl_» وحدهما، فهما في سكربت Cloudflare السلبي
// (/cdn-cgi/challenge-platform/scripts/jsd/…) الذي يُضاف إلى صفحات عادية كثيرة، وفي سطور Disallow لملفات robots.txt عادية.
const CHALLENGE_MARKERS =
  /(cf-browser-verification|_cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\/|<title>\s*just a moment|verify you are human|enable javascript and cookies to continue|checking your browser)/i;

function looksLikeChallenge(html: string, text: string): boolean {
  return text.length < 2000 && CHALLENGE_MARKERS.test(html);
}

// ترويسة Cloudflare الصريحة على رد التحقق
const cfChallenge = (res: Response) => (res.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge";

// صفحة تحقق في مكان robots.txt: الترويسة الصريحة، أو جسم HTML (يبدأ بوسم، أياً كان نوعه المعلن) قصير فيه علامات التحقق.
// ملف قواعد يذكر مسار التحقق في سطر Disallow ليس صفحة تحقق ولو أُعلن text/html، ولا صفحة طويلة تحمل السكربت المضاف
function robotsChallenge(res: Response, body: string): boolean {
  if (cfChallenge(res)) return true;
  return /^[\s﻿]*</.test(body) && looksLikeChallenge(body, htmlToText(body));
}

// مخازن الملفات (Amazon S3 وما يشبهها) تردّ على ملف غير موجود بـ403 AccessDenied إن لم يكن للزائر حق سرد المحتوى
function storageMissing(res: Response, body: string): boolean {
  return /AmazonS3/i.test(res.headers.get("server") ?? "") || /<Code>\s*(AccessDenied|NoSuchKey)\s*<\/Code>/i.test(body);
}

function charsetOf(contentType: string, head: string): string {
  const fromHeader = contentType.match(/charset\s*=\s*"?([\w-]+)/i)?.[1];
  const fromMeta = head.match(/<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  return (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
}

function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const label = charsetOf(contentType, head);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/* ===================== الجلب ===================== */

// مهلة الرابط الواحد: كل نداء (robots.txt، تحويلة، الصفحة) يأخذ أقل من سقفه ومن المتبقي من المهلة الكلية
class Budget {
  private readonly start: number;
  constructor(private readonly ms: number, private readonly now: () => number = Date.now) {
    this.start = now();
  }
  left(): number {
    return this.ms - (this.now() - this.start);
  }
  signal(cap: number): AbortSignal {
    const ms = Math.min(cap, this.left());
    if (ms <= 0) throw new UrlError("انتهت مهلة فتح الرابط", true);
    return AbortSignal.timeout(ms);
  }
}

function transient(e: unknown, host: string): UrlError {
  const name = (e as Error)?.name;
  return new UrlError(name === "TimeoutError" || name === "AbortError" ? `انتهت مهلة فتح ${host}` : `تعذّر الاتصال بـ ${host}`, true);
}

const fmtCap = (cap: number) => cap >= 1048576 ? `${Math.round(cap / 1048576)} ميغابايت` : `${Math.round(cap / 1024)} كيلوبايت`;

// يقرأ الجسم بحد أقصى: تجاوزه خطأ (لا اقتطاع صامت)، إلا في وضع المعاينة (peek) حيث تكفي البداية
async function readCapped(res: Response, cap: number, what: string, host: string, peek = false): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        if (peek) break;
        throw new UrlError(`${what} أكبر من الحد (${fmtCap(cap)})`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof UrlError) throw e;
    throw transient(e, host);
  }
  const out = new Uint8Array(Math.min(total, peek ? cap + 65_536 : total));
  let at = 0;
  for (const c of chunks) {
    if (at + c.byteLength > out.byteLength) break;
    out.set(c, at);
    at += c.byteLength;
  }
  return out.subarray(0, at);
}

const HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html, application/xhtml+xml, application/pdf, text/plain;q=0.9, */*;q=0.1",
  "Accept-Language": "ar, en;q=0.8",
};

const discard = (res: Response) => res.body?.cancel().catch(() => {});

// نداء بتحويلات يدوية: كل وجهة تمر على حارس الرابط ومحلّل الأسماء (وعلى beforeHop: robots.txt للصفحات)
// قبل أن تُطلب، فلا تقود تحويلة إلى عنوان داخلي ولا تتجاوز قيود موقع آخر.
async function fetchHops(
  fetchFn: Fetch, start: URL, budget: Budget, perHopMs: number, maxHops: number, resolve: Resolve,
  beforeHop: (u: URL) => Promise<void>,
): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    await refuseIfPrivate(url, resolve);
    await beforeHop(url);
    let res: Response;
    try {
      res = await fetchFn(url.toString(), { headers: HEADERS, redirect: "manual", signal: budget.signal(perHopMs) });
    } catch (e) {
      if (e instanceof UrlError) throw e;
      throw transient(e, url.hostname);
    }
    if (res.status < 300 || res.status >= 400) return { res, url };
    const location = res.headers.get("location");
    await discard(res);
    if (!location) throw new UrlError(`تعذّر فتح الرابط (تحويل بلا وجهة، HTTP ${res.status})`);
    if (hop >= maxHops) throw new UrlError("الرابط يتحوّل أكثر من اللازم");
    let next: string;
    try {
      next = new URL(location, url).toString();
    } catch {
      throw new UrlError("الرابط يتحوّل إلى وجهة غير صالحة");
    }
    url = new URL(guardUrl(next));
  }
}

async function robotsOk(fetchFn: Fetch, url: URL, cache: Map<string, string | null>, budget: Budget, resolve: Resolve): Promise<void> {
  const origin = url.origin;
  if (!cache.has(origin)) {
    let got: { res: Response; url: URL };
    try {
      got = await fetchHops(fetchFn, new URL(origin + "/robots.txt"), budget, ROBOTS_TIMEOUT_MS, ROBOTS_REDIRECTS, resolve, () => Promise.resolve());
    } catch (e) {
      // robots.txt يتحوّل إلى عنوان داخلي أو غير صالح: الموقع لا يُقرأ آلياً
      if (e instanceof UrlError && !e.retry) {
        throw new UrlError(`الموقع ${url.hostname} يحوّل robots.txt إلى وجهة غير مقبولة — الصق نص الإعلان بدل الرابط`);
      }
      throw e;
    }
    const { res } = got;
    // بداية الجسم لتسمية الرفض فقط: الحالة وحدها تقرر، فجسم يتعثّر أو ينقطع لا يحوّل رفضاً إلى تعذّر عابر
    const peek = async () => {
      try {
        return decode(await readCapped(res, CHALLENGE_PEEK_BYTES, "robots.txt", url.hostname, true), res.headers.get("content-type") ?? "");
      } catch {
        return "";
      }
    };
    const challenge = () =>
      new UrlError(`الموقع ${url.hostname} يضع صفحة تحقق أمام القراءة الآلية${res.ok ? "" : ` (robots.txt ${res.status})`} — الصق نص الإعلان بدل الرابط`);
    if (res.status === 429 || res.status >= 500) {
      // صفحة تحقق خلف 429/503 رفضٌ نهائي كما على الصفحة نفسها (لا يُطرق الباب ثلاث مرات)؛ غيرها تعذّر عابر يُعاد
      if (robotsChallenge(res, await peek())) throw challenge();
      throw new UrlError(`الموقع ${url.hostname} لا يستجيب الآن (robots.txt ${res.status})`, true);
    }
    if (res.status === 401 || res.status === 403) {
      const body = await peek();
      // مخزن ملفات (S3 وما أمامه) يردّ على ملف غير موجود بـ403 حين لا يملك الزائر حق سرد المحتوى: غياب لا رفض
      if (res.status === 403 && storageMissing(res, body)) {
        cache.set(origin, null);
      } else {
        // موقع يرفض أن يقرأ برنامجٌ قواعده نفسها يرفض البرامج كلها: يقف الطلب هنا ولا تُطلب الصفحة
        // (المعيار يسمح بالمتابعة، والأمانة لا)
        if (robotsChallenge(res, body)) throw challenge();
        throw new UrlError(`الموقع ${url.hostname} يمنع القراءة الآلية أو يتطلب تسجيل الدخول (robots.txt ${res.status}) — الصق نص الإعلان بدل الرابط`);
      }
    } else if (res.ok) {
      const rules = new TextDecoder("utf-8").decode(await readCapped(res, ROBOTS_MAX_BYTES, "robots.txt", url.hostname));
      // صفحة تحقق مكان robots.txt رفض؛ أما ملف قواعد عادي يذكر مسار التحقق (Disallow: /cdn-cgi/challenge-platform/) فيُقرأ كغيره
      if (robotsChallenge(res, rules)) throw challenge();
      cache.set(origin, rules);
    } else {
      // غير موجود (404 وأمثالها) = لا قيود معلنة
      await discard(res);
      cache.set(origin, null);
    }
  }
  const robots = cache.get(origin);
  if (robots !== null && robots !== undefined && !robotsAllows(robots, url.pathname + url.search)) {
    throw new UrlError(`الموقع ${url.hostname} لا يسمح للبرامج بقراءة هذه الصفحة (robots.txt) — الصق نص الإعلان بدل الرابط`);
  }
}

function statusError(status: number, host: string): UrlError {
  if (status === 401 || status === 403) {
    return new UrlError(`الموقع ${host} يمنع القراءة الآلية أو يتطلب تسجيل الدخول (${status}) — الصق نص الإعلان بدل الرابط`);
  }
  if (status === 404 || status === 410) return new UrlError(`الصفحة غير موجودة (${status})`);
  if (status === 429) return new UrlError(`الموقع ${host} يحدّ من الطلبات الآلية (429) — الصق نص الإعلان بدل الرابط`);
  if (status >= 500) return new UrlError(`الموقع ${host} أعاد خطأً مؤقتاً (${status})`, true);
  return new UrlError(`تعذّر فتح الرابط (HTTP ${status})`);
}

// يفتح رابطاً عاماً واحداً: robots.txt لكل أصل يمرّ به، ثم الصفحة بتحويلات محدودة يُفحص كل منها كالرابط
// الأول، كل ذلك داخل مهلة واحدة. يعيد نص الصفحة (أو ملف PDF) ليُحفظ في المخزن.
export async function fetchUrlSource(raw: string, fetchFn: Fetch, opts: FetchOptions = {}): Promise<FetchedPage> {
  const resolve = opts.resolve ?? dnsResolve;
  const budget = new Budget(opts.budgetMs ?? LINK_BUDGET_MS, opts.now);
  const first = new URL(guardUrl(raw));
  const robots = new Map<string, string | null>();
  const { res, url } = await fetchHops(
    fetchFn, first, budget, FETCH_TIMEOUT_MS, MAX_REDIRECTS, resolve, (u) => robotsOk(fetchFn, u, robots, budget, resolve),
  );
  const host = url.hostname;

  if (!res.ok) {
    // 403/429/503 تكون صفحة تحدٍّ غالباً: تُقرأ بدايتها لتسمية الرفض باسمه (نهائي، لا يُعاد الطرق)، لا لتجاوزه
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      let peek = "";
      try {
        peek = decode(await readCapped(res, CHALLENGE_PEEK_BYTES, "الصفحة", host, true), res.headers.get("content-type") ?? "");
      } catch { /* الحالة وحدها تقرر إن تعثّر الجسم */ }
      if (cfChallenge(res) || CHALLENGE_MARKERS.test(peek)) {
        throw new UrlError(`الموقع ${host} يضع صفحة تحقق أمام القراءة الآلية (${res.status}) — الصق نص الإعلان بدل الرابط`);
      }
    } else {
      await discard(res);
    }
    throw statusError(res.status, host);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const isPdf = contentType.includes("application/pdf");
  const isText = /text\/html|application\/xhtml\+xml|text\/plain/.test(contentType) || contentType === "";
  if (!isPdf && !isText) {
    await discard(res);
    throw new UrlError(`الرابط ليس صفحة ويب ولا ملف PDF (${contentType.split(";")[0] || "نوع مجهول"})`);
  }
  const bytes = await readCapped(res, isPdf ? MAX_FILE_BYTES : MAX_HTML_BYTES, isPdf ? "الملف" : "الصفحة", host);
  const finalUrl = url.toString();

  // الملف يُحكم بمحتواه لا بما أعلنه الخادم: PDF يبدأ بـ%PDF-
  if (isPdf || String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") {
    if (bytes.byteLength > MAX_FILE_BYTES) throw new UrlError("الملف أكبر من عشرة ميغابايت");
    return { kind: "pdf", bytes, text: null, title: null, finalUrl, contentType: "application/pdf" };
  }

  const plainType = contentType.includes("text/plain");
  const html = decode(bytes, contentType);
  let plain = plainType ? html.trim() : htmlToText(html);
  if (!plainType && looksLikeChallenge(html, plain)) {
    throw new UrlError(`الموقع ${host} يضع صفحة تحقق أمام القراءة الآلية — الصق نص الإعلان بدل الرابط`);
  }
  if (plain.length < MIN_TEXT_CHARS) {
    throw new UrlError("الصفحة بلا نص مقروء (فارغة أو تُبنى بالجافاسكربت بعد التحميل) — الصق نص الإعلان بدل الرابط");
  }
  if (plain.length > MAX_PAGE_CHARS) {
    throw new UrlError(`نص الصفحة أطول من الحد (${MAX_PAGE_CHARS.toLocaleString("en")} حرفاً) — الصق الجزء المطلوب منها`);
  }
  // الصفحة المقروءة فعلاً تُسمّى في أول سطر محفوظ إن حوّل الرابط إلى غيرها
  if (finalUrl !== first.toString()) plain = `الرابط بعد التحويل: ${finalUrl}\n\n` + plain;
  const title = plainType ? null : pageTitle(html);
  return { kind: "text", bytes: new TextEncoder().encode(plain), text: plain, title, finalUrl, contentType: contentType.split(";")[0] };
}

export { MAX_PDF_PAGES };
