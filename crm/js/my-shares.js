// ‎#/shares‎ — «مشاركاتي»: المشاريع التي شاركها الموظف مع عملائه، وكم شخصاً فتح كل رابط ومتى (my_project_shares، 038).
// من المعاينة المعتمدة (MyShares): رأس الصفحة وزر واحد «شارك مشروعاً»، وشريط بثلاثة أرقام، وحبّات الصيغة بأعدادها،
// وصف لكل مشروع: الاسم والحي، والصيغة، و«5 أشخاص فتحوه»، و«آخر فتح: …» ونقطة «مهتم الآن» إن فُتح خلال ساعتين، ثم
// «فتح ←» (صفحة المشروع) و«مشاركة مجدداً» (نافذة المشاركة).
//
// قسم في «العقارات» (تبويبا «الوحدات» و«مشاركاتي»)، فتُضاء «العقارات» في القائمة (app.js). لكل الأدوار، ومركز الاتصال
// يشارك أيضاً: هو أول من يكلّم العميل، والصفحة لا تعرض عمولة. المدير يرى مشاركات الموظفين كلهم باسم كل واحد.
// الأشخاص زوار مختلفون (من فتح الرابط مراراً يُحسب مرة)، و«هذا الأسبوع» آخر 7 أيام؛ الحساب كله في القاعدة.

import { supabase } from './supabase.js';
import { isAdmin, myId } from './auth.js';
import { sanitizeSearch } from './data.js';
import {
    el, replace, loading, empty, errorBox, errorText, pageHead, actionBtn, subTabs, filterChips, number, countText, openModal
} from './ui.js';
import { PROPERTY_TABS } from './properties.js';
import { openShareSheet, shIcon } from './share-project.js';
import {
    FORMAT_LABEL, FORMAT_ICON, placeText, opensText, lastOpenText, isInterestedNow, sortShares, formatCounts, stripNumbers,
    peopleUnit, monthSubText, weekSubText
} from './share-model.js';

// الصيغة المختارة ومن شارك (للمدير) تبقى ما دامت الصفحة مفتوحة
const remembered = { format: '', all: false };

const FORMAT_CHIPS = [
    { value: '', label: 'الكل' },
    { value: 'link', label: FORMAT_LABEL.link },
    { value: 'card', label: FORMAT_LABEL.card },
    { value: 'pdf', label: FORMAT_LABEL.pdf }
];

const settle = (query) => Promise.resolve(query).catch((error) => ({ data: null, error }));

function isMissingFunction(error) {
    return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(String(error.message || '')));
}

// خانة في الشريط بخطوطه الرفيعة (kpi-strip في v6.css): تُرسم فوراً وتمتلئ حين تصل الأرقام
function kpiCell(label) {
    const title = el('span', { class: 'kpi-label', text: label });
    const num = el('span', { class: 'kpi-num', text: '…' });
    const sub = el('span', { class: 'kpi-sub sh-kpi-sub' });
    const node = el('div', { class: 'kpi is-loading', 'aria-busy': 'true' }, [title, num, sub]);
    const done = () => { node.classList.remove('is-loading'); node.removeAttribute('aria-busy'); };
    return {
        node,
        loading() { node.classList.add('is-loading'); node.setAttribute('aria-busy', 'true'); num.textContent = '…'; sub.textContent = ''; },
        failed() { done(); num.textContent = '—'; sub.textContent = 'تعذّر الحساب'; },
        set(value, unit, subText, labelText) {
            done();
            if (labelText) title.textContent = labelText;
            replace(num, [value, unit ? el('small', { class: 'kpi-unit', text: unit }) : null]);
            sub.textContent = subText || '';
        }
    };
}

