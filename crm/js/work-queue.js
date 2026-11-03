// «عملي اليوم»: حساب صافٍ لقائمة «يحتاج إجراء» ولـ«مساري» (بلا DOM ولا شبكة، يُختبر وحده في tests/work-queue.test.mjs).
//
// القائمة واحدة لأن الموظف يبدأ يومه من سؤال واحد: ماذا ينتظرني؟ والترتيب ثابت لأن السبب نفسه يقول الأولوية:
//   1) متابعات فات يومها (الأقدم أولاً): عميل ينتظر منذ أيام،
//   2) صفقات جارية واقفة أكثر من STUCK_DAYS في مرحلتها (الأطول وقوفاً أولاً): مال يبرد،
//   3) مواعيد اليوم (بوقتها)،
//   4) عروضي التي تنتظر اعتماد المدير (الأقدم انتظاراً أولاً): لا يملك الوسيط فيها إلا أن يعرف.
// ما يُفعل في كل سطر (اتصال، «تم»، نقل الصفقة) في work.js؛ هنا الترتيب والتصفية والعدّ ونصوص حبّة السبب.
//
// «مساري» خمس خطوات بأعداد المدة المختارة: مشاركة ← عميل ← معاينة ← عربون ← تمت. كل خطوة نسبتها من التي قبلها، وطول
// شريطها من الخطوة الأولى. الأعداد أحداث في المدة لا دفعة واحدة من العملاء، فقد تزيد خطوة على التي قبلها (تُكتب كما هي).
// «معاينة» تعريف واحد: عدد العملاء الذين عاينوا في المدة، كل عميل مرة واحدة — أُنجزت له متابعة بقناة «زيارة» أو دخلت
// صفقته مرحلة «معاينة». السجلّان يصفان المعاينة نفسها في أحيان كثيرة، فالعدّ بالعميل لا بالسطر حتى لا تُحسب مرتين.

import { stageOf, nextStage, enteredAt, daysSince, isStuck, STUCK_DAYS, expectedCommission, daysText } from './deal-path.js';

/* ===================== القائمة ===================== */

// كم سطراً يظهر قبل «عرض الكل»: ما يتسع فوق الطيّة على الكمبيوتر مع الأرقام
export const QUEUE_PREVIEW = 7;
export const QUEUE_KINDS = ['late', 'stuck', 'today', 'wait'];

export const QUEUE_FILTERS = [
    { value: 'all', label: 'الكل' },
    { value: 'late', label: 'متأخر' },
    { value: 'stuck', label: 'واقف' },
    { value: 'today', label: 'موعد اليوم' },
    { value: 'wait', label: 'عند المدير' }
];

// الحبّات بحسب ما يخص الموظف: «واقف» لمن له صفقات (لا لمركز الاتصال)، و«عند المدير» لمن تنتظر عروضه اعتماداً (الوسيط)
export function queueFilters({ deals = true, offers = true } = {}) {
    return QUEUE_FILTERS.filter((f) => (f.value !== 'stuck' || deals) && (f.value !== 'wait' || offers));
}

// الأيام التقويمية بالتوقيت المحلي (منتصف ليل إلى منتصف ليل)، لا الساعات التي مرّت: متابعة موعدها أمس الحادية عشرة
// ليلاً متأخرة يوماً واحداً صباح اليوم. null لوقت غير صالح. Math.round يمتص يوماً من 23 أو 25 ساعة حيث يتغيّر التوقيت.
export function calendarDays(fromIso, now = Date.now()) {
    const t = Date.parse(fromIso);
    if (!Number.isFinite(t)) return null;
    const from = new Date(t);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(0, 0, 0, 0);
    return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// متأخرة منذ كم يوم: يوم واحد على الأقل، فما في قائمة المتأخرة فات يومه أصلاً
export function lateDays(dueIso, now = Date.now()) {
    const days = calendarDays(dueIso, now);
    return days === null ? null : Math.max(1, days);
}

const time = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Infinity;
};
const byId = (a, b) => String(a).localeCompare(String(b));
const byStuck = (a, b) => (b.days - a.days) || (time(a.entered) - time(b.entered)) || byId(a.deal.id, b.deal.id);

