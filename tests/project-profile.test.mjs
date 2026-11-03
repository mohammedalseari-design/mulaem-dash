// اختبار crm/js/project-profile.js: التبويب من الرابط ورجوعه إليه، وصور المشروع (https وحده بلا تكرار)، والوصف والمميزات،
// وحقائق «معلومات المشروع» (عدد الوحدات ورخصة الإعلان وانتهاؤها)، ورابط خرائط Google، وبطاقات «المخططات»، ورفع بروشور
// المطور: عنوان الطلب الذي يُعرف به، وفحص الملف، ومراحل الطلب من حالته ومسوداته، ومتى يُعرض عند فتح الصفحة.
// التشغيل: node tests/project-profile.test.mjs   أو   deno run tests/project-profile.test.mjs
import {
    PROJECT_TABS, DEFAULT_TAB, parseProjectRoute, projectHash, wrapIndex, firstText, constructionLabel, httpsUrl,
    projectImages, MAX_IMAGES, galleryPlan, projectAbout, projectFeatures, MAX_FEATURES, unitsCount, adLicense, licenseState,
    projectFacts, mapsLink, placeLines, planCards, specsText, BROCHURE_TITLE_PREFIX, brochureTitle, brochureInstruction,
    brochureTitleMatches, latestBrochure, pdfName, fileSizeText, fileProblem, pagesProblem, uploadSummary, brochureProgress,
    uploadingProgress, showOnLoad, RECENT_DAYS
} from '../crm/js/project-profile.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NBSP = '\u00a0';
const MB = 1048576;

/* ===================== التبويب والرابط ===================== */

t('three tabs, profile first and default', same(PROJECT_TABS.map((x) => x.key), ['profile', 'plans', 'bookings']) && DEFAULT_TAB === 'profile'
    && same(PROJECT_TABS.map((x) => x.label), ['البروفايل', 'المخططات', 'الحجوزات']));
t('route: id alone', same(parseProjectRoute('12'), { id: '12', tab: null }));
t('route: id with a known tab', same(parseProjectRoute('12?tab=plans'), { id: '12', tab: 'plans' })
    && same(parseProjectRoute('7?tab=bookings'), { id: '7', tab: 'bookings' }));
t('route: tab among other params', same(parseProjectRoute('12?x=1&tab=bookings&y=2'), { id: '12', tab: 'bookings' }));
t('route: unknown or odd tab → default', parseProjectRoute('12?tab=evil').tab === null && parseProjectRoute('12?tab=Plans').tab === null
    && parseProjectRoute('12?tabs=plans').tab === null && parseProjectRoute('12?').tab === null);
t('route: spaces and nothing', same(parseProjectRoute(' 12 '), { id: '12', tab: null }) && same(parseProjectRoute(null), { id: '', tab: null })
    && same(parseProjectRoute(undefined), { id: '', tab: null }));
t('route: a bad id stays as written (project.js rejects it)', parseProjectRoute('abc?tab=plans').id === 'abc');
t('hash: default tab has no suffix', projectHash(12, 'profile') === '#/project/12' && projectHash(12, null) === '#/project/12');
t('hash: other tabs carry ?tab=', projectHash(12, 'plans') === '#/project/12?tab=plans' && projectHash('5', 'bookings') === '#/project/5?tab=bookings');
t('hash: unknown tab ignored', projectHash(12, 'x') === '#/project/12');
t('hash ↔ route round trip', PROJECT_TABS.every((tab) => {
    const back = parseProjectRoute(projectHash(44, tab.key).replace('#/project/', ''));
    return back.id === '44' && (back.tab || DEFAULT_TAB) === tab.key;
}));
t('wrap index both ways', wrapIndex(3, 3) === 0 && wrapIndex(-1, 3) === 2 && wrapIndex(5, 3) === 2 && wrapIndex(1, 3) === 1);
t('wrap index of nothing', wrapIndex(2, 0) === 0 && wrapIndex('x', 4) === 0);

/* ===================== القيم ===================== */

t('first text skips blanks and objects', firstText(null, '  ', {}, ['x'], ' دار المسكن ') === 'دار المسكن' && firstText(0) === '0' && firstText() === '');
t('construction label: stored value gets its space', constructionLabel('تحت_الإنشاء') === 'تحت الإنشاء' && constructionLabel('جاهز للسكن') === 'جاهز للسكن'
    && constructionLabel(null) === '');
