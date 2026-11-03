// اختبار crm/js/deals-list-model.js: تبويبات المراحل وأعدادها، وترتيب الخادم والصفحة، وشرط البحث، وما يُحدَّد وإلى أين
// يُنقل، ونتائج التعديل الجماعي ونصوصها، وخانات الصف (العقار، الأيام في المرحلة، العمولة). المراحل كما في
// 007_deals_commissions.sql، وتصل من القاعدة بأي ترتيب.
// التشغيل: node tests/deals-list-model.test.mjs
import {
    TAB_ALL, listTabs, findTab, tabCounts, DEFAULT_SORT, SORTS, sortOrder, orderPage, searchOr,
    canSelect, tabSelectable, MOVE_BLOCKED, moveTarget, lostTarget, tallyResults,
    dealsCount, selectionText, bulkMessage, lostIntro, emptyText, placeText, stageFacts, rateFor, commissionFacts
} from '../crm/js/deals-list-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// عمداً بغير ترتيب
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

/* ---------- التبويبات ---------- */
const tabs = listTabs(STAGES);
t('tabs: الكل, the five open stages in order, تمت, خسرت',
    same(tabs.map((x) => x.label), ['الكل', 'اهتمام جدي', 'معاينة', 'تفاوض', 'عربون', 'عقد وإفراغ', 'تمت', 'خسرت']), tabs.map((x) => x.label));
t('tab الكل = all open stage ids', tabs[0].key === TAB_ALL && same(tabs[0].stageIds, [1, 2, 3, 4, 5]) && tabs[0].kind === 'open');
t('one stage per stage tab', same(tabs[3].stageIds, [3]) && tabs[3].key === 'stage-3' && tabs[3].stage.id === 3);
t('closed tabs keyed won / lost', tabs[6].key === 'won' && tabs[6].kind === 'won' && same(tabs[6].stageIds, [6])
    && tabs[7].key === 'lost' && tabs[7].kind === 'lost' && same(tabs[7].stageIds, [7]));
t('no stages → only الكل (empty)', listTabs([]).length === 1 && listTabs(null)[0].stageIds.length === 0);
t('findTab by key', findTab(tabs, 'stage-2').label === 'معاينة');
t('findTab unknown → الكل', findTab(tabs, 'stage-99').key === TAB_ALL && findTab(tabs, undefined).key === TAB_ALL);
t('findTab on nothing → null', findTab([], 'all') === null && findTab(null, 'all') === null);

const counts = new Map([['stage-1', 4], ['stage-2', 3], ['stage-3', 2], ['stage-4', 0], ['stage-5', 1], ['won', 9], ['lost', 5]]);
const withAll = tabCounts(tabs, counts);
t('الكل = sum of the open stages only', withAll.get(TAB_ALL) === 10 && withAll.get('won') === 9 && withAll.get('lost') === 5);
const missing = new Map(counts); missing.set('stage-3', null);
t('الكل unknown when an open count failed', tabCounts(tabs, missing).get(TAB_ALL) === null && tabCounts(tabs, missing).get('stage-1') === 4);
t('a failed closed count does not hide الكل', tabCounts(tabs, new Map([...counts, ['won', null]])).get(TAB_ALL) === 10);
t('tabCounts does not change its input', !counts.has(TAB_ALL));

/* ---------- الترتيب ---------- */
const openTab = tabs[0];
const wonTab = tabs[6];
t('default sort is oldest in stage', DEFAULT_SORT === 'stage' && SORTS.stage === 'الأقدم في المرحلة أولاً'
    && SORTS.newest === 'الأحدث أولاً' && SORTS.amount === 'الأعلى قيمة');
t('stage sort, open tab: least recently updated first, id tiebreak',
    same(sortOrder('stage', openTab), [{ column: 'updated_at', ascending: true }, { column: 'id', ascending: true }]));
t('stage sort, closed tab: closed_at ascending, nulls last',
    same(sortOrder('stage', wonTab), [{ column: 'closed_at', ascending: true, nullsFirst: false }, { column: 'id', ascending: true }]));
t('newest, open tab: newest opened first', same(sortOrder('newest', openTab)[0], { column: 'created_at', ascending: false }));
t('newest, closed tab: newest closed first', same(sortOrder('newest', tabs[7])[0], { column: 'closed_at', ascending: false, nullsFirst: false }));
t('amount: highest first, empty values last', same(sortOrder('amount', openTab)[0], { column: 'amount', ascending: false, nullsFirst: false }));
t('unknown sort falls back to the default', same(sortOrder('nope', openTab), sortOrder('stage', openTab)));

