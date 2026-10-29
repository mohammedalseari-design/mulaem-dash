// ‎#/mortgage‎ — «حاسبة التمويل العقاري» للمدير: كم يقدر العميل يتموّل وكم قسطه الشهري، بحسب راتبه
// والتزاماته وعمره وسعر العقار ودفعته الأولى. الفكرة من حاسبتي «عون» و«سكني» (2026-10-29)، أما الشروط
// والأرقام فمن مصادر نظامية مذكورة في أسفل الصفحة، لا منقولة منهما.
//
// - الحساب كله في mortgage-calc.js (دوال صافية، لها tests/mortgage-calc.test.mjs).
// - لا اتصال بقاعدة البيانات، ولا يُحفظ شيء عن العميل: الراتب والالتزامات والعمر والسعر تبقى في الصفحة.
//   يُحفظ في متصفح المدير شروط التمويل وحدها (الربح والاستقطاع…) ليكتبها مرة واحدة.

import {
    el, replace, empty, pageHead, actionBtn, subTabs, field, input, moneyInput, parseNumber, money, badge, notify, openModal
} from './ui.js';
import { TERMS, computeMortgage } from './mortgage-calc.js';
import { CALC_TABS, loadFinancing } from './financing.js';
import { entityStatus, termsOf } from './financing-model.js';

const STORE_KEY = 'mulaem.mortgage.terms.v2';   // v2: الربح الافتراضي 6.7%، ويُحفظ ما يغيّره المدير فقط
const TERM_KEYS = Object.keys(TERMS);
const PERSONAL_KEYS = ['salary', 'obligations', 'age', 'price', 'down', 'years'];
const MONEY_KEYS = ['salary', 'obligations', 'price', 'down', 'feeCap'];
const EXAMPLE = { salary: '12000', obligations: '0', age: '35', price: '1000000', down: '100000', years: '' };

export async function renderMortgage(root) {
    const form = buildForm(loadTerms(), recalc);
    const copyBtn = actionBtn('نسخ الملخص', 'clipboard', { onclick: copy, disabled: true }, true);
    const strip = el('div', { class: 'kpi-strip kpi-strip-3 mort-kpis', role: 'group', 'aria-label': 'خلاصة التمويل' });
    const result = el('div', { 'aria-live': 'polite' });
    let last = null;
    let fin = null; // جهات التمويل: تصل بعد أول رسم، فتظهر المقارنة حين تصل

    root.appendChild(pageHead('حاسبة التمويل العقاري',
        'كم يقدر العميل يتموّل وكم قسطه الشهري؟ الأرقام تقديرية، والعرض النهائي من البنك.', copyBtn));
    root.appendChild(subTabs('أقسام حاسبة التمويل', CALC_TABS, '#/mortgage'));
    root.appendChild(el('div', { class: 'mort-grid' }, [
        form.node,
        strip,
        el('section', { class: 'crm-card mort-result' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'التفاصيل' })]),
            result
        ])
    ]));
    recalc();
    loadFinancing().then((data) => {
        fin = data;
        if (result.isConnected) recalc();
    }).catch(() => { /* الحاسبة تعمل بشروطها بلا مقارنة الجهات */ });

    function recalc() {
        const values = form.read();
        if (form.termsTouched()) saveTerms(values);
        last = computeMortgage(values);
        form.update(last);
        copyBtn.disabled = !(last.months > 0 && last.needed > 0);
        replace(strip, kpis(last));
        replace(result, details(last, compare(values)));
    }

    // الحساب نفسه بشروط كل جهة مفعّلة لها نسبة؛ الضغط على جهة يطبّق شروطها على النموذج
    function compare(values) {
        if (!fin) return null;
        const now = new Date();
        return {
            on: form.appliedName(),
            pick: (e) => form.applyTerms(termsOf(e), e.name),
            list: fin.entities.filter((e) => e.active && e.rate !== null).map((e) => ({
                e, r: computeMortgage({ ...values, ...termsOf(e) }), st: entityStatus(e, fin.proposals[e.id], now)
            }))
        };
    }

    async function copy() {
        if (!last || copyBtn.disabled) return;
        const text = summaryText(last);
        try {
            await navigator.clipboard.writeText(text);
            notify('نُسخ الملخص، الصقه في واتساب أو رسالة');
        } catch (error) {
            // متصفح يمنع النسخ التلقائي: نعرض النص ليُنسخ باليد
            const box = el('textarea', { class: 'mort-copy', rows: 8, readOnly: true, value: text });
            openModal('ملخص التمويل', [box, el('p', { class: 'hint', text: 'حدد النص وانسخه.' })], { narrow: true });
            box.select();
        }
    }
}

