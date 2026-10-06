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
    // role=status وaria-busy: قارئ الشاشة يعلن الانتظار، وcss/theme.css يرسم هيكلاً رمادياً مكان المحتوى
    return el('div', { class: 'loading', role: 'status', 'aria-busy': 'true', text: message });
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
    return el('span', { class: 'phone-cell' }, [
        el('span', { class: 'phone-num', text: phone }),
        el('a', {
            class: 'phone-act', href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''),
            text: 'اتصال', title: 'اتصال بـ ' + phone, onclick: stop
        }),
        el('a', {
            class: 'phone-act phone-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener',
            text: 'واتساب', title: 'محادثة واتساب مع ' + phone, onclick: stop
        })
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
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9']
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
