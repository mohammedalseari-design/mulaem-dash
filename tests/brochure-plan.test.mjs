// اختبار حقائق البروشور والتحقق من مخطط الصفحات (crm/js/brochure-plan.js): الحقائق من البيانات فقط، والمخطط فهارس موجودة.
// التشغيل: node tests/brochure-plan.test.mjs   أو   deno run tests/brochure-plan.test.mjs
import { brochureFacts, validateSpec, chaptersOf, splitFigure, guaranteePage, PALETTES, MAX_MODELS, MAX_PAGES } from '../crm/js/brochure-plan.js';

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
t('validate: a numbers page and a models opener pointing at its models are valid', validateSpec({ pages: [cover, { kind: 'features', variant: 'numbers', text: { bullets: ['10 سنوات هيكل البناء'] } },
  { kind: 'statement', variant: 'chapter', images: [9], text: { title: 'نماذج الوحدات', bullets: [] }, models: [0, 2] }, { kind: 'model', variant: 'plan', model: 0 }] }, f).length === 0);
t('validate: a models opener must point at models that exist, first before last', validateSpec({ pages: [cover, { kind: 'statement', variant: 'chapter', models: [2, 0] },
  { kind: 'statement', variant: 'chapter', models: [0, 9] }, { kind: 'statement', variant: 'chapter' }] }, f).length === 3);
t('validate: garbage', validateSpec(null, f).length === 1 && validateSpec({ pages: [] }, f).length === 1);

// ---- ألوان المشروع: اسم عائلة من الجدول الثابت فقط، وإلا كحلي ملائم ----
t('palette: a known family brings its fixed colours', JSON.stringify(brochureFacts({ details: { palette: 'forest' } }).palette) === JSON.stringify({ name: 'forest', ...PALETTES.forest }));
t('palette: a free colour or an inherited key is refused (Mulaem navy)', brochureFacts({ details: { palette: '#ff0000' } }).palette.name === 'navy'
  && brochureFacts({ details: { palette: 'constructor' } }).palette.name === 'navy' && brochureFacts(null).palette.name === 'navy');
t('image family kept only from the table', brochureFacts({ images: [{ url: u(1), deep: 'teal' }, { url: u(2), deep: 'red' }] }).images.map((i) => i.deep).join() === 'teal,');

// ---- قصّ المخطط: نسب من 0 إلى 1 وأضلاع معقولة، وإلا يُعرض المخطط كاملاً ----
const cut = (plan_crop, plan_ratio) => brochureFacts({ details: { models: [{ name: 'شقة 1', plan: u('p'), plan_ratio, plan_crop }] } }).models[0];
const ok = cut({ unit: [0.09, 0.04, 0.49, 0.93], key: [0.53, 0.14, 0.93, 0.67] }, 1.41);
t('plan crop: the unit and key boxes and the ratio pass through', ok.planRatio === 1.41 && ok.planUnit.join() === '0.09,0.04,0.49,0.93' && ok.planKey.join() === '0.53,0.14,0.93,0.67', ok);
const bad = cut({ unit: [0.5, 0, 0.55, 1], key: [0, 0, 2, 1] }, 99);
t('plan crop: slivers, values out of range and absurd ratios are dropped', bad.planUnit === null && bad.planKey === null && bad.planRatio === null
  && cut('x', 'y').planUnit === null && cut(null, null).planKey === null);

// ---- فصول البروشور: من أدوار الصفحات، والفهرس وما قبله مقدمة ----
const fm = brochureFacts({ details: { models: [{ name: 'شقة 1', type: 'شقة' }, { name: 'شقة 2', type: 'شقة' }, { name: 'ملحق 1', type: 'ملحق' }] } });
const book = { pages: [cover, { kind: 'about', variant: 'split' }, { kind: 'statement', variant: 'contents' }, { kind: 'statement', variant: 'say', text: { title: 'منذ 2010' } },
  { kind: 'location', variant: 'map' }, { kind: 'features', variant: 'list' }, { kind: 'statement', variant: 'chapter', models: [0, 2] },
  { kind: 'model', variant: 'plan', model: 0 }, { kind: 'model', variant: 'plan', model: 1 }, { kind: 'model', variant: 'facts', model: 2 },
  { kind: 'statement', variant: 'say', text: { title: 'تواصل معنا' } }, { kind: 'back', variant: 'brand' }] };
