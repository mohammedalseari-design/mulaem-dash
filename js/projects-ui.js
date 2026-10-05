/*
 * صفحة المشاريع والخريطة — أزرار التخطيط الجديد فقط (التصميم الرابع، css/projects.css).
 * لا يقرأ بيانات ولا يكتبها: الإضافة والتعديل والخريطة والبطاقات كلها في js/script.js كما كانت.
 *   - «إضافة مشروع» وزر الإغلاق: لوحة النموذج الجانبية (openProjectForm / closeProjectForm في script.js).
 *   - الجوال: «المزيد» يفتح القائمة كاملة، و«القائمة | الخريطة» تبدّل العرض، و«الفلاتر» تُظهر باقي الفلاتر.
 * ملف تقليدي (لا وحدة) يُحمَّل بعد script.js، فيرى map وcancelEdit وopenProjectForm في النطاق العام نفسه.
 */
(function () {
    'use strict';

    var body = document.body;
    var $ = function (id) { return document.getElementById(id); };
    var phone = function () { return window.matchMedia('(max-width: 700px)').matches; };
    var refreshMap = function () {
        setTimeout(function () { try { map.invalidateSize(); } catch (e) { /* الخريطة لم تُنشأ بعد */ } }, 60);
    };

    // «إضافة مشروع»: إن كان تعديل مفتوحاً يُلغى أولاً، ثم يُفتح نموذج فارغ ويُركَّز على الاسم
    var add = $('p4AddProject');
    if (add) {
        add.addEventListener('click', function () {
            var editing = $('editProjectId');
            if (editing && editing.value && typeof cancelEdit === 'function') cancelEdit();
            openProjectForm();
            setTimeout(function () { var name = $('projectName'); if (name) name.focus(); }, 150);
        });
    }

    // الإغلاق: يلغي التعديل إن كان تعديلاً (cancelEdit يغلق اللوحة بنفسه)، وإلا يغلق اللوحة ويبقي ما كُتب مسودةً
    var close = $('p4CloseForm');
    if (close) {
        close.addEventListener('click', function () {
            var editing = $('editProjectId');
            if (editing && editing.value && typeof cancelEdit === 'function') cancelEdit();
            else closeProjectForm();
        });
    }
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !body.classList.contains('p4-form-open')) return;
        if (document.querySelector('.modal.active, .swal2-container')) return;
        if (close) close.click();
    });

    // الجوال: «المزيد» يفتح القائمة الكاملة لوحةً سفلية، وتُغلق باختيار بند أو بالضغط خارجها
    var more = $('p4More');
    var nav = $('mainNav');
    function setNav(open) {
        body.classList.toggle('p4-nav-open', open);
        if (more) more.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (more) more.addEventListener('click', function () { setNav(!body.classList.contains('p4-nav-open')); });
    if (nav) nav.addEventListener('click', function (event) { if (event.target.closest('a')) setNav(false); });
    document.addEventListener('click', function (event) {
        if (!body.classList.contains('p4-nav-open')) return;
        if (event.target.closest('#mainNav') || event.target.closest('#p4More')) return;
        setNav(false);
    });

    // الجوال: القائمة أو الخريطة. الخريطة المخفية تُعاد حساب حجمها حين تظهر
    var listBtn = $('p4ShowList');
    var mapBtn = $('p4ShowMap');
    // الخريطة أُنشئت مخفية على الجوال (بلا حجم)، فأول ظهور لها يضبطها على دبابيس المشاريع
    var fittedOnce = false;
    function showMap(on) {
        body.classList.toggle('p4-map-open', on);
        if (listBtn) listBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
        if (mapBtn) mapBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (!on) return;
        setTimeout(function () {
            try {
                map.invalidateSize();
                if (!fittedOnce && markerClusterGroup && markerClusterGroup.getLayers().length) {
                    fittedOnce = true;
                    map.fitBounds(markerClusterGroup.getBounds(), { padding: [30, 30], maxZoom: 15 });
                }
            } catch (e) { /* الخريطة لم تُنشأ بعد */ }
        }, 60);
    }
    if (listBtn) listBtn.addEventListener('click', function () { showMap(false); });
    if (mapBtn) mapBtn.addEventListener('click', function () { showMap(true); });

    // «الموقع» على بطاقة مشروع: على الجوال تُعرض الخريطة أولاً ثم يُفتح المشروع عليها
    var locate = window.locateProject;
    if (typeof locate === 'function') {
        window.locateProject = function () {
            if (phone()) showMap(true);
            return locate.apply(this, arguments);
        };
    }

    // الجوال: البحث ظاهر دائماً، وباقي الفلاتر خلف زر «الفلاتر»
    var filters = $('p4FiltersToggle');
    if (filters) {
        filters.addEventListener('click', function () {
            var open = body.classList.toggle('p4-filters-open');
            filters.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    // تغيّر عرض النافذة (جوال ↔ كمبيوتر) يغيّر حجم الخريطة
    window.addEventListener('resize', refreshMap);
})();
