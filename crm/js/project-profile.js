// صفحة العقار (‎#/project/:id‎): الحساب الصافي لتبويباتها الثلاثة، بلا DOM ولا شبكة، يُختبر وحده في tests/project-profile.test.mjs.
//
//   • التبويب من الرابط: ‎#/project/12?tab=plans‎ (الموجّه يمرّر «12?tab=plans» كما هو)، و«البروفايل» بلا لاحقة.
//   • «البروفايل» من صف المشروع: الصور (projects.images: رابط نصي، أو { url, caption } من البروشور المصنَّف — https وحده كما
//     تعرضه اللوحة)، والوصف (details.description الذي يكتبه المساعد، وإلا projects.notes كما في شاشة الاعتماد)، والمميزات
//     (details.amenities أو details.features كما يقرؤها استوديو البروشورات)، والحقائق: المطوّر وحالة البناء والتسليم وعدد
//     الوحدات ورخصة الإعلان (projects.rega_ad_license، وتاريخ انتهائها listing_expires_at)، والموقع (الإحداثيات، وإلا العنوان).
//   • «المخططات»: بطاقة لكل نموذج من صفوف لوحة الوحدات (units-board.js) ومخططه details.models[ord-1].plan إن كان رابط https.
//   • «ارفع بروشور المطور»: عنوان الطلب الذي يُعرف به، وفحص الملف قبل الرفع، ومراحل الطلب (رُفع ← يقرأ المساعد ← بانتظار
//     اعتماد المدير) من صف agent_requests ومسوداته. لا شيء هنا يكتب.

import { countText, number } from './ui.js';

/* ===================== التبويبات والرابط ===================== */

export const PROJECT_TABS = [
    { key: 'profile', label: 'البروفايل' },
    { key: 'plans', label: 'المخططات' },
    { key: 'bookings', label: 'الحجوزات' }
];
export const DEFAULT_TAB = 'profile';
const TAB_KEYS = PROJECT_TABS.map((tab) => tab.key);

// «12» أو «12?tab=plans» ← { id: '12', tab: 'plans' }. تبويب لا يُعرف = null (يُفتح الافتراضي). المعرّف يُفحص في project.js
export function parseProjectRoute(raw) {
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    const q = text.indexOf('?');
    const id = (q < 0 ? text : text.slice(0, q)).trim();
    const query = q < 0 ? '' : text.slice(q + 1);
    const m = /(?:^|&)tab=([a-z]+)(?:&|$)/.exec(query);
    const route = { id, tab: m && TAB_KEYS.includes(m[1]) ? m[1] : null };
    // ?share=1: صفحة المشاريع القديمة تفتح نافذة المشاركة هنا
    if (/(?:^|&)share=1(?:&|$)/.test(query)) route.share = true;
    return route;
}

// رابط الصفحة على تبويب: الافتراضي بلا لاحقة، فيبقى الرابط كما تكتبه «العقارات» والبحث السريع
export function projectHash(id, tab) {
    const base = '#/project/' + id;
    return tab && tab !== DEFAULT_TAB && TAB_KEYS.includes(tab) ? base + '?tab=' + tab : base;
}

// التنقل بالأسهم بين التبويبات وفي عارض الصور: يدور من الآخر إلى الأول ومن الأول إلى الآخر
export function wrapIndex(i, n) {
    if (!(n > 0)) return 0;
    const k = Math.trunc(Number(i)) || 0;
    return ((k % n) + n) % n;
}

/* ===================== قراءة القيم ===================== */

const present = (value) => value !== null && value !== undefined && typeof value !== 'object' && String(value).trim() !== '';

function detailsOf(project) {
    const d = project && project.details;
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}

// أول نص غير فارغ: الحقول الحرة في details قد تأتي أرقاماً أو فراغات أو كائنات
export function firstText(...values) {
    for (const value of values) {
        if (!present(value)) continue;
        return String(value).trim();
    }
    return '';
}

