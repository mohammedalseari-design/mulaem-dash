// #/reports — التقارير التحليلية، منفصلة عن Dashboard الأساسي.

import { supabase } from './supabase.js';
import { el, replace, loading, empty, errorBox, badge, money, number, dash } from './ui.js';

export async function renderReports(root) {
    const funnelBody = el('div');
    const brokersBody = el('div');
    const priorityBody = el('div');
    const gapBody = el('div');
    const broker = el('select', { class: 'crm-filter-select' }, [
        el('option', { value: '', text: 'كل الوسطاء' })
    ]);
    const period = el('select', { class: 'crm-filter-select' }, [
        el('option', { value: '3', text: 'آخر 3 أشهر' }),
        el('option', { value: '6', text: 'آخر 6 أشهر' }),
        el('option', { value: '12', text: 'آخر 12 شهرًا', selected: true })
    ]);
    const exportButton = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تصدير CSV' });
    const printButton = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'طباعة / PDF' });

    replace(root, el('div', { class: 'dashboard-shell' }, [
        el('div', { class: 'dashboard-intro' }, [
            el('div', {}, [
                el('h1', { text: 'التقارير' }),
                el('p', { text: 'قراءة تشغيلية للقمع والأداء والمخزون.' })
            ]),
            el('div', { class: 'dashboard-intro-meta', text: 'بيانات النظام الحالية' })
        ]),
        el('div', { class: 'crm-toolbar' }, [
            el('span', { class: 'crm-subtle', text: 'نطاق القمع' }), period,
            el('span', { class: 'crm-subtle', text: 'الوسيط' }), broker, exportButton, printButton
        ]),
        el('div', { class: 'dashboard-grid' }, [card('القمع الشهري', funnelBody), card('أداء الوسطاء', brokersBody)]),
        el('div', { class: 'dashboard-grid' }, [card('أولوية العرض', priorityBody), card('فجوة الطلب حسب الحي', gapBody)])
    ]));
    [funnelBody, brokersBody, priorityBody, gapBody].forEach((body) => replace(body, loading()));

    const [funnel, brokers, priority, gap] = await Promise.all([
        supabase.from('v_funnel_monthly').select('*').order('month', { ascending: false }).range(0, 11),
        supabase.from('v_broker_performance').select('fullname, active_clients, open_requirements, follow_ups_done_30d, follow_ups_overdue, deals_open, won_90d, lost_90d').order('won_90d', { ascending: false }).range(0, 24),
        supabase.from('v_inventory_priority').select('id, name, district, completeness_score, priority_score').order('priority_score', { ascending: false }).range(0, 19),
        supabase.from('v_inventory_demand_gap').select('district, open_requests, available_properties, gap, state').order('gap', { ascending: false }).range(0, 24)
    ]);
    if (!root.isConnected) return;

    const paintFunnel = () => renderFunnel(funnelBody, {
        error: funnel.error,
        data: (funnel.data || []).slice(0, Number(period.value))
    });
    period.addEventListener('change', paintFunnel);
    const brokerRows = brokers.data || [];
    brokerRows.forEach((row) => broker.appendChild(el('option', { value: row.fullname, text: row.fullname })));
    const paintBrokers = () => renderTable(brokersBody, {
        error: brokers.error,
        data: broker.value ? brokerRows.filter((row) => row.fullname === broker.value) : brokerRows
    }, [
        ['fullname', 'الوسيط'], ['active_clients', 'عملاء نشطون'], ['open_requirements', 'طلبات مفتوحة'],
        ['follow_ups_done_30d', 'متابعات منجزة'], ['follow_ups_overdue', 'متأخرة'], ['deals_open', 'صفقات مفتوحة'],
        ['won_90d', 'تمت'], ['lost_90d', 'خسرت']
    ], 'لا توجد بيانات أداء');
    broker.addEventListener('change', paintBrokers);
    exportButton.addEventListener('click', () => exportReports({
        funnel: (funnel.data || []).slice(0, Number(period.value)),
        brokers: broker.value ? brokerRows.filter((row) => row.fullname === broker.value) : brokerRows,
        priority: priority.data || [],
        gap: gap.data || [],
        period: period.value,
        broker: broker.value
    }));
    printButton.addEventListener('click', () => printReports({
        funnel: (funnel.data || []).slice(0, Number(period.value)),
        brokers: broker.value ? brokerRows.filter((row) => row.fullname === broker.value) : brokerRows,
        priority: priority.data || [],
        gap: gap.data || [],
        period: period.value,
        broker: broker.value
    }));
    paintFunnel();
    paintBrokers();
    renderPriority(priorityBody, priority);
    renderGap(gapBody, gap);
}

function card(title, body) {
    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: title })]), body
    ]);
}

function renderFunnel(host, result) {
    if (result.error) return void replace(host, errorBox(result.error, 'تعذّر تحميل القمع'));
    const rows = result.data || [];
    if (!rows.length) return void replace(host, empty('لا توجد بيانات شهرية'));
    const columns = [['month', 'الشهر'], ['new_clients', 'عملاء'], ['new_requirements', 'طلبات'], ['requirements_matched', 'طوبقت'], ['viewings', 'معاينات'], ['negotiations', 'مفاوضات'], ['won', 'تمت']];
    renderTable(host, { data: rows, error: null }, columns, 'لا توجد بيانات شهرية');
}

