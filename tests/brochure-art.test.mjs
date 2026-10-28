// اختبار «المدير الفني» (crm/js/brochure-art.js): لكل مشروع اتجاهه الفني من المشروع نفسه — طابعه وألوانه وخطاه وإيقاعه —
// من مجموعات مختارة سلفاً مختبرة التباين، والمدخل نفسه يعطي الاتجاه نفسه، و«تصميم آخر» ينتقل إلى بديل متّسق.
// التشغيل: node tests/brochure-art.test.mjs   أو   deno run --allow-read tests/brochure-art.test.mjs
import { readFileSync } from 'node:fs';
import { artDirection, moodScores, rankMoods, directionStyle, directionLabel, fontFamilies, coverFits, norm, MOODS, PAIRINGS, FAMILIES, TEXT_FONT } from '../crm/js/brochure-art.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// مشاريع بعلامات المشاريع الخمسة الحقيقية كما قُرئت (الاسم والوصف والحي والنماذج والعناوين، وعائلة لون الصور)
const img = (kind, w, h, extra) => ({ url: 'https://img.test/' + kind + w + 'x' + h + '.jpg', kind, w: w || 2400, h: h || 1600, ...extra });
const facts = (o) => ({ name: null, nameLatin: null, tagline: null, district: null, city: 'جدة', models: [], images: [img('exterior', 2400, 1350)], amenities: [], landmarks: [], family: null, ...o });
const pages = (...titles) => ({ pages: [{ kind: 'cover', variant: 'side', images: [0] }, ...titles.map((title) => ({ kind: 'about', variant: 'text', text: { title, bullets: [], figures: [] } }))] });
const apt = (name, area, price, rooms) => ({ name, type: 'شقة', area, price, rooms, sold: false });

const serin = { facts: facts({ name: 'لامير سيرين', nameLatin: 'LAMER SERIN', tagline: 'سكن بروح الطبيعة', district: 'أبحر', family: 'forest',
    models: [apt('شقة 1', 97, 639000, 2), apt('شقة 2', 107, 689000, 3), apt('شقة 7', 65, 489000, 1)], images: [img('exterior', 2008, 783, { wide: true })] }),
    spec: { pages: [{ kind: 'cover', variant: 'low', images: [0] }, ...pages('حياة سكنية أكثر هدوءًا وإتزاناً', 'أبحر الجنوبية من أرقى مناطق جدة الحديثة، تجمع بين فخامة السكن وذكاء الاستثمار.').pages.slice(1)] } };
const naqsh = { facts: facts({ name: 'نقش', nameLatin: 'NQSH ABHOR', district: 'أبحر', family: 'bronze', images: [img('exterior', 2400, 1923)] }),
    spec: pages('المقدمة', 'تصاميم منفذة بأتقان', 'راحة ومستقر السكينة') };
const sky = { facts: facts({ name: 'الصفا 3 سكاي', tagline: 'حيث يبدأ المستقبل', family: 'teal', models: [apt('A', 168, 690000, 4), apt('B', 114, 490000, 3)],
    images: [img('exterior', 1240, 1754), ...Array.from({ length: 8 }, (_, i) => img('interior', 1600 + i, 1200))] }), spec: pages('مميزات المشروع', 'ضمانات المشروع') };
const kayan = { facts: facts({ name: 'كيان الريان 225', district: 'الريان', family: 'navy', models: [apt('A', 282, 860000, 6), apt('B', 116, 435000, 3)], images: [img('map', 1600, 1000)] }),
    spec: { pages: [{ kind: 'cover', variant: 'type', text: { title: null, subtitle: 'افراغ فوري', body: null, bullets: [], figures: [] } }, ...pages('موقع المشروع').pages.slice(1)] } };
const hayat = { facts: facts({ name: 'الحياة ريزيدنس', nameLatin: 'Alhayat Residence', district: 'السلامة', family: 'navy', models: [apt('A', 180, 950000, 4)],
    images: [img('exterior', 1427, 1840), ...Array.from({ length: 12 }, (_, i) => img('interior', 2000 + i, 1400))] }), spec: pages('مميزات المشروع') };

