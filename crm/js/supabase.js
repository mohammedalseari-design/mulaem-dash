// عميل Supabase واحد لكل صفحة.
//
// storageKey مطابق تماماً لما تستخدمه اللوحة القديمة ('mulaem-auth')، فالمستخدم
// الذي سجّل دخوله في /projects.html يجد نفسه داخل /crm/ بلا تسجيل دخول ثانٍ، والعكس.
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

// الخادم يرد 1000 صف على الأكثر في الطلب الواحد (max_rows)، وما زاد يُقطع بصمت. fetchAll يقرأ الجدول كله على
// دفعات. build يبني استعلاماً جديداً بترتيب ثابت في كل نداء. يعيد { data, error } كالاستعلام الواحد.
export const MAX_ROWS = 1000;
export async function fetchAll(build) {
    const rows = [];
    for (let from = 0; ; from += MAX_ROWS) {
        const { data, error } = await build().range(from, from + MAX_ROWS - 1);
        if (error) return { data: null, error };
        rows.push(...(data || []));
        if (!data || data.length < MAX_ROWS) return { data: rows, error: null };
    }
}

// مدى ‎.range()‎ لصفحة رقمها page (يبدأ من صفر)
export function pageRange(page, size = PAGE_SIZE) {
    const from = page * size;
    return [from, from + size - 1];
}