t('https only', httpsUrl('https://x.co/a.jpg') === 'https://x.co/a.jpg' && httpsUrl('http://x.co/a.jpg') === null
    && httpsUrl('javascript:alert(1)') === null && httpsUrl('https://x.co/a b.jpg') === null && httpsUrl(42) === null);

/* ===================== الصور ===================== */

const imgs = projectImages({
    images: [
        'https://cdn.example/1.jpg',
        { url: 'https://cdn.example/2.jpg', caption: '  صورة الواجهة  ' },
        'https://cdn.example/1.jpg',
        'http://old.example/3.jpg',
        'data:image/png;base64,AAAA',
        { url: 42 },
        null,
        { url: ' https://cdn.example/4.jpg ', caption: { x: 1 } },
        'javascript:alert(1)'
    ]
});
t('images: https only, in order, no duplicates', same(imgs.map((i) => i.url), ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg', 'https://cdn.example/4.jpg']));
t('images: captions trimmed, missing = null', imgs[0].caption === null && imgs[1].caption === 'صورة الواجهة' && imgs[2].caption === null);
t('images: none or not a list', projectImages({}).length === 0 && projectImages({ images: 'https://x.co/a.jpg' }).length === 0 && projectImages(null).length === 0);
t('images: capped', projectImages({ images: Array.from({ length: 90 }, (_, i) => 'https://x.co/' + i + '.jpg') }).length === MAX_IMAGES);
t('gallery: five tiles at most, «كل الصور» from two', same(galleryPlan(0), { shown: 0, all: 0 }) && same(galleryPlan(1), { shown: 1, all: 0 })
    && same(galleryPlan(3), { shown: 3, all: 3 }) && same(galleryPlan(24), { shown: 5, all: 24 }));

/* ===================== الوصف والمميزات ===================== */

t('about: description first', same(projectAbout({ details: { description: 'أبراج سكنية' }, notes: 'أبراج سكنية' }), { text: 'أبراج سكنية', notes: null }));
t('about: notes when no description', same(projectAbout({ details: {}, notes: '  دفعة أولى 10%  ' }), { text: 'دفعة أولى 10%', notes: null }));
t('about: different notes kept under it', same(projectAbout({ details: { description: 'وصف' }, notes: 'ملاحظة' }), { text: 'وصف', notes: 'ملاحظة' }));
t('about: paragraphs kept, extra blank lines dropped', projectAbout({ details: { description: 'سطر\r\n\r\n\r\n\nسطر ثانٍ  \nثالث' } }).text === 'سطر\n\nسطر ثانٍ\nثالث');
t('about: nothing', same(projectAbout({ details: { description: '   ' }, notes: null }), { text: null, notes: null }) && same(projectAbout(null), { text: null, notes: null }));
t('features from a list', same(projectFeatures({ details: { amenities: ['مسبح على السطح', ' نادي رياضي ', '', null, { a: 1 }, 'مسبح على السطح'] } }),
    ['مسبح على السطح', 'نادي رياضي']));
t('features: amenities before features', same(projectFeatures({ details: { amenities: ['أ'], features: ['ب'] } }), ['أ'])
    && same(projectFeatures({ details: { features: ['ب'] } }), ['ب']));
t('features from text lines, bullets removed', same(projectFeatures({ details: { features: '- أمن 24 ساعة\n• مواقف خاصة\n1. قريب من الكورنيش\n\n' } }),
    ['أمن 24 ساعة', 'مواقف خاصة', 'قريب من الكورنيش']));
t('features: a number keeps its digits', same(projectFeatures({ details: { features: ['24 ساعة أمن'] } }), ['24 ساعة أمن']));
t('features capped and none', projectFeatures({ details: { features: Array.from({ length: 30 }, (_, i) => 'ميزة ' + i) } }).length === MAX_FEATURES
    && projectFeatures({}).length === 0 && projectFeatures({ details: { features: 5 } }).length === 0);

/* ===================== الحقائق ===================== */

const ROWS = [{ ord: 1, total: 12 }, { ord: 2, total: 16 }, { ord: 3, total: 8 }, { ord: 4, total: 4 }];
t('units: sum of the models', unitsCount({}, ROWS) === 40);
t('units: written count when no models', unitsCount({ details: { units_count: 40 } }, [{ ord: 0, total: 1 }]) === 40
    && unitsCount({ details: { aptCount: '٢٤' } }, []) === 24 && unitsCount({ details: { units_count: '12' } }, null) === 12);
t('units: a whole property is one unit', unitsCount({ details: {} }, [{ ord: 0, total: 1 }]) === 1);
t('units: nothing known', unitsCount({ details: { units_count: 0, aptCount: 'كثير' } }, []) === null && unitsCount(null, null) === null);
t('ad license: column, then details', adLicense({ rega_ad_license: ' 7200457812 ' }) === '7200457812'
    && adLicense({ rega_ad_license: '', details: { license: '1100058276' } }) === '1100058276'
    && adLicense({ details: { rega_license: 99 } }) === '99' && adLicense({}) === null);
t('license expiry states', licenseState('2026-11-03', '2026-11-04') === 'expired' && licenseState('2026-11-04', '2026-11-04') === 'soon'
    && licenseState('2026-12-04', '2026-11-04') === 'soon' && licenseState('2026-12-05', '2026-11-04') === 'valid');
t('license expiry: unknown', licenseState(null, '2026-11-04') === null && licenseState('soon', '2026-11-04') === null && licenseState('2026-12-01', null) === null);

const facts = projectFacts({
    rega_ad_license: '7200457812', listing_expires_at: '2026-11-20', delivery_date: '2027-06-30',
    details: { developer_name: 'دار المسكن للتطوير', construction_status: 'تحت_الإنشاء' }
}, ROWS, '2026-11-04');
t('facts: developer from its other names', facts.developer === 'دار المسكن للتطوير');
t('facts: status label', facts.status === 'تحت الإنشاء');
t('facts: delivery date when no delivery text', same(facts.delivery, { date: '2027-06-30' }));
t('facts: units and license with its expiry', facts.units === 40 && facts.license === '7200457812' && facts.licenseExpiry === '2026-11-20' && facts.licenseState === 'soon');
const factsText = projectFacts({ delivery_date: '2027-06-30T00:00:00', details: { delivery_time: 'الربع الثاني 2027', developer: 'أ', developer_name: 'ب' } }, [], '2026-11-04');
t('facts: delivery text wins, developer first name wins', same(factsText.delivery, { text: 'الربع الثاني 2027' }) && factsText.developer === 'أ');
const factsNone = projectFacts({}, [], '2026-11-04');
t('facts: all missing', factsNone.developer === null && factsNone.status === null && factsNone.delivery === null && factsNone.units === null
    && factsNone.license === null && factsNone.licenseExpiry === null && factsNone.licenseState === null);

/* ===================== الموقع ===================== */

t('maps: coordinates (numbers or text) are exact', same(mapsLink({ latitude: '21.5433', longitude: 39.1728 }),
    { href: 'https://www.google.com/maps/search/?api=1&query=21.5433,39.1728', exact: true }));
const byAddress = mapsLink({ latitude: 0, longitude: 0, address: 'شارع الأمير سلطان', city: 'جدة' });
t('maps: zero point falls back to the address with the city', byAddress && byAddress.exact === false
    && byAddress.href === 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('شارع الأمير سلطان، جدة'));
t('maps: city not repeated when the address has it', mapsLink({ address: 'حي الشاطئ جدة', city: 'جدة' }).href.endsWith(encodeURIComponent('حي الشاطئ جدة')));
t('maps: out of range or one coordinate → address or nothing', mapsLink({ latitude: 95, longitude: 39 }) === null
    && mapsLink({ latitude: 21.5, longitude: null }) === null && mapsLink({ latitude: true, longitude: true }) === null
    && mapsLink({ latitude: 21.5, longitude: '', address: 'أ' }).exact === false);
t('maps: nothing', mapsLink({}) === null && mapsLink(null) === null);
t('place: district gets «حي», city after it', same(placeLines({ district: 'الشاطئ', city: 'جدة' }), { place: 'حي الشاطئ، جدة', address: null }));
t('place: «حي» or «مخطط» already written', placeLines({ district: 'حي الصفا', city: 'جدة' }).place === 'حي الصفا، جدة'
    && placeLines({ district: 'مخطط الأمير فواز' }).place === 'مخطط الأمير فواز');
t('place: the address when it adds something', placeLines({ district: 'الشاطئ', city: 'جدة', address: 'شارع الكورنيش' }).address === 'شارع الكورنيش'
    && placeLines({ district: 'الشاطئ', address: 'الشاطئ' }).address === null);
t('place: city only, nothing', same(placeLines({ city: 'جدة' }), { place: 'جدة', address: null }) && same(placeLines(null), { place: null, address: null }));

/* ===================== «المخططات» ===================== */

const BOARD = [
    { ord: 0, key: 'كامل العقار', total: 1, available: 1 },
    { ord: 1, key: 'نموذج A', rooms: 3, bathrooms: 2, area: 165, price: 1250000, total: 12, available: 6, reserved: 2, sold: 4 },
    { ord: 2, key: 'نموذج B', rooms: 4, bathrooms: 3, area: 198, price: 0, total: 16, available: 1, reserved: 3, sold: 12 },
    { ord: 3, key: 'بنتهاوس', rooms: 6, bathrooms: 5, area: null, price: 3900000, total: 1, available: 1, reserved: 0, sold: 0 },
    { ord: 4, key: 'نموذج D', rooms: 2, area: 120, price: 900000, total: 4, available: 1, reserved: 0, sold: 3 }
];
const PLAN_PROJECT = { details: { models: [{ plan: 'https://cdn.example/a.png' }, { plan: 'http://cdn.example/b.png' }, 'نص', { plan: ' https://cdn.example/d.png ' }] } };
const cards = planCards(PLAN_PROJECT, BOARD);
t('plans: one card per model, no whole-property row', same(cards.map((c) => c.row.ord), [1, 2, 3, 4]));
t('plans: https plan from the model at ord-1', same(cards.map((c) => c.plan), ['https://cdn.example/a.png', null, null, 'https://cdn.example/d.png']));
t('plans: price per metre rounded, none without price or area', cards[0].perMeter === 7576 && cards[1].perMeter === null && cards[2].perMeter === null
    && cards[3].perMeter === 7500);
t('plans: zero price is no price', cards[1].price === null && cards[0].price === 1250000);
t('plans: «آخر وحدة» only when one is left of several', cards[0].last === false && cards[1].last === true && cards[2].last === false && cards[3].last === true);
t('plans: no models in details → no plan', planCards({ details: { models: 'x' } }, BOARD).every((c) => c.plan === null) && planCards({}, null).length === 0);
t('specs: rooms, bathrooms (dual in a word), area with their units glued',
    specsText(BOARD[1]) === '3' + NBSP + 'غرف · دورتا' + NBSP + 'مياه · 165' + NBSP + 'م²'
    && specsText({ rooms: 4, bathrooms: 3 }) === '4' + NBSP + 'غرف · 3' + NBSP + 'دورات' + NBSP + 'مياه');
t('specs: singular forms and missing parts', specsText({ rooms: 1, bathrooms: 1 }) === 'غرفة' + NBSP + 'واحدة · دورة' + NBSP + 'مياه' + NBSP + 'واحدة'
    && specsText({ area: 1250 }) === '1,250' + NBSP + 'م²' && specsText({}) === '' && specsText(null) === '');

/* ===================== رفع البروشور: العنوان والملف ===================== */

const P = { id: 12, name: ' أبراج الشاطئ ٣ ' };
t('title names the project by number and name', brochureTitle(P) === BROCHURE_TITLE_PREFIX + '12 «أبراج الشاطئ ٣»' && brochureTitle({ id: 9 }) === BROCHURE_TITLE_PREFIX + '9');
t('instruction like «حوّله تحديثاً»', brochureInstruction(P) === 'حدّث المشروع رقم 12 «أبراج الشاطئ ٣» بما في بروشور المطور المرفق.'
    && brochureInstruction({ id: 9 }) === 'حدّث المشروع رقم 9 بما في بروشور المطور المرفق.');
t('title matches its own project only', brochureTitleMatches(brochureTitle(P), 12) && brochureTitleMatches(brochureTitle({ id: 12 }), 12)
    && !brochureTitleMatches(brochureTitle({ id: 123, name: 'س' }), 12) && !brochureTitleMatches(BROCHURE_TITLE_PREFIX + '12٣', 12)
    && !brochureTitleMatches('تحديث #12 «أبراج»', 12) && !brochureTitleMatches(null, 12));
t('latest brochure: first matching row', latestBrochure([
    { id: 'a', title: brochureTitle({ id: 123 }) }, null, { id: 'b', title: brochureTitle(P) }, { id: 'c', title: brochureTitle(P) }
], 12).id === 'b' && latestBrochure([], 12) === null && latestBrochure(null, 12) === null);
t('pdf name: kept, completed, refused', pdfName('Brochure.PDF', '') === 'Brochure.PDF' && pdfName('document', 'application/pdf') === 'document.pdf'
    && pdfName('', 'application/pdf') === 'brochure.pdf' && pdfName('photo.png', 'image/png') === null && pdfName('x.pdf.exe', 'application/pdf') === 'x.pdf.exe.pdf');
t('file size text', fileSizeText(0) === '' && fileSizeText(500) === '1 ك.ب' && fileSizeText(850 * 1024) === '850 ك.ب'
    && fileSizeText(1.5 * MB) === '1.5 ميغابايت' && fileSizeText(10 * MB) === '10 ميغابايت' && fileSizeText(18 * MB) === '18 ميغابايت');
t('file problem: none for a good PDF', fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 2 * MB }, 10 * MB) === null);
t('file problem: missing, not PDF, empty', fileProblem(null, 10 * MB) === 'اختر ملف PDF.'
    && fileProblem({ name: 'a.docx', type: '', size: 5 }, 10 * MB) === 'البروشور يُرفع ملف PDF فقط.'
    && fileProblem({ name: 'a.pdf', type: '', size: 0 }, 10 * MB) === 'الملف «a.pdf» فارغ.');
