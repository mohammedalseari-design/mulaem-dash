// اختبار crm/js/share-model.js: الجوال وصيغه، ورمز الرابط والزائر، وقراءة رد get_project_share (038) بما يراه العميل،
// وأرقام المشروع ونصوصه، ورسائل واتساب، وأرقام «مشاركاتي» ونصوصها وقاعدة «مهتم الآن»، ورمز QR للبطاقة.
// رمز QR يُفكّ هنا من المصفوفة نفسها (القناع، والترتيب المتعرّج، والكتل، وريد-سولومون) فيعود النص كما دخل، وجدولا
// الصيغة والإصدار من المواصفة. (قورنت المصفوفة أيضاً بمكتبة qrcode-generator خارج المستودع: الأقنعة الثمانية والإصدارات 1–10.)
// التشغيل: node tests/share-model.test.mjs
import {
    FORMATS, FORMAT_LABEL, INTEREST_MS, cleanText, cleanBlock, districtText, placeText, constructionText, deliveryText, priceText,
    roomsText, areaText, initialOf, normalizeMobile, intlDigits, phoneDisplay, phoneTel, waLink, isShareCode, isVisitorId,
    shareLink, readParams, newVisitorId, summarize, mapUrl, publicView, modelSpecs, modelPill, unitsLine, availableText,
    stripFacts, cardFacts, shareMessage, contactMessage, defaultOffer, offerLabel, agoText, isInterestedNow, opensText, peopleUnit, lastOpenText,
    sortShares, formatCounts, stripNumbers, sheetStatsText, cardFileName, monthSubText, weekSubText,
    qrMatrix, qrRawCodewords, qrDataCodewords, qrFormatBits, qrVersionBits, qrMaskAt, rsRemainder, gfMul, qrPenalty
} from '../crm/js/share-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ===================== الجوال ===================== */

t('mobile: 05… becomes 9665…', normalizeMobile('0551234567') === '966551234567');
t('mobile: spaces, dashes and +966', normalizeMobile('+966 55 123 4567') === '966551234567' && normalizeMobile('055-123-4567') === '966551234567');
t('mobile: 00966 and bare 5…', normalizeMobile('00966551234567') === '966551234567' && normalizeMobile('551234567') === '966551234567');
t('mobile: Arabic and Persian digits', normalizeMobile('٠٥٥١٢٣٤٥٦٧') === '966551234567' && normalizeMobile('۰۵۵۱۲۳۴۵۶۷') === '966551234567');
t('mobile: landline, short, foreign and empty are refused', normalizeMobile('0126543210') === null && normalizeMobile('05512345') === null
    && normalizeMobile('+201001234567') === null && normalizeMobile('') === null && normalizeMobile(null) === null);
t('phone display: 055 123 4567', phoneDisplay('966551234567') === '055 123 4567' && phoneDisplay('0551234567') === '055 123 4567');
t('phone display: other numbers as written', phoneDisplay(' 0126543210 ') === '0126543210' && phoneDisplay('') === '');
t('intl digits: mobile, local landline, 00 prefix', intlDigits('0551234567') === '966551234567' && intlDigits('0126543210') === '966126543210'
    && intlDigits('00201001234567') === '201001234567' && intlDigits('123') === null);
t('tel link with +', phoneTel('0551234567') === 'tel:+966551234567' && phoneTel('') === null);
t('wa link with number and text', waLink('0551234567', 'مرحبا') === 'https://wa.me/966551234567?text=' + encodeURIComponent('مرحبا'));
t('wa link without a number opens the chat list', waLink(null, 'x y') === 'https://wa.me/?text=x%20y');

/* ===================== الرمز والرابط والزائر ===================== */

t('share code shape', isShareCode('AbCdEfGhIjKlMnOpQrStUv') && isShareCode('a-b_c'.repeat(4)) && !isShareCode('short')
    && !isShareCode('has space in it 1234') && !isShareCode('x'.repeat(65)) && !isShareCode(null) && !isShareCode('ﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍﺍ'));
t('visitor id shape', isVisitorId('abcdEFGH') && !isVisitorId('abc') && !isVisitorId('a b c d e f') && !isVisitorId(undefined));
t('share link: page, and the profile in print mode', shareLink('https://dash.mulaem.sa/crm/p.html', 'AbCdEfGhIjKlMnOpQrStUv') === 'https://dash.mulaem.sa/crm/p.html?c=AbCdEfGhIjKlMnOpQrStUv'
    && shareLink('https://x/p.html', 'AbCdEfGhIjKlMnOpQrStUv', 'pdf') === 'https://x/p.html?c=AbCdEfGhIjKlMnOpQrStUv&print=1'
    && shareLink('https://x/p.html', 'AbCdEfGhIjKlMnOpQrStUv', 'card') === 'https://x/p.html?c=AbCdEfGhIjKlMnOpQrStUv');
