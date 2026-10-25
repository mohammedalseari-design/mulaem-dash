// اختبار مخطط البروشور (crm/js/brochure-plan.js): الحقائق من البيانات فقط، والصفحات حسب المادة، ولا مخطط مستعار، والتحقق.
// التشغيل: node tests/brochure-plan.test.mjs   أو   deno run tests/brochure-plan.test.mjs
import { brochureFacts, planBrochure, validateSpec, MAX_MODELS } from '../crm/js/brochure-plan.js';

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
t('models: broken rows dropped, Arabic digits read, insecure plan dropped', f.models.length === 3 && f.models[1].price === 689000 && f.models[1].rooms === 3 && f.models[1].plan === null && f.models[0].planTone === 'light', f.models);
t('price: lowest unsold; the sold annex is not counted', f.price === 639000 && f.priceFrom === true);
t('area range from the units', JSON.stringify(f.areaRange) === '[97,224]');
t('lists keep text only', f.landmarks.join() === 'برج جدة' && f.amenities.length === 2);
t('nothing the record does not hold: no developer phone', !('contact_phone' in f) && f.office.whatsapp === '966551234567');
t('models capped', brochureFacts({ details: { models: Array.from({ length: 20 }, (_, i) => ({ name: 'N' + i, area: 100 + i })) } }).models.length === MAX_MODELS);
t('empty record → empty facts, no crash', brochureFacts(null).name === null && brochureFacts({ details: 'x' }).models.length === 0);

const spec = planBrochure(f);
const kinds = spec.pages.map((p) => p.kind + ':' + p.variant).join(' ');
t('pages follow the material', /^cover:(side|low) about:split photo:full trio:panels pair:offset location:map model:plan model:facts model:facts features:photo back:brand$/.test(kinds), kinds);
t('a model without its own plan gets the numbers page, never another image', spec.pages.filter((p) => p.kind === 'model' && p.variant === 'facts').every((p) => !p.images));
t('every image used at most once', (() => { const all = spec.pages.flatMap((p) => p.images || []); return all.length === new Set(all).size; })());
t('the plan carries no prices or names, only references', !/639|لامير|ريال/.test(JSON.stringify(spec)), spec);
t('valid', validateSpec(spec, f).length === 0, validateSpec(spec, f));
t('same project, same design; a variation may change the cover', JSON.stringify(planBrochure(f)) === JSON.stringify(spec)
  && [0, 1, 2, 3].map((v) => JSON.stringify(planBrochure(f, { variation: v }).pages[0])).some((c) => c !== JSON.stringify(spec.pages[0])));

const bare = brochureFacts({ id: 9, name: 'أرض الفيصلية' });
t('no photos, no units, no facts: typographic cover and back only', planBrochure(bare).pages.map((p) => p.kind + ':' + p.variant).join() === 'cover:type,back:brand');
const inventory = brochureFacts({ id: 5, name: 'مشروع', price: 500000, images: [u(1)] });
t('one inventory photo: cover only uses it, about without photo', planBrochure(inventory).pages.map((p) => p.kind + ':' + p.variant).join() === 'cover:side,about:text,back:brand'
  || planBrochure(inventory).pages.map((p) => p.kind + ':' + p.variant).join() === 'cover:low,about:text,back:brand', planBrochure(inventory).pages);

t('validate: a model page pointing at a missing model or a plan it does not have', validateSpec({ pages: [spec.pages[0], { kind: 'model', variant: 'plan', model: 1 }, { kind: 'model', variant: 'facts', model: 9 }] }, f).length === 2);
t('validate: missing image, unknown kind, no cover first', validateSpec({ pages: [{ kind: 'trio', variant: 'panels', images: [0, 1, 40] }, { kind: 'poster', variant: 'x' }] }, f).length >= 3);
t('validate: garbage', validateSpec(null, f).length === 1 && validateSpec({ pages: [] }, f).length === 1);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
