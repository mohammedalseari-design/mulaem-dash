// قراءة بروشور المطوّر (PDF) في المتصفح بـ pdf.js: كل صورة ومخطط فيه ملفاً مستقلاً كما تظهر في الصفحة، بلا تكرار ولا صور
// فارغة، وكل صفحة صورةً للمساعد وتحتها صورها مصغّراتٍ مرقّمة يحكم على كل منها برقمها.
// الحساب على البكسل في brochure-media.js (مختبَر وحده)، وهنا الرسم والملفات فقط.
// الملف لا يغادر المتصفح هنا: الرفع إلى المخزن وإنشاء طلب المساعد في brochure.js.

import { uprightMatrix, pageRotation, multiply, classifyPixels, deepTone, quietSide, planCrop, fingerprint, pixelKey, duplicate, worthKeeping, sliceCount,
    sliceCuts, sectionHeads, contentBox, photoBlocks, focusOf, pageFill, drawingRegions, viewPrint, cleanPaper } from './brochure-media.js';

// نسخة مثبّتة من jsDelivr (كمكتبة supabase-js في الصفحة). العامل من نطاق آخر: pdf.js يلفّه بنفسه
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
export const MAX_PAGES = 36;          // حد طلب البروشور 40 ملفاً (036)
export const MAX_IMAGES = 64;
export const MAX_DRAWINGS = 12;       // رسوم المطوّر الخطية المقصوصة من صفحاته (مخططات وخرائط بلا صورة نقطية)
export const MAX_PAGE_IMAGES = 12;    // مصغّرات الصفحة الواحدة، كحد الخادم (brochure.ts)
const PAGE_WIDTH = 1100;              // عرض صورة الصفحة للمساعد: يقرأ نصوص النماذج والأسعار
const IMAGE_MAX = 2400;               // أطول ضلع لصورة تُطبع في بروشور ملائم

let lib = null;
async function pdfjs() {
    if (!lib) {
        lib = await import(PDFJS + 'pdf.min.mjs');
        lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    }
    return lib;
}

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذّر حفظ الصورة'))), type, quality));
}

