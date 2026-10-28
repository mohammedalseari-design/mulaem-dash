// اختبار بناء بروشور ملائم من قراءة المساعد صفحةً صفحة (crm/js/brochure-read.js): العدد نفسه، وكل صفحة من دورها وصورها،
// ولا شعار ولا خلفية، ولا مخطط يناقض نموذجه، والصفحة غير المقروءة من صورها.
// التشغيل: node tests/brochure-read.test.mjs   أو   deno run tests/brochure-read.test.mjs
import { readingToBrochure, areaIn, spaced, tidy as tidyText, ownName, areaUnit } from '../crm/js/brochure-read.js';
import { brochureFacts, validateSpec, chaptersOf } from '../crm/js/brochure-plan.js';

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
// صفحة «عن المشروع» صورتها صورة الغلاف نفسها: صفحة كلام لا الصورة مرة ثانية
t('one Mulaem page per developer page, each from its role', kinds === 'cover:side about:text trio:panels model:plan model:wide back:brand', kinds);
const facts = brochureFacts(b.project, { whatsapp: '966551234567' });
t('the plan is valid for its facts', validateSpec(b.spec, facts).length === 0, validateSpec(b.spec, facts));
t('a photo shown on two pages is one image, and the page right after the cover does not show it again', b.project.images.filter((i) => i.url === u(1)).length === 1
    && b.spec.pages[1].kind === 'about' && b.spec.pages[1].variant === 'text' && !b.spec.pages[1].images);
const own = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.page === 2 ? { ...x, images: [...x.images, { n: 2, role: 'exterior', caption: null }] } : x)) },
    { ...media, images: [...media.images, { url: u(8), page: 2, kind: 'photo', tall: false, on: [{ page: 2, n: 2 }] }] }, { id: 'r1' });
t('an about page with a photo of its own keeps it beside its text', own.spec.pages[1].variant === 'split' && own.project.images[own.spec.pages[1].images[0]].url === u(8), own.spec.pages[1]);
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

// بروشور لامير الحقيقي: آخر صفحة غلافه الخلفي، وقبلها صفحة «تواصل معنا»؛ والاسم بمدّ «سيـرين»
const closing = readingToBrochure({ ...reading, project: { ...reading.project, name: 'لامير سيـرين' },
    pages: [...reading.pages.slice(0, 5), page(6, 'contact', { title: 'تواصل معنا لتتعرف على الخصم' }), page(7, 'cover', { title: 'لاميـر سيـرين' })] }, { ...media, read: 7 }, {});
t('the closing page of the developer brochure is the Mulaem back cover; the contact page before it is a statement', closing.spec.pages[6].kind === 'back'
    && closing.spec.pages[5].kind === 'statement' && closing.spec.pages[5].text.title === 'تواصل معنا لتتعرف على الخصم', closing.spec.pages.map((x) => x.kind));
t('stretched letters (ـ) in the developer names are not copied', closing.project.name === 'لامير سيرين');

// ---- نظام «مونوغراف» (2026-10-25): الضمانات أرقاماً، وافتتاح النماذج بفهرسها، ونص المطوّر بلا مدّ ولا التصاق ----
const guarantees = readingToBrochure(swap(3, page(3, 'amenities', { title: 'مميزات المشروع', bullets: ['10 سنوات أبوابWPC', '25 سنة الأفياش والقواطع', '1 سنة كهرباء وسباكة'],
    images: [{ n: 1, role: 'interior', caption: null }] })), media, {});
t('amenities that all start with a number are a numbers page, without a photo', guarantees.spec.pages[2].kind === 'features' && guarantees.spec.pages[2].variant === 'numbers'
    && !guarantees.spec.pages[2].images && guarantees.spec.pages[2].text.bullets[0] === '10 سنوات أبواب WPC'
    && validateSpec(guarantees.spec, brochureFacts(guarantees.project)).length === 0, guarantees.spec.pages[2]);
const mixed = readingToBrochure(swap(3, page(3, 'amenities', { title: 'مميزات المشروع', bullets: ['مداخل ذكية', '25 سنة الأفياش والقواطع'], images: [{ n: 1, role: 'interior', caption: null }] })), media, {});
t('a list that does not all start with a number stays a list with its photo', mixed.spec.pages[2].variant === 'photo', mixed.spec.pages[2]);
const opener = readingToBrochure(swap(3, page(3, 'other', { title: 'نماذج الوحدات', images: [{ n: 1, role: 'plan3d', caption: null }] })), media, {});
const op = opener.spec.pages[2];
t('a photo page with a heading alone before the models opens them: their index from the first to the last model', op.kind === 'statement' && op.variant === 'chapter'
    && JSON.stringify(op.models) === '[0,1]' && op.text.title === 'نماذج الوحدات' && opener.project.images[op.images[0]].kind === 'plan3d'
    && validateSpec(opener.spec, brochureFacts(opener.project)).length === 0, op);
const talk = readingToBrochure(swap(3, page(3, 'about', { title: 'رؤيتنا', body: 'نصنع مساحات تعيش طويلاً.' })), { ...media, images: media.images.filter((m) => m.page !== 3) }, {});
t('a text page before the models stays itself', talk.spec.pages[2].variant === 'say', talk.spec.pages[2]);
const tidy = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.page === 3 ? { ...x, images: x.images.map((im) => ({ ...im, caption: im.n === 1 ? 'المصـــاعد' : null })) }
    : x.page === 5 ? { ...x, model: { ...x.model, name: 'ملحق3', orientation: 'أمـامـيـة', parts: ['2دورات مياه', '60م² سطح', 'غرفة نوم ماستر'] } } : x)) }, media, {});
const tm = tidy.project.details.models[1];
t('names, captions and parts as printed, without stretched letters and with the spaces the developer dropped', tm.name === 'ملحق 3' && tm.orientation === 'أمامية'
    && tm.parts.join('|') === '2 دورات مياه|60م² سطح|غرفة نوم ماستر' && tidy.project.images.some((i) => i.caption === 'المصاعد'), { tm, caps: tidy.project.images.map((i) => i.caption) });
t('spaced: a number stuck to a word, Arabic stuck to Latin; units stay', spaced('2دورات مياه') === '2 دورات مياه' && spaced('أبوابWPC') === 'أبواب WPC' && spaced('60م² سطح') === '60م² سطح'
    && spaced('ملحق1', 40, true) === 'ملحق 1' && spaced('شقة 1', 40, true) === 'شقة 1' && spaced(null) === null);

t('areaIn: the area printed in a plan', areaIn('نموذج شقة (3) مساحتها 168م²') === 168 && areaIn('مساحة: ١٠٧') === 107 && areaIn('97 م') === 97 && areaIn('97 مجلس') === null && areaIn(null) === null);

