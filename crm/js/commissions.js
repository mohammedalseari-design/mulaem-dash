// ‎#/commissions‎ — كل العمولات (للمدير).
//
// البند مخفي عن غير المدير والموجّه يرفض المسار، والقاعدة تحصر ما يُقرأ على كل
// حال بـ crm_can_see_deal: الوسيط لا يرى إلا عمولات صفقاته. لا ترشيح بالمستخدم هنا.
//
// المجاميع في ذيل الجدول للصفحة المعروضة وحدها — لا تُجمع صفحات في الذاكرة.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { COMMISSION_STATUS, COMMISSION_STATUS_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, select, optionList,
    money, fmtDate, dash
} from './ui.js';

const FIELDS = 'id, deal_id, base_amount, rate_percent, gross_amount, vat_amount, collected_amount,'
    + ' collected_at, status, invoice_no, updated_at,'
    + ' deal:deals(id, broker_id, closed_at, unit_key, client:clients(id, full_name))';

export async function renderCommissions(root) {
    const view = { page: 0, status: '' };
    const body = el('div');

    const statusBox = select(optionList(COMMISSION_STATUS, 'كل الحالات'), '');
    statusBox.addEventListener('change', () => {
        view.status = statusBox.value;
        view.page = 0;
        load();
    });

    replace(root, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'العمولات' }),
            el('a', { class: 'btn btn-outline btn-sm', href: '#/deals', text: 'لوحة الصفقات' })
        ]),
        el('div', { class: 'crm-toolbar' }, [statusBox, el('div', { class: 'crm-spacer' })]),
        body
    ]));

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        return void replace(body, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
    }
    if (!body.isConnected) return;

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('commissions')
            .select(FIELDS, { count: 'exact' })
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to);
        if (view.status) query = query.eq('status', view.status);

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العمولات'));
        if (!data || data.length === 0) {
            return void replace(body, empty(view.status ? 'لا عمولات بهذه الحالة' : 'لا توجد عمولات بعد'));
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
        el('th', { text: 'العميل' }),
        el('th', { text: 'الوسيط' }),
        el('th', { text: 'قيمة الصفقة' }),
        el('th', { text: 'النسبة' }),
        el('th', { text: 'الإجمالي' }),
        el('th', { text: 'المحصَّل' }),
        el('th', { text: 'المتبقي' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'الفاتورة' }),
        el('th', { text: '' })
    ]));

    let grossTotal = 0;
    let collectedTotal = 0;
    const body = el('tbody');

    for (const row of rows) {
        const gross = Number(row.gross_amount || 0);
        const collected = Number(row.collected_amount || 0);
        const outstanding = Math.max(0, gross - collected);
        grossTotal += gross;
        collectedTotal += collected;

        const client = row.deal && row.deal.client ? row.deal.client : null;
        body.appendChild(el('tr', {}, [
            el('td', {}, client
                ? el('a', { href: '#/clients/' + client.id, text: client.full_name })
                : el('span', { text: 'عميل غير مرئي' })),
            el('td', { text: staffName(names, row.deal ? row.deal.broker_id : null) }),
            el('td', { class: 'num', text: money(row.base_amount) }),
            el('td', { class: 'num', text: dash(row.rate_percent) + '%' }),
            el('td', { class: 'num', text: money(gross) }),
            el('td', { class: 'num', text: money(collected) }),
            el('td', { class: 'num', text: money(outstanding) }),
            el('td', {}, badge(label(COMMISSION_STATUS, row.status), COMMISSION_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'crm-subtle', text: dash(row.invoice_no) }),
            el('td', { class: 'cell-actions' }, el('a', {
                class: 'btn btn-secondary btn-xs', href: '#/deals/' + row.deal_id, text: 'الصفقة'
            }))
        ]));
    }

    // مجاميع الصفحة المعروضة لا مجاميع الجدول كله
    const foot = el('tfoot', {}, el('tr', { class: 'crm-total-row' }, [
        el('td', { text: 'مجموع هذه الصفحة' }),
        el('td', {}),
        el('td', {}),
        el('td', {}),
        el('td', { class: 'num', text: money(grossTotal) }),
        el('td', { class: 'num', text: money(collectedTotal) }),
        el('td', { class: 'num', text: money(Math.max(0, grossTotal - collectedTotal)) }),
        el('td', {}),
        el('td', {}),
        el('td', {})
    ]));

    return el('table', { class: 'users-table crm-table' }, [head, body, foot]);
}