t('read params: code and print', same(readParams('?c=AbCdEfGhIjKlMnOpQrStUv&print=1'), { code: 'AbCdEfGhIjKlMnOpQrStUv', given: true, print: true, model: null }));
t('read params: malformed code is not asked', same(readParams('?c=<script>'), { code: null, given: true, print: false, model: null })
    && same(readParams(''), { code: null, given: false, print: false, model: null }));
t('visitor id: 16 bytes → 22 base64url characters', newVisitorId(Uint8Array.from({ length: 16 }, (_, i) => i)) === 'AAECAwQFBgcICQoLDA0ODw');
t('visitor id: high bytes use - and _', newVisitorId([251, 255, 255]) === '-___' && isVisitorId(newVisitorId(new Uint8Array(16).fill(200))));

/* ===================== نصوص صغيرة ===================== */

t('clean text: objects, booleans and blanks are nothing', cleanText({ a: 1 }) === '' && cleanText(true) === '' && cleanText('  ') === ''
    && cleanText(12) === '12' && cleanText('a\n\n b') === 'a b' && cleanText('abcdef', 3) === 'abc');
t('clean block keeps paragraphs', cleanBlock('  سطر   أول \r\n\r\n\r\n\r\n سطر ثانٍ ') === 'سطر أول\n\nسطر ثانٍ' && cleanBlock(null) === '' && cleanBlock({ a: 1 }) === '' && cleanBlock('abcdef', 3) === 'abc');
t('district with حي once', districtText('الشاطئ') === 'حي الشاطئ' && districtText('حي الشاطئ') === 'حي الشاطئ' && districtText('') === ''
    && districtText('حيدر') === 'حي حيدر');
t('place text, full and short', placeText('الشاطئ', 'جدة') === 'حي الشاطئ، جدة' && placeText('الشاطئ', 'جدة', true) === 'الشاطئ، جدة'
    && placeText('', 'جدة') === 'جدة' && placeText(null, null) === '');
t('construction status label', constructionText('تحت_الإنشاء') === 'تحت الإنشاء' && constructionText('جاهز') === 'جاهز' && constructionText(null) === '');
t('delivery: details text first, else month and year', deliveryText('الربع الثاني 2027', '2027-06-30') === 'الربع الثاني 2027'
    && deliveryText('', '2027-06-30') === 'يونيو 2027' && deliveryText(null, '2028-01-01') === 'يناير 2028' && deliveryText(null, null) === '');
t('price text', priceText(1250000) === '1,250,000 ر.س' && priceText(0) === '' && priceText(null) === '');
t('rooms text: range, compact range, single', roomsText({ min: 3, max: 6 }) === '3 إلى 6 غرف' && roomsText({ min: 3, max: 6 }, true) === '3–6 غرف'
    && roomsText({ min: 3, max: 3 }) === '3 غرف' && roomsText({ min: 1, max: 1 }) === 'غرفة واحدة' && roomsText(null) === '');
t('area text', areaText({ min: 165, max: 420 }) === '165 إلى 420 م²' && areaText({ min: 165, max: 165 }) === '165 م²' && areaText(null) === '');
t('initial letter for the avatar', initialOf('سعد العتيبي') === 'س' && initialOf('') === 'م' && initialOf('الهنوف') === 'ه');

/* ===================== رد الخادم ===================== */

