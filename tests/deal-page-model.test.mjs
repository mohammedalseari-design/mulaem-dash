// اختبار crm/js/deal-page-model.js: خطوات «مسار الصفقة» وحالة كل خطوة، ومتى تُعرض حالة «خسرت»، وسطر المدة فوق المسار
// بأيام التقويم (مع «واقفة» والمغلقة)، ومن أي مرحلة خسرت، والإجراءات المسموحة لكل حالة ودور (ولمن يقرأ الصفقة ولا
// يكتبها)، وأساس العمولة وصندوقها ولونه. المراحل كما في 007_deals_commissions.sql وتصل من القاعدة بأي ترتيب.
// التشغيل: node tests/deal-page-model.test.mjs   أو   deno run tests/deal-page-model.test.mjs
import {
    sar, pathOrder, pathSteps, showLost, calendarDays, lostFrom, sinceLine, pathActions, commissionBase, unitPriceKey, commissionBox,
    LOST_STAGE_ID, LOCKED_NOTE, REOPEN_WON_NOTE, REOPEN_LOST_NOTE, PICK_NOTE, OTHER_BROKER_NOTE, NO_BASE_HINT, NO_AMOUNT_TEXT
} from '../crm/js/deal-page-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

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
const ids = (list) => list.map((s) => s.id).join(',');
const states = (model) => model.steps.map((s) => s.state).join(',');

/* ---------- المبالغ ---------- */
t('sar formats with thousands and ر.س', sar(1480000) === '1,480,000 ر.س' && sar('37000.50') === '37,000.5 ر.س');
t('sar: nothing = dash', sar(null) === '—' && sar(undefined) === '—' && sar('') === '—' && sar('x') === '—');

/* ---------- الخطوات ---------- */
t('path order: open stages then تمت, no خسرت', ids(pathOrder(STAGES)) === '1,2,3,4,5,6');
const mid = pathSteps(STAGES, 3);
t('open deal at تفاوض: two done, current, three ahead', mid.status === 'open' && states(mid) === 'done,done,current,todo,todo,todo', states(mid));
t('steps are numbered 1..6 with names', mid.steps.map((s) => s.n).join(',') === '1,2,3,4,5,6' && mid.steps[2].name === 'تفاوض');
t('only تمت is the final step', mid.steps.filter((s) => s.final).map((s) => s.id).join(',') === '6');
t('first stage: current then todo', states(pathSteps(STAGES, 1)) === 'current,todo,todo,todo,todo,todo');
t('last open stage: four done, current, تمت ahead', states(pathSteps(STAGES, 5)) === 'done,done,done,done,current,todo');
t('string stage id works', states(pathSteps(STAGES, '2')) === 'done,current,todo,todo,todo,todo');
const won = pathSteps(STAGES, 6);
t('won deal: all done and تمت marked won', won.status === 'won' && states(won) === 'done,done,done,done,done,won', states(won));
const lost = pathSteps(STAGES, 7);
t('lost deal: whole path greyed, no step looks done', lost.status === 'lost' && states(lost) === 'off,off,off,off,off,off', states(lost));
t('lost deal keeps the same six steps', lost.steps.length === 6 && !lost.steps.some((s) => s.id === 7));
t('unknown stage: nothing done', pathSteps(STAGES, 99).status === 'unknown' && states(pathSteps(STAGES, 99)) === 'todo,todo,todo,todo,todo,todo');
t('no stages: no steps', pathSteps([], 3).steps.length === 0 && pathSteps(null, 3).status === 'unknown');

/* ---------- حالة «خسرت» ---------- */
t('lost state: from the stages', showLost(pathSteps(STAGES, 7), 7) === true && showLost(pathSteps(STAGES, 3), 3) === false
    && showLost(pathSteps(STAGES, 6), 6) === false);
t('lost state: stages not loaded, still shown by the lost stage number', LOST_STAGE_ID === 7 && showLost(pathSteps([], 7), 7) === true
    && showLost(pathSteps(null, '7'), '7') === true && showLost(pathSteps([], 3), 3) === false);