const big = fileProblem({ name: 'كبير.pdf', type: 'application/pdf', size: 18 * MB }, 10 * MB);
t('file problem: too big says the limit', typeof big === 'string' && big.includes('«كبير.pdf»') && big.includes('10 ميغابايت'));
t('pages problem only above the limit', pagesProblem('a.pdf', null, 20) === null && pagesProblem('a.pdf', 20, 20) === null
    && pagesProblem('a.pdf', 24, 20) === 'الملف «a.pdf» فيه 24 صفحة، والحد 20 صفحة للملف. ارفع صفحات الأسعار والنماذج وحدها.');

/* ===================== رفع البروشور: المراحل ===================== */

t('upload summary with this session’s name', same(uploadSummary([{ kind: 'pdf', bytes: 18 * MB, pages: 24 }], ['بروشور-ابراج-الشاطئ.pdf']),
    { label: 'رُفع: بروشور-ابراج-الشاطئ.pdf (24 صفحة)', size: '18 ميغابايت' }));
t('upload summary from the stored rows', same(uploadSummary([{ kind: 'pdf', bytes: MB, pages: 1 }], null), { label: 'رُفع البروشور (صفحة واحدة)', size: '1 ميغابايت' }));
t('upload summary of two files', same(uploadSummary([{ kind: 'pdf', bytes: MB, pages: 14 }, { kind: 'pdf', bytes: MB, pages: 20 }]),
    { label: 'رُفع ملفان (34 صفحة)', size: '2 ميغابايت' }));
