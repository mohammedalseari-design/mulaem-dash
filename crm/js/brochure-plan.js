// استوديو البروشورات: الحقائق التي يجوز طبعها، والتحقق من مخطط الصفحات قبل الرسم — بلا DOM وبلا شبكة، فيُختبر وحده.
//
// المستوى المطلوب من بروشورات المطورين التي أرسلها المالك (2026-10-25): الصورة بطل الصفحة والنص صغير وهادئ، وصفحة لكل نموذج
// فيها مخططه رسماً فنياً وسعره أكبر رقم فيها ومكوّناته. التصميم «مونوغراف» كتب العمارة (brochure.css): شبكة ظاهرة، وعناوين
// وأرقام كبيرة، وفصول بأرقامها وفهرس، وكتل ورق ورمل ولون المشروع. لا بطاقات ولا تدرّجات ولا زخرفة.
// المخطط بيانات لا رسم: brochure-read.js يبنيه صفحةً لكل صفحة من بروشور المطوّر، وbrochure.js يرسمه صفحات 16:9.
// والمخطط لا يحمل أرقاماً، بل فهارس صور ونماذج ونصوص الصفحة كما قرأها المساعد، فلا يكتب نموذجٌ سعراً من عنده.
// لا قيمة في البروشور ليست في البيانات: الناقص يغيب مع سطره ولا يُخمَّن.

export const PAGE_KINDS = {
    cover: ['side', 'low', 'type'],
    about: ['split', 'text'],
    // full: صورة عريضة بعرض الصفحة؛ tall: صورة طولية بنسبتها وارتفاع الصفحة كله بجانب حقل ورق (يتبادل الجانبان)؛ plate: لوحة
    // بهوامش بحد بكسلاتها (صورة صغيرة أو لقطة ضعيفة بين لقطات متتالية)
    photo: ['full', 'tall', 'plate'],
    trio: ['panels'],
    pair: ['offset'],
    // hero: صورة جوّية عريضة تملأ الصفحة كلها، والكلام على كتلة ورق في زاويتها (افتتاح فصل الموقع)
    location: ['map', 'text', 'hero'],
    // wide: نموذج بلا مخطط ولا صورة: الاسم والسعر يميناً والقياسات والمكوّنات في الحقل المقابل، فلا يبقى نصف الصفحة فارغاً
    model: ['plan', 'facts', 'wide'],
    // numbers: مزايا كل سطر فيها مدة أو عدد (الضمانات) أرقاماً كبيرة؛ mixed: قائمة مزايا ومعها أرقام الصفحة البارزة في الحقل المقابل
    features: ['list', 'photo', 'numbers', 'mixed'],
    back: ['brand'],
    // صفحة فاصلة: جملة كبيرة، من نص الصفحة القصير أو من شعار المشروع لصفحة لا صورة فيها ولا نص، فيبقى العدد؛
    // وchapter: افتتاح سلسلة نماذج (models: [أول نموذج، آخر نموذج]) بفهرسها؛ وcontents: فهرس البروشور وبطاقة المشروع في صفحة
    // صورتها صارت الغلاف (أو صفحة «المحتويات» في بروشور المطوّر)
    statement: ['say', 'chapter', 'contents']
};

// ألوان البروشور من لون مشروعه: لون هوية المطوّر المسطّح في صفحاته إن تكرر (brandColour في brochure-media.js)، وإلا عائلة لون
// صوره (brochureTone): deep للصفحات والكتل الداكنة (ثلاث صفحات على الأكثر) وللغلاف الخلفي، وpale لكتل فصل النماذج الثاني.
// المالك (2026-10-25): «مو لازم أزرق غامق… لا تكون مقيد بألوان ملائم». هوية ملائم في شعارها وسطرها على الغلاف الخلفي بلون
// المشروع؛ وبلا لون ولا عائلة يبقى كحلي ملائم. العائلات مختارة هنا سلفاً
export const PALETTES = {
    navy: { deep: '#14213A', pale: '#E3E6EA' },
    forest: { deep: '#1E3A2F', pale: '#E2E7DD' },
    teal: { deep: '#173B40', pale: '#DFE8E6' },
    bronze: { deep: '#3A2A1E', pale: '#ECE2D3' },
    plum: { deep: '#2E2436', pale: '#E8E2E8' }
};

