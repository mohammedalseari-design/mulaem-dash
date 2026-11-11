// اختبار crm/js/map-model.js («خريطة المشاريع»): الإصدارات المثبّتة، وصحة الإحداثيات، وجمع صفوف v_units مشروعاً واحداً
// (أقل سعر متاح، والوحدات المتاحة، وحالة البناء، والصورة)، والبحث والفلاتر، والعدد مع المعدود، وأقرب مشروع، وترتيب الجولة،
// والحدود، ورابط ‎#/map?p=12‎، وإعادة تلوين نمط الخريطة بحبر ملائم والأسماء بالعربية.
// التشغيل: node tests/map-model.test.mjs
import {
    MAPLIBRE_JS, MAPLIBRE_JS_SRI, MAPLIBRE_CSS, MAPLIBRE_CSS_SRI, RTL_PLUGIN, STYLE_URL, JEDDAH, TOUR_MS, MARK_URL,
    coordinate, validPoint, constructionKind, coverUrl, summarizeUnits, normalizeText, searchTokens, matchesSearch, freshFilters,
    filterProjects, activeFilterCount, placed, unplaced, cityChips, typeOptions, countWords, projectsText, onMapText, noLocationText,
    unitsAvailableText, priceFromText, placeText, statusPill, pinLabel, clusterLabel, haversineKm, nearestProject, kmText, nearestText,
    tourOrder, tourProgressText, boundsOf, inBounds, parseMapRoute, mapHash, MAP_COLORS, ARABIC_NAME, recolorStyle,
    JEDDAH_BOUNDS, inJeddah, nearestLandmarks, nearbyText, spreadDuplicates, tightGroup, listSearchTerm
} from '../crm/js/map-model.js';
import { LANDMARKS, LANDMARK_CATEGORIES } from '../crm/js/map-landmarks.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ===================== المكتبة ===================== */

t('maplibre and the rtl plugin are pinned to exact versions', /@4\.7\.1\/dist\/maplibre-gl\.js$/.test(MAPLIBRE_JS) && /@4\.7\.1\/dist\/maplibre-gl\.css$/.test(MAPLIBRE_CSS)
    && /@mapbox\/mapbox-gl-rtl-text@0\.2\.3\/mapbox-gl-rtl-text\.min\.js$/.test(RTL_PLUGIN));
t('every CDN url is https on unpkg, no «latest»', [MAPLIBRE_JS, MAPLIBRE_CSS, RTL_PLUGIN].every((u) => u.startsWith('https://unpkg.com/') && !/latest/.test(u)));
t('subresource integrity for the script and the stylesheet', /^sha384-[A-Za-z0-9+/]{64}$/.test(MAPLIBRE_JS_SRI) && /^sha384-[A-Za-z0-9+/]{64}$/.test(MAPLIBRE_CSS_SRI));
t('OpenFreeMap dark style, no key', STYLE_URL === 'https://tiles.openfreemap.org/styles/dark');
t('Jeddah centre, a 6 s tour, the copper mark from /crm/', JEDDAH.lat > 21.4 && JEDDAH.lat < 21.7 && JEDDAH.lng > 39 && JEDDAH.lng < 39.3
    && TOUR_MS === 6000 && MARK_URL === '../images/brand/mark.svg');

/* ===================== الإحداثيات ===================== */

t('coordinate: numbers and numeric text inside the limit', coordinate(21.5, 90) === 21.5 && coordinate('21.55', 90) === 21.55 && coordinate(' 39.1 ', 180) === 39.1);
t('coordinate: Arabic digits and the Arabic decimal mark', coordinate('٢١٫٥', 90) === 21.5);
t('coordinate: empty, boolean, text, NaN, infinity → null', [null, undefined, '', true, false, 'شارع', NaN, Infinity, '1e999', {}].every((v) => coordinate(v, 90) === null));
t('coordinate: out of range → null', coordinate(91, 90) === null && coordinate(-180.5, 180) === null && coordinate(180, 180) === 180);
t('valid point: both parts or nothing', same(validPoint(21.5, 39.2), { lat: 21.5, lng: 39.2 }) && validPoint(21.5, null) === null && validPoint(null, 39.2) === null);
t('valid point: (0, 0) is an empty value, not the sea', validPoint(0, 0) === null && validPoint('0', '0') === null && same(validPoint(0, 39), { lat: 0, lng: 39 }));
t('valid point: swapped or broken values are refused', validPoint(139.2, 21.5) === null && validPoint('lat', 'lng') === null);

