// ‎#/work‎ — "عملي اليوم".
//
// لا يوجد أي ترشيح بالمستخدم هنا: سياسات RLS على follow_ups وdeals وprojects وclients تتكفّل بالباقي (وv_my_work معرّف
// security_invoker)، فالمدير يرى الجميع والوسيط يرى نفسه تلقائياً. إلا الصفقات: deals_select تُري الوسيط أيضاً صفقة
// أنشأها ثم جعل المدير وسيطها غيره، فيُبقي ownDeals (work-queue.js) صفقاته وحده للعدّ و«واقف» و«عمولتي»، وتُعدّ خطوات
// الصفقات في «مساري» («معاينة» بالصفقة، و«عربون»، و«تمت») بوسيط الصفقة نفسه (broker_id).
//
// حدود اليوم: v_my_work تحسب "اليوم" بتوقيت Asia/Riyadh (006_inventory_quality.sql)، والقوائم هنا ترسل بداية اليوم
// المحلي وبداية الغد نصّاً ISO بإزاحة المتصفح، فيطابق كل رقم طول قائمته.
//
// الخطوة الثالثة (2026-11-03، بعد معاينة وافق عليها المالك): قائمة واحدة «يحتاج إجراء» بدل اللوحات الأربع، لأن الموظف
// يسأل سؤالاً واحداً كل صباح: ماذا ينتظرني؟ الترتيب والعدّ والنصوص في work-queue.js (يُختبر وحده):
//   المتابعات المتأخرة (الأقدم أولاً) ← الصفقات الواقفة أكثر من 14 يوماً في مرحلتها (الأطول أولاً) ← مواعيد اليوم (بوقتها)
//   ← عروض الوسيط التي تنتظر اعتماد المدير.
// فوقها حبّات تصفية بعددها، وأول سبعة سطور ثم «عرض الكل». لكل سطر سبب ملوّن بمعناه (أحمر متأخر، كهرماني واقف أو حان
// وقته، محايد موعد قادم، باهت عند المدير)، وإجراء واحد: «تم» للمتابعة (ومنها التأجيل)، و«انقله إلى» للصفقة.
// بجانبها «مساري»: من المشاركة حتى الإتمام في 7 أو 30 أو 90 يوماً. مركز الاتصال لا صفقات له: لا «واقف» ولا عمولة ولا
// «مساري»، ومكانه «طلبات جديدة» كما كان.
// كل مصدر استعلام مستقل: تعذّر أحدها يظهر في مكانه ولا يخفي البقية.

import { supabase, fetchAll } from './supabase.js';
import { staffMap, staffName, dealStages } from './data.js';
import { CHANNEL, REQUEST_PURPOSE, label } from './labels.js';
import { state, myRole, myId, isAdmin, canSeeCommission } from './auth.js';
import {
    el, replace, append, loading, errorBox, fmtDateTime, fmtDate, dayText, localDayStart, number, countText,
    waNumber, icon, money, badge, errorText, notify, fail, filterChips
} from './ui.js';
import { openStages, STUCK_DAYS, daysText } from './deal-path.js';
import {
    queueFilters, ownDeals, stuckDeals, buildQueue, queueTotals, queueView, reasonText, dealAction, nextUpcoming, expectedTotal,
    PATH_PERIODS, PATH_DEFAULT, periodStart, distinctCount, viewingCount, pathSteps
} from './work-queue.js';
import { openDoneForm } from './followup-form.js';
import { openClientForm } from './client-form.js';
import { openPalette } from './palette.js';
import { presetCalendarScope } from './calendar.js';
import { budgetText } from './requirements.js';
import { ACTIVE_REQUEST } from './clients.js';

// تُستعمل أيضاً في لوحة الإدارة (#/dashboard) فوق بطاقات القمع الشهري
export const WORK_CARDS = [
    { key: 'follow_ups_today', label: 'متابعات اليوم' },
    { key: 'follow_ups_overdue', label: 'متابعات متأخرة' },
    { key: 'new_requirements_7d', label: 'طلبات جديدة (7 أيام)' },
    { key: 'viewings_today', label: 'معاينات اليوم' },
    { key: 'active_clients', label: 'عملاء نشطون' }
];

// حد ما يُحمَّل من كل مصدر في القائمة: الوسيط لا يقترب منه، والمدير قد يتجاوزه في المتأخرة، فيُعرض الباقي رابطاً إلى «المواعيد»
const QUEUE_CAP = 100;
const VISIT_DAYS = 7;
const PANEL_ROWS = 6;

const FU_FIELDS = 'id, due_at, channel, purpose, assigned_to, client_id, requirement_id, client:clients(full_name, phone)';
// سجل المراحل مضمَّن في كل صفقة: منه متى دخلت مرحلتها (deal-path.js: enteredAt)، فلا استعلام ثانٍ بقائمة معرّفات طويلة
const DEAL_FIELDS = 'id, client_id, stage_id, amount, unit_key, project_id, broker_id, created_at, updated_at,'
    + ' client:clients(full_name, phone), project:projects(name), history:deal_stage_history(to_stage, changed_at)';
const OFFER_FIELDS = 'id, name, type, district, price, updated_at, date_added';

const LATE_FORMS = ['متابعة متأخرة واحدة', 'متابعتان متأخرتان', 'متابعات متأخرة', 'متابعة متأخرة'];
const TODAY_FORMS = ['موعد واحد اليوم', 'موعدان اليوم', 'مواعيد اليوم', 'موعداً اليوم'];
const STUCK_FORMS = ['صفقة واقفة', 'صفقتان واقفتان', 'صفقات واقفة', 'صفقة واقفة'];
const OPEN_DEAL_FORMS = ['صفقة جارية واحدة', 'صفقتين جاريتين', 'صفقات جارية', 'صفقة جارية'];
const DEAL_FORMS = ['صفقة واحدة', 'صفقتان', 'صفقات', 'صفقة'];
const FRESH_FORMS = ['طلب جديد هذا الأسبوع', 'طلبان جديدان هذا الأسبوع', 'طلبات جديدة هذا الأسبوع', 'طلباً جديداً هذا الأسبوع'];

