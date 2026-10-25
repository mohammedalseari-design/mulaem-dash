// استوديو البروشورات: الحقائق التي يجوز طبعها، والتحقق من مخطط الصفحات قبل الرسم — بلا DOM وبلا شبكة، فيُختبر وحده.
//
// المستوى المطلوب من بروشورات المطورين التي أرسلها المالك (2026-10-25): الصورة تملأ الصفحة والنص صغير في زاوية هادئة، وصفحة
// لكل نموذج فيها مخططه كبيراً وثلاثة أرقام ومكوّناته، وخط واحد ولونان وخطوط رفيعة. لا بطاقات ولا تدرّجات ولا زخرفة.
// المخطط بيانات لا رسم: brochure-read.js يبنيه صفحةً لكل صفحة من بروشور المطوّر، وbrochure.js يرسمه صفحات 16:9.
// والمخطط لا يحمل أرقاماً، بل فهارس صور ونماذج ونصوص الصفحة كما قرأها المساعد، فلا يكتب نموذجٌ سعراً من عنده.
// لا قيمة في البروشور ليست في البيانات: الناقص يغيب مع سطره ولا يُخمَّن.

export const PAGE_KINDS = {
    cover: ['side', 'low', 'type'],
    about: ['split', 'text'],
    photo: ['full'],
    trio: ['panels'],
    pair: ['offset'],
    location: ['map', 'text'],
    model: ['plan', 'facts'],
    features: ['list', 'photo'],
    back: ['brand'],
    // صفحة فاصلة: جملة كبيرة، من نص الصفحة القصير أو من شعار المشروع لصفحة لا صورة فيها ولا نص، فيبقى العدد
    statement: ['say']
};

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

// صورة: رابط نصي (المخزون) أو { url, kind, caption, tall } (البروشور المرفوع بعد التصنيف)
function image(value) {
    const raw = value && typeof value === 'object' ? value : { url: value };
    const url = https(raw.url);
    if (!url) return null;
    return { url, kind: IMAGE_KINDS.includes(raw.kind) ? raw.kind : 'photo', caption: text(raw.caption, 60), tall: raw.tall === true };
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
        plan: https(m.plan), planTone: m.plan_tone === 'light' ? 'light' : 'dark'
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
    const NEED = { cover: { side: 1, low: 1 }, about: { split: 1 }, photo: { full: 1 }, trio: { panels: 3 }, pair: { offset: 2 }, location: { map: 1 }, features: { photo: 1 } };
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
        if (page.kind === 'features' && !(page.text && page.text.bullets && page.text.bullets.length) && !facts.amenities.length) errors.push(n + 'لا مزايا');
    });
    return errors;
}
