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
    return el('div', { class: 'loading', text: message });
}

export function empty(message) {
    return el('div', { class: 'crm-empty', text: message });
}

export function errorBox(error, prefix = 'تعذّر تحميل البيانات') {
    return el('div', { class: 'crm-error', text: prefix + ': ' + errorText(error) });
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

export function errorText(error) {
    if (!error) return 'خطأ غير معروف';
    if (error.code && CODE_AR[error.code]) return CODE_AR[error.code];
    return error.message || error.error_description || error.details || error.hint || String(error);
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

/* ===================== النافذة المنبثقة ===================== */

let onModalClose = null;

export function openModal(title, body, options = {}) {
    const holder = document.getElementById('modalContent');
    holder.className = 'modal-content' + (options.narrow ? ' modal-narrow' : '');
    clear(holder);
    holder.appendChild(el('span', { class: 'modal-close', title: 'إغلاق', text: '×', onclick: closeModal }));
    holder.appendChild(el('h2', { class: 'crm-modal-title', text: title }));
    append(holder, body);
    onModalClose = options.onClose || null;
    document.getElementById('modal').classList.add('active');
    const firstField = holder.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
}

export function closeModal() {
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('active')) return;
    modal.classList.remove('active');
    clear(document.getElementById('modalContent'));
    const cb = onModalClose;
    onModalClose = null;
    if (cb) cb();
}

export function initModal() {
    const modal = document.getElementById('modal');
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
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
    bar.appendChild(el('span', { text: 'صفحة ' + (page + 1) + ' من ' + pages + ' — ' + total + ' سجل' }));
    bar.appendChild(el('button', {
        type: 'button', class: 'btn btn-outline btn-xs', text: 'التالي',
        disabled: page >= pages - 1, onclick: () => onPage(page + 1)
    }));
    return bar;
}

/* ===================== تنسيق الأرقام ===================== */

const NUM = new Intl.NumberFormat('en-US');
const DASH = '—';

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
