// اختبار حساب صور بروشور المطوّر (crm/js/brochure-media.js): الاتجاه، والنوع التقريبي، وبصمة التكرار.
// التشغيل: node tests/brochure-media.test.mjs   أو   deno run tests/brochure-media.test.mjs
import { uprightMatrix, pageRotation, multiply, classifyPixels, deepTone, quietSide, brochureTone, planCrop, fingerprint, sameImage, pixelKey, duplicate, worthKeeping } from '../crm/js/brochure-media.js';
import { sliceCount } from '../crm/js/brochure-media.js';
import { photoBlocks, contentBox, focusOf, brandColour, pageFill, sliceCuts, borderColour, drawingRegions, sectionHeads, sameView, viewPrint, cleanPaper } from '../crm/js/brochure-media.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// ---- الاتجاه: مصفوفات الرسم في فضاء الـPDF (y للأعلى) ← تحويل لوحة الرسم الذي يُظهر الصورة كما في الصفحة ----
const w = 500, h = 700;
const um = (m) => JSON.stringify(uprightMatrix(m, w, h));
t('upright image: drawn as it is', um([w, 0, 0, h, 10, 20]) === '{"width":500,"height":700,"matrix":[1,0,0,1,0,0]}', um([w, 0, 0, h, 10, 20]));
// صفحة 14 من بروشور لامير سيرين: PyMuPDF يعطي مصفوفة العرض [0 -387.6 548.2 0]، أي [0 w -h 0] في فضاء الـPDF، والمخطط قائم في الصفحة
t('turned 90° counter-clockwise by the page (the Lamer Serin plans): its top goes left, landscape', um([0, w, -h, 0, 0, 0]) === '{"width":700,"height":500,"matrix":[0,-1,1,0,0,500]}', um([0, w, -h, 0, 0, 0]));
t('upside down: half a turn', um([-w, 0, 0, -h, 0, 0]) === '{"width":500,"height":700,"matrix":[-1,0,0,-1,500,700]}');
t('turned 90° clockwise: its top goes right', um([0, -w, h, 0, 0, 0]) === '{"width":700,"height":500,"matrix":[0,1,-1,0,700,0]}');
t('mirrored by the page: mirrored the same way', um([-w, 0, 0, h, 0, 0]) === '{"width":500,"height":700,"matrix":[-1,0,0,1,500,0]}');
t('a slight tilt rounds to the nearest quarter', um([w, 20, -28, h, 0, 0]) === um([w, 0, 0, h, 0, 0]));
t('no matrix or a degenerate one: as it is', um(null) === um([w, 0, 0, h]) && um([0, 0, 0, 0]) === um([w, 0, 0, h]) && um([w, 0, w, 0]) === um([w, 0, 0, h]));
t('a page rotated 90° (/Rotate) turns an upright image clockwise', um(multiply(pageRotation(90), [w, 0, 0, h, 0, 0])) === um([0, -w, h, 0, 0, 0]) && um(multiply(pageRotation(0), [w, 0, 0, h, 0, 0])) === um([w, 0, 0, h]));
t('multiply: identity keeps a matrix', JSON.stringify(multiply([1, 0, 0, 1, 0, 0], [2, 0, 0, 3, 4, 5])) === '[2,0,0,3,4,5]');
t('multiply: translate then scale', JSON.stringify(multiply([2, 0, 0, 2, 10, 10], [1, 0, 0, 1, 5, 5])) === '[2,0,0,2,20,20]');

// ---- النوع ----
function image(size, paint) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const [r, g, b, a] = paint(x, y);
        const i = (y * size + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
    return data;
}
const S = 60;
const lines = (x, y) => x % 12 === 0 || y % 15 === 0;
const lightPlan = image(S, (x, y) => (lines(x, y) ? [245, 245, 245, 255] : [0, 0, 0, 0]));
const darkPlan = image(S, (x, y) => (lines(x, y) ? [30, 30, 30, 255] : [255, 255, 255, 255]));
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed % 256; };
const photo = image(S, () => [rnd(), rnd(), rnd(), 255]);
const sky = image(S, (x, y) => [80 + y, 130 + y, 200, 255]);
const black = image(S, () => [0, 0, 0, 255]);
const empty = image(S, () => [0, 0, 0, 0]);

