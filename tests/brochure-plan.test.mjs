// اختبار حقائق البروشور والتحقق من مخطط الصفحات (crm/js/brochure-plan.js): الحقائق من البيانات فقط، والمخطط فهارس موجودة.
// التشغيل: node tests/brochure-plan.test.mjs   أو   deno run tests/brochure-plan.test.mjs
import { brochureFacts, validateSpec, MAX_MODELS, MAX_PAGES } from '../crm/js/brochure-plan.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const u = (n) => 'https://cdn.test/p/' + n + '.jpg';
const base = {
    id: 701, name: 'لامير سيرين', type: 'شقة', purpose: 'sale', city: 'جدة', district: 'أبحر', price: 639000,
    images: [
        { url: u(1), kind: 'exterior' }, { url: u(2), kind: 'exterior' }, { url: u(3), kind: 'exterior', caption: 'واجهة المشروع' },
        { url: u(4), kind: 'interior', tall: true }, { url: u(5), kind: 'interior', tall: true }, { url: u(6), kind: 'interior', tall: true },
        { url: u(7), kind: 'interior', tall: true }, { url: u(8), kind: 'interior', tall: true }, { url: u(9), kind: 'aerial' },
        { url: u(10), kind: 'plan3d' }, { url: 'http://insecure.test/x.jpg', kind: 'exterior' }, { url: u(1), kind: 'interior' }, 'javascript:alert(1)'
    ],
    availability: 'available',
    details: {
        developer: 'لامير العقارية', name_en: 'LAMER SERIN', tagline: 'سكن بروح الطبيعة', description: 'وصف قصير.',
        landmarks: ['برج جدة', { x: 1 }, ''], amenities: ['دخول ذكي', 'مواقف خاصة'], contact_phone: '0551234567',
        models: [
            { name: 'شقة 1', orientation: 'داخلية شمالي', rooms: 2, bathrooms: 2, area: 97, price: 639000, plan: u('plan1'), plan_tone: 'light', parts: ['غرفة نوم ماستر', 'مطبخ'] },
            { name: 'شقة 2', rooms: '٣', area: '107', price: '٦٨٩٬٠٠٠', plan: 'http://insecure.test/plan.png' },
            { name: 'ملحق 2', rooms: 4, area: 224, price: 1300000, status: 'sold' },
            null, { note: 'سطر بلا اسم ولا مساحة ولا سعر' }
        ]
    }
};

const f = brochureFacts(base, { whatsapp: '966551234567' });
t('images: https only, no duplicates, kinds kept', f.images.length === 10 && f.images[2].caption === 'واجهة المشروع' && f.images[3].tall === true && f.images[9].kind === 'plan3d', f.images.map((i) => i.kind));
t('a plain URL (inventory image) is a photo of unknown kind', brochureFacts({ images: [u(1)] }).images[0].kind === 'photo');
t('models: kept in order (pages point at them by index), Arabic digits read, insecure plan dropped', f.models.length === 4 && f.models[1].price === 689000 && f.models[1].rooms === 3 && f.models[1].plan === null && f.models[0].planTone === 'light', f.models);
t('price: lowest unsold; the sold annex is not counted', f.price === 639000 && f.priceFrom === true);
t('area range from the units', JSON.stringify(f.areaRange) === '[97,224]');
t('lists keep text only', f.landmarks.join() === 'برج جدة' && f.amenities.length === 2);
t('nothing the record does not hold: no developer phone', !('contact_phone' in f) && f.office.whatsapp === '966551234567');
t('models capped', brochureFacts({ details: { models: Array.from({ length: 50 }, (_, i) => ({ name: 'N' + i, area: 100 + i })) } }).models.length === MAX_MODELS);
t('empty record → empty facts, no crash', brochureFacts(null).name === null && brochureFacts({ details: 'x' }).models.length === 0);

const cover = { kind: 'cover', variant: 'side', images: [0] };
t('validate: a page-by-page plan with its own texts is valid', validateSpec({ pages: [cover, { kind: 'about', variant: 'split', images: [3], text: { title: 'عن المشروع', body: 'وصف.', bullets: [] }, stats: true },
  { kind: 'trio', variant: 'panels', images: [3, 4, 5] }, { kind: 'model', variant: 'plan', model: 0 }, { kind: 'model', variant: 'facts', model: 3 }, { kind: 'back', variant: 'brand' }] }, f).length === 0);
t('validate: a features page needs its own list or the project amenities', validateSpec({ pages: [cover, { kind: 'features', variant: 'list', text: { bullets: ['دخول ذكي'] } }] }, brochureFacts({ images: [u(1)] })).length === 0
  && validateSpec({ pages: [cover, { kind: 'features', variant: 'list', text: { bullets: [] } }] }, brochureFacts({ images: [u(1)] })).length === 1);
t('validate: at most MAX_PAGES pages', validateSpec({ pages: Array.from({ length: MAX_PAGES + 1 }, () => cover) }, f).length === 1
  && validateSpec({ pages: Array.from({ length: MAX_PAGES }, () => cover) }, f).length === 0);
t('validate: a model page pointing at a missing model or a plan it does not have', validateSpec({ pages: [cover, { kind: 'model', variant: 'plan', model: 1 }, { kind: 'model', variant: 'facts', model: 9 }] }, f).length === 2);
t('validate: missing image, unknown kind, no cover first', validateSpec({ pages: [{ kind: 'trio', variant: 'panels', images: [0, 1, 40] }, { kind: 'poster', variant: 'x' }] }, f).length >= 3);
t('validate: garbage', validateSpec(null, f).length === 1 && validateSpec({ pages: [] }, f).length === 1);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