/* ===================== حالة البناء والصورة ===================== */

t('construction: the two stored values', constructionKind('جاهز') === 'ready' && constructionKind('تحت_الإنشاء') === 'building' && constructionKind('تحت الإنشاء') === 'building');
t('construction: free text like the legacy page', constructionKind('قيد الإنشاء') === 'building' && constructionKind('على الخارطة') === 'building'
    && constructionKind('مكتمل البناء') === 'ready' && constructionKind('إفراغ فوري') === 'ready' && constructionKind('مرحلة التشطيب') === 'building');
t('construction: unknown or empty → nothing', constructionKind('') === '' && constructionKind(null) === '' && constructionKind('ممتاز') === '' && constructionKind({}) === '');
t('cover: an https link as it is', coverUrl('https://img.example/a.jpg') === 'https://img.example/a.jpg');
t('cover: the JSON text of { url, caption } (images->>0 of a classified brochure)', coverUrl('{"url": "https://img.example/b.jpg", "caption": "الواجهة"}') === 'https://img.example/b.jpg');
t('cover: an object as it is', coverUrl({ url: 'https://img.example/c.jpg' }) === 'https://img.example/c.jpg');
t('cover: http, javascript:, broken JSON and nothing → null', coverUrl('http://img.example/a.jpg') === null && coverUrl('javascript:alert(1)') === null
    && coverUrl('{"url": ') === null && coverUrl(null) === null && coverUrl(42) === null && coverUrl('') === null);

/* ===================== المشاريع من صفوف الوحدات ===================== */

const row = (o) => Object.assign({ project_id: 101, project_name: 'فلل الروضة', project_type: 'فيلا', purpose: 'sale', city: 'جدة', district: 'الروضة',
    latitude: 21.559, longitude: 39.156, project_image: 'https://img.example/101.jpg', construction_status: 'جاهز', status: 'approved', deleted_at: null,
    availability: 'available', unit_ord: 1, price: 900000, unit_count: 2, units_left: 2, unit_status: 'available' }, o);
const rows = [
    row({ unit_ord: 1, price: 900000, unit_count: 3, units_left: 1 }),
    row({ unit_ord: 2, price: 650000, unit_count: 5, units_left: 5 }),
    row({ unit_ord: 3, price: 400000, unit_count: 2, units_left: 0, unit_status: 'sold' }),
    row({ project_id: 102, project_name: 'شقق السلامة', project_type: 'شقة', district: 'السلامة', latitude: null, longitude: null, construction_status: 'تحت_الإنشاء',
        project_image: null, unit_ord: 0, price: 520000, unit_count: 1, units_left: null }),
    row({ project_id: 103, project_name: 'عمارة الصفا', project_type: 'عمارة', district: 'الصفا', latitude: '21.588', longitude: '39.219', availability: 'sold_out',
        unit_status: 'sold_out', unit_ord: 0, price: 1200000 }),
    row({ project_id: 104, project_name: 'مشروع ينتظر', status: 'pending' }),
    row({ project_id: 105, project_name: 'مشروع محذوف', deleted_at: '2026-11-01T10:00:00Z' }),
    row({ project_id: 106, project_name: 'بإحداثيات خاطئة', latitude: 210.5, longitude: 39.1, purpose: 'rent', unit_ord: 1, price: null, unit_count: 4, units_left: 4 }),
    row({ project_id: 'x', project_name: 'رقم غير صالح' })
];
const P = summarizeUnits(rows);
const byId = (id) => P.find((p) => p.id === id);
t('summary: one project per id, in the order seen; pending, deleted and bad ids never enter', same(P.map((p) => p.id), [101, 102, 103, 106]));
t('summary: the lowest price among available units only (the sold model at 400,000 is not «from»)', byId(101).minPrice === 650000);
t('summary: available units count what is left after deals (units_left)', byId(101).availableUnits === 6 && byId(101).totalUnits === 10);
t('summary: a whole-property row counts one unit', byId(102).availableUnits === 1 && byId(102).minPrice === 520000);
t('summary: a sold-out project has no price and is sold out', byId(103).soldOut === true && byId(103).minPrice === null && byId(103).availableUnits === 0);
t('summary: coordinates from text are read, broken ones dropped', byId(103).lat === 21.588 && byId(103).lng === 39.219 && byId(106).lat === null && byId(106).lng === null
    && byId(102).lat === null);
