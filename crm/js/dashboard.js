// ‎#/dashboard‎ — لوحة الإدارة (للمدير).
//
// كل الأرقام من عروض معرّفة security_invoker: v_my_work و v_funnel_monthly و
// v_broker_performance و v_lost_reasons_90d. فهي محسوبة أصلاً تحت صلاحيات
// المستخدم نفسه، ولا يُرشَّح شيء منها بالمستخدم في الواجهة.
//
// لا مكتبة رسوم: القمع أشرطة أفقية بعرض نسبي، والباقي جداول.

import { supabase } from './supabase.js';
import {
    el, append, replace, loading, empty, errorBox, money, number, dash, pageHead, actionBtn, countText
} from './ui.js';
import { WORK_CARDS } from './work.js';
import { todaySpend } from './settings.js';

// بطاقات الشهر الجاري من v_funnel_monthly
const FUNNEL_CARDS = [
    { key: 'new_clients', label: 'عملاء جدد' },
    { key: 'new_requirements', label: 'طلبات جديدة' },
    { key: 'requirements_matched', label: 'مطابقات' },
    { key: 'viewings', label: 'معاينات' },
    { key: 'negotiations', label: 'مفاوضات' },
    { key: 'won', label: 'صفقات تمت' },
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
    
];

export async function renderDashboard(root) {
    const stats = el('div', { class: 'stats-bar admin-stats' });
    const funnelBody = el('div');
    const brokersBody = el('div');
    const lostBody = el('div');
    const monthsBody = el('div');
    const attentionBody = el('div');
    const systemBody = el('div');

    replace(root, el('div', { class: 'dashboard-shell' }, [
        pageHead('لوحة الإدارة', 'صورة مختصرة عن العملاء والصفقات والمخزون.', [
            actionBtn('التقارير', 'chart', { href: '#/reports' })
        ]),
        stats,
        card('حالة النظام', systemBody),
        card('يحتاج انتباه', attentionBody),
        el('div', { class: 'dashboard-grid dashboard-grid-wide' }, [card('القمع — الشهر الجاري', funnelBody), card('أداء الوسطاء', brokersBody)]),
        el('div', { class: 'dashboard-grid' }, [card('لماذا نخسر (90 يوماً)', lostBody), card('آخر 12 شهراً', monthsBody)])
    ]));

    replace(stats, loading());
    replace(systemBody, loading());
    renderSystem(systemBody);
    for (const body of [attentionBody, funnelBody, brokersBody, lostBody, monthsBody]) replace(body, loading());

    // العروض صغيرة ومحدودة بطبيعتها (12 شهراً، طاقم العمل، أسباب الخسارة)،
    // ومع ذلك لكل استعلام مدى صريح فلا يُفتح باب قراءة غير محدودة.
    const [work, funnel, brokers, lost, attention] = await Promise.all([
        supabase.from('v_my_work').select('*').maybeSingle(),
        supabase.from('v_funnel_monthly').select('*').order('month', { ascending: false }).range(0, 11),
        supabase.from('v_broker_performance').select('*')
            .order('won_90d', { ascending: false })
            .order('commission_gross_90d', { ascending: false })
            .range(0, 24),
        supabase.from('v_lost_reasons_90d').select('*').order('deals', { ascending: false }).range(0, 24),
        supabase.from('v_inventory_attention').select('id, name, issues, listing_expires_at')
            .order('listing_expires_at', { ascending: true, nullsFirst: false }).range(0, 5)
    ]);
    if (!root.isConnected) return;

    const months = funnel.data || [];
    const current = months.length ? months[0] : null;

    renderStats(stats, work, funnel, current);
    renderAttention(attentionBody, attention);
    renderFunnel(funnelBody, funnel, current);
    renderTable(brokersBody, brokers, BROKER_COLUMNS, 'لا توجد بيانات أداء بعد', 'تعذّر تحميل أداء الوسطاء');
    renderTable(lostBody, lost, [
        { key: 'reason', label: 'السبب', text: true },
        { key: 'deals', label: 'صفقات خاسرة' }
    ], 'لا توجد صفقات خاسرة في آخر 90 يوماً', 'تعذّر تحميل أسباب الخسارة');
    renderTable(monthsBody, funnel, MONTH_COLUMNS, 'لا توجد بيانات شهرية', 'تعذّر تحميل تقرير الأشهر');
}

/* ===================== حالة النظام ===================== */
// أربعة أسطر بلون الحالة: آخر نسخة احتياطية (من سجل GitHub العام للمستودع)، وصرف المساعد اليوم مقابل حده،
// وطلبات المساعد العالقة، وما ينتظر الاعتماد. كل سطر يُحسب وحده، وتعذّر أحدها لا يخفي البقية.

const STUCK_MINUTES = 30;