/* ===================== النموذج ===================== */

function buildForm(terms, onChange) {
    const num = (attrs) => input(Object.assign({ inputMode: 'decimal', autocomplete: 'off' }, attrs));
    const f = {
        salary: moneyInput({ placeholder: 'مثال: 12,000' }),
        obligations: moneyInput({ placeholder: '0' }),
        age: num({ placeholder: 'بالسنوات', maxLength: 2 }),
        price: moneyInput({ placeholder: 'مثال: 1,000,000' }),
        down: moneyInput({ placeholder: 'مثال: 100,000' }),
        years: num({ placeholder: 'الأقصى المتاح', maxLength: 2 }),
        rate: num({ value: String(terms.rate) }),
        cap: num({ value: String(terms.cap) }),
        endAge: num({ value: String(terms.endAge) }),
        maxYears: num({ value: String(terms.maxYears) }),
        minDownPct: num({ value: String(terms.minDownPct) }),
        feePct: num({ value: String(terms.feePct) }),
        feeCap: moneyInput({ value: String(terms.feeCap) })
    };
    for (const key of Object.keys(f)) f[key].id = 'mort_' + key;
    // يُحفظ الشرط حين يغيّره المدير فقط، فلا يتجمد عنده رقم افتراضي قديم
    let touched = false;
    let appliedName = null; // جهة طُبّقت شروطها من جدول المقارنة، حتى يغيّر المدير شرطاً بيده
    for (const key of TERM_KEYS) f[key].addEventListener('input', () => { touched = true; appliedName = null; });

    // حقل يتغير سطر الشرح تحته بحسب النتيجة (نسبة الدفعة، أقصى مدة)
    const downHint = el('small', { class: 'hint' });
    const yearsHint = el('small', { class: 'hint' });
    const liveField = (label, control, hintNode) => el('div', { class: 'form-group' }, [
        el('label', { for: control.id, text: label }), control, hintNode
    ]);
    const termsSummary = el('summary');

    const node = el('form', { class: 'crm-card mort-form', noValidate: true, onsubmit: (e) => e.preventDefault() }, [
        el('div', { class: 'crm-card-head mort-form-head' }, [
            el('h2', { text: 'بيانات العميل والعقار' }),
            el('span', { class: 'mort-form-tools' }, [
                el('button', { type: 'button', class: 'link-btn', text: 'جرّب مثالاً', onclick: () => fill(EXAMPLE) }),
                el('button', { type: 'button', class: 'link-btn', text: 'مسح البيانات', onclick: () => fill(null) })
            ])
        ]),
        el('h3', { class: 'mort-group', text: 'العميل' }),
        el('div', { class: 'form-grid' }, [
            field('صافي الراتب الشهري', f.salary, { hint: 'الراتب المودع في الحساب البنكي' }),
            field('الالتزامات الشهرية', f.obligations, { hint: 'أقساط القروض والبطاقات القائمة' })
        ]),
        el('h3', { class: 'mort-group', text: 'العقار' }),
        el('div', { class: 'form-grid' }, [
            field('سعر العقار', f.price),
            liveField('الدفعة الأولى', f.down, downHint)
        ]),
        el('h3', { class: 'mort-group', text: 'العمر والمدة' }),
        el('div', { class: 'form-grid' }, [
            field('عمر العميل', f.age),
            liveField('مدة التمويل (سنوات)', f.years, yearsHint)
        ]),
        el('details', { class: 'mort-params' }, [
            termsSummary,
            el('div', { class: 'form-grid' }, [
                field('نسبة الربح السنوية %', f.rate, { hint: 'من عرض البنك. الافتراضي 6.7% يطابق حاسبة عون في 29/10/2026' }),
                field('حد الاستقطاع من الراتب %', f.cap, { hint: '55% في المبادئ، و65% لمستفيدي الدعم السكني. تحقق من سياسة البنك' }),
                field('آخر عمر للتمويل', f.endAge, { hint: 'ينتهي السداد قبله، بحسب البنك' }),
                field('أقصى مدة (سنوات)', f.maxYears),
                field('أقل دفعة أولى %', f.minDownPct, { hint: 'المتداول: 10% للمسكن الأول و30% لغيره. الحد الفعلي من البنك' }),
                field('الرسوم الإدارية %', f.feePct),
                field('أعلى رسوم إدارية (ر.س)', f.feeCap, { hint: 'السقف النظامي: 1% أو 5,000 ريال أيهما أقل' })
            ]),
            el('button', { type: 'button', class: 'link-btn', text: 'إعادة الشروط الافتراضية', onclick: resetTerms })
        ])
    ]);

    node.addEventListener('input', onChange);
    node.addEventListener('change', onChange);

    function read() {
        const v = {};
        for (const key of PERSONAL_KEYS) v[key] = parseNumber(f[key].value) || 0;
        // شرط فارغ يعود إلى قيمته الافتراضية في الحساب، والحقل نفسه يبقى فارغاً حتى يكمل المدير الكتابة
        for (const key of TERM_KEYS) {
            const n = parseNumber(f[key].value);
            v[key] = n === null ? TERMS[key] : n;
        }
        return v;
    }

    function update(r) {
        downHint.textContent = r.price > 0 ? pct(r.downPct) + ' من السعر' : 'اكتب سعر العقار لتظهر النسبة';
        yearsHint.textContent = r.age > 0 && r.limit > 0 ? 'الأقصى لهذا العميل: ' + yearsText(r.limit) : '';
        const isDefault = TERM_KEYS.every((key) => r[key] === TERMS[key]);
        const label = appliedName ? 'شروط ' + appliedName : 'شروط التمويل' + (isDefault ? ' (الافتراضية)' : '');
        termsSummary.textContent = label + ': ربح ' + fmt(r.rate) +
            '% · استقطاع ' + fmt(r.cap) + '% · حتى عمر ' + fmt(r.endAge) + ' · أقصى ' + yearsText(r.maxYears);
    }

    function fill(data) {
        for (const key of PERSONAL_KEYS) f[key].value = data ? data[key] : '';
        for (const key of MONEY_KEYS) f[key].dispatchEvent(new Event('blur'));
        onChange();
    }

    function resetTerms() {
        for (const key of TERM_KEYS) f[key].value = String(TERMS[key]);
        f.feeCap.dispatchEvent(new Event('blur'));
        touched = false;
        appliedName = null;
        clearTerms();
        onChange();
    }

    function applyTerms(terms, name) {
        for (const key of ['rate', 'cap', 'endAge', 'maxYears', 'minDownPct']) f[key].value = String(terms[key]);
        appliedName = name;
        onChange();
    }

    return { node, read, update, applyTerms, termsTouched: () => touched, appliedName: () => appliedName };
}

