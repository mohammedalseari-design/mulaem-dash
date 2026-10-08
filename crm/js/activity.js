// ‎#/activity‎ — «سجل النشاطات» (للمدير وحده): ما كتبه النظام في جدول activities (دخول وخروج وإضافة المشاريع
// وتعديلها…)، نُقل من لوحة الصفحة القديمة. القراءة للمدير وحده بسياسة activities_select_admin.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { sanitizeSearch } from './data.js';
import { el, replace, loading, empty, errorBox, pager, select, dash, pageHead } from './ui.js';

// الوقت مخزّن بتوقيت الرياض بلا منطقة زمنية («timestamp» بلا tz)، فيُعرض كما هو
function whenText(value) {
    if (!value) return dash(null);
    const [day, time] = String(value).split('T').length === 2 ? String(value).split('T') : String(value).split(' ');
    return day + (time ? ' ' + time.slice(0, 5) : '');
}

export async function renderActivity(root) {
    const view = { page: 0, user: '', search: '' };
    const body = el('div');
    const search = el('input', { type: 'search', class: 'crm-search', placeholder: 'ابحث في النشاط أو تفاصيله…', autocomplete: 'off' });
    const userBox = select([{ value: '', label: 'كل الموظفين' }], '');

    replace(root, [
        pageHead('سجل النشاطات', 'من فعل ماذا ومتى: الدخول والخروج وإضافة المشاريع وتعديلها وحذفها.'),
        el('div', { class: 'crm-card' }, [el('div', { class: 'crm-toolbar' }, [search, userBox]), body])
    ]);

    // مرشّح الموظف: رقمه (legacy_id) هو ما يكتبه مشغّل activities_guard في user_id
    const { data: people } = await supabase.from('profiles').select('legacy_id, fullname, username').order('fullname');
    for (const p of people || []) userBox.appendChild(el('option', { value: String(p.legacy_id), text: p.fullname || p.username }));

    let debounce = null;
    search.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { view.search = search.value; view.page = 0; load(); }, 300);
    });
    userBox.addEventListener('change', () => { view.user = userBox.value; view.page = 0; load(); });

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        let query = supabase.from('activities')
            .select('id, user_name, action, details, timestamp', { count: 'exact' })
            .order('timestamp', { ascending: false })
            .range(from, to);
        if (view.user) query = query.eq('user_id', Number(view.user));
        const term = sanitizeSearch(view.search);
        if (term) query = query.or('action.ilike.%' + term + '%,details.ilike.%' + term + '%');
        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل السجل'));
        if (!data || !data.length) return void replace(body, empty(term || view.user ? 'لا نتائج مطابقة' : 'السجل فارغ'));
        const head = el('thead', {}, el('tr', {}, ['الوقت', 'الموظف', 'النشاط', 'التفاصيل'].map((t) => el('th', { text: t }))));
        const rows = el('tbody', {}, data.map((row) => el('tr', {}, [
            el('td', { class: 'crm-subtle', dir: 'ltr', text: whenText(row.timestamp) }),
            el('td', {}, el('strong', { text: dash(row.user_name) })),
            el('td', { text: dash(row.action) }),
            el('td', { class: 'crm-subtle', text: dash(row.details) })
        ])));
        replace(body, [
            el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, rows])),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}
