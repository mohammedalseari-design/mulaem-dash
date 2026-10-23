// ‎#/deals‎ — لوحة الصفقات: عمود لكل مرحلة غير نهائية، والمغلقة في قسم مطوي.
//
// لا يوجد ترشيح بالمستخدم هنا: سياسة deals_select تُري المدير كل الصفقات والوسيط
// صفقاته وحده. مركز الاتصال لا يصل إلى هذا المسار (الموجّه يمنعه والقاعدة ترفضه).
//
// كل عمود استعلام مستقل بـ ‎.in('stage_id', […])‎ و ‎.range()‎ بحجم صفحة 25، وزر
// "المزيد" يجلب الصفحة التالية ويضيفها: لا يُحمَّل الجدول كاملاً في أي حال.
//
// التصميم السادس «الوسيط» (2026-10-23): شريط المراحل فوق اللوحة يقرأ عدد كل عمود من استعلامه نفسه (لا استعلام
// إضافي)، والضغط على مرحلة يأخذك إلى عمودها. البطاقة التي فات موعد إغلاقها المتوقع تُعلَّم بالأحمر.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, dealStages } from './data.js';
import { DEAL_STAGE_TONE } from './labels.js';
import {
    el, clear, replace, loading, empty, errorBox, badge,
    money, fmtDate, number, pageHead, actionBtn, subTabs, localDayStart
} from './ui.js';
import { DEAL_TABS } from './commissions.js';

const CARD_FIELDS = 'id, stage_id, amount, unit_key, project_id, broker_id, expected_close_date, updated_at,'
    + ' client:clients(id, full_name), project:projects(name)';

export async function renderBoard(root) {
    replace(root, loading());

    const [stages, names] = await Promise.all([
        dealStages().catch((error) => ({ error: error })),
        staffMap().catch(() => new Map())
    ]);
    if (!root.isConnected) return;

    if (stages && stages.error) return void replace(root, errorBox(stages.error, 'تعذّر تحميل مراحل الصفقات', () => renderBoard(root)));

    const open = stages.filter((s) => !s.is_terminal);
    const closed = stages.filter((s) => s.is_terminal);

    const pipe = pipeline(open);
    const board = el('div', { class: 'deal-board' });
    for (const stage of open) {
        board.appendChild(column([stage.id], stage.name_ar, DEAL_STAGE_TONE[stage.id], names, false, (n) => pipe.setCount(stage.id, n), 'dealCol' + stage.id));
    }

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
        pageHead('الصفقات', 'من الاهتمام حتى الإغلاق. تُفتح الصفقة من ملف العميل أو من مطابقة، وتنتقل بين المراحل من صفحتها.', [
            actionBtn('العملاء', 'users', { href: '#/clients' })
        ]),
        subTabs('أقسام الصفقات', DEAL_TABS, '#/deals'),
        pipe.node,
        el('div', { class: 'crm-card' }, [board]),
        el('div', { class: 'crm-card' }, closedSection)
    ]);
}