// ---- الغلاف أقوى صورة، والفهرس مكان صفحتها، وألوان المشروع (2026-10-27) ----
// بروشور لامير: الغلاف شعار المطوّر وحده؛ صفحة 2 «عن المشروع» بصورة، وصفحة 3 الواجهة البانورامية وحدها؛ والخلفية الخضراء على صفحات كثيرة
const lm = {
    version: 2, pages: 7, read: 7,
    images: [
        { url: u(1), page: 1, kind: 'photo', w: 1280, h: 720, deep: 'forest', on: [{ page: 1, n: 1 }, { page: 2, n: 1 }, { page: 4, n: 1 }] },
        { url: u(2), page: 2, kind: 'photo', w: 1303, h: 1303, deep: 'forest', on: [{ page: 2, n: 2 }] },
        { url: u(3), page: 3, kind: 'photo', w: 2008, h: 783, deep: 'bronze', on: [{ page: 3, n: 1 }] },
        { url: u(4), page: 5, kind: 'plan', tone: 'light', w: 2048, h: 1448, crop: { unit: [0.09, 0.04, 0.49, 0.93], key: [0.53, 0.14, 0.93, 0.67] }, on: [{ page: 5, n: 1 }] },
        { url: u(5), page: 6, kind: 'photo', w: 900, h: 900, deep: 'bronze', on: [{ page: 6, n: 1 }] }
    ]
};
const lr = { ...reading, pages: [
    page(1, 'cover', { title: 'لامير سيرين', images: [{ n: 1, role: 'logo', caption: null }] }),
    page(2, 'about', { title: 'حياة سكنية أكثر هدوءًا', body: 'في موقع حيوي بأبحر الجنوبية.', bullets: ['مفهوم بصري يوازن بين العمارة والضوء'], images: [{ n: 1, role: 'texture', caption: null }, { n: 2, role: 'exterior', caption: null }] }),
    page(3, 'photos', { title: 'واجهة المشروع', images: [{ n: 1, role: 'exterior', caption: 'واجهة المشروع' }] }),
    page(4, 'about', { title: 'بخبرة تمتد منذ عام 2010', body: 'نطوّر مجتمعات سكنية.', images: [{ n: 1, role: 'texture', caption: null }] }),
    page(5, 'model', { model: model('شقة 1', 97, 'نموذج شقة (1) مساحتها : 97 م2'), images: [{ n: 1, role: 'plan', caption: null }] }),
    page(6, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }] }),
    page(7, 'cover', { title: 'لامير سيرين' })
] };
const lb = readingToBrochure(lr, lm, { id: 'r1' });
const lf = brochureFacts(lb.project, {});
t('cover: the facade the developer gave a page of its own, as a wide band (panorama)', lb.spec.pages[0].variant === 'low' && lb.project.images[lb.spec.pages[0].images[0]].url === u(3), lb.spec.pages[0]);
t('«تصميم آخر» on a panorama: beside the split', readingToBrochure(lr, lm, { id: 'r1', variation: 1 }).spec.pages[0].variant === 'side');
t('the page whose photo became the cover is the contents page; the about page keeps its own photo and leaves the figures to it',
    lb.spec.pages[2].kind === 'statement' && lb.spec.pages[2].variant === 'contents' && lb.spec.pages[1].variant === 'split'
    && lb.project.images[lb.spec.pages[1].images[0]].url === u(2) && lb.spec.pages[1].stats === false, lb.spec.pages.slice(0, 3));
t('a far page with the cover photo is not touched, and the brochure stays valid', lb.spec.pages[5].kind === 'photo' && validateSpec(lb.spec, lf).length === 0, validateSpec(lb.spec, lf));
t('palette: the family the brochure wears page after page (its green background), not the warm cover photo', lb.project.details.palette === 'forest' && lf.family === 'forest');
t('the plan keeps its crop and ratio for the model page', lf.models[0].planUnit.join() === '0.09,0.04,0.49,0.93' && lf.models[0].planKey !== null && Math.abs(lf.models[0].planRatio - 2048 / 1448) < 1e-9, lf.models[0]);
t('no family read anywhere: none (the art direction keeps its calm default)', brochureFacts(readingToBrochure(reading, media, {}).project).family === null);
const ownIndex = readingToBrochure({ ...lr, pages: lr.pages.map((x) => (x.page === 3 ? page(3, 'other', { title: 'المحتويات' }) : x)) }, lm, {});
t('the developer\'s own contents page stays a contents page', ownIndex.spec.pages[2].variant === 'contents', ownIndex.spec.pages[2]);

// ---- الصور المحسّنة من الخادم (result.enhanced، agent-run/enhance.ts) وملاحظاتها (result.enhance_notes) ----
const box = 'https://img.test/brochures/r1/';
const enh = (extra, meta) => readingToBrochure({ ...reading, ...extra }, media, { id: 'r1', mediaPrefix: box, ...meta });
const eb = enh({ enhanced: { 0: box + 'enh-01.png', 2: box + 'enh-03.png', 5: box + 'enh-06.png', 4: 'https://evil.example/enh-05.png' },
    enhance_notes: ['رُفضت صورة محسّنة واحدة لأن التحسين غيّر لافتة أو شعاراً أو كتابة، فبقيت الصورة الأصلية.'] });
const coverImg = eb.project.images[eb.spec.pages[0].images[0]];
t('enhanced: the restored photo is printed in place of its original, with the original\'s kind and shape', coverImg.url === box + 'enh-01.png'
    && coverImg.tall === false && coverImg.kind === 'exterior' && !eb.project.images.some((i) => i.url === u(1)), eb.project.images);
const tallImg = eb.project.images.find((i) => i.url === box + 'enh-03.png');
t('enhanced: a tall interior stays tall and keeps its caption', tallImg && tallImg.tall === true && tallImg.kind === 'interior' && tallImg.caption === 'المدخل', tallImg);
const ef = brochureFacts(eb.project);
t('enhanced: a plan is never swapped (its crop is measured on the original)', ef.models[0].plan === u(6), ef.models[0]);
t('enhanced: a link outside this brochure\'s storage is refused, the original stays', !JSON.stringify(eb.project).includes('evil.example'));
t('enhanced: the server notes and a count of restored photos join the reading notes', eb.notes.some((n) => /رُفضت صورة محسّنة واحدة/.test(n))
    && eb.notes.some((n) => /حُسّنت صورتان من صور البروشور/.test(n)), eb.notes);
t('enhanced: nothing from the server → the originals and no note', enh({}).project.images.some((i) => i.url === u(1)) && !enh({}).notes.some((n) => /حُسّنت/.test(n)));
t('enhanced: a non-https link or a junk map is ignored', enh({ enhanced: { 0: 'http://img.test/brochures/r1/enh-01.png' } }).project.images.some((i) => i.url === u(1))
    && enh({ enhanced: ['x'] }).project.images.some((i) => i.url === u(1)) && enh({ enhanced: 'x', enhance_notes: 'x' }).notes.every((n) => n !== 'x'));
t('enhanced: an image whose original was refused is not brought back by its restored copy', !readingToBrochure({ ...reading, enhanced: { 0: box + 'enh-01.png' } },
    { ...media, images: media.images.map((m, i) => (i === 0 ? { ...m, url: 'https://evil.example/x.jpg' } : m)) }, { mediaPrefix: box }).project.images.some((i) => /enh-01/.test(i.url)));

// ---- الجولة الثالثة (2026-10-27): الترقيم، والمعالم، وأرقام الصفحة، والضمانات، وترتيب المباع، والصور المستعارة ----
const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069);
t('tidy: no space before the comma or the period, one space after the comma, «و» attached, ranges with an en dash in the digits\' direction, tanween before the alif',
    tidyText('العملية ، ضمن') === 'العملية، ضمن' && tidyText('الداخلي،والإضاءة') === 'الداخلي، والإضاءة' && tidyText('السكن و الترفيه و الأعمال') === 'السكن والترفيه والأعمال'
    && tidyText('مميزة .') === 'مميزة.' && tidyText('لامير 20- 21 - 22') === 'لامير ' + LRI + '20–21–22' + PDI && tidyText(tidyText('25- 26')) === LRI + '25–26' + PDI
    && tidyText('هدوءًا وإتزاناً') === 'هدوءًا وإتزانًا' && tidyText('كلمة   كلمة') === 'كلمة كلمة' && tidyText(null) === null && tidyText('+700 عملاء،+800') === '+700 عملاء، +800');
