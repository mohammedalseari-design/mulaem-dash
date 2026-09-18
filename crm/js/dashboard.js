// ‎#/dashboard‎ — لوحة الإدارة (للمدير).
//
// كل الأرقام من عروض معرّفة security_invoker: v_my_work و v_funnel_monthly و
// v_broker_performance و v_lost_reasons_90d. فهي محسوبة أصلاً تحت صلاحيات
// المستخدم نفسه، ولا يُرشَّح شيء منها بالمستخدم في الواجهة.
//
// لا مكتبة رسوم: القمع أشرطة أفقية بعرض نسبي، والباقي جداول.

import { supabase } from './supabase.js';
import {
    el, append, replace, loading, empty, errorBox, money, number, dash
} from './ui.js';
import { WORK_CARDS } from './work.js';

// بطاقات الشهر الجاري من v_funnel_monthly
const FUNNEL_CARDS = [
    { key: 'new_clients', label: 'عملاء جدد' },
    { key: 'new_requirements', label: 'طلبات جديدة' },
    { key: 'requirements_matched', label: 'مطابقات' },
    { key: 'viewings', label: 'معاينات' },
    { key: 'negotiations', label: 'مفاوضات' },
    { key: 'won', label: 'صفقات تمت' },
    { key: 'commission_gross', label: 'عمولات (إجمالي)', money: true }
];

// مراحل القمع بالترتيب؛ نسبة التحويل تُحسب من الخطوة التي قبلها
const FUNNEL_STEPS = [
    { key: 'new_clients', label: 'عملاء جدد' },
    { key: 'new_requirements', label: 'طلبات' },
    { key: 'requirements_matched', label: 'طلبات طوبقت' },
    { key: 'viewings', label: 'معاينات' },
    { key: 'negotiations', label: 'مفاوضات' },
    { key: 'won', label: 'صفقات تمت' }
];

const BROKER_COLUMNS = [
    { key: 'fullname', label: 'الوسيط', text: true },
    { key: 'active_clients', label: 'عملاء نشطون' },
    { key: 'open_requirements', label: 'طلبات مفتوحة' },
    { key: 'follow_ups_done_30d', label: 'متابعات منجزة (30 يوماً)' },
    { key: 'follow_ups_overdue', label: 'متابعات متأخرة' },
    { key: 'shared_30d', label: 'عروض شوركت (30 يوماً)' },
    { key: 'deals_open', label: 'صفقات مفتوحة' },
    { key: 'won_90d', label: 'تمت (90 يوماً)' },
    { key: 'lost_90d', label: 'خسرت (90 يوماً)' },
    { key: 'commission_gross_90d', label: 'عمولات (90 يوماً)', money: true },
    { key: 'broker_share_90d', label: 'حصة الوسيط (90 يوماً)', money: true }
];

const MONTH_COLUMNS = [
    { key: 'month', label: 'الشهر', text: true },
    { key: 'new_clients', label: 'عملاء جدد' },
    { key: 'new_requirements', label: 'طلبات' },
    { key: 'requirements_matched', label: 'طوبقت' },
    { key: 'viewings', label: 'معاينات' },
    { key: 'negotiations', label: 'مفاوضات' },
    { key: 'won', label: 'تمت' },
    { key: 'lost', label: 'خسرت' },
    { key: 'commission_gross', label: 'عمولات (إجمالي)', money: true },
    { key: 'commission_collected', label: 'محصَّل', money: true }
];