t('summary: construction, cover and place', byId(101).construction === 'ready' && byId(102).construction === 'building' && byId(101).image === 'https://img.example/101.jpg'
    && byId(102).image === null && byId(101).district === 'الروضة' && byId(101).city === 'جدة');
t('summary: available units without a price give no «from»', byId(106).minPrice === null && byId(106).availableUnits === 4 && byId(106).soldOut === false);
t('summary: no rows, null, junk → empty', same(summarizeUnits([]), []) && same(summarizeUnits(null), []) && same(summarizeUnits([null, {}, { project_id: null }]), []));
t('summary: never carries a commission field', P.every((p) => !Object.keys(p).some((k) => /commission/.test(k))));

/* ===================== البحث والفلاتر ===================== */

t('normalize: hamza, ta marbuta, alef maqsura, diacritics, tatweel, digits', normalizeText('أَحْمَد جـدة مستشفى ٢٣') === 'احمد جده مستشفي 23');
t('search words: «حي» and «مدينة» are dropped', same(searchTokens('حي الروضة'), ['الروضه']) && same(searchTokens('مدينة جدة'), ['جده']) && same(searchTokens('   '), []));
t('search: name, district, city, type; every word must match', matchesSearch(byId(101), 'فلل') && matchesSearch(byId(101), 'حي الروضه')
    && matchesSearch(byId(101), 'جده') && matchesSearch(byId(102), 'شقة السلامة') && !matchesSearch(byId(101), 'السلامة'));
t('search: the developer only when allowed (the admin)', (() => {
    const p = Object.assign({}, byId(101), { developer: 'شركة الأفق' });
    return !matchesSearch(p, 'الأفق') && matchesSearch(p, 'الأفق', true);
})());
t('filters: fresh = available only, nothing else', same(freshFilters(), { query: '', purpose: '', type: '', status: '', availableOnly: true, city: '' }));
t('filters: available only hides the sold out', same(filterProjects(P, {}).map((p) => p.id), [101, 102, 106])
    && same(filterProjects(P, { availableOnly: false }).map((p) => p.id), [101, 102, 103, 106]));
t('filters: purpose, type, status, city, query', same(filterProjects(P, { purpose: 'rent' }).map((p) => p.id), [106])
    && same(filterProjects(P, { type: 'شقة' }).map((p) => p.id), [102]) && same(filterProjects(P, { status: 'building' }).map((p) => p.id), [102])
    && same(filterProjects(P, { city: 'مكة' }).map((p) => p.id), []) && same(filterProjects(P, { query: 'الروضة' }).map((p) => p.id), [101, 106]));
t('filters: active count ignores search and city', activeFilterCount(freshFilters()) === 0 && activeFilterCount({ purpose: 'sale', type: 'شقة', status: 'ready', availableOnly: false }) === 4
    && activeFilterCount({ query: 'x', city: 'جدة' }) === 0);
