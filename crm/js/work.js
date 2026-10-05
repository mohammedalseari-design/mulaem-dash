// ‎#/work‎ — "عملي اليوم".
//
// لا يوجد أي ترشيح بالمستخدم هنا: v_my_work معرّف security_invoker وسياسات
// follow_ups تتكفّل بالباقي، فالمدير يرى الجميع والوسيط يرى نفسه تلقائياً.
//
// حدود اليوم: v_my_work صارت تحسب "اليوم" و"المتأخر" بتوقيت Asia/Riyadh
// (006_inventory_quality.sql)، فالقائمتان ترسلان بداية اليوم المحلي وبداية الغد
// نصّاً ISO بإزاحة المتصفح، كي يطابق عدّاد البطاقة طول القائمة تماماً.
//
// التصميم (2026-10، crm/app.css): العنوان والإجراءات السريعة في سطر، ثم أرقام اليوم في صف، ثم لوحتان
// جنباً إلى جنب — «متابعات متأخرة» و«مواعيد اليوم» — صفوفاً مضغوطة بأزرار اتصال وواتساب و«تم»، فيظهر
// المهم بلا تمرير. على الجوال مفتاح يعرض إحدى اللوحتين كاملة. الاستعلامات والترقيم ونموذج «تم» كما كانت.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CHANNEL, label } from './labels.js';
import { myRole } from './auth.js';
import {
    el, replace, clear, loading, errorBox, pager, fmtDateTime,
    localDayStart, number, waNumber, icon
} from './ui.js';
import { openDoneForm } from './followup-form.js';
import { openClientForm } from './client-form.js';

// تُستعمل أيضاً في لوحة الإدارة (#/dashboard) فوق بطاقات القمع الشهري
export const WORK_CARDS = [
    { key: 'follow_ups_today', label: 'متابعات اليوم' },
    { key: 'follow_ups_overdue', label: 'متابعات متأخرة' },
    { key: 'new_requirements_7d', label: 'طلبات جديدة (7 أيام)' },
    { key: 'viewings_today', label: 'معاينات اليوم' },
    { key: 'active_clients', label: 'عملاء نشطون' }
];

// ترتيب الأرقام في هذه الصفحة وتسمياتها: ما يحتاج عملاً أولاً
const KPIS = [
    { key: 'follow_ups_overdue', label: 'متابعات متأخرة' },
    { key: 'follow_ups_today', label: 'مواعيد اليوم' },
    { key: 'viewings_today', label: 'معاينات اليوم' },
    { key: 'new_requirements_7d', label: 'طلبات آخر 7 أيام' },
    { key: 'active_clients', label: 'عملاء نشطون' }
];

const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const FMT_TODAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const FMT_TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });

