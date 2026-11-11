// ‎#/map‎ — «خريطة المشاريع»: خريطة داكنة بحبر ملائم تملأ الشاشة تحت الشريط العلوي، ودبوس لكل مشروع فيه صورته (أو علامة
// ملائم النحاسية بلا صورة)، والمتقاربة تتجمّع دبوساً واحداً بعددها. فوقها: البحث، و«الفلاتر»، و«موقعي» ثم «أقرب مشروع»،
// و«إعادة التمركز»، وحبّة لكل مدينة؛ وعلى الطرف: التكبير والتصغير و«إمالة ثلاثية الأبعاد»؛ وتحتها: عدد ما على الخريطة،
// وما ليس له موقع، و«جولة» تطير من مشروع إلى مشروع و«القائمة». الضغط على دبوس يفتح بطاقة المشروع: جانبية على الكمبيوتر،
// وورقة من الأسفل على الجوال.
//
// الفكرة من خريطة «سفير» والهوية لملائم: ألوان look.css وعلامتنا، لا شيء من غيرنا.
// المصدر v_units كما في «العقارات» (security_invoker: ما لا تسمح به سياسات projects لا يصل)، والمعتمد غير المحذوف وحده.
// لا عمولة هنا لأي دور: لا تُطلب أعمدتها أصلاً. الصفحة لكل الأدوار، والحساب الصافي كله في map-model.js.
//
// المكتبة MapLibre GL (إصدار مثبّت ببصمته) تُحمَّل أول مرة تُفتح فيها الخريطة، والبلاطات والخطوط من OpenFreeMap بلا مفتاح،
// والأسماء العربية تُشكَّل بإضافة RTL. إن تعذّرت المكتبة أو النمط أو WebGL: رسالة بزر «أعد المحاولة» وقائمة المشاريع نفسها،
// فلا تبقى الصفحة فارغة ولا يتوقف العمل.

import { supabase, fetchAll } from './supabase.js';
import { isAdmin } from './auth.js';
import { openShareSheet } from './share-project.js';
import { presetPropertySearch } from './properties.js';
import { LISTING_PURPOSE, label } from './labels.js';
import { el, replace, clear, icon, errorBox, pageHead, openModal, closeModal, filterChips, select, field, number } from './ui.js';
import * as M from './map-model.js';
import { LANDMARKS, LANDMARK_CATEGORIES } from './map-landmarks.js';

// المرشّحات ومكان الخريطة تبقى ما دامت الصفحة مفتوحة في المتصفح: الرجوع من صفحة مشروع يعيد الخريطة كما تُركت
const remembered = { filters: M.freshFilters(), camera: null };

// «المعالم» مطفأة أول مرة، واختيار الموظف يبقى لجلسة التبويب (sessionStorage، وإن مُنع التخزين فما دامت الصفحة مفتوحة)
const LM_KEY = 'mulaem-map-landmarks';
let landmarksChoice = null;
function landmarksWanted() {
    if (landmarksChoice !== null) return landmarksChoice;
    try { return sessionStorage.getItem(LM_KEY) === '1'; } catch (_) { return false; }
}
function rememberLandmarks(on) {
    landmarksChoice = on;
    try { sessionStorage.setItem(LM_KEY, on ? '1' : '0'); } catch (_) { /* تخزين محجوب */ }
}
// أسماء المعالم تظهر من هذا التكبير، وتحته نقاطها وحدها حتى لا تزدحم المدينة
const LM_NAMES_ZOOM = 12.5;

const LOAD_MS = 20000;
const FAIL_TEXT = 'تعذّر تحميل الخريطة — تحقق من اتصالك بالإنترنت ثم أعد المحاولة، أو تصفّح المشاريع كقائمة.';
const settle = (query) => Promise.resolve(query).catch((error) => ({ data: null, error }));

/* ===================== تحميل المكتبة والنمط ===================== */

let libPromise = null;

function withTimeout(promise, ms, message) {
    let timer = 0;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]).finally(() => clearTimeout(timer));
}

// مرة واحدة في الجلسة: ملف الأنماط ثم السكربت، بالبصمة (integrity) فلا يعمل ملف تغيّر على الشبكة. الفشل يمسح الوسم، فتعيد
// «أعد المحاولة» تحميله من جديد
function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (libPromise) return libPromise;
    if (!document.querySelector('link[data-mp-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = M.MAPLIBRE_CSS;
        link.integrity = M.MAPLIBRE_CSS_SRI;
        link.crossOrigin = 'anonymous';
        link.dataset.mpCss = '1';
        document.head.appendChild(link);
    }
    const old = document.querySelector('script[data-mp-js]');
    if (old) old.remove();
    libPromise = withTimeout(new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = M.MAPLIBRE_JS;
        script.integrity = M.MAPLIBRE_JS_SRI;
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.dataset.mpJs = '1';
        script.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error('مكتبة الخريطة لم تُحمَّل')));
        script.onerror = () => reject(new Error('تعذّر تحميل مكتبة الخريطة'));
        document.head.appendChild(script);
    }), LOAD_MS, 'انتهت مهلة تحميل مكتبة الخريطة').catch((error) => {
        libPromise = null;
        const s = document.querySelector('script[data-mp-js]');
        if (s) s.remove();
        throw error;
    });
    return libPromise;
}

// تشكيل العربية مرة واحدة في الجلسة (MapLibre يرفض النداء الثاني). تعذّرها لا يُسقط الخريطة: الأسماء تظهر بلا وصل
function rtlPlugin(lib) {
    try {
        if (typeof lib.getRTLTextPluginStatus === 'function' && lib.getRTLTextPluginStatus() !== 'unavailable') return;
        const done = lib.setRTLTextPlugin(M.RTL_PLUGIN, true);
        if (done && typeof done.catch === 'function') done.catch((error) => console.warn('[CRM] map: rtl plugin', error));
    } catch (error) {
        console.warn('[CRM] map: rtl plugin', error);
    }
}

let styleCache = null;
async function loadStyle() {
    if (styleCache) return styleCache;
    const response = await withTimeout(fetch(M.STYLE_URL, { credentials: 'omit' }), LOAD_MS, 'انتهت مهلة تحميل نمط الخريطة');
    if (!response.ok) throw new Error('نمط الخريطة: ' + response.status);
    const raw = await response.json();
    if (!raw || !Array.isArray(raw.layers) || !raw.sources) throw new Error('نمط الخريطة غير صالح');
    styleCache = M.recolorStyle(raw);
    return styleCache;
}

// فحص سريع قبل تحميل المكتبة: جهاز بلا WebGL يرى القائمة فوراً. السياق التجريبي يُغلق حتى لا يُحسب على المتصفح
function webglOk() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return false;
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return true;
    } catch (_) {
        return false;
    }
}

/* ===================== البيانات ===================== */

// صف لكل نموذج من v_units، المعتمد غير المحذوف وحده كما يعرضه «العقارات». المطوّر للمدير وحده (بحثه في «العقارات» له وحده).
// قاعدة بلا 030 (units_left) أو بلا الصورة: يُعاد الطلب بلا الأعمدة الاختيارية بدل خطأ يُسقط الصفحة
async function loadUnits(admin) {
    const base = 'project_id, project_name, project_type, purpose, city, district, latitude, longitude, construction_status,'
        + ' unit_ord, price, unit_status, availability, status, deleted_at';
    const extra = ', project_image, unit_count, units_left' + (admin ? ', developer' : '');
    const run = (cols) => settle(fetchAll(() => supabase.from('v_units').select(cols)
        .eq('status', 'approved').is('deleted_at', null)
        .order('project_id', { ascending: true }).order('unit_ord', { ascending: true })));
    let result = await run(base + extra);
    if (result.error && /project_image|unit_count|units_left|developer/.test(String(result.error.message || ''))) result = await run(base);
    return result;
}

