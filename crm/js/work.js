// ‎#/work‎ — "عملي اليوم".
//
// لا يوجد أي ترشيح بالمستخدم هنا: v_my_work معرّف security_invoker وسياسات
// follow_ups تتكفّل بالباقي، فالمدير يرى الجميع والوسيط يرى نفسه تلقائياً.
//
// حدود اليوم: v_my_work صارت تحسب "اليوم" و"المتأخر" بتوقيت Asia/Riyadh
// (006_inventory_quality.sql)، فالقائمتان ترسلان بداية اليوم المحلي وبداية الغد
// نصّاً ISO بإزاحة المتصفح، كي يطابق عدّاد البطاقة طول القائمة تماماً.
//
// التصميم (2026-10، crm/v2.css): تحية وجملة تلخّص اليوم، ثم شريط أرقام، ثم المهام بطاقاتٍ —
// المتأخرة أولاً بالأحمر الهادئ، ثم متابعات اليوم بالساعة — وعلى كل بطاقة «اتصال» و«واتساب» و«تم».
// وفي عمود جانبي: الموعد القادم واختصارات. الاستعلامات والترقيم ونموذج «تم» كما كانت.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CHANNEL, label } from './labels.js';
import { state, displayName, myRole } from './auth.js';
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

// ترتيب شريط الأرقام في هذه الصفحة: ما يحتاج عملاً أولاً
const KPI_ORDER = ['follow_ups_overdue', 'follow_ups_today', 'viewings_today', 'new_requirements_7d', 'active_clients'];
const KPI_ICON = {
    follow_ups_overdue: 'alert', follow_ups_today: 'today', viewings_today: 'eye',
    new_requirements_7d: 'inbox', active_clients: 'users'
};
const CHANNEL_ICON = { call: 'phone', whatsapp: 'chat', visit: 'pin', other: 'dots' };
// تسمية أقصر في هذه الصفحة: القوسان كانا ينكسران في سطرين داخل البطاقة الصغيرة
const KPI_LABEL = { new_requirements_7d: 'طلبات آخر 7 أيام' };