t('lost state: a known stage is not overridden by the number', showLost({ status: 'open', steps: [] }, 7) === false && showLost(null, 7) === false);

/* ---------- السطر فوق المسار ---------- */
// أوقات محلية بتوقيت الجهاز ('2026-11-03 13:00'): النص يعدّ أيام التقويم المحلية، فتُبنى الأوقات بها ولا يتعلق
// الاختبار بمنطقة الجهاز (يمرّ بتوقيت الرياض وبـUTC في tests.yml). الفوارق ساعة فأكثر فلا تقلبها الساعة الصيفية.
const L = (text) => {
    const [date, time = '00:00'] = text.split(' ');
    const [y, m, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi).toISOString();
};
const NOW = Date.parse(L('2026-11-03 13:00'));
const MORNING = Date.parse(L('2026-11-03 09:00'));

t('calendar days: same day 0, yesterday 1 even hours ago', calendarDays(L('2026-11-03 00:30'), MORNING) === 0
    && calendarDays(L('2026-11-02 23:30'), MORNING) === 1 && calendarDays(L('2026-11-02 01:00'), MORNING) === 1);
t('calendar days: a week; the future is 0; a bad time is null', calendarDays(L('2026-10-27 09:00'), MORNING) === 7
    && calendarDays(L('2026-11-04 09:00'), MORNING) === 0 && calendarDays('x', MORNING) === null && calendarDays(null, MORNING) === null);

const deal = { id: 'd1', stage_id: 3, created_at: L('2026-10-01 11:00'), updated_at: L('2026-11-02 11:00'), closed_at: null };
const history = [
    { deal_id: 'd1', from_stage: 2, to_stage: 3, changed_at: L('2026-10-28 12:00') },
    { deal_id: 'd1', from_stage: 3, to_stage: 2, changed_at: L('2026-10-25 11:00') },
    { deal_id: 'd1', from_stage: 2, to_stage: 3, changed_at: L('2026-10-20 11:00') },
    { deal_id: 'd1', from_stage: null, to_stage: 1, changed_at: L('2026-10-01 11:00') }
];
const six = sinceLine(STAGES, deal, history, NOW);
t('open: «في «تفاوض» من 6 أيام» from the latest move in', six && six.text === 'في «تفاوض» من 6 أيام' && six.days === 6 && six.stuck === false && six.flag === null, six);
const at = (text) => [{ deal_id: 'd1', from_stage: 2, to_stage: 3, changed_at: L(text) }];
t('two days reads «من يومين» (not يومان)', sinceLine(STAGES, deal, at('2026-11-01 12:00'), NOW).text === 'في «تفاوض» من يومين');
t('yesterday reads «من أمس»', sinceLine(STAGES, deal, at('2026-11-02 12:00'), NOW).text === 'في «تفاوض» من أمس');
t('same day reads «من اليوم»', sinceLine(STAGES, deal, at('2026-11-03 10:00'), NOW).text === 'في «تفاوض» من اليوم');
const lateYesterday = sinceLine(STAGES, deal, at('2026-11-02 23:00'), MORNING);
t('entered late yesterday, read this morning: «من أمس», not «اليوم» (days stays full days)', lateYesterday.text === 'في «تفاوض» من أمس'
    && lateYesterday.days === 0, lateYesterday);
t('two calendar days ago in the evening: «من يومين» (34 hours)', sinceLine(STAGES, deal, at('2026-11-01 23:00'), MORNING).text === 'في «تفاوض» من يومين');
const stuck = sinceLine(STAGES, deal, at('2026-10-19 12:00'), NOW);
t('over 14 days: stuck, flagged «واقفة», with the reason', stuck.stuck === true && stuck.flag === 'واقفة'
    && stuck.text === 'في «تفاوض» من 15 يوماً' && stuck.title === 'مضى عليها أكثر من 14 يوماً في هذه المرحلة', stuck);
t('exactly 14 days is not stuck yet', sinceLine(STAGES, deal, at('2026-10-20 12:00'), NOW).stuck === false);
const edge = sinceLine(STAGES, deal, at('2026-10-19 23:00'), MORNING);
t('«واقفة» keeps full days (isStuck threshold unchanged): 15 calendar days but 14 full days is not stuck yet',
    edge.text === 'في «تفاوض» من 15 يوماً' && edge.days === 14 && edge.stuck === false, edge);