const PAYLOAD = {
    project: {
        name: 'أبراج الشاطئ ٣', type: 'شقة', purpose: 'sale', city: 'جدة', district: 'الشاطئ', developer: 'دار المسكن للتطوير',
        construction_status: 'تحت_الإنشاء', delivery_time: 'الربع الثاني 2027', delivery_date: null,
        description: 'أبراج سكنية على بعد دقائق من الكورنيش.', features: ['مسبح على السطح', 'نادي رياضي', '', 'مسبح على السطح', 7],
        images: ['https://x.supabase.co/a.jpg', 'http://insecure/b.jpg', 'https://x.supabase.co/a.jpg', 'https://x.supabase.co/c.jpg', 12],
        latitude: 21.6, longitude: 39.1, ad_license: '7200457812', sold_out: false
    },
    units: [
        { ord: 2, name: 'نموذج B', type: 'شقة', rooms: 4, bathrooms: 3, area: 198, price: 1480000, total: 16, available: 5 },
        { ord: 1, name: 'نموذج A', type: 'شقة', rooms: 3, bathrooms: 2, area: 165, price: 1250000, plan: 'https://x.supabase.co/plan-a.jpg', total: 12, available: 6 },
        { ord: 3, name: 'نموذج C', rooms: 5, area: 260, price: 2100000, plan: 'http://x.test/plan-c.jpg', total: 8, available: 0 },
        { ord: 4, name: 'بنتهاوس', rooms: 6, area: 420, price: 900000, total: 4, available: 0 },
        { ord: 'x' }, null
    ],
    consultant: { name: 'سعد العتيبي', phone: '966551234567' }
};
const view = publicView(PAYLOAD);
t('view: nothing without a project', publicView(null) === null && publicView({}) === null && publicView({ project: 'x' }) === null);
t('view: name, place, status, delivery', view.name === 'أبراج الشاطئ ٣' && view.place === 'حي الشاطئ، جدة' && view.status === 'تحت الإنشاء'
    && view.delivery === 'الربع الثاني 2027' && view.developer === undefined && view.license === '7200457812');
t('view: https images only, without repeats', same(view.images, ['https://x.supabase.co/a.jpg', 'https://x.supabase.co/c.jpg']));
t('view: features cleaned and unique', same(view.features, ['مسبح على السطح', 'نادي رياضي', '7']));
t('view: models sorted by order, bad rows dropped', same(view.models.map((m) => m.ord), [1, 2, 3, 4]) && view.whole === null);
t('view: map link from the location', view.mapUrl === 'https://www.google.com/maps?q=21.6,39.1');
t('view: https plans only', view.models[0].plan === 'https://x.supabase.co/plan-a.jpg' && view.models[1].plan === null && view.models[2].plan === null);
t('view: consultant with the office number', view.consultant.name === 'سعد العتيبي'
    && view.consultant.display === '055 123 4567' && view.consultant.tel === 'tel:+966551234567');
t('summary: available of total, lowest available price', view.summary.available === 11 && view.summary.total === 40
    && view.summary.fromPrice === 1250000 && view.summary.priceLabel === 'يبدأ من');
t('summary: the cheap sold-out penthouse is not «يبدأ من»', view.summary.fromPrice !== 900000);
t('summary: rooms and area ranges over all models', same(view.summary.rooms, { min: 3, max: 6 }) && same(view.summary.area, { min: 165, max: 420 }));

const sold = publicView(Object.assign({}, PAYLOAD, { project: Object.assign({}, PAYLOAD.project, { sold_out: true }) }));
t('sold out project: nothing available, no starting price', sold.soldOut && sold.summary.available === 0 && sold.summary.fromPrice === null
    && sold.models.every((m) => m.available === 0));
const office = publicView({ project: { name: 'فيلا' }, units: [{ ord: 0, price: 1800000, area: 450, rooms: 6, total: 1, available: 1 }],
    consultant: { name: 'سعد', phone: '966126543210' } });
t('whole property: one row, «السعر» not «يبدأ من»', office.models.length === 0 && office.whole.ord === 0 && office.summary.total === 1
    && office.summary.fromPrice === 1800000 && office.summary.priceLabel === 'السعر');
t('a landline office number can be dialled', office.consultant.tel === 'tel:+966126543210');
const nobody = publicView({ project: { name: 'x' }, consultant: { name: null, phone: null } });
t('no office number: nothing to dial', nobody.consultant.phone === '' && nobody.consultant.tel === null && nobody.consultant.display === '');
t('summary of nothing', same(summarize([]), { models: 0, total: 0, available: 0, fromPrice: null, priceLabel: 'السعر', rooms: null, area: null }));
t('one price over many units is «السعر»', summarize([{ ord: 1, price: 900000, total: 10, available: 4, rooms: 3, area: 150 },
    { ord: 2, price: 900000, total: 2, available: 1, rooms: 3, area: 150 }]).priceLabel === 'السعر');
t('map link guards', mapUrl(0, 0) === null && mapUrl(91, 10) === null && mapUrl(null, 39) === null && mapUrl('21.5', '39.2') === 'https://www.google.com/maps?q=21.5,39.2');

t('model specs', modelSpecs(view.models[0]) === '3 غرف · 165 م²' && modelSpecs({ rooms: null, area: 90 }) === '90 م²' && modelSpecs(null) === '');
t('model pill: available count, single unit, closed', same(modelPill(view.models[0]), { text: 'متاح 6', tone: 'ok' })
    && same(modelPill({ total: 1, available: 1 }), { text: 'متاح', tone: 'ok' }) && same(modelPill(view.models[2]), { text: 'غير متاح', tone: 'muted' }));
