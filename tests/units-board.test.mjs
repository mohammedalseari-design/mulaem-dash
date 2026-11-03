// اختبار crm/js/units-board.js: قسمة كل نموذج بين متاح ومحجوز ومباع بقاعدة v_units (030_unit_holds.sql)، ومطابقة
// الحجوزات باسم الوحدة، والحالة اليدوية من تفاصيل المشروع، والمربعات وترتيبها وتصغيرها، وأرقام الشريط والنموذج الأول.
// القاعدة نفسها مكتوبة هنا مرة ثانية (vUnits) كما في العرض، وكل قسمة تُقارن بها على شبكة من الحالات.
// التشغيل: node tests/units-board.test.mjs   أو   deno run tests/units-board.test.mjs
import {
    unitTotal, kindOf, holdTally, manualStatus, inferManual, splitUnits, statusOf, MAX_CELLS, cellsOf,
    buildBoard, boardSummary, defaultOrd, availabilityText, takenText
} from '../crm/js/units-board.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parts = (s) => [s.available, s.reserved, s.sold].join('/');

/* ===================== الأساسيات ===================== */

t('unit total: count, default 1, never below 1', unitTotal(8) === 8 && unitTotal(null) === 1 && unitTotal(0) === 1 && unitTotal('3') === 3 && unitTotal('x') === 1);
t('kind: available / reserved / everything else is out of sale', kindOf('available') === 'available' && kindOf('reserved') === 'reserved'
    && kindOf('sold') === 'sold' && kindOf('sold_out') === 'sold' && kindOf('Available') === 'sold');

const tally = holdTally([
    { unit_key: 'A', status: 'reserved' }, { unit_key: 'A', status: 'sold' }, { unit_key: 'B', status: 'sold' },
    { unit_key: null, status: 'reserved' }, null
]);
t('holds tallied by unit key', same(tally.get('A'), { held: 2, sold: 1 }) && same(tally.get('B'), { held: 1, sold: 1 }));
t('whole-property holds under null', same(tally.get(null), { held: 1, sold: 0 }) && !tally.has('null'));
t('no holds → empty map', holdTally(null).size === 0);

/* ===================== الحالة اليدوية ===================== */

const PROJECT = {
    availability: 'available',
    details: { models: [{ name: 'A', status: 'available' }, { name: 'B', status: 'reserved' }, { name: 'C' }, { name: 'D', status: '' }, 'نص', { name: 'F', status: 'sold' }] }
};
t('manual from the model', manualStatus(PROJECT, 1) === 'available' && manualStatus(PROJECT, 2) === 'reserved' && manualStatus(PROJECT, 6) === 'sold');
t('manual: missing or empty status = available (as v_units)', manualStatus(PROJECT, 3) === 'available' && manualStatus(PROJECT, 4) === 'available');
t('manual: a non-object model = available', manualStatus(PROJECT, 5) === 'available');
t('manual: model beyond the list is unknown', manualStatus(PROJECT, 7) === null && manualStatus({ availability: 'available' }, 1) === null);
t('manual: whole-property row uses availability', manualStatus(PROJECT, 0) === 'available' && manualStatus({ availability: 'sold_out' }, 0) === 'sold_out');
t('manual: a sold-out project covers its models', manualStatus(Object.assign({}, PROJECT, { availability: 'sold_out' }), 1) === 'sold_out');
t('manual: no project at all', manualStatus(null, 0) === 'available' && manualStatus(null, 2) === null);

/* ===================== القسمة ===================== */

t('no holds → all available', parts(splitUnits(8, 'available', 0, 0)) === '8/0/0');
t('holds split reserved vs sold', parts(splitUnits(8, 'available', 5, 3)) === '3/2/3');
t('every unit held, some sold → rest reserved', parts(splitUnits(4, 'available', 4, 1)) === '0/3/1');
t('every unit sold', parts(splitUnits(4, 'available', 4, 4)) === '0/0/4');
t('overbooked: never below zero, sold capped', parts(splitUnits(3, 'available', 6, 2)) === '0/1/2' && parts(splitUnits(3, 'available', 6, 5)) === '0/0/3');
t('manual reserved covers the model (holds ignored)', parts(splitUnits(5, 'reserved', 2, 1)) === '0/5/0');
t('manual sold covers the model', parts(splitUnits(5, 'sold', 0, 0)) === '0/0/5');
t('sold out / unknown manual = out of sale', parts(splitUnits(2, 'sold_out')) === '0/0/2' && parts(splitUnits(1, 'hidden')) === '0/0/1');
t('empty manual = available', parts(splitUnits(2, '', 1, 0)) === '1/1/0' && parts(splitUnits(2, null)) === '2/0/0');
t('sold more than held is clamped', parts(splitUnits(5, 'available', 1, 3)) === '4/0/1');
t('status of a split', statusOf(splitUnits(3, 'available', 1, 1)) === 'available' && statusOf(splitUnits(3, 'available', 3, 1)) === 'reserved'
    && statusOf(splitUnits(3, 'available', 3, 3)) === 'sold' && statusOf(splitUnits(3, 'reserved')) === 'reserved');

