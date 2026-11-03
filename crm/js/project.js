// ‎#/project/:id‎ — صفحة العقار: ترويسته، وشريط أرقام وحداته، و«لوحة الوحدات» (صف لكل نموذج ومربع لكل وحدة بلونها)،
// ولوحة النموذج المختار وفيها زر واحد يسجّل عليه عميلاً: نموذج «صفقة جديدة» نفسه (deal-form.js) بالعقار والوحدة معبّأين.
//
// قراءة فقط لكل الأدوار، والسياسات تقرّر ما يُرى: projects (المعتمد غير المحذوف، وما أضافه الوسيط بنفسه)، و v_units
// بالسياسات نفسها (security_invoker)، و unit_holds يقرؤها كل موظف (030). قسمة كل نموذج بين متاح ومحجوز ومباع في
// units-board.js بقاعدة v_units نفسها. العمولة لمن يرى العمولة (037)، ولغيره «••••» مخفية؛ والقاعدة لا تعطيه الأرقام أصلاً.
// مركز الاتصال لا عمولة له أصلاً (لا صفقات له): لا خانة «عمولتي» عنده ولو مخفية، ولو شغّل المدير إظهار العمولة للموظفين.
// زر التسجيل لا يُبنى لمركز الاتصال (لا صفقات له، والقاعدة ترفضها له)، ولا على عقار محذوف.
// التعديل في صفحة المشاريع (‎../projects.html‎) كما في «العقارات»، وهذه نافذة عليه.

import { supabase, fetchAll } from './supabase.js';
import { myRole, canSeeCommission } from './auth.js';
import { openDealForm } from './deal-form.js';
import { LISTING_PURPOSE, label } from './labels.js';
import { buildBoard, boardSummary, defaultOrd, availabilityText, takenText, MAX_CELLS } from './units-board.js';
import {
    el, replace, loading, empty, errorBox, isMissingRelation, icon, pageHead, actionBtn, money, number, countText, fmtDate, dash
} from './ui.js';

const SAR = 'ر.س';
// مسافة لا ينكسر عندها السطر: الرقم ووحدته («ر.س»، «م²»، «غرف») لا يفترقان على الجوال، فينكسر السطر عند « · » وحدها
const NBSP = '\u00a0';

// الاستعلام لا يرمي: خطأ الشبكة يصل { error } كخطأ الخادم، فيُعرض في مربع واحد بزر «إعادة المحاولة»
const settle = (query) => Promise.resolve(query).catch((error) => ({ data: null, error }));