t('history unreadable: no line for an open deal', sinceLine(STAGES, deal, null, NOW) === null);
t('history empty: open deal counts from creation', sinceLine(STAGES, deal, [], NOW).text === 'في «تفاوض» من 33 يوماً');
t('history rows of another deal are ignored', sinceLine(STAGES, deal, [{ deal_id: 'd2', to_stage: 3, changed_at: L('2026-11-03 12:00') }], NOW).days === 33);

const wonDeal = { id: 'w1', stage_id: 6, created_at: L('2026-09-01 11:00'), closed_at: L('2026-10-31 11:00') };
const wonHistory = [{ deal_id: 'w1', from_stage: 5, to_stage: 6, changed_at: L('2026-10-31 11:00') }];
const closedAt = (text) => Object.assign({}, wonDeal, { closed_at: L(text) });
t('won: «تمّت قبل 3 أيام»', sinceLine(STAGES, wonDeal, wonHistory, NOW).text === 'تمّت قبل 3 أيام');
t('won today: «تمّت اليوم»', sinceLine(STAGES, closedAt('2026-11-03 11:00'), [], NOW).text === 'تمّت اليوم');
t('won yesterday evening, read this morning: «تمّت أمس», not «اليوم»', sinceLine(STAGES, closedAt('2026-11-02 20:00'), [], MORNING).text === 'تمّت أمس');
t('won two calendar days ago in the evening: «تمّت قبل يومين», not «قبل يوم واحد»',
    sinceLine(STAGES, closedAt('2026-11-01 20:00'), [], MORNING).text === 'تمّت قبل يومين');
t('won, history unreadable: closed_at', sinceLine(STAGES, wonDeal, null, NOW).text === 'تمّت قبل 3 أيام');
t('won, no history row: closed_at, never the creation date', sinceLine(STAGES, wonDeal, [], NOW).days === 3);
t('closed lines are never stuck', sinceLine(STAGES, closedAt('2026-08-01 11:00'), [], NOW).stuck === false);

const lostDeal = { id: 'l1', stage_id: 7, created_at: L('2026-09-01 11:00'), closed_at: L('2026-11-01 12:00') };
const lostHistory = [
    { deal_id: 'l1', from_stage: 4, to_stage: 7, changed_at: L('2026-11-01 12:00') },
    { deal_id: 'l1', from_stage: 7, to_stage: 4, changed_at: L('2026-10-20 11:00') },
    { deal_id: 'l1', from_stage: 2, to_stage: 7, changed_at: L('2026-10-10 11:00') }
];
t('lost: «خسرت قبل يومين وهي في «عربون»»', sinceLine(STAGES, lostDeal, lostHistory, NOW).text === 'خسرت قبل يومين وهي في «عربون»');
t('lost yesterday: «خسرت أمس وهي في «عربون»»', sinceLine(STAGES, lostDeal,
    [{ deal_id: 'l1', from_stage: 4, to_stage: 7, changed_at: L('2026-11-02 20:00') }], MORNING).text === 'خسرت أمس وهي في «عربون»');
t('lost, history unreadable: closed_at, no stage', sinceLine(STAGES, lostDeal, null, NOW).text === 'خسرت قبل يومين');
t('no stage or no deal: no line', sinceLine(STAGES, { id: 'x', stage_id: 99 }, [], NOW) === null && sinceLine(STAGES, null, [], NOW) === null);

/* ---------- من أي مرحلة خسرت ---------- */
t('lost from: the latest move into خسرت', lostFrom(STAGES, lostDeal, lostHistory).id === 4);
t('lost from: unknown without history', lostFrom(STAGES, lostDeal, []) === null && lostFrom(STAGES, lostDeal, null) === null);
t('lost from: a closed stage is not shown', lostFrom(STAGES, lostDeal, [{ deal_id: 'l1', from_stage: 6, to_stage: 7, changed_at: '2026-11-01T09:00:00Z' }]) === null);
t('lost from: only for lost deals', lostFrom(STAGES, deal, history) === null && lostFrom(STAGES, wonDeal, wonHistory) === null);