const EMPTY_TEXT = {
    all: ['لا شيء يحتاج إجراء الآن', 'المتابعات في وقتها، ولا صفقة واقفة أكثر من ' + STUCK_DAYS + ' يوماً.'],
    late: ['لا متابعات متأخرة', 'كل ما فات موعده أُنجز.'],
    stuck: ['لا صفقات واقفة', 'كل صفقة جارية تحركت خلال ' + STUCK_DAYS + ' يوماً.'],
    today: ['لا مواعيد اليوم', 'أضف متابعة من ملف العميل لتظهر هنا في وقتها.'],
    wait: ['لا عروض عند المدير', 'العرض الذي تضيفه أو تعدّله ينتظر اعتماد المدير، ويظهر هنا حتى يُعتمد.']
};

const PATH_NOTE = 'النسبة من الخطوة التي قبلها. المعاينة: كل عميل عاين في المدة مرة واحدة، بزيارة أُنجزت أو صفقة دخلت «معاينة».';

const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const FMT_TODAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const FMT_TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });

// مدة «مساري» المختارة تبقى طوال الجلسة: من اختار 90 يوماً يجدها كما تركها حين يعود إلى الصفحة
let pathPeriod = PATH_DEFAULT;

const safe = (query) => Promise.resolve(query).catch((error) => ({ error }));