t('units line', unitsLine(view.summary) === 'متاح 11 من 40 وحدة' && unitsLine(sold.summary) === 'لا وحدات متاحة الآن'
    && unitsLine({ total: 5, available: 3 }) === 'متاح 3 من 5 وحدات' && unitsLine({ total: 1, available: 1 }) === 'متاح الآن' && unitsLine(null) === '');
t('available text for the phone preview', availableText(view.summary) === 'متاح 11 وحدة' && availableText({ available: 3 }) === 'متاح 3 وحدات'
    && availableText(sold.summary) === '');
t('strip facts: price, rooms, delivery', same(stripFacts(view).map((c) => [c.label, c.value, c.unit]),
    [['يبدأ من', '1,250,000', 'ر.س'], ['الغرف', '3–6 غرف', ''], ['التسليم', 'الربع الثاني 2027', '']]));
t('strip facts: no price → «عند التواصل»', stripFacts(sold)[0].value === 'عند التواصل' && stripFacts(sold)[0].unit === '');
t('card facts: rooms, area, delivery (no available count)', same(cardFacts(view).map((f) => f.text), ['3 إلى 6 غرف', '165 إلى 420 م²', 'التسليم الربع الثاني 2027']));
t('card facts: type fills a gap', same(cardFacts(publicView({ project: { name: 'أرض', type: 'أرض' }, units: [{ ord: 0, area: 600, total: 1, available: 1 }] })).map((f) => f.text),
    ['600 م²', 'أرض']));

/* ===================== الرسائل ===================== */

const link = 'https://dash.mulaem.sa/crm/p.html?c=AbCdEfGhIjKlMnOpQrStUv';
const offerView = publicView(PAYLOAD, 1);
const APPROVED = (format, line, url) => [
    'السلام عليكم،',
    'أرسل لك ' + format + ' مشروع «أبراج الشاطئ ٣»:',
    '• نموذج A',
    '• 1,250,000 ر.س',
    '• 3 غرف · 165 م²',
    '• التسليم: الربع الثاني 2027',
    line,
    url,
    'مستشارك العقاري: سعد العتيبي',
    'للتواصل: \u200e055 123 4567\u200e',
    'ملائم العقارية'
].join('\n');
t('district: «مخطط» and «حى» get no extra «حي»', districtText('مخطط سندس') === 'مخطط سندس' && districtText('حى المروة') === 'حى المروة' && districtText('حيّ النزهة') === 'حيّ النزهة' && districtText('حي الشاطئ') === 'حي الشاطئ' && districtText('الشاطئ') === 'حي الشاطئ' && districtText('حيفا') === 'حي حيفا');
t('one offer: only the chosen model', offerView.models.length === 1 && offerView.offer.name === 'نموذج A' && offerView.summary.total === 12 && offerView.summary.fromPrice === 1250000);
t('one offer: an unknown model shows the project', publicView(PAYLOAD, 99).models.length === 4 && publicView(PAYLOAD, 99).offer === null && publicView(PAYLOAD).offer === null);
t('default offer: by name, else first available, else first, none without models', defaultOffer(view) === 1 && defaultOffer(view, 'نموذج B') === 2 && defaultOffer(view, 'غير موجود') === 1
    && defaultOffer(publicView({ project: { name: 'x' }, units: [{ ord: 1, name: 'أ', total: 1, available: 0 }, { ord: 2, name: 'ب', total: 1, available: 1 }] })) === 2
    && defaultOffer(publicView({ project: { name: 'x' }, units: [{ ord: 1, name: 'أ', total: 1, available: 0 }] })) === 1
    && defaultOffer(publicView({ project: { name: 'x' }, units: [{ ord: 0, total: 1, available: 1 }] })) === null);
