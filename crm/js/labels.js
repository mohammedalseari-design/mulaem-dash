// مفردات عقد البيانات بالعربية. القيم هنا هي القيم المخزَّنة حرفياً في قاعدة البيانات
// (قيود CHECK في 005_crm_core.sql)، والنص المقابل هو ما يراه المستخدم فقط.

export const CLIENT_STATUS = {
    active: 'نشط',
    inactive: 'غير نشط',
    blacklist: 'قائمة سوداء'
};

export const CLIENT_STATUS_TONE = {
    active: 'green',
    inactive: 'neutral',
    blacklist: 'red'
};

export const CLIENT_TYPE = {
    buy: 'شراء',
    rent: 'استئجار',
    sell: 'بيع',
    invest: 'استثمار'
};

// source نص حر في قاعدة البيانات؛ هذه القيم المقترحة في التصميم
export const CLIENT_SOURCES = ['إعلان', 'توصية', 'اتصال', 'معرض', 'موقع', 'واتساب', 'أخرى'];

export const PURPOSE = {
    sale: 'بيع',
    rent: 'إيجار'
};

export const REQ_STATUS = {
    open: 'مفتوح',
    matched: 'تمت المطابقة',
    won: 'مُنجز',
    closed: 'مغلق'
};

export const REQ_STATUS_TONE = {
    open: 'blue',
    matched: 'gold',
    won: 'green',
    closed: 'neutral'
};

export const PRIORITY = {
    1: 'عالية',
    2: 'متوسطة',
    3: 'منخفضة'
};

export const PRIORITY_TONE = {
    1: 'red',
    2: 'gold',
    3: 'neutral'
};

export const FINANCING = ['نقد', 'تمويل', 'مدعوم'];

export const MATCH_STATE = {
    shared: 'شورك مع العميل',
    interested: 'مهتم',
    not_interested: 'غير مهتم',
    viewing: 'معاينة'
};

export const MATCH_STATE_TONE = {
    shared: 'blue',
    interested: 'green',
    not_interested: 'red',
    viewing: 'gold'
};

export const CHANNEL = {
    call: 'مكالمة',
    whatsapp: 'واتساب',
    visit: 'زيارة',
    other: 'أخرى'
};

export const FOLLOW_UP_STATUS = {
    pending: 'قيد الانتظار',
    done: 'تمت',
    cancelled: 'ملغاة'
};

export const FOLLOW_UP_STATUS_TONE = {
    pending: 'orange',
    done: 'green',
    cancelled: 'neutral'
};

// أنواع الأحداث في crm_events (تُكتب آلياً من مشغّل crm_log_event)
export const EVENT_TYPE = {
    client_created: 'أُنشئ العميل',
    client_reassigned: 'أُعيد إسناد العميل',
    client_status_changed: 'تغيّرت حالة العميل',
    requirement_created: 'طلب جديد',
    requirement_status_changed: 'تغيّرت حالة الطلب',
    match_shared: 'شورك عرض مع العميل',
    match_interested: 'العميل مهتم بعرض',
    match_not_interested: 'العميل غير مهتم بعرض',
    match_viewing: 'معاينة عرض',
    follow_up_scheduled: 'جُدولت متابعة',
    follow_up_done: 'أُنجزت متابعة',
    follow_up_cancelled: 'أُلغيت متابعة',
    note: 'ملاحظة',
    // أحداث الصفقات والعمولات (مشغّلات 007_deals_commissions.sql)
    deal_opened: 'فُتحت صفقة',
    deal_stage_changed: 'تغيّرت مرحلة الصفقة',
    property_sold_flag: 'العقار بيع فعلياً — راجع حالته في اللوحة',
    commission_recorded: 'سُجّلت عمولة',
    commission_due: 'العمولة مستحقة',
    commission_invoiced: 'صدرت فاتورة العمولة',
    commission_partial: 'تحصيل جزئي للعمولة',
    commission_collected: 'حُصّلت العمولة',
    commission_waived: 'أُعفيت العمولة'
};

// درجات المطابقة كما في وصف المرحلة 3
export function scoreLabel(score) {
    const n = Number(score);
    if (n >= 85) return { text: 'مطابقة ممتازة', tone: 'green' };
    if (n >= 70) return { text: 'مطابقة جيدة', tone: 'gold' };
    return { text: 'مطابقة محتملة', tone: 'neutral' };
}

export function label(map, key, fallback = '—') {
    if (key === null || key === undefined || key === '') return fallback;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : String(key);
}

/* ===================== الصفقات والعمولات (007_deals_commissions.sql) ===================== */

// أسماء المراحل تأتي من جدول deal_stages نفسه (name_ar)، فلا تُكرَّر هنا.
// هذه ألوان العرض فقط، مفتاحها معرّف المرحلة الثابت 1..7.
export const DEAL_STAGE_TONE = {
    1: 'blue',
    2: 'gold',
    3: 'orange',
    4: 'gold',
    5: 'blue',
    6: 'green',
    7: 'red'
};

export const COMMISSION_STATUS = {
    due: 'مستحقة',
    invoiced: 'صدرت فاتورة',
    partial: 'محصّلة جزئياً',
    collected: 'محصّلة',
    waived: 'معفاة'
};

export const COMMISSION_STATUS_TONE = {
    due: 'orange',
    invoiced: 'blue',
    partial: 'gold',
    collected: 'green',
    waived: 'neutral'
};

// الحالتان اللتان يكتبهما المدير؛ partial و collected يشتقّهما المشغّل من المحصَّل
export const COMMISSION_STATUS_EDITABLE = {
    due: 'مشتقة من التحصيل',
    invoiced: 'صدرت فاتورة',
    waived: 'معفاة'
};
