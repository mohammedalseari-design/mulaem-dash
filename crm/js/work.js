// ‎#/work‎ — "عملي اليوم".
//
// لا يوجد أي ترشيح بالمستخدم هنا: v_my_work معرّف security_invoker وسياسات
// follow_ups تتكفّل بالباقي، فالمدير يرى الجميع والوسيط يرى نفسه تلقائياً.
//
// حدود اليوم: v_my_work صارت تحسب "اليوم" و"المتأخر" بتوقيت Asia/Riyadh
// (006_inventory_quality.sql)، فالقائمتان ترسلان بداية اليوم المحلي وبداية الغد
// نصّاً ISO بإزاحة المتصفح، كي يطابق عدّاد البطاقة طول القائمة تماماً.
//
// التصميم السادس «الوسيط» (2026-10-23): أرقام الوسيط في صف واحد، كل رقم يأخذك إلى ما وراءه:
// المتأخرة، ومواعيد اليوم، والمعاينات القادمة (متابعات بقناة «زيارة» في الأيام السبعة القادمة)، والعملاء المحتملون
// (عملاء لهم طلب شراء أو إيجار نشط)، والصفقات الجارية، والعمولات التي لم تُحصّل. مركز الاتصال لا يرى الرقمين
// الأخيرين (لا صفقات له). تحتها أربع لوحات: «متابعات متأخرة» و«مواعيد اليوم» كما كانتا، ثم «المعاينات القادمة»
// و«صفقات تحتاج متابعة» (لمركز الاتصال: «طلبات جديدة»). على الجوال مفتاح يعرض لوحة واحدة كاملة.
// كل رقم وكل لوحة استعلام مستقل: تعذّر أحدها يظهر في مكانه ولا يخفي البقية.

import { supabase, PAGE_SIZE, pageRange, pageBack, fetchAll } from './supabase.js';
import { staffMap, staffName, dealStages, stageMap, stageName } from './data.js';
import { CHANNEL, DEAL_STAGE_TONE, REQUEST_PURPOSE, label } from './labels.js';
import { myRole } from './auth.js';
import {
    el, replace, loading, errorBox, pager, fmtDateTime, fmtDate, dayText,
    localDayStart, number, waNumber, icon, money, badge, errorText
} from './ui.js';
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

const OPEN_COMMISSION = ['due', 'invoiced', 'partial'];
const VISIT_DAYS = 7;
const SOON_DAYS = 14;
const PANEL_ROWS = 6;

const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const FMT_TODAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const FMT_TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });

