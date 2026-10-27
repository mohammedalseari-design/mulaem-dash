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

// بكسلات RGBA (Uint8ClampedArray) لصورة مصغّرة ← { kind: 'plan' | 'photo' | 'backdrop' | 'blank', tone, alpha, detail }
//   plan: رسم خطي — خطوط رفيعة على شفاف بأي لون (خطوط القياس الحمراء وأرقام الدرج الخضراء في مخططات «نقش»: أغلب بكسلاته
//         المعتمة على حافة الشفاف)، أو على خلفية بيضاء بلا ألوان تقريباً؛ tone: light للخطوط الفاتحة (تُعرض على داكن)،
//         وdark للخطوط الداكنة (تُعرض على ورق)
//   backdrop: طبقة لونية أو تدرّج شفاف أو ظل ناعم أو صورة تحت غشاء لون (خلفيات المطوّر: لا حافة حادة واحدة بين بكسلين
//         معتمين في المصغّرة كلها)، فلا تُطبع صورةً ولا تُستعار ولا تصوّت للون البروشور
//   blank: تباين ضئيل جداً، فلا تُعرض
//   detail: نسبة الحواف الحادة (0–1)، لقوة اللقطة
export function classifyPixels(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return { kind: 'blank', tone: 'dark', alpha: false, detail: 0 };
    let clear = 0, white = 0, satSum = 0, opaque = 0, lumSum = 0, lumSq = 0, lumOpaque = 0;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        L[i] = lum;
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
    if (!alpha && spread < 0.025) return { kind: 'blank', tone: 'dark', alpha, detail: 0 };
    if (alpha && opaque / n < 0.003) return { kind: 'blank', tone: 'dark', alpha, detail: 0 };
    // الحواف الحادة بين بكسلين معتمين متجاورين، والبكسلات المعتمة التي على حافة الشفاف (خطوط الرسم)
    const solid = (i) => data[i * 4 + 3] >= 24;
    let pairs = 0, sharp = 0, rim = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (!solid(i)) continue;
            if (x + 1 < width && y + 1 < height && solid(i + 1) && solid(i + width)) {
                pairs++;
                if (Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + width] - L[i]) > 0.2) sharp++;
            }
            if (alpha && ((x > 0 && !solid(i - 1)) || (x + 1 < width && !solid(i + 1)) || (y > 0 && !solid(i - width)) || (y + 1 < height && !solid(i + width)))) rim++;
        }
    }
    const detail = pairs ? sharp / pairs : 0;
    const lightLines = opaque && lumOpaque / opaque > 0.62;
    if (alpha && clear / n > 0.3 && opaque && rim / opaque > 0.35) return { kind: 'plan', tone: lightLines ? 'light' : 'dark', alpha, detail };
    if (pairs && detail < 0.004) return { kind: 'backdrop', tone: 'dark', alpha, detail };
    const background = (clear + white) / n;
    const saturation = opaque ? satSum / opaque : 0;
    if (background > 0.62 && saturation < 0.16) return { kind: 'plan', tone: alpha && lightLines ? 'light' : 'dark', alpha, detail };
    return { kind: 'photo', tone: 'dark', alpha, detail };
}

// لون الخلفية الغالب على حواف الصورة (حلقة بعرض 2% حولها) وتجانسه ← { r, g, b, lum, even } أو null للشفافة
// even: الحلقة لون واحد (ورقة أو لوح بلون واحد تحت الرسم أو الصور)
export function borderColour(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return null;
    const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
    let r = 0, g = 0, b = 0, k = 0, clear = 0;
    const lums = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
            const i = (y * width + x) * 4;
            if (data[i + 3] < 24) { clear++; continue; }
            r += data[i]; g += data[i + 1]; b += data[i + 2]; k++;
            lums.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255);
        }
    }
    if (!k || clear > k) return null;
    r /= k; g /= k; b /= k;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const near = lums.filter((l) => Math.abs(l - lum) < 0.06).length / lums.length;
    return { r, g, b, lum, even: near > 0.9 };
}

// ما في الصورة فعلاً: مستطيل البكسلات المعتمة (على شفاف) أو المختلفة عن خلفية حوافها الموحّدة ← [x0, y0, x1, y1] نسباً،
// أو null إن ملأت الصورة (خلفية المطوّر الشفافة حول مخطط صغير: مخطط «الصفا 3» نحو 7% من لوحته)
export function contentBox(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return null;
    let clear = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 24) clear++;
    const alpha = clear / n > 0.05;
    const bg = alpha ? null : borderColour(data, width, height);
    if (!alpha && !(bg && bg.even)) return null;
    const on = (i) => alpha ? data[i * 4 + 3] >= 24
        : Math.abs(data[i * 4] - bg.r) + Math.abs(data[i * 4 + 1] - bg.g) + Math.abs(data[i * 4 + 2] - bg.b) > 45;
    let x0 = width, y0 = height, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (on(y * width + x)) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (count < n * 0.002 || x1 < x0) return null;
    const box = [x0 / width, y0 / height, (x1 + 1) / width, (y1 + 1) / height];
    if ((box[2] - box[0]) * (box[3] - box[1]) > 0.85) return null;
    const pad = 0.01;
    return [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(1, box[2] + pad), Math.min(1, box[3] + pad)].map((v) => Math.round(v * 1000) / 1000);
}

