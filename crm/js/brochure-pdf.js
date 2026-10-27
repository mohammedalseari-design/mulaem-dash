// قراءة بروشور المطوّر (PDF) في المتصفح بـ pdf.js: كل صورة ومخطط فيه ملفاً مستقلاً كما تظهر في الصفحة، بلا تكرار ولا صور
// فارغة، وكل صفحة صورةً للمساعد وتحتها صورها مصغّراتٍ مرقّمة يحكم على كل منها برقمها.
// الحساب على البكسل في brochure-media.js (مختبَر وحده)، وهنا الرسم والملفات فقط.
// الملف لا يغادر المتصفح هنا: الرفع إلى المخزن وإنشاء طلب المساعد في brochure.js.

import { uprightMatrix, pageRotation, multiply, classifyPixels, deepTone, quietSide, planCrop, fingerprint, pixelKey, duplicate, worthKeeping, sliceCount } from './brochure-media.js';

// نسخة مثبّتة من jsDelivr (كمكتبة supabase-js في الصفحة). العامل من نطاق آخر: pdf.js يلفّه بنفسه
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
export const MAX_PAGES = 36;          // حد طلب البروشور 40 ملفاً (036)
export const MAX_IMAGES = 64;
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

// نسخة مصغّرة بكسلاتها للحكم على النوع وبصمة التكرار
function probe(canvas) {
    const s = 96;
    const k = Math.min(1, s / Math.max(canvas.width, canvas.height));
    const c = canvasOf(canvas.width * k, canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const g = canvasOf(8, 8);
    const gx = g.getContext('2d');
    gx.fillStyle = '#fff';
    gx.fillRect(0, 0, 8, 8);
    gx.drawImage(canvas, 0, 0, 8, 8);
    const gp = gx.getImageData(0, 0, 8, 8).data;
    const gray = [];
    for (let i = 0; i < 64; i++) gray.push(0.299 * gp[i * 4] + 0.587 * gp[i * 4 + 1] + 0.114 * gp[i * 4 + 2]);
    const cls = classifyPixels(px, c.width, c.height);
    // عائلة لون الصورة (ألوان البروشور): للصور والخلفيات وحدها، اسماً من قائمة ثابتة
    // والجهة الأهدأ أسفل الصورة لكتلة كلام فوقها (صفحة كاملة الصورة)
    const photo = cls.kind === 'photo';
    return { cls, deep: photo ? deepTone(px, c.width, c.height) : null, quiet: photo ? quietSide(px, c.width, c.height) : null,
        print: fingerprint(gray), key: c.width + 'x' + c.height + ':' + pixelKey(px) };
}

// قصّ المخطط (مخطط الوحدة ومخطط الدور بلا الإطار والنص المكرر) من نسخة بـ 400 بكسل: الخطوط الرفيعة تبقى فيها
function cropOf(canvas) {
    const k = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
    const c = canvasOf(canvas.width * k, canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return planCrop(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

// مراجع الصور في صفحة مع مصفوفة رسم كل منها، من قائمة أوامر الرسم (مع حفظ الحالة واسترجاعها والنماذج المتداخلة)
async function imageRefs(page, OPS) {
    const ops = await page.getOperatorList();
    const refs = [];
    const base = pageRotation(page.rotate);
    let ctm = base;
    const stack = [];
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
    }
    return refs;
}

function imageObject(page, name) {
    const store = String(name).startsWith('g_') ? page.commonObjs : page.objs;
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 8000);
        try { store.get(name, (img) => { clearTimeout(timer); resolve(img || null); }); } catch (_) { clearTimeout(timer); resolve(null); }
    });
}

