// قراءة ملفات «تصدير الدردشة» من واتساب — بلا DOM وبلا شبكة، فتُختبر وحدها.
//
// لماذا التصدير لا واجهة برمجية: الواجهة الرسمية (WhatsApp Business Platform) لا تقرأ
// المجموعات ولا المحادثات القديمة، ولا يُبنى هنا أي شيء يلتف على ذلك. المصدر الوحيد هو
// ملف يصدّره المالك بنفسه من هاتفه: ‎_chat.txt‎ أو ملف ‎.zip‎ (مع الوسائط أو بدونها).
//
// الناتج كتل عروض: رسائل متتالية من المرسل نفسه خلال دقائق تُدمج في كتلة واحدة، لأن
// الوسيط يرسل العرض عادةً على عدة رسائل (نص ثم صور ثم سطر السعر).

/* ===================== تنظيف النص ===================== */

// علامات الاتجاه التي يحشرها واتساب حول الأرقام والأسماء، والمسافات غير المنكسرة.
const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function cleanLine(text) {
    return String(text || '')
        .replace(BIDI, '')
        .replace(/[   ]/g, ' ');
}

export function asciiDigits(text) {
    return String(text || '').replace(/[٠-٩۰-۹]/g, (d) => {
        const i = ARABIC_DIGITS.indexOf(d);
        return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
    });
}

/* ===================== رأس الرسالة ===================== */

// آيفون:  [21/9/2026، 9:47:45 ص] المرسل: النص
// أندرويد: 21/09/2026, 9:47 م - المرسل: النص
const IOS_HEAD = /^\[(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})[,،]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|AM|PM|am|pm|a\.m\.|p\.m\.)?\]\s?(.*)$/;
const ANDROID_HEAD = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})[,،]?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|AM|PM|am|pm|a\.m\.|p\.m\.)?\s+-\s(.*)$/;

function matchHead(line) {
    const m = IOS_HEAD.exec(line) || ANDROID_HEAD.exec(line);
    if (!m) return null;
    return { a: +m[1], b: +m[2], c: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0, ampm: m[7] || '', rest: m[8] };
}

// ترتيب اليوم والشهر يختلف بلغة الهاتف. يُحسم للملف كله: قيمة أكبر من 12 في الموضع
// الأول تعني يوم/شهر، وفي الثاني تعني شهر/يوم، وإلا فالافتراض السعودي يوم/شهر.
function dayFirst(heads) {
    let dm = 0, md = 0;
    for (const h of heads) {
        if (h.a > 31) continue; // سنة/شهر/يوم
        if (h.a > 12) dm += 1;
        else if (h.b > 12) md += 1;
    }
    return md <= dm;
}

const pad = (n) => String(n).padStart(2, '0');

// وقت محلي كما في الهاتف بلا منطقة زمنية: "2026-09-21T09:47:45". يُقارن نصياً.
function stampOf(h, dmFirst) {
    let year, month, day;
    if (h.a > 31) { year = h.a; month = h.b; day = h.c; }
    else if (dmFirst) { day = h.a; month = h.b; year = h.c; }
    else { month = h.a; day = h.b; year = h.c; }
    if (year < 100) year += 2000;
    let hour = h.h;
    const ap = h.ampm.toLowerCase();
    const pm = ap === 'م' || ap === 'pm' || ap === 'p.m.';
    const am = ap === 'ص' || ap === 'am' || ap === 'a.m.';
    if (pm && hour < 12) hour += 12;
    if (am && hour === 12) hour = 0;
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && h.mi <= 59)) return null;
    return year + '-' + pad(month) + '-' + pad(day) + 'T' + pad(hour) + ':' + pad(h.mi) + ':' + pad(h.s);
}

// "المرسل: النص" — الاسم قد يبدأ بـ "~ " لغير المحفوظين. سطر النظام قد لا يحمل مرسلاً.
function splitSender(rest) {
    const i = rest.indexOf(': ');
    if (i <= 0 || i > 80) return { sender: '', text: rest };
    return { sender: rest.slice(0, i).replace(/^~\s*/, '').trim(), text: rest.slice(i + 2) };
}

/* ===================== أنواع الرسائل ===================== */