export async function renderDashboard(root) {
    const stats = el('div', { class: 'stats-bar admin-stats' });
    const funnelBody = el('div');
    const brokersBody = el('div');
    const lostBody = el('div');
    const monthsBody = el('div');

    replace(root, [
        stats,
        card('القمع — الشهر الجاري', funnelBody),
        card('أداء الوسطاء', brokersBody),
        card('لماذا نخسر (90 يوماً)', lostBody),
        card('آخر 12 شهراً', monthsBody)
    ]);

    replace(stats, loading());
    for (const body of [funnelBody, brokersBody, lostBody, monthsBody]) replace(body, loading());

    // العروض صغيرة ومحدودة بطبيعتها (12 شهراً، طاقم العمل، أسباب الخسارة)،
    // ومع ذلك لكل استعلام مدى صريح فلا يُفتح باب قراءة غير محدودة.
    const [work, funnel, brokers, lost] = await Promise.all([
        supabase.from('v_my_work').select('*').maybeSingle(),
        supabase.from('v_funnel_monthly').select('*').order('month', { ascending: false }).range(0, 11),
        supabase.from('v_broker_performance').select('*')
            .order('won_90d', { ascending: false })
            .order('commission_gross_90d', { ascending: false })
            .range(0, 24),
        supabase.from('v_lost_reasons_90d').select('*').order('deals', { ascending: false }).range(0, 24)
    ]);
    if (!root.isConnected) return;

    const months = funnel.data || [];
    const current = months.length ? months[0] : null;

    renderStats(stats, work, funnel, current);
    renderFunnel(funnelBody, funnel, current);
    renderTable(brokersBody, brokers, BROKER_COLUMNS, 'لا توجد بيانات أداء بعد', 'تعذّر تحميل أداء الوسطاء');
    renderTable(lostBody, lost, [
        { key: 'reason', label: 'السبب', text: true },
        { key: 'deals', label: 'صفقات خاسرة' }
    ], 'لا توجد صفقات خاسرة في آخر 90 يوماً', 'تعذّر تحميل أسباب الخسارة');
    renderTable(monthsBody, funnel, MONTH_COLUMNS, 'لا توجد بيانات شهرية', 'تعذّر تحميل تقرير الأشهر');
}

function card(title, body) {
    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: title })]),
        body
    ]);
}

/* ===================== البطاقات ===================== */

function renderStats(host, work, funnel, current) {
    replace(host, []);
    if (work.error) return void append(host, errorBox(work.error, 'تعذّر تحميل مؤشرات اليوم'));
    if (funnel.error) return void append(host, errorBox(funnel.error, 'تعذّر تحميل مؤشرات الشهر'));

    for (const item of WORK_CARDS) {
        host.appendChild(tile(number(work.data ? work.data[item.key] : 0), item.label));
    }
    for (const item of FUNNEL_CARDS) {
        const value = current ? current[item.key] : 0;
        host.appendChild(tile(item.money ? money(value) : number(value), item.label));
    }
}

function tile(value, label) {
    return el('div', { class: 'stat-card' }, [
        el('h3', { text: value }),
        el('p', { text: label })
    ]);
}

/* ===================== القمع ===================== */

function renderFunnel(host, funnel, current) {
    if (funnel.error) return void replace(host, errorBox(funnel.error, 'تعذّر تحميل القمع'));
    if (!current) return void replace(host, empty('لا توجد بيانات لهذا الشهر'));

    const values = FUNNEL_STEPS.map((step) => Number(current[step.key] || 0));
    const top = Math.max.apply(null, values.concat([1]));

    const list = el('div', { class: 'funnel' });
    FUNNEL_STEPS.forEach((step, index) => {
        const value = values[index];
        const previous = index === 0 ? null : values[index - 1];
        const rate = previous ? (previous === 0 ? null : Math.round((value / previous) * 100)) : null;

        list.appendChild(el('div', { class: 'funnel-row' }, [
            el('span', { class: 'funnel-label', text: step.label }),
            el('span', { class: 'funnel-bar' },
                el('span', { class: 'funnel-fill', style: 'width:' + Math.round((value / top) * 100) + '%' })),
            el('span', { class: 'funnel-value num', text: number(value) }),
            el('span', {
                class: 'funnel-rate crm-subtle',
                text: index === 0 ? '' : (rate === null ? '—' : rate + '% من ' + FUNNEL_STEPS[index - 1].label)
            })
        ]));
    });

    replace(host, [
        el('div', { class: 'crm-subtle', style: 'margin-bottom:12px', text: 'الشهر: ' + dash(current.month) }),
        list
    ]);
}

/* ===================== الجداول ===================== */

function renderTable(host, result, columns, emptyText, errorPrefix) {
    if (result.error) return void replace(host, errorBox(result.error, errorPrefix));
    const rows = result.data || [];
    if (rows.length === 0) return void replace(host, empty(emptyText));

    const head = el('thead', {}, el('tr', {}, columns.map((column) => el('th', { text: column.label }))));
    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, columns.map((column) => {
            if (column.text) return el('td', {}, el('strong', { text: dash(row[column.key]) }));
            return el('td', { class: 'num', text: column.money ? money(row[column.key]) : number(row[column.key]) });
        })));
    }

    replace(host, el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, body])));
}