function renderPriority(host, result) {
    if (result.error) return void replace(host, errorBox(result.error, 'تعذّر تحميل أولوية العرض'));
    const rows = result.data || [];
    if (!rows.length) return void replace(host, empty('لا توجد عقارات جاهزة للعرض'));
    replace(host, table([
        ['العقار', 'name'], ['الحي', 'district'], ['اكتمال البيانات', 'completeness_score'], ['أولوية العرض', 'priority_score']
    ], rows, (row, key) => key === 'name' ? dash(row[key]) : key === 'district' ? dash(row[key]) : badge(Number(row[key]) + '%', Number(row[key]) >= 80 ? 'green' : 'orange')));
}

function renderGap(host, result) {
    if (result.error) return void replace(host, errorBox(result.error, 'تعذّر تحميل فجوة الطلب'));
    const rows = result.data || [];
    if (!rows.length) return void replace(host, empty('لا توجد بيانات فجوة حسب الحي'));
    replace(host, table([
        ['الحي', 'district'], ['طلبات مفتوحة', 'open_requests'], ['متاح', 'available_properties'], ['الفجوة', 'gap'], ['الحالة', 'state']
    ], rows, (row, key) => key === 'district' ? dash(row[key]) : key === 'state' ? badge(row[key], row[key] === 'عجز' ? 'red' : row[key] === 'فائض' ? 'green' : 'neutral') : number(row[key])));
}

function renderTable(host, result, columns, emptyText) {
    if (result.error) return void replace(host, errorBox(result.error, 'تعذّر تحميل التقرير'));
    const rows = result.data || [];
    if (!rows.length) return void replace(host, empty(emptyText));
    replace(host, table(columns.map(([key, label]) => [label, key]), rows, (row, key) => {
        if (key.includes('commission') || key.includes('share')) return money(row[key]);
        return key === 'fullname' || key === 'month' ? dash(row[key]) : number(row[key]);
    }));
}

function table(columns, rows, renderCell) {
    const head = el('thead', {}, el('tr', {}, columns.map(([label]) => el('th', { text: label }))));
    const body = el('tbody');
    rows.forEach((row) => body.appendChild(el('tr', {}, columns.map(([, key]) => el('td', { class: key === 'fullname' || key === 'name' || key === 'district' ? '' : 'num' }, renderCell(row, key))))));
    return el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, body]));
}

function exportReports(reports) {
    const sections = [
        ['القمع الشهري', reports.funnel],
        ['أداء الوسطاء', reports.brokers],
        ['أولوية العرض', reports.priority],
        ['فجوة الطلب', reports.gap]
    ];
    const lines = ['تقرير ملائم', 'الفترة: ' + reports.period + ' أشهر', 'الوسيط: ' + (reports.broker || 'الكل'), ''];
    for (const [title, rows] of sections) {
        lines.push(title);
        if (!rows.length) { lines.push('لا توجد بيانات', ''); continue; }
        const keys = Object.keys(rows[0]);
        lines.push(keys.join(','));
        rows.forEach((row) => lines.push(keys.map((key) => csvCell(row[key])).join(',')));
        lines.push('');
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mulaem-reports-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(url);
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function printReports(reports) {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1000,height=800');
    if (!popup) return;
    const sections = [
        ['القمع الشهري', reports.funnel],
        ['أداء الوسطاء', reports.brokers],
        ['أولوية العرض', reports.priority],
        ['فجوة الطلب', reports.gap]
    ];
    const html = sections.map(([title, rows]) => {
        if (!rows.length) return '<section><h2>' + escapeHtml(title) + '</h2><p>لا توجد بيانات</p></section>';
        const keys = Object.keys(rows[0]);
        return '<section><h2>' + escapeHtml(title) + '</h2><table><thead><tr>'
            + keys.map((key) => '<th>' + escapeHtml(key) + '</th>').join('')
            + '</tr></thead><tbody>'
            + rows.map((row) => '<tr>' + keys.map((key) => '<td>' + escapeHtml(row[key]) + '</td>').join('') + '</tr>').join('')
            + '</tbody></table></section>';
    }).join('');
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير ملائم</title><style>body{font-family:Arial,sans-serif;color:#17202a;padding:28px}h1{border-bottom:3px solid #c5a880;padding-bottom:10px}h2{margin-top:28px;font-size:18px}p{color:#69737f}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #d9dee5;padding:7px;text-align:right}th{background:#f2f4f7}@media print{@page{size:A4 landscape;margin:12mm}button{display:none}}</style></head><body><h1>تقرير ملائم</h1><p>الفترة: ' + escapeHtml(reports.period) + ' أشهر · الوسيط: ' + escapeHtml(reports.broker || 'الكل') + '</p>' + html + '<script>window.onload=function(){window.print()}<\/script></body></html>');
    popup.document.close();
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