export async function renderMyShares(root) {
    const view = remembered;
    const admin = isAdmin();
    if (!admin) view.all = false;
    let rows = [];
    let seq = 0;

    const shareBtn = actionBtn('شارك مشروعاً', null, { onclick: () => openPicker(load) }, true);
    shareBtn.insertBefore(shIcon('share'), shareBtn.firstChild);

    const cells = [kpiCell('مشاركات هذا الشهر'), kpiCell('فتحوا روابطك'), kpiCell('هذا الأسبوع')];
    const strip = el('div', { class: 'kpi-strip kpi-strip-3 sh-strip', role: 'group', 'aria-label': 'أرقام المشاركة' }, cells.map((c) => c.node));
    const formatChips = filterChips('حسب الصيغة', FORMAT_CHIPS, view.format, (value) => { view.format = value; paintRows(); });
    const whoChips = admin
        ? filterChips('من شارك', [{ value: 'mine', label: 'مشاركاتي' }, { value: 'all', label: 'كل الموظفين' }], view.all ? 'all' : 'mine',
            (value) => { view.all = value === 'all'; load(); })
        : null;
    const rowsHost = el('div', { class: 'sh-rows-host' }, loading('جارٍ تحميل المشاركات'));

    replace(root, [
        pageHead('مشاركاتي', 'المشاريع التي شاركتها مع عملائك، وكم شخص فتح كل رابط.', [shareBtn]),
        subTabs('أقسام العقارات', PROPERTY_TABS, '#/shares'),
        strip,
        el('section', { class: 'crm-card sh-list', 'aria-label': 'قائمة المشاركات' }, [
            el('div', { class: 'sh-toolbar' }, [
                el('div', { class: 'f-row sh-chips' }, [formatChips.node, whoChips ? whoChips.node : null]),
                el('span', { class: 'sh-sort', text: 'مرتبة حسب آخر فتح' })
            ]),
            rowsHost,
            el('p', { class: 'sh-foot', text: 'البطاقة والبروفايل فيهم رابط لصفحة المشروع، فتعرف متى انفتحوا مثل الرابط بالضبط.' })
        ])
    ]);

    async function load() {
        if (!root.isConnected) return;
        const mine = ++seq;
        cells.forEach((cell) => cell.loading());
        replace(rowsHost, loading('جارٍ تحميل المشاركات'));
        const { data, error } = await settle(supabase.rpc('my_project_shares', { p_all: Boolean(admin && view.all) }));
        if (mine !== seq || !root.isConnected) return;
        if (error) {
            cells.forEach((cell) => cell.failed());
            replace(rowsHost, isMissingFunction(error)
                ? el('div', { class: 'crm-error', role: 'alert', text: '«مشاركاتي» لم تُفعَّل بعد في قاعدة البيانات (التحديث 038). راجع المدير.' })
                : errorBox(error, 'تعذّر تحميل المشاركات', load));
            return;
        }
        rows = sortShares(data || []);
        paintStrip();
        paintRows();
    }

    function paintStrip() {
        const now = new Date();
        const s = stripNumbers(rows, now);
        cells[0].set(number(s.monthShares), '', monthSubText(s, view.all));
        cells[1].set(number(s.people), peopleUnit(s.people), 'كل شخص ينحسب مرة وحدة في الرابط حتى لو فتحه أكثر من مرة',
            view.all ? 'فتحوا الروابط' : 'فتحوا روابطك');
        cells[2].set(number(s.weekPeople), peopleUnit(s.weekPeople), weekSubText(s, now, view.all));
    }

    function paintRows() {
        const counts = formatCounts(rows);
        for (const chip of FORMAT_CHIPS) formatChips.setCount(chip.value, counts[chip.value]);
        if (!rows.length) {
            return void replace(rowsHost, empty(
                view.all ? 'لم يشارك أحد مشروعاً بعد' : 'لم تشارك أي مشروع بعد',
                'اضغط «شارك مشروعاً» واختر المشروع، أو شاركه من صفحته. كل من يفتح رابطك يظهر هنا.'
            ));
        }
        const list = view.format ? rows.filter((row) => row.last_format === view.format) : rows;
        if (!list.length) {
            return void replace(rowsHost, empty('لا مشاركات بصيغة «' + FORMAT_LABEL[view.format] + '»', null,
                el('button', {
                    type: 'button', class: 'btn btn-outline btn-sm', text: 'عرض الكل',
                    onclick: () => { view.format = ''; formatChips.set(''); paintRows(); }
                })));
        }
        const now = new Date();
        replace(rowsHost, el('ul', { class: 'sh-rows', role: 'list' }, list.map((row) => shareRow(row, now))));
    }

    function shareRow(row, now) {
        const name = row.project_name || 'مشروع رقم ' + row.project_id;
        const own = row.broker_id === myId();
        const opened = Number(row.opens_total) > 0;
        const hot = opened && isInterestedNow(row.last_opened_at, now);
        const place = placeText(row.district, row.city, true);
        const format = FORMAT_LABEL[row.last_format] ? row.last_format : null;
        return el('li', { class: 'sh-row' }, [
            el('div', { class: 'sh-pj' }, [
                el('b', { text: name }),
                el('span', { text: [place, view.all && row.broker_name ? 'شاركه ' + row.broker_name : ''].filter(Boolean).join(' · ') || '—' })
            ]),
            el('div', { class: 'sh-meta' }, [
                format ? el('span', { class: 'sh-fmt' }, [shIcon(FORMAT_ICON[format]), el('span', { text: FORMAT_LABEL[format] })]) : el('span', { class: 'sh-fmt-none' }),
                el('span', { class: opened ? 'sh-op' : 'sh-op sh-op-none', text: opensText(row.opens_total) }),
                el('div', { class: 'sh-lt' + (opened ? '' : ' sh-lt-none') }, [
                    el('span', { text: lastOpenText(row, now) }),
                    hot ? el('span', { class: 'sh-now' }, [el('i', { 'aria-hidden': 'true' }), el('span', { text: 'مهتم الآن' })]) : null
                ])
            ]),
            el('div', { class: 'sh-row-acts' }, [
                el('a', { class: 'sh-tl', href: '#/project/' + row.project_id, 'aria-label': 'فتح: ' + name, text: 'فتح ←' }),
                own && row.project_live
                    ? el('button', {
                        type: 'button', class: 'sh-tl', 'aria-label': 'مشاركة مجدداً: ' + name, text: 'مشاركة مجدداً',
                        onclick: () => openShareSheet({ id: row.project_id, name, district: row.district, city: row.city }, { onClose: load })
                    })
                    : own ? el('span', { class: 'sh-row-gone', text: 'لم يعد معروضاً' }) : null
            ])
        ]);
    }

    await load();
}

