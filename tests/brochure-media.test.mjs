// اختبار حساب صور بروشور المطوّر (crm/js/brochure-media.js): الاتجاه، والنوع التقريبي، وبصمة التكرار.
// التشغيل: node tests/brochure-media.test.mjs   أو   deno run tests/brochure-media.test.mjs
import { uprightMatrix, pageRotation, multiply, classifyPixels, deepTone, quietSide, brochureTone, planCrop, fingerprint, sameImage, pixelKey, duplicate, worthKeeping } from '../crm/js/brochure-media.js';
import { sliceCount } from '../crm/js/brochure-media.js';

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

t('white lines on transparent → plan, light (shown on dark)', JSON.stringify(classifyPixels(lightPlan, S, S)) === '{"kind":"plan","tone":"light","alpha":true}', classifyPixels(lightPlan, S, S));
t('dark lines on white → plan, dark (shown on paper)', classifyPixels(darkPlan, S, S).kind === 'plan' && classifyPixels(darkPlan, S, S).tone === 'dark');
t('noisy colour → photo', classifyPixels(photo, S, S).kind === 'photo');
t('a smooth sky gradient is a photo, not blank', classifyPixels(sky, S, S).kind === 'photo', classifyPixels(sky, S, S));
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

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