const five = [serin, naqsh, sky, kayan, hayat].map((x) => artDirection(x, 0));
t('direction: the five real projects get five different moods, each from its own signals',
    five.map((d) => d.mood).join() === 'garden-serene,heritage-craft,urban-bold,family-warm,calm-luxury', five.map((d) => d.mood));
t('direction: five different deep fields, accents, papers and type pairings',
    ['deep', 'accent', 'paper'].every((k) => new Set(five.map((d) => d.palette[k])).size === 5) && new Set(five.map((d) => d.type.name)).size === 5,
    five.map((d) => [d.palette.deep, d.palette.accent, d.palette.paper, d.type.name]));
t('direction: five different covers — panorama band, full-bleed facade, dark field, title only, framed print',
    five.map((d) => d.rhythm.cover + ':' + d.rhythm.coverTone + ':' + d.rhythm.photos).join() === 'low:paper:bleed,full:paper:bleed,side:deep:bleed,type:paper:bleed,side:paper:framed',
    five.map((d) => [d.rhythm.cover, d.rhythm.coverTone, d.rhythm.photos]));
t('direction: the reasons are the project\'s own signals («طبيع» in its tagline, «نقش», «سكاي، مستقبل», the price per metre, «ريزيدنس»)',
    /طبيع/.test(five[0].why.join()) && /نقش/.test(five[1].why.join()) && /سكاي/.test(five[2].why.join()) && /سعر المتر/.test(five[3].why.join()) && /ريزيدنس/.test(five[4].why.join()),
    five.map((d) => d.why));
t('direction: deterministic — the same input gives the same direction', JSON.stringify(artDirection(sky, 0)) === JSON.stringify(artDirection(JSON.parse(JSON.stringify(sky)), 0)));
t('idea: the main promise is the reading\'s own words — tagline, else the cover line, else the first non-section title, else the name',
    five.map((d) => d.idea.promise).join('|') === 'سكن بروح الطبيعة|تصاميم منفذة بأتقان|حيث يبدأ المستقبل|افراغ فوري|الحياة ريزيدنس' && five.every((d) => d.idea.angle === MOODS[d.mood].angle),
    five.map((d) => d.idea.promise));

// «تصميم آخر»: الطابع نفسه بخطه وغلافه الآخرين، ثم الطابعان التاليان، ثم يعود
const alts = [0, 1, 2, 3, 4].map((v) => artDirection(serin, v));
t('variation: the second design keeps the mood with its other type pairing; then the next moods; then it cycles',
    alts[1].mood === alts[0].mood && alts[1].type.name !== alts[0].type.name && alts[2].mood !== alts[0].mood && alts[3].mood !== alts[2].mood
    && JSON.stringify(alts[4]) === JSON.stringify(alts[0]) && alts[0].of === 4 && alts.map((d) => d.at).join() === '0,1,2,3,0', alts.map((d) => [d.mood, d.type.name, d.rhythm.cover]));
t('variation: every alternative is a whole direction from the curated sets', [serin, naqsh, sky, kayan, hayat].flatMap((x) => [0, 1, 2, 3].map((v) => artDirection(x, v))).every((d) => MOODS[d.mood] && PAIRINGS[d.type.name]
    && MOODS[d.mood].types.includes(d.type.name) && Object.values(MOODS[d.mood].fields).some((f) => f.deep === d.palette.deep) && d.palette.paper === MOODS[d.mood].ground.paper));
t('variation: a negative, missing or broken variation is still a direction', JSON.stringify(artDirection(serin)) === JSON.stringify(alts[0]) && artDirection(serin, -1).at === 3
    && artDirection(serin, 'x').at === 0 && artDirection(serin, 1.5).at === 0);

// الألوان من المجموعات المختارة وحدها: عائلة الصور تختار الحقل العميق، ولا لون من الملف
t('palette: the photos\' colour family picks the deep field of the mood (night render → midnight, warm wood → espresso)',
    artDirection({ ...hayat, family: 'navy' }, 0).palette.deep === MOODS['calm-luxury'].fields.navy.deep
    && artDirection({ ...hayat, family: 'bronze' }, 0).palette.deep === MOODS['calm-luxury'].fields.bronze.deep
    && artDirection({ ...hayat, family: 'red' }, 0).palette.deep === MOODS['calm-luxury'].fields.default.deep);