const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const FMT_TODAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const FMT_TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });
const FMT_DAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export async function renderWork(root) {
    const firstName = String(displayName(state.profile) || '').trim().split(/\s+/)[0] || '';
    const summary = el('p', { class: 'wk-summary', text: 'نجمع مهامك…' });
    const kpis = el('div', { class: 'wk-kpis' });
    const overdueBody = el('div');
    const todayBody = el('div');
    const overdueCount = el('span', { class: 'wk-count wk-count-danger', hidden: true });
    const todayCount = el('span', { class: 'wk-count', hidden: true });
    const nextHost = el('div', { class: 'wk-panel wk-next' }, loading());

    const overdueSection = el('section', { class: 'wk-section wk-section-overdue', 'aria-labelledby': 'wk-overdue-title' }, [
        el('header', { class: 'wk-section-head' }, [
            el('h2', { id: 'wk-overdue-title' }, [icon('alert', 'ico wk-head-ico'), el('span', { text: 'متأخرة' })]),
            overdueCount,
            el('span', { class: 'wk-section-hint', text: 'الأقدم أولاً' })
        ]),
        overdueBody
    ]);
    const todaySection = el('section', { class: 'wk-section', 'aria-labelledby': 'wk-today-title' }, [
        el('header', { class: 'wk-section-head' }, [
            el('h2', { id: 'wk-today-title' }, [icon('today', 'ico wk-head-ico'), el('span', { text: 'متابعات اليوم' })]),
            todayCount,
            el('span', { class: 'wk-section-hint', text: 'بالساعة' })
        ]),
        todayBody
    ]);

    replace(root, el('div', { class: 'wk' }, [
        el('header', { class: 'wk-head' }, [
            el('div', { class: 'wk-hello' }, [
                el('p', { class: 'wk-date', text: FMT_TODAY.format(new Date()) }),
                el('h1', { text: greeting() + (firstName ? '، ' + firstName : '') }),
                summary
            ]),
            el('div', { class: 'wk-head-actions' }, [
                el('button', {
                    type: 'button', class: 'btn btn-primary wk-btn',
                    onclick: () => openClientForm(null, (saved) => {
                        if (saved && saved.id) location.hash = '#/clients/' + saved.id;
                        else reloadAll();
                    })
                }, [icon('userPlus'), el('span', { text: 'عميل جديد' })]),
                el('a', { class: 'btn btn-outline wk-btn', href: '#/calendar' }, [icon('calendar'), el('span', { text: 'كل المواعيد' })])
            ])
        ]),
        kpis,
        el('div', { class: 'wk-grid' }, [
            el('div', { class: 'wk-main' }, [overdueSection, todaySection]),
            el('aside', { class: 'wk-side', 'aria-label': 'الموعد القادم واختصارات' }, [nextHost, shortcuts()])
        ])
    ]));

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        replace(todayBody, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
        return;
    }
    if (!root.isConnected) return;

    const overdueList = list(overdueBody, names, 'overdue', reloadAll, (rows, page, total) => {
        showCount(overdueCount, total);
    });
    const todayList = list(todayBody, names, 'today', reloadAll, (rows, page, total) => {
        showCount(todayCount, total);
        if (page === 0) renderNext(nextHost, rows, names, reloadAll);
    });

    async function loadStats() {
        replace(kpis, loading());
        const { data, error } = await supabase.from('v_my_work').select('*').maybeSingle();
        if (!kpis.isConnected) return;
        if (error) {
            summary.textContent = '';
            return void replace(kpis, errorBox(error, 'تعذّر تحميل مؤشرات اليوم'));
        }
        const value = (key) => Number(data && data[key]) || 0;
        summary.textContent = summarize(value('follow_ups_overdue'), value('follow_ups_today'));

        clear(kpis);
        const targets = { follow_ups_overdue: overdueSection, follow_ups_today: todaySection };
        for (const key of KPI_ORDER) {
            const card = WORK_CARDS.find((c) => c.key === key);
            const n = value(key);
            const target = targets[key] || null;
            const tone = key === 'follow_ups_overdue' && n > 0 ? ' wk-kpi-danger' : '';
            const body = [
                el('span', { class: 'wk-kpi-ico' }, icon(KPI_ICON[key])),
                el('span', { class: 'wk-kpi-num', text: number(n) }),
                el('span', { class: 'wk-kpi-label', text: KPI_LABEL[key] || card.label })
            ];
            // بطاقتا «متأخرة» و«اليوم» تنقلان إلى قائمتيهما
            kpis.appendChild(target
                ? el('button', {
                    type: 'button', class: 'wk-kpi wk-kpi-link' + tone,
                    onclick: () => target.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, body)
                : el('div', { class: 'wk-kpi' + tone }, body));
        }
    }

    async function reloadAll() {
        await Promise.all([loadStats(), overdueList.reload(), todayList.reload()]);
    }

    await reloadAll();
}

/* ===================== القوائم ===================== */

// قائمة متابعات معلّقة ضمن نطاق زمني، بترقيم مستقل
function list(host, names, scope, onChanged, onRows) {
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
        if (onRows) onRows(rows, view.page, count || rows.length);
        if (rows.length === 0) {
            return void replace(host, scope === 'today'
                ? calm('today', 'لا متابعات مجدولة اليوم', 'أضف متابعة من ملف العميل لتظهر هنا في موعدها.')
                : calm('check', 'لا متابعات متأخرة', 'كل ما فات موعده أُنجز. أحسنت.'));
        }

        replace(host, [
            el('ol', { class: 'wk-tasks' }, rows.map((row) => taskCard(row, names, scope, onChanged))),
            (count || rows.length) > PAGE_SIZE
                ? pager(view.page, count || rows.length, (p) => { view.page = p; reload(); }, PAGE_SIZE)
                : null
        ]);
    }

    return { reload: reload };
}

