// ‎#/clients‎ — قائمة العملاء: بحث بالاسم أو الجوال، فئة العميل، الحالة والترتيب، وترقيم من الخادم.
// لا تُحمَّل القائمة كاملة أبداً: كل صفحة استعلام مستقل بـ ‎.range()‎ و count دقيق.
//
// التصميم السادس «الوسيط» (2026-10-23): الصفحة باب لثلاثة أقسام (العملاء، طلبات الشراء والإيجار، المطابقات)،
// والفئات حبّات بعددها (مشترون، مستأجرون، ملاك وبائعون، مستثمرون) فيجد الوسيط الملاك بضغطة. المصدر
// v_clients_overview (006، security_invoker فيخضع لسياسات clients نفسها) لعمودَي «طلبات مفتوحة» و«المتابعة
// القادمة». إن لم يوجد العرض في قاعدة البيانات تعود الصفحة إلى جدول clients كما كانت، بلا العمودين.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, sanitizeSearch, phoneNeedle } from './data.js';
import { CLIENT_STATUS, CLIENT_STATUS_TONE, CLIENT_TYPE, CLIENT_TYPE_GROUP, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, select, optionList, phoneLinks, pageHead, actionBtn,
    subTabs, filterChips, resultLine, countText, isMissingRelation, dayText, fmtDate, number
} from './ui.js';
import { openClientForm } from './client-form.js';

// أقسام باب «العملاء»: تبويبات تحت رأس كل صفحة منها (requests.js و matches.js تستعملها أيضاً)
export const CLIENT_TABS = [
    { hash: '#/clients', label: 'العملاء', icon: 'users' },
    { hash: '#/requests', label: 'طلبات الشراء والإيجار', icon: 'file' },
    { hash: '#/matches', label: 'المطابقات', icon: 'target' }
];

const SORTS = {
    updated: { label: 'آخر تحديث', column: 'updated_at', ascending: false },
    created: { label: 'الأحدث إضافة', column: 'created_at', ascending: false },
    next: { label: 'أقرب متابعة', column: 'next_follow_up_at', ascending: true, overview: true },
    name: { label: 'الاسم', column: 'full_name', ascending: true }
};

// البحث والفئة والحالة والترتيب والصفحة ومكان التمرير تبقى ما دامت الصفحة مفتوحة: الرجوع من ملف عميل يعيد
// القائمة كما تُركت بدل أولها. لا تخزين في المتصفح؛ إعادة التحميل تبدأ من جديد.
const remembered = { page: 0, search: '', status: '', type: '', sort: 'updated', scroll: 0 };

// العرض غير موجود في قاعدة البيانات: لا يُسأل عنه ثانية في هذه الجلسة
let overviewMissing = false;

// بحث من الشريط العلوي أو البحث السريع (palette.js): يُطبَّق عند فتح الصفحة التالية بدل أن يكتبه الموظف مرتين
export function presetClientSearch(term) {
    remembered.search = String(term || '').trim();
    remembered.page = 0;
    remembered.scroll = 0;
}