// اسم الفصل لمجموعة نماذج ثانية فأكثر («ملحق» ← «الملاحق»)؛ ما ليس هنا يبقى في فصل «النماذج»
const PLURAL = { 'شقة': 'الشقق', 'ملحق': 'الملاحق', 'فيلا': 'الفلل', 'فيلة': 'الفلل', 'فلة': 'الفلل', 'دور': 'الأدوار', 'روف': 'الروف',
    'تاون هاوس': 'التاون هاوس', 'بنتهاوس': 'البنتهاوس', 'دوبلكس': 'الدوبلكس', 'استوديو': 'الاستوديوهات', 'محل': 'المحلات', 'مكتب': 'المكاتب' };

// عدد ووحدته وما بعدهما: «10 سنوات» ← { n: «10»، unit: «سنوات» }، «+300,000m» ← { n: «+300,000»، unit: «m» }، «1 سنة مجانًا»
// ← { n: «1»، unit: «سنة مجانًا» }؛ وقيمة لا تبدأ بعدد ← { n: null، unit: null، rest: القيمة }
export function splitFigure(value) {
    const t = String(value ?? '').trim();
    const m = /^([+\-−]?\s*[\d٠-٩][\d٠-٩.,٬]*\s*%?\+?)\s*(.*)$/.exec(t);
    if (!m) return { n: null, unit: null, rest: t || null };
    return { n: m[1].replace(/\s+/g, ''), unit: m[2].trim() || null, rest: null };
}
// مدة («سنوات»، «سنة مجانًا»، «أشهر»): صفحة أرقام كل وحداتها مدد هي صفحة الضمانات
export const DURATION = /^(سنوات|سنة|سنين|سنتين|سنتان|أعوام|عام|عامين|عامان|أشهر|شهور|شهر|أيام|يوم)(\s|$)/;

// سطر فيه مدة أو مقدار في أي موضع منه، كما طبعه المطوّر ← { n, unit, label, note } أو null. البند قبل العدد أو بعده، وما بعد
// المدة حين يسبقها البند شرطُها ويُطبع معها («الهيكل الإنشائي 25 سنة ولا يشمل ذلك الكوارث الطبيعية»، «السباكة سنتان التمديدات
// الداخلية»). والمدة بالكلمة عددُها: «سنة» واحدة و«سنتان/سنتين» اثنتان («سنتين ضمان للمصاعد» ← 2 سنتين)
const UNITS = 'سنوات|سنة|سنين|سنتين|سنتان|أعوام|عامين|عامان|عام|أشهر|شهور|شهر|أيام|يوم|ساعات|ساعة|دقائق|دقيقة|دقايق|%';
const WORD_COUNT = { 'سنة': '1', 'عام': '1', 'سنتان': '2', 'سنتين': '2', 'عامان': '2', 'عامين': '2' };
export function durationRow(line) {
    const t = String(line ?? '').replace(/[\u2066-\u2069]/g, '').trim();
    if (!t) return null;
    let n, unit, at, len;
    const m = new RegExp('(^|[^\\d٠-٩.,])(\\+?[\\d٠-٩]+(?:[.,][\\d٠-٩]+)?)\\s*(' + UNITS + ')(?=[\\s،,.:()]|$)').exec(t);
    if (m) {
        n = m[2]; unit = m[3]; at = m.index + m[1].length; len = m[0].length - m[1].length;
    } else {
        const w = /(^|\s)(سنتان|سنتين|عامان|عامين|سنة|عام)(?=[\s،,.:]|$)/.exec(t);
        if (!w) return null;
        n = WORD_COUNT[w[2]]; unit = w[2]; at = w.index + w[1].length; len = w[2].length;
    }
    const before = t.slice(0, at).replace(/[\s:–-]+$/, '').trim(), after = t.slice(at + len).replace(/^[\s:–-]+/, '').trim();
    return { n, unit, label: before || after || null, note: before && after ? after : null };
}

// صفوف الأرقام في صفحة المزايا كما طُبعت: من أسطرها إن كان في كل سطر مدة (والشرط معها)، وإلا من أرقامها البارزة؛ القيمة بلا عدد
// («سنتان») عددُها بالكلمة. ← [{ n, unit, label, note }]
export function numberRows(text) {
    const t = text || {};
    const bullets = Array.isArray(t.bullets) ? t.bullets.filter(Boolean) : [];
    const figs = Array.isArray(t.figures) ? t.figures.filter((f) => f && f.value) : [];
    const lines = bullets.map(durationRow);
    if (bullets.length && lines.every((r) => r && DURATION.test(r.unit)) && (bullets.length >= 2 || !figs.length)) return lines;
    return figs.map((f) => {
        const s = splitFigure(f.value);
        if (s.n) return { n: s.n, unit: s.unit, label: f.label || null, note: null };
        const r = durationRow(f.value);
        return r ? { n: r.n, unit: r.unit, label: f.label || r.label, note: null } : null;
    }).filter(Boolean);
}

