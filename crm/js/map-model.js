// «خريطة المشاريع» (‎#/map‎، map.js): الحساب الصافي للصفحة، بلا DOM ولا شبكة، يختبره tests/map-model.test.mjs.
//
//   • المصدر صفوف v_units (security_invoker) كما في «العقارات»: المعتمد غير المحذوف وحده، وصف لكل نموذج. هنا تُجمع الصفوف
//     مشروعاً واحداً: أقل سعر بين الوحدات المتاحة، وعدد ما بقي متاحاً (units_left من 030، وإلا unit_count)، وحالة البناء،
//     وصورته الأولى (https وحده، نصاً أو { url, caption } كما يقرؤها projectImages)، وإحداثياته إن صحّت.
//   • البحث والفلاتر (الغرض والنوع وحالة البناء و«المتاح فقط» والمدينة)، والعدد بصيغته العربية، وأقرب مشروع إلى موقع
//     الموظف، وترتيب «الجولة»، وحدود الخريطة لما يظهر.
//   • لون الخريطة: نمط OpenFreeMap «dark» يُعاد تلوينه بحبر ملائم قبل رسم الخريطة (recolorStyle)، وأسماؤه بالعربية أولاً.
// لا عمولة هنا أبداً: الصفحة لا تطلبها ولا تعرضها لأي دور.

import { countText, number, money } from './ui.js';
import { projectImages } from './project-profile.js';

/* ===================== المكتبة والخريطة ===================== */

// إصدارات مثبّتة بأرقامها (لا «أحدث إصدار» يتغيّر تحتنا)، وبصمة الملفين تمنع تشغيل ملف عُدّل على الشبكة (SRI)
export const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
export const MAPLIBRE_JS_SRI = 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj';
export const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
export const MAPLIBRE_CSS_SRI = 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V';
// تشكيل الحروف العربية ووصلها (بدونه تظهر الأسماء حروفاً مقطّعة معكوسة). 0.2.3 لا 0.3.0: الأحدث يسجّل نفسه بعد تحميل
// WebAssembly، وعامل MapLibre 4 يفحص التسجيل فور importScripts فيرفضه («RTL Text Plugin failed to import scripts»)
export const RTL_PLUGIN = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js';
// نمط OpenFreeMap الداكن: بلا مفتاح، وخطوطه (Noto Sans) فيها العربية وأشكالها الموصولة
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

// جدة: حيث المشاريع، وحيث تبدأ الخريطة إن لم يكن فيها مشروع بموقع
export const JEDDAH = { lng: 39.1728, lat: 21.5433 };
export const TOUR_MS = 6000;
export const MARK_URL = '../images/brand/mark.svg';
export const SAR = 'ر.س';

/* ===================== قراءة القيم ===================== */

const text = (value) => (value === null || value === undefined || typeof value === 'object' ? '' : String(value).trim());

