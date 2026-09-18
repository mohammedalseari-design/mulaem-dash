// نموذج "صفقة جديدة" داخل نافذة منبثقة.
//
// ما لا يُرسل أبداً: created_by و stage_id — الخادم يضع المنشئ، والمرحلة تبدأ 1 افتراضاً.
// broker_id يُرسل من المدير وحده؛ الوسيط يفرضه الخادم على نفسه، وإن تُرك فارغاً
// أخذه المشغّل من مالك العميل (deals_guard في 007_deals_commissions.sql).
//
// مركز الاتصال لا يرى هذا النموذج أصلاً: سياسة deals_insert تقتصر على admin/field.

import { supabase } from './supabase.js';
import { isAdmin } from './auth.js';
import { brokerStaff, sanitizeSearch, phoneNeedle } from './data.js';
import { PURPOSE, REQ_STATUS, label } from './labels.js';
import {
    el, clear, field, input, select, moneyInput, parseNumber,
    openModal, closeModal, notify, fail, dash
} from './ui.js';

const PROJECT_LIMIT = 25;
const CLIENT_LIMIT = 25;

// client: العميل حين يُفتح النموذج من ملفه أو من صف مطابقة، و null حين يُفتح من
// صفحة العقارات — وعندها يُضاف منتقي عميل يبحث في الخادم كما يبحث منتقي العقار.
// preset: { requirement_id, project_id, unit_key }
export async function openDealForm(client, preset, onSaved) {
    const seed = preset || {};
    const fixedClient = client || null;
    let brokerOptions = [];
    let requirementOptions = [];
    let presetProject = null;

    try {
        if (isAdmin()) {
            brokerOptions = (await brokerStaff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        }
        if (fixedClient) requirementOptions = await requirementsFor(fixedClient.id);

        // العقار المُمرَّر من صف المطابقة أو من صف وحدة: نقرأ اسمه ليظهر في القائمة مختاراً
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
        [NO_REQUIREMENT].concat(requirementOptions),
        seed.requirement_id || ''
    );

    // منتقي العميل: لا يُبنى إلا حين يُفتح النموذج بلا عميل، والطلبات تُعاد قراءتها
    // عند اختياره لأنها طلبات ذلك العميل وحده.
    const clientSearch = input({ placeholder: 'ابحث بالاسم أو رقم الجوال…', autocomplete: 'off' });
    const clientSelect = select([NO_CLIENT], '');
    let clientDebounce = null;
    clientSearch.addEventListener('input', () => {
        clearTimeout(clientDebounce);
        clientDebounce = setTimeout(searchClients, 300);
    });
    clientSelect.addEventListener('change', async () => {
        fillOptions(requirement, [NO_REQUIREMENT]);
        if (!clientSelect.value) return;
        try {
            fillOptions(requirement, [NO_REQUIREMENT].concat(await requirementsFor(clientSelect.value)));
        } catch (error) {
            fail(error, 'تعذّر تحميل طلبات العميل');
        }
    });

    async function searchClients() {
        const term = sanitizeSearch(clientSearch.value);
        if (!term) return;

        const needle = phoneNeedle(term) || term;
        const { data, error } = await supabase
            .from('clients')
            .select('id, full_name, phone')
            .or('full_name.ilike.%' + term + '%,phone.ilike.%' + needle + '%')
            .order('updated_at', { ascending: false })
            .range(0, CLIENT_LIMIT - 1);

        if (!clientSelect.isConnected) return;
        if (error) return void fail(error, 'تعذّر البحث عن العملاء');

        refill(clientSelect, NO_CLIENT, data || [], clientOption);
        if (!data || data.length === 0) notify('لا عملاء مطابقون لهذا البحث', 'info');
    }

    const projectSearch = input({ placeholder: 'ابحث باسم العقار…', autocomplete: 'off' });
    const projectSelect = select(
        [NO_PROJECT].concat(presetProject ? [projectOption(presetProject)] : []),
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

        refill(projectSelect, NO_PROJECT, data || [], projectOption);
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
            fixedClient ? null : field('العميل', el('div', { class: 'crm-picker' }, [clientSearch, clientSelect]),
                { span2: true, required: true, hint: 'اكتب اسم العميل أو رقم جواله ثم اختره من القائمة' }),
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

        const clientId = fixedClient ? fixedClient.id : clientSelect.value;
        if (!clientId) return void notify('اختر العميل أولاً', 'error', 6000);

        const payload = {
            client_id: clientId,
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

    openModal(fixedClient ? 'صفقة جديدة — ' + fixedClient.full_name : 'صفقة جديدة', form);
}

/* ===================== القوائم ===================== */

const NO_CLIENT = { value: '', label: 'اختر العميل' };
const NO_REQUIREMENT = { value: '', label: 'بدون طلب محدد' };
const NO_PROJECT = { value: '', label: 'بدون عقار محدد' };

// منتقي الطلبات: أحدث 25 طلباً لهذا العميل، لا الجدول كاملاً
async function requirementsFor(clientId) {
    const { data, error } = await supabase
        .from('client_requirements')
        .select('id, purpose, property_type, status')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(0, 24);
    if (error) throw error;
    return (data || []).map((r) => ({
        value: r.id,
        label: label(PURPOSE, r.purpose) + ' — ' + dash(r.property_type) + ' (' + label(REQ_STATUS, r.status) + ')'
    }));
}

function fillOptions(node, options) {
    clear(node);
    for (const option of options) node.appendChild(el('option', { value: option.value, text: option.label }));
}

// إعادة بناء خيارات منتقٍ بعد بحث جديد: الاختيار الحالي يبقى ضمن الخيارات وإلا
// أفرغه المتصفح فضاع ما اختاره المستخدم بلا إنذار.
function refill(node, placeholder, rows, toOption) {
    const current = node.value;
    const currentLabel = current ? optionLabel(node, current) : '';
    const options = [placeholder];
    let hasCurrent = false;
    for (const row of rows) {
        const option = toOption(row);
        if (option.value === current) hasCurrent = true;
        options.push(option);
    }
    if (current && !hasCurrent) options.push({ value: current, label: currentLabel });

    fillOptions(node, options);
    node.value = current;
}

function projectOption(row) {
    const parts = [dash(row.name)];
    if (row.district) parts.push(row.district);
    return { value: String(row.id), label: parts.join(' — ') + ' (رقم ' + row.id + ')' };
}

function clientOption(row) {
    return { value: String(row.id), label: dash(row.full_name) + (row.phone ? ' — ' + row.phone : '') };
}

function optionLabel(node, value) {
    for (const option of node.options) {
        if (option.value === value) return option.textContent;
    }
    return value;
}