const ch = chaptersOf(book, fm);
t('chapters: project, location, features, models, the second group by its plural, contact — each with its first page',
  ch.list.map((c) => c.n + ' ' + c.name + ' ' + c.page).join(' | ') === '01 المشروع 4 | 02 الموقع 5 | 03 المميزات 6 | 04 النماذج 7 | 05 الملاحق 10 | 06 تواصل 11', ch.list);
t('chapters: covers and the pages up to the contents have none', ch.of[0] === -1 && ch.of[1] === -1 && ch.of[2] === -1 && ch.of[11] === -1 && ch.of[8] === 3);
t('validate: the contents page is a known page', validateSpec({ pages: [cover, { kind: 'statement', variant: 'contents' }] }, f).length === 0);

// ---- أرقام الصفحة البارزة والضمانات وصفحة الموقع الكاملة (2026-10-27) ----
const sf = (v) => JSON.stringify(splitFigure(v));
t('splitFigure: the number, then its unit as printed', sf('+700') === '{"n":"+700","unit":null,"rest":null}' && sf('+300,000m') === '{"n":"+300,000","unit":"m","rest":null}'
    && sf('1 سنة مجانًا') === '{"n":"1","unit":"سنة مجانًا","rest":null}' && sf('50%') === '{"n":"50%","unit":null,"rest":null}'
    && sf('أكثر من 5') === '{"n":null,"unit":null,"rest":"أكثر من 5"}' && sf(null).startsWith('{"n":null'));
const nums = (figures, bullets) => ({ kind: 'features', variant: 'numbers', text: { figures, bullets: bullets || [] } });
t('guaranteePage: every unit a duration (from figures, else from the list)', guaranteePage(nums([{ value: '10 سنوات' }, { value: '1 سنة مجانًا' }]))
    && guaranteePage(nums([], ['25 سنة الأفياش والقواطع'])) && !guaranteePage(nums([{ value: '10 سنوات' }, { value: '+700' }]))
    && !guaranteePage(nums([{ value: '3 حدائق' }])) && !guaranteePage({ kind: 'features', variant: 'list', text: { bullets: ['10 سنوات هيكل'] } }) && !guaranteePage(null));
const plainCover = { kind: 'cover', variant: 'type' };
const withG = { pages: [plainCover, { kind: 'statement', variant: 'contents' }, { kind: 'features', variant: 'list', text: { bullets: ['مداخل ذكية'] } },
    nums([{ value: '10 سنوات', label: 'هيكل البناء' }]), { kind: 'model', variant: 'facts', model: 0 }, { kind: 'back', variant: 'brand' }] };
t('chapters: the guarantees page is its own chapter after the features', chaptersOf(withG, fm).list.map((c) => c.name + ' ' + c.page).join(' | ') === 'المميزات 3 | الضمانات 4 | النماذج 5',
    chaptersOf(withG, fm).list);
t('validate: a numbers page with figures alone is valid; without figures, list or amenities it is not', validateSpec(withG, fm).length === 0
    && validateSpec({ pages: [plainCover, nums([], [])] }, fm).length === 1, validateSpec(withG, fm));
t('validate: a full-bleed location page needs its photo', validateSpec({ pages: [cover, { kind: 'location', variant: 'hero', images: [8] }] }, f).length === 0
    && validateSpec({ pages: [cover, { kind: 'location', variant: 'hero', images: [] }] }, f).length === 1);

// صورة البروشور المرفوع تحمل بكسلاتها والجهة الأهدأ أسفلها، فلا تُطبع أكبر مما تحمل وتقع كتلة الكلام على الجهة الهادئة
const px = brochureFacts({ images: [{ url: u(1), kind: 'aerial', w: 2400, h: 1349.6, quiet: 'left' }, { url: u(2), kind: 'interior', w: -3, h: 'x', quiet: 'top' }] }).images;
t('facts: an image keeps its pixel size and quiet side; junk values are dropped', px[0].w === 2400 && px[0].h === 1350 && px[0].quiet === 'left'
    && px[1].w === null && px[1].h === null && px[1].quiet === null, px);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
