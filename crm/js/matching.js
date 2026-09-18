// ‎#/clients/:id/requirements/:rid‎ — مطابقة الطلب بالمخزون.
//
// الحساب كله في قاعدة البيانات: match_requirement دالة security invoker، فالوسيط
// لا يُطابق إلا على عقار يحق له رؤيته أصلاً، والأوزان تأتي من crm_settings بلا نشر.
// لا يُحفظ من النتائج إلا ما تُصرَّف فيه فعلاً (property_matches).

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import {
    MATCH_STATE, MATCH_STATE_TONE, PURPOSE, REQ_STATUS, REQ_STATUS_TONE,
    PRIORITY, PRIORITY_TONE, label, scoreLabel
} from './labels.js';
import {
    el, replace, clear, loading, empty, errorBox, badge, pager, money, number,
    fmtDate, dash, notify, fail, input, EM_DASH
} from './ui.js';
import { districtsText, budgetText, rangeText, deliveryText } from './requirements.js';

const BREAKDOWN_AR = {
    district: 'الحي',
    budget: 'الميزانية',
    area: 'المساحة',
    rooms: 'الغرف',
    delivery: 'التسليم'
};

export async function renderRequirementMatches(root, clientId, requirementId) {
    replace(root, loading());

    const [{ data: requirement, error }, { data: client }] = await Promise.all([
        supabase.from('client_requirements').select('*').eq('id', requirementId).maybeSingle(),
        supabase.from('clients').select('id, full_name').eq('id', clientId).maybeSingle()
    ]);
    if (!root.isConnected) return;

    clear(root);
    if (error) return void root.appendChild(errorBox(error, 'تعذّر تحميل الطلب'));
    if (!requirement || requirement.client_id !== clientId) {
        root.appendChild(el('div', { class: 'crm-error', text: 'الطلب غير موجود أو لا تملك صلاحية الاطلاع عليه.' }));
        root.appendChild(el('div', { class: 'btn-row', style: 'margin-top:14px' },
            el('a', { class: 'btn btn-outline btn-sm', href: '#/clients/' + clientId, text: 'رجوع إلى العميل' })));
        return;
    }

    const resultsBody = el('div', {}, empty('اضغط "ابحث عن مطابقات" لعرض العقارات المناسبة'));
    const savedBody = el('div');
    const searchBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'ابحث عن مطابقات' });

    replace(root, [
        summaryCard(requirement, client, clientId),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'نتائج المطابقة' }),
                searchBtn
            ]),
            resultsBody
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'المطابقات المحفوظة' })]),
            savedBody
        ])
    ]);

    const savedView = { page: 0 };

    async function loadSaved() {
        replace(savedBody, loading());
        const [from, to] = pageRange(savedView.page);
        const { data, error: savedError, count } = await supabase
            .from('property_matches')
            .select('id, project_id, unit_key, score, state, note, updated_at, project:projects(name, district)',
                { count: 'exact' })
            .eq('requirement_id', requirementId)
            .order('updated_at', { ascending: false })
            .range(from, to);

        if (!savedBody.isConnected) return;
        if (savedError) return void replace(savedBody, errorBox(savedError, 'تعذّر تحميل المطابقات المحفوظة'));

        if (!data || data.length === 0) {
            return void replace(savedBody, empty('لم تُحفظ أي مطابقة لهذا الطلب بعد'));
        }

        replace(savedBody, [
            el('div', { class: 'crm-table-wrap' }, savedTable(data, refreshAll)),
            pager(savedView.page, count || data.length, (p) => { savedView.page = p; loadSaved(); }, PAGE_SIZE)
        ]);
    }

    async function search() {
        searchBtn.disabled = true;
        searchBtn.textContent = 'جارٍ البحث…';
        replace(resultsBody, loading('جارٍ مطابقة الطلب بالمخزون'));

        const { data, error: rpcError } = await supabase.rpc('match_requirement', { p_requirement: requirementId });

        searchBtn.disabled = false;
        searchBtn.textContent = 'ابحث عن مطابقات';
        if (!resultsBody.isConnected) return;
        if (rpcError) return void replace(resultsBody, errorBox(rpcError, 'تعذّر تنفيذ المطابقة'));
        if (!data || data.length === 0) {
            return void replace(resultsBody, empty('لا توجد عقارات مطابقة لهذا الطلب حالياً'));
        }

        replace(resultsBody, [
            el('div', { class: 'crm-subtle', style: 'margin-bottom:12px', text: data.length + ' نتيجة، مرتبة تنازلياً حسب الدرجة' }),
            el('div', { class: 'crm-table-wrap' }, resultsTable(data, requirementId, refreshAll))
        ]);
    }

    async function refreshAll() {
        await loadSaved();
        if (resultsBody.isConnected && resultsBody.querySelector('table')) await search();
    }

    searchBtn.addEventListener('click', search);
    await loadSaved();
}