/* ---------- الإجراءات ---------- */
const a3 = pathActions(STAGES, 3, false);
t('open: one primary «انقل إلى: عربون»', a3.primary && a3.primary.stage.id === 4 && a3.primary.won === false && a3.primary.text === 'انقل إلى: عربون', a3.primary);
t('open: «رجّعها مرحلة» to معاينة', a3.back && a3.back.stage.id === 2 && a3.back.text === 'رجّعها مرحلة' && a3.back.target === 'إلى «معاينة»');
t('open: «سجّلها «خسرت»» opens the lost form', a3.lose && a3.lose.stage.id === 7 && a3.lose.text === 'سجّلها «خسرت»');
t('open: «مرحلة أخرى…» lists every other step, خسرت has its own link', a3.other && ids(a3.other.stages) === '1,2,4,5,6'
    && a3.other.text === 'مرحلة أخرى…' && a3.other.note === PICK_NOTE);
t('open: nothing to reopen, no note', a3.reopen === null && a3.note === null);
t('first stage: no «رجّعها مرحلة»', pathActions(STAGES, 1, false).back === null && pathActions(STAGES, 1, false).primary.stage.id === 2);
const a5 = pathActions(STAGES, 5, false);
t('next is تمت: «تمّت الصفقة…» (the final-amount form)', a5.primary.won === true && a5.primary.stage.id === 6 && a5.primary.text === 'تمّت الصفقة…');
t('the admin sees the same open actions', JSON.stringify(pathActions(STAGES, 3, true)) === JSON.stringify(a3));
const wonBroker = pathActions(STAGES, 6, false);
t('won, not admin: locked, note only', wonBroker.note === LOCKED_NOTE && !wonBroker.primary && !wonBroker.back && !wonBroker.other && !wonBroker.lose && !wonBroker.reopen);
const wonAdmin = pathActions(STAGES, 6, true);
t('won, admin: reopen to an open stage only', wonAdmin.reopen && ids(wonAdmin.reopen.stages) === '1,2,3,4,5' && wonAdmin.reopen.note === REOPEN_WON_NOTE
    && wonAdmin.reopen.text === 'أعد فتحها…' && wonAdmin.note === null && !wonAdmin.primary && !wonAdmin.lose);
const lostAny = pathActions(STAGES, 7, false);
t('lost: anyone reopens to an open stage', lostAny.reopen && ids(lostAny.reopen.stages) === '1,2,3,4,5' && lostAny.reopen.note === REOPEN_LOST_NOTE
    && !lostAny.primary && !lostAny.lose && lostAny.note === null);
const unknown = pathActions(STAGES, 99, false);
t('unknown stage: no primary, every step to choose, خسرت still possible', unknown.primary === null && unknown.back === null
    && ids(unknown.other.stages) === '1,2,3,4,5,6' && unknown.lose.stage.id === 7);
t('no stages: no actions', JSON.stringify(pathActions([], 3, true)) === JSON.stringify({ primary: null, back: null, other: null, lose: null, reopen: null, note: null }));

// من يقرأ الصفقة ولا يكتبها: وسيط أنشأها ثم صار وسيطها غيره (deals_select تُريه إياها، وdeals_update لا تكتبها له)
const none = (a) => !a.primary && !a.back && !a.other && !a.lose && !a.reopen;
t('the note for a deal held by another broker', OTHER_BROKER_NOTE === 'الصفقة عند وسيط آخر: يغيّر مرحلتها وسيطها أو المدير.');
const otherOpen = pathActions(STAGES, 3, false, false);
t('open, not my deal: no stage buttons or links, only the note', none(otherOpen) && otherOpen.note === OTHER_BROKER_NOTE, otherOpen);
t('first and last open stage, not my deal: still nothing to press', none(pathActions(STAGES, 1, false, false))
    && none(pathActions(STAGES, 5, false, false)) && pathActions(STAGES, 5, false, false).note === OTHER_BROKER_NOTE);
