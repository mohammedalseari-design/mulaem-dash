// ‎#/commissions‎ — العمولات لكل الصفقات (التصميم السادس «الوسيط»، 2026-10-23). كانت هنا صفحة قديمة للمدير لا يصلها
// أي مسار؛ صارت قسماً في باب «الصفقات» للمدير والوسيط معاً.
//
// قائمة واحدة لما لم يُحصَّل بعد وما حُصّل، وثلاثة أرقام فوقها: المتبقي على العمولات غير المحصّلة، والمحصّل هذا الشهر
// (من سجل الدفعات)، وما يحتاج مراجعة. قراءة فقط: الدفعة والفاتورة والإعفاء في صفحة الصفقة كما كانت (commission.js،
// للمدير وحده)، والسطر يفتحها.
//
// لا ترشيح بالمستخدم هنا: سياسة commissions_select (crm_can_see_deal) تُري المدير كل العمولات والوسيط عمولات
// صفقاته وحدها. مركز الاتصال لا يصل إلى هذا المسار (الموجّه يمنعه والقاعدة لا تُريه شيئاً).

import { supabase, PAGE_SIZE, pageRange, fetchAll } from './supabase.js';
import { isAdmin } from './auth.js';
import { staffMap, staffName } from './data.js';
import { COMMISSION_STATUS, COMMISSION_STATUS_TONE, label } from './labels.js';
import { REVIEW_BADGE } from './commission.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, money, pageHead, subTabs, filterChips, resultLine, countText, dash
} from './ui.js';

// أقسام باب «الصفقات»: تبويبات تحت رأس الصفحتين (board.js يستعملها أيضاً)
export const DEAL_TABS = [
    { hash: '#/deals', label: 'مسار الصفقات', icon: 'briefcase' },
    { hash: '#/commissions', label: 'العمولات', icon: 'wallet' }
];

const OPEN_STATUSES = ['due', 'invoiced', 'partial'];

const STATUS_CHIPS = [
    { value: 'open', label: 'لم تُحصّل', statuses: OPEN_STATUSES },
    { value: 'collected', label: COMMISSION_STATUS.collected, statuses: ['collected'] },
    { value: 'waived', label: COMMISSION_STATUS.waived, statuses: ['waived'] },
    { value: 'review', label: REVIEW_BADGE, review: true },
    { value: 'all', label: 'الكل', statuses: null }
];

const remembered = { page: 0, status: 'open' };