t('placed / unplaced split', same(placed(P).map((p) => p.id), [101, 103]) && same(unplaced(P).map((p) => p.id), [102, 106]));
t('city chips and type options from the data, most first', same(cityChips([{ city: 'مكة' }, { city: 'جدة' }, { city: 'جدة' }, { city: '' }]), [{ value: 'جدة', count: 2 }, { value: 'مكة', count: 1 }])
    && same(typeOptions(P).map((x) => x.value + ' ' + x.count), ['فيلا 2', 'شقة 1', 'عمارة 1']));

/* ===================== النصوص ===================== */

const cases = [[1, 'مشروع واحد'], [2, 'مشروعان'], [3, '3 مشاريع'], [10, '10 مشاريع'], [11, '11 مشروعاً'], [25, '25 مشروعاً'], [99, '99 مشروعاً'],
    [100, '100 مشروع'], [101, '101 مشروع'], [102, '102 مشروع'], [103, '103 مشاريع'], [110, '110 مشاريع'], [111, '111 مشروعاً'], [200, '200 مشروع'], [1250, '1,250 مشروعاً']];
t('projects count: Arabic agreement 1, 2, 3–10, 11–99, and by the rest of a hundred', cases.every(([n, want]) => projectsText(n) === want),
    cases.map(([n]) => projectsText(n)));
t('on the map: the pill text, and none', onMapText(25) === '25 مشروعاً على الخريطة' && onMapText(1) === 'مشروع واحد على الخريطة'
    && onMapText(2) === 'مشروعان على الخريطة' && onMapText(3) === '3 مشاريع على الخريطة' && onMapText(0) === 'لا مشاريع على الخريطة');
t('no location: the note text', noLocationText(3) === '3 مشاريع بلا موقع' && noLocationText(1) === 'مشروع واحد بلا موقع');
t('available units: Arabic agreement', unitsAvailableText(0) === 'لا وحدات متاحة' && unitsAvailableText(1) === 'وحدة واحدة متاحة'
    && unitsAvailableText(2) === 'وحدتان متاحتان' && unitsAvailableText(5) === '5 وحدات متاحة' && unitsAvailableText(21) === '21 وحدة متاحة'
    && unitsAvailableText(100) === '100 وحدة متاحة');
t('count words: below a hundred is countText (ui.js) itself', countWords(7, ['أ', 'ب', 'جمع', 'مفرد']) === '7 جمع' && countWords(0, ['أ', 'ب', 'جمع', 'مفرد']) === '0 جمع');
t('price: «من 650,000 ر.س», nothing without a price', priceFromText(650000) === 'من 650,000 ر.س' && priceFromText(null) === '' && priceFromText(0) === '' && priceFromText('x') === '');
t('place: «district — city»', placeText(byId(101)) === 'الروضة — جدة' && placeText({ city: 'جدة' }) === 'جدة' && placeText(null) === '');
t('status pill: sold out first, then ready / under construction', same(statusPill(byId(103)), { text: 'نفد بالكامل', tone: 'out' })
    && same(statusPill(byId(101)), { text: 'جاهز', tone: 'ready' }) && same(statusPill(byId(102)), { text: 'تحت الإنشاء', tone: 'building' })
    && statusPill(Object.assign({}, byId(101), { construction: '' })) === null);
{
    const held = summarizeUnits([row({ project_id: 120, project_name: 'محجوز كله', unit_status: 'reserved', unit_ord: 0, price: 800000 })])[0];
    t('status pill: a project whose units are all reserved (none sold) says «محجوز بالكامل», not «نفد بالكامل»',
        held.soldOut === true && held.reservedUnits === 2 && same(statusPill(held), { text: 'محجوز بالكامل', tone: 'out' }));
}
t('pin name for screen readers: name, place, price', pinLabel(byId(101)) === 'فلل الروضة، الروضة — جدة، من 650,000 ر.س');
t('cluster name says what a press does', clusterLabel(13) === '13 مشروعاً هنا. اضغط لتكبير الخريطة عليها');

/* ===================== المسافة والجولة والحدود ===================== */

