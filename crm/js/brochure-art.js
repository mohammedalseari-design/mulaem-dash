// استوديو البروشورات: «المدير الفني». بروشور المطوّر مادة خام (صور ونصوص وأرقام)، والمصمم هو نظام «مونوغراف» نفسه (الشبكة،
// وسلّم الخط، وصفحات الكتاب)، وهنا يقرر لكل مشروع اتجاهه الفني من المشروع نفسه لا من تصميم المطوّر: طابعه (mood)، وألوانه،
// وخطاه، وإيقاع صفحاته. بلا DOM وبلا شبكة فيُختبر وحده، والمدخل نفسه يعطي الاتجاه نفسه دائماً.
//
// المالك (2026-10-27): «ما ابغا ذوق البروشور، ابغا ذوق المصمم اللي سويناه، وابغاه يكون فنان ويعطي لكل مشروع على حسبه، بس
// هوية ملائم تكون متجانسة مع المشروع وتخلق شكل رهيب». ومن قبل: «مو لازم أزرق غامق… لا تكون مقيد بألوان ملائم».
//
// الطابع من علامات المشروع: كلمات اسمه ووصفه أثقل من عناوين صفحاته، وعناوينه أثقل من نصوصه؛ وحيّه (على البحر)، وسعر المتر،
// ونوع الوحدات وحجمها، وعائلة لون صوره، وكثرة الصور الداخلية. لكل طابع ورقه وحبره ولون إبرازه، وحقل عميق لكل عائلة لون —
// كلها مختارة هنا سلفاً ومختبرة التباين، فلا لون يأتي من ملف المطوّر. والخطوط من Google Fonts: خط عربي للعناوين ومعه خط لاتيني
// لأرقامه واسم المشروع اللاتيني، والنص دائماً IBM Plex Sans Arabic خط ملائم نفسه. «تصميم آخر» ينتقل إلى البديل التالي المتّسق.
// هوية ملائم ثابتة في كل بروشور بألوان مشروعه (brochure.js): الشعار الرسمي نفسه لوناً واحداً، وعلامته في رأس كل صفحة، والغلاف
// الخلفي بتركيبه الواحد (الشعار، وسطر «ملائم العقارية.. حيث تجد ما يناسبك»، وواتساب المكتب).

// عائلات لون الصور (deepTone وbrochureTone في brochure-media.js): أسماء من قائمة ثابتة لا ألوان
export const FAMILIES = ['navy', 'teal', 'forest', 'bronze', 'plum'];
export const TEXT_FONT = 'IBM Plex Sans Arabic';

// أزواج الخطوط: display خط عربي للعناوين، وfigures خط لاتيني لأرقامه واسم المشروع اللاتيني (يُحمَّل بأحرفه وحدها، فالعربي يقع على
// display؛ وnull: أرقام الخط العربي نفسه). k مقاس العناوين نسبةً إلى Alexandria (Markazi أصغر عيناً فيكبر درجة، وKufi أعرض فيصغر)،
// فيبقى سلّم الدرجات السبع نفسه بصرياً؛ والأوزان لكل استعمال: title الغلاف، وhead العناوين، وfig الأرقام الكبيرة، وfig2 الصغيرة
export const PAIRINGS = {
    gallery: { display: 'Alexandria', figures: 'Cormorant Garamond', k: 1, w: { title: 200, head: 300, fig: 300, fig2: 400 }, label: 'ألكسندريا وكورمورانت' },
    monograph: { display: 'Alexandria', figures: 'Jost', k: 1, w: { title: 300, head: 300, fig: 200, fig2: 400 }, label: 'ألكسندريا وجوست' },
    air: { display: 'Readex Pro', figures: null, k: 0.95, w: { title: 200, head: 300, fig: 200, fig2: 300 }, label: 'ريدكس' },
    kufi: { display: 'Noto Kufi Arabic', figures: 'Antonio', k: 0.94, w: { title: 500, head: 500, fig: 200, fig2: 300 }, label: 'كوفي وأنطونيو' },
    naskh: { display: 'Markazi Text', figures: 'Fraunces', k: 1.22, w: { title: 500, head: 500, fig: 300, fig2: 400 }, label: 'مركزي وفراونسز' },
    soft: { display: 'Tajawal', figures: 'Nunito Sans', k: 1, w: { title: 300, head: 400, fig: 200, fig2: 300 }, label: 'تجوال ونونيتو' },
    calm: { display: TEXT_FONT, figures: null, k: 1.04, w: { title: 200, head: 300, fig: 200, fig2: 300 }, label: 'بلكس' }
};