t('offer label', offerLabel(view.models[0]) === 'نموذج A · 3 غرف · 165 م² · 1,250,000 ر.س' && offerLabel(view.models[2]).endsWith('· غير متاح'), offerLabel(view.models[0]));
t('share link carries the offer', shareLink('https://x/p.html', 'ABC', 'link', 2) === 'https://x/p.html?c=ABC&m=2' && shareLink('https://x/p.html', 'ABC', 'pdf', 2) === 'https://x/p.html?c=ABC&m=2&print=1' && shareLink('https://x/p.html', 'ABC') === 'https://x/p.html?c=ABC');
t('read params: the offer', readParams('?c=AbCdEfGhIjKlMnOpQrStUv&m=2').model === 2 && readParams('?c=AbCdEfGhIjKlMnOpQrStUv&m=x').model === null && readParams('?c=AbCdEfGhIjKlMnOpQrStUv&m=0').model === null && readParams('?c=AbCdEfGhIjKlMnOpQrStUv').model === null);
t('share message: one offer in the wording the owner chose', shareMessage('link', offerView, link) === APPROVED('تفاصيل', 'الصور والمخططات هنا:', link), shareMessage('link', offerView, link));
t('share message: the card sends the same message', shareMessage('card', offerView, link) === shareMessage('link', offerView, link));
t('share message: profile', shareMessage('pdf', offerView, link + '&print=1') === APPROVED('بروفايل', 'تقدر تحفظه PDF من هنا:', link + '&print=1'));
t('share message: no place and no map', !shareMessage('link', offerView, link).includes('في حي') && !shareMessage('link', offerView, link).includes('جدة') && !shareMessage('link', offerView, link).includes('الموقع'));
t('share message: promises only what the page has', shareMessage('link', publicView(PAYLOAD, 2), link).includes('\nالصور هنا:\n'));
t('share message: nothing known, no empty lines', shareMessage('link', publicView({ project: { name: 'برج' } }), link)
    === 'السلام عليكم،\nأرسل لك تفاصيل مشروع «برج»:\nالتفاصيل هنا:\n' + link + '\nملائم العقارية');
t('share message: one room count and one area have no «من»', shareMessage('link', office, link).includes('\n• 6 غرف · 450 م²\n'), shareMessage('link', office, link));
t('share message: status when no delivery date', shareMessage('link', publicView({ project: { name: 'برج', construction_status: 'تحت_الإنشاء' } }), link).includes('\n• الحالة: تحت الإنشاء\n'));
t('contact message: the approved wording names the broker', contactMessage(view) === 'مرحباً، اطلعت على مشروع أبراج الشاطئ ٣ عن طريق سعد العتيبي وأرغب بمعرفة المزيد وحجز زيارة.');
t('contact message: names the offer', contactMessage(offerView) === 'مرحباً، اطلعت على مشروع أبراج الشاطئ ٣ (نموذج A) عن طريق سعد العتيبي وأرغب بمعرفة المزيد وحجز زيارة.');
t('contact message: visit', contactMessage(view, 'visit') === 'مرحباً، اطلعت على مشروع أبراج الشاطئ ٣ عن طريق سعد العتيبي وأرغب بحجز زيارة.');
t('contact message: a model with its price', contactMessage(offerView, 'model', offerView.models[0]) === 'مرحباً، اطلعت على مشروع أبراج الشاطئ ٣ عن طريق سعد العتيبي وأرغب بمعرفة المزيد عن نموذج A (1,250,000 ر.س).');
const named = publicView({ project: { name: 'مشروع النخيل' } });
t('a name that starts with «مشروع» does not repeat the word', shareMessage('link', named, link).includes('أرسل لك تفاصيل «مشروع النخيل»:')
    && contactMessage(named) === 'مرحباً، اطلعت على مشروع النخيل وأرغب بمعرفة المزيد وحجز زيارة.');
t('contact message: no broker name', contactMessage(publicView({ project: { name: 'برج' } })) === 'مرحباً، اطلعت على مشروع برج وأرغب بمعرفة المزيد وحجز زيارة.');

/* ===================== «مشاركاتي» ===================== */

const NOW = new Date(2026, 10, 4, 15, 0, 0);
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60000, HOUR = 3600000;
t('ago: now and minutes', agoText(ago(30000), NOW) === 'الآن' && agoText(ago(MIN), NOW) === 'قبل دقيقة' && agoText(ago(2 * MIN), NOW) === 'قبل دقيقتين'
    && agoText(ago(5 * MIN), NOW) === 'قبل 5 دقائق' && agoText(ago(15 * MIN), NOW) === 'قبل 15 دقيقة');
t('ago: hours', agoText(ago(HOUR), NOW) === 'قبل ساعة' && agoText(ago(2 * HOUR), NOW) === 'قبل ساعتين' && agoText(ago(3 * HOUR), NOW) === 'قبل 3 ساعات'
    && agoText(ago(11 * HOUR), NOW) === 'قبل 11 ساعة');
