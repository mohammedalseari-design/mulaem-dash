// طابور المراجعة في ‎#/approvals‎: عمر الانتظار، وقوة مطابقة المشروع القائم، والحقول الناقصة التي يكملها المدير
// قبل الاعتماد — بلا DOM وبلا شبكة، فتُختبر وحدها.

import { PURPOSE } from './labels.js';
import { parseNumber, toAsciiDigits } from './ui.js';

// بعد يومين من الانتظار تُعلَّم المسودة في الطابور
export const LATE_DAYS = 2;

// أيام الانتظار الكاملة منذ iso، أو null لتاريخ غير مقروء. ساعة الجهاز المتقدمة لا تُنتج عمراً سالباً
export function waitDays(iso, now = Date.now()) {
    const start = iso ? new Date(iso).getTime() : NaN;
    if (!Number.isFinite(start)) return null;
    return Math.max(0, Math.floor((now - start) / 86400000));
}

// «أقل من يوم»، «يوم»، «يومان»، «3 أيام»، «12 يوماً»
export function waitText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 1) return 'أقل من يوم';
    if (days === 1) return 'يوم';
    if (days === 2) return 'يومان';
    if (days <= 10) return days + ' أيام';
    return days + ' يوماً';
}

export function isLate(days) {
    return days !== null && days !== undefined && days >= LATE_DAYS;
}

// مرشّحو المشروع القائم كما كتبهم agent_find_duplicates (027): الرتبة 1 الاسم نفسه بعد التطبيع، و2 اسم يحوي الآخر،
// و3 موقع قريب، و4 الحي والنوع فقط. التحذير الأحمر للرتبتين 1 و2، والباقي يبقى في «مكرّرات محتملة».
// مسودة أقدم من 027 بلا رتبة تُحذَّر كما كانت تُحذَّر قبله
function projectEntries(duplicates) {
    return (Array.isArray(duplicates) ? duplicates : []).filter((d) => d && d.kind === 'project' && d.id);
}

export function strongMatches(duplicates) {
    return projectEntries(duplicates).filter((d) => d.rank === undefined || d.rank === null || d.rank === '1' || d.rank === '2'
        || d.rank === 1 || d.rank === 2);
}

export function weakMatches(duplicates) {
    const strong = strongMatches(duplicates);
    return projectEntries(duplicates).filter((d) => !strong.includes(d));
}

// المشاريع القائمة التي أوقف تطابقُ اسمها طلبَ «مشروع جديد» بلا مسودة: يسمّيها الخادم في رسالة الطلب (sameNameText في
// agent-run/validate.ts): «جوهرة الصفا» (#54، الصفا)، «…» (#…). [{ id, name }] بلا تكرار، أو [] لرسالة أخرى
export function matchedProjects(message) {
    const out = [];
    for (const m of String(message ?? '').matchAll(/«([^»]+)» \(#(\d+)/g)) {
        if (!out.some((p) => p.id === m[2])) out.push({ id: m[2], name: m[1] });
    }
    return out;
}

// الحقول المهمة التي يكملها المدير في مسودة مشروع جديد إن لم يذكرها المصدر. الأرقام تُقرأ أرقاماً لأن دالة الاعتماد
// تحوّلها ‎::numeric‎ و‎::int‎ و‎::date‎، فنصٌّ مثل «600 ألف» كان يُفشل الاعتماد كله
export const PROJECT_AVAILABILITY = { available: 'متاحة', sold_out: 'نفدت بالكامل' };
export const FILL_FIELDS = {
    price: 'money', availability: 'availability', area: 'number', rooms: 'integer',
    delivery_date: 'date', district: 'text', type: 'text', purpose: 'purpose'
};

function blank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

// ما ينقص هذه المسودة من FILL_FIELDS: مسودة مشروع جديد فقط. في التعديل على مشروع قائم يكتب الحقل المضاف فوق قيمة
// المشروع، فلا يُعرض هناك إلا ما في المقترح أصلاً
export function fillableFields(draft) {
    if (!draft || draft.target_kind !== 'project' || !blank(draft.target_id)) return [];
    const proposed = draft.proposed || {};
    return Object.keys(FILL_FIELDS).filter((key) => blank(proposed[key]));
}

// قيمة حقل مضاف كما تُحفظ في المقترح: { value } أو { skip } للفارغ أو { error } بالعربية
export function parseFill(key, raw) {
    const kind = FILL_FIELDS[key];
    const text = String(raw ?? '').trim();
    if (!kind || text === '') return { skip: true };
    if (kind === 'money' || kind === 'number' || kind === 'integer') {
        // «600 ألف» و«1.2 مليون» ليست أرقاماً: الأحرف تُرفض بدل أن يُقرأ منها 600 أو 1.2
        if (/[^\d٠-٩۰-۹.,٬٫\s]/.test(text)) return { error: 'اكتب ' + (kind === 'money' ? 'المبلغ' : 'الرقم') + ' أرقاماً فقط' };
        const n = parseNumber(text);
        if (n === null || n <= 0) return { error: 'اكتب رقماً أكبر من صفر' };
        if (kind === 'integer' && !Number.isInteger(n)) return { error: 'اكتب عدداً صحيحاً' };
        return { value: n };
    }
    if (kind === 'date') {
        const ascii = toAsciiDigits(text);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ascii) || isNaN(new Date(ascii + 'T00:00:00Z').getTime())) return { error: 'اختر تاريخاً صحيحاً' };
        return { value: ascii };
    }
    if (kind === 'availability') return PROJECT_AVAILABILITY[text] ? { value: text } : { error: 'اختر التوفر من القائمة' };
    if (kind === 'purpose') return PURPOSE[text] ? { value: text } : { error: 'اختر الغرض من القائمة' };
    return { value: text };
}