t('palette: the family falls back to facts.family; an explicit family wins', artDirection({ facts: hayat.facts, spec: hayat.spec }, 0).family === 'navy'
    && artDirection({ ...hayat, family: 'plum' }, 0).family === 'plum');
t('palette: urban-bold takes its single accent from the photos\' family (sky → azure), the deep stays graphite',
    five[2].palette.accent === MOODS['urban-bold'].fields.teal.accent && artDirection({ ...sky, family: 'bronze' }, 0).palette.accent === MOODS['urban-bold'].accent
    && five[2].palette.deep === MOODS['urban-bold'].fields.teal.deep);
t('palette: a developer colour anywhere in the facts is never used', (() => {
    const d = artDirection({ ...serin, facts: { ...serin.facts, palette: { name: 'brand', deep: '#FF0000', pale: '#00FF00' }, colours: { deep: '#FF0000' } } }, 0);
    return !JSON.stringify(d).includes('#FF0000') && !directionStyle(d).includes('#FF0000');
})());
const HEX = /^#[0-9A-F]{6}$/;
t('palette: every colour in every mood is a #RRGGBB constant', Object.values(MOODS).every((m) => [...Object.values(m.ground), m.accent, m.accentDeep, m.onDeep,
    ...Object.values(m.fields).flatMap((f) => [f.deep, f.pale, f.accent || m.accent, f.accentDeep || m.accentDeep])].every((c) => HEX.test(c))));
// تباين النص (WCAG): الحبر والنص والخافت والإبراز على الورق والرمل، والكلام والإبراز على الحقل العميق، والحبر على الدرجة الفاتحة
const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const low = [];
for (const [k, m] of Object.entries(MOODS)) {
    const g = m.ground;
    const check = (what, a, b, min) => { if (ratio(a, b) < min) low.push(k + ' ' + what + ' ' + ratio(a, b).toFixed(2)); };
    check('ink/paper', g.ink, g.paper, 13); check('text/paper', g.text, g.paper, 9); check('muted/paper', g.muted, g.paper, 4.6); check('muted/sand', g.muted, g.sand, 4);
    check('text/stone', g.text, g.stone, 7);
    for (const [fk, f] of Object.entries(m.fields)) {
        check(fk + ' accent/paper', f.accent || m.accent, g.paper, 4.6); check(fk + ' accent/sand', f.accent || m.accent, g.sand, 4);
        check(fk + ' on/deep', m.onDeep, f.deep, 10); check(fk + ' accent/deep', f.accentDeep || m.accentDeep, f.deep, 5.5);
        check(fk + ' ink/pale', g.ink, f.pale, 12); check(fk + ' muted/pale', g.muted, f.pale, 4);
    }
}
t('palette: readable in every mood and family — ink 13:1, text 9:1, muted 4.6:1 on paper, text 7:1 on the stone of sold units, accent 4.6:1, light text 10:1 and accent 5.5:1 on the deep field', !low.length, low);

