// أدوات العرض المشتركة.
//
// قاعدة أمنية ثابتة في هذا المجلد: لا يُبنى أي عنصر بـ innerHTML.
// كل نص يأتي من المستخدم أو من قاعدة البيانات يمر عبر textContent أو createTextNode،
// فلا يوجد مسار أصلاً لحقن HTML مخزَّن.

/* ===================== بناء الـ DOM ===================== */

export function append(parent, children) {
    if (children === null || children === undefined || children === false || children === true) return parent;
    if (Array.isArray(children)) {
        for (const child of children) append(parent, child);
        return parent;
    }
    parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return parent;
}

// مفاتيح تكتب HTML خاماً. el() يرفضها رفضاً صريحاً حتى لا يُفتح هذا الباب سهواً
// لاحقاً: القاعدة أعلاه تبقى قاعدة لأن الأداة نفسها لا تعرف كيف تخالفها.
const FORBIDDEN_KEYS = ['innerHTML', 'outerHTML', 'srcdoc'];

export function el(tag, attrs = {}, children = null) {
    const node = document.createElement(tag);
    for (const key of Object.keys(attrs)) {
        if (FORBIDDEN_KEYS.indexOf(key) !== -1) {
            throw new Error('el(): ' + key + ' ممنوع — استعمل text أو عناصر أبناء');
        }
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style') node.setAttribute('style', value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
    }
    return append(node, children);
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

export function replace(node, children) {
    return append(clear(node), children);
}

/* ===================== حالات الشاشة ===================== */

export function loading(message = 'جارٍ التحميل') {
    // role=status وaria-busy: قارئ الشاشة يعلن الانتظار، وcrm/v6.css يرسم أسطراً رمادية مكان المحتوى
    return el('div', { class: 'loading', role: 'status', 'aria-busy': 'true', text: message });
}

// حالة فارغة: جملة تقول ما الذي لا يوجد، وسطر اختياري يقول ما الذي يُفعل، وإجراء اختياري (زر أو رابط).
// الاستدعاء القديم empty(نص) يبقى كما كان: النص نفسه هو كل محتوى المربع المقروء.
export function empty(message, hint = null, action = null) {
    return el('div', { class: 'crm-empty' + (hint || action ? ' crm-empty-rich' : '') }, [
        el('span', { class: 'crm-empty-ico', 'aria-hidden': 'true' }, icon('inbox')),
        el('strong', { class: 'crm-empty-title', text: message }),
        hint ? el('span', { class: 'crm-empty-hint', text: hint }) : null,
        action || null
    ]);
}

// retry: دالة تعيد التحميل، فيظهر بجانب الرسالة زر «إعادة المحاولة» بدل أن يعيد الموظف فتح الصفحة كلها
export function errorBox(error, prefix = 'تعذّر تحميل البيانات', retry = null) {
    return el('div', { class: 'crm-error' + (retry ? ' crm-error-retry' : ''), role: 'alert' }, [
        el('span', { class: 'crm-error-text', text: prefix + ': ' + errorText(error) }),
        retry ? el('button', {
            type: 'button', class: 'btn btn-outline btn-xs crm-retry', onclick: retry
        }, [icon('refresh'), el('span', { text: 'إعادة المحاولة' })]) : null
    ]);
}

// رموز Postgres/PostgREST الشائعة: رسالة الخادم بالإنجليزية ولا تفيد المستخدم،
// وهذه أربعة رموز تتكرر فعلاً في هذه الشاشات.
const CODE_AR = {
    '42501': 'لا تملك صلاحية',
    'PGRST116': 'السجل غير موجود أو غير مرئي لك',
    '23503': 'مرجع غير صحيح',
    '22P02': 'قيمة غير صالحة',
    // قيد CHECK: مرحلة "خسرت" بلا سبب، أو حصص عمولة تتجاوز الإجمالي
    '23514': 'قيمة مرفوضة: تخالف قاعدة في قاعدة البيانات'
};

// رسائل الشبكة والجلسة كما يكتبها المتصفح وsupabase-js بالإنجليزية: تُقال للموظف بالعربية مع ما يفعله
const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network/i;
const TIMEOUT_RE = /timeout|timed out|57014/i;
const SESSION_RE = /jwt expired|invalid jwt|jwt malformed|refresh token/i;

export function errorText(error) {
    if (!error) return 'خطأ غير معروف';
    if (error.code && CODE_AR[error.code]) return CODE_AR[error.code];
    const raw = String(error.message || error.error_description || error.details || error.hint || error);
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || NETWORK_RE.test(raw)) {
        return 'لا يوجد اتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة';
    }
    if (error.code === 'PGRST301' || SESSION_RE.test(raw)) return 'انتهت الجلسة. أعد تحميل الصفحة وسجّل الدخول من جديد';
    if (error.code === '57014' || TIMEOUT_RE.test(raw)) return 'استغرق الطلب وقتاً أطول من المعتاد. أعد المحاولة بعد لحظات';
    if (error.status === 429 || /rate limit/i.test(raw)) return 'طلبات كثيرة في وقت قصير. انتظر قليلاً ثم أعد المحاولة';
    return raw;
}