// لوحة صور المطوّر: صورتان فأكثر بإطاراتها على شفاف أو على لون واحد في ملف واحد («الصفا 3»: كل صفحة معرض ملف PNG فيه
// صورتان مؤطرتان بظلّهما). تُقسم بالفراغات بينها صفوفاً ثم أعمدة؛ كل جزء مستطيل ممتلئ (85% فأكثر) من الصورة، والأجزاء تحمل
// أغلب ما فيها. ← [[x0, y0, x1, y1], ...] نسباً مقصوصة 3% من كل جزء (زواياه المدوّرة وحافته)، أو null لصورة واحدة
export function photoBlocks(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 24 || height < 24) return null;
    let clear = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 24) clear++;
    const alpha = clear / n > 0.05;
    const bg = alpha ? null : borderColour(data, width, height);
    if (!alpha && !(bg && bg.even)) return null;
    const solid = new Uint8Array(n);
    let mass = 0;
    for (let i = 0; i < n; i++) {
        const on = alpha ? data[i * 4 + 3] >= 200
            : Math.abs(data[i * 4] - bg.r) + Math.abs(data[i * 4 + 1] - bg.g) + Math.abs(data[i * 4 + 2] - bg.b) > 60;
        if (on) { solid[i] = 1; mass++; }
    }
    if (mass < n * 0.05) return null;
    const leaves = [];
    const split = (x0, y0, x1, y1, depth) => {
        // حدود ما في المستطيل
        const rows = new Uint32Array(y1 - y0), cols = new Uint32Array(x1 - x0);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (solid[y * width + x]) { rows[y - y0]++; cols[x - x0]++; }
        const lineMin = (len) => Math.max(1, len * 0.02);
        let a = 0, b = rows.length; while (a < b && rows[a] < lineMin(x1 - x0)) a++; while (b > a && rows[b - 1] < lineMin(x1 - x0)) b--;
        let c = 0, d = cols.length; while (c < d && cols[c] < lineMin(y1 - y0)) c++; while (d > c && cols[d - 1] < lineMin(y1 - y0)) d--;
        if (a >= b || c >= d) return;
        const Y0 = y0 + a, Y1 = y0 + b, X0 = x0 + c, X1 = x0 + d;
        // أعرض فراغ داخلي: صفوف (أو أعمدة) شبه خالية بطول 2% من الصورة فأكثر
        const gapIn = (prof, from, to, cross, size) => {
            let best = null, start = -1;
            for (let k = from; k <= to; k++) {
                const empty = k < to && prof[k] < Math.max(1, cross * 0.01);
                if (empty) { if (start < 0) start = k; } else if (start >= 0) { if (k - start >= size * 0.02 && (!best || k - start > best[1] - best[0])) best = [start, k]; start = -1; }
            }
            return best;
        };
        const gy = depth < 4 ? gapIn(rows, a, b, x1 - x0, height) : null;
        const gx = depth < 4 ? gapIn(cols, c, d, y1 - y0, width) : null;
        if (gy && (!gx || gy[1] - gy[0] >= gx[1] - gx[0])) { split(X0, Y0, X1, y0 + gy[0], depth + 1); split(X0, y0 + gy[1], X1, Y1, depth + 1); return; }
        if (gx) { split(X0, Y0, x0 + gx[0], Y1, depth + 1); split(x0 + gx[1], Y0, X1, Y1, depth + 1); return; }
        let filled = 0;
        for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) filled += solid[y * width + x];
        leaves.push({ x0: X0, y0: Y0, x1: X1, y1: Y1, filled, area: (X1 - X0) * (Y1 - Y0) });
    };
    split(0, 0, width, height, 0);
    const photos = leaves.filter((k) => k.area >= n * 0.03 && k.filled >= k.area * 0.85);
    if (photos.length < 2 || photos.reduce((s, k) => s + k.filled, 0) < mass * 0.85) return null;
    return photos.map((k) => {
        const ix = (k.x1 - k.x0) * 0.03, iy = (k.y1 - k.y0) * 0.03;
        return [(k.x0 + ix) / width, (k.y0 + iy) / height, (k.x1 - ix) / width, (k.y1 - iy) / height].map((v) => Math.round(v * 1000) / 1000);
    });
}

// نقطة ثقل الصورة (أين تفاصيلها) ← [fx, fy] نسباً: مركز طاقة الحواف، بلا السماء الهادئة فوقها. يحدد موضع القصّ حين يملأ
// إطارٌ بنسبة أخرى الصورة (object-position)، فتُقصّ السماء الفارغة قبل الموضوع (السيارة التي ثبّت بها المطوّر مشهد الشارع)
export function focusOf(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 4 || height < 4) return null;
    const lum = (i) => (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const i = y * width + x;
            if (data[i * 4 + 3] < 24) continue;
            const e = Math.abs(lum(i + 1) - lum(i)) + Math.abs(lum(i + width) - lum(i));
            if (e < 0.04) continue;
            sx += e * (x + 0.5); sy += e * (y + 0.5); sw += e;
        }
    }
    if (!sw) return null;
    return [Math.round((sx / sw / width) * 100) / 100, Math.round((sy / sw / height) * 100) / 100];
}