// الكلمات: الجذر في أول الكلمة بعد حروف العطف والجر و«ال»، لا في وسط كلمة أخرى
t('words: «الطبيعة»، «بالبحر»، «للعائلة» match; «الشرقية» is not «رقي» and «أبحر» is not «بحر» (the district counts on its own)', (() => {
    const s = (name) => moodScores({ facts: facts({ name }), spec: { pages: [] } }).scores;
    return s('سكن بروح الطبيعة')['garden-serene'] > 0 && s('إطلالة بالبحر')['coastal-light'] > 0 && s('بيت للعائلة')['family-warm'] > 0
        && s('المنطقة الشرقية')['calm-luxury'] === 0 && s('أبحر')['coastal-light'] === 0 && s('Marina Bay')['coastal-light'] > 0;
})());
t('words: the name and tagline weigh more than page titles, and titles more than body text', (() => {
    const score = (o) => moodScores({ facts: facts(o.facts || {}), spec: o.spec || { pages: [] } }).scores['urban-bold'];
    return score({ facts: { name: 'برج النخبة' } }) > score({ spec: pages('برج النخبة') }) && score({ spec: pages('برج النخبة') }) > score({ spec: { pages: [{ kind: 'about', variant: 'text', text: { body: 'برج النخبة', bullets: [], figures: [] } }] } });
})());
t('norm: diacritics, tatweel and hamza forms are folded', norm('إتـــزانً') === 'اتزان' && norm('شاطئ') === 'شاطي' && norm('أرقى') === 'ارقي');
t('signals: a coastal district, a high price per metre, large family units and villas (in the models or «75 فلة» in the text) each move their mood', (() => {
    const s = (o, spec) => moodScores({ facts: facts(o), spec: spec || { pages: [] } }).scores;
    return s({ district: 'الشاطئ' })['coastal-light'] > 0 && s({ models: [apt('A', 100, 900000, 3)] })['calm-luxury'] > 0
        && s({ models: [apt('A', 300, 900000, 6)] })['family-warm'] > 0 && s({ models: [{ name: 'فيلا 1', type: 'فيلا', area: 400, price: 2000000 }] })['family-warm'] > 0
        && s({}, { pages: [{ kind: 'about', variant: 'text', text: { title: 'المقدمة', body: 'يقدم المشروع 75 فلة سكنية', bullets: [], figures: [] } }] })['family-warm'] > 0;
})());
t('signals: many interior photos lean luxury; the photos\' family leans its moods', moodScores(hayat).why['calm-luxury'].includes('صور داخلية كثيرة')
    && moodScores({ ...naqsh, family: 'forest' }).scores['garden-serene'] > moodScores({ ...naqsh, family: null }).scores['garden-serene']);
t('signals: no signal at all is a calm direction, never an error', artDirection({ facts: {}, spec: {} }, 0).mood === 'calm-luxury' && artDirection(null, 0).mood === 'calm-luxury'
    && artDirection(undefined).rhythm.cover === 'type');
t('rank: every mood is ranked once', rankMoods(sky).length === Object.keys(MOODS).length && new Set(rankMoods(sky)).size === Object.keys(MOODS).length);

// الغلاف من إيقاع الطابع بقدر ما تحمله صورته
t('cover: full only for a landscape photo with the pixels for the page; low only for a wide one; side for any but a panorama; type without a photo',
    coverFits(img('exterior', 2400, 1923), 'full') && !coverFits(img('exterior', 1200, 960), 'full') && !coverFits(img('exterior', 1240, 1754), 'full')
    && coverFits(img('exterior', 3000, 1500), 'low') && !coverFits(img('exterior', 1600, 2000), 'low') && coverFits(img('exterior', 600, 400), 'side')
    && !coverFits(img('exterior', 2008, 783), 'side') && coverFits(null, 'type') && !coverFits(null, 'side'));
t('cover: a heritage facade fills the page; a small photo falls back to beside the split; the alternative swaps them', (() => {
    const small = artDirection({ ...naqsh, facts: { ...naqsh.facts, images: [img('exterior', 900, 700)] } }, 0);
    return five[1].rhythm.cover === 'full' && small.rhythm.cover === 'side' && artDirection(naqsh, 1).rhythm.cover === 'side';
})());
t('cover: a panorama keeps its band even when the mood prefers beside the split (it would lose half its width)',
    artDirection({ ...serin, facts: { ...serin.facts, name: 'برج', tagline: null }, family: null }, 0).rhythm.cover === 'low');
t('cover: a panorama too small for every cover stays a band on every alternative (beside the split it would show 39% of it, softer)',
    [0, 1, 2, 3].every((v) => artDirection({ ...serin, facts: { ...serin.facts, images: [img('exterior', 1506, 587, { wide: true })] } }, v).rhythm.cover === 'low'),
    [0, 1, 2, 3].map((v) => artDirection({ ...serin, facts: { ...serin.facts, images: [img('exterior', 1506, 587, { wide: true })] } }, v).rhythm.cover));
