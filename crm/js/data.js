// استعلامات مساعدة مشتركة، كل واحد منها يُنفَّذ مرة واحدة لكل جلسة ويُخزَّن في الذاكرة.

import { supabase } from './supabase.js';
import { toAsciiDigits } from './ui.js';

/* ===================== طاقم العمل ===================== */
// crm_staff() دالة security definer تُرجع الموظفين غير الموقوفين، وهي الطريقة
// الوحيدة لتحويل owner_id / actor_id / assigned_to إلى اسم: سياسات profiles
// لا تسمح للوسيط بقراءة صف غيره.

let staffPromise = null;

export function staff() {
    if (!staffPromise) {
        staffPromise = supabase.rpc('crm_staff').then(({ data, error }) => {
            if (error) { staffPromise = null; throw error; }
            return data || [];
        });
    }
    return staffPromise;
}

export async function staffMap() {
    const list = await staff();
    const map = new Map();
    for (const person of list) map.set(person.id, person.fullname || person.username);
    return map;
}

export function staffName(map, id) {
    if (!id) return 'غير مُسند';
    return map.get(id) || 'مستخدم غير معروف';
}

export async function fieldStaff() {
    return (await staff()).filter((p) => p.role === 'field');
}

/* ===================== إعدادات الـ CRM ===================== */

let settingsPromise = null;

export function settings() {
    if (!settingsPromise) {
        settingsPromise = supabase.from('crm_settings').select('key, value').then(({ data, error }) => {
            if (error) { settingsPromise = null; throw error; }
            const map = {};
            for (const row of data || []) map[row.key] = row.value;
            return map;
        });
    }
    return settingsPromise;
}

export async function defaultCity() {
    const all = await settings();
    const city = all.default_city;
    return typeof city === 'string' ? city : '';
}

/* ===================== مفردات المخزون ===================== */
// المفردات تأتي من قاعدة البيانات لا من مسح للجدول: crm_property_types() تُرجع
// أنواع الوحدات الموجودة فعلاً في المخزون (v_units لا projects، ولهذا صار الروف
// مطروحاً بعد أن كان خارج القائمة)، و crm_districts() تُرجع الأحياء مرتبة بالتكرار.
// كلتاهما security invoker، فما لا يراه المستخدم لا يظهر له في القائمة.
//
// لا ترمي هذه الدالة أبداً: الفشل يُبلَّغ في propertyTypesError / districtsError
// ليتحوّل الحقل إلى نص حر، فلا يبقى النموذج مقفلاً بسبب مفردات.

let inventoryPromise = null;

export function inventoryVocabulary() {
    if (!inventoryPromise) {
        // Promise.resolve لأن باني PostgREST قابل للانتظار لا وعداً كاملاً (لا ‎.catch‎ عليه)
        const safe = (name) => Promise.resolve(supabase.rpc(name)).catch((error) => ({ data: null, error: error }));
        inventoryPromise = Promise.all([safe('crm_property_types'), safe('crm_districts')])
            .then(([types, districts]) => {
                // نتيجة ناقصة لا تُخزَّن: الفتحة التالية للنموذج تعيد السؤال
                if (types.error || districts.error) inventoryPromise = null;
                return {
                    propertyTypes: column(types.data, 'property_type'),
                    propertyTypesError: types.error || null,
                    districts: column(districts.data, 'district'),
                    districtsError: districts.error || null
                };
            });
    }
    return inventoryPromise;
}

// عمود واحد من صفوف الدالة، بلا فراغات ولا تكرار، مع الحفاظ على ترتيب الخادم
function column(rows, key) {
    const seen = [];
    for (const row of rows || []) {
        const value = row[key];
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (text && !seen.includes(text)) seen.push(text);
    }
    return seen;
}

/* ===================== أرقام الجوال ===================== */

// النسخة المطابقة لدالة public.normalize_phone في 005_crm_core.sql.
// تُستخدم احتياطاً فقط: المصدر الموثوق هو الخادم عبر normalizePhone().
function normalizePhoneLocal(value) {
    if (value === null || value === undefined) return null;
    let d = String(value).replace(/[^0-9+]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (d.startsWith('+')) return '+' + d.replace(/[^0-9]/g, '');
    if (/^966\d{9}$/.test(d)) return '+' + d;
    if (/^05\d{8}$/.test(d)) return '+966' + d.slice(1);
    if (/^5\d{8}$/.test(d)) return '+966' + d;
    return d || null;
}

// يطلب التطبيع من نفس الدالة التي يستخدمها المشغّل، حتى لا يختلف تطبيعان.
export async function normalizePhone(value) {
    const { data, error } = await supabase.rpc('normalize_phone', { p: value });
    if (error) return normalizePhoneLocal(value);
    return data;
}

/* ===================== البحث ===================== */

// PostgREST يفسّر الفاصلة والقوسين والاقتباس داخل ‎.or()‎ كقواعد نحوية، فتُزال.
export function sanitizeSearch(text) {
    return String(text || '').trim().replace(/[,()"\\]/g, ' ').replace(/\s+/g, ' ');
}

// الجوال مخزَّن بصيغة ‎+966…‎، فالبحث عن "0501234567" يجب أن يطابق آخر تسع خانات.
// الأرقام العربية تُحوَّل أولاً، وإلا مسحها ‎\D‎ وعاد البحث بلا نتائج بلا سبب ظاهر.
export function phoneNeedle(text) {
    const digits = toAsciiDigits(text).replace(/\D/g, '');
    if (digits.length < 6) return null;
    return digits.slice(-9);
}

/* ===================== مراحل الصفقة وأسباب الخسارة ===================== */
// جدولان مرجعيان صغيران يقرأهما كل الموظفين (سياسات 007_deals_commissions.sql)،
// فيُقرآن مرة واحدة لكل جلسة: المراحل بترتيب sort_order كما تُعرض في المسار،
// وأسباب الخسارة النشطة وحدها لأن القديمة تبقى في الصفقات المغلقة ولا تُقترح.

let stagesPromise = null;

export function dealStages() {
    if (!stagesPromise) {
        stagesPromise = supabase
            .from('deal_stages')
            .select('id, key, name_ar, sort_order, is_terminal, is_won')
            .order('sort_order', { ascending: true })
            .then(({ data, error }) => {
                if (error) { stagesPromise = null; throw error; }
                return data || [];
            });
    }
    return stagesPromise;
}

export async function stageMap() {
    const map = new Map();
    for (const stage of await dealStages()) map.set(stage.id, stage);
    return map;
}

export function stageName(map, id) {
    const stage = map.get(Number(id));
    return stage ? stage.name_ar : 'مرحلة ' + dashOrId(id);
}

function dashOrId(id) {
    return id === null || id === undefined ? '—' : String(id);
}

let reasonsPromise = null;

export function lostReasons() {
    if (!reasonsPromise) {
        reasonsPromise = supabase
            .from('lost_reasons')
            .select('id, key, name_ar, is_active')
            .eq('is_active', true)
            .order('id', { ascending: true })
            .then(({ data, error }) => {
                if (error) { reasonsPromise = null; throw error; }
                return data || [];
            });
    }
    return reasonsPromise;
}

// وسطاء الصفقات: الوسيط الميداني والمدير — وهما الدوران اللذان يظهران في
// v_broker_performance، ومركز الاتصال لا صفقات له أصلاً.
export async function brokerStaff() {
    return (await staff()).filter((p) => p.role === 'field' || p.role === 'admin');
}
