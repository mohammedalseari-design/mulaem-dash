// لسان "الطلبات" في صفحة العميل.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { PURPOSE, REQ_STATUS, REQ_STATUS_TONE, PRIORITY, PRIORITY_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, money, fmtDate, dash, EM_DASH, notify, fail
} from './ui.js';
import { openRequirementForm } from './requirement-form.js';

export async function renderRequirements(host, context) {
    const view = { page: 0 };
    const body = el('div');

    replace(host, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'الطلبات' }),
            el('button', {
                type: 'button', class: 'btn btn-primary btn-sm', text: 'طلب جديد',
                onclick: () => openRequirementForm(context.client, null, () => { view.page = 0; load(); })
            })
        ]),
        body
    ]));

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('client_requirements')
            .select('*', { count: 'exact' })
            .eq('client_id', context.client.id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الطلبات'));
        if (!data || data.length === 0) return void replace(body, empty('لا توجد طلبات لهذا العميل بعد'));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, table(data, context, load)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows, context, reload) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الغرض' }),
        el('th', { text: 'نوع العقار' }),
        el('th', { text: 'الأحياء' }),
        el('th', { text: 'الميزانية' }),
        el('th', { text: 'الأولوية' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', { text: label(PURPOSE, row.purpose) }),
            el('td', {}, el('strong', { text: dash(row.property_type) })),
            el('td', { text: districtsText(row.districts) }),
            el('td', { class: 'num', text: budgetText(row) }),
            el('td', {}, badge(label(PRIORITY, row.priority), PRIORITY_TONE[row.priority] || 'neutral')),
            el('td', {}, badge(label(REQ_STATUS, row.status), REQ_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'cell-actions' }, el('div', { class: 'btn-row' }, [
                el('a', {
                    class: 'btn btn-secondary btn-xs', text: 'المطابقات',
                    href: '#/clients/' + context.client.id + '/requirements/' + row.id
                }),
                el('button', {
                    type: 'button', class: 'btn btn-outline btn-xs', text: 'تعديل',
                    onclick: () => openRequirementForm(context.client, row, reload)
                }),
                el('button', {
                    type: 'button', class: 'btn btn-outline btn-xs', text: 'رابط للعميل',
                    onclick: (event) => shareRequirement(event.currentTarget, context.client.id, row.id)
                })
            ]))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

async function shareRequirement(button, clientId, requirementId) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return void notify('النسخ إلى الحافظة غير متاح في هذا المتصفح', 'error', 8000);
    }
    button.disabled = true;
    try {
        const { data: token, error } = await supabase.rpc('create_client_share', {
            p_client: clientId,
            p_requirement: requirementId
        });
        if (error) throw error;
        const url = new URL('share.html', window.location.href);
        url.searchParams.set('token', token);
        await navigator.clipboard.writeText(url.href);
        notify('تم نسخ رابط العرض، وصلاحيته 14 يومًا', 'success', 8000);
    } catch (error) {
        fail(error, 'تعذّر إنشاء رابط العرض');
    } finally {
        button.disabled = false;
    }
}

export function districtsText(districts) {
    return districts && districts.length ? districts.join('، ') : 'كل الأحياء';
}

export function budgetText(row) {
    const min = row.budget_min === null || row.budget_min === undefined ? null : money(row.budget_min);
    const max = row.budget_max === null || row.budget_max === undefined ? null : money(row.budget_max);
    if (min && max) return min + ' ' + EM_DASH + ' ' + max;
    if (max) return 'حتى ' + max;
    if (min) return 'من ' + min;
    return EM_DASH;
}

export function rangeText(min, max, suffix) {
    const unit = suffix ? ' ' + suffix : '';
    if (min !== null && min !== undefined && max !== null && max !== undefined) return money(min) + ' ' + EM_DASH + ' ' + money(max) + unit;
    if (max !== null && max !== undefined) return 'حتى ' + money(max) + unit;
    if (min !== null && min !== undefined) return 'من ' + money(min) + unit;
    return EM_DASH;
}

export function deliveryText(value) {
    return value ? 'قبل ' + fmtDate(value) : EM_DASH;
}