t('white lines on transparent → plan, light (shown on dark)', (({ kind, tone, alpha }) => kind === 'plan' && tone === 'light' && alpha)(classifyPixels(lightPlan, S, S)), classifyPixels(lightPlan, S, S));
t('dark lines on white → plan, dark (shown on paper)', classifyPixels(darkPlan, S, S).kind === 'plan' && classifyPixels(darkPlan, S, S).tone === 'dark');
t('noisy colour → photo', classifyPixels(photo, S, S).kind === 'photo');
// [2026-10-28] تدرّج ناعم بلا حافة حادة واحدة طبقةٌ لونية (خلفية المطوّر)، لا صورة تُطبع ولا فارغة تُحذف من المصغّرات
t('a smooth gradient with no sharp edge is a backdrop (a colour wash), not blank', classifyPixels(sky, S, S).kind === 'backdrop', classifyPixels(sky, S, S));
t('solid black (the empty rectangle in the Lamer brochure) → blank', classifyPixels(black, S, S).kind === 'blank');
t('fully transparent → blank', classifyPixels(empty, S, S).kind === 'blank');
t('bad input → blank', classifyPixels(null, 0, 0).kind === 'blank' && classifyPixels(new Uint8ClampedArray(8), 10, 10).kind === 'blank');

// ---- التكرار ----
const grad = Array.from({ length: 64 }, (_, i) => (i % 8) * 30 + Math.floor(i / 8) * 2);
const grad2 = grad.map((v, i) => v + (i === 5 ? 9 : 1));
const other = grad.slice().reverse();
t('fingerprint: 64 bits', fingerprint(grad).length === 64 && fingerprint([1, 2]) === '');
t('the same picture recompressed matches', sameImage(fingerprint(grad), fingerprint(grad2)));
t('a different picture does not', !sameImage(fingerprint(grad), fingerprint(other)));
t('empty prints never match', !sameImage('', '') && !sameImage(null, fingerprint(grad)));

const lightPrint = fingerprint(Array(64).fill(255));   // خطوط فاتحة على شفاف فوق الأبيض: رمادي واحد، بصمة كلها أصفار
const planA = { kind: 'plan', print: lightPrint, key: pixelKey(lightPlan) }, planB = { kind: 'plan', print: lightPrint, key: pixelKey(darkPlan) };
t('two different light plans share a print and are both kept', sameImage(planA.print, planB.print) && !duplicate(planA, planB));
t('the same plan drawn twice is one image', duplicate(planA, { kind: 'plan', print: lightPrint, key: pixelKey(lightPlan.slice()) }));
t('a recompressed photo is one image, a plan with the same print is not',
    duplicate({ kind: 'photo', print: fingerprint(grad), key: 'a' }, { kind: 'photo', print: fingerprint(grad2), key: 'b' })
    && !duplicate({ kind: 'photo', print: fingerprint(grad), key: 'a' }, { kind: 'plan', print: fingerprint(grad2), key: 'b' }));
t('pixel key: rounding noise matches, a real change does not', pixelKey(new Uint8Array([200, 100, 50, 255])) === pixelKey(new Uint8Array([201, 102, 48, 255]))
    && pixelKey(new Uint8Array([200, 100, 50, 255])) !== pixelKey(new Uint8Array([200, 140, 50, 255])) && pixelKey(null) === pixelKey(new Uint8Array(0)));

t('icons and small logos are skipped, renders and plans kept', !worthKeeping(300, 900) && worthKeeping(670, 1191) && worthKeeping(1448, 2048, 600) && !worthKeeping(899, 499));

// ---- عائلة لون المشروع (المالك 2026-10-25: الألوان حرة لكل مشروع) ----
const forest = image(S, (x, y) => ((x + y) % 5 ? [34, 78, 52, 255] : [230, 230, 225, 255]));
const wood = image(S, (x, y) => (y % 3 ? [120, 78, 40, 255] : [210, 200, 190, 255]));
const grey = image(S, (x, y) => [90 + (x % 40), 90 + (x % 40), 92 + (x % 40), 255]);
t('deepTone: greenery → forest, wood and stone → bronze', deepTone(forest, S, S) === 'forest' && deepTone(wood, S, S) === 'bronze', [deepTone(forest, S, S), deepTone(wood, S, S)]);
t('deepTone: a grey render, a pale sky or bad input has no family', deepTone(grey, S, S) === null && deepTone(image(S, () => [235, 240, 248, 255]), S, S) === null && deepTone(null, 0, 0) === null);
t('brochureTone: each image votes once per page it is on; the developer backgrounds outvote one warm photo', brochureTone([
    { deep: 'bronze', on: [{ page: 3 }] }, { deep: 'bronze', on: [{ page: 7 }] },
    { deep: 'forest', on: [{ page: 2 }, { page: 4 }, { page: 5 }] }, { deep: null, on: [{ page: 6 }] }, null]) === 'forest'
    && brochureTone([]) === null && brochureTone(null) === null);

