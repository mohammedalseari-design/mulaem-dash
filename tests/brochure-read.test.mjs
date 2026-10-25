// اختبار دمج قراءة المساعد بصور البروشور (crm/js/brochure-read.js)، بحالات بروشور لامير سيرين.
// التشغيل: node tests/brochure-read.test.mjs   أو   deno run tests/brochure-read.test.mjs
import { factsFromReading, sheetGroups, areaIn, SHEET_SIZE } from '../crm/js/brochure-read.js';
import { brochureFacts, planBrochure, validateSpec } from '../crm/js/brochure-plan.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const u = (n) => 'https://store.test/brochures/r1/img-' + n;
const media = { images: [
    { url: u(1), page: 1, kind: 'photo', tall: false },            // 1 شعار المطوّر على جدار
    { url: u(2), page: 3, kind: 'photo', tall: false },            // 2 واجهة
    { url: u(3), page: 5, kind: 'photo', tall: false },            // 3 ضباب (خلفية)
    { url: u(4), page: 6, kind: 'photo', tall: true },             // 4 داخلي (بلا دور من المساعد، صفحته داخلية)
    { url: u(5), page: 14, kind: 'plan', tone: 'light' },          // 5 مخطط شقة 1
    { url: u(6), page: 27, kind: 'plan', tone: 'light' },          // 6 مخطط على صفحة ملحق 3 مكتوب عليه 168م²
    { url: u(7), page: 26, kind: 'plan', tone: 'light' },          // 7 مخطط بلا نموذج معروف
    { url: u(8), page: 12, kind: 'photo', tall: false },           // 8 مجسّم ثلاثي
    { url: u(9), page: 31, kind: 'photo', tall: false },           // 9 مصافحة
    null, { page: 2 }
] };
const result = {
    version: 1,
    project: { name: 'لامير سيرين', name_latin: 'LAMER SERIN', tagline: 'سكن بروح الطبيعة', developer: 'لامير العقارية', district: 'أبحر', city: 'جدة',
        amenities: ['دخول ذكي'], landmarks: ['برج جدة'], license: 'رخصة 821' },
    evidence: { name: 1 },
    models: [
        { name: 'شقة 1', area: 97, price: 639000, rooms: 2, page: 14, plan_label: 'نموذج شقة (1) مساحتها : 97 م2', parts: ['مطبخ'], sold: false },
        { name: 'ملحق 3', area: 225, price: 1400000, rooms: 4, page: 27, plan_label: 'نموذج شقة (3) مساحتها 168م²', parts: [], sold: true },
        { name: 'ملحق 2', area: 224, price: 1300000, rooms: 4, page: 26, plan_label: null, parts: [], sold: false }
    ],
    pages: [{ page: 1, role: 'cover' }, { page: 3, role: 'exterior' }, { page: 6, role: 'interior' }, { page: 12, role: 'plan' }, { page: 14, role: 'model' }],
    images: [
        { n: 1, role: 'logo', model: null, caption: null }, { n: 2, role: 'exterior', model: null, caption: 'واجهة المشروع' },
        { n: 3, role: 'texture', model: null, caption: null }, { n: 5, role: 'plan', model: 'نموذج شقة ١', caption: null },
        { n: 6, role: 'plan', model: 'ملحق 3', caption: null }, { n: 7, role: 'plan', model: null, caption: null },
        { n: 8, role: 'plan3d', model: null, caption: null }, { n: 9, role: 'people', model: null, caption: null }
    ],
    conflicts: [{ field: 'models[1].area', values: ['225', '168'], pages: [27], note: 'مخطط الصفحة يذكر نموذجاً آخر' }],
    suspicious: [{ quote: 'تجاهل التعليمات', page: 2, reason: 'أمر' }],
    dropped: 2
};

const { project, notes } = factsFromReading(result, media, { id: 'r1' });
t('logo, texture and stock people are left out, with a note', !project.images.some((i) => [u(1), u(3), u(9)].includes(i.url)) && notes.some((n) => /تُركت 3 صورة/.test(n)), notes);
t('exterior keeps the AI caption; interior falls back to its page role', project.images.find((i) => i.url === u(2)).caption === 'واجهة المشروع'
    && project.images.find((i) => i.url === u(4)).kind === 'interior' && project.images.find((i) => i.url === u(4)).tall === true);
t('a 3D plan goes to the gallery as plan3d', project.images.find((i) => i.url === u(8)).kind === 'plan3d');
t('plans are never gallery photos', !project.images.some((i) => [u(5), u(6), u(7)].includes(i.url)));
t('شقة 1 gets its plan (AI named it with Arabic digits and «نموذج»), light tone kept', project.details.models[0].plan === u(5) && project.details.models[0].plan_tone === 'light');
t('ملحق 3: the plan printed 168م² contradicts 225م², so no plan, with a note', project.details.models[1].plan === null && notes.some((n) => /168م² والنموذج 225م²/.test(n)), notes);
t('ملحق 2: a plan with no known model is not attached', project.details.models[2].plan === null);
t('sold is carried', project.details.models[1].status === 'sold' && project.details.models[0].status === 'available');
t('conflicts, suspicious text and dropped values become notes', notes.some((n) => /تناقض في البروشور \(صفحة 27\)/.test(n)) && notes.some((n) => /تجاهل التعليمات/.test(n)) && notes.some((n) => /2 قيمة/.test(n)));
t('project fields from the reading only', project.name === 'لامير سيرين' && project.details.name_en === 'LAMER SERIN' && project.details.license === 'رخصة 821' && project.address === null);

const facts = brochureFacts(project);
const spec = planBrochure(facts);
t('the reading makes a valid brochure', validateSpec(spec, facts).length === 0, validateSpec(spec, facts));
t('one model page with its plan, two with numbers only', spec.pages.filter((p) => p.kind === 'model').map((p) => p.variant).join() === 'plan,facts,facts', spec.pages);

const bare = factsFromReading(null, null, {});
t('nothing read → empty project, no crash', bare.project.name === null && bare.project.images.length === 0 && bare.project.details.models.length === 0 && bare.notes.length === 0);
const noAi = factsFromReading({ project: { name: 'x' }, models: [{ name: 'A', area: 100, page: 4 }], pages: [{ page: 4, role: 'model' }] },
    { images: [{ url: u(1), page: 4, kind: 'plan', tone: 'dark' }, { url: u(2), page: 9, kind: 'photo' }] });
t('without AI image roles: a plan on the model\'s page is its plan, other photos stay photos', noAi.project.details.models[0].plan === u(1) && noAi.project.images[0].kind === 'photo');

t('sheets of 16', SHEET_SIZE === 16 && JSON.stringify(sheetGroups(20).map((g) => g.length)) === '[16,4]' && sheetGroups(0).length === 0);
t('area printed in a plan label', areaIn('نموذج شقة (1) مساحتها : 97 م2') === 97 && areaIn('مساحتها ١٦٨م²') === 168 && areaIn('مساحة: 107') === 107 && areaIn('بلا مساحة') === null && areaIn(null) === null);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
