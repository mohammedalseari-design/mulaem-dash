// اختبار جمع منشورات واتساب المتشابهة قبل الإرسال للمساعد (crm/js/whatsapp-twins.js).
// التشغيل: node tests/whatsapp-twins.test.mjs   أو   deno run tests/whatsapp-twins.test.mjs
import { shapeOf, similar, twinGroups } from '../crm/js/whatsapp-twins.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const base = `🔥 زود النزهه 103 🔥
شقق تمليك في حي النزهه
4 غرف وصالة ومجلس ومطبخ راكب
المساحة 165 م
السعر 850 ألف شامل الضريبة
التسليم فوري — صك إلكتروني`;

const same = (a, b) => similar(shapeOf(a), shapeOf(b));

t('phone numbers are not offer numbers', [...shapeOf('للتواصل 0551234567 أو +966 55 123 4567 أو ٠٥٥١٢٣٤٥٦٧ السعر 850').numbers].join() === '850',
  [...shapeOf('للتواصل 0551234567 أو +966 55 123 4567 أو ٠٥٥١٢٣٤٥٦٧ السعر 850').numbers]);
t('a long price is not eaten as a phone', shapeOf('السعر 350000000 ريال للعمارة كاملة في حي الروضة').numbers.has('350000000'));
t('the same post with an extra line and another phone', same(base, base + '\nللتواصل: 0551234567'));
t('the same post with emoji and spacing changed', same(base, base.replace(/🔥/g, '✨').replace(/\n/g, '\n\n')));
t('Arabic digits = Latin digits', same(base, base.replace('850', '٨٥٠').replace('165', '١٦٥')));
t('one copy drops the price line', same(base, base.replace('\nالسعر 850 ألف شامل الضريبة', '')));
t('another price is another offer', !same(base, base.replace('850', '750')));
t('another project number is another offer', !same(base, base.replace('103', '104')));
t('another area is another offer', !same(base, base.replace('165', '140')));
const template = 'للبيع فيلا درج داخلي وشقة في حي السامر بجدة واجهة شمالية شارع عشرين للتواصل خاص';
t('broker template in another district, no numbers: different', !same(template, template.replace('السامر', 'النعيم')));
t('no shared number: never merged (exact copies are merged by the page already)', !same(template, template + ' 🌹'));
const priced = 'فيلا للبيع في حي السامر مساحة 300 متر السعر 2500 ألف درج داخلي وملحق واجهة شمالية للتواصل خاص';
t('same price and area in another district: different', !same(priced, priced.replace('السامر', 'النعيم')));
t('«حي السامر» = «بحي سامر»', same(priced, priced.replace('في حي السامر', 'بحي سامر') + ' 🌹'));
t('district named on one side only: still the same', same(priced, priced.replace('في حي السامر ', '')));
t('too short to judge', !same('شقة للبيع 850', 'شقة للبيع 850'));
t('unrelated posts', !same(base, 'مطلوب أرض في شمال جدة مساحة 600 متر للبناء السكني والدفع كاش للتواصل'));

const items = [
    { id: 'a', text: base, at: 3 },
    { id: 'b', text: 'مطلوب أرض في شمال جدة مساحة 600 متر للبناء السكني والدفع كاش للتواصل', at: 5 },
    { id: 'c', text: base + '\nللتواصل: 0551234567', at: 9 },
    { id: 'd', text: base.replace('\nالسعر 850 ألف شامل الضريبة', ''), at: 1 },
    { id: 'e', text: base.replace('850', '750').replace('\nالسعر', '\nالسعر'), at: 7 }
];
const groups = twinGroups(items, (i) => i.text, (x, y) => x.at > y.at);
const shape = groups.map((g) => g.main.id + (g.others.length ? '<' + g.others.map((o) => o.id).join('') : '')).join(' | ');
// d (بلا سعر) يشبه a و c و e كلاً على حدة، لكن e سعرها آخر: الربط الكامل يُبقي e وحدها، و d تدخل مجموعة a أولاً
t('groups: newest leads, order of first member kept, complete linkage', shape === 'c<ad | b | e', shape);
t('groups: nothing in, nothing out', twinGroups([], (i) => i, () => false).length === 0 && twinGroups(null, (i) => i, () => false).length === 0);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
