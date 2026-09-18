// لسان "السجل" — crm_events للعميل: قراءة فقط عدا الملاحظة اليدوية.
// الأحداث الأخرى يكتبها مشغّل crm_log_event في قاعدة البيانات، لا الواجهة.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffName } from './data.js';
import {
    CHANNEL, CLIENT_STATUS, EVENT_TYPE, FOLLOW_UP_STATUS, PURPOSE, REQ_STATUS, label
} from './labels.js';
import {
    el, replace, loading, empty, errorBox, pager, fmtDateTime, money, notify, fail
} from './ui.js';

export async function renderTimeline(host, context) {
    const view = { page: 0 };
    const body = el('div');

    const noteInput = el('textarea', { rows: 2, placeholder: 'أضف ملاحظة على العميل…' });
    const noteBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'إضافة ملاحظة' });
    const noteForm = el('form', { class: 'crm-card' }, [
        el('div', { class: 'form-group', style: 'margin-bottom:12px' }, noteInput),
        el('div', { class: 'btn-row btn-row-end' }, noteBtn)
    ]);

    noteForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = noteInput.value.trim();
        if (!text) return;

        noteBtn.disabled = true;
        noteBtn.textContent = 'جارٍ الحفظ…';
        const { error } = await supabase.from('crm_events').insert({
            client_id: context.client.id,
            entity_type: 'note',
            event_type: 'note',
            payload: { text: text }
        });
        noteBtn.disabled = false;
        noteBtn.textContent = 'إضافة ملاحظة';

        if (error) return void fail(error, 'تعذّر إضافة الملاحظة');
        noteInput.value = '';
        notify('تمت إضافة الملاحظة', 'success');
        view.page = 0;
        load();
    });

    replace(host, [
        noteForm,
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'السجل' })]),
            body
        ])
    ]);

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('crm_events')
            .select('*', { count: 'exact' })
            .eq('client_id', context.client.id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل السجل'));
        if (!data || data.length === 0) return void replace(body, empty('لا توجد أحداث بعد'));

        const list = el('ul', { class: 'timeline' });
        for (const event of data) {
            const detail = eventDetail(event);
            list.appendChild(el('li', {}, [
                el('div', { class: 'tl-head' }, [
                    el('span', { class: 'tl-title', text: label(EVENT_TYPE, event.event_type) }),
                    el('span', { class: 'tl-meta', text: fmtDateTime(event.created_at) + ' · ' + staffName(context.names, event.actor_id) })
                ]),
                detail ? el('div', { class: 'tl-body', text: detail }) : null
            ]));
        }

        replace(body, [
            list,
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

// ملخّص عربي لحمولة الحدث. كل القيم تُعرض كنص، بلا أي تركيب HTML.
function eventDetail(event) {
    const p = event.payload || {};
    switch (event.event_type) {
        case 'note':
            return p.text ? String(p.text) : '';
        case 'client_status_changed':
            return 'من ' + label(CLIENT_STATUS, p.from) + ' إلى ' + label(CLIENT_STATUS, p.to);
        case 'requirement_created': {
            const parts = [label(PURPOSE, p.purpose), p.property_type].filter(Boolean);
            if (p.districts && p.districts.length) parts.push(p.districts.join('، '));
            if (p.budget_max) parts.push('حتى ' + money(p.budget_max) + ' ريال');
            return parts.join(' · ');
        }
        case 'requirement_status_changed':
            return 'من ' + label(REQ_STATUS, p.from) + ' إلى ' + label(REQ_STATUS, p.to)
                + (p.reason ? ' — ' + p.reason : '');
        case 'match_shared':
        case 'match_interested':
        case 'match_not_interested':
        case 'match_viewing': {
            const parts = [];
            if (p.unit_key) parts.push('الوحدة: ' + p.unit_key);
            if (p.project_id) parts.push('العقار رقم ' + p.project_id);
            if (p.score !== null && p.score !== undefined) parts.push('الدرجة ' + p.score);
            return parts.join(' · ');
        }
        case 'follow_up_scheduled': {
            const parts = [];
            if (p.due_at) parts.push(fmtDateTime(p.due_at));
            if (p.channel) parts.push(label(CHANNEL, p.channel));
            if (p.purpose) parts.push(String(p.purpose));
            return parts.join(' · ');
        }
        case 'follow_up_done':
        case 'follow_up_cancelled':
            return p.outcome ? String(p.outcome) : label(FOLLOW_UP_STATUS, event.event_type.replace('follow_up_', ''));
        case 'client_reassigned':
            return '';
        case 'deal_opened': {
            const parts = [];
            if (p.stage) parts.push('المرحلة: ' + String(p.stage));
            if (p.unit_key) parts.push('الوحدة: ' + String(p.unit_key));
            if (p.project_id) parts.push('العقار رقم ' + p.project_id);
            if (p.amount) parts.push(money(p.amount) + ' ريال');
            return parts.join(' · ');
        }
        case 'deal_stage_changed': {
            const parts = [];
            if (p.stage) parts.push('إلى: ' + String(p.stage));
            if (p.amount) parts.push(money(p.amount) + ' ريال');
            return parts.join(' · ');
        }
        // تنبيه للمدير يكتبه المشغّل عند إتمام صفقة على عقار: اللوحة القديمة لا
        // تعرف بالإتمام، فحالة العقار فيها تبقى كما هي حتى يغيّرها المدير بنفسه.
        case 'property_sold_flag': {
            const parts = ['العقار بيع فعلياً — راجع حالته في اللوحة'];
            if (p.unit_key) parts.push('الوحدة: ' + String(p.unit_key));
            if (event.entity_id) parts.push('العقار رقم ' + String(event.entity_id));
            return parts.join(' · ');
        }
        case 'commission_recorded': {
            const parts = [];
            if (p.gross !== null && p.gross !== undefined) parts.push('الإجمالي ' + money(p.gross) + ' ريال');
            if (p.vat !== null && p.vat !== undefined) parts.push('الضريبة ' + money(p.vat) + ' ريال');
            return parts.join(' · ');
        }
        case 'commission_due':
        case 'commission_invoiced':
        case 'commission_partial':
        case 'commission_collected':
        case 'commission_waived': {
            const parts = [];
            if (p.collected !== null && p.collected !== undefined) parts.push('المحصَّل ' + money(p.collected) + ' ريال');
            if (p.gross !== null && p.gross !== undefined) parts.push('من ' + money(p.gross) + ' ريال');
            return parts.join(' · ');
        }
        default:
            return '';
    }
}
