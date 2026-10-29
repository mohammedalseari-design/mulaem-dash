// اختبار حساب التمويل العقاري (crm/js/mortgage-calc.js): القسط والأصل متعاكسان، وحدود العمر والمدة والاستقطاع،
// والحالات الست، والاقتراحات، ومدخلات فارغة أو تالفة لا تنتج NaN.
// التشغيل: node tests/mortgage-calc.test.mjs   أو   deno run tests/mortgage-calc.test.mjs
import { TERMS, payment, principalFor, yearlySchedule, computeMortgage } from '../crm/js/mortgage-calc.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const base = { salary: 12000, obligations: 0, age: 35, price: 1000000, down: 100000, years: 0, ...TERMS };
const calc = (over) => computeMortgage({ ...base, ...over });
const R = TERMS.rate / 100 / 12;

/* ---- الدوال الأساسية ---- */
t('payment: القسط المرجعي 100,000 بربح 1% شهرياً على 12 شهراً = 8,884.88', near(payment(100000, 0.01, 12), 8884.88));
t('payment: بلا ربح = الأصل ÷ الأشهر', payment(120000, 0, 12) === 10000);
t('payment: أصل أو أشهر صفر = صفر', payment(0, 0.01, 12) === 0 && payment(1000, 0.01, 0) === 0);
for (const [p, r, n] of [[900000, R, 300], [250000, 0.004, 120], [50000, 0, 60], [1500000, 0.006, 360]]) {
    t('principalFor يعكس payment: ' + p + ' / ' + n, near(principalFor(payment(p, r, n), r, n), p, p * 1e-9), { p, r, n });
}
{
    const p = 900000, n = 300, pmt = payment(p, R, n);
    const rows = yearlySchedule(p, R, n, pmt);
    const capital = rows.reduce((s, x) => s + x.capital, 0);
    const interest = rows.reduce((s, x) => s + x.interest, 0);
    t('schedule: 25 سنة بالضبط', rows.length === 25, rows.length);
    t('schedule: مجموع المسدد من الأصل = الأصل', near(capital, p), capital);
    t('schedule: المتبقي آخر سنة صفر', rows[24].balance < 0.01, rows[24].balance);
    t('schedule: مجموع الأرباح = الأقساط − الأصل', near(interest, pmt * n - p), interest);
    t('schedule: أرباح السنة الأولى أكبر من الأخيرة', rows[0].interest > rows[24].interest);
}

/* ---- المثال الافتراضي ---- */
{
    const r = calc({});
    t('مثال: الحالة fits والمدة الأقصى 25 سنة', r.status === 'fits' && r.years === 25 && r.months === 300, [r.status, r.years]);
    t('مثال: أعلى قسط يسمح به الراتب = 55% من 12,000', near(r.room, 6600), r.room);
    t('مثال: القسط الأقصى يسدد أقصى تمويل', near(payment(r.maxFinance, R, 300), 6600), payment(r.maxFinance, R, 300));
    t('مثال: القسط على 900,000', near(r.installment, payment(900000, R, 300), 1e-6), r.installment);
    t('مثال: نسبة الاستقطاع = القسط ÷ الراتب', near(r.dbr, r.installment / 12000 * 100, 1e-9), r.dbr);
    t('مثال: الأرباح = الأقساط − مبلغ التمويل', near(r.profit, r.installment * 300 - 900000, 1e-6), r.profit);
    t('مثال: الرصيد سنة بسنة حاضر', r.schedule.length === 25);
    t('TERMS مجمّدة', Object.isFrozen(TERMS));
}

/* ---- الالتزامات والاستقطاع ---- */
{
    const a = calc({}), b = calc({ obligations: 2000 });
    t('الالتزامات تخفض أعلى قسط', near(b.room, 4600), b.room);
    t('أقصى تمويل يتناسب مع أعلى قسط', near(b.maxFinance / a.maxFinance, 4600 / 6600, 1e-9));
    const c = calc({ obligations: 6600 });
    t('التزامات بقدر الحد: لا قدرة جديدة والحالة short', c.room === 0 && c.maxFinance === 0 && c.status === 'short', [c.room, c.status]);
    const d = calc({ obligations: 9000 });
    t('التزامات فوق الحد: القدرة صفر لا سالبة', d.room === 0 && d.maxFinance === 0, [d.room, d.maxFinance]);
    t('حد الاستقطاع أعلى من 100 يُقصّ إلى 100', calc({ cap: 500 }).cap === 100);
    t('حد الاستقطاع 65% يرفع القدرة', near(calc({ cap: 65 }).room, 7800));
}

/* ---- العمر والمدة ---- */
{
    const a = calc({ age: 50 });
    t('عمر 50 وآخر عمر 60: الحد 10 سنوات والمدة الفارغة تأخذه', a.limit === 10 && a.years === 10 && a.months === 120, [a.limit, a.years]);
    const b = calc({ age: 50, years: 25 });
    t('طلب 25 سنة فوق الحد: تُقصّر إلى 10 مع علامة clamped', b.years === 10 && b.clamped === true);
    const c = calc({ age: 50, years: 5 });
    t('طلب 5 سنوات ضمن الحد: كما هو بلا clamped', c.years === 5 && c.clamped === false);
    t('أقصى مدة 20 سنة تسبق العمر', calc({ age: 30, maxYears: 20 }).limit === 20);
    for (const age of [60, 61, 75]) {
        const r = calc({ age });
        t('عمر ' + age + ': لا مدة متاحة', r.status === 'no-term' && r.months === 0 && r.schedule.length === 0, [r.status, r.months]);
    }
    t('عمر 59: سنة واحدة', calc({ age: 59 }).years === 1);
    t('عمر كسري 35.5: يُقرَّب الحد لأسفل حتى ينتهي السداد قبل آخر عمر', calc({ age: 35.5 }).limit === 24 && calc({ age: 35.5 }).endsAt <= 60, calc({ age: 35.5 }).limit);
}