// كما في صفحة المشاريع (constructionLabel في js/script.js): القيمة المعتمدة بمسافتها، والنص الحر كما كُتب لأنه أدق
export function constructionLabel(value) {
    const text = firstText(value);
    return text === 'تحت_الإنشاء' ? 'تحت الإنشاء' : text;
}

// عدد صحيح موجب من رقم أو نص أرقام (بالعربية أو اللاتينية)، وإلا null
function positiveInt(value) {
    if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
    if (typeof value !== 'string') return null;
    const t = value.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    return /^\d{1,7}$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

// تاريخ «YYYY-MM-DD» من عمود date أو طابع زمني، وإلا null
function dateOnly(value) {
    const t = String(value === null || value === undefined ? '' : value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

const HTTPS = /^https:\/\/[^\s"'<>]+$/i;

// صورة تُعرض: https فقط، كما تعرضها اللوحة وصفحة الاعتماد (shownImage)
export function httpsUrl(value) {
    if (typeof value !== 'string') return null;
    const t = value.trim();
    return HTTPS.test(t) ? t : null;
}

/* ===================== «البروفايل» ===================== */

export const MAX_IMAGES = 60;

// صور المشروع بترتيبها: رابط نصي (المخزون) أو كائن { url, caption } (البروشور المصنَّف)، بلا تكرار ولا رابط غير https
export function projectImages(project) {
    const list = project && Array.isArray(project.images) ? project.images : [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { url: raw };
        const url = httpsUrl(item.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, caption: firstText(item.caption).slice(0, 60) || null });
        if (out.length >= MAX_IMAGES) break;
    }
    return out;
}

// شبكة الصور في «البروفايل»: خمس على الأكثر (كبيرة وأربع صغيرة)، و«كل الصور (N)» تفتح العارض حين تكون أكثر من صورة
export function galleryPlan(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    return { shown: Math.min(n, 5), all: n > 1 ? n : 0 };
}

// نص حر طويل كما كُتب: بلا فراغ في أوله وآخره، وبلا أكثر من سطر فارغ واحد بين الفقرات
function longText(value, max = 3000) {
    if (!present(value)) return null;
    const t = String(value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return t ? t.slice(0, max) : null;
}

// «عن المشروع»: الوصف (details.description)، وإلا الملاحظات (notes) كما في شاشة الاعتماد. الملاحظات المختلفة عن الوصف
// تبقى سطراً تحته، فلا تختفي معلومة كتبها الموظف في صفحة المشاريع
export function projectAbout(project) {
    const description = longText(detailsOf(project).description);
    const notes = longText(project && project.notes);
    return {
        text: description || notes || null,
        notes: description && notes && notes !== description ? notes : null
    };
}

export const MAX_FEATURES = 16;

// المميزات: قائمة (أو نص بسطر لكل ميزة) في details.amenities أو details.features، بلا علامات التعداد ولا تكرار
export function projectFeatures(project) {
    const d = detailsOf(project);
    const raw = d.amenities !== undefined && d.amenities !== null ? d.amenities : d.features;
    const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
    const seen = new Set();
    const out = [];
    for (const item of items) {
        if (!present(item)) continue;
        const t = String(item).replace(/^\s*(?:[-–—•·*▪◦]|\d{1,2}[.)-])\s*/, '').trim().slice(0, 80);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= MAX_FEATURES) break;
    }
    return out;
}

// عدد الوحدات: مجموع وحدات النماذج في لوحة الوحدات، وإلا ما كُتب في التفاصيل (units_count من المساعد، aptCount من صفحة
// المشاريع)، وإلا وحدة واحدة لعقار بلا نماذج له صف «كامل العقار»، وإلا null
export function unitsCount(project, rows) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const models = list.filter((row) => Number(row.ord) > 0);
    if (models.length) return models.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    const d = detailsOf(project);
    const written = positiveInt(d.units_count) || positiveInt(d.aptCount);
    if (written) return written;
    return list.some((row) => Number(row.ord) === 0) ? 1 : null;
}

// رقم رخصة الإعلان: عمود projects.rega_ad_license، وإلا ما قرأه استوديو البروشورات في التفاصيل
export function adLicense(project) {
    const d = detailsOf(project);
    return firstText(project && project.rega_ad_license, d.license, d.rega_license).slice(0, 40) || null;
}

// انتهاء رخصة الإعلان (listing_expires_at) كما يحسبه v_inventory_attention: «منتهية» قبل اليوم، و«قريبة» خلال 30 يوماً.
// today: «YYYY-MM-DD» بتوقيت الجهاز
export function licenseState(expiry, today) {
    const end = dateOnly(expiry);
    const now = dateOnly(today);
    if (!end || !now) return null;
    if (end < now) return 'expired';
    const days = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(now + 'T00:00:00Z')) / 86400000);
    return days <= 30 ? 'soon' : 'valid';
}