// كما في project-profile.js: رقم أو نص رقم، داخل حدّه، وإلا null (الفراغ والمنطقي والنص الحر لا يُقرأ صفراً)
export function coordinate(value, limit) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = typeof value === 'string' ? Number(value.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.')) : Number(value);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

// موقع المشروع على الخريطة، أو null. (0، 0) قيمة فارغة لا مكان في البحر
export function validPoint(lat, lng) {
    const y = coordinate(lat, 90);
    const x = coordinate(lng, 180);
    if (y === null || x === null || (y === 0 && x === 0)) return null;
    return { lat: y, lng: x };
}

// حالة البناء كما يصنّفها js/script.js (constructionKind): الجاهز والمكتمل، أو تحت الإنشاء بأي صيغة كُتب بها، وإلا ''
export function constructionKind(value) {
    const t = text(value).replace(/_/g, ' ');
    if (!t) return '';
    if (/^(جاهز|مكتمل)/.test(t)) return 'ready';
    if (/تحت|قيد|الخارطة|بدأ العمل|مرحل[ةه]|اللمسات|التشطيب|الإنجاز|العظم/.test(t)) return 'building';
    if (/جاهز|إفراغ|افراغ|مكتمل|شهاد|تملك الآن|إتمام|اتمام/.test(t)) return 'ready';
    return '';
}

export const CONSTRUCTION_TEXT = { ready: 'جاهز', building: 'تحت الإنشاء' };

// الصورة الأولى: v_units.project_image هو images->>0، فيصل رابطاً نصياً أو نص كائن { url, caption } من البروشور المصنَّف
export function coverUrl(raw) {
    let item = raw;
    if (typeof raw === 'string' && /^\s*\{/.test(raw)) {
        try { item = JSON.parse(raw); } catch (_) { return null; }
    }
    const images = projectImages({ images: [item] });
    return images.length ? images[0].url : null;
}

/* ===================== المشاريع من صفوف الوحدات ===================== */

const isAvailable = (row) => row.unit_status === 'available' && (row.availability === undefined || row.availability === 'available');
const count = (value) => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n >= 0 ? n : null;
};

// صفوف v_units ← مشروع واحد لكل project_id بترتيب أول ظهوره. غير المعتمد والمحذوف لا يدخل الخريطة أبداً (الاستعلام
// يطلب المعتمد وحده، وهذا حارس ثانٍ). availableUnits: ما بقي من الوحدات المتاحة؛ minPrice: أقل سعر بينها (null حين لا متاح)
export function summarizeUnits(rows) {
    const byId = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || row.project_id === null || row.project_id === undefined) continue;
        if (row.status !== undefined && row.status !== 'approved') continue;
        if (row.deleted_at) continue;
        const id = Number(row.project_id);
        if (!Number.isInteger(id) || id <= 0) continue;
        let p = byId.get(id);
        if (!p) {
            const point = validPoint(row.latitude, row.longitude);
            p = {
                id,
                name: text(row.project_name) || 'مشروع رقم ' + id,
                type: text(row.project_type),
                purpose: text(row.purpose),
                city: text(row.city),
                district: text(row.district),
                developer: text(row.developer),
                lat: point ? point.lat : null,
                lng: point ? point.lng : null,
                image: coverUrl(row.project_image),
                construction: constructionKind(row.construction_status),
                projectAvailable: row.availability === undefined || row.availability === 'available',
                availableUnits: 0,
                reservedUnits: 0,
                totalUnits: 0,
                minPrice: null
            };
            byId.set(id, p);
        }
        const units = row.unit_count === undefined || row.unit_count === null ? 1 : Math.max(count(row.unit_count) || 0, 0);
        p.totalUnits += units;
        if (row.unit_status === 'reserved' && p.projectAvailable) p.reservedUnits += Math.max(units, 1);
        if (!isAvailable(row)) continue;
        // نموذج بعدة وحدات: ما بقي منه بعد حجوزات الصفقات (030)، وإلا عدده كله
        const left = count(row.units_left);
        p.availableUnits += left === null ? Math.max(units, 1) : left;
        const price = Number(row.price);
        if (row.price !== null && row.price !== undefined && row.price !== '' && Number.isFinite(price) && price > 0) {
            p.minPrice = p.minPrice === null ? price : Math.min(p.minPrice, price);
        }
    }
    return Array.from(byId.values()).map((p) => Object.assign(p, { soldOut: p.availableUnits === 0 }));
}

/* ===================== البحث والفلاتر ===================== */

