// حساب التمويل العقاري: دوال صافية بلا DOM، تستعملها صفحة الحاسبة (mortgage.js) واختبارها (tests/mortgage-calc.test.mjs).
//
// النموذج: قسط شهري ثابت على الرصيد المتناقص بنسبة ربح سنوية (الشهري = السنوية ÷ 12).
// ما لا يحسبه: الدعم السكني، وعروض بنك بعينه، وانتهاء الالتزامات الحالية قبل آخر المدة.
// كل ناتج تقدير؛ العرض النهائي من جهة التمويل.

// شروط التمويل الافتراضية، والفعلي من عرض البنك. معايَرة على حاسبة «عون» المرخصة (own.sa) في 2026-10-29:
// موظف حكومي، صافي 12,000، مسكن أول جاهز، 25 سنة: تمويل 900,000 بقسط 6,189، وأقصى تمويل 959,686 بقسط 6,600
// (55% من الصافي). القسطان يطابقان ربحاً متناقصاً 6.7% سنوياً، وأقل دفعة 10% وأقصى مدة 25 سنة كما عندهم.
// الرسوم الإدارية: سقف 1% من مبلغ التمويل أو 5,000 ريال أيهما أقل
// (قواعد البنك المركزي السعودي، المادة 9 «رسوم وعمولات»: rulebook.sama.gov.sa/en/node/5504).
export const TERMS = Object.freeze({
    rate: 6.7, cap: 55, endAge: 60, maxYears: 25, minDownPct: 10, feePct: 1, feeCap: 5000
});

// رقم موجب أو صفر: يقبل نصاً رقمياً، ويحوّل الفارغ وغير الرقمي والسالب إلى صفر
const pos = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
};

// القسط الشهري الثابت لأصل على عدد أشهر بربح شهري r (صفر يعني بلا ربح)
export function payment(principal, monthlyRate, months) {
    if (!(principal > 0) || !(months > 0)) return 0;
    if (!(monthlyRate > 0)) return principal / months;
    return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}

// عكس payment: أكبر أصل يسدده قسط شهري ثابت على عدد أشهر
export function principalFor(installment, monthlyRate, months) {
    if (!(installment > 0) || !(months > 0)) return 0;
    if (!(monthlyRate > 0)) return installment * months;
    return installment * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
}

// الرصيد سنة بسنة: المسدد من الأصل والأرباح والمتبقي آخر السنة
export function yearlySchedule(principal, monthlyRate, months, installment) {
    const rows = [];
    let balance = principal;
    for (let m = 1; m <= months; m++) {
        const interest = balance * monthlyRate;
        const capital = Math.min(balance, Math.max(0, installment - interest));
        balance -= capital;
        const y = Math.ceil(m / 12);
        const row = rows[y - 1] || (rows[y - 1] = { year: y, capital: 0, interest: 0, balance: 0 });
        row.capital += capital;
        row.interest += interest;
        row.balance = balance;
    }
    return rows;
}

// الحالات: empty (ينقص الراتب أو العمر) | no-term (لا مدة متاحة) | ready (السعر غير مكتوب)
//          covered (الدفعة تغطي السعر) | fits (ضمن القدرة) | short (فوق القدرة)
export function computeMortgage(input) {
    const salary = pos(input.salary);
    const obligations = pos(input.obligations);
    const age = pos(input.age);
    const price = pos(input.price);
    const downRaw = pos(input.down);
    const down = Math.min(price, downRaw);
    const rate = pos(input.rate);
    const cap = Math.min(100, pos(input.cap));
    const endAge = pos(input.endAge);
    const maxYears = Math.floor(pos(input.maxYears));
    const minDownPct = pos(input.minDownPct);
    const feePct = pos(input.feePct);
    const feeCap = pos(input.feeCap);

    // المدة: ما طلبه المدير (الفارغ يعني الأقصى)، بحد أقصى مدة البنك وبحيث ينتهي السداد قبل آخر عمر
    const limit = Math.max(0, Math.min(maxYears, Math.floor(endAge - age)));
    const wanted = Math.floor(pos(input.years));
    const years = wanted > 0 ? Math.min(wanted, limit) : limit;
    const months = years * 12;
    const r = rate / 100 / 12;

    const room = Math.max(0, salary * cap / 100 - obligations);   // أعلى قسط يسمح به حد الاستقطاع
    const maxFinance = principalFor(room, r, months);
    const needed = Math.max(0, price - down);
    const installment = payment(needed, r, months);
    const totalPaid = installment * months;
    const minDown = price * minDownPct / 100;

    let status;
    if (salary <= 0 || age <= 0) status = 'empty';
    else if (months <= 0) status = 'no-term';
    else if (price <= 0) status = 'ready';
    else if (needed <= 0) status = 'covered';
    else if (Math.round(needed) <= Math.round(maxFinance)) status = 'fits';
    else status = 'short';

    return {
        status, salary, obligations, age, price, down, downRaw, rate, cap, endAge, maxYears, minDownPct, feePct, feeCap,
        limit, years, months, clamped: wanted > years,
        room, maxFinance, needed, installment, totalPaid,
        profit: Math.max(0, totalPaid - needed),
        dbr: salary > 0 ? (installment + obligations) / salary * 100 : 0,
        gap: needed - maxFinance,
        fee: Math.min(needed * feePct / 100, feeCap),
        minDown,
        downPct: price > 0 ? down / price * 100 : 0,
        downShort: price > 0 && down < minDown - 0.5,
        // أعلى سعر يناسب الدفعة المكتوبة: لا يزيد على قدرة التمويل ولا على ما تسمح به أقل دفعة أولى
        affordablePrice: downRaw > 0 ? Math.min(maxFinance + downRaw, minDownPct > 0 ? downRaw / (minDownPct / 100) : Infinity) : 0,
        downNeeded: price > 0 ? Math.max(price - maxFinance, minDown) : 0,
        endsAt: age + years,
        schedule: months > 0 && needed > 0 ? yearlySchedule(needed, r, months, installment) : []
    };
}