// الطوابع. ground: ورق الصفحات، ورمل الكتل والفهارس، وحجري المباعة وخلفية الصور، وحبر العناوين، ونص القراءة، والخافت.
// accent لون الإبراز على الورق، وaccentDeep على الحقل العميق، وonDeep الكلام عليه. fields: لكل عائلة لون حقلها العميق (الصفحات
// الداكنة والغلاف الخلفي) ودرجتها الفاتحة (كتل فصل النماذج الثاني)، وقد تحمل إبرازها هي (الحضري: لون الإبراز من الصور)؛
// default حين لا عائلة. types أزواج خطوطه، وcovers غلافاه بالترتيب، وcoverTone أرضية الغلاف (deep: الاسم على الحقل العميق)،
// وphotos: bleed الصور من الحافة، framed لوحات بهوامش كمعرض؛ وpanel أرضية كتلة الكلام فوق الصورة الكاملة، وdark أقصى عدد
// للصفحات الداكنة غير الغلاف الخلفي، وopener: bold رقم الفصل درجة أكبر
export const MOODS = {
    'calm-luxury': {
        label: 'هدوء فاخر',
        angle: 'ورق عاجي، وصور مؤطرة كلوحات معرض، وعناوين رفيعة وأرقام كلاسيكية، واللون العميق لصفحتين وللغلاف الخلفي',
        ground: { paper: '#F5F1EA', sand: '#EAE3D9', stone: '#E1DAD0', ink: '#1E1A17', text: '#3B3531', muted: '#6A625A' },
        accent: '#7A5C30', accentDeep: '#D9C7AE', onDeep: '#F5EFE6',
        fields: {
            default: { deep: '#2E231C', pale: '#ECE4DA' },
            navy: { deep: '#22211F', pale: '#E6E4E0' },
            bronze: { deep: '#2E231C', pale: '#ECE4DA' },
            plum: { deep: '#2B2131', pale: '#E9E3EA' },
            teal: { deep: '#19302F', pale: '#E0E8E6' },
            forest: { deep: '#1F2B25', pale: '#E2E8E1' }
        },
        types: ['gallery', 'naskh'], covers: ['side', 'low'], coverTone: 'paper', photos: 'framed', panel: 'paper', dark: 2, opener: 'quiet'
    },
    'urban-bold': {
        label: 'حضري جريء',
        angle: 'غلاف داكن، وخط كوفي متين وأرقام طويلة، وأبيض وغرافيت ولون إبراز واحد من صور المشروع، وثلاث صفحات داكنة',
        ground: { paper: '#F3F4F4', sand: '#E5E7E8', stone: '#DADDDF', ink: '#0F1214', text: '#2A2F34', muted: '#58606A' },
        accent: '#AE461D', accentDeep: '#F2915F', onDeep: '#FFFFFF',
        fields: {
            default: { deep: '#191715', pale: '#ECE7E2' },
            teal: { deep: '#15191C', pale: '#DFE7EA', accent: '#17698A', accentDeep: '#74C7EA' },
            navy: { deep: '#15181D', pale: '#E0E5EC', accent: '#2459A0', accentDeep: '#8AB8F0' },
            bronze: { deep: '#191715', pale: '#ECE7E2' },
            forest: { deep: '#151A17', pale: '#E2E8E3', accent: '#4A6B1C', accentDeep: '#B9D873' },
            plum: { deep: '#19161C', pale: '#E8E3EC', accent: '#8B3F97', accentDeep: '#DDA2E6' }
        },
        types: ['kufi', 'monograph'], covers: ['full', 'side'], coverTone: 'deep', photos: 'bleed', panel: 'deep', dark: 3, opener: 'bold'
    },
    'coastal-light': {
        label: 'ساحلي مضيء',
        angle: 'أبيض بحري وهواء كثير، وخط واسع خفيف، والغلاف شريط بانورامي، وصفحة داكنة واحدة',
        ground: { paper: '#F6F7F5', sand: '#E4ECEA', stone: '#DCE3E1', ink: '#12282E', text: '#33464B', muted: '#55686D' },
        accent: '#24625F', accentDeep: '#9DD3C9', onDeep: '#F2F8F7',
        fields: {
            default: { deep: '#143B41', pale: '#DCE9E6' },
            teal: { deep: '#143B41', pale: '#DCE9E6' },
            navy: { deep: '#15304A', pale: '#DFE6EE' },
            forest: { deep: '#183A33', pale: '#DCE8E2' },
            bronze: { deep: '#173A40', pale: '#DDE9E7' },
            plum: { deep: '#252D44', pale: '#E2E3EC' }
        },
        types: ['air', 'monograph'], covers: ['low', 'full', 'side'], coverTone: 'paper', photos: 'bleed', panel: 'paper', dark: 1, opener: 'quiet'
    },
    'family-warm': {
        label: 'دفء عائلي',
        angle: 'ورق كريمي، وخط ليّن واضح، وأرقام كبيرة مقروءة بلون الطين، وصفحة داكنة واحدة',
        ground: { paper: '#F8F2E9', sand: '#F0E4D2', stone: '#E6DCCD', ink: '#2A2220', text: '#463A35', muted: '#6E605A' },
        accent: '#9A4A27', accentDeep: '#F2B08A', onDeep: '#FBF5EC',
        fields: {
            default: { deep: '#3D2A20', pale: '#F0E4D6' },
            navy: { deep: '#34302C', pale: '#ECE8E2' },
            bronze: { deep: '#3D2A20', pale: '#F0E4D6' },
            forest: { deep: '#2F3A28', pale: '#E5E9DA' },
            teal: { deep: '#22403E', pale: '#DEE8E4' },
            plum: { deep: '#3A2733', pale: '#EEE3E8' }
        },
        types: ['soft', 'air'], covers: ['side', 'low'], coverTone: 'paper', photos: 'bleed', panel: 'paper', dark: 1, opener: 'quiet'
    },
    'heritage-craft': {
        label: 'حِرفة وأصالة',
        angle: 'ورق رملي، وخط نسخي معاصر، ولون الطين المحروق للأرقام والإبراز، والواجهة غلافاً كاملاً',
        ground: { paper: '#F4EEE4', sand: '#EADDC9', stone: '#E1D6C6', ink: '#261C15', text: '#45382E', muted: '#6E5B4A' },
        accent: '#8F4427', accentDeep: '#E5A47E', onDeep: '#F7EFE4',
        fields: {
            default: { deep: '#3A2519', pale: '#EFE2D3' },
            bronze: { deep: '#3A2519', pale: '#EFE2D3' },
            navy: { deep: '#1F2A3D', pale: '#E2E5EC' },
            teal: { deep: '#1E3634', pale: '#DDE7E4' },
            forest: { deep: '#2A3120', pale: '#E6E8D8' },
            plum: { deep: '#321F27', pale: '#EEE2E5' }
        },
        types: ['naskh', 'gallery'], covers: ['full', 'side'], coverTone: 'paper', photos: 'bleed', panel: 'paper', dark: 2, opener: 'quiet'
    },
    'garden-serene': {
        label: 'طبيعة وهدوء',
        angle: 'ورق حجري مخضرّ، وأخضر عميق، وخط واسع خفيف، والصور من الحافة كبيرة',
        ground: { paper: '#F2F2EC', sand: '#E3E7DB', stone: '#DADFD2', ink: '#18241D', text: '#36433A', muted: '#5A6658' },
        accent: '#45663B', accentDeep: '#BCD6A6', onDeep: '#F1F4EC',
        fields: {
            default: { deep: '#1F3529', pale: '#E0E8DE' },
            forest: { deep: '#1F3529', pale: '#E0E8DE' },
            teal: { deep: '#1A3533', pale: '#DCE8E5' },
            navy: { deep: '#1D2E36', pale: '#DFE6E9' },
            bronze: { deep: '#2D3322', pale: '#E7E8D6' },
            plum: { deep: '#29272F', pale: '#E6E4E9' }
        },
        types: ['air', 'calm'], covers: ['low', 'side'], coverTone: 'paper', photos: 'bleed', panel: 'paper', dark: 2, opener: 'quiet'
    }
};
// ترتيب الطوابع عند التعادل: الأهدأ أولاً، فمشروع بلا علامة «هدوء فاخر»
const ORDER = ['calm-luxury', 'family-warm', 'garden-serene', 'coastal-light', 'urban-bold', 'heritage-craft'];