/* ===================== النتائج ===================== */

function kpis(r) {
    const live = r.status !== 'empty' && r.status !== 'no-term';
    const financing = live && r.needed > 0;
    const over = financing && r.dbr > r.cap + 0.05;
    let maxSub = 'اكتب الراتب والعمر';
    if (live) maxSub = 'بقسط حتى ' + money(Math.round(r.room)) + ' ر.س شهرياً';
    else if (r.status === 'no-term') maxSub = 'لا مدة متاحة';
    let installmentSub = '';
    if (financing) installmentSub = 'ربح ' + fmt(r.rate) + '% على ' + yearsText(r.years);
    else if (live) installmentSub = r.price > 0 ? 'لا تمويل مطلوب' : 'اكتب سعر العقار';
    return [
        kpi('أقصى تمويل ممكن', live ? money(Math.round(r.maxFinance)) : '—', maxSub, live ? 'ر.س' : ''),
        kpi('القسط الشهري', financing ? money(Math.round(r.installment)) : '—', installmentSub, financing ? 'ر.س' : ''),
        kpi('نسبة الاستقطاع', financing ? pct(r.dbr) : '—',
            financing ? 'الحد ' + pct(r.cap) + (over ? ' · تجاوز' : '') : '', '', over ? 'kpi-late' : '')
    ];
}