// ---- الجهة الأهدأ أسفل الصورة لكتلة الكلام (2026-10-27: كتلة صفحة الموقع لا تغطي الحي المضاء) ----
const litRight = image(S, (x, y) => (x > S * 0.6 && y > S * 0.4 ? ((x * 7 + y * 3) % 5 ? [250, 235, 200, 255] : [40, 30, 20, 255]) : [45, 40, 35, 255]));
const litLeft = image(S, (x, y) => (x < S * 0.4 && y > S * 0.4 ? ((x * 7 + y * 3) % 5 ? [250, 235, 200, 255] : [40, 30, 20, 255]) : [45, 40, 35, 255]));
t('quietSide: the text block goes to the calm side, away from the bright busy subject; the right when both are alike',
    quietSide(litRight, S, S) === 'left' && quietSide(litLeft, S, S) === 'right' && quietSide(image(S, () => [60, 60, 60, 255]), S, S) === 'right',
    [quietSide(litRight, S, S), quietSide(litLeft, S, S)]);
t('quietSide: bad input gives nothing', quietSide(null, 0, 0) === null && quietSide(new Uint8ClampedArray(8), 10, 10) === null);

// ---- قصّ المخطط: إطار المطوّر، مخطط الوحدة، خط فاصل، مخطط الدور الكثيف ونص تحته ----
const PW = 200, PH = 140;
const sheet = new Uint8ClampedArray(PW * PH * 4).fill(255);
const dot = (x, y) => { const i = (y * PW + x) * 4; sheet[i] = sheet[i + 1] = sheet[i + 2] = 20; };
for (let x = 4; x <= 195; x++) { dot(x, 4); dot(x, 135); }
for (let y = 4; y <= 135; y++) { dot(4, y); dot(195, y); }
for (let x = 15; x <= 85; x++) { dot(x, 15); dot(x, 125); dot(x, 60); }
for (let y = 15; y <= 125; y++) { dot(15, y); dot(85, y); dot(50, y); }
for (let y = 10; y <= 130; y++) dot(100, y);
for (let y = 20; y <= 80; y++) for (let x = 115; x <= 185; x++) if (x % 4 === 0 || y % 4 === 0) dot(x, y);
for (let y = 100; y <= 110; y++) for (let x = 130; x <= 170; x++) if (x % 3) dot(x, y);
const pc = planCrop(sheet, PW, PH);
const near = (v, want) => Math.abs(v - want) < 0.03;
t('planCrop: the unit plan alone, without the frame', pc && near(pc.unit[0], 15 / PW) && near(pc.unit[2], 86 / PW) && near(pc.unit[1], 15 / PH) && near(pc.unit[3], 126 / PH), pc);
t('planCrop: the dense floor plan beside it is the key, without the text under it', pc && pc.key && near(pc.key[0], 115 / PW) && near(pc.key[2], 186 / PW) && pc.key[3] < 95 / PH, pc);
const lone = new Uint8ClampedArray(PW * PH * 4).fill(255);
for (let x = 40; x <= 160; x++) { const a = (30 * PW + x) * 4, b = (110 * PW + x) * 4; lone[a] = lone[a + 1] = lone[a + 2] = 0; lone[b] = lone[b + 1] = lone[b + 2] = 0; }
for (let y = 30; y <= 110; y++) for (const x of [40, 100, 160]) { const a = (y * PW + x) * 4; lone[a] = lone[a + 1] = lone[a + 2] = 0; }
const lc = planCrop(lone, PW, PH);
t('planCrop: one plan without a frame is trimmed to itself, with no key', lc && lc.key === null && near(lc.unit[0], 40 / PW) && near(lc.unit[2], 161 / PW), lc);
t('planCrop: blank, tiny or bad input gives nothing', planCrop(new Uint8ClampedArray(PW * PH * 4).fill(255), PW, PH) === null && planCrop(null, 0, 0) === null && planCrop(new Uint8ClampedArray(16), 2, 2) === null);

