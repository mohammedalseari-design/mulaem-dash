// ‎#/properties‎ — تصفّح المخزون من داخل الـCRM. قراءة فقط، عدا عمولة المشروع للمدير.
//
// المصدر عرض ‎v_units‎ (security_invoker)، فما لا تسمح به سياسات projects لا يظهر
// هنا: صفٌّ لكل نموذج وحدة، وصفٌّ واحد ‎'كامل العقار'‎ للمشاريع بلا نماذج.
//
// المخزون يُحرَّر في اللوحة القديمة (‎../projects.html‎)، وهذه نافذة عليه حتى لا يخرج الموظف
// من الـCRM ليرى العقارات. الاستثناء الوحيد: المدير يضغط عمود «العمولة» فتُفتح «عمولة المشروع»
// (project-commission.js): نسبة المشروع ومبلغ محدد لأي نموذج (037).
// عمود العمولة ومرشّحاها لا يُرسمان لمن لا يرى العمولة (canSeeCommission)، والقاعدة لا تعطيه أرقامها أصلاً.
// الصفحة لكل الأدوار، وزر "فتح صفقة" وحده مخفي عن مركز الاتصال (والقاعدة ترفضه أصلاً).
// اسم العقار في كل صف يفتح صفحته (‎#/project/:id‎): لوحة وحداته كلها بألوانها، متاحة ومحجوزة ومباعة.
// والرجوع منها يعيد القائمة كما تُركت: البحث والمرشّحات والصفحة ومكان التمرير (remembered، كما في العملاء).

import { supabase, PAGE_SIZE, pageRange, pageBack } from './supabase.js';
import { inventoryVocabulary, sanitizeSearch } from './data.js';
import { myRole, isAdmin, canSeeCommission } from './auth.js';
import { openProjectCommission } from './project-commission.js';
import { sourceText } from './commission-rate.js';
import { openDealForm } from './deal-form.js';
import { safeUrl } from './agent.js';
import { UNIT_STATUS, UNIT_STATUS_TONE, LISTING_PURPOSE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, input, select,
    moneyInput, parseNumber, money, number, dash, notify, fail, pageHead, actionBtn, countText,
    filterChips, resultLine
} from './ui.js';

// القائمة كما تُفتح أول مرة، وكما يعيدها «مسح التصفية»: «المتاح فقط» مفعّل وبقية المرشّحات فارغة
const freshView = () => ({
    page: 0, search: '', projectId: null, district: '', unitType: '', purpose: '',
    rooms: '', priceMin: '', priceMax: '', commissionMin: '', commissionOrder: '', availableOnly: true
});

// البحث والمرشّحات والصفحة ومكان التمرير تبقى ما دامت الصفحة مفتوحة: الرجوع من صفحة عقار (اسمه رابطها) يعيد القائمة
// كما تُركت بدل أولها، كما في العملاء. لا تخزين في المتصفح؛ إعادة التحميل تبدأ من جديد.
const remembered = Object.assign(freshView(), { scroll: 0 });

// من البحث السريع (palette.js): القائمة من أولها بهذا البحث وحده. projectId: عقار بعينه اختاره الموظف، فتُعرض وحداته
// كلها (المتاحة والمحجوزة والمباعة) بمعرّفه لا باسمه — الاسم قد يحمل أقواساً يمحوها تنظيف البحث.
export function presetPropertySearch(term, projectId = null) {
    const id = projectId === null || projectId === undefined ? null : projectId;
    Object.assign(remembered, freshView(), { search: String(term || '').trim(), projectId: id, availableOnly: id === null, scroll: 0 });
}

const PURPOSE_CHIPS = [
    { value: '', label: 'الكل' },
    { value: 'sale', label: LISTING_PURPOSE.sale },
    { value: 'rent', label: LISTING_PURPOSE.rent }
];