async function renderSystem(host) {
    const rows = await Promise.all([backupLine(), spendLine(), stuckLine(), approvalsLine()]);
    if (!host.isConnected) return;
    replace(host, el('ul', { class: 'sys-list' }, rows.map((row) => el('li', { class: 'sys-row sys-' + row.tone }, [
        el('span', { class: 'sys-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'sys-label', text: row.label }),
        row.href ? el('a', { class: 'sys-value', href: row.href, text: row.text }) : el('span', { class: 'sys-value', text: row.text })
    ]))));
}

function ago(iso) {
    const hours = Math.floor((Date.now() - Date.parse(iso)) / 3600000);
    if (hours < 1) return 'قبل أقل من ساعة';
    if (hours < 48) return 'قبل ' + countText(hours, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']);
    return 'قبل ' + countText(Math.floor(hours / 24), ['يوم', 'يومين', 'أيام', 'يوماً']);
}

async function backupLine() {
    const label = 'النسخة الاحتياطية';
    try {
        const res = await fetch('https://api.github.com/repos/mohammedalseari-design/mulaem-dash/actions/workflows/backup.yml/runs?status=success&per_page=1',
            { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        const run = body && Array.isArray(body.workflow_runs) ? body.workflow_runs[0] : null;
        if (!run) return { label, tone: 'bad', text: 'لا توجد نسخة ناجحة' };
        const hours = (Date.now() - Date.parse(run.created_at)) / 3600000;
        return { label, tone: hours > 36 ? 'bad' : 'ok', text: 'آخر نسخة ناجحة ' + ago(run.created_at) };
    } catch (_) {
        return { label, tone: 'unknown', text: 'تعذّر الفحص الآن' };
    }
}

async function spendLine() {
    const label = 'صرف المساعد اليوم';
    const [spent, capRow] = await Promise.all([
        todaySpend(),
        supabase.from('crm_settings').select('value').eq('key', 'agent_daily_usd_cap').maybeSingle()
    ]);
    if (spent === null) return { label, tone: 'unknown', text: 'تعذّر الحساب' };
    const raw = capRow && capRow.data ? capRow.data.value : null;
    const cap = typeof raw === 'number' ? raw : Number(raw) || 2;
    const share = cap > 0 ? spent / cap : 1;
    return {
        label, href: '#/settings',
        tone: share >= 1 ? 'bad' : share >= 0.8 ? 'warn' : 'ok',
        text: spent.toFixed(2) + ' من ' + cap + ' دولار' + (share >= 1 ? ' — توقف المساعد لبلوغ الحد' : '')
    };
}

async function stuckLine() {
    const label = 'طلبات المساعد';
    const since = new Date(Date.now() - STUCK_MINUTES * 60000).toISOString();
    const [stuck, running] = await Promise.all([
        supabase.from('agent_requests').select('id', { count: 'exact', head: true })
            .in('status', ['queued', 'running']).lt('updated_at', since),
        supabase.from('agent_requests').select('id', { count: 'exact', head: true }).eq('status', 'running')
    ]);
    if (stuck.error || running.error) return { label, tone: 'unknown', text: 'تعذّر الفحص' };
    if (stuck.count) {
        return { label, href: '#/assistant', tone: 'bad', text: stuck.count + ' عالق منذ أكثر من ' + STUCK_MINUTES + ' دقيقة' };
    }
    return { label, tone: 'ok', text: running.count ? 'يعمل الآن على ' + running.count : 'لا طلبات عالقة' };
}

async function approvalsLine() {
    const label = 'بانتظار اعتمادك';
    const [drafts, projects] = await Promise.all([
        supabase.from('agent_drafts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    if (drafts.error || projects.error) return { label, tone: 'unknown', text: 'تعذّر العدّ' };
    const n = (drafts.count || 0) + (projects.count || 0);
    return { label, href: n ? '#/approvals' : null, tone: n ? 'warn' : 'ok', text: n ? n + ' طلب' : 'لا شيء' };
}

function renderAttention(host, result) {
    if (result.error) return void replace(host, errorBox(result.error, 'تعذّر تحميل التنبيهات'));
    const rows = result.data || [];
    if (!rows.length) return void replace(host, empty('لا توجد عناصر تحتاج انتباهًا'));

    const list = el('div', { class: 'dashboard-attention-list' });
    rows.forEach((row) => {
        list.appendChild(el('a', { class: 'dashboard-attention-item', href: '#/inventory' }, [
            el('span', { class: 'dashboard-attention-dot' }),
            el('span', {}, [
                el('strong', { text: dash(row.name) }),
                el('small', { text: (row.issues || []).join(' · ') || 'مراجعة العقار' })
            ]),
            el('span', { class: 'dashboard-attention-date', text: row.listing_expires_at || '—' })
        ]));
    });
    replace(host, list);
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
        host.appendChild(tile(number(work.data ? work.data[item.key] : 0), item.label, item.key));
    }
    for (const item of FUNNEL_CARDS) {
        const value = current ? current[item.key] : 0;
        host.appendChild(tile(item.money ? money(value) : number(value), item.label, item.key));
    }
}

// key يختار أيقونة البطاقة في css/theme.css
function tile(value, label, key) {
    return el('div', { class: 'stat-card', dataset: key ? { key: key } : null }, [
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