t('ownName: the project itself, with «مشروع» or one letter off, is not a landmark', ownName('مشروع لامير سيرين', 'لامير سيرين') === 'same'
    && ownName('لامير سيين', 'لامير سيرين') === 'near' && ownName('لامير 24', 'لامير سيرين') === null && ownName('برج جدة', 'لامير سيرين') === null && ownName('x', null) === null);

const bm = { version: 2, pages: 11, read: 11, images: [
    { url: u(1), page: 1, kind: 'photo', w: 1600, h: 900, deep: 'bronze', on: [{ page: 1, n: 1 }] },
    { url: u(2), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 1 }] },
    { url: u(3), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 2 }] },
    { url: u(4), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 3 }] },
    { url: u(5), page: 3, kind: 'photo', w: 2400, h: 1350, on: [{ page: 3, n: 1 }] },
    { url: u(6), page: 4, kind: 'photo', w: 2000, h: 2000, on: [{ page: 4, n: 1 }] }
] };
const book = readingToBrochure({ ...reading, pages: [
    page(1, 'cover', { title: 'لامير سيرين', images: [{ n: 1, role: 'exterior', caption: null }] }),
    page(2, 'photos', { images: [1, 2, 3].map((n) => ({ n, role: 'interior', caption: 'غرفة ' + n })) }),
    page(3, 'location', { title: 'موقع المشروع.', body: 'السكن و الترفيه ، والأعمال', bullets: ['مشروع لامير سيرين', 'لامير سيين', 'برج جدة', 'لامير 25- 26'], images: [{ n: 1, role: 'aerial', caption: null }] }),
    page(4, 'location', { title: 'الحي', bullets: ['السوبر دوم'], images: [{ n: 1, role: 'map', caption: null }] }),
    page(5, 'amenities', { title: 'مميزات المشروع', bullets: ['مداخل ذكية', 'أسقف عالية'] }),
    page(6, 'amenities', { title: 'مميزات المشروع', figures: [{ value: '10 سنوات', label: 'أبوابWPC' }, { value: '1 سنة مجانًا', label: 'اتحاد ملاك' }] }),
    page(7, 'about', { title: 'من مشاريعنا', bullets: ['لامير 24', 'لامير 23'], figures: [{ value: '+700', label: 'عملاء' }, { value: '+300,000m', label: 'المساحة المطورة' }, { value: 'كثير', label: 'بلا عدد' }, null] }),
    page(8, 'model', { model: model('شقة 6', 97, null, { sold: true }) }),
    page(9, 'model', { model: model('شقة 7', 65, null) }),
    page(10, 'contact', { title: 'تواصل معنا لتتعرف على الخصم', subtitle: 'الخاصة بعملاء الكاش' }),
    page(11, 'cover', { title: 'لامير سيرين' })
] }, bm, { id: 'r1' });
const bf = brochureFacts(book.project);
const bk = book.spec.pages;
t('the book is valid for its facts', validateSpec(book.spec, bf).length === 0 && bk.length === 11, validateSpec(book.spec, bf));
t('the first location page with a wide aerial is a full-bleed page; the map after it stays a map', bk[2].kind === 'location' && bk[2].variant === 'hero' && bk[3].variant === 'map', bk.slice(2, 4));
t('the project is not in its own landmark list; a near-miss spelling is dropped with a note', bk[2].text.bullets.join('|') === 'برج جدة|لامير ' + LRI + '25–26' + PDI
    && book.notes.some((n) => /صفحة 3: «لامير سيين» في قائمة المعالم يشبه اسم المشروع «لامير سيرين»/.test(n)), { b: bk[2].text.bullets, notes: book.notes });
t('printed text tidied without changing a word; a heading loses its final period', bk[2].text.title === 'موقع المشروع' && bk[2].text.body === 'السكن والترفيه، والأعمال', bk[2].text);
t('a features list without a photo borrows an interior the pages beside it do not show', bk[4].kind === 'features' && bk[4].variant === 'photo'
    && bf.images[bk[4].images[0]].kind === 'interior' && ![bk[3], bk[5]].some((p) => (p.images || []).includes(bk[4].images[0])), bk[4]);
t('figures alone (the warranty page) make a numbers page with their labels tidied', bk[5].kind === 'features' && bk[5].variant === 'numbers'
    && bk[5].text.figures.map((f) => f.value + '/' + f.label).join('|') === '10 سنوات/أبواب WPC|1 سنة مجانًا/اتحاد ملاك', bk[5].text);
t('the numbers page whose units are all durations is the guarantees chapter', chaptersOf(book.spec, bf).list.some((c) => c.name === 'الضمانات' && c.page === 6), chaptersOf(book.spec, bf).list);
t('an about page keeps its own headline figures (a value without a number is dropped) and does not take the project figures', bk[6].kind === 'about'
    && bk[6].text.figures.map((f) => f.value).join() === '+700,+300,000م²' && bk[6].stats === false, bk[6]);
t('available models before sold ones, the models list in the new page order, with a note', bf.models[bk[7].model].name === 'شقة 7' && bf.models[bk[8].model].name === 'شقة 6'
    && bk[7].model === 0 && bf.models[1].sold === true && book.notes.some((n) => /رُتّبت النماذج المتاحة قبل المباعة/.test(n)), bf.models.map((m) => m.name));
t('a model without a plan borrows a project photo, never the same as the next page', (bk[7].images || []).length === 1 && (bk[8].images || []).length === 1
    && bk[7].images[0] !== bk[8].images[0] && bf.images[bk[7].images[0]].kind === 'interior' && book.notes.some((n) => /صفحة 5، 8، 9: بلا صورة/.test(n)), [bk[7], bk[8], book.notes]);
t('the closing «تواصل معنا» page carries the cover photo; the back cover stays last', bk[9].kind === 'statement' && JSON.stringify(bk[9].images) === JSON.stringify(bk[0].images)
    && bk[10].kind === 'back', bk.slice(9));
const solo = readingToBrochure(reading, media, {});
t('nothing to reorder, nothing to borrow for the plain fixture: no notes about it', !solo.notes.some((n) => /رُتّبت|بلا صورة في بروشور المطوّر/.test(n)), solo.notes);

// ---- الصقل الأخير (2026-10-27): وحدة المساحة، والإملاء بين الصفحات، والصور المستعارة بلا تكرار ولا تكبير ----
t('area unit: m², m2, sqm and م2 after a number print as م²; a bare «m» only where the text is about area; words untouched',
    tidyText('مساحتها 168م2') === 'مساحتها 168م²' && tidyText('60 m²') === '60 م²' && tidyText('120sqm سطح') === '120م² سطح' && tidyText('بمساحة 300m') === 'بمساحة 300م²'
    && tidyText('على بعد 500m من البحر') === 'على بعد 500m من البحر' && tidyText('10min') === '10min' && tidyText('ملحق 2 مجلس') === 'ملحق 2 مجلس'
    && areaUnit('+300,000m', true) === '+300,000م²' && areaUnit('+300,000m', false) === '+300,000m' && areaUnit(null) === null,
    [tidyText('مساحتها 168م2'), tidyText('60 m²'), tidyText('120sqm سطح'), tidyText('بمساحة 300m')]);

