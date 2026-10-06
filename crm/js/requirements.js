// لسان "الطلبات" في صفحة العميل.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { PURPOSE, REQ_STATUS, REQ_STATUS_TONE, PRIORITY, PRIORITY_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, money, fmtDate, dash, EM_DASH, notify, fail,
    openModal, closeModal, waNumber, icon
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
                    onclick: (event) => sendShareLink(event.currentTarget, context.client, row.id)
                })
            ]))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

// رابط العرض للعميل: صفحة واحدة بكل العقارات المحفوظة لطلبه (مشارَكة أو مهتم أو معاينة)، صالحة 14 يوماً.
// النافذة فيها الرسالة جاهزة و«أرسل في واتساب» رابطاً يضغطه الموظف بنفسه، فلا يمنعه حاجب النوافذ
// المنبثقة على الجوال، و«انسخ الرابط» لمن يرسله بطريقة أخرى. lead سطر يسبق الرسالة (مثلاً: حُفظ العقار).
export async function sendShareLink(button, client, requirementId, lead) {
    if (button) button.disabled = true;
    let link;
    try {
        const { data: token, error } = await supabase.rpc('create_client_share', {
            p_client: client.id,
            p_requirement: requirementId
        });
        if (error) throw error;
        const url = new URL('share.html', window.location.href);
        url.searchParams.set('token', token);
        link = url.href;
    } catch (error) {
        return void fail(error, 'تعذّر إنشاء رابط العرض');
    } finally {
        if (button) button.disabled = false;
    }
    openShareSheet(client, link, lead);
}

function openShareSheet(client, link, lead) {
    const message = 'السلام عليكم' + (client.full_name ? ' ' + client.full_name : '') + '،\n'
        + 'هذه عروض ملائم العقارية المناسبة لطلبك:\n' + link + '\nالرابط صالح 14 يوماً.';
    const phone = client.phone ? waNumber(client.phone) : '';

    const copyBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm' }, [icon('link'), el('span', { text: 'انسخ الرابط' })]);
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(link);
            notify('تم نسخ الرابط', 'success');
        } catch (error) {
            fail(error, 'تعذّر النسخ — انسخ الرابط من الرسالة');
        }
    });
    // الإغلاق بعد الضغط لا قبله: الرابط يُفتح أولاً ثم تُغلق النافذة
    const waBtn = phone ? el('a', {
        class: 'btn btn-success btn-sm', target: '_blank', rel: 'noopener',
        href: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message),
        onclick: () => setTimeout(closeModal, 0)
    }, [icon('chat'), el('span', { text: 'أرسل في واتساب' })]) : null;

    openModal('أرسل العرض للعميل', [
        lead ? el('p', { class: 'share-lead', text: lead }) : null,
        phone
            ? el('p', { class: 'crm-subtle', style: 'margin-bottom:8px' }, [
                'تُفتح هذه الرسالة جاهزة في واتساب على جوال العميل ',
                el('span', { class: 'phone-num', dir: 'ltr', text: client.phone })
            ])
            : el('p', { class: 'crm-subtle', style: 'margin-bottom:8px', text: 'لا يوجد جوال مسجّل للعميل — انسخ الرابط وأرسله بالطريقة المناسبة:' }),
        el('p', { class: 'share-msg', text: message }),
        el('div', { class: 'btn-row btn-row-end' }, [copyBtn, waBtn])
    ], { narrow: true });
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