const otherLost = pathActions(STAGES, 7, false, false);
t('lost, not my deal: no «أعد فتحها…», the note says who can', none(otherLost) && otherLost.note === OTHER_BROKER_NOTE, otherLost);
const otherWon = pathActions(STAGES, 6, false, false);
t('won, not my deal: the won lock note (only the admin reopens)', none(otherWon) && otherWon.note === LOCKED_NOTE, otherWon);
const otherUnknown = pathActions(STAGES, 99, false, false);
t('unknown stage, not my deal: nothing to press', none(otherUnknown) && otherUnknown.note === OTHER_BROKER_NOTE);
t('my deal (canMove true) = the actions as before', JSON.stringify(pathActions(STAGES, 3, false, true)) === JSON.stringify(a3)
    && JSON.stringify(pathActions(STAGES, 7, false, true)) === JSON.stringify(lostAny));
t('the admin always moves, whoever the broker', JSON.stringify(pathActions(STAGES, 3, true, false)) === JSON.stringify(a3)
    && JSON.stringify(pathActions(STAGES, 6, true, false)) === JSON.stringify(wonAdmin));

/* ---------- أساس العمولة ---------- */
t('base: the deal amount first', JSON.stringify(commissionBase(1480000, 900000)) === JSON.stringify({ base: 1480000, from: 'deal' }));
t('base: amount as text', commissionBase('1500000.00', null).base === 1500000);
t('base: the unit price when no amount', JSON.stringify(commissionBase(null, 900000)) === JSON.stringify({ base: 900000, from: 'unit' })
    && commissionBase(0, '750000').from === 'unit');
t('base: none', commissionBase(null, null) === null && commissionBase('', '') === null && commissionBase(undefined, 0) === null);
t('unit key: the named unit, trimmed', JSON.stringify(unitPriceKey({ project_id: 12, unit_key: '  شقة A ' })) === JSON.stringify({ project_id: 12, unit_key: 'شقة A' }));
t('unit key: the whole-property row when no unit', JSON.stringify(unitPriceKey({ project_id: 12, unit_key: null })) === JSON.stringify({ project_id: 12, unit_ord: 0 })
    && unitPriceKey({ project_id: 12, unit_key: '   ' }).unit_ord === 0);
t('unit key: no project = nothing to read', unitPriceKey({ project_id: null, unit_key: 'x' }) === null && unitPriceKey(null) === null);

/* ---------- صندوق العمولة ---------- */
const s = (id) => STAGES.find((x) => x.id === id);
const exp = commissionBox({ stage: s(3), amount: 1480000, unitPrice: null, rate: 3, rateFrom: 'نسبة المشروع', row: null });
t('open: «متوقعة» neutral (no colour) = amount × rate', exp.state === 'expected' && exp.label === 'متوقعة' && exp.tone === 'neutral'
    && exp.value === 44400 && exp.valueText === '44,400 ر.س', exp);
t('open: the line says rate, its source and the base', exp.detail === '3٪ (نسبة المشروع) من قيمة الصفقة 1,480,000 ر.س' && exp.hint === null, exp.detail);
const fromUnit = commissionBox({ stage: s(1), amount: null, unitPrice: '900000', rate: 2.5, rateFrom: 'النسبة العامة', row: null });
t('open without amount: from the listed unit price', fromUnit.value === 22500 && fromUnit.detail === '2.5٪ (النسبة العامة) من سعر الوحدة المعروض 900,000 ر.س', fromUnit);
const noBase = commissionBox({ stage: s(2), amount: null, unitPrice: null, rate: 2.5, row: null });
t('open without any base: ask for the deal amount', noBase.value === null && noBase.valueText === '—' && noBase.hint === NO_BASE_HINT
    && noBase.askAmount === true && NO_BASE_HINT === 'اكتب قيمة الصفقة لتظهر العمولة المتوقعة');