const spell = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.page === 2 ? { ...x, title: 'حياة أكثر هدوءًا وإتزاناً', body: 'تجمع المساحات المفتوحة.' }
    : x.page === 3 ? page(3, 'about', { title: 'فلسفة المشروع', body: 'بيئة أكثر اتزانًا وراحة، والمساحات المفتوحة.' }) : x)) }, media, {});
t('spelling: the same word with a different hamza on two pages is flagged for staff and printed as the developer wrote it',
    spell.notes.some((n) => /صفحة 2 «وإتزانًا» وصفحة 3 «اتزانًا»: الكلمة نفسها بإملاءين/.test(n)) && spell.spec.pages[1].text.title === 'حياة أكثر هدوءًا وإتزانًا'
    && !spell.notes.some((n) => /المساحات/.test(n)), spell.notes);
const sites = readingToBrochure({ ...reading, pages: reading.pages.map((x) => (x.page === 3 ? page(3, 'location', { title: 'الموقع', bullets: ['مشروع SEVEN', 'ملعب الجوهرة (الإنماء)', 'برج جدة'] })
    : x.page === 4 ? page(4, 'location', { title: 'الحي', bullets: ['مشروع سيفين', 'مدينة الملك عبدالله الرياضية (ملعب الجوهرة)', 'برج جدة', 'مشروع مرافي'] }) : x)) }, media, {});
t('spelling: one landmark written two ways on the two location pages (Latin and Arabic, or another name around it) is flagged, not changed',
    sites.notes.some((n) => /صفحة 3 «مشروع SEVEN» وصفحة 4 «مشروع سيفين»: المعلم نفسه باسمين/.test(n))
    && sites.notes.some((n) => /صفحة 3 «ملعب الجوهرة \(الإنماء\)» وصفحة 4 «مدينة الملك عبدالله الرياضية \(ملعب الجوهرة\)»/.test(n))
    && !sites.notes.some((n) => /برج جدة|مرافي/.test(n)) && sites.spec.pages[3].text.bullets[0] === 'مشروع سيفين', sites.notes);

// صور مستعارة: صورة لم تُعرض أولاً (صورة صفحة الضمانات التي لا تُطبع)، ثم صورة الوحدة ثلاثية الأبعاد المعروضة مصغّرة في افتتاح
// النماذج لنموذج بلا مخطط، ثم الأكبر بكسلاتٍ من المعروضة كبيرة تفصيلاً مقرّباً
const lendMedia = { version: 2, pages: 12, read: 12, images: [
    { url: u(1), page: 1, kind: 'photo', w: 1600, h: 900, on: [{ page: 1, n: 1 }] },
    { url: u(2), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 1 }] },
    { url: u(3), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 2 }] },
    { url: u(4), page: 2, kind: 'photo', w: 700, h: 1200, tall: true, on: [{ page: 2, n: 3 }] },
    { url: u(5), page: 3, kind: 'photo', w: 900, h: 1400, tall: true, on: [{ page: 3, n: 1 }] },
    { url: u(6), page: 5, kind: 'photo', w: 1672, h: 941, on: [{ page: 5, n: 1 }] },
    { url: u(7), page: 6, kind: 'plan', tone: 'light', w: 2048, h: 1448, on: [{ page: 6, n: 1 }] },
    { url: u(8), page: 7, kind: 'plan', tone: 'light', w: 2048, h: 1448, on: [{ page: 7, n: 1 }] },
    { url: u(9), page: 8, kind: 'plan', tone: 'light', w: 2048, h: 1448, on: [{ page: 8, n: 1 }] },
    { url: u(10), page: 12, kind: 'photo', w: 2400, h: 1350, on: [{ page: 12, n: 1 }] }
] };
const planned = (n, name) => page(n, 'model', { model: model(name, 97, null), images: [{ n: 1, role: 'plan', caption: null }] });
const lend = readingToBrochure({ ...reading, pages: [
    page(1, 'cover', { title: 'لامير سيرين', images: [{ n: 1, role: 'exterior', caption: null }] }),
    page(2, 'photos', { images: [1, 2, 3].map((n) => ({ n, role: 'interior', caption: 'غرفة ' + n })) }),
    page(3, 'amenities', { title: 'الضمانات', figures: [{ value: '10 سنوات', label: 'الهيكل' }, { value: '1 سنة', label: 'السباكة' }], images: [{ n: 1, role: 'interior', caption: null }] }),
    page(4, 'amenities', { title: 'مميزات المشروع', bullets: ['مداخل ذكية', 'أسقف عالية'] }),
    page(5, 'other', { title: 'نماذج الوحدات', images: [{ n: 1, role: 'plan3d', caption: null }] }),
    planned(6, 'شقة 1'), planned(7, 'شقة 2'), planned(8, 'شقة 3'),
    page(9, 'model', { model: model('شقة 4', 41, null) }), page(10, 'model', { model: model('شقة 5', 50, null) }),
    page(11, 'contact', { title: 'تواصل معنا' }), page(12, 'cover', { title: 'لامير سيرين', images: [{ n: 1, role: 'exterior', caption: null }] })
] }, lendMedia, { id: 'r1' });
const lp = lend.spec.pages, lfx = brochureFacts(lend.project);
const urlOf = (pg) => lfx.images[pg.images[0]].url;
t('lent photos: the unused one first (the guarantees page photo that is not printed), shown whole, not as a detail',
    lp[3].kind === 'features' && lp[3].variant === 'photo' && urlOf(lp[3]) === u(5) && lp[3].lent === true && !lp[3].detail, lp[3]);
t('lent photos: a model without a plan takes the 3D unit render shown only as the models opener thumbnail, marked as lent',
    lp[4].variant === 'chapter' && urlOf(lp[8]) === u(6) && lfx.images[lp[8].images[0]].kind === 'plan3d' && lp[8].lent === true && !lp[8].detail, lp[8]);
t('lent photos: with nothing unused left, the largest photo shown far away is printed as a close detail, with a note naming its page',
    urlOf(lp[9]) === u(5) && lp[9].detail === true && lend.notes.some((n) => /صفحة 4، 9، 10: بلا صورة.*\(صفحة 10 تفصيل مقرّب من صورة صفحة 4، إذ لا صورة أخرى لم تُعرض\)/.test(n))
    && validateSpec(lend.spec, lfx).length === 0, [lp[9], lend.notes]);
t('lent photos: the image keeps its pixel size for the print frame; a picture from the closing page of the developer (now the Mulaem back cover) is never lent',
    lfx.images[lp[9].images[0]].w === 900 && lfx.images[lp[9].images[0]].h === 1400 && !lfx.images.some((im) => im.url === u(10)) && lp[11].kind === 'back');