// كائن الصورة من pdf.js (ImageBitmap، أو بكسلات خام بأنواعها الثلاثة) ← لوحة رسم
function imageCanvas(img) {
    const w = img.width, h = img.height;
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');
    if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
    if (!img.data) return null;
    const out = ctx.createImageData(w, h);
    const d = img.data, o = out.data;
    if (img.kind === 3) o.set(d.subarray(0, o.length));
    else if (img.kind === 2) {
        for (let i = 0, j = 0; j < o.length; i += 3, j += 4) { o[j] = d[i]; o[j + 1] = d[i + 1]; o[j + 2] = d[i + 2]; o[j + 3] = 255; }
    } else {
        // GRAYSCALE_1BPP: بت لكل بكسل، الصف مقرّب إلى بايت
        const row = (w + 7) >> 3;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const v = (d[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
            const j = (y * w + x) * 4;
            o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
    return c;
}

// الصورة كما تظهر في الصفحة (مُدارة، ومعكوسة إن عكستها الصفحة)، مصغّرة إلى IMAGE_MAX
function upright(src, ctm) {
    const scale = Math.min(1, IMAGE_MAX / Math.max(src.width, src.height));
    const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
    const { width, height, matrix } = uprightMatrix(ctm, w, h);
    const c = canvasOf(width, height);
    const ctx = c.getContext('2d');
    ctx.setTransform(...matrix);
    ctx.drawImage(src, 0, 0, w, h);
    return c;
}

// تدرّج رمادي w×h للصورة فوق أبيض (بصمة التكرار)
function grayOf(canvas, w, h) {
    const g = canvasOf(w, h);
    const gx = g.getContext('2d');
    gx.fillStyle = '#fff';
    gx.fillRect(0, 0, w, h);
    gx.drawImage(canvas, 0, 0, w, h);
    const gp = gx.getImageData(0, 0, w, h).data;
    const gray = [];
    for (let i = 0; i < w * h; i++) gray.push(0.299 * gp[i * 4] + 0.587 * gp[i * 4 + 1] + 0.114 * gp[i * 4 + 2]);
    return gray;
}
function pixelsOf(canvas, side) {
    const k = Math.min(1, side / Math.max(canvas.width, canvas.height));
    const c = canvasOf(canvas.width * k, canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

// نسخة مصغّرة بكسلاتها للحكم على النوع وبصمة التكرار، ونقطة ثقلها، وإضاءة لوحها (المخطط المضيء على لوح داكن)
function probe(canvas) {
    const { data: px, w, h } = pixelsOf(canvas, 96);
    const cls = classifyPixels(px, w, h);
    // عائلة لون الصورة (ألوان البروشور): للصور والخلفيات وحدها، اسماً من قائمة ثابتة
    // والجهة الأهدأ أسفل الصورة لكتلة كلام فوقها (صفحة كاملة الصورة)
    const photo = cls.kind === 'photo';
    let top = 0;
    const hist = new Uint32Array(17);
    for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] >= 24) hist[Math.round(((0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255) * 16)]++;
    for (let k = 1; k < 17; k++) if (hist[k] > hist[top]) top = k;
    return { cls, deep: photo ? deepTone(px, w, h) : null, quiet: photo ? quietSide(px, w, h) : null, focus: photo ? focusOf(px, w, h) : null,
        print: fingerprint(grayOf(canvas, 8, 8)), view: photo ? viewPrint(px, w, h) : null, key: w + 'x' + h + ':' + pixelKey(px), bg: Math.round((top / 16) * 100) / 100 };
}

// قصّ المخطط (مخطط الوحدة ومخطط الدور بلا الإطار والنص المكرر) من نسخة بـ 400 بكسل: الخطوط الرفيعة تبقى فيها
function cropOf(canvas) {
    const { data, w, h } = pixelsOf(canvas, 400);
    return planCrop(data, w, h);
}

// جزء من لوحة رسم بنسب [x0, y0, x1, y1]
function cut(canvas, box) {
    const [x0, y0, x1, y1] = box;
    const sx = Math.round(x0 * canvas.width), sy = Math.round(y0 * canvas.height);
    const c = canvasOf(Math.max(1, Math.round((x1 - x0) * canvas.width)), Math.max(1, Math.round((y1 - y0) * canvas.height)));
    c.getContext('2d').drawImage(canvas, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
    return c;
}

// مراجع الصور في صفحة مع مصفوفة رسم كل منها، من قائمة أوامر الرسم (مع حفظ الحالة واسترجاعها والنماذج المتداخلة)؛ ومعها
// refs.paths: مستطيل كل مسار مرسوم (لا مسار القصّ) في فضاء الصفحة وعدد أوامره [x0, y0, x1, y1, n]، لرسوم المطوّر الخطية
async function imageRefs(page, OPS) {
    const ops = await page.getOperatorList();
    const refs = [];
    const paths = [];
    const base = pageRotation(page.rotate);
    let ctm = base;
    const stack = [];
    const clipOps = new Set([OPS.clip, OPS.eoClip, OPS.endPath]);
    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() || base;
        else if (fn === OPS.transform) ctm = multiply(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) {
            stack.push(ctm);
            if (Array.isArray(args[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || base;
        else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) refs.push({ name: args[0], ctm });
        else if (fn === OPS.constructPath && args && args[2] && args[2].length === 4 && !clipOps.has(ops.fnArray[i + 1])) {
            const [x0, y0, x1, y1] = args[2];
            if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
            const [a, b, c, d, e, f] = ctm;
            const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
            paths.push([Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1])),
                Array.isArray(args[0]) ? args[0].length : 1]);
        }
    }
    refs.paths = paths;
    return refs;
}

// منطقة من الصفحة مرسومةً بدقة عالية (حتى 2400 بكسل): رسم المطوّر الخطي صورةً تُطبع. box بكسل في صورة الصفحة بمقياس k
async function renderRegion(page, box, k) {
    const w = (box[2] - box[0]) / k, h = (box[3] - box[1]) / k;
    const s = Math.min(3, IMAGE_MAX / Math.max(w, h));
    const vp = page.getViewport({ scale: s, offsetX: -(box[0] / k) * s, offsetY: -(box[1] / k) * s });
    const c = canvasOf(w * s, h * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
}

function imageObject(page, name) {
    const store = String(name).startsWith('g_') ? page.commonObjs : page.objs;
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 8000);
        try { store.get(name, (img) => { clearTimeout(timer); resolve(img || null); }); } catch (_) { clearTimeout(timer); resolve(null); }
    });
}

// مصغّرة الصورة لصفحة المساعد: ارتفاع ثابت، والشفافة فوق أبيض كما تظهر على الورق (مخطط بخطوط داكنة على شفاف كان يُرسم
// على الشريط الرمادي فلا يكاد يُرى)
const THUMB_H = 170;
function thumbOf(canvas) {
    const k = Math.min(THUMB_H / canvas.height, 560 / canvas.width);
    const c = canvasOf(canvas.width * k, canvas.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
}

// صفحة للمساعد: الصفحة نفسها، وتحت خط فاصل صورها المستخرجة مصغّراتٍ مرقّمة (1…) صفاً أو أكثر بعرض الصفحة
function pageSheet(page, thumbs) {
    const pad = 12;
    const rows = [];
    let row = [], x = pad;
    thumbs.forEach((t, k) => {
        if (row.length && x + t.width + pad > page.width) { rows.push(row); row = []; x = pad; }
        row.push({ t, k, x });
        x += t.width + pad;
    });
    if (row.length) rows.push(row);
    const strip = rows.length ? 4 + pad + rows.length * (THUMB_H + pad) : 0;
    const c = canvasOf(page.width, page.height + strip);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(page, 0, 0);
    if (!rows.length) return c;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, page.height, c.width, 4);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, page.height + 4, c.width, strip - 4);
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    rows.forEach((r, ri) => {
        const y = page.height + 4 + pad + ri * (THUMB_H + pad);
        for (const { t, k, x: tx } of r) {
            ctx.drawImage(t, tx, y);
            ctx.fillStyle = '#fff';
            ctx.fillRect(tx, y, 52, 34);
            ctx.fillStyle = '#000';
            ctx.fillText('#' + (k + 1), tx + 6, y + 18);
        }
    });
    return c;
}

// وسط الصورة في فضاء الصفحة: مصفوفة الرسم تنقل مربع الوحدة [0,1]² إلى موضع الصورة
function centerOf(m) {
    const [a, b, c, d, e, f] = m || [1, 0, 0, 1, 0, 0];
    return [e + (a + c) / 2, f + (b + d) / 2];
}

// مستطيل الصورة في صورة الصفحة (بكسل) وما يظهر منه داخل الصفحة: { box: [x0, y0, x1, y1], seen: [نسب الجزء الظاهر من الصورة
// كما تظهر] | null إن لم يظهر منها شيء، cover: نسبة الصفحة التي تغطيها }. مخطط «الصفا 3» على لوحة أكبر من الصفحة أغلبها خارجها
function placement(viewport, ctm) {
    const [a, b, c, d, e, f] = ctm || [1, 0, 0, 1, 0, 0];
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => viewport.convertToViewportPoint(e + a * u + c * v, f + b * u + d * v));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const W = box[2] - box[0], H = box[3] - box[1];
    if (!(W > 0) || !(H > 0)) return { box, seen: null, cover: 0 };
    const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]), x1 = Math.min(viewport.width, box[2]), y1 = Math.min(viewport.height, box[3]);
    if (x1 - x0 < 2 || y1 - y0 < 2) return { box, seen: null, cover: 0 };
    const seen = [(x0 - box[0]) / W, (y0 - box[1]) / H, (x1 - box[0]) / W, (y1 - box[1]) / H];
    return { box, seen, cover: ((x1 - x0) * (y1 - y0)) / (viewport.width * viewport.height) };
}