const SYSTEM_PATTERNS = [
    /^انضم/, /انضم.*باستخدام رابط/, /لقد انضممت/, /^غادر/, / غادر$/, / أضاف /, /^أضاف /, / أزال /, /^أزال /,
    /غيّر (رقم هاتفه|صورة|اسم|وصف|إعدادات)/, /غير (رقم هاتفه|صورة|اسم|وصف|إعدادات)/, /تغيّر أعضاء المجموعة/,
    /أنشأ (المجموعة|مجموعة)/, /الرسائل والمكالمات مشفرة/, /تم حذف هذه الرسالة/, /حذفت هذه الرسالة/,
    /تم حذف الملصقات/, /رمز الأمان/, /أصبح مشرفاً|أصبحت مشرفاً/, /ثبّت رسالة|ثبت رسالة/,
    /^This message was deleted/i, /joined using this group/i, /\bleft$/, /\badded\b/, /\bremoved\b/,
    /changed (the group|this group|their phone|the subject)/i, /end-to-end encrypted/i, /created group/i,
    /security code changed/i, /انقر للعرض/
];

// ما يكتبه واتساب مكان الوسائط غير المصدّرة، ومكان المرفق حين تُصدَّر الوسائط.
const OMITTED = /(لم يتم إدراج [^\s]+( [^\s]+)?|<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|document omitted|GIF omitted|Contact card omitted|الوسائط غير مضمّنة|الوسائط غير مضمنة)/gi;
// "بروشور التحديثات.pdf • 22 صفحة" — اسم مستند أُرسل ولم يُصدَّر.
const DOCUMENT_LINE = /^(.+?\.(pdf|xlsx?|docx?|pptx?))(\s*•.*)?$/i;
const EDITED = /<(تم تعديل هذه الرسالة|This message was edited)>/gi;
const ATTACHED = /<[^<>:]{1,20}:\s*([^<>]+?\.[A-Za-z0-9]{2,5})>/g;          // <مرفق: 0001-PHOTO.jpg>
const ANDROID_ATTACHED = /([\w.\-]+\.[A-Za-z0-9]{2,5}) \((ملف مرفق|file attached)\)/g;

function isSystem(text, sender, groupName) {
    const t = text.trim();
    if (!t) return false;
    if (t.length > 160) return false;
    if (groupName && sender === groupName && /مشفرة|encrypted|أنشأ|created/i.test(t)) return true;
    return SYSTEM_PATTERNS.some((re) => re.test(t));
}

/* ===================== تصنيف العرض ===================== */

const PRICE = /(\d[\d,.]*\s*(ألف|الف|آلاف|مليون|ملايين|ريال|ر\.س|k\b))|(\d{1,3}(,\d{3}){1,2})|(\b\d{6,8}\b)/i;
const PROPERTY = /(شقة|شقه|شقق|فيلا|فيلة|فلة|فله|فلل|دور|أدوار|ادوار|أرض|ارض|عمارة|عماره|دوبلكس|تاون|روف|مشروع|وحدة|وحده|وحدات|غرف|غرفة|غرفه|م2|م²|متر|مساحة|مساحه|استوديو|ملحق|محل|مستودع)/;
const OFFER_WORDS = /(للبيع|للإيجار|للايجار|السعر|سعر|أسعار|اسعار|تبدأ|تبدا|العمولة|عمولة|عموله|تحت الإنشاء|تحت الانشاء|جاهز|إفراغ|افراغ|متاح|متوفر|نماذج|تشطيب|تسليم|دفعة|دفعه|أقساط|اقساط)/;
const WANTED = /^\s*[*_~]*\s*(مطلوب|ابغى|أبغى|ابغا|أبحث|ابحث|نبحث|نبغى|عميل يبحث|عميل يبغى|عندي عميل|يوجد عميل|لدي عميل|لدينا عميل)/;
const UPDATE_WORDS = /(تحديث|تم تعديل|تعديل الأسعار|تعديل الاسعار|تخفيض|السعر الجديد|الأسعار الجديدة|الاسعار الجديدة|تم بيع|تم البيع|مباعة|مباع|نفذت|نفذ|محجوز|تم حجز|المتبقي|المتبقية|آخر الوحدات|اخر الوحدات)/;