t('upload summary: unknown pages, no rows', uploadSummary([{ kind: 'pdf', bytes: 2048, pages: null }]).label === 'رُفع البروشور'
    && same(uploadSummary(null), { label: 'رُفع البروشور', size: '' }));

const states = (p) => p.steps.map((s) => s.state).join('/');
const labels = (p) => p.steps.map((s) => s.label);

const queued = brochureProgress({ status: 'queued' }, []);
t('queued: uploaded, reading now, approval next', states(queued) === 'done/now/todo' && labels(queued)[1] === 'يقرأ المساعد…'
    && labels(queued)[2] === 'بانتظار اعتماد المدير');
t('queued: polled, open, cancellable', queued.polling && queued.open && queued.cancellable && !queued.awaitingApproval);
t('queued: says it keeps going', queued.steps[1].note.includes('بانتظار دوره') && queued.steps[1].note.includes('يكمل وحده لو قفلت الصفحة'));
const running = brochureProgress({ status: 'running', stage: 'extracting' }, []);
t('running: the stage in words', states(running) === 'done/now/todo' && running.steps[1].note.startsWith('يستخرج الأسعار والنماذج') && running.polling);
t('running without a stage', brochureProgress({ status: 'running' }, []).steps[1].note.startsWith('يقرأ البروشور'));
const failed = brochureProgress({ status: 'failed', error_ar: 'x' }, []);
t('failed: red step, not polled, closed', states(failed) === 'done/fail/todo' && !failed.polling && !failed.open && !failed.cancellable);
t('cancelled: grey', states(brochureProgress({ status: 'cancelled' }, [])) === 'done/off/todo');
const choose = brochureProgress({ status: 'ready', candidates: [{ id: '12' }] }, []);
t('ready asking for the project: waits for the broker', states(choose) === 'done/wait/todo' && labels(choose)[1] === 'اختر المشروع المقصود'
    && choose.open && !choose.polling);
