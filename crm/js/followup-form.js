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
// ومعها «المتابعة التالية» مفعّلة افتراضياً (غداً، بنفس الساعة والقناة والغرض) حتى لا يبقى عميل بلا موعد قادم.
// و«لم يرد — أجّلها» في النافذة نفسها: العميل الذي لم يرد لا يُسجَّل منجزاً، بل يُنقل موعده ويُكتب ذلك في سجله.
export function openDoneForm(followUp, onDone) {
    const outcome = el('textarea', { rows: 2, placeholder: 'ماذا حدث في هذه المتابعة؟' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-success btn-sm', text: 'تأكيد الإنجاز' });
    const next = nextFollowUpFields(followUp);
    const later = snoozeFields(followUp);

    let mode = 'done';
    const modeDone = el('button', { type: 'button', class: 'fu-mode-btn', 'aria-pressed': 'true', text: 'تمت المتابعة' });
    const modeLater = el('button', { type: 'button', class: 'fu-mode-btn', 'aria-pressed': 'false', text: 'لم يرد — أجّلها' });
    const doneBody = el('div', { class: 'fu-mode-body' }, [el('div', { class: 'form-group' }, outcome), next.section]);
    function setMode(value) {
        mode = value;
        modeDone.setAttribute('aria-pressed', String(value === 'done'));
        modeLater.setAttribute('aria-pressed', String(value === 'later'));
        doneBody.hidden = value !== 'done';
        later.section.hidden = value !== 'later';
        // الحقول المخفية تُعطَّل حتى لا يوقف تحققُ المتصفح الإرسال بحقل لا يراه الموظف
        outcome.disabled = value !== 'done';
        next.setActive(value === 'done');
        later.setActive(value === 'later');
        saveBtn.className = 'btn btn-sm ' + (value === 'done' ? 'btn-success' : 'btn-primary');
        saveBtn.textContent = value === 'done' ? 'تأكيد الإنجاز' : 'تأجيل المتابعة';
    }
    modeDone.addEventListener('click', () => setMode('done'));
    modeLater.addEventListener('click', () => setMode('later'));
    later.setActive(false);

    const form = el('form', {}, [
        // اسم العميل في النافذة: على الجوال يُفتح «تم» من بطاقة، فلا يُغلق متابعة عميل آخر خطأً
        followUp.client && followUp.client.full_name
            ? el('p', { style: 'margin-bottom:4px;font-weight:700', text: 'العميل: ' + followUp.client.full_name })
            : null,
        el('p', { class: 'crm-subtle', style: 'margin-bottom:10px', text: 'الموعد: ' + fmtDateTime(followUp.due_at) }),
        el('div', { class: 'fu-mode', role: 'group', 'aria-label': 'ماذا حدث؟' }, [modeDone, modeLater]),
        doneBody,
        later.section,
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (mode === 'later') return void postpone(followUp, later, saveBtn, onDone);
        // يُتحقق من الموعد التالي قبل أي كتابة، فلا تُغلق المتابعة ثم يُرفض التالي
        const nextPayload = next.payload();
        if (nextPayload && nextPayload.error) return void notify(nextPayload.error, 'error');
        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { data: updated, error } = await supabase
            .from('follow_ups')
            .update({ status: 'done', outcome: outcome.value.trim() || null })
            .eq('id', followUp.id)
            .select('id');
        saveBtn.disabled = false;
        saveBtn.textContent = 'تأكيد الإنجاز';

        if (error) return void fail(error, 'تعذّر إنهاء المتابعة');
        // صفر صفوف بلا خطأ = RLS رشّحت الصف
        if (!updated || updated.length === 0) return void notify('لا تملك صلاحية تعديل هذا السجل', 'error', 8000);

        if (!nextPayload) {
            closeModal();
            notify('تم إنجاز المتابعة', 'success');
            if (onDone) onDone();
            return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الجدولة…';
        const { data: created, error: nextError } = await supabase
            .from('follow_ups').insert(nextPayload).select('id, due_at').single();
        saveBtn.disabled = false;
        saveBtn.textContent = 'تأكيد الإنجاز';
        closeModal();
        if (onDone) onDone();
        // المتابعة أُنجزت فعلاً؛ فشل التالية يُقال صراحة حتى تُجدول يدوياً من ملف العميل
        if (nextError) return void fail(nextError, 'تم إنجاز المتابعة، لكن تعذّرت جدولة التالية');
        notify('تم إنجاز المتابعة، والتالية: ' + fmtDateTime(created.due_at), 'success', 6000);
    });

    openModal('نتيجة المتابعة', form, { narrow: true });
}

// «لم يرد — أجّلها»: يُنقل موعد المتابعة نفسها (تبقى معلّقة)، ثم تُكتب ملاحظة في سجل العميل لأن نقل الموعد
// لا يسجّل حدثاً بنفسه. فشل الملاحظة لا يُرجع التأجيل، ويُقال صراحة.
async function postpone(followUp, later, saveBtn, onDone) {
    const dueAt = toLocalISO(later.dueDate.value, later.dueTime.value);
    if (!dueAt) return void notify('حدّد تاريخ ووقت الموعد الجديد', 'error');
    if (Date.parse(dueAt) < Date.now() - 60000) return void notify('الموعد الجديد فات — اختر موعداً قادماً', 'error');

    saveBtn.disabled = true;
    saveBtn.textContent = 'جارٍ التأجيل…';
    const { data: updated, error } = await supabase
        .from('follow_ups')
        .update({ due_at: dueAt })
        .eq('id', followUp.id)
        .eq('status', 'pending')
        .select('id, due_at');
    saveBtn.disabled = false;
    saveBtn.textContent = 'تأجيل المتابعة';
    if (error) return void fail(error, 'تعذّر تأجيل المتابعة');
    if (!updated || updated.length === 0) return void notify('لا تملك صلاحية تعديل هذه المتابعة أو أنها لم تعد معلّقة', 'error', 8000);

    const when = fmtDateTime(updated[0].due_at);
    const note = later.note.value.trim();
    const { error: noteError } = await supabase.from('crm_events').insert({
        client_id: followUp.client_id,
        entity_type: 'note',
        event_type: 'note',
        payload: { text: 'لم يرد العميل — أُجّلت المتابعة إلى ' + when + (note ? ' · ' + note : '') }
    });
    closeModal();
    if (onDone) onDone();
    if (noteError) return void fail(noteError, 'أُجّلت المتابعة إلى ' + when + '، لكن تعذّرت كتابة الملاحظة في سجل العميل');
    notify('أُجّلت المتابعة إلى ' + when, 'success', 6000);
}

// قسم التأجيل: الافتراضي بعد ساعتين (مقرّباً لنصف الساعة التالية)، مع «غداً» و«بعد 3 أيام» بساعة الموعد الأصلي.
function snoozeFields(followUp) {
    const hour = dueHour(followUp);
    const soon = new Date(Date.now() + 2 * 3600000);
    soon.setMinutes(soon.getMinutes() <= 30 ? 30 : 60, 0, 0);
    const dueDate = input({ type: 'date', required: true, value: localDateValue(soon) });
    const dueTime = input({ type: 'time', required: true, value: pad2(soon.getHours()) + ':' + pad2(soon.getMinutes()) });
    const note = input({ maxLength: 200, placeholder: 'مثال: الجوال مغلق، أو طلب الاتصال بعد العصر' });

    const choices = [
        { text: 'بعد ساعتين', date: soon, time: dueTime.value },
        { text: 'غداً', date: daysFromToday(1), time: hour },
        { text: 'بعد 3 أيام', date: daysFromToday(3), time: hour }
    ];
    const quick = choices.map((choice, index) => {
        const chip = el('button', { type: 'button', class: 'chip' + (index === 0 ? ' on' : ''), text: choice.text });
        chip.addEventListener('click', () => {
            dueDate.value = localDateValue(choice.date);
            dueTime.value = choice.time;
            for (const other of quick) other.classList.toggle('on', other === chip);
        });
        return chip;
    });
    const clearQuick = () => { for (const chip of quick) chip.classList.remove('on'); };
    dueDate.addEventListener('change', clearQuick);
    dueTime.addEventListener('change', clearQuick);

    const section = el('fieldset', { class: 'next-fu fu-later' }, [
        el('legend', { text: 'إلى متى نؤجّلها؟' }),
        el('div', { class: 'next-fu-quick' }, quick),
        el('div', { class: 'next-fu-grid fu-later-grid' }, [
            field('التاريخ', dueDate, { required: true }),
            field('الوقت', dueTime, { required: true }),
            field('ملاحظة (اختياري)', note)
        ])
    ]);
    section.hidden = true;

    function setActive(active) {
        for (const control of [dueDate, dueTime, note]) control.disabled = !active;
    }
    return { section, dueDate, dueTime, note, setActive };
}

// ساعة الموعد الأصلي بصيغة hh:mm، أو العاشرة صباحاً إن لم يكن له موعد صالح
function dueHour(followUp) {
    const due = followUp.due_at ? new Date(followUp.due_at) : null;
    return due && !Number.isNaN(due.getTime()) ? pad2(due.getHours()) + ':' + pad2(due.getMinutes()) : '10:00';
}

// قسم «متى المتابعة التالية؟» في نافذة «تم»: الافتراضي غداً بساعة الموعد الحالي وقناته وغرضه.
// payload() تعيد null إن أُلغي القسم، أو { error } إن كان الموعد ناقصاً أو فائتاً.
function nextFollowUpFields(followUp) {
    const hour = dueHour(followUp);
    const enabled = el('input', { type: 'checkbox', checked: true });
    const toggle = el('label', { class: 'chip on next-fu-toggle' }, [enabled, 'أضف متابعة تالية']);
    const dueDate = input({ type: 'date', required: true, value: localDateValue(daysFromToday(1)) });
    const dueTime = input({ type: 'time', required: true, value: hour });
    const channel = select(optionList(CHANNEL), followUp.channel || 'call');
    const purpose = input({ maxLength: 200, value: followUp.purpose || '', placeholder: 'مثال: متابعة عرض السلامة' });

    const quick = [[1, 'غداً'], [3, 'بعد 3 أيام'], [7, 'بعد أسبوع']].map(([days, text]) => {
        const chip = el('button', { type: 'button', class: 'chip' + (days === 1 ? ' on' : ''), text: text });
        chip.addEventListener('click', () => {
            dueDate.value = localDateValue(daysFromToday(days));
            for (const other of quick) other.classList.toggle('on', other === chip);
        });
        return chip;
    });
    dueDate.addEventListener('change', () => { for (const chip of quick) chip.classList.remove('on'); });

    // التبديل والأيام السريعة في سطر واحد، والحقول الأربعة في شبكة مضغوطة، حتى يظهر «تأكيد الإنجاز» بلا تمرير
    const quickRow = el('div', { class: 'next-fu-quick' }, quick);
    const grid = el('div', { class: 'next-fu-grid' }, [
        field('التاريخ', dueDate, { required: true }),
        field('الوقت', dueTime, { required: true }),
        field('القناة', channel),
        field('الغرض', purpose)
    ]);
    // الحقول المعطّلة لا تدخل في تحقق النموذج، فإلغاء القسم لا يوقف «تأكيد الإنجاز» بحقل مخفي فارغ
    enabled.addEventListener('change', () => {
        toggle.classList.toggle('on', enabled.checked);
        quickRow.hidden = !enabled.checked;
        grid.hidden = !enabled.checked;
        for (const control of [dueDate, dueTime, channel, purpose]) control.disabled = !enabled.checked;
    });

    const section = el('fieldset', { class: 'next-fu' }, [
        el('legend', { text: 'متى المتابعة التالية؟' }),
        el('div', { class: 'next-fu-head' }, [toggle, quickRow]),
        grid
    ]);

    // setActive(false) حين يختار الموظف «لم يرد»: يُعطَّل القسم كله، ويعود كما تركه العلم عند الرجوع
    function setActive(active) {
        enabled.disabled = !active;
        for (const control of [dueDate, dueTime, channel, purpose]) control.disabled = !active || !enabled.checked;
    }

    function payload() {
        if (!enabled.checked) return null;
        const dueAt = toLocalISO(dueDate.value, dueTime.value);
        if (!dueAt) return { error: 'حدّد تاريخ ووقت المتابعة التالية' };
        if (Date.parse(dueAt) < Date.now() - 60000) return { error: 'موعد المتابعة التالية فات — اختر موعداً قادماً' };
        const row = {
            client_id: followUp.client_id,
            due_at: dueAt,
            channel: channel.value,
            purpose: purpose.value.trim() || null,
            requirement_id: followUp.requirement_id || null
        };
        // المدير ومركز الاتصال يبقيان التالية عند المكلَّف نفسه؛ الوسيط يفرضه الخادم على نفسه
        if (canAssign() && followUp.assigned_to) row.assigned_to = followUp.assigned_to;
        return row;
    }

    return { section, payload, setActive };
}

function daysFromToday(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

const pad2 = (n) => String(n).padStart(2, '0');

function localDateValue(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}