// لون الصورة العميق ← عائلة لونية للبروشور: البروشور يلبس ألوان مشروعه لا ألوان ملائم وحدها (المالك 2026-10-25: «مو لازم
// أزرق غامق… لا تكون مقيد بألوان ملائم»). يُوزن كل بكسل معتم متوسط الإضاءة بتشبّعه وعمقه، فتغلب الخضرة والخشب والحجر على
// الإسفلت والسماء البيضاء، ويؤخذ متوسط درجة اللون دائرياً. لون واحد واضح يغطي 5% من الصورة فأكثر ← عائلته (forest للخضرة،
// teal للماء، bronze للخشب والحجر الدافئ والغروب، plum للبنفسجي، navy للأزرق)؛ وصورة رمادية أو باهتة أو ألوانها متفرقة ← null.
// العائلة اسم من قائمة ثابتة لا لون حر، فالألوان نفسها مختارة سلفاً (PALETTES في brochure-plan.js) ولا تأتي من الملف
// والسماء لا تصوّت: الأزرق الفاتح في أعلى الصورة (45% منها) سماءُ كل واجهة، لا لون المشروع («نقش»: سماء خمس واجهات
// صوّتت كحلياً على هوية خضراء). سماء الليل الداكنة تبقى (صورة الغلاف الليلية لونها)
export function deepTone(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return null;
    let x = 0, y = 0, weight = 0;
    for (let i = 0; i < n; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
        if (a < 200) continue;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum < 0.06 || lum > 0.62) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max ? (max - min) / max : 0;
        if (sat < 0.12) continue;
        const d = max - min;
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        if (Math.floor(i / width) < height * 0.45 && h >= 185 && h <= 250 && lum > 0.3) continue;
        const w = sat * (1 - lum);
        x += w * Math.cos(h * Math.PI / 180);
        y += w * Math.sin(h * Math.PI / 180);
        weight += w;
    }
    if (weight < n * 0.05 || Math.hypot(x, y) / weight < 0.35) return null;
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    // الخشب والحجر والغروب والرمل بين 20° و45°، والخضرة في التصاميم زيتونية كثيراً (نحو 65°): الحد بينهما 52°
    return hue < 52 || hue >= 330 ? 'bronze' : hue < 165 ? 'forest' : hue < 200 ? 'teal' : hue < 255 ? 'navy' : 'plum';
}

// الجهة الأهدأ أسفل الصورة، لكتلة الكلام فوقها حين تملأ الصورة الصفحة (افتتاح الموقع): يُقارن أسفل الصورة يساراً ويميناً
// (من 30% من ارتفاعها إلى أسفلها، و44% من عرضها كل جهة: عرض الكتلة نفسها) بإضاءته وكثافة تفاصيله، فالأضوأ والأكثر تفاصيل
// موضوع الصورة (الحي المضاء على القناة في جوّية لامير سيرين) فلا تغطيه الكتلة. اليمين (أول السطر) ما لم يكن اليسار أهدأ
// بوضوح. ← 'left' | 'right' | null
export function quietSide(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 4 || height < 4) return null;
    const lum = (x, y) => { const i = (y * width + x) * 4; return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255; };
    const busy = (x0, x1) => {
        let sum = 0, edge = 0, k = 0;
        for (let y = Math.floor(height * 0.3); y < height; y++) {
            for (let x = x0; x < x1; x++) {
                const l = lum(x, y);
                sum += l;
                if (x + 1 < width) edge += Math.abs(lum(x + 1, y) - l);
                if (y + 1 < height) edge += Math.abs(lum(x, y + 1) - l);
                k++;
            }
        }
        return k ? (sum + 2 * edge) / k : 0;
    };
    const side = Math.max(1, Math.round(width * 0.44));
    const left = busy(0, side), right = busy(width - side, width);
    return left < right * 0.88 ? 'left' : 'right';
}

// عائلة البروشور كله: تصوّت كل صورة بعائلتها مرةً لكل صفحة ظهرت فيها (أو بوزنها weight إن حُسب: صورة الغلاف أثقل، والداخلية
// أخف)، والخلفيات التي يلبسها بروشور المطوّر صفحةً بعد صفحة تصوّت أكثر من غيرها، فيأخذ البروشور لون مشروعه لا لون صورة واحدة.
// والعائلتان المتجاورتان (الكحلي والأزرق المخضر) صوت واحد للأزرق قبل اختيار الفائز، ثم أكثرهما أصواتاً، والتعادل لعائلة hero.
// لا تصوّت الخلفيات اللونية والطبقات (backdrop) ولا المخططات. images: [{ deep, on: [{ page }], weight?, kind? }] ← اسم العائلة أو null
const TONE_GROUP = { navy: 'blue', teal: 'blue' };
export function brochureTone(images, hero) {
    const votes = new Map();
    for (const im of Array.isArray(images) ? images : []) {
        if (!im || typeof im.deep !== 'string' || im.kind === 'backdrop' || im.kind === 'plan') continue;
        const pages = typeof im.weight === 'number' ? im.weight : new Set((Array.isArray(im.on) ? im.on : []).map((o) => o && o.page)).size || 1;
        if (pages > 0) votes.set(im.deep, (votes.get(im.deep) || 0) + pages);
    }
    const groups = new Map();
    for (const [k, v] of votes) groups.set(TONE_GROUP[k] || k, (groups.get(TONE_GROUP[k] || k) || 0) + v);
    const top = (map, prefer) => {
        let best = null, most = 0;
        for (const [k, v] of map) if (v > most + 1e-9 || (Math.abs(v - most) < 1e-9 && k === prefer)) { best = k; most = v; }
        return best;
    };
    const group = top(groups, hero ? TONE_GROUP[hero] || hero : null);
    if (!group) return null;
    return top(new Map([...votes].filter(([k]) => (TONE_GROUP[k] || k) === group)), hero);
}