// صفحة الضمانات: عنوانها ضمانات، أو صفحة أرقام كل وحداتها مدد
export function guaranteePage(page) {
    if (!page || page.kind !== 'features' || !page.text) return false;
    if (/ضمان/.test(page.text.title || '')) return true;
    if (page.variant !== 'numbers') return false;
    const rows = numberRows(page.text);
    return rows.length > 0 && rows.every((r) => r.n && r.unit && DURATION.test(r.unit));
}

// مجموعة النموذج: نوعه كما قُرئ، وإلا أول كلمة من اسمه بلا أرقام («شقة 8» ← شقة، «ملحق1» ← ملحق)
export function groupOf(m) {
    if (!m) return '';
    if (m.type) return m.type;
    return ((m.name || '').trim().split(/\s+/)[0] || '').replace(/[\d٠-٩]+/g, '');
}

// فصول البروشور من أدوار صفحاته: المشروع، الموقع، المميزات، الضمانات (صفحة أرقام كلها مدد)، النماذج (ومجموعة ثانية باسمها: الملاحق)، تواصل. الفهرس والصفحات
// قبله مقدمة بلا فصل، والغلافان بلا فصل. ← { of: [فهرس الفصل لكل صفحة أو -1], list: [{ name, page, n }] }
// page رقم أول صفحة في الفصل (من 1)، وn رقمه («01»). فصل يعود اسمه بعد غيره يبقى فصله الأول، فلا يتكرر في الفهرس
export function chaptersOf(spec, facts) {
    const pages = spec && Array.isArray(spec.pages) ? spec.pages : [];
    const models = facts && Array.isArray(facts.models) ? facts.models : [];
    const contents = pages.findIndex((p) => p && p.kind === 'statement' && p.variant === 'contents');
    // نموذج واحد (بأدواره) فصلُه بالمفرد
    const names = new Set(models.map((m) => m && m.name).filter(Boolean));
    const one = models.length > 0 && names.size <= 1 && (names.size === 1 || models.length === 1);
    let first = null;
    const nameOf = (p, i) => {
        if (!p || p.kind === 'cover' || p.kind === 'back' || (contents > 0 && i <= contents)) return null;
        if (p.kind === 'location') return 'الموقع';
        if (guaranteePage(p)) return 'الضمانات';
        if (p.kind === 'features') return 'المميزات';
        if (p.kind === 'statement' && p.variant === 'chapter') return one ? 'النموذج' : 'النماذج';
        if (p.kind === 'model') {
            if (one) return 'النموذج';
            const g = groupOf(models[p.model]);
            if (first === null) first = g;
            return g === first ? 'النماذج' : PLURAL[g] || 'النماذج';
        }
        if (p.kind === 'statement' && p.variant === 'say' && (p.call || (pages[i + 1] && pages[i + 1].kind === 'back'))) return 'تواصل';
        return 'المشروع';
    };
    const list = [], of = [];
    pages.forEach((p, i) => {
        const name = nameOf(p, i);
        if (name === null) return void of.push(-1);
        let at = list.findIndex((c) => c.name === name);
        if (at < 0) { at = list.length; list.push({ name, page: i + 1, n: String(list.length + 1).padStart(2, '0') }); }
        of.push(at);
    });
    return { of, list };
}

// أنواع الصور: من تصنيف البروشور المرفوع، أو photo لصورة لا يُعرف نوعها (صور المخزون الحالية)
export const IMAGE_KINDS = ['exterior', 'interior', 'aerial', 'map', 'plan3d', 'plan', 'photo'];
export const MAX_PAGES = 40;
export const MAX_MODELS = MAX_PAGES;

