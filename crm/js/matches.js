// ‎#/matches‎ — المطابقات لكل الطلبات (التصميم السادس «الوسيط»، 2026-10-23).
//
// كل عقار حُفظ لطلب عميل وحالته: شورك مع العميل، مهتم، معاينة، غير مهتم. قبلها كانت تُرى من صفحة كل طلب
// وحدها؛ هنا يرى الوسيط من ينتظر ردّه ومن صار في مرحلة المعاينة. قراءة فقط: تغيير الحالة والملاحظة في صفحة
// الطلب نفسها (matching.js) كما كانا، والصف يفتحها.
//
// لا ترشيح بالمستخدم هنا: سياسة matches_select (crm_can_see_requirement) تُري كل دور مطابقات عملائه وحدها.

import { supabase, PAGE_SIZE, pageRange, pageBack } from './supabase.js';
import { MATCH_STATE, MATCH_STATE_TONE, REQUEST_PURPOSE, label, scoreLabel } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, pageHead, subTabs, filterChips, resultLine, countText, fmtDate, dash
} from './ui.js';
import { CLIENT_TABS } from './clients.js';

const STATE_CHIPS = [
    { value: '', label: 'الكل' },
    { value: 'shared', label: MATCH_STATE.shared },
    { value: 'interested', label: MATCH_STATE.interested },
    { value: 'viewing', label: MATCH_STATE.viewing },
    { value: 'not_interested', label: MATCH_STATE.not_interested }
];

const remembered = { page: 0, state: '' };

export async function renderMatches(root) {
    const view = remembered;
    const body = el('div');
    // ردّ تحميل أقدم يصل بعد أحدث يُهمَل
    let seq = 0;
    const stateChips = filterChips('حالة المطابقة', STATE_CHIPS, view.state, (value) => { view.state = value; view.page = 0; load(); });

    function reset() {
        view.state = '';
        view.page = 0;
        stateChips.set('');
        load();
    }

    replace(root, [
        pageHead('المطابقات', 'العقارات التي حفظتها لطلبات العملاء وأين وصلت: شورك، مهتم، معاينة. افتح السطر لتغيّر الحالة أو تشارك العرض.'),
        subTabs('أقسام العملاء', CLIENT_TABS, '#/matches'),
        el('div', { class: 'crm-card' }, [stateChips.node, body])
    ]);

    // عدد كل حالة بجانب اسمها (head، مرة عند فتح الصفحة)
    (async () => {
        const counts = await Promise.all(STATE_CHIPS.map((chip) => {
            let query = supabase.from('property_matches').select('id', { count: 'exact', head: true });
            if (chip.value) query = query.eq('state', chip.value);
            return Promise.resolve(query).catch(() => ({ count: null }));
        }));
        if (!root.isConnected) return;
        STATE_CHIPS.forEach((chip, i) => stateChips.setCount(chip.value, counts[i].error ? null : counts[i].count));
    })();

    async function load() {
        const mine = ++seq;
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        let query = supabase
            .from('property_matches')
            .select('id, requirement_id, project_id, unit_key, score, state, note, updated_at,'
                + ' project:projects(name, district),'
                + ' requirement:client_requirements(client_id, purpose, property_type, client:clients(full_name))', { count: 'exact' })
            .order('updated_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to);
        if (view.state) query = query.eq('state', view.state);

        const result = await Promise.resolve(query).catch((error) => ({ error }));
        if (mine !== seq || !body.isConnected) return;
        const back = pageBack(view.page, result);
        if (back !== null) { view.page = back; return load(); }
        const { data, error, count } = result;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل المطابقات', load));

        if (!data || data.length === 0) {
            replace(body, view.state
                ? empty('لا مطابقات بهذه الحالة', 'اختر حالة أخرى أو اعرض الكل.',
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'اعرض الكل', onclick: reset }))
                : empty('لا مطابقات محفوظة بعد', 'افتح طلب عميل من «طلبات الشراء والإيجار»، واحفظ العقار المناسب أو شاركه معه.',
                    el('a', { class: 'btn btn-outline btn-sm', href: '#/requests', text: 'افتح الطلبات' })));
            return;
        }

        const total = count === null || count === undefined ? data.length : count;
        replace(body, [
            resultLine(countText(total, ['مطابقة واحدة', 'مطابقتان', 'مطابقات', 'مطابقة']), view.state ? reset : null),
            el('div', { class: 'crm-table-wrap' }, table(data)),
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function table(rows) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'العميل' }),
        el('th', { text: 'العقار' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'المطابقة' }),
        el('th', { text: 'ملاحظة' }),
        el('th', { text: 'آخر تحديث' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const req = row.requirement || {};
        const client = req.client || {};
        const href = req.client_id ? '#/clients/' + req.client_id + '/requirements/' + row.requirement_id : null;
        const score = row.score === null || row.score === undefined ? null : scoreLabel(row.score);
        const project = row.project && row.project.name ? row.project.name : (row.project_id ? 'عقار رقم ' + row.project_id : 'عقار');
        body.appendChild(el('tr', { class: href ? 'clickable' : null, onclick: href ? () => { location.hash = href; } : null }, [
            el('td', { class: 'm-client' }, el('div', { class: 'cl-name' }, [
                href ? el('a', { href: href, text: client.full_name || 'عميل', onclick: (event) => event.stopPropagation() })
                    : el('strong', { text: client.full_name || 'عميل' }),
                el('span', { class: 'cl-type', text: [label(REQUEST_PURPOSE, req.purpose, ''), req.property_type].filter(Boolean).join(' · ') || null })
            ])),
            el('td', { class: 'm-property' }, el('div', { class: 'pr-name' }, [
                el('strong', { text: project }),
                el('span', { class: 'crm-subtle', text: [row.unit_key, row.project && row.project.district].filter(Boolean).join(' · ') || null })
            ])),
            el('td', { class: 'm-state' }, badge(label(MATCH_STATE, row.state), MATCH_STATE_TONE[row.state] || 'neutral')),
            el('td', { class: 'm-score' }, score ? el('span', { class: 'score-tag score-' + score.tone, text: score.text }) : el('span', { class: 'crm-subtle', text: '—' })),
            el('td', { class: 'm-note crm-subtle', text: dash(row.note) }),
            el('td', { class: 'm-date crm-subtle', text: fmtDate(row.updated_at) })
        ]));
    }

    // t-card t-matches: على الجوال بطاقة (crm/v6.css): العميل والحالة، ثم العقار، ثم الملاحظة والتاريخ
    return el('table', { class: 'users-table crm-table t-card t-matches' }, [head, body]);
}