// لون هوية المطوّر من صفحاته نفسها: مساحات اللون المسطّحة خارج الصور (غلاف «نقش» وخريطته وخاتمته أخضر غابي #22302C) تقرر
// لون البروشور حين تتكرر في صفحتين فأكثر وتغطي معاً ربع صفحة على الأقل. fills: [{ page, hex, share }] (اللون الغالب الملوّن في
// كل صفحة خارج صورها، share من الصفحة) ← { deep, pale, hex, pages } بألوان مشتقة من درجة لونه، أو null
function rgbOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function hslOf([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
}
export function hexOfHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function brandColour(fills) {
    const list = (Array.isArray(fills) ? fills : []).map((f) => ({ ...f, rgb: rgbOf(f && f.hex) })).filter((f) => f.rgb && f.share > 0);
    let best = null;
    for (const f of list) {
        const [h] = hslOf(f.rgb);
        const near = list.filter((g) => { const [gh] = hslOf(g.rgb); return Math.min(Math.abs(gh - h), 360 - Math.abs(gh - h)) <= 14; });
        const pages = new Set(near.filter((g) => g.share >= 0.05).map((g) => g.page));
        const total = near.reduce((s, g) => s + g.share, 0);
        if (pages.size >= 2 && total >= 0.25 && (!best || total > best.total)) best = { f, total, pages: [...pages].sort((a, b) => a - b) };
    }
    if (!best) return null;
    // الأعمق من ألوان المجموعة لوناً عميقاً للبروشور، ودرجة فاتحة هادئة من اللون نفسه للكتل. والصفحة الداكنة كلها بدرجة لون المطوّر
    // هادئةً: تشبّع 35% على الأكثر وإضاءة بين 15% و25% (أخضر «لامير» الحاد #053F32 صفحةً كاملة يصير أخضر غابياً هادئاً قريباً مما
    // اختاره المحكّمون #1E3A2F، والأخضر الرمادي والكحلي الرمادي الهادئان يبقيان كما طبعهما المطوّر)
    const near = list.filter((g) => { const a = hslOf(g.rgb)[0], b = hslOf(best.f.rgb)[0]; return Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 14; });
    const darkest = near.reduce((a, g) => (hslOf(g.rgb)[2] < hslOf(a.rgb)[2] ? g : a), near[0]);
    const [h, s, l] = hslOf(darkest.rgb);
    const calmS = Math.min(s, 0.35), calmL = Math.max(0.15, Math.min(0.25, l));
    const deep = calmS === s && calmL === l ? darkest.hex.toUpperCase() : hexOfHsl(h, calmS, calmL);
    const pale = hexOfHsl(h, Math.min(0.14, Math.max(0.06, s * 0.35)), 0.9);
    return { deep: deep.startsWith('#') ? deep : '#' + deep, pale, hex: darkest.hex.toUpperCase(), pages: best.pages };
}

// اللون المسطّح الغالب في صفحة خارج صورها: البكسلات الملوّنة (تشبّع 0.1 فأكثر) غير الفاتحة جداً بدرجات مقرّبة، وأكبرها مساحةً.
// mask: Uint8Array بطول البكسلات، 1 لما تغطيه صورة ← { hex, share } أو null
export function pageFill(data, width, height, mask) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return null;
    const bins = new Map();
    let counted = 0;
    for (let i = 0; i < n; i++) {
        if (mask && mask[i]) continue;
        counted++;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (!max || (max - min) / max < 0.1 || (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.86) continue;
        const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
        const bin = bins.get(key) || { r: 0, g: 0, b: 0, k: 0 };
        bin.r += r; bin.g += g; bin.b += b; bin.k++;
        bins.set(key, bin);
    }
    let top = null;
    for (const v of bins.values()) if (!top || v.k > top.k) top = v;
    if (!top || top.k < n * 0.02) return null;
    const hex = '#' + [top.r, top.g, top.b].map((v) => Math.round(v / top.k).toString(16).padStart(2, '0')).join('').toUpperCase();
    return { hex, share: Math.round((top.k / n) * 1000) / 1000 };
}

// المخطط كما رسمه المطوّر: إطار حول لوحة فيها مخطط الوحدة، وبجانبه مخطط الدور صغيراً ونصّ يكرر المواصفات. يُقصّ مخطط الوحدة
// وحده فيملأ حقله، ومخطط الدور (أكثف كتلة في الجانب الآخر) يُعرض صغيراً بجانبه، ويُترك النص المكرر والإطار.
// البكسلات RGBA لنسخة مصغّرة (≈400 بكسل) كما تظهر في الصفحة ← { unit: [x0, y0, x1, y1], key: [...] | null } بنسب من 0 إلى 1،
// أو null إن لم يُعرف فيه شيء (يُعرض المخطط كاملاً كما هو)
// والحبر على لوح معتم هو ما يختلف عن لون اللوح نفسه: الخطوط الداكنة على الورق، والخطوط المضيئة على لوح كحلي (مخطط «الحياة»)،
// بعتبة خفيفة فلا تضيع الجدران والسيارات الرمادية الفاتحة (مخطط «نقش» B قُصّ عند 59% من ارتفاعه حين كان الحبر أغمق من 0.8)
export function planCrop(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 40 || height < 40) return null;
    let clear = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 24) clear++;
    const alpha = clear / n > 0.05;
    // لون اللوح: أكثر إضاءة تكراراً في الصورة (الورق الأبيض، أو اللوح الكحلي)
    let bgL = 1;
    if (!alpha) {
        const hist = new Uint32Array(33);
        for (let i = 0; i < n; i++) hist[Math.round(((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255) * 32)]++;
        let top = 0;
        for (let k = 1; k < 33; k++) if (hist[k] > hist[top]) top = k;
        bgL = top / 32;
    }
    const ink = new Uint8Array(n);
    // وعلى الشفاف «حبر باهت» أيضاً: كل بكسل فيه شيء من الرسم، ولو خطاً صار شبه شفاف في النسخة المصغّرة (تظليل شرفة «نقش»
    // المفتوحة)، لحدود الرسم وحدها
    const faint = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (alpha && data[i * 4 + 3] >= 8) faint[i] = 1;
        if (data[i * 4 + 3] < 24) continue;
        if (alpha) { ink[i] = 1; continue; }
        if (Math.abs((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255 - bgL) > 0.07) ink[i] = 1;
    }
    const cols = (x0, x1, y0, y1, src) => { const c = new Uint32Array(width), m = src || ink; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c[x] += m[y * width + x]; return c; };
    const rows = (x0, x1, y0, y1, src) => { const r = new Uint32Array(height), m = src || ink; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r[y] += m[y * width + x]; return r; };
    // الإطار: خطوط تمتد أكثر من نصف الطول قرب الحواف (8%)، واللوحة داخلها
    const c0 = cols(0, width, 0, height), r0 = rows(0, width, 0, height);
    const edge = (prof, len, size, fromEnd) => {
        let at = fromEnd ? size : 0;
        for (let k = 0; k < Math.ceil(size * 0.08); k++) {
            const i = fromEnd ? size - 1 - k : k;
            if (prof[i] > len * 0.5) at = fromEnd ? i : i + 1;
        }
        return at;
    };
    let L = edge(c0, height, width, false), R = edge(c0, height, width, true);
    let T = edge(r0, width, height, false), B = edge(r0, width, height, true);
    // هامش صغير بعد خط الإطار (سماكته المضادّة للتعرّج)
    if (L > 0) L = Math.min(width, L + 2);
    if (R < width) R = Math.max(0, R - 2);
    if (T > 0) T = Math.min(height, T + 2);
    if (B < height) B = Math.max(0, B - 2);
    if (R - L < width * 0.3 || B - T < height * 0.3) return null;
    const W = R - L, H = B - T;
    // كتل الحبر في مستطيل: صفوف يفصلها فراغ (1.5% من الارتفاع فأكثر) ← [{ y0, y1, x0, x1, mass }]
    const blocks = (x0, x1, y0, y1, fine, src) => {
        const r = rows(x0, x1, y0, y1, src), out = [];
        const gap = Math.max(2, Math.round(H * (fine ? 0.007 : 0.015)));
        let start = -1, empty = 0;
        for (let y = y0; y <= y1; y++) {
            const on = y < y1 && r[y] > 0;
            if (on) { if (start < 0) start = y; empty = 0; } else if (start >= 0 && (++empty >= gap || y === y1)) { out.push([start, y - empty + 1]); start = -1; empty = 0; }
        }
        return out.map(([a, b]) => {
            const c = cols(x0, x1, a, b, src);
            let lo = x1, hi = x0, mass = 0;
            for (let x = x0; x < x1; x++) if (c[x]) { lo = Math.min(lo, x); hi = Math.max(hi, x + 1); mass += c[x]; }
            return { y0: a, y1: b, x0: lo, x1: hi, mass };
        }).filter((k) => k.x1 > k.x0);
    };
    const main = (list) => list.reduce((a, k) => (!a || k.mass > a.mass ? k : a), null);
    const box = (k) => {
        const px = Math.round(W * 0.012), py = Math.round(H * 0.012);
        const v = [Math.max(L, k.x0 - px) / width, Math.max(T, k.y0 - py) / height, Math.min(R, k.x1 + px) / width, Math.min(B, k.y1 + py) / height];
        return v.map((x) => Math.round(x * 1000) / 1000);
    };
    // الفاصل بين مخطط الوحدة ومخطط الدور: أعرض مجرى عمودي فارغ (أو خط فاصل طويل بجانب فراغ) في الوسط، 1% من العرض فأكثر
    const ci = cols(L, R, T, B);
    // مجرى بين اللوحتين: أعمدة شبه فارغة (1.5% من الارتفاع حبراً على الأكثر)، ومعها الخط الطويل الذي بجانبه فراغ. يُفضَّل مجرى
    // فيه خط فاصل كهذا (لوحات المطوّرين)، وإلا فأعرض مجرى فيه أعمدة خالية تماماً بعرض 2.5% فأكثر. الغرفة الواسعة بجدران رفيعة
    // في مخطط واحد ليست مجرى: جداراها فوق وتحت يمرّان بكل عمود فيها، فلا عمود خالياً
    const empty = (x, f) => x >= L && x < R && ci[x] <= Math.max(1, H * (f || 0.015));
    const near = (x, d) => { for (let k = 1; k <= 5; k++) if (empty(x + d * k)) return true; return false; };
    const rule = (x) => ci[x] > H * 0.5 && (near(x, -1) || near(x, 1));
    const runs = [];
    for (let x = L + Math.round(W * 0.15), cur = null; x <= R - Math.round(W * 0.15); x++) {
        const on = x < R - Math.round(W * 0.15) && (empty(x) || rule(x));
        if (on) { if (!cur) cur = { a: x, b: x + 1, inner: false, zero: 0 }; else cur.b = x + 1; continue; }
        if (cur) runs.push(cur);
        cur = null;
    }
    for (const r of runs) {
        // خط على طرف المجرى جدارُ ما بجانبه، فيعود إليه؛ وخط في داخله هو الفاصل
        // خط طويل جداً (65% من الارتفاع فأكثر) على طرف المجرى فاصلٌ أيضاً، وما دونه جدار
        const long = (x) => ci[x] > H * 0.65;
        while (r.b - r.a > 1 && rule(r.a) && !empty(r.a)) { if (long(r.a)) r.edge = true; r.a += 1; }
        while (r.b - r.a > 1 && rule(r.b - 1) && !empty(r.b - 1)) { if (long(r.b - 1)) r.edge = true; r.b -= 1; }
        for (let x = r.a; x < r.b; x++) { if (rule(x) && !empty(x)) r.inner = true; if (ci[x] <= 1) r.zero += 1; }
    }
    const pick = (list) => list.reduce((a, r) => (!a || r.b - r.a > a.b - a.a ? r : a), null);
    const lined = pick(runs.filter((r) => r.zero && ((r.inner && r.b - r.a >= W * 0.01) || (r.edge && r.zero >= 2 && r.b - r.a >= W * 0.0075))));
    const best = lined || pick(runs.filter((r) => r.zero >= W * 0.025));
    const area = (k) => (k.x1 - k.x0) * (k.y1 - k.y0);
    // مخطط الوحدة مرسوم بمقياس أكبر: غرفه واسعة، فالفراغات بين خطوطه طويلة؛ ومخطط الدور شقق صغيرة كثيرة والنص حروف متقاربة.
    // المقياس: متوسط طول الفراغات بين الحبر في الصفوف موزوناً بطولها (Σل² ÷ Σل)
    const open = (k) => {
        let sum = 0, sq = 0;
        for (let y = k.y0; y < k.y1; y += 2) {
            let last = -1;
            for (let x = k.x0; x < k.x1; x++) {
                if (!ink[y * width + x]) continue;
                const run = last >= 0 ? x - last - 1 : 0;
                if (run > 0) { sum += run; sq += run * run; }
                last = x;
            }
        }
        return sum ? sq / sum : 0;
    };
    // الرسم في جانب: أثقل كتلة ومعها كل كتلة رسمٍ على محورها (ارتفاعها 15% منه و6% من اللوحة فأكثر: جزء من الرسم لا سطر نص)،
    // فلا يُقطع مخطط فصلته جدران رمادية فاتحة أو شرفة مظللة عن نصفه الآخر؛ وأسطر النص فوقه وتحته تُترك
    const whole = (list) => {
        const m = main(list);
        if (!m) return null;
        const keep = list.filter((k) => k === m || (k.y1 - k.y0) >= Math.max((m.y1 - m.y0) * 0.15, H * 0.06));
        return keep.reduce((a, k) => ({ y0: Math.min(a.y0, k.y0), y1: Math.max(a.y1, k.y1), x0: Math.min(a.x0, k.x0), x1: Math.max(a.x1, k.x1), mass: a.mass + k.mass }));
    };
    // القسمة تُقبل إن كان في كل جانب منها رسم له حجم (6% من اللوحة فأكثر)
    const drawn = alpha ? faint : ink;
    let parts = best ? [[L, best.a], [best.b, R]].map(([a, b]) => { const k = whole(blocks(a, b, T, B, false, drawn)); return k && { ...k, a, b }; }) : [];
    if (parts.length !== 2 || !parts.every((k) => k && area(k) >= W * H * 0.06)) parts = [whole(blocks(L, R, T, B, false, drawn))].filter(Boolean);
    if (!parts.length) return null;
    parts.sort((p, q) => open(q) - open(p));
    const unit = parts[0];
    // مخطط الدور وحده بلا عنوان المطوّر ولا نصه تحته: كتلته الأثقل بفراغ أدقّ بين الكتل
    // (بلا الخط الفاصل الطويل على طرف جانبه، فهو يصل العنوان والمخطط والنص عمودياً)
    let ka = parts[1] ? parts[1].a : 0, kb = parts[1] ? parts[1].b : 0;
    while (kb - ka > 2 && ci[ka] > H * 0.5) ka++;
    while (kb - ka > 2 && ci[kb - 1] > H * 0.5) kb--;
    const keyBlock = parts[1] ? main(blocks(ka, kb, T, B, true)) : null;
    const key = keyBlock && area(keyBlock) >= W * H * 0.04 ? keyBlock : null;
    if (area(unit) < W * H * 0.08) return null;
    return { unit: box(unit), key: key ? box(key) : null };
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

// بصمة اللقطة: متوسط إضاءة كل خانة في شبكة 8×8 من نسخة مصغّرة (≈96 بكسل، والشفاف فوق أبيض)، والخانة 1 إن كانت أفتح من متوسط
// الصورة ← 64 حرفاً. المتوسط على بكسلات الخانة كلها لا بكسل واحد منها، فلا تتغير البصمة بتصغير الصورة أو ضغطها (بصمة التكرار
// fingerprint ترسم الصورة على 8×8 بكسلات مباشرة فتتأثر بموضع العيّنة)
export function viewPrint(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 8 || height < 8) return null;
    const sum = new Float64Array(64), cnt = new Float64Array(64);
    for (let y = 0; y < height; y++) {
        const by = Math.min(7, Math.floor((y * 8) / height));
        for (let x = 0; x < width; x++) {
            const k = by * 8 + Math.min(7, Math.floor((x * 8) / width));
            const i = (y * width + x) * 4, a = data[i + 3] / 255;
            sum[k] += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
            cnt[k]++;
        }
    }
    const v = Array.from(sum, (s, k) => s / (cnt[k] || 1));
    const mean = v.reduce((s, x) => s + x, 0) / 64;
    return v.map((x) => (x > mean ? '1' : '0')).join('');
}

