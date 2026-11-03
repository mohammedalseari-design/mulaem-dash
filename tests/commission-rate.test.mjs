// اختبار crm/js/commission-rate.js: قراءة النسبة بكل كتاباتها، ونصها، وعمولة السعر، ومصدر عمولة الوحدة، وتغيير المبلغ المحدد.
// التشغيل: node tests/commission-rate.test.mjs   أو   deno run tests/commission-rate.test.mjs
import { parseRate, formatRate, commissionAt, sourceText, overrideChange } from '../crm/js/commission-rate.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const isNaNValue = (v) => typeof v === 'number' && Number.isNaN(v);

// parseRate
t('rate: 2.5', parseRate('2.5') === 2.5);
t('rate: Arabic ٢٫٥', parseRate('٢٫٥') === 2.5);
t('rate: comma 2,5', parseRate('2,5') === 2.5);
t('rate: with % and spaces', parseRate(' 3 % ') === 3);
t('rate: Arabic percent sign', parseRate('٢٪') === 2);
t('rate: Persian digits', parseRate('۱.۵') === 1.5);
t('rate: rounds to 2 decimals', parseRate('2.555') === 2.56);
t('rate: 0 allowed', parseRate('0') === 0);
t('rate: 100 allowed', parseRate('100') === 100);
t('rate: empty → null', parseRate('') === null && parseRate('  ') === null && parseRate(null) === null);
t('rate: over 100 → NaN', isNaNValue(parseRate('101')));
t('rate: negative → NaN', isNaNValue(parseRate('-1')));
t('rate: words → NaN', isNaNValue(parseRate('اثنين')));
t('rate: two dots → NaN', isNaNValue(parseRate('2.5.1')));

// formatRate
t('format: 3 → 3٪', formatRate(3) === '3٪');
t('format: "2.50" → 2.5٪', formatRate('2.50') === '2.5٪');
t('format: 2.75', formatRate(2.75) === '2.75٪');
t('format: null → empty', formatRate(null) === '' && formatRate('') === '' && formatRate('x') === '');

// commissionAt
t('commission: 1,250,000 at 2.5 = 31,250', commissionAt(1250000, 2.5) === 31250);
t('commission: 1,480,000 at 3 = 44,400', commissionAt(1480000, 3) === 44400);
t('commission: rounds to halalas', commissionAt(999999, 2.5) === 24999.98);
t('commission: no price → null', commissionAt(0, 2.5) === null && commissionAt(null, 2.5) === null);
t('commission: bad rate → null', commissionAt(100, 'x') === null && commissionAt(100, -1) === null);
t('commission: rate 0 → 0', commissionAt(500000, 0) === 0);

// sourceText
t('source: override', sourceText('override', null) === 'مبلغ محدد');
t('source: project', sourceText('project', 3) === '3٪ المشروع');
t('source: default', sourceText('default', '2.50') === '2.5٪ العامة');
t('source: hidden/none', sourceText(null, null) === '' && sourceText(undefined) === '');

// overrideChange
const amount = (s) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : null; };
t('override: unchanged empty', overrideChange(null, '', amount) === undefined);
t('override: unchanged same amount', overrideChange(50000, '50,000', amount) === undefined);
t('override: unchanged 50000 vs "50000.00"', overrideChange('50000.00', '50000', amount) === undefined);
t('override: new amount', overrideChange(null, '15000', amount) === 15000);
t('override: changed amount', overrideChange(50000, '45000', amount) === 45000);
t('override: cleared → null', overrideChange(50000, ' ', amount) === null);
t('override: zero is a real amount', overrideChange(null, '0', amount) === 0);
t('override: junk → NaN', isNaNValue(overrideChange(null, 'abc', amount)));
t('override: too big → NaN', isNaNValue(overrideChange(null, '200000000', amount)));

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof process !== 'undefined') process.exit(1);
    else if (typeof Deno !== 'undefined') Deno.exit(1);
}