t('cover: urban-bold puts the name on its deep field; no cover photo → the type cover', five[2].rhythm.coverTone === 'deep' && five[3].rhythm.cover === 'type'
    && artDirection({ ...sky, spec: { pages: [{ kind: 'cover', variant: 'type' }] } }, 0).rhythm.cover === 'type');

// خصائص CSS والخطوط
const style = directionStyle(five[2]);
t('style: CSS custom properties for every colour, both fonts, their size and weights — and nothing else',
    ['--p-paper:', '--p-sand:', '--p-stone:', '--p-ink:', '--p-text:', '--p-muted:', '--p-hair:', '--p-accent:', '--p-accent-d:', '--p-on:', '--deep:', '--pale:', '--display:', '--plex:', '--dk:', '--dl:', '--w-title:', '--w-head:', '--w-fig:', '--w-fig2:'].every((k) => style.includes(k))
    && style.split(';').every((x) => /^--[a-z0-9-]+:[^;<>"{}]+$/.test(x)), style);
t('style: numbers and Latin first in the display stack, then the Arabic display font; the text font is always IBM Plex Sans Arabic',
    /--display:'Antonio', 'Noto Kufi Arabic', 'IBM Plex Sans Arabic'/.test(style) && /--plex:'IBM Plex Sans Arabic', Tahoma/.test(style) && TEXT_FONT === 'IBM Plex Sans Arabic'
    && /--display:'Readex Pro', 'IBM Plex Sans Arabic', Tahoma/.test(directionStyle(five[0])));
t('style: a smaller Naskh face is set larger and its lines tighter, so the seven-step scale reads the same', /--dk:1\.22;--dl:0\.82/.test(directionStyle(five[1])) && /--dk:1;--dl:1;/.test(directionStyle(five[4])));
t('fonts: every pairing\'s faces and weights are imported by brochure.css from Google Fonts, digits faces by their glyphs only', (() => {
    const css = readFileSync(new URL('../crm/brochure.css', import.meta.url), 'utf8');
    const urls = [...css.matchAll(/@import url\('([^']+)'\)/g)].map((m) => m[1]);
    if (!urls.length || !urls.every((u) => u.startsWith('https://fonts.googleapis.com/css2?'))) return false;
    const have = (name, w, needText) => urls.some((u) => {
        const m = new RegExp('family=' + name.replace(/ /g, '\\+') + ':wght@([0-9;]+)').exec(u);
        return m && m[1].split(';').map(Number).includes(w) && (!needText || /&text=/.test(u));
    });
    const { arabic, latin } = fontFamilies();
    const nearest = (name, w, need) => have(name, w, need) || [w - 100, w + 100, w + 200].some((x) => have(name, x, need));
    return [...arabic].every(([name, ws]) => [...ws].some((w) => have(name, w, false)) && [...ws].every((w) => nearest(name, w, false)))
        && [...latin].every(([name, ws]) => [...ws].every((w) => nearest(name, w, true)));
})());
t('fonts: the digits faces are the vetted ones whose «1» never reads as an alef beside Arabic', Object.values(PAIRINGS).every((p) => [null, 'Jost', 'Cormorant Garamond', 'Antonio', 'Fraunces', 'Nunito Sans'].includes(p.figures)));
t('moods: each mood names known pairings, covers and rhythm values, a dark-page limit and a default field', Object.values(MOODS).every((m) => m.types.length >= 2 && m.types.every((x) => PAIRINGS[x])
    && m.covers.every((c) => ['side', 'low', 'full'].includes(c)) && ['paper', 'deep'].includes(m.coverTone) && ['bleed', 'framed'].includes(m.photos)
    && ['paper', 'deep'].includes(m.panel) && ['quiet', 'bold'].includes(m.opener) && m.dark >= 1 && m.dark <= 3 && m.fields.default && FAMILIES.every((f) => m.fields[f])));
t('label: one line for the staff with the mood, the type and the alternative', directionLabel(five[0]) === 'إخراج «طبيعة وهدوء» · خط ريدكس — 1 من 4', directionLabel(five[0]));

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