// كلمات كل طابع: جذور عربية بعد التطبيع (بلا تشكيل ولا كشيدة، والهمزات ألفاً أو ياء) تُطابق في أول الكلمة بعد «و، ف، ب، ك»
// و«ال»، وكلمات لاتينية في أول الكلمة
const WORDS = {
    'coastal-light': { ar: ['بحر', 'بحري', 'شاطي', 'ساحل', 'كورنيش', 'مارينا', 'مرسي', 'خليج', 'جزير', 'بحير', 'لاجون', 'موج', 'نسيم', 'يخت', 'مرفا'],
        la: ['beach', 'sea', 'bay', 'marina', 'coast', 'shore', 'lagoon', 'island', 'ocean', 'corniche', 'wave', 'pier', 'harbo', 'yacht', 'riviera', 'reef'] },
    'garden-serene': { ar: ['طبيع', 'حديق', 'حدايق', 'خضر', 'اخضر', 'نخيل', 'نخل', 'واحة', 'شجر', 'اشجار', 'بستان', 'بساتين', 'ريف', 'زهور', 'ازهار'],
        la: ['green', 'garden', 'park', 'nature', 'oasis', 'palm', 'grove', 'botanic', 'forest', 'leaf', 'meadow', 'valley'] },
    'urban-bold': { ar: ['سكاي', 'برج', 'ابراج', 'مستقبل', 'ذكي', 'حضري', 'عصري', 'سنتر', 'سيتي', 'بزنس', 'اعمال', 'مكاتب', 'ناطح', 'افق'],
        la: ['sky', 'tower', 'future', 'smart', 'urban', 'city', 'downtown', 'metro', 'loft', 'hub', 'business', 'central', 'avenue', 'boulevard', 'heights'] },
    'calm-luxury': { ar: ['فخام', 'فخم', 'فاخر', 'راقي', 'ارقي', 'رقي', 'رفاهي', 'رفاه', 'نخب', 'ريزيدنس', 'رزيدنس', 'ريزدنس', 'رزدنس', 'ريسيدنس', 'بنتهاوس', 'حصري', 'استثنايي', 'قصور'],
        la: ['luxury', 'luxe', 'premium', 'prestige', 'elite', 'residence', 'penthouse', 'exclusive', 'signature', 'grand', 'royal', 'palace', 'private', 'collection'] },
    'family-warm': { ar: ['عايل', 'اسرة', 'اسرت', 'اسري', 'اطفال', 'طفل', 'اولاد', 'ابناء', 'مدارس', 'مدرسة', 'العاب', 'جيران', 'مجتمع', 'دافي'],
        la: ['family', 'kids', 'community', 'neighbo', 'playground', 'school', 'nest'] },
    'heritage-craft': { ar: ['نقش', 'نقوش', 'تراث', 'اصال', 'اصيل', 'حرفة', 'حرفي', 'مشربي', 'روشان', 'رواشين', 'سدو', 'نجدي', 'حجازي', 'عريق', 'عراقة', 'درعية', 'زخرف', 'قصبة'],
        la: ['heritage', 'craft', 'artisan', 'legacy', 'mashrabiya', 'najdi', 'hijazi', 'diriyah'] }
};
// كلمات الهدوء تقوّي الطوابع الهادئة كلها معاً
const CALM = { ar: ['هدوء', 'هادي', 'سكين', 'اتزان', 'سكون', 'طمانين', 'استرخاء'], la: ['serene', 'calm', 'tranquil', 'quiet', 'peace'] };
const CALM_MOODS = ['calm-luxury', 'garden-serene', 'coastal-light'];
// أحياء على البحر (بأسمائها مطبّعة)
const COASTAL_PLACES = ['ابحر', 'الشاطي', 'الكورنيش', 'ذهبان', 'درة العروس', 'المرجان', 'نصف القمر'];
// فلل وبيوت أرضية في نوع الوحدات وأسمائها، أو عددٌ منها في نص المشروع («75 فلة سكنية»)
const HOUSES = /(فيلا|فيلل|فلل|فلة|فله|فيلة|تاون ?هاوس|دوبلكس|دوبليكس|قصر|villa|townhouse|duplex)/i;
const HOUSE_COUNT = /\d+\s*(?:فيلا|فيلات|فلل|فلة|فله|فيلة|تاون ?هاوس|دوبلكس)/;

