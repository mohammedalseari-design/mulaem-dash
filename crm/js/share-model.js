// «مشاركة المشروع مع عميل» و«مشاركاتي» وصفحة العميل: حساب صافٍ بلا DOM ولا شبكة، يُختبر وحده في tests/share-model.test.mjs.
//
// ما يصل من get_project_share (038) يُقرأ هنا مرة واحدة (publicView): صفحة العميل (public-project.js) ونافذة المشاركة
// وبطاقة الصورة (share-project.js) ترسم الشيء نفسه، فلا تختلف البطاقة عن الصفحة التي يفتحها رمزها. العمولة والملاحظات
// لا تصل من الخادم أصلاً، فلا شيء هنا يعرفها.
//
// وفيه رمز QR (نمط البايت، تصحيح M، الإصدارات 1–10) لبطاقة الصورة: رابط الصفحة نحو 60 حرفاً فيكفيه الإصدار الرابع.

import { countText, number, money, toAsciiDigits } from './ui.js';

export const FORMATS = ['link', 'card', 'pdf'];
export const FORMAT_LABEL = { link: 'رابط صفحة', card: 'بطاقة صورة', pdf: 'بروفايل PDF' };
export const FORMAT_HINT = { link: 'يفتحه العميل مباشرة', card: 'جاهزة للواتساب', pdf: 'ملف مفصّل بالصور والنماذج' };
export const FORMAT_ICON = { link: 'link', card: 'image', pdf: 'file' };
export const OFFICE_NAME = 'ملائم العقارية';
export const SAR = 'ر.س';
// «مهتم الآن»: فتح الرابط خلال آخر ساعتين
export const INTEREST_MS = 2 * 60 * 60 * 1000;

