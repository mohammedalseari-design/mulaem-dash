// اختبار بناء بروشور ملائم من قراءة المساعد صفحةً صفحة (crm/js/brochure-read.js): العدد نفسه، وكل صفحة من دورها وصورها،
// ولا شعار ولا خلفية، ولا مخطط يناقض نموذجه، والصفحة غير المقروءة من صورها.
// التشغيل: node tests/brochure-read.test.mjs   أو   deno run tests/brochure-read.test.mjs
import { readingToBrochure, areaIn } from '../crm/js/brochure-read.js';
import { brochureFacts, validateSpec } from '../crm/js/brochure-plan.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const u = (n) => 'https://img.test/brochures/r1/img-' + n + '.jpg';
const media = {
    version: 2, pages: 6, read: 6,
    images: [
        { url: u(1), page: 1, kind: 'photo', tall: false, on: [{ page: 1, n: 1 }, { page: 2, n: 1 }] },
        { url: u(2), page: 1, kind: 'plan', tone: 'light', on: [{ page: 1, n: 2 }] },
        { url: u(3), page: 3, kind: 'photo', tall: true, on: [{ page: 3, n: 1 }] },
        { url: u(4), page: 3, kind: 'photo', tall: true, on: [{ page: 3, n: 2 }] },
        { url: u(5), page: 3, kind: 'photo', tall: true, on: [{ page: 3, n: 3 }] },
        { url: u(6), page: 4, kind: 'plan', tone: 'light', on: [{ page: 4, n: 1 }] },
        { url: u(7), page: 5, kind: 'plan', tone: 'dark', on: [{ page: 5, n: 1 }] }
    ]
};
const page = (n, role, extra = {}) => ({ page: n, role, title: null, subtitle: null, body: null, bullets: [], model: null, images: [], ...extra });
const model = (name, area, plan_label, extra = {}) => ({ name, type: null, orientation: 'داخلية شمالي', rooms: 2, bathrooms: 2, area, price: 639000, sold: false, parts: ['غرفة نوم ماستر'], plan_label, ...extra });
const reading = {
    version: 2,
    project: { name: 'لامير سيرين', name_latin: 'LAMER SERIN', developer: 'لامير العقارية', city: 'جدة', district: 'أبحر', tagline: 'سكن بروح الطبيعة' },
    pages: [
        page(1, 'cover', { title: 'لامير سيرين', images: [{ n: 1, role: 'exterior', caption: null }, { n: 2, role: 'logo', caption: null }] }),
        page(2, 'about', { title: 'عن المشروع', body: 'يقوم المشروع على فكرة التوازن بين الداخل والخارج.', images: [{ n: 1, role: 'exterior', caption: null }] }),
        page(3, 'photos', { title: 'من الداخل', images: [1, 2, 3].map((n) => ({ n, role: 'interior', caption: n === 1 ? 'المدخل' : null })) }),
        page(4, 'model', { model: model('شقة 1', 97, 'نموذج شقة (1) مساحتها : 97 م2'), images: [{ n: 1, role: 'plan', caption: null }] }),
        page(5, 'model', { model: model('ملحق 3', 225, 'نموذج شقة (3) مساحتها 168م²'), images: [{ n: 1, role: 'plan', caption: null }] }),
        page(6, 'contact', { title: 'تواصل معنا' })
    ],
    missing: [], conflicts: [], dropped: 0
};

const b = readingToBrochure(reading, media, { id: 'r1' });
const kinds = b.spec.pages.map((p) => p.kind + ':' + p.variant).join(' ');
t('one Mulaem page per developer page, each from its role', kinds === 'cover:side about:split trio:panels model:plan model:facts back:brand', kinds);
const facts = brochureFacts(b.project, { whatsapp: '966551234567' });
t('the plan is valid for its facts', validateSpec(b.spec, facts).length === 0, validateSpec(b.spec, facts));
t('a photo shown on two pages is one image', b.project.images.filter((i) => i.url === u(1)).length === 1 && b.spec.pages[0].images[0] === b.spec.pages[1].images[0]);
t('the developer logo is left out, with a note', !b.project.images.some((i) => i.url === u(2)) && b.notes.some((n) => /تُركت 1 صورة/.test(n)), b.notes);
t('the page text comes with the page', b.spec.pages[1].text.body.startsWith('يقوم المشروع') && b.spec.pages[1].stats === true);
t('interior captions kept', facts.images[b.spec.pages[2].images[0]].caption === 'المدخل');
t('a model keeps its own plan; a plan that names another area is not shown', facts.models[0].plan === u(6) && facts.models[0].planTone === 'light' && facts.models[1].plan === null
    && b.notes.some((n) => /صفحة 5: مخطط ملحق 3 مكتوب عليه 168م² والنموذج 225م²/.test(n)), b.notes);
t('«تصميم آخر» changes the cover only', readingToBrochure(reading, media, { id: 'r1', variation: 1 }).spec.pages[0].variant === 'low'
    && readingToBrochure(reading, media, { id: 'r1', variation: 1 }).spec.pages.slice(1).map((p) => p.kind).join() === b.spec.pages.slice(1).map((p) => p.kind).join());
t('no prices in the plan, only references and printed page text', !/639000/.test(JSON.stringify(b.spec)));

// صفحة لم تُقرأ: من صورها كما استُخرجت، ويبقى العدد
const partial = { ...reading, pages: reading.pages.filter((p) => p.page !== 3), missing: [3] };
const bp = readingToBrochure(partial, media, { id: 'r1' });
t('an unread page is built from its own images, the count stays', bp.spec.pages.length === 6 && bp.spec.pages[2].kind === 'trio' && bp.notes.some((n) => /لم يقرأ المساعد الصفحات 3/.test(n)), bp.spec.pages.map((p) => p.kind));