const MAKKAH = { lat: 21.4225, lng: 39.8262 };
const d = haversineKm(JEDDAH, MAKKAH);
t('distance Jeddah → Makkah is about 69 km', d > 64 && d < 74, d);
t('distance to itself is zero', haversineKm(JEDDAH, JEDDAH) === 0);
const pts = [{ id: 3, name: 'ج', lat: 21.60, lng: 39.20 }, { id: 1, name: 'أ', lat: 21.50, lng: 39.15 }, { id: 2, name: 'ب', lat: 21.55, lng: 39.17 }, { id: 4, name: 'د', lat: null, lng: null }];
t('nearest: the closest placed project and its distance', (() => { const n = nearestProject(pts, { lat: 21.551, lng: 39.171 }); return n && n.project.id === 2 && n.km < 0.2; })());
t('nearest: a tie goes to the smaller id, no point → null', (() => {
    const twins = [{ id: 9, lat: 21.5, lng: 39.2 }, { id: 5, lat: 21.5, lng: 39.2 }];
    return nearestProject(twins, { lat: 21.4, lng: 39.2 }).project.id === 5 && nearestProject(pts, null) === null
        && nearestProject(pts, { lat: 'x', lng: 1 }) === null && nearestProject([{ id: 1, lat: null, lng: null }], JEDDAH) === null;
})());
t('km text', kmText(0.04) === '0.1 كم' && kmText(2.44) === '2.4 كم' && kmText(15.6) === '16 كم' && kmText(-1) === '' && kmText('x') === '');
t('nearest text', nearestText({ project: { name: 'فلل الروضة' }, km: 2.4 }) === 'أقرب مشروع: فلل الروضة — 2.4 كم' && nearestText(null) === '');
t('tour: starts at the project nearest the centre, then hops to the nearest left', same(tourOrder(pts, { lat: 21.501, lng: 39.151 }).map((p) => p.id), [1, 2, 3]));
t('tour: without a start, by id; projects without a place are skipped', same(tourOrder(pts, null).map((p) => p.id), [1, 2, 3]) && same(tourOrder([], JEDDAH), []));
t('tour progress text', tourProgressText(1, 9) === 'المشروع 2 من 9');
t('bounds: west-south and east-north of the placed', same(boundsOf(pts), [[39.15, 21.5], [39.2, 21.6]]));
t('bounds: one project gets a small box, none → null', (() => {
    const b = boundsOf([{ lat: 21.5, lng: 39.2 }]);
    return b[0][0] < 39.2 && b[1][0] > 39.2 && b[0][1] < 21.5 && b[1][1] > 21.5 && boundsOf([pts[3]]) === null && boundsOf(null) === null;
})());
t('in bounds', inBounds(pts[2], boundsOf(pts)) && !inBounds({ lat: 22, lng: 39.2 }, boundsOf(pts)) && !inBounds(pts[3], boundsOf(pts)) && !inBounds(pts[0], null));

/* ===================== الرابط ===================== */

t('route: p=12 focuses the project', parseMapRoute('p=12').focus === 12 && parseMapRoute('x=1&p=7').focus === 7);
t('route: nothing, junk or too big → no focus', parseMapRoute(undefined).focus === null && parseMapRoute('p=abc').focus === null
    && parseMapRoute('p=0').focus === null && parseMapRoute('p=99999999999').focus === null && parseMapRoute('pp=3').focus === null);
t('hash for a project', mapHash(12) === '#/map?p=12' && mapHash('12') === '#/map?p=12' && mapHash('x') === '#/map' && mapHash(-3) === '#/map');

/* ===================== لون الخريطة ===================== */

