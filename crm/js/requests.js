// ‎#/requests‎ — طلبات الشراء والإيجار لكل العملاء (التصميم السادس «الوسيط»، 2026-10-23).
//
// قبلها كانت الطلبات تُرى من ملف كل عميل وحده. هنا قائمة واحدة لما يطلبه السوق الآن: الغرض (شراء أو إيجار)،
// نوع العقار والمكان والميزانية والأولوية، والصف يفتح العقارات المطابقة لذلك الطلب. قراءة فقط: الإضافة
// والتعديل في ملف العميل كما كانا (requirement-form.js)، فلا طريق جديد للكتابة.
//
// لا ترشيح بالمستخدم هنا: سياسة requirements_select (crm_can_see_client) تُري كل دور طلبات عملائه وحدها.

import { supabase, PAGE_SIZE, pageRange, pageBack } from './supabase.js';
import { sanitizeSearch, phoneNeedle } from './data.js';
import { REQUEST_PURPOSE, REQ_STATUS, REQ_STATUS_TONE, PRIORITY, PRIORITY_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, select, pageHead, subTabs, filterChips, resultLine,
    countText, fmtDate, phoneLinks
} from './ui.js';
import { CLIENT_TABS, ACTIVE_REQUEST } from './clients.js';
import { districtsText, budgetText } from './requirements.js';

// «النشطة» = مفتوح أو تمت مطابقته: ما زال العميل يبحث، وهو ما يعمل عليه الوسيط
const STATUS_CHIPS = [
    { value: 'active', label: 'النشطة', statuses: ACTIVE_REQUEST },
    { value: 'open', label: 'مفتوحة', statuses: ['open'] },
    { value: 'matched', label: 'تمت المطابقة', statuses: ['matched'] },
    { value: 'won', label: 'منجزة', statuses: ['won'] },
    { value: 'closed', label: 'مغلقة', statuses: ['closed'] },
    { value: 'all', label: 'الكل', statuses: null }
];

const PURPOSE_CHIPS = [
    { value: '', label: 'شراء وإيجار' },
    { value: 'sale', label: 'شراء' },
    { value: 'rent', label: 'إيجار' }
];

const SORTS = {
    new: { label: 'الأحدث', column: 'created_at', ascending: false },
    priority: { label: 'الأولوية', column: 'priority', ascending: true },
    budget: { label: 'أعلى ميزانية', column: 'budget_max', ascending: false }
};

const remembered = { page: 0, search: '', purpose: '', status: 'active', priority: '', sort: 'new' };