// قاعدة v_units حرفياً (030/037): الحالة المجمّعة و units_left. h.n_held is null ⇔ لا حجوزات
function vUnits(count, manual, held, sold) {
    const status = manual !== 'available' || held === 0 || held < count ? manual : sold >= count ? 'sold' : 'reserved';
    return { status, left: Math.max(count - held, 0) };
}
let agree = true, sums = true, inferAvail = true, inferSplit = true, firstBad = null;
for (const count of [1, 2, 3, 5, 8]) {
    for (const manual of ['available', 'reserved', 'sold']) {
        for (let held = 0; held <= 10; held++) {
            for (let sold = 0; sold <= held; sold++) {
                const s = splitUnits(count, manual, held, sold);
                const v = vUnits(count, manual, held, sold);
                const ok = s.available === (v.status === 'available' ? v.left : 0) && statusOf(s) === kindOf(v.status);
                if (!ok && agree) { agree = false; firstBad = { count, manual, held, sold, s, v }; }
                if (s.available + s.reserved + s.sold !== count) sums = false;
                // الاستنتاج من الحالة المجمّعة يعطي المتاح نفسه دائماً، والقسمة نفسها خارج الالتباس الوحيد الموثّق
                const inferred = splitUnits(count, inferManual(v.status, count, held, sold), held, sold);
                if (inferred.available !== s.available) inferAvail = false;
                const ambiguous = manual === 'reserved' && held >= count && sold < count;
                if (!ambiguous && parts(inferred) !== parts(s)) inferSplit = false;
            }
        }
    }
}
t('split agrees with v_units on every case (available count and model status)', agree, firstBad);
t('split always adds up to the unit count', sums);
t('inferred manual gives the same available count', inferAvail);
t('inferred manual gives the same split outside the documented ambiguity', inferSplit);
t('infer: available stays available', inferManual('available', 3, 3, 3) === 'available' && inferManual(null, 1) === 'available');
t('infer: not explained by holds → manual', inferManual('reserved', 4, 1, 0) === 'reserved' && inferManual('sold', 2, 2, 0) === 'sold');
t('infer: explained by holds → manual was available', inferManual('reserved', 2, 2, 1) === 'available' && inferManual('sold', 2, 3, 2) === 'available');

/* ===================== المربعات ===================== */

t('cells in fill order: sold, reserved, available', cellsOf({ available: 2, reserved: 1, sold: 2 }).join(',') === 'sold,sold,reserved,available,available');
t('one cell per unit', cellsOf(splitUnits(8, 'available', 5, 3)).length === 8);
t('no units → no cells', cellsOf(null).length === 0);
const big = cellsOf({ sold: 150, reserved: 30, available: 20 });
const count = (list, kind) => list.filter((k) => k === kind).length;
t('large model scaled to the cell limit', big.length === MAX_CELLS && count(big, 'sold') === 75 && count(big, 'reserved') === 15 && count(big, 'available') === 10);
const tiny = cellsOf({ sold: 997, reserved: 2, available: 1 });
t('scaled: every non-empty kind keeps one cell', tiny.length === MAX_CELLS && count(tiny, 'reserved') === 1 && count(tiny, 'available') === 1 && count(tiny, 'sold') === 98);
t('scaled order kept', tiny[0] === 'sold' && tiny[tiny.length - 1] === 'available');
t('exactly at the limit is not scaled', cellsOf({ available: MAX_CELLS }).length === MAX_CELLS);

/* ===================== اللوحة ===================== */

const UNITS = [
    // عمداً بغير ترتيب
    { unit_ord: 3, unit_key: 'C', unit_type: 'شقة', rooms: 4, bathrooms: 3, area: 180, price: 1200000, unit_count: 2, unit_status: 'available', unit_commission: 30000 },
    { unit_ord: 1, unit_key: 'A', unit_type: 'شقة', rooms: 3, bathrooms: 2, area: 140, price: 850000, unit_count: 8, unit_status: 'available', unit_commission: 21250 },
    { unit_ord: 2, unit_key: 'B', unit_type: 'شقة', rooms: 3, bathrooms: 2, area: 150, price: 900000, unit_count: 3, unit_status: 'reserved', unit_commission: 22500 }
];
const HOLDS = [
    { unit_key: 'A', status: 'reserved' }, { unit_key: 'A', status: 'reserved' }, { unit_key: 'A', status: 'sold' },
    { unit_key: 'A', status: 'sold' }, { unit_key: 'A', status: 'sold' },
    { unit_key: 'شقة 9', status: 'reserved' },   // اسم لا يطابق نموذجاً: يتركه v_units، وتتركه اللوحة
    { unit_key: null, status: 'sold' },          // صفقة على «كامل العقار» في مشروع له نماذج: لا تطابق صفاً
    { unit_key: 'C', status: 'reserved' }
];
const board = buildBoard(UNITS, HOLDS, { availability: 'available', details: { models: [{ name: 'A' }, { name: 'B', status: 'reserved' }, { name: 'C' }] } });
t('board ordered by unit_ord', board.map((r) => r.ord).join(',') === '1,2,3');
t('model A: holds by name', parts(board[0]) === '3/2/3' && board[0].status === 'available');
t('model B: manual reserved covers it', parts(board[1]) === '0/3/0' && board[1].status === 'reserved');
t('model C: one reserved of two', parts(board[2]) === '1/1/0');
t('board row carries specs and commission', board[0].key === 'A' && board[0].rooms === 3 && board[0].price === 850000 && board[0].commission === 21250 && board[0].type === 'شقة');
t('board row cells', board[0].cells.length === 8 && board[0].cells.join(',') === 'sold,sold,sold,reserved,reserved,available,available,available');

