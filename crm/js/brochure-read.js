// قراءة المساعد لبروشور المطوّر صفحةً صفحة (agent_requests.result، الإصدار 2) + صوره المستخرجة (media.json) ← بروشور ملائم
// بعدد الصفحات نفسه: صف «مشروع» يقبله brochureFacts، ومخطط صفحات (صفحة لكل صفحة)، وملاحظات للمدير — بلا DOM وبلا شبكة،
// فيُختبر وحده.
//
// كل صفحة تأخذ شكلها من دورها كما قرأه المساعد (غلاف، عن المشروع، صور، نموذج، موقع، مزايا، تواصل) ونصوصها كما طُبعت،
// وصورها من صور الصفحة نفسها (المصغّرات المرقّمة تحت كل صفحة). يُترك ما قال المساعد إنه شعار أو خلفية أو صورة بشر جاهزة،
// ولا يُعرض مخطط يناقض نموذجه (مخطط «شقة 3، 168م²» على صفحة «ملحق 3، 225م²» في بروشور لامير سيرين): الأرقام وحدها أصدق.
// صفحة لم تُقرأ تُصمَّم من صورها وحدها، فلا ينقص العدد.
// وصفحة كلام لا تكرر صورة الصفحة التي قبلها، والمزايا التي تبدأ كلها بعدد (الضمانات) صفحة أرقام، والصفحة التي تسبق سلسلة
// النماذج بلا نص طويل («نماذج الوحدات») افتتاحٌ لها بفهرسها.
// الغلاف أقوى صورة في البروشور: صورة غلاف المطوّر، وإلا الواجهة التي أفرد لها المطوّر صفحة كاملة؛ والصفحة التي أُخذت صورتها
// للغلاف في أول البروشور تصير فهرسه وبطاقة المشروع، فلا تتكرر الصورة ولا تُضاف صفحة. وألوان البروشور عائلة لون مشروعه.

// والصور التي حسّنها الخادم (result.enhanced، agent-run/enhance.ts) تُطبع مكان أصلها بفهرسها نفسه وصفاتها هي.
// وترتيب البروشور كتاب: النماذج المتاحة قبل المباعة في كل مجموعة، فلا يفتح فصلٌ بوحدة مباعة؛ وصفحة مزايا بلا صورة، ونموذج بلا
// مخطط، وصفحة «تواصل معنا» الأخيرة تستعير صورة من صور المشروع نفسه لم تظهر في الصفحات المجاورة.

import { brochureTone, brandColour, sameView } from './brochure-media.js';
import { groupOf, numberRows, durationRow, DURATION } from './brochure-plan.js';

const PHOTO_ROLES = new Set(['exterior', 'interior', 'aerial', 'map', 'plan3d', 'lifestyle']);
const MAX_PAGES = 40;   // حد طلب البروشور (036)
const DROPPED_ROLES = new Set(['logo', 'texture', 'people', 'other']);