/* ===================== ملخّص الطلب ===================== */

function summaryCard(requirement, client, clientId) {
    const kv = (title, value) => el('div', { class: 'kv' }, [
        el('span', { text: title }),
        el('span', {}, value instanceof Node ? value : document.createTextNode(dash(value)))
    ]);

    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'client-head' }, [
            el('div', {}, [
                el('h2', { text: 'طلب: ' + dash(requirement.property_type) + ' — ' + label(PURPOSE, requirement.purpose) }),
                el('div', { class: 'btn-row' }, [
                    badge(label(REQ_STATUS, requirement.status), REQ_STATUS_TONE[requirement.status] || 'neutral'),
                    badge('أولوية ' + label(PRIORITY, requirement.priority), PRIORITY_TONE[requirement.priority] || 'neutral'),
                    client ? badge(client.full_name, 'neutral') : null
                ])
            ]),
            el('a', { class: 'btn btn-outline btn-sm', href: '#/clients/' + clientId, text: 'رجوع إلى العميل' })
        ]),
        el('div', { class: 'kv-grid' }, [
            kv('المدينة', requirement.city),
            kv('الأحياء', districtsText(requirement.districts)),
            kv('الميزانية', budgetText(requirement)),
            kv('المساحة', rangeText(requirement.area_min, requirement.area_max, 'م²')),
            kv('أقل عدد غرف', requirement.rooms_min === null || requirement.rooms_min === undefined ? EM_DASH : String(requirement.rooms_min)),
            kv('التسليم', deliveryText(requirement.delivery_before)),
            kv('التمويل', requirement.financing_type)
        ]),
        requirement.notes
            ? el('div', { class: 'kv', style: 'margin-top:16px' }, [
                el('span', { text: 'ملاحظات' }),
                el('span', { class: 'tl-body', text: requirement.notes })
            ])
            : null
    ]);
}

/* ===================== نتائج المطابقة ===================== */