/* ===================== الصفحة ===================== */

export async function renderMap(root, query) {
    const route = M.parseMapRoute(query);
    const admin = isAdmin();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const st = {
        all: [], byId: new Map(), shown: [], filters: Object.assign(M.freshFilters(), remembered.filters, { query: remembered.filters.query || '' }),
        forceId: route.focus, lib: null, map: null, loaded: false, failed: false, markers: new Map(), selected: null, user: null, userMarker: null,
        nearest: null, tour: null, pitched: false, destroyed: false, msgTimer: 0, fitTimer: 0, searchTimer: 0, opener: null,
        lmMarkers: [], lmPopup: null
    };
    window.scrollTo(0, 0);

    /* ---------- الهيكل ---------- */

    const live = el('div', { class: 'w4-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const mapHost = el('div', { class: 'mp-map', id: 'mpMap' });
    const skeleton = el('div', { class: 'mp-skel', role: 'status', 'aria-busy': 'true' }, [
        el('span', { class: 'w4-sr', text: 'جارٍ تحميل الخريطة' }),
        el('span', { class: 'mp-skel-pin', style: 'top:38%;left:34%' }), el('span', { class: 'mp-skel-pin', style: 'top:52%;left:58%' }),
        el('span', { class: 'mp-skel-pin', style: 'top:30%;left:66%' }), el('span', { class: 'mp-skel-pin mp-skel-big', style: 'top:60%;left:28%' })
    ]);

    // البحث باسم المطوّر للمدير وحده كما في «العقارات»؛ يُقال في الاسم والتلميح، والعبارة الظاهرة واحدة للجميع فتتسع على 320
    const searchBox = el('input', {
        type: 'search', class: 'mp-search-input', autocomplete: 'off', value: st.filters.query, enterKeyHint: 'search',
        placeholder: 'ابحث عن مشروع أو حي أو مدينة…', title: admin ? 'ابحث باسم المشروع أو الحي أو المدينة أو المطوّر' : null,
        'aria-label': admin ? 'ابحث في المشاريع بالاسم أو الحي أو المدينة أو المطوّر' : 'ابحث في المشاريع بالاسم أو الحي أو المدينة'
    });
    const searchForm = el('form', { class: 'mp-search', role: 'search', onsubmit: (event) => { event.preventDefault(); applySearch(true); searchBox.blur(); } },
        [icon('search', 'ico mp-search-ico'), searchBox]);

    const filterCount = el('span', { class: 'mp-chip-count', hidden: true });
    const filtersBtn = chip('الفلاتر', 'sliders', openFilters, { 'aria-haspopup': 'dialog' }, filterCount);
    const meBtn = chip('موقعي', 'target', locateMe);
    const fitBtn = chip('إعادة التمركز', 'refresh', () => { closeCard(); fitAll(true); }, { class: 'mp-chip mp-fit' });
    const lmBtn = el('button', {
        type: 'button', class: 'mp-chip mp-lm-chip', 'aria-pressed': landmarksWanted() ? 'true' : 'false',
        title: 'أماكن معروفة في جدة: مولات ومستشفيات وجامعات ومعالم', onclick: () => toggleLandmarks()
    }, [lmIcon('sight', 'ico'), el('span', { text: 'المعالم' })]);
    const cityRow = el('span', { class: 'mp-cities', role: 'group', 'aria-label': 'المدن' });
    const nearBtn = el('button', { type: 'button', class: 'mp-near', hidden: true, onclick: () => { if (st.nearest) openCard(st.nearest.project, { fly: true, focus: true }); } });
    const top = el('div', { class: 'mp-top' }, [
        searchForm,
        el('div', { class: 'mp-chips', role: 'group', 'aria-label': 'أدوات الخريطة' }, [filtersBtn, meBtn, lmBtn, fitBtn, cityRow]),
        nearBtn
    ]);

    const tiltBtn = el('button', {
        type: 'button', class: 'mp-ctl mp-ctl-3d', 'aria-pressed': 'false', 'aria-label': 'إمالة ثلاثية الأبعاد', title: 'إمالة ثلاثية الأبعاد', onclick: toggleTilt
    }, el('span', { 'aria-hidden': 'true', text: '3D' }));
    const controls = el('div', { class: 'mp-ctrl', role: 'group', 'aria-label': 'تكبير الخريطة وإمالتها' }, [
        el('button', { type: 'button', class: 'mp-ctl', 'aria-label': 'تكبير', title: 'تكبير', onclick: () => zoomBy(1) }, icon('plus')),
        el('button', { type: 'button', class: 'mp-ctl', 'aria-label': 'تصغير', title: 'تصغير', onclick: () => zoomBy(-1) }, el('span', { class: 'mp-minus', 'aria-hidden': 'true' })),
        tiltBtn
    ]);

    const countPill = el('p', { class: 'mp-count', role: 'status', 'aria-live': 'polite', text: '…' });
    const noLocLink = el('a', {
        class: 'mp-noloc', href: '#/properties', hidden: true,
        onclick: () => { if (st.filters.query.trim()) presetPropertySearch(st.filters.query); }
    });
    const tourBtn = el('button', { type: 'button', class: 'mp-btn mp-tour-btn', onclick: startTour }, [playIcon(), el('span', { text: 'جولة' })]);
    const listLink = el('a', {
        class: 'mp-btn', href: '#/properties', onclick: () => { if (st.filters.query.trim()) presetPropertySearch(st.filters.query); }
    }, [icon('menu'), el('span', { text: 'القائمة' })]);
    // «جولة» و«القائمة» في الزاوية (بداية السطر)، والعدد في الوسط
    const bottom = el('div', { class: 'mp-bottom' }, [
        el('div', { class: 'mp-corner' }, [tourBtn, listLink]),
        el('div', { class: 'mp-status' }, [countPill, noLocLink])
    ]);

    const msg = el('div', { class: 'mp-msg', hidden: true });
    const empty = el('div', { class: 'mp-empty', hidden: true });

    // الجولة: السابق، إيقاف مؤقت/متابعة، التالي، إنهاء، والتقدّم «المشروع 2 من 9» وخط الوقت الباقي
    const tourText = el('span', { class: 'mp-tour-text' });
    const tourLine = el('span', { class: 'mp-tour-line', 'aria-hidden': 'true' });
    const pauseBtn = el('button', { type: 'button', class: 'mp-tour-ctl', onclick: () => tourPause(!st.tour || st.tour.playing) });
    const tourBar = el('div', { class: 'mp-tourbar', role: 'group', 'aria-label': 'جولة المشاريع', hidden: true }, [
        el('div', { class: 'mp-tour-top' }, [tourText, tourLine]),
        el('div', { class: 'mp-tour-btns' }, [
            el('button', { type: 'button', class: 'mp-tour-ctl', 'aria-label': 'المشروع السابق', onclick: () => tourStep(-1) }, [arrowIcon('prev'), el('span', { text: 'السابق' })]),
            pauseBtn,
            el('button', { type: 'button', class: 'mp-tour-ctl', 'aria-label': 'المشروع التالي', onclick: () => tourStep(1) }, [el('span', { text: 'التالي' }), arrowIcon('next')]),
            el('button', { type: 'button', class: 'mp-tour-ctl mp-tour-end', onclick: () => endTour() }, [icon('close'), el('span', { text: 'إنهاء' })])
        ])
    ]);

    const card = el('section', { class: 'mp-card', 'aria-labelledby': 'mpCardTitle', hidden: true });
    // على الجوال: البطاقة ورقة من الأسفل والجولة فوقها في عمود واحد؛ على الكمبيوتر لا أثر للغلاف (display: contents)
    const dock = el('div', { class: 'mp-dock' }, [tourBar, card]);

    const page = el('section', { class: 'mp-page', 'aria-labelledby': 'mpTitle', dataset: { state: 'loading' } }, [
        el('h1', { class: 'w4-sr', id: 'mpTitle', text: 'خريطة المشاريع' }),
        mapHost, skeleton, top, controls, bottom, msg, empty, dock, live
    ]);
    replace(root, page);
    fitHeight();
    // ارتفاع الصف العلوي (يلتف سطرين على الشاشات الأضيق): البطاقة والرسائل تبدأ تحته
    const topWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => paintTopHeight()) : null;
    if (topWatch) topWatch.observe(top);
    paintTopHeight();

    const onResize = () => { fitHeight(); paintTopHeight(); };
    const onHash = () => { if (!page.isConnected) destroy(); };
    const onKey = (event) => {
        if (event.key !== 'Escape' || (!page.contains(document.activeElement) && document.activeElement !== document.body)) return;
        if (document.getElementById('modal') && document.getElementById('modal').classList.contains('active')) return;
        if (st.lmPopup) { event.preventDefault(); closeLandmarkPopup(true); }
        else if (st.tour) { event.preventDefault(); endTour(); } else if (!card.hidden) { event.preventDefault(); closeCard(true); }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('hashchange', onHash);
    // طور الالتقاط: يُقرأ Esc قبل أن تغلق به النافذة المنبثقة نفسها (app.js)، فلا يغلق الحرف نفسه النافذة والبطاقة معاً
    document.addEventListener('keydown', onKey, true);
    searchBox.addEventListener('input', () => {
        clearTimeout(st.searchTimer);
        st.searchTimer = setTimeout(() => applySearch(false), 250);
    });

    /* ---------- البيانات ---------- */

    const { data, error } = await loadUnits(admin);
    if (st.destroyed || !page.isConnected) return void destroy();
    if (error) {
        destroy();
        return void replace(root, [
            pageHead('خريطة المشاريع', 'كل المشاريع المعتمدة على الخريطة.'),
            errorBox(error, 'تعذّر تحميل المشاريع', () => renderMap(root, query))
        ]);
    }
    st.all = M.summarizeUnits(data || []).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    for (const p of st.all) st.byId.set(p.id, p);
    paintCities();
    apply();
    startMap();

    /* ===================== الخريطة ===================== */

    async function startMap() {
        st.failed = false;
        page.dataset.state = 'loading';
        skeleton.hidden = false;
        try {
            if (!webglOk()) throw new Error('المتصفح لا يدعم WebGL');
            const [lib, style] = await Promise.all([loadMapLibre(), loadStyle()]);
            // الصفحة استُبدلت أثناء التحميل (ولو بلا تغيّر في الرابط): لا خريطة لصفحة غير معروضة
            if (st.destroyed || !page.isConnected) return void destroy();
            rtlPlugin(lib);
            st.lib = lib;
            createMap(lib, style);
        } catch (error) {
            if (!st.destroyed) fallback(error);
        }
    }

    function createMap(lib, style) {
        const focus = st.forceId ? st.byId.get(st.forceId) : null;
        const placed = M.placed(st.shown);
        const bounds = M.boundsOf(placed);
        const options = {
            container: mapHost, style, attributionControl: false, minZoom: 3, maxZoom: 18, maxPitch: 60,
            dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false, fadeDuration: reduced ? 0 : 250,
            locale: {
                'Map.Title': 'خريطة المشاريع', 'Marker.Title': 'مشروع', 'AttributionControl.ToggleAttribution': 'حقوق الخريطة',
                'AttributionControl.MapFeedback': 'ملاحظة على الخريطة'
            }
        };
        if (focus && focus.lat !== null) Object.assign(options, { center: [focus.lng, focus.lat], zoom: 14.5 });
        else if (remembered.camera) Object.assign(options, remembered.camera);
        else if (bounds) Object.assign(options, { bounds, fitBoundsOptions: { padding: padding(), maxZoom: 14 } });
        else Object.assign(options, { center: [M.JEDDAH.lng, M.JEDDAH.lat], zoom: 11 });
        let map;
        try {
            map = new lib.Map(options);
        } catch (error) {
            return void fallback(error);
        }
        st.map = map;
        if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation();
        if (map.keyboard && map.keyboard.disableRotation) map.keyboard.disableRotation();
        map.addControl(new lib.AttributionControl({ compact: false }), 'bottom-left');
        // خريطة لا يكتمل رسمها الأول في وقته (شبكة معطّلة، جهاز ضعيف): القائمة بدل شاشة داكنة صامتة
        const slow = setTimeout(() => { if (!st.loaded && st.map === map) fallback(new Error('انتهت مهلة رسم الخريطة')); }, LOAD_MS + 5000);
        let tilesWarned = false;
        map.on('error', (event) => {
            const e = event && event.error;
            console.warn('[CRM] map:', e && e.message ? e.message : e);
            // بلاطة أو خط ناقص لا يُسقط الصفحة. تعذّر مصدر الشوارع كله: الدبابيس تعمل على خلفية داكنة، ويُقال ذلك مرة
            if (event && event.sourceId === 'openmaptiles' && !event.tile && !tilesWarned) {
                tilesWarned = true;
                say('تعذّر تحميل تفاصيل الخريطة (الشوارع والأسماء)، والمشاريع ظاهرة بمواقعها. أعد فتح الصفحة بعد قليل.', 'info', 9000);
            }
        });
        map.on('load', () => {
            clearTimeout(slow);
            if (st.destroyed) return;
            st.loaded = true;
            if (remembered.camera && remembered.camera.pitch > 0 && !focus) setTilt(true, false);
            map.addSource('mp-projects', {
                type: 'geojson', data: geojson(M.placed(st.shown)), cluster: true, clusterRadius: 52, clusterMaxZoom: 13,
                // صورة غلاف للتجمّع: أول صورة بين مشاريعه، وإلا علامة ملائم
                clusterProperties: { cover: [['coalesce', ['accumulated'], ['get', 'cover']], ['get', 'img']] }
            });
            // طبقة شفافة تُبقي المصدر محمَّلاً لقراءة دبابيسه (الدبابيس نفسها عناصر HTML فوق الخريطة)
            map.addLayer({ id: 'mp-projects-hit', type: 'circle', source: 'mp-projects', paint: { 'circle-radius': 1, 'circle-opacity': 0, 'circle-stroke-opacity': 0 } });
            skeleton.hidden = true;
            page.dataset.state = 'ready';
            syncMarkers();
            if (landmarksWanted()) showLandmarks(true);
            paintLandmarkNames();
            if (focus) {
                if (focus.lat === null) say('«' + focus.name + '» بلا موقع على الخريطة بعد. تفاصيله في البطاقة.');
                openCard(focus, { fly: false, focus: false });
            } else if (st.forceId) {
                say('هذا المشروع غير موجود على الخريطة: لم يُعتمد بعد أو لا تملك صلاحية الاطلاع عليه.');
            }
        });
        map.on('render', () => {
            // صفحة أُزيلت من غير تغيّر في الرابط: تُغلق الخريطة بعد هذا الإطار فلا يبقى سياق WebGL معلّقاً
            if (!page.isConnected) return void setTimeout(destroy, 0);
            if (st.loaded) syncMarkers();
        });
        map.on('click', (event) => {
            const target = event.originalEvent && event.originalEvent.target;
            if (target && target.closest && target.closest('.mp-pin, .mp-me, .mp-lm, .maplibregl-popup')) return;
            closeLandmarkPopup();
            if (!st.tour) closeCard();
        });
        map.on('dragstart', (event) => { if (st.tour && st.tour.playing && event.originalEvent) tourPause(true); });
        map.on('zoomend', paintLandmarkNames);
    }

    function geojson(list) {
        return {
            type: 'FeatureCollection',
            features: list.map((p) => ({
                type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, img: p.image || null }
            }))
        };
    }

    // الدبابيس: ما في البلاطات الظاهرة من المصدر (المجمّع والمنفرد)، يُنشأ الجديد ويُزال ما خرج. الرسم ثابت ما دامت الخريطة ساكنة
    function syncMarkers() {
        const map = st.map;
        if (!map || st.destroyed || !map.getSource('mp-projects') || !map.isSourceLoaded('mp-projects')) return;
        const seen = new Set();
        for (const f of map.querySourceFeatures('mp-projects')) {
            const props = f.properties || {};
            const cluster = Boolean(props.cluster);
            const key = cluster ? 'c' + props.cluster_id + ':' + props.point_count : 'p' + props.id;
            if (seen.has(key)) continue;
            seen.add(key);
            if (st.markers.has(key)) continue;
            const coords = f.geometry && f.geometry.coordinates;
            if (!coords) continue;
            const node = cluster ? clusterPin(props, coords) : projectPin(st.byId.get(Number(props.id)));
            if (!node) continue;
            const marker = new st.lib.Marker({ element: node, anchor: 'bottom' }).setLngLat(coords).addTo(map);
            // MapLibre يكتب «Map marker» عند الإضافة: الاسم العربي بعدها
            node.setAttribute('aria-label', node.dataset.label);
            st.markers.set(key, marker);
        }
        for (const [key, marker] of st.markers) {
            if (!seen.has(key)) { marker.remove(); st.markers.delete(key); }
        }
    }

    function clearMarkers() {
        for (const marker of st.markers.values()) marker.remove();
        st.markers.clear();
    }

    function pinImage(url) {
        const img = el('img', { src: url || M.MARK_URL, alt: '', class: url ? null : 'mp-pin-mark', decoding: 'async', draggable: false });
        // صورة لا تفتح: علامة ملائم مكانها بدل أيقونة المتصفح المكسورة
        if (url) img.addEventListener('error', () => { img.src = M.MARK_URL; img.classList.add('mp-pin-mark'); }, { once: true });
        return img;
    }

    function projectPin(p) {
        if (!p) return null;
        const node = el('button', {
            type: 'button', class: 'mp-pin' + (st.selected === p.id ? ' is-on' : ''), title: p.name,
            dataset: { id: String(p.id), label: M.pinLabel(p) }
        }, [el('span', { class: 'mp-pin-badge' }, pinImage(p.image)), el('span', { class: 'mp-pin-tail', 'aria-hidden': 'true' })]);
        if (st.selected === p.id) node.style.zIndex = '3';
        node.addEventListener('click', (event) => {
            event.stopPropagation();
            if (st.tour) endTour(false);
            openCard(p, { fly: true, focus: event.detail === 0 });
        });
        return node;
    }

    function clusterPin(props, coords) {
        const n = Number(props.point_count) || 0;
        const node = el('button', {
            type: 'button', class: 'mp-pin mp-cluster', dataset: { label: M.clusterLabel(n), count: String(n) }
        }, [
            el('span', { class: 'mp-pin-badge' }, pinImage(typeof props.cover === 'string' ? props.cover : null)),
            el('span', { class: 'mp-pin-tail', 'aria-hidden': 'true' }),
            el('span', { class: 'mp-pin-count', 'aria-hidden': 'true', text: M.projectsText(n) })
        ]);
        node.addEventListener('click', async (event) => {
            event.stopPropagation();
            const map = st.map;
            const source = map && map.getSource('mp-projects');
            if (!source) return;
            let zoom = map.getZoom() + 2;
            try { zoom = await source.getClusterExpansionZoom(props.cluster_id); } catch (_) { /* التكبير الافتراضي */ }
            if (st.destroyed) return;
            map.easeTo({ center: coords, zoom: Math.min(Math.max(zoom, map.getZoom() + 1), 16), duration: reduced ? 0 : 600 });
        });
        return node;
    }

    function markSelected() {
        for (const marker of st.markers.values()) {
            const node = marker.getElement();
            const on = node.dataset.id !== undefined && Number(node.dataset.id) === st.selected;
            node.classList.toggle('is-on', on);
            node.style.zIndex = on ? '3' : '';
        }
    }

    /* ===================== المعالم ===================== */

    // «المعالم»: نقطة صغيرة رمادية مخضرّة لكل معلم برمز فئته واسمه العربي، أصغر من دبابيس المشاريع وتحتها دائماً (look-map.css)،
    // وبلا نحاسي. الضغط عليها يقول اسمها وفئتها في فقاعة صغيرة، لا بطاقة كالمشاريع
    function toggleLandmarks() {
        const on = lmBtn.getAttribute('aria-pressed') !== 'true';
        rememberLandmarks(on);
        showLandmarks(on);
        live.textContent = on ? 'ظهرت على الخريطة ' + M.countWords(LANDMARKS.length, ['معلم واحد', 'معلمان', 'معالم', 'معلماً', 'معلم']) + ' من جدة' : 'أُخفيت المعالم';
    }

    function showLandmarks(on) {
        lmBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        page.classList.toggle('has-landmarks', on);
        if (!on) {
            closeLandmarkPopup();
            for (const marker of st.lmMarkers) marker.remove();
            st.lmMarkers = [];
            return;
        }
        if (!st.map || !st.lib || st.lmMarkers.length) return;
        for (const lm of LANDMARKS) {
            const cat = LANDMARK_CATEGORIES[lm.category];
            const node = el('button', { type: 'button', class: 'mp-lm', dataset: { cat: lm.category, osm: lm.osm } }, [
                el('span', { class: 'mp-lm-dot', 'aria-hidden': 'true' }, lmIcon(lm.category)),
                el('span', { class: 'mp-lm-name', 'aria-hidden': 'true', text: lm.name })
            ]);
            node.addEventListener('click', (event) => {
                event.stopPropagation();
                openLandmarkPopup(lm, event.detail === 0);
            });
            st.lmMarkers.push(new st.lib.Marker({ element: node, anchor: 'center' }).setLngLat([lm.lng, lm.lat]).addTo(st.map));
            // MapLibre يكتب «Map marker» عند الإضافة: الاسم العربي وفئته بعدها
            node.setAttribute('aria-label', lm.name + '، ' + (cat ? cat.one : ''));
        }
        paintLandmarkNames();
    }

    // الأسماء من تكبير 12.5، وتحته النقاط وحدها
    function paintLandmarkNames() {
        if (st.map) page.classList.toggle('mp-lm-far', st.map.getZoom() < LM_NAMES_ZOOM);
    }

    function openLandmarkPopup(lm, byKeyboard) {
        if (!st.map || !st.lib) return;
        closeLandmarkPopup();
        const opener = document.activeElement;
        const cat = LANDMARK_CATEGORIES[lm.category];
        st.lmPopup = new st.lib.Popup({ closeButton: true, closeOnClick: false, offset: 16, maxWidth: '260px', className: 'mp-lm-pop', focusAfterOpen: byKeyboard })
            .setLngLat([lm.lng, lm.lat])
            .setDOMContent(el('div', { class: 'mp-lm-pop-body' }, [
                el('strong', { class: 'mp-lm-pop-name', text: lm.name }),
                el('span', { class: 'mp-lm-pop-cat' }, [lmIcon(lm.category, 'ico'), el('span', { text: cat ? cat.one : '' })])
            ]))
            .addTo(st.map);
        const popup = st.lmPopup;
        popup.mpOpener = opener;
        popup.on('close', () => { if (st.lmPopup === popup) st.lmPopup = null; });
    }

    function closeLandmarkPopup(byUser = false) {
        const popup = st.lmPopup;
        if (!popup) return;
        st.lmPopup = null;
        popup.remove();
        // Esc يعيد التركيز إلى المعلم الذي فتحها
        if (byUser && popup.mpOpener && popup.mpOpener.isConnected) popup.mpOpener.focus({ preventScroll: true });
    }

    /* ===================== الحجم والمساحة ===================== */

    // الخريطة بارتفاع الشاشة تحت الشريط العلوي، وفوق شريط الجوال السفلي (هامش body السفلي له)
    function fitHeight() {
        if (!page.isConnected) return;
        const topEdge = page.getBoundingClientRect().top + window.scrollY;
        const bottomEdge = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        page.style.height = Math.max(320, Math.round(window.innerHeight - topEdge - bottomEdge)) + 'px';
        if (st.map) st.map.resize();
    }

    function paintTopHeight() {
        if (!page.isConnected) return;
        page.style.setProperty('--mp-top-h', Math.round(top.getBoundingClientRect().height) + 'px');
    }

    // حواف ما يغطي الخريطة (البحث فوق، والعدد والأزرار تحت، والبطاقة الجانبية) حتى لا يقع دبوس تحتها
    function padding(withCard = false) {
        const box = page.getBoundingClientRect();
        const topH = Math.max(0, top.getBoundingClientRect().bottom - box.top);
        const bottomH = Math.max(0, box.bottom - bottom.getBoundingClientRect().top);
        const side = window.innerWidth > 700;
        const cardW = withCard && side && !card.hidden ? card.getBoundingClientRect().width + 16 : 0;
        const cardH = withCard && !side && !card.hidden ? card.getBoundingClientRect().height : 0;
        // الدبوس يرتفع نحو 60 بكسلاً فوق نقطته، واسم التجمّع ينزل تحتها: حافتا الأعلى والأسفل تحسبانهما
        const pad = {
            top: Math.round(topH + 72),
            bottom: Math.round(Math.max(bottomH, cardH) + 40),
            left: Math.round((side ? 76 : 56)),
            right: Math.round(24 + cardW)
        };
        // خريطة أصغر من الحواف (جوال بالعرض، أو قبل أن تأخذ مقاسها): تُصغَّر الحواف بنسبتها فيبقى للدبابيس ثلث المساحة على الأقل
        const fit = (a, b, total) => {
            const k = a + b > total * 0.66 ? (total * 0.66) / Math.max(1, a + b) : 1;
            return [Math.max(0, Math.floor(a * k)), Math.max(0, Math.floor(b * k))];
        };
        const [t, b] = fit(pad.top, pad.bottom, box.height);
        const [l, r] = fit(pad.left, pad.right, box.width);
        return { top: t, bottom: b, left: l, right: r };
    }

    function fitAll(animate) {
        const map = st.map;
        const bounds = M.boundsOf(M.placed(st.shown));
        if (!map || !bounds) return;
        map.fitBounds(bounds, { padding: padding(true), maxZoom: 14, duration: animate && !reduced ? 700 : 0 });
    }

    function flyTo(p, zoom) {
        const map = st.map;
        if (!map || p.lat === null) return;
        const target = { center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), zoom || 14.5), padding: padding(true) };
        if (reduced) map.jumpTo(target);
        else map.flyTo(Object.assign(target, { speed: 1.1, curve: 1.42, essential: true }));
    }

    function zoomBy(step) {
        if (!st.map) return;
        if (step > 0) st.map.zoomIn({ duration: reduced ? 0 : 300 });
        else st.map.zoomOut({ duration: reduced ? 0 : 300 });
    }

    function setTilt(on, animate = true) {
        st.pitched = on;
        tiltBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const map = st.map;
        if (!map) return;
        if (map.getLayer('mp-building-3d')) map.setLayoutProperty('mp-building-3d', 'visibility', on ? 'visible' : 'none');
        map.easeTo({ pitch: on ? 55 : 0, duration: animate && !reduced ? 600 : 0 });
    }

    function toggleTilt() {
        setTilt(!st.pitched);
        say(st.pitched ? 'الخريطة مائلة: المباني القريبة تظهر مجسّمة عند التكبير.' : 'عادت الخريطة مسطّحة.', 'info', 3500);
    }

    /* ===================== البحث والفلاتر ===================== */

    function applySearch(fitNow) {
        if (st.destroyed) return;
        st.filters.query = searchBox.value;
        st.forceId = null;
        apply();
        clearTimeout(st.fitTimer);
        if (st.filters.query.trim() && M.placed(st.shown).length) st.fitTimer = setTimeout(() => fitAll(true), fitNow ? 0 : 450);
    }

    function apply() {
        const list = M.filterProjects(st.all, st.filters, admin);
        // مشروع جاء به الرابط (#/map?p=12) يبقى ظاهراً ولو أخفته الفلاتر، حتى تتغيّر
        if (st.forceId && !list.some((p) => p.id === st.forceId) && st.byId.has(st.forceId)) list.push(st.byId.get(st.forceId));
        st.shown = list;
        Object.assign(remembered.filters, st.filters);
        const placed = M.placed(list);
        const missing = M.unplaced(list);
        countPill.textContent = M.onMapText(placed.length);
        noLocLink.hidden = !missing.length;
        // الجوال الضيق يكتفي بـ«4 بلا موقع» بجانب العدد؛ الاسم الكامل للقارئ في aria-label
        replace(noLocLink, missing.length ? [
            el('span', { class: 'mp-noloc-long', text: M.noLocationText(missing.length) + ' — اعرضها في القائمة' }),
            el('span', { class: 'mp-noloc-short', text: number(missing.length) + ' بلا موقع' })
        ] : null);
        if (missing.length) noLocLink.setAttribute('aria-label', M.noLocationText(missing.length) + ' على الخريطة — اعرضها في القائمة');
        const active = M.activeFilterCount(st.filters);
        filterCount.hidden = !active;
        filterCount.textContent = active ? number(active) : '';
        filtersBtn.setAttribute('aria-label', active ? 'الفلاتر، ' + number(active) + ' مفعّلة' : 'الفلاتر');
        for (const b of cityRow.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.city === st.filters.city ? 'true' : 'false');
        paintEmpty(placed.length);
        if (st.failed) paintFallbackList();
        if (st.map && st.loaded && st.map.getSource('mp-projects')) {
            st.map.getSource('mp-projects').setData(geojson(placed));
            clearMarkers();
        }
        if (st.selected !== null && !list.some((p) => p.id === st.selected)) closeCard();
        if (st.user) updateNearest(false);
    }

    // لا دبوس على الخريطة: السبب كما هو — لا مشاريع أصلاً، أو بلا مواقع، أو أخفاها البحث والفلاتر، أو نفدت كلها و«المتاح فقط» مفعّل
    function paintEmpty(placedCount) {
        if (placedCount) { empty.hidden = true; return; }
        const filtered = Boolean(st.filters.query.trim() || st.filters.city || M.activeFilterCount(st.filters));
        let parts;
        if (!st.all.length) {
            parts = [el('strong', { text: 'لا توجد مشاريع معتمدة بعد' }),
                el('span', { text: 'المشاريع الجديدة تُضاف من «إضافة عرض» أو من صفحة المشاريع، وتظهر هنا بعد اعتمادها.' })];
        } else if (!M.placed(st.all).length) {
            parts = [el('strong', { text: 'لا مشاريع لها موقع على الخريطة بعد' }), el('span', { text: 'الموقع يُضاف للمشروع من صفحة المشاريع.' })];
        } else if (filtered) {
            parts = [el('strong', { text: 'لا مشاريع مطابقة على الخريطة' }), el('span', { text: 'وسّع البحث أو امسح الفلاتر.' }),
                el('button', { type: 'button', class: 'mp-btn mp-btn-copper', text: 'مسح البحث والفلاتر', onclick: resetAll })];
        } else {
            parts = [el('strong', { text: 'لا مشاريع فيها وحدات متاحة الآن' }),
                el('span', { text: 'كل المشاريع المعتمدة نفدت. أطفئ «المتاح فقط» في «الفلاتر» لتراها على الخريطة.' }),
                el('button', { type: 'button', class: 'mp-btn mp-btn-copper', text: 'الفلاتر', onclick: openFilters })];
        }
        replace(empty, parts);
        empty.hidden = false;
    }

    function resetAll() {
        st.filters = M.freshFilters();
        searchBox.value = '';
        apply();
        fitAll(true);
    }

    function paintCities() {
        const cities = M.cityChips(st.all);
        replace(cityRow, cities.map((c) => el('button', {
            type: 'button', class: 'mp-chip mp-city', dataset: { city: c.value }, 'aria-pressed': c.value === st.filters.city ? 'true' : 'false',
            onclick: () => {
                st.filters.city = st.filters.city === c.value ? '' : c.value;
                st.forceId = null;
                apply();
                fitAll(true);
            }
        }, [icon('pin'), el('span', { text: c.value })])));
    }

    // «الفلاتر»: الغرض، والنوع، وحالة البناء، و«المتاح فقط». كل تغيير يُطبَّق فوراً، والزر يقول كم مشروعاً سيظهر
    function openFilters() {
        const f = st.filters;
        const purpose = filterChips('غرض العرض', [{ value: '', label: 'الكل' }, { value: 'sale', label: LISTING_PURPOSE.sale }, { value: 'rent', label: LISTING_PURPOSE.rent }],
            f.purpose, (value) => { f.purpose = value; changed(); });
        const status = filterChips('حالة البناء', [{ value: '', label: 'الكل' }, { value: 'ready', label: M.CONSTRUCTION_TEXT.ready }, { value: 'building', label: M.CONSTRUCTION_TEXT.building }],
            f.status, (value) => { f.status = value; changed(); });
        const types = M.typeOptions(st.all);
        const typeBox = select([{ value: '', label: 'كل الأنواع' }].concat(types.map((t) => ({ value: t.value, label: t.value }))), f.type);
        typeBox.addEventListener('change', () => { f.type = typeBox.value; changed(); });
        const availableBox = el('input', { type: 'checkbox', checked: f.availableOnly });
        const availableChip = el('label', { class: 'chip' + (f.availableOnly ? ' on' : '') }, [availableBox, 'المتاح فقط']);
        availableBox.addEventListener('change', () => { f.availableOnly = availableBox.checked; availableChip.classList.toggle('on', availableBox.checked); changed(); });
        const showBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { closeModal(); fitAll(true); } });
        const resetBtn = el('button', {
            type: 'button', class: 'btn btn-outline', text: 'مسح الفلاتر',
            onclick: () => {
                Object.assign(f, { purpose: '', type: '', status: '', availableOnly: true });
                purpose.set(''); status.set(''); typeBox.value = ''; availableBox.checked = true; availableChip.classList.add('on');
                changed();
            }
        });
        function changed() {
            st.forceId = null;
            apply();
            showBtn.textContent = M.placed(st.shown).length ? 'اعرض ' + M.onMapText(M.placed(st.shown).length) : 'لا مشاريع مطابقة';
        }
        changed();
        openModal('فلاتر الخريطة', el('div', { class: 'mp-filters' }, [
            el('div', { class: 'mp-filter' }, [el('span', { class: 'mp-filter-label', text: 'الغرض' }), purpose.node]),
            field('نوع العقار', typeBox),
            el('div', { class: 'mp-filter' }, [el('span', { class: 'mp-filter-label', text: 'حالة البناء' }), status.node]),
            el('div', { class: 'mp-filter' }, [availableChip, el('small', { class: 'hint', text: 'مثل «العقارات»: ما فيه وحدة متاحة على الأقل.' })]),
            el('div', { class: 'btn-row mp-filter-actions' }, [showBtn, resetBtn])
        ]), { narrow: true });
    }

    /* ===================== البطاقة ===================== */

    function openCard(p, { fly = false, focus = false, tour = false } = {}) {
        if (!p || st.destroyed) return;
        if (!tour && card.hidden) st.opener = document.activeElement;
        st.selected = p.id;
        markSelected();
        const pill = M.statusPill(p);
        const price = M.priceFromText(p.minPrice);
        // «بالقرب من المشروع»: أقرب ثلاثة معالم ومسافتها، للمشروع الذي له موقع (ظاهرة أكانت «المعالم» مفعّلة أم لا)
        const near = p.lat !== null ? M.nearestLandmarks(p, LANDMARKS, 3) : [];
        const title = el('h2', { class: 'mp-card-title', id: 'mpCardTitle', tabindex: '-1', text: p.name });
        const share = el('button', { type: 'button', class: 'btn btn-outline mp-card-share', onclick: () => openShareSheet({ id: p.id, name: p.name, district: p.district, city: p.city }) },
            [icon('link'), el('span', { text: 'مشاركة مع عميل' })]);
        replace(card, [
            el('button', { type: 'button', class: 'mp-card-close', 'aria-label': 'إغلاق بطاقة المشروع', onclick: () => (st.tour ? endTour() : closeCard(true)) }, icon('close')),
            el('div', { class: 'mp-card-photo' + (p.image ? '' : ' is-mark') }, cardImage(p)),
            el('div', { class: 'mp-card-body' }, [
                title,
                el('p', { class: 'mp-card-place' }, [icon('pin'), el('span', { text: M.placeText(p) || '—' })]),
                el('div', { class: 'mp-card-tags' }, [
                    pill ? el('span', { class: 'mp-pill mp-pill-' + pill.tone, text: pill.text }) : null,
                    p.purpose ? el('span', { class: 'mp-pill mp-pill-plain', text: label(LISTING_PURPOSE, p.purpose, '') }) : null,
                    p.type ? el('span', { class: 'mp-pill mp-pill-plain', text: p.type }) : null
                ]),
                price ? el('p', { class: 'mp-card-price', text: price }) : null,
                el('p', { class: 'mp-card-units', text: M.unitsAvailableText(p.availableUnits) }),
                p.lat === null ? el('p', { class: 'mp-card-note', text: 'هذا المشروع بلا موقع على الخريطة بعد.' }) : null,
                near.length ? el('div', { class: 'mp-card-near' }, [
                    el('h3', { class: 'mp-card-sub', text: 'بالقرب من المشروع' }),
                    el('ul', { class: 'mp-near-list', role: 'list' }, near.map((x) => el('li', { class: 'mp-near-item', dataset: { osm: x.landmark.osm } }, [
                        el('span', { class: 'mp-near-ico', 'aria-hidden': 'true' }, lmIcon(x.landmark.category)),
                        el('span', { class: 'mp-near-text', text: M.nearbyText(x) })
                    ])))
                ]) : null,
                el('div', { class: 'mp-card-actions' }, [
                    el('a', { class: 'btn btn-primary mp-card-open', href: '#/project/' + p.id }, [el('span', { text: 'عرض المشروع' })]),
                    share
                ])
            ])
        ]);
        card.hidden = false;
        page.classList.add('has-card');
        rememberFocus(p.id);
        if (fly) flyTo(p);
        if (focus) title.focus({ preventScroll: true });
    }

    function cardImage(p) {
        const img = el('img', { src: p.image || M.MARK_URL, alt: p.image ? 'صورة ' + p.name : '', decoding: 'async' });
        if (p.image) img.addEventListener('error', () => { img.src = M.MARK_URL; img.alt = ''; img.parentElement && img.parentElement.classList.add('is-mark'); }, { once: true });
        return img;
    }

    function closeCard(byUser = false) {
        if (card.hidden) return;
        card.hidden = true;
        clear(card);
        page.classList.remove('has-card');
        st.selected = null;
        markSelected();
        rememberFocus(null);
        if (byUser && st.opener && st.opener.isConnected && typeof st.opener.focus === 'function') st.opener.focus({ preventScroll: true });
        st.opener = null;
    }

    // المشروع المختار في الرابط (‎#/map?p=12‎) بلا إعادة رسم: الرجوع من صفحته يعيده، ويُنسخ الرابط كما هو
    function rememberFocus(id) {
        const hash = id ? M.mapHash(id) : '#/map';
        if (location.hash === hash || !page.isConnected) return;
        try { history.replaceState(history.state, '', hash); } catch (_) { /* متصفح يمنع تعديل الرابط */ }
    }

    /* ===================== موقعي وأقرب مشروع ===================== */

    function locateMe() {
        if (!navigator.geolocation) return void say('المتصفح لا يدعم تحديد الموقع، فلا نعرف أقرب مشروع إليك.', 'error');
        meBtn.disabled = true;
        meBtn.setAttribute('aria-busy', 'true');
        say('جارٍ تحديد موقعك…', 'info', 8000);
        navigator.geolocation.getCurrentPosition((position) => {
            meBtn.disabled = false;
            meBtn.removeAttribute('aria-busy');
            if (st.destroyed) return;
            const point = M.validPoint(position.coords.latitude, position.coords.longitude);
            if (!point) return void say('وصل موقع غير صالح من الجهاز. أعد المحاولة.', 'error');
            st.user = point;
            meBtn.setAttribute('aria-pressed', 'true');
            showUser();
            updateNearest(true);
        }, (failure) => {
            meBtn.disabled = false;
            meBtn.removeAttribute('aria-busy');
            if (st.destroyed) return;
            say(failure && failure.code === 1
                ? 'لم يُسمح للمتصفح بمعرفة موقعك. فعّل إذن الموقع لهذا الموقع من إعدادات المتصفح، ثم اضغط «موقعي» مجدداً.'
                : 'تعذّر تحديد موقعك الآن. تأكد من تشغيل خدمة الموقع في الجهاز ثم أعد المحاولة.', 'error', 9000);
        }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
    }

    function showUser() {
        if (!st.map || !st.lib || !st.user) return;
        if (!st.userMarker) {
            const dot = el('span', { class: 'mp-me', role: 'img', 'aria-label': 'موقعك' }, el('span', { class: 'mp-me-dot' }));
            st.userMarker = new st.lib.Marker({ element: dot, anchor: 'center' }).setLngLat([st.user.lng, st.user.lat]).addTo(st.map);
            dot.setAttribute('aria-label', 'موقعك');
        } else {
            st.userMarker.setLngLat([st.user.lng, st.user.lat]);
        }
    }

    function updateNearest(move) {
        st.nearest = M.nearestProject(st.shown, st.user);
        nearBtn.hidden = !st.nearest;
        if (!st.nearest) {
            if (move) say('لا مشروع له موقع بين ما يظهر الآن، فلا نعرف الأقرب إليك.', 'info');
            return;
        }
        replace(nearBtn, [icon('target'), el('span', { text: M.nearestText(st.nearest) })]);
        nearBtn.setAttribute('aria-label', M.nearestText(st.nearest) + '. اضغط لفتح بطاقته');
        if (!move) return;
        say(M.nearestText(st.nearest), 'quiet', 6000);
        live.textContent = M.nearestText(st.nearest);
        const both = M.boundsOf([st.user, st.nearest.project]);
        if (st.map && both) st.map.fitBounds(both, { padding: padding(), maxZoom: 14.5, duration: reduced ? 0 : 900 });
    }

    /* ===================== الجولة ===================== */

    function startTour() {
        if (!st.map || !st.loaded) return;
        const all = M.placed(st.shown);
        const bounds = st.map.getBounds();
        const inView = all.filter((p) => bounds.contains([p.lng, p.lat]));
        // جولة على مشروع واحد ليست جولة: الخريطة مكبَّرة على مشروع، فتمر الجولة على كل ما يظهر بالبحث والفلاتر
        const list = inView.length >= 2 ? inView : all;
        if (!list.length) return void say('لا مشاريع على الخريطة للجولة. وسّع البحث أو امسح الفلاتر.', 'info');
        const c = st.map.getCenter();
        st.tour = { list: M.tourOrder(list, { lat: c.lat, lng: c.lng }), i: -1, playing: true, timer: 0 };
        page.classList.add('is-touring');
        tourBar.hidden = false;
        tourGo(0);
        pauseBtn.focus({ preventScroll: true });
    }

    function tourGo(i) {
        const t = st.tour;
        if (!t || st.destroyed) return;
        if (i >= t.list.length) return void endTour(true);
        t.i = Math.max(0, i);
        const p = t.list[t.i];
        openCard(p, { fly: true, tour: true });
        tourText.textContent = M.tourProgressText(t.i, t.list.length);
        live.textContent = M.tourProgressText(t.i, t.list.length) + ': ' + p.name;
        tourTimer();
    }

    function tourTimer() {
        const t = st.tour;
        if (!t) return;
        clearTimeout(t.timer);
        paintPause();
        // خط الوقت الباقي يبدأ من أوله مع كل مشروع، ويقف مع الإيقاف
        tourLine.classList.remove('is-running');
        void tourLine.offsetWidth;
        if (!t.playing) return;
        tourLine.classList.add('is-running');
        t.timer = setTimeout(() => tourGo(t.i + 1), M.TOUR_MS);
    }

    function tourPause(pause) {
        const t = st.tour;
        if (!t) return;
        t.playing = !pause;
        live.textContent = pause ? 'أُوقفت الجولة مؤقتاً' : 'تتابع الجولة';
        tourTimer();
    }

    function paintPause() {
        const t = st.tour;
        const playing = Boolean(t && t.playing);
        // «مؤقت» تسقط على الجوال الضيق (mp-tour-opt) والاسم الكامل في aria-label
        replace(pauseBtn, playing ? [pauseIcon(), el('span', { text: 'إيقاف' }), el('span', { class: 'mp-tour-opt', text: ' مؤقت' })] : [playIcon(), el('span', { text: 'متابعة' })]);
        pauseBtn.setAttribute('aria-label', playing ? 'إيقاف الجولة مؤقتاً' : 'متابعة الجولة');
    }

    function tourStep(delta) {
        const t = st.tour;
        if (!t) return;
        if (delta > 0 && t.i >= t.list.length - 1) return void endTour(true);
        tourGo(Math.max(0, t.i + delta));
    }

    function endTour(finished = false) {
        const t = st.tour;
        if (!t) return;
        clearTimeout(t.timer);
        // التركيز في شريط الجولة يعود إلى «جولة» حين يختفي الشريط؛ ومن لم يكن فيه لا يُنقل تركيزه
        const hadFocus = tourBar.contains(document.activeElement);
        st.tour = null;
        page.classList.remove('is-touring');
        tourBar.hidden = true;
        tourLine.classList.remove('is-running');
        // يُعلن مرة واحدة (منطقة aria-live)، والرسالة الظاهرة بلا دور حتى لا تُقرأ مرتين
        live.textContent = 'انتهت الجولة';
        say(finished ? 'انتهت الجولة: مررنا على ' + M.projectsText(t.list.length) + '.' : 'انتهت الجولة', 'quiet', 4500);
        if (hadFocus && tourBtn.isConnected) tourBtn.focus({ preventScroll: true });
    }

    /* ===================== الرسائل ===================== */

    // رسالة قصيرة فوق الخريطة: إخبار هادئ (role=status)، أو تنبيه (role=alert) حين يتعذّر شيء طلبه الموظف، أو ظاهرة فقط
    // (quiet) حين أعلنتها منطقة aria-live للصفحة
    function say(text, kind = 'info', ms = 6000) {
        clearTimeout(st.msgTimer);
        msg.className = 'mp-msg' + (kind === 'error' ? ' is-error' : '');
        if (kind === 'quiet') msg.removeAttribute('role');
        else msg.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        replace(msg, [
            el('span', { class: 'mp-msg-text', text }),
            el('button', { type: 'button', class: 'mp-msg-close', 'aria-label': 'إغلاق الرسالة', onclick: () => { msg.hidden = true; } }, icon('close'))
        ]);
        msg.hidden = false;
        st.msgTimer = setTimeout(() => { msg.hidden = true; }, ms);
    }

    /* ===================== تعذّر الخريطة ===================== */

    // رسالة بزر «أعد المحاولة»، وتحتها قائمة المشاريع نفسها (البحث والفلاتر تعمل عليها)، فيستمر العمل بلا خريطة
    function fallback(error) {
        console.warn('[CRM] map unavailable:', error && error.message ? error.message : error);
        if (st.destroyed) return;
        if (st.map) { try { st.map.remove(); } catch (_) { /* خريطة نصف منشأة */ } }
        st.map = null;
        st.loaded = false;
        st.failed = true;
        st.markers.clear();
        st.lmMarkers = [];
        st.lmPopup = null;
        st.userMarker = null;
        if (st.tour) endTour();
        closeCard();
        skeleton.hidden = true;
        page.dataset.state = 'failed';
        page.classList.add('is-failed');
        paintFallbackList();
    }

    function paintFallbackList() {
        const list = st.shown.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        const retry = el('button', {
            type: 'button', class: 'btn btn-outline btn-xs crm-retry', onclick: () => {
                page.classList.remove('is-failed');
                clear(mapHost);
                startMap();
            }
        }, [icon('refresh'), el('span', { text: 'أعد المحاولة' })]);
        replace(mapHost, el('div', { class: 'mp-fail' }, [
            el('div', { class: 'crm-error crm-error-retry', role: 'alert' }, [el('span', { class: 'crm-error-text', text: FAIL_TEXT }), retry]),
            el('h2', { class: 'mp-fail-title', text: M.projectsText(list.length) || 'لا مشاريع' }),
            list.length ? el('ul', { class: 'mp-fail-list', role: 'list' }, list.map((p) => el('li', {}, el('a', { class: 'mp-fail-item', href: '#/project/' + p.id }, [
                el('strong', { text: p.name }),
                el('span', { class: 'mp-fail-place', text: M.placeText(p) || '—' }),
                el('span', { class: 'mp-fail-price', text: M.priceFromText(p.minPrice) || M.unitsAvailableText(p.availableUnits) })
            ])))) : el('p', { class: 'mp-fail-empty', text: 'لا مشاريع مطابقة. امسح البحث أو الفلاتر.' })
        ]));
    }

    /* ===================== المغادرة ===================== */

    // مغادرة الصفحة تُغلق الخريطة (سياق WebGL واحد لكل زيارة) وتحفظ مكانها للرجوع
    function destroy() {
        if (st.destroyed) return;
        st.destroyed = true;
        clearTimeout(st.msgTimer);
        clearTimeout(st.fitTimer);
        clearTimeout(st.searchTimer);
        if (st.tour) clearTimeout(st.tour.timer);
        st.tour = null;
        window.removeEventListener('resize', onResize);
        window.removeEventListener('hashchange', onHash);
        document.removeEventListener('keydown', onKey, true);
        if (topWatch) topWatch.disconnect();
        if (st.map) {
            try {
                const c = st.map.getCenter();
                remembered.camera = { center: [c.lng, c.lat], zoom: st.map.getZoom(), pitch: st.map.getPitch() };
                st.map.remove();
            } catch (_) { /* أُزيلت من قبل */ }
        }
        st.map = null;
        st.markers.clear();
        st.lmMarkers = [];
        st.lmPopup = null;
    }
}