// أيقونات خطية بنمط ui.js (شبكة 24) لما ليس في ICON_PATHS هناك. نفس المسارات ترسمها البطاقة على canvas (Path2D)
export const SH_ICONS = {
    image: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 15l-5-5L5 21'],
    lock: ['M6 11h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    copy: ['M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
    idcard: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M6 16.5a3 3 0 0 1 6 0', 'M15 10h3', 'M15 14h2'],
    share: ['M18 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M18 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M8.2 10.8l7.6-4.4', 'M8.2 13.2l7.6 4.4'],
    bed: ['M3 19v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7', 'M3 16h18', 'M6 10V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3'],
    area: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
    calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4'],
    pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
    phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'],
    chat: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
    building: ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M2 21h20', 'M8 7h4M8 11h4M8 15h4'],
    check: ['M20 6L9 17l-5-5'],
    info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
    printer: ['M6 9V3h12v6', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v7H6z'],
    close: ['M18 6L6 18', 'M6 6l12 12']
};

// ألوان البطاقة: نسخة من متغيرات crm/v6.css في الوضع النهاري (:root). share-project.js يقرأ المتغيرات نفسها من الصفحة،
// وهذه لا تُستعمل إلا إن غابت (الملف لم يُحمَّل). البطاقة نهارية دائماً: صورة تُرسل لعميل، لا جزء من شاشة الموظف.
export const CARD_COLORS = {
    bg: '#f5f2eb', surface: '#fffefb', hover: '#f2eee6', ink: '#15201c', ink2: '#3a4541', muted: '#5d6762',
    line: '#e7e1d6', line2: '#d5cdbf', brand: '#1b5b62'
};

/* ===================== نصوص صغيرة ===================== */

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// نص من قيمة حرة: الأرقام نص، والكائنات والمصفوفات لا شيء، والفراغ لا شيء
export function cleanText(value, max = 400) {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

// نص طويل (الوصف): تبقى أسطره الفارغة فواصل فقرات، وتُختصر الفراغات المكررة
export function cleanBlock(value, max = 3000) {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') return '';
    return String(value).replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const posNum = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

// «حي الشاطئ» مرة واحدة ولو كُتب الحي بكلمة «حي» في القاعدة
export function districtText(district) {
    const d = cleanText(district, 80);
    if (!d) return '';
    return /^(ح[يى]ّ?|مخطط)(\s|$)/.test(d) ? d : 'حي ' + d;
}

// «حي الشاطئ، جدة» لصفحة العميل والبطاقة، و«الشاطئ، جدة» مختصراً لصفوف «مشاركاتي»
export function placeText(district, city, short = false) {
    return [short ? cleanText(district, 80) : districtText(district), cleanText(city, 60)].filter(Boolean).join('، ');
}

// حالة البناء كما تكتبها صفحة المشاريع: القيمة المعتمدة بمسافتها، والنص الحر كما كُتب
export function constructionText(value) {
    const text = cleanText(value, 60);
    return text === 'تحت_الإنشاء' ? 'تحت الإنشاء' : text.replace(/_/g, ' ');
}

// موعد التسليم: نص التفاصيل كما كُتب («الربع الثاني 2027») أولاً، وإلا شهر وسنة من التاريخ («يونيو 2027»)
export function deliveryText(timeText, dateValue) {
    const text = cleanText(timeText, 60);
    if (text) return text;
    const m = /^(\d{4})-(\d{2})/.exec(String(dateValue || ''));
    if (!m) return '';
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? MONTHS[month - 1] + ' ' + m[1] : m[1];
}

export function priceText(value) {
    const n = posNum(value);
    return n === null ? '' : money(n) + ' ' + SAR;
}

// «3 إلى 6 غرف» أو «3–6 غرف» مختصراً، و«3 غرف» لقيمة واحدة
export function roomsText(range, compact = false) {
    if (!range) return '';
    if (range.min === range.max) return countText(range.min, ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة']);
    const word = range.max <= 10 ? 'غرف' : 'غرفة';
    return number(range.min) + (compact ? '–' : ' إلى ') + number(range.max) + ' ' + word;
}

export function areaText(range, compact = false) {
    if (!range) return '';
    if (range.min === range.max) return number(range.min) + ' م²';
    return number(range.min) + (compact ? '–' : ' إلى ') + number(range.max) + ' م²';
}

// أول حرف للصورة الرمزية في لوحة المستشار
export function initialOf(name) {
    const text = cleanText(name, 80).replace(/^(ال)/, '');
    return text ? Array.from(text)[0] : 'م';
}

/* ===================== الجوال ===================== */

// جوال سعودي بأي كتابة شائعة (05… أو 5… أو ‎+966…‎ أو ‎00966…‎، وبالأرقام العربية) ← 9665XXXXXXXX كما يقرؤه wa.me.
// أي رقم غيره null.
export function normalizeMobile(text) {
    const digits = toAsciiDigits(text).replace(/\D/g, '');
    if (/^05\d{8}$/.test(digits)) return '966' + digits.slice(1);
    if (/^5\d{8}$/.test(digits)) return '966' + digits;
    if (/^9665\d{8}$/.test(digits)) return digits;
    if (/^009665\d{8}$/.test(digits)) return digits.slice(2);
    return null;
}

// الرقم بصيغة دولية بلا علامة +: الجوال كما سبق، والمحلي الذي يبدأ بصفر برمز السعودية، و00 تُحذف
export function intlDigits(raw) {
    const mobile = normalizeMobile(raw);
    if (mobile) return mobile;
    const digits = toAsciiDigits(raw).replace(/\D/g, '');
    if (digits.length < 7) return null;
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('0')) return '966' + digits.slice(1);
    return digits;
}

// للعرض: «055 123 4567» للجوال السعودي، وغيره كما كُتب
export function phoneDisplay(raw) {
    const mobile = normalizeMobile(raw);
    if (!mobile) return cleanText(raw, 30);
    const local = '0' + mobile.slice(3);
    return local.slice(0, 3) + ' ' + local.slice(3, 6) + ' ' + local.slice(6);
}

export function phoneTel(raw) {
    const digits = intlDigits(raw);
    return digits ? 'tel:+' + digits : null;
}

// رابط واتساب برسالة جاهزة. بلا رقم: wa.me يفتح قائمة المحادثات فيختار الوسيط عميله
export function waLink(phone, text) {
    const digits = phone ? intlDigits(phone) : null;
    return 'https://wa.me/' + (digits || '') + '?text=' + encodeURIComponent(String(text || ''));
}

/* ===================== الرمز والرابط والزائر ===================== */

export const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const VISITOR_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isShareCode(code) {
    return typeof code === 'string' && CODE_RE.test(code);
}

export function isVisitorId(value) {
    return typeof value === 'string' && VISITOR_RE.test(value);
}

// base: رابط crm/p.html بلا استعلام. ord: النموذج الذي يخصه الرابط (عرض واحد يختاره الوسيط). البروفايل يفتح الصفحة نفسها بوضع
// الطباعة (PDF)
export function shareLink(base, code, format = 'link', ord = null) {
    let url = String(base || '') + '?c=' + encodeURIComponent(String(code || ''));
    if (Number.isInteger(ord) && ord > 0) url += '&m=' + ord;
    return format === 'pdf' ? url + '&print=1' : url;
}

// ?c=…&m=2&print=1 → { code, model, print }. رمز بشكل غير صالح لا يُسأل عنه الخادم
export function readParams(search) {
    const params = new URLSearchParams(String(search || ''));
    const code = params.get('c') || '';
    const model = params.get('m') || '';
    return { code: isShareCode(code) ? code : null, given: Boolean(code), print: params.get('print') === '1', model: /^[1-9][0-9]{0,4}$/.test(model) ? Number(model) : null };
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// معرّف الزائر: 16 بايتاً عشوائياً بحروف آمنة في الرابط (22 حرفاً). bytes من crypto.getRandomValues
export function newVisitorId(bytes) {
    let out = '';
    let acc = 0;
    let bits = 0;
    for (const b of bytes) {
        acc = (acc << 8) | (b & 255);
        bits += 8;
        while (bits >= 6) {
            bits -= 6;
            out += B64URL[(acc >>> bits) & 63];
        }
        acc &= (1 << bits) - 1;
    }
    if (bits > 0) out += B64URL[(acc << (6 - bits)) & 63];
    return out;
}

/* ===================== ما يصل من get_project_share ===================== */

function unitOf(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const ord = Number(raw.ord);
    if (!Number.isInteger(ord) || ord < 0) return null;
    const total = Math.max(1, Math.floor(Number(raw.total)) || 1);
    const available = Math.min(total, Math.max(0, Math.floor(Number(raw.available)) || 0));
    return {
        ord,
        name: ord === 0 ? '' : cleanText(raw.name, 80) || 'وحدة ' + ord,
        type: cleanText(raw.type, 60),
        rooms: posNum(raw.rooms),
        bathrooms: posNum(raw.bathrooms),
        area: posNum(raw.area),
        price: posNum(raw.price),
        plan: typeof raw.plan === 'string' && /^https:\/\//i.test(raw.plan) ? raw.plan : null,
        total,
        available
    };
}

const range = (values) => {
    const list = values.filter((v) => v !== null);
    return list.length ? { min: Math.min(...list), max: Math.max(...list) } : null;
};

// أرقام المشروع من نماذجه (أو صف «كامل العقار» حين لا نماذج): المتاح من الكل، وأقل سعر بين المتاح («يبدأ من» حين
// تختلف الأسعار، و«السعر» حين يكون واحداً)، ومدى الغرف والمساحة بين النماذج كلها (وصف للمشروع لا للمتاح)
export function summarize(units, soldOut = false) {
    const all = (units || []).filter(Boolean);
    const models = all.filter((u) => u.ord > 0);
    const list = models.length ? models : all.filter((u) => u.ord === 0);
    const available = soldOut ? 0 : list.reduce((sum, u) => sum + u.available, 0);
    const total = list.reduce((sum, u) => sum + u.total, 0);
    const prices = soldOut ? [] : list.filter((u) => u.available > 0 && u.price !== null).map((u) => u.price);
    const distinct = new Set(prices);
    return {
        models: models.length,
        total,
        available,
        fromPrice: prices.length ? Math.min(...prices) : null,
        priceLabel: distinct.size > 1 ? 'يبدأ من' : 'السعر',
        rooms: range(list.map((u) => (u.rooms !== null ? Math.round(u.rooms) : null))),
        area: range(list.map((u) => (u.area !== null ? Math.round(u.area) : null)))
    };
}

export function mapUrl(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined || lat === '' || lng === '') return null;
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
    return 'https://www.google.com/maps?q=' + a + ',' + b;
}

// صفحة العميل كلها من رد الخادم: null حين لا رد (رمز غير صالح، أو المشروع لم يعد معتمداً). ord: عرض واحد (قرار المالك: الرابط
// والرسالة لنموذج واحد يختاره الوسيط، فلا يظهر غيره ولا تدخل أرقامه). نموذج لم يعد موجوداً: يظهر الكل
export function publicView(payload, ord = null) {
    if (!payload || typeof payload !== 'object' || !payload.project || typeof payload.project !== 'object') return null;
    const p = payload.project;
    const all = (Array.isArray(payload.units) ? payload.units : []).map(unitOf).filter(Boolean).sort((a, b) => a.ord - b.ord);
    const soldOut = p.sold_out === true;
    if (soldOut) for (const u of all) u.available = 0;
    const offer = Number.isInteger(ord) && ord > 0 ? all.find((u) => u.ord === ord) || null : null;
    const units = offer ? [offer] : all;
    const images = [];
    for (const src of Array.isArray(p.images) ? p.images : []) {
        if (typeof src === 'string' && /^https:\/\//i.test(src) && !images.includes(src)) images.push(src);
    }
    const features = [];
    for (const f of Array.isArray(p.features) ? p.features : []) {
        const text = cleanText(f, 120);
        if (text && !features.includes(text)) features.push(text);
    }
    const c = payload.consultant && typeof payload.consultant === 'object' ? payload.consultant : {};
    const phone = cleanText(c.phone, 30);
    const district = cleanText(p.district, 80);
    const city = cleanText(p.city, 60);
    return {
        name: cleanText(p.name, 160) || 'مشروع',
        type: cleanText(p.type, 60),
        purpose: p.purpose === 'rent' ? 'rent' : p.purpose === 'sale' ? 'sale' : '',
        district,
        city,
        place: placeText(district, city),
        status: constructionText(p.construction_status),
        delivery: deliveryText(p.delivery_time, p.delivery_date),
        description: cleanBlock(p.description, 3000),
        features: features.slice(0, 16),
        images: images.slice(0, 24),
        mapUrl: mapUrl(p.latitude, p.longitude),
        license: cleanText(p.ad_license, 60),
        soldOut,
        offer,
        units,
        models: units.filter((u) => u.ord > 0),
        whole: units.find((u) => u.ord === 0) || null,
        summary: summarize(units, soldOut),
        consultant: {
            name: cleanText(c.name, 80),
            phone: phone || '',
            display: phone ? phoneDisplay(phone) : '',
            tel: phone ? phoneTel(phone) : null
        }
    };
}

// المواصفات في سطر: «3 غرف · 165 م²»
export function modelSpecs(model) {
    if (!model) return '';
    return [
        model.rooms !== null ? countText(Math.round(model.rooms), ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة']) : '',
        model.area !== null ? number(model.area) + ' م²' : ''
    ].filter(Boolean).join(' · ');
}

// العرض الذي تبدأ به نافذة المشاركة: النموذج المطلوب باسمه (من المطابقة)، وإلا أول متاح، وإلا الأول. عقار بلا نماذج: null
export function defaultOffer(view, unitKey = null) {
    const models = view ? view.models : [];
    if (!models.length) return null;
    const wanted = cleanText(unitKey, 80);
    const named = wanted ? models.find((m) => m.name === wanted) : null;
    return (named || models.find((m) => m.available > 0) || models[0]).ord;
}

// سطر النموذج في قائمة «اختر العرض»
export function offerLabel(model) {
    if (!model) return '';
    return [model.name, modelSpecs(model), model.price !== null ? priceText(model.price) : '', model.available > 0 ? '' : 'غير متاح'].filter(Boolean).join(' · ');
}

// حبّة النموذج: «متاح 6» (أو «متاح» لوحدة واحدة) بالأخضر، و«غير متاح» رمادية
export function modelPill(model) {
    if (!model || model.available <= 0) return { text: 'غير متاح', tone: 'muted' };
    return { text: model.total > 1 ? 'متاح ' + number(model.available) : 'متاح', tone: 'ok' };
}

// «متاح 14 من 40 وحدة»، أو كلمة لعقار من وحدة واحدة
export function unitsLine(summary) {
    if (!summary || !summary.total) return '';
    if (summary.total === 1) return summary.available > 0 ? 'متاح الآن' : 'غير متاح الآن';
    if (summary.available <= 0) return 'لا وحدات متاحة الآن';
    return 'متاح ' + number(summary.available) + ' من ' + countText(summary.total, ['وحدة واحدة', 'وحدتين', 'وحدات', 'وحدة']);
}

// «متاح 14 وحدة» في معاينة الجوال
export function availableText(summary) {
    if (!summary || summary.available <= 0) return '';
    return 'متاح ' + countText(summary.available, ['وحدة واحدة', 'وحدتان', 'وحدات', 'وحدة']);
}

// خانات شريط صفحة العميل: السعر، ثم الغرف (أو المساحة)، ثم التسليم (أو حالة البناء)
export function stripFacts(view) {
    if (!view) return [];
    const s = view.summary;
    const cells = [{ key: 'price', label: s.priceLabel, value: s.fromPrice === null ? 'عند التواصل' : money(s.fromPrice), unit: s.fromPrice === null ? '' : SAR }];
    if (s.rooms) cells.push({ key: 'rooms', label: 'الغرف', value: roomsText(s.rooms, true), unit: '' });
    else if (s.area) cells.push({ key: 'area', label: 'المساحة', value: areaText(s.area, true), unit: '' });
    if (view.delivery) cells.push({ key: 'delivery', label: 'التسليم', value: view.delivery, unit: '' });
    else if (view.status) cells.push({ key: 'status', label: 'الحالة', value: view.status, unit: '' });
    return cells;
}

// ثلاث حقائق للبطاقة بلا عدد المتاح (يتغيّر، والرمز يفتح الصفحة المحدّثة): الغرف، والمساحة، والتسليم، ثم النوع إن نقص منها
export function cardFacts(view) {
    if (!view) return [];
    const s = view.summary;
    const facts = [];
    if (s.rooms) facts.push({ icon: 'bed', text: roomsText(s.rooms) });
    if (s.area) facts.push({ icon: 'area', text: areaText(s.area) });
    if (view.delivery) facts.push({ icon: 'calendar', text: 'التسليم ' + view.delivery });
    else if (view.status) facts.push({ icon: 'calendar', text: view.status });
    if (facts.length < 3 && view.type) facts.push({ icon: 'building', text: view.type });
    return facts.slice(0, 3);
}

/* ===================== الرسائل ===================== */

// اسم يبدأ بكلمة «مشروع» لا تتكرر قبله
const startsWithWord = (name) => /^مشروع(\s|$)/.test(name);

// «من 3 إلى 6 غرف»، ومع قيمة واحدة الرقم وحده
const spanned = (range, text) => (range.min !== range.max ? 'من ' + text : text);

// ما في الصفحة فعلاً، فلا تَعِد الرسالة بما ليس فيها: «الصور والمخططات هنا:». لا ذكر للموقع (قرار المالك)
function pageLine(view) {
    const parts = [];
    if (view.images.length) parts.push('الصور');
    if (view.models.some((m) => m.plan)) parts.push('المخططات');
    return (parts.length ? parts.join(' و') : 'التفاصيل') + ' هنا:';
}

// رسالة الوسيط للعميل في واتساب، بالصيغة التي اعتمدها المالك (2026-11-04): تحية، ثم المشروع بلا حي ولا مدينة، ثم العرض الواحد
// بأرقامه في نقاط، والرابط في سطره (wa.me يجعله قابلاً للضغط)، ثم مستشاره ورقم ملائم للتواصل. ما لا قيمة له لا سطر له
export function shareMessage(format, view, link) {
    if (!view) return String(link || '');
    const s = view.summary;
    const sizes = [
        s.rooms ? spanned(s.rooms, roomsText(s.rooms)) : '',
        s.area ? spanned(s.area, areaText(s.area)) : ''
    ].filter(Boolean).join(' · ');
    const c = view.consultant;
    return [
        'السلام عليكم،',
        (format === 'pdf' ? 'أرسل لك بروفايل ' : 'أرسل لك تفاصيل ') + (startsWithWord(view.name) ? '' : 'مشروع ') + '«' + view.name + '»:',
        view.offer && view.offer.name ? '• ' + view.offer.name : '',
        s.fromPrice === null ? '' : '• ' + (view.offer ? '' : s.priceLabel + ' ') + priceText(s.fromPrice),
        sizes ? '• ' + sizes : '',
        view.delivery ? '• التسليم: ' + view.delivery : view.status ? '• الحالة: ' + view.status : '',
        format === 'pdf' ? 'تقدر تحفظه PDF من هنا:' : pageLine(view),
        link,
        c.name ? 'مستشارك العقاري: ' + c.name : '',
        // علامتا اتجاه غير مرئيتين حول الرقم، وإلا عُكست مجموعاته في سطر عربي: «4567 123 055»
        c.display ? 'للتواصل: \u200e' + c.display + '\u200e' : '',
        OFFICE_NAME
    ].filter(Boolean).join('\n');
}

// رسالة العميل إلى رقم ملائم من صفحة المشروع، باسم من أرسل له الرابط ليصل إلى وسيطه. kind: ask | visit | model
export function contactMessage(view, kind = 'ask', model = null) {
    if (!view) return '';
    const name = view.consultant && view.consultant.name;
    const offer = view.offer && view.offer.name && kind !== 'model' ? ' (' + view.offer.name + ')' : '';
    const start = 'مرحباً، اطلعت على ' + (startsWithWord(view.name) ? '' : 'مشروع ') + view.name + offer + (name ? ' عن طريق ' + name : '') + ' وأرغب ';
    if (kind === 'visit') return start + 'بحجز زيارة.';
    if (kind === 'model' && model) {
        const price = model.price !== null ? ' (' + priceText(model.price) + ')' : '';
        return start + 'بمعرفة المزيد عن ' + (model.name || 'النموذج') + price + '.';
    }
    return start + 'بمعرفة المزيد وحجز زيارة.';
}

/* ===================== «مشاركاتي» ===================== */

const time = (iso) => {
    if (!iso) return NaN;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : NaN;
};

// العدد مع معدوده لعبارات الزمن: «دقيقة»، «دقيقتين»، «3 دقائق»، «11 دقيقة»
function unitCount(n, forms) {
    if (n === 1) return forms[0];
    if (n === 2) return forms[1];
    if (n >= 3 && n <= 10) return n + ' ' + forms[2];
    return number(n) + ' ' + forms[3];
}

function dayDiff(a, b) {
    const da = new Date(a); da.setHours(0, 0, 0, 0);
    const db = new Date(b); db.setHours(0, 0, 0, 0);
    return Math.round((db - da) / 86400000);
}

// «الآن»، «قبل دقيقتين»، «قبل ساعة»، «أمس»، «قبل 3 أيام»، ثم التاريخ («3 نوفمبر»، وبالسنة إن لم تكن هذه السنة)
export function agoText(iso, now = new Date()) {
    const t = time(iso);
    if (!Number.isFinite(t)) return '';
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    const diff = nowMs - t;
    if (diff < 60000) return 'الآن';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return 'قبل ' + unitCount(minutes, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة']);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'قبل ' + unitCount(hours, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']);
    const days = dayDiff(t, nowMs);
    if (days <= 1) return 'أمس';
    if (days < 7) return 'قبل ' + unitCount(days, ['يوم', 'يومين', 'أيام', 'يوماً']);
    const d = new Date(t);
    const year = d.getFullYear() === new Date(nowMs).getFullYear() ? '' : ' ' + d.getFullYear();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + year;
}

// «مهتم الآن»: آخر فتح خلال ساعتين (ودقائق قليلة من فرق الساعات بين الجهاز والخادم مقبولة)
export function isInterestedNow(lastOpenedIso, now = new Date()) {
    const t = time(lastOpenedIso);
    if (!Number.isFinite(t)) return false;
    const diff = (now instanceof Date ? now.getTime() : Number(now)) - t;
    return diff <= INTEREST_MS && diff >= -5 * 60000;
}

// كم شخصاً فتح الرابط، بفعل يطابق العدد
export function opensText(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v === 0) return 'لم يفتحه أحد';
    if (v === 1) return 'شخص واحد فتحه';
    if (v === 2) return 'شخصان فتحاه';
    if (v <= 10) return v + ' أشخاص فتحوه';
    return number(v) + ' شخصاً فتحوه';
}

// معدود الأشخاص بجانب رقم كبير في الشريط: «1 شخص»، «5 أشخاص»، «11 شخصاً»
export function peopleUnit(n) {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v === 1 || v === 2) return 'شخص';
    if (v >= 3 && v <= 10) return 'أشخاص';
    return v === 0 ? 'أشخاص' : 'شخصاً';
}

// سطر الوقت في صف المشاركة: «آخر فتح: قبل ساعة»، وما لم يُفتح «أُرسل قبل 3 أيام»
export function lastOpenText(row, now = new Date()) {
    if (!row) return '';
    if (row.last_opened_at) return 'آخر فتح: ' + agoText(row.last_opened_at, now);
    if (row.last_shared_at) return 'أُرسل ' + agoText(row.last_shared_at, now);
    return '';
}

// الأحدث فتحاً أولاً، وما لم يُفتح بعده بالأحدث إرسالاً
export function sortShares(rows) {
    return (rows || []).slice().sort((a, b) => {
        const oa = time(a.last_opened_at);
        const ob = time(b.last_opened_at);
        if (Number.isFinite(oa) !== Number.isFinite(ob)) return Number.isFinite(oa) ? -1 : 1;
        if (Number.isFinite(oa) && oa !== ob) return ob - oa;
        const sa = time(a.last_shared_at) || 0;
        const sb = time(b.last_shared_at) || 0;
        if (sa !== sb) return sb - sa;
        return String(a.project_name || '').localeCompare(String(b.project_name || ''), 'ar');
    });
}

// عدد كل صيغة لحبّات التصفية، و'' للكل
export function formatCounts(rows) {
    const out = { '': 0, link: 0, card: 0, pdf: 0 };
    for (const row of rows || []) {
        out[''] += 1;
        if (Object.prototype.hasOwnProperty.call(out, row.last_format) && row.last_format) out[row.last_format] += 1;
    }
    return out;
}

// أرقام الشريط الثلاثة: مشاركات هذا الشهر (وكم منها فُتح)، ومن فتح الروابط كلها، ومن فتحها خلال آخر 7 أيام
export function stripNumbers(rows, now = new Date()) {
    const list = rows || [];
    const nowDate = now instanceof Date ? now : new Date(now);
    const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
    const month = list.filter((r) => time(r.last_shared_at) >= monthStart);
    let last = NaN;
    for (const r of list) {
        const t = time(r.last_opened_at);
        if (Number.isFinite(t) && !(t <= last)) last = t;
    }
    const weekAgo = nowDate.getTime() - 7 * 86400000;
    return {
        monthShares: month.length,
        monthOpened: month.filter((r) => Number(r.opens_total) > 0).length,
        people: list.reduce((sum, r) => sum + (Number(r.opens_total) || 0), 0),
        weekPeople: list.reduce((sum, r) => sum + (Number(r.opens_week) || 0), 0),
        lastOpenedAt: Number.isFinite(last) ? new Date(last).toISOString() : null,
        lastOpenedThisWeek: Number.isFinite(last) && last >= weekAgo
    };
}

// سطر خانة «مشاركات هذا الشهر»: كم منها فُتح. all: مشاركات كل الموظفين (المدير)
export function monthSubText(strip, all = false) {
    if (!strip || !strip.monthShares) return all ? 'لا مشاركات هذا الشهر' : 'لم تشارك مشروعاً هذا الشهر';
    const n = strip.monthOpened;
    if (n === 0) return 'لم يُفتح منها شيء بعد';
    if (n === 1) return 'واحدة منها فُتحت';
    if (n === 2) return 'اثنتان منها فُتحتا';
    return number(n) + ' منها فُتحت';
}

// سطر خانة «هذا الأسبوع»: متى فتح آخرهم
export function weekSubText(strip, now = new Date(), all = false) {
    if (!strip || !strip.weekPeople) return all ? 'لم يفتح أحد الروابط هذا الأسبوع' : 'لم يفتح أحد روابطك هذا الأسبوع';
    const last = strip.lastOpenedThisWeek && strip.lastOpenedAt ? '، آخرهم ' + agoText(strip.lastOpenedAt, now) : '';
    return (all ? 'فتحوا الروابط' : 'فتحوا روابطك') + last;
}

// السطر في نافذة المشاركة تحت الأزرار: «رابطك فتحه 5 أشخاص · آخرهم قبل ساعة»
export function sheetStatsText(row, now = new Date()) {
    if (!row || !row.last_shared_at) return '';
    const n = Math.max(0, Math.floor(Number(row.opens_total) || 0));
    if (n === 0) return 'لم يفتح أحد رابطك بعد';
    const people = countText(n, ['شخص واحد', 'شخصان', 'أشخاص', 'شخصاً']);
    return 'رابطك فتحه ' + people + (row.last_opened_at ? ' · آخرهم ' + agoText(row.last_opened_at, now) : '');
}

// اسم ملف البطاقة: «ملائم - اسم المشروع.png» بلا حروف تمنعها أنظمة الملفات
export function cardFileName(name) {
    const safe = cleanText(name, 60).replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim();
    return 'ملائم - ' + (safe || 'مشروع') + '.png';
}

/* ===================== رمز QR ===================== */
// ISO/IEC 18004: نمط البايت، مستوى التصحيح M (نحو 15٪)، الإصدارات 1–10 (حتى 213 بايتاً)، وأفضل قناع من الثمانية بعقوبات
// المواصفة. الإحداثيات (x عمود، y صف) كما في المواصفة. يُرسم كما هو: true مربع داكن.

// [كلمات التصحيح في الكتلة، عدد الكتل] للمستوى M
const QR_EC_M = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]];
const QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const QR_MAX_VERSION = 10;

// كل الكلمات (بيانات وتصحيح) في الإصدار
export function qrRawCodewords(ver) {
    let bits = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const n = Math.floor(ver / 7) + 2;
        bits -= (25 * n - 10) * n - 55;
        if (ver >= 7) bits -= 36;
    }
    return Math.floor(bits / 8);
}