// صفقات الموظف من كل ما تُريه سياسة deals_select (007): الوسيط يرى أيضاً صفقة أنشأها ثم جعل المدير وسيطها غيره
// (created_by)، وهي ليست له: لا يملك نقلها (deals_update لوسيطها وحده) ولا تُحسب له عمولتها. فلا تدخل عدّه ولا «واقف»
// ولا «عمولتي». everyone للمدير: الفريق كله، كبقية صفحته.
export function ownDeals(deals, userId, everyone = false) {
    const list = (deals || []).filter(Boolean);
    if (everyone) return list;
    if (userId === null || userId === undefined || userId === '') return [];
    return list.filter((deal) => String(deal.broker_id) === String(userId));
}

// الصفقات الجارية الواقفة: مضى على مرحلتها الحالية أكثر من الحد. سجل مراحل كل صفقة في deal.history
// ({ to_stage, changed_at } كما يضمّنه استعلام work.js من deal_stage_history)، ودخول المرحلة من enteredAt.
// الأطول وقوفاً أولاً، ثم الأقدم دخولاً، ثم المعرّف: ترتيب ثابت بين تحميلين فلا تتقافز السطور.
export function stuckDeals(deals, stages, now = Date.now(), limit = STUCK_DAYS) {
    const out = [];
    for (const deal of deals || []) {
        if (!deal) continue;
        const stage = stageOf(stages, deal.stage_id);
        if (!stage || stage.is_terminal) continue;
        const history = (Array.isArray(deal.history) ? deal.history : [])
            .filter(Boolean)
            .map((h) => ({ deal_id: deal.id, to_stage: h.to_stage, changed_at: h.changed_at }));
        const entered = enteredAt(deal, history);
        const days = daysSince(entered, now);
        if (!isStuck(stage, days, limit)) continue;
        out.push({ deal, stage, next: nextStage(stages, deal.stage_id), entered, days });
    }
    return out.sort(byStuck);
}

function byDue(rows) {
    return (rows || [])
        .filter((row) => row && Number.isFinite(Date.parse(row.due_at)))
        .sort((a, b) => (Date.parse(a.due_at) - Date.parse(b.due_at)) || byId(a.id, b.id));
}

// القائمة الواحدة بترتيب الأولوية. overdue وtoday سطور follow_ups، وstuck ناتج stuckDeals، وwaiting مشاريع
// «بانتظار الاعتماد» ({ id, name, updated_at, date_added }). كل عنصر { kind, key, row, at, … }:
//   late  → days (أيام التأخر)،  stuck → stage, next, days،  today → passed (حان وقته)،  wait → days (منذ الإرسال).
export function buildQueue({ overdue = [], stuck = [], today = [], waiting = [] } = {}, now = Date.now()) {
    const late = byDue(overdue).map((row) => ({ kind: 'late', key: 'f' + row.id, row, at: row.due_at, days: lateDays(row.due_at, now) }));
    const stuckItems = (stuck || []).filter((s) => s && s.deal).slice().sort(byStuck).map((s) => ({
        kind: 'stuck', key: 'd' + s.deal.id, row: s.deal, at: s.entered, stage: s.stage, next: s.next || null, days: s.days
    }));
    const todayItems = byDue(today).map((row) => ({ kind: 'today', key: 'f' + row.id, row, at: row.due_at, passed: Date.parse(row.due_at) <= now }));
    const wait = (waiting || []).filter(Boolean).map((project) => {
        // updated_at يتحرك مع كل إرسال أو تعديل يعيد العرض «بانتظار الاعتماد» (016)؛ date_added احتياط
        const since = project.updated_at || project.date_added || null;
        return { kind: 'wait', key: 'p' + project.id, row: project, at: since, days: daysSince(since, now) };
    }).sort((a, b) => (time(a.at) - time(b.at)) || byId(a.row.id, b.row.id));
    return late.concat(stuckItems, todayItems, wait);
}