function present(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

function text(value, max) {
    return present(value) && typeof value !== 'object' ? String(value).trim().slice(0, max || 200) : null;
}

function num(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== 'string' || !/^\s*[\d٠-٩.,٬\s]+\s*$/.test(value)) return null;
    const n = Number(value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
}

// صورة تُطبع: https فقط، كما تعرضها اللوحة (shownImage في approvals.js)
function https(value) {
    const t = String(value ?? '').trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(t) ? t : null;
}

function list(value, max) {
    return (Array.isArray(value) ? value : []).map((v) => text(v, 80)).filter(Boolean).slice(0, max);
}

// صورة: رابط نصي (المخزون) أو { url, kind, caption, tall, wide, deep, w, h, quiet, focus, alpha, tone, raster, detail } (البروشور
// المرفوع بعد التصنيف): w وh بكسلاتها، فلا تُطبع أكبر مما تحمل، وquiet الجهة الأهدأ أسفلها لكتلة كلام فوقها، وfocus نقطة ثقلها
// [x, y] لموضع القصّ، وalpha رسم على شفاف (خريطة خطوط: حبر على الورق لا صورة)، وraster صفحة المطوّر كاملةً (عنوانه في سمائها)
function image(value) {
    const raw = value && typeof value === 'object' ? value : { url: value };
    const url = https(raw.url);
    if (!url) return null;
    const px = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    return { url, kind: IMAGE_KINDS.includes(raw.kind) ? raw.kind : 'photo', caption: text(raw.caption, 60), tall: raw.tall === true,
        wide: raw.wide === true, deep: Object.prototype.hasOwnProperty.call(PALETTES, raw.deep) ? raw.deep : null,
        w: px(raw.w), h: px(raw.h), quiet: raw.quiet === 'left' || raw.quiet === 'right' ? raw.quiet : null,
        focus: Array.isArray(raw.focus) && raw.focus.length === 2 && raw.focus.every(unit) ? raw.focus.slice() : null,
        alpha: raw.alpha === true, tone: raw.tone === 'light' ? 'light' : 'dark', raster: raw.raster === true, detail: unit(raw.detail) ? raw.detail : null };
}
const HEX = /^#[0-9A-F]{6}$/i;

// قصّ المخطط: [x0, y0, x1, y1] نسباً من 0 إلى 1، وكل ضلع 15% فأكثر؛ وغيره null (يُعرض المخطط كاملاً)
function crop(value) {
    if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) return null;
    return value[2] - value[0] >= 0.15 && value[3] - value[1] >= 0.15 ? value.slice() : null;
}

// صف المشروع ← الحقائق التي يجوز طبعها. office: { whatsapp } من إعدادات المكتب
export function brochureFacts(project, office = {}) {
    const p = project || {};
    const d = p.details && typeof p.details === 'object' ? p.details : {};
    const seen = new Set();
    const images = (Array.isArray(p.images) ? p.images : []).map(image).filter((i) => i && !seen.has(i.url) && seen.add(i.url)).slice(0, 64);
    const models = (Array.isArray(d.models) ? d.models : []).filter((m) => m && typeof m === 'object').map((m) => ({
        name: text(m.name, 40), type: text(m.type, 30), floor: text(m.floor, 40),
        rooms: num(m.rooms), bathrooms: num(m.bathrooms ?? m.baths), area: num(m.area),
        price: num(m.price), count: num(m.count),
        sold: m.status === 'sold' || m.status === 'sold_out',
        orientation: text(m.orientation ?? m.facing, 40),
        parts: list(m.parts ?? m.features ?? m.components, 12),
        plan: https(m.plan), planTone: m.plan_tone === 'light' ? 'light' : 'dark', planBoard: m.plan_board === true,
        // نسبة عرض المخطط إلى ارتفاعه، وقصّ مخطط الوحدة ومخطط الدور منه (brochure-media.js)
        planRatio: typeof m.plan_ratio === 'number' && m.plan_ratio > 0.2 && m.plan_ratio < 5 ? m.plan_ratio : null,
        planUnit: crop(m.plan_crop && m.plan_crop.unit), planKey: crop(m.plan_crop && m.plan_crop.key)
    })).slice(0, MAX_MODELS);
    const prices = models.filter((m) => m.price && !m.sold).map((m) => m.price);
    const areas = models.filter((m) => m.area).map((m) => m.area);
    return {
        id: p.id ?? null,
        name: text(p.name, 80),
        nameLatin: text(d.name_en, 60),
        tagline: text(d.tagline, 80),
        developer: text(d.developer, 60),
        type: text(p.type, 30),
        purpose: p.purpose === 'rent' ? 'rent' : p.purpose === 'sale' ? 'sale' : null,
        city: text(p.city, 30),
        district: text(p.district, 40),
        address: text(p.address, 120),
        price: prices.length ? Math.min(...prices) : num(p.price),
        priceFrom: prices.length > 1,
        area: areas.length ? null : num(p.area),
        // مدى المساحات من النماذج، وإلا كما طُبع في نص «عن المشروع» («بمساحات تتراوح ما بين 196.45م2 وحتى 220م2»)
        areaRange: areas.length ? [Math.min(...areas), Math.max(...areas)]
            : Array.isArray(d.area_range) && d.area_range.length === 2 && d.area_range.every((v) => num(v)) && num(d.area_range[0]) <= num(d.area_range[1]) ? d.area_range.map(num) : null,
        delivery_date: present(p.delivery_date) ? String(p.delivery_date).slice(0, 10) : null,
        construction_status: text(d.construction_status, 40),
        units_count: num(d.units_count),
        description: text(d.description, 520),
        amenities: list(d.amenities ?? d.features, 12),
        landmarks: list(d.landmarks ?? d.nearby, 6),
        license: text(d.license ?? d.rega_license, 60),
        models, images,
        // لون هوية المطوّر من صفحاته (colours: { deep, pale } ست عشريّة مختبرة)، وإلا عائلة صوره، وإلا كحلي ملائم
        palette: d.colours && HEX.test(d.colours.deep) && HEX.test(d.colours.pale) ? { name: 'brand', deep: d.colours.deep.toUpperCase(), pale: d.colours.pale.toUpperCase() }
            : Object.prototype.hasOwnProperty.call(PALETTES, d.palette) ? { name: d.palette, ...PALETTES[d.palette] } : { name: 'navy', ...PALETTES.navy },
        soldOut: p.availability === 'sold_out',
        office: { whatsapp: text(office.whatsapp, 20) }
    };
}