export async function renderRequests(root) {
    const view = remembered;
    const body = el('div');
    // ردّ تحميل أقدم يصل بعد أحدث (ضغطتان متتاليتان على شبكة بطيئة) يُهمَل
    let seq = 0;
    let countSeq = 0;

    const searchBox = el('input', {
        type: 'search', class: 'crm-search', placeholder: 'ابحث باسم العميل أو جواله…', autocomplete: 'off',
        value: view.search, 'aria-label': 'بحث في الطلبات باسم العميل أو جواله'
    });
    const priorityBox = select([{ value: '', label: 'كل الأولويات' }].concat(Object.keys(PRIORITY).map((key) => ({ value: key, label: 'أولوية ' + PRIORITY[key] }))),
        view.priority, { 'aria-label': 'الأولوية' });
    const sortBox = select(Object.keys(SORTS).map((key) => ({ value: key, label: 'الترتيب: ' + SORTS[key].label })), view.sort, { 'aria-label': 'ترتيب الطلبات' });
    const purposeChips = filterChips('غرض الطلب', PURPOSE_CHIPS, view.purpose, (value) => { view.purpose = value; view.page = 0; load(); });
    const statusChips = filterChips('حالة الطلب', STATUS_CHIPS, view.status, (value) => { view.status = value; view.page = 0; load(); });

    let debounce = null;
    searchBox.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { view.search = searchBox.value; view.page = 0; load(); }, 300);
    });
    priorityBox.addEventListener('change', () => { view.priority = priorityBox.value; view.page = 0; load(); });
    sortBox.addEventListener('change', () => { view.sort = sortBox.value; view.page = 0; load(); });

    function reset() {
        Object.assign(view, { page: 0, search: '', purpose: '', status: 'active', priority: '' });
        searchBox.value = '';
        priorityBox.value = '';
        purposeChips.set('');
        statusChips.set('active');
        load();
    }

    replace(root, [
        pageHead('طلبات الشراء والإيجار', 'ما يبحث عنه عملاؤك الآن. افتح الطلب لترى العقارات المطابقة وتشاركها مع العميل.'),
        subTabs('أقسام العملاء', CLIENT_TABS, '#/requests'),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-toolbar' }, [searchBox, priorityBox, sortBox]),
            el('div', { class: 'f-row' }, [purposeChips.node, statusChips.node]),
            body
        ])
    ]);

    // الحالة والأولوية والبحث المختارة على الاستعلام (للقائمة ولعدّ الحبّات معاً)
    function filters(query, term) {
        const chip = STATUS_CHIPS.find((c) => c.value === view.status) || STATUS_CHIPS[0];
        if (chip.statuses) query = query.in('status', chip.statuses);
        if (view.priority) query = query.eq('priority', Number(view.priority));
        if (term) {
            const needle = phoneNeedle(term);
            query = needle ? query.ilike('client.phone', '%' + needle + '%') : query.ilike('client.full_name', '%' + term + '%');
        }
        return query;
    }

    // عدد الطلبات لكل غرض بالحالة والأولوية والبحث المختارة، فيطابق العدد ما تعرضه القائمة حين تُضغط الحبّة
    function countPurposes(term) {
        const mine = ++countSeq;
        Promise.all(PURPOSE_CHIPS.map((chip) => {
            let query = filters(supabase.from('client_requirements')
                .select('id' + (term ? ', client:clients!inner(full_name, phone)' : ''), { count: 'exact', head: true }), term);
            if (chip.value) query = query.eq('purpose', chip.value);
            return Promise.resolve(query).catch(() => ({ count: null }));
        })).then((counts) => {
            if (mine !== countSeq || !root.isConnected) return;
            PURPOSE_CHIPS.forEach((chip, i) => purposeChips.setCount(chip.value, counts[i].error ? null : counts[i].count));
        });
    }

    async function load() {
        const mine = ++seq;
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const sort = SORTS[view.sort] || SORTS.new;
        const term = sanitizeSearch(view.search);
        countPurposes(term);

        // !inner: البحث باسم العميل يرشّح الطلبات نفسها، لا العميل المضمَّن وحده
        let query = supabase
            .from('client_requirements')
            .select('id, client_id, purpose, property_type, city, districts, budget_min, budget_max, priority, status, created_at,'
                + ' client:clients' + (term ? '!inner' : '') + '(full_name, phone)', { count: 'exact' })
            .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
            .order('created_at', { ascending: false })
            .range(from, to);
        query = filters(query, term);
        if (view.purpose) query = query.eq('purpose', view.purpose);

        const result = await Promise.resolve(query).catch((error) => ({ error }));
        if (mine !== seq || !body.isConnected) return;
        const back = pageBack(view.page, result);
        if (back !== null) { view.page = back; return load(); }
        const { data, error, count } = result;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الطلبات', load));

        const filtered = Boolean(term || view.purpose || view.priority || view.status !== 'active');
        if (!data || data.length === 0) {
            replace(body, filtered
                ? empty('لا طلبات بهذه التصفية', 'غيّر الغرض أو الحالة، أو امسح التصفية لترى الطلبات النشطة كلها.',
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'مسح التصفية', onclick: reset }))
                : empty('لا طلبات نشطة الآن', 'الطلب يُضاف من ملف العميل: «العملاء» ← افتح العميل ← «طلب جديد».',
                    el('a', { class: 'btn btn-outline btn-sm', href: '#/clients', text: 'افتح العملاء' })));
            return;
        }

        const total = count === null || count === undefined ? data.length : count;
        replace(body, [
            resultLine(countText(total, ['طلب واحد', 'طلبان', 'طلبات', 'طلباً']), filtered ? reset : null),
            el('div', { class: 'crm-table-wrap' }, table(data)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العميل' }),
        el('th', { text: 'الطلب' }),
        el('th', { text: 'المكان' }),
        el('th', { text: 'الميزانية' }),
        el('th', { text: 'الأولوية' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'أُضيف' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const client = row.client || {};
        const href = '#/clients/' + row.client_id + '/requirements/' + row.id;
        body.appendChild(el('tr', { class: 'clickable', onclick: () => { location.hash = href; } }, [
            el('td', { class: 'r-client' }, el('div', { class: 'cl-name' }, [
                el('a', { href: href, text: client.full_name || 'عميل', onclick: (event) => event.stopPropagation() }),
                client.phone ? phoneLinks(client.phone) : null
            ])),
            el('td', { class: 'r-what' }, el('div', { class: 'req-what' }, [
                badge(label(REQUEST_PURPOSE, row.purpose), row.purpose === 'rent' ? 'blue' : 'neutral'),
                el('strong', { text: row.property_type || 'أي عقار' })
            ])),
            el('td', { class: 'r-where', text: [row.city, districtsText(row.districts)].filter(Boolean).join(' · ') }),
            // بلا class="num": خانة الأرقام اتجاهها من اليسار، فكانت «حتى 900,000» تُقرأ مقلوبة
            el('td', { class: 'r-budget', text: budgetText(row) }),
            el('td', { class: 'r-priority' }, badge(label(PRIORITY, row.priority), PRIORITY_TONE[row.priority] || 'neutral')),
            el('td', { class: 'r-status' }, badge(label(REQ_STATUS, row.status), REQ_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'r-date crm-subtle', text: fmtDate(row.created_at) })
        ]));
    }

    // t-card t-requests: على الجوال بطاقة (crm/v6.css): العميل والحالة، ثم الطلب والمكان، ثم الميزانية والأولوية
    return el('table', { class: 'users-table crm-table t-card t-requests' }, [head, body]);
}
