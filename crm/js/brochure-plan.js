// استوديو البروشورات: بيانات المشروع ← مخطط البروشور (الصفحات ونوعها) — بلا DOM وبلا شبكة، فيُختبر وحده.
//
// المستوى المطلوب من بروشورات المطورين التي أرسلها المالك (2026-10-25): الصورة تملأ الصفحة والنص صغير في زاوية هادئة، وصفحة
// لكل نموذج فيها مخططه كبيراً وثلاثة أرقام ومكوّناته، وخط واحد ولونان وخطوط رفيعة. لا بطاقات ولا تدرّجات ولا زخرفة.
// المخطط بيانات لا رسم: brochure.js يرسمه صفحات 16:9، والمدير الإبداعي بالذكاء الاصطناعي (لاحقاً) يكتب مخططاً بالشكل نفسه
// ويمرّ من validateSpec نفسها. والمخطط لا يحمل أرقاماً ولا أسماء، بل فهارس صور ونماذج، فلا يكتب نموذجٌ سعراً من عنده.
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
    back: ['brand']
};

// أنواع الصور: من تصنيف البروشور المرفوع، أو photo لصورة لا يُعرف نوعها (صور المخزون الحالية)
export const IMAGE_KINDS = ['exterior', 'interior', 'aerial', 'map', 'plan3d', 'photo'];
export const MAX_MODELS = 8;

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
    const images = (Array.isArray(p.images) ? p.images : []).map(image).filter((i) => i && !seen.has(i.url) && seen.add(i.url)).slice(0, 24);
    const models = (Array.isArray(d.models) ? d.models : []).filter((m) => m && typeof m === 'object').map((m) => ({
        name: text(m.name, 40), type: text(m.type, 30),
        rooms: num(m.rooms), bathrooms: num(m.bathrooms ?? m.baths), area: num(m.area),
        price: num(m.price), count: num(m.count),
        sold: m.status === 'sold' || m.status === 'sold_out',
        orientation: text(m.orientation ?? m.facing, 40),
        parts: list(m.parts ?? m.features ?? m.components, 12),
        plan: https(m.plan), planTone: m.plan_tone === 'light' ? 'light' : 'dark'
    })).filter((m) => m.name || m.area || m.price).slice(0, MAX_MODELS);
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

// رقم ثابت لكل مشروع: «تصميم آخر» يزيد variation فيتغير الاختيار، والمشروع نفسه يخرج بالشكل نفسه حتى يُطلب غيره
function seedOf(facts, variation) {
    const s = String(facts.id ?? facts.name ?? '') + ':' + (variation || 0);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// الحقائق ← المخطط: { version, pages: [{ kind, variant, images?: [فهارس], model?: فهرس }] }
export function planBrochure(facts, options = {}) {
    const seed = seedOf(facts, options.variation);
    const used = new Set();
    const of = (...kinds) => facts.images.map((img, i) => ({ img, i })).filter(({ img, i }) => !used.has(i) && kinds.includes(img.kind)).map(({ i }) => i);
    const take = (i) => { used.add(i); return i; };
    const wide = (i) => !facts.images[i].tall;
    const pages = [];

    // الغلاف: أقوى واجهة (عريضة) ثم أي صورة؛ بلا صور غلاف بالخط
    const heroes = of('exterior').filter(wide).concat(of('exterior', 'photo', 'aerial').filter(wide), of('exterior', 'photo'));
    if (heroes.length) {
        const pick = heroes[seed % Math.min(heroes.length, 2)];
        pages.push({ kind: 'cover', variant: ['side', 'low'][seed % 2], images: [take(pick)] });
    } else {
        pages.push({ kind: 'cover', variant: 'type' });
    }

    // عن المشروع: نص وأرقام، وصورة إن بقيت واجهة أو صورة
    if (facts.description || facts.price || facts.areaRange || facts.area || facts.units_count) {
        const side = of('exterior', 'photo')[0];
        pages.push(side !== undefined ? { kind: 'about', variant: 'split', images: [take(side)] } : { kind: 'about', variant: 'text' });
    }

    // صفحة صورة كاملة: واجهة أو صورة عريضة باقية
    const full = of('exterior', 'photo', 'aerial').filter(wide)[0];
    if (full !== undefined) pages.push({ kind: 'photo', variant: 'full', images: [take(full)] });

    // ثلاث لقطات داخلية طولية جنباً إلى جنب، أو صورتان
    const inside = of('interior', 'photo');
    if (inside.length >= 3) pages.push({ kind: 'trio', variant: 'panels', images: inside.slice(0, 3).map(take) });
    const two = of('interior', 'exterior', 'photo', 'plan3d');
    if (two.length >= 2) pages.push({ kind: 'pair', variant: 'offset', images: two.slice(0, 2).map(take) });

    // الموقع: صورة جوية أو خريطة، أو المعالم القريبة وحدها
    const where = of('aerial', 'map')[0];
    if (where !== undefined) pages.push({ kind: 'location', variant: 'map', images: [take(where)] });
    else if (facts.landmarks.length) pages.push({ kind: 'location', variant: 'text' });

    // صفحة لكل نموذج: بمخططه هو، وإلا بالأرقام وحدها. لا يُستعار مجسّم عام أو مخطط نموذج آخر: يوهم أنه مخطط هذه الوحدة
    // (في بروشور لامير سيرين نفسه وُضع مخطط «شقة 3، 168م²» على صفحة «ملحق 3، 225م²»)
    facts.models.forEach((m, i) => pages.push({ kind: 'model', variant: m.plan ? 'plan' : 'facts', model: i }));

    // المزايا بجانب صورة باقية إن وُجدت، فلا تبقى الصفحة نصف فارغة
    if (facts.amenities.length) {
        const spare = of('interior', 'exterior', 'photo', 'plan3d')[0];
        pages.push(spare !== undefined ? { kind: 'features', variant: 'photo', images: [take(spare)] } : { kind: 'features', variant: 'list' });
    }
    pages.push({ kind: 'back', variant: 'brand' });
    return { version: 2, pages };
}

// المخطط قبل الرسم، من الكود أو من نموذج: الأنواع والأنساق من القوائم، والصور والنماذج فهارس موجودة. قائمة أخطاء بالعربية
export function validateSpec(spec, facts) {
    const errors = [];
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.pages)) return ['المخطط بلا صفحات'];
    if (!spec.pages.length || spec.pages.length > 20) errors.push('عدد الصفحات يجب أن يكون من 1 إلى 20');
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
        if (page.kind === 'features' && !facts.amenities.length) errors.push(n + 'لا مزايا');
    });
    return errors;
}
