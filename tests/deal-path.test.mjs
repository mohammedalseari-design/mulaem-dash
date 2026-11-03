// اختبار crm/js/deal-path.js: الترتيب والمرحلة التالية والسابقة، ومكان الصفقة في المسار، ومتى دخلت مرحلتها، والأيام،
// و«واقفة»، وحالة العمولة ومبلغها المتوقع. المراحل كما في 007_deals_commissions.sql، وتصل من القاعدة بأي ترتيب.
// التشغيل: node tests/deal-path.test.mjs   أو   deno run tests/deal-path.test.mjs
import {
    openStages, wonStage, lostStage, stageOf, nextStage, prevStage, progress, enteredAt, daysSince, isStuck, STUCK_DAYS,
    commissionState, COMMISSION_STATE_TEXT, expectedCommission, daysText
} from '../crm/js/deal-path.js';

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

t('open stages sorted, terminals out', ids(openStages(STAGES)) === '1,2,3,4,5');
t('won / lost stages', wonStage(STAGES).id === 6 && lostStage(STAGES).id === 7);
t('stageOf by id (string id ok)', stageOf(STAGES, '3').name_ar === 'تفاوض' && stageOf(STAGES, 99) === null);
t('next of اهتمام جدي = معاينة', nextStage(STAGES, 1).id === 2);
t('next of تفاوض = عربون', nextStage(STAGES, 3).id === 4);
t('next of last open (عقد وإفراغ) = تمت', nextStage(STAGES, 5).id === 6);
t('closed deals have no next', nextStage(STAGES, 6) === null && nextStage(STAGES, 7) === null);
t('unknown stage has no next', nextStage(STAGES, 42) === null && nextStage(null, 1) === null);
t('prev of first = none', prevStage(STAGES, 1) === null);
t('prev of عربون = تفاوض', prevStage(STAGES, 4).id === 3);
t('prev of closed = none', prevStage(STAGES, 6) === null && prevStage(STAGES, 7) === null);
t('progress تفاوض = 3 of 6', JSON.stringify(progress(STAGES, 3)) === JSON.stringify({ step: 3, total: 6, won: false, lost: false }));
t('progress تمت = 6 of 6, won', JSON.stringify(progress(STAGES, 6)) === JSON.stringify({ step: 6, total: 6, won: true, lost: false }));
t('progress خسرت = lost, no step', JSON.stringify(progress(STAGES, 7)) === JSON.stringify({ step: 0, total: 6, won: false, lost: true }));
t('progress unknown', progress(STAGES, 99).step === 0);

const deal = { id: 'd1', stage_id: 3, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-11-02T08:00:00Z' };
const history = [
    { deal_id: 'd1', to_stage: 1, changed_at: '2026-10-01T08:00:00Z' },
    { deal_id: 'd1', to_stage: 3, changed_at: '2026-10-20T08:00:00Z' },
    { deal_id: 'd1', to_stage: 2, changed_at: '2026-10-25T08:00:00Z' },
    { deal_id: 'd1', to_stage: 3, changed_at: '2026-10-28T09:00:00Z' },
    { deal_id: 'd2', to_stage: 3, changed_at: '2026-11-01T09:00:00Z' }
];
t('entered = latest move into the current stage', enteredAt(deal, history) === '2026-10-28T09:00:00Z');
t('entered ignores other deals', enteredAt({ id: 'd2', stage_id: 3 }, history) === '2026-11-01T09:00:00Z');
t('entered falls back to created_at', enteredAt(Object.assign({}, deal, { stage_id: 5 }), history) === '2026-10-01T08:00:00Z');
t('entered: no deal → null', enteredAt(null, history) === null);

const NOW = Date.parse('2026-11-03T10:00:00Z');
t('days since 6 days', daysSince('2026-10-28T09:00:00Z', NOW) === 6);
t('days since a few hours = 0', daysSince('2026-11-03T02:00:00Z', NOW) === 0);
t('future = 0', daysSince('2026-11-05T02:00:00Z', NOW) === 0);
t('bad date = null', daysSince('nope', NOW) === null && daysSince(null, NOW) === null);
t('stuck: open stage over the limit', isStuck(stageOf(STAGES, 3), STUCK_DAYS + 1) === true);
t('not stuck at the limit', isStuck(stageOf(STAGES, 3), STUCK_DAYS) === false);
t('closed deals are never stuck', isStuck(stageOf(STAGES, 6), 100) === false && isStuck(stageOf(STAGES, 7), 100) === false);
t('unknown days not stuck', isStuck(stageOf(STAGES, 3), null) === false);

t('commission: open = expected', commissionState(stageOf(STAGES, 4)) === 'expected' && COMMISSION_STATE_TEXT.expected === 'متوقعة');
t('commission: won = due', commissionState(stageOf(STAGES, 6)) === 'due' && COMMISSION_STATE_TEXT.due === 'مستحقة');
t('commission: lost = lost', commissionState(stageOf(STAGES, 7)) === 'lost' && COMMISSION_STATE_TEXT.lost === 'فائتة');
t('commission: no stage', commissionState(null) === null);
t('expected 1,480,000 at 3% = 44,400', expectedCommission(1480000, 3) === 44400);
t('expected 850,000 at 1.5% = 12,750', expectedCommission(850000, 1.5) === 12750);
t('expected rounds to halalas', expectedCommission(999999, 2.5) === 24999.98);
t('expected needs amount and rate', expectedCommission(null, 2.5) === null && expectedCommission(100000, null) === null && expectedCommission(0, 2) === null);

t('days text', daysText(0) === 'اليوم' && daysText(1) === 'يوم واحد' && daysText(2) === 'يومان' && daysText(6) === '6 أيام' && daysText(15) === '15 يوماً');
t('days text empty', daysText(null) === '');

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
