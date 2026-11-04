// اختبار crm/js/work-queue.js: ترتيب قائمة «يحتاج إجراء» وتصفيتها وعدّها و«عرض الكل»، ونصوص حبّة السبب، وصفقاتي من بين ما
// تُريه السياسة، والصفقات الواقفة،
// والإجراء الرئيسي لسطر الصفقة، والعمولة المتوقعة بنسبة المشروع أو العامة، وخطوات «مساري» ونسبها وأطوال أشرطتها.
// الأوقات تُبنى بالتوقيت المحلي (new Date(سنة، شهر، يوم، ساعة)) فلا تتغيّر النتيجة بتوقيت الجهاز الذي يشغّل الاختبار.
// التشغيل: node tests/work-queue.test.mjs   أو   deno run tests/work-queue.test.mjs
import {
    QUEUE_PREVIEW, QUEUE_FILTERS, queueFilters, calendarDays, lateDays, ownDeals, stuckDeals, buildQueue, queueTotals, filterQueue,
    queueView, reasonText, dealAction, nextUpcoming, effectiveRate, expectedTotal, PATH_PERIODS, PATH_DEFAULT, PATH_STEPS,
    periodStart, distinctCount, viewingCount, pathSteps
} from '../crm/js/work-queue.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// المراحل كما في 007_deals_commissions.sql، عمداً بغير ترتيب
const STAGES = [
    { id: 6, key: 'closed_won', name_ar: 'تمت', sort_order: 6, is_terminal: true, is_won: true },
    { id: 3, key: 'negotiation', name_ar: 'تفاوض', sort_order: 3, is_terminal: false, is_won: false },
    { id: 1, key: 'new', name_ar: 'اهتمام جدي', sort_order: 1, is_terminal: false, is_won: false },
    { id: 7, key: 'closed_lost', name_ar: 'خسرت', sort_order: 7, is_terminal: true, is_won: false },
    { id: 5, key: 'contract', name_ar: 'عقد وإفراغ', sort_order: 5, is_terminal: false, is_won: false },
    { id: 2, key: 'viewing', name_ar: 'معاينة', sort_order: 2, is_terminal: false, is_won: false },
    { id: 4, key: 'deposit', name_ar: 'عربون', sort_order: 4, is_terminal: false, is_won: false }
];
const stage = (id) => STAGES.find((s) => s.id === id);