// أعداد الحبّات: العدد الكامل لكل سبب (count من الخادم، فقد يزيد على ما حُمِّل)، و«الكل» مجموعها
export function queueTotals(totals = {}) {
    const n = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : 0);
    const out = { late: n(totals.late), stuck: n(totals.stuck), today: n(totals.today), wait: n(totals.wait) };
    out.all = out.late + out.stuck + out.today + out.wait;
    return out;
}

export function filterQueue(items, filter = 'all') {
    const list = (items || []).filter(Boolean);
    return !filter || filter === 'all' ? list : list.filter((item) => item.kind === filter);
}

// ما يُرسم الآن للحبّة المختارة: أول limit ما لم يُفتح «عرض الكل».
//   total   العدد الكامل (عنوان «عرض الكل (N)»)،  toggle  هل يلزم الزر أصلاً،
//   more    ما لم يُحمَّل من كل سبب ({ late: 37 }) لأن work.js يحمّل حداً من كل مصدر: يُعرض بعد آخر سطر رابطاً إلى صفحته.
export function queueView(items, totals, filter = 'all', expanded = false, limit = QUEUE_PREVIEW) {
    const t = queueTotals(totals);
    const all = !filter || filter === 'all';
    const list = filterQueue(items, filter);
    const total = Math.max(all ? t.all : (t[filter] || 0), list.length);
    const shown = expanded ? list : list.slice(0, limit);
    const loaded = {};
    for (const item of list) loaded[item.kind] = (loaded[item.kind] || 0) + 1;
    const more = {};
    if (expanded) {
        for (const kind of QUEUE_KINDS) {
            if (!all && filter !== kind) continue;
            const missing = t[kind] - (loaded[kind] || 0);
            if (missing > 0) more[kind] = missing;
        }
    }
    return { shown, total, toggle: total > limit, more };
}

// المدة بعد «متأخر» و«واقف» و«من»: المثنى منصوب أو مجرور («متأخر يومين»، «من يومين»)، لا «يومان» كما يكتبها daysText
// وحدها. بقية الأعداد كما هي («يوم واحد»، «3 أيام»، «15 يوماً»).
const daysAfter = (days) => (days === 2 ? 'يومين' : daysText(days));

// نص حبّة السبب. وقت «موعد اليوم» يكتبه work.js بتنسيق المتصفح، فلا نص له هنا.
export function reasonText(item) {
    if (!item) return '';
    if (item.kind === 'late') return item.days > 0 ? 'متأخر ' + daysAfter(item.days) : 'متأخر';
    if (item.kind === 'stuck') {
        return 'واقف ' + daysAfter(item.days) + (item.stage && item.stage.name_ar ? ' في «' + item.stage.name_ar + '»' : '');
    }
    if (item.kind === 'wait') {
        return item.days === null || item.days === undefined ? 'عند المدير' : 'عند المدير · من ' + daysAfter(item.days);
    }
    return '';
}

// الإجراء الرئيسي لسطر الصفقة الواقفة: نقلها إلى المرحلة التالية بضغطة. «تمت» لا تُنقل من هنا لأنها تحتاج السعر النهائي
// (منه تُنشأ العمولة)، ومن لا يملك نقل الصفقة (صفقة أنشأها ووسيطها غيره) يُفتح له بابها بدل زر يرفضه الخادم.
export function dealAction(item, { canMove = true } = {}) {
    const next = item && item.next;
    if (!next || next.is_terminal || !canMove) return { type: 'open' };
    return { type: 'move', stage: next, label: 'انقله إلى: ' + next.name_ar };
}

// أقرب موعد لم يحن بعد بين مواعيد اليوم، أو null إن حانت كلها
export function nextUpcoming(rows, now = Date.now()) {
    let best = null;
    let bestTime = Infinity;
    for (const row of rows || []) {
        const t = Date.parse(row && row.due_at);
        if (!Number.isFinite(t) || t <= now || t >= bestTime) continue;
        best = row;
        bestTime = t;
    }
    return best;
}

/* ===================== العمولة المتوقعة ===================== */