export function qrDataCodewords(ver) {
    const [ec, blocks] = QR_EC_M[ver];
    return qrRawCodewords(ver) - ec * blocks;
}

// الضرب في GF(256) بكثيرة الحدود 0x11D
export function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}

function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = gfMul(result[j], root);
            if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = gfMul(root, 0x02);
    }
    return result;
}

// باقي القسمة على مولّد ريد-سولومون: كلمات التصحيح للكتلة
export function rsRemainder(data, degree) {
    const divisor = rsDivisor(degree);
    const result = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ result.shift();
        result.push(0);
        divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
}

// الكتل بترتيبها في الرمز: بايت من كل كتلة بالتناوب، ثم كلمات التصحيح كذلك
function qrInterleave(data, ver) {
    const [ecLen, numBlocks] = QR_EC_M[ver];
    const raw = qrRawCodewords(ver);
    const numShort = numBlocks - (raw % numBlocks);
    const shortData = Math.floor(raw / numBlocks) - ecLen;
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const len = shortData + (i < numShort ? 0 : 1);
        const dat = data.slice(k, k + len);
        k += len;
        blocks.push({ dat, ecc: rsRemainder(dat, ecLen) });
    }
    const out = [];
    for (let i = 0; i <= shortData; i++) for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ecc[i]);
    return out;
}

