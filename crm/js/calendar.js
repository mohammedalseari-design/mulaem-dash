// #/calendar — المواعيد والمتابعات القادمة من follow_ups.
//
// التصميم السادس «الوسيط» (2026-10-23): نطاق «المعاينات» = المتابعات المعلّقة بقناة «زيارة» من اليوم فصاعداً، وهي
// مواعيد معاينة العقار مع العميل. «عملي اليوم» يفتح الصفحة عليه مباشرة (presetCalendarScope).

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CHANNEL, FOLLOW_UP_STATUS, FOLLOW_UP_STATUS_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, fmtDateTime, localDayStart, dash, phoneLinks, pageHead, filterChips
} from './ui.js';
import { openDoneForm } from './followup-form.js';

const SCOPES = [
    { value: 'upcoming', label: 'القادمة' },
    { value: 'today', label: 'اليوم' },
    { value: 'visits', label: 'المعاينات' },
    { value: 'overdue', label: 'المتأخرة' },
    { value: 'done', label: 'المنجزة' }
];

let presetScope = null;
export function presetCalendarScope(scope) {
    presetScope = SCOPES.some((s) => s.value === scope) ? scope : null;
}

export async function renderCalendar(root) {
    const view = { page: 0, scope: presetScope || 'upcoming' };
    presetScope = null;
    const body = el('div');
    const names = await staffMap().catch(() => new Map());
    const chips = filterChips('نطاق المواعيد', SCOPES, view.scope, (value) => { view.scope = value; view.page = 0; load(); });

    replace(root, [
        pageHead('المواعيد', 'كل المتابعات حسب موعدها: القادمة واليوم والمعاينات والمتأخرة والمنجزة.'),
        el('div', { class: 'crm-card' }, [el('div', { class: 'crm-toolbar' }, chips.node), body])
    ]);

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        let query = supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, status, outcome, assigned_to, client_id, requirement_id, client:clients(full_name, phone)', { count: 'exact' })
            .range(from, to);

        if (view.scope === 'upcoming') {
            query = query.eq('status', 'pending').gte('due_at', new Date().toISOString()).order('due_at', { ascending: true });
        } else if (view.scope === 'today') {
            query = query.eq('status', 'pending').gte('due_at', localDayStart(0)).lt('due_at', localDayStart(1)).order('due_at', { ascending: true });
        } else if (view.scope === 'visits') {
            query = query.eq('status', 'pending').eq('channel', 'visit').gte('due_at', localDayStart(0)).order('due_at', { ascending: true });
        } else if (view.scope === 'overdue') {
            query = query.eq('status', 'pending').lt('due_at', localDayStart(0)).order('due_at', { ascending: true });
        } else {
            query = query.eq('status', 'done').order('due_at', { ascending: false });
        }

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل المواعيد', load));
        if (!data || data.length === 0) return void replace(body, empty(emptyText(view.scope), emptyHint(view.scope)));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, names, load)),
            pager(view.page, count || data.length, (page) => { view.page = page; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function emptyText(scope) {
    if (scope === 'today') return 'لا توجد مواعيد اليوم';
    if (scope === 'visits') return 'لا معاينات قادمة';
    if (scope === 'overdue') return 'لا توجد متابعات متأخرة';
    if (scope === 'done') return 'لا توجد متابعات منجزة';
    return 'لا توجد مواعيد قادمة';
}

function emptyHint(scope) {
    if (scope === 'visits') return 'موعد المعاينة متابعة بقناة «زيارة»: من ملف العميل ← «المتابعات» ← متابعة جديدة.';
    if (scope === 'overdue') return 'كل ما فات موعده أُنجز.';
    if (scope === 'done') return null;
    return 'أضف متابعة من ملف العميل لتظهر هنا في وقتها.';
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
            el('td', {}, phoneLinks(row.client && row.client.phone)),
            el('td', {}, row.channel === 'visit' ? badge(label(CHANNEL, row.channel), 'gold') : document.createTextNode(label(CHANNEL, row.channel))),
            el('td', { text: dash(row.purpose) }),
            el('td', { text: staffName(names, row.assigned_to) }),
            el('td', {}, badge(label(FOLLOW_UP_STATUS, row.status), FOLLOW_UP_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'cell-actions' }, row.status === 'pending' ? el('button', {
                type: 'button', class: 'btn btn-success btn-xs', text: 'تم',
                onclick: () => openDoneForm(row, reload)
            }) : null)
        ]));
    }
    // t-card t-cal: على الجوال بطاقة (easy.css): الموعد والحالة، ثم العميل والغرض، ثم الاتصال و«تم»
    return el('table', { class: 'users-table crm-table t-card t-cal' }, [head, body]);
}