export async function renderClients(root) {
    const view = remembered;
    const restoreScroll = view.scroll;
    view.scroll = 0;
    let names = new Map();

    const body = el('div');
    const searchBox = el('input', {
        type: 'search', class: 'crm-search', placeholder: 'ابحث بالاسم أو رقم الجوال…', autocomplete: 'off',
        value: view.search, 'aria-label': 'بحث عن عميل بالاسم أو الجوال'
    });
    const statusBox = select(optionList(CLIENT_STATUS, 'كل الحالات'), view.status, { 'aria-label': 'حالة العميل' });
    const sortBox = select(Object.keys(SORTS).map((key) => ({ value: key, label: 'الترتيب: ' + SORTS[key].label })),
        view.sort, { 'aria-label': 'ترتيب القائمة' });
    const typeChips = filterChips('فئة العميل',
        [{ value: '', label: 'الكل' }].concat(Object.keys(CLIENT_TYPE_GROUP).map((key) => ({ value: key, label: CLIENT_TYPE_GROUP[key] }))),
        view.type, (value) => { view.type = value; view.page = 0; load(); });

    let debounce = null;
    searchBox.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            view.search = searchBox.value;
            view.page = 0;
            load();
        }, 300);
    });
    statusBox.addEventListener('change', () => {
        view.status = statusBox.value;
        view.page = 0;
        load();
    });
    sortBox.addEventListener('change', () => {
        view.sort = sortBox.value;
        view.page = 0;
        load();
    });

    function reset() {
        view.search = '';
        view.status = '';
        view.type = '';
        view.page = 0;
        searchBox.value = '';
        statusBox.value = '';
        typeChips.set('');
        load();
    }

    root.appendChild(pageHead('العملاء', 'المشترون والمستأجرون والملاك في مكان واحد. افتح ملف العميل لطلباته ومتابعاته وصفقاته.', [
        actionBtn('عميل جديد', 'userPlus', { onclick: () => openClientForm(null, () => { view.page = 0; load(); countTypes(); }) }, true)
    ]));
    root.appendChild(subTabs('أقسام العملاء', CLIENT_TABS, '#/clients'));
    root.appendChild(el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-toolbar' }, [searchBox, statusBox, sortBox]),
        typeChips.node,
        body
    ]));

    try {
        names = await staffMap();
    } catch (error) {
        replace(body, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
        return;
    }
    if (!root.isConnected) return;

    // عدد كل فئة بجانب اسمها: عدّ بلا صفوف (head) لكل فئة، مرة عند فتح الصفحة. فشل العدّ يترك الحبّة بلا رقم.
    async function countTypes() {
        const keys = [''].concat(Object.keys(CLIENT_TYPE_GROUP));
        const counts = await Promise.all(keys.map((key) => {
            let query = supabase.from('clients').select('id', { count: 'exact', head: true });
            if (key) query = query.eq('client_type', key);
            return Promise.resolve(query).catch(() => ({ count: null }));
        }));
        if (!root.isConnected) return;
        keys.forEach((key, i) => typeChips.setCount(key, counts[i].error ? null : counts[i].count));
    }

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const term = sanitizeSearch(view.search);

        const build = (useOverview) => {
            const wanted = SORTS[view.sort] || SORTS.updated;
            const sort = wanted.overview && !useOverview ? SORTS.updated : wanted;
            let query = supabase
                .from(useOverview ? 'v_clients_overview' : 'clients')
                .select('id, full_name, phone, client_type, status, owner_id, created_at, updated_at'
                    + (useOverview ? ', open_requirements, next_follow_up_at' : ''), { count: 'exact' })
                .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
                .order('id', { ascending: true })
                .range(from, to);
            if (term) {
                const needle = phoneNeedle(term) || term;
                query = query.or('full_name.ilike.%' + term + '%,phone.ilike.%' + needle + '%');
            }
            if (view.status) query = query.eq('status', view.status);
            if (view.type) query = query.eq('client_type', view.type);
            return query;
        };

        let result = await build(!overviewMissing);
        if (result.error && !overviewMissing && isMissingRelation(result.error)) {
            overviewMissing = true;
            result = await build(false);
        }
        const { data, error, count } = result;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العملاء', load));

        const filtered = Boolean(term || view.status || view.type);
        if (!data || data.length === 0) {
            replace(body, filtered
                ? empty('لا نتائج مطابقة', 'جرّب جزءاً من الاسم أو آخر أرقام الجوال، أو امسح التصفية.',
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'مسح التصفية', onclick: reset }))
                : empty('لا يوجد عملاء بعد', 'أضف أول عميل من زر «عميل جديد» أعلى الصفحة، ثم أضف طلبه في ملفه.'));
            return;
        }

        const total = count === null || count === undefined ? data.length : count;
        replace(body, [
            resultLine(countText(total, ['عميل واحد', 'عميلان', 'عملاء', 'عميلاً']), filtered ? reset : null),
            el('div', { class: 'crm-table-wrap' }, table(data, names, !overviewMissing)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    countTypes();
    await load();
    if (restoreScroll > 0 && root.isConnected) requestAnimationFrame(() => window.scrollTo(0, restoreScroll));
}

function table(rows, names, overview) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العميل' }),
        el('th', { text: 'الجوال' }),
        overview ? el('th', { text: 'طلبات مفتوحة' }) : null,
        overview ? el('th', { text: 'المتابعة القادمة' }) : null,
        el('th', { text: 'الوسيط المسؤول' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'آخر تحديث' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {
            class: 'clickable',
            onclick: () => { remembered.scroll = window.scrollY; location.hash = '#/clients/' + row.id; }
        }, [
            el('td', { class: 'c-name' }, el('div', { class: 'cl-name' }, [
                el('strong', { text: row.full_name }),
                row.client_type ? el('span', { class: 'cl-type', text: label(CLIENT_TYPE, row.client_type) }) : null
            ])),
            el('td', { class: 'c-phone' }, phoneLinks(row.phone)),
            overview ? el('td', { class: 'c-reqs num' }, Number(row.open_requirements) > 0
                ? el('span', { class: 'count-pill', text: number(row.open_requirements) })
                : el('span', { class: 'crm-subtle', text: '—' })) : null,
            overview ? el('td', { class: 'c-next' }, nextFollowUp(row.next_follow_up_at)) : null,
            el('td', { class: 'c-owner', text: staffName(names, row.owner_id) }),
            el('td', { class: 'c-status' }, badge(label(CLIENT_STATUS, row.status), CLIENT_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'c-updated crm-subtle', text: fmtDate(row.updated_at) })
        ]));
    }

    // t-card t-clients6: على الجوال بطاقة (crm/v6.css): الاسم والحالة، ثم الجوال، ثم المتابعة والطلبات والوسيط
    return el('table', { class: 'users-table crm-table t-card t-clients6' + (overview ? '' : ' t-basic') }, [head, body]);
}

// المتابعة القادمة: يومها ووقتها، وبالأحمر إن فات موعدها. بلا متابعة: شرطة باهتة
const FMT_TIME = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { hour: 'numeric', minute: '2-digit', hour12: true });
function nextFollowUp(iso) {
    if (!iso) return el('span', { class: 'crm-subtle', text: 'لا متابعة' });
    const due = new Date(iso);
    const late = due.getTime() < Date.now();
    return el('span', { class: 'fu-when' + (late ? ' fu-late' : ''), title: late ? 'فات موعدها' : null }, [
        el('span', { text: dayText(iso) }),
        el('span', { class: 'fu-time', text: FMT_TIME.format(due) }),
        late ? el('span', { class: 'fu-flag', text: 'متأخرة' }) : null
    ]);
}
