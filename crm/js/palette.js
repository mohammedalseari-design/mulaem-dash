// البحث السريع (التصميم السادس «الوسيط»، 2026-10-23): نافذة واحدة تبحث في العملاء (بالاسم أو الجوال)
// وفي العقارات (بالاسم أو الحي)، وتعرض صفحات النظام وإجراءاته بأسمائها. تُفتح من حقل البحث في الشريط
// العلوي، أو Ctrl+K، أو «/»، أو زر البحث أعلى «عملي اليوم» على الجوال.
//
// لا ترشيح بالمستخدم هنا: سياسات clients و projects تقرّر ما يراه كل دور، فالنتائج هي ما يملك رؤيته أصلاً.
// كل استعلام محدود بستة صفوف، والكتابة تُؤجَّل 220 مللي ثانية، وردّ بحثٍ قديم يصل متأخراً يُهمَل.

import { supabase } from './supabase.js';
import { sanitizeSearch, phoneNeedle } from './data.js';
import { isAdmin, myRole } from './auth.js';
import { CLIENT_TYPE, LISTING_PURPOSE, label } from './labels.js';
import { el, clear, icon, money, errorText } from './ui.js';
import { presetClientSearch } from './clients.js';
import { presetPropertySearch } from './properties.js';
import { openClientForm } from './client-form.js';

const LIMIT = 6;
const DELAY = 220;

// الصفحات والإجراءات. admin: للمدير وحده، deny: دور لا يراها. keys: كلمات إضافية يُطابق بها البحث.
const ACTIONS = [
    { title: 'عميل جديد', icon: 'userPlus', keys: 'إضافة عميل جديد مالك مشتري مستأجر', run: newClient },
    { title: 'عملي اليوم', icon: 'today', hash: '#/work', keys: 'الرئيسية المتابعات المتأخرة' },
    { title: 'المواعيد والمعاينات', icon: 'calendar', hash: '#/calendar', keys: 'التقويم زيارة زيارات معاينة' },
    { title: 'العملاء', icon: 'users', hash: '#/clients', keys: 'الملاك البائعون المشترون المستأجرون المستثمرون' },
    { title: 'طلبات الشراء والإيجار', icon: 'file', hash: '#/requests', keys: 'الطلبات المفتوحة العملاء المحتملون' },
    { title: 'المطابقات', icon: 'target', hash: '#/matches', keys: 'العروض المشاركة مهتم معاينة' },
    { title: 'العقارات', icon: 'building', hash: '#/properties', keys: 'الوحدات المخزون المشاريع' },
    { title: 'الصفقات', icon: 'briefcase', hash: '#/deals', deny: 'callcenter', keys: 'المسار المراحل التفاوض' },
    { title: 'العمولات', icon: 'wallet', hash: '#/commissions', deny: 'callcenter', keys: 'التحصيل الفواتير المستحقة' },
    { title: 'إضافة عرض', icon: 'sparkle', hash: '#/assistant', keys: 'المساعد عرض جديد مطور واتساب رابط' },
    { title: 'الإدارة', icon: 'settings', hash: '#/admin', admin: true, keys: 'الاعتماد التقارير المستخدمون الإعدادات واتساب' },
    { title: 'كيف أبدأ؟', icon: 'help', hash: '#/help', keys: 'مساعدة شرح دليل' }
];

let root = null;
let input = null;
let list = null;
let status = null;
let opener = null;
let items = [];
let active = -1;
let token = 0;
let timer = null;

function newClient() {
    openClientForm(null, (saved) => {
        if (saved && saved.id) location.hash = '#/clients/' + saved.id;
    });
}

function allowed(action) {
    return !(action.admin && !isAdmin()) && !(action.deny && myRole() === action.deny);
}

// يطابق الكلمة في الاسم أو في الكلمات الإضافية، بلا اعتبار للهمزات والتاء المربوطة
function fold(text) {
    return String(text || '').toLowerCase()
        .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '');
}

function matchActions(term) {
    const list = ACTIONS.filter(allowed);
    if (!term) return list;
    const needle = fold(term);
    return list.filter((a) => fold(a.title + ' ' + (a.keys || '')).includes(needle));
}

/* ===================== البناء ===================== */