export async function renderProject(root, projectId) {
    replace(root, loading('جارٍ تحميل العقار'));
    const id = String(projectId || '').trim();
    // رقم العقار عدد صحيح دائماً (projects.id integer): رابط غيره خاطئ، فلا يُسأل الخادم عنه ولا تظهر رسالته الإنجليزية
    const pid = /^\d{1,10}$/.test(id) ? Number(id) : NaN;
    if (!(pid <= 2147483647)) return void replace(root, notFound());
    // show: الأرقام، masked: «••••» مخفية، none: لا خانة (مركز الاتصال)
    const commission = myRole() === 'callcenter' ? 'none' : canSeeCommission() ? 'show' : 'masked';
    const seeCommission = commission === 'show';

    const [projectResult, unitsResult, holdsResult] = await Promise.all([
        settle(supabase.from('projects')
            .select('id, name, purpose, city, district, availability, status, deleted_at, delivery_date, details')
            .eq('id', pid)
            .maybeSingle()),
        // عمود العمولة لا يُطلب لمن لا يراها، كما في «العقارات»
        settle(fetchAll(() => supabase.from('v_units')
            .select('unit_ord, unit_key, unit_type, rooms, bathrooms, area, price, unit_count, unit_status' + (seeCommission ? ', unit_commission' : ''))
            .eq('project_id', pid)
            .order('unit_ord', { ascending: true }))),
        settle(fetchAll(() => supabase.from('unit_holds')
            .select('deal_id, unit_key, status')
            .eq('project_id', pid)
            .order('deal_id', { ascending: true })))
    ]);
    if (!root.isConnected) return;

    const retry = () => renderProject(root, projectId);
    if (projectResult.error) return void replace(root, errorBox(projectResult.error, 'تعذّر تحميل العقار', retry));
    const project = projectResult.data;
    if (!project) return void replace(root, notFound());
    if (unitsResult.error) return void replace(root, errorBox(unitsResult.error, 'تعذّر تحميل وحدات العقار', retry));
    // قاعدة قبل 030 لا حجوزات فيها، و v_units فيها تعرض الحالة اليدوية وحدها: اللوحة مثلها. أي خطأ آخر يُقال، فلا تُرسم
    // وحدات محجوزة خضراء
    const holdsMissing = Boolean(holdsResult.error) && isMissingRelation(holdsResult.error);
    if (holdsResult.error && !holdsMissing) {
        return void replace(root, errorBox(holdsResult.error, 'تعذّر تحميل حجوزات الوحدات', retry));
    }

    const rows = buildBoard(unitsResult.data || [], holdsMissing ? [] : holdsResult.data || [], project);
    const panel = el('aside', { class: 'crm-card pj-panel', id: 'pjPanel', 'aria-labelledby': 'pjPanelTitle' });
    const buttons = new Map();

    // اختيار نموذج: يُضغط زره وحده، وتُرسم تفاصيله في اللوحة الجانبية. byUser: ضغطة الموظف (لا الاختيار الأول)
    function select(ord, byUser) {
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', key === ord ? 'true' : 'false');
        replace(panel, panelBody(project, rows.find((row) => row.ord === ord), commission));
        if (byUser) revealPanel(panel);
    }

    const list = rows.map((row) => {
        const button = modelButton(row, () => select(row.ord, true));
        buttons.set(row.ord, button);
        return button;
    });

    // بلا زر رئيسي في الترويسة: الإجراء الرئيسي في لوحة النموذج المختار
    const mapLink = actionBtn('المشاريع والخريطة', 'map', { href: '../projects.html' });
    mapLink.classList.add('pj-head-link');
    replace(root, [
        pageHead(dash(project.name), subLine(project), [mapLink]),
        statusNote(project),
        rows.length ? summaryStrip(boardSummary(rows), commission) : null,
        el('div', { class: 'pj-layout' + (rows.length ? '' : ' pj-layout-empty') }, [
            boardCard(rows, list),
            rows.length ? panel : null
        ])
    ]);

    const first = defaultOrd(rows);
    if (first !== null) select(first, false);
}

/* ===================== الترويسة ===================== */

// الحي · المدينة · المطوّر · حالة البناء · التسليم، من صف العقار وتفاصيله (المطوّر بأسمائه الثلاثة كما يقرؤها v_units)
function subLine(project) {
    const details = project.details && typeof project.details === 'object' ? project.details : {};
    const developer = firstText(details.developer, details.developer_name, details.developerName);
    const delivery = firstText(details.delivery_time) || (project.delivery_date ? fmtDate(String(project.delivery_date).slice(0, 10)) : '');
    return [
        label(LISTING_PURPOSE, project.purpose, ''),
        firstText(project.district),
        firstText(project.city),
        developer ? 'المطوّر: ' + developer : '',
        constructionLabel(details.construction_status),
        delivery ? 'التسليم: ' + delivery : ''
    ].filter(Boolean).join(' · ');
}

