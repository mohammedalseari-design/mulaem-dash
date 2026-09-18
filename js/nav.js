/*
 * شريط التنقل المشترك — إظهار بنود الأدوار في اللوحة القديمة.
 * ملف مستقل عن script.js عمداً: يقرأ profiles.role للمستخدم الحالي ويظهر الروابط
 * المسموح بها داخل #mainNav، ولا يلمس شيئاً آخر. الإخفاء تجميلي فقط (صفحات /crm/
 * تحرس مساراتها، والحماية في RLS)، فأي خطأ هنا يعني بقاء روابط المدير مخفية لا أكثر.
 */
(function () {
    'use strict';

    var nav = document.getElementById('mainNav');
    if (!nav) return;

    function guarded() {
        return nav.querySelectorAll('[data-admin],[data-deny]');
    }

    // الحالة الافتراضية: كل بند مشروط مخفي حتى يُعرف الدور
    function hideAll() {
        var links = guarded();
        for (var i = 0; i < links.length; i++) links[i].hidden = true;
    }

    function apply(role) {
        var links = guarded();
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            var allowed = link.hasAttribute('data-admin')
                ? role === 'admin'
                : role !== null && role !== link.getAttribute('data-deny');
            link.hidden = !allowed;
        }
    }

    function refresh() {
        var sb = window.mulaemSupabase;
        if (!sb || !sb.auth) return hideAll();

        sb.auth.getSession().then(function (result) {
            var session = result && result.data ? result.data.session : null;
            if (!session || !session.user) return hideAll();

            return sb.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
                .then(function (out) {
                    var role = out && out.data && out.data.role ? out.data.role : null;
                    apply(role);
                });
        }).catch(hideAll);
    }

    hideAll();
    refresh();

    // المستخدم قد يسجّل دخوله بعد تحميل الصفحة (اللوحة القديمة لا تعيد التحميل)
    try {
        window.mulaemSupabase.auth.onAuthStateChange(refresh);
    } catch (error) {
        /* الشيم لم يُحمَّل: البنود المشروطة تبقى مخفية */
    }
})();