export async function renderWork(root) {
    const noDeals = myRole() === 'callcenter';
    const sub = el('p', { class: 'w4-sub', text: FMT_TODAY.format(new Date()) });

    // اللوحات الأربع: المفتاح على الجوال يعرض واحدة منها
    const panels = {
        late: panel('late', 'متابعات متأخرة', 'alert', el('span', { class: 'w4-panel-hint', text: 'الأقدم أولاً' })),
        today: panel('today', 'مواعيد اليوم', 'today', el('a', { class: 'w4-panel-hint w4-panel-link', href: '#/calendar', text: 'كل المواعيد' })),
        visits: panel('visits', 'المعاينات القادمة (7 أيام)', 'eye', el('a', {
            class: 'w4-panel-hint w4-panel-link', href: '#/calendar', text: 'كل المعاينات',
            onclick: () => presetCalendarScope('visits')
        })),
        deals: noDeals
            ? panel('deals', 'طلبات جديدة', 'file', el('a', { class: 'w4-panel-hint w4-panel-link', href: '#/requests', text: 'كل الطلبات' }))
            : panel('deals', 'صفقات تحتاج متابعة', 'briefcase', el('a', { class: 'w4-panel-hint w4-panel-link', href: '#/deals', text: 'كل الصفقات' }))
    };
    const board = el('div', { class: 'w4-board w6-board', dataset: { show: 'late' } }, Object.values(panels).map((p) => p.node));

    const segButtons = {};
    const seg = el('div', { class: 'w4-seg w6-seg', role: 'group', 'aria-label': 'اختر القائمة' }, Object.keys(panels).map((key) => {
        const short = { late: 'المتأخرة', today: 'اليوم', visits: 'المعاينات', deals: noDeals ? 'الطلبات' : 'الصفقات' }[key];
        const button = el('button', {
            type: 'button', dataset: { show: key }, 'aria-pressed': key === 'late' ? 'true' : 'false',
            onclick: () => { userPicked = true; show(key); }
        }, [el('span', { text: short }), panels[key].segCount]);
        segButtons[key] = button;
        return button;
    }));
    let userPicked = false;
    function show(which) {
        board.dataset.show = which;
        for (const key of Object.keys(segButtons)) segButtons[key].setAttribute('aria-pressed', key === which ? 'true' : 'false');
    }
    function focusPanel(key) {
        show(key);
        panels[key].node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const kpis = kpiStrip([
        { key: 'overdue', label: 'متابعات متأخرة', go: () => focusPanel('late') },
        { key: 'today', label: 'مواعيد اليوم', go: () => focusPanel('today') },
        { key: 'visits', label: 'معاينات قادمة', go: () => focusPanel('visits') },
        { key: 'leads', label: 'عملاء محتملون', href: '#/requests' },
        noDeals ? null : { key: 'deals', label: 'صفقات جارية', href: '#/deals' },
        noDeals ? null : { key: 'commission', label: 'عمولات لم تُحصّل', href: '#/commissions' }
    ].filter(Boolean));

    replace(root, el('div', { class: 'w4 w6' }, [
        el('header', { class: 'w4-head' }, [
            el('div', { class: 'w4-title' }, [el('h1', { text: 'عملي اليوم' }), sub]),
            el('div', { class: 'w4-quick', 'aria-label': 'إجراءات سريعة' }, quickActions(() => reloadAll()))
        ]),
        // الجوال بلا شريط علوي: البحث السريع هنا، أول ما تراه العين
        el('button', { type: 'button', class: 'work-search', onclick: () => openPalette() }, [
            icon('search'), el('span', { text: 'ابحث عن عميل أو جوال أو عقار…' })
        ]),
        kpis.node,
        seg,
        board
    ]));

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        replace(panels.late.body, errorBox(error, 'تعذّر تحميل أسماء الموظفين', () => renderWork(root)));
        return;
    }
    if (!root.isConnected) return;

    const lateList = followUpList(panels.late, 'overdue', (rows) => {
        if (!rows.length) return emptyPanel('check', 'لا متابعات متأخرة', 'كل ما فات موعده أُنجز.');
        return el('ol', { class: 'w4-list' }, rows.map((row) => lateRow(row, names, reloadAll)));
    });
    const todayList = followUpList(panels.today, 'today', (rows) => {
        if (!rows.length) return emptyPanel('today', 'لا مواعيد اليوم', 'أضف متابعة من ملف العميل لتظهر هنا في وقتها.');
        return el('ol', { class: 'w4-list' }, rows.map((row) => todayRow(row, names, reloadAll)));
    });

    /* ---------- الأرقام ---------- */

    async function loadStats() {
        kpis.loading();
        const today = localDayStart(0).slice(0, 10);
        const soon = localDayStart(SOON_DAYS).slice(0, 10);

        const work = Promise.resolve(supabase.from('v_my_work').select('*').maybeSingle()).catch((error) => ({ error }));
        const visits = Promise.resolve(supabase.from('follow_ups').select('id', { count: 'exact', head: true })
            .eq('status', 'pending').eq('channel', 'visit').gte('due_at', localDayStart(0)).lt('due_at', localDayStart(VISIT_DAYS + 1))).catch((error) => ({ error }));
        const leads = fetchAll(() => supabase.from('client_requirements').select('id, client_id').in('status', ACTIVE_REQUEST).order('id', { ascending: true }));

        const [w, v, l] = await Promise.all([work, visits, leads]);
        if (!kpis.node.isConnected) return;

        const value = (key) => Number(w.data && w.data[key]) || 0;
        const overdue = value('follow_ups_overdue');
        const todayCount = value('follow_ups_today');

        // سطر تحت العنوان: التاريخ وخلاصة اليوم
        if (!w.error) {
            replace(sub, [
                FMT_TODAY.format(new Date()) + ' · ',
                overdue ? el('b', { class: 'w4-sub-late', text: arCount(overdue, 'متابعة متأخرة', 'متابعتان متأخرتان', 'متابعات متأخرة', 'متابعة متأخرة') }) : 'لا متأخرات',
                ' · ',
                el('b', { text: todayCount ? arCount(todayCount, 'موعد اليوم', 'موعدان اليوم', 'مواعيد اليوم', 'موعداً اليوم') : 'لا مواعيد اليوم' })
            ]);
            // على الجوال تفتح الصفحة على المتأخرة إن وُجدت، وإلا على مواعيد اليوم
            if (!userPicked) show(overdue ? 'late' : 'today');
        }

        kpis.set('overdue', w.error ? failed(w.error) : { value: number(overdue), tone: overdue ? 'late' : null, sub: overdue ? 'ابدأ بالأقدم' : 'لا شيء متأخر' });
        kpis.set('today', w.error ? failed(w.error) : { value: number(todayCount), sub: todayCount ? 'مكالمات وزيارات اليوم' : 'يومك خالٍ من المواعيد' });
        // النافذة نفسها للرقم ولوحة «المعاينات القادمة» (سبعة أيام)؛ «كل المعاينات» في المواعيد بلا حد، فالسطر يقول المدة صراحة
        kpis.set('visits', v.error ? failed(v.error) : {
            value: number(v.count || 0),
            sub: v.count ? 'خلال ' + VISIT_DAYS + ' أيام' : 'لا شيء خلال ' + VISIT_DAYS + ' أيام'
        });
        if (l.error) kpis.set('leads', failed(l.error));
        else {
            const clients = new Set((l.data || []).map((row) => row.client_id)).size;
            const fresh = w.error ? 0 : value('new_requirements_7d');
            kpis.set('leads', { value: number(clients), sub: fresh ? arCount(fresh, 'طلب جديد هذا الأسبوع', 'طلبان جديدان هذا الأسبوع', 'طلبات جديدة هذا الأسبوع', 'طلباً جديداً هذا الأسبوع') : 'لهم طلب شراء أو إيجار نشط' });
        }

        if (noDeals) return;
        const [stages, commissions] = await Promise.all([
            dealStages().catch((error) => ({ error })),
            fetchAll(() => supabase.from('commissions').select('id, gross_amount, collected_amount').in('status', OPEN_COMMISSION).order('id', { ascending: true }))
        ]);
        if (!kpis.node.isConnected) return;

        if (commissions.error) kpis.set('commission', failed(commissions.error));
        else {
            const rows = commissions.data || [];
            const remaining = rows.reduce((sum, row) => sum + Math.max(0, Number(row.gross_amount || 0) - Number(row.collected_amount || 0)), 0);
            kpis.set('commission', { value: money(remaining), unit: 'ر.س', tone: remaining > 0 ? 'due' : null,
                sub: rows.length ? 'على ' + arCount(rows.length, 'عمولة واحدة', 'عمولتين', 'عمولات', 'عمولة') : 'لا شيء معلّق' });
        }

        if (stages.error) return void kpis.set('deals', failed(stages.error));
        const openIds = stages.filter((s) => !s.is_terminal).map((s) => s.id);
        const dealsBase = () => supabase.from('deals').select('id', { count: 'exact', head: true }).in('stage_id', openIds);
        const [all, late, closing] = await Promise.all([
            Promise.resolve(dealsBase()).catch((error) => ({ error })),
            Promise.resolve(dealsBase().lt('expected_close_date', today)).catch((error) => ({ error })),
            Promise.resolve(dealsBase().gte('expected_close_date', today).lte('expected_close_date', soon)).catch((error) => ({ error }))
        ]);
        if (!kpis.node.isConnected) return;
        if (all.error) return void kpis.set('deals', failed(all.error));
        // العدد صريح دائماً تحت الرقم («صفقة متأخرة…» لا «تجاوزت…» وحدها، فلا يُفهم أن الصفقات كلها متأخرة)
        kpis.set('deals', {
            value: number(all.count || 0),
            subTone: late.count ? 'late' : null,
            sub: late.count ? arCount(late.count, 'صفقة متأخرة عن موعدها', 'صفقتان متأخرتان عن موعدهما', 'صفقات متأخرة عن موعدها', 'صفقة متأخرة عن موعدها')
                : closing.count ? arCount(closing.count, 'صفقة تُغلق خلال أسبوعين', 'صفقتان تُغلقان خلال أسبوعين', 'صفقات تُغلق خلال أسبوعين', 'صفقة تُغلق خلال أسبوعين')
                : 'من الاهتمام حتى الإغلاق'
        });
    }

    /* ---------- اللوحتان الجديدتان ---------- */

    async function loadVisits() {
        replace(panels.visits.body, loading());
        const { data, error, count } = await Promise.resolve(supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, assigned_to, client_id, requirement_id, client:clients(full_name, phone)', { count: 'exact' })
            .eq('status', 'pending').eq('channel', 'visit')
            .gte('due_at', localDayStart(0)).lt('due_at', localDayStart(VISIT_DAYS + 1))
            .order('due_at', { ascending: true })
            .range(0, PANEL_ROWS - 1)).catch((e) => ({ error: e }));
        if (!panels.visits.body.isConnected) return;
        if (error) return void replace(panels.visits.body, errorBox(error, 'تعذّر تحميل المعاينات', loadVisits));
        panels.visits.setCount(count || 0);
        const rows = data || [];
        if (!rows.length) {
            return void replace(panels.visits.body, emptyPanel('eye', 'لا معاينات في الأيام السبعة القادمة',
                'موعد المعاينة متابعة بقناة «زيارة» من ملف العميل.'));
        }
        replace(panels.visits.body, [
            el('ol', { class: 'w4-list' }, rows.map((row) => visitRow(row, names, reloadAll))),
            count > rows.length ? morePanel('و' + arCount(count - rows.length, 'معاينة أخرى', 'معاينتان أخريان', 'معاينات أخرى', 'معاينة أخرى'), '#/calendar', () => presetCalendarScope('visits')) : null
        ]);
    }

    async function loadDeals() {
        replace(panels.deals.body, loading());
        if (noDeals) return void loadNewRequests();
        let stages;
        try {
            stages = await stageMap();
        } catch (error) {
            return void replace(panels.deals.body, errorBox(error, 'تعذّر تحميل مراحل الصفقات', loadDeals));
        }
        const openIds = [...stages.values()].filter((s) => !s.is_terminal).map((s) => s.id);
        // الأقرب إغلاقاً أولاً (والمتأخرة قبلها لأنها أقدم تاريخاً)، ثم ما لا تاريخ له بحسب الأقدم تحديثاً
        const { data, error, count } = await Promise.resolve(supabase
            .from('deals')
            .select('id, stage_id, amount, unit_key, project_id, expected_close_date, updated_at, client:clients(full_name), project:projects(name)', { count: 'exact' })
            .in('stage_id', openIds)
            .order('expected_close_date', { ascending: true, nullsFirst: false })
            .order('updated_at', { ascending: true })
            .range(0, PANEL_ROWS - 1)).catch((e) => ({ error: e }));
        if (!panels.deals.body.isConnected) return;
        if (error) return void replace(panels.deals.body, errorBox(error, 'تعذّر تحميل الصفقات', loadDeals));
        panels.deals.setCount(count || 0);
        const rows = data || [];
        if (!rows.length) {
            return void replace(panels.deals.body, emptyPanel('briefcase', 'لا صفقات مفتوحة',
                'حين يهتم العميل بعقار افتح له صفقة من صفحة الطلب أو من «العقارات».'));
        }
        replace(panels.deals.body, [
            el('ol', { class: 'w4-list' }, rows.map((row) => dealRow(row, stages))),
            count > rows.length ? morePanel('و' + arCount(count - rows.length, 'صفقة أخرى', 'صفقتان أخريان', 'صفقات أخرى', 'صفقة أخرى'), '#/deals') : null
        ]);
    }

    // مركز الاتصال: أحدث الطلبات المفتوحة مكان الصفقات
    async function loadNewRequests() {
        const { data, error, count } = await Promise.resolve(supabase
            .from('client_requirements')
            .select('id, client_id, purpose, property_type, city, budget_min, budget_max, created_at, client:clients(full_name)', { count: 'exact' })
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .range(0, PANEL_ROWS - 1)).catch((e) => ({ error: e }));
        if (!panels.deals.body.isConnected) return;
        if (error) return void replace(panels.deals.body, errorBox(error, 'تعذّر تحميل الطلبات', loadDeals));
        panels.deals.setCount(count || 0);
        const rows = data || [];
        if (!rows.length) return void replace(panels.deals.body, emptyPanel('file', 'لا طلبات مفتوحة', 'الطلب يُضاف من ملف العميل ← «طلب جديد».'));
        replace(panels.deals.body, [
            el('ol', { class: 'w4-list' }, rows.map(requestRow)),
            count > rows.length ? morePanel('و' + arCount(count - rows.length, 'طلب آخر', 'طلبان آخران', 'طلبات أخرى', 'طلباً آخر'), '#/requests') : null
        ]);
    }

    async function reloadAll() {
        await Promise.all([loadStats(), lateList.reload(), todayList.reload(), loadVisits(), loadDeals()]);
    }

    await reloadAll();
}