t('a normal page is one piece; a scroll page is cut into A4 pieces under the model limit', sliceCount(1100, 1556) === 1 && sliceCount(1100, 619) === 1
    && sliceCount(1100, 20001) === 13 && Math.ceil(20001 / sliceCount(1100, 20001)) < 8000 && sliceCount(0, 500) === 1 && sliceCount(1100, 2200) === 1 && sliceCount(1100, 2300) === 2);

// ---- قواعد عامة من مراجعة أربعة بروشورات أخرى (2026-10-28) ----
const W2 = 80, H2 = 60;
function canvas(w, h, paint) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [r, g, b, a] = paint(x, y);
        const i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
    return data;
}
// مخطط بخطوط ملونة رفيعة على شفاف (خطوط القياس الحمراء وأرقام الدرج الخضراء): رسم لا صورة
const coloured = canvas(W2, H2, (x, y) => (x % 10 === 0 ? [200, 30, 30, 255] : y % 12 === 0 ? [30, 150, 60, 255] : [0, 0, 0, 0]));
t('classify: thin coloured lines on transparent are a plan, whatever their colour', classifyPixels(coloured, W2, H2).kind === 'plan', classifyPixels(coloured, W2, H2));
// طبقة لونية شفافة بلون واحد متدرّج (تدرّج المطوّر فوق صورته)، وظل ناعم على أبيض: ليست صوراً
const overlay = canvas(W2, H2, (x, y) => [30, 60, 50, y > 20 ? Math.round(((y - 20) / 40) * 200) : 0]);
const shadow = canvas(W2, H2, (x, y) => { const v = 255 - Math.round(40 * Math.exp(-((x - 40) ** 2 + (y - 30) ** 2) / 300)); return [v, v, v, 255]; });
t('classify: a one-colour transparent ramp and a soft shadow are backdrops, never photos or plans', classifyPixels(overlay, W2, H2).kind === 'backdrop' && classifyPixels(shadow, W2, H2).kind === 'backdrop',
    [classifyPixels(overlay, W2, H2), classifyPixels(shadow, W2, H2)]);
// لوحة صور: صورتان مؤطرتان بلا شيء بينهما على شفاف (صفحة معرض «الصفا 3»)
let s2 = 3;
const noise = () => { s2 = (s2 * 16807) % 2147483647; return s2 % 256; };
const collage = canvas(W2, H2, (x, y) => ((x >= 10 && x < 70 && ((y >= 4 && y < 27) || (y >= 33 && y < 56))) ? [noise(), noise(), noise(), 255] : [0, 0, 0, 0]));
const blocks = photoBlocks(collage, W2, H2);
t('photoBlocks: a collage of two framed photos gives each photo, inset from its frame', blocks && blocks.length === 2 && blocks[0][1] < 0.1 && blocks[1][1] > 0.5
    && blocks.every((b) => b[0] > 10 / W2 && b[2] < 70 / W2), blocks);
const single = canvas(W2, H2, (x, y) => (x >= 10 && x < 70 && y >= 4 && y < 56 ? [noise(), noise(), noise(), 255] : [0, 0, 0, 0]));
t('photoBlocks: one framed photo, a plan or bad input is not a collage', photoBlocks(single, W2, H2) === null && photoBlocks(coloured, W2, H2) === null && photoBlocks(null, 0, 0) === null);
t('contentBox: a small drawing on a large transparent canvas is trimmed to it; a full image is not',
    (() => { const b = contentBox(canvas(W2, H2, (x, y) => (x >= 40 && x < 56 && y >= 30 && y < 44 ? [20, 20, 20, 255] : [0, 0, 0, 0])), W2, H2); return b && b[0] > 0.45 && b[2] < 0.72 && b[1] > 0.45; })()
    && contentBox(photo, S, S) === null);
