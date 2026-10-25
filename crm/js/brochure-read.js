// قراءة المساعد لبروشور المطوّر (agent_requests.result، 036) + صوره المستخرجة (media.json) ← صف «مشروع» يقبله brochureFacts،
// وملاحظات للمدير — بلا DOM وبلا شبكة، فيُختبر وحده.
//
// لا يدخل البروشورَ إلا ما قرأه المساعد بمصدر صفحته (brochure.ts يُسقط الباقي). والصور: يُترك ما قال المساعد إنه شعار أو خلفية
// أو صورة بشر جاهزة، ويُنسب المخطط إلى نموذجه بما قاله المساعد أو بصفحته، ولا يُعرض مخطط بلا نموذج معروف ولا مخطط يناقض
// نموذجه (مخطط «شقة 3، 168م²» على صفحة «ملحق 3، 225م²» في بروشور لامير سيرين): الأرقام وحدها أصدق من مخطط مستعار.

// المصغّرات في كل ورقة ترسل إلى المساعد (4 × 4)
export const SHEET_SIZE = 16;
const DROPPED_ROLES = new Set(['logo', 'texture', 'people', 'other']);

// عدد الصور ← مجموعات فهارسها، ورقة لكل SHEET_SIZE
export function sheetGroups(count) {
    const groups = [];
    for (let i = 0; i < count; i += SHEET_SIZE) groups.push(Array.from({ length: Math.min(SHEET_SIZE, count - i) }, (_, k) => i + k));
    return groups;
}

// الاسم للمقارنة: الأرقام العربية لاتينية، وبلا همزات ولا تشكيل ولا مسافات ولا أقواس، و«نموذج» محذوفة
function key(value) {
    return String(value ?? '').toLowerCase()
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '')
        .replace(/نموذج/g, '').replace(/[^a-z0-9ء-ي]+/g, '');
}

// أول مساحة في نص مطبوع داخل المخطط: «مساحتها 168م²»، «168 م2»، «مساحة: ١٠٧»
export function areaIn(label) {
    const t = String(label ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    // «م» وحدها وحدةٌ ما لم تتبعها حروف («97 م» نعم، «97 مجلس» لا). \b لا يعرف الحروف العربية فلا يصلح هنا
    const m = /(\d{2,4}(?:\.\d+)?)\s*(?:م²|م2|م(?![ء-ي])|m²|m2|sqm)/i.exec(t) || /مساح(?:ت\S*|ة)\s*:?\s*(\d{2,4}(?:\.\d+)?)/.exec(t);
    return m ? Number(m[1]) : null;
}

function modelByName(name, models) {
    const k = key(name);
    if (!k) return null;
    const hits = models.map((m, i) => (key(m.name) === k ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : null;
}

function modelOnPage(page, models) {
    const hits = models.map((m, i) => (m.page === page ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : null;
}

// بلا دور من المساعد: تقدير الاستخراج (مخطط) ودور الصفحة التي جاءت منها الصورة
function fallbackKind(m, role) {
    if (m.kind === 'plan') return 'plan';
    if (role === 'interior' || role === 'aerial' || role === 'map' || role === 'exterior') return role;
    if (role === 'plan' || role === 'model') return 'plan3d';
    return 'photo';
}

// result: قراءة المساعد؛ media: { images: [{ url, page, kind, tone, tall }] } بترتيب أرقام المصغّرات؛ meta: { id }
export function factsFromReading(result, media, meta = {}) {
    const r = result && typeof result === 'object' ? result : {};
    const p = r.project && typeof r.project === 'object' ? r.project : {};
    const models = Array.isArray(r.models) ? r.models : [];
    const notes = [];
    const aiRole = new Map((Array.isArray(r.images) ? r.images : []).map((x) => [x.n, x]));
    const pageRole = new Map((Array.isArray(r.pages) ? r.pages : []).map((x) => [x.page, x.role]));

    const images = [];
    const plans = new Map();
    let dropped = 0;
    (media && Array.isArray(media.images) ? media.images : []).forEach((m, i) => {
        if (!m || !m.url) return;
        const ai = aiRole.get(i + 1);
        const kind = ai ? ai.role : fallbackKind(m, pageRole.get(m.page));
        if (DROPPED_ROLES.has(kind)) { dropped++; return; }
        if (kind === 'plan') {
            // قال المساعد إنه لا يعرف نموذجه: يُترك، فحذره أصدق من الصفحة (مخطط ملحق في بروشور لامير وُضع على صفحة نموذج آخر).
            // الصفحة تُعتمد فقط حين لا دور من المساعد للصورة أصلاً
            const owner = ai ? (ai.model ? modelByName(ai.model, models) : null) : modelOnPage(m.page, models);
            if (owner !== null && !plans.has(owner)) plans.set(owner, m);
            return;
        }
        images.push({ url: m.url, kind, caption: ai && ai.caption ? ai.caption : null, tall: m.tall === true });
    });
    if (dropped) notes.push('تُركت ' + dropped + ' صورة لأنها شعار المطوّر أو خلفية أو صورة جاهزة لا تخص المشروع.');

    const outModels = models.map((m, i) => {
        let plan = plans.get(i) || null;
        const printed = areaIn(m.plan_label);
        if (plan && printed && m.area && Math.abs(printed - m.area) > 1) {
            notes.push('مخطط ' + (m.name || 'النموذج') + ' في البروشور مكتوب عليه ' + printed + 'م² والنموذج ' + m.area + 'م² — لم يُعرض المخطط، وتُعرض الأرقام وحدها.');
            plan = null;
        }
        return {
            name: m.name, type: m.type, orientation: m.orientation, rooms: m.rooms, bathrooms: m.bathrooms, area: m.area, price: m.price,
            status: m.sold ? 'sold' : 'available', parts: Array.isArray(m.parts) ? m.parts : [],
            plan: plan ? plan.url : null, plan_tone: plan && plan.tone === 'light' ? 'light' : 'dark'
        };
    });

    for (const c of Array.isArray(r.conflicts) ? r.conflicts : []) {
        const pages = Array.isArray(c.pages) && c.pages.length ? ' (صفحة ' + c.pages.join('، ') + ')' : '';
        notes.push('تناقض في البروشور' + pages + ': ' + (c.note || (c.values || []).join(' / ')));
    }
    for (const s of Array.isArray(r.suspicious) ? r.suspicious : []) {
        notes.push('نص في البروشور يحاول توجيه المساعد ولم يُنفَّذ: «' + s.quote + '»');
    }
    if (r.dropped) notes.push(r.dropped + ' قيمة لم تُقرأ بمصدر واضح فلم تُكتب.');

    const project = {
        id: meta.id ?? null,
        name: p.name ?? null, type: p.type ?? null, purpose: p.purpose ?? null,
        city: p.city ?? null, district: p.district ?? null, address: p.address ?? null,
        delivery_date: p.delivery_date ?? null, availability: 'available',
        images,
        details: {
            developer: p.developer ?? null, name_en: p.name_latin ?? null, tagline: p.tagline ?? null,
            description: p.description ?? null, construction_status: p.construction_status ?? null,
            units_count: p.units_count ?? null, license: p.license ?? null,
            landmarks: Array.isArray(p.landmarks) ? p.landmarks : [], amenities: Array.isArray(p.amenities) ? p.amenities : [],
            models: outModels
        }
    };
    return { project, notes };
}