export async function renderWork(root) {
    const role = myRole();
    const noDeals = role === 'callcenter';
    // «عند المدير» للوسيط وحده: المدير هو من يعتمد (له «طلبات الاعتماد»)، ومركز الاتصال لا تُريه سياسة projects غير
    // المعتمد أصلاً (001_init.sql)، وعروضه تمر بالمساعد لا بجدول المشاريع.
    const withOffers = role === 'field';
    // العمولة (037): أرقامها لمن يراها، ومن لا يراها لا خانة له ولا ذكر لها (قرار المالك 2026-11-04: كأنها غير موجودة)
    const seeCommission = !noDeals && canSeeCommission();
    const me = myId();
    // المدير يرى الفريق كله (كبقية صفحته)، فخانة العمولة له «العمولة المتوقعة» للفريق لا «عمولتي»
    const team = isAdmin();
    const view = { filter: 'all', expanded: false };
    let names = new Map();
    let queue = { ready: false, items: [], totals: queueTotals({}), errors: [] };
    // عدّادات التحميل (القائمة و«مساري» و«طلبات جديدة») قبل أي زر يُرسم: ضغطة مدة أو «عميل جديد» قبل وصول الأسماء تبدأ
    // تحميلاً، وردّ أقدم يصل بعد أحدث يُهمَل
    let workSeq = 0;
    let pathSeq = 0;
    let reqSeq = 0;

    const sub = el('p', { class: 'w4-sub', text: FMT_TODAY.format(new Date()) });

    /* ---------- الأرقام ---------- */

    const kpis = kpiStrip(noDeals ? [
        { key: 'needs', label: 'يحتاج إجراء', go: () => focusQueue('all') },
        { key: 'today', label: 'مواعيد اليوم', go: () => focusQueue('today') },
        { key: 'visits', label: 'معاينات قادمة', href: '#/calendar', onclick: () => presetCalendarScope('visits') },
        { key: 'leads', label: 'عملاء محتملون', href: '#/requests' }
    ] : [
        { key: 'needs', label: 'يحتاج إجراء', go: () => focusQueue('all') },
        { key: 'today', label: 'مواعيد اليوم', go: () => focusQueue('today') },
        { key: 'deals', label: 'صفقات جارية', href: '#/deals' },
        seeCommission ? { key: 'commission', label: team ? 'العمولة المتوقعة' : 'عمولتي المتوقعة', href: '#/deals' } : null,
        { key: 'leads', label: 'عملاء محتملون', href: '#/requests' }
    ].filter(Boolean));
    kpis.node.classList.add('wq-kpis');


    /* ---------- القائمة الواحدة ---------- */

    const filters = queueFilters({ deals: !noDeals, offers: withOffers });
    const chips = filterChips('اعرض حسب السبب', filters, view.filter, (value) => {
        view.filter = value;
        view.expanded = false;
        drawQueue();
    });
    const totalBadge = el('span', { class: 'wq-total', hidden: true });
    const heading = el('h2', { id: 'wq-queue-title', tabindex: '-1' }, [el('span', { text: 'يحتاج إجراء' }), totalBadge]);
    const listHost = el('div', { class: 'wq-body', id: 'wq-list' }, loading());
    const toggle = el('button', {
        type: 'button', class: 'wq-toggle', hidden: true, 'aria-controls': 'wq-list', 'aria-expanded': 'false',
        onclick: () => {
            view.expanded = !view.expanded;
            drawQueue();
            if (!view.expanded) toggle.scrollIntoView({ block: 'nearest' });
        }
    });
    const queueNode = el('section', { class: 'wq-queue', 'aria-labelledby': 'wq-queue-title' }, [
        el('header', { class: 'wq-head' }, [
            heading,
            el('a', { class: 'wq-head-link', href: '#/calendar', text: 'كل المواعيد' })
        ]),
        el('div', { class: 'wq-filter' }, chips.node),
        listHost,
        toggle
    ]);

    // رقم في الشريط يفتح سببه في القائمة: يختار الحبّة وينزل إليها، والتركيز على عنوانها لمن يتنقل بلوحة المفاتيح
    function focusQueue(filter) {
        view.filter = filter;
        view.expanded = false;
        chips.set(filter);
        drawQueue();
        queueNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
        heading.focus({ preventScroll: true });
    }

    /* ---------- العمود الجانبي: «مساري»، ولمركز الاتصال «طلبات جديدة» ---------- */

    const pathSub = el('p', { class: 'wq-path-sub' });
    const stepsHost = el('div', { class: 'wq-steps-host' }, loading());
    const periodButtons = new Map();
    const pathNode = noDeals ? null : el('section', { class: 'wq-path', 'aria-labelledby': 'wq-path-title' }, [
        el('header', { class: 'wq-path-head' }, [
            el('div', { class: 'wq-path-title' }, [el('h2', { id: 'wq-path-title', text: 'مساري' }), pathSub]),
            el('div', { class: 'wq-period', role: 'group', 'aria-label': 'مدة «مساري»' }, PATH_PERIODS.map((days) => {
                const button = el('button', {
                    type: 'button', class: 'wq-period-btn', 'aria-pressed': String(days === pathPeriod),
                    onclick: () => {
                        if (days === pathPeriod) return;
                        pathPeriod = days;
                        loadPath();
                    }
                }, daysText(days));
                periodButtons.set(days, button);
                return button;
            }))
        ]),
        stepsHost,
        el('p', { class: 'wq-path-note', text: PATH_NOTE })
    ]);
    const requests = noDeals
        ? panel('requests', 'طلبات جديدة', 'file', el('a', { class: 'w4-panel-hint w4-panel-link', href: '#/requests', text: 'كل الطلبات' }))
        : null;

    replace(root, el('div', { class: 'w4 w6 wq' }, [
        el('header', { class: 'w4-head' }, [
            el('div', { class: 'w4-title' }, [el('h1', { text: 'عملي اليوم' }), sub]),
            el('div', { class: 'w4-quick', 'aria-label': 'إجراءات سريعة' }, quickActions(() => reloadAll()))
        ]),
        // الجوال بلا شريط علوي: البحث السريع هنا، أول ما تراه العين
        el('button', { type: 'button', class: 'work-search', onclick: () => openPalette() }, [
            icon('search'), el('span', { text: 'ابحث عن عميل أو جوال أو عقار…' })
        ]),
        kpis.node,
        el('div', { class: 'wq-layout' }, [
            queueNode,
            el('div', { class: 'wq-side' }, noDeals ? requests.node : pathNode)
        ])
    ]));
    kpis.loading();

    // الأسماء لسطر «المكلَّف» وحده: تعذّرها لا يوقف الصفحة («مستخدم غير معروف» مكان الاسم)
    names = await staffMap().catch(() => new Map());
    if (!root.isConnected) return;

    /* ---------- تحميل القائمة والأرقام ---------- */

    async function loadWork() {
        const mine = ++workSeq;
        listHost.setAttribute('aria-busy', 'true');
        const today0 = localDayStart(0);
        const today1 = localDayStart(1);
        const followUps = (scope) => safe(scope(supabase.from('follow_ups').select(FU_FIELDS, { count: 'exact' }).eq('status', 'pending'))
            .order('due_at', { ascending: true }).order('id', { ascending: true }).range(0, QUEUE_CAP - 1));
        const stagesTask = noDeals ? Promise.resolve(null) : dealStages().catch((error) => ({ error }));
        // كل الصفقات الجارية مرة واحدة: منها العدد، والواقفة، والعمولة المتوقعة
        const dealsTask = noDeals ? Promise.resolve(null) : stagesTask.then((stages) => (stages && stages.error ? null
            : safe(fetchAll(() => supabase.from('deals').select(DEAL_FIELDS)
                .in('stage_id', openStages(stages).map((s) => s.id)).order('id', { ascending: true })))));
        const username = state.profile ? state.profile.username : null;

        const [overdue, today, stages, deals, waiting, work, leads, policy, rates, visits] = await Promise.all([
            followUps((q) => q.lt('due_at', today0)),
            followUps((q) => q.gte('due_at', today0).lt('due_at', today1)),
            stagesTask,
            dealsTask,
            withOffers && username
                ? safe(supabase.from('projects').select(OFFER_FIELDS, { count: 'exact' })
                    .eq('status', 'pending').eq('added_by', username).is('deleted_at', null)
                    .order('updated_at', { ascending: true }).range(0, QUEUE_CAP - 1))
                : null,
            safe(supabase.from('v_my_work').select('new_requirements_7d').maybeSingle()),
            safe(fetchAll(() => supabase.from('client_requirements').select('id, client_id').in('status', ACTIVE_REQUEST).order('id', { ascending: true }))),
            seeCommission ? safe(supabase.from('commission_policy').select('default_rate').maybeSingle()) : null,
            seeCommission ? safe(fetchAll(() => supabase.from('project_commission').select('project_id, rate').order('project_id', { ascending: true }))) : null,
            noDeals
                ? safe(supabase.from('follow_ups').select('id', { count: 'exact', head: true })
                    .eq('status', 'pending').eq('channel', 'visit').gte('due_at', today0).lt('due_at', localDayStart(VISIT_DAYS + 1)))
                : null
        ]);
        if (mine !== workSeq || !root.isConnected) return;

        const now = Date.now();
        const errors = [];
        const ok = (result, kind, prefix) => {
            if (!result) return null;
            if (result.error) { errors.push({ kind, error: result.error, prefix }); return null; }
            return result;
        };
        const overdueOk = ok(overdue, 'late', 'تعذّر تحميل المتابعات المتأخرة');
        const todayOk = ok(today, 'today', 'تعذّر تحميل مواعيد اليوم');
        const waitingOk = ok(waiting, 'wait', 'تعذّر تحميل عروضك التي عند المدير');
        let openDeals = null;
        let dealError = null;
        let stuck = [];
        if (!noDeals) {
            dealError = (stages && stages.error) || (deals && deals.error) || null;
            if (dealError) errors.push({ kind: 'stuck', error: dealError, prefix: 'تعذّر تحميل الصفقات' });
            else {
                // صفقاتي وحدها (المدير: الفريق كله): منها العدد و«واقف» والعمولة، فلا يظهر سطر صفقة لا يملك نقلها
                openDeals = ownDeals((deals && deals.data) || [], me, team);
                stuck = stuckDeals(openDeals, stages, now);
            }
        }
        const total = (result) => (result ? (result.count === null || result.count === undefined ? (result.data || []).length : result.count) : 0);

        queue = {
            ready: true,
            items: buildQueue({
                overdue: overdueOk && overdueOk.data,
                stuck,
                today: todayOk && todayOk.data,
                waiting: waitingOk && waitingOk.data
            }, now),
            totals: queueTotals({ late: total(overdueOk), stuck: stuck.length, today: total(todayOk), wait: total(waitingOk) }),
            errors
        };
        drawQueue();

        const t = queue.totals;

        // سطر تحت العنوان: التاريخ وخلاصة اليوم
        const bits = [FMT_TODAY.format(new Date())];
        if (overdueOk) bits.push(t.late ? el('b', { class: 'w4-sub-late', text: countText(t.late, LATE_FORMS) }) : 'لا متأخرات');
        if (todayOk) bits.push(el('b', { text: t.today ? countText(t.today, TODAY_FORMS) : 'لا مواعيد اليوم' }));
        replace(sub, bits.flatMap((bit, i) => (i ? [' · ', bit] : [bit])));

        // «يحتاج إجراء»: طول القائمة كلها، بالأحمر حين يتأخر شيء. مصدر تعذّر يجعل الرقم ناقصاً فيُقال ذلك، ويبقى الأحمر
        // وعدد المتأخرة ما دامت المتأخرة نفسها حُمِّلت
        kpis.set('needs', errors.length ? {
            value: number(t.all),
            tone: t.late ? 'late' : 'failed',
            sub: (t.late ? countText(t.late, LATE_FORMS) + ' · ' : '') + 'ناقص: تعذّر تحميل بعضها',
            title: errorText(errors[0].error)
        } : {
            value: number(t.all),
            tone: t.late ? 'late' : null,
            subTone: t.late ? 'late' : null,
            sub: t.late ? countText(t.late, LATE_FORMS) : t.all ? 'لا شيء متأخر' : 'لا شيء ينتظرك الآن'
        });

        if (!todayOk) kpis.set('today', failed(today.error));
        else {
            const next = nextUpcoming(todayOk.data, now);
            const unloaded = t.today > (todayOk.data || []).length;
            kpis.set('today', {
                value: number(t.today),
                sub: !t.today ? 'يومك خالٍ من المواعيد'
                    : next ? 'التالي ' + FMT_TIME.format(new Date(next.due_at))
                    : unloaded ? 'مكالمات وزيارات اليوم' : 'حان وقتها كلها'
            });
        }

        if (!noDeals) {
            if (dealError) kpis.set('deals', failed(dealError));
            else {
                kpis.set('deals', {
                    value: number(openDeals.length),
                    subClass: stuck.length ? 'wq-sub-due' : null,
                    sub: stuck.length ? countText(stuck.length, STUCK_FORMS) + ' أكثر من ' + STUCK_DAYS + ' يوماً'
                        : openDeals.length ? 'لا صفقة واقفة' : 'من الاهتمام حتى الإغلاق'
                });
            }
        }

        if (seeCommission) {
            const rateError = dealError || (policy && policy.error) || (rates && rates.error) || null;
            const projectRates = new Map(((rates && rates.data) || []).map((row) => [Number(row.project_id), row.rate]));
            const defaultRate = policy && policy.data ? policy.data.default_rate : null;
            // openDeals صفقاتي وحدها (ownDeals أعلاه)، وللمدير صفقات الفريق كله فيُقال ذلك كما في «مساري». null: لم يصل صف
            // commission_policy — العمولة رآها عند دخوله وأخفاها المدير بعده (037 يحجب الصف ونسب المشاريع معاً)، فلا رقم
            const sum = rateError ? null : expectedTotal(openDeals, projectRates, defaultRate);
            if (rateError) kpis.set('commission', failed(rateError));
            else if (!sum) {
                // الوسيط: أخفاها المدير بعد دخوله، فتختفي خانتها كأنها لم تكن
                if (!team) kpis.remove('commission');
                else {
                    kpis.set('commission', {
                        value: '—',
                        tone: 'failed',
                        sub: 'لا نسبة عامة للعمولة',
                        title: 'لم تصل النسبة العامة للعمولة، فلا يُحسب مجموع من نسب ناقصة.'
                    });
                }
            } else {
                kpis.set('commission', {
                    value: money(sum.total),
                    unit: 'ر.س',
                    sub: (team ? 'الفريق كله · ' : '') + (sum.missing ? 'بلا قيمة: ' + countText(sum.missing, DEAL_FORMS)
                        : sum.counted ? 'على ' + countText(sum.counted, OPEN_DEAL_FORMS) : 'لا صفقات جارية'),
                    title: (team ? 'كل صفقات الفريق الجارية' : 'صفقاتك الجارية وحدها')
                        + ': قيمة كل صفقة × نسبة مشروعها أو النسبة العامة. الصفقة بلا قيمة لا تدخل المجموع.'
                });
            }
        }

        if (leads.error) kpis.set('leads', failed(leads.error));
        else {
            const clients = new Set((leads.data || []).map((row) => row.client_id)).size;
            const fresh = work && !work.error && work.data ? Number(work.data.new_requirements_7d) || 0 : 0;
            kpis.set('leads', { value: number(clients), sub: fresh ? countText(fresh, FRESH_FORMS) : 'لهم طلب شراء أو إيجار نشط' });
        }

        if (noDeals) {
            kpis.set('visits', visits.error ? failed(visits.error) : {
                value: number(visits.count || 0),
                sub: visits.count ? 'خلال ' + VISIT_DAYS + ' أيام' : 'لا شيء خلال ' + VISIT_DAYS + ' أيام'
            });
        }
    }

    /* ---------- رسم القائمة ---------- */

    function drawQueue() {
        // قبل وصول البيانات يبقى «جارٍ التحميل»: ضغطة رقم مبكرة تختار الحبّة فقط، ولا تُظهر «لا شيء» كاذبة
        if (!queue.ready) return;
        const t = queue.totals;
        const failedKinds = new Set(queue.errors.map((e) => e.kind));
        for (const f of filters) chips.setCount(f.value, f.value === 'all' ? t.all : failedKinds.has(f.value) ? null : t[f.value]);
        totalBadge.textContent = number(t.all);
        totalBadge.hidden = !t.all;

        const v = queueView(queue.items, t, view.filter, view.expanded);
        const errors = queue.errors.filter((e) => view.filter === 'all' || e.kind === view.filter);
        const parts = errors.map((e) => errorBox(e.error, e.prefix, () => reloadAll()));
        // list-style: none يُسقط معنى القائمة في Safari، فيُعاد صريحاً (وكذلك خطوات «مساري»)
        if (v.shown.length) parts.push(el('ol', { class: 'wq-list', role: 'list' }, v.shown.map(itemRow)));
        else if (!errors.length) parts.push(emptyQueue(view.filter));
        for (const kind of Object.keys(v.more)) parts.push(moreRow(kind, v.more[kind]));
        replace(listHost, parts);
        listHost.removeAttribute('aria-busy');

        toggle.hidden = !v.toggle;
        toggle.setAttribute('aria-expanded', String(view.expanded));
        replace(toggle, el('span', { text: view.expanded ? 'عرض أقل' : 'عرض الكل (' + number(v.total) + ')' }));
    }

    function emptyQueue(filter) {
        const [title, hint] = EMPTY_TEXT[filter] || EMPTY_TEXT.all;
        return emptyPanel('check', title, noDeals && filter === 'all' ? 'لا متابعات متأخرة ولا مواعيد اليوم.' : hint);
    }

    // ما لم يُحمَّل لأن المصدر تجاوز حده (المدير وحده عادةً): رابط إلى صفحته بالعدد الباقي
    function moreRow(kind, n) {
        if (kind === 'late') {
            return morePanel('و' + countText(n, ['متابعة متأخرة أخرى', 'متابعتان متأخرتان أخريان', 'متابعات متأخرة أخرى', 'متابعة متأخرة أخرى'])
                + ' في «المواعيد»', '#/calendar', () => presetCalendarScope('overdue'));
        }
        if (kind === 'today') {
            return morePanel('و' + countText(n, ['موعد آخر اليوم', 'موعدان آخران اليوم', 'مواعيد أخرى اليوم', 'موعداً آخر اليوم'])
                + ' في «المواعيد»', '#/calendar', () => presetCalendarScope('today'));
        }
        if (kind === 'wait') return morePanel('و' + countText(n, ['عرض آخر', 'عرضان آخران', 'عروض أخرى', 'عرضاً آخر']) + ' في «المشاريع»', '../projects.html');
        return null;
    }

    function itemRow(item) {
        if (item.kind === 'stuck') return dealItem(item);
        if (item.kind === 'wait') return offerItem(item);
        return followUpItem(item);
    }

    // حبّة السبب: لونها معناها، ونصها يقوله أيضاً (لا يُعتمد على اللون وحده)
    function reasonChip(item) {
        if (item.kind === 'today') {
            const when = FMT_TIME.format(new Date(item.at));
            return el('span', {
                class: 'wq-reason ' + (item.passed ? 'wq-reason-due' : 'wq-reason-today'), title: fmtDateTime(item.at),
                text: item.passed ? when + ' · حان موعدها' : when
            });
        }
        const title = item.kind === 'late' ? 'موعدها ' + fmtDateTime(item.at)
            : item.kind === 'stuck' ? 'في هذه المرحلة منذ ' + fmtDate(item.at)
            : item.at ? 'أُرسل ' + fmtDateTime(item.at) : null;
        return el('span', { class: 'wq-reason wq-reason-' + item.kind, title, text: reasonText(item) });
    }

    // المتابعة: العميل، ثم القناة والغرض (واسم المكلَّف إن لم يكن أنا)، واتصال وواتساب و«تم» (ومنها «لم يرد — أجّلها»)
    function followUpItem(item) {
        const row = item.row;
        const client = row.client || {};
        const name = client.full_name || 'العميل';
        const context = [
            label(CHANNEL, row.channel),
            row.purpose,
            row.assigned_to && row.assigned_to !== me ? staffName(names, row.assigned_to) : null
        ].filter(Boolean).join(' · ');
        return el('li', { class: 'wq-item wq-item-' + item.kind }, [
            el('div', { class: 'wq-main' }, [
                el('div', { class: 'wq-top' }, [
                    reasonChip(item),
                    el('a', { class: 'wq-name', href: '#/clients/' + row.client_id, text: client.full_name || 'فتح ملف العميل' })
                ]),
                el('p', { class: 'wq-ctx', text: context })
            ]),
            el('div', { class: 'wq-actions' }, [
                ...contactLinks(client.phone, name),
                el('button', {
                    type: 'button', class: 'btn w4-done', 'aria-label': 'تم: ' + name,
                    onclick: () => openDoneForm(row, () => reloadAll())
                }, [icon('check'), el('span', { text: 'تم' })])
            ])
        ]);
    }

    // الصفقة الواقفة: العميل (رابط الصفقة)، ثم العقار والوحدة والقيمة (والوسيط إن لم يكن أنا)، و«انقله إلى» المرحلة التالية
    function dealItem(item) {
        const deal = item.row;
        const client = deal.client || {};
        const name = client.full_name || 'صفقة';
        const project = deal.project && deal.project.name ? deal.project.name : (deal.project_id ? 'عقار رقم ' + deal.project_id : 'بدون عقار');
        const context = [
            project,
            deal.unit_key,
            deal.amount ? money(deal.amount) + ' ر.س' : null,
            deal.broker_id && deal.broker_id !== me ? staffName(names, deal.broker_id) : null
        ].filter(Boolean).join(' · ');
        const action = dealAction(item, { canMove: isAdmin() || deal.broker_id === me });
        const main = action.type === 'move'
            ? el('button', {
                type: 'button', class: 'wq-move', 'aria-label': action.label + ' — ' + name,
                onclick: (event) => moveDeal(event.currentTarget, deal, action.stage)
            }, el('span', { text: action.label }))
            : el('a', { class: 'wq-move', href: '#/deals/' + deal.id, 'aria-label': 'افتح الصفقة — ' + name }, el('span', { text: 'افتح الصفقة' }));
        return el('li', { class: 'wq-item wq-item-stuck' }, [
            el('div', { class: 'wq-main' }, [
                el('div', { class: 'wq-top' }, [reasonChip(item), el('a', { class: 'wq-name', href: '#/deals/' + deal.id, text: name })]),
                el('p', { class: 'wq-ctx', text: context })
            ]),
            el('div', { class: 'wq-actions' }, [...contactLinks(client.phone, name), main])
        ]);
    }

    // عرضي عند المدير: لا إجراء للوسيط فيه إلا أن يعرف، فالسطر معلومة ورابط إلى صفحة المشاريع حيث يراه ويعدّله
    function offerItem(item) {
        const project = item.row;
        const context = [project.type, project.district, project.price ? money(project.price) + ' ر.س' : null].filter(Boolean).join(' · ');
        return el('li', { class: 'wq-item wq-item-wait' }, [
            el('div', { class: 'wq-main' }, [
                el('div', { class: 'wq-top' }, [
                    reasonChip(item),
                    el('a', { class: 'wq-name', href: '../projects.html', text: project.name || 'عرض رقم ' + project.id })
                ]),
                el('p', { class: 'wq-ctx', text: context || 'بانتظار اعتماد المدير' })
            ])
        ]);
    }

    // نقل الصفقة إلى المرحلة التالية: update واحد كما في صفحة الصفقة، والخادم يكتب السجل والحجز (007 و030).
    // شرط المرحلة الحالية يمنع نقلها مرتين بضغطتين أو من صفحة قديمة، والزر يبقى معطلاً حتى تُرسم القائمة من جديد (السطر
    // يختفي معها عادةً)، فلا تُرسل ضغطة ثانية تحديثاً ثانياً قبل ذلك.
    async function moveDeal(button, deal, stage) {
        if (button.disabled) return;
        button.disabled = true;
        const { data, error } = await safe(supabase.from('deals').update({ stage_id: stage.id })
            .eq('id', deal.id).eq('stage_id', deal.stage_id).select('id'));
        const moved = !error && data && data.length > 0;
        if (!moved) {
            button.disabled = false;
            if (error) return void fail(error, 'تعذّر نقل الصفقة');
            return void notify('لم تُنقل الصفقة: تغيّرت مرحلتها، أو لا تملك تعديلها', 'error', 8000);
        }
        notify('تم الانتقال إلى: ' + stage.name_ar, 'success');
        try {
            await reloadAll();
        } finally {
            if (button.isConnected) button.disabled = false;
        }
    }

    /* ---------- «مساري» ---------- */

    async function loadPath() {
        if (!pathNode) return;
        const mine = ++pathSeq;
        const days = pathPeriod;
        for (const [value, button] of periodButtons) button.setAttribute('aria-pressed', String(value === days));
        pathSub.textContent = (isAdmin() ? 'الفريق كله · ' : '') + 'آخر ' + daysText(days);
        stepsHost.setAttribute('aria-busy', 'true');
        if (!stepsHost.querySelector('.wq-steps')) replace(stepsHost, loading());

        const since = periodStart(days).toISOString();
        const stages = await dealStages().catch(() => null);
        if (mine !== pathSeq || !stepsHost.isConnected) return;
        const viewingId = stageId(stages, 'viewing', 2);
        const depositId = stageId(stages, 'deposit', 4);
        const wonIds = stages ? stages.filter((s) => s.is_won).map((s) => s.id) : [6];
        // خطوات الصفقات لغير المدير بصفقات هو وسيطها وحده (كـ ownDeals): السياسة تُريه سجل صفقة أنشأها ووسيطها غيره، فتُربط
        // سطور السجل بصفقتها (!inner) وتُرشَّح بوسيطها. المدير: الفريق كله كما كان
        const ownOnly = (query, column) => (team ? query : query.eq(column, me));
        const dealOf = (columns) => (team ? (columns ? ', deal:deals(' + columns + ')' : '')
            : ', deal:deals!inner(' + (columns ? columns + ', ' : '') + 'broker_id)');

        const [shared, clients, visits, moves, deposits, won] = await Promise.all([
            safe(supabase.from('property_matches').select('id', { count: 'exact', head: true }).gte('created_at', since)),
            safe(supabase.from('clients').select('id', { count: 'exact', head: true }).gte('created_at', since)),
            safe(fetchAll(() => supabase.from('follow_ups').select('id, client_id')
                .eq('status', 'done').eq('channel', 'visit').gte('done_at', since).order('id', { ascending: true }))),
            safe(fetchAll(() => ownOnly(supabase.from('deal_stage_history').select('id, deal_id' + dealOf('client_id'))
                .eq('to_stage', viewingId).gte('changed_at', since), 'deal.broker_id').order('id', { ascending: true }))),
            safe(fetchAll(() => ownOnly(supabase.from('deal_stage_history').select('id, deal_id' + dealOf(''))
                .eq('to_stage', depositId).gte('changed_at', since), 'deal.broker_id').order('id', { ascending: true }))),
            safe(ownOnly(supabase.from('deals').select('id', { count: 'exact', head: true }).in('stage_id', wonIds).gte('closed_at', since), 'broker_id'))
        ]);
        if (mine !== pathSeq || !stepsHost.isConnected) return;

        const steps = pathSteps({
            shared: shared.error ? null : shared.count || 0,
            clients: clients.error ? null : clients.count || 0,
            viewing: visits.error || moves.error ? null : viewingCount(visits.data, moves.data),
            // صفقة دخلت «عربون» مرتين في المدة (رجعت ثم عادت) تُعدّ مرة
            deposit: deposits.error ? null : distinctCount((deposits.data || []).map((row) => row.deal_id)),
            won: won.error ? null : won.count || 0
        });
        replace(stepsHost, el('ol', { class: 'wq-steps', role: 'list' }, steps.map((step, i) => stepRow(step, i ? steps[i - 1] : null))));
        const firstError = [shared, clients, visits, moves, deposits, won].map((r) => r.error).find(Boolean);
        if (firstError) append(stepsHost, errorBox(firstError, 'تعذّر حساب بعض الخطوات', () => loadPath()));
        stepsHost.removeAttribute('aria-busy');
    }

    // خطوة: اسمها وعددها ونسبتها من التي قبلها، وشريط بطولها من الأولى (زخرفي: الأرقام نفسها مكتوبة)
    function stepRow(step, prev) {
        const count = step.count === null ? '—' : number(step.count);
        const pct = !prev ? null : step.pct === null ? '—' : number(step.pct) + '٪';
        const title = step.count === null ? step.label + ': تعذّر حسابها'
            : step.label + ': ' + number(step.count) + (prev && step.pct !== null ? ' — ' + number(step.pct) + '٪ من «' + prev.label + '»' : '');
        return el('li', { class: 'wq-step wq-step-' + step.key, title }, [
            el('div', { class: 'wq-step-top' }, [
                el('span', { class: 'wq-step-name', text: step.label }),
                el('span', { class: 'wq-step-num', text: count }),
                pct === null
                    ? el('span', { class: 'wq-step-pct', 'aria-hidden': 'true' })
                    : el('span', { class: 'wq-step-pct' }, [pct, el('span', { class: 'w4-sr', text: ' من «' + prev.label + '»' })])
            ]),
            el('div', { class: 'wq-step-bar', 'aria-hidden': 'true' }, el('span', { class: 'wq-step-fill', style: 'width:' + step.width + '%' }))
        ]);
    }

    /* ---------- مركز الاتصال: أحدث الطلبات المفتوحة مكان «مساري» ---------- */

    async function loadNewRequests() {
        if (!requests) return;
        const mine = ++reqSeq;
        replace(requests.body, loading());
        const { data, error, count } = await safe(supabase
            .from('client_requirements')
            .select('id, client_id, purpose, property_type, city, budget_min, budget_max, created_at, client:clients(full_name)', { count: 'exact' })
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .range(0, PANEL_ROWS - 1));
        if (mine !== reqSeq || !requests.body.isConnected) return;
        if (error) return void replace(requests.body, errorBox(error, 'تعذّر تحميل الطلبات', loadNewRequests));
        requests.setCount(count || 0);
        const rows = data || [];
        if (!rows.length) return void replace(requests.body, emptyPanel('file', 'لا طلبات مفتوحة', 'الطلب يُضاف من ملف العميل ← «طلب جديد».'));
        replace(requests.body, [
            el('ol', { class: 'w4-list' }, rows.map(requestRow)),
            count > rows.length ? morePanel('و' + countText(count - rows.length, ['طلب آخر', 'طلبان آخران', 'طلبات أخرى', 'طلباً آخر']), '#/requests') : null
        ]);
    }

    function reloadAll() {
        return Promise.all([loadWork(), noDeals ? loadNewRequests() : loadPath()]);
    }

    await reloadAll();
}