const noBaseOther = commissionBox({ stage: s(2), amount: null, unitPrice: null, rate: 2.5, row: null, canEdit: false });
t('open without a base, not my deal: no «اكتب قيمة الصفقة…» link, just no amount', noBaseOther.askAmount === false
    && noBaseOther.hint === NO_AMOUNT_TEXT && NO_AMOUNT_TEXT === 'لا قيمة مسجّلة لهذه الصفقة', noBaseOther);
t('canEdit true or left out keeps the ask', commissionBox({ stage: s(2), amount: null, rate: 2.5, row: null, canEdit: true }).askAmount === true);
const noRate = commissionBox({ stage: s(2), amount: 500000, rate: null, row: null });
t('open, rate unreadable: say so, no number', noRate.value === null && noRate.hint === 'تعذّرت قراءة نسبة العمولة' && noRate.askAmount === false);
const due = commissionBox({ stage: s(6), row: { gross_amount: 37000, base_amount: 1480000, rate_percent: 2.5, status: 'due' } });
t('won, unpaid: amber «مستحقة» = the commission row gross', due.state === 'due' && due.label === 'مستحقة' && due.tone === 'amber'
    && due.value === 37000 && due.valueText === '37,000 ر.س' && due.detail === '2.5٪ من 1,480,000 ر.س', due);
const dueText = commissionBox({ stage: s(6), row: { gross_amount: '37000.00', base_amount: '1480000.00', rate_percent: '2.50', status: 'partial' } });
t('won: numbers as text, and the collection state when past «مستحقة»', dueText.value === 37000
    && dueText.detail === '2.5٪ من 1,480,000 ر.س · محصّلة جزئياً', dueText.detail);
t('won, partly collected: still an amber «مستحقة» (money is still due)', dueText.label === 'مستحقة' && dueText.tone === 'amber');
const rowOf = (status) => ({ gross_amount: 37000, base_amount: 1480000, rate_percent: 2.5, status });
const invoiced = commissionBox({ stage: s(6), row: rowOf('invoiced') });
t('won, invoiced: still an amber «مستحقة», the invoice in the line', invoiced.label === 'مستحقة' && invoiced.tone === 'amber'
    && invoiced.detail === '2.5٪ من 1,480,000 ر.س · صدرت فاتورة', invoiced);
const waived = commissionBox({ stage: s(6), row: rowOf('waived') });
t('won, commission waived: muted «معفاة», never a green «مستحقة»', waived.state === 'due' && waived.label === 'معفاة' && waived.tone === 'muted'
    && waived.value === 37000 && waived.detail === '2.5٪ من 1,480,000 ر.س', waived);
const collected = commissionBox({ stage: s(6), row: rowOf('collected') });
t('won, commission collected: green «محصّلة», said once', collected.label === 'محصّلة' && collected.tone === 'ok'
    && collected.value === 37000 && collected.detail === '2.5٪ من 1,480,000 ر.س', collected);
t('won: the deal amount is not used for «مستحقة»', commissionBox({ stage: s(6), amount: 999, rate: 50, row: null }).value === null);
const noRow = commissionBox({ stage: s(6), row: null });
t('won without a commission row', noRow.value === null && noRow.hint === 'لم تُسجَّل عمولة لهذه الصفقة' && noRow.askAmount === false);
t('won without a commission row: neutral with its text, never a green chip', noRow.tone === 'neutral' && noRow.label === 'مستحقة', noRow);
const missed = commissionBox({ stage: s(7), amount: 1000000, rate: 2.5, rateFrom: 'النسبة العامة', row: null });
t('lost: «فائتة» muted = what it would have been', missed.state === 'lost' && missed.label === 'فائتة' && missed.tone === 'muted'
    && missed.value === 25000 && missed.detail === '2.5٪ (النسبة العامة) من قيمة الصفقة 1,000,000 ر.س', missed);
const missedNoBase = commissionBox({ stage: s(7), amount: null, unitPrice: null, rate: 2.5, row: null });
t('lost without a base: no ask to write the amount', missedNoBase.hint === 'لا قيمة مسجّلة لهذه الصفقة' && missedNoBase.askAmount === false);
t('no stage: no box', commissionBox({ stage: null }) === null && commissionBox(null) === null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
