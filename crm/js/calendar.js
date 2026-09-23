// #/calendar — المواعيد والمتابعات القادمة من follow_ups.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CHANNEL, FOLLOW_UP_STATUS, FOLLOW_UP_STATUS_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, fmtDateTime, localDayStart, dash
} from './ui.js';
import { openDoneForm } from './followup-form.js';

export async function renderCalendar(root) {
    const view = { page: 0, scope: 'upcoming' };
    const body = el('div');
    const toolbar = el('div', { class: 'crm-toolbar' });
    const names = await staffMap().catch(() => new Map());

    replace(root, [
        el('div', { class: 'page-intro' }, [
            el('div', {}, [
                el('h1', { text: 'المواعيد والمتابعات' }),
                el('p', { text: 'رتّب ما يحتاج إجراء اليوم وتابع ما تأخر.' })
            ]),
            el('span', { class: 'page-intro-meta', text: 'المتابعات القادمة' })
        ]),
        el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'المواعيد والمتابعات' }),
            el('div', { class: 'crm-subtle', text: 'المواعيد مبنية على سجل المتابعات الحالي' })
        ]),
        toolbar,
        body
        ])
    ]);

    const scopes = [
        ['upcoming', 'القادمة'],
        ['today', 'اليوم'],
        ['overdue', 'المتأخرة'],
        ['done', 'المنجزة']
    ];
    for (const [value, text] of scopes) {
        toolbar.appendChild(el('button', {
            type: 'button', class: 'btn btn-outline btn-xs' + (value === view.scope ? ' active' : ''), text,
            onclick: () => { view.scope = value; view.page = 0; refreshButtons(); load(); }
        }));
    }

    function refreshButtons() {
        const buttons = toolbar.querySelectorAll('button');
        buttons.forEach((button, index) => button.classList.toggle('active', scopes[index][0] === view.scope));
    }

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        let query = supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, status, outcome, assigned_to, client_id, client:clients(full_name, phone)', { count: 'exact' })
            .range(from, to);

        if (view.scope === 'upcoming') {
            query = query.eq('status', 'pending').gte('due_at', new Date().toISOString()).order('due_at', { ascending: true });
        } else if (view.scope === 'today') {
            query = query.eq('status', 'pending').gte('due_at', localDayStart(0)).lt('due_at', localDayStart(1)).order('due_at', { ascending: true });
        } else if (view.scope === 'overdue') {
            query = query.eq('status', 'pending').lt('due_at', localDayStart(0)).order('due_at', { ascending: true });
        } else {
            query = query.eq('status', 'done').order('due_at', { ascending: false });
        }

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل المواعيد'));
        if (!data || data.length === 0) return void replace(body, empty(emptyText(view.scope)));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, names, load)),
            pager(view.page, count || data.length, (page) => { view.page = page; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function emptyText(scope) {
    if (scope === 'today') return 'لا توجد مواعيد اليوم';
    if (scope === 'overdue') return 'لا توجد متابعات متأخرة';
    if (scope === 'done') return 'لا توجد متابعات منجزة';
    return 'لا توجد مواعيد قادمة';
}

function table(rows, names, reload) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الموعد' }), el('th', { text: 'العميل' }), el('th', { text: 'الجوال' }),
        el('th', { text: 'القناة' }), el('th', { text: 'الغرض' }), el('th', { text: 'المكلّف' }),
        el('th', { text: 'الحالة' }), el('th', { text: '' })
    ]));
    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', { text: fmtDateTime(row.due_at) }),
            el('td', {}, el('a', { href: '#/clients/' + row.client_id, text: row.client ? row.client.full_name : 'فتح ملف العميل' })),
            el('td', { class: 'num', text: row.client ? dash(row.client.phone) : dash(null) }),
            el('td', { text: label(CHANNEL, row.channel) }),
            el('td', { text: dash(row.purpose) }),
            el('td', { text: staffName(names, row.assigned_to) }),
            el('td', {}, badge(label(FOLLOW_UP_STATUS, row.status), FOLLOW_UP_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'cell-actions' }, row.status === 'pending' ? el('button', {
                type: 'button', class: 'btn btn-success btn-xs', text: 'تم',
                onclick: () => openDoneForm(row, reload)
            }) : null)
        ]));
    }
    return el('table', { class: 'users-table crm-table' }, [head, body]);
}