/* ===================== الأرقام ===================== */

// شريط الأرقام: كل رقم زر (يفتح لوحته في الصفحة) أو رابط (يفتح صفحته). تُرسم الخانات فوراً وتمتلئ حين تصل أرقامها،
// فلا يقفز التخطيط. set(key, { value, unit, sub, tone, subTone }).
function kpiStrip(defs) {
    const cells = new Map();
    const node = el('div', { class: 'kpi-strip kpi-strip-' + defs.length, role: 'group', 'aria-label': 'أرقام اليوم' }, defs.map((def) => {
        const num = el('span', { class: 'kpi-num' });
        const subLine = el('span', { class: 'kpi-sub' });
        const attrs = { class: 'kpi kpi-link', dataset: { kpi: def.key } };
        const cell = def.href
            ? el('a', Object.assign(attrs, { href: def.href }), [el('span', { class: 'kpi-label', text: def.label }), num, subLine])
            : el('button', Object.assign(attrs, { type: 'button', onclick: def.go }), [el('span', { class: 'kpi-label', text: def.label }), num, subLine]);
        cells.set(def.key, { cell, num, subLine, def });
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
            c.cell.classList.remove('is-loading', 'kpi-late', 'kpi-due', 'kpi-failed');
            c.cell.removeAttribute('aria-busy');
            if (data.tone) c.cell.classList.add('kpi-' + data.tone);
            replace(c.num, [data.value, data.unit ? el('small', { class: 'kpi-unit', text: data.unit }) : null]);
            c.subLine.textContent = data.sub || '';
            c.subLine.className = 'kpi-sub' + (data.subTone ? ' kpi-sub-' + data.subTone : '');
            c.cell.title = data.title || '';
        }
    };
}

function failed(error) {
    return { value: '—', tone: 'failed', sub: 'تعذّر الحساب', title: errorText(error) };
}

/* ===================== اللوحات ===================== */

function panel(key, title, iconName, extra) {
    const count = el('span', { class: 'w4-count' + (key === 'late' ? ' w4-count-late' : ''), hidden: true });
    const segCount = el('span', { class: 'w4-count' + (key === 'late' ? ' w4-count-late' : ''), hidden: true });
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
        node, body, segCount,
        setCount(n) {
            for (const badgeNode of [count, segCount]) {
                badgeNode.textContent = number(n);
                badgeNode.hidden = !n;
            }
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
        // التصميم الخامس: زر واحد في الرأس. البحث في الشريط العلوي (وعلى الجوال تحت العنوان)، و«إضافة عرض» باب في
        // القائمة، و«كل المواعيد» رابط في رأس لوحة مواعيد اليوم.
    ];
}

/* ===================== قوائم المتابعات ===================== */

// قائمة متابعات معلّقة ضمن نطاق زمني، بترقيم مستقل. draw يرسم الصفوف بعد كل تحميل.
function followUpList(target, scope, draw) {
    const view = { page: 0 };
    const host = target.body;
    let seq = 0;

    async function reload() {
        const mine = ++seq;
        replace(host, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, assigned_to, client_id, requirement_id, client:clients(full_name, phone)',
                { count: 'exact' })
            .eq('status', 'pending')
            .range(from, to);

        if (scope === 'today') {
            query = query
                .gte('due_at', localDayStart(0))
                .lt('due_at', localDayStart(1))
                .order('due_at', { ascending: true });
        } else {
            query = query
                .lt('due_at', localDayStart(0))
                .order('due_at', { ascending: true });
        }

        const result = await Promise.resolve(query).catch((e) => ({ error: e }));
        if (mine !== seq || !host.isConnected) return;
        // «تم» على آخر صف في آخر صفحة: يعود إلى آخر صفحة صالحة بدل «لا متابعات» كاذبة
        const back = pageBack(view.page, result);
        if (back !== null) { view.page = back; return reload(); }
        const { data, error, count } = result;
        if (error) return void replace(host, errorBox(error, 'تعذّر تحميل المتابعات', reload));
        const rows = data || [];
        const total = count || rows.length;
        target.setCount(total);
        replace(host, [
            draw(rows, view.page, total),
            total > PAGE_SIZE ? pager(view.page, total, (p) => { view.page = p; reload(); }, PAGE_SIZE) : null
        ]);
    }

    return { reload: reload };
}

function lateRow(row, names, onChanged) {
    const client = row.client || {};
    return el('li', { class: 'w4-row w4-task' }, [
        el('div', { class: 'w4-main' }, [
            el('div', { class: 'w4-top' }, [
                clientLink(row),
                el('span', { class: 'w4-badge w4-badge-late', title: fmtDateTime(row.due_at), text: lateText(new Date(row.due_at)) })
            ]),
            row.purpose ? el('p', { class: 'w4-purpose', text: row.purpose }) : null,
            el('p', { class: 'w4-meta', text: label(CHANNEL, row.channel) + ' · ' + staffName(names, row.assigned_to) })
        ]),
        actions(row, client, onChanged)
    ]);
}

function todayRow(row, names, onChanged) {
    const client = row.client || {};
    const due = new Date(row.due_at);
    const passed = due.getTime() <= Date.now();
    return el('li', { class: 'w4-row w4-row-today w4-task' + (passed ? ' w4-row-due' : '') }, [
        el('div', { class: 'w4-time' }, [
            el('strong', { text: FMT_TIME.format(due) }),
            el('span', { text: soonText(due) })
        ]),
        el('div', { class: 'w4-main' }, [
            el('div', { class: 'w4-top' }, [clientLink(row), row.channel === 'visit' ? el('span', { class: 'w4-badge w4-badge-visit', text: 'معاينة' }) : null]),
            row.purpose ? el('p', { class: 'w4-purpose', text: row.purpose }) : null,
            el('p', { class: 'w4-meta', text: label(CHANNEL, row.channel) + ' · ' + staffName(names, row.assigned_to) })
        ]),
        actions(row, client, onChanged)
    ]);
}

// المعاينة: يومها ووقتها، ثم العميل والغرض، وأزرار الاتصال و«تم» كبقية المتابعات
function visitRow(row, names, onChanged) {
    const client = row.client || {};
    const due = new Date(row.due_at);
    return el('li', { class: 'w4-row w4-row-today w4-row-visit w4-task' }, [
        el('div', { class: 'w4-time' }, [
            el('strong', { text: dayText(row.due_at) }),
            el('span', { text: FMT_TIME.format(due) })
        ]),
        el('div', { class: 'w4-main' }, [
            el('div', { class: 'w4-top' }, [clientLink(row)]),
            row.purpose ? el('p', { class: 'w4-purpose', text: row.purpose }) : null,
            el('p', { class: 'w4-meta', text: staffName(names, row.assigned_to) })
        ]),
        actions(row, client, onChanged)
    ]);
}

// الصفقة: العميل ومرحلتها، والعقار، وموعد الإغلاق المتوقع (بالأحمر إن فات) والقيمة. السطر كله رابط لصفحتها.
function dealRow(row, stages) {
    const today = localDayStart(0).slice(0, 10);
    const late = row.expected_close_date && row.expected_close_date < today;
    const project = row.project && row.project.name ? row.project.name : (row.project_id ? 'عقار رقم ' + row.project_id : 'بدون عقار');
    const when = row.expected_close_date
        ? (late ? 'تجاوزت موعد الإغلاق ' + fmtDate(row.expected_close_date) : 'الإغلاق المتوقع ' + fmtDate(row.expected_close_date))
        : 'بلا موعد إغلاق متوقع';
    return el('li', { class: 'w4-row w4-row-deal' }, [
        el('a', { class: 'w4-main w4-row-link', href: '#/deals/' + row.id }, [
            el('div', { class: 'w4-top' }, [
                el('span', { class: 'w4-name', text: (row.client && row.client.full_name) || 'عميل' }),
                badge(stageName(stages, row.stage_id), DEAL_STAGE_TONE[row.stage_id] || 'neutral')
            ]),
            el('p', { class: 'w4-purpose', text: project + (row.unit_key ? ' · ' + row.unit_key : '') }),
            el('p', { class: 'w4-meta' }, [
                el('span', { class: late ? 'is-late' : null, text: when }),
                row.amount ? ' · ' + money(row.amount) + ' ر.س' : null
            ])
        ])
    ]);
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

function clientLink(row) {
    const client = row.client || {};
    return el('a', { class: 'w4-name', href: '#/clients/' + row.client_id, text: client.full_name || 'فتح ملف العميل' });
}

// اتصال وواتساب (إن وُجد رقم) و«تم» — بحجم الإصبع، ولكل زر اسم يُقرأ
function actions(row, client, onChanged) {
    const name = client.full_name || 'العميل';
    const phone = client.phone;
    return el('div', { class: 'w4-actions' }, [
        phone ? el('a', {
            class: 'w4-icon', href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), title: 'اتصال: ' + phone
        }, [icon('phone'), el('span', { class: 'w4-sr', text: 'اتصال بـ ' + name })]) : null,
        phone ? el('a', {
            class: 'w4-icon w4-icon-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener', title: 'واتساب: ' + phone
        }, [icon('chat'), el('span', { class: 'w4-sr', text: 'واتساب ' + name })]) : null,
        el('button', {
            type: 'button', class: 'btn w4-done', 'aria-label': 'تم: ' + name,
            onclick: () => openDoneForm(row, onChanged)
        }, [icon('check'), el('span', { text: 'تم' })])
    ]);
}

/* ===================== نصوص ===================== */

// العدد مع المعدود بالعربية: 1 مفرد، 2 مثنى، 3–10 جمع، 11+ مفرد منصوب
function arCount(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
}

function lateText(due) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const day = new Date(due); day.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((start - day) / 86400000));
    return 'منذ ' + arCount(days, 'يوم', 'يومين', 'أيام', 'يوماً');
}

function soonText(due) {
    const minutes = Math.round((due.getTime() - Date.now()) / 60000);
    if (minutes <= 0) return 'حان موعدها';
    if (minutes < 60) return 'بعد ' + arCount(minutes, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
    const hours = Math.round(minutes / 60);
    return 'بعد ' + arCount(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
}