/* ---- الحالات ---- */
{
    t('بلا راتب: empty', calc({ salary: 0 }).status === 'empty');
    t('بلا عمر: empty', calc({ age: 0 }).status === 'empty');
    const ready = calc({ price: 0, down: 0 });
    t('بلا سعر: ready وأقصى تمويل محسوب', ready.status === 'ready' && ready.maxFinance > 0 && ready.installment === 0, ready.status);
    const covered = calc({ down: 1000000 });
    t('الدفعة تغطي السعر: covered بلا قسط ولا جدول', covered.status === 'covered' && covered.installment === 0 && covered.schedule.length === 0);
    const over = calc({ down: 2500000 });
    t('دفعة فوق السعر تُقصّ إلى السعر', over.down === 1000000 && over.needed === 0 && over.status === 'covered');

    const m = calc({ price: 0, down: 0 }).maxFinance;
    const edge = calc({ price: Math.floor(m), down: 0 });
    t('السعر = أقصى تمويل: fits', edge.status === 'fits', [edge.status, edge.needed, m]);
    const over1 = calc({ price: Math.floor(m) + 1000, down: 0 });
    t('فوق أقصى تمويل بألف: short والنقص ألف تقريباً', over1.status === 'short' && near(over1.gap, 1000, 1), [over1.status, over1.gap]);
}

/* ---- الاقتراحات والدفعة الأولى والرسوم ---- */
{
    const r = calc({});
    t('أعلى سعر بدفعة 100,000: تحدده أقل دفعة 10% لا القدرة', near(r.affordablePrice, 1000000), r.affordablePrice);
    const big = calc({ down: 300000 });
    t('بدفعة 300,000: تحدده القدرة (أقصى تمويل + الدفعة)', near(big.affordablePrice, big.maxFinance + 300000, 1e-6), big.affordablePrice);
    const noDown = calc({ down: 0, price: 0 });
    t('بلا دفعة: لا أعلى سعر مقترح', noDown.affordablePrice === 0);
    const far = calc({ price: 1500000 });
    t('الدفعة اللازمة لسعر 1.5 مليون = السعر − أقصى تمويل', near(far.downNeeded, 1500000 - far.maxFinance, 1e-6), far.downNeeded);
    const pNear = Math.round(calc({ price: 0, down: 0 }).maxFinance + 50000);
    const near1 = calc({ price: pNear });
    t('الدفعة اللازمة لا تقل عن أقل نسبة (10%)', near(near1.downNeeded, pNear * 0.1, 1e-6), near1.downNeeded);
    t('دفعة 5% مع حد 10%: downShort', calc({ down: 50000 }).downShort === true);
    t('دفعة 10% مع حد 10%: لا downShort', calc({ down: 100000 }).downShort === false);
    t('الرسوم الإدارية بسقف 5,000', calc({ price: 1100000, down: 100000 }).fee === 5000);
    t('الرسوم الإدارية 1% تحت السقف', calc({ price: 300000, down: 100000 }).fee === 2000);
    const zero = calc({ rate: 0 });
    t('بلا ربح: القسط = المبلغ ÷ الأشهر والأرباح صفر', near(zero.installment, 900000 / 300, 1e-9) && zero.profit === 0, [zero.installment, zero.profit]);
}

/* ---- مدخلات نصية وتالفة ---- */
{
    const s = calc({ salary: '12000', age: '35', price: '1000000', down: '100000' });
    const n = calc({});
    t('أرقام نصية = أرقام', s.status === n.status && near(s.installment, n.installment, 1e-9) && near(s.maxFinance, n.maxFinance, 1e-9));
    const junk = [null, undefined, '', 'abc', -5, 1e12, NaN, Infinity, -Infinity, 0];
    const keys = Object.keys(base);
    let bad = null;
    for (const key of keys) {
        for (const v of junk) {
            const r = calc({ [key]: v });
            for (const [k, x] of Object.entries(r)) {
                if (typeof x === 'number' && !Number.isFinite(x)) bad = bad || [key, String(v), k, x];
            }
            if (r.schedule.some((row) => !Number.isFinite(row.capital) || !Number.isFinite(row.interest) || !Number.isFinite(row.balance))) bad = bad || [key, String(v), 'schedule'];
        }
    }
    t('مدخلات تالفة في أي حقل: كل الأرقام منتهية (لا NaN ولا Infinity)', bad === null, bad);
    const allJunk = computeMortgage({});
    t('كائن فارغ: empty بلا استثناء', allJunk.status === 'empty');
}

/* ---- مطابقة حاسبة «عون» (own.sa) في 2026-10-29: موظف حكومي، صافي 12,000، بلا التزامات، مسكن أول جاهز، 25 سنة ---- */
{
    const a = calc({ price: 1000000, down: 100000 });
    t('عون: تمويل 900,000 قسطه 6,189', Math.abs(a.installment - 6189) <= 1.5, a.installment);
    const b = calc({ price: 2000000, down: 200000 });
    t('عون: أقصى تمويل 959,686 بقسط 6,600', Math.abs(b.maxFinance - 959686) <= 100 && near(b.room, 6600), [b.maxFinance, b.room]);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
