// نموذج العميل (إنشاء/تعديل) داخل نافذة منبثقة.
//
// ما لا يُرسل أبداً: created_by — الخادم يحدده من هوية الحساب.
// owner_id يُرسل فقط ممن يملك الإسناد (مدير/مركز اتصال)؛ الوسيط يملك ما ينشئه تلقائياً.

import { supabase } from './supabase.js';
import { canAssign, isAdmin } from './auth.js';
import { defaultCity, fieldStaff, normalizePhone } from './data.js';
import { CLIENT_SOURCES, CLIENT_STATUS, CLIENT_TYPE } from './labels.js';
import {
    el, append, clear, field, input, select, optionList, openModal, closeModal,
    notify, fail, errorText
} from './ui.js';

export async function openClientForm(client, onSaved) {
    const editing = Boolean(client);
    let staffOptions = [];
    let city = client ? (client.city || '') : '';

    try {
        if (canAssign()) {
            staffOptions = (await fieldStaff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        }
        if (!editing) city = await defaultCity();
    } catch (error) {
        return fail(error, 'تعذّر تحضير النموذج');
    }

    const notice = el('div', { class: 'crm-hidden' });

    const fullName = input({ value: client ? client.full_name : '', required: true, maxLength: 120 });
    const phone = input({ type: 'tel', value: client ? client.phone : '', required: true, dir: 'ltr', placeholder: '05xxxxxxxx' });
    const phoneAlt = input({ type: 'tel', value: client && client.phone_alt ? client.phone_alt : '', dir: 'ltr' });
    const email = input({ type: 'email', value: client && client.email ? client.email : '', dir: 'ltr' });
    const cityInput = input({ value: city });
    const notes = el('textarea', { value: client && client.notes ? client.notes : '', rows: 3 });

    const source = select(
        [{ value: '', label: 'غير محدد' }].concat(CLIENT_SOURCES.map((s) => ({ value: s, label: s }))),
        client ? client.source : ''
    );
    const clientType = select(optionList(CLIENT_TYPE, 'غير محدد'), client ? client.client_type : '');
    const status = select(optionList(CLIENT_STATUS), client ? client.status : 'active');

    // الإسناد: المدير يغيّره متى شاء، ومركز الاتصال يسنده مرة واحدة فقط وهو فارغ.
    const ownerLocked = editing && !isAdmin() && Boolean(client.owner_id);
    const owner = select(
        [{ value: '', label: 'غير مُسند' }].concat(staffOptions),
        client ? (client.owner_id || '') : '',
        { disabled: ownerLocked }
    );

    const grid = el('div', { class: 'form-grid' }, [
        field('الاسم الكامل', fullName, { required: true }),
        field('رقم الجوال', phone, { required: true, hint: 'يُحفظ بصيغة ‎+966…‎ تلقائياً' }),
        field('جوال إضافي', phoneAlt),
        field('البريد الإلكتروني', email),
        field('المصدر', source),
        field('نوع العميل', clientType),
        field('المدينة', cityInput),
        editing ? field('الحالة', status) : null,
        canAssign() ? field('الوسيط المسؤول', owner, {
            hint: ownerLocked ? 'إعادة الإسناد للمدير فقط' : null
        }) : null,
        field('ملاحظات', notes, { span2: true })
    ]);

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: editing ? 'حفظ التعديل' : 'إضافة العميل' });
    const form = el('form', { class: 'crm-client-form' }, [
        notice,
        grid,
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!fullName.value.trim() || !phone.value.trim()) {
            notify('الاسم ورقم الجوال مطلوبان', 'error');
            return;
        }

        const payload = {
            full_name: fullName.value.trim(),
            phone: phone.value.trim(),
            phone_alt: phoneAlt.value.trim() || null,
            email: email.value.trim() || null,
            source: source.value || null,
            client_type: clientType.value || null,
            city: cityInput.value.trim() || null,
            notes: notes.value.trim() || null
        };
        if (editing) payload.status = status.value;
        if (canAssign() && !ownerLocked) payload.owner_id = owner.value || null;

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        clear(notice).className = 'crm-hidden';

        const query = editing
            ? supabase.from('clients').update(payload).eq('id', client.id)
            : supabase.from('clients').insert(payload);
        const { data, error } = await query.select('id, full_name, phone').single();

        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'حفظ التعديل' : 'إضافة العميل';

        if (error) {
            if (error.code === '23505') return showDuplicate(notice, payload.phone);
            return fail(error, 'تعذّر حفظ العميل');
        }

        closeModal();
        notify((editing ? 'تم حفظ التعديل' : 'تم إضافة العميل') + ' — الجوال: ' + data.phone, 'success', 6000);
        if (onSaved) onSaved(data);
    });

    openModal(editing ? 'تعديل بيانات العميل' : 'عميل جديد', form);
}

// 23505 = تكرار على clients_phone_uk. نعرض الرسالة ثم نبحث عن العميل بالرقم بعد تطبيعه.
async function showDuplicate(notice, rawPhone) {
    notify('العميل موجود مسبقاً', 'error', 8000);
    notice.className = 'crm-error';
    clear(notice);
    notice.appendChild(el('div', { text: 'العميل موجود مسبقاً' }));

    const normalized = await normalizePhone(rawPhone);
    const { data, error } = await supabase
        .from('clients')
        .select('id, full_name')
        .eq('phone', normalized)
        .maybeSingle();

    if (error) {
        notice.appendChild(el('div', { class: 'crm-subtle', text: 'تعذّر البحث عن العميل الموجود: ' + errorText(error) }));
        return;
    }
    if (!data) {
        notice.appendChild(el('div', {
            class: 'crm-subtle',
            text: 'الرقم ' + (normalized || rawPhone) + ' مسجّل لعميل يتبع وسيطاً آخر، ولا تملك صلاحية الاطلاع عليه.'
        }));
        return;
    }

    append(notice, [
        el('div', { class: 'crm-subtle', text: 'الرقم ' + (normalized || rawPhone) + ' مسجّل باسم: ' + data.full_name }),
        el('div', { class: 'btn-row', style: 'margin-top:10px' }, [
            el('button', {
                type: 'button', class: 'btn btn-secondary btn-xs', text: 'فتح ملف العميل',
                onclick: () => { closeModal(); location.hash = '#/clients/' + data.id; }
            })
        ])
    ]);
}