// ---- قواعد عامة من مراجعة أربعة بروشورات أخرى (2026-10-28): كل بروشور مطوّر لا بروشور لامير وحده ----
const v = (n) => 'https://img.test/brochures/r1/v-' + n + '.jpg';
const pg = (n, role, extra) => page(n, role, extra);
const build = (pages, images, extra = {}) => readingToBrochure({ version: 2, project: { name: 'نقش', developer: 'Alramz', city: 'جدة', district: 'أبحر', ...(extra.project || {}) }, pages, missing: [], conflicts: [], dropped: 0 },
    { version: 2, pages: pages.length, read: pages.length, images, fills: extra.fills || [], links: extra.links || [] }, { id: 'r1' });
const kindsOf = (b) => b.spec.pages.map((p) => p.kind + ':' + p.variant).join(' ');

t('areaIn: the Arabic decimal comma and decimal sign are decimals (١٦٨,١٥م٢ ← 168.15), not a room of 15 m²',
    areaIn('صالة معيشة ١٦٨,١٥م٢') === 168.15 && areaIn('١١٤,٢٣م٢') === 114.23 && areaIn('168,15 م2') === 168.15 && areaIn('١٦٨٫١٥ م2') === 168.15 && areaIn('مساحتها 97 م2') === 97);
t('tidy: a Latin letter inside a stretched Arabic word moves to its end, brackets lose inner spaces', tidyText('نمBوذج') === 'نموذج B' && tidyText('( 4 ) غرف') === '(4) غرف');
// «نقش»: «نـــمــC ـــوذج» عنوان صفحة النماذج كما قُرئ، بمسافة بين الحرف والكشيدة
const stretched = build([pg(1, 'cover'), pg(2, 'other', { title: 'نـــمــC ـــوذج' }), pg(3, 'contact')], []);
t('a space between a Latin letter and a kashida belongs to the stretched word («نـــمــC ـــوذج» ← «نموذج C»)',
    JSON.stringify(stretched.spec.pages).includes('نموذج C') && !JSON.stringify(stretched.spec.pages).includes('نمC'), stretched.spec.pages.map((x) => x.text && x.text.title));
const stretched2 = build([pg(1, 'cover'), pg(2, 'other', { title: 'نـــمــ Cـــوذج' }), pg(3, 'contact')], []);
const dashed = build([pg(1, 'cover'), pg(2, 'other', { title: 'Tower A ـ B' }), pg(3, 'other', { title: 'النماذج A ـ B ـ C' }), pg(4, 'other', { title: 'www.lamer.sa ـ info@lamer.sa' }), pg(5, 'contact')], []);
const dashedText = JSON.stringify(dashed.spec.pages);
t('a kashida between Latin words is a dash: dropped, never joining them («Tower A ـ B» ← «Tower A B»); the other spacing still joins',
    JSON.stringify(stretched2.spec.pages).includes('نموذج C') && dashedText.includes('Tower A B') && dashedText.includes('النماذج A B C')
    && dashedText.includes('www.lamer.sa info@lamer.sa') && !dashedText.includes('AB') && !dashedText.includes('lamer.sainfo'), dashed.spec.pages.map((x) => x.text && x.text.title));

// المخطط لا يُحذف لأن عليه مساحة غرفة: التناقض مساحةُ وحدة (60% من النموذج فأكثر)
const roomLabel = build([pg(1, 'cover'), pg(2, 'model', { model: model('A', 168, 'غرفة نوم ١٥م٢'), images: [{ n: 1, role: 'plan', caption: null }] }), pg(3, 'contact')],
    [{ url: v(1), page: 2, kind: 'plan', tone: 'dark', w: 900, h: 700, on: [{ page: 2, n: 1 }] }]);
t('a room size printed on a plan is not a contradiction; the plan is shown', roomLabel.spec.pages[1].variant === 'plan' && !roomLabel.notes.some((n) => /مكتوب عليه/.test(n)), roomLabel.notes);

// فاصل «نموذج A» ثم صفحات أدواره بلا اسم: الاسم من الفاصل والدور من عنوان الصفحة؛ ونموذج بلا اسم ولا فاصل عنوانه مساحته
const floors = build([pg(1, 'cover'), pg(2, 'other', { title: 'نموذج A' }),
    pg(3, 'model', { title: 'مكونات الدور الأرضي', model: model(null, null, null, { parts: ['مجلس', 'جناح نوم رئيسي', 'يحتوي على غرفه ملابس + دورة مياة'] }) }),
    pg(4, 'model', { title: 'مكونات الدور الاول', model: model(null, null, null) }),
    pg(5, 'other', { title: 'نـــمـــBـــوذج' }), pg(6, 'model', { title: 'مكونات الدور الأرضي', model: model(null, null, null) }),
    pg(7, 'amenities', { title: 'مميزات', bullets: ['مصعد'] }), pg(8, 'model', { model: model(null, 282, null) }), pg(9, 'contact')], []);
const fm = floors.project.details.models;
t('model names carry from the divider before their floors, the floor from the page title; a stretched «نمBوذج» reads «نموذج B»',
    fm[0].name === 'نموذج A' && fm[0].floor === 'الدور الأرضي' && fm[1].name === 'نموذج A' && fm[1].floor === 'الدور الاول' && fm[2].name === 'نموذج B' && fm[3].name === null, fm.map((m) => [m.name, m.floor]));
t('a model with no name is reported, and its divider pages open the models', floors.notes.some((n) => /صفحة 8: لم يُقرأ اسم النموذج/.test(n)) && floors.spec.pages[1].variant === 'chapter' && floors.spec.pages[4].variant === 'chapter');
const ff = brochureFacts(floors.project, {});
t('a model page without plan or photo is the wide layout, never a blank half', floors.spec.pages[2].variant === 'wide' && validateSpec(floors.spec, ff).length === 0, validateSpec(floors.spec, ff));

// لقطة الحياة (صورة بشر هي الصورة الوحيدة في صفحة المطوّر) تُطبع؛ وصورة المصافحة على صفحة التواصل لا
const life = build([pg(1, 'cover'), pg(2, 'about', { title: 'المقدمة', body: 'نؤمن بأن أمان الإنسان في مسكنه.', images: [{ n: 1, role: 'people', caption: null }] }),
    pg(3, 'photos', { images: [{ n: 1, role: 'people', caption: null }, { n: 2, role: 'texture', caption: null }] }),
    pg(4, 'contact', { title: 'تواصل معنا', images: [{ n: 1, role: 'people', caption: null }] }), pg(5, 'cover')],
    [{ url: v(1), page: 2, kind: 'photo', w: 1926, h: 2400, on: [{ page: 2, n: 1 }] }, { url: v(2), page: 3, kind: 'photo', w: 2400, h: 1921, on: [{ page: 3, n: 1 }] },
        { url: v(3), page: 3, kind: 'backdrop', w: 1600, h: 2000, on: [{ page: 3, n: 2 }] }, { url: v(4), page: 4, kind: 'photo', w: 1448, h: 1086, on: [{ page: 4, n: 1 }] }]);
const lifeUrls = life.project.images.map((i) => i.url);
t('a lifestyle photo (the only picture on its page) is printed; stock people on a contact page and backdrops are not',
    life.spec.pages[1].variant === 'split' && life.spec.pages[2].kind === 'photo' && lifeUrls.includes(v(1)) && lifeUrls.includes(v(2)) && !lifeUrls.includes(v(3)) && !lifeUrls.includes(v(4)), kindsOf(life));