// بطاقة مهمة: متى، ومن، ولماذا، ثم الأزرار. الموعد يميناً بخط كبير، والإجراءات في طرفها.
function taskCard(row, names, scope, onChanged) {
    const client = row.client || {};
    const due = new Date(row.due_at);
    const owner = staffName(names, row.assigned_to);
    const name = client.full_name || 'عميل';
    const late = scope === 'overdue';
    const when = late
        ? [el('span', { class: 'wk-when-main', text: lateText(due) }), el('span', { class: 'wk-when-sub', text: fmtDateTime(row.due_at) })]
        : [el('span', { class: 'wk-when-main', text: FMT_TIME.format(due) }), el('span', { class: 'wk-when-sub', text: soonText(due) })];

    return el('li', { class: 'wk-task' + (late ? ' wk-task-late' : (due.getTime() <= Date.now() ? ' wk-task-due' : '')) }, [
        el('div', { class: 'wk-when' }, when),
        el('div', { class: 'wk-task-body' }, [
            el('div', { class: 'wk-task-title' }, [
                el('a', { class: 'wk-client', href: '#/clients/' + row.client_id, text: client.full_name || 'فتح ملف العميل' }),
                el('span', { class: 'wk-channel wk-channel-' + (row.channel || 'other') }, [
                    icon(CHANNEL_ICON[row.channel] || 'dots'), el('span', { text: label(CHANNEL, row.channel) })
                ])
            ]),
            row.purpose ? el('p', { class: 'wk-purpose', text: row.purpose }) : null,
            el('div', { class: 'wk-meta' }, [
                el('span', { class: 'wk-owner' }, [
                    el('span', { class: 'wk-avatar', 'aria-hidden': 'true', text: initial(owner) }),
                    el('span', { text: owner })
                ]),
                client.phone ? el('span', { class: 'wk-phone', text: client.phone }) : null
            ])
        ]),
        el('div', { class: 'wk-actions' }, [
            ...contactButtons(client.phone, name),
            el('button', {
                type: 'button', class: 'btn wk-done', 'aria-label': 'تم: ' + name,
                onclick: () => openDoneForm(row, onChanged)
            }, [icon('check'), el('span', { text: 'تم' })])
        ])
    ]);
}

function contactButtons(phone, name) {
    if (!phone) return [];
    return [
        el('a', {
            class: 'wk-act', href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), 'aria-label': 'اتصال بـ ' + name
        }, [icon('phone'), el('span', { text: 'اتصال' })]),
        el('a', {
            class: 'wk-act wk-act-wa', href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener',
            'aria-label': 'واتساب ' + name
        }, [icon('chat'), el('span', { text: 'واتساب' })])
    ];
}

/* ===================== العمود الجانبي ===================== */

