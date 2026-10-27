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

// لون الصورة العميق ← عائلة لونية للبروشور: البروشور يلبس ألوان مشروعه لا ألوان ملائم وحدها (المالك 2026-10-25: «مو لازم
// أزرق غامق… لا تكون مقيد بألوان ملائم»). يُوزن كل بكسل معتم متوسط الإضاءة بتشبّعه وعمقه، فتغلب الخضرة والخشب والحجر على
// الإسفلت والسماء البيضاء، ويؤخذ متوسط درجة اللون دائرياً. لون واحد واضح يغطي 5% من الصورة فأكثر ← عائلته (forest للخضرة،
// teal للماء، bronze للخشب والحجر الدافئ والغروب، plum للبنفسجي، navy للأزرق)؛ وصورة رمادية أو باهتة أو ألوانها متفرقة ← null.
// العائلة اسم من قائمة ثابتة لا لون حر، فالألوان نفسها مختارة سلفاً (PALETTES في brochure-plan.js) ولا تأتي من الملف
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

// عائلة البروشور كله: تصوّت كل صورة بعائلتها مرةً لكل صفحة ظهرت فيها، والخلفيات التي يلبسها بروشور المطوّر صفحةً بعد صفحة
// تصوّت أكثر من غيرها، فيأخذ البروشور لون مشروعه لا لون صورة واحدة. images: [{ deep, on: [{ page }] }] ← اسم العائلة أو null
export function brochureTone(images) {
    const votes = new Map();
    for (const im of Array.isArray(images) ? images : []) {
        if (!im || typeof im.deep !== 'string') continue;
        const pages = new Set((Array.isArray(im.on) ? im.on : []).map((o) => o && o.page)).size || 1;
        votes.set(im.deep, (votes.get(im.deep) || 0) + pages);
    }
    let best = null, most = 0;
    for (const [k, v] of votes) if (v > most) { best = k; most = v; }
    return best;
}

// المخطط كما رسمه المطوّر: إطار حول لوحة فيها مخطط الوحدة، وبجانبه مخطط الدور صغيراً ونصّ يكرر المواصفات. يُقصّ مخطط الوحدة
// وحده فيملأ حقله، ومخطط الدور (أكثف كتلة في الجانب الآخر) يُعرض صغيراً بجانبه، ويُترك النص المكرر والإطار.
// البكسلات RGBA لنسخة مصغّرة (≈400 بكسل) كما تظهر في الصفحة ← { unit: [x0, y0, x1, y1], key: [...] | null } بنسب من 0 إلى 1،
// أو null إن لم يُعرف فيه شيء (يُعرض المخطط كاملاً كما هو)
export function planCrop(data, width, height) {
    const n = width * height;
    if (!n || !data || data.length < n * 4 || width < 40 || height < 40) return null;
    let clear = 0;
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 24) clear++;
    const alpha = clear / n > 0.05;
    // الحبر: كل بكسل معتم على الشفاف، وكل بكسل غير فاتح على الأبيض
    const ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (data[i * 4 + 3] < 24) continue;
        if (alpha) { ink[i] = 1; continue; }
        if ((0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255 < 0.8) ink[i] = 1;
    }
    const cols = (x0, x1, y0, y1) => { const c = new Uint32Array(width); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c[x] += ink[y * width + x]; return c; };
    const rows = (x0, x1, y0, y1) => { const r = new Uint32Array(height); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r[y] += ink[y * width + x]; return r; };
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
    const blocks = (x0, x1, y0, y1, fine) => {
        const r = rows(x0, x1, y0, y1), out = [];
        const gap = Math.max(2, Math.round(H * (fine ? 0.007 : 0.015)));
        let start = -1, empty = 0;
        for (let y = y0; y <= y1; y++) {
            const on = y < y1 && r[y] > 0;
            if (on) { if (start < 0) start = y; empty = 0; } else if (start >= 0 && (++empty >= gap || y === y1)) { out.push([start, y - empty + 1]); start = -1; empty = 0; }
        }
        return out.map(([a, b]) => {
            const c = cols(x0, x1, a, b);
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
    // القسمة تُقبل إن كان في كل جانب منها رسم له حجم (6% من اللوحة فأكثر)
    let parts = best ? [[L, best.a], [best.b, R]].map(([a, b]) => { const k = main(blocks(a, b, T, B)); return k && { ...k, a, b }; }) : [];
    if (parts.length !== 2 || !parts.every((k) => k && area(k) >= W * H * 0.06)) parts = [main(blocks(L, R, T, B))].filter(Boolean);
    if (!parts.length) return null;
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

// صفحة أطول من ضعف عرضها (بروشور «تمرير» بصفحة واحدة، كبروشور كيان 595×10717 نقطة): تُقسم قطعاً بمقاس A4 قائم، فلا تتجاوز
// صورتها حد النموذج (8000 بكسل في أي ضلع: رُفض بروشور بهذا في 2026-10-25) ولا تُصغَّر حتى يضيع نصها. وإلا قطعة واحدة
export function sliceCount(width, height) {
    if (!(width > 0) || !(height > width * 2)) return 1;
    return Math.ceil(height / (width * Math.SQRT2));
}