function kpi(label, value, sub, unit, tone) {
    return el('div', { class: 'kpi' + (tone ? ' ' + tone : '') }, [
        el('span', { class: 'kpi-label', text: label }),
        el('span', { class: 'kpi-num' }, [el('span', { text: value }), unit ? el('span', { class: 'kpi-unit', text: unit }) : null]),
        el('span', { class: 'kpi-sub', text: sub })
    ]);
}

function details(r, cmp) {
    if (r.status === 'empty') {
        return empty('اكتب صافي الراتب والعمر', 'فيظهر أقصى تمويل يناسب العميل. أو اضغط «جرّب مثالاً».');
    }
    if (r.status === 'no-term') {
        return empty('لا مدة متاحة للتمويل', r.age >= r.endAge
            ? 'عمر العميل بلغ آخر عمر للتمويل (' + fmt(r.endAge) + '). عدّل «شروط التمويل» إن كان البنك يقبل أكثر.'
            : 'أقصى مدة في «شروط التمويل» صفر.');
    }

    const notes = [];
    const say = (tone, title, text) => notes.push(badge(title, tone), el('span', { text: text }));
    if (r.status === 'fits') {
        say('green', 'ضمن قدرة العميل', 'يبقى ' + money(Math.round(r.maxFinance - r.needed)) + ' ر.س من أقصى تمويل ممكن.');
    } else if (r.status === 'short') {
        say('red', 'ينقص ' + money(Math.round(r.gap)) + ' ر.س', 'ارفع الدفعة الأولى إلى ' + money(Math.round(r.downNeeded)) + ' ر.س، أو اختر عقاراً أقل سعراً.');
    } else if (r.status === 'covered') {
        say('green', 'لا حاجة لتمويل', 'الدفعة الأولى تغطي سعر العقار كاملاً.');
    } else {
        say('neutral', 'اكتب سعر العقار', 'ليظهر القسط والرسوم.');
    }
    if (r.clamped) {
        say('orange', 'قُصّرت المدة إلى ' + yearsText(r.years),
            r.limit < r.maxYears ? 'حتى ينتهي السداد قبل عمر ' + fmt(r.endAge) + '.' : 'أقصى مدة في الشروط ' + yearsText(r.maxYears) + '.');
    }
    if (r.downShort) {
        say('orange', 'الدفعة أقل من ' + pct(r.minDownPct), 'أقلها هنا ' + money(Math.round(r.minDown)) + ' ر.س بحسب الشروط.');
    }

    const financing = r.status === 'fits' || r.status === 'short';
    const rows = [];
    if (r.price > 0) rows.push(['سعر العقار', money(Math.round(r.price)) + ' ر.س'], ['الدفعة الأولى', money(Math.round(r.down)) + ' ر.س (' + pct(r.downPct) + ')']);
    if (r.needed > 0) rows.push(['مبلغ التمويل', money(Math.round(r.needed)) + ' ر.س']);
    rows.push(['مدة التمويل', yearsText(r.years) + ' (' + r.months + ' قسطاً)، حتى عمر ' + fmt(r.endsAt)]);
    if (financing) {
        rows.push(
            ['القسط الشهري', money(Math.round(r.installment)) + ' ر.س'],
            ['إجمالي الأرباح', money(Math.round(r.profit)) + ' ر.س'],
            ['إجمالي الأقساط', money(Math.round(r.totalPaid)) + ' ر.س'],
            ['الرسوم الإدارية', money(Math.round(r.fee)) + ' ر.س (' + fmt(r.feePct) + '% بسقف ' + money(r.feeCap) + ')']
        );
    }
    if (r.downRaw > 0) rows.push(['أعلى سعر يناسبه بهذه الدفعة', money(Math.round(r.affordablePrice)) + ' ر.س']);

    return [
        el('div', { class: 'mort-status' }, notes),
        el('table', { class: 'mort-table' }, [el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [el('th', { scope: 'row', text: k }), el('td', { text: v })])))]),
        compareBlock(r, cmp),
        r.schedule.length ? el('details', { class: 'mort-more' }, [
            el('summary', { text: 'الرصيد سنة بسنة' }),
            el('div', { class: 'mort-sched-wrap' }, [el('table', { class: 'crm-table mort-sched-table' }, [
                el('thead', {}, [el('tr', {}, ['السنة', 'المسدد من الأصل', 'الأرباح', 'المتبقي'].map((t) => el('th', { text: t })))]),
                el('tbody', {}, r.schedule.map((row) => el('tr', {}, [
                    el('td', { text: String(row.year) }),
                    el('td', { text: money(Math.round(row.capital)) }),
                    el('td', { text: money(Math.round(row.interest)) }),
                    el('td', { text: money(Math.round(row.balance)) })
                ])))
            ])])
        ]) : null,
        sources()
    ];
}

