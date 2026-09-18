// ‎#/work‎ — "عملي اليوم".
//
// لا يوجد أي ترشيح بالمستخدم هنا: v_my_work معرّف security_invoker وسياسات
// follow_ups تتكفّل بالباقي، فالمدير يرى الجميع والوسيط يرى نفسه تلقائياً.
//
// حدود اليوم: v_my_work صارت تحسب "اليوم" و"المتأخر" بتوقيت Asia/Riyadh
// (006_inventory_quality.sql)، فالقائمتان ترسلان بداية اليوم المحلي وبداية الغد
// نصّاً ISO بإزاحة المتصفح، كي يطابق عدّاد البطاقة طول القائمة تماماً.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CHANNEL, label } from './labels.js';
import {
    el, replace, clear, loading, empty, errorBox, pager, fmtDateTime,
    localDayStart, dash, number
} from './ui.js';
import { openDoneForm } from './followup-form.js';

// تُستعمل أيضاً في لوحة الإدارة (#/dashboard) فوق بطاقات القمع الشهري
export const WORK_CARDS = [
    { key: 'follow_ups_today', label: 'متابعات اليوم' },
    { key: 'follow_ups_overdue', label: 'متابعات متأخرة' },
    { key: 'new_requirements_7d', label: 'طلبات جديدة (7 أيام)' },
    { key: 'viewings_today', label: 'معاينات اليوم' },
    { key: 'active_clients', label: 'عملاء نشطون' }
];

export async function renderWork(root) {
    const stats = el('div', { class: 'stats-bar admin-stats' });
    const todayBody = el('div');
    const overdueBody = el('div');

    replace(root, [
        stats,
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'متابعات اليوم' })]),
            todayBody
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'متأخرة' })]),
            overdueBody
        ])
    ]);

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        replace(todayBody, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
        return;
    }
    if (!root.isConnected) return;

    const todayList = list(todayBody, names, 'today', reloadAll);
    const overdueList = list(overdueBody, names, 'overdue', reloadAll);

    async function loadStats() {
        replace(stats, loading());
        const { data, error } = await supabase.from('v_my_work').select('*').maybeSingle();
        if (!stats.isConnected) return;
        if (error) return void replace(stats, errorBox(error, 'تعذّر تحميل مؤشرات اليوم'));

        clear(stats);
        for (const card of WORK_CARDS) {
            stats.appendChild(el('div', { class: 'stat-card' }, [
                el('h3', { text: number(data ? data[card.key] : 0) }),
                el('p', { text: card.label })
            ]));
        }
    }

    async function reloadAll() {
        await Promise.all([loadStats(), todayList.reload(), overdueList.reload()]);
    }

    await reloadAll();
}

// قائمة متابعات معلّقة ضمن نطاق زمني، بترقيم مستقل
function list(host, names, scope, onChanged) {
    const view = { page: 0 };

    async function reload() {
        replace(host, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, assigned_to, client_id, client:clients(full_name, phone)',
                { count: 'exact' })
            .eq('status', 'pending')
            .range(from, to);

        if (scope === 'today') {
            query = query
                .gte('due_at', localDayStart(0))
                .lt('due_at', localDayStart(1))
                .order('due_at', { ascending: true });
        } else {
            query = query
                .lt('due_at', localDayStart(0))
                .order('due_at', { ascending: true });
        }

        const { data, error, count } = await query;
        if (!host.isConnected) return;
        if (error) return void replace(host, errorBox(error, 'تعذّر تحميل المتابعات'));
        if (!data || data.length === 0) {
            return void replace(host, empty(scope === 'today' ? 'لا متابعات مجدولة اليوم' : 'لا متابعات متأخرة'));
        }

        replace(host, [
            el('div', { class: 'crm-table-wrap' }, table(data, names, onChanged)),
            pager(view.page, count || data.length, (p) => { view.page = p; reload(); }, PAGE_SIZE)
        ]);
    }

    return { reload: reload };
}

function table(rows, names, onChanged) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الموعد' }),
        el('th', { text: 'العميل' }),
        el('th', { text: 'الجوال' }),
        el('th', { text: 'القناة' }),
        el('th', { text: 'الغرض' }),
        el('th', { text: 'المكلَّف' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', { text: fmtDateTime(row.due_at) }),
            el('td', {}, el('a', {
                href: '#/clients/' + row.client_id,
                text: row.client ? row.client.full_name : 'فتح ملف العميل'
            })),
            el('td', { class: 'num', text: row.client ? dash(row.client.phone) : dash(null) }),
            el('td', { text: label(CHANNEL, row.channel) }),
            el('td', { text: dash(row.purpose) }),
            el('td', { text: staffName(names, row.assigned_to) }),
            el('td', { class: 'cell-actions' }, el('button', {
                type: 'button', class: 'btn btn-success btn-xs', text: 'تم',
                onclick: () => openDoneForm(row, onChanged)
            }))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}