// المخطط قبل الرسم: الأنواع والأنساق من القوائم، والصور والنماذج فهارس موجودة. قائمة أخطاء بالعربية
export function validateSpec(spec, facts) {
    const errors = [];
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.pages)) return ['المخطط بلا صفحات'];
    if (!spec.pages.length || spec.pages.length > MAX_PAGES) errors.push('عدد الصفحات يجب أن يكون من 1 إلى ' + MAX_PAGES);
    if (spec.pages[0] && spec.pages[0].kind !== 'cover') errors.push('الصفحة الأولى ليست غلافاً');
    const NEED = { cover: { side: 1, low: 1 }, about: { split: 1 }, photo: { full: 1, tall: 1, plate: 1 }, trio: { panels: 3 }, pair: { offset: 2 }, location: { map: 1, hero: 1 }, features: { photo: 1 } };
    spec.pages.forEach((page, i) => {
        const n = 'الصفحة ' + (i + 1) + ': ';
        if (!page || !PAGE_KINDS[page.kind]) return void errors.push(n + 'نوع غير معروف');
        if (!PAGE_KINDS[page.kind].includes(page.variant)) errors.push(n + 'نسق غير معروف');
        for (const idx of page.images || []) {
            if (!Number.isInteger(idx) || idx < 0 || idx >= facts.images.length) errors.push(n + 'صورة غير موجودة');
        }
        if ((page.images || []).length < ((NEED[page.kind] || {})[page.variant] || 0)) errors.push(n + 'صور أقل مما يحتاجه النسق');
        if (page.kind === 'model') {
            const m = facts.models[page.model];
            if (!Number.isInteger(page.model) || !m) errors.push(n + 'نموذج غير موجود');
            else if (page.variant === 'plan' && !m.plan) errors.push(n + 'النموذج بلا مخطط');
            else if (page.variant === 'wide' && (page.images || []).length) errors.push(n + 'نموذج عريض بصورة');
        }
        const t = page.text || {};
        if (page.kind === 'features' && !(Array.isArray(t.bullets) && t.bullets.length) && !(Array.isArray(t.figures) && t.figures.length) && !facts.amenities.length) errors.push(n + 'لا مزايا');
        if (page.kind === 'statement' && page.variant === 'chapter') {
            const [from, to] = Array.isArray(page.models) ? page.models : [];
            if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || !facts.models[from] || !facts.models[to]) errors.push(n + 'نماذج الافتتاح غير موجودة');
        }
    });
    return errors;
}

