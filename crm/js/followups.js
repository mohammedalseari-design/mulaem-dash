// لسان "المتابعات" في صفحة العميل.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffName } from './data.js';
import { CHANNEL, FOLLOW_UP_STATUS, FOLLOW_UP_STATUS_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, fmtDateTime, dash
} from './ui.js';

export async function renderFollowUps(host, context) {
    const view = { page: 0 };
    const body = el('div');

    replace(host, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'المتابعات' })]),
        body
    ]));

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('follow_ups')
            .select('*', { count: 'exact' })
            .eq('client_id', context.client.id)
            .order('due_at', { ascending: false })
            .range(from, to);

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل المتابعات'));
        if (!data || data.length === 0) return void replace(body, empty('لا توجد متابعات لهذا العميل بعد'));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, context)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows, context) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الموعد' }),
        el('th', { text: 'القناة' }),
        el('th', { text: 'الغرض' }),
        el('th', { text: 'المكلَّف' }),
        el('th', { text: 'الحالة' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', { text: fmtDateTime(row.due_at) }),
            el('td', { text: label(CHANNEL, row.channel) }),
            el('td', { text: dash(row.purpose) }),
            el('td', { text: staffName(context.names, row.assigned_to) }),
            el('td', {}, badge(label(FOLLOW_UP_STATUS, row.status), FOLLOW_UP_STATUS_TONE[row.status] || 'neutral'))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}
