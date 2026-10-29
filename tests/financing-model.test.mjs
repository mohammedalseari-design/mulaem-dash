// اختبار «جهات التمويل» (crm/js/financing-model.js): قراءة الإعداد بحذر، وحال كل جهة، والاعتماد والتجاهل.
// التشغيل: node tests/financing-model.test.mjs   أو   deno run tests/financing-model.test.mjs
import {
    DEFAULT_ENTITIES, STALE_DAYS, cleanEntities, cleanProposals, entityStatus, applyRate, dismissRate, upsertEntity,
    removeEntity, newEntityId, termsOf, hostOf
} from '../crm/js/financing-model.js';
import { TERMS, computeMortgage } from '../crm/js/mortgage-calc.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const NOW = new Date('2026-10-29T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

/* ---- قراءة الإعداد ---- */
{
    const d = cleanEntities(undefined);
    t('بلا مفتاح: الجهة الافتراضية «متوسط حاسبة عون» بنسبة الحاسبة', d.length === 1 && d[0].id === 'own-avg' && d[0].rate === TERMS.rate);
    d[0].rate = 1;
    t('الافتراضي نسخة لا تُعدَّل من الخارج', DEFAULT_ENTITIES[0].rate === TERMS.rate);
    t('قائمة فارغة محفوظة تبقى فارغة', cleanEntities([]).length === 0);
    const list = cleanEntities([
        { id: 'a', name: 'مصرف أ', url: 'https://a.example/p', rate: '6.5', cap: 65 },
        { id: 'a', name: 'مكرر' },
        { id: 'b', name: '' },
        null, 'x',
        { id: 'c', name: 'جهة ج', url: 'http://c.example', rate: 99, cap: 500, endAge: 10, maxYears: 0, minDownPct: -1 }
    ]);
    t('تسقط الجهة المكررة والتي بلا اسم والقيم غير الكائنات', list.map((e) => e.id).join() === 'a,c', list.map((e) => e.id));
    t('الأرقام النصية تُقرأ', list[0].rate === 6.5 && list[0].cap === 65);
    t('رابط غير https لا يُقبل', list[1].url === null);
    t('نسبة خارج الحد تصير فارغة، والشروط خارج الحد تعود إلى افتراض الحاسبة',
        list[1].rate === null && list[1].cap === TERMS.cap && list[1].endAge === TERMS.endAge && list[1].maxYears === TERMS.maxYears && list[1].minDownPct === TERMS.minDownPct, list[1]);
    const p = cleanProposals({ a: { checkedAt: daysAgo(1), url: 'https://a.example/p', rate: 7.75, quote: 'معدل نسبة سنوي يبدأ من 7.75%' }, bad: { url: 'x' }, c: { checkedAt: daysAgo(2), candidates: [{ rate: 6.5, quote: 'q' }, { rate: 'x' }, null] } });
    t('اقتراح بلا تاريخ فحص يسقط', Object.keys(p).join() === 'a,c', Object.keys(p));
    t('المرشحات غير الصالحة تسقط', p.c.candidates.length === 1 && p.c.rate === null);
    t('إعداد اقتراحات تالف: لا شيء', Object.keys(cleanProposals([1])).length === 0 && Object.keys(cleanProposals(null)).length === 0);
}