// روابط الصفحة كما وضعها المطوّر (زر «موقع المشروع» إلى خرائط Google): [{ url, y }] y موضعها في صورة الصفحة
async function linksOf(page, viewport) {
    try {
        const list = await page.getAnnotations();
        return list.filter((x) => x && x.subtype === 'Link' && typeof x.url === 'string' && /^https?:[/][/]/i.test(x.url))
            .map((x) => ({ url: x.url.slice(0, 500), y: Array.isArray(x.rect) ? viewport.convertToViewportPoint(x.rect[0], (x.rect[1] + x.rect[3]) / 2)[1] : 0 }));
    } catch (_) {
        return [];
    }
}

// رؤوس أقسام صفحة التمرير من طبقة النص (sectionHeads: الدرجة الكبرى من العناوين) ← مواضعها في صورة الصفحة
async function headsOf(page, viewport) {
    try {
        const tc = await page.getTextContent();
        const items = (tc.items || []).filter((x) => x && typeof x.str === 'string' && x.str.trim() && Array.isArray(x.transform));
        const size = (x) => Math.hypot(x.transform[2], x.transform[3]) || x.height || 0;
        return sectionHeads(items.filter((x) => size(x) > 0).map((x) => ({
            y: viewport.convertToViewportPoint(x.transform[4], x.transform[5] + size(x))[1], size: size(x) * viewport.scale, text: x.str
        })));
    } catch (_) {
        return [];
    }
}