// حقائق «معلومات المشروع». delivery: { text } كما كُتب (delivery_time)، أو { date } من عمود delivery_date للتنسيق
export function projectFacts(project, rows, today) {
    const p = project || {};
    const d = detailsOf(p);
    const deliveryText = firstText(d.delivery_time);
    const deliveryDate = dateOnly(p.delivery_date);
    const expiry = dateOnly(p.listing_expires_at);
    return {
        developer: firstText(d.developer, d.developer_name, d.developerName) || null,
        status: constructionLabel(d.construction_status) || null,
        delivery: deliveryText ? { text: deliveryText } : deliveryDate ? { date: deliveryDate } : null,
        units: unitsCount(p, rows),
        license: adLicense(p),
        licenseExpiry: expiry,
        licenseState: licenseState(expiry, today)
    };
}

/* ===================== الموقع ===================== */

function coordinate(value, limit) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

// رابط خرائط Google: بالإحداثيات (exact)، وإلا بحثاً بالعنوان والمدينة. لا شيء يدل على المكان = null
export function mapsLink(project) {
    const p = project || {};
    const lat = coordinate(p.latitude, 90);
    const lng = coordinate(p.longitude, 180);
    if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) {
        return { href: 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng, exact: true };
    }
    const address = firstText(p.address);
    if (!address) return null;
    const city = firstText(p.city);
    const query = city && !address.includes(city) ? address + '، ' + city : address;
    return { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query), exact: false };
}

// «حي الشاطئ، جدة» والعنوان المكتوب تحته إن زاد عليهما شيئاً. الحي يُخزَّن بلا «حي» (004)، فتُضاف إلا لمخطط أو حي مكتوب بها
export function placeLines(project) {
    const p = project || {};
    const district = firstText(p.district);
    const city = firstText(p.city);
    const named = district && !/^(ح[يى]|مخطط)\s/.test(district) ? 'حي ' + district : district;
    const place = [named, city].filter(Boolean).join('، ') || null;
    const address = firstText(p.address);
    const extra = address && address !== district && address !== named && address !== place ? address : null;
    return { place, address: extra };
}

/* ===================== «المخططات» ===================== */

// بطاقة لكل نموذج (صفوف اللوحة بلا صف «كامل العقار»): أرقامه وقسمته، وسعر المتر، و«آخر وحدة» حين تبقى واحدة من عدة، ومخططه
// من details.models[ord-1].plan إن كان https (كما يقرؤه استوديو البروشورات)، وإلا لا صورة
export function planCards(project, rows) {
    const models = Array.isArray(detailsOf(project).models) ? detailsOf(project).models : [];
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => row && Number(row.ord) > 0)
        .map((row) => {
            const model = models[Number(row.ord) - 1];
            const plan = model && typeof model === 'object' && !Array.isArray(model) ? httpsUrl(model.plan) : null;
            const price = Number(row.price) > 0 ? Number(row.price) : null;
            const area = Number(row.area) > 0 ? Number(row.area) : null;
            return {
                row,
                plan,
                price,
                perMeter: price && area ? Math.round(price / area) : null,
                last: row.available === 1 && row.total > 1
            };
        });
}

const NBSP = '\u00a0';

