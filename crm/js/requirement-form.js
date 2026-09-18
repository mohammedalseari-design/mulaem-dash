// نموذج طلب العميل (إنشاء/تعديل).
//
// ما لا يُرسل أبداً: owner_id، created_by، city — الخادم يشتقّها من العميل ومن هوية الحساب
// (مشغّل requirements_guard في 005_crm_core.sql).

import { supabase } from './supabase.js';
import { inventoryVocabulary } from './data.js';
import { PURPOSE, REQ_STATUS, PRIORITY, FINANCING } from './labels.js';
import {
    el, field, input, select, optionList, moneyInput, parseNumber,
    openModal, closeModal, notify, fail
} from './ui.js';

export async function openRequirementForm(client, requirement, onSaved) {
    const editing = Boolean(requirement);
    let vocabulary;
    try {
        vocabulary = await inventoryVocabulary();
    } catch (error) {
        return fail(error, 'تعذّر تحميل مفردات المخزون');
    }

    const purpose = select(optionList(PURPOSE), requirement ? requirement.purpose : 'sale');
    const propertyType = select(
        [{ value: '', label: 'اختر النوع' }].concat(vocabulary.propertyTypes.map((t) => ({ value: t, label: t }))),
        requirement ? requirement.property_type : '',
        { required: true }
    );
    // نوع مسجّل على طلب قديم لم يعد موجوداً في المخزون: نضيفه حتى لا تضيع القيمة
    if (editing && requirement.property_type && propertyType.value !== requirement.property_type) {
        propertyType.appendChild(el('option', { value: requirement.property_type, text: requirement.property_type }));
        propertyType.value = requirement.property_type;
    }

    const chosen = new Set(requirement && requirement.districts ? requirement.districts : []);
    const districtsBox = el('div', { class: 'chips' });
    const allDistricts = [...new Set(vocabulary.districts.concat([...chosen]))];
    for (const name of allDistricts) {
        const box = el('input', { type: 'checkbox', value: name, checked: chosen.has(name) });
        const chip = el('label', { class: 'chip' + (chosen.has(name) ? ' on' : '') }, [box, name]);
        box.addEventListener('change', () => {
            if (box.checked) chosen.add(name); else chosen.delete(name);
            chip.classList.toggle('on', box.checked);
        });
        districtsBox.appendChild(chip);
    }
    if (allDistricts.length === 0) districtsBox.appendChild(el('span', { class: 'crm-subtle', text: 'لا توجد أحياء في المخزون' }));

    const budgetMin = moneyInput({ value: requirement && requirement.budget_min ? requirement.budget_min : '' });
    const budgetMax = moneyInput({ value: requirement && requirement.budget_max ? requirement.budget_max : '' });
    const areaMin = input({ type: 'number', min: '0', step: '0.5', value: requirement && requirement.area_min ? requirement.area_min : '' });
    const areaMax = input({ type: 'number', min: '0', step: '0.5', value: requirement && requirement.area_max ? requirement.area_max : '' });
    const roomsMin = input({ type: 'number', min: '0', step: '1', value: requirement && requirement.rooms_min !== null && requirement.rooms_min !== undefined ? requirement.rooms_min : '' });
    const deliveryBefore = input({ type: 'date', value: requirement && requirement.delivery_before ? requirement.delivery_before : '' });
    const financing = select(
        [{ value: '', label: 'غير محدد' }].concat(FINANCING.map((f) => ({ value: f, label: f }))),
        requirement ? requirement.financing_type : ''
    );
    const priority = select(optionList(PRIORITY), requirement ? String(requirement.priority) : '2');
    const status = select(optionList(REQ_STATUS), requirement ? requirement.status : 'open');
    const closedReason = input({ value: requirement && requirement.closed_reason ? requirement.closed_reason : '' });
    const notes = el('textarea', { value: requirement && requirement.notes ? requirement.notes : '', rows: 3 });

    const grid = el('div', { class: 'form-grid' }, [
        field('الغرض', purpose, { required: true }),
        field('نوع العقار', propertyType, { required: true }),
        field('الأولوية', priority),
        editing ? field('الحالة', status) : null,
        field('الأحياء المطلوبة', districtsBox, { span2: true, hint: 'اتركها فارغة لقبول كل الأحياء' }),
        field('الميزانية من (ريال)', budgetMin),
        field('الميزانية إلى (ريال)', budgetMax),
        field('المساحة من (م²)', areaMin),
        field('المساحة إلى (م²)', areaMax),
        field('أقل عدد غرف', roomsMin),
        field('التسليم قبل', deliveryBefore),
        field('طريقة التمويل', financing),
        editing ? field('سبب الإغلاق', closedReason) : null,
        field('ملاحظات', notes, { span2: true })
    ]);

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: editing ? 'حفظ التعديل' : 'إضافة الطلب' });
    const form = el('form', {}, [
        grid,
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!propertyType.value) return void notify('اختر نوع العقار', 'error');

        const bMin = parseNumber(budgetMin.value);
        const bMax = parseNumber(budgetMax.value);
        const aMin = parseNumber(areaMin.value);
        const aMax = parseNumber(areaMax.value);
        if (bMin !== null && bMax !== null && bMin > bMax) return void notify('الميزانية الدنيا أكبر من العليا', 'error');
        if (aMin !== null && aMax !== null && aMin > aMax) return void notify('المساحة الدنيا أكبر من العليا', 'error');

        const payload = {
            purpose: purpose.value,
            property_type: propertyType.value,
            districts: [...chosen],
            budget_min: bMin,
            budget_max: bMax,
            area_min: aMin,
            area_max: aMax,
            rooms_min: parseNumber(roomsMin.value),
            delivery_before: deliveryBefore.value || null,
            financing_type: financing.value || null,
            priority: Number(priority.value),
            notes: notes.value.trim() || null
        };
        if (editing) {
            payload.status = status.value;
            payload.closed_reason = closedReason.value.trim() || null;
        } else {
            payload.client_id = client.id;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';

        const query = editing
            ? supabase.from('client_requirements').update(payload).eq('id', requirement.id)
            : supabase.from('client_requirements').insert(payload);
        const { data, error } = await query.select('id').single();

        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'حفظ التعديل' : 'إضافة الطلب';
        if (error) return void fail(error, 'تعذّر حفظ الطلب');

        closeModal();
        notify(editing ? 'تم حفظ الطلب' : 'تم إضافة الطلب', 'success');
        if (onSaved) onSaved(data);
    });

    openModal(editing ? 'تعديل الطلب' : 'طلب جديد', form);
}