export async function renderWork(root) {
    const sub = el('p', { class: 'w4-sub', text: FMT_TODAY.format(new Date()) });
    const kpis = el('div', { class: 'w4-kpis' }, loading());
    const lateBody = el('div', { class: 'w4-panel-body' });
    const todayBody = el('div', { class: 'w4-panel-body' });
    const lateCount = el('span', { class: 'w4-count w4-count-late', hidden: true });
    const todayCount = el('span', { class: 'w4-count', hidden: true });
    const segLateCount = el('span', { class: 'w4-count w4-count-late', hidden: true });
    const segTodayCount = el('span', { class: 'w4-count', hidden: true });

    const latePanel = el('section', { class: 'w4-panel w4-panel-late', 'aria-labelledby': 'w4-late-title' }, [
        el('header', { class: 'w4-panel-head' }, [
            el('h2', { id: 'w4-late-title' }, [icon('alert'), el('span', { text: 'متابعات متأخرة' })]),
            lateCount,
            el('span', { class: 'w4-panel-hint', text: 'الأقدم أولاً' })
        ]),
        lateBody
    ]);
    const todayPanel = el('section', { class: 'w4-panel w4-panel-today', 'aria-labelledby': 'w4-today-title' }, [
        el('header', { class: 'w4-panel-head' }, [
            el('h2', { id: 'w4-today-title' }, [icon('today'), el('span', { text: 'مواعيد اليوم' })]),
            todayCount,
            el('span', { class: 'w4-panel-hint', text: 'حسب الوقت' })
        ]),
        todayBody
    ]);
    const board = el('div', { class: 'w4-board', dataset: { show: 'late' } }, [latePanel, todayPanel]);

    // الجوال: مفتاح يعرض لوحة واحدة كاملة. على الكمبيوتر اللوحتان ظاهرتان والمفتاح مخفي.
    const segLate = el('button', { type: 'button', dataset: { show: 'late' }, 'aria-pressed': 'true', onclick: () => show('late') },
        [el('span', { text: 'المتأخرة' }), segLateCount]);
    const segToday = el('button', { type: 'button', dataset: { show: 'today' }, 'aria-pressed': 'false', onclick: () => show('today') },
        [el('span', { text: 'مواعيد اليوم' }), segTodayCount]);
    function show(which) {
        board.dataset.show = which;
        segLate.setAttribute('aria-pressed', which === 'late' ? 'true' : 'false');
        segToday.setAttribute('aria-pressed', which === 'today' ? 'true' : 'false');
    }
    let userPicked = false;
    segLate.addEventListener('click', () => { userPicked = true; });
    segToday.addEventListener('click', () => { userPicked = true; });

    replace(root, el('div', { class: 'w4' }, [
        el('header', { class: 'w4-head' }, [
            el('div', { class: 'w4-title' }, [el('h1', { text: 'عملي اليوم' }), sub]),
            el('div', { class: 'w4-quick', 'aria-label': 'إجراءات سريعة' }, quickActions(() => reloadAll()))
        ]),
        kpis,
        el('div', { class: 'w4-seg', role: 'group', 'aria-label': 'اختر القائمة' }, [segLate, segToday]),
        board
    ]));

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        replace(lateBody, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
        return;
    }
    if (!root.isConnected) return;

    const lateList = list(lateBody, 'overdue', (rows, page, total) => {
        showCount([lateCount, segLateCount], total);
        if (!rows.length) return empty('check', 'لا متابعات متأخرة', 'كل ما فات موعده أُنجز.');
        return el('ol', { class: 'w4-list' }, rows.map((row) => lateRow(row, names, reloadAll)));
    });
    const todayList = list(todayBody, 'today', (rows, page, total) => {
        showCount([todayCount, segTodayCount], total);
        if (!rows.length) return empty('today', 'لا مواعيد اليوم', 'أضف متابعة من ملف العميل لتظهر هنا في وقتها.');
        return el('ol', { class: 'w4-list' }, rows.map((row) => todayRow(row, names, reloadAll)));
    });

    async function loadStats() {
        replace(kpis, loading());
        const { data, error } = await supabase.from('v_my_work').select('*').maybeSingle();
        if (!kpis.isConnected) return;
        if (error) return void replace(kpis, errorBox(error, 'تعذّر تحميل مؤشرات اليوم'));
        const value = (key) => Number(data && data[key]) || 0;
        const overdue = value('follow_ups_overdue');
        const today = value('follow_ups_today');

        // سطر تحت العنوان: التاريخ وخلاصة اليوم
        replace(sub, [
            FMT_TODAY.format(new Date()) + ' · ',
            overdue ? el('b', { class: 'w4-sub-late', text: arCount(overdue, 'متابعة متأخرة', 'متابعتان متأخرتان', 'متابعات متأخرة', 'متابعة متأخرة') }) : 'لا متأخرات',
            ' · ',
            el('b', { text: today ? arCount(today, 'موعد اليوم', 'موعدان اليوم', 'مواعيد اليوم', 'موعداً اليوم') : 'لا مواعيد اليوم' })
        ]);
        // على الجوال تفتح الصفحة على المتأخرة إن وُجدت، وإلا على مواعيد اليوم
        if (!userPicked) show(overdue ? 'late' : 'today');

        clear(kpis);
        const targets = { follow_ups_overdue: latePanel, follow_ups_today: todayPanel };
        for (const item of KPIS) {
            const n = value(item.key);
            const target = targets[item.key] || null;
            const late = item.key === 'follow_ups_overdue' && n > 0;
            const body = [el('span', { class: 'w4-kpi-label', text: item.label }), el('span', { class: 'w4-kpi-num', text: number(n) })];
            const cls = 'w4-kpi' + (late ? ' w4-kpi-late' : '');
            kpis.appendChild(target
                ? el('button', {
                    type: 'button', class: cls + ' w4-kpi-link',
                    onclick: () => {
                        show(item.key === 'follow_ups_overdue' ? 'late' : 'today');
                        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }, body)
                : el('div', { class: cls }, body));
        }
    }

    async function reloadAll() {
        await Promise.all([loadStats(), lateList.reload(), todayList.reload()]);
    }

    await reloadAll();
}

/* ===================== الإجراءات السريعة ===================== */

function quickActions(onSaved) {
    const callcenter = myRole() === 'callcenter';
    return [
        el('button', {
            type: 'button', class: 'btn btn-primary w4-qbtn',
            onclick: () => openClientForm(null, (saved) => {
                if (saved && saved.id) location.hash = '#/clients/' + saved.id;
                else onSaved();
            })
        }, [icon('userPlus'), el('span', { text: 'عميل جديد' })]),
        el('a', { class: 'btn btn-outline w4-qbtn', href: '#/clients' }, [icon('users'), el('span', { text: 'بحث عن عميل' })]),
        callcenter ? null : el('a', { class: 'btn btn-outline w4-qbtn', href: '#/assistant' }, [icon('sparkle'), el('span', { text: 'إضافة عرض' })]),
        el('a', { class: 'btn btn-outline w4-qbtn', href: '#/calendar' }, [icon('calendar'), el('span', { text: 'كل المواعيد' })])
    ];
}

/* ===================== القوائم ===================== */

// قائمة متابعات معلّقة ضمن نطاق زمني، بترقيم مستقل. draw يرسم الصفوف بعد كل تحميل.
function list(host, scope, draw) {
    const view = { page: 0 };

    async function reload() {
        replace(host, loading());
        const [from, to] = pageRange(view.page);

        let query = supabase
            .from('follow_ups')
            .select('id, due_at, channel, purpose, assigned_to, client_id, client:clients(full_name, phone)',
                { count: 'exact' })
            .eq('status', 'pending')
            .range(from, to);

        if (scope === 'today') {
            query = query
                .gte('due_at', localDayStart(0))
                .lt('due_at', localDayStart(1))
                .order('due_at', { ascending: true });
        } else {
            query = query
                .lt('due_at', localDayStart(0))
                .order('due_at', { ascending: true });
        }

        const { data, error, count } = await query;
        if (!host.isConnected) return;
        if (error) return void replace(host, errorBox(error, 'تعذّر تحميل المتابعات'));
        const rows = data || [];
        const total = count || rows.length;
        replace(host, [
            draw(rows, view.page, total),
            total > PAGE_SIZE ? pager(view.page, total, (p) => { view.page = p; reload(); }, PAGE_SIZE) : null
        ]);
    }

    return { reload: reload };
}

function lateRow(row, names, onChanged) {
    const client = row.client || {};
    return el('li', { class: 'w4-row w4-task' }, [
        el('div', { class: 'w4-main' }, [
            el('div', { class: 'w4-top' }, [
                clientLink(row),
                el('span', { class: 'w4-badge w4-badge-late', title: fmtDateTime(row.due_at), text: lateText(new Date(row.due_at)) })
            ]),
            row.purpose ? el('p', { class: 'w4-purpose', text: row.purpose }) : null,
            el('p', { class: 'w4-meta', text: label(CHANNEL, row.channel) + ' · ' + staffName(names, row.assigned_to) })
        ]),
        actions(row, client, onChanged)
    ]);
}

function todayRow(row, names, onChanged) {
    const client = row.client || {};
    const due = new Date(row.due_at);
    const passed = due.getTime() <= Date.now();
    return el('li', { class: 'w4-row w4-row-today w4-task' + (passed ? ' w4-row-due' : '') }, [
        el('div', { class: 'w4-time' }, [
            el('strong', { text: FMT_TIME.format(due) }),
            el('span', { text: soonText(due) })
        ]),
        el('div', { class: 'w4-main' }, [
            el('div', { class: 'w4-top' }, [clientLink(row)]),
            row.purpose ? el('p', { class: 'w4-purpose', text: row.purpose }) : null,
            el('p', { class: 'w4-meta', text: label(CHANNEL, row.channel) + ' · ' + staffName(names, row.assigned_to) })
        ]),
        actions(row, client, onChanged)
    ]);
}

function clientLink(row) {
    const client = row.client || {};
    return el('a', { class: 'w4-name', href: '#/clients/' + row.client_id, text: client.full_name || 'فتح ملف العميل' });
}

// اتصال وواتساب (إن وُجد رقم) و«تم» — بحجم الإصبع، ولكل زر اسم يُقرأ
function actions(row, client, onChanged) {
    const name = client.full_name || 'العميل';
    const phone = client.phone;
    return el('div', { class: 'w4-actions' }, [
        phone ? el('a', {
            class: 'w4-icon', href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), title: 'اتصال: ' + phone
        }, [icon('phone'), el('span', { class: 'w4-sr', text: 'اتصال بـ ' + name })]) : null,
        phone ? el('a', {
            class: 'w4-icon w4-icon-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener', title: 'واتساب: ' + phone
        }, [icon('chat'), el('span', { class: 'w4-sr', text: 'واتساب ' + name })]) : null,
        el('button', {
            type: 'button', class: 'btn w4-done', 'aria-label': 'تم: ' + name,
            onclick: () => openDoneForm(row, onChanged)
        }, [icon('check'), el('span', { text: 'تم' })])
    ]);
}

/* ===================== نصوص ===================== */

// العدد مع المعدود بالعربية: 1 مفرد، 2 مثنى، 3–10 جمع، 11+ مفرد منصوب
function arCount(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
}

function lateText(due) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const day = new Date(due); day.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((start - day) / 86400000));
    return 'منذ ' + arCount(days, 'يوم', 'يومين', 'أيام', 'يوماً');
}

function soonText(due) {
    const minutes = Math.round((due.getTime() - Date.now()) / 60000);
    if (minutes <= 0) return 'حان موعدها';
    if (minutes < 60) return 'بعد ' + arCount(minutes, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
    const hours = Math.round(minutes / 60);
    return 'بعد ' + arCount(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
}

function empty(ico, title, hint) {
    return el('div', { class: 'w4-empty' }, [
        el('span', { class: 'w4-empty-ico' }, icon(ico)),
        el('strong', { text: title }),
        el('span', { text: hint })
    ]);
}

function showCount(nodes, total) {
    for (const node of nodes) {
        node.textContent = number(total);
        node.hidden = !total;
    }
}