t('ago: yesterday and days', agoText(new Date(2026, 10, 3, 9, 0).toISOString(), NOW) === 'أمس' && agoText(new Date(2026, 10, 2, 9, 0).toISOString(), NOW) === 'قبل يومين'
    && agoText(new Date(2026, 10, 1, 9, 0).toISOString(), NOW) === 'قبل 3 أيام' && agoText(new Date(2026, 9, 29, 9, 0).toISOString(), NOW) === 'قبل 6 أيام');
t('ago: older is a date, with the year when not this year', agoText(new Date(2026, 9, 20, 9, 0).toISOString(), NOW) === '20 أكتوبر'
    && agoText(new Date(2025, 11, 31, 9, 0).toISOString(), NOW) === '31 ديسمبر 2025');
t('ago: future (clock skew) is «الآن», nothing is empty', agoText(new Date(NOW.getTime() + 5 * MIN).toISOString(), NOW) === 'الآن' && agoText(null, NOW) === ''
    && agoText('not a date', NOW) === '');
t('interested now: within two hours', isInterestedNow(ago(119 * MIN), NOW) && isInterestedNow(ago(INTEREST_MS), NOW) && !isInterestedNow(ago(INTEREST_MS + MIN), NOW));
t('interested now: small skew yes, far future no, nothing no', isInterestedNow(new Date(NOW.getTime() + 3 * MIN).toISOString(), NOW)
    && !isInterestedNow(new Date(NOW.getTime() + 10 * MIN).toISOString(), NOW) && !isInterestedNow(null, NOW));
t('opens text by count', opensText(0) === 'لم يفتحه أحد' && opensText(1) === 'شخص واحد فتحه' && opensText(2) === 'شخصان فتحاه'
    && opensText(5) === '5 أشخاص فتحوه' && opensText(10) === '10 أشخاص فتحوه' && opensText(11) === '11 شخصاً فتحوه' && opensText(1200) === '1,200 شخصاً فتحوه'
    && opensText(null) === 'لم يفتحه أحد');
t('people unit beside a big number', peopleUnit(1) === 'شخص' && peopleUnit(3) === 'أشخاص' && peopleUnit(11) === 'شخصاً' && peopleUnit(0) === 'أشخاص');

const ROWS = [
    { project_id: 1, project_name: 'دار الصفا', last_format: 'link', last_shared_at: new Date(2026, 10, 1, 10).toISOString(), opens_total: 1, opens_week: 1, last_opened_at: new Date(2026, 10, 2, 12).toISOString() },
    { project_id: 2, project_name: 'أبراج الشاطئ ٣', last_format: 'link', last_shared_at: new Date(2026, 10, 3, 10).toISOString(), opens_total: 5, opens_week: 3, last_opened_at: ago(HOUR) },
    { project_id: 3, project_name: 'سكن الروضة', last_format: 'pdf', last_shared_at: new Date(2026, 10, 1, 9).toISOString(), opens_total: 0, opens_week: 0, last_opened_at: null },
    { project_id: 4, project_name: 'فلل الياقوت', last_format: 'card', last_shared_at: new Date(2026, 9, 20, 9).toISOString(), opens_total: 3, opens_week: 0, last_opened_at: new Date(2026, 9, 25, 9).toISOString() },
    { project_id: 5, project_name: 'أبراج النخبة', last_format: 'card', last_shared_at: new Date(2026, 10, 2, 9).toISOString(), opens_total: 0, opens_week: 0, last_opened_at: null }
];
t('sort: latest opened first, never-opened last by latest sent', same(sortShares(ROWS).map((r) => r.project_id), [2, 1, 4, 5, 3]));
t('sort does not touch the input', ROWS[0].project_id === 1);
t('format counts', same(formatCounts(ROWS), { '': 5, link: 2, card: 2, pdf: 1 }) && same(formatCounts(null), { '': 0, link: 0, card: 0, pdf: 0 }));
const strip = stripNumbers(ROWS, NOW);
t('strip: shares this month and how many were opened', strip.monthShares === 4 && strip.monthOpened === 2);
t('strip: people overall and this week', strip.people === 9 && strip.weekPeople === 4);
t('strip: last opened', strip.lastOpenedAt === ago(HOUR) && strip.lastOpenedThisWeek === true);
t('strip of nothing', same(stripNumbers([], NOW), { monthShares: 0, monthOpened: 0, people: 0, weekPeople: 0, lastOpenedAt: null, lastOpenedThisWeek: false }));
t('month sub line', monthSubText(strip) === 'اثنتان منها فُتحتا' && monthSubText({ monthShares: 3, monthOpened: 0 }) === 'لم يُفتح منها شيء بعد'
    && monthSubText({ monthShares: 5, monthOpened: 1 }) === 'واحدة منها فُتحت' && monthSubText({ monthShares: 9, monthOpened: 4 }) === '4 منها فُتحت'
    && monthSubText({ monthShares: 0 }) === 'لم تشارك مشروعاً هذا الشهر' && monthSubText(null, true) === 'لا مشاركات هذا الشهر');
