// ‎#/deals‎ — لوحة الصفقات: عمود لكل مرحلة غير نهائية، والمغلقة في قسم مطوي.
//
// لا يوجد ترشيح بالمستخدم هنا: سياسة deals_select تُري المدير كل الصفقات والوسيط
// صفقاته وحده. مركز الاتصال لا يصل إلى هذا المسار (الموجّه يمنعه والقاعدة ترفضه).
//
// كل عمود استعلام مستقل بـ ‎.in('stage_id', […])‎ و ‎.range()‎ بحجم صفحة 25، وزر
// "المزيد" يجلب الصفحة التالية ويضيفها: لا يُحمَّل الجدول كاملاً في أي حال.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, dealStages } from './data.js';
import { DEAL_STAGE_TONE } from './labels.js';
import {
    el, clear, replace, loading, empty, errorBox, badge,
    money, fmtDate, number
} from './ui.js';

const CARD_FIELDS = 'id, stage_id, amount, unit_key, project_id, broker_id, expected_close_date, updated_at,'
    + ' client:clients(id, full_name), project:projects(name)';

export async function renderBoard(root) {
    replace(root, loading());

    const [stages, names] = await Promise.all([
        dealStages().catch((error) => ({ error: error })),
        staffMap().catch(() => new Map())
    ]);
    if (!root.isConnected) return;

    if (stages && stages.error) return void replace(root, errorBox(stages.error, 'تعذّر تحميل مراحل الصفقات'));

    const open = stages.filter((s) => !s.is_terminal);
    const closed = stages.filter((s) => s.is_terminal);

    const board = el('div', { class: 'deal-board' });
    for (const stage of open) board.appendChild(column([stage.id], stage.name_ar, DEAL_STAGE_TONE[stage.id], names));

    // القسم المغلق مطوي، ولا يُستعلم عنه إلا عند فتحه أول مرة
    const closedBody = el('div');
    const closedSection = el('details', { class: 'deal-closed' }, [
        el('summary', { text: 'المغلقة (' + closed.map((s) => s.name_ar).join(' / ') + ')' }),
        closedBody
    ]);
    let closedLoaded = false;
    closedSection.addEventListener('toggle', () => {
        if (!closedSection.open || closedLoaded) return;
        closedLoaded = true;
        const list = column(closed.map((s) => s.id), 'المغلقة', 'neutral', names, true);
        replace(closedBody, list);
    });

    replace(root, [
        el('div', { class: 'page-intro' }, [
            el('div', {}, [
                el('h1', { text: 'الصفقات' }),
                el('p', { text: 'تابع حركة الصفقات من الاهتمام حتى الإغلاق.' })
            ]),
            el('span', { class: 'page-intro-meta', text: 'مسار الصفقات' })
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'لوحة الصفقات' }),
                el('a', { class: 'btn btn-outline btn-sm', href: '#/clients', text: 'العملاء' })
            ]),
            el('div', {
                class: 'crm-subtle', style: 'margin-bottom:14px',
                text: 'تُفتح الصفقات من ملف العميل أو من صف مطابقة. كل عمود يعرض 25 صفقة ثم "المزيد".'
            }),
            board
        ]),
        el('div', { class: 'crm-card' }, closedSection)
    ]);
}

// عمود واحد: ترويسة بالعدد، ثم بطاقات تتراكم صفحة بعد صفحة
function column(stageIds, title, tone, names, wide = false) {
    const view = { page: 0, loaded: 0, total: null };
    const counter = el('span', { class: 'deal-col-count crm-subtle', text: '…' });
    const head = el('div', { class: 'deal-col-head' }, [badge(title, tone || 'neutral'), counter]);
    const cards = el('div', { class: 'deal-col-body' + (wide ? ' deal-col-wide' : '') });
    const footer = el('div');
    const host = el('div', { class: 'deal-col' + (wide ? ' deal-col-full' : '') }, [head, cards, footer]);

    async function load() {
        clear(footer);
        footer.appendChild(loading('جارٍ التحميل'));

        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('deals')
            .select(CARD_FIELDS, { count: 'exact' })
            .in('stage_id', stageIds)
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to);

        if (!host.isConnected) return;
        clear(footer);
        if (error) return void footer.appendChild(errorBox(error, 'تعذّر تحميل الصفقات'));

        const rows = data || [];
        view.total = count === null || count === undefined ? view.loaded + rows.length : count;
        view.loaded += rows.length;

        for (const row of rows) cards.appendChild(card(row, names));
        if (view.loaded === 0) cards.appendChild(empty('لا صفقات في هذه المرحلة'));

        counter.textContent = number(view.total);
        if (view.loaded < view.total) {
            footer.appendChild(el('button', {
                type: 'button', class: 'btn btn-outline btn-xs', text: 'المزيد',
                onclick: () => { view.page += 1; load(); }
            }));
        }
    }

    load();
    return host;
}

function card(row, names) {
    const projectName = row.project && row.project.name
        ? row.project.name
        : (row.project_id ? 'عقار رقم ' + row.project_id : 'بدون عقار');

    return el('a', { class: 'deal-card', href: '#/deals/' + row.id }, [
        el('strong', { text: row.client ? row.client.full_name : 'عميل' }),
        el('div', { class: 'crm-subtle', text: projectName + (row.unit_key ? ' · ' + row.unit_key : '') }),
        el('div', { class: 'deal-card-foot' }, [
            el('span', { class: 'num', text: money(row.amount) }),
            el('span', { class: 'crm-subtle', text: staffName(names, row.broker_id) })
        ]),
        row.expected_close_date
            ? el('div', { class: 'crm-subtle', text: 'الإغلاق المتوقع: ' + fmtDate(row.expected_close_date) })
            : null
    ]);
}