// «3 غرف · 2 دورتا مياه · 165 م²»: الرقم ووحدته لا يفترقان على الجوال، والسطر ينكسر عند « · » وحدها
export function specsText(row) {
    if (!row) return '';
    const glue = (text) => text.replace(/ /g, NBSP);
    return [
        Number(row.rooms) > 0 ? glue(countText(row.rooms, ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة'])) : null,
        Number(row.bathrooms) > 0 ? glue(countText(row.bathrooms, ['دورة مياه واحدة', 'دورتا مياه', 'دورات مياه', 'دورة مياه'])) : null,
        Number(row.area) > 0 ? number(row.area) + NBSP + 'م²' : null
    ].filter(Boolean).join(' · ');
}

/* ===================== «ارفع بروشور المطور» ===================== */

// عنوان الطلب يعرّفه: «طلباتي» في المساعد تعرضه كما هو، وبه يجد هذا البطاقة آخر بروشور رفعه الموظف لهذا المشروع (هدف طلب
// الوسيط يُفرَّغ في القاعدة، 035، فلا يُعرف المشروع من target_id إلا لطلب المدير). «رقم 12» لا «#12»: في السطر العربي تنقلب
export const BROCHURE_TITLE_PREFIX = 'بروشور المطور — المشروع رقم ';

export function brochureTitle(project) {
    const p = project || {};
    const name = firstText(p.name).slice(0, 80);
    return BROCHURE_TITLE_PREFIX + p.id + (name ? ' «' + name + '»' : '');
}

// التعليمات كما يكتبها «حوّله تحديثاً» (updateFromRequest في agent.js): رقم المشروع واسمه، فيعرف المساعد المقصود ولو فُرّغ الهدف
export function brochureInstruction(project) {
    const p = project || {};
    const name = firstText(p.name);
    return 'حدّث المشروع رقم ' + p.id + (name ? ' «' + name + '»' : '') + ' بما في بروشور المطور المرفق.';
}

// عنوان طلب لهذا المشروع بعينه: «رقم 12» لا يطابق «رقم 123»
export function brochureTitleMatches(title, id) {
    const t = String(title || '');
    const head = BROCHURE_TITLE_PREFIX + id;
    return t.startsWith(head) && !/[0-9٠-٩]/.test(t.charAt(head.length));
}

// أحدث طلب بروشور لهذا المشروع من صفوف مرتبة بالأحدث أولاً، أو null
export function latestBrochure(rows, id) {
    return (Array.isArray(rows) ? rows : []).find((row) => row && brochureTitleMatches(row.title, id)) || null;
}

// اسم ملف PDF كما يحتاجه المساعد (النوع من الامتداد، agent.js fileKind): بامتداده، أو يُضاف لملف نوعه PDF بلا امتداد.
// ما ليس PDF = null
export function pdfName(name, type) {
    const n = String(name || '').trim();
    if (/\.pdf$/i.test(n)) return n;
    return String(type || '').toLowerCase() === 'application/pdf' ? (n || 'brochure') + '.pdf' : null;
}

// «850 ك.ب» أو «2.4 ميغابايت»
export function fileSizeText(bytes) {
    const b = Number(bytes);
    if (!(b > 0)) return '';
    if (b < 1048576) return number(Math.max(1, Math.round(b / 1024))) + ' ك.ب';
    const mb = b / 1048576;
    return (mb < 10 ? String(Math.round(mb * 10) / 10) : number(Math.round(mb))) + ' ميغابايت';
}

// فحص الملف قبل الرفع: الحجم الأعلى من agent.js (MAX_FILE_BYTES، والمخزن يرفض ما فوقه). نص المشكلة، أو null
export function fileProblem(file, maxBytes) {
    if (!file) return 'اختر ملف PDF.';
    if (!pdfName(file.name, file.type)) return 'البروشور يُرفع ملف PDF فقط.';
    if (!(Number(file.size) > 0)) return 'الملف «' + file.name + '» فارغ.';
    if (maxBytes > 0 && file.size > maxBytes) {
        return 'الملف «' + file.name + '» أكبر من ' + fileSizeText(maxBytes) + '. صغّر حجمه أو ارفع صفحات الأسعار والنماذج وحدها.';
    }
    return null;
}

// عدد الصفحات بعد قراءة الملف (pdfPageCount، وقد يكون null): ما فوق الحد (MAX_PDF_PAGES) يُرفض قبل إنشاء الطلب
export function pagesProblem(name, pages, maxPages) {
    if (pages === null || pages === undefined || !(maxPages > 0) || pages <= maxPages) return null;
    return 'الملف «' + name + '» فيه ' + number(pages) + ' صفحة، والحد ' + number(maxPages) + ' صفحة للملف. ارفع صفحات الأسعار والنماذج وحدها.';
}

const PAGES = ['صفحة واحدة', 'صفحتان', 'صفحات', 'صفحة'];
const FILES = ['ملف واحد', 'ملفان', 'ملفات', 'ملفاً'];

// المرحلة الأولى بعد الرفع: «رُفع: اسم الملف (24 صفحة)» واسم الملف من هذه الجلسة (المخزن يحفظه بحروف لاتينية)، وإلا «رُفع
// البروشور» أو «رُفع ملفان» أو «رُفع 3 ملفات»؛ و size مجموع الأحجام
export function uploadSummary(sources, names) {
    const files = (Array.isArray(sources) ? sources : []).filter((s) => s && s.kind !== 'url' && s.kind !== 'text');
    const known = files.length > 0 && files.every((s) => Number(s.pages) > 0);
    const pages = known ? files.reduce((sum, s) => sum + Number(s.pages), 0) : null;
    const bytes = files.reduce((sum, s) => sum + (Number(s.bytes) || 0), 0);
    const list = (Array.isArray(names) ? names : []).filter(Boolean);
    const head = list.length === 1 ? 'رُفع: ' + list[0]
        : (list.length || files.length) > 1 ? 'رُفع ' + countText(list.length || files.length, FILES)
        : 'رُفع البروشور';
    return { label: head + (pages ? ' (' + countText(pages, PAGES) + ')' : ''), size: fileSizeText(bytes) };
}

// مراحل الطلب الثلاث كما تظهر في البطاقة. state لكل مرحلة: done (تم، أخضر)، now (جارٍ، بلون الشعار)، wait (ينتظر أحداً،
// كهرماني)، fail (تعذّر، أحمر)، off (أُغلق بلا نتيجة، رمادي)، todo (لم يأتِ دورها).
// polling: الطلب في الانتظار أو التنفيذ فتُعاد قراءته؛ open: ما زال يحتاج يداً أو ينتظر؛ cancellable: «إلغاء القراءة»؛
// awaitingApproval: مسودته «بانتظار الاعتماد» (فيُعطى المدير رابط شاشة الاعتماد).
// admin: المدير يعتمد بنفسه، ومسودات طلبه تدخل «بانتظار الاعتماد» مباشرة (agent-run draftStatusFor)
const STAGE_NOTE = {
    reading: 'يقرأ صفحات البروشور',
    extracting: 'يستخرج الأسعار والنماذج',
    validating: 'يتحقق مما استخرجه'
};
const KEEPS_GOING = 'يكمل وحده لو قفلت الصفحة.';

export function brochureProgress(request, drafts, admin = false) {
    const r = request || {};
    const list = (Array.isArray(drafts) ? drafts : []).filter(Boolean);
    const upload = { key: 'upload', state: 'done', label: 'رُفع', note: null };
    const approveTodo = { key: 'approve', state: 'todo', label: 'بانتظار اعتماد المدير', note: 'يروح للمدير في طلب واحد، يراجعه ويعتمده.' };
    const result = (read, approve, extra = {}) => Object.assign({
        steps: [upload, Object.assign({ key: 'read' }, read), Object.assign({ key: 'approve' }, approve)],
        polling: false, open: false, cancellable: false, awaitingApproval: false
    }, extra);

    if (r.status === 'queued' || r.status === 'running') {
        const stage = r.status === 'running' ? STAGE_NOTE[r.stage] || 'يقرأ البروشور' : 'بانتظار دوره';
        return result({ state: 'now', label: 'يقرأ المساعد…', note: stage + ' — ' + KEEPS_GOING }, approveTodo,
            { polling: true, open: true, cancellable: true });
    }
    if (r.status === 'failed') {
        return result({ state: 'fail', label: 'تعذّرت قراءة البروشور', note: 'السبب في صفحة الطلب، وتقدر ترفعه من جديد.' }, approveTodo);
    }
    if (r.status === 'cancelled') {
        return result({ state: 'off', label: 'أُلغيت القراءة', note: null }, approveTodo);
    }
    if (r.status !== 'ready') {
        return result({ state: 'todo', label: 'يقرأ المساعد…', note: null }, approveTodo);
    }
    const candidates = Array.isArray(r.candidates) ? r.candidates : [];
    if (candidates.length) {
        return result({ state: 'wait', label: 'اختر المشروع المقصود', note: 'المساعد ما جزم بالمشروع؛ اختره من صفحة الطلب ليكمل.' },
            approveTodo, { open: true });
    }
    if (!list.length) {
        return result({ state: 'off', label: 'انتهت القراءة بلا تغيير', note: 'ما وجد المساعد في البروشور شيئاً يغيّر المشروع.' },
            { state: 'off', label: 'لا شيء للاعتماد', note: null });
    }
    const read = { state: 'done', label: 'قرأه المساعد', note: null };
    const has = (status) => list.some((d) => d.status === status);
    if (has('returned')) {
        return result(read, { state: 'wait', label: 'أعاده المدير إليك', note: 'راجع ملاحظته في صفحة الطلب، ثم أرسله من جديد.' }, { open: true });
    }
    if (has('draft')) {
        return result(read, { state: 'wait', label: 'أرسله للاعتماد', note: 'راجع ما استخرجه المساعد في صفحة الطلب، ثم اضغط «إرسال للاعتماد».' },
            { open: true });
    }
    if (has('submitted')) {
        return result(read, admin
            ? { state: 'wait', label: 'بانتظار اعتمادك', note: 'راجعه واعتمده من «طلبات الاعتماد».' }
            : { state: 'wait', label: 'بانتظار اعتماد المدير', note: 'يراجعه المدير ويعتمده، وما يتغيّر شيء في المشروع قبلها.' },
        { open: true, awaitingApproval: true });
    }
    if (has('applied') || has('approved')) {
        return result(read, { state: 'done', label: 'اعتمده المدير', note: 'تحدّث المشروع بما في البروشور.' });
    }
    if (has('rejected')) return result(read, { state: 'off', label: 'رفضه المدير', note: 'السبب في صفحة الطلب.' });
    return result(read, { state: 'off', label: 'تغيّر المشروع قبل الاعتماد', note: 'ارفع البروشور من جديد إن احتجت.' });
}

// قبل وصول معرّف الطلب: الرفع جارٍ، و message رسالة الرفع («جارٍ رفع ملف.pdf…»)
export function uploadingProgress(message) {
    return {
        steps: [
            { key: 'upload', state: 'now', label: 'يُرفع البروشور…', note: message || null },
            { key: 'read', state: 'todo', label: 'يقرأ المساعد…', note: null },
            { key: 'approve', state: 'todo', label: 'بانتظار اعتماد المدير', note: 'يروح للمدير في طلب واحد، يراجعه ويعتمده.' }
        ],
        polling: false, open: true, cancellable: false, awaitingApproval: false
    };
}

// البطاقة تعرض آخر طلب عند فتح الصفحة ما دام مفتوحاً، أو انتهى خلال الأيام السبعة الأخيرة
export const RECENT_DAYS = 7;

export function showOnLoad(progress, request, nowMs) {
    if (!request) return false;
    if (progress && progress.open) return true;
    const at = Date.parse(request.updated_at || request.created_at || '');
    return Number.isFinite(at) && nowMs - at <= RECENT_DAYS * 86400000;
}
