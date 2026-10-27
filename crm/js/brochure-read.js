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

import { brochureTone } from './brochure-media.js';
import { groupOf } from './brochure-plan.js';

const PHOTO_ROLES = new Set(['exterior', 'interior', 'aerial', 'map', 'plan3d']);
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
export function tidy(value) {
    if (typeof value !== 'string') return value;
    return areaUnit(value)
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

// أول مساحة في نص مطبوع داخل المخطط: «مساحتها 168م²»، «168 م2»، «مساحة: ١٠٧»
export function areaIn(label) {
    const t = String(label ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    // «م» وحدها وحدةٌ ما لم تتبعها حروف («97 م» نعم، «97 مجلس» لا). \b لا يعرف الحروف العربية فلا يصلح هنا
    const m = /(\d{2,4}(?:\.\d+)?)\s*(?:م²|م2|م(?![ء-ي])|m²|m2|sqm)/i.exec(t) || /مساح(?:ت\S*|ة)\s*:?\s*(\d{2,4}(?:\.\d+)?)/.exec(t);
    return m ? Number(m[1]) : null;
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

// result: القراءة (الإصدار 2)؛ media: { pages, read, images: [{ url, page, w, h, kind, tone, tall, on: [{ page, n }] }] }؛
// meta: { id, variation, mediaPrefix }. ← { project, spec: { version, pages }, notes } أو null لقراءة من إصدار آخر.
// media.json في المخزن العام الذي يرفع إليه الميداني أيضاً: لا تُقبل إلا صور مخزن هذا البروشور (mediaPrefix)، والصفحات بحد الطلب
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
    const all = (media && Array.isArray(media.images) ? media.images : []).map((m, i) => {
        if (!(m && ours(m.url))) return null;
        const e = Object.prototype.hasOwnProperty.call(enhanced, String(i)) ? enhanced[String(i)] : null;
        if (m.kind === 'plan' || !ours(e) || e === m.url) return m;
        better.add(i);
        return { ...m, url: e, original: m.url };
    });
    const notes = [];
    const variation = meta.variation || 0;
    const projectName = str(p.name, 80);

    // صورة الصفحة برقم مصغّرتها ← فهرسها في media
    const at = new Map();
    all.forEach((m, i) => (m && Array.isArray(m.on) ? m.on : []).forEach((o) => at.set(o.page + ':' + o.n, i)));
    const read = new Map(r.pages.map((x) => [x.page, x]));
    const count = Math.min(MAX_PAGES, Math.max(Number(media && media.read) || 0, ...r.pages.map((x) => x.page), ...(Array.isArray(r.missing) ? r.missing : []), 1));

    // صور البروشور التي تُطبع: فهرس media ← فهرس في project.images
    const images = [];
    const factIndex = new Map();
    const use = (i, kind, caption) => {
        if (!factIndex.has(i)) {
            factIndex.set(i, images.length);
            const m = all[i];
            images.push({ url: m.url, kind: kind === 'plan3d' ? 'plan3d' : kind, caption: spaced(caption, 60), tall: m.tall === true,
                wide: Number(m.w) > 0 && Number(m.h) > 0 && m.w / m.h >= 1.9, deep: typeof m.deep === 'string' ? m.deep : null,
                w: Number(m.w) > 0 ? Number(m.w) : null, h: Number(m.h) > 0 ? Number(m.h) : null, quiet: m.quiet === 'left' || m.quiet === 'right' ? m.quiet : null });
        }
        return factIndex.get(i);
    };
    // الصور المعروضة في كل صفحة (فهارس media): صفحة نصّها هو المهم لا تكرر صورة الصفحة التي قبلها (الغلاف يستعير صورة
    // «عن المشروع» حين لا صورة في غلاف المطوّر، فتصير صفحة «عن المشروع» بعده صفحة كلام لا الصورة نفسها مرة ثانية)
    const shown = new Map();
    // الصور التي قال المساعد في أي صفحة إنها شعار أو خلفية أو صورة جاهزة: تُترك، وتُعدّ مرة واحدة
    const dropped = new Set();
    for (const x of r.pages) for (const im of x.images || []) if (DROPPED_ROLES.has(im.role) && at.has(x.page + ':' + im.n)) dropped.add(at.get(x.page + ':' + im.n));
    // صور الصفحة بأدوارها: من المساعد، وإلا من تقدير الاستخراج (مخطط أو صورة) لصفحة لم تُقرأ
    const picsOf = (n, page) => {
        if (page) {
            return page.images.map((im) => ({ i: at.get(n + ':' + im.n), role: im.role, caption: im.caption }))
                .filter((x) => x.i !== undefined && all[x.i] && !DROPPED_ROLES.has(x.role));
        }
        return all.map((m, i) => ({ m, i })).filter(({ m, i }) => m && !dropped.has(i) && (m.on || []).some((o) => o.page === n))
            .map(({ m, i }) => ({ i, role: m.kind === 'plan' ? 'plan' : 'exterior', caption: null }));
    };

    const models = [];
    const pages = [];
    let statsShown = false;
    // الغلاف الخلفي (تواصل ملائم) مكان صفحة المطوّر الختامية (غلافه الخلفي أو تواصل أو غيرها في آخر البروشور)، وإلا مكان آخر
    // صفحة تواصل، وإلا آخر صفحة ما لم تكن نموذجاً: العدد نفسه وخاتمة ملائم في آخره
    const contactPages = r.pages.filter((x) => x.role === 'contact').map((x) => x.page);
    const final = read.get(count);
    const lastContact = count < 2 ? null
        : !final || ['cover', 'contact', 'other'].includes(final.role) ? count
        : contactPages.length ? Math.max(...contactPages)
        : final.role !== 'model' ? count : null;
    // صورة الغلاف حين لا صورة في غلاف المطوّر: الواجهة التي أفرد لها المطوّر صفحة وحدها (صفحة صور فيها صورة خارجية واحدة،
    // الأعرض أولاً)، وإلا أول صورة خارجية في البروشور
    const heroExterior = () => {
        const solo = [];
        let firstSeen = null;
        for (const x of r.pages) {
            const ext = (x.images || []).map((im) => at.get(x.page + ':' + im.n)).filter((i, k) => i !== undefined && all[i] && x.images[k].role === 'exterior' && !dropped.has(i));
            if (firstSeen === null && ext.length) firstSeen = ext[0];
            const photos = (x.images || []).filter((im) => PHOTO_ROLES.has(im.role) && im.role !== 'map');
            if (x.page > 1 && x.role === 'photos' && ext.length === 1 && photos.length === 1) solo.push(ext[0]);
        }
        const ratio = (i) => (Number(all[i].w) > 0 && Number(all[i].h) > 0 ? all[i].w / all[i].h : 1);
        solo.sort((a, b) => ratio(b) - ratio(a));
        return solo.length ? solo[0] : firstSeen;
    };
    let coverFrom = null;
    // النص المطبوع لكل صفحة ومعالم صفحات الموقع، لملاحظات الإملاء بين الصفحات
    const texts = [], places = [];

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
        const figures = figuresOf(page);
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
            pages.push(hero !== null ? { kind: 'cover', variant: order[variation % 2], images: [hero] } : { kind: 'cover', variant: 'type' });
            continue;
        }
        if (n === lastContact) {
            pages.push({ kind: 'back', variant: 'brand' });
            continue;
        }
        const m = page && page.model ? page.model : {};
        const modelish = Boolean(m.name || m.area || m.price || m.rooms || (m.parts || []).length);
        const planPage = !photos.length && plans.length > 0 && (role === 'photos' || role === 'other');
        if ((role === 'model' && (modelish || plans.length)) || planPage) {
            let plan = plans[0] ? all[plans[0].i] : null;
            const printed = areaIn(m.plan_label);
            if (plan && printed && m.area && Math.abs(printed - m.area) > 1) {
                notes.push('صفحة ' + n + ': مخطط ' + (m.name || 'النموذج') + ' مكتوب عليه ' + printed + 'م² والنموذج ' + m.area + 'م² — لم يُعرض المخطط، وتُعرض الأرقام وحدها.');
                plan = null;
            }
            models.push({
                name: spaced(m.name, 40, true), type: str(m.type, 30), orientation: str(m.orientation, 40),
                rooms: m.rooms ?? null, bathrooms: m.bathrooms ?? null, area: m.area ?? null, price: m.price ?? null,
                status: m.sold ? 'sold' : 'available', parts: (Array.isArray(m.parts) ? m.parts : []).map((x) => spaced(x, 80)).filter(Boolean),
                plan: plan ? plan.url : null, plan_tone: plan && plan.tone === 'light' ? 'light' : 'dark',
                plan_ratio: plan && Number(plan.w) > 0 && Number(plan.h) > 0 ? plan.w / plan.h : null,
                plan_crop: plan && plan.crop && typeof plan.crop === 'object' ? { unit: plan.crop.unit || null, key: plan.crop.key || null } : null
            });
            pages.push({ kind: 'model', variant: plan ? 'plan' : 'facts', model: models.length - 1, text });
            continue;
        }
        if (role === 'location') {
            const where = pics.find((x) => x.role === 'map') || pics.find((x) => x.role === 'aerial');
            // أول صفحة موقع صورتها جوّية عريضة: صفحة كاملة بلا هوامش، والكلام على كتلة من الورق في زاويتها
            const wide = where && where.role !== 'map' && Number(all[where.i].w) / Number(all[where.i].h) >= 1.5;
            const hero = wide && !pages.some((x) => x.kind === 'location');
            pages.push(where ? { kind: 'location', variant: hero ? 'hero' : 'map', images: [photo(where)], text } : { kind: 'location', variant: 'text', text });
            continue;
        }
        // مزايا كلها أعداد: أرقام الصفحة البارزة («10 سنوات» أبواب WPC)، أو قائمة يبدأ كل سطر فيها بعدد («25 سنة الأفياش
        // والقواطع»): صفحة أرقام كبيرة بلا صورة
        const counted = (list, of) => list.length >= 2 && list.length <= 6 && list.every((x) => NUMERIC.test(of(x)));
        if (role === 'amenities' && text && (counted(text.figures, (f) => f.value) || (!text.figures.length && counted(text.bullets, (x) => x)))) {
            pages.push({ kind: 'features', variant: 'numbers', text });
            continue;
        }
        if (role === 'amenities' && text && text.bullets.length) {
            pages.push(fresh.length ? { kind: 'features', variant: 'photo', images: [photo(fresh[0])], text } : { kind: 'features', variant: 'list', text });
            continue;
        }
        if (role === 'about' || role === 'contact' || (role === 'amenities' && hasText) || (!photos.length && hasText)) {
            // أول صفحة «عن المشروع» تحمل أرقامه؛ وصفحة نص قصير بلا صورة (عنوان وسطر أو سطران) صفحة فاصلة بنصها، لا صفحة شبه فارغة
            // صفحة لها أرقامها البارزة (سجل المطوّر) تطبعها هي لا أرقام المشروع
            const stats = role === 'about' && !statsShown && !text.figures.length;
            const short = !fresh.length && !stats && text.title && !text.bullets.length && !text.figures.length && (!text.body || text.body.length <= 220);
            if (short) {
                pages.push({ kind: 'statement', variant: 'say', text });
                continue;
            }
            if (stats) statsShown = true;
            pages.push(fresh.length ? { kind: 'about', variant: 'split', images: [photo(fresh[0])], text, stats } : { kind: 'about', variant: 'text', text, stats });
            continue;
        }
        // صور: ثلاث فأكثر لوحات (الداخلية أولاً)، واثنتان متجاورتان، وواحدة كاملة؛ وصفحة بلا صورة ولا نص فاصلٌ باسم المشروع
        const order = photos.filter((x) => x.role === 'interior').concat(photos.filter((x) => x.role !== 'interior'));
        if (order.length >= 3) pages.push({ kind: 'trio', variant: 'panels', images: order.slice(0, 3).map(photo), text });
        else if (order.length === 2) pages.push({ kind: 'pair', variant: 'offset', images: order.map(photo), text });
        else if (order.length === 1) pages.push({ kind: 'photo', variant: 'full', images: [photo(order[0])], text });
        else pages.push({ kind: 'statement', variant: 'say' });
    }

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
        if (pages[k + 1].kind !== 'model' || !(pg.kind === 'photo' || (pg.kind === 'statement' && pg.variant === 'say'))) continue;
        if (pg.text && (pg.text.body || pg.text.bullets.length)) continue;
        let end = k + 1;
        while (end + 1 < pages.length && pages[end + 1].kind === 'model') end++;
        pages[k] = { kind: 'statement', variant: 'chapter', images: pg.images || [], text: pg.text || null, models: [pages[k + 1].model, pages[end].model] };
    }

    // الصفحة التي أُخذت صورتها للغلاف في أول البروشور (صفحة صورة بلا نص طويل): فهرس البروشور وبطاقة المشروع مكانها، وصفحة
    // «المحتويات» في بروشور المطوّر كذلك. وحينها تحمل هي أرقام المشروع لا صفحة «عن المشروع»
    const coverImage = coverFrom !== null ? factIndex.get(coverFrom) : pages[0] && pages[0].images ? pages[0].images[0] : null;
    const contentsAt = pages.findIndex((pg, k) => k > 0 && k <= 5 && ((pg.kind === 'photo' && pg.images[0] === coverImage && !(pg.text && pg.text.body))
        || (pg.text && /^(المحتويات|المحتوى|الفهرس)$/.test(pg.text.title || '') && !pg.text.body)));
    if (contentsAt > 0) {
        pages[contentsAt] = { kind: 'statement', variant: 'contents', text: pages[contentsAt].text || null };
        for (const pg of pages) if (pg.kind === 'about') pg.stats = false;
    }

    // صورة مستعارة من صور المشروع نفسه لصفحة بلا صورة. أولاً صورة لم تُعرض في أي صفحة، ثم صورة عُرضت مصغّرة وحدها (صورة
    // افتتاح النماذج)، ثم صورة عُرضت كبيرة في صفحة بعيدة (لا في الصفحتين قبلها ولا بعدها) فتُطبع تفصيلاً مقرّباً منها لا الصورة
    // نفسها مرة ثانية (detail). في الدرجتين الأوليين النوع الأنسب للصفحة أولاً (المزايا: الداخلية ثم الخارجية؛ النموذج بلا مخطط:
    // صورة الوحدة ثلاثية الأبعاد ثم الغرف)، ثم الأكبر بكسلاتٍ فلا تُكبَّر صورة صغيرة (والتفصيل المقرّب يبدأ بها)، ثم الأبعد. وصفحة «تواصل معنا» الأخيرة صورة الغلاف
    const LENDABLE = new Set(['interior', 'exterior', 'plan3d']);
    // الصور التي لم تُعرض من صفحات صارت صفحات ملائم (لا غلاف المطوّر ولا خاتمته التي صار مكانها غلاف ملائم الخلفي: صورها شعاره
    // وخلفياته وكتابته)
    const pool = new Map();
    for (const x of r.pages) {
        if (x.page === 1 || x.page === lastContact) continue;
        for (const im of x.images || []) {
            const i = at.get(x.page + ':' + im.n);
            if (i === undefined || !all[i] || dropped.has(i) || all[i].kind === 'plan' || !LENDABLE.has(im.role) || pool.has(i)) continue;
            pool.set(i, { role: im.role, caption: im.caption });
        }
    }
    const usedOn = new Map();
    pages.forEach((pg, k) => (pg.images || []).forEach((ix) => usedOn.set(ix, [...(usedOn.get(ix) || []), k])));
    const thumb = (j) => pages[j].kind === 'statement' && pages[j].variant === 'chapter';
    const borrow = (k, kinds, late) => {
        const list = [];
        for (const [i, info] of pool) {
            if (!kinds.includes(info.role)) continue;
            const ix = factIndex.has(i) ? factIndex.get(i) : null;
            if (ix !== null && ix === coverImage) continue;
            const on = ix !== null ? usedOn.get(ix) || [] : [];
            if (on.some((j) => Math.abs(j - k) <= 2)) continue;
            const tier = !on.length ? 0 : on.every(thumb) ? 1 : 2;
            list.push({ i, info, on, tier, px: (Number(all[i].w) || 0) * (Number(all[i].h) || 0), far: on.length ? Math.min(...on.map((j) => Math.abs(j - k))) : 0 });
        }
        list.sort((a, b) => a.tier - b.tier || (a.tier < 2 ? kinds.indexOf(a.info.role) - kinds.indexOf(b.info.role) : 0) || b.px - a.px || b.far - a.far || (late ? b.i - a.i : a.i - b.i));
        if (!list.length) return null;
        const c = list[0];
        const ix = use(c.i, c.info.role, c.info.caption);
        usedOn.set(ix, [...c.on, k]);
        return { ix, detail: c.tier === 2, from: c.tier === 2 ? Math.min(...c.on.filter((j) => !thumb(j))) + 1 : null };
    };
    const lent = [], details = [];
    pages.forEach((pg, k) => {
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
    });

    if (moved) notes.push('رُتّبت النماذج المتاحة قبل المباعة في كل مجموعة، فتغيّرت صفحاتها عن بروشور المطوّر.');
    if (lent.length) notes.push('صفحة ' + lent.join('، ') + ': بلا صورة في بروشور المطوّر، فوُضعت فيها صورة من صور المشروع نفسه'
        + (details.length ? ' (' + details.join('، ') + '، إذ لا صورة أخرى لم تُعرض)' : '') + '.');
    notes.push(...spellingNotes(texts, places));
    if (better.size) {
        const printed = [...better].filter((i) => factIndex.has(i)).length;
        if (printed) notes.push('حُسّنت ' + photosWord(printed) + ' من صور البروشور بنموذج صور واجتازت فحص الأمانة، فطُبعت مكان أصلها — قارنها بالأصل قبل المشاركة.');
    }
    for (const n of Array.isArray(r.enhance_notes) ? r.enhance_notes : []) if (str(n, 300)) notes.push(str(n, 300));
    if (dropped.size) notes.push('تُركت ' + dropped.size + ' صورة لأنها شعار المطوّر أو خلفية أو صورة جاهزة لا تخص المشروع.');
    const missing = Array.isArray(r.missing) ? r.missing : [];
    if (missing.length) notes.push('لم يقرأ المساعد الصفحات ' + missing.join('، ') + '، فصُمّمت من صورها وحدها.');
    for (const c of Array.isArray(r.conflicts) ? r.conflicts : []) {
        const where = Array.isArray(c.pages) && c.pages.length ? ' (صفحة ' + c.pages.join('، ') + ')' : '';
        notes.push('تناقض في البروشور' + where + ': ' + (c.note || (c.values || []).join(' / ')));
    }
    if (r.dropped) notes.push(r.dropped + ' قيمة خارج المعقول أو بلا صفحة واضحة فلم تُكتب.');

    const project = {
        id: meta.id ?? null,
        name: str(p.name, 80), city: str(p.city, 40), district: str(p.district, 60), availability: 'available',
        images,
        // عائلة لون البروشور: تصوّت كل صورة فيه (والخلفيات التي يلبسها بروشور المطوّر) بعدد صفحاتها
        details: { developer: str(p.developer, 80), name_en: str(p.name_latin, 60), tagline: str(p.tagline, 120), license: str(p.license, 120), models,
            palette: brochureTone(all) }
    };
    return { project, spec: { version: 3, pages }, notes };
}