export function norm(value) {
    return String(value ?? '').replace(/[ً-ْٰـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ئ/g, 'ي')
        .replace(/ؤ/g, 'و').toLowerCase();
}
const AR_LETTER = '\\u0621-\\u064A';
function matcher(list) {
    const ar = new RegExp('(?:^|[^' + AR_LETTER + '])(?:و|ف|ب|ك)?(?:ال|لل|ل)?(' + list.ar.join('|') + ')', 'g');
    const la = new RegExp('\\b(' + list.la.join('|') + ')', 'g');
    return (text) => {
        const t = norm(text), found = new Set();
        for (const m of t.matchAll(ar)) found.add(m[1]);
        for (const m of t.matchAll(la)) found.add(m[1]);
        return found;
    };
}
const MATCH = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, matcher(v)]));
const MATCH_CALM = matcher(CALM);

function median(list) {
    if (!list.length) return null;
    const s = list.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function pagesOf(spec) {
    return spec && Array.isArray(spec.pages) ? spec.pages : [];
}

// نصوص المشروع بأوزانها: هويته (الاسم بحرفيه ووصفه) ثم عناوين الصفحات ثم نصوصها
function sources(facts, spec) {
    const f = facts || {};
    const titles = [], bodies = [];
    for (const p of pagesOf(spec)) {
        const t = p && p.text;
        if (!t) continue;
        if (t.title) titles.push(t.title);
        if (t.subtitle) titles.push(t.subtitle);
        if (t.body) bodies.push(t.body);
        for (const b of Array.isArray(t.bullets) ? t.bullets : []) bodies.push(b);
    }
    for (const x of [...(Array.isArray(f.amenities) ? f.amenities : []), ...(Array.isArray(f.landmarks) ? f.landmarks : [])]) bodies.push(x);
    if (f.description) bodies.push(f.description);
    return { identity: [f.name, f.nameLatin, f.tagline].filter(Boolean), titles, bodies };
}

// عائلة لون صور البروشور: المعطاة، وإلا ما في الحقائق (brochureFacts)، والعائلة غير المعروفة لا شيء
function familyOf(input) {
    const raw = input && input.family !== undefined ? input.family : input && input.facts ? input.facts.family : null;
    return FAMILIES.includes(raw) ? raw : null;
}

// درجات الطوابع ← { scores: { mood: درجة }, why: { mood: [سبب] } }. input: { facts (brochureFacts)، spec (مخطط الصفحات)، family }
export function moodScores(input) {
    const { facts, spec } = input || {};
    const family = familyOf(input);
    const f = facts || {};
    const scores = Object.fromEntries(ORDER.map((k) => [k, 0]));
    const why = Object.fromEntries(ORDER.map((k) => [k, []]));
    const add = (mood, n, reason) => { if (!n) return; scores[mood] += n; if (reason && !why[mood].includes(reason)) why[mood].push(reason); };
    const src = sources(f, spec);

    // الكلمات: كل جذر مرة في كل طبقة، بحد لكل طبقة
    const layer = (texts, weight, cap, label) => {
        for (const mood of ORDER) {
            const hits = new Set();
            for (const t of texts) for (const w of MATCH[mood](t)) hits.add(w);
            add(mood, Math.min(cap, hits.size * weight), hits.size ? label + ' «' + [...hits].slice(0, 2).join('، ') + '»' : null);
        }
        const calm = new Set();
        for (const t of texts) for (const w of MATCH_CALM(t)) calm.add(w);
        if (calm.size) for (const mood of CALM_MOODS) add(mood, Math.min(cap, calm.size * weight) / 2, label + ' هادئ');
    };
    layer(src.identity, 4, 8, 'الاسم والوصف');
    layer(src.titles, 0.75, 1.5, 'العناوين');
    layer(src.bodies, 0.4, 1.2, 'النص');

    // الحي على البحر
    const place = norm([f.district, f.city, f.address].filter(Boolean).join(' '));
    if (COASTAL_PLACES.some((p) => place.includes(p))) add('coastal-light', 1.5, 'حي على البحر');

    // السعر للمتر من النماذج المتاحة، ونوع الوحدات وحجمها
    const models = Array.isArray(f.models) ? f.models.filter((m) => m && typeof m === 'object') : [];
    const ppsm = median(models.filter((m) => m.price && m.area && !m.sold).map((m) => m.price / m.area))
        ?? (f.price && f.area ? f.price / f.area : null);
    if (ppsm !== null) {
        if (ppsm >= 8000) add('calm-luxury', 2, 'سعر المتر مرتفع');
        else if (ppsm >= 6000) add('calm-luxury', 1, 'سعر المتر مرتفع');
        else if (ppsm <= 3800) { add('family-warm', 1.5, 'سعر المتر في متناول الأسر'); add('calm-luxury', -0.5); }
        else if (ppsm <= 4500) add('family-warm', 0.5, 'سعر المتر في متناول الأسر');
    }
    const top = Math.max(0, ...models.map((m) => m.price || 0));
    if (top >= 2500000) add('calm-luxury', 1, 'وحدات بأسعار عالية');
    if (models.some((m) => (m.rooms && m.rooms >= 5) || (m.area && m.area >= 250))) add('family-warm', 1, 'وحدات كبيرة للأسر');
    const kinds = [f.type, ...models.map((m) => [m.type, m.name].filter(Boolean).join(' '))].filter(Boolean).join(' ');
    if (HOUSES.test(kinds) || src.bodies.some((b) => HOUSE_COUNT.test(String(b)))) { add('family-warm', 1, 'فلل'); add('calm-luxury', 0.5); }

    // الصور: عائلة لونها، وكثرة الداخلية
    const images = Array.isArray(f.images) ? f.images.filter(Boolean) : [];
    const inside = images.filter((i) => i.kind === 'interior').length;
    const photos = images.filter((i) => !['map', 'plan', 'plan3d', 'logo'].includes(i.kind)).length;
    if (inside >= 5 && inside / Math.max(1, photos) >= 0.4) add('calm-luxury', 1, 'صور داخلية كثيرة');
    const TONE = {
        bronze: { 'calm-luxury': 0.5, 'family-warm': 0.5, 'heritage-craft': 0.75 },
        navy: { 'urban-bold': 0.75, 'coastal-light': 0.5 },
        teal: { 'coastal-light': 1, 'garden-serene': 0.25 },
        forest: { 'garden-serene': 1.5 },
        plum: { 'calm-luxury': 1 }
    };
    for (const [mood, n] of Object.entries(TONE[family] || {})) add(mood, n, 'ألوان الصور');
    return { scores, why };
}

// الطوابع مرتبة: الأعلى درجة، والتعادل بترتيب ORDER
export function rankMoods(input) {
    const { scores } = moodScores(input);
    return ORDER.slice().sort((a, b) => scores[b] - scores[a] || ORDER.indexOf(a) - ORDER.indexOf(b));
}

// 1cqw من عرض الصفحة = 8.42 نقطة مطبوعة؛ صورة تملأ إطاراً w × h (بـ cqw) بدقتها ← نقطة لكل بوصة
const PT_PER_CQW = 841.89 / 100, SOFT_DPI = 135;
export function dpiIn(it, w, h) {
    if (!it || !it.w || !it.h) return Infinity;
    return Math.min(it.w, it.h * (w / h)) / (w * PT_PER_CQW / 72);
}
// غلاف بصورته: side حتى خط القسمة (56 × 56.25) لأي صورة إلا البانورامية (تفقد أكثر من نصف عرضها)، وlow شريط بعرض الصفحة
// (100 × 34) لصورة عريضة، وfull الصفحة كلها لصورة أفقية تحمل بكسلاتها الصفحة؛ وtype بلا صورة
export function coverFits(it, variant) {
    if (!it) return variant === 'type';
    const ratio = it.w && it.h ? it.w / it.h : it.wide ? 2.5 : 1.5;
    if (variant === 'side') return ratio < 2.2;
    if (variant === 'low') return ratio >= 1.45 && dpiIn(it, 100, 34) >= SOFT_DPI;
    if (variant === 'full') return ratio >= 1.2 && dpiIn(it, 100, 56.25) >= SOFT_DPI;
    return false;
}

// صورة الغلاف من المخطط (أول صورة في الصفحة الأولى)، أو null لغلاف بلا صورة
function coverImage(facts, spec) {
    const first = pagesOf(spec)[0];
    if (!first || first.variant === 'type' || !Array.isArray(first.images) || !first.images.length) return null;
    const images = facts && Array.isArray(facts.images) ? facts.images : [];
    return images[first.images[0]] || null;
}

// الوعد الرئيسي من القراءة نفسها: شعار المشروع، وإلا سطر غلافه، وإلا أول عنوان قالَه المطوّر في صفحة كلام أو صورة (لا اسم قسم
// مثل «المقدمة» و«عن الرمز» و«مميزات المشروع»)، وإلا اسمه. لا يُطبع من هنا شيء: الوعد مطبوع حيث طبعه المطوّر، وهذا سطر للموظف
const SECTION = /^(?:ال)?(?:مقدمه|مقدمة|محتويات|فهرس|نبذه|نبذة|مشروع|موقع|مميزات|ميزات|ضمانات|نماذج|تواصل)|^(?:عن|من)\s/;
function promiseOf(facts, spec) {
    const f = facts || {};
    const pages = pagesOf(spec);
    const sub = pages[0] && pages[0].text && pages[0].text.subtitle;
    const said = pages.find((p) => p && ['about', 'statement', 'photo'].includes(p.kind) && p.text && p.text.title && !SECTION.test(norm(p.text.title).trim()));
    return f.tagline || sub || (said ? said.text.title : null) || f.name || null;
}

function make(mood, k, family, cover) {
    const m = MOODS[mood];
    const field = (family && m.fields[family]) || m.fields.default;
    const name = m.types[k % m.types.length];
    const covers = k ? [...m.covers.slice(1), m.covers[0]] : m.covers;
    // غلاف الطابع إن حملته صورته، وإلا أي غلاف تحمله؛ وبانورامية أصغر من كل غلاف تبقى شريطاً (لا يصل إلى هنا غيرها): الشريط
    // يُظهر عرضها كله وبدقة أعلى، وحتى خط القسمة يقصّ أكثر من نصف عرضها
    const fit = cover ? [...covers, 'low', 'side', 'full'].find((v) => coverFits(cover, v)) || 'low' : 'type';
    return {
        mood, label: m.label, angle: m.angle, family: family || null,
        palette: { ...m.ground, accent: field.accent || m.accent, accentDeep: field.accentDeep || m.accentDeep, onDeep: m.onDeep, deep: field.deep, pale: field.pale },
        type: { name, ...PAIRINGS[name], text: TEXT_FONT },
        rhythm: { cover: fit, coverTone: m.coverTone, photos: m.photos, panel: m.panel, dark: m.dark, opener: m.opener }
    };
}

// الاتجاه الفني للبروشور. input: { facts (brochureFacts)، spec (مخطط الصفحات)، family (عائلة لون صوره، وإلا facts.family) }؛
// variation: رقم «تصميم آخر» (0 للأول). ← { mood, label, angle, family, palette, type, rhythm, idea, why, at, of }
// البدائل بالترتيب: الطابع الأول بخطه وغلافه، ثم بخطه وغلافه الآخرين، ثم الطابع الثاني ثم الثالث، ثم يعود
export function artDirection(input, variation) {
    const { facts, spec } = input || {};
    const family = familyOf(input);
    const ranked = rankMoods(input);
    const { why } = moodScores(input);
    const list = [[ranked[0], 0], [ranked[0], 1], [ranked[1], 0], [ranked[2], 0]];
    const v = Number.isInteger(Number(variation)) ? Number(variation) : 0;
    const at = ((v % list.length) + list.length) % list.length;
    const [mood, k] = list[at];
    const d = make(mood, k, family, coverImage(facts, spec));
    return { ...d, idea: { promise: promiseOf(facts, spec), angle: d.angle }, why: why[mood].slice(0, 4), at, of: list.length };
}

function hexA(hex, a) {
    const v = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((v >> 16) & 255) + ', ' + ((v >> 8) & 255) + ', ' + (v & 255) + ', ' + a + ')';
}

// خصائص CSS للبروشور على كل صفحة (فتحملها نسخة الطباعة): ألوان اللوحة بأسماء --p-* (brochure.css يسمّيها للورق وللسياق
// الداكن)، والحقل العميق ودرجته، وخطا الزوج ومقاس عناوينه وأوزانه. القيم كلها من المجموعات أعلاه، لا من الملف
export function directionStyle(d) {
    const p = d.palette, t = d.type;
    const stack = (...names) => names.filter(Boolean).map((n) => "'" + n + "'").join(', ') + ', Tahoma, sans-serif';
    return [
        '--p-paper:' + p.paper, '--p-sand:' + p.sand, '--p-stone:' + p.stone,
        '--p-ink:' + p.ink, '--p-text:' + p.text, '--p-muted:' + p.muted, '--p-hair:' + hexA(p.ink, 0.17),
        '--p-accent:' + p.accent, '--p-accent-d:' + p.accentDeep,
        '--p-on:' + p.onDeep, '--p-on-text:' + hexA(p.onDeep, 0.86), '--p-on-muted:' + hexA(p.onDeep, 0.7), '--p-on-hair:' + hexA(p.onDeep, 0.24),
        '--deep:' + p.deep, '--pale:' + p.pale,
        '--display:' + stack(t.figures, t.display, t.display === TEXT_FONT ? null : TEXT_FONT),
        '--plex:' + stack(TEXT_FONT),
        '--dk:' + t.k, '--dl:' + Math.round(1000 / t.k) / 1000,
        '--w-title:' + t.w.title, '--w-head:' + t.w.head, '--w-fig:' + t.w.fig, '--w-fig2:' + t.w.fig2
    ].join(';');
}

// سطر الإخراج للموظف في الاستوديو: «إخراج «طبيعة وهدوء» · خط ريدكس — 1 من 4»
export function directionLabel(d) {
    return 'إخراج «' + d.label + '» · خط ' + d.type.label + ' — ' + (d.at + 1) + ' من ' + d.of;
}

// كل خطوط الأزواج كما يستوردها brochure.css: العربية بأوزانها، واللاتينية لأرقامها
export function fontFamilies() {
    const arabic = new Map(), latin = new Map();
    for (const t of Object.values(PAIRINGS)) {
        const add = (map, name, ws) => map.set(name, new Set([...(map.get(name) || []), ...ws]));
        add(arabic, t.display, [t.w.title, t.w.head, t.w.fig, t.w.fig2]);
        if (t.figures) add(latin, t.figures, [t.w.title, t.w.head, t.w.fig, t.w.fig2]);
    }
    return { arabic, latin };
}