// بلا صفحة تواصل: آخر صفحة غلاف ملائم الخلفي؛ وصفحة بلا صورة ولا نص فاصل
const noContact = { ...reading, pages: [...reading.pages.slice(0, 5), page(6, 'other')] };
t('without a contact page the last page is the back cover', readingToBrochure(noContact, media, {}).spec.pages[5].kind === 'back');
const blank = { ...reading, pages: [...reading.pages.slice(0, 2), page(3, 'other'), ...reading.pages.slice(3)] };
t('a page with nothing usable is a pause page, not a gap', readingToBrochure(blank, { ...media, images: media.images.slice(0, 2) }, {}).spec.pages[2].kind === 'statement');

// صفحة «نموذج» بلا أرقام ولا مخطط: من صورها أو نصها، لا صفحة نموذج فارغة
const thin = { ...reading, pages: reading.pages.map((p) => (p.page === 4 ? page(4, 'model', { title: 'النماذج', model: model(null, null, null, { rooms: null, price: null, parts: [] }) }) : p)) };
t('an empty model page falls back to its text (a heading alone: a statement page)', readingToBrochure(thin, media, {}).spec.pages[3].kind === 'statement' && readingToBrochure(thin, media, {}).spec.pages[3].text.title === 'النماذج');

t('a reading from the old studio is refused', readingToBrochure({ version: 1, pages: [] }, media, {}) === null && readingToBrochure(null, media, {}) === null);
t('the page count follows the pages the browser read', readingToBrochure({ ...reading, pages: reading.pages.slice(0, 2) }, { ...media, read: 6 }, {}).spec.pages.length === 6);

// صفحة نص قصير بلا صورة بعد صفحة «عن المشروع»: صفحة فاصلة بنصها
const vision = { ...reading, pages: [...reading.pages.slice(0, 2), page(3, 'about', { title: 'رؤيتنا', body: 'نصنع مساحات تعيش طويلاً.' }), ...reading.pages.slice(3)] };
const bv = readingToBrochure(vision, { ...media, images: media.images.filter((m) => m.page !== 3) }, {});
t('a short text page without a photo is a statement page with its own text', bv.spec.pages[2].kind === 'statement' && bv.spec.pages[2].variant === 'say' && bv.spec.pages[2].text.title === 'رؤيتنا'
    && bv.spec.pages[1].kind === 'about' && bv.spec.pages[1].stats === true, bv.spec.pages.slice(0, 3));

// ---- ملاحظات المراجعة (2026-10-25) ----
const swap = (n, pg) => ({ ...reading, pages: reading.pages.map((x) => (x.page === n ? pg : x)) });
const amen = readingToBrochure(swap(3, page(3, 'amenities', { title: 'الضمانات', body: 'ضمان عشر سنوات على الهيكل.', images: [{ n: 1, role: 'interior', caption: null }] })), media, {});
t('amenities with a paragraph and no list: an about page, and the brochure stays valid', amen.spec.pages[2].kind === 'about'
    && validateSpec(amen.spec, brochureFacts(amen.project)).length === 0, amen.spec.pages[2]);
const site = readingToBrochure(swap(3, page(3, 'location', { title: 'المخطط العام', images: [{ n: 1, role: 'plan', caption: null }] })), { ...media, images: media.images.map((m) => (m.page === 3 ? { ...m, kind: 'plan' } : m)) }, {});
t('a location page whose only image is a plan stays a location page, no made-up model', site.spec.pages[2].kind === 'location' && site.project.details.models.length === 2);
const unnamed = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.model ? { ...x, title: 'النماذج', model: { ...x.model, name: null } } : x)) }, media, {});
t('an unnamed model does not take the page heading as its name', unnamed.project.details.models.every((m) => m.name === null));
const logoTwice = { ...media, images: media.images.map((m, i) => (i === 1 ? { ...m, on: [{ page: 1, n: 2 }, { page: 3, n: 4 }] } : m)) };
const unreadLogo = readingToBrochure({ ...reading, pages: reading.pages.filter((x) => x.page !== 3), missing: [3] }, logoTwice, {});
t('an unread page does not reuse an image the assistant called a logo elsewhere', !unreadLogo.project.images.some((i) => i.url === u(2)));
const twice = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.page === 2 ? { ...x, images: [...x.images, { n: 2, role: 'logo', caption: null }] } : x)) },
    { ...media, images: media.images.map((m, i) => (i === 1 ? { ...m, on: [{ page: 1, n: 2 }, { page: 2, n: 2 }] } : m)) }, {});
t('the dropped-images note counts each image once', twice.notes.some((n) => /تُركت 1 صورة/.test(n)), twice.notes);
const foreign = readingToBrochure(reading, { ...media, read: 1e9, images: media.images.map((m, i) => (i === 0 ? { ...m, url: 'https://evil.example/x.jpg' } : m)) }, { mediaPrefix: 'https://img.test/brochures/r1/' });
t('media.json: images only from this brochure\'s storage, pages capped at 40', !foreign.project.images.some((i) => /evil/.test(i.url)) && foreign.spec.pages.length === 40);

t('areaIn: the area printed in a plan', areaIn('نموذج شقة (3) مساحتها 168م²') === 168 && areaIn('مساحة: ١٠٧') === 107 && areaIn('97 م') === 97 && areaIn('97 مجلس') === null && areaIn(null) === null);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