export async function renderCommissions(root) {
    const view = remembered;
    const body = el('div');
    const summary = el('div', { class: 'kpi-strip kpi-strip-3', role: 'group', 'aria-label': 'ملخص العمولات' }, loading());
    const chips = filterChips('حالة العمولة', STATUS_CHIPS, view.status, (value) => { view.status = value; view.page = 0; load(); });

    replace(root, [
        pageHead('العمولات', 'عمولات الصفقات التي تمت: الإجمالي والمحصّل والمتبقي. الدفعات والفواتير تُسجَّل من صفحة الصفقة.'),
        subTabs('أقسام الصفقات', DEAL_TABS, '#/commissions'),
        summary,
        el('div', { class: 'crm-card' }, [chips.node, body])
    ]);

    const names = await staffMap().catch(() => new Map());
    if (!root.isConnected) return;

    loadSummary(summary);

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        let query = supabase
            .from('commissions')
            .select('id, deal_id, gross_amount, collected_amount, status, invoice_no, needs_review, created_at,'
                + ' deal:deals(id, broker_id, unit_key, client:clients(full_name), project:projects(name))', { count: 'exact' })
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to);
        const chip = STATUS_CHIPS.find((c) => c.value === view.status) || STATUS_CHIPS[0];
        if (chip.statuses) query = query.in('status', chip.statuses);
        if (chip.review) query = query.eq('needs_review', true);

        const { data, error, count } = await query;
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العمولات', load));

        if (!data || data.length === 0) {
            replace(body, view.status === 'open'
                ? empty('لا عمولات تنتظر التحصيل', 'تُسجَّل العمولة تلقائياً حين تصل صفقة بقيمة معلومة إلى «تمت».',
                    el('a', { class: 'btn btn-outline btn-sm', href: '#/deals', text: 'افتح مسار الصفقات' }))
                : empty('لا عمولات بهذه الحالة', 'اختر حالة أخرى من الأزرار أعلاه.'));
            return;
        }

        const total = count === null || count === undefined ? data.length : count;
        replace(body, [
            resultLine(countText(total, ['عمولة واحدة', 'عمولتان', 'عمولات', 'عمولة']), null),
            el('div', { class: 'crm-table-wrap' }, table(data, names)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

// ثلاثة أرقام: المتبقي على غير المحصّلة، والمحصّل هذا الشهر من سجل الدفعات، وما يحتاج مراجعة.
// الصفوف قليلة بطبيعتها (عمولة لكل صفقة تمت)، وfetchAll يقرأها على دفعات إن تجاوزت حد الخادم.
async function loadSummary(host) {
    const now = new Date();
    const firstDay = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    const [open, paid, review] = await Promise.all([
        fetchAll(() => supabase.from('commissions').select('id, gross_amount, collected_amount').in('status', OPEN_STATUSES).order('id', { ascending: true })),
        fetchAll(() => supabase.from('commission_payments').select('id, amount').gte('paid_on', firstDay).order('id', { ascending: true })),
        Promise.resolve(supabase.from('commissions').select('id', { count: 'exact', head: true }).eq('needs_review', true)).catch((error) => ({ error }))
    ]);
    if (!host.isConnected) return;
    if (open.error) {
        return void replace(host, errorBox(open.error, 'تعذّر حساب ملخص العمولات', () => { replace(host, loading()); loadSummary(host); }));
    }

    const rows = open.data || [];
    const remaining = rows.reduce((sum, row) => sum + Math.max(0, Number(row.gross_amount || 0) - Number(row.collected_amount || 0)), 0);
    const collected = paid.error ? null : (paid.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const reviewCount = review.error ? null : review.count || 0;

    replace(host, [
        cell('لم يُحصَّل بعد', money(remaining) + ' ر.س',
            rows.length ? 'على ' + countText(rows.length, ['عمولة واحدة', 'عمولتين', 'عمولات', 'عمولة']) : 'لا شيء معلّق', remaining > 0 ? 'due' : null),
        cell('محصّل هذا الشهر', collected === null ? '—' : money(collected) + ' ر.س', paid.error ? 'تعذّر قراءة الدفعات' : 'من سجل الدفعات'),
        cell(REVIEW_BADGE, reviewCount === null ? '—' : String(reviewCount),
            isAdmin() ? 'تُراجع من صفحة الصفقة' : 'يراجعها المدير', reviewCount ? 'late' : null)
    ]);
}

function cell(title, value, sub, tone) {
    return el('div', { class: 'kpi' + (tone ? ' kpi-' + tone : '') }, [
        el('span', { class: 'kpi-label', text: title }),
        el('span', { class: 'kpi-num', text: value }),
        sub ? el('span', { class: 'kpi-sub', text: sub }) : null
    ]);
}

function table(rows, names) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الصفقة' }),
        el('th', { text: 'إجمالي العمولة' }),
        el('th', { text: 'المحصّل' }),
        el('th', { text: 'المتبقي' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'الفاتورة' }),
        el('th', { text: 'الوسيط' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const deal = row.deal || {};
        const remaining = Math.max(0, Number(row.gross_amount || 0) - Number(row.collected_amount || 0));
        const href = '#/deals/' + row.deal_id;
        const project = deal.project && deal.project.name ? deal.project.name : null;
        body.appendChild(el('tr', { class: 'clickable', onclick: () => { location.hash = href; } }, [
            el('td', { class: 'k-deal' }, el('div', { class: 'cl-name' }, [
                el('a', { href: href, text: (deal.client && deal.client.full_name) || 'صفقة', onclick: (event) => event.stopPropagation() }),
                el('span', { class: 'cl-type', text: [project, deal.unit_key].filter(Boolean).join(' · ') || null })
            ])),
            el('td', { class: 'k-gross num', text: money(row.gross_amount) }),
            el('td', { class: 'k-collected num', text: money(row.collected_amount) }),
            el('td', { class: 'k-remaining num' + (remaining > 0 && OPEN_STATUSES.includes(row.status) ? ' is-due' : ''), text: money(remaining) }),
            el('td', { class: 'k-status' }, el('div', { class: 'pr-status' }, [
                badge(label(COMMISSION_STATUS, row.status), COMMISSION_STATUS_TONE[row.status] || 'neutral'),
                row.needs_review ? badge(REVIEW_BADGE, 'red') : null
            ])),
            el('td', { class: 'k-invoice crm-subtle', text: dash(row.invoice_no) }),
            el('td', { class: 'k-broker', text: staffName(names, deal.broker_id) })
        ]));
    }

    // t-card t-commissions: على الجوال بطاقة (crm/v6.css): الصفقة والحالة، ثم المتبقي، ثم الإجمالي والمحصّل
    return el('table', { class: 'users-table crm-table t-card t-commissions' }, [head, body]);
}