/* ===================== الأرقام ===================== */

// شريط الأرقام: كل رقم زر (يفتح سببه في الصفحة) أو رابط (يفتح صفحته)، وخانة بلا وجهة نصٌّ فقط (لا زر لا يفعل شيئاً).
// تُرسم الخانات فوراً وتمتلئ حين تصل أرقامها، فلا يقفز التخطيط. set(key, { value, unit, sub, tone, subTone, subClass,
// className, title }). value نص أو عناصر.
export function kpiStrip(defs, groupLabel = 'أرقام اليوم') {
    const cells = new Map();
    const node = el('div', { class: 'kpi-strip kpi-strip-' + defs.length, role: 'group', 'aria-label': groupLabel }, defs.map((def) => {
        const num = el('span', { class: 'kpi-num' });
        const subLine = el('span', { class: 'kpi-sub' });
        const parts = [el('span', { class: 'kpi-label', text: def.label }), num, subLine];
        const attrs = { class: 'kpi kpi-link', dataset: { kpi: def.key } };
        const cell = def.href
            ? el('a', Object.assign(attrs, { href: def.href, onclick: def.onclick || null }), parts)
            : def.go
                ? el('button', Object.assign(attrs, { type: 'button', onclick: def.go }), parts)
                : el('div', { class: 'kpi', dataset: { kpi: def.key } }, parts);
        cells.set(def.key, { cell, num, subLine, base: cell.className });
        return cell;
    }));
    return {
        node,
        loading() {
            for (const { cell, num, subLine } of cells.values()) {
                cell.classList.add('is-loading');
                cell.setAttribute('aria-busy', 'true');
                num.textContent = '…';
                subLine.textContent = '';
            }
        },
        set(key, data) {
            const c = cells.get(key);
            if (!c) return;
            c.cell.className = c.base + (data.tone ? ' kpi-' + data.tone : '') + (data.className ? ' ' + data.className : '');
            c.cell.removeAttribute('aria-busy');
            replace(c.num, [data.value, data.unit ? el('small', { class: 'kpi-unit', text: data.unit }) : null]);
            c.subLine.textContent = data.sub || '';
            c.subLine.className = 'kpi-sub' + (data.subTone ? ' kpi-sub-' + data.subTone : '') + (data.subClass ? ' ' + data.subClass : '');
            if (data.title) c.cell.title = data.title;
            else c.cell.removeAttribute('title');
        },
        // خانة لم تعد لصاحب الصفحة: تُزال ويتوزع الشريط على ما بقي
        remove(key) {
            const c = cells.get(key);
            if (!c) return;
            c.cell.remove();
            cells.delete(key);
            node.className = node.className.replace(/kpi-strip-\d+/, 'kpi-strip-' + cells.size);
        }
    };
}

