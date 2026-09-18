// نموذج المتابعة وإجراء "تم".
//
// ما لا يُرسل أبداً: created_by. و assigned_to يُرسل من المدير/مركز الاتصال فقط،
// والوسيط يفرضه الخادم على نفسه (مشغّل follow_ups_guard).

import { supabase } from './supabase.js';
import { canAssign } from './auth.js';
import { staff } from './data.js';
import { CHANNEL, PURPOSE, REQ_STATUS, label } from './labels.js';
import {
    el, field, input, select, optionList, toLocalISO, openModal, closeModal,
    notify, fail, fmtDateTime
} from './ui.js';

export async function openFollowUpForm(client, onSaved, presetRequirementId) {
    let staffOptions = [];
    let requirementOptions = [];

    try {
        if (canAssign()) {
            staffOptions = (await staff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        }
        // منتقي الطلبات: أحدث 25 طلباً للعميل، لا الجدول كاملاً
        const { data, error } = await supabase
            .from('client_requirements')
            .select('id, purpose, property_type, status')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false })
            .range(0, 24);
        if (error) throw error;
        requirementOptions = (data || []).map((r) => ({
            value: r.id,
            label: label(PURPOSE, r.purpose) + ' — ' + r.property_type + ' (' + label(REQ_STATUS, r.status) + ')'
        }));
    } catch (error) {
        return fail(error, 'تعذّر تحضير النموذج');
    }

    // الافتراضي: الساعة القادمة، والتاريخ منها أيضاً حتى لا ينقلب اليوم عند منتصف الليل
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const dueDate = input({ type: 'date', required: true, value: localDateValue(next) });
    const dueTime = input({ type: 'time', required: true, value: pad2(next.getHours()) + ':00' });
    const channel = select(optionList(CHANNEL), 'call');
    const purpose = input({ maxLength: 200, placeholder: 'مثال: متابعة عرض السلامة' });
    const requirement = select(
        [{ value: '', label: 'بدون طلب محدد' }].concat(requirementOptions),
        presetRequirementId || ''
    );
    const assignee = select([{ value: '', label: 'حسب مالك العميل' }].concat(staffOptions), '');

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'جدولة المتابعة' });
    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('التاريخ', dueDate, { required: true }),
            field('الوقت', dueTime, { required: true }),
            field('القناة', channel),
            field('الغرض', purpose),
            field('الطلب المرتبط', requirement),
            canAssign() ? field('المكلَّف', assignee) : null
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const dueAt = toLocalISO(dueDate.value, dueTime.value);
        if (!dueAt) return void notify('حدّد تاريخ ووقت المتابعة', 'error');

        const payload = {
            client_id: client.id,
            due_at: dueAt,
            channel: channel.value,
            purpose: purpose.value.trim() || null,
            requirement_id: requirement.value || null
        };
        if (canAssign() && assignee.value) payload.assigned_to = assignee.value;

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { data, error } = await supabase.from('follow_ups').insert(payload).select('id, due_at').single();
        saveBtn.disabled = false;
        saveBtn.textContent = 'جدولة المتابعة';

        if (error) return void fail(error, 'تعذّر جدولة المتابعة');
        closeModal();
        notify('تمت جدولة المتابعة — ' + fmtDateTime(data.due_at), 'success', 6000);
        if (onSaved) onSaved(data);
    });

    openModal('متابعة جديدة', form);
}

// "تم": تسأل عن النتيجة ثم تحدّث الحالة. done_at يضعه الخادم.
export function openDoneForm(followUp, onDone) {
    const outcome = el('textarea', { rows: 3, placeholder: 'ماذا حدث في هذه المتابعة؟' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-success btn-sm', text: 'تأكيد الإنجاز' });

    const form = el('form', {}, [
        el('p', { class: 'crm-subtle', style: 'margin-bottom:14px', text: 'الموعد: ' + fmtDateTime(followUp.due_at) }),
        el('div', { class: 'form-group' }, outcome),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { error } = await supabase
            .from('follow_ups')
            .update({ status: 'done', outcome: outcome.value.trim() || null })
            .eq('id', followUp.id);
        saveBtn.disabled = false;
        saveBtn.textContent = 'تأكيد الإنجاز';

        if (error) return void fail(error, 'تعذّر إنهاء المتابعة');
        closeModal();
        notify('تم إنجاز المتابعة', 'success');
        if (onDone) onDone();
    });

    openModal('نتيجة المتابعة', form, { narrow: true });
}

const pad2 = (n) => String(n).padStart(2, '0');

function localDateValue(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}