// الموعد القادم من أول صفحة في متابعات اليوم (مرتبة بالساعة): أول ما لم يحن بعد، وإلا أقدم ما حان
function renderNext(host, rows, names, onChanged) {
    if (!host.isConnected) return;
    const now = Date.now();
    const next = rows.find((row) => new Date(row.due_at).getTime() >= now) || rows[0];
    if (!next) {
        return void replace(host, [
            el('h2', { class: 'wk-panel-title', text: 'الموعد القادم' }),
            el('p', { class: 'wk-panel-empty', text: 'لا مواعيد متبقية اليوم.' })
        ]);
    }
    const client = next.client || {};
    const due = new Date(next.due_at);
    const passed = due.getTime() < now;
    replace(host, [
        el('h2', { class: 'wk-panel-title', text: passed ? 'متابعة حان موعدها' : 'الموعد القادم' }),
        el('div', { class: 'wk-next-time' }, [
            el('span', { class: 'wk-next-clock', text: FMT_TIME.format(due) }),
            el('span', { class: 'wk-next-in', text: passed ? 'لم تُنجز بعد' : soonText(due) })
        ]),
        el('a', { class: 'wk-next-client', href: '#/clients/' + next.client_id, text: client.full_name || 'فتح ملف العميل' }),
        next.purpose ? el('p', { class: 'wk-next-purpose', text: next.purpose }) : null,
        el('p', { class: 'wk-next-meta', text: label(CHANNEL, next.channel) + ' · ' + staffName(names, next.assigned_to) }),
        el('div', { class: 'wk-next-actions' }, [
            ...contactButtons(client.phone, client.full_name || 'العميل'),
            el('button', {
                type: 'button', class: 'btn wk-done', 'aria-label': 'تم: ' + (client.full_name || 'المتابعة'),
                onclick: () => openDoneForm(next, onChanged)
            }, [icon('check'), el('span', { text: 'تم' })])
        ])
    ]);
}

// اختصارات إلى الصفحات المتاحة لدور المستخدم (مركز الاتصال بلا مساعد ولا صفقات)
function shortcuts() {
    const callcenter = myRole() === 'callcenter';
    const items = [
        { href: '#/clients', label: 'العملاء', hint: 'بحث وملفات', ico: 'users' },
        { href: '#/properties', label: 'العقارات', hint: 'الوحدات المتاحة', ico: 'building' },
        callcenter ? null : { href: '#/assistant', label: 'المساعد الذكي', hint: 'أضف عرضاً من نص أو ملف', ico: 'sparkle' },
        callcenter ? null : { href: '#/deals', label: 'الصفقات', hint: 'مراحل البيع', ico: 'briefcase' }
    ].filter(Boolean);
    return el('nav', { class: 'wk-panel wk-shortcuts', 'aria-label': 'اختصارات' }, [
        el('h2', { class: 'wk-panel-title', text: 'اختصارات' }),
        el('ul', {}, items.map((item) => el('li', {}, el('a', { href: item.href }, [
            el('span', { class: 'wk-short-ico' }, icon(item.ico)),
            el('span', { class: 'wk-short-text' }, [el('strong', { text: item.label }), el('small', { text: item.hint })]),
            icon('arrow', 'ico wk-short-arrow')
        ]))))
    ]);
}

/* ===================== نصوص ===================== */

function greeting() {
    return new Date().getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
}

// العدد مع المعدود بالعربية: 1 مفرد، 2 مثنى، 3–10 جمع، 11+ مفرد منصوب
function arCount(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + few;
    return n + ' ' + many;
}

function summarize(overdue, today) {
    const late = arCount(overdue, 'متابعة متأخرة واحدة', 'متابعتان متأخرتان', 'متابعات متأخرة', 'متابعة متأخرة');
    const now = arCount(today, 'متابعة واحدة اليوم', 'متابعتان اليوم', 'متابعات اليوم', 'متابعة اليوم');
    if (overdue && today) return 'عندك ' + late + ' و' + now + '. ابدأ بالمتأخرة.';
    if (overdue) return 'عندك ' + late + '، ولا شيء مجدول لليوم. ابدأ بها.';
    if (today) return 'عندك ' + now + '، ولا متأخرات.';
    return 'لا متابعات اليوم ولا متأخرات.';
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
    if (hours < 24) return 'بعد ' + arCount(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
    return FMT_DAY.format(due);
}

function initial(name) {
    const text = String(name || '').trim();
    return text ? text[0] : '؟';
}

function calm(ico, title, hint) {
    return el('div', { class: 'wk-calm' }, [
        el('span', { class: 'wk-calm-ico' }, icon(ico)),
        el('strong', { text: title }),
        el('span', { text: hint })
    ]);
}

function showCount(node, total) {
    node.textContent = number(total);
    node.hidden = !total;
}