// «حسب جهة التمويل»: بالسعر مكتوباً تُرتَّب بالقسط الأقل، وبلا سعر بأعلى تمويل
function compareBlock(r, cmp) {
    if (!cmp || !cmp.list.length) return null;
    const byPrice = r.price > 0;
    const cost = (x) => (x.months > 0 && x.needed > 0 ? x.installment : Infinity);
    const rows = cmp.list.slice().sort((a, b) => (byPrice ? cost(a.r) - cost(b.r) : b.r.maxFinance - a.r.maxFinance));
    const go = (e) => (ev) => {
        if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        cmp.pick(e);
    };
    return el('details', { class: 'mort-more mort-compare', open: true }, [
        el('summary', { text: 'حسب جهة التمويل' }),
        el('div', { class: 'mort-sched-wrap' }, [el('table', { class: 'crm-table mort-compare-table' }, [
            el('thead', {}, [el('tr', {}, ['الجهة', 'النسبة', byPrice ? 'القسط' : 'أعلى قسط', 'أقصى تمويل'].map((t) => el('th', { text: t })))]),
            el('tbody', {}, rows.map(({ e, r: x, st }) => el('tr', {
                class: 'clickable' + (e.name === cmp.on ? ' is-on' : ''), tabIndex: 0,
                title: 'تطبيق شروط ' + e.name, onclick: go(e), onkeydown: go(e)
            }, [
                el('td', {}, [
                    el('span', { text: e.name }),
                    x.status === 'short' ? badge('ينقص', 'red') : null,
                    st.stale ? badge('قديمة', 'orange') : null
                ]),
                el('td', { text: fmt(e.rate) + '%' }),
                el('td', { text: x.months > 0 && (!byPrice || x.needed > 0) ? money(Math.round(byPrice ? x.installment : x.room)) : '—' }),
                el('td', { text: x.months > 0 ? money(Math.round(x.maxFinance)) : '—' })
            ])))
        ])]),
        el('p', { class: 'hint', text: 'اضغط جهة لتطبيق شروطها على الحساب. «قديمة»: لم تُؤكَّد نسبتها منذ شهر. النسب يحدّثها المساعد في «جهات التمويل».' })
    ]);
}