// كما يطابق البحث السريع: بلا تشكيل ولا تطويل، والهمزات ألفاً، والتاء المربوطة هاءً، والألف المقصورة ياءً، والأرقام لاتينية
export function normalizeText(value) {
    return text(value).toLowerCase()
        .replace(/[ً-ٰٟـ]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// «حي» و«مدينة» و«مشروع» كلمات تسبق الاسم ولا تفرّق بين المشاريع: «حي الروضة» يجد مشاريع الروضة
const STOP = new Set(['حي', 'مدينه', 'مشروع', 'مشاريع', 'في']);

export function searchTokens(query) {
    return normalizeText(query).split(' ').filter((w) => w && !STOP.has(w));
}

// كل كلمة من البحث في الاسم أو الحي أو المدينة أو النوع (والمطوّر للمدير وحده، كما في «العقارات»)
export function matchesSearch(project, query, withDeveloper = false) {
    const words = searchTokens(query);
    if (!words.length) return true;
    const hay = normalizeText([project.name, project.district, project.city, project.type, withDeveloper ? project.developer : ''].join(' '));
    return words.every((w) => hay.includes(w));
}

// الفلاتر كما تُفتح الصفحة: «المتاح فقط» مفعّل كما في «العقارات»، وما سواه فارغ
export function freshFilters() {
    return { query: '', purpose: '', type: '', status: '', availableOnly: true, city: '' };
}

export function filterProjects(list, filters, withDeveloper = false) {
    const f = Object.assign(freshFilters(), filters || {});
    return (Array.isArray(list) ? list : []).filter((p) => {
        if (f.availableOnly && (p.soldOut || !p.projectAvailable)) return false;
        if (f.purpose && p.purpose !== f.purpose) return false;
        if (f.type && p.type !== f.type) return false;
        if (f.status && p.construction !== f.status) return false;
        if (f.city && p.city !== f.city) return false;
        return matchesSearch(p, f.query, withDeveloper);
    });
}

// ما في نافذة «الفلاتر» مغيّراً عن أول الصفحة (البحث والمدينة لهما مكانهما على الخريطة)
export function activeFilterCount(filters) {
    const f = Object.assign(freshFilters(), filters || {});
    return (f.purpose ? 1 : 0) + (f.type ? 1 : 0) + (f.status ? 1 : 0) + (f.availableOnly ? 0 : 1);
}

export function placed(list) {
    return (Array.isArray(list) ? list : []).filter((p) => p.lat !== null && p.lng !== null);
}

export function unplaced(list) {
    return (Array.isArray(list) ? list : []).filter((p) => p.lat === null || p.lng === null);
}

// قيم القائمة من البيانات نفسها، الأكثر أولاً ثم بالاسم
function tally(list, key) {
    const counts = new Map();
    for (const p of Array.isArray(list) ? list : []) {
        const v = p[key];
        if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return Array.from(counts, ([value, n]) => ({ value, count: n }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
}

export const cityChips = (list) => tally(list, 'city');
export const typeOptions = (list) => tally(list, 'type');

/* ===================== النصوص ===================== */

// العدد مع المعدود: countText (ui.js) لما دون المئة، وفوقها بباقي المئة: 103 مشاريع، 111 مشروعاً، 200 مشروع.
// forms = [واحد، اثنان، جمع 3–10، مفرد منصوب 11–99، مفرد مجرور بعد المئة]
export function countWords(n, forms) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    if (v < 100) return countText(v, forms);
    const rest = v % 100;
    if (rest >= 3 && rest <= 10) return number(v) + ' ' + forms[2];
    if (rest >= 11) return number(v) + ' ' + forms[3];
    return number(v) + ' ' + (forms[4] || forms[3]);
}

const PROJECT_FORMS = ['مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً', 'مشروع'];

export function projectsText(n) {
    return countWords(n, PROJECT_FORMS);
}

export function onMapText(n) {
    return Number(n) > 0 ? projectsText(n) + ' على الخريطة' : 'لا مشاريع على الخريطة';
}

export function noLocationText(n) {
    return projectsText(n) + ' بلا موقع';
}

export function unitsAvailableText(n) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    if (!v) return 'لا وحدات متاحة';
    return countWords(v, ['وحدة واحدة متاحة', 'وحدتان متاحتان', 'وحدات متاحة', 'وحدة متاحة', 'وحدة متاحة']);
}

export function priceFromText(price) {
    const n = Number(price);
    return price !== null && price !== undefined && Number.isFinite(n) && n > 0 ? 'من ' + money(n) + ' ' + SAR : '';
}

// «الروضة — جدة»: الحي بلا «حي» كما يُخزَّن (004)، والمدينة
export function placeText(project) {
    return [text(project && project.district), text(project && project.city)].filter(Boolean).join(' — ');
}

// شارة الحالة: نفد بالكامل أولاً (أو «محجوز بالكامل» حين لا متاح وبعض وحداته محجوزة لا مبيعة)، ثم حالة البناء
export function statusPill(project) {
    if (!project) return null;
    if (!project.projectAvailable) return { text: 'نفد بالكامل', tone: 'out' };
    if (project.soldOut) return project.reservedUnits > 0 ? { text: 'محجوز بالكامل', tone: 'out' } : { text: 'نفد بالكامل', tone: 'out' };
    if (project.construction === 'ready') return { text: CONSTRUCTION_TEXT.ready, tone: 'ready' };
    if (project.construction === 'building') return { text: CONSTRUCTION_TEXT.building, tone: 'building' };
    return null;
}

// اسم الدبوس لقارئ الشاشة: الاسم والمكان والسعر
export function pinLabel(project) {
    return [project.name, placeText(project), priceFromText(project.minPrice)].filter(Boolean).join('، ');
}

export function clusterLabel(n) {
    return projectsText(n) + ' هنا. اضغط لتكبير الخريطة عليها';
}

/* ===================== المسافة والجولة والحدود ===================== */

export function haversineKm(a, b) {
    const R = 6371.0088;
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// أقرب مشروع له موقع إلى نقطة الموظف، أو null. التعادل للأصغر رقماً، فالنتيجة ثابتة
export function nearestProject(list, point) {
    if (!point || validPoint(point.lat, point.lng) === null) return null;
    let best = null;
    for (const p of placed(list)) {
        const km = haversineKm(point, p);
        if (!best || km < best.km - 1e-9 || (Math.abs(km - best.km) <= 1e-9 && p.id < best.project.id)) best = { project: p, km };
    }
    return best;
}

// «0.8 كم»، «2.4 كم»، «15 كم»
export function kmText(km) {
    const n = Number(km);
    if (!Number.isFinite(n) || n < 0) return '';
    const shown = n < 10 ? Math.max(0.1, Math.round(n * 10) / 10) : Math.round(n);
    return number(shown) + ' كم';
}

export function nearestText(found) {
    return found ? 'أقرب مشروع: ' + found.project.name + ' — ' + kmText(found.km) : '';
}

/* ===================== المعالم ===================== */

// مربع جدة الذي أُخذت منه المعالم (map-landmarks.js): جنوب، غرب، شمال، شرق
export const JEDDAH_BOUNDS = { south: 21.25, west: 39.05, north: 21.95, east: 39.35 };

export function inJeddah(point) {
    const p = point && validPoint(point.lat, point.lng);
    const b = JEDDAH_BOUNDS;
    return Boolean(p) && p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

// «بالقرب من المشروع»: أقرب n معالم إلى نقطة (المشروع بموقعه)، الأقرب أولاً والتعادل بالاسم، فالنتيجة ثابتة. بلا موقع: لا شيء
export function nearestLandmarks(point, list, n = 3) {
    const at = point && validPoint(point.lat, point.lng);
    if (!at || !(n > 0)) return [];
    return (Array.isArray(list) ? list : [])
        .filter((l) => l && validPoint(l.lat, l.lng))
        .map((landmark) => ({ landmark, km: haversineKm(at, landmark) }))
        .sort((a, b) => a.km - b.km || a.landmark.name.localeCompare(b.landmark.name, 'ar'))
        .slice(0, Math.trunc(n));
}

// «ردسي مول · 1.2 كم» (المسافة بصيغة «أقرب مشروع» نفسها)
export function nearbyText(item) {
    return item && item.landmark ? item.landmark.name + ' · ' + kmText(item.km) : '';
}

// ترتيب «الجولة»: من المشروع الأقرب إلى نقطة البداية (وسط الخريطة)، ثم كل مرة إلى أقرب مشروع لم تزره الجولة، فتقصر الرحلات
export function tourOrder(list, start) {
    const left = placed(list).slice().sort((a, b) => a.id - b.id);
    const out = [];
    let at = start && validPoint(start.lat, start.lng) ? start : null;
    while (left.length) {
        let k = 0;
        if (at) {
            let best = Infinity;
            left.forEach((p, i) => {
                const d = haversineKm(at, p);
                if (d < best - 1e-9) { best = d; k = i; }
            });
        }
        const next = left.splice(k, 1)[0];
        out.push(next);
        at = next;
    }
    return out;
}

export function tourProgressText(index, total) {
    return 'المشروع ' + number(index + 1) + ' من ' + number(total);
}

// [[غرب، جنوب]، [شرق، شمال]] لما له موقع، أو null. مشروع واحد: مربع صغير حوله لا تكبير بلا حد
export function boundsOf(list) {
    const pts = placed(list);
    if (!pts.length) return null;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const p of pts) {
        w = Math.min(w, p.lng); e = Math.max(e, p.lng);
        s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    }
    const pad = 0.004;
    if (e - w < pad) { w -= pad; e += pad; }
    if (n - s < pad) { s -= pad; n += pad; }
    return [[w, s], [e, n]];
}

export function inBounds(project, bounds) {
    if (!bounds || project.lat === null || project.lng === null) return false;
    const [[w, s], [e, n]] = bounds;
    return project.lng >= w && project.lng <= e && project.lat >= s && project.lat <= n;
}

/* ===================== الرابط ===================== */

// ‎#/map?p=12‎: الخريطة على المشروع 12 وبطاقته مفتوحة (الموجّه يمرّر «p=12» كما هو)
export function parseMapRoute(query) {
    const m = /(?:^|&)p=(\d{1,10})(?:&|$)/.exec(String(query || ''));
    const id = m ? Number(m[1]) : null;
    return { focus: id && id <= 2147483647 ? id : null };
}

export function mapHash(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? '#/map?p=' + n : '#/map';
}

/* ===================== لون الخريطة ===================== */

// حبر ملائم (look.css: --look-ink #12282c) مدرَّجاً للخريطة: اليابسة بلون الشريط العلوي، والبحر أعمق، والطرق أفتح بدرجات
// من الأخضر المزرق نفسه، والأسماء بلون النص على الحبر. الخريطة داكنة في الوضعين.
export const MAP_COLORS = {
    land: '#12282c',
    water: '#0a1a1d',
    waterText: '#7fa9ae',
    residential: '#152e33',
    park: '#163a36',
    building: '#1b373c',
    buildingLine: '#24464c',
    building3d: '#2a5056',
    aeroway: '#1d3a3f',
    minor: '#21434a',
    major: '#2b5157',
    motorway: '#386168',
    casing: '#0d2023',
    rail: '#2a4a50',
    boundary: '#4d6f74',
    text: '#eef3f2',
    textSoft: '#c6d4d2',
    textMuted: '#a9bcba',
    halo: '#12282c'
};

// الاسم العربي أولاً، وإلا الاسم المحلي كما في المصدر
export const ARABIC_NAME = ['coalesce', ['get', 'name:ar'], ['get', 'name']];

const isRefField = (field) => Array.isArray(field) && JSON.stringify(field).includes('"ref"') && !JSON.stringify(field).includes('"name');

function fillColor(id) {
    const C = MAP_COLORS;
    if (/water/.test(id)) return C.water;
    if (/residential/.test(id)) return C.residential;
    if (/park|wood|grass|landcover/.test(id) && !/ice|glacier/.test(id)) return C.park;
    if (/building/.test(id)) return C.building;
    if (/aeroway/.test(id)) return C.aeroway;
    return C.land;
}

function lineColor(id) {
    const C = MAP_COLORS;
    if (/water/.test(id)) return C.water;
    if (/casing/.test(id)) return C.casing;
    if (/motorway/.test(id)) return C.motorway;
    if (/major|trunk|primary|secondary/.test(id)) return C.major;
    if (/dashline|pier/.test(id)) return C.land;
    if (/rail/.test(id)) return C.rail;
    if (/boundary/.test(id)) return C.boundary;
    if (/aeroway/.test(id)) return C.major;
    return C.minor;
}

// أسماء الأماكن: المدن أوضح وأكبر، والأحياء أهدأ، والطرق أصغر. الأحجام أكبر من النمط الأصلي لأن الحرف العربي أدق
function labelLook(id) {
    const C = MAP_COLORS;
    if (/water/.test(id)) return { color: C.waterText, size: 13 };
    if (/country|state/.test(id)) return { color: C.textSoft, size: 13 };
    if (/city_large/.test(id)) return { color: C.text, size: 17, bold: true };
    if (/city|town/.test(id)) return { color: C.text, size: 15, bold: true };
    if (/suburb|village/.test(id)) return { color: C.textSoft, size: 13 };
    if (/place/.test(id)) return { color: C.textMuted, size: 12 };
    return { color: C.textMuted, size: 12 };
}

// نسخة جديدة من نمط OpenFreeMap بحبر ملائم: لا يُعدَّل الأصل. يُحذف ما لا يلزم (الأيقونات وأسهم الاتجاه والمصادر غير
// المستعملة)، فلا تُطلب ملفات لا تُرسم، وتضاف طبقة مبانٍ مجسّمة مخفية تُظهرها «إمالة ثلاثية الأبعاد».
// طبقة لا يعرفها التحويل (تغيّر النمط في المصدر) تأخذ لون نوعها، فتبقى الخريطة داكنة مقروءة.
export function recolorStyle(style) {
    const s = JSON.parse(JSON.stringify(style || {}));
    const C = MAP_COLORS;
    delete s.sprite;
    s.name = 'Mulaem ink (OpenFreeMap dark)';
    const layers = [];
    for (const layer of Array.isArray(s.layers) ? s.layers : []) {
        const id = String(layer.id || '');
        const layout = layer.layout || {};
        const paint = layer.paint || {};
        if (layer.type === 'raster' || layer.type === 'hillshade' || layer.type === 'heatmap') continue;
        // أسهم الاتجاه وكل ما لا يُرسم إلا بأيقونة: لا أيقونات بلا sprite
        if (layer.type === 'symbol' && !layout['text-field']) continue;
        if (layer.type === 'background') {
            layer.paint = { 'background-color': C.land };
        } else if (layer.type === 'fill') {
            layer.paint = { 'fill-color': fillColor(id), 'fill-opacity': /park|wood|landcover/.test(id) ? 0.7 : 1, 'fill-antialias': true };
            if (/building/.test(id)) layer.paint['fill-outline-color'] = C.buildingLine;
            if (/ice|glacier/.test(id)) layer.paint['fill-opacity'] = 0;
        } else if (layer.type === 'line') {
            const next = { 'line-color': lineColor(id) };
            for (const key of ['line-width', 'line-gap-width', 'line-dasharray', 'line-offset', 'line-blur']) {
                if (paint[key] !== undefined) next[key] = paint[key];
            }
            next['line-opacity'] = /boundary/.test(id) ? 0.8 : 1;
            layer.paint = next;
        } else if (layer.type === 'fill-extrusion') {
            layer.paint = Object.assign({}, paint, { 'fill-extrusion-color': C.building3d });
        } else if (layer.type === 'symbol') {
            const look = labelLook(id);
            for (const key of Object.keys(layout)) if (/^icon-/.test(key)) delete layout[key];
            if (!isRefField(layout['text-field'])) layout['text-field'] = ARABIC_NAME;
            layout['text-font'] = [look.bold ? 'Noto Sans Bold' : 'Noto Sans Regular'];
            layout['text-size'] = look.size;
            // الحرف العربي موصول: لا تباعد بين الحروف، ولا تحويل لحروف كبيرة
            delete layout['text-transform'];
            layout['text-letter-spacing'] = 0;
            if (layout['symbol-placement'] !== 'line') {
                layout['text-anchor'] = 'center';
                layout['text-justify'] = 'center';
                layout['text-offset'] = [0, 0];
                layout['text-max-width'] = 9;
            }
            layer.layout = layout;
            layer.paint = { 'text-color': look.color, 'text-halo-color': C.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
        }
        layers.push(layer);
        if (id === 'building' && layer.type === 'fill') {
            layers.push({
                id: 'mp-building-3d', type: 'fill-extrusion', source: layer.source, 'source-layer': layer['source-layer'] || 'building',
                minzoom: 14, layout: { visibility: 'none' },
                paint: {
                    'fill-extrusion-color': C.building3d,
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
                    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                    'fill-extrusion-opacity': 0.75
                }
            });
        }
    }
    s.layers = layers;
    const used = new Set(layers.map((l) => l.source).filter(Boolean));
    const sources = {};
    for (const [key, value] of Object.entries(s.sources || {})) if (used.has(key)) sources[key] = value;
    s.sources = sources;
    return s;
}

/* ===================== دبابيس على نفس النقطة ===================== */

// مشاريع على نفس النقطة (موقع منسوخ من مشروع لآخر، أو مبانٍ في مخطط واحد): تتوزّع على دائرة نحو 40 م حولها ليظهر كل دبوس
// وحده عند التكبير. للرسم فقط: البطاقة والمسافات و«بالقرب من المشروع» على الموقع الحقيقي. يرجع Map: id ← [lng, lat]
export function spreadDuplicates(list) {
    const groups = new Map();
    for (const p of Array.isArray(list) ? list : []) {
        const key = p.lat.toFixed(4) + ',' + p.lng.toFixed(4);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    }
    const out = new Map();
    for (const group of groups.values()) {
        if (group.length === 1) { out.set(group[0].id, [group[0].lng, group[0].lat]); continue; }
        const lat0 = group.reduce((s, p) => s + p.lat, 0) / group.length;
        const lng0 = group.reduce((s, p) => s + p.lng, 0) / group.length;
        const meters = 40 * Math.max(1, group.length / 6);
        const dLat = meters / 111320;
        const dLng = meters / (111320 * Math.cos((lat0 * Math.PI) / 180));
        group.forEach((p, i) => {
            const a = (2 * Math.PI * i) / group.length;
            out.set(p.id, [lng0 + dLng * Math.sin(a), lat0 + dLat * Math.cos(a)]);
        });
    }
    return out;
}

// نقاط [lng, lat] كلها داخل نحو 150 م: مجموعة لا تنفصل إلا بتكبير قريب
export function tightGroup(points, km = 0.15) {
    const list = (Array.isArray(points) ? points : []).filter((c) => Array.isArray(c) && c.length >= 2);
    if (list.length < 2) return false;
    const [lng0, lat0] = list[0];
    return list.every(([lng, lat]) => haversineKm({ lat: lat0, lng: lng0 }, { lat, lng }) <= km);
}

// بحث الخريطة كما تفهمه «العقارات» (نص واحد في اسم العقار أو حيّه): كلمات البحث بلا «حي» و«مشروع»، إن وجدته في أحد
// المشاريع المعروضة؛ وإلا '' فتفتح القائمة كلها بدل قائمة فارغة
export function listSearchTerm(query, projects) {
    const term = String(query || '').trim().split(/\s+/).filter((w) => searchTokens(w).length).join(' ');
    if (!term) return '';
    const t = term.toLowerCase();
    return (Array.isArray(projects) ? projects : []).some((p) => [p.name, p.district].some((v) => String(v || '').toLowerCase().includes(t))) ? term : '';
}