const whole = buildBoard([{ unit_ord: 0, unit_key: 'كامل العقار', price: '2500000', unit_count: 1, unit_status: 'reserved' }],
    [{ unit_key: null, status: 'reserved' }], { availability: 'available', details: {} });
t('whole-property row matches null-key holds', parts(whole[0]) === '0/1/0' && whole[0].status === 'reserved' && whole[0].price === 2500000);
const soldOut = buildBoard(UNITS, [], { availability: 'sold_out', details: { models: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } });
t('sold-out project: nothing available', soldOut.every((r) => r.available === 0 && r.status === 'sold'));
const twins = buildBoard([{ unit_ord: 1, unit_key: 'A', unit_count: 2 }, { unit_ord: 2, unit_key: 'A', unit_count: 2 }],
    [{ unit_key: 'A', status: 'reserved' }], { availability: 'available', details: { models: [{ name: 'A' }, { name: 'A' }] } });
t('two models with the same name share their holds (as v_units)', parts(twins[0]) === '1/1/0' && parts(twins[1]) === '1/1/0');
const drifted = buildBoard([{ unit_ord: 4, unit_key: 'D', unit_count: 2, unit_status: 'sold' }], [], { availability: 'available', details: { models: [] } });
t('model missing from details: manual inferred from v_units', drifted[0].manual === 'sold' && parts(drifted[0]) === '0/0/2');
t('empty board', buildBoard(null, null, null).length === 0);
t('rows without unit_ord are dropped', buildBoard([{ unit_key: 'X' }, null], [], PROJECT).length === 0);

/* ===================== الشريط والنموذج الأول ===================== */

const sum = boardSummary(board);
t('summary totals', sum.models === 3 && sum.total === 13 && sum.available === 4 && sum.reserved === 6 && sum.sold === 3);
t('summary: from-price among available models only', sum.fromPrice === 850000);
t('summary: commission range among available models only', same(sum.commission, { min: 21250, max: 30000 }));
const single = boardSummary([{ available: 1, total: 1, reserved: 0, sold: 0, price: 0, commission: 0 }, { available: 2, total: 2, reserved: 0, sold: 0, price: 500000, commission: null }]);
t('summary: zero price ignored, zero commission kept, null commission ignored', single.fromPrice === 500000 && same(single.commission, { min: 0, max: 0 }));
const none = boardSummary(soldOut);
t('summary: nothing available → no price, no commission', none.available === 0 && none.fromPrice === null && none.commission === null && none.sold === 13);
t('summary of nothing', same(boardSummary(null), { models: 0, total: 0, available: 0, reserved: 0, sold: 0, fromPrice: null, commission: null }));

t('default: first model with an available unit', defaultOrd(board) === 1 && defaultOrd([board[1], board[2]]) === 3);
t('default: nothing available → first model', defaultOrd(soldOut) === 1);
t('default: no rows → null', defaultOrd([]) === null && defaultOrd(null) === null);

/* ===================== النصوص ===================== */

t('availability text for a model', availabilityText(board[0]) === 'متاح 3 من 8' && availabilityText(board[1]) === 'متاح 0 من 3');
t('availability text with a number formatter', availabilityText({ total: 1200, available: 1000 }, (n) => n.toLocaleString('en-US')) === 'متاح 1,000 من 1,200');
t('single unit in a word', availabilityText({ total: 1, available: 1 }) === 'متاح' && availabilityText({ total: 1, available: 0, reserved: 1 }) === 'محجوز'
    && availabilityText({ total: 1, available: 0, reserved: 0, sold: 1 }) === 'مباع');
t('taken text skips empty parts', takenText(board[0]) === 'محجوز 2 · مباع 3' && takenText(board[2]) === 'محجوز 1' && takenText({ reserved: 0, sold: 0 }) === '');
t('texts of nothing', availabilityText(null) === '' && takenText(null) === '');

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
