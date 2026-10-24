// «قد يكون تحديثاً لـ#N»: المشروع القائم الذي قد يكون منشور واتساب تحديثاً له، قبل الإرسال للمساعد — بلا DOM وبلا شبكة،
// فيُختبر وحده.
//
// المساعد لا يعرف المشروع إلا بعد الاستخراج، وبالاسم بعد التطبيع (agent_find_duplicates، 027): «زود 102» و«مشروع الربوة
// ١٠٢» لا يطابقان «زود الربوة 102» فيصيران مسودة مشروع جديد مكررة، و«أوس 102» يطابق «أوس 102» تماماً فيتوقف بلا مسودة.
// هنا قائمة مختصرة يبنيها الكود من نص المنشور وحده:
//   - رقم المشروع: الأرقام في اسمه (2–4 خانات) كلها بين أرقام المنشور، بعد حذف أرقام الجوال؛
//   - كلمات الاسم: كلمات اسمه في المنشور، بلا «مشروع/برج/مجمع…» وبلا ألفاظ العقار العامة («فيلا»، «شقة»…) وبلا «ال»؛
//   - الحي: حي المشروع مذكور في المنشور.
// ويُقترح المشروع حين يجتمع رقمه مع كلمة من اسمه أو مع حيّه، أو حين تحضر كلمات اسمه كلها وهي كلمتان فأكثر. الرقم وحده لا
// يكفي (المساحة «102 م» رقم أيضاً، ومشاريع المطوّر الواحد تتشارك الأرقام)، ولا كلمة واحدة وحدها («زود» في كل مشاريعه).
// والسعر لا يُستعمل: «يبدأ من» يختلف بين منشورات المشروع نفسه.
// للعرض فقط: لا يُرسل شيء تلقائياً، والمدير يختار «أرسله تحديثاً لـ#N» أو يتركه مشروعاً جديداً.

import { withoutPhones } from './whatsapp-twins.js';

// كما يحذفها agent_norm_name (020) من الاسم، ومعها ألفاظ العقار العامة التي في الأسماء الوصفية («فيلا – حي السامر – 650م»)
const FILLER = new Set(['مشروع', 'مشاريع', 'ابراج', 'برج', 'مجمع', 'سكني', 'عماره', 'عمائر',
    'فيلا', 'فلل', 'فله', 'شقه', 'شقق', 'دور', 'ادوار', 'دوبلكس', 'تاون', 'هاوس', 'روف', 'ارض', 'قطعه', 'محل', 'مكتب',
    'حي', 'بحي', 'في', 'جده', 'للبيع', 'للايجار', 'بيع', 'ايجار', 'تمليك', 'من', 'مع']);

function tokens(text) {
    return String(text ?? '').toLowerCase()
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ؤ]/g, 'و').replace(/[ئ]/g, 'ي')
        .replace(/[ً-ْـ]/g, '')
        .split(/[^a-z0-9ء-ي]+/).filter(Boolean)
        .map((t) => (t.length > 3 && /^(ال|بال|وال)/.test(t) ? t.replace(/^(ال|بال|وال)/, '') : t));
}

// صفوف المشاريع ({ id, name, district }) ← مفاتيح المطابقة، مرة واحدة للصفحة
export function prepareProjects(rows) {
    return (rows || []).filter((r) => r && r.id !== undefined && r.id !== null && r.name).map((r) => {
        const parts = tokens(r.name);
        return {
            id: String(r.id), name: String(r.name), district: r.district || '',
            codes: parts.filter((t) => /^\d{2,4}$/.test(t)),
            words: [...new Set(parts.filter((t) => !/\d/.test(t) && t.length >= 2 && !FILLER.has(t)))],
            place: tokens(r.district).filter((t) => !FILLER.has(t))
        };
    });
}

// نص المنشور ← حتى limit مشروع: [{ id, name, district, strong, reason }] من الأقوى. strong: الرقم وكل كلمات الاسم معاً
export function suggestProjects(text, projects, limit = 3) {
    const post = tokens(withoutPhones(text));
    if (!post.length || !projects || !projects.length) return [];
    const words = new Set(post);
    const out = [];
    for (const p of projects) {
        const code = p.codes.length > 0 && p.codes.every((c) => words.has(c));
        const hits = p.words.filter((w) => words.has(w)).length;
        const whole = p.words.length > 0 && hits === p.words.length;
        const place = p.place.length > 0 && p.place.every((w) => words.has(w));
        let reason = null;
        if (code && hits) reason = whole ? 'الاسم ورقم المشروع' : 'رقم المشروع وجزء من الاسم';
        else if (code && place) reason = 'رقم المشروع والحي';
        else if (whole && p.words.length >= 2) reason = place ? 'الاسم والحي' : 'الاسم';
        if (!reason) continue;
        const score = (code ? 3 : 0) + 3 * (p.words.length ? hits / p.words.length : 0) + (place ? 1 : 0);
        out.push({ id: p.id, name: p.name, district: p.district, strong: code && whole, reason, score });
    }
    out.sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
    return out.slice(0, limit).map(({ score, ...rest }) => rest);
}
