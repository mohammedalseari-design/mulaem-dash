/*
 * نظام ملائم العقاري — طبقة الاتصال بـ Supabase
 *
 * الواجهة (script.js) ما زالت تنادي api/*.php كما في النظام القديم.
 * هذا الملف يعترض تلك النداءات ويحوّلها إلى Supabase (Auth + Postgres + Storage)،
 * ويرجع نفس شكل الردود القديمة حتى لا تتغير الواجهة.
 *
 * الأمان ليس هنا: كل الصلاحيات مفروضة في قاعدة البيانات (RLS) وفي دالة admin-users.
 */
(function () {
    'use strict';

    var cfg = window.MULAEM_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY || !window.supabase) {
        console.error('[mulaem] إعدادات Supabase ناقصة: راجع js/config.js وتحميل مكتبة supabase-js');
        return;
    }

    var STORAGE_KEY = 'mulaem-auth';
    var BUCKET = 'project-images';
    var EMAIL_DOMAIN = cfg.AUTH_EMAIL_DOMAIN || 'users.mulaem.sa';

    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY }
    });
    window.mulaemSupabase = sb;

    var realFetch = window.fetch.bind(window);

    // ---------- أدوات ----------
    function reply(obj, status) {
        return new Response(JSON.stringify(obj), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
    function ok(extra) { return reply(Object.assign({ status: 'success' }, extra || {})); }
    function fail(message, status) { return reply({ status: 'error', message: message }, status || 200); }

    function toEmail(username) {
        var u = String(username || '').trim().toLowerCase();
        return u.indexOf('@') > -1 ? u : u + '@' + EMAIL_DOMAIN;
    }

    // النظام القديم (PHP) كان يرجع كل القيم كنصوص — نحافظ على نفس الشكل
    function str(v) { return v === null || v === undefined ? null : String(v); }
    function money(v) { return v === null || v === undefined ? null : Number(v).toFixed(2); }
    function stamp(v) { return v ? String(v).replace('T', ' ').slice(0, 19) : null; }
    function flag(v) { return v ? '1' : '0'; }

    function projectOut(p) {
        return {
            id: str(p.id), name: p.name, type: p.type,
            price: money(p.price), area: money(p.area),
            address: p.address || '', latitude: str(p.latitude), longitude: str(p.longitude),
            notes: p.notes || '', employee: p.employee, added_by: p.added_by,
            images: Array.isArray(p.images) ? p.images : [],
            details: p.details && typeof p.details === 'object' ? p.details : {},
            status: p.status, date_added: stamp(p.date_added),
            rega_ad_license: p.rega_ad_license || '', listing_expires_at: p.listing_expires_at || '',
            deletion_requested: flag(p.deletion_requested),
            rejection_reason: p.rejection_reason, deleted_at: stamp(p.deleted_at),
            availability: p.availability
        };
    }
    function userOut(u) {
        return {
            id: str(u.legacy_id), username: u.username, fullname: u.fullname, role: u.role,
            email: u.email || '', created_at: stamp(u.created_at), is_blocked: flag(u.is_blocked)
        };
    }
    function activityOut(a) {
        return {
            id: str(a.id), user_id: str(a.user_id), action: a.action, details: a.details,
            timestamp: stamp(a.timestamp), user_name: a.user_name
        };
    }

    function fileNames(images) {
        return (Array.isArray(images) ? images : []).map(function (u) {
            return String(u).split('/').pop().split('?')[0];
        });
    }

    function num(v) {
        if (v === '' || v === null || v === undefined) return null;
        var n = Number(v);
        return isFinite(n) ? n : null;
    }

    function projectIn(b) {
        var images = Array.isArray(b.images) ? b.images : [];
        return {
            name: b.name, type: b.type, availability: b.availability || 'available',
            price: num(b.price), area: num(b.area), address: b.address || null,
            latitude: num(b.latitude), longitude: num(b.longitude), notes: b.notes || null,
            rega_ad_license: b.rega_ad_license || null,
            listing_expires_at: b.listing_expires_at || null,
            images: images, image_files: fileNames(images),
            details: b.details && typeof b.details === 'object' ? b.details : {}
        };
    }

    function readBody(init) {
        if (!init || init.body === undefined || init.body === null) return {};
        if (typeof init.body === 'string') {
            try { return JSON.parse(init.body); } catch (e) { return {}; }
        }
        return init.body; // FormData
    }

    async function myProfile() {
        var s = await sb.auth.getSession();
        var session = s.data && s.data.session;
        if (!session) return null;
        var r = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        return r.data || null;
    }

    async function callAdmin(payload) {
        var r = await sb.functions.invoke('admin-users', { body: payload });
        if (r.error) {
            var msg = 'فشل تنفيذ العملية';
            try {
                var ctx = r.error.context;
                if (ctx && typeof ctx.json === 'function') {
                    var j = await ctx.json();
                    if (j && j.message) msg = j.message;
                }
            } catch (e) { /* keep default */ }
            return fail(msg);
        }
        return reply(r.data || { status: 'success' });
    }

    // ---------- نقاط النهاية ----------
    var routes = {
        // تسجيل الدخول + فحص الحظر
        login: async function (method, q, init) {
            if (method === 'GET') {
                var p = await myProfile();
                if (!p) return reply({ status: 'not_found' });
                return reply({ status: p.is_blocked ? 'blocked' : 'ok' });
            }
            var b = readBody(init);
            if (!b.username || !b.password) return fail('أدخل اسم المستخدم وكلمة المرور');
            var res = await sb.auth.signInWithPassword({ email: toEmail(b.username), password: b.password });
            if (res.error) return fail('اسم المستخدم أو كلمة المرور غير صحيحة');
            var profile = await myProfile();
            if (!profile) { await sb.auth.signOut({ scope: 'local' }); return fail('الحساب غير مفعّل في النظام. تواصل مع المدير.'); }
            if (profile.is_blocked) { await sb.auth.signOut({ scope: 'local' }); return fail('تم تعطيل حسابك من قبل الإدارة. تواصل مع المدير.'); }
            return ok({ user: { id: str(profile.legacy_id), username: profile.username, fullname: profile.fullname, role: profile.role } });
        },

        setup_check: async function () {
            var r = await sb.from('site_settings').select('key').limit(1);
            if (r.error) return reply({ status: 'error', message: r.error.message });
            return reply({ status: 'success', message: 'Connected successfully!', details: { backend: 'supabase' } });
        },

        projects: async function (method, q, init) {
            var id = q.get('id');
            if (method === 'GET') {
                if (id) {
                    var one = await sb.from('projects').select('*').eq('id', id).maybeSingle();
                    if (one.error) return fail(one.error.message, 500);
                    return reply(one.data ? projectOut(one.data) : {});
                }
                var list = await sb.from('projects').select('*').order('id', { ascending: false });
                if (list.error) return fail(list.error.message, 500);
                return reply(list.data.map(projectOut));
            }
            var b = readBody(init);
            if (method === 'POST' && !id && !b.id) {
                var ins = await sb.from('projects').insert(projectIn(b)).select('id').maybeSingle();
                if (ins.error || !ins.data) return fail(ins.error ? 'غير مصرح بإضافة مشروع: ' + ins.error.message : 'تعذر حفظ المشروع');
                return ok({ id: str(ins.data.id) });
            }
            if (method === 'PUT' || method === 'POST') {
                var pid = id || b.id;
                var patch;
                if (b.action === 'approve') patch = { status: 'approved', rejection_reason: null };
                else if (b.action === 'reject') patch = { status: 'rejected', rejection_reason: b.rejection_reason || null };
                else if (b.action === 'update_availability') patch = { availability: b.availability };
                else patch = projectIn(b);
                var up = await sb.from('projects').update(patch).eq('id', pid).select('id');
                if (up.error) return fail(up.error.message);
                if (!up.data || !up.data.length) return fail('غير مصرح بهذا الإجراء أو المشروع غير موجود');
                return ok();
            }
            if (method === 'DELETE') {
                var del = await sb.from('projects').delete().eq('id', id).select('id');
                if (del.error) return fail(del.error.message);
                if (!del.data || !del.data.length) return fail('غير مصرح بالحذف أو المشروع غير موجود');
                return ok();
            }
            return fail('طلب غير مدعوم', 405);
        },

        upload: async function (method, q, init) {
            var form = readBody(init);
            var file = form && typeof form.get === 'function' ? form.get('image') : null;
            if (!file) return fail('لم يتم استلام صورة');
            var name = 'projects/img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg';
            var up = await sb.storage.from(BUCKET).upload(name, file, { contentType: file.type || 'image/jpeg', upsert: false });
            if (up.error) return fail('فشل رفع الصورة: ' + up.error.message);
            return ok({ url: sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl });
        },

        users: async function (method, q, init) {
            if (method === 'GET') {
                var r = await sb.from('profiles').select('*').order('legacy_id', { ascending: false });
                if (r.error) return fail(r.error.message, 500);
                return reply(r.data.map(userOut));
            }
            var b = readBody(init);
            if (method === 'POST') return callAdmin({ action: 'create', username: b.username, fullname: b.fullname, password: b.password, role: b.role });
            if (method === 'PUT' && b.action === 'toggle_block') return callAdmin({ action: 'toggle_block', id: b.id, is_blocked: !!Number(b.is_blocked) });
            if (method === 'PUT' && b.action === 'change_password') return callAdmin({ action: 'change_password', id: b.id, password: b.password });
            if (method === 'DELETE') return callAdmin({ action: 'delete', id: q.get('id') });
            return fail('طلب غير مدعوم', 405);
        },

        activities: async function (method, q, init) {
            if (method === 'GET') {
                var r = await sb.from('activities').select('*').order('id', { ascending: false }).limit(50);
                if (r.error) return reply([]);
                return reply(r.data.map(activityOut));
            }
            var b = readBody(init);
            var ins = await sb.from('activities').insert({ action: b.action, details: b.details });
            return ins.error ? fail(ins.error.message) : ok();
        }
    };

    // ---------- اعتراض fetch لنداءات api/*.php فقط ----------
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var m = /(?:^|\/)api\/([a-z_]+)\.php(\?.*)?$/i.exec(url.replace(/^https?:\/\/[^/]+\//, ''));
        if (!m || !routes[m[1]]) return realFetch(input, init);
        var method = ((init && init.method) || 'GET').toUpperCase();
        var query = new URLSearchParams((m[2] || '').replace(/^\?/, ''));
        return routes[m[1]](method, query, init).catch(function (e) {
            console.error('[mulaem] ' + m[1] + ' failed:', e);
            return fail('تعذر الاتصال بالخادم', 500);
        });
    };

    // تسجيل الخروج: الواجهة تمسح sessionStorage، ونحن ننهي جلسة Supabase أيضاً
    document.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('#logoutBtn') : null;
        if (!btn) return;
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
        sb.auth.signOut({ scope: 'local' }).catch(function () {});
    }, true);
})();