function resultsTable(rows, requirementId, onChanged) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العقار' }),
        el('th', { text: 'الوحدة' }),
        el('th', { text: 'الحي' }),
        el('th', { text: 'السعر' }),
        el('th', { text: 'المساحة' }),
        el('th', { text: 'الغرف' }),
        el('th', { text: 'حالة البناء' }),
        el('th', { text: 'الدرجة' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const shareBtn = el('button', {
            type: 'button', class: 'btn btn-secondary btn-xs', text: 'مشاركة مع العميل'
        });
        shareBtn.addEventListener('click', () => shareMatch(shareBtn, requirementId, row, onChanged));

        body.appendChild(el('tr', {}, [
            el('td', {}, el('strong', { text: dash(row.project_name) })),
            el('td', { text: dash(row.unit_key) }),
            el('td', {}, [
                document.createTextNode(dash(row.district)),
                row.district_inferred ? document.createTextNode(' ') : null,
                row.district_inferred ? badge('الحي مستنتج', 'orange') : null
            ]),
            el('td', { class: 'num', text: money(row.price) }),
            el('td', { class: 'num', text: number(row.area) }),
            el('td', { class: 'num', text: number(row.rooms) }),
            el('td', { text: dash(row.construction_status) }),
            el('td', {}, scoreBadge(row.score, row.breakdown)),
            el('td', { class: 'cell-actions' }, shareBtn)
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

function scoreBadge(score, breakdown) {
    const info = scoreLabel(score);
    const node = badge(number(score) + ' · ' + info.text, info.tone);
    if (breakdown) {
        const parts = [];
        for (const key of Object.keys(BREAKDOWN_AR)) {
            if (breakdown[key] === null || breakdown[key] === undefined) continue;
            parts.push(BREAKDOWN_AR[key] + ': ' + Math.round(Number(breakdown[key]) * 100) + '%');
        }
        if (parts.length) node.setAttribute('title', parts.join(' | '));
    }
    return node;
}

// تُحفظ المطابقة عند التصرّف فيها فقط. التكرار (23505) يعني أن الصف موجود، فيُحدَّث.
async function shareMatch(button, requirementId, row, onChanged) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'جارٍ الحفظ…';

    const payload = {
        requirement_id: requirementId,
        project_id: row.project_id,
        unit_key: row.unit_key,
        score: row.score,
        score_breakdown: row.breakdown || {},
        state: 'shared'
    };
    const { error } = await supabase.from('property_matches').insert(payload);

    if (error && error.code === '23505') {
        const { error: updateError } = await unitFilter(
            supabase.from('property_matches')
                .update({ score: row.score, score_breakdown: row.breakdown || {}, state: 'shared' })
                .eq('requirement_id', requirementId)
                .eq('project_id', row.project_id),
            row.unit_key
        );
        button.disabled = false;
        button.textContent = original;
        if (updateError) return void fail(updateError, 'تعذّر تحديث المطابقة');
        notify('تم تحديث المطابقة المحفوظة', 'success');
        return void onChanged();
    }

    button.disabled = false;
    button.textContent = original;
    if (error) return void fail(error, 'تعذّر حفظ المطابقة');
    notify('تمت مشاركة العرض مع العميل', 'success');
    onChanged();
}

/* ===================== المطابقات المحفوظة ===================== */

const STATE_BUTTONS = [
    { state: 'interested', label: 'مهتم' },
    { state: 'not_interested', label: 'غير مهتم' },
    { state: 'viewing', label: 'معاينة' }
];

function savedTable(rows, onChanged) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العقار' }),
        el('th', { text: 'الوحدة' }),
        el('th', { text: 'الدرجة' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'ملاحظة' }),
        el('th', { text: 'آخر تحديث' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const noteBox = input({ value: row.note || '', placeholder: 'ملاحظة اختيارية', class: 'crm-note' });
        const buttons = el('div', { class: 'btn-row' });
        for (const option of STATE_BUTTONS) {
            const button = el('button', {
                type: 'button',
                class: 'btn btn-xs ' + (row.state === option.state ? 'btn-secondary' : 'btn-outline'),
                text: option.label
            });
            button.addEventListener('click', () => setState(button, row, option.state, noteBox.value, onChanged));
            buttons.appendChild(button);
        }

        body.appendChild(el('tr', {}, [
            el('td', {}, el('strong', { text: row.project ? dash(row.project.name) : 'عقار رقم ' + row.project_id })),
            el('td', { text: dash(row.unit_key) }),
            el('td', { class: 'num', text: number(row.score) }),
            el('td', {}, badge(label(MATCH_STATE, row.state), MATCH_STATE_TONE[row.state] || 'neutral')),
            el('td', {}, noteBox),
            el('td', { class: 'crm-subtle', text: fmtDate(row.updated_at) }),
            el('td', { class: 'cell-actions' }, buttons)
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

async function setState(button, row, state, note, onChanged) {
    button.disabled = true;
    const { error } = await supabase
        .from('property_matches')
        .update({ state: state, note: note.trim() || null })
        .eq('id', row.id);
    button.disabled = false;

    if (error) return void fail(error, 'تعذّر تحديث حالة المطابقة');
    notify('تم تحديث الحالة إلى: ' + label(MATCH_STATE, state), 'success');
    onChanged();
}

/* ===================== مساعدات ===================== */

// الفهرس الفريد يستخدم coalesce(unit_key,'')، فالقيمة الفارغة تُطابَق بـ is null
function unitFilter(query, unitKey) {
    return unitKey === null || unitKey === undefined
        ? query.is('unit_key', null)
        : query.eq('unit_key', unitKey);
}