// جدول أو عرض غير موجود في قاعدة البيانات الحالية (ترحيل لم يُطبَّق بعد): الصفحة تعود إلى المصدر الأقدم بدل الخطأ
export function isMissingRelation(error) {
    if (!error) return false;
    return error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST200'
        || /does not exist|could not find the table|schema cache/i.test(String(error.message || ''));
}

/* ===================== التنبيهات ===================== */

let notifyTimer = null;

export function notify(message, kind = 'info', ms = 4500) {
    const box = document.getElementById('notification');
    if (!box) return;
    box.className = 'notification ' + kind;
    box.textContent = message;
    box.style.display = 'block';
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => { box.style.display = 'none'; }, ms);
}

// كل خطأ قادم من Supabase يُعرض للمستخدم بالعربية ولا نفعل شيئاً آخر.
export function fail(error, prefix = 'تعذّر إتمام العملية') {
    notify(prefix + ': ' + errorText(error), 'error', 8000);
    if (error) console.error('[CRM]', error);
    return null;
}

/* ===================== سحب الملفات وإفلاتها ===================== */

// ملف يُسحب إلى الصفحة: على مربع فيه حقل ملفات (.crm-import-file أو .form-group، أو طيّة رفع واتساب) يذهب إلى ذلك الحقل كأنه
// اختير بالزر، وفي أي مكان آخر لا يفتحه المتصفح ولا يغادر الصفحة (فيضيع ما لم يُحفظ). الإفلات على الحقل نفسه
// يتركه للمتصفح كما كان. المجلد لا يُفلَت: يُختار بزرّه.
export function wireFileDrop() {
    let over = null;
    const mark = (box) => {
        if (over === box) return;
        if (over) over.classList.remove('drop-on');
        over = box;
        if (over) over.classList.add('drop-on');
    };
    const carriesFiles = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
    const zoneOf = (target) => {
        const box = target && target.closest ? target.closest('.crm-import-file, .form-group, .wa-upload') : null;
        const input = box ? box.querySelector('input[type=file]') : null;
        return input && !input.disabled ? { box, input } : null;
    };
    const accepts = (input, file) => {
        const tokens = String(input.accept || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (!tokens.length) return true;
        const name = file.name.toLowerCase();
        const type = String(file.type || '').toLowerCase();
        return tokens.some((t) => t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t);
    };

    window.addEventListener('dragover', (event) => {
        if (!carriesFiles(event) || (event.target.matches && event.target.matches('input[type=file]'))) return;
        event.preventDefault();
        const zone = zoneOf(event.target);
        event.dataTransfer.dropEffect = zone && !zone.input.webkitdirectory ? 'copy' : 'none';
        mark(zone && !zone.input.webkitdirectory ? zone.box : null);
    });
    window.addEventListener('dragleave', (event) => { if (!event.relatedTarget) mark(null); });
    window.addEventListener('dragend', () => mark(null));
    window.addEventListener('drop', (event) => {
        mark(null);
        if (!carriesFiles(event) || (event.target.matches && event.target.matches('input[type=file]'))) return;
        event.preventDefault();
        const zone = zoneOf(event.target);
        if (!zone) return;
        if (zone.input.webkitdirectory) return void notify('المجلد يُختار بالزر في هذا المربع.', 'info');
        const files = Array.from(event.dataTransfer.files || []);
        const fit = files.filter((file) => accepts(zone.input, file));
        if (!fit.length) return void notify('هذا النوع من الملفات لا يُقبل هنا.', 'error');
        if (fit.length < files.length) notify('تُرك ' + (files.length - fit.length) + ' من الملفات لأن نوعه لا يُقبل هنا.', 'info');
        const picked = new DataTransfer();
        (zone.input.multiple ? fit : fit.slice(0, 1)).forEach((file) => picked.items.add(file));
        zone.input.files = picked.files;
        zone.input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

/* ===================== النافذة المنبثقة ===================== */

let onModalClose = null;
// العنصر الذي فتح النافذة: يعود إليه التركيز عند إغلاقها، فلا يبدأ مستخدم لوحة المفاتيح من أول الصفحة
let modalOpener = null;

export function openModal(title, body, options = {}) {
    const holder = document.getElementById('modalContent');
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('active')) modalOpener = document.activeElement;
    holder.className = 'modal-content' + (options.narrow ? ' modal-narrow' : '');
    holder.setAttribute('role', 'dialog');
    holder.setAttribute('aria-modal', 'true');
    holder.setAttribute('aria-labelledby', 'crmModalTitle');
    clear(holder);
    holder.appendChild(el('button', { type: 'button', class: 'modal-close', title: 'إغلاق', 'aria-label': 'إغلاق', text: '×', onclick: closeModal }));
    holder.appendChild(el('h2', { class: 'crm-modal-title', id: 'crmModalTitle', text: title }));
    append(holder, body);
    onModalClose = options.onClose || null;
    modal.classList.add('active');
    const firstField = holder.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    if (firstField) firstField.focus();
    else holder.querySelector('.modal-close').focus();
}

export function closeModal() {
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('active')) return;
    modal.classList.remove('active');
    clear(document.getElementById('modalContent'));
    const cb = onModalClose;
    onModalClose = null;
    const opener = modalOpener;
    modalOpener = null;
    if (cb) cb();
    if (opener && opener.isConnected && typeof opener.focus === 'function' && !modal.classList.contains('active')) opener.focus();
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initModal() {
    const modal = document.getElementById('modal');
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    // Tab يدور داخل النافذة المفتوحة ولا يخرج إلى الصفحة التي خلفها
    modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || !modal.classList.contains('active')) return;
        const items = Array.from(modal.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
}

/* ===================== عناصر النماذج ===================== */

export function field(labelText, control, options = {}) {
    const group = el('div', { class: 'form-group' + (options.span2 ? ' span-2' : '') });
    if (!control.id) control.id = 'f_' + Math.random().toString(36).slice(2, 9);
    group.appendChild(el('label', { for: control.id, text: labelText + (options.required ? ' *' : '') }));
    group.appendChild(control);
    if (options.hint) group.appendChild(el('small', { class: 'hint', text: options.hint }));
    return group;
}

export function input(attrs = {}) {
    return el('input', Object.assign({ type: 'text' }, attrs));
}

// خيارات القائمة: [{ value, label }] — القيمة الفارغة تعني "غير محدد"
export function select(options, value, attrs = {}) {
    const node = el('select', attrs);
    for (const opt of options) {
        node.appendChild(el('option', { value: opt.value, text: opt.label }));
    }
    node.value = value === null || value === undefined ? '' : String(value);
    return node;
}

export function optionList(map, placeholder) {
    const list = placeholder === undefined ? [] : [{ value: '', label: placeholder }];
    for (const key of Object.keys(map)) list.push({ value: key, label: map[key] });
    return list;
}

/* ===================== الترقيم ===================== */

export function pager(page, total, onPage, size = 25) {
    const pages = Math.max(1, Math.ceil(total / size));
    const bar = el('div', { class: 'crm-pager' });
    bar.appendChild(el('button', {
        type: 'button', class: 'btn btn-outline btn-xs', text: 'السابق',
        disabled: page <= 0, onclick: () => onPage(page - 1)
    }));
    bar.appendChild(el('span', { text: 'صفحة ' + (page + 1) + ' من ' + pages + ' — ' + countText(total, ['سجل واحد', 'سجلان', 'سجلات', 'سجلاً']) }));
    bar.appendChild(el('button', {
        type: 'button', class: 'btn btn-outline btn-xs', text: 'التالي',
        disabled: page >= pages - 1, onclick: () => onPage(page + 1)
    }));
    return bar;
}

/* ===================== تنسيق الأرقام ===================== */

const NUM = new Intl.NumberFormat('en-US');
const DASH = '—';

// العدد مع المعدود بالعربية: forms = [المفرد بلفظ «واحد»، المثنى، جمع 3–10، مفرد 11 فأكثر].
// مثال: countText(3, ['سجل واحد', 'سجلان', 'سجلات', 'سجلاً']) ← «3 سجلات». الصفر بصيغة الجمع: «0 سجلات».
export function countText(n, forms) {
    const v = Number(n) || 0;
    if (v === 1) return forms[0];
    if (v === 2) return forms[1];
    if (v >= 3 && v <= 10) return v + ' ' + forms[2];
    if (v === 0) return '0 ' + forms[2];
    return number(v) + ' ' + forms[3];
}

export function money(value) {
    if (value === null || value === undefined || value === '') return DASH;
    const n = Number(value);
    return Number.isFinite(n) ? NUM.format(n) : DASH;
}

export function number(value) {
    if (value === null || value === undefined || value === '') return DASH;
    const n = Number(value);
    return Number.isFinite(n) ? NUM.format(n) : DASH;
}

// لوحة المفاتيح العربية تكتب ٠١٢٣٤٥٦٧٨٩ (والفارسية ۰۱۲۳۴۵۶۷۸۹)، و Number() لا يقرأ
// إلا اللاتينية، فكانت "٥٠٠٠٠٠" تصل إلى الخادم null. الفاصلة العشرية العربية ٫ تصير نقطة.
const AR_DIGITS = /[٠-٩۰-۹٫]/g;

export function toAsciiDigits(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(AR_DIGITS, (ch) => {
        if (ch === '٫') return '.';
        const code = ch.charCodeAt(0);
        return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
    });
}

export function parseNumber(text) {
    if (text === null || text === undefined) return null;
    const cleaned = toAsciiDigits(text).replace(/[^\d.]/g, '');
    if (cleaned === '' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

// حقل مبلغ: يُظهر فواصل الآلاف عند مغادرة الحقل ويزيلها عند التحرير
export function moneyInput(attrs = {}) {
    const node = input(Object.assign({ class: 'crm-money', inputMode: 'numeric', autocomplete: 'off' }, attrs));
    node.addEventListener('focus', () => {
        const n = parseNumber(node.value);
        node.value = n === null ? '' : String(n);
    });
    node.addEventListener('blur', () => {
        const n = parseNumber(node.value);
        node.value = n === null ? '' : NUM.format(n);
    });
    if (node.value) node.value = NUM.format(parseNumber(node.value));
    return node;
}

/* ===================== تنسيق التواريخ ===================== */
// تقويم ميلادي بأرقام لاتينية وأسماء شهور عربية: التقويم الهجري الافتراضي لـ ar-SA
// غير مناسب لمواعيد المتابعات.

const FMT_DATETIME = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
});
const FMT_DATE = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric'
});

export function fmtDateTime(iso) {
    if (!iso) return DASH;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? DASH : FMT_DATETIME.format(d);
}

export function fmtDate(iso) {
    if (!iso) return DASH;
    const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
    return isNaN(d.getTime()) ? DASH : FMT_DATE.format(d);
}

const pad2 = (n) => String(Math.abs(n)).padStart(2, '0');

// "2026-09-18" + "14:30" → "2026-09-18T14:30:00+03:00" بإزاحة المتصفح المحلية
export function toLocalISO(dateValue, timeValue) {
    if (!dateValue) return null;
    const [y, m, d] = dateValue.split('-').map(Number);
    const [hh, mm] = (timeValue || '00:00').split(':').map(Number);
    const dt = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
    if (isNaN(dt.getTime())) return null;
    const offset = -dt.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    return y + '-' + pad2(m) + '-' + pad2(d) + 'T' + pad2(hh || 0) + ':' + pad2(mm || 0) + ':00'
        + sign + pad2(Math.trunc(offset / 60)) + ':' + pad2(offset % 60);
}

// بداية اليوم المحلي كنص ISO بإزاحة المتصفح. v_my_work تحسب حدود اليوم بتوقيت
// Asia/Riyadh، والمستخدم في السعودية على الإزاحة نفسها، فتتفق البطاقة مع القائمة.
export function localDayStart(dayOffset = 0) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    return toLocalISO(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()), '00:00');
}