// مستطيلات نصوص الصفحة الحقيقية (طبقة النص) في صورة الصفحة: رسمٌ أغلبه نص لوحةُ كلام المطوّر لا مخطط ولا خريطة
async function textBoxes(page, viewport) {
    try {
        const tc = await page.getTextContent();
        return (tc.items || []).filter((x) => x && typeof x.str === 'string' && x.str.trim() && Array.isArray(x.transform)).map((x) => {
            const h = Math.hypot(x.transform[2], x.transform[3]) || x.height || 0;
            const r = viewport.convertToViewportRectangle([x.transform[4], x.transform[5] - h * 0.25, x.transform[4] + (x.width || 0), x.transform[5] + h]);
            return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
        });
    } catch (_) {
        return [];
    }
}

// اللون المسطّح الغالب في الصفحة خارج صورها (لون هوية المطوّر في صفحاته المرسومة)
function fillOf(canvas, rects) {
    const k = Math.min(1, 240 / canvas.width);
    const w = Math.max(1, Math.round(canvas.width * k)), h = Math.max(1, Math.round(canvas.height * k));
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (const [x0, y0, x1, y1] of rects) {
        for (let y = Math.max(0, Math.floor(y0 * k)); y < Math.min(h, Math.ceil(y1 * k)); y++) {
            for (let x = Math.max(0, Math.floor(x0 * k)); x < Math.min(w, Math.ceil(x1 * k)); x++) mask[y * w + x] = 1;
        }
    }
    return pageFill(data, w, h, mask);
}

// كثافة كل سطر في صورة الصفحة (فرق الإضاءة بين البكسلات المتجاورة على عرض مصغّر) ← y ← 0 للسطر الفارغ
function rowBusy(canvas) {
    const w = Math.max(8, Math.round(canvas.width / 4)), h = canvas.height;
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(canvas, 0, 0, w, h);
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const rows = new Float32Array(h);
    for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = 0; x + 1 < w; x++) {
            const i = (y * w + x) * 4;
            sum += Math.abs(data[i] - data[i + 4]) + Math.abs(data[i + 1] - data[i + 5]) + Math.abs(data[i + 2] - data[i + 6]);
        }
        rows[y] = sum / (w * 765) < 0.002 ? 0 : sum / (w * 765);
    }
    return (y) => rows[Math.max(0, Math.min(h - 1, y))];
}