const nothing = brochureProgress({ status: 'ready', candidates: [] }, []);
t('ready without drafts: closed, grey', states(nothing) === 'done/off/off' && !nothing.open);
const draft = brochureProgress({ status: 'ready' }, [{ status: 'draft' }]);
t('broker draft: read, send it', states(draft) === 'done/done/wait' && labels(draft)[2] === 'أرسله للاعتماد' && draft.open && !draft.awaitingApproval);
t('returned draft comes first', labels(brochureProgress({ status: 'ready' }, [{ status: 'submitted' }, { status: 'returned' }]))[2] === 'أعاده المدير إليك');
const waiting = brochureProgress({ status: 'ready' }, [{ status: 'submitted' }]);
t('submitted: waits for the admin', states(waiting) === 'done/done/wait' && labels(waiting)[2] === 'بانتظار اعتماد المدير' && waiting.awaitingApproval && waiting.open);
const mine = brochureProgress({ status: 'ready' }, [{ status: 'submitted' }], true);
t('submitted, seen by the admin: waits for you', labels(mine)[2] === 'بانتظار اعتمادك' && mine.awaitingApproval);
const applied = brochureProgress({ status: 'ready' }, [{ status: 'applied' }]);
t('applied: all green, closed', states(applied) === 'done/done/done' && labels(applied)[2] === 'اعتمده المدير' && !applied.open);
t('approved counts as applied', states(brochureProgress({ status: 'ready' }, [{ status: 'approved' }, { status: 'rejected' }])) === 'done/done/done');
t('rejected: grey', states(brochureProgress({ status: 'ready' }, [{ status: 'rejected' }])) === 'done/done/off');
t('stale: grey with a way forward', labels(brochureProgress({ status: 'ready' }, [{ status: 'stale' }]))[2] === 'تغيّر المشروع قبل الاعتماد');
t('open work wins over closed', labels(brochureProgress({ status: 'ready' }, [{ status: 'applied' }, null, { status: 'draft' }]))[2] === 'أرسله للاعتماد');
t('unknown request: nothing claimed', states(brochureProgress(null, null)) === 'done/todo/todo');
const up = uploadingProgress('جارٍ رفع a.pdf…');
t('uploading: first step now with the message', states(up) === 'now/todo/todo' && up.steps[0].note === 'جارٍ رفع a.pdf…' && !up.polling && !up.cancellable);
t('every progress has three steps with keys', [queued, failed, choose, draft, applied, up].every((p) => same(p.steps.map((s) => s.key), ['upload', 'read', 'approve'])));

const NOW = Date.parse('2026-11-04T12:00:00Z');
t('on load: an open request shows', showOnLoad(draft, { created_at: '2026-01-01T00:00:00Z' }, NOW));
t('on load: a closed one shows for a week', showOnLoad(applied, { updated_at: '2026-11-01T00:00:00Z' }, NOW)
    && !showOnLoad(applied, { updated_at: '2026-10-20T00:00:00Z' }, NOW) && RECENT_DAYS === 7);
t('on load: nothing or no date', !showOnLoad(applied, null, NOW) && !showOnLoad(applied, { created_at: 'x' }, NOW));

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