function sources() {
    const items = [
        'الحساب: قسط شهري ثابت على الرصيد المتناقص بنسبة ربح سنوية. إن كان عرض البنك بنسبة ثابتة على أصل المبلغ فالقسط يختلف.',
        'يُفترض بقاء الالتزامات الحالية طوال المدة، ولا يُحسب الدعم السكني.',
        'حد الاستقطاع: مبادئ التمويل المسؤول للأفراد (البنك المركزي 2018) تحدده بـ55% من الراتب، و65% لمستفيدي الدعم السكني. وذكرت «الاقتصادية» في 27/9/2025 أن بنوكاً خفّضته إلى 55% لمن راتبه دون 15 ألفاً. تحقق من سياسة البنك الحالية.',
        'الرسوم الإدارية: سقف 1% من مبلغ التمويل أو 5,000 ريال أيهما أقل (قواعد البنك المركزي، المادة 9: رسوم وعمولات).',
        'الافتراضي معايَر على حاسبة «عون» المرخصة في 29/10/2026: لموظف حكومي براتب صافٍ 12,000 أعطت قسط 6,189 لتمويل 900,000 على 25 سنة، وأقصى تمويل 959,686. حاسبتنا تعطي الأرقام نفسها بربح 6.7%. آخر عمر 60 افتراض، والفعلي من عرض البنك.'
    ];
    return el('details', { class: 'mort-more mort-sources' }, [
        el('summary', { text: 'طريقة الحساب ومصادر الأرقام' }),
        el('ul', {}, items.map((text) => el('li', { text: text })))
    ]);
}

function summaryText(r) {
    return [
        'تقدير التمويل العقاري — ملائم',
        'سعر العقار: ' + money(Math.round(r.price)) + ' ر.س',
        'الدفعة الأولى: ' + money(Math.round(r.down)) + ' ر.س (' + pct(r.downPct) + ')',
        'مبلغ التمويل: ' + money(Math.round(r.needed)) + ' ر.س',
        'المدة: ' + yearsText(r.years) + ' · نسبة الربح ' + fmt(r.rate) + '%',
        'القسط الشهري التقريبي: ' + money(Math.round(r.installment)) + ' ر.س',
        'الأرقام تقديرية، والعرض النهائي من جهة التمويل.'
    ].join('\n');
}

/* ===================== أدوات صغيرة ===================== */

function fmt(x) { return Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '—'; }
function pct(x) { return fmt(Math.round(x * 10) / 10) + '%'; }

// عدد السنوات بصيغته العربية: سنة، سنتان، 3 سنوات … 10 سنوات، 11 سنة …
function yearsText(n) {
    if (n === 1) return 'سنة';
    if (n === 2) return 'سنتان';
    return n + (n >= 3 && n <= 10 ? ' سنوات' : ' سنة');
}

function loadTerms() {
    const terms = Object.assign({}, TERMS);
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (saved && typeof saved === 'object') {
            for (const key of TERM_KEYS) if (Number.isFinite(saved[key])) terms[key] = saved[key];
        }
    } catch (error) { /* متصفح يمنع التخزين أو قيمة تالفة: نبدأ بالافتراضي */ }
    return terms;
}

function clearTerms() {
    try { localStorage.removeItem(STORE_KEY); } catch (error) { /* لا شيء */ }
}

function saveTerms(values) {
    try {
        const out = {};
        for (const key of TERM_KEYS) out[key] = values[key];
        localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (error) { /* لا شيء */ }
}
