// عميل Supabase واحد لكل صفحة.
//
// storageKey مطابق تماماً لما تستخدمه اللوحة القديمة ('mulaem-auth')، فالمستخدم
// الذي سجّل دخوله في /index.html يجد نفسه داخل /crm/ بلا تسجيل دخول ثانٍ، والعكس.
// لا نحمّل هنا supabase-shim.js ولا script.js: هذه الصفحة تتحدث إلى PostgREST مباشرة.

const cfg = window.MULAEM_CONFIG;

if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
    throw new Error('إعدادات الاتصال غير محمّلة (js/config.js)');
}
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('مكتبة supabase-js غير محمّلة');
}

export const config = cfg;

export const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'mulaem-auth'
    }
});

// حجم الصفحة الموحّد لكل القوائم. لا تُحمَّل جداول كاملة في الذاكرة أبداً.
export const PAGE_SIZE = 25;

// مدى ‎.range()‎ لصفحة رقمها page (يبدأ من صفر)
export function pageRange(page, size = PAGE_SIZE) {
    const from = page * size;
    return [from, from + size - 1];
}