/* ---- حال الجهة ---- */
{
    const e = { id: 'a', rate: 6.5, confirmedAt: daysAgo(3), dismissedRate: null };
    let st = entityStatus(e, undefined, NOW);
    t('مؤكدة قبل 3 أيام: حديثة بلا قرار ينتظر', st.stale === false && st.daysOld === 3 && st.pending === null, st);
    st = entityStatus({ ...e, confirmedAt: daysAgo(STALE_DAYS + 1) }, undefined, NOW);
    t('مؤكدة قبل أكثر من شهر: قديمة', st.stale === true);
    st = entityStatus({ ...e, confirmedAt: daysAgo(60) }, { checkedAt: daysAgo(2), rate: 6.5, candidates: [], error: '' }, NOW);
    t('قراءة المساعد للرقم نفسه تُعدّ تأكيداً', st.sameRate === true && st.stale === false && st.daysOld === 2 && st.pending === null && st.lastBy === 'agent', st);
    st = entityStatus({ ...e, confirmedAt: daysAgo(0) }, { checkedAt: daysAgo(1), rate: 6.5, candidates: [], error: '' }, NOW);
    t('اعتماد المدير بعد قراءة المساعد: التاريخ والفاعل للمدير', st.lastBy === 'admin' && st.daysOld === 0, st);
    st = entityStatus(e, { checkedAt: daysAgo(1), rate: 7.75, candidates: [], error: '' }, NOW);
    t('رقم مختلف من المساعد: ينتظر الاعتماد', st.pending === 'rate');
    st = entityStatus({ ...e, dismissedRate: 7.75 }, { checkedAt: daysAgo(1), rate: 7.75, candidates: [], error: '' }, NOW);
    t('اقتراح تجاهله المدير لا يعود', st.pending === null);
    st = entityStatus(e, { checkedAt: daysAgo(1), rate: null, candidates: [{ rate: 6.5, quote: 'a' }, { rate: 7.1, quote: 'b' }], error: '' }, NOW);
    t('أكثر من نسبة: الاختيار للمدير', st.pending === 'choose');
    st = entityStatus(e, { checkedAt: daysAgo(1), rate: null, candidates: [], error: 'لا يسمح الموقع' }, NOW);
    t('تعذّر القراءة يظهر سبباً', st.pending === 'error');
    st = entityStatus({ id: 'n', rate: null, confirmedAt: null }, undefined, NOW);
    t('جهة بلا نسبة: قديمة دائماً', st.stale === true && st.lastAt === null);
}

/* ---- الاعتماد والتعديل ---- */
{
    const list = [{ id: 'a', name: 'أ', rate: 6.5, quote: '', confirmedAt: daysAgo(40), dismissedRate: 7 }, { id: 'b', name: 'ب', rate: null }];
    const a2 = applyRate(list, 'a', 7.75, 'معدل نسبة سنوي يبدأ من 7.75%', '2026-10-29');
    t('الاعتماد يكتب النسبة والجملة وتاريخ اليوم ويمسح التجاهل',
        a2[0].rate === 7.75 && a2[0].confirmedAt === '2026-10-29' && a2[0].dismissedRate === null && a2[0].quote.includes('7.75'), a2[0]);
    t('الاعتماد لا يمس الجهات الأخرى ولا القائمة الأصلية', a2[1] === list[1] && list[0].rate === 6.5);
    t('التجاهل يحفظ الرقم المتجاهَل', dismissRate(list, 'b', 8.1)[1].dismissedRate === 8.1);
    t('إضافة جهة ثم استبدالها', upsertEntity(list, { id: 'c', name: 'ج' }).length === 3 && upsertEntity(list, { id: 'a', name: 'أأ' })[0].name === 'أأ');
    t('الحذف', removeEntity(list, 'a').map((e) => e.id).join() === 'b');
    const id1 = newEntityId([], 1000);
    t('معرّف جديد لا يتكرر', newEntityId([{ id: id1 }], 1000) !== id1);
    t('اسم الموقع من الرابط', hostOf('https://www.alrajhibank.com.sa/Personal/x') === 'alrajhibank.com.sa' && hostOf('x') === '');
}

/* ---- الحاسبة بشروط جهة ---- */
{
    const own = cleanEntities(undefined)[0];
    const base = { salary: 12000, obligations: 0, age: 35, price: 1000000, down: 100000, years: 0, feePct: 1, feeCap: 5000 };
    const a = computeMortgage({ ...base, ...TERMS });
    const b = computeMortgage({ ...base, ...termsOf(own) });
    t('شروط الجهة الافتراضية = شروط الحاسبة', Math.abs(a.installment - b.installment) < 1e-9 && a.maxFinance === b.maxFinance);
    const bank = computeMortgage({ ...base, ...termsOf({ rate: 7.75, cap: 55, endAge: 60, maxYears: 25, minDownPct: 10 }) });
    t('نسبة أعلى: قسط أعلى وأقصى تمويل أقل', bank.installment > a.installment && bank.maxFinance < a.maxFinance);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