// اللقطة نفسها من زاوية قريبة (لا الصورة نفسها): بصمتا اللقطتين (viewPrint) تختلفان في 10 خانات من 64 على الأكثر. زاويتا
// ركن «A-40» في «نقش» تختلفان في 6، ولقطتا الحمّام نفسه في «الحياة» في 7، وصور المشروع المختلفة في 15 فأكثر
export function sameView(f1, f2) {
    if (typeof f1 !== 'string' || typeof f2 !== 'string' || f1.length !== 64 || f2.length !== 64) return false;
    let diff = 0;
    for (let i = 0; i < 64; i++) if (f1[i] !== f2[i] && ++diff > 10) return false;
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

// { kind, key, print, alpha } مكرر لآخر: البكسلات نفسها لأي صورة، والبصمة المتقاربة للصور المعتمة وحدها. المخططات خطوط على
// خلفية واحدة فتتقارب بصماتها وهي مختلفة، والخطوط الفاتحة على شفاف تعطي كلها البصمة نفسها (بروشور لامير: ضاعت مخططاته إلا
// ثلاثة)، والصورة الشفافة بصمتها حوافّها الشفافة لا ما فيها («الصفا 3»: لوحتا معرض مختلفتان بالتخطيط نفسه اختلفت بصمتاهما
// ببت واحد فدُمجتا وضاعت صورتان)
export function duplicate(a, b) {
    if (a.key && a.key === b.key) return true;
    return a.kind === 'photo' && b.kind === 'photo' && !a.alpha && !b.alpha && sameImage(a.print, b.print);
}

// الصورة تستحق الاستخراج: ضلعها الأصغر من minSide فأكثر (الأيقونات والشعارات الصغيرة تُترك)
export function worthKeeping(width, height, minSide = 500) {
    return Math.min(width, height) >= minSide;
}

// صفحة أطول من ضعف عرضها (بروشور «تمرير» بصفحة واحدة، كبروشور كيان 595×10717 نقطة): تُقسم قطعاً بمقاس A4 قائم، فلا تتجاوز
// صورتها حد النموذج (8000 بكسل في أي ضلع: رُفض بروشور بهذا في 2026-10-25) ولا تُصغَّر حتى يضيع نصها. وإلا قطعة واحدة
export function sliceCount(width, height) {
    if (!(width > 0) || !(height > width * 2)) return 1;
    return Math.ceil(height / (width * Math.SQRT2));
}

// رؤوس الأقسام في صفحة التمرير من طبقة نصها: items [{ y, size, text }] (y موضع أعلى السطر وsize مقاس خطه، بالبكسل نفسه) ←
// مواضع رؤوس الأقسام مرتبة. رأس القسم كلمةٌ لا رقم وحده («20» سنة بخط كبير ليست قسماً)، بخط 1.6 من وسيط خطوط الصفحة فأكثر،
// وفي الدرجة الكبرى من هذه العناوين (0.8 من مقاس العُشر الأكبر منها): سطر الغلاف تحت اسمه («افراغ فوري» بخط أصغر من رؤوس
// الأقسام) ليس رأس قسم يُقطع قبله فينفصل عن اسم المشروع، ولا سعر ولا «المساحة» بخطها المتوسط. وكلمات السطر الواحد والعنوان من
// سطرين («موقع» ثم «المشروع») رأس واحد
export function sectionHeads(items) {
    const list = (Array.isArray(items) ? items : []).filter((x) => x && Number.isFinite(x.y) && x.size > 0 && typeof x.text === 'string' && x.text.trim());
    if (!list.length) return [];
    const sizes = list.map((x) => x.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    const big = list.filter((x) => x.size >= median * 1.6 && /[A-Za-zء-ي]/.test(x.text));
    if (!big.length) return [];
    const bs = big.map((x) => x.size).sort((a, b) => a - b);
    const tier = bs[Math.min(bs.length - 1, Math.floor(bs.length * 0.9))] * 0.8;
    const top = big.filter((x) => x.size >= tier).sort((a, b) => a.y - b.y);
    const out = [];
    let last = -Infinity;
    for (const x of top) {
        if (x.y - last > x.size * 2.2) out.push(Math.round(x.y));
        last = x.y;
    }
    return out;
}

// مواضع القطع في صفحة التمرير عند حدود أقسامها لا بأطوال ثابتة: قبل كل عنوان قسم («نموذج F» في بروشور «كيان»: كان القطع الثابت
// يضع العنوان في آخر القطعة وبياناته في التالية، فانزاحت الأسماء نموذجاً). عدد القطع كما هو (sliceCount: صفحة لكل قطعة بمقاس A4)،
// وكل قطع ينتقل من موضعه المتساوي إلى أقرب عنوان في حدود ثلث صفحة A4 حوله، في أهدأ سطر فوق العنوان مباشرة؛ وبلا عنوان قريب
// إلى أهدأ سطر حوله. ولا تقل قطعة عن نصف A4.
// heads: مواضع رؤوس العناوين (بكسل من أعلى الصفحة، sectionHeads)؛ busy(y) ← كثافة السطر y (0 فارغ). ← [موضع كل قطع]
export function sliceCuts(width, height, heads, busy) {
    const parts = sliceCount(width, height);
    if (parts <= 1) return [];
    const a4 = width * Math.SQRT2;
    const calm = (from, to) => {
        let best = Math.round(to), low = Infinity;
        for (let y = Math.round(to); y >= Math.round(from); y--) { const b = busy ? busy(y) : 0; if (b < low - 1e-9) { low = b; best = y; } if (b === 0) break; }
        return best;
    };
    const cuts = [];
    let prev = 0;
    for (let k = 1; k < parts; k++) {
        const even = (k * height) / parts;
        const lo = Math.max(prev + a4 * 0.5, even - a4 * 0.35), hi = Math.min(height - a4 * 0.5 * (parts - k), even + a4 * 0.35);
        const near = (Array.isArray(heads) ? heads : []).filter((y) => y > lo && y < hi).sort((p, q) => Math.abs(p - even) - Math.abs(q - even));
        let cut = near.length ? calm(Math.max(lo, near[0] - a4 * 0.06), near[0] - 2) : calm(Math.max(lo, even - a4 * 0.1), Math.min(hi, even + a4 * 0.1));
        if (!(cut > prev + a4 * 0.3)) cut = Math.round(even);
        cuts.push(cut);
        prev = cut;
    }
    return cuts;
}

// رسم المطوّر الخطي مقصوصاً من صفحته يُطبع على ورق نظيف: الخلفية الفاتحة غير الملوّنة تحته (ورق بملمس رخامي أو غشاء رمادي في
// صفحات «كيان») تصير بيضاء، وما بين الخط والورق يفتح بقدر قربه من الورق؛ والخطوط الداكنة والألوان (حدود الوحدات الملوّنة
// وتعبئتها، ولوح خريطة داكن) كما هي. data: RGBA تُعدَّل في مكانها ← عدد البكسلات التي فتحت
export function cleanPaper(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4) return 0;
    let changed = 0;
    for (let i = 0; i < n; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 26) continue;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum <= 0.55) continue;
        const t = lum >= 0.75 ? 1 : (lum - 0.55) / 0.2;
        data[i * 4] = Math.round(r + (255 - r) * t);
        data[i * 4 + 1] = Math.round(g + (255 - g) * t);
        data[i * 4 + 2] = Math.round(b + (255 - b) * t);
        changed++;
    }
    return changed;
}