// مصغّرة الصورة لصفحة المساعد: ارتفاع ثابت
const THUMB_H = 170;
function thumbOf(canvas) {
    const k = Math.min(THUMB_H / canvas.height, 560 / canvas.width);
    const c = canvasOf(canvas.width * k, canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
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

// file ← { pageCount, pages: [{ n, blob, strip }], images: [{ blob, page, w, h, kind, tone, deep, quiet, crop, tall, type, on }], skipped }
// blob: الصفحة للمساعد مع مصغّراتها؛ strip: فهارس صورها بترتيب أرقامها؛ on: [{ page, n }] كل صفحة ظهرت فيها الصورة ورقمها فيها
// onProgress(نص) يصف المرحلة الحقيقية: «صفحة 5 من 32»
export async function readBrochurePdf(file, onProgress = () => {}) {
    const pdf = await pdfjs();
    const doc = await pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pageCount = doc.numPages;
    const pages = [];
    const images = [];
    const known = [];
    const thumbs = [];
    let skipped = 0;
    let out = 0;   // صفحات البروشور كما تُرسل: الصفحة الطويلة جداً (بروشور «تمرير» بصفحة واحدة) تُقسم صفحاتٍ بمقاس A4
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
        const parts = sliceCount(canvas.width, canvas.height);
        const sliceH = Math.ceil(canvas.height / parts);
        const strips = Array.from({ length: parts }, () => []);

        // صور الصفحة: الجديدة تُضاف، والمكررة (في صفحة سابقة أو مرتين هنا) تُنسب إلى الأولى، وكلها في مصغّرات الصفحة —
        // وفي الصفحة المقسومة في مصغّرات القطعة التي يقع فيها وسط الصورة
        for (const ref of await imageRefs(page, pdf.OPS)) {
            const [, cy] = viewport.convertToViewportPoint(...centerOf(ref.ctm));
            const part = Math.min(parts - 1, Math.max(0, Math.floor(cy / sliceH)));
            if (out + part >= MAX_PAGES) continue;
            const strip = strips[part];
            const img = await imageObject(page, ref.name);
            if (!img || !worthKeeping(img.width, img.height)) continue;
            const raw = imageCanvas(img);
            if (!raw) continue;
            const done = upright(raw, ref.ctm);
            const { cls, deep, quiet, print, key } = probe(done);
            if (cls.kind === 'blank') continue;
            const seen = { kind: cls.kind, print, key };
            let index = known.findIndex((k) => duplicate(k, seen));
            if (index < 0) {
                // صورة جديدة لا مكان لها في مصغّرات الصفحة لا يراها المساعد: لا تُرفع ولا تأخذ من حد الصور
                if (images.length >= MAX_IMAGES || strip.length >= MAX_PAGE_IMAGES) { skipped++; continue; }
                index = images.length;
                known.push(seen);
                thumbs.push(thumbOf(done));
                const png = cls.alpha;
                images.push({
                    blob: await toBlob(done, png ? 'image/png' : 'image/jpeg', 0.86), type: png ? 'png' : 'jpg',
                    page: out + part + 1, w: done.width, h: done.height, kind: cls.kind, tone: cls.tone, deep, quiet, crop: cls.kind === 'plan' ? cropOf(done) : null,
                    tall: done.height > done.width * 1.15, on: []
                });
            }
            if (!strip.includes(index) && strip.length < MAX_PAGE_IMAGES) {
                strip.push(index);
                images[index].on.push({ page: out + part + 1, n: strip.length });
            }
        }
        for (let p = 0; p < parts && out < MAX_PAGES; p++) {
            const piece = parts === 1 ? canvas : canvasOf(canvas.width, Math.min(sliceH, canvas.height - p * sliceH));
            if (parts > 1) piece.getContext('2d').drawImage(canvas, 0, -p * sliceH);
            out += 1;
            pages.push({ n: out, blob: await toBlob(pageSheet(piece, strips[p].map((i) => thumbs[i])), 'image/jpeg', 0.82), strip: strips[p] });
        }
        page.cleanup();
    }
    await doc.destroy();
    return { pageCount, pages, images, skipped };
}