const rateValue = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// نسبة الصفقة كما يحسبها الخادم عند «تمت» (commissions_apply_rate في 037، وeffectiveDealRate في deal.js): نسبة مشروعها
// إن كانت له نسبة خاصة، وإلا النسبة العامة. projectRates: Map أو كائن من project_id إلى النسبة.
export function effectiveRate(projectId, projectRates, defaultRate) {
    if (projectId !== null && projectId !== undefined && projectRates) {
        const own = projectRates instanceof Map
            ? (projectRates.has(Number(projectId)) ? projectRates.get(Number(projectId)) : projectRates.get(String(projectId)))
            : projectRates[projectId];
        const rate = rateValue(own);
        if (rate !== null) return rate;
    }
    return rateValue(defaultRate);
}

// مجموع العمولة المتوقعة لصفقات جارية: القيمة × نسبتها لكل صفقة. counted ما دخل المجموع، وmissing ما لا قيمة له أو لا
// نسبة، فلا يُقال رقم أكبر مما هو.
export function expectedTotal(deals, projectRates, defaultRate) {
    let total = 0;
    let counted = 0;
    let missing = 0;
    for (const deal of deals || []) {
        if (!deal) continue;
        const value = expectedCommission(deal.amount, effectiveRate(deal.project_id, projectRates, defaultRate));
        if (value === null) missing += 1;
        else { total += value; counted += 1; }
    }
    return { total: Math.round(total * 100) / 100, counted, missing };
}

/* ===================== «مساري» ===================== */

export const PATH_PERIODS = [7, 30, 90];
export const PATH_DEFAULT = 30;
export const PATH_STEPS = [
    { key: 'shared', label: 'مشاركة' },
    { key: 'clients', label: 'عميل' },
    { key: 'viewing', label: 'معاينة' },
    { key: 'deposit', label: 'عربون' },
    { key: 'won', label: 'تمت' }
];

// أول المدة: منتصف ليل أول يوم فيها بالتوقيت المحلي، واليوم منها («7 أيام» = اليوم وستة قبله)
export function periodStart(days, now = Date.now()) {
    const span = Math.max(1, Math.floor(Number(days)) || 1);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));
    return start;
}

export function distinctCount(values) {
    const seen = new Set();
    for (const v of values || []) {
        if (v === null || v === undefined || v === '') continue;
        seen.add(String(v));
    }
    return seen.size;
}

// «معاينة»: العملاء المختلفون في السجلّين معاً. visits سطور follow_ups ({ client_id })، وmoves سطور deal_stage_history
// إلى «معاينة» بعميل صفقتها ({ deal_id, deal: { client_id } }). سطر بلا عميل يُعدّ بصفقته حتى لا يضيع.
export function viewingCount(visits, moves) {
    const ids = [];
    for (const visit of visits || []) ids.push(visit && visit.client_id);
    for (const move of moves || []) {
        if (!move) continue;
        const client = move.client_id || (move.deal && move.deal.client_id);
        ids.push(client || (move.deal_id ? 'deal:' + move.deal_id : null));
    }
    return distinctCount(ids);
}

const countValue = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

// الخطوات الخمس جاهزة للرسم: count (null حين تعذّر حسابها)، وpct نسبتها من التي قبلها (null للأولى، أو حين تكون التي
// قبلها صفراً أو تعذّرت)، وwidth طول الشريط بالمئة من الخطوة الأولى (ومن أكبرها إن كانت الأولى صفراً). أي عدد فوق الصفر
// يظهر شريطه ولو قصيراً (2% على الأقل)، ولا يتجاوز شريط 100%.
export function pathSteps(counts = {}) {
    const values = PATH_STEPS.map((step) => countValue(counts[step.key]));
    const first = values[0];
    const base = first > 0 ? first : Math.max(0, ...values.filter((v) => v !== null));
    return PATH_STEPS.map((step, i) => {
        const count = values[i];
        const prev = i > 0 ? values[i - 1] : null;
        const pct = i > 0 && count !== null && prev > 0 ? Math.round((count / prev) * 100) : null;
        const width = count > 0 && base > 0 ? Math.max(2, Math.min(100, Math.round((count / base) * 1000) / 10)) : 0;
        return { key: step.key, label: step.label, count, pct, width };
    });
}
