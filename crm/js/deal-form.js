// نموذج "صفقة جديدة" داخل نافذة منبثقة.
//
// ما لا يُرسل أبداً: created_by و stage_id — الخادم يضع المنشئ، والمرحلة تبدأ 1 افتراضاً.
// broker_id يُرسل من المدير وحده؛ الوسيط يفرضه الخادم على نفسه، وإن تُرك فارغاً
// أخذه المشغّل من مالك العميل (deals_guard في 007_deals_commissions.sql).
//
// مركز الاتصال لا يرى هذا النموذج أصلاً: سياسة deals_insert تقتصر على admin/field.

import { supabase } from './supabase.js';
import { isAdmin } from './auth.js';
import { brokerStaff, sanitizeSearch } from './data.js';
import { PURPOSE, REQ_STATUS, label } from './labels.js';
import {
    el, clear, field, input, select, moneyInput, parseNumber,
    openModal, closeModal, notify, fail, dash
} from './ui.js';

const PROJECT_LIMIT = 25;

// preset: { requirement_id, project_id, unit_key } — تأتي من صف مطابقة
export async function openDealForm(client, preset, onSaved) {
    const seed = preset || {};
    let brokerOptions = [];
    let requirementOptions = [];
    let presetProject = null;

    try {
        if (isAdmin()) {
            brokerOptions = (await brokerStaff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        }
        // منتقي الطلبات: أحدث 25 طلباً لهذا العميل، لا الجدول كاملاً
        const { data, error } = await supabase
            .from('client_requirements')
            .select('id, purpose, property_type, status')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false })
            .range(0, 24);
        if (error) throw error;
        requirementOptions = (data || []).map((r) => ({
            value: r.id,
            label: label(PURPOSE, r.purpose) + ' — ' + dash(r.property_type) + ' (' + label(REQ_STATUS, r.status) + ')'
        }));

        // العقار المُمرَّر من صف المطابقة: نقرأ اسمه ليظهر في القائمة مختاراً
        if (seed.project_id) {
            const { data: project, error: projectError } = await supabase
                .from('projects')
                .select('id, name, district')
                .eq('id', seed.project_id)
                .maybeSingle();
            if (projectError) throw projectError;
            presetProject = project || { id: seed.project_id, name: 'عقار رقم ' + seed.project_id, district: null };
        }
    } catch (error) {
        return fail(error, 'تعذّر تحضير النموذج');
    }

    const requirement = select(
        [{ value: '', label: 'بدون طلب محدد' }].concat(requirementOptions),
        seed.requirement_id || ''
    );

    const projectSearch = input({ placeholder: 'ابحث باسم العقار…', autocomplete: 'off' });
    const projectSelect = select(
        [{ value: '', label: 'بدون عقار محدد' }].concat(presetProject ? [projectOption(presetProject)] : []),
        presetProject ? String(presetProject.id) : ''
    );

    // البحث على الخادم دائماً وبسقف صفحة واحدة: جدول العقارات بالآلاف ولا يُحمَّل هنا
    let debounce = null;
    projectSearch.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(searchProjects, 300);
    });

    async function searchProjects() {
        const term = sanitizeSearch(projectSearch.value);
        if (!term) return;

        let query = supabase
            .from('projects')
            .select('id, name, district')
            .is('deleted_at', null)
            .order('id', { ascending: false })
            .range(0, PROJECT_LIMIT - 1);
        query = /^\d+$/.test(term) ? query.eq('id', Number(term)) : query.ilike('name', '%' + term + '%');

        const { data, error } = await query;
        if (!projectSelect.isConnected) return;
        if (error) return void fail(error, 'تعذّر البحث عن العقارات');

        // الاختيار الحالي يبقى ضمن الخيارات وإلا أفرغه المتصفح وضاع العقار المختار
        const current = projectSelect.value;
        const currentLabel = current ? optionLabel(projectSelect, current) : '';
        const options = [{ value: '', label: 'بدون عقار محدد' }];
        let hasCurrent = false;
        for (const row of data || []) {
            if (String(row.id) === current) hasCurrent = true;
            options.push(projectOption(row));
        }
        if (current && !hasCurrent) options.push({ value: current, label: currentLabel });

        clear(projectSelect);
        for (const option of options) projectSelect.appendChild(el('option', { value: option.value, text: option.label }));
        projectSelect.value = current;
        if (!data || data.length === 0) notify('لا عقارات مطابقة لهذا البحث', 'info');
    }

    const unitKey = input({
        value: seed.unit_key || '', maxLength: 120, placeholder: 'اسم الوحدة أو رقمها (اختياري)'
    });
    const amount = moneyInput({ value: seed.amount || '' });
    const expectedClose = input({ type: 'date' });
    const broker = select([{ value: '', label: 'حسب مالك العميل' }].concat(brokerOptions), '');

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'فتح الصفقة' });
    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('الطلب المرتبط', requirement),
            field('الوحدة', unitKey),
            field('العقار', el('div', { class: 'crm-picker' }, [projectSearch, projectSelect]),
                { span2: true, hint: 'اكتب اسم العقار أو رقمه ثم اختره من القائمة' }),
            field('قيمة الصفقة (ريال)', amount, { hint: 'تُستعمل أساساً لاحتساب العمولة عند الإتمام' }),
            field('الإغلاق المتوقع', expectedClose),
            isAdmin() ? field('الوسيط', broker) : null
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const payload = {
            client_id: client.id,
            requirement_id: requirement.value || null,
            project_id: projectSelect.value ? Number(projectSelect.value) : null,
            unit_key: unitKey.value.trim() || null,
            amount: parseNumber(amount.value),
            expected_close_date: expectedClose.value || null
        };
        if (isAdmin() && broker.value) payload.broker_id = broker.value;

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { data, error } = await supabase.from('deals').insert(payload).select('id').maybeSingle();
        saveBtn.disabled = false;
        saveBtn.textContent = 'فتح الصفقة';

        if (error) return void fail(error, 'تعذّر فتح الصفقة');
        // صفر صفوف بلا خطأ = RLS رشّحت الصف
        if (!data) return void notify('لا تملك صلاحية فتح صفقة لهذا العميل', 'error', 8000);

        closeModal();
        notify('تم فتح الصفقة', 'success');
        if (onSaved) onSaved(data);
    });

    openModal('صفقة جديدة — ' + client.full_name, form);
}

function projectOption(row) {
    const parts = [dash(row.name)];
    if (row.district) parts.push(row.district);
    return { value: String(row.id), label: parts.join(' — ') + ' (رقم ' + row.id + ')' };
}

function optionLabel(node, value) {
    for (const option of node.options) {
        if (option.value === value) return option.textContent;
    }
    return value;
}