// السماء لا تصوّت للون: نصف علوي سماء زرقاء ونصف سفلي خضرة ← أخضر لا كحلي
const skyAndGarden = canvas(W2, H2, (x, y) => (y < H2 / 2 ? [80, 130, 200, 255] : (x + y) % 4 ? [40, 90, 50, 255] : [200, 200, 190, 255]));
t('deepTone: the blue sky over a building does not vote; the garden does', deepTone(skyAndGarden, W2, H2) === 'forest', deepTone(skyAndGarden, W2, H2));
t('brochureTone: weights count, navy and teal are one blue against warm, and backdrops or plans never vote', brochureTone([
    { deep: 'bronze', weight: 13 * 0.1 + 1 }, { deep: 'navy', weight: 1.5 }, { deep: 'teal', weight: 1 }, { deep: 'forest', kind: 'backdrop', weight: 9 }, { deep: 'plum', kind: 'plan', weight: 9 }]) === 'navy'
    && brochureTone([{ deep: 'bronze', weight: 2 }, { deep: 'forest', weight: 2 }], 'forest') === 'forest');
t('brandColour: a flat colour on two or more pages is the developer identity, with a pale tint of it; one page is not', (() => {
    const b = brandColour([{ page: 1, hex: '#212C2A', share: 0.96 }, { page: 9, hex: '#23302D', share: 0.77 }, { page: 12, hex: '#F4A157', share: 0.01 }]);
    return b && b.deep === '#212C2A' && /^#[0-9A-F]{6}$/.test(b.pale) && b.pages.join() === '1,9';
})() && brandColour([{ page: 1, hex: '#212C2A', share: 0.96 }]) === null && brandColour(null) === null);
t('pageFill: the main flat colour outside the images; a white page has none', (() => {
    const page = canvas(W2, H2, (x) => (x < 50 ? [33, 44, 42, 255] : [80, 130, 200, 255]));
    const mask = new Uint8Array(W2 * H2); for (let y = 0; y < H2; y++) for (let x = 50; x < W2; x++) mask[y * W2 + x] = 1;
    const f = pageFill(page, W2, H2, mask);
    return f && f.hex === '#212C2A' && Math.abs(f.share - 50 / 80) < 0.02 && pageFill(canvas(W2, H2, () => [255, 255, 255, 255]), W2, H2) === null;
})());
// قصّ المخطط: نصفاه يفصلهما فراغ (جدران رمادية فاتحة) يبقيان معاً، وأسطر النص تحته تُترك؛ والمخطط المضيء على لوح كحلي يُقصّ كذلك
const twoHalves = new Uint8ClampedArray(PW * PH * 4).fill(255);
const ink = (buf, x, y, v) => { const i = (y * PW + x) * 4; buf[i] = buf[i + 1] = buf[i + 2] = v; };
for (const [y0, y1] of [[10, 70], [80, 115]]) {
    for (let x = 60; x <= 140; x++) { ink(twoHalves, x, y0, 30); ink(twoHalves, x, y1, 30); }
    for (let y = y0; y <= y1; y++) for (const x of [60, 100, 140]) ink(twoHalves, x, y, 30);
}
for (let x = 70; x <= 130; x++) if (x % 3) { ink(twoHalves, x, 125, 30); ink(twoHalves, x, 126, 30); }
const th = planCrop(twoHalves, PW, PH);
t('planCrop: a plan split by a light gap keeps both halves; a text line under it is left out', th && th.unit[1] < 12 / PH && th.unit[3] > 114 / PH && th.unit[3] < 124 / PH, th);
const board = new Uint8ClampedArray(PW * PH * 4);
for (let i = 0; i < PW * PH; i++) { board[i * 4] = 20; board[i * 4 + 1] = 33; board[i * 4 + 2] = 58; board[i * 4 + 3] = 255; }
const glow = (x, y) => { const i = (y * PW + x) * 4; board[i] = 240; board[i + 1] = 210; board[i + 2] = 150; };
for (let x = 60; x <= 140; x++) { glow(x, 15); glow(x, 90); glow(x, 50); }
for (let y = 15; y <= 90; y++) { glow(60, y); glow(140, y); glow(100, y); }
for (let x = 70; x <= 130; x++) if (x % 3) { glow(x, 110); glow(x, 120); }
const bc = planCrop(board, PW, PH);
t('planCrop: glowing lines on a navy board are the drawing; the printed specs under it are left out', bc && bc.unit[1] < 17 / PH && bc.unit[3] > 89 / PH && bc.unit[3] < 105 / PH, bc);
t('borderColour: an even board and its brightness', (() => { const b = borderColour(board, PW, PH); return b && b.even && b.lum < 0.2; })());
t('focusOf: the detail sits low under a plain sky', (() => { const f = focusOf(canvas(W2, H2, (x, y) => (y < 40 ? [150, 190, 230, 255] : (x + y) % 2 ? [20, 20, 20, 255] : [230, 230, 230, 255])), W2, H2); return f && f[1] > 0.6; })());
// الصور الشفافة لا تُدمج ببصمتها (لوحتا معرض بالتخطيط نفسه)، والمعتمة بضغط آخر تُدمج كما كانت
t('duplicate: transparent images never merge by their print, only by their pixels; opaque recompressions still merge',
    !duplicate({ kind: 'photo', alpha: true, print: fingerprint(grad), key: 'a' }, { kind: 'photo', alpha: true, print: fingerprint(grad2), key: 'b' })
    && duplicate({ kind: 'photo', alpha: true, print: fingerprint(grad), key: 'a' }, { kind: 'photo', alpha: true, print: fingerprint(other), key: 'a' })
    && duplicate({ kind: 'photo', print: fingerprint(grad), key: 'a' }, { kind: 'photo', print: fingerprint(grad2), key: 'b' }));
