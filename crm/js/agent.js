// أدوات المساعد الذكي المشتركة بين شاشة الطلب وشاشة الاعتماد.
//
// قاعدتان ثابتتان هنا:
//   1) المرفقات في مخزن خاص (agent-sources)؛ لا تُقرأ إلا برابط موقّع قصير العمر
//      يصدره المخزن لمن تسمح له سياسته — فلا يوجد رابط دائم لملف عميل.
//   2) أي رابط قادم من قاعدة البيانات يمرّ على safeUrl قبل أن يوضع في href،
//      فالمصدر الخارجي لا يحقن javascript: في الصفحة.

import { supabase } from './supabase.js';

export const BUCKET = 'agent-sources';

// الحدود نفسها مفروضة في مشغّل agent_sources_guard وفي حد حجم المخزن؛
// ما هنا رسالة مبكرة للمستخدم لا حماية.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const MAX_PDF_PAGES = 20;

// الاستخراج الآلي (وظيفة agent-run ومفتاح Anthropic) من الجولة B.
// ما دام false فالطلب يُحفظ ومرفقاته تُرفع، ولا يُنادى أي خادم خارجي.
export const EXTRACTION_ENABLED = false;

/* ===================== أنواع الملفات المقبولة ===================== */
// النوع يُحدَّد من الامتداد لا مما يقوله المتصفح، ويُرسل صراحة إلى المخزن،
// فقائمة الأنواع المسموحة على المخزن لا ترفض ملفاً سليماً بسبب نظام تشغيل.
const EXT = {
    pdf:  { kind: 'pdf',   mime: 'application/pdf' },
    png:  { kind: 'image', mime: 'image/png' },
    jpg:  { kind: 'image', mime: 'image/jpeg' },
    jpeg: { kind: 'image', mime: 'image/jpeg' },
    webp: { kind: 'image', mime: 'image/webp' },
    csv:  { kind: 'sheet', mime: 'text/csv' },
    xlsx: { kind: 'sheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    xls:  { kind: 'sheet', mime: 'application/vnd.ms-excel' },
    txt:  { kind: 'text',  mime: 'text/plain' }
};

export const ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls,.txt';

export function fileKind(name) {
    const dot = String(name || '').lastIndexOf('.');
    if (dot < 0) return null;
    return EXT[String(name).slice(dot + 1).toLowerCase()] || null;
}

// مفاتيح المخزن تُكتب بحروف لاتينية وأرقام فقط: الاسم العربي يبقى في العرض،
// والمفتاح يُشتق منه بلا محارف قد يرفضها المخزن أو تُفسَّر كمسار.
export function storageName(index, original) {
    const raw = String(original || 'file');
    const dot = raw.lastIndexOf('.');
    const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
    const stem = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40);
    return index + '-' + (stem.replace(/^_+|_+$/g, '') || 'file') + '.' + ext;
}

export function baseName(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1] || String(path || '');
}

/* ===================== بصمة الملف وعدد الصفحات ===================== */

export async function sha256Hex(buffer) {
    if (!crypto || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// عدّ تقريبي لصفحات PDF من بنية الملف نفسه. ملف بأجسام مضغوطة قد لا يكشف عدده
// هنا فيعود null، ولا يُمنع الرفع بسببه: التحقق القاطع يقع عند قراءة الملف
// فعلياً في وظيفة الاستخراج (الجولة B).
export function pdfPageCount(buffer) {
    let text = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    const pages = text.match(/\/Type\s*\/Page[^s]/g);
    if (pages && pages.length) return pages.length;
    const counts = text.match(/\/Count\s+(\d+)/g);
    if (counts && counts.length) {
        return counts.reduce((max, c) => Math.max(max, Number(c.replace(/\D/g, '')) || 0), 0) || null;
    }
    return null;
}

/* ===================== الروابط ===================== */

// رابط من قاعدة البيانات لا يوضع في href قبل هذا: javascript: و data: مرفوضان.
export function safeUrl(value) {
    const text = String(value || '').trim();
    return /^https?:\/\//i.test(text) ? text : null;
}

export async function signedUrl(path, seconds = 120) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
    if (error) throw error;
    if (!data || !data.signedUrl) throw new Error('تعذّر إصدار رابط للملف');
    return data.signedUrl;
}

export async function sourceText(path) {
    const url = await signedUrl(path, 60);
    const response = await fetch(url);
    if (!response.ok) throw new Error('تعذّر قراءة الملف من المخزن');
    return response.text();
}

/* ===================== قراءة القيم للعرض ===================== */

// قيمة من jsonb: نص للعرض فقط، ويوضع دائماً في textContent.
export function valueText(value) {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return value.length ? value.map(valueText).join('، ') : '—';
    if (typeof value === 'object') return JSON.stringify(value);
    if (value === '') return '—';
    return String(value);
}

/* ===================== السجل الهدف ===================== */

const TARGET_TABLE = {
    client: { table: 'clients', key: 'id' },
    requirement: { table: 'client_requirements', key: 'id' },
    project: { table: 'projects', key: 'id' }
};

// الصف الهدف لمسودة تعديل، لبناء جدول "قبل/بعد". غيابه ليس خطأً في الواجهة:
// دالة الاعتماد هي التي تحكم، وهنا نعرض ما استطعنا قراءته فقط.
export async function targetRow(targetKind, targetId) {
    const spec = TARGET_TABLE[targetKind];
    if (!spec || targetId === null || targetId === undefined || targetId === '') return null;
    const id = targetKind === 'project' ? Number(targetId) : targetId;
    if (targetKind === 'project' && !Number.isInteger(id)) return null;
    const { data, error } = await supabase.from(spec.table).select('*').eq(spec.key, id).maybeSingle();
    if (error) return null;
    return data || null;
}

// رابط السجل بعد تطبيقه. المشاريع ليس لها صفحة مستقلة في الـCRM، فتُفتح اللوحة.
export async function recordLink(kind, id) {
    if (kind === 'client') return { href: '#/clients/' + id, text: 'فتح ملف العميل' };
    if (kind === 'project') return { href: '../index.html', text: 'فتح لوحة المشاريع (رقم ' + id + ')' };
    if (kind === 'requirement') {
        const { data } = await supabase.from('client_requirements').select('client_id').eq('id', id).maybeSingle();
        if (data && data.client_id) return { href: '#/clients/' + data.client_id, text: 'فتح ملف العميل' };
    }
    return null;
}
