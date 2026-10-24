// اختبار «قد يكون تحديثاً لـ#N» في صفحة واتساب (crm/js/project-match.js)، بحالات من مراجعة مسار المساعد 2026-10-24.
// التشغيل: node tests/project-match.test.mjs   أو   deno run tests/project-match.test.mjs
import { prepareProjects, suggestProjects } from '../crm/js/project-match.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const projects = prepareProjects([
    { id: 504, name: 'زود الربوة 102', district: 'الربوة' },
    { id: 505, name: 'زود النزهة 103', district: 'النزهة' },
    { id: 510, name: 'نجل الفخامة الصفا 116', district: 'الصفا' },
    { id: 512, name: 'الصفا ترف 105', district: 'الصفا' },
    { id: 598, name: 'خزامى هومز 122', district: 'السامر' },
    { id: 599, name: 'أوس 102', district: 'الصفا' },
    { id: 600, name: 'مشروع 105', district: 'النعيم' },
    { id: 601, name: 'فيلا – حي السامر – 650م', district: 'السامر' },
    { id: 12, name: 'برج 12', district: 'الحمراء' },
    { id: 40, name: 'مجمع 12', district: 'النعيم' },
    { id: 0, name: '' }, null
]);
const ids = (text) => suggestProjects(text, projects).map((s) => s.id).join(',');
const top = (text) => suggestProjects(text, projects)[0] || {};

t('prepare: empty and broken rows dropped, filler and digits out of the words', projects.length === 10
  && projects.find((p) => p.id === '504').words.join() === 'زود,ربوه' && projects.find((p) => p.id === '504').codes.join() === '102'
  && projects.find((p) => p.id === '601').words.join() === 'سامر', projects.find((p) => p.id === '601'));

t('«أوس 102» → #599 first, strong; #504 (102 only) not suggested', ids('🔥 أوس 102 🔥 شقق تمليك 4 غرف السعر 690 ألف') === '599' && top('أوس 102 شقق').strong === true,
  suggestProjects('🔥 أوس 102 🔥 شقق تمليك 4 غرف السعر 690 ألف', projects));
t('«زود 102» → #504 (the report: became a new draft)', ids('زود 102 جاهز للسكن شقق 5 غرف') === '504' && top('زود 102 جاهز').strong === false,
  suggestProjects('زود 102 جاهز للسكن شقق 5 غرف', projects));
t('«مشروع الربوة ١٠٢» (Arabic digits) → #504', ids('مشروع الربوة ١٠٢ شقق تمليك بحي الربوة') === '504', suggestProjects('مشروع الربوة ١٠٢ شقق تمليك بحي الربوة', projects));
t('«ترف 105» → #512, not «مشروع 105»', ids('ترف 105 شقق فاخرة') === '512', suggestProjects('ترف 105 شقق فاخرة', projects));
t('«خزامى هومز» without its number → #598 by the whole name', ids('خزامي هومز فلل دوبلكس بحي السامر') === '598', suggestProjects('خزامي هومز فلل دوبلكس بحي السامر', projects));
t('«نجل الفخامة الصفا 116» → #510 strong', top('نجل الفخامة الصفا 116 آخر شقتين').id === '510' && top('نجل الفخامة الصفا 116 آخر شقتين').strong);
t('a number-only name needs its district: «مشروع 105 في النعيم» → #600', ids('مشروع 105 في حي النعيم 3 غرف') === '600');
t('… and «105» alone suggests nothing', ids('شقة 105 م للبيع 3 غرف') === '');
t('a developer word alone suggests nothing («زود» is in all its projects)', ids('زود للتطوير العقاري عروض جديدة') === '');
t('a descriptive name is not matched by a generic villa post', ids('فيلا للبيع في حي السامر درج داخلي') === '');
t('«برج 12» and «مجمع 12»: both shown when only the number and no district fit', ids('عمارة 12 دور للبيع') === '');
t('«برج 12 الحمراء» → #12 by number and district', ids('برج 12 بحي الحمراء مكاتب') === '12');
t('the phone number is not a project number', ids('للتواصل 0551161105 فلل للبيع') === '' && ids('للتواصل +966 55 116 1105 ترف') === '');
// #504: الرقم والاسم كله والحي (7)، #599: الرقم والاسم كله بلا حيّه (6)
t('order: strongest first; limit cuts', ids('أوس 102 زود الربوة 102 بحي الربوة') === '504,599'
  && suggestProjects('أوس 102 زود الربوة 102 بحي الربوة', projects, 1).map((s) => s.id).join() === '504',
  suggestProjects('أوس 102 زود الربوة 102 بحي الربوة', projects));
t('nothing in, nothing out', suggestProjects('', projects).length === 0 && suggestProjects('أوس 102', []).length === 0 && suggestProjects('أوس 102', null).length === 0);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