// صفحة التمرير تُقطع فوق عناوين أقسامها، في سطر هادئ، وكل قطعة بين 0.6 و1.4 من A4
const tallW = 1100, tallH = 20000, a4 = tallW * Math.SQRT2;
const heads = [1500, 3050, 4600, 6200, 7700, 9300, 10900, 12500, 14000, 15600, 17200, 18700];
const cuts = sliceCuts(tallW, tallH, heads, (y) => (heads.some((h) => y >= h - 6 && y <= h + 40) ? 1 : 0));
const pieces = [0, ...cuts, tallH].slice(1).map((v, i, arr) => v - (i ? arr[i - 1] : 0));
t('sliceCuts: a scroll page keeps its count of A4 pieces, each cut moved just above a section heading, never through one', cuts.length === sliceCount(tallW, tallH) - 1
    && cuts.every((c) => heads.some((h) => c < h && c > h - a4 * 0.07)) && pieces.every((p) => p >= a4 * 0.5 && p <= a4 * 1.7), { cuts, pieces: pieces.map((p) => (p / a4).toFixed(2)) });
t('sliceCuts: without headings the cuts stay near their even places, in a calm row', (() => {
    const c = sliceCuts(tallW, tallH, [], (y) => (y % 250 < 30 ? 0 : 1));
    return c.length === sliceCount(tallW, tallH) - 1 && c.every((y, k) => Math.abs(y - ((k + 1) * tallH) / sliceCount(tallW, tallH)) <= a4 * 0.1 + 1 && y % 250 < 30);
})());
t('sliceCuts: a normal page is not cut', sliceCuts(1100, 1556, [], null).length === 0);
// رؤوس الأقسام: الدرجة الكبرى من العناوين وحدها. سطر الغلاف تحت اسمه («افراغ فوري» بخط أصغر) والأرقام الكبيرة («20» سنة) والأسعار
// ليست رؤوساً، وكلمات السطر الواحد رأس واحد («مشروع» ثم «كيان الريان» في سطر الغلاف)
const textItems = [
    ...Array.from({ length: 40 }, (_, k) => ({ y: 2000 + k * 300, size: 24, text: 'غرفة نوم' })),
    { y: 1264, size: 94, text: 'مشروع' }, { y: 1271, size: 90, text: 'كيان الريان' }, { y: 1432, size: 57, text: 'افراغ فوري' },
    { y: 1735, size: 90, text: 'موقع' }, { y: 1742, size: 87, text: 'المشروع' }, { y: 4304, size: 90, text: 'نموذج F' }, { y: 5878, size: 90, text: 'نموذج G' },
    { y: 5640, size: 42, text: 'السعر 860 ألف ريال' }, { y: 9300, size: 92, text: '20' }, { y: 9600, size: 92, text: '25' }
];
const sh = sectionHeads(textItems);
t('sectionHeads: only the top tier of headings starts a section; the cover line under the name, big numbers and prices do not; one line is one head',
    JSON.stringify(sh) === '[1264,1735,4304,5878]', sh);