/* ===================== شارات ونصوص جاهزة ===================== */

export function badge(text, tone = 'neutral') {
    return el('span', { class: 'badge badge-' + tone, text: text });
}

export function dash(value) {
    return value === null || value === undefined || value === '' ? DASH : String(value);
}

export const EM_DASH = DASH;

/* ===================== الجوال: اتصال وواتساب بضغطة ===================== */

// رقم واتساب بلا علامة + ولا أصفار دولية. الجوال يُحفظ بالصيغة الدولية (+9665…)، ورقم محلي قديم
// (05… أو 5…) يُكمَّل برمز السعودية.
export function waNumber(phone) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (/^05[0-9]{8}$/.test(digits)) return '966' + digits.slice(1);
    if (/^5[0-9]{8}$/.test(digits)) return '966' + digits;
    if (digits.startsWith('00')) return digits.slice(2);
    return digits;
}

// الرقم مع زرّي «اتصال» و«واتساب». الضغط عليهما لا يفتح الصف الذي يحملهما (صفوف العملاء تُفتح بالضغط).
export function phoneLinks(phone) {
    if (!phone) return dash(null);
    const stop = (event) => event.stopPropagation();
    // التصميم الخامس: الرقم نفسه رابط اتصال، واتصال/واتساب أيقونتان خفيفتان (اسمهما للقارئ)، لا حبّتان
    const tel = 'tel:' + String(phone).replace(/[^0-9+]/g, '');
    return el('span', { class: 'phone-cell' }, [
        el('a', { class: 'phone-num', href: tel, text: phone, onclick: stop }),
        el('a', {
            class: 'phone-act', href: tel, title: 'اتصال بـ ' + phone, onclick: stop
        }, [icon('phone'), el('span', { class: 'w4-sr', text: 'اتصال' })]),
        el('a', {
            class: 'phone-act phone-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener',
            title: 'محادثة واتساب مع ' + phone, onclick: stop
        }, [icon('chat'), el('span', { class: 'w4-sr', text: 'واتساب' })])
    ]);
}