const style = {
    version: 8, sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm', glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, ne2_shaded: { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'] }, unused: { type: 'geojson', data: {} } },
    layers: [
        { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
        { id: 'ne2', type: 'raster', source: 'ne2_shaded' },
        { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(27,27,29)' } },
        { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': 'rgb(10,10,10)' } },
        { id: 'highway_motorway_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, 'hsla(0,0%,85%,0.53)', 6, '#000'], 'line-width': 2 } },
        { id: 'road_oneway', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation', layout: { 'icon-image': 'oneway' } },
        { id: 'highway_name_motorway', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': ['to-string', ['get', 'ref']], 'text-font': ['Noto Sans Regular'] } },
        { id: 'place_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
            layout: { 'icon-image': ['step', ['zoom'], 'circle-11', 9, ''], 'icon-size': 0.4, 'text-anchor': 'left', 'text-offset': [0.5, 0.2], 'text-transform': 'uppercase',
                'text-field': ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']], ['coalesce', ['get', 'name_en'], ['get', 'name']]], 'text-font': ['Noto Sans Regular'] },
            paint: { 'text-color': 'rgb(101,101,101)', 'icon-opacity': 0.7 } },
        { id: 'something_new', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#fff' } }
    ]
};
const before = JSON.stringify(style);
const S = recolorStyle(style);
const L = (id) => S.layers.find((l) => l.id === id);
t('style: the original is not changed', JSON.stringify(style) === before);
t('style: no sprite, no raster, no icon-only layers, unused sources gone', S.sprite === undefined && !L('ne2') && !L('road_oneway')
    && same(Object.keys(S.sources), ['openmaptiles']) && S.glyphs === style.glyphs);
t('style: Mulaem ink for land and water', L('background').paint['background-color'] === MAP_COLORS.land && L('water').paint['fill-color'] === MAP_COLORS.water
    && MAP_COLORS.land === '#12282c');
t('style: names in Arabic first, the road ref kept', same(L('place_city').layout['text-field'], ARABIC_NAME)
    && same(ARABIC_NAME, ['coalesce', ['get', 'name:ar'], ['get', 'name']]) && same(L('highway_name_motorway').layout['text-field'], ['to-string', ['get', 'ref']]));
t('style: Arabic stays joined (no letter spacing, no upper case) and no icon keys left', L('place_city').layout['text-letter-spacing'] === 0
    && !('text-transform' in L('place_city').layout) && !Object.keys(L('place_city').layout).some((k) => /^icon-/.test(k))
    && !Object.keys(L('place_city').paint).some((k) => /^icon-/.test(k)) && L('place_city').layout['text-anchor'] === 'center');
t('style: labels light on ink with an ink halo', L('place_city').paint['text-color'] === MAP_COLORS.text && L('place_city').paint['text-halo-color'] === MAP_COLORS.halo);
t('style: roads keep their width, get ink colours (expression replaced)', L('highway_motorway_inner').paint['line-color'] === MAP_COLORS.motorway
    && L('highway_motorway_inner').paint['line-width'] === 2);
t('style: a layer it does not know still gets a dark colour', L('something_new').paint['line-color'] === MAP_COLORS.minor);
t('style: hidden 3D buildings right after the flat ones', (() => {
    const i = S.layers.findIndex((l) => l.id === 'building');
    const b = S.layers[i + 1];
    return b && b.id === 'mp-building-3d' && b.type === 'fill-extrusion' && b.layout.visibility === 'none' && b['source-layer'] === 'building';
})());
t('style: empty input gives an empty valid shell', same(recolorStyle(null).layers, []) && same(recolorStyle({}).sources, {}));

/* ===================== المعالم ===================== */

t('landmarks: 35 to 50, from every category', LANDMARKS.length >= 35 && LANDMARKS.length <= 50
    && Object.keys(LANDMARK_CATEGORIES).every((c) => LANDMARKS.some((l) => l.category === c)), LANDMARKS.length);
t('landmarks: every one inside the Jeddah box', LANDMARKS.every((l) => inJeddah(l)), LANDMARKS.filter((l) => !inJeddah(l)).map((l) => l.name));
t('landmarks: a known category, an Arabic and an English name', LANDMARKS.every((l) => LANDMARK_CATEGORIES[l.category]
    && /[؀-ۿ]/.test(l.name) && /[A-Za-z]/.test(l.en)));
t('landmarks: unique names and unique OpenStreetMap ids', new Set(LANDMARKS.map((l) => l.name)).size === LANDMARKS.length
    && new Set(LANDMARKS.map((l) => l.osm)).size === LANDMARKS.length);
t('landmarks: every one says which OpenStreetMap element it came from', LANDMARKS.every((l) => /^(node|way|relation)\/\d+$/.test(l.osm)));
t('landmarks: the data cannot be changed by a page', Object.isFrozen(LANDMARKS) && Object.isFrozen(LANDMARKS[0]));
t('Jeddah box and inJeddah', JEDDAH_BOUNDS.south < 21.5 && JEDDAH_BOUNDS.north > 21.7 && inJeddah({ lat: 21.54, lng: 39.17 })
    && !inJeddah({ lat: 24.71, lng: 46.67 }) && !inJeddah(null) && !inJeddah({ lat: 'x', lng: 39.1 }));
const L3 = [{ name: 'ج', lat: 21.60, lng: 39.20 }, { name: 'أ', lat: 21.50, lng: 39.15 }, { name: 'ب', lat: 21.55, lng: 39.17 }, { name: 'د', lat: 21.70, lng: 39.10 }, { name: 'بلا', lat: null, lng: 39.1 }];
t('nearest landmarks: the closest first, three by default', (() => {
    const r = nearestLandmarks({ lat: 21.551, lng: 39.171 }, L3);
    return same(r.map((x) => x.landmark.name), ['ب', 'أ', 'ج']) && r[0].km < r[1].km && r[1].km <= r[2].km;
})());
t('nearest landmarks: n, no place, a landmark without a place is skipped', nearestLandmarks({ lat: 21.5, lng: 39.15 }, L3, 1).length === 1
    && same(nearestLandmarks(null, L3), []) && same(nearestLandmarks({ lat: null, lng: 39 }, L3), [])
    && same(nearestLandmarks({ lat: 21.5, lng: 39.15 }, L3, 9).map((x) => x.landmark.name), ['أ', 'ب', 'ج', 'د']));
t('nearest landmarks: a tie goes by name', same(nearestLandmarks({ lat: 21.5, lng: 39.2 }, [{ name: 'ص', lat: 21.6, lng: 39.2 }, { name: 'ب', lat: 21.6, lng: 39.2 }]).map((x) => x.landmark.name), ['ب', 'ص']));
t('nearby text: «name · km» like «أقرب مشروع»', nearbyText({ landmark: { name: 'ردسي مول' }, km: 1.23 }) === 'ردسي مول · 1.2 كم' && nearbyText(null) === '');
t('nearest landmarks on the real data: the fountain is the closest to itself', (() => {
    const f = LANDMARKS.find((l) => l.osm === 'node/3098654094');
    return f && nearestLandmarks(f, LANDMARKS, 1)[0].landmark === f;
})());

{
    const a = { id: 1, lat: 21.5, lng: 39.2 }, b = { id: 2, lat: 21.5, lng: 39.2 }, c = { id: 3, lat: 21.6, lng: 39.1 };
    const at = spreadDuplicates([a, b, c]);
    const km = (x, y) => haversineKm({ lat: x[1], lng: x[0] }, { lat: y[1], lng: y[0] });
    t('stacked pins: two projects on one point are spread about 80 m apart, a lone project stays where it is',
        km(at.get(1), at.get(2)) > 0.07 && km(at.get(1), at.get(2)) < 0.09 && same(at.get(3), [39.1, 21.6]));
    t('stacked pins: a group within 150 m is tight, a spread one is not',
        tightGroup([[39.2, 21.5], [39.2005, 21.5004]]) === true && tightGroup([[39.2, 21.5], [39.1, 21.6]]) === false && tightGroup([[39.2, 21.5]]) === false);
    const shown = [{ name: 'فلل الروضة', district: 'الروضة' }, { name: 'شقق السلامة', district: 'السلامة' }];
    t('list link: the map search goes to «العقارات» only when the list can find it, without «حي»',
        listSearchTerm('حي الروضة', shown) === 'الروضة' && listSearchTerm('فيلا جدة', shown) === '' && listSearchTerm('  ', shown) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
