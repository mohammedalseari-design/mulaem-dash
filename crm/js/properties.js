// ‎#/properties‎ — تصفّح المخزون من داخل الـCRM. قراءة فقط.
//
// المصدر عرض ‎v_units‎ (security_invoker)، فما لا تسمح به سياسات projects لا يظهر
// هنا: صفٌّ لكل نموذج وحدة، وصفٌّ واحد ‎'كامل العقار'‎ للمشاريع بلا نماذج.
//
// لا تعديل من هذه الصفحة: المخزون يُحرَّر في اللوحة القديمة (‎../index.html‎)، وهذه
// نافذة عليه فقط حتى لا يخرج الموظف من الـCRM ليرى العقارات. الصفحة لكل الأدوار،
// وزر "فتح صفقة" وحده مخفي عن مركز الاتصال (والقاعدة ترفضه أصلاً).

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { inventoryVocabulary, sanitizeSearch } from './data.js';
import { myRole } from './auth.js';
import { openDealForm } from './deal-form.js';
import { UNIT_STATUS, UNIT_STATUS_TONE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, input, select,
    moneyInput, parseNumber, money, number, dash, notify, fail
} from './ui.js';

export async function renderProperties(root) {
    const view = {
        page: 0, search: '', district: '', unitType: '',
        rooms: '', priceMin: '', priceMax: '', availableOnly: true
    };

    const body = el('div', {}, loading());
    const toolbar = el('div', { class: 'crm-toolbar' });

    replace(root, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'العقارات' })]),
        el('div', { class: 'crm-subtle', style: 'margin-bottom:14px' }, [
            document.createTextNode('التعديل على العقارات يتم من اللوحة '),
            el('a', { href: '../index.html', text: 'افتح اللوحة' })
        ]),
        toolbar,
        body
    ]));

    // لا ترمي هذه الدالة أبداً؛ الفشل يصل في ‎*Error‎ فيتحوّل الحقل إلى نص حر
    const vocabulary = await inventoryVocabulary();
    if (!root.isConnected) return;

    const searchBox = el('input', {
        type: 'search', class: 'crm-search', placeholder: 'ابحث باسم العقار…', autocomplete: 'off'
    });
    const districtField = vocabFilter(vocabulary.districts, vocabulary.districtsError, 'كل الأحياء', 'الحي');
    const typeField = vocabFilter(vocabulary.propertyTypes, vocabulary.propertyTypesError, 'كل الأنواع', 'نوع الوحدة');
    const roomsBox = input({
        class: 'crm-filter-num', inputMode: 'numeric', autocomplete: 'off', placeholder: 'غرف ≥'
    });
    const priceMinBox = moneyInput({ class: 'crm-money crm-filter-num', placeholder: 'السعر من' });
    const priceMaxBox = moneyInput({ class: 'crm-money crm-filter-num', placeholder: 'إلى' });
    const availableBox = el('input', { type: 'checkbox', checked: true });
    const availableChip = el('label', { class: 'chip on' }, [availableBox, 'المتاح فقط']);

    // البحث بالكتابة وحده مؤجَّل؛ بقية الحقول تُطلق الاستعلام عند تغيّرها فعلاً
    // (‎change‎ لا ‎input‎)، فلا يُستعلم عند كل ضغطة في حقول الأرقام.
    let debounce = null;
    searchBox.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { view.search = searchBox.value; reload(); }, 300);
    });
    districtField.node.addEventListener('change', () => { view.district = districtField.node.value.trim(); reload(); });
    typeField.node.addEventListener('change', () => { view.unitType = typeField.node.value.trim(); reload(); });
    roomsBox.addEventListener('change', () => { view.rooms = roomsBox.value; reload(); });
    priceMinBox.addEventListener('change', () => { view.priceMin = priceMinBox.value; reload(); });
    priceMaxBox.addEventListener('change', () => { view.priceMax = priceMaxBox.value; reload(); });
    availableBox.addEventListener('change', () => {
        view.availableOnly = availableBox.checked;
        availableChip.classList.toggle('on', availableBox.checked);
        reload();
    });

    replace(toolbar, [
        searchBox, districtField.node, typeField.node,
        roomsBox, priceMinBox, priceMaxBox, availableChip
    ]);

    function reload() {
        view.page = 0;
        load();
    }

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('v_units')
            .select(
                'project_id, project_name, unit_ord, unit_key, unit_type, district, district_inferred,'
                + ' rooms, bathrooms, area, price, construction_status, unit_status',
                { count: 'exact' }
            )
            // ‎project_id‎ بين الاسم والترتيب: مشروعان باسم واحد لا يتداخلان بين الصفحات
            .order('project_name', { ascending: true })
            .order('project_id', { ascending: true })
            .order('unit_ord', { ascending: true })
            .range(from, to);

        // "المتاح فقط": وحدة متاحة في عرضٍ متاح معتمد وغير محذوف — أربعة شروط معاً
        if (view.availableOnly) {
            query = query
                .eq('unit_status', 'available')
                .eq('availability', 'available')
                .eq('status', 'approved')
                .is('deleted_at', null);
        }

        const term = sanitizeSearch(view.search);
        if (term) query = query.ilike('project_name', '%' + term + '%');
        if (view.district) query = districtField.filter(query, 'district', view.district);
        if (view.unitType) query = typeField.filter(query, 'unit_type', view.unitType);

        const rooms = parseNumber(view.rooms);
        if (rooms !== null) query = query.gte('rooms', rooms);
        const priceMin = parseNumber(view.priceMin);
        if (priceMin !== null) query = query.gte('price', priceMin);
        const priceMax = parseNumber(view.priceMax);
        if (priceMax !== null) query = query.lte('price', priceMax);

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العقارات'));

        const rows = data || [];
        if (rows.length === 0) {
            return void replace(body, empty(filtered(view) ? 'لا وحدات مطابقة لهذا البحث' : 'لا توجد عقارات'));
        }

        const total = count === null || count === undefined ? rows.length : count;
        replace(body, [
            el('div', { class: 'crm-subtle', style: 'margin-bottom:12px', text: number(total) + ' وحدة' }),
            el('div', { class: 'crm-table-wrap' }, table(rows)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function filtered(view) {
    return Boolean(view.search || view.district || view.unitType || view.rooms || view.priceMin || view.priceMax);
}

// مفردة تعذّر جلبها لا تقفل المرشّح: يصير الحقل نصاً حراً و ‎ilike‎ بدل المطابقة التامة.
function vocabFilter(values, error, allLabel, freePlaceholder) {
    if (error) {
        return {
            node: input({ placeholder: freePlaceholder, autocomplete: 'off' }),
            filter: (query, column, value) => query.ilike(column, '%' + sanitizeSearch(value) + '%')
        };
    }
    return {
        node: select([{ value: '', label: allLabel }].concat(values.map((v) => ({ value: v, label: v }))), ''),
        filter: (query, column, value) => query.eq(column, value)
    };
}

/* ===================== الجدول ===================== */

function table(rows) {
    // مركز الاتصال لا صفقات له، فالزر لا يُبنى له أصلاً
    const dealAllowed = myRole() !== 'callcenter';

    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العقار' }),
        el('th', { text: 'الوحدة' }),
        el('th', { text: 'النوع' }),
        el('th', { text: 'الحي' }),
        el('th', { text: 'الغرف' }),
        el('th', { text: 'دورات المياه' }),
        el('th', { text: 'المساحة' }),
        el('th', { text: 'السعر' }),
        el('th', { text: 'حالة البناء' }),
        el('th', { text: 'حالة الوحدة' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', {}, el('div', {}, [
                el('strong', { text: dash(row.project_name) }),
                el('div', { class: 'crm-subtle', text: 'رقم ' + dash(row.project_id) })
            ])),
            el('td', { text: dash(row.unit_key) }),
            el('td', { text: dash(row.unit_type) }),
            el('td', {}, [
                document.createTextNode(dash(row.district)),
                row.district_inferred ? document.createTextNode(' ') : null,
                row.district_inferred ? badge('مستنتج', 'orange') : null
            ]),
            el('td', { class: 'num', text: number(row.rooms) }),
            el('td', { class: 'num', text: number(row.bathrooms) }),
            el('td', { class: 'num', text: number(row.area) }),
            el('td', { class: 'num', text: money(row.price) }),
            el('td', { text: dash(row.construction_status) }),
            el('td', {}, badge(label(UNIT_STATUS, row.unit_status), UNIT_STATUS_TONE[row.unit_status] || 'neutral')),
            el('td', { class: 'cell-actions' }, rowActions(row, dealAllowed))
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

function rowActions(row, dealAllowed) {
    const copyBtn = el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'نسخ الوصف' });
    copyBtn.addEventListener('click', () => copyDescription(copyBtn, row));

    // ‎unit_ord = 0‎ هو صفّ "كامل العقار" الاصطناعي، لا وحدة حقيقية، فلا يُملأ به unit_key
    const dealBtn = dealAllowed
        ? el('button', {
            type: 'button', class: 'btn btn-secondary btn-xs', text: 'فتح صفقة',
            onclick: () => openDealForm(null, {
                project_id: row.project_id,
                unit_key: row.unit_ord > 0 ? row.unit_key : null
            }, (deal) => { location.hash = '#/deals/' + deal.id; })
        })
        : null;

    return el('div', { class: 'btn-row' }, [dealBtn, copyBtn]);
}

/* ===================== نسخ الوصف ===================== */

// نص عربي قصير للصف يُلصق في أي محادثة. بلا تكامل مراسلة: الحافظة وحدها.
function describe(row) {
    const title = dash(row.project_name) + (row.unit_ord > 0 ? ' — ' + dash(row.unit_key) : '');
    const facts = [];
    if (row.rooms !== null && row.rooms !== undefined) facts.push('الغرف: ' + number(row.rooms));
    if (row.area !== null && row.area !== undefined) facts.push('المساحة: ' + number(row.area) + ' م²');
    if (row.price !== null && row.price !== undefined) facts.push('السعر: ' + money(row.price) + ' ريال');

    const lines = [title];
    if (row.district) lines.push('الحي: ' + row.district);
    if (facts.length) lines.push(facts.join(' · '));
    return lines.join('\n');
}

async function copyDescription(button, row) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return void notify('النسخ إلى الحافظة غير متاح في هذا المتصفح', 'error', 8000);
    }
    button.disabled = true;
    try {
        await navigator.clipboard.writeText(describe(row));
        notify('نُسخ وصف الوحدة', 'success');
    } catch (error) {
        fail(error, 'تعذّر النسخ إلى الحافظة');
    } finally {
        button.disabled = false;
    }
}