const page = [
    { id: 'a', stage_id: 3, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-02T08:00:00Z' },
    { id: 'b', stage_id: 3, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-10-03T08:00:00Z' },
    { id: 'c', stage_id: 2, created_at: '2026-10-05T08:00:00Z', updated_at: '2026-10-05T08:00:00Z' }
];
const hist = [
    { deal_id: 'a', to_stage: 3, changed_at: '2026-10-02T08:00:00Z' },
    // b دخل «تفاوض» قديماً ثم عُدّلت قيمته أمس: آخر تعديل جاء به بعد a، ودخوله المرحلة قبله
    { deal_id: 'b', to_stage: 3, changed_at: '2026-09-20T08:00:00Z' },
    { deal_id: 'c', to_stage: 2, changed_at: '2026-10-05T08:00:00Z' }
];
t('page re-sorted by the real time in stage', same(orderPage(page, hist, 'stage').map((r) => r.id), ['b', 'a', 'c']));
t('other sorts keep the server order', same(orderPage(page, hist, 'amount').map((r) => r.id), ['a', 'b', 'c']));
t('no history → server order kept', same(orderPage(page, null, 'stage').map((r) => r.id), ['a', 'b', 'c']));
t('orderPage returns a copy', orderPage(page, hist, 'stage') !== page && page[0].id === 'a');
const tie = [{ id: 'x', stage_id: 1, created_at: '2026-10-01T00:00:00Z' }, { id: 'y', stage_id: 1, created_at: '2026-10-01T00:00:00Z' }];
t('equal times keep their order (stable)', same(orderPage(tie, [], 'stage').map((r) => r.id), ['x', 'y']));
const unknown = [{ id: 'u', stage_id: 1 }, { id: 'k', stage_id: 1, created_at: '2026-10-01T00:00:00Z' }];
t('unknown entry time goes last', same(orderPage(unknown, [], 'stage').map((r) => r.id), ['k', 'u']));

/* ---------- البحث ---------- */
const U1 = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const U2 = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b';
t('search: clients or projects', searchOr([U1, U2], [12, 7]) === 'client_id.in.(' + U1 + ',' + U2 + '),project_id.in.(12,7)');
t('search: clients only', searchOr([U1], []) === 'client_id.in.(' + U1 + ')');
t('search: projects only', searchOr(null, ['33']) === 'project_id.in.(33)');
t('search: nothing matched → null', searchOr([], []) === null && searchOr(null, undefined) === null);
t('search: duplicates removed', searchOr([U1, U1], [5, '5']) === 'client_id.in.(' + U1 + '),project_id.in.(5)');
t('search: malformed ids dropped', searchOr(['x),stage_id.eq.(6', null, ''], ['1,2', -3, 4.5, 8]) === 'project_id.in.(8)');

/* ---------- التحديد ---------- */
t('open deals selectable by anyone', canSelect(stage(2), false) === true && canSelect(stage(5), true) === true);
t('won deals selectable by the admin only (034)', canSelect(stage(6), true) === true && canSelect(stage(6), false) === false);
t('lost deals never selectable', canSelect(stage(7), true) === false && canSelect(stage(7), false) === false);
t('unknown stage not selectable', canSelect(null, true) === false);
t('tab checkbox column', tabSelectable(tabs[0], false) && tabSelectable(tabs[2], false)
    && tabSelectable(tabs[6], true) && !tabSelectable(tabs[6], false) && !tabSelectable(tabs[7], true) && !tabSelectable(null, true));

const d = (id, stageId, extra) => Object.assign({ id, stage_id: stageId }, extra || {});
t('move: nothing selected', moveTarget([], STAGES).ok === false && moveTarget([], STAGES).reason === 'empty');
const move = moveTarget([d('a', 2), d('b', 2)], STAGES);
t('move: same open stage → next stage', move.ok === true && move.stage.id === 3 && move.reason === null);
t('move: mixed stages blocked', moveTarget([d('a', 2), d('b', 3)], STAGES).reason === 'mixed' && !moveTarget([d('a', 2), d('b', 3)], STAGES).ok);
t('move: string and number stage ids are the same stage', moveTarget([d('a', '2'), d('b', 2)], STAGES).ok === true);
const toWon = moveTarget([d('a', 5)], STAGES);
t('move: next is تمت → blocked, names تمت', toWon.ok === false && toWon.reason === 'won' && toWon.stage.id === 6);
t('move: closed deals blocked', moveTarget([d('a', 6)], STAGES).reason === 'closed' && moveTarget([d('a', 7)], STAGES).reason === 'closed');
t('move: unknown stage blocked', moveTarget([d('a', 42)], STAGES).reason === 'closed');
t('every blocked reason has a sentence', Boolean(MOVE_BLOCKED.mixed && MOVE_BLOCKED.closed && MOVE_BLOCKED.won));

const lost = lostTarget([d('a', 1), d('b', 4)], STAGES);
t('lost: open deals ok, no won warning', lost.ok === true && lost.stage.id === 7 && lost.hasWon === false);
t('lost: won deals (admin) ok with the commission warning', lostTarget([d('a', 6)], STAGES).ok && lostTarget([d('a', 6)], STAGES).hasWon);
t('lost: already lost or unknown → no', !lostTarget([d('a', 2), d('b', 7)], STAGES).ok && !lostTarget([d('a', 42)], STAGES).ok);
t('lost: nothing selected or no lost stage', !lostTarget([], STAGES).ok && !lostTarget([d('a', 1)], STAGES.filter((s) => s.id !== 7)).ok);

/* ---------- نتائج التعديل الجماعي ---------- */
const err = { code: '42501', message: 'denied' };
t('tally: row back = ok, zero rows or error = failed, first error kept',
    same(tallyResults([{ data: [{ id: 'a' }] }, { data: [] }, { error: err }, { data: null }, { data: [{ id: 'b' }] }, { error: { code: 'x' } }]),
        { ok: 2, failed: 4, error: err }));
t('tally: nothing', same(tallyResults([]), { ok: 0, failed: 0, error: null }) && same(tallyResults(null), { ok: 0, failed: 0, error: null }));

t('count text', dealsCount(1) === 'صفقة واحدة' && dealsCount(2) === 'صفقتان' && dealsCount(3) === '3 صفقات' && dealsCount(11) === '11 صفقة');
t('selection text (genitive dual)', selectionText(1) === 'تم تحديد صفقة واحدة' && selectionText(2) === 'تم تحديد صفقتين'
    && selectionText(5) === 'تم تحديد 5 صفقات' && selectionText(25) === 'تم تحديد 25 صفقة');
t('move all ok', same(bulkMessage('move', 3, 0, 'تفاوض'), { kind: 'success', text: 'نُقلت 3 صفقات إلى «تفاوض»' }));
t('move one ok', bulkMessage('move', 1, 0, 'معاينة').text === 'نُقلت صفقة واحدة إلى «معاينة»');
t('move partly failed names both counts', same(bulkMessage('move', 3, 2, 'تفاوض'),
    { kind: 'error', text: 'نُقلت 3 صفقات إلى «تفاوض»، وتعذّر نقل صفقتين: ربما تغيّرت مرحلتها أو لا تملك صلاحية تعديلها' }));
t('move all failed with the server reason', same(bulkMessage('move', 0, 1, 'تفاوض', 'لا تملك صلاحية'),
    { kind: 'error', text: 'تعذّر نقل الصفقة: لا تملك صلاحية' }));
t('lost all ok', same(bulkMessage('lost', 2, 0), { kind: 'success', text: 'سُجّلت صفقتان «خسرت»' }));
t('lost partly failed', bulkMessage('lost', 4, 1).text === 'سُجّلت 4 صفقات «خسرت»، وتعذّر تسجيل صفقة واحدة: ربما تغيّرت مرحلتها أو لا تملك صلاحية تعديلها');
t('lost all failed', bulkMessage('lost', 0, 3, null, 'قيمة مرفوضة').text === 'تعذّر تسجيل الصفقات «خسرت»: قيمة مرفوضة');
t('lost form intro', lostIntro(1) === 'ستُسجَّل صفقة واحدة «خسرت».' && lostIntro(2) === 'ستُسجَّل صفقتان «خسرت» بالسبب نفسه.'
    && lostIntro(4) === 'ستُسجَّل 4 صفقات «خسرت» بالسبب نفسه.');

t('empty: filtered → reset', emptyText(tabs[3], true).action === 'reset' && emptyText(tabs[3], true).title === 'لا نتائج مطابقة');
t('empty: الكل → open clients', emptyText(tabs[0], false).action === 'clients' && emptyText(null, false).title === 'لا صفقات جارية');
t('empty: a stage names it', emptyText(tabs[2], false).title === 'لا صفقات في «معاينة»');
t('empty: closed tabs', emptyText(tabs[6], false).title === 'لا صفقات «تمت» بعد' && emptyText(tabs[7], false).title === 'لا صفقات «خسرت»'
    && emptyText(tabs[7], false).hint === null);

/* ---------- خانات الصف ---------- */
t('place: project and unit', placeText({ project: { name: 'النخيل' }, project_id: 4, unit_key: ' فيلا 3 ' }) === 'النخيل · فيلا 3');
t('place: hidden project shows its number', placeText({ project: null, project_id: 9 }) === 'عقار رقم 9');
t('place: no project', placeText({ project_id: null, unit_key: '' }) === 'بدون عقار' && placeText(null) === 'بدون عقار');

const NOW = Date.parse('2026-11-03T10:00:00Z');
const deal = { id: 'd1', stage_id: 3, created_at: '2026-10-01T08:00:00Z' };
const dealHistory = [
    { deal_id: 'd1', to_stage: 2, changed_at: '2026-10-05T08:00:00Z' },
    { deal_id: 'd1', to_stage: 3, changed_at: '2026-10-18T08:00:00Z' }
];
const facts = stageFacts(deal, STAGES, dealHistory, NOW);
t('facts: stage, step 3 of 6, 16 days, stuck', facts.stage.id === 3 && facts.path.step === 3 && facts.path.total === 6 && facts.days === 16 && facts.stuck === true);
t('facts: fresh stage not stuck', stageFacts(deal, STAGES, [{ deal_id: 'd1', to_stage: 3, changed_at: '2026-11-01T08:00:00Z' }], NOW).stuck === false);
t('facts: no history → no days, not stuck', stageFacts(deal, STAGES, null, NOW).days === null && stageFacts(deal, STAGES, null, NOW).stuck === false);
t('facts: closed deals never stuck', stageFacts({ id: 'w', stage_id: 6, created_at: '2026-01-01T00:00:00Z' }, STAGES, [], NOW).stuck === false);
t('facts: won path complete', stageFacts({ id: 'w', stage_id: 6 }, STAGES, [], NOW).path.won === true);

const rates = new Map([[4, 3], [8, 0]]);
t('rate: project rate first', rateFor(4, rates, 2.5) === 3);
t('rate: a project rate of 0 is a rate', rateFor('8', rates, 2.5) === 0);
t('rate: falls back to the general rate', rateFor(5, rates, 2.5) === 2.5 && rateFor(null, rates, '2') === 2);
t('rate: none known', rateFor(5, rates, null) === null && rateFor(5, null, undefined) === null);

t('commission: open = expected amber', same(commissionFacts({ amount: 1480000 }, stage(3), 3, null),
    { state: 'expected', amount: 44400, label: 'متوقعة', tone: 'amber' }));
t('commission: open without amount or rate → no amount', commissionFacts({ amount: null }, stage(3), 3, null).amount === null
    && commissionFacts({ amount: 900000 }, stage(1), null, null).amount === null);
t('commission: won = due green from the commission row', same(commissionFacts({ amount: 1000000 }, stage(6), 2.5, { gross_amount: '30000.00', status: 'collected' }),
    { state: 'due', amount: 30000, label: 'مستحقة', tone: 'ok' }));
t('commission: won without a row → no amount', commissionFacts({ amount: 1000000 }, stage(6), 2.5, null).amount === null);
t('commission: waived says so, muted', same(commissionFacts({ amount: 1000000 }, stage(6), 2.5, { gross_amount: 25000, status: 'waived' }),
    { state: 'due', amount: 25000, label: 'معفاة', tone: 'muted' }));
t('commission: lost = missed, muted', same(commissionFacts({ amount: 850000 }, stage(7), 1.5, null),
    { state: 'lost', amount: 12750, label: 'فائتة', tone: 'muted' }));
t('commission: unknown stage → nothing', commissionFacts({ amount: 1 }, null, 2.5, null) === null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
