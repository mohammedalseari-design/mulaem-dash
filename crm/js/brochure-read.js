// قراءة المساعد لبروشور المطوّر صفحةً صفحة (agent_requests.result، الإصدار 2) + صوره المستخرجة (media.json) ← بروشور ملائم
// بعدد الصفحات نفسه: صف «مشروع» يقبله brochureFacts، ومخطط صفحات (صفحة لكل صفحة)، وملاحظات للمدير — بلا DOM وبلا شبكة،
// فيُختبر وحده.
//
// كل صفحة تأخذ شكلها من دورها كما قرأه المساعد (غلاف، عن المشروع، صور، نموذج، موقع، مزايا، تواصل) ونصوصها كما طُبعت،
// وصورها من صور الصفحة نفسها (المصغّرات المرقّمة تحت كل صفحة). يُترك ما قال المساعد إنه شعار أو خلفية أو صورة بشر جاهزة،
// ولا يُعرض مخطط يناقض نموذجه (مخطط «شقة 3، 168م²» على صفحة «ملحق 3، 225م²» في بروشور لامير سيرين): الأرقام وحدها أصدق.
// صفحة لم تُقرأ تُصمَّم من صورها وحدها، فلا ينقص العدد.

const PHOTO_ROLES = new Set(['exterior', 'interior', 'aerial', 'map', 'plan3d']);
const MAX_PAGES = 40;   // حد طلب البروشور (036)
const DROPPED_ROLES = new Set(['logo', 'texture', 'people', 'other']);