// لقطة الحياة تبقى في صفحتها ولا تُستعار لصفحة مزايا؛ وصورة بشر في صفحة ختام («other») مصافحة جاهزة لا تُطبع ولا تُستعار
const stock = build([pg(1, 'cover'), pg(2, 'amenities', { title: 'مميزات المشروع', bullets: ['دخول ذكي', 'مداخل فندقية'] }),
    pg(3, 'photos', { images: [{ n: 1, role: 'people', caption: null }] }), pg(4, 'other', { images: [{ n: 1, role: 'people', caption: null }] }), pg(5, 'contact')],
    [{ url: v(60), page: 3, kind: 'photo', w: 2400, h: 1600, on: [{ page: 3, n: 1 }] }, { url: v(61), page: 4, kind: 'photo', w: 2400, h: 1600, on: [{ page: 4, n: 1 }] }]);
t('a lifestyle photo stays on its own page and is never lent; stock people on a closing page are not printed', stock.spec.pages[2].kind === 'photo'
    && stock.project.images[stock.spec.pages[2].images[0]].url === v(60) && stock.spec.pages[1].variant === 'list' && !stock.project.images.some((i) => i.url === v(61)), kindsOf(stock));

// صفحة صور كل صورها خلفيات تستعير صورة لم تُعرض؛ وصورة يقول المساعد إنها واجهة وهي طبقة لونية لا تُطبع
const lost = build([pg(1, 'cover'), pg(2, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }] }), pg(3, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }, { n: 2, role: 'exterior', caption: null }] }),
    pg(4, 'about', { title: 'عن', body: 'نص طويل عن المشروع.', images: [{ n: 1, role: 'interior', caption: null }, { n: 2, role: 'interior', caption: null }] }), pg(5, 'contact')],
    [{ url: v(1), page: 2, kind: 'backdrop', w: 1240, h: 1754, on: [{ page: 2, n: 1 }] }, { url: v(2), page: 3, kind: 'photo', w: 2400, h: 1600, on: [{ page: 3, n: 1 }] },
        { url: v(3), page: 3, kind: 'photo', w: 2400, h: 1600, on: [{ page: 3, n: 2 }] }, { url: v(4), page: 4, kind: 'photo', w: 1200, h: 900, on: [{ page: 4, n: 1 }] },
        { url: v(5), page: 4, kind: 'photo', w: 1600, h: 1200, on: [{ page: 4, n: 2 }] }]);
t('a backdrop is never printed whatever the reading calls it; a photo page that lost its photos is not an empty pause page',
    !lost.project.images.some((i) => i.url === v(1)) && lost.spec.pages[1].kind === 'photo' && lost.project.images[lost.spec.pages[1].images[0]].url === v(5)
    && lost.notes.some((n) => /تُركت 1 صورة/.test(n)), kindsOf(lost));

// لوحة صور المطوّر (صورتان في ملف واحد) أجزاءً: صفحتها صورتان متجاورتان
const coll = build([pg(1, 'cover'), pg(2, 'photos', { images: [{ n: 1, role: 'interior', caption: null }] }), pg(3, 'contact')],
    [{ url: v(1), page: 2, kind: 'photo', alpha: true, w: 1240, h: 1754, on: [{ page: 2, n: 1 }],
        parts: [{ url: v('1a'), w: 540, h: 700, tall: true }, { url: v('1b'), w: 540, h: 700, tall: true }] }]);
t('a developer collage of two framed photos prints as its two photos, not one sliced canvas', coll.spec.pages[1].kind === 'pair'
    && coll.spec.pages[1].images.map((i) => coll.project.images[i].url).join() === v('1a') + ',' + v('1b') && !coll.project.images.some((i) => i.url === v(1)), kindsOf(coll));

// الموقع: المسافات المطبوعة تبقى، ورابط الخرائط يُنسب إلى صفحة الموقع
const loc = build([pg(1, 'cover'), pg(2, 'location', { title: 'احتياجاتك تحيط بك', body: 'يقع المشروع في أبحر.', figures: [{ value: '7 دقائق', label: 'عن جدة سوبردوم' }, { value: '10 دقائق', label: 'عن المطار' }] }),
    pg(3, 'location', { title: 'موقع المشروع' }), pg(4, 'contact')], [], { links: [{ page: 3, url: 'https://maps.app.goo.gl/abc' }, { page: 3, url: 'https://wa.me/9665' }] });
t('location: the printed drive times stay with the page, and the developer\'s maps link goes to its location page (not a WhatsApp link)',
    loc.spec.pages[1].text.figures.length === 2 && loc.spec.pages[2].link === 'https://maps.app.goo.gl/abc' && !loc.spec.pages[1].link);

// المزايا: كل سطر مدة (بالكلمة أيضاً) ← أرقام حتى 12؛ قائمة وأرقام ← حقلان؛ رقم عنوانه سطر في القائمة يُدمج في سطره؛ وسطر بلا عدد تحت الأرقام
const warr = ['سنة ضمان شامل للوحدة السكنية', '25 سنة ضمان عدادات الكهرباء', '3 سنوات ضمان للإضاءة', '10 سنوات ضمان للهيكل الإنشائي', 'سنة ضمان للدهان', '15 سنة ضمان للمواسير الحرارية',
    '5 سنوات ضمان لتمديدات السباكة', '10 سنوات ضمان للعزل المائي والحراري', 'سنة ضمان للأبواب', '5 سنوات ضمان للتمديدات الكهربائية', 'سنتين ضمان للمصاعد'];
const am = build([pg(1, 'cover'),
    pg(2, 'amenities', { title: 'الضمانات', bullets: warr, figures: [{ value: '25 سنة', label: 'ضمان عدادات الكهرباء' }] }),
    pg(3, 'amenities', { title: 'مميزات المشروع', bullets: ['موقع مميز', 'تصميم بوهيمي', 'أسقف عالية'], figures: [{ value: '5 دقايق', label: 'يبعد عن الكورنيش' }, { value: '10 دقايق', label: 'يبعد عن المطار' }] }),
    pg(4, 'amenities', { title: 'مميزات المشروع', bullets: ['مصعد أتوماتيك بالكامل', 'دخول ذكي'], figures: [{ value: '2', label: 'مصعد أتوماتيك بالكامل' }] }),
    pg(5, 'amenities', { title: 'ضمانات المشروع', bullets: ['تأمين ضد العيوب الخفية'], figures: [{ value: '20 سنة', label: 'الهيكل الانشائي' }, { value: '25 سنة', label: 'الافياش' }, { value: '5 سنوات', label: 'الكهرباء' }] }),
    pg(6, 'contact')], []);
const ap = am.spec.pages;
t('amenities: eleven warranties (one written «سنتين») are all numbers, none dropped', ap[1].variant === 'numbers' && ap[1].text.bullets.length === 11);
t('amenities: a list with headline figures is two fields (list and figures), not figures alone', ap[2].variant === 'mixed' && ap[2].text.bullets.length === 3 && ap[2].text.figures.length === 2);
t('amenities: a figure whose label is a line of the list joins its line («2 مصعد أتوماتيك بالكامل»)', ap[3].variant === 'list' && ap[3].text.bullets[0] === '2 مصعد أتوماتيك بالكامل' && !ap[3].text.figures.length, ap[3]);
t('amenities: numbers with a line that has no number keep that line under the numbers', ap[4].variant === 'numbers' && (ap[4].extra || []).join() === 'تأمين ضد العيوب الخفية', ap[4]);