t('sectionHeads: no text layer, no heads', sectionHeads([]).length === 0 && sectionHeads(null).length === 0);
// اللقطة نفسها من زاوية قريبة: 10 خانات مختلفة من 64 على الأكثر
const bits = (n) => '1'.repeat(n) + '0'.repeat(64 - n);
t('sameView: two shots of one view differ in a few cells of 64; different photos differ in more; bad prints never match',
    sameView(bits(0), bits(6)) && sameView(bits(0), bits(10)) && !sameView(bits(0), bits(11)) && !sameView(bits(0), null) && !sameView('101', '101'));
// بصمة اللقطة من متوسطات خاناتها: اللقطة نفسها مصغّرةً بمقاس آخر وبإضاءة أخف قليلاً تبقى المنظر نفسه، ومنظر آخر لا
const scene = (W, H, shift, lift) => canvas(W, H, (x, y) => {
    const v = y < H * (0.42 + shift) ? 210 : x < W * 0.3 ? 70 : (x + y) % 5 ? 120 : 200;
    return [v + lift, v + lift, v + lift, 255];
});
t('viewPrint: one view at another size and exposure keeps its print; another view does not; bad input gives none', (() => {
    const a = viewPrint(scene(96, 72, 0, 0), 96, 72), b = viewPrint(scene(80, 60, 0.02, 12), 80, 60);
    const c = viewPrint(canvas(96, 72, (x) => (x < 48 ? [40, 40, 40, 255] : [230, 230, 230, 255])), 96, 72);
    return a && a.length === 64 && sameView(a, b) && !sameView(a, c) && viewPrint(null, 0, 0) === null;
})());
// الرسم المقصوص من صفحته على ورق نظيف: الملمس الرمادي الفاتح يبيضّ، والخط الداكن ولون حدود الوحدة يبقيان
t('cleanPaper: a light grey paper texture under a drawing turns white; dark lines and coloured unit outlines stay', (() => {
    const px = new Uint8ClampedArray([215, 215, 212, 255, 40, 40, 40, 255, 200, 60, 60, 255, 150, 150, 150, 255]);
    const n = cleanPaper(px, 4, 1);
    return n === 2 && px[0] === 255 && px[2] === 255 && px[4] === 40 && px[8] === 200 && px[9] === 60 && px[12] > 150 && px[12] < 255 && cleanPaper(null, 0, 0) === 0;
})());
// لون المطوّر الحاد صفحةً كاملة يهدأ بدرجته نفسها؛ والهادئ يبقى كما طُبع
t('brandColour: a vivid developer colour becomes a calm deep of the same hue for whole pages; a calm one stays as printed', (() => {
    const b = brandColour([{ page: 14, hex: '#053F32', share: 0.5 }, { page: 15, hex: '#053F32', share: 0.5 }]);
    const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(b && b.deep);
    if (!m) return false;
    const [r, g, bl] = m.slice(1).map((x) => parseInt(x, 16) / 255);
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl), l = (max + min) / 2, s = (max - min) / (1 - Math.abs(2 * l - 1));
    return b.hex === '#053F32' && s <= 0.36 && l >= 0.145 && l <= 0.255 && g > r && g > bl;
})() && brandColour([{ page: 1, hex: '#323245', share: 0.4 }, { page: 2, hex: '#323245', share: 0.4 }]).deep === '#323245');

// رسوم خطية: كتلة كثيفة من المسارات منطقةٌ؛ وسطر عنوان مرسوم خطوطاً، وخلفية تغطي الصفحة، ورسم فوق صورة نقطية ليست رسماً
const PWd = 1100, PHd = 1556;
const plan2 = [];
for (let y = 300; y < 900; y += 12) for (let x = 200; x < 800; x += 15) plan2.push([x, y, x + 14, y + 2, 2]);
const heading = [];
for (let x = 100; x < 1000; x += 8) heading.push([x, 100, x + 7, 140, 6]);
const regions = drawingRegions([...plan2, ...heading, [0, 0, PWd, PHd, 4]], PWd, PHd, []);
t('drawingRegions: a dense drawing is one region; a drawn heading line and a page background are not', regions.length === 1
    && regions[0][0] <= 200 && regions[0][2] >= 800 && regions[0][1] <= 300 && regions[0][3] >= 890 && regions[0][1] > 140, regions);
t('drawingRegions: lines drawn over a raster photo are not a drawing; bad input gives nothing', drawingRegions(plan2, PWd, PHd, [[150, 250, 850, 950]]).length === 0
    && drawingRegions(null, PWd, PHd).length === 0 && drawingRegions(plan2, 0, 0).length === 0);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