export async function renderProperties(root) {
    const view = remembered;
    const restoreScroll = view.scroll;
    view.scroll = 0;
    // ردّ تحميل أقدم يصل بعد أحدث (تغيير مرشّحين بسرعة) يُهمَل
    let seq = 0;

    const body = el('div', {}, loading());
    const toolbar = el('div', { class: 'crm-toolbar' });
    // الحبّات تظهر قبل وصول مفردات الحي والنوع؛ الضغط قبلها يُحفظ ويُطبَّق مع أول تحميل
    let ready = false;
    const purposeChips = filterChips('غرض العرض', PURPOSE_CHIPS, view.purpose, (value) => { view.purpose = value; if (ready) reload(); });

    replace(root, [
        pageHead('العقارات', 'كل الوحدات المعتمدة للبيع والإيجار. إضافة المشروع وتعديله من صفحة المشاريع.', [
            actionBtn('المشاريع والخريطة', 'map', { href: '../projects.html' })
        ]),
        el('div', { class: 'crm-card' }, [toolbar, purposeChips.node, body])
    ]);

    // لا ترمي هذه الدالة أبداً؛ الفشل يصل في ‎*Error‎ فيتحوّل الحقل إلى نص حر
    const vocabulary = await inventoryVocabulary();
    if (!root.isConnected) return;

    const searchBox = el('input', {
        // البحث باسم المطور للمدير وحده (طلب المالك 2026-11-04)
        type: 'search', class: 'crm-search', placeholder: isAdmin() ? 'ابحث باسم العقار أو الحي أو المطور…' : 'ابحث باسم العقار أو الحي…', autocomplete: 'off',
        value: view.search, 'aria-label': isAdmin() ? 'بحث باسم العقار أو الحي أو المطور' : 'بحث باسم العقار أو الحي'
    });
    const districtField = vocabFilter(vocabulary.districts, vocabulary.districtsError, 'كل الأحياء', 'الحي');
    const typeField = vocabFilter(vocabulary.propertyTypes, vocabulary.propertyTypesError, 'كل الأنواع', 'نوع الوحدة');
    view.district = restoreChoice(districtField.node, view.district);
    view.unitType = restoreChoice(typeField.node, view.unitType);
    const roomsBox = input({
        class: 'crm-filter-num', inputMode: 'numeric', autocomplete: 'off', placeholder: 'غرف ≥', value: view.rooms
    });
    const priceMinBox = moneyBox('السعر من', view.priceMin);
    const priceMaxBox = moneyBox('إلى', view.priceMax);
    const commissionMinBox = moneyBox('العمولة من', view.commissionMin);
    const commissionOrderBox = select([
        { value: '', label: 'ترتيب افتراضي' },
        { value: 'desc', label: 'أعلى عمولة أولاً' },
        { value: 'asc', label: 'أقل عمولة أولاً' }
    ], view.commissionOrder, { 'aria-label': 'ترتيب العمولة' });
    const availableBox = el('input', { type: 'checkbox', checked: view.availableOnly });
    const availableChip = el('label', { class: 'chip' + (view.availableOnly ? ' on' : '') }, [availableBox, 'المتاح فقط']);

    // البحث بالكتابة وحده مؤجَّل؛ بقية الحقول تُطلق الاستعلام عند تغيّرها فعلاً
    // (‎change‎ لا ‎input‎)، فلا يُستعلم عند كل ضغطة في حقول الأرقام. الكتابة تُلغي «عقاراً بعينه» من البحث السريع.
    // الحالة مشتركة بين الزيارات: كتابة لم تُطبَّق قبل مغادرة الصفحة لا تُكتب فيها بعدها (القائمة المحفوظة ما رآه الموظف)
    let debounce = null;
    searchBox.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            if (!searchBox.isConnected) return;
            view.search = searchBox.value;
            view.projectId = null;
            reload();
        }, 300);
    });
    districtField.node.addEventListener('change', () => { view.district = districtField.node.value.trim(); reload(); });
    typeField.node.addEventListener('change', () => { view.unitType = typeField.node.value.trim(); reload(); });
    roomsBox.addEventListener('change', () => { view.rooms = roomsBox.value; reload(); });
    priceMinBox.addEventListener('change', () => { view.priceMin = priceMinBox.value; reload(); });
    priceMaxBox.addEventListener('change', () => { view.priceMax = priceMaxBox.value; reload(); });
    commissionMinBox.addEventListener('change', () => { view.commissionMin = commissionMinBox.value; reload(); });
    commissionOrderBox.addEventListener('change', () => { view.commissionOrder = commissionOrderBox.value; reload(); });
    availableBox.addEventListener('change', () => {
        view.availableOnly = availableBox.checked;
        availableChip.classList.toggle('on', availableBox.checked);
        reload();
    });

    // على الجوال: البحث ظاهر، وباقي المرشّحات خلف زر «المرشّحات» حتى تظهر النتائج في أول الشاشة.
    // على الكمبيوتر الغلاف بلا أثر (display: contents في css/theme.css) فيبقى الشريط كما هو.
    const seeCommission = canSeeCommission();
    const extra = el('div', { class: 'crm-toolbar-extra', id: 'propertyFilters' }, [
        districtField.node, typeField.node,
        roomsBox, priceMinBox, priceMaxBox,
        seeCommission ? commissionMinBox : null, seeCommission ? commissionOrderBox : null, availableChip
    ]);
    const filtersBtn = el('button', {
        type: 'button', class: 'btn btn-outline btn-sm crm-filter-toggle', text: 'المرشّحات',
        'aria-expanded': 'false', 'aria-controls': 'propertyFilters',
        onclick: () => {
            const open = extra.classList.toggle('open');
            filtersBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    });
    replace(toolbar, [searchBox, filtersBtn, extra]);

    function reload() {
        view.page = 0;
        load();
    }

    // «مسح التصفية»: كل الحقول إلى أول حالها، و«المتاح فقط» يبقى مفعّلاً كما تُفتح الصفحة
    function reset() {
        Object.assign(view, freshView());
        for (const box of [searchBox, roomsBox, priceMinBox, priceMaxBox, commissionMinBox]) box.value = '';
        districtField.node.value = '';
        typeField.node.value = '';
        commissionOrderBox.value = '';
        availableBox.checked = true;
        availableChip.classList.add('on');
        purposeChips.set('');
        reload();
    }

    async function load() {
        const mine = ++seq;
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        // الأعمدة الاختيارية بالتدريج: بيئة بلا 037 (أو بلا 030) لا تُسقط الصفحة، بل تُسقط ما ينقصها فقط
        const commissionCols = seeCommission ? 'unit_commission, ' : '';
        const tiers = [
            'project_image, developer, ' + commissionCols + (seeCommission ? 'unit_commission_rate, unit_commission_source, ' : '') + 'unit_count, units_left, ',
            'project_image, developer, ' + commissionCols + 'unit_count, units_left, ',
            ''
        ];
        const buildQuery = (extraCols) => {
            const withUnitFields = extraCols !== '';
            const sortByCommission = withUnitFields && seeCommission && view.commissionOrder;
            let query = supabase
                .from('v_units')
                .select(
                    'project_id, project_name, unit_ord, unit_key, unit_type, district, district_inferred,'
                    + ' rooms, bathrooms, area, price, '
                    + extraCols
                    + 'construction_status, unit_status',
                    { count: 'exact' }
                )
                .order(sortByCommission ? 'unit_commission' : 'project_name', { ascending: view.commissionOrder !== 'desc' })
                .order('project_id', { ascending: true })
                .order('unit_ord', { ascending: true })
                .range(from, to);

            if (view.availableOnly) {
                query = query.eq('unit_status', 'available').eq('availability', 'available')
                    .eq('status', 'approved').is('deleted_at', null);
            }
            const term = sanitizeSearch(view.search);
            // عقار بعينه من البحث السريع: بمعرّفه. وإلا الكلمة في اسم العقار أو حيّه، كما يبحث البحث السريع
            if (view.projectId !== null) query = query.eq('project_id', view.projectId);
            else if (term) query = query.or('project_name.ilike.%' + term + '%,district.ilike.%' + term + '%'
                + (isAdmin() && withUnitFields ? ',developer.ilike.%' + term + '%' : ''));
            if (view.purpose) query = query.eq('purpose', view.purpose);
            if (view.district) query = districtField.filter(query, 'district', view.district);
            if (view.unitType) query = typeField.filter(query, 'unit_type', view.unitType);
            const rooms = parseNumber(view.rooms);
            if (rooms !== null) query = query.gte('rooms', rooms);
            const priceMin = parseNumber(view.priceMin);
            if (priceMin !== null) query = query.gte('price', priceMin);
            const priceMax = parseNumber(view.priceMax);
            if (priceMax !== null) query = query.lte('price', priceMax);
            const commissionMin = parseNumber(view.commissionMin);
            if (withUnitFields && seeCommission && commissionMin !== null) query = query.gte('unit_commission', commissionMin);
            return query;
        };

        // عمود ناقص في العرض = خطأ يذكر اسمه؛ عندها يُجرَّب المستوى الأقل. أي خطأ آخر يُعرض كما هو
        const OPTIONAL = /unit_commission|project_image|developer|units_left|unit_count/;
        let result = null;
        for (const cols of tiers) {
            result = await buildQuery(cols);
            if (!(result.error && OPTIONAL.test(String(result.error.message || '')))) break;
        }
        if (mine !== seq || !body.isConnected) return;
        // صفحة محفوظة صارت بعد آخر القائمة (تغيّر المخزون والموظف في صفحة عقار): آخر صفحة صالحة بدل «لا وحدات» كاذبة
        const back = pageBack(view.page, result);
        if (back !== null) { view.page = back; return load(); }
        const { data, error, count } = result;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العقارات', load));

        const rows = data || [];
        if (rows.length === 0) {
            return void replace(body, filtered(view)
                ? empty('لا وحدات مطابقة لهذا البحث', 'وسّع نطاق السعر أو الحي، أو امسح التصفية.',
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'مسح التصفية', onclick: reset }))
                : empty('لا توجد عقارات متاحة', 'العروض الجديدة تُضاف من «إضافة عرض» أو من صفحة المشاريع، وتظهر هنا بعد اعتمادها.'));
        }

        const total = count === null || count === undefined ? rows.length : count;
        replace(body, [
            resultLine(countText(total, ['وحدة واحدة', 'وحدتان', 'وحدات', 'وحدة']), filtered(view) ? reset : null),
            el('div', { class: 'crm-table-wrap' }, table(rows, seeCommission, load)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    ready = true;
    await load();
    if (restoreScroll > 0 && root.isConnected) requestAnimationFrame(() => window.scrollTo(0, restoreScroll));
}

function filtered(view) {
    return Boolean(view.search || view.projectId !== null || view.district || view.unitType || view.purpose || view.rooms || view.priceMin
        || view.priceMax || view.commissionMin || view.commissionOrder || !view.availableOnly);
}

// قيمة محفوظة تعود إلى حقلها. حيّ أو نوع لم يعد في القائمة (تغيّرت المفردات) يرجع إلى «الكل» بدل خانة فارغة
// ومرشّح خفي؛ والحقل النصي (حين تعذّرت المفردات) يأخذ القيمة كما هي
function restoreChoice(node, value) {
    node.value = value;
    if (node.value !== value) node.value = '';
    return node.value;
}

// حقل مبلغ بقيمته المحفوظة كما يُظهرها عند مغادرته: بفواصل الآلاف، وفارغاً لما لا يُقرأ رقماً
function moneyBox(placeholder, value) {
    const box = moneyInput({ class: 'crm-money crm-filter-num', placeholder });
    const n = parseNumber(value);
    if (n !== null) box.value = money(n);
    return box;
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
        node: select([{ value: '', label: allLabel }].concat(values.map((v) => ({ value: v, label: v }))), '', { 'aria-label': freePlaceholder }),
        filter: (query, column, value) => query.eq(column, value)
    };
}

/* ===================== الجدول ===================== */

function table(rows, seeCommission, reload) {
    // مركز الاتصال لا صفقات له، فالزر لا يُبنى له أصلاً
    const dealAllowed = myRole() !== 'callcenter';

    // ثماني خانات مقروءة بدل ثلاث عشرة: العقار ووحدته ومطوره معاً، والنوع والحي معاً، والمواصفات في سطر
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الصورة' }),
        el('th', { text: 'العقار' }),
        el('th', { text: 'النوع والحي' }),
        el('th', { text: 'المواصفات' }),
        el('th', { text: 'السعر' }),
        el('th', { text: 'العمولة' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: '' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const sub = [row.unit_key, row.developer].filter(Boolean).join(' · ');
        // صيغة قصيرة تتسع في سطر: «غرف 5 · حمامات 4 · 300 م²»
        const specs = [
            present(row.rooms) ? 'غرف ' + number(row.rooms) : null,
            present(row.bathrooms) ? 'حمامات ' + number(row.bathrooms) : null,
            present(row.area) ? number(row.area) + ' م²' : null
        ].filter(Boolean).join(' · ');
        body.appendChild(el('tr', {}, [
            el('td', {}, unitImage(row)),
            el('td', {}, el('div', { class: 'pr-name' }, [
                // الاسم رابط صفحة العقار (‎#/project/:id‎، project.js): لوحة وحداته بألوانها والتسجيل على نموذج منها
                // مكان التمرير يُحفظ قبل الانتقال، فيعود إليه الرجوع
                el('strong', {}, el('a', {
                    class: 'pj-link', href: '#/project/' + row.project_id, text: dash(row.project_name),
                    onclick: () => { remembered.scroll = window.scrollY; }
                })),
                el('span', { class: 'crm-subtle', text: (sub || 'رقم ' + dash(row.project_id)) })
            ])),
            el('td', {}, el('div', { class: 'pr-place' }, [
                el('span', { text: [row.unit_type, row.district].filter(Boolean).join(' · ') || dash(null) }),
                row.district_inferred ? badge('حي مستنتج', 'orange') : null
            ])),
            el('td', { text: specs || dash(null) }),
            el('td', { class: 'num pr-price', text: money(row.price) }),
            el('td', { class: 'num' }, seeCommission ? commissionCell(row, reload) : el('span', { class: 'pr-none', text: '—' })),
            el('td', {}, el('div', { class: 'pr-status' }, [
                badge(label(UNIT_STATUS, row.unit_status), UNIT_STATUS_TONE[row.unit_status] || 'neutral'),
                // نموذج بعدة وحدات: يبقى «متاحاً» حتى تُحجز كلها، والباقي من حجوزات الصفقات (030)
                row.unit_count > 1 && row.units_left !== null && row.units_left !== undefined
                    ? el('span', { class: 'crm-subtle', text: 'متبقي ' + row.units_left + ' من ' + row.unit_count })
                    : null,
                row.construction_status ? el('span', { class: 'crm-subtle', text: row.construction_status }) : null
            ])),
            el('td', { class: 'cell-actions' }, rowActions(row, dealAllowed))
        ]));
    }

    // t-card t-props: على الجوال بطاقة (easy.css): الصورة والاسم، ثم السعر والحالة، ثم الموقع والمواصفات، ثم الأزرار.
    // من لا يرى العمولة: الخانة السادسة تبقى في الصف (easy.css يرتّب البطاقة بأرقام الخانات) ويخفيها no-commission
    return el('table', { class: 'users-table crm-table pr-table t-card t-props' + (seeCommission ? '' : ' no-commission') }, [head, body]);
}

const present = (value) => value !== null && value !== undefined && value !== '';

/* ===================== العمولة ===================== */

// العمولة محسوبة في القاعدة (037): مبلغ محدد للنموذج، وإلا السعر × نسبة المشروع أو العامة. المدير يرى المبلغ ومصدره،
// ويضغطه فتُفتح «عمولة المشروع» لهذا المشروع. غيره (حين يشغّل المدير الزر) يرى المبلغ فقط.
function commissionCell(row, reload) {
    const missing = row.unit_commission === null || row.unit_commission === undefined;
    const amount = missing ? '—' : money(row.unit_commission);
    // pr-none: لا عمولة، فتُخفى الخانة على الجوال (easy.css) بدل سطر «العمولة —»
    if (!isAdmin()) return el('span', { class: missing ? 'pr-none' : null, text: amount });
    const source = sourceText(row.unit_commission_source, row.unit_commission_rate);
    return el('button', {
        type: 'button', class: 'pr-com', title: 'عمولة المشروع: النسبة ومبالغ النماذج',
        'aria-label': 'عمولة ' + dash(row.project_name) + ' — ' + dash(row.unit_key) + ': ' + amount + (source ? '، ' + source : '') + '. تعديل',
        onclick: () => openProjectCommission(row.project_id, reload)
    }, [
        el('span', { class: 'pr-com-amount', text: amount }),
        source ? el('small', { class: 'pr-com-src' + (row.unit_commission_source === 'override' ? ' is-fixed' : ''), text: source }) : null
    ]);
}

function unitImage(row) {
    const url = safeUrl(row.project_image);
    return url
        ? el('img', { src: url, alt: dash(row.project_name), class: 'unit-thumb', loading: 'lazy' })
        : el('span', { class: 'unit-thumb-placeholder', text: '—' });
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
                unit_key: row.unit_ord > 0 ? row.unit_key : null,
                amount: row.price ?? null
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