/* ===================== أجزاء صغيرة ===================== */

function chip(text, iconName, onclick, attrs = {}, extra = null) {
    return el('button', Object.assign({ type: 'button', class: 'mp-chip', onclick }, attrs), [icon(iconName), el('span', { text }), extra]);
}

// أيقونات التشغيل والإيقاف والسهمين بخطوط كأيقونات ui.js. «التالي» يشير يساراً في الصفحة العربية
function lineIcon(paths) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'ico');
    for (const d of paths) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}
const playIcon = () => lineIcon(['M8 5.5v13l10.5-6.5z']);
// رمز كل فئة من المعالم بخطوط كأيقونات ui.js: علم، حقيبة تسوق، صليب طبي، قبعة تخرج، قطار، كرة
const LM_PATHS = {
    sight: ['M5 21V4', 'M5 4h11l-2.5 4L16 12H5'],
    mall: ['M6 8h12l-1 12H7L6 8z', 'M9 8V7a3 3 0 0 1 6 0v1'],
    hospital: ['M12 6v12', 'M6 12h12'],
    university: ['M2 9.5L12 5l10 4.5-10 4.5L2 9.5z', 'M6.5 11.5v4.5c3 2 8 2 11 0v-4.5'],
    transport: ['M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M5 11h14', 'M9 21l1.5-4M15 21l-1.5-4'],
    sport: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.5 9h17M3.5 15h17', 'M12 3c3 3.5 3 14.5 0 18'],
};
function lmIcon(category, cls = 'ico mp-lm-ico') {
    const svg = lineIcon(LM_PATHS[category] || LM_PATHS.sight);
    svg.setAttribute('class', cls);
    return svg;
}
const pauseIcon = () => lineIcon(['M8 5v14', 'M16 5v14']);
const arrowIcon = (dir) => lineIcon(dir === 'next' ? ['M15 6l-6 6 6 6'] : ['M9 6l6 6-6 6']);