// ترقيم النص المطبوع بلا تغيير كلمة: لا مسافة قبل الفاصلة والنقطة، ومسافة واحدة بعد الفاصلة العربية، و«و» العطف ملتصقة
// بما بعدها، والمدى بين عددين شرطةٌ قصيرة بلا مسافات («25- 26» ← «25–26») معزولاً باتجاه الأرقام فيُقرأ كما طبعه المطوّر، والتنوين على الحرف قبل الألف («إتزاناً» ← «إتزانًا»)،
// ومسافة واحدة بين الكلمات. والعنوان بلا نقطة في آخره
// ووحدة المساحة بعد عدد بصيغة واحدة «م²» كبقية البروشور («168م2»، «60 m²»، «120sqm» ← «168م²»، «60 م²»، «120م²»)، و«m» وحدها
// كذلك في نص عن المساحة («مساحة 300m»)؛ الوحدة وحدها تتغير، والكلمات كما طُبعت
const AREA_UNIT = /([\d٠-٩])(\s?)(?:m²|m2|㎡|sqm|م2)(?![A-Za-z\d٠-٩²])/gi;
export function areaUnit(value, area) {
    if (typeof value !== 'string') return value;
    const t = value.replace(AREA_UNIT, '$1$2م²');
    return area || /مساح/.test(t) ? t.replace(/([\d٠-٩])(\s?)m(?![A-Za-z\d²])/gi, '$1$2م²') : t;
}
// وحرف لاتيني واحد داخل كلمة عربية ممدودة («نـــمـــBـــوذج»: حرف النموذج مرسوم وسط الكشيدة) يُنقل إلى آخرها علامةً
// («نموذج B»)، والقوسان بلا مسافات داخلهما («( 4 ) غرف» ← «(4) غرف»)
export function tidy(value) {
    if (typeof value !== 'string') return value;
    return areaUnit(value)
        .replace(/([ء-ي]+)([A-Za-z])([ء-ي]+)/g, '$1$3 $2')
        .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
        .replace(/[ \t\u00A0]+([،؛:.!؟,])/g, '$1')
        .replace(/([،؛])(?=[^\s،؛.])/g, '$1 ')
        .replace(/(^|\s)و\s+(?=[ء-ي])/g, '$1و')
        .replace(/[\u2066\u2069]/g, '')
        .replace(/[\d٠-٩]+(?:\s*[-–]\s*[\d٠-٩]+)+/g, (m) => '\u2066' + m.split(/\s*[-–]\s*/).join('–') + '\u2069')
        .replace(/ا\u064B/g, '\u064Bا')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
function titleText(value, max) {
    const t = str(value, max);
    return t ? t.replace(/\s*\.$/, '') || null : null;
}

// اسم مكتوب للمقارنة: بلا «مشروع» في أوله ولا مسافات ولا تشكيل ولا كشيدة، والهمزات ألفاً
function bare(value) {
    return String(value || '').replace(/^\s*(?:مشروع|مشاريع)\s+/, '').replace(/[\u064B-\u0652ـ\s()«»"'.،\u2066\u2069–-]/g, '').replace(/[أإآ]/g, 'ا').toLowerCase();
}
function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}
// معلم في قائمة الموقع هو المشروع نفسه («مشروع لامير سيرين»، أو «لامير سيين» بخطأ حرف): same، أو قريب منه: near، وإلا null
export function ownName(landmark, name) {
    const a = bare(landmark), b = bare(name);
    if (!a || b.length < 3) return null;
    if (a === b || a.includes(b)) return 'same';
    return b.length >= 6 && distance(a, b) <= 2 ? 'near' : null;
}

// «صورة واحدة»، «صورتان»، «3 صور»، «11 صورة»
function photosWord(n) {
    return n === 1 ? 'صورة واحدة' : n === 2 ? 'صورتان' : n + (n <= 10 ? ' صور' : ' صورة');
}

// أول مساحة في نص مطبوع داخل المخطط: «مساحتها 168م²»، «168 م2»، «مساحة: ١٠٧»، والفاصلة العشرية العربية كالنقطة
// («صالة معيشة ١٦٨,١٥م٢» ← 168.15: كانت تُقرأ 15 فيُحذف مخطط صحيح)
export function areaIn(label) {
    const t = String(label ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٢]/g, '2').replace(/(\d)[٫](\d)/g, '$1.$2');
    // «م» وحدها وحدةٌ ما لم تتبعها حروف («97 م» نعم، «97 مجلس» لا). \b لا يعرف الحروف العربية فلا يصلح هنا
    const m = /(?<![\d.,])(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:م²|م2|م(?![ء-ي])|m²|m2|sqm)/i.exec(t) || /مساح(?:ت\S*|ة)\s*:?\s*(\d{2,4}(?:[.,]\d{1,2})?)/.exec(t);
    return m ? Number(m[1].replace(',', '.')) : null;
}

// نص كما طُبع بلا مدّ الكشيدة (ـ): المطوّر يمدّ الحروف زخرفةً («سيـرين»)، وخط ملائم يرسم الكلمة بلا مدّ
function str(value, max) {
    const t = typeof value === 'string' ? tidy(value.replace(/ـ/g, '')) : '';
    return t ? t.slice(0, max) : null;
}

// أرقام الصفحة البارزة كما طُبعت ({ value: «+700»، label: «عملاء» }): القيمة فيها عدد، وإلا تُترك. وقيمة عنوانها مساحة
// («+300,000m» «المساحة المطورة») وحدتها «م²» كبقية البروشور
function figuresOf(page) {
    return (Array.isArray(page && page.figures) ? page.figures : []).map((f) => {
        const label = f && typeof f === 'object' ? spaced(f.label, 60) : null;
        const value = f && typeof f === 'object' ? areaUnit(str(f.value, 30), /مساح/.test(label || '')) : null;
        return value && /[\d٠-٩]/.test(value) ? { value, label } : null;
    }).filter(Boolean).slice(0, 8);
}

// إملاءان للكلمة نفسها بين صفحتين («وإتزانًا» في صفحة و«اتزانًا» في أخرى: الفرق همزة الألف وحدها)، واسمان للمعلم نفسه بين
// صفحتي الموقع («مشروع SEVEN» و«مشروع سيفين»، «ملعب الجوهرة (الإنماء)» و«مدينة الملك عبدالله الرياضية (ملعب الجوهرة)»):
// يُطبع كلٌّ كما في صفحته، وتُكتب للمدير ملاحظة ليوحّدهما إن شاء. texts: [{ page, strings }]، places: [{ page, items }]
const MARKS = /[ً-ْٰـ]/g;
function hamzaFree(w) {
    return w.replace(/[أإآ]/g, 'ا');
}
// هيكل الحروف الساكنة للمقارنة بين كتابة لاتينية وعربية للاسم نفسه («SEVEN» و«سيفين» ← sfn)
const AR_LATIN = { 'ب': 'b', 'ت': 't', 'ث': 't', 'ج': 'j', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 's', 'ص': 's',
    'ض': 'd', 'ط': 't', 'ظ': 'z', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h' };
function skeleton(part) {
    if (/[A-Za-z]/.test(part)) {
        return part.toLowerCase().replace(/[^a-z]/g, '').replace(/sh/g, 's').replace(/th/g, 't').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/ph/g, 'f')
            .replace(/v/g, 'f').replace(/p/g, 'b').replace(/[cq]/g, 'k').replace(/g/g, 'j').replace(/[aeiouwy]/g, '').replace(/(.)\1+/g, '$1');
    }
    return Array.from(part.replace(MARKS, '')).map((c) => AR_LATIN[c] || '').join('').replace(/(.)\1+/g, '$1');
}
function spellingNotes(texts, places) {
    const notes = [];
    // الكلمات: بلا تشكيل ولا «و» العطف في أولها، خمسة أحرف فأكثر، تختلف همزة ألفها وحدها
    const seen = new Map();
    const flagged = new Set();
    for (const { page, strings } of texts) {
        for (const s of strings) {
            for (const word of String(s || '').split(/[^ء-يً-ْٰـ]+/)) {
                const plain = word.replace(MARKS, '');
                const stem = plain.length >= 6 && plain[0] === 'و' ? plain.slice(1) : plain;
                if (stem.length < 5 || !/[أإآا]/.test(stem)) continue;
                const key = hamzaFree(stem);
                const first = seen.get(key);
                if (!first) { seen.set(key, { stem, word, page }); continue; }
                if (first.stem === stem || first.page === page || flagged.has(key)) continue;
                flagged.add(key);
                notes.push('صفحة ' + first.page + ' «' + first.word + '» وصفحة ' + page + ' «' + word + '»: الكلمة نفسها بإملاءين، وطُبعت كما كتبها المطوّر — وحّدهما قبل المشاركة إن لزم.');
            }
        }
    }
    // المعالم: جزء مشترك (الاسم أو ما بين القوسين) أو الاسم نفسه بحروف لاتينية وعربية
    const parts = (item) => String(item).replace(/[⁦⁩]/g, '').split(/[()]/).map((x) => x.trim()).filter(Boolean);
    const same = (a, b) => parts(a).some((x) => parts(b).some((y) => {
        const bx = bare(x), by = bare(y);
        if (bx.length >= 5 && bx === by) return true;
        const latin = /[A-Za-z]/.test(bx), other = /[A-Za-z]/.test(by);
        if (latin === other) return false;
        const sx = skeleton(x.replace(/^\s*(?:مشروع|مشاريع)\s+/, '')), sy = skeleton(y.replace(/^\s*(?:مشروع|مشاريع)\s+/, ''));
        return sx.length >= 3 && sx === sy;
    }));
    for (let i = 0; i < places.length; i++) {
        for (let j = i + 1; j < places.length; j++) {
            for (const a of places[i].items) {
                for (const b of places[j].items) {
                    if (bare(a) === bare(b) || !same(a, b)) continue;
                    notes.push('صفحة ' + places[i].page + ' «' + a + '» وصفحة ' + places[j].page + ' «' + b + '»: المعلم نفسه باسمين، وطُبع كما كتبه المطوّر في كل صفحة — وحّدهما قبل المشاركة إن لزم.');
                }
            }
        }
    }
    return notes.slice(0, 8);
}
const NUMERIC = /^\s*[+]?\s*[\d٠-٩]/;

// مسافة بين عدد وكلمة ملتصقين وبين العربي واللاتيني كما يُكتبان («2دورات مياه» ← «2 دورات مياه»، «أبوابWPC» ← «أبواب WPC»)،
// و«60م²» تبقى كما هي. في أسماء النماذج أيضاً بين الكلمة والعدد بعدها («ملحق1» ← «ملحق 1» كبقية الملاحق)
export function spaced(value, max, isName) {
    let t = str(value, max);
    if (!t) return null;
    t = t.replace(/([\d٠-٩])([ء-ي]{2})/g, '$1 $2').replace(/([ء-ي])([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])([ء-ي])/g, '$1 $2');
    return isName ? t.replace(/([ء-ي])([\d٠-٩])/g, '$1 $2') : t;
}

// اسم النموذج كما يُطبع عنواناً لصفحته أو لفاصل قبل أدواره: «نموذج A»، «طراز 2»، «فيلا B»، «Type C»
const MODEL_TITLE = /^(?:ال)?(?:نموذج|طراز|فيلا|فيلة|فلة|شقة|ملحق|دوبلكس|تاون\s?هاوس|بنتهاوس|روف|وحدة|type|model)\s*[-:#]?\s*\(?(?:[A-Za-z]{1,2}[\d٠-٩]{0,2}|[\d٠-٩]{1,3}[A-Za-z]?)\)?$/i;
// عنوان صفحة دورٍ من النموذج («مكونات الدور الأرضي» ← «الدور الأرضي»)
const FLOOR_TITLE = /(?:^|\s)(?:ال)?(?:دور|طابق|أرضي|ارضي|الأول|الاول|الثاني|الثالث|العلوي|سطح|ميزانين|بدروم|قبو|روف)(?:\s|$)|ground|floor|roof/i;
function floorText(title) {
    return title.replace(/^(?:مكونات|مكوّنات|محتويات|مخطط|تفاصيل)\s+/, '');
}
// صفحة «المحتويات» في بروشور المطوّر
const TOC = /^(?:ال)?(?:محتويات|محتوى|فهرس)$|^(?:contents|index)$/i;
// خرائط Google كما وضعها المطوّر رابطاً في صفحته
const MAPS = /^https:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl)\S*$/i;
// اسم المطوّر بحروف لاتينية («Alramz») وهو مطبوع بالعربية في صفحة أخرى («شركة الرمز للعقارات»): الكلمة العربية بهيكل حروفه نفسه
function arabicName(latin, texts) {
    if (!latin || /[ء-ي]/.test(latin) || !/[A-Za-z]/.test(latin)) return null;
    const want = skeleton(latin);
    if (want.length < 3) return null;
    for (const { strings } of texts) {
        for (const s of strings) {
            for (const w of String(s || '').split(/[^ء-يً-ْٰـ]+/)) if (w.replace(MARKS, '').length >= 4 && skeleton(w) === want) return w.replace(MARKS, '');
        }
    }
    return null;
}
// عدد الوحدات ومدى المساحات من نص «عن المشروع» كما طُبعا («ليقدِّم 75 فلة سكنية بمساحات تتراوح ما بين 196.45م2 وحتى 220م2»)
function projectCounts(body) {
    const t = String(body || '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[⁦-⁩]/g, '');
    const u = /(?<![\d.,])(\d{1,4})\s*(?:فلة|فلل|فيلا|فيلات|فيلة|وحدة|وحدات|شقة|شقق|منزل)(?![ء-ي])/.exec(t);
    const k = t.search(/مساح/);
    const clause = k >= 0 ? [t.slice(k, k + 140)] : null;
    const areas = clause ? [...clause[0].matchAll(/(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:م²|م2|م(?![ء-ي])|m²|m2)/g)].map((m) => Number(m[1].replace(',', '.'))) : [];
    return { units: u ? Number(u[1]) : null, areas: areas.length >= 2 ? [Math.min(...areas), Math.max(...areas)] : null };
}

// result: القراءة (الإصدار 2)؛ media: { pages, read, images: [{ url, page, w, h, kind, tone, tall, focus, alpha, raster, detail, bg, crop, parts,
// on: [{ page, n }] }], fills, links }؛ meta: { id, variation, mediaPrefix }. ← { project, spec: { version, pages }, notes } أو null لقراءة
// من إصدار آخر. media.json في المخزن العام الذي يرفع إليه الميداني أيضاً: لا تُقبل إلا صور مخزن هذا البروشور (mediaPrefix)، والصفحات بحد الطلب
export function readingToBrochure(result, media, meta = {}) {
    const r = result && typeof result === 'object' ? result : {};
    if (r.version !== 2 || !Array.isArray(r.pages)) return null;
    const p = r.project && typeof r.project === 'object' ? r.project : {};
    const prefix = typeof meta.mediaPrefix === 'string' && meta.mediaPrefix ? meta.mediaPrefix : null;
    // الفهارس تبقى كما في media (أرقام المصغّرات تشير إليها)، والصورة المرفوضة مكانها فارغ. الصورة التي حسّنها الخادم واجتازت
    // فحص الأمانة (result.enhanced: { "فهرس media": رابطها }) تُطبع مكان أصلها بصفات الأصل (طولها ونوعها ولونها)؛ رابطها من
    // مخزن هذا البروشور وحده كالأصل، ولا يُستبدل مخطط (قصّه محسوب على بكسلات الأصل)
    const ours = (url) => typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(url) && (!prefix || url.startsWith(prefix));
    const enhanced = r.enhanced && typeof r.enhanced === 'object' && !Array.isArray(r.enhanced) ? r.enhanced : {};
    const better = new Set();
    const source = media && Array.isArray(media.images) ? media.images : [];
    const all = source.map((m, i) => {
        if (!(m && ours(m.url))) return null;
        const e = Object.prototype.hasOwnProperty.call(enhanced, String(i)) ? enhanced[String(i)] : null;
        if (m.kind === 'plan' || !ours(e) || e === m.url) return m;
        better.add(i);
        return { ...m, url: e, original: m.url };
    });
    // لوحة صور المطوّر (صورتان مؤطرتان في ملف واحد): أجزاؤها صورٌ بفهارس بعد صور media، بدور اللوحة نفسها
    const partsOf = new Map();
    source.forEach((m, i) => {
        if (!all[i] || !Array.isArray(m.parts) || m.parts.length < 2 || !m.parts.every((q) => q && ours(q.url))) return;
        partsOf.set(i, m.parts.map((q) => { all.push({ ...q, kind: 'photo', on: [], parent: i }); return all.length - 1; }));
    });
    const notes = [];
    const variation = meta.variation || 0;
    const projectName = str(p.name, 80);

    // صورة الصفحة برقم مصغّرتها ← فهرسها في media
    const at = new Map();
    all.forEach((m, i) => (m && Array.isArray(m.on) ? m.on : []).forEach((o) => at.set(o.page + ':' + o.n, i)));
    const read = new Map(r.pages.map((x) => [x.page, x]));
    const count = Math.min(MAX_PAGES, Math.max(Number(media && media.read) || 0, ...r.pages.map((x) => x.page), ...(Array.isArray(r.missing) ? r.missing : []), 1));

    // دور كل صورة في صفحتها كما قرأه المساعد، مصحّحاً: الخلفية اللونية والطبقة والظل الناعم (backdrop) ليست صورة أياً كان دورها؛
    // وصورة بشر هي الصورة الوحيدة في صفحة «عن» أو صفحة صور للمطوّر (لقطة حياة صوّرها للمشروع، لا مصافحة جاهزة في صفحة ختام أو تواصل)
    // تبقى صورةً في صفحتها (lifestyle)، ولا تُستعار لصفحة أخرى
    const roleOf = (x, im) => {
        const i = at.get(x.page + ':' + im.n);
        if (i === undefined || !all[i]) return null;
        if (all[i].kind === 'backdrop' || all[i].kind === 'blank') return 'texture';
        if (im.role === 'people' && ['about', 'photos'].includes(x.role) && Number(all[i].w) * Number(all[i].h) >= 1.5e6
            && !(x.images || []).some((o) => o !== im && PHOTO_ROLES.has(o.role) && o.role !== 'map')) return 'lifestyle';
        return im.role;
    };
    // صور الصفحة (فهارس media، واللوحة أجزاؤها) بأدوارها
    const expand = (list) => list.flatMap((x) => (partsOf.has(x.i) && PHOTO_ROLES.has(x.role) ? partsOf.get(x.i).map((i) => ({ ...x, i })) : [x]));

    // صور البروشور التي تُطبع: فهرس media ← فهرس في project.images. التعليق لكل صورة من أول صفحة طُبع فيها معها
    const images = [];
    const factIndex = new Map();
    const use = (i, kind, caption) => {
        const m = all[i];
        if (!factIndex.has(i)) {
            factIndex.set(i, images.length);
            const focus = Array.isArray(m.focus) && m.focus.length === 2 ? m.focus : null;
            images.push({ url: m.url, kind: kind === 'plan3d' ? 'plan3d' : kind === 'lifestyle' || kind === 'people' ? 'photo' : kind, caption: spaced(caption, 60), tall: m.tall === true,
                wide: Number(m.w) > 0 && Number(m.h) > 0 && m.w / m.h >= 1.9, deep: typeof m.deep === 'string' ? m.deep : null,
                w: Number(m.w) > 0 ? Number(m.w) : null, h: Number(m.h) > 0 ? Number(m.h) : null, quiet: m.quiet === 'left' || m.quiet === 'right' ? m.quiet : null,
                focus, alpha: m.alpha === true, tone: m.tone === 'light' ? 'light' : 'dark', raster: m.raster === true, detail: typeof m.detail === 'number' ? m.detail : null });
        } else if (caption && !images[factIndex.get(i)].caption) images[factIndex.get(i)].caption = spaced(caption, 60);
        return factIndex.get(i);
    };
    // الصور المعروضة في كل صفحة (فهارس media): صفحة نصّها هو المهم لا تكرر صورة الصفحة التي قبلها (الغلاف يستعير صورة
    // «عن المشروع» حين لا صورة في غلاف المطوّر، فتصير صفحة «عن المشروع» بعده صفحة كلام لا الصورة نفسها مرة ثانية)
    const shown = new Map();
    // الصور التي قال المساعد في أي صفحة إنها شعار أو خلفية أو صورة جاهزة، والخلفيات اللونية: تُترك، وتُعدّ مرة واحدة
    const dropped = new Set();
    for (const x of r.pages) for (const im of x.images || []) if (DROPPED_ROLES.has(roleOf(x, im))) dropped.add(at.get(x.page + ':' + im.n));
    // صور الصفحة بأدوارها: من المساعد، وإلا من تقدير الاستخراج (مخطط أو صورة) لصفحة لم تُقرأ — بلا الخلفيات والطبقات
    // رسوم المطوّر الخطية المستخرجة من صفحة (vector) لم يذكرها المساعد بين صورها: الأكبر أولاً. مخططاتٌ ودورٌ مرسوم في بروشور
    // مخططاته كلها خطوط (لا مخطط صورةً فيه)؛ وفي بروشور مخططاته صور، الرسم الخطي في صفحة نموذج لوحٌ وإطار لا مخطط
    const rasterPlans = r.pages.some((x) => (x.images || []).some((im) => im.role === 'plan' && at.has(x.page + ':' + im.n) && all[at.get(x.page + ':' + im.n)] && !all[at.get(x.page + ':' + im.n)].vector));
    // والرسم الخطي ليس خلفية ولا شعاراً وإن سمّاه المساعد كذلك: يبقى متاحاً ما لم يجعله المساعد صورة للصفحة
    const drawingsOn = (n, page, most) => {
        const listed = new Set((page && page.images ? page.images : []).filter((im) => !DROPPED_ROLES.has(im.role)).map((im) => at.get(n + ':' + im.n)));
        return all.map((m, i) => ({ m, i })).filter(({ m, i }) => m && m.vector === true && !listed.has(i) && (m.on || []).some((o) => o.page === n)
            && (typeof m.text !== 'number' || m.text < (most || 0.12)))
            .sort((a, b) => (Number(b.m.w) * Number(b.m.h) || 0) - (Number(a.m.w) * Number(a.m.h) || 0)).map(({ i }) => i);
    };
    const picsOf = (n, page) => {
        if (page) {
            return expand(page.images.map((im) => ({ i: at.get(n + ':' + im.n), role: roleOf(page, im), caption: im.caption }))
                .filter((x) => x.i !== undefined && all[x.i] && x.role && !DROPPED_ROLES.has(x.role)));
        }
        return expand(all.map((m, i) => ({ m, i })).filter(({ m, i }) => m && !dropped.has(i) && ['plan', 'photo'].includes(m.kind) && (m.on || []).some((o) => o.page === n))
            .map(({ m, i }) => ({ i, role: m.kind === 'plan' ? 'plan' : 'exterior', caption: null })));
    };

    // أسماء النماذج وأدوارها: صفحة نموذج بلا اسم تأخذ عنوانها إن كان اسماً («نموذج A»)، وإلا اسم آخر فاصلٍ قبلها («نموذج A» ثم
    // «مكونات الدور الأرضي» و«الدور الأول»…: الصفحات تُقرأ متوازية فلا ترى صفحة الدور فاصل نموذجها)، وعنوانها حينئذ اسم الدور
    const naming = new Map();
    let carry = null;
    for (let n = 1; n <= count; n++) {
        const x = read.get(n);
        const title = x ? titleText(x.title, 120) : null;
        const m = x && x.model ? x.model : null;
        const data = Boolean(m && (m.name || m.area || m.price || m.rooms || (m.parts || []).length));
        const named = Boolean(title && MODEL_TITLE.test(title));
        if (x && x.role === 'model' && data) {
            const floor = title && !named && FLOOR_TITLE.test(title) && !(m.name && bare(title).includes(bare(m.name))) ? floorText(title) : null;
            if (m.name) { naming.set(n, { name: null, floor }); carry = null; }
            else if (named) { naming.set(n, { name: title, floor: null }); carry = title; }
            else naming.set(n, { name: carry, floor: carry ? (title ? floorText(title) : null) : floor });
        } else if (x && named && !data) carry = title;
        else if (x) carry = null;
    }

    const models = [];
    const pages = [];
    let statsShown = false;
    // الغلاف الخلفي (تواصل ملائم) مكان صفحة المطوّر الختامية (غلافه الخلفي أو تواصل أو غيرها في آخر البروشور)، وإلا مكان آخر
    // صفحة تواصل، وإلا آخر صفحة ما لم تكن نموذجاً: العدد نفسه وخاتمة ملائم في آخره. وعنوان صفحة أخيرة فيها كلام («افراغ فوري»)
    // يُطبع على الغلاف الخلفي نفسه فلا يضيع
    const contactPages = r.pages.filter((x) => x.role === 'contact').map((x) => x.page);
    const final = read.get(count);
    const lastContact = count < 2 ? null
        : !final || ['cover', 'contact', 'other'].includes(final.role) ? count
        : contactPages.length ? Math.max(...contactPages)
        : final.role !== 'model' ? count : null;
    // صورة الغلاف حين لا صورة في غلاف المطوّر: الواجهة التي أفرد لها المطوّر صفحة وحدها (صفحة صور فيها صورة خارجية واحدة):
    // في أول البروشور أولاً (صفحتها تصير الفهرس فلا تتكرر الصورة)، ثم الأكبر بكسلاتٍ، ثم الأعرض؛ وإلا أول صورة خارجية في البروشور
    const heroExterior = () => {
        const solo = [];
        let firstSeen = null;
        for (const x of r.pages) {
            const ext = (x.images || []).filter((im) => roleOf(x, im) === 'exterior').map((im) => at.get(x.page + ':' + im.n)).filter((i) => i !== undefined && all[i] && !dropped.has(i));
            if (firstSeen === null && ext.length) firstSeen = ext[0];
            const photos = (x.images || []).filter((im) => PHOTO_ROLES.has(roleOf(x, im)) && roleOf(x, im) !== 'map');
            if (x.page > 1 && x.role === 'photos' && ext.length === 1 && photos.length === 1) solo.push({ i: ext[0], page: x.page });
        }
        const ratio = (i) => (Number(all[i].w) > 0 && Number(all[i].h) > 0 ? all[i].w / all[i].h : 1);
        const px = (i) => (Number(all[i].w) || 0) * (Number(all[i].h) || 0);
        solo.sort((a, b) => (a.page <= 6 ? 0 : 1) - (b.page <= 6 ? 0 : 1) || px(b.i) - px(a.i) || ratio(b.i) - ratio(a.i));
        return solo.length ? solo[0].i : firstSeen;
    };
    let coverFrom = null;
    // النص المطبوع لكل صفحة ومعالم صفحات الموقع، لملاحظات الإملاء بين الصفحات
    const texts = [], places = [];
    const pageLinks = (Array.isArray(media && media.links) ? media.links : []).filter((l) => l && typeof l.url === 'string' && MAPS.test(l.url));

    for (let n = 1; n <= count; n++) {
        const page = read.get(n) || null;
        const role = page ? page.role : 'other';
        const pics = picsOf(n, page);
        const photos = pics.filter((x) => PHOTO_ROLES.has(x.role) && x.role !== 'map');
        const plans = pics.filter((x) => x.role === 'plan');
        let bullets = (Array.isArray(page && page.bullets) ? page.bullets : []).map((x) => spaced(x, 120)).filter(Boolean).slice(0, 16);
        // قائمة الموقع لا تعدّ المشروع نفسه بين معالمه؛ واسم قريب منه بخطأ حرف («لامير سيين») يُترك وتُكتب ملاحظة
        if (role === 'location' && projectName) {
            bullets = bullets.filter((x) => {
                const own = ownName(x, projectName);
                if (own === 'near') notes.push('صفحة ' + n + ': «' + x + '» في قائمة المعالم يشبه اسم المشروع «' + projectName + '»، فلم يُطبع فيها.');
                return !own;
            });
        }
        let figures = figuresOf(page);
        // رقم بارز عنوانه سطرٌ في القائمة نفسها («2» و«مصعد أتوماتيك بالكامل») يُطبع في سطره: «2 مصعد أتوماتيك بالكامل»
        figures = figures.filter((f) => {
            const k = f.label ? bullets.findIndex((b) => bare(b) === bare(f.label)) : -1;
            if (k < 0 || !/^[+]?[\d٠-٩]/.test(f.value)) return true;
            bullets[k] = f.value + ' ' + bullets[k];
            return false;
        });
        const text = page ? { title: titleText(page.title, 120), subtitle: str(page.subtitle, 120), body: str(page.body, 600), bullets, figures } : null;
        const hasText = Boolean(text && (text.title || text.body || text.bullets.length || text.figures.length));
        if (text) texts.push({ page: n, strings: [text.title, text.subtitle, text.body, ...bullets, ...figures.map((f) => f.label), ...pics.map((x) => x.caption)] });
        if (role === 'location' && bullets.length) places.push({ page: n, items: bullets });
        const now = new Set();
        shown.set(n, now);
        const before = shown.get(n - 1) || new Set();
        const fresh = photos.filter((x) => !before.has(x.i));
        const photo = (x) => { now.add(x.i); return use(x.i, x.role, x.caption); };

        if (n === 1) {
            const wide = photos.find((x) => !all[x.i].tall) || photos[0];
            const borrowed = wide ? null : heroExterior();
            if (borrowed !== null && borrowed !== undefined) { now.add(borrowed); coverFrom = borrowed; }
            const hero = wide ? photo(wide) : borrowed !== null && borrowed !== undefined ? use(borrowed, 'exterior', null) : null;
            // صورة بانورامية: شريطاً عريضاً فوق الاسم؛ وغيرها حتى خط القسمة. «تصميم آخر» يبدّل بينهما
            const order = hero !== null && images[hero].wide ? ['low', 'side'] : ['side', 'low'];
            // سطر الغلاف كما طبعه المطوّر تحت الاسم («وحدات سكنية جاهزه»، «افراغ فوري») لا الاسم اللاتيني نفسه
            const sub = text && text.subtitle && bare(text.subtitle) !== bare(p.name_latin) && bare(text.subtitle) !== bare(p.name) ? text.subtitle : null;
            const cover = hero !== null ? { kind: 'cover', variant: order[variation % 2], images: [hero] } : { kind: 'cover', variant: 'type' };
            if (sub) cover.text = { title: null, subtitle: sub, body: null, bullets: [], figures: [] };
            pages.push(cover);
            continue;
        }
        if (n === lastContact) {
            const closing = text && text.title && !['cover', 'contact'].includes(role) ? { title: text.title, subtitle: text.subtitle, body: null, bullets: [], figures: [] } : null;
            pages.push(closing ? { kind: 'back', variant: 'brand', text: closing } : { kind: 'back', variant: 'brand' });
            if (closing && (text.bullets.length || text.body)) notes.push('صفحة ' + n + ' الأخيرة فيها كلام للمطوّر صار مكانها غلاف ملائم الخلفي' + (closing ? ' وعليه عنوانها «' + closing.title + '»' : '') + ' — راجع ما لم يُطبع منها.');
            continue;
        }
        const m = page && page.model ? page.model : {};
        const modelish = Boolean(m.name || m.area || m.price || m.rooms || (m.parts || []).length);
        const planPage = !photos.length && plans.length > 0 && (role === 'photos' || role === 'other');
        if ((role === 'model' && (modelish || plans.length)) || planPage) {
            // بلا مخطط بين صور الصفحة: رسم المطوّر الخطي في الصفحة نفسها مخططُها (مخططات «كيان» مرسومة خطوطاً)
            const drawing = plans.length || rasterPlans ? null : drawingsOn(n, page, 0.25)[0];
            let plan = plans[0] ? all[plans[0].i] : drawing !== undefined && drawing !== null ? all[drawing] : null;
            // مساحة مطبوعة على المخطط تناقض النموذج حين تكون مساحة وحدة مثله (60% منه فأكثر)؛ والأصغر منها مساحة غرفة لا تناقض
            const printed = areaIn(m.plan_label);
            if (plan && printed && m.area && Math.abs(printed - m.area) > 1 && printed >= m.area * 0.6) {
                notes.push('صفحة ' + n + ': مخطط ' + (m.name || 'النموذج') + ' مكتوب عليه ' + printed + 'م² والنموذج ' + m.area + 'م² — لم يُعرض المخطط، وتُعرض الأرقام وحدها.');
                plan = null;
            }
            const named = naming.get(n) || {};
            const name = spaced(m.name, 40, true) || spaced(named.name, 40, true);
            if (!name) notes.push('صفحة ' + n + ': لم يُقرأ اسم النموذج، فعنوانه ' + (m.area ? 'مساحته' : 'عنوان صفحته') + ' — أضف اسمه من بروشور المطوّر إن لزم.');
            // المخطط: قصّه من استخراجه (مخطط الوحدة ومخطط الدور)، ولونه من لوحه: خطوط مضيئة على لوح داكن تُعرض حبراً على الورق
            const light = plan && (plan.tone === 'light' || (plan.kind !== 'plan' && typeof plan.bg === 'number' && plan.bg < 0.4));
            models.push({
                name, floor: named.floor ? str(named.floor, 40) : null, type: str(m.type, 30), orientation: str(m.orientation, 40),
                rooms: m.rooms ?? null, bathrooms: m.bathrooms ?? null, area: m.area ?? null, price: m.price ?? null,
                status: m.sold ? 'sold' : 'available', parts: (Array.isArray(m.parts) ? m.parts : []).map((x) => spaced(x, 80)).filter(Boolean),
                plan: plan ? plan.url : null, plan_tone: light ? 'light' : 'dark', plan_board: Boolean(plan && light && plan.alpha !== true),
                plan_ratio: plan && Number(plan.w) > 0 && Number(plan.h) > 0 ? plan.w / plan.h : null,
                plan_crop: plan && plan.crop && typeof plan.crop === 'object' ? { unit: plan.crop.unit || null, key: plan.crop.key || null } : null
            });
            pages.push({ kind: 'model', variant: plan ? 'plan' : 'facts', model: models.length - 1, text });
            continue;
        }
        if (role === 'location') {
            // رسم خطي خريطةً حين لا تطبع الصفحة معالمها كلمات: قائمة المعالم المرسومة حروفاً كبيرة («سوق المرجان») رسمٌ لكلماتها لا خريطة
            const drawn = bullets.length ? undefined : drawingsOn(n, page)[0];
            const where = pics.find((x) => x.role === 'map') || pics.find((x) => x.role === 'aerial') || (drawn !== undefined ? { i: drawn, role: 'map', caption: null } : null);
            // أول صفحة موقع صورتها جوّية عريضة: صفحة كاملة بلا هوامش، والكلام على كتلة من الورق في زاويتها
            const wide = where && where.role !== 'map' && Number(all[where.i].w) / Number(all[where.i].h) >= 1.5;
            const hero = wide && !pages.some((x) => x.kind === 'location');
            pages.push(where ? { kind: 'location', variant: hero ? 'hero' : 'map', images: [photo(where)], text } : { kind: 'location', variant: 'text', text });
            continue;
        }
        if (role === 'amenities' && text) {
            // صفحة أرقام: كل سطر فيها مدة («25 سنة الأفياش»، «السباكة سنتان…» بشرطها)، أو أرقامها البارزة وحدها؛ وسطر أو سطران بلا
            // عدد يُطبعان تحت الأرقام. قائمة مزايا ومعها أرقام بارزة: القائمة والأرقام في حقلين (mixed). لا حد صامتاً: 12 رقماً و16 سطراً
            const rows = numberRows(text);
            const lines = text.bullets.map(durationRow);
            const allLines = text.bullets.length >= 2 && lines.every((x) => x && DURATION.test(x.unit));
            const figsOnly = !text.bullets.length && text.figures.length >= 2 && rows.length === text.figures.length;
            const numbersPlus = !text.bullets.length ? false : text.figures.length >= 2 && rows.length === text.figures.length && text.bullets.length <= 2;
            if ((allLines || figsOnly || numbersPlus) && rows.length >= 2 && rows.length <= 12) {
                const pg = { kind: 'features', variant: 'numbers', text };
                if (numbersPlus) pg.extra = text.bullets.slice();
                pages.push(pg);
                continue;
            }
            if (text.bullets.length && text.figures.length) {
                pages.push({ kind: 'features', variant: 'mixed', text });
                continue;
            }
            if (text.bullets.length) {
                pages.push(fresh.length ? { kind: 'features', variant: 'photo', images: [photo(fresh[0])], text } : { kind: 'features', variant: 'list', text });
                continue;
            }
        }
        // صفحة «تواصل» قبل آخر البروشور: دعوة ملائم برقم المكتب، وكلام المطوّر (إخلاء المسؤولية) سطراً صغيراً تحتها
        if (role === 'contact' && hasText) {
            const pg = { kind: 'statement', variant: 'say', call: true, text: { ...text, title: text.title || 'تواصل معنا' } };
            if (fresh.length) pg.images = [photo(fresh[0])];
            pages.push(pg);
            continue;
        }
        if (role === 'about' || role === 'contact' || (role === 'amenities' && hasText) || (!photos.length && hasText)) {
            // أول صفحة «عن المشروع» تحمل أرقامه؛ وصفحة نص قصير بلا صورة (عنوان وسطر أو سطران) صفحة فاصلة بنصها، لا صفحة شبه فارغة
            // صفحة لها أرقامها البارزة (سجل المطوّر) تطبعها هي لا أرقام المشروع
            const stats = role === 'about' && !statsShown && !text.figures.length;
            const short = !fresh.length && !stats && text.title && !text.bullets.length && !text.figures.length && (!text.body || text.body.length <= 220);
            // عنوان قصير ومعه رسم المطوّر الخطي (دور متكرر بألوان وحداته، أو مخطط عام): الرسم لوحةً وعنوانه تعليقها
            const drawing = short && !text.body && !rasterPlans ? drawingsOn(n, page)[0] : undefined;
            if (drawing !== undefined) {
                pages.push({ kind: 'photo', variant: 'plate', images: [use(drawing, 'plan', null)], text });
                continue;
            }
            if (short) {
                pages.push({ kind: 'statement', variant: 'say', text });
                continue;
            }
            if (stats) statsShown = true;
            pages.push(fresh.length ? { kind: 'about', variant: 'split', images: [photo(fresh[0])], text, stats } : { kind: 'about', variant: 'text', text, stats });
            continue;
        }
        // صور: ثلاث فأكثر لوحات (الداخلية أولاً)، واثنتان متجاورتان، وواحدة كاملة؛ وصفحة صور فقدت صورها (كلها خلفيات) تستعير
        // صورة لم تُعرض من صور المشروع، وإلا فاصلٌ باسم المشروع
        const order = photos.filter((x) => x.role === 'interior').concat(photos.filter((x) => x.role !== 'interior'));
        if (order.length >= 3) pages.push({ kind: 'trio', variant: 'panels', images: order.slice(0, 3).map(photo), text });
        else if (order.length === 2) pages.push({ kind: 'pair', variant: 'offset', images: order.map(photo), text });
        else if (order.length === 1) pages.push({ kind: 'photo', variant: 'full', images: [photo(order[0])], text });
        else pages.push({ kind: 'statement', variant: 'say', empty: true });
    }

    // رابط الموقع على الخرائط كما وضعه المطوّر: في صفحة الموقع التي هو فيها، وإلا في أول صفحة موقع
    const locs = pages.map((pg, k) => (pg.kind === 'location' ? k : -1)).filter((k) => k >= 0);
    for (const k of locs) { const l = pageLinks.find((x) => x.page === k + 1); if (l) pages[k].link = l.url; }
    if (locs.length && pageLinks.length && !locs.some((k) => pages[k].link)) pages[locs[0]].link = pageLinks[0].url;

    // سلسلة صفحات النماذج: كل مجموعة معاً بترتيب ظهورها، والمتاح فيها قبل المباع، فلا يفتح فصل («الملاحق») بوحدة مباعة والمباع
    // كتلة واحدة في آخر فصله. ثم النماذج نفسها بترتيب صفحاتها الجديد، فتشير الصفحات وفهرس الافتتاح إلى فهارسها
    let moved = false;
    for (let k = 0; k < pages.length; k++) {
        if (pages[k].kind !== 'model') continue;
        let end = k;
        while (end + 1 < pages.length && pages[end + 1].kind === 'model') end++;
        const run = pages.slice(k, end + 1);
        const groups = [];
        for (const pg of run) if (!groups.includes(groupOf(models[pg.model]))) groups.push(groupOf(models[pg.model]));
        const rank = (pg) => groups.indexOf(groupOf(models[pg.model])) * 2 + (models[pg.model].status === 'sold' ? 1 : 0);
        const sorted = run.map((pg, j) => ({ pg, j })).sort((a, b) => rank(a.pg) - rank(b.pg) || a.j - b.j);
        if (sorted.some((x, j) => x.j !== j)) moved = true;
        sorted.forEach((x, j) => { pages[k + j] = x.pg; });
        k = end;
    }
    const ordered = [];
    for (const pg of pages) if (pg.kind === 'model') { ordered.push(models[pg.model]); pg.model = ordered.length - 1; }
    models.splice(0, models.length, ...ordered);

    // صفحة صورة أو فاصلة بلا نص طويل تسبق سلسلة نماذج («نماذج الوحدات» وصورة النموذج): افتتاح النماذج، وفيه فهرسها
    // بأسمائها ومساحاتها وأسعارها من القراءة نفسها، فتبدأ سلسلة صفحات النماذج الطويلة بباب لا بصفحة صورة عابرة
    for (let k = 1; k < pages.length - 1; k++) {
        const pg = pages[k];
        if (pages[k + 1].kind !== 'model' || !(pg.kind === 'photo' || (pg.kind === 'statement' && pg.variant === 'say' && !pg.call))) continue;
        if (pg.text && (pg.text.body || pg.text.bullets.length)) continue;
        let end = k + 1;
        while (end + 1 < pages.length && pages[end + 1].kind === 'model') end++;
        pages[k] = { kind: 'statement', variant: 'chapter', images: pg.images || [], text: pg.text || null, models: [pages[k + 1].model, pages[end].model] };
    }

    // بصمة اللقطة لكل صورة مطبوعة (view في media)، لصورتين من الزاوية نفسها
    const mediaOf = new Map([...factIndex].map(([i, ix]) => [ix, i]));
    const viewOf = (ix) => { const i = mediaOf.get(ix); return i !== undefined && all[i] && typeof all[i].view === 'string' ? all[i].view : null; };
    // اللقطة نفسها في صفحتين متجاورتين («نقش»: ركن A-40 في صفحة «عن المشروع» ثم صفحةً كاملة بعدها مباشرة): صفحة الكلام تترك
    // صورتها وتُطبع نصاً، فلا يرى القارئ المنظر نفسه مرتين متتاليتين، وتبقى الصورة المتروكة لصفحة بلا صورة
    const twins = [];
    pages.forEach((pg, k) => {
        if (pg.kind !== 'about' || pg.variant !== 'split' || !(pg.images || []).length) return;
        const v = viewOf(pg.images[0]);
        const near = [pages[k - 1], pages[k + 1]].filter(Boolean).flatMap((q) => q.images || []).filter((ix) => ix !== pg.images[0]);
        if (v && near.some((ix) => sameView(v, viewOf(ix)))) { pg.variant = 'text'; delete pg.images; twins.push(k + 1); }
    });

    // صورة مستعارة من صور المشروع نفسه لصفحة بلا صورة. أولاً صورة لم تُعرض في أي صفحة، ثم صورة عُرضت مصغّرة وحدها (صورة
    // افتتاح النماذج)، ثم صورة عُرضت كبيرة في صفحة بعيدة (لا في الصفحتين قبلها ولا بعدها) فتُطبع تفصيلاً مقرّباً منها لا الصورة
    // نفسها مرة ثانية (detail). في الدرجتين الأوليين النوع الأنسب للصفحة أولاً (المزايا: الداخلية ثم الخارجية؛ النموذج بلا مخطط:
    // صورة الوحدة ثلاثية الأبعاد ثم الغرف)، ثم الأكبر بكسلاتٍ فلا تُكبَّر صورة صغيرة (والتفصيل المقرّب يبدأ بها)، ثم الأبعد. وصفحة «تواصل معنا» الأخيرة صورة الغلاف
    const LENDABLE = new Set(['interior', 'exterior', 'plan3d']);
    // الصور التي لم تُعرض من صفحات صارت صفحات ملائم (لا غلاف المطوّر ولا خاتمته التي صار مكانها غلاف ملائم الخلفي: صورها شعاره
    // وخلفياته وكتابته)، واللوحة بأجزائها
    const pool = new Map();
    for (const x of r.pages) {
        if (x.page === 1 || x.page === lastContact) continue;
        for (const im of x.images || []) {
            const i0 = at.get(x.page + ':' + im.n);
            const role = roleOf(x, im);
            if (i0 === undefined || !all[i0] || dropped.has(i0) || all[i0].kind === 'plan' || !LENDABLE.has(role)) continue;
            for (const i of partsOf.get(i0) || [i0]) if (!pool.has(i)) pool.set(i, { role, caption: im.caption });
        }
    }

    // فهرس البروشور وبطاقة المشروع: مكان صفحة «المحتويات» في بروشور المطوّر (لا يتكرر فهرسان)، أو مكان الصفحة التي أُخذت صورتها
    // للغلاف في أول البروشور (صفحة صورة بلا نص طويل). وحين يكون في أول البروشور الاثنان معاً وصفحة صورة الغلاف أسبق، فالفهرس مكان
    // فهرس المطوّر إن بقيت صورة لم تُعرض تأخذ صفحة صورة الغلاف (فلا تتكرر صورة الغلاف)، وإلا مكان صفحة صورة الغلاف كما كان وتبقى
    // قائمة المطوّر صفحةً بكلامها. وحينها تحمل هي أرقام المشروع لا صفحة «عن المشروع»
    const coverImage = coverFrom !== null ? factIndex.get(coverFrom) : pages[0] && pages[0].images ? pages[0].images[0] : null;
    const tocPage = pages.findIndex((pg, k) => k > 0 && k <= 5 && pg.text && TOC.test(pg.text.title || '') && !pg.text.body);
    const coverPage = pages.findIndex((pg, k) => k > 0 && k <= 5 && pg.kind === 'photo' && pg.images[0] === coverImage && !(pg.text && pg.text.body));
    const shownNow = new Set(pages.flatMap((pg) => pg.images || []));
    const spare = [...pool.keys()].some((i) => !(factIndex.has(i) && shownNow.has(factIndex.get(i))));
    const contentsAt = tocPage > 0 && (coverPage < 0 || tocPage < coverPage || spare) ? tocPage : coverPage > 0 ? coverPage : -1;
    if (contentsAt > 0) {
        pages[contentsAt] = { kind: 'statement', variant: 'contents', text: pages[contentsAt].text || null };
        for (const pg of pages) if (pg.kind === 'about') pg.stats = false;
        // قائمة فهرس المطوّر لا تُطبع، فلا تدخل ملاحظات الإملاء بين الصفحات
        if (contentsAt === tocPage) { const k = texts.findIndex((x) => x.page === contentsAt + 1); if (k >= 0) texts.splice(k, 1); }
    }

    const usedOn = new Map();
    pages.forEach((pg, k) => (pg.images || []).forEach((ix) => usedOn.set(ix, [...(usedOn.get(ix) || []), k])));
    const thumb = (j) => pages[j].kind === 'statement' && pages[j].variant === 'chapter';
    const borrow = (k, kinds, late, fresh) => {
        const list = [];
        for (const [i, info] of pool) {
            if (!kinds.includes(info.role)) continue;
            const ix = factIndex.has(i) ? factIndex.get(i) : null;
            if (ix !== null && ix === coverImage) continue;
            const on = ix !== null ? usedOn.get(ix) || [] : [];
            if (on.some((j) => Math.abs(j - k) <= 2)) continue;
            const tier = !on.length ? 0 : on.every(thumb) ? 1 : 2;
            if (fresh && tier) continue;
            // جزء من لوحة المطوّر مؤطر أصلاً: لا تفصيل مقرّب منه
            if (tier === 2 && all[i].parent !== undefined) continue;
            list.push({ i, info, on, tier, px: (Number(all[i].w) || 0) * (Number(all[i].h) || 0), far: on.length ? Math.min(...on.map((j) => Math.abs(j - k))) : 0 });
        }
        list.sort((a, b) => a.tier - b.tier || (a.tier < 2 ? kinds.indexOf(a.info.role) - kinds.indexOf(b.info.role) : 0) || b.px - a.px || b.far - a.far || (late ? b.i - a.i : a.i - b.i));
        if (!list.length) return null;
        const c = list[0];
        const ix = use(c.i, c.info.role, c.info.caption);
        usedOn.set(ix, [...c.on, k]);
        return { ix, detail: c.tier === 2, from: c.tier === 2 ? Math.min(...c.on.filter((j) => !thumb(j))) + 1 : null };
    };
    const lent = [], details = [], swapped = [];
    pages.forEach((pg, k) => {
        // صفحة صور فقدت صورها: صورة لم تُعرض بعد، وإلا تبقى فاصلاً
        if (pg.kind === 'statement' && pg.empty) {
            const lend = borrow(k, ['interior', 'exterior', 'plan3d'], false, true);
            if (lend) { pages[k] = { kind: 'photo', variant: 'full', images: [lend.ix], lent: true }; lent.push(k + 1); }
            return;
        }
        // صورة الغلاف مطبوعة مرة ثانية صفحةً كاملة بعد الفهرس: صورة أخرى لم تُعرض مكانها إن وُجدت
        if (pg.kind === 'photo' && k !== contentsAt && coverImage !== null && coverImage !== undefined && pg.images[0] === coverImage) {
            const lend = borrow(k, ['exterior', 'interior', 'plan3d'], false, true);
            if (lend) { pg.images = [lend.ix]; swapped.push(k + 1); }
            return;
        }
        const lend = pg.kind === 'features' && pg.variant === 'list' ? borrow(k, ['interior', 'exterior'], false)
            : pg.kind === 'model' && pg.variant === 'facts' ? borrow(k, ['plan3d', 'interior', 'exterior'], true) : null;
        if (lend) {
            if (pg.kind === 'features') pg.variant = 'photo';
            pg.images = [lend.ix];
            pg.lent = true;
            if (lend.detail) { pg.detail = true; details.push('صفحة ' + (k + 1) + ' تفصيل مقرّب من صورة صفحة ' + lend.from); }
            lent.push(k + 1);
        } else if (pg.kind === 'statement' && pg.variant === 'say' && pg.text && pg.text.title && pages[k + 1] && pages[k + 1].kind === 'back'
            && coverImage !== null && coverImage !== undefined && !(pg.images || []).length && k > 3) {
            pg.images = [coverImage];
        }
        // نموذج بلا مخطط ولا صورة: قياساته ومكوّناته في الحقل المقابل بدل حقل فارغ
        if (pg.kind === 'model' && pg.variant === 'facts' && !(pg.images || []).length) pg.variant = 'wide';
    });
    for (const pg of pages) if (pg.kind === 'statement' && pg.empty) delete pg.empty;

    // صفحات الصور المتتالية لا تتكرر بتكوين واحد: الطولية بنسبتها وارتفاع الصفحة يتبادل جانباها، والعريضة كاملةً إن حملت بكسلاتها
    // عرض الصفحة (1580 بكسلاً: 135 نقطة في البوصة على 297 مم) وإلا لوحةً بهوامش؛ واللقطة الضعيفة (حوافها قليلة) بين ثلاث فأكثر
    // متتالية لوحةٌ صغيرة، فلا تأخذ جدارٌ فارغ معاملة البطل
    let side = 0;
    pages.forEach((pg, k) => {
        if (pg.kind !== 'photo') return;
        const it = images[pg.images[0]];
        // رسمٌ لا صورة: لوحة بنسبته كاملاً لا يُقصّ
        if (it.kind === 'plan') { pg.variant = 'plate'; pg.side = side++ % 2 ? 'right' : 'left'; return; }
        let a = k, b = k;
        while (a > 0 && pages[a - 1].kind === 'photo') a--;
        while (b + 1 < pages.length && pages[b + 1].kind === 'photo') b++;
        const run = b - a + 1;
        const weak = run >= 3 && typeof it.detail === 'number' && it.detail < 0.02;
        const prev = k > a ? pages[k - 1] : null;
        // لقطة تعيد منظر صورة قبلها في السلسلة نفسها (الحمّام نفسه مرتين، أو غرفتان متطابقتان) لوحةٌ صغيرة، ما لم تكن التي قبلها لوحة
        const again = pages.slice(a, k).some((q) => sameView(viewOf(pg.images[0]), viewOf(q.images[0])));
        if (weak || (again && !(prev && prev.variant === 'plate'))) pg.variant = 'plate';
        else if (it.tall) pg.variant = 'tall';
        else pg.variant = it.w && it.w < 1580 ? 'plate' : prev && prev.variant === 'full' && !(images[prev.images[0]] || {}).tall ? 'plate' : 'full';
        if (pg.variant !== 'full') pg.side = side++ % 2 ? 'right' : 'left';
    });

    if (moved) notes.push('رُتّبت النماذج المتاحة قبل المباعة في كل مجموعة، فتغيّرت صفحاتها عن بروشور المطوّر.');
    if (lent.length) notes.push('صفحة ' + lent.join('، ') + ': بلا صورة في بروشور المطوّر، فوُضعت فيها صورة من صور المشروع نفسه'
        + (details.length ? ' (' + details.join('، ') + '، إذ لا صورة أخرى لم تُعرض)' : '') + '.');
    if (twins.length) notes.push('صفحة ' + twins.join('، ') + ': صورتها المنظر نفسه في الصفحة المجاورة، فطُبع كلامها وحده.');
    if (swapped.length) notes.push('صفحة ' + swapped.join('، ') + ': صورتها صارت الغلاف، فوُضعت مكانها صورة أخرى من صور المشروع لم تُعرض.');
    notes.push(...spellingNotes(texts, places));
    if (better.size) {
        const printed = [...better].filter((i) => factIndex.has(i)).length;
        if (printed) notes.push('حُسّنت ' + photosWord(printed) + ' من صور البروشور بنموذج صور واجتازت فحص الأمانة، فطُبعت مكان أصلها — قارنها بالأصل قبل المشاركة.');
    }
    for (const n of Array.isArray(r.enhance_notes) ? r.enhance_notes : []) if (str(n, 300)) notes.push(str(n, 300));
    const droppedCount = [...dropped].filter((i) => i !== undefined).length;
    if (droppedCount) notes.push('تُركت ' + droppedCount + ' صورة لأنها شعار المطوّر أو خلفية أو طبقة لونية أو صورة جاهزة لا تخص المشروع.');
    if (partsOf.size) notes.push('في ' + partsOf.size + ' من صور المطوّر أكثر من صورة في ملف واحد، فطُبعت كل صورة وحدها بلا إطارها.');
    const missing = Array.isArray(r.missing) ? r.missing : [];
    if (missing.length) notes.push('لم يقرأ المساعد الصفحات ' + missing.join('، ') + '، فصُمّمت من صورها وحدها.');
    for (const c of Array.isArray(r.conflicts) ? r.conflicts : []) {
        const where = Array.isArray(c.pages) && c.pages.length ? ' (صفحة ' + c.pages.join('، ') + ')' : '';
        notes.push('تناقض في البروشور' + where + ': ' + (c.note || (c.values || []).join(' / ')));
    }
    if (r.dropped) notes.push(r.dropped + ' قيمة خارج المعقول أو بلا صفحة واضحة فلم تُكتب.');

    // المطوّر بالعربية إن طبعه المطوّر بها في صفحة («Alramz» ← «الرمز»)
    const latinDev = str(p.developer, 80);
    const arDev = arabicName(latinDev, texts);
    if (arDev) notes.push('اسم المطوّر «' + latinDev + '» طُبع بالعربية «' + arDev + '» كما في صفحات بروشوره.');
    // عدد الوحدات ومدى المساحات من نص «عن المشروع» الذي يذكر المشروع باسمه
    let counts = { units: null, areas: null };
    for (const x of r.pages) {
        if (x.role !== 'about' || !x.body || !(projectName && bare(x.body).includes(bare(projectName)))) continue;
        const c = projectCounts(str(x.body, 600));
        counts = { units: counts.units || c.units, areas: counts.areas || c.areas };
    }

    // لون البروشور: لون هوية المطوّر المسطّح في صفحاته إن تكرر، وإلا عائلة صوره: صورة الغلاف أثقلها، ثم الواجهات وخلفيات المطوّر
    // صفحةً صفحة، وصورة الغلاف صوتاً ونصفاً فوق صفحاتها، والداخلية عُشر صوت (جدران بيج لا هوية)، ولا تصوّت الطبقات اللونية ولا المخططات
    const brand = brandColour(media && media.fills);
    const heroAt = pages[0] && pages[0].images ? pages[0].images[0] : null;
    const heroUrl = heroAt !== null && images[heroAt] ? images[heroAt].url : null;
    const votes = all.map((m, i) => {
        if (!m || m.parent !== undefined || typeof m.deep !== 'string') return null;
        let weight = 0;
        for (const o of m.on || []) {
            const x = read.get(o.page);
            const im = x && (x.images || []).find((q) => q.n === o.n);
            const role = x && im ? roleOf(x, im) : 'exterior';
            weight += ['interior', 'lifestyle', 'people'].includes(role) ? 0.1 : 1;
        }
        if (m.url === heroUrl) weight += 1.5;
        return { deep: m.deep, kind: m.kind, weight };
    });
    const heroDeep = heroUrl ? (all.find((m) => m && m.url === heroUrl) || {}).deep : null;
    const family = brochureTone(votes, heroDeep);
    if (brand) notes.push('ألوان البروشور من لون هوية المطوّر في صفحاته ' + brand.pages.join('، ') + ' (' + brand.hex + ').');
    else if (family) notes.push('ألوان البروشور من صور المشروع (عائلة ' + ({ navy: 'الكحلي', forest: 'الأخضر', teal: 'الأزرق المخضر', bronze: 'البرونزي', plum: 'البنفسجي' }[family] || family) + ').');

    const project = {
        id: meta.id ?? null,
        name: str(p.name, 80), city: str(p.city, 40), district: str(p.district, 60), availability: 'available',
        images,
        details: { developer: arDev || latinDev, name_en: str(p.name_latin, 60), tagline: str(p.tagline, 120), license: str(p.license, 120), models,
            units_count: counts.units, area_range: counts.areas,
            palette: family, colours: brand ? { deep: brand.deep, pale: brand.pale } : null }
    };
    return { project, spec: { version: 3, pages }, notes };
}
