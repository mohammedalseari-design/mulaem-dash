// لسان "الصفقات" في صفحة العميل.
//
// اللسان مخفي عن مركز الاتصال (client.js لا يبنيه له)، وسياسات deals ترفضه أصلاً.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffName, stageMap, stageName } from './data.js';
import { DEAL_STAGE_TONE } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, money, fmtDate, dash
} from './ui.js';
import { openDealForm } from './deal-form.js';

export async function renderDeals(host, context) {
    const view = { page: 0 };
    const body = el('div');

    replace(host, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'الصفقات' }),
            el('button', {
                type: 'button', class: 'btn btn-primary btn-sm', text: 'صفقة جديدة',
                onclick: () => openDealForm(context.client, null, () => { view.page = 0; load(); })
            })
        ]),
        body
    ]));

    let stages = new Map();
    try {
        stages = await stageMap();
    } catch (error) {
        return void replace(body, errorBox(error, 'تعذّر تحميل مراحل الصفقات'));
    }
    if (!body.isConnected) return;

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('deals')
            .select(
                'id, stage_id, project_id, unit_key, amount, broker_id, opened_at, expected_close_date,'
                + ' project:projects(name)',
                { count: 'exact' }
            )
            .eq('client_id', context.client.id)
            .order('opened_at', { ascending: false })
            .range(from, to);

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الصفقات'));
        if (!data || data.length === 0) return void replace(body, empty('لا توجد صفقات لهذا العميل بعد'));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, stages, context)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows, stages, context) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'المرحلة' }),
        el('th', { text: 'العقار / الوحدة' }),
        el('th', { text: 'القيمة' }),
        el('th', { text: 'الوسيط' }),
        el('th', { text: 'فُتحت' }),
        el('th', { text: 'الإغلاق المتوقع' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', {}, badge(stageName(stages, row.stage_id), DEAL_STAGE_TONE[row.stage_id] || 'neutral')),
            el('td', {}, propertyCell(row)),
            el('td', { class: 'num', text: money(row.amount) }),
            el('td', { text: staffName(context.names, row.broker_id) }),
            el('td', { class: 'crm-subtle', text: fmtDate(row.opened_at) }),
            el('td', { class: 'crm-subtle', text: fmtDate(row.expected_close_date) }),
            el('td', { class: 'cell-actions' }, el('a', {
                class: 'btn btn-secondary btn-xs', href: '#/deals/' + row.id, text: 'فتح الصفقة'
            }))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

// اسم العقار من التضمين، وإن حجبته سياسات projects فرقمه يكفي للبحث عنه في اللوحة
export function propertyCell(row) {
    const name = row.project && row.project.name
        ? row.project.name
        : (row.project_id ? 'عقار رقم ' + row.project_id : null);
    return el('div', {}, [
        el('strong', { text: name ? name : 'بدون عقار' }),
        row.unit_key ? el('div', { class: 'crm-subtle', text: 'الوحدة: ' + dash(row.unit_key) }) : null
    ]);
}