t('week sub line', weekSubText(strip, NOW) === 'فتحوا روابطك، آخرهم قبل ساعة' && weekSubText(strip, NOW, true) === 'فتحوا الروابط، آخرهم قبل ساعة'
    && weekSubText({ weekPeople: 0 }, NOW) === 'لم يفتح أحد روابطك هذا الأسبوع'
    && weekSubText({ weekPeople: 2, lastOpenedAt: null, lastOpenedThisWeek: false }, NOW) === 'فتحوا روابطك');
t('last open line', lastOpenText(ROWS[1], NOW) === 'آخر فتح: قبل ساعة' && lastOpenText(ROWS[2], NOW) === 'أُرسل قبل 3 أيام' && lastOpenText(null, NOW) === '');
t('sheet stats line', sheetStatsText(ROWS[1], NOW) === 'رابطك فتحه 5 أشخاص · آخرهم قبل ساعة' && sheetStatsText(ROWS[2], NOW) === 'لم يفتح أحد رابطك بعد'
    && sheetStatsText(ROWS[0], NOW) === 'رابطك فتحه شخص واحد · آخرهم قبل يومين' && sheetStatsText({ last_shared_at: null }, NOW) === '' && sheetStatsText(null, NOW) === '');
t('card file name is safe', cardFileName('أبراج "الشاطئ" / ٣') === 'ملائم - أبراج الشاطئ ٣.png' && cardFileName('') === 'ملائم - مشروع.png');
t('formats and labels', same(FORMATS, ['link', 'card', 'pdf']) && FORMAT_LABEL.pdf === 'بروفايل PDF');

/* ===================== رمز QR ===================== */

// جدولا المواصفة: الإصدار → [كلمات التصحيح في الكتلة، عدد الكتل] للمستوى M، وكل الكلمات
const EC_M = { 1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4], 7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5] };
const TOTAL = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };
t('qr: codeword totals per version', Object.keys(TOTAL).every((v) => qrRawCodewords(Number(v)) === TOTAL[v]));
t('qr: data codewords (M)', qrDataCodewords(1) === 16 && qrDataCodewords(4) === 64 && qrDataCodewords(8) === 154 && qrDataCodewords(10) === 216);
t('qr: GF(256) multiply', gfMul(0, 77) === 0 && gfMul(1, 77) === 77 && gfMul(2, 128) === 0x1d && gfMul(3, 7) === 9);
// ملحق المواصفة: «01234567» بالإصدار 1-M
const DATA_1M = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
t('qr: Reed–Solomon example from the standard', same(rsRemainder(DATA_1M, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]));
// جدول بتات الصيغة للمستوى M (الأقنعة 0–7)
const FORMAT_M = [0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
    0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000];
t('qr: format bits for level M', FORMAT_M.every((bits, mask) => qrFormatBits(mask) === bits));
t('qr: version bits', qrVersionBits(7) === 0x07c94 && qrVersionBits(8) === 0x085bc && qrVersionBits(10) === 0x0a4d3);

function readFormat(q, copy) {
    const m = q.modules;
    const size = q.size;
    let bits = 0;
    const put = (k, dark) => { if (dark) bits |= 1 << k; };
    if (copy === 1) {
        for (let k = 0; k <= 5; k++) put(k, m[k][8]);
        put(6, m[7][8]); put(7, m[8][8]); put(8, m[8][7]);
        for (let k = 9; k < 15; k++) put(k, m[8][14 - k]);
    } else {
        for (let k = 0; k < 8; k++) put(k, m[8][size - 1 - k]);
        for (let k = 8; k < 15; k++) put(k, m[size - 15 + k][8]);
    }
    return bits;
}