// شريط المراحل: شريط واحد مقسوم بنسبة عدد كل مرحلة، وتحته اسم المرحلة وعددها زراً يأخذك إلى عمودها
function pipeline(stages) {
    const segments = new Map();
    const keys = new Map();
    const counts = new Map();
    const total = el('span', { class: 'pipe-total', text: '…' });
    const bar = el('div', { class: 'pipe-bar', 'aria-hidden': 'true' });
    const legend = el('ul', { class: 'pipe-legend' });

    stages.forEach((stage, i) => {
        const shade = stages.length > 1 ? 0.28 + (0.72 * i) / (stages.length - 1) : 1;
        const seg = el('span', { class: 'pipe-seg', style: '--k:' + shade.toFixed(2) + ';flex-grow:0' });
        bar.appendChild(seg);
        segments.set(stage.id, seg);
        const count = el('b', { class: 'pipe-n', text: '…' });
        const button = el('button', {
            type: 'button', class: 'pipe-key',
            onclick: () => {
                const col = document.getElementById('dealCol' + stage.id);
                if (!col) return;
                col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                col.classList.remove('flash');
                void col.offsetWidth;
                col.classList.add('flash');
            }
        }, [el('i', { class: 'pipe-dot', style: '--k:' + shade.toFixed(2) }), el('span', { text: stage.name_ar }), count]);
        keys.set(stage.id, { button, count, name: stage.name_ar });
        legend.appendChild(el('li', {}, button));
    });

    function setCount(stageId, n) {
        counts.set(stageId, n);
        const key = keys.get(stageId);
        if (key) {
            key.count.textContent = number(n);
            key.button.setAttribute('aria-label', key.name + ': ' + number(n) + ' — اذهب إلى العمود');
        }
        const seg = segments.get(stageId);
        if (seg) seg.style.flexGrow = String(n);
        if (counts.size === stages.length) {
            const sum = [...counts.values()].reduce((a, b) => a + b, 0);
            total.textContent = number(sum) + (sum === 1 ? ' صفقة مفتوحة' : ' صفقات مفتوحة');
            bar.classList.toggle('is-empty', sum === 0);
        }
    }

    const node = el('section', { class: 'pipe', 'aria-label': 'مراحل الصفقات المفتوحة' }, [
        el('div', { class: 'pipe-head' }, [el('h2', { text: 'الصفقات المفتوحة حسب المرحلة' }), total]),
        bar,
        legend
    ]);
    return { node, setCount };
}

// عمود واحد: ترويسة بالعدد، ثم بطاقات تتراكم صفحة بعد صفحة. onCount يُبلَّغ بالعدد الكلي بعد أول تحميل.
function column(stageIds, title, tone, names, wide = false, onCount = null, id = null) {
    const view = { page: 0, loaded: 0, total: null };
    const counter = el('span', { class: 'deal-col-count crm-subtle', text: '…' });
    const head = el('div', { class: 'deal-col-head' }, [badge(title, tone || 'neutral'), counter]);
    const cards = el('div', { class: 'deal-col-body' + (wide ? ' deal-col-wide' : '') });
    const footer = el('div');
    const host = el('div', { class: 'deal-col' + (wide ? ' deal-col-full' : ''), id: id }, [head, cards, footer]);

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
        if (error) return void footer.appendChild(errorBox(error, 'تعذّر تحميل الصفقات', load));

        const rows = data || [];
        view.total = count === null || count === undefined ? view.loaded + rows.length : count;
        view.loaded += rows.length;

        for (const row of rows) cards.appendChild(card(row, names));
        if (view.loaded === 0) cards.appendChild(empty('لا صفقات في هذه المرحلة'));

        counter.textContent = number(view.total);
        if (onCount && view.page === 0) onCount(view.total);
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
    // تاريخ الإغلاق المتوقع قبل اليوم: الصفقة تأخرت عن موعدها (التاريخ وحده بلا وقت، فيُقارن ببداية اليوم)
    const late = row.expected_close_date && row.expected_close_date < localDayStart(0).slice(0, 10);

    return el('a', { class: 'deal-card' + (late ? ' deal-late' : ''), href: '#/deals/' + row.id }, [
        el('strong', { text: row.client ? row.client.full_name : 'عميل' }),
        el('div', { class: 'crm-subtle', text: projectName + (row.unit_key ? ' · ' + row.unit_key : '') }),
        el('div', { class: 'deal-card-foot' }, [
            el('span', { class: 'num', text: money(row.amount) }),
            el('span', { class: 'crm-subtle', text: staffName(names, row.broker_id) })
        ]),
        row.expected_close_date
            ? el('div', { class: late ? 'deal-due deal-due-late' : 'crm-subtle', text: (late ? 'تجاوز موعد الإغلاق: ' : 'الإغلاق المتوقع: ') + fmtDate(row.expected_close_date) })
            : null
    ]);
}