// رسوم المطوّر المرسومة خطوطاً لا صوراً (مخططات «كيان» وأدوارها، وخريطة «نقش»): مناطق كثيفة بأوامر الرسم في الصفحة. paths:
// [[x0, y0, x1, y1, عدد أوامرها]] مستطيلات المسارات في صورة الصفحة (بكسل)؛ avoid: مستطيلات الصور النقطية فيها. تُوزَّع أوامر كل
// مسار على خلايا شبكة بعرض 1/48 من الصفحة، والخلايا الكثيفة المتجاورة منطقةٌ واحدة تُقبل إن كانت 18% من العرض و10% منه ارتفاعاً
// فأكثر (لا سطر عنوان ولا أيقونة) وفيها 150 أمراً فأكثر، وليست صورة نقطية في أغلبها. الخلفيات والإطارات (مسار يغطي ثلث صفحة A4) تُترك.
// ← [[x0, y0, x1, y1]] بكسل
export function drawingRegions(paths, width, height, avoid) {
    if (!(width > 0) || !(height > 0) || !Array.isArray(paths) || !paths.length) return [];
    const cell = width / 48, cols = 48, rows = Math.max(1, Math.ceil(height / cell));
    const grid = new Float32Array(cols * rows);
    const big = width * width * Math.SQRT2 * 0.33;
    const at = (v, n) => Math.max(0, Math.min(n - 1, Math.floor(v / cell)));
    for (const p of paths) {
        const [x0, y0, x1, y1, w] = p;
        if (!(x1 >= x0) || !(y1 >= y0) || (x1 - x0) * (y1 - y0) > big || !(w > 0)) continue;
        const c0 = at(x0, cols), c1 = at(x1, cols), r0 = at(y0, rows), r1 = at(y1, rows);
        const share = w / ((c1 - c0 + 1) * (r1 - r0 + 1));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * cols + c] += share;
    }
    const dense = new Uint8Array(cols * rows);
    for (let i = 0; i < grid.length; i++) if (grid[i] >= 1.5) dense[i] = 1;
    const seen = new Uint8Array(cols * rows);
    const out = [];
    for (let i = 0; i < dense.length; i++) {
        if (!dense[i] || seen[i]) continue;
        const stack = [i];
        seen[i] = 1;
        let c0 = cols, c1 = -1, r0 = rows, r1 = -1, weight = 0;
        while (stack.length) {
            const k = stack.pop();
            const r = Math.floor(k / cols), c = k % cols;
            c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
            weight += grid[k];
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                const rr = r + dr, cc = c + dc;
                if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
                const j = rr * cols + cc;
                if (dense[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
            }
        }
        if (c1 - c0 + 1 < cols * 0.18 || r1 - r0 + 1 < cols * 0.1 || weight < 150) continue;
        const box = [Math.max(0, (c0 - 1) * cell), Math.max(0, (r0 - 1) * cell), Math.min(width, (c1 + 2) * cell), Math.min(height, (r1 + 2) * cell)];
        const area = (box[2] - box[0]) * (box[3] - box[1]);
        const covered = (Array.isArray(avoid) ? avoid : []).reduce((s, [a, b, c, d]) => s + Math.max(0, Math.min(c, box[2]) - Math.max(a, box[0])) * Math.max(0, Math.min(d, box[3]) - Math.max(b, box[1])), 0);
        if (covered > area * 0.5) continue;
        out.push(box.map((v) => Math.round(v)));
    }
    return out;
}