// offer: عرض جديد | update: تحديث على عرض قائم | wanted: طلب شراء لا عرض | other: غير ذلك
export function classify(text) {
    const t = asciiDigits(text);
    if (WANTED.test(t)) return 'wanted';
    const hasPrice = PRICE.test(t);
    const hasProperty = PROPERTY.test(t);
    const hasOfferWord = OFFER_WORDS.test(t);
    if ((hasPrice && (hasProperty || hasOfferWord)) || (hasProperty && hasOfferWord && t.length > 60)) {
        return UPDATE_WORDS.test(t) ? 'update' : 'offer';
    }
    return 'other';
}

// نص للمقارنة بين نسخ العرض نفسه (الوسطاء يعيدون نشره في أكثر من مجموعة).
export function normalizeForDedupe(text) {
    return asciiDigits(cleanLine(text))
        .replace(/[*_~`]/g, '')
        .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[ً-ْـ]/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .toLowerCase();
}

/* ===================== التحليل ===================== */

export const MERGE_MINUTES = 15;

function minutesBetween(a, b) {
    return Math.abs(Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 60000;
}

// يعيد { group, messages, blocks, firstAt, lastAt }.
//   messages: كل رسالة { at, sender, text, system, media, attachments }
//   blocks:   كتل غير نظامية { at, lastAt, sender, text, kind, media, documents, attachments, count }
//             kind: offer | update | wanted | other | document (كتلة ليس فيها إلا مستند)
//             documents: مستندات ذُكرت ولم تُصدَّر | attachments: ملفات موجودة فعلاً في الأرشيف
// options.files: أسماء الملفات الموجودة فعلاً في الأرشيف، فلا يُعرض مرفق غير موجود.
export function parseChat(raw, options = {}) {
    const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
    const heads = [];
    const entries = [];
    for (const original of lines) {
        const line = cleanLine(original);
        const head = matchHead(asciiDigits(line));
        if (head) {
            heads.push(head);
            // الأرقام تُحوَّل لقراءة الرأس فقط؛ نص الرسالة يُؤخذ من السطر الأصلي بطول الرأس نفسه.
            entries.push({ head: head, first: line.slice(line.length - head.rest.length), lines: [] });
        } else if (entries.length) {
            entries[entries.length - 1].lines.push(line);
        }
    }
    const dm = dayFirst(heads);
    const knownFiles = options.files ? new Set(options.files) : null;

    // اسم المجموعة: ما مرّره المستدعي (من اسم الملف أو المجلد)، وإلا مرسل سطر التشفير الأول.
    let group = options.group || '';
    const messages = [];
    for (const entry of entries) {
        const at = stampOf(entry.head, dm);
        if (!at) continue;
        const split = splitSender(entry.first);
        let text = [split.text].concat(entry.lines).join('\n');
        if (!group && messages.length === 0 && /مشفرة|encrypted/i.test(text)) group = split.sender;

        const attachments = [];
        text = text.replace(ATTACHED, (_, name) => { attachments.push(name.trim()); return ''; });
        text = text.replace(ANDROID_ATTACHED, (_, name) => { attachments.push(name.trim()); return ''; });
        let media = attachments.length > 0;
        text = text.replace(OMITTED, () => { media = true; return ''; });
        text = text.replace(EDITED, '').replace(/[ \t]+\n/g, '\n').trim();

        const documents = [];
        for (const line of text.split('\n')) {
            const doc = DOCUMENT_LINE.exec(line.trim());
            if (doc && doc[1].length <= 120) documents.push(doc[1].trim());
        }
        if (documents.length) media = true;

        const usable = knownFiles ? attachments.filter((name) => knownFiles.has(name)) : attachments;
        messages.push({
            at: at,
            sender: split.sender,
            text: text,
            system: isSystem(text, split.sender, group),
            media: media,
            documents: documents,
            attachments: usable
        });
    }

    const blocks = [];
    let current = null;
    for (const msg of messages) {
        if (msg.system) { current = null; continue; }
        if (!msg.text && !msg.media) continue;
        if (current && current.sender === msg.sender && minutesBetween(current.lastAt, msg.at) <= MERGE_MINUTES) {
            // الصورة الثانية بالتعليق نفسه لا تكرّر النص في الكتلة.
            if (msg.text && current.pieces.indexOf(msg.text) === -1) {
                current.pieces.push(msg.text);
                current.text = current.text ? current.text + '\n' + msg.text : msg.text;
            }
            current.media = current.media || msg.media;
            current.documents.push(...msg.documents);
            current.attachments.push(...msg.attachments);
            current.lastAt = msg.at;
            current.count += 1;
            continue;
        }
        current = {
            at: msg.at, lastAt: msg.at, sender: msg.sender, text: msg.text,
            media: msg.media, documents: msg.documents.slice(), attachments: msg.attachments.slice(),
            pieces: msg.text ? [msg.text] : [], count: 1
        };
        blocks.push(current);
    }
    for (const block of blocks) {
        delete block.pieces;
        block.kind = block.text ? classify(block.text) : 'other';
        // مستند وحده بلا نص عرض (بروشور، جدول أسعار) يُعرض مع العروض ليُصدَّر مع الوسائط.
        if (block.kind === 'other' && (block.documents.length || block.attachments.some(isDocumentName))) {
            block.kind = 'document';
        }
    }

    return {
        group: group,
        messages: messages,
        blocks: blocks,
        firstAt: messages.length ? messages[0].at : null,
        lastAt: messages.length ? messages[messages.length - 1].at : null
    };
}

export function isDocumentName(name) {
    return /\.(pdf|xlsx?|csv)$/i.test(String(name || ''));
}

// "WhatsApp Chat - شركة زود.zip" / "محادثة واتساب مع X.txt" → اسم المجموعة
export function groupFromFileName(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/\.(zip|txt)$/i, '').trim();
    const m = /^(?:WhatsApp Chat(?: with)?|محادثة واتساب(?: مع)?|دردشة واتساب(?: مع)?)\s*[-–]?\s*(.+)$/i.exec(base);
    if (m) return m[1].trim();
    if (/^_?chat$/i.test(base)) return '';
    return base;
}

/* ===================== قراءة ملف ZIP ===================== */
// قارئ صغير لما يصدّره واتساب: الفهرس المركزي ثم فك الضغط عند الطلب عبر
// DecompressionStream('deflate-raw') المدمج في المتصفح — بلا مكتبة خارجية.

export function readZipIndex(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('الملف ليس أرشيف ZIP صالحاً');
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    if (offset === 0xffffffff || count === 0xffff) throw new Error('الأرشيف كبير جداً — صدّر المحادثة بدون وسائط');
    const decoder = new TextDecoder('utf-8');
    const entries = [];
    for (let n = 0; n < count; n++) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('فهرس الأرشيف تالف');
        const method = view.getUint16(offset + 10, true);
        const compressed = view.getUint32(offset + 20, true);
        const size = view.getUint32(offset + 24, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const local = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
        entries.push({ name: name, base: name.split('/').pop(), method: method, compressed: compressed, size: size, local: local });
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

export async function readZipEntry(buffer, entry) {
    const view = new DataView(buffer);
    if (view.getUint32(entry.local, true) !== 0x04034b50) throw new Error('ملف تالف داخل الأرشيف');
    const nameLen = view.getUint16(entry.local + 26, true);
    const extraLen = view.getUint16(entry.local + 28, true);
    const start = entry.local + 30 + nameLen + extraLen;
    const data = new Uint8Array(buffer, start, entry.compressed);
    if (entry.method === 0) return data.slice();
    if (entry.method !== 8) throw new Error('طريقة ضغط غير مدعومة في الأرشيف');
    if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح لا يدعم فك الضغط — افتح الأرشيف وارفع ‎_chat.txt‎');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function chatEntry(entries) {
    const txt = entries.filter((e) => /\.txt$/i.test(e.base) && !e.name.startsWith('__MACOSX'));
    return txt.find((e) => /^_?chat\.txt$/i.test(e.base)) || txt.find((e) => /whatsapp|واتساب|محادثة/i.test(e.base)) || txt[0] || null;
}