function build() {
    input = el('input', {
        type: 'search', class: 'pal-input', id: 'palInput', autocomplete: 'off', spellcheck: false,
        placeholder: 'اسم عميل، رقم جوال، اسم عقار أو حي…', enterKeyHint: 'go',
        role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palList', 'aria-autocomplete': 'list',
        'aria-label': 'بحث سريع في العملاء والعقارات والصفحات'
    });
    list = el('ul', { class: 'pal-list', id: 'palList', role: 'listbox', 'aria-label': 'النتائج' });
    status = el('p', { class: 'pal-status', role: 'status', 'aria-live': 'polite' });

    const panel = el('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'بحث سريع' }, [
        el('div', { class: 'pal-field' }, [
            icon('search', 'pal-ico'),
            input,
            el('button', { type: 'button', class: 'pal-close', 'aria-label': 'إغلاق البحث', title: 'إغلاق (Esc)', onclick: () => closePalette() }, icon('close'))
        ]),
        status,
        list,
        el('p', { class: 'pal-foot', 'aria-hidden': 'true' }, [
            el('kbd', { text: '↑' }), el('kbd', { text: '↓' }), el('span', { text: 'للتنقل' }),
            el('kbd', { text: 'Enter' }), el('span', { text: 'للفتح' }),
            el('kbd', { text: 'Esc' }), el('span', { text: 'للإغلاق' })
        ])
    ]);

    root = el('div', { class: 'pal-scrim', hidden: true }, panel);
    root.addEventListener('mousedown', (event) => { if (event.target === root) closePalette(); });
    input.addEventListener('input', schedule);
    panel.addEventListener('keydown', onKey);
    document.body.appendChild(root);
}

/* ===================== الفتح والإغلاق ===================== */

export function openPalette(text = '') {
    if (!root) build();
    if (!root.hidden) { input.focus(); return; }
    opener = document.activeElement;
    root.hidden = false;
    document.body.classList.add('pal-open');
    input.value = text;
    schedule();
    input.focus();
}

export function closePalette(restoreFocus = true) {
    if (!root || root.hidden) return;
    root.hidden = true;
    token += 1;
    clearTimeout(timer);
    document.body.classList.remove('pal-open');
    const back = opener;
    opener = null;
    if (restoreFocus && back && back.isConnected && typeof back.focus === 'function') back.focus();
}

// Ctrl+K (أو ⌘K) من أي مكان، و«/» حين لا يكون التركيز في حقل كتابة ولا نافذة مفتوحة.
// e.code لا e.key: على لوحة المفاتيح العربية يكتب الحرف K «ن» والشرطة المائلة «ظ».
export function initPalette() {
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyK' || String(event.key).toLowerCase() === 'k')) {
            event.preventDefault();
            openPalette();
            return;
        }
        if (event.code === 'Slash' && !event.ctrlKey && !event.metaKey && !event.altKey && !typing(event.target)) {
            const modal = document.getElementById('modal');
            if (modal && modal.classList.contains('active')) return;
            event.preventDefault();
            openPalette();
        }
    });
    window.addEventListener('hashchange', () => closePalette(false));
}

function typing(target) {
    return Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
}

/* ===================== البحث ===================== */

function schedule() {
    clearTimeout(timer);
    token += 1;
    const term = sanitizeSearch(input.value);
    const actions = matchActions(term);
    if (term.length < 2) {
        status.textContent = term ? 'اكتب حرفين على الأقل للبحث في العملاء والعقارات.' : '';
        render([{ title: term ? 'الصفحات' : 'انتقل إلى', rows: actions.map(actionRow) }]);
        return;
    }
    status.textContent = 'جارٍ البحث…';
    root.querySelector('.pal').setAttribute('aria-busy', 'true');
    render([{ title: 'الصفحات', rows: actions.map(actionRow) }]);
    const mine = token;
    timer = setTimeout(() => search(term, actions, mine), DELAY);
}

async function search(term, actions, mine) {
    const needle = phoneNeedle(term) || term;
    const [clients, properties] = await Promise.all([
        supabase.from('clients')
            .select('id, full_name, phone, client_type')
            .or('full_name.ilike.%' + term + '%,phone.ilike.%' + needle + '%')
            .order('updated_at', { ascending: false })
            .range(0, LIMIT - 1),
        supabase.from('projects')
            .select('id, name, type, district, city, price, purpose')
            .or('name.ilike.%' + term + '%,district.ilike.%' + term + '%')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .order('name', { ascending: true })
            .range(0, LIMIT - 1)
    ].map((query) => Promise.resolve(query).catch((error) => ({ data: null, error }))));
    if (mine !== token || !root || root.hidden) return;
    root.querySelector('.pal').removeAttribute('aria-busy');

    const clientRows = (clients.data || []).map(clientRow);
    if (clientRows.length === LIMIT) {
        clientRows.push({ icon: 'search', title: 'كل العملاء المطابقين لـ «' + term + '»', more: true,
            run: () => { presetClientSearch(term); go('#/clients'); } });
    }
    const propertyRows = (properties.data || []).map(propertyRow);
    if (propertyRows.length) {
        propertyRows.push({ icon: 'search', title: 'كل الوحدات المطابقة في «العقارات»', more: true,
            run: () => { presetPropertySearch(term); go('#/properties'); } });
    }
    const found = (clients.data || []).length + (properties.data || []).length;
    const failed = clients.error || properties.error;

    const groups = [
        { title: 'العملاء', rows: clientRows },
        { title: 'العقارات', rows: propertyRows },
        { title: 'الصفحات', rows: actions.map(actionRow) }
    ];
    if (!found && !failed) groups.push({ title: 'لم تجده؟', rows: [actionRow(ACTIONS[0])] });
    render(groups);

    if (failed) status.textContent = 'تعذّر جزء من البحث: ' + errorText(failed);
    else if (!found) status.textContent = 'لا نتائج لـ «' + term + '» في العملاء والعقارات.';
    else status.textContent = found + ' نتيجة لـ «' + term + '».';
}