// أول مساحة في نص مطبوع داخل المخطط: «مساحتها 168م²»، «168 م2»، «مساحة: ١٠٧»
export function areaIn(label) {
    const t = String(label ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    // «م» وحدها وحدةٌ ما لم تتبعها حروف («97 م» نعم، «97 مجلس» لا). \b لا يعرف الحروف العربية فلا يصلح هنا
    const m = /(\d{2,4}(?:\.\d+)?)\s*(?:م²|م2|م(?![ء-ي])|m²|m2|sqm)/i.exec(t) || /مساح(?:ت\S*|ة)\s*:?\s*(\d{2,4}(?:\.\d+)?)/.exec(t);
    return m ? Number(m[1]) : null;
}

// نص كما طُبع بلا مدّ الكشيدة (ـ): المطوّر يمدّ الحروف زخرفةً («سيـرين»)، وخط ملائم يرسم الكلمة بلا مدّ
function str(value, max) {
    const t = typeof value === 'string' ? value.replace(/ـ/g, '').trim() : '';
    return t ? t.slice(0, max) : null;
}

// result: القراءة (الإصدار 2)؛ media: { pages, read, images: [{ url, page, w, h, kind, tone, tall, on: [{ page, n }] }] }؛
// meta: { id, variation, mediaPrefix }. ← { project, spec: { version, pages }, notes } أو null لقراءة من إصدار آخر.
// media.json في المخزن العام الذي يرفع إليه الميداني أيضاً: لا تُقبل إلا صور مخزن هذا البروشور (mediaPrefix)، والصفحات بحد الطلب
export function readingToBrochure(result, media, meta = {}) {
    const r = result && typeof result === 'object' ? result : {};
    if (r.version !== 2 || !Array.isArray(r.pages)) return null;
    const p = r.project && typeof r.project === 'object' ? r.project : {};
    const prefix = typeof meta.mediaPrefix === 'string' && meta.mediaPrefix ? meta.mediaPrefix : null;
    // الفهارس تبقى كما في media (أرقام المصغّرات تشير إليها)، والصورة المرفوضة مكانها فارغ
    const all = (media && Array.isArray(media.images) ? media.images : []).map((m) => (m && typeof m.url === 'string'
        && /^https:\/\//i.test(m.url) && (!prefix || m.url.startsWith(prefix)) ? m : null));
    const notes = [];
    const variation = meta.variation || 0;

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
            images.push({ url: all[i].url, kind: kind === 'plan3d' ? 'plan3d' : kind, caption: caption || null, tall: all[i].tall === true });
        }
        return factIndex.get(i);
    };
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
    const firstExterior = () => {
        for (const x of r.pages) for (const im of x.images || []) if (im.role === 'exterior' && all[at.get(x.page + ':' + im.n)]) return at.get(x.page + ':' + im.n);
        return null;
    };

    for (let n = 1; n <= count; n++) {
        const page = read.get(n) || null;
        const role = page ? page.role : 'other';
        const pics = picsOf(n, page);
        const photos = pics.filter((x) => PHOTO_ROLES.has(x.role) && x.role !== 'map');
        const plans = pics.filter((x) => x.role === 'plan');
        const text = page ? { title: str(page.title, 120), subtitle: str(page.subtitle, 120), body: str(page.body, 600), bullets: (page.bullets || []).slice(0, 8) } : null;
        const hasText = Boolean(text && (text.title || text.body || text.bullets.length));
        const photo = (x) => use(x.i, x.role, x.caption);

        if (n === 1) {
            const wide = photos.find((x) => !all[x.i].tall) || photos[0];
            const hero = wide ? photo(wide) : firstExterior() !== null ? use(firstExterior(), 'exterior', null) : null;
            pages.push(hero !== null ? { kind: 'cover', variant: ['side', 'low'][variation % 2], images: [hero] } : { kind: 'cover', variant: 'type' });
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
                name: m.name || null, type: m.type || null, orientation: m.orientation || null,
                rooms: m.rooms ?? null, bathrooms: m.bathrooms ?? null, area: m.area ?? null, price: m.price ?? null,
                status: m.sold ? 'sold' : 'available', parts: Array.isArray(m.parts) ? m.parts : [],
                plan: plan ? plan.url : null, plan_tone: plan && plan.tone === 'light' ? 'light' : 'dark'
            });
            pages.push({ kind: 'model', variant: plan ? 'plan' : 'facts', model: models.length - 1, text });
            continue;
        }
        if (role === 'location') {
            const where = pics.find((x) => x.role === 'map') || pics.find((x) => x.role === 'aerial');
            pages.push(where ? { kind: 'location', variant: 'map', images: [photo(where)], text } : { kind: 'location', variant: 'text', text });
            continue;
        }
        if (role === 'amenities' && text && text.bullets.length) {
            pages.push(photos.length ? { kind: 'features', variant: 'photo', images: [photo(photos[0])], text } : { kind: 'features', variant: 'list', text });
            continue;
        }
        if (role === 'about' || role === 'contact' || (role === 'amenities' && hasText) || (!photos.length && hasText)) {
            // أول صفحة «عن المشروع» تحمل أرقامه؛ وصفحة نص قصير بلا صورة (عنوان وسطر أو سطران) صفحة فاصلة بنصها، لا صفحة شبه فارغة
            const stats = role === 'about' && !statsShown;
            const short = !photos.length && !stats && text.title && !text.bullets.length && (!text.body || text.body.length <= 220);
            if (short) {
                pages.push({ kind: 'statement', variant: 'say', text });
                continue;
            }
            if (stats) statsShown = true;
            pages.push(photos.length ? { kind: 'about', variant: 'split', images: [photo(photos[0])], text, stats } : { kind: 'about', variant: 'text', text, stats });
            continue;
        }
        // صور: ثلاث فأكثر لوحات (الداخلية أولاً)، واثنتان متجاورتان، وواحدة كاملة؛ وصفحة بلا صورة ولا نص فاصلٌ باسم المشروع
        const order = photos.filter((x) => x.role === 'interior').concat(photos.filter((x) => x.role !== 'interior'));
        if (order.length >= 3) pages.push({ kind: 'trio', variant: 'panels', images: order.slice(0, 3).map(photo), text });
        else if (order.length === 2) pages.push({ kind: 'pair', variant: 'offset', images: order.map(photo), text });
        else if (order.length === 1) pages.push({ kind: 'photo', variant: 'full', images: [photo(order[0])], text });
        else pages.push({ kind: 'statement', variant: 'say' });
    }

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
        details: { developer: str(p.developer, 80), name_en: str(p.name_latin, 60), tagline: str(p.tagline, 120), license: str(p.license, 120), models }
    };
    return { project, spec: { version: 3, pages }, notes };
}