// التواصل قبل الأخيرة دعوة ملائم (الرقم وكلام المطوّر صغيراً)؛ وآخر صفحة فيها نقاط (جدول توفّر) لا يبقى عنوانها يتيماً على الغلاف الخلفي
const ends = build([pg(1, 'cover', { title: 'نقش', subtitle: 'وحدات سكنية جاهزه' }), pg(2, 'contact', { title: 'للاسفسارات', body: 'نود الإحاطة بأن المخططات المعروضة لأغراض توضيحية.' }),
    pg(3, 'photos', { title: 'صورة' }), pg(4, 'other', { title: 'افراغ فوري', bullets: ['متاح', 'محجوز'] })], []);
t('a contact page before the end is the Mulaem call page; a last page with a list leaves the back cover clean and a note names it', ends.spec.pages[1].kind === 'statement' && ends.spec.pages[1].call === true
    && ends.spec.pages[3].kind === 'back' && !ends.spec.pages[3].text && ends.notes.some((n) => /صفحة 4 الأخيرة/.test(n)), kindsOf(ends));
const endLine = build([pg(1, 'cover', { title: 'نقش' }), pg(2, 'contact', { title: 'للاسفسارات' }), pg(3, 'photos', { title: 'صورة' }), pg(4, 'other', { title: 'افراغ فوري' })], []);
const endFigs = build([pg(1, 'cover', { title: 'نقش' }), pg(2, 'contact', { title: 'للاسفسارات' }), pg(3, 'photos', { title: 'صورة' }),
    pg(4, 'other', { title: 'الأسعار', figures: [{ value: '435000', label: 'نموذج A' }] })], []);
const endBare = build([pg(1, 'cover', { title: 'نقش' }), pg(2, 'contact', { title: 'للاسفسارات' }), pg(3, 'photos', { title: 'صورة' }),
    pg(4, 'other', { bullets: ['متاح', 'محجوز'] })], []);
t('a last page with figures, or with text but no title, leaves the back cover clean and a note says what was not printed',
    !endFigs.spec.pages[3].text && endFigs.notes.some((n) => n.startsWith('صفحة 4 الأخيرة («الأسعار»)'))
    && !endBare.spec.pages[3].text && endBare.notes.some((n) => /^صفحة 4 الأخيرة فيها كلام/.test(n)), [endFigs.notes, endBare.notes]);
t('a last page that is only a closing line («افراغ فوري») is printed on the back cover', endLine.spec.pages[3].kind === 'back'
    && endLine.spec.pages[3].text && endLine.spec.pages[3].text.title === 'افراغ فوري' && !endLine.notes.some((n) => /صفحة 4 الأخيرة/.test(n)), kindsOf(endLine));
t('the cover carries the line the developer printed under the name, not the Latin name', ends.spec.pages[0].text.subtitle === 'وحدات سكنية جاهزه'
    && !build([pg(1, 'cover', { subtitle: 'NQSH' }), pg(2, 'contact')], [], { project: { name_latin: 'NQSH' } }).spec.pages[0].text);

// اسم المطوّر اللاتيني بالعربية كما طُبع في صفحة؛ وعدد الوحدات ومدى المساحات من نص «عن المشروع» الذي يسمّيه
const named = build([pg(1, 'cover'), pg(2, 'about', { title: 'عن الـرمـز', body: 'تأسست شركة الرمز للعقارات في عام 2016م.' }),
    pg(3, 'about', { body: 'يأتي مشروع نقش أبحر ليقدِّم 75 فلة سكنية بمساحات تتراوح ما بين 196.45م2 وحتى 220م2 يمتاز بتصميمه.' }), pg(4, 'contact')], []);
t('the developer\'s Latin name is printed in Arabic as its own pages print it (Alramz ← الرمز), with a note', named.project.details.developer === 'الرمز' && named.notes.some((n) => /Alramz/.test(n)));
t('units and the area range come from the about text that names the project, as printed', named.project.details.units_count === 75
    && JSON.stringify(named.project.details.area_range) === '[196.45,220]');

// صورة الغلاف: الواجهة التي أفرد لها المطوّر صفحة في أول البروشور (فتصير صفحتها الفهرس) قبل واجهة أعرض بعيدة
const hero = build([pg(1, 'cover'), pg(2, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }] }), pg(3, 'about', { title: 'عن', body: 'نص.' }), pg(4, 'about', { title: 'ب', body: 'نص.' }),
    pg(5, 'about', { title: 'ج', body: 'نص.' }), pg(6, 'about', { title: 'د', body: 'نص.' }), pg(7, 'about', { title: 'ه', body: 'نص.' }), pg(8, 'photos', { images: [{ n: 1, role: 'exterior', caption: 'انتقالة عمرانية' }] }), pg(9, 'contact')],
    [{ url: v(1), page: 2, kind: 'photo', w: 2400, h: 1923, on: [{ page: 2, n: 1 }] }, { url: v(2), page: 8, kind: 'photo', w: 2400, h: 1921, on: [{ page: 8, n: 1 }] }]);
t('the cover photo is the early solo facade, whose page becomes the contents; the later facade keeps its own page and caption',
    hero.project.images[hero.spec.pages[0].images[0]].url === v(1) && hero.spec.pages[1].variant === 'contents' && hero.spec.pages[7].kind === 'photo'
    && hero.project.images[hero.spec.pages[7].images[0]].caption === 'انتقالة عمرانية', kindsOf(hero));

// صفحات الصور المتتالية: الطولية بنسبتها تتبادل جانباها، واللقطة الضعيفة بينها لوحة
const tallImgs = Array.from({ length: 4 }, (_, k) => ({ url: v(10 + k), page: k + 2, kind: 'photo', w: 960, h: 1280, tall: true, detail: k === 2 ? 0.01 : 0.08, on: [{ page: k + 2, n: 1 }] }));
const run4 = build([pg(1, 'cover'), ...[2, 3, 4, 5].map((n) => pg(n, 'photos', { images: [{ n: 1, role: 'interior', caption: null }] })), pg(6, 'contact')], tallImgs);
const rv = run4.spec.pages.slice(1, 5);
t('a run of portrait photos is not squeezed into strips: own ratio, alternating sides, and the weak shot as a small plate',
    rv.map((p) => p.variant).join() === 'tall,tall,plate,tall' && rv[0].side !== rv[1].side && validateSpec(run4.spec, brochureFacts(run4.project, {})).length === 0, rv);