function go(hash) {
    // الصفحة نفسها مفتوحة: الموجّه لا يعمل على هاش لم يتغيّر، فيُطلب منه الرسم من جديد
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
}

/* ===================== الصفوف ===================== */

function actionRow(action) {
    return { icon: action.icon, title: action.title, hash: action.hash, run: action.run, hint: action.hash ? 'صفحة' : 'إجراء' };
}

function clientRow(row) {
    return {
        icon: 'users',
        title: row.full_name || 'عميل بلا اسم',
        meta: [label(CLIENT_TYPE, row.client_type, ''), row.phone ? el('bdi', { dir: 'ltr', text: row.phone }) : null],
        hash: '#/clients/' + row.id,
        hint: 'ملف العميل'
    };
}

function propertyRow(row) {
    return {
        icon: 'building',
        title: row.name || 'عقار رقم ' + row.id,
        meta: [[row.type, label(LISTING_PURPOSE, row.purpose, ''), row.district || row.city].filter(Boolean).join(' · '),
            row.price ? money(row.price) + ' ر.س' : null],
        run: () => { presetPropertySearch(row.name || ''); go('#/properties'); },
        hint: 'العقارات'
    };
}

function render(groups) {
    clear(list);
    items = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    for (const group of groups) {
        if (!group.rows.length) continue;
        list.appendChild(el('li', { class: 'pal-group', role: 'presentation', text: group.title }));
        for (const row of group.rows) {
            const index = items.length;
            const meta = (Array.isArray(row.meta) ? row.meta : [row.meta]).filter(Boolean);
            const node = el('li', {
                class: 'pal-opt' + (row.more ? ' pal-more' : ''), id: 'palOpt' + index, role: 'option', 'aria-selected': 'false',
                onclick: () => choose(index),
                onmousemove: () => { if (active !== index) setActive(index, false); }
            }, [
                el('span', { class: 'pal-opt-ico' }, icon(row.icon)),
                el('span', { class: 'pal-opt-text' }, [
                    el('strong', { text: row.title }),
                    meta.length ? el('span', { class: 'pal-opt-meta' }, meta.map((part, i) => [i ? ' · ' : null, part])) : null
                ]),
                row.hint ? el('span', { class: 'pal-opt-hint', text: row.hint }) : null
            ]);
            items.push({ node, row });
            list.appendChild(node);
        }
    }
    if (items.length) setActive(0, false);
}

function setActive(index, scroll = true) {
    if (items[active]) {
        items[active].node.setAttribute('aria-selected', 'false');
        items[active].node.classList.remove('on');
    }
    active = index;
    const item = items[index];
    if (!item) return void input.removeAttribute('aria-activedescendant');
    item.node.setAttribute('aria-selected', 'true');
    item.node.classList.add('on');
    input.setAttribute('aria-activedescendant', item.node.id);
    if (scroll) item.node.scrollIntoView({ block: 'nearest' });
}

function choose(index) {
    const item = items[index];
    if (!item) return;
    closePalette(false);
    if (item.row.run) item.row.run();
    else if (item.row.hash) go(item.row.hash);
}

function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); return; }
    if (event.key === 'Tab') {
        // التركيز يبقى بين الحقل وزر الإغلاق، فلا يخرج إلى الصفحة التي خلف النافذة
        event.preventDefault();
        const close = root.querySelector('.pal-close');
        (document.activeElement === close ? input : close).focus();
        return;
    }
    if (event.target !== input) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
    else if (event.key === 'Enter') { event.preventDefault(); if (active >= 0) choose(active); }
}
