// ‎#/inventory‎ — جودة المخزون: عروض تحتاج انتباه، وتكرار محتمل.
//
// قراءة فقط من عرضين معرّفين security_invoker (006_inventory_quality.sql)، فحتى لو
// فُتح المسار بالعنوان مباشرة لا يرى غير المدير إلا ما تسمح به سياسات projects.
// الصفحة للمدير وحده: بند القائمة مخفي لغيره والموجّه يرفض المسار.
//
// الصفوف لا تفتح شيئاً: اللوحة القديمة بلا روابط عميقة، فيُعرض رقم المشروع
// ليبحث عنه المدير هناك.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, money, fmtDate, dash
} from './ui.js';

// نصوص الملاحظات تأتي من العرض نفسه؛ ما لا نعرفه يُعرض رمادياً بلا تخمين
const ISSUE_TONE = {
    'منتهي': 'red',
    'بلا رقم ترخيص إعلان': 'red',
    'ينتهي خلال 30 يوماً': 'orange',
    'بلا حي': 'orange',
    'الحي مستنتج': 'gold',
    'بلا صور': 'neutral',
    'لم يُحدَّث منذ 90 يوماً': 'neutral'
};

const CONFIDENCE_TONE = {
    'عالية': 'red',
    'متوسطة': 'orange',
    'منخفضة': 'neutral'
};

export async function renderInventory(root) {
    const attentionBody = el('div');
    const duplicatesBody = el('div');

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'عروض تحتاج انتباه' })]),
            attentionBody
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'تكرار محتمل' })]),
            duplicatesBody
        ])
    ]);

    const attention = { page: 0, issue: '', rows: [], total: 0 };
    const duplicates = { page: 0 };

    async function loadAttention() {
        replace(attentionBody, loading());
        const [from, to] = pageRange(attention.page);

        const { data, error, count } = await supabase
            .from('v_inventory_attention')
            .select('id, name, type, district, price, employee, issues, listing_expires_at', { count: 'exact' })
            // الأقرب انتهاءً أولاً، ثم الرقم حتى يكون الترتيب قاطعاً فلا تتكرر صفوف بين الصفحات
            .order('listing_expires_at', { ascending: true, nullsFirst: false })
            .order('id', { ascending: true })
            .range(from, to);

        if (!attentionBody.isConnected) return;
        if (error) return void replace(attentionBody, errorBox(error, 'تعذّر تحميل عروض جودة المخزون'));

        attention.rows = data || [];
        attention.total = count === null || count === undefined ? attention.rows.length : count;
        attention.issue = '';
        paintAttention();
    }

    // المرشّح يعمل على الصفحة المعروضة وحدها، فلا يُعاد الاستعلام عند الضغط على شريحة
    function paintAttention() {
        if (attention.rows.length === 0) {
            return void replace(attentionBody, empty('لا توجد عروض تحتاج انتباهاً'));
        }

        const issues = [];
        for (const row of attention.rows) {
            for (const issue of row.issues || []) {
                if (!issues.includes(issue)) issues.push(issue);
            }
        }

        const shown = attention.issue
            ? attention.rows.filter((row) => (row.issues || []).includes(attention.issue))
            : attention.rows;

        replace(attentionBody, [
            chipFilter(issues, attention.issue, (value) => { attention.issue = value; paintAttention(); }),
            el('div', {
                class: 'crm-subtle', style: 'margin-bottom:12px',
                text: 'المرشّح يعمل على الصفحة المعروضة فقط — ' + shown.length + ' من ' + attention.rows.length
            }),
            shown.length === 0
                ? empty('لا صفوف بهذه الملاحظة في هذه الصفحة')
                : el('div', { class: 'crm-table-wrap' }, attentionTable(shown)),
            pager(attention.page, attention.total, (p) => { attention.page = p; loadAttention(); }, PAGE_SIZE)
        ]);
    }

    async function loadDuplicates() {
        replace(duplicatesBody, loading());
        const [from, to] = pageRange(duplicates.page);

        const { data, error, count } = await supabase
            .from('v_inventory_duplicates')
            .select('project_id, duplicate_of, name, duplicate_name, confidence, reason', { count: 'exact' })
            // ترتيب العربية التصاعدي يوافق ترتيب الثقة نزولاً: ع ثم مت ثم من
            // (عالية، متوسطة، منخفضة)، والرقمان بعده حتى يكون الترتيب قاطعاً.
            .order('confidence', { ascending: true })
            .order('project_id', { ascending: true })
            .order('duplicate_of', { ascending: true })
            .range(from, to);

        if (!duplicatesBody.isConnected) return;
        if (error) return void replace(duplicatesBody, errorBox(error, 'تعذّر تحميل التكرار المحتمل'));
        if (!data || data.length === 0) {
            return void replace(duplicatesBody, empty('لا يوجد تكرار محتمل'));
        }

        replace(duplicatesBody, [
            el('div', { class: 'crm-table-wrap' }, duplicatesTable(data)),
            pager(duplicates.page, count || data.length, (p) => { duplicates.page = p; loadDuplicates(); }, PAGE_SIZE)
        ]);
    }

    await Promise.all([loadAttention(), loadDuplicates()]);
}

/* ===================== شرائح المرشّح ===================== */

function chipFilter(values, active, onPick) {
    const row = el('div', { class: 'chips crm-chip-filter' });
    const add = (value, text) => {
        row.appendChild(el('button', {
            type: 'button',
            class: 'chip' + (active === value ? ' on' : ''),
            text: text,
            onclick: () => onPick(value)
        }));
    };

    add('', 'الكل');
    for (const value of values) add(value, value);
    return row;
}

/* ===================== الجداول ===================== */

function attentionTable(rows) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'رقم المشروع' }),
        el('th', { text: 'الاسم' }),
        el('th', { text: 'النوع' }),
        el('th', { text: 'الحي' }),
        el('th', { text: 'السعر' }),
        el('th', { text: 'الموظف' }),
        el('th', { text: 'الملاحظات' }),
        el('th', { text: 'انتهاء الإعلان' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const issues = el('div', { class: 'btn-row' });
        for (const issue of row.issues || []) {
            issues.appendChild(badge(issue, ISSUE_TONE[issue] || 'neutral'));
        }

        body.appendChild(el('tr', {}, [
            el('td', { class: 'num', text: String(row.id) }),
            el('td', {}, el('strong', { text: dash(row.name) })),
            el('td', { text: dash(row.type) }),
            el('td', { text: dash(row.district) }),
            el('td', { class: 'num', text: money(row.price) }),
            el('td', { text: dash(row.employee) }),
            el('td', {}, issues),
            el('td', { class: 'crm-subtle', text: fmtDate(row.listing_expires_at) })
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

function duplicatesTable(rows) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الثقة' }),
        el('th', { text: 'العقار' }),
        el('th', { text: 'المكرَّر معه' }),
        el('th', { text: 'السبب' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        body.appendChild(el('tr', {}, [
            el('td', {}, badge(dash(row.confidence), CONFIDENCE_TONE[row.confidence] || 'neutral')),
            el('td', {}, projectCell(row.name, row.project_id)),
            el('td', {}, projectCell(row.duplicate_name, row.duplicate_of)),
            el('td', { class: 'crm-subtle', text: dash(row.reason) })
        ]));
    }

    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

// اسم المشروع ورقمه: الرقم هو ما يبحث به المدير في اللوحة القديمة
function projectCell(name, id) {
    return el('div', {}, [
        el('strong', { text: dash(name) }),
        el('div', { class: 'crm-subtle', text: 'رقم ' + dash(id) })
    ]);
}
