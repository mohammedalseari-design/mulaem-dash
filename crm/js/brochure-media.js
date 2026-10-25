// صور بروشور المطوّر بعد استخراجها من الـPDF: اتجاهها، ونوعها التقريبي (مخطط أو صورة أو فارغة)، وبصمة التكرار —
// حساب على أرقام البكسل فقط، بلا DOM وبلا شبكة، فيُختبر وحده. brochure-pdf.js يستخرج الصور ويمرّرها إلى هنا.
//
// النوع هنا تقدير أولي يصححه المدير في شاشة المراجعة، ثم قراءة الذكاء الاصطناعي: المخطط خطوط رفيعة على خلفية بيضاء أو
// شفافة بلا ألوان تقريباً، والصورة الفارغة لون واحد (مستطيل أسود في بروشور لامير سيرين مثلاً).

// مصفوفة الرسم [a b c d e f] في فضاء الـPDF (المحور y للأعلى) لصورة w×h ← { width, height, matrix } لـ setTransform ثم
// drawImage(src, 0, 0, w, h): الصورة كما تظهر في الصفحة، يمينها وأسفلها على الشاشة مقرّبان إلى المحاور. المخطط في بروشور
// لامير سيرين مخزّن على جنبه وتديره الصفحة 90°. والدوران على الشاشة (y للأسفل) عكس دورانه في فضاء الـPDF: الحساب الأول
// أداره بإشارة الـPDF فخرجت المخططات مقلوبة رأساً على عقب
export function uprightMatrix(m, w, h) {
    const [a, b, c, d] = m || [1, 0, 0, 1];
    const axis = (x, y) => (Math.abs(x) >= Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)]);
    let right = axis(a, -b), down = axis(-c, d);
    // محور مفقود أو محوران متوازيان (مصفوفة منحرفة): الصورة كما هي
    if (!(right[0] || right[1]) || !(down[0] || down[1]) || (right[0] !== 0) === (down[0] !== 0)) { right = [1, 0]; down = [0, 1]; }
    const e = (right[0] < 0 ? w : 0) + (down[0] < 0 ? h : 0);
    const f = (right[1] < 0 ? w : 0) + (down[1] < 0 ? h : 0);
    return { width: right[0] ? w : h, height: right[0] ? h : w, matrix: [right[0], right[1], down[0], down[1], e, f] };
}

// دوران الصفحة نفسها (/Rotate، مع عقارب الساعة عند العرض) مصفوفةً في فضاء الـPDF: منها تبدأ مصفوفات الرسم في الصفحة
export function pageRotation(deg) {
    const r = ((Math.round((deg || 0) / 90) % 4) + 4) % 4;
    return [[1, 0, 0, 1, 0, 0], [0, -1, 1, 0, 0, 0], [-1, 0, 0, -1, 0, 0], [0, 1, -1, 0, 0, 0]][r];
}

export function multiply(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
        a2 * a1 + b2 * c1, a2 * b1 + b2 * d1,
        c2 * a1 + d2 * c1, c2 * b1 + d2 * d1,
        e2 * a1 + f2 * c1 + e1, e2 * b1 + f2 * d1 + f1
    ];
}

// بكسلات RGBA (Uint8ClampedArray) لصورة مصغّرة ← { kind: 'plan' | 'photo' | 'blank', tone, alpha }
//   plan: الخلفية (بيضاء أو شفافة) أغلب الصورة والألوان شبه معدومة؛ tone: light للخطوط الفاتحة على شفاف (تُعرض على داكن)،
//         وdark للخطوط الداكنة (تُعرض على ورق)
//   blank: تباين ضئيل جداً، فلا تُعرض
export function classifyPixels(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return { kind: 'blank', tone: 'dark', alpha: false };
    let clear = 0, white = 0, satSum = 0, opaque = 0, lumSum = 0, lumSq = 0, lumOpaque = 0;
    for (let i = 0; i < n; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        lumSum += lum; lumSq += lum * lum;
        if (a < 24) { clear++; continue; }
        opaque++;
        lumOpaque += lum;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        satSum += max ? (max - min) / max : 0;
        if (r > 232 && g > 232 && b > 232) white++;
    }
    const mean = lumSum / n;
    const spread = Math.sqrt(Math.max(0, lumSq / n - mean * mean));
    const alpha = clear / n > 0.05;
    if (!alpha && spread < 0.025) return { kind: 'blank', tone: 'dark', alpha };
    if (alpha && opaque / n < 0.003) return { kind: 'blank', tone: 'dark', alpha };
    const background = (clear + white) / n;
    const saturation = opaque ? satSum / opaque : 0;
    if (background > 0.62 && saturation < 0.16) {
        // على شفاف: لون الخطوط نفسها؛ على أبيض: الخطوط داكنة
        const tone = alpha && opaque && lumOpaque / opaque > 0.62 ? 'light' : 'dark';
        return { kind: 'plan', tone, alpha };
    }
    return { kind: 'photo', tone: 'dark', alpha };
}

// بصمة تكرار: تدرّج رمادي 8×8 (64 بكسل) → سلسلة بتات حول المتوسط. الصورة نفسها بمقاس آخر أو بضغط آخر تعطي البصمة نفسها
// تقريباً، ويُعدّ التطابق إن اختلف 4 بتات على الأكثر
export function fingerprint(gray64) {
    const values = Array.from(gray64 || []);
    if (values.length !== 64) return '';
    const mean = values.reduce((s, v) => s + v, 0) / 64;
    return values.map((v) => (v > mean ? '1' : '0')).join('');
}

export function sameImage(f1, f2) {
    if (!f1 || !f2 || f1.length !== f2.length) return false;
    let diff = 0;
    for (let i = 0; i < f1.length; i++) if (f1[i] !== f2[i] && ++diff > 4) return false;
    return true;
}

// مفتاح البكسلات نفسها (FNV-1a على القيم مقرّبة): الصورة نفسها مرسومة في صفحتين أو مرتين في صفحة تعطي المفتاح نفسه
export function pixelKey(data) {
    let h = 0x811c9dc5;
    for (let i = 0; i < (data ? data.length : 0); i++) {
        h ^= data[i] >> 2;
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

// { kind, key, print } مكرر لآخر: البكسلات نفسها لأي صورة، والبصمة المتقاربة للصور وحدها. المخططات خطوط على خلفية واحدة
// فتتقارب بصماتها وهي مختلفة، والخطوط الفاتحة على شفاف تعطي كلها البصمة نفسها (بروشور لامير: ضاعت مخططاته إلا ثلاثة)
export function duplicate(a, b) {
    if (a.key && a.key === b.key) return true;
    return a.kind === 'photo' && b.kind === 'photo' && sameImage(a.print, b.print);
}

// الصورة تستحق الاستخراج: ضلعها الأصغر من minSide فأكثر (الأيقونات والشعارات الصغيرة تُترك)
export function worthKeeping(width, height, minSide = 500) {
    return Math.min(width, height) >= minSide;
}