/* ===================== «شارك مشروعاً»: اختيار المشروع ===================== */

// المشاريع المعتمدة غير المحذوفة وحدها (share_project ترفض غيرها): أحدثها أولاً، أو بالاسم والحي. الاختيار يفتح نافذة
// المشاركة مكان هذه النافذة
function openPicker(onDone) {
    const input = el('input', { type: 'search', id: 'shPickSearch', placeholder: 'ابحث باسم المشروع أو الحي…', autocomplete: 'off', class: 'sh-pick-search' });
    const status = el('p', { class: 'sh-pick-status', role: 'status' });
    const list = el('ul', { class: 'sh-pick-list', role: 'list' });
    let token = 0;
    let timer = null;
    openModal('شارك مشروعاً', [
        el('p', { class: 'sh-sub', text: 'اختر المشروع الذي تشاركه مع عميلك. تظهر هنا المشاريع المعتمدة وحدها.' }),
        el('div', { class: 'form-group sh-pick-field' }, [el('label', { for: 'shPickSearch', text: 'المشروع' }), input]),
        status,
        list
    ], { narrow: true });
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(search, 250);
    });
    search();

    async function search() {
        const mine = ++token;
        const term = sanitizeSearch(input.value);
        status.textContent = 'جارٍ البحث…';
        let query = supabase.from('projects').select('id, name, district, city').eq('status', 'approved').is('deleted_at', null);
        query = term
            ? query.or('name.ilike.%' + term + '%,district.ilike.%' + term + '%').order('name', { ascending: true })
            : query.order('updated_at', { ascending: false });
        const { data, error } = await settle(query.range(0, 7));
        if (mine !== token || !list.isConnected) return;
        if (error) {
            status.textContent = 'تعذّر البحث: ' + errorText(error);
            return void replace(list, null);
        }
        const found = data || [];
        status.textContent = !found.length
            ? (term ? 'لا مشروع معتمد بهذا الاسم أو الحي.' : 'لا مشاريع معتمدة بعد.')
            : term ? countText(found.length, ['مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً']) + ' لـ «' + term + '»' : 'أحدث المشاريع المعتمدة';
        replace(list, found.map((project) => el('li', {}, el('button', {
            type: 'button', class: 'sh-pick', onclick: () => openShareSheet(project, { onClose: onDone })
        }, [
            el('b', { text: project.name || 'مشروع رقم ' + project.id }),
            el('span', { text: placeText(project.district, project.city, true) || '—' })
        ]))));
    }
}