function failed(error) {
    return { value: '—', tone: 'failed', sub: 'تعذّر الحساب', title: errorText(error) };
}

/* ===================== أجزاء مشتركة ===================== */

function panel(key, title, iconName, extra) {
    const count = el('span', { class: 'w4-count', hidden: true });
    const body = el('div', { class: 'w4-panel-body' }, loading());
    const id = 'w4-' + key + '-title';
    const node = el('section', { class: 'w4-panel w4-panel-' + key, 'aria-labelledby': id }, [
        el('header', { class: 'w4-panel-head' }, [
            el('h2', { id: id }, [icon(iconName), el('span', { text: title })]),
            count,
            extra
        ]),
        body
    ]);
    return {
        node, body,
        setCount(n) {
            count.textContent = number(n);
            count.hidden = !n;
        }
    };
}

function emptyPanel(ico, title, hint) {
    return el('div', { class: 'w4-empty' }, [
        el('span', { class: 'w4-empty-ico' }, icon(ico)),
        el('strong', { text: title }),
        el('span', { text: hint })
    ]);
}

function morePanel(text, href, onclick) {
    return el('a', { class: 'w4-more', href: href, onclick: onclick || null }, [el('span', { text: text }), icon('arrow')]);
}

function stageId(stages, key, fallback) {
    const found = (stages || []).find((s) => s && s.key === key);
    return found ? found.id : fallback;
}