// file ← { pageCount, pages: [{ n, blob, strip }], images: [{ blob, page, w, h, kind, tone, deep, quiet, focus, bg, detail, raster, crop, tall,
// alpha, parts, type, on }], fills: [{ page, hex, share }], links: [{ page, url }], skipped }
// blob: الصفحة للمساعد مع مصغّراتها؛ strip: فهارس صورها بترتيب أرقامها؛ on: [{ page, n }] كل صفحة ظهرت فيها الصورة ورقمها فيها.
// الصورة كما تظهر في الصفحة: الجزء الظاهر منها داخل الصفحة وحده، والشفافة بلا هوامشها الفارغة؛ ولوحة صور المطوّر (صورتان
// مؤطرتان في ملف واحد) أجزاءً (parts) كل منها صورة تُرفع وحدها، ويبقى رقمها واحداً تحت الصفحة كما رآها المساعد.
// raster: الصورة تغطي الصفحة كلها (تصميم المطوّر نفسه صورةً، وعنوانه مرسوم فيها غالباً)
// onProgress(نص) يصف المرحلة الحقيقية: «صفحة 5 من 32»
export async function readBrochurePdf(file, onProgress = () => {}) {
    const pdf = await pdfjs();
    const doc = await pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pageCount = doc.numPages;
    const pages = [];
    const images = [];
    const known = [];
    const thumbs = [];
    const fills = [];
    const links = [];
    let skipped = 0;
    let out = 0;   // صفحات البروشور كما تُرسل: الصفحة الطويلة جداً (بروشور «تمرير» بصفحة واحدة) تُقسم صفحاتٍ بمقاس A4 عند حدود أقسامها
    for (let n = 1; n <= pageCount && out < MAX_PAGES; n++) {
        onProgress('قراءة صفحة ' + n + ' من ' + Math.min(pageCount, MAX_PAGES));
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, PAGE_WIDTH / base.width) });
        const canvas = canvasOf(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        const cuts = sliceCount(canvas.width, canvas.height) > 1 ? sliceCuts(canvas.width, canvas.height, await headsOf(page, viewport), rowBusy(canvas)) : [];
        const bounds = [0, ...cuts, canvas.height];
        const parts = bounds.length - 1;
        const partOf = (y) => { let p = 0; while (p < parts - 1 && y >= bounds[p + 1]) p++; return p; };
        const strips = Array.from({ length: parts }, () => []);
        const rects = [];
        // ما تحمله كل قطعة من صور نقطية: مخطط (1)، أو نسبة ما تغطيه الصور منها
        const held = new Array(parts).fill(0);

        // صور الصفحة: الجديدة تُضاف، والمكررة (في صفحة سابقة أو مرتين هنا) تُنسب إلى الأولى، وكلها في مصغّرات الصفحة —
        // وفي الصفحة المقسومة في مصغّرات القطعة التي يقع فيها وسط الجزء الظاهر من الصورة. صورة لا يظهر منها شيء في الصفحة تُترك
        // الصورة نفسها تُعرف بملفها كاملاً (فتُنسب إلى صفحاتها كلها وتبقى أرقامها تحت كل صفحة كما هي). والشفافة (لوحة رسم أكبر
        // من الصفحة) يُرفع منها ما يظهر في الصفحة حين يكون أغلبها خارجها (أقل من 60% ظاهر)، بلا هوامشها الشفافة الواسعة؛ والصورة
        // المعتمة تبقى كاملة (ما قصّه المطوّر منها صورةٌ أيضاً). وصورة بنسبة الصفحة نفسها تغطيها صفحةُ المطوّر مرسومةً صورةً (raster):
        // عنوانه في سمائها غالباً («الصفا 3 سكاي» و«Alhayat Residence» مرسومان في بكسلات الغلاف)
        const refsOf = await imageRefs(page, pdf.OPS);
        for (const ref of refsOf) {
            const where = placement(viewport, ref.ctm);
            const vy0 = Math.max(0, where.box[1]), vy1 = Math.min(canvas.height, where.box[3]);
            const part = where.seen ? partOf((vy0 + vy1) / 2) : Math.min(parts - 1, Math.max(0, partOf(viewport.convertToViewportPoint(...centerOf(ref.ctm))[1])));
            if (out + part >= MAX_PAGES) continue;
            const strip = strips[part];
            const img = await imageObject(page, ref.name);
            if (!img || !worthKeeping(img.width, img.height)) continue;
            const raw = imageCanvas(img);
            if (!raw) continue;
            const full = upright(raw, ref.ctm);
            const pr0 = probe(full);
            if (pr0.cls.kind === 'blank') continue;
            // مستطيلات الصور التي تُرى صوراً (لا الخلفيات والطبقات): خارجها لون المطوّر ورسومه الخطية
            if (where.seen && pr0.cls.kind !== 'backdrop') rects.push([Math.max(0, where.box[0]), vy0, Math.min(canvas.width, where.box[2]), vy1]);
            if (where.seen && pr0.cls.kind === 'plan') held[part] = 1;
            else if (where.seen && pr0.cls.kind === 'photo') {
                const ph = Math.max(1, bounds[part + 1] - bounds[part]);
                held[part] += ((Math.min(canvas.width, where.box[2]) - Math.max(0, where.box[0])) * (Math.min(vy1, bounds[part + 1]) - Math.max(vy0, bounds[part]))) / (canvas.width * ph);
            }
            const seen = { kind: pr0.cls.kind, print: pr0.print, key: pr0.key, alpha: pr0.cls.alpha };
            let index = known.findIndex((k) => duplicate(k, seen));
            if (index < 0) {
                // صورة جديدة لا مكان لها في مصغّرات الصفحة لا يراها المساعد: لا تُرفع ولا تأخذ من حد الصور
                if (images.filter((x) => !x.vector).length >= MAX_IMAGES || strip.length >= MAX_PAGE_IMAGES) { skipped++; continue; }
                index = images.length;
                known.push(seen);
                let done = full, pr = pr0;
                const s = where.seen;
                if (s && pr0.cls.alpha && (s[2] - s[0]) * (s[3] - s[1]) < 0.6) {
                    const shown = cut(full, s);
                    const ps = probe(shown);
                    if (ps.cls.kind !== 'blank' && worthKeeping(shown.width, shown.height, 160)) { done = shown; pr = ps; }
                }
                if (pr.cls.alpha) {
                    const { data, w, h } = pixelsOf(done, 400);
                    const box = contentBox(data, w, h);
                    if (box && (box[2] - box[0]) * (box[3] - box[1]) < 0.5) {
                        const inner = cut(done, box);
                        if (worthKeeping(inner.width, inner.height, 160)) { done = inner; pr = probe(inner); }
                    }
                }
                thumbs.push(thumbOf(done));
                const kind = pr.cls.kind === 'blank' ? pr0.cls.kind : pr.cls.kind;
                // لوحة صور: كل صورة فيها وحدها بلا إطارها وظلّها
                let sub = null;
                if (kind === 'photo') {
                    const { data, w, h } = pixelsOf(done, 300);
                    const blocks = photoBlocks(data, w, h);
                    if (blocks) {
                        sub = [];
                        for (const b of blocks) {
                            const piece = cut(done, b);
                            if (!worthKeeping(piece.width, piece.height, 300)) { sub = null; break; }
                            const pp = probe(piece);
                            sub.push({ blob: await toBlob(piece, 'image/jpeg', 0.86), type: 'jpg', w: piece.width, h: piece.height, kind: 'photo', deep: pp.deep, quiet: pp.quiet,
                                focus: pp.focus, detail: Math.round(pp.cls.detail * 1000) / 1000, tall: piece.height > piece.width * 1.15, box: b, view: pp.view });
                        }
                    }
                }
                const png = pr.cls.alpha;
                images.push({
                    blob: await toBlob(done, png ? 'image/png' : 'image/jpeg', 0.86), type: png ? 'png' : 'jpg',
                    page: out + part + 1, w: done.width, h: done.height, kind, tone: pr.cls.tone, deep: pr.deep, quiet: pr.quiet, focus: pr.focus, bg: pr.bg,
                    detail: Math.round(pr.cls.detail * 1000) / 1000, alpha: pr.cls.alpha, view: pr.view,
                    raster: where.cover >= 0.9 && Math.abs((full.width / full.height) / (viewport.width / viewport.height) - 1) < 0.03,
                    crop: kind === 'plan' || (kind === 'photo' && !png) ? cropOf(done) : null,
                    tall: done.height > done.width * 1.15, parts: sub && sub.length >= 2 ? sub : null, on: []
                });
            }
            if (!strip.includes(index) && strip.length < MAX_PAGE_IMAGES) {
                strip.push(index);
                images[index].on.push({ page: out + part + 1, n: strip.length });
            }
        }
        // رسوم المطوّر الخطية (مخطط أو خريطة أو دور مرسوم بلا صورة): كل منطقة كثيفة صورةٌ بدقة عالية بعد صور الصفحة في مصغّراتها
        const words = refsOf.paths.length ? await textBoxes(page, viewport) : [];
        const pathsPx = refsOf.paths.map(([a, b, c, d, n]) => { const r = viewport.convertToViewportRectangle([a, b, c, d]); return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3]), n]; });
        for (const box of drawingRegions(pathsPx, canvas.width, canvas.height, rects)) {
            const part = partOf((box[1] + box[3]) / 2);
            // صفحة مخططها صورة أو صورها تغطي ربعها فأكثر: رسومها الخطية لوحات مواصفات وأيقونات ومخطط دور صغير، لا صورة تُضاف
            if (held[part] >= 0.25) continue;
            const y0 = Math.max(box[1], bounds[part]), y1 = Math.min(box[3], bounds[part + 1]);
            if (out + part >= MAX_PAGES || y1 - y0 < canvas.width * 0.08) continue;
            const strip = strips[part];
            // حدّها وحدها (12 رسماً) فلا تأخذ من حد صور البروشور النقطية
            if (images.filter((x) => x.vector).length >= MAX_DRAWINGS || strip.length >= MAX_PAGE_IMAGES) { skipped++; continue; }
            let drawn;
            try { drawn = await renderRegion(page, [box[0], y0, box[2], y1], viewport.scale); } catch (_) { continue; }
            // على ورق نظيف: ملمس الخلفية الفاتح تحت الرسم يصير أبيض
            const dctx = drawn.getContext('2d');
            const sheet = dctx.getImageData(0, 0, drawn.width, drawn.height);
            cleanPaper(sheet.data, drawn.width, drawn.height);
            dctx.putImageData(sheet, 0, 0);
            const pr = probe(drawn);
            if (pr.cls.kind === 'blank' || pr.cls.kind === 'backdrop') continue;
            const area = (box[2] - box[0]) * (y1 - y0);
            const text = Math.min(1, words.reduce((sum, [a, b, c, d]) => sum + Math.max(0, Math.min(c, box[2]) - Math.max(a, box[0])) * Math.max(0, Math.min(d, y1) - Math.max(b, y0)), 0) / area);
            const index = images.length;
            known.push({ kind: pr.cls.kind, print: pr.print, key: pr.key, alpha: false });
            thumbs.push(thumbOf(drawn));
            strip.push(index);
            images.push({ blob: await toBlob(drawn, 'image/jpeg', 0.9), type: 'jpg', page: out + part + 1, w: drawn.width, h: drawn.height,
                kind: pr.cls.kind === 'photo' ? 'photo' : 'plan', tone: 'dark', deep: null, quiet: null, focus: null, bg: pr.bg, detail: Math.round(pr.cls.detail * 1000) / 1000,
                alpha: false, raster: false, vector: true, text: Math.round(text * 100) / 100, crop: cropOf(drawn), tall: drawn.height > drawn.width * 1.15, parts: null, on: [{ page: out + part + 1, n: strip.length }] });
        }
        const pageLinks = await linksOf(page, viewport);
        for (let p = 0; p < parts && out < MAX_PAGES; p++) {
            const top = bounds[p], tall = bounds[p + 1] - bounds[p];
            const piece = parts === 1 ? canvas : canvasOf(canvas.width, tall);
            if (parts > 1) piece.getContext('2d').drawImage(canvas, 0, -top);
            out += 1;
            const fill = fillOf(piece, rects.map(([x0, y0, x1, y1]) => [x0, y0 - top, x1, y1 - top]));
            if (fill) fills.push({ page: out, ...fill });
            for (const l of pageLinks) if (l.y >= top && l.y < top + tall && !links.some((x) => x.url === l.url && x.page === out)) links.push({ page: out, url: l.url });
            pages.push({ n: out, blob: await toBlob(pageSheet(piece, strips[p].map((i) => thumbs[i])), 'image/jpeg', 0.82), strip: strips[p] });
        }
        page.cleanup();
    }
    await doc.destroy();
    return { pageCount, pages, images, fills, links: links.slice(0, 40), skipped };
}