// بتات الصيغة (15 بتاً): المستوى M (00) والقناع، مع BCH وقناع 0x5412
export function qrFormatBits(mask) {
    const data = mask & 7;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
}

export function qrVersionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
}

const QR_MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];
export const qrMaskAt = (mask, x, y) => QR_MASKS[mask](x, y);

function linePenalty(at, size) {
    let result = 0;
    let runColor = false;
    let runLen = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    const addHistory = (len) => {
        if (history[0] === 0) len += size;
        history.pop();
        history.unshift(len);
    };
    const finderLike = () => {
        const n = history[1];
        const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
        return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
    };
    for (let i = 0; i < size; i++) {
        const c = at(i);
        if (c === runColor) {
            runLen++;
            if (runLen === 5) result += 3;
            else if (runLen > 5) result++;
        } else {
            addHistory(runLen);
            if (!runColor) result += finderLike() * 40;
            runColor = c;
            runLen = 1;
        }
    }
    if (runColor) {
        addHistory(runLen);
        runLen = 0;
    }
    addHistory(runLen + size);
    return result + finderLike() * 40;
}

// عقوبات المواصفة الأربع: صفوف متصلة، ومربعات 2×2، وأشباه علامات الزوايا، وميزان الداكن والفاتح
export function qrPenalty(modules) {
    const size = modules.length;
    let result = 0;
    for (let y = 0; y < size; y++) result += linePenalty((x) => modules[y][x], size);
    for (let x = 0; x < size; x++) result += linePenalty((y) => modules[y][x], size);
    let dark = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const c = modules[y][x];
            if (c) dark++;
            if (x < size - 1 && y < size - 1 && c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
        }
    }
    const total = size * size;
    return result + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