// «الآن»: الثلاثاء 3 نوفمبر 2026 العاشرة صباحاً بالتوقيت المحلي
const at = (month, day, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();
const NOW = new Date(2026, 10, 3, 10, 0).getTime();
const daysAgo = (n, hour = 9) => new Date(2026, 10, 3 - n, hour, 0).toISOString();

/* ---------- الحبّات ---------- */

t('filters: all five by default', queueFilters().map((f) => f.value).join(',') === 'all,late,stuck,today,wait');
t('filters: call center has no stuck/wait', queueFilters({ deals: false, offers: false }).map((f) => f.value).join(',') === 'all,late,today');
t('filters: admin has no wait', queueFilters({ deals: true, offers: false }).map((f) => f.value).join(',') === 'all,late,stuck,today');
t('filters: labels in Arabic', QUEUE_FILTERS.map((f) => f.label).join('|') === 'الكل|متأخر|واقف|موعد اليوم|عند المدير');
t('preview is 7 rows', QUEUE_PREVIEW === 7);

/* ---------- الأيام ---------- */

t('calendar days: yesterday 23:30 = 1', calendarDays(at(11, 2, 23, 30), NOW) === 1);
t('calendar days: two days ago morning = 2', calendarDays(at(11, 1, 8), NOW) === 2);
t('calendar days: earlier today = 0', calendarDays(at(11, 3, 7), NOW) === 0);
t('calendar days: across a month = 9', calendarDays(at(10, 25, 18), NOW) === 9);
t('calendar days: bad date = null', calendarDays('nope', NOW) === null && calendarDays(null, NOW) === null);
t('late days: at least one', lateDays(at(11, 3, 7), NOW) === 1 && lateDays(at(11, 1, 8), NOW) === 2);
t('late days: bad date = null', lateDays(undefined, NOW) === null);

/* ---------- الصفقات الواقفة ---------- */

const DEALS = [
    // معاينة منذ 20 يوماً (دخلها بعد اهتمام جدي)
    { id: 'd1', stage_id: 2, created_at: daysAgo(40), history: [{ to_stage: 1, changed_at: daysAgo(40) }, { to_stage: 2, changed_at: daysAgo(20) }] },
    // تفاوض منذ 5 أيام: ليست واقفة
    { id: 'd2', stage_id: 3, created_at: daysAgo(60), history: [{ to_stage: 3, changed_at: daysAgo(5) }] },
    // عربون بلا سجل: دخولها من created_at قبل 30 يوماً
    { id: 'd3', stage_id: 4, created_at: daysAgo(30), history: [] },
    // تمت قديمة: المغلقة لا تقف
    { id: 'd4', stage_id: 6, created_at: daysAgo(90), history: [{ to_stage: 6, changed_at: daysAgo(80) }] },
    // عادت إلى اهتمام جدي قبل 16 يوماً: العبرة بآخر دخول للمرحلة الحالية
    { id: 'd5', stage_id: 1, created_at: daysAgo(50), history: [{ to_stage: 1, changed_at: daysAgo(50) }, { to_stage: 2, changed_at: daysAgo(30) }, { to_stage: 1, changed_at: daysAgo(16) }] },
    // عقد وإفراغ منذ 14 يوماً بالضبط: على الحد، ليست واقفة
    { id: 'd6', stage_id: 5, created_at: daysAgo(20), history: [{ to_stage: 5, changed_at: new Date(NOW - 14 * 86400000).toISOString() }] },
    // معاينة منذ 20 يوماً أيضاً لكن دخلتها أبكر بساعات: قبل d1
    { id: 'd7', stage_id: 2, created_at: daysAgo(25), history: [{ to_stage: 2, changed_at: daysAgo(20, 7) }] },
    null
];
const stuck = stuckDeals(DEALS, STAGES, NOW);
t('stuck: only open deals over 14 days', stuck.map((s) => s.deal.id).join(',') === 'd3,d7,d1,d5', stuck.map((s) => s.deal.id));
t('stuck: days in stage', stuck.map((s) => s.days).join(',') === '30,20,20,16', stuck.map((s) => s.days));
t('stuck: next stage after عربون = عقد وإفراغ', stuck[0].next.id === 5 && stuck[0].stage.name_ar === 'عربون');
t('stuck: next after اهتمام جدي = معاينة', stuck[3].next.id === 2);
t('stuck: entered from history, else created_at', stuck[2].entered === daysAgo(20) && stuck[0].entered === daysAgo(30));
t('stuck: custom limit', stuckDeals(DEALS, STAGES, NOW, 25).map((s) => s.deal.id).join(',') === 'd3');
t('stuck: nothing in, nothing out', stuckDeals(null, STAGES, NOW).length === 0 && stuckDeals(DEALS, [], NOW).length === 0);

/* ---------- صفقاتي ---------- */

// u1 وسيط: d1 وd3 له، وd2 أنشأها ثم جعل المدير وسيطها u2 (يراها الوسيط بسياسة created_by)
const SEEN = [
    { id: 'd1', broker_id: 'u1', created_by: 'u1' },
    { id: 'd2', broker_id: 'u2', created_by: 'u1' },
    { id: 'd3', broker_id: 'u1', created_by: 'admin' },
    null
];
t('own deals: a broker keeps only deals he is the broker of', ownDeals(SEEN, 'u1').map((d) => d.id).join(',') === 'd1,d3');
t('own deals: the admin keeps the whole team', ownDeals(SEEN, 'admin', true).map((d) => d.id).join(',') === 'd1,d2,d3');
t('own deals: unknown user = none', ownDeals(SEEN, null).length === 0 && ownDeals(SEEN, '').length === 0);
t('own deals: nothing in, nothing out', ownDeals(null, 'u1').length === 0 && ownDeals(undefined, 'u1', true).length === 0);
// المبنية على صفقاتي وحدها: صفقة d2 الواقفة لا تظهر للوسيط الذي لا يملك نقلها
t('own deals: stuck only from my deals', stuckDeals(ownDeals([
    { id: 'm1', broker_id: 'u1', stage_id: 2, created_at: daysAgo(30), history: [] },
    { id: 'm2', broker_id: 'u2', stage_id: 2, created_at: daysAgo(40), history: [] }
], 'u1'), STAGES, NOW).map((s) => s.deal.id).join(',') === 'm1');

/* ---------- القائمة الواحدة ---------- */

const OVERDUE = [
    { id: 'f2', due_at: at(11, 2, 16), channel: 'call' },
    { id: 'f1', due_at: at(10, 30, 11), channel: 'visit' },
    { id: 'f3', due_at: 'bad' }
];
const TODAY = [
    { id: 'f5', due_at: at(11, 3, 16, 30), channel: 'call' },
    { id: 'f4', due_at: at(11, 3, 9, 15), channel: 'visit' }
];
const WAITING = [
    { id: 11, name: 'برج الصفا', updated_at: daysAgo(1), date_added: null },
    { id: 12, name: 'فيلا الياسمين', updated_at: null, date_added: daysAgo(6) }
];
const queue = buildQueue({ overdue: OVERDUE, stuck, today: TODAY, waiting: WAITING }, NOW);
t('queue: kinds in priority order', queue.map((i) => i.kind).join(',') === 'late,late,stuck,stuck,stuck,stuck,today,today,wait,wait', queue.map((i) => i.kind));
t('queue: overdue oldest first', queue[0].row.id === 'f1' && queue[1].row.id === 'f2');
t('queue: overdue days', queue[0].days === 4 && queue[1].days === 1, [queue[0].days, queue[1].days]);
t('queue: bad dates dropped', !queue.some((i) => i.row && i.row.id === 'f3'));
t('queue: stuck longest first', queue.slice(2, 6).map((i) => i.row.id).join(',') === 'd3,d7,d1,d5');
t('queue: today by time, passed flag', queue[6].row.id === 'f4' && queue[6].passed === true && queue[7].row.id === 'f5' && queue[7].passed === false);
t('queue: waiting oldest first (date_added fallback)', queue[8].row.id === 12 && queue[8].days === 6 && queue[9].row.id === 11 && queue[9].days === 1);
t('queue: keys unique per source', new Set(queue.map((i) => i.key)).size === queue.length && queue[0].key === 'ff1' && queue[2].key === 'dd3' && queue[8].key === 'p12');
t('queue: empty input', buildQueue({}, NOW).length === 0 && buildQueue(undefined, NOW).length === 0);

/* ---------- العدّ والتصفية و«عرض الكل» ---------- */

const totals = queueTotals({ late: 2, stuck: 4, today: '2', wait: 2 });
t('totals: all = sum', totals.all === 10 && totals.today === 2);
t('totals: junk = 0', JSON.stringify(queueTotals({ late: -3, stuck: 'x', today: null })) === JSON.stringify({ late: 0, stuck: 0, today: 0, wait: 0, all: 0 }));
t('filter: all keeps order', filterQueue(queue, 'all').length === 10 && filterQueue(queue).length === 10);
t('filter: by reason', filterQueue(queue, 'stuck').map((i) => i.row.id).join(',') === 'd3,d7,d1,d5' && filterQueue(queue, 'wait').length === 2);

let v = queueView(queue, totals, 'all', false);
t('view: first 7 then toggle', v.shown.length === 7 && v.total === 10 && v.toggle === true && Object.keys(v.more).length === 0);
v = queueView(queue, totals, 'all', true);
t('view: expanded shows all', v.shown.length === 10 && v.toggle === true);
v = queueView(queue, totals, 'stuck', false);
t('view: four stuck, no toggle', v.shown.length === 4 && v.total === 4 && v.toggle === false);
// الخادم يقول 140 متأخرة وحُمِّلت 2 فقط (حد التحميل): «و138» رابطاً بعد آخر سطر حين تُفتح القائمة
const big = queueTotals({ late: 140, stuck: 4, today: 2, wait: 2 });
v = queueView(queue, big, 'late', false);
t('view: total from the server count', v.total === 140 && v.shown.length === 2 && v.toggle === true && Object.keys(v.more).length === 0);
v = queueView(queue, big, 'late', true);
t('view: unloaded rows listed when expanded', v.more.late === 138 && Object.keys(v.more).length === 1);
v = queueView(queue, big, 'all', true);
t('view: all lists every short source', v.more.late === 138 && v.more.today === undefined);
v = queueView(queue, queueTotals({}), 'today', false);
t('view: total never below what is loaded', v.total === 2);

/* ---------- نص حبّة السبب ---------- */

t('reason: late', reasonText({ kind: 'late', days: 2 }) === 'متأخر يومين' && reasonText({ kind: 'late', days: 1 }) === 'متأخر يوم واحد' && reasonText({ kind: 'late', days: 15 }) === 'متأخر 15 يوماً');
t('reason: late without days', reasonText({ kind: 'late', days: null }) === 'متأخر');
t('reason: stuck', reasonText({ kind: 'stuck', days: 18, stage: stage(2) }) === 'واقف 18 يوماً في «معاينة»');
t('reason: stuck, two days (custom limit) = يومين', reasonText({ kind: 'stuck', days: 2, stage: stage(2) }) === 'واقف يومين في «معاينة»');
t('reason: stuck from the queue', reasonText(queue[2]) === 'واقف 30 يوماً في «عربون»');
t('reason: waiting', reasonText({ kind: 'wait', days: 3 }) === 'عند المدير · من 3 أيام' && reasonText({ kind: 'wait', days: 0 }) === 'عند المدير · من اليوم');
t('reason: waiting two days = من يومين', reasonText({ kind: 'wait', days: 2 }) === 'عند المدير · من يومين' && reasonText({ kind: 'wait', days: 1 }) === 'عند المدير · من يوم واحد');
t('reason: waiting, unknown since', reasonText({ kind: 'wait', days: null }) === 'عند المدير');
t('reason: today has no text here', reasonText({ kind: 'today' }) === '' && reasonText(null) === '');

/* ---------- الإجراء الرئيسي للصفقة ---------- */

let a = dealAction({ next: stage(3) });
t('action: move to the next open stage', a.type === 'move' && a.stage.id === 3 && a.label === 'انقله إلى: تفاوض');
a = dealAction({ next: stage(6) });
t('action: «تمت» opens the deal (needs the final price)', a.type === 'open');
t('action: no right to move opens the deal', dealAction({ next: stage(3) }, { canMove: false }).type === 'open');
t('action: no next opens the deal', dealAction({ next: null }).type === 'open' && dealAction(null).type === 'open');

/* ---------- أقرب موعد اليوم ---------- */

t('next upcoming: earliest still ahead', nextUpcoming(TODAY, NOW).id === 'f5');
t('next upcoming: none left', nextUpcoming(TODAY, new Date(2026, 10, 3, 18, 0).getTime()) === null && nextUpcoming(null, NOW) === null);

/* ---------- العمولة المتوقعة ---------- */

const rates = new Map([[7, 3], [9, 0]]);
t('rate: project rate wins', effectiveRate(7, rates, 2.5) === 3 && effectiveRate('7', rates, 2.5) === 3);
t('rate: zero project rate is a rate', effectiveRate(9, rates, 2.5) === 0);
t('rate: else the general rate', effectiveRate(8, rates, 2.5) === 2.5 && effectiveRate(null, rates, '2.5') === 2.5);
t('rate: plain object works too', effectiveRate(7, { 7: '1.5' }, 2.5) === 1.5);
t('rate: nothing known = null', effectiveRate(8, rates, null) === null && effectiveRate(8, null, '') === null);
// لا صف commission_policy (037 يحجبه مع نسب المشاريع عمّن أخفى المدير عنه العمولة): لا نسبة ولو وصلت نسبة مشروع
t('rate: no general rate = no rate, even with a project rate', effectiveRate(7, rates, null) === null && effectiveRate(7, { 7: '1.5' }, undefined) === null);
const OPEN = [
    { id: 'a', amount: 1480000, project_id: 7 },   // 3% = 44,400
    { id: 'b', amount: 1000000, project_id: 8 },   // 2.5% = 25,000
    { id: 'c', amount: null, project_id: 7 },      // بلا قيمة
    { id: 'd', amount: 999999, project_id: null }  // 2.5% = 24,999.98
];
let total = expectedTotal(OPEN, rates, 2.5);
t('expected: sum of amount × rate', total.total === 94399.98 && total.counted === 3 && total.missing === 1, total);
// الصف لم يصل: لا رقم أصلاً (خانة العمولة تختفي عن الوسيط) بدل مجموع من نسب المشاريع وحدها أو صفر كاذب
t('expected: no general rate (no commission_policy row) = no number at all', expectedTotal(OPEN, rates, null) === null
    && expectedTotal(OPEN, rates, undefined) === null && expectedTotal(OPEN, new Map(), '') === null && expectedTotal([], rates, null) === null);
t('expected: empty', JSON.stringify(expectedTotal([], rates, 2.5)) === JSON.stringify({ total: 0, counted: 0, missing: 0 }));
t('expected: a general rate of 0 is a rate', JSON.stringify(expectedTotal([{ amount: 500000, project_id: 8 }], rates, 0))
    === JSON.stringify({ total: 0, counted: 1, missing: 0 }));

/* ---------- «مساري» ---------- */

t('periods 7 / 30 / 90, default 30', PATH_PERIODS.join(',') === '7,30,90' && PATH_DEFAULT === 30);
t('steps in order', PATH_STEPS.map((s) => s.label).join(' ← ') === 'مشاركة ← عميل ← معاينة ← عربون ← تمت');
t('period start: 7 days = today and six before', periodStart(7, NOW).getTime() === new Date(2026, 9, 28).getTime());
t('period start: 30 days', periodStart(30, NOW).getTime() === new Date(2026, 9, 5).getTime());
t('period start: 1 day = today 00:00', periodStart(1, NOW).getTime() === new Date(2026, 10, 3).getTime());
t('period start: junk = today', periodStart('x', NOW).getTime() === new Date(2026, 10, 3).getTime());

t('distinct: ignores empties, 5 = "5"', distinctCount(['a', 'b', 'a', null, '', undefined, 5, '5']) === 3);
t('viewing: one count per client across both logs', viewingCount(
    [{ client_id: 'c1' }, { client_id: 'c2' }, { client_id: 'c1' }, null],
    [{ deal_id: 'x', deal: { client_id: 'c2' } }, { deal_id: 'y', deal: { client_id: 'c3' } }, { deal_id: 'z', deal: null }, { client_id: 'c3' }]
) === 4);
t('viewing: nothing = 0', viewingCount(null, undefined) === 0);

let steps = pathSteps({ shared: 40, clients: 10, viewing: 6, deposit: 2, won: 1 });
t('path: counts', steps.map((s) => s.count).join(',') === '40,10,6,2,1');
t('path: percent of the step before', steps.map((s) => s.pct).join(',') === ',25,60,33,50', steps.map((s) => s.pct));
t('path: bars from the first step', steps.map((s) => s.width).join(',') === '100,25,15,5,2.5', steps.map((s) => s.width));
t('path: labels and keys', steps[2].label === 'معاينة' && steps[4].key === 'won');
steps = pathSteps({ shared: 0, clients: 5, viewing: 2, deposit: 0, won: 0 });
t('path: zero first step → bars from the largest', steps.map((s) => s.width).join(',') === '0,100,40,0,0' && steps[1].pct === null && steps[2].pct === 40 && steps[4].pct === null, steps);
steps = pathSteps({ shared: 10, clients: null, viewing: 3, deposit: 1, won: 0 });
t('path: a failed step shows no count and breaks the next percent', steps[1].count === null && steps[1].pct === null && steps[2].pct === null && steps[2].width === 30 && steps[3].pct === 33);
steps = pathSteps({ shared: 1000, clients: 1 });
t('path: a non-zero step is never invisible', steps[1].width === 2 && steps[2].count === null && steps[2].width === 0);
steps = pathSteps({ shared: 5, clients: 8, viewing: 8 });
t('path: more than the step before is written as is, bar capped', steps[1].pct === 160 && steps[1].width === 100 && steps[2].pct === 100);
t('path: all zero', pathSteps({ shared: 0, clients: 0, viewing: 0, deposit: 0, won: 0 }).every((s) => s.width === 0 && s.count === 0));
t('path: negative or junk = unknown', pathSteps({ shared: -1, clients: 'x' }).slice(0, 2).every((s) => s.count === null));

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
