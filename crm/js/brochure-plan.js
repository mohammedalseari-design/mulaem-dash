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
    photo: ['full'],
    trio: ['panels'],
    pair: ['offset'],
    // hero: صورة جوّية عريضة تملأ الصفحة كلها، والكلام على كتلة ورق في زاويتها (افتتاح فصل الموقع)
    location: ['map', 'text', 'hero'],
    model: ['plan', 'facts'],
    // numbers: مزايا تبدأ كلها بعدد (الضمانات) أرقاماً كبيرة
    features: ['list', 'photo', 'numbers'],
    back: ['brand'],
    // صفحة فاصلة: جملة كبيرة، من نص الصفحة القصير أو من شعار المشروع لصفحة لا صورة فيها ولا نص، فيبقى العدد؛
    // وchapter: افتتاح سلسلة نماذج (models: [أول نموذج، آخر نموذج]) بفهرسها؛ وcontents: فهرس البروشور وبطاقة المشروع في صفحة
    // صورتها صارت الغلاف (أو صفحة «المحتويات» في بروشور المطوّر)
    statement: ['say', 'chapter', 'contents']
};

// ألوان البروشور من عائلة لون مشروعه (brochureTone في brochure-media.js): deep للصفحات والكتل الداكنة (ثلاث صفحات على الأكثر)،
// وpale لكتل فصل النماذج الثاني. المالك (2026-10-25): «مو لازم أزرق غامق… لا تكون مقيد بألوان ملائم». هوية ملائم في شعارها
// وغلافها الخلفي الكحلي دائماً؛ وبلا عائلة يبقى كحلي ملائم. الألوان مختارة هنا سلفاً، والقراءة لا تحمل إلا اسم العائلة
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
export const DURATION = /^(سنوات|سنة|سنين|سنتين|سنتان|أعوام|عام|عامين|أشهر|شهور|شهر|أيام|يوم)(\s|$)/;
export function guaranteePage(page) {
    if (!page || page.kind !== 'features' || page.variant !== 'numbers' || !page.text) return false;
    const figs = Array.isArray(page.text.figures) && page.text.figures.length ? page.text.figures.map((f) => f.value)
        : Array.isArray(page.text.bullets) ? page.text.bullets : [];
    return figs.length > 0 && figs.every((v) => { const f = splitFigure(v); return f.n && f.unit && DURATION.test(f.unit); });
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
    let first = null;
    const nameOf = (p, i) => {
        if (!p || p.kind === 'cover' || p.kind === 'back' || (contents > 0 && i <= contents)) return null;
        if (p.kind === 'location') return 'الموقع';
        if (guaranteePage(p)) return 'الضمانات';
        if (p.kind === 'features') return 'المميزات';
        if (p.kind === 'statement' && p.variant === 'chapter') return 'النماذج';
        if (p.kind === 'model') {
            const g = groupOf(models[p.model]);
            if (first === null) first = g;
            return g === first ? 'النماذج' : PLURAL[g] || 'النماذج';
        }
        if (p.kind === 'statement' && p.variant === 'say' && pages[i + 1] && pages[i + 1].kind === 'back') return 'تواصل';
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
export const IMAGE_KINDS = ['exterior', 'interior', 'aerial', 'map', 'plan3d', 'photo'];
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

// صورة: رابط نصي (المخزون) أو { url, kind, caption, tall, wide, deep, w, h, quiet } (البروشور المرفوع بعد التصنيف): w وh
// بكسلاتها، فلا تُطبع أكبر مما تحمل، وquiet الجهة الأهدأ أسفلها لكتلة كلام فوقها
function image(value) {
    const raw = value && typeof value === 'object' ? value : { url: value };
    const url = https(raw.url);
    if (!url) return null;
    const px = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    return { url, kind: IMAGE_KINDS.includes(raw.kind) ? raw.kind : 'photo', caption: text(raw.caption, 60), tall: raw.tall === true,
        wide: raw.wide === true, deep: Object.prototype.hasOwnProperty.call(PALETTES, raw.deep) ? raw.deep : null,
        w: px(raw.w), h: px(raw.h), quiet: raw.quiet === 'left' || raw.quiet === 'right' ? raw.quiet : null };
}

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
        name: text(m.name, 40), type: text(m.type, 30),
        rooms: num(m.rooms), bathrooms: num(m.bathrooms ?? m.baths), area: num(m.area),
        price: num(m.price), count: num(m.count),
        sold: m.status === 'sold' || m.status === 'sold_out',
        orientation: text(m.orientation ?? m.facing, 40),
        parts: list(m.parts ?? m.features ?? m.components, 12),
        plan: https(m.plan), planTone: m.plan_tone === 'light' ? 'light' : 'dark',
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
        areaRange: areas.length ? [Math.min(...areas), Math.max(...areas)] : null,
        delivery_date: present(p.delivery_date) ? String(p.delivery_date).slice(0, 10) : null,
        construction_status: text(d.construction_status, 40),
        units_count: num(d.units_count),
        description: text(d.description, 520),
        amenities: list(d.amenities ?? d.features, 12),
        landmarks: list(d.landmarks ?? d.nearby, 6),
        license: text(d.license ?? d.rega_license, 60),
        models, images,
        palette: Object.prototype.hasOwnProperty.call(PALETTES, d.palette) ? { name: d.palette, ...PALETTES[d.palette] } : { name: 'navy', ...PALETTES.navy },
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
    const NEED = { cover: { side: 1, low: 1 }, about: { split: 1 }, photo: { full: 1 }, trio: { panels: 3 }, pair: { offset: 2 }, location: { map: 1, hero: 1 }, features: { photo: 1 } };
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