/* ===================== الإجراءات السريعة ===================== */

function quickActions(onSaved) {
    return [
        el('button', {
            type: 'button', class: 'btn btn-primary w4-qbtn',
            onclick: () => openClientForm(null, (saved) => {
                if (saved && saved.id) location.hash = '#/clients/' + saved.id;
                else onSaved();
            })
        }, [icon('userPlus'), el('span', { text: 'عميل جديد' })])
        // زر واحد في الرأس: البحث في الشريط العلوي (وعلى الجوال تحته)، و«إضافة عرض» باب في القائمة، و«كل المواعيد»
        // رابط في رأس قائمة «يحتاج إجراء».
    ];
}

/* ===================== السطور ===================== */

// اتصال وواتساب (إن وُجد رقم) — بحجم الإصبع على الجوال، ولكل رابط اسم يُقرأ
function contactLinks(phone, name) {
    if (!phone) return [];
    return [
        el('a', {
            class: 'w4-icon', href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), title: 'اتصال: ' + phone
        }, [icon('phone'), el('span', { class: 'w4-sr', text: 'اتصال بـ ' + name })]),
        el('a', {
            class: 'w4-icon w4-icon-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener', title: 'واتساب: ' + phone
        }, [icon('chat'), el('span', { class: 'w4-sr', text: 'واتساب ' + name })])
    ];
}

function requestRow(row) {
    return el('li', { class: 'w4-row w4-row-deal' }, [
        el('a', { class: 'w4-main w4-row-link', href: '#/clients/' + row.client_id + '/requirements/' + row.id }, [
            el('div', { class: 'w4-top' }, [
                el('span', { class: 'w4-name', text: (row.client && row.client.full_name) || 'عميل' }),
                badge(label(REQUEST_PURPOSE, row.purpose), row.purpose === 'rent' ? 'blue' : 'neutral')
            ]),
            el('p', { class: 'w4-purpose', text: [row.property_type, row.city].filter(Boolean).join(' · ') || 'طلب عقار' }),
            el('p', { class: 'w4-meta', text: budgetText(row) + ' · أُضيف ' + dayText(row.created_at) })
        ])
    ]);
}