function utf8(text) {
    return Array.from(new TextEncoder().encode(String(text || '')));
}

// المصفوفة: { version, size, mask, modules } أو null لنص أطول من الإصدار العاشر. options.mask يثبّت القناع (للاختبار)
export function qrMatrix(text, options = {}) {
    const bytes = utf8(text);
    let ver = 1;
    for (; ver <= QR_MAX_VERSION; ver++) {
        if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= qrDataCodewords(ver) * 8) break;
    }
    if (ver > QR_MAX_VERSION || !bytes.length) return null;

    const bits = [];
    const put = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    const capacity = qrDataCodewords(ver) * 8;
    put(4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
        data.push(v);
    }
    const codewords = qrInterleave(data, ver);

    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { modules[y][x] = dark; fixed[y][x] = true; };

    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                if (x < 0 || y < 0 || x >= size || y >= size) continue;
                const d = Math.max(Math.abs(dx), Math.abs(dy));
                set(x, y, d !== 2 && d !== 4);
            }
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    const pos = QR_ALIGN[ver];
    const n = pos.length;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }
    const drawFormat = (mask) => {
        const f = qrFormatBits(mask);
        const bit = (k) => ((f >>> k) & 1) === 1;
        for (let k = 0; k <= 5; k++) set(8, k, bit(k));
        set(8, 7, bit(6));
        set(8, 8, bit(7));
        set(7, 8, bit(8));
        for (let k = 9; k < 15; k++) set(14 - k, 8, bit(k));
        for (let k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k));
        for (let k = 8; k < 15; k++) set(8, size - 15 + k, bit(k));
        set(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
        const v = qrVersionBits(ver);
        for (let k = 0; k < 18; k++) {
            const dark = ((v >>> k) & 1) === 1;
            const a = size - 11 + (k % 3);
            const b = Math.floor(k / 3);
            set(a, b, dark);
            set(b, a, dark);
        }
    }

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!fixed[y][x] && i < codewords.length * 8) {
                    modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
                    i++;
                }
            }
        }
    }

    const applyMask = (mask) => {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) if (!fixed[y][x] && QR_MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
        }
    };
    let best = Number.isInteger(options.mask) && options.mask >= 0 && options.mask < 8 ? options.mask : -1;
    if (best < 0) {
        let bestScore = Infinity;
        for (let m = 0; m < 8; m++) {
            applyMask(m);
            drawFormat(m);
            const score = qrPenalty(modules);
            if (score < bestScore) {
                best = m;
                bestScore = score;
            }
            applyMask(m);
        }
    }
    applyMask(best);
    drawFormat(best);
    return { version: ver, size, mask: best, modules, fixed };
}
