// اختبار حساب صور بروشور المطوّر (crm/js/brochure-media.js): الاتجاه، والنوع التقريبي، وبصمة التكرار.
// التشغيل: node tests/brochure-media.test.mjs   أو   deno run tests/brochure-media.test.mjs
import { uprightMatrix, pageRotation, multiply, classifyPixels, fingerprint, sameImage, pixelKey, duplicate, worthKeeping } from '../crm/js/brochure-media.js';

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

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