// أول نص غير فارغ: الحقول الحرة في details قد تأتي أرقاماً أو فراغات
function firstText(...values) {
    for (const value of values) {
        if (value === null || value === undefined || typeof value === 'object') continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return '';
}

// كما في صفحة المشاريع (constructionLabel في js/script.js): القيمة المعتمدة بمسافتها، والنص الحر كما كُتب لأنه أدق
function constructionLabel(value) {
    const text = firstText(value);
    return text === 'تحت_الإنشاء' ? 'تحت الإنشاء' : text;
}

// ما يغيّر معنى الصفحة يُقال تحت الترويسة: عقار محذوف (لا صفقات عليه)، أو لم يُعتمد بعد، أو نفد بالكامل.
// غير المعتمد والمرفوض يراهما المدير ومن أضافهما وحدهما (سياسة projects)، وهما من يفتح الصفحة: الجملة تقول ما يصدق عليهما
function statusNote(project) {
    if (project.deleted_at) return note('هذا العقار محذوف من المخزون، فلا تُفتح عليه صفقات جديدة.', 'danger');
    if (project.status === 'pending') return note('هذا العقار بانتظار اعتماد المدير؛ لا يراه بقية الموظفين حتى يُعتمد.', 'amber');
    if (project.status === 'rejected') return note('هذا العقار مرفوض؛ لا يراه بقية الموظفين.', 'danger');
    if (project.availability && project.availability !== 'available') return note('هذا العقار «نفد بالكامل»، فكل وحداته خارج البيع.', 'muted');
    return null;
}

function note(text, tone) {
    return el('p', { class: 'pj-note pj-note-' + tone }, [icon('alert'), el('span', { text })]);
}

function notFound() {
    return el('div', { class: 'crm-denied' }, [
        el('div', { class: 'crm-error', text: 'العقار غير موجود أو لا تملك صلاحية الاطلاع عليه.' }),
        el('a', { class: 'btn btn-outline btn-sm pj-back', href: '#/properties', text: 'رجوع إلى العقارات' })
    ]);
}

/* ===================== شريط الأرقام ===================== */

// خمس خانات ثابتة: المتاح من الكل، والمحجوز، والمباع، وأقل سعر بين المتاح، وعمولة الوحدة — وأربع لمركز الاتصال (لا
// عمولة له): pj-sum-4 يوزّع الخانات الأربع فلا تبقى خانة فارغة في الشريط. commission: show | masked | none
function summaryStrip(s, commission) {
    const none = commission === 'none';
    return el('div', { class: 'pj-sum' + (none ? ' pj-sum-4' : ''), role: 'group', 'aria-label': 'ملخص وحدات العقار' }, [
        sumCell('متاح', [number(s.available), unit('من ' + number(s.total))], { tone: s.available > 0 ? 'ok' : null }),
        sumCell('محجوز', number(s.reserved), { tone: s.reserved > 0 ? 'amber' : null }),
        sumCell('مباع', number(s.sold)),
        sumCell('يبدأ من', s.fromPrice === null ? '—' : [money(s.fromPrice), unit(SAR)], {
            wide: true, sub: s.fromPrice !== null ? null : s.available > 0 ? 'بلا سعر مسجّل' : 'لا وحدة متاحة'
        }),
        none ? null : commissionCell(s, commission === 'show')
    ]);
}

function sumCell(title, value, options = {}) {
    return el('div', { class: 'pj-sum-cell' + (options.wide ? ' pj-sum-wide' : '') }, [
        el('span', { class: 'pj-sum-label', text: title }),
        el('span', { class: 'pj-sum-num' + (options.tone ? ' pj-tone-' + options.tone : '') }, value),
        options.sub ? el('span', { class: 'pj-sum-sub', text: options.sub }) : null
    ]);
}

const unit = (text) => el('small', { class: 'pj-sum-unit', text });

// النقاط للعين وحدها؛ قارئ الشاشة يقرأ «مخفية» المكتوبة بجانبها
const masked = () => el('span', { class: 'pj-masked', 'aria-hidden': 'true', text: '••••' });

// «عمولتي»: مدى عمولة الوحدة بين النماذج المتاحة (أو قيمتها الواحدة) لمن يرى العمولة، ولغيره «••••» مخفية
function commissionCell(s, seeCommission) {
    if (!seeCommission) return sumCell('عمولتي', masked(), { wide: true, sub: 'مخفية' });
    if (!s.commission) return sumCell('عمولتي', '—', { wide: true, sub: s.available > 0 ? 'غير محسوبة' : 'لا وحدة متاحة' });
    const { min, max } = s.commission;
    // المدى لا ينكسر داخل الرقم، بل عند الشرطة إن ضاقت الخانة
    const value = min === max
        ? [money(min)]
        : [el('span', { class: 'pj-nw', text: money(min) }), ' – ', el('span', { class: 'pj-nw', text: money(max) })];
    return sumCell('عمولتي', value.concat(unit(SAR)), { wide: true, sub: 'للوحدة الواحدة' });
}

/* ===================== لوحة الوحدات ===================== */

const KINDS = [['available', 'متاح'], ['reserved', 'محجوز'], ['sold', 'مباع']];

// list-style: none يُسقط معنى القائمة في Safari، فيُعاد صريحاً
function legend() {
    return el('ul', { class: 'pj-legend', role: 'list', 'aria-label': 'معنى الألوان' }, KINDS.map(([kind, text]) => el('li', {}, [
        el('span', { class: 'pj-sq pj-sq-' + kind, 'aria-hidden': 'true' }),
        el('span', { text })
    ])));
}

function boardCard(rows, buttons) {
    // صف «كامل العقار» وحده (عقار بلا نماذج) لا يُعدّ نماذج
    const hasModels = rows.length > 0 && rows[0].ord > 0;
    const models = hasModels ? countText(rows.length, ['نموذج واحد', 'نموذجان', 'نماذج', 'نموذجاً']) : null;
    return el('section', { class: 'crm-card pj-board', 'aria-labelledby': 'pjBoardTitle' }, [
        el('div', { class: 'crm-card-head pj-board-head' }, [
            el('div', { class: 'pj-board-title' }, [
                el('h2', { id: 'pjBoardTitle', text: 'لوحة الوحدات' }),
                models ? el('span', { class: 'pj-board-count', text: models }) : null
            ]),
            rows.length ? legend() : null
        ]),
        rows.length
            ? el('div', { class: 'pj-models', role: 'group', 'aria-label': hasModels ? 'النماذج: اختر نموذجاً لتظهر تفاصيله' : 'وحدات العقار' }, buttons)
            : empty('لا وحدات مسجّلة لهذا العقار', 'النماذج وأعداد وحداتها تُضاف من صفحة المشاريع.')
    ]);
}

// لون نص الحالة: أخضر ما بقي متاح، وكهرماني لنموذج محجوز، ورمادي لما بيع كله
const toneOf = (row) => (row.available > 0 ? 'ok' : row.status === 'reserved' ? 'amber' : 'muted');

// صف النموذج زر واحد: الاسم ومواصفاته، ثم مربع لكل وحدة، ثم «متاح N من M». المربعات للعين (aria-hidden)، وقارئ الشاشة
// يقرأ المحجوز والمباع نصاً
function modelButton(row, onSelect) {
    const specs = [
        row.rooms > 0 ? countText(row.rooms, ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة']).replace(/ /g, NBSP) : null,
        row.area > 0 ? number(row.area) + NBSP + 'م²' : null,
        row.price > 0 ? money(row.price) + NBSP + SAR : null
    ].filter(Boolean).join(' · ');
    const taken = row.total > 1 ? takenText(row, number) : '';
    const perCell = row.total > MAX_CELLS ? Math.max(1, Math.round(row.total / MAX_CELLS)) : 0;
    return el('button', {
        type: 'button', class: 'pj-model', 'aria-pressed': 'false', 'aria-controls': 'pjPanel', onclick: onSelect
    }, [
        el('span', { class: 'pj-model-main' }, [
            el('strong', { class: 'pj-model-name', text: dash(row.key) }),
            specs ? el('span', { class: 'pj-model-specs', text: specs }) : null
        ]),
        el('span', {
            class: 'pj-cells', 'aria-hidden': 'true',
            title: perCell ? 'كل مربع نحو ' + countText(perCell, ['وحدة واحدة', 'وحدتين', 'وحدات', 'وحدة']) : null
        }, row.cells.map((kind) => el('span', { class: 'pj-sq pj-sq-' + kind }))),
        el('span', { class: 'pj-model-count pj-tone-' + toneOf(row) }, [
            availabilityText(row, number),
            taken ? el('span', { class: 'w4-sr', text: '، ' + taken.replace(/ · /g, '، ') }) : null
        ])
    ]);
}

/* ===================== لوحة النموذج المختار ===================== */

function fact(title, value) {
    return el('div', { class: 'pj-fact' }, [el('dt', { text: title }), el('dd', {}, value)]);
}

// commission: show | masked | none (مركز الاتصال: لا سطر «عمولتي» أصلاً)
function panelBody(project, row, commission) {
    if (!row) return null;
    // صف «كامل العقار» (unit_ord 0) ليس نموذجاً: العقار كله وحدة واحدة
    const whole = row.ord === 0;
    const taken = row.total > 1 ? takenText(row, number) : '';
    const canRegister = myRole() !== 'callcenter' && !project.deleted_at;
    return [
        whole ? null : el('p', { class: 'pj-panel-kicker', text: 'النموذج المختار' }),
        el('h2', { class: 'pj-panel-title', id: 'pjPanelTitle', text: dash(row.key) }),
        row.type ? el('p', { class: 'pj-panel-type', text: row.type }) : null,
        el('dl', { class: 'pj-facts' }, [
            row.rooms > 0 ? fact('الغرف', number(row.rooms)) : null,
            row.bathrooms > 0 ? fact('دورات المياه', number(row.bathrooms)) : null,
            row.area > 0 ? fact('المساحة', number(row.area) + NBSP + 'م²') : null,
            fact('السعر', row.price > 0 ? money(row.price) + NBSP + SAR : '—'),
            fact('الوحدات', [
                el('span', { class: 'pj-tone-' + toneOf(row), text: availabilityText(row, number) }),
                taken ? el('small', { text: taken }) : null
            ]),
            commission === 'none' ? null : fact('عمولتي', commission === 'show'
                ? (row.commission === null ? '—' : money(row.commission) + NBSP + SAR)
                : [masked(), el('small', { text: 'مخفية' })])
        ]),
        row.available > 0 ? null : el('p', { class: 'pj-panel-note', text: whole ? 'العقار غير متاح الآن.' : 'لا وحدة متاحة الآن في هذا النموذج.' }),
        canRegister ? el('button', {
            type: 'button', class: 'btn btn-primary pj-register', onclick: () => registerClient(project, row),
            text: whole ? 'سجّل عميل على هذا العقار' : 'سجّل عميل على هذا النموذج'
        }) : null,
        canRegister ? el('p', {
            class: 'pj-panel-hint',
            text: (whole ? 'يفتح صفقة جديدة على هذا العقار، ويُحجز' : 'يفتح صفقة جديدة على هذا النموذج، والوحدة تُحجز') + ' تلقائياً من مرحلة «عربون».'
        }) : null
    ];
}

// نموذج «صفقة جديدة» كما يفتحه «فتح صفقة» في «العقارات»: العميل يُختار فيه، والعقار والوحدة والسعر معبّأة.
// صف «كامل العقار» ليس وحدة، فلا يُكتب اسمه في unit_key (الحجز يطابق العقار كله حين لا وحدة)
function registerClient(project, row) {
    openDealForm(null, {
        project_id: project.id,
        unit_key: row.ord > 0 ? row.key : null,
        amount: row.price > 0 ? row.price : null
    }, (deal) => { location.hash = '#/deals/' + deal.id; });
}

// الجوال واللوحي: لوحة النموذج تحت قائمة النماذج (crm/v6.css، قسم صفحة المشروع، حتى 1000px)، فإن بقيت خارج الشاشة بعد
// الاختيار يُنزل إليها (التركيز يبقى على الزر)
function revealPanel(panel) {
    if (!window.matchMedia('(max-width: 1000px)').matches) return;
    const top = panel.getBoundingClientRect().top;
    if (top >= 0 && top <= window.innerHeight - 200) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
}