/* ===================== أيقونات ===================== */

// أيقونات خطية بنمط Lucide (مسارات SVG تُبنى بـ createElementNS، لا innerHTML). زخرفية دائماً:
// aria-hidden، والاسم الظاهر أو aria-label على الزر الحامل لها هو ما يُقرأ.
const ICON_PATHS = {
    today: ['M8 2v4M16 2v4M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 15l2 2 4-4'],
    calendar: ['M8 2v4M16 2v4M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 13h3v3H8z'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
    userPlus: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6M22 11h-6'],
    building: ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M2 21h20', 'M8 7h4M8 11h4M8 15h4'],
    sparkle: ['M12 3l1.8 4.6 4.7 1.9-4.7 1.9L12 16l-1.8-4.6-4.7-1.9 4.7-1.9z', 'M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
    clipboard: ['M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z', 'M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2', 'M9 14l2 2 4-4'],
    chat: ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z'],
    link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
    briefcase: ['M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M3 13h18'],
    grid: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
    chart: ['M3 3v18h18', 'M8 17V9M13 17V5M18 17v-6'],
    upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
    layers: ['M12 2l10 5-10 5L2 7l10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
    sliders: ['M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3', 'M1 14h6M9 8h6M17 16h6'],
    map: ['M9 3L3 6v15l6-3 6 3 6-3V3l-6 3-6-3z', 'M9 3v15M15 6v15'],
    menu: ['M4 6h16M4 12h16M4 18h16'],
    phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z'],
    pin: ['M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
    dots: ['M5 12h.01M12 12h.01M19 12h.01'],
    check: ['M20 6L9 17l-5-5'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
    alert: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 8v4M12 16h.01'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'],
    arrow: ['M19 12H5', 'M12 19l-7-7 7-7'],
    sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7', 'M12 17h.01'],
    // التصميم السادس: البحث السريع، وإعادة المحاولة، والطلبات والمطابقات والعمولات، وانقطاع الاتصال
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
    refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
    plus: ['M12 5v14M5 12h14'],
    close: ['M18 6L6 18M6 6l12 12'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6M9 17h4'],
    target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12h.01'],
    wallet: ['M4 7a2 2 0 0 1 2-2h12v4', 'M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z', 'M16 14.5h.01'],
    key: ['M15 9a3 3 0 1 0 0-.01', 'M13 11l-9 9', 'M7 17l2 2M9 15l2 2'],
    offline: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.6a10 10 0 0 1 4.7-2.5', 'M2 8.8a15 15 0 0 1 4-2.6', 'M22 8.8A15 15 0 0 0 11 5', 'M19 12.6a10 10 0 0 0-1.7-1.3', 'M12 20h.01'],
    enter: ['M9 10l-5 5 5 5', 'M20 4v7a4 4 0 0 1-4 4H4'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z']
};

export function icon(name, cls = 'ico') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls);
    for (const d of ICON_PATHS[name] || ICON_PATHS.dots) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

/* ===================== رأس الصفحة (التصميم الرابع) ===================== */

// عنوان الصفحة وسطر قصير يشرحها، والإجراءات الرئيسية بجانبه — نفس رأس «عملي اليوم» (crm/app.css: .w4-head).
// يحل محل «page-intro» والعنوان المكرر في أول بطاقة، فلا يظهر اسم الصفحة مرتين.
export function pageHead(title, sub, actions = []) {
    const list = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
    return el('header', { class: 'w4-head pg-head' }, [
        el('div', { class: 'w4-title' }, [
            el('h1', { text: title }),
            sub ? el('p', { class: 'w4-sub', text: sub }) : null
        ]),
        list.length ? el('div', { class: 'w4-quick' }, list) : null
    ]);
}

// زر إجراء في رأس الصفحة: رابط إن أُعطي href، وإلا زر. primary للإجراء الأهم وحده.
export function actionBtn(text, iconName, attrs = {}, primary = false) {
    const tag = attrs.href ? 'a' : 'button';
    return el(tag, Object.assign({
        class: 'btn ' + (primary ? 'btn-primary' : 'btn-outline') + ' w4-qbtn',
        type: tag === 'button' ? 'button' : null
    }, attrs), [iconName ? icon(iconName) : null, el('span', { text: text })]);
}

/* ===================== التصميم السادس «الوسيط»: تبويبات ومرشّحات مشتركة ===================== */

// تبويبات تحت رأس الصفحة، كل تبويب رابط لمساره (العملاء | الطلبات | المطابقات، الصفقات | العمولات).
// الحالي يُعلَّم aria-current، فقارئ الشاشة يعرف أين هو والضغط عليه لا يعيد شيئاً.
export function subTabs(label, items, current) {
    return el('nav', { class: 'sub-tabs', 'aria-label': label }, items.map((item) => el('a', {
        class: 'sub-tab' + (item.hash === current ? ' on' : ''),
        href: item.hash,
        'aria-current': item.hash === current ? 'page' : null
    }, [item.icon ? icon(item.icon) : null, el('span', { text: item.label })])));
}

// أزرار تصفية متجاورة (حبّات): واحد فقط مضغوط. items: [{ value, label }]. setCount يكتب العدد بجانب الاسم
// بعد وصوله من الخادم، فتظهر الحبّات فوراً ولا تنتظر العدّ.
export function filterChips(label, items, value, onChange) {
    const buttons = new Map();
    const node = el('div', { class: 'f-chips', role: 'group', 'aria-label': label }, items.map((item) => {
        const count = el('span', { class: 'f-chip-count', hidden: true });
        const button = el('button', {
            type: 'button', class: 'f-chip', 'aria-pressed': String(item.value) === String(value) ? 'true' : 'false',
            onclick: () => { set(item.value); onChange(item.value); }
        }, [el('span', { text: item.label }), count]);
        buttons.set(String(item.value), { button, count });
        return button;
    }));
    function set(next) {
        for (const [key, b] of buttons) b.button.setAttribute('aria-pressed', key === String(next) ? 'true' : 'false');
    }
    function setCount(key, n) {
        const b = buttons.get(String(key));
        if (!b) return;
        b.count.textContent = number(n);
        b.count.hidden = n === null || n === undefined;
    }
    return { node, set, setCount };
}

// سطر النتائج فوق الجدول: العدد بصيغته العربية، و«مسح التصفية» حين يكون هناك ما يُمسح.
// aria-live: قارئ الشاشة يعلن العدد الجديد بعد كل تصفية.
export function resultLine(text, onReset) {
    return el('div', { class: 'result-line', 'aria-live': 'polite' }, [
        el('span', { class: 'result-count', text: text }),
        onReset ? el('button', { type: 'button', class: 'link-btn result-reset', onclick: onReset }, [icon('close'), el('span', { text: 'مسح التصفية' })]) : null
    ]);
}

// تأريخ نسبي قصير للمواعيد القادمة: «اليوم»، «غداً»، ثم اسم اليوم والتاريخ
const FMT_DAY = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'short' });
export function dayText(iso) {
    if (!iso) return DASH;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return DASH;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - start) / 86400000);
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'غداً';
    if (diff === -1) return 'أمس';
    return FMT_DAY.format(d);
}