// عنوان صفحة النموذج: اسمه كما قُرئ؛ والاسم الذي هو حرف أو رقم وحده («A» في شارة المطوّر بجانب «شقة امامية») يُسبق بنوعه كما
// قُرئ («شقة A»)، وإلا بـ«نموذج». وبلا اسم عنوانُ صفحته المطبوع، ثم نوعه أو مساحته («وحدة 282 م²») — لا «النموذج» عنواناً لكل الصفحات.
// fmt يكتب الأعداد (money في الواجهة)
export function modelLabel(m, title, fmt = String) {
    const name = m && typeof m.name === 'string' ? m.name : null;
    const type = m && typeof m.type === 'string' && m.type.length <= 12 ? m.type : null;
    if (name && /^[A-Za-z\d٠-٩]{1,3}$/.test(name)) return (type || 'نموذج') + ' ' + name;
    if (name) return name;
    if (title && !/مكون|مكوّن/.test(title)) return title;
    if (m && m.area) return (type || 'وحدة') + ' ' + fmt(m.area) + ' م²';
    return type || title || 'النموذج';
}

// مكوّن يعيد عدد الغرف أو دورات المياه نفسه بأي صيغة («3 دورة مياة»، «(4) غرف»، «غرف نوم 4»): مكتوبٌ في شريط القياسات فلا يتكرر
export function restates(p, m) {
    const t = String(p ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[()]/g, ' ').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
    const baths = /^(\d+) ?(?:دورات|دوره) مياه$/.exec(t) || /^(?:دورات|دوره) مياه ?(\d+)$/.exec(t);
    if (baths && m.bathrooms && Number(baths[1]) === m.bathrooms) return true;
    const rooms = /^(\d+) ?(?:غرف|غرفه)(?: نوم)?$/.exec(t) || /^(?:غرف|غرفه)(?: نوم)? ?(\d+)$/.exec(t);
    return Boolean(rooms && m.rooms && Number(rooms[1]) === m.rooms);
}

// كل نص قرأه المساعد يصل إلى صفحته: العنوان والعنوان الفرعي والنص والأسطر والأرقام وعناوينها ومكوّنات النماذج. يُعدّ النص مطبوعاً
// إن ظهرت كل كلماته في نص الصفحة (الأرقام مع وحداتها قد تُطبع مفرّقة: «25» ثم «سنة» ثم بندها). لا يُفحص الغلاف (اسم المشروع
// وسطره من القراءة نفسها) ولا الفهرس، ولا عنوان صفحة النموذج (اسمه هو العنوان)، ولا مكوّن يعيد قياساً في شريط القياسات.
// pageTexts: نص كل صفحة مرسومة بالترتيب ← [{ page, text }] ما لم يُطبع
export function unprinted(spec, facts, pageTexts) {
    const norm = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\u2066-\u2069\u200e\u200fـ]/g, '')
        .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/m²|m2|م2/gi, 'م²');
    const words = (v) => norm(v).split(/[\s،,.:;()«»"'\-–+/·]+/).filter((w) => w.length >= 2);
    const out = [];
    const pages = spec && Array.isArray(spec.pages) ? spec.pages : [];
    const models = facts && Array.isArray(facts.models) ? facts.models : [];
    pages.forEach((pg, i) => {
        if (!pg || pg.kind === 'cover' || (pg.kind === 'statement' && pg.variant === 'contents')) return;
        const have = new Set(words(pageTexts[i]));
        const flat = norm(pageTexts[i]).replace(/\s+/g, '');
        const seen = (v) => { const w = words(v); return !w.length || w.every((x) => have.has(x) || flat.includes(x)); };
        const t = pg.text || {};
        // عنوان صفحة الضمانات المكرر من صفحة قبلها («مميزات المشروع» مرتين) يُعنون باسم قسمها عمداً
        const renamed = guaranteePage(pg) && t.title && pages.slice(0, i).some((q) => q && q.text && q.text.title === t.title);
        const want = pg.kind === 'model' ? [t.body] : [renamed ? null : t.title, t.subtitle, t.body, ...(t.bullets || []), ...(t.figures || []).flatMap((f) => [f.value, f.label])];
        if (pg.kind === 'back') want.splice(0, want.length, t.title, t.subtitle);
        if (pg.kind === 'model' && models[pg.model]) want.push(...models[pg.model].parts.filter((x) => !restates(x, models[pg.model])));
        for (const v of want) if (v && !seen(v)) out.push({ page: i + 1, text: String(v).replace(/[\u2066-\u2069]/g, '') });
    });
    return out;
}