// عائلة لون البروشور من صور المشروع، والداخلية عُشر صوت؛ ولون المطوّر المسطّح في صفحتين فأكثر صوتٌ لعائلة حين لا صور تقرر،
// ولا يُطبع اللون نفسه (الاتجاه الفني يختار ألوانه من مجموعاته: «ابغا ذوق المصمم اللي سويناه»)
const brand = build([pg(1, 'cover'), pg(2, 'contact')], [], { fills: [{ page: 1, hex: '#212C2A', share: 0.96 }, { page: 2, hex: '#23302D', share: 0.77 }] });
t('without photos the developer\'s flat colour only names the family (teal for #212C2A), with a note; the colour itself is not kept',
    brand.project.details.palette === 'teal' && !('colours' in brand.project.details) && brochureFacts(brand.project, {}).family === 'teal'
    && brand.notes.some((n) => /#212C2A/.test(n) && /عائلة/.test(n)), brand.project.details);
const branded = build([pg(1, 'cover', { images: [{ n: 1, role: 'exterior', caption: null }] }), pg(2, 'contact')],
    [{ url: v(1), page: 1, kind: 'photo', w: 2400, h: 1600, deep: 'bronze', on: [{ page: 1, n: 1 }] }], { fills: [{ page: 1, hex: '#212C2A', share: 0.3 }, { page: 2, hex: '#23302D', share: 0.77 }] });
t('the photos decide the family before the developer\'s layout colour', branded.project.details.palette === 'bronze' && branded.notes.some((n) => /صور المشروع/.test(n)), branded.notes);
const rooms = build([pg(1, 'cover', { images: [{ n: 1, role: 'exterior', caption: null }] }), ...[2, 3, 4, 5, 6, 7].map((n) => pg(n, 'photos', { images: [{ n: 1, role: 'interior', caption: null }] })), pg(8, 'contact')],
    [{ url: v(1), page: 1, kind: 'photo', w: 1427, h: 1840, deep: 'navy', on: [{ page: 1, n: 1 }] }, ...[2, 3, 4, 5, 6, 7].map((n) => ({ url: v(n + 20), page: n, kind: 'photo', w: 960, h: 1280, deep: 'bronze', on: [{ page: n, n: 1 }] }))]);
t('beige interiors do not outvote the cover: the palette follows the night render', rooms.project.details.palette === 'navy', rooms.project.details.palette);

// رسوم المطوّر الخطية (لا صورة نقطية فيها): مخطط النموذج، والدور المتكرر لوحةً بعنوانه، والخريطة
const vec = build([pg(1, 'cover'), pg(2, 'location', { title: 'موقع المشروع', body: 'يقع في حي الريان.' }),
    pg(3, 'model', { title: 'نموذج A', model: model(null, 116, null) }), pg(4, 'other', { title: 'الطابق المتكرر' }), pg(5, 'contact')],
    [{ url: v(30), page: 2, kind: 'photo', vector: true, w: 1600, h: 1400, on: [{ page: 2, n: 1 }] },
        { url: v(31), page: 3, kind: 'plan', vector: true, w: 1800, h: 1500, crop: { unit: [0.1, 0.1, 0.9, 0.9], key: null }, on: [{ page: 3, n: 1 }] },
        { url: v(32), page: 4, kind: 'plan', vector: true, w: 2000, h: 1200, on: [{ page: 4, n: 1 }] }]);
const vp = vec.spec.pages;
const words2 = build([pg(1, 'cover'), pg(2, 'location', { title: 'قريب من', bullets: ['سوق المرجان', 'طريق الحرمين'] }), pg(3, 'contact')],
    [{ url: v(33), page: 2, kind: 'photo', vector: true, w: 1600, h: 1400, on: [{ page: 2, n: 1 }] }]);
t('vector drawings: a location page that lists its landmarks as words does not take a drawing (the same words outlined) as its map', words2.spec.pages[1].variant === 'text', kindsOf(words2));
t('vector drawings: a model page without a raster plan uses the plan drawn on its page; a floor plate is a plate with its title; a drawn map is the map',
    vp[2].variant === 'plan' && vec.project.details.models[0].plan === v(31) && vp[3].kind === 'photo' && vp[3].variant === 'plate'
    && vec.project.images[vp[3].images[0]].kind === 'plan' && vp[1].variant === 'map' && validateSpec(vec.spec, brochureFacts(vec.project, {})).length === 0, kindsOf(vec));

// اللقطة نفسها في صفحتين متجاورتين: صفحة الكلام تترك صورتها؛ وصفحة «المحتويات» في بروشور المطوّر يصير مكانها فهرس ملائم حين تأخذ
// صفحة صورة الغلاف صورة لم تُعرض (فلا فهرسان ولا صورة الغلاف مرتين)
const view = (n) => '1'.repeat(n) + '0'.repeat(64 - n);
const twin = build([pg(1, 'cover'), pg(2, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }] }), pg(3, 'about', { title: 'المقدمة', body: 'نؤمن بأن أمان الإنسان في مسكنه.' }),
    pg(4, 'other', { title: 'المحتويات', bullets: ['عن الرمز', 'حول', 'احتياجاتك تحيط بك'] }), pg(5, 'about', { title: 'عن الرمز', body: 'تأسست شركة الرمز.' }),
    pg(6, 'about', { body: 'يأتي مشروع نقش أبحر.', images: [{ n: 1, role: 'exterior', caption: null }] }), pg(7, 'photos', { images: [{ n: 1, role: 'exterior', caption: 'انتقالة عمرانية' }] }), pg(8, 'contact')],
    [{ url: v(40), page: 2, kind: 'photo', w: 2400, h: 1923, view: view(0), on: [{ page: 2, n: 1 }] },
        { url: v(41), page: 6, kind: 'photo', w: 1922, h: 2400, tall: true, view: view(40), on: [{ page: 6, n: 1 }] },
        { url: v(42), page: 7, kind: 'photo', w: 2400, h: 1921, view: view(34), on: [{ page: 7, n: 1 }] }]);
const tw = twin.spec.pages;
t('same view on neighbouring pages: the text page leaves its photo (about text), with a note', tw[5].kind === 'about' && tw[5].variant === 'text' && !tw[5].images
    && twin.project.images[tw[6].images[0]].url === v(42) && twin.notes.some((n) => /صفحة 6: صورتها المنظر نفسه/.test(n)), kindsOf(twin));
t('the developer\'s contents page becomes Mulaem\'s contents; the cover-photo page takes the photo left unused, so neither repeats',
    tw[3].variant === 'contents' && tw[1].kind === 'photo' && twin.project.images[tw[1].images[0]].url === v(41) && twin.project.images[tw[0].images[0]].url === v(40)
    && tw.filter((p) => p.variant === 'contents').length === 1 && validateSpec(twin.spec, brochureFacts(twin.project, {})).length === 0, kindsOf(twin));
const noSpare = build([pg(1, 'cover'), pg(2, 'photos', { images: [{ n: 1, role: 'exterior', caption: null }] }), pg(3, 'about', { title: 'المقدمة', body: 'نص.' }),
    pg(4, 'other', { title: 'المحتويات', bullets: ['عن الرمز', 'حول'] }), pg(5, 'contact')], [{ url: v(40), page: 2, kind: 'photo', w: 2400, h: 1923, on: [{ page: 2, n: 1 }] }]);
t('without a spare photo the contents stay on the cover-photo page and the developer\'s list stays a page of its own', noSpare.spec.pages[1].variant === 'contents'
    && noSpare.spec.pages[3].kind === 'about', kindsOf(noSpare));
// سلسلة صور: لقطة تعيد منظر صورة قبلها (الحمّام نفسه مرتين) لوحةٌ صغيرة
const again = build([pg(1, 'cover'), ...[2, 3, 4, 5].map((n) => pg(n, 'photos', { images: [{ n: 1, role: 'interior', caption: null }] })), pg(6, 'contact')],
    [2, 3, 4, 5].map((n) => ({ url: v(50 + n), page: n, kind: 'photo', w: 960, h: 1280, tall: true, detail: 0.08, view: n === 5 ? view(30) : view(n * 14), on: [{ page: n, n: 1 }] })));
t('a photo that repeats the view of an earlier one in its run is a small plate', again.spec.pages.slice(1, 5).map((p) => p.variant).join() === 'tall,tall,tall,plate', kindsOf(again));

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
