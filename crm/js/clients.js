// ‎#/clients‎ — قائمة العملاء: بحث بالاسم أو الجوال، مرشّح الحالة، وترقيم من الخادم.
// لا تُحمَّل القائمة كاملة أبداً: كل صفحة استعلام مستقل بـ ‎.range()‎ و count دقيق.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, sanitizeSearch, phoneNeedle } from './data.js';
import { CLIENT_STATUS, CLIENT_STATUS_TONE, CLIENT_TYPE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager,
    fmtDateTime, select, optionList, dash
} from './ui.js';
import { openClientForm } from './client-form.js';

export async function renderClients(root) {
    const view = { page: 0, search: '', status: '' };
    let names = new Map();

    const body = el('div');
    const searchBox = el('input', {
        type: 'search', class: 'crm-search', placeholder: 'ابحث بالاسم أو رقم الجوال…', autocomplete: 'off'
    });
    const statusBox = select(optionList(CLIENT_STATUS, 'كل الحالات'), '');

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

    const card = el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'العملاء' }),
            el('button', {
                type: 'button', class: 'btn btn-primary btn-sm', text: 'عميل جديد',
                onclick: () => openClientForm(null, () => { view.page = 0; load(); })
            })
        ]),
        el('div', { class: 'crm-toolbar' }, [searchBox, statusBox]),
        body
    ]);
    root.appendChild(card);

    try {
        names = await staffMap();
    } catch (error) {
        replace(body, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
        return;
    }
    if (!root.isConnected) return;

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('clients')
            .select('id, full_name, phone, client_type, status, owner_id, updated_at', { count: 'exact' })
            .order('updated_at', { ascending: false })
            .range(from, to);

        const term = sanitizeSearch(view.search);
        if (term) {
            const needle = phoneNeedle(term) || term;
            query = query.or('full_name.ilike.%' + term + '%,phone.ilike.%' + needle + '%');
        }
        if (view.status) query = query.eq('status', view.status);

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العملاء'));

        if (!data || data.length === 0) {
            replace(body, empty(term || view.status ? 'لا نتائج مطابقة' : 'لا يوجد عملاء بعد'));
            return;
        }

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, names)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows, names) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الاسم' }),
        el('th', { text: 'الجوال' }),
        el('th', { text: 'النوع' }),
        el('th', { text: 'الوسيط المسؤول' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'آخر تحديث' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const tr = el('tr', {
            class: 'clickable',
            onclick: () => { location.hash = '#/clients/' + row.id; }
        }, [
            el('td', {}, el('strong', { text: row.full_name })),
            el('td', { class: 'num', text: dash(row.phone) }),
            el('td', { text: label(CLIENT_TYPE, row.client_type) }),
            el('td', { text: staffName(names, row.owner_id) }),
            el('td', {}, badge(label(CLIENT_STATUS, row.status), CLIENT_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'crm-subtle', text: fmtDateTime(row.updated_at) })
        ]);
        body.appendChild(tr);
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}
