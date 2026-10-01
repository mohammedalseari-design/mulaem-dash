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
            address: p.address || '', city: p.city || '', district: p.district || '',
            latitude: str(p.latitude), longitude: str(p.longitude),
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
    function sessionUserOut(p) {
        return { id: str(p.legacy_id), username: p.username, fullname: p.fullname, role: p.role };
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

    // خطأ من auth-js غير الشبكة (رمز تجديد مرفوض أو منتهٍ، حساب أوقفه المدير، جلسة مفقودة):
    // auth-js حذف الجلسة بنفسه قبل أن يعيده، فهي «لا جلسة» لا عطل عابر
    function sessionEnded(error) {
        return /^Auth/.test(error.name || '') && error.name !== 'AuthRetryableFetchError';
    }

    // الجلسة ثم صف profiles. null = لا جلسة، أو جلسة بلا صف (حساب غير مفعّل).
    // أي خطأ آخر يُرمى (فيرد api/login.php بـ 500) ولا يُخلط بـ«لا جلسة»: اللوحة تُخرج
    // المستخدم عند not_found، فانقطاع عابر في الشبكة يجب ألا يصلها بهذا الشكل.
    async function myProfile() {
        var s = await sb.auth.getSession();
        if (s.error && !sessionEnded(s.error)) throw s.error;
        var session = s.data && s.data.session;
        if (!session) return null;
        var r = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        if (r.error) throw r.error;
        return r.data || null;
    }

    // أقصى انتظار لإلغاء الجلسة عند الخادم في dropSession
    var SIGN_OUT_WAIT_MS = 3000;

    // إنهاء الجلسة دون أن يرمي أبداً، وفي وقت محدود. نُلغيها عند الخادم بـ auth.admin.signOut(رمزها):
    // طلب POST /logout وحده لا يمسّ التخزين. أما auth.signOut فيحذف عند انتهائه ما في mulaem-auth ساعتها
    // أياً كان، فلو جاء ردّه بعد المهلة (بلا شبكة قد يتأخر نحو 25 ثانية) لمسح جلسة من دخل بعدنا.
    // ننتظر الطلب SIGN_OUT_WAIT_MS على الأكثر (صاحب الجلسة يظن أنه خرج فيغلق التبويب)، ثم نحذف
    // المفتاح بأنفسنا في كل الأحوال حتى لا يدخل بها التحميل التالي. حذفنا لا يبثّ SIGNED_OUT، فتلتقطه
    // التبويبات الأخرى بحدث storage (js/script.js و crm/js/app.js). بلا جلسة محفوظة لا طلب.
    // التخزين المحجوب وحده يُبقي الجلسة في ذاكرة auth-js، فلا يُنهيها إلا auth.signOut.
    async function dropSession() {
        var raw = null, token = null, blocked = false;
        try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { blocked = true; }
        try { token = raw ? JSON.parse(raw).access_token || null : null; } catch (e) { /* قيمة تالفة: لا رمز نُلغيه */ }
        if (token || blocked) {
            var timedOut = {};
            try {
                var out = await Promise.race([
                    token ? sb.auth.admin.signOut(token, 'local') : sb.auth.signOut({ scope: 'local' }),
                    new Promise(function (resolve) { setTimeout(resolve, SIGN_OUT_WAIT_MS, timedOut); })
                ]);
                if (out === timedOut) console.warn('[mulaem] signOut still pending after ' + SIGN_OUT_WAIT_MS + 'ms');
                else if (out && out.error) console.warn('[mulaem] signOut failed:', out.error);
            } catch (e) {
                console.warn('[mulaem] signOut failed:', e);
            }
        }
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
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
                // فحص الجلسة الحالية: الهوية من الخادم لا من المتصفح. لا يُنهي جلسة بنفسه؛
                // الواجهة تُنهيها عبر logout.php حتى لا تُعاد الصفحة قبل أن يُقرأ سبب الخروج
                var p = await myProfile();
                if (!p) return reply({ status: 'not_found' });
                // اسم الحساب مع الحظر: من يفتح الصفحة على جهاز مشترك قد لا يكون صاحب الجلسة المحفوظة
                if (p.is_blocked) return reply({ status: 'blocked', username: p.username });
                return reply({ status: 'ok', user: sessionUserOut(p) });
            }
            var b = readBody(init);
            if (!b.username || !b.password) return fail('أدخل اسم المستخدم وكلمة المرور');
            var res = await sb.auth.signInWithPassword({ email: toEmail(b.username), password: b.password });
            if (res.error) {
                // انقطاع الشبكة، أو ردّ لا يُقرأ (صفحة HTML من وسيط أو بوابة شبكة)، أو عطل في الخادم: ليس كلمة
                // مرور خاطئة. والحساب الموقوف يرفضه Supabase Auth نفسه (toggle_block يحظر مستخدم auth)، فلا
                // يصل فحص is_blocked أدناه: سبب المنع يُقرأ من الخطأ
                var authError = res.error;
                if (authError.name === 'AuthRetryableFetchError' || authError.name === 'AuthUnknownError' || authError.status >= 500) {
                    return fail('تعذر الاتصال بالخادم. أعد المحاولة.', 500);
                }
                if (authError.code === 'user_banned' || /banned/i.test(authError.message || '')) {
                    return fail('تم تعطيل حسابك من قبل الإدارة. تواصل مع المدير.');
                }
                // حدّ محاولات الدخول في Supabase Auth لكل عنوان IP (مكتب كامل خلف عنوان واحد): كلمة المرور
                // قد تكون صحيحة، وإعادة المحاولة فوراً تُطيل المنع
                if (authError.status === 429 || authError.code === 'over_request_rate_limit') {
                    return fail('محاولات دخول كثيرة من هذه الشبكة. انتظر بضع دقائق ثم أعد المحاولة.');
                }
                return fail('اسم المستخدم أو كلمة المرور غير صحيحة');
            }
            var profile;
            try {
                profile = await myProfile();
            } catch (e) {
                // دخول ناجح تعذّرت بعده قراءة الملف: لا نترك في mulaem-auth جلسة يظن صاحبها
                // أن دخوله فشل، فيدخل بها مباشرة من يفتح الصفحة بعده
                console.error('[mulaem] profile read after login failed:', e);
                await dropSession();
                return fail('تعذر التحقق من حسابك. أعد المحاولة.', 500);
            }
            if (!profile) { await dropSession(); return fail('الحساب غير مفعّل في النظام. تواصل مع المدير.'); }
            if (profile.is_blocked) { await dropSession(); return fail('تم تعطيل حسابك من قبل الإدارة. تواصل مع المدير.'); }
            return ok({ user: sessionUserOut(profile) });
        },

        // تسجيل الخروج: تناديه الواجهة بعد نافذة التأكيد وبعد تسجيل النشاط، لا قبلهما.
        // كان هنا مستمع نقرات على #logoutBtn يُنهي الجلسة قبل التأكيد، فمن ضغط «إلغاء»
        // بقي في لوحة بلا جلسة، وخرجت معه تبويبات /crm/ المفتوحة.
        logout: async function (method) {
            if (method !== 'POST') return fail('طلب غير مدعوم', 405);
            await dropSession();
            return ok();
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
})();