// يفك الرمز: يقرأ بتات البيانات بالترتيب المتعرّج متخطياً مواضع الأنماط، ويزيل القناع، ويفصل الكتل، ويتحقق من التصحيح،
// ثم يقرأ نمط البايت
function decode(q) {
    const { size, modules, fixed, mask, version } = q;
    const bits = [];
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
                if (!fixed[y][x]) bits.push(modules[y][x] !== qrMaskAt(mask, x, y) ? 1 : 0);
            }
        }
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length && bytes.length < TOTAL[version]; i += 8) {
        let v = 0;
        for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
        bytes.push(v);
    }
    const [ecLen, numBlocks] = EC_M[version];
    const numShort = numBlocks - (TOTAL[version] % numBlocks);
    const shortData = Math.floor(TOTAL[version] / numBlocks) - ecLen;
    const blocks = Array.from({ length: numBlocks }, (_, i) => ({ len: shortData + (i < numShort ? 0 : 1), dat: [], ecc: [] }));
    let k = 0;
    for (let i = 0; i <= shortData; i++) for (const b of blocks) if (i < b.len) b.dat.push(bytes[k++]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) b.ecc.push(bytes[k++]);
    const eccOk = blocks.every((b) => same(rsRemainder(b.dat, ecLen), b.ecc));
    const data = blocks.flatMap((b) => b.dat);
    const stream = data.flatMap((v) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (v >>> s) & 1));
    let p = 0;
    const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | stream[p++]; return v; };
    const mode = take(4);
    const len = take(version <= 9 ? 8 : 16);
    const out = [];
    for (let i = 0; i < len; i++) out.push(take(8));
    return { eccOk, mode, text: new TextDecoder().decode(Uint8Array.from(out)) };
}

const LINK = 'https://dash.mulaem.sa/crm/p.html?c=AbCdEfGhIjKlMnOpQrStUv';
const q = qrMatrix(LINK);
t('qr: a share link fits version 4 (33×33)', q.version === 4 && q.size === 33 && q.modules.length === 33 && q.modules.every((row) => row.length === 33));
const finderAt = (m, x0, y0) => {
    for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
            const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
            if (m[y0 + dy][x0 + dx] !== (d !== 2)) return false;
        }
    }
    return true;
};
t('qr: three finder patterns', finderAt(q.modules, 0, 0) && finderAt(q.modules, q.size - 7, 0) && finderAt(q.modules, 0, q.size - 7));
t('qr: separators are light', [0, 1, 2, 3, 4, 5, 6, 7].every((i) => !q.modules[7][i] && !q.modules[i][7] && !q.modules[7][q.size - 1 - i]));
t('qr: timing patterns alternate', Array.from({ length: q.size - 16 }, (_, i) => i + 8).every((i) => q.modules[6][i] === (i % 2 === 0) && q.modules[i][6] === (i % 2 === 0)));
t('qr: dark module', q.modules[q.size - 8][8] === true);
t('qr: alignment pattern at (26, 26)', q.modules[26][26] && !q.modules[25][26] && !q.modules[27][27] && q.modules[24][24] && q.modules[28][28]);
t('qr: both format copies agree with the chosen mask', readFormat(q, 1) === qrFormatBits(q.mask) && readFormat(q, 2) === qrFormatBits(q.mask));
const dq = decode(q);
t('qr: decodes back to the link, error correction intact', dq.eccOk && dq.mode === 4 && dq.text === LINK, dq);
t('qr: chosen mask has the lowest penalty', [0, 1, 2, 3, 4, 5, 6, 7].every((m) => qrPenalty(qrMatrix(LINK, { mask: m }).modules) >= qrPenalty(q.modules)));
let roundTrips = true;
for (const len of [1, 14, 15, 42, 43, 62, 63, 84, 106, 122, 152, 153, 180, 181, 213]) {
    const text = 'م'.repeat(Math.floor(len / 2)) + 'x'.repeat(len % 2);
    const bytesLen = new TextEncoder().encode(text).length;
    const m = qrMatrix(text);
    for (let mask = 0; m && mask < 8; mask++) {
        const forced = qrMatrix(text, { mask });
        const d = decode(forced);
        if (!d.eccOk || d.text !== text || readFormat(forced, 1) !== qrFormatBits(mask) || readFormat(forced, 2) !== qrFormatBits(mask)) roundTrips = false;
    }
    if (!m && bytesLen <= 213) roundTrips = false;
}
t('qr: every size up to version 10 and every mask decodes (Arabic UTF-8 too)', roundTrips);
const v7 = qrMatrix('x'.repeat(110));
const readVersion = (m, size) => { let v = 0; for (let k = 0; k < 18; k++) if (m[Math.floor(k / 3)][size - 11 + (k % 3)]) v |= 1 << k; return v; };
t('qr: version 7 carries its version bits', v7.version === 7 && readVersion(v7.modules, v7.size) === qrVersionBits(7));
t('qr: too long or empty → null', qrMatrix('x'.repeat(214)) === null && qrMatrix('') === null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
