// ‎#/deals‎ — الصفقات قائمةً حسب المرحلة (الخطوة الثانية، 2026-11). حلّت محل أعمدة اللوحة وشريط المراحل والقسم المطوي:
// خمسة أعمدة ضيقة لا تُقرأ على الجوال، ولا تقول أيّ صفقة واقفة، ولا تنقل صفقتين معاً.
//
// تبويب لكل مرحلة بعددها («الكل» = الجارية كلها، ثم المراحل الخمس، ثم «تمت» و«خسرت»)، وبحث باسم العميل أو جواله أو
// اسم المشروع، والوسيط للمدير، والترتيب أوله «الأقدم تحديثاً» (الصفقة المتروكة أولاً؛ لماذا لا «الأقدم في المرحلة»: في
// deals-list-model.js). الجدول مرقّم من الخادم (‎.range()‎ بحجم PAGE_SIZE) ويُعرض بترتيبه، وأيام كل صفقة في مرحلتها من
// استعلام واحد على deal_stage_history لصفوف الصفحة وحدها (بالأحمر حين تقف)، و«تجاوز موعد الإغلاق» تحت اسم الجارية التي
// فات موعدها المتوقع — «عملي اليوم» يعدّها ويحيل إلى هنا.
// الحساب نفسه (التبويبات، الترتيب، ما يُحدَّد وإلى أين يُنقل، والنصوص) في deals-list-model.js ويُختبر وحده.
//
// التحديد ينقل عدة صفقات معاً إلى المرحلة التالية، أو يسجّلها «خسرت» بسبب واحد. كل صفقة تعديل مستقل يُعدّ نجاحه
// وتعذّره، بشرط أن تكون ما زالت في المرحلة التي رآها الموظف (‎.eq('stage_id', …)‎): إن نقلها زميل قبله لا تقفز خطوتين.
// «تمت» لا يُنقل إليها جماعياً: السعر النهائي لكل صفقة أساس عمولتها، فتُتمّ من صفحتها (deal.js). وصفقة «تمت» يحددها
// المدير وحده (034 يرفض تغيير مرحلتها من غيره)، و«خسرت» لا شيء يُفعل بها هنا.
//
// العمولة لمن يراها فقط (037: canSeeCommission)، ومن لا يراها لا يُرسم له عمودها أصلاً. لا ترشيح بالمستخدم هنا: سياسة
// deals_select تُري المدير كل الصفقات والوسيط صفقاته. مركز الاتصال لا يصل إلى هذا المسار (الموجّه يمنعه والقاعدة ترفضه).

import { supabase, PAGE_SIZE, pageRange, pageBack } from './supabase.js';
import { staffMap, staffName, dealStages, lostReasons, brokerStaff, sanitizeSearch, phoneNeedle } from './data.js';
import { isAdmin, canSeeCommission } from './auth.js';
import { daysText, STUCK_DAYS } from './deal-path.js';
import {
    TAB_ALL, listTabs, findTab, tabCounts, DEFAULT_SORT, SORTS, sortOrder, searchOr,
    canSelect, tabSelectable, MOVE_BLOCKED, moveTarget, lostTarget, tallyResults,
    dealsCount, selectionText, bulkMessage, lostIntro, emptyText, placeText, stageFacts, lateClose, rateFor, commissionFacts
} from './deals-list-model.js';
import {
    el, replace, loading, empty, errorBox, pager, select, field, openModal, closeModal, notify, fail, errorText,
    money, number, fmtDate, localDayStart, pageHead, actionBtn, resultLine, icon, EM_DASH
} from './ui.js';
import { dealTabs } from './commissions.js';

const DEAL_FIELDS = 'id, client_id, project_id, unit_key, stage_id, amount, expected_close_date, broker_id, created_at, updated_at,'
    + ' closed_at, client:clients(full_name), project:projects(name)';

// أقصى عدد من العملاء أو المشاريع المطابقة للبحث: معرّفاتها تُكتب في عنوان كل طلب، فلا تطول بلا حد
const LOOKUP_CAP = 100;

// التبويب والبحث والوسيط والترتيب والصفحة تبقى ما دامت الجلسة: الرجوع من صفحة صفقة يعيد القائمة كما تُركت.
// التحديد لا يبقى: يُلغى مع كل تحميل، فلا يُنقل ما لم يعد ظاهراً.
const remembered = { tab: TAB_ALL, page: 0, search: '', broker: '', sort: DEFAULT_SORT };

export async function renderBoard(root) {
    replace(root, loading());
    const admin = isAdmin();

    const [stages, names, brokers] = await Promise.all([
        dealStages().catch((error) => ({ error: error })),
        staffMap().catch(() => new Map()),
        admin ? brokerStaff().catch(() => []) : []
    ]);
    if (!root.isConnected) return;
    if (stages && stages.error) return void replace(root, errorBox(stages.error, 'تعذّر تحميل مراحل الصفقات', () => renderBoard(root)));

    const view = remembered;
    const seeCommission = canSeeCommission();
    const tabs = listTabs(stages);
    view.tab = findTab(tabs, view.tab).key;
    if (!SORTS[view.sort]) view.sort = DEFAULT_SORT;
    if (!admin) view.broker = '';

    const selected = new Map();   // معرّف الصفقة ← صفها في الصفحة الحالية
    const rowNodes = new Map();   // معرّف الصفقة ← { tr, box }
    const lookups = new Map();    // نص البحث ← وعد معرّفات العملاء والمشاريع المطابقة
    let pageRows = [];
    let allBox = null;
    let busy = false;
    let seq = 0;
    let countSeq = 0;
    let countedKey = null;
    let focusAfter = false;
    let policy = null;

    /* ---------- تبويبات المراحل ---------- */

    const tabNodes = new Map();
    const tabBar = el('div', { class: 'dl-tabs', role: 'group', 'aria-label': 'مراحل الصفقات' });
    tabs.forEach((tab, i) => {
        // فاصل رفيع بعد «الكل» وقبل المغلقة: المسار الجاري بينهما
        if (i === 1 || (tab.kind !== 'open' && tabs[i - 1].kind === 'open')) {
            tabBar.appendChild(el('span', { class: 'dl-tab-sep', 'aria-hidden': 'true' }));
        }
        const count = el('span', { class: 'dl-tab-n', hidden: true });
        const button = el('button', {
            type: 'button', class: 'dl-tab',
            'aria-current': tab.key === view.tab ? 'true' : null,
            title: tab.key === TAB_ALL ? 'الصفقات الجارية كلها، بلا «تمت» و«خسرت»' : null,
            onclick: () => pickTab(tab.key)
        }, [el('span', { text: tab.label }), count]);
        tabNodes.set(tab.key, { button, count });
        tabBar.appendChild(button);
    });

    function pickTab(key) {
        if (key === view.tab) return;
        view.tab = key;
        view.page = 0;
        for (const [k, node] of tabNodes) {
            if (k === key) node.button.setAttribute('aria-current', 'true');
            else node.button.removeAttribute('aria-current');
        }
        revealTab();
        load();
    }

    function setTabCount(key, n) {
        const node = tabNodes.get(key);
        if (!node) return;
        const known = n !== null && n !== undefined;
        node.count.textContent = known ? number(n) : '';
        node.count.hidden = !known;
    }

    // على الجوال الشريط يُسحب أفقياً: يُمرَّر وحده (لا الصفحة) حتى يظهر التبويب الحالي
    function revealTab() {
        const node = tabNodes.get(view.tab);
        if (!node || tabBar.scrollWidth <= tabBar.clientWidth) return;
        const box = tabBar.getBoundingClientRect();
        const item = node.button.getBoundingClientRect();
        if (item.left < box.left) tabBar.scrollBy({ left: item.left - box.left - 16 });
        else if (item.right > box.right) tabBar.scrollBy({ left: item.right - box.right + 16 });
    }

    /* ---------- البحث والوسيط والترتيب ---------- */

    const searchBox = el('input', {
        type: 'search', class: 'crm-search', placeholder: 'ابحث باسم العميل أو جواله أو المشروع…', autocomplete: 'off',
        value: view.search, 'aria-label': 'بحث في الصفقات باسم العميل أو جواله أو اسم المشروع'
    });
    const brokerBox = admin
        ? select([{ value: '', label: 'كل الوسطاء' }].concat(brokerOptions(brokers)), view.broker, { 'aria-label': 'الوسيط' })
        : null;
    // وسيط محفوظ لم يعد في القائمة (أُوقف حسابه): يرجع «كل الوسطاء» بدل ترشيح خفي لا يظهر في الحقل
    if (brokerBox && brokerBox.value !== view.broker) {
        view.broker = '';
        brokerBox.value = '';
    }
    const sortBox = select(Object.keys(SORTS).map((key) => ({ value: key, label: SORTS[key] })), view.sort, { 'aria-label': 'ترتيب الصفقات' });

    // على الجوال: البحث ظاهر، والوسيط والترتيب خلف زر حتى تظهر الصفقات في أول الشاشة (نمط «العقارات»)
    const extra = el('div', { class: 'crm-toolbar-extra', id: 'dlFilters' }, [brokerBox, sortBox]);
    const extraBtn = el('button', {
        type: 'button', class: 'btn btn-outline btn-sm crm-filter-toggle', text: admin ? 'المرشّحات' : 'الترتيب',
        'aria-expanded': 'false', 'aria-controls': 'dlFilters',
        onclick: () => extraBtn.setAttribute('aria-expanded', extra.classList.toggle('open') ? 'true' : 'false')
    });

    let debounce = null;
    searchBox.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { view.search = searchBox.value; view.page = 0; load(); }, 300);
    });
    if (brokerBox) brokerBox.addEventListener('change', () => { view.broker = brokerBox.value; view.page = 0; load(); });
    sortBox.addEventListener('change', () => { view.sort = sortBox.value; view.page = 0; load(); });

    function reset() {
        clearTimeout(debounce);
        view.search = '';
        view.broker = '';
        view.page = 0;
        searchBox.value = '';
        if (brokerBox) brokerBox.value = '';
        load();
    }

    /* ---------- شريط التحديد ---------- */

    // إعلان واحد لقارئ الشاشة بعدد المحدد، خارج الشريط (الشريط يختفي ويظهر، وإعلان مخفي قد لا يُقرأ)
    const announcer = el('span', { class: 'dl-sr', role: 'status', 'aria-atomic': 'true' });
    const selCount = el('strong', { class: 'dl-sel-count' });
    const clearBtn = el('button', {
        type: 'button', class: 'link-btn dl-sel-clear', onclick: () => clearSelection()
    }, [icon('close'), el('span', { text: 'إلغاء التحديد' })]);
    const moveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm dl-sel-move', onclick: () => runMove() });
    const lostBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm dl-sel-lost', text: 'سجّلها «خسرت»', onclick: () => openLostForm() });
    const selWhy = el('p', { class: 'dl-sel-why', id: 'dlSelWhy', hidden: true });
    const selbar = el('div', { class: 'dl-selbar', role: 'region', 'aria-label': 'الصفقات المحددة', hidden: true }, [
        el('div', { class: 'dl-sel-head' }, [selCount, clearBtn]),
        el('div', { class: 'dl-sel-actions' }, [moveBtn, lostBtn]),
        selWhy
    ]);

    function syncSelection(announce) {
        const list = [...selected.values()];
        const n = list.length;
        selbar.hidden = n === 0;
        selCount.textContent = n ? selectionText(n) : '';
        if (announce) announcer.textContent = n ? selectionText(n) : 'أُلغي التحديد';

        let boxes = 0;
        for (const [id, node] of rowNodes) {
            const on = selected.has(id);
            node.tr.classList.toggle('dl-on', on);
            if (!node.box) continue;
            boxes += 1;
            node.box.checked = on;
            node.box.disabled = busy;
        }
        if (allBox) {
            allBox.checked = n > 0 && n === boxes;
            allBox.indeterminate = n > 0 && n < boxes;
            allBox.disabled = busy;
        }

        const target = moveTarget(list, stages);
        moveBtn.textContent = target.stage ? 'انقلها إلى: ' + target.stage.name_ar : 'انقلها إلى المرحلة التالية';
        moveBtn.disabled = busy || !target.ok;
        const why = n && !target.ok ? MOVE_BLOCKED[target.reason] || '' : '';
        selWhy.textContent = why;
        selWhy.hidden = !why;
        if (why) moveBtn.setAttribute('aria-describedby', selWhy.id);
        else moveBtn.removeAttribute('aria-describedby');
        lostBtn.disabled = busy || !lostTarget(list, stages).ok;
        clearBtn.disabled = busy;
    }

    function toggle(deal, on) {
        if (busy) return;
        if (on) selected.set(deal.id, deal);
        else selected.delete(deal.id);
        syncSelection(true);
    }

    function toggleAll(on) {
        if (busy) return;
        for (const deal of pageRows) {
            const node = rowNodes.get(deal.id);
            if (!node || !node.box) continue;
            if (on) selected.set(deal.id, deal);
            else selected.delete(deal.id);
        }
        syncSelection(true);
    }

    // الزر يختفي مع الشريط، فيعود التركيز إلى أول مربع اختيار ظاهر بدل أن يضيع إلى أول الصفحة
    function clearSelection() {
        if (busy) return;
        selected.clear();
        syncSelection(true);
        const first = [...body.querySelectorAll('.dl-check input')].find((box) => box.offsetParent !== null);
        if (first) first.focus();
    }

    /* ---------- النقل والخسارة الجماعيان ---------- */

    // صفقة بعد صفقة (لا تعديل واحد للكل): لكل واحدة نتيجتها، فيُقال كم نجح وكم تعذّر
    async function eachDeal(list, update, onStep) {
        const results = [];
        for (let i = 0; i < list.length; i++) {
            onStep(i + 1, list.length);
            results.push(await Promise.resolve(update(list[i])).catch((error) => ({ error })));
        }
        return tallyResults(results);
    }

    function startBusy() {
        busy = true;
        syncSelection(false);
    }

    function finishBulk(message) {
        // التركيز يُنقل بعد التحميل إن ضاع (كان على زر في الشريط أو في النموذج، واختفى)، لا إن انتقل الموظف أثناء
        // التعديل إلى غيره (أغلق النموذج وكتب في البحث مثلاً)
        const active = document.activeElement;
        const lostFocus = !active || active === document.body || active === document.documentElement || selbar.contains(active);
        busy = false;
        selected.clear();
        syncSelection(false);
        notify(message.text, message.kind, message.kind === 'error' ? 9000 : 4500);
        if (!root.isConnected) return;
        focusAfter = lostFocus;
        countedKey = null;   // تغيّرت أعداد التبويبات
        load();
    }

    async function runMove() {
        const list = [...selected.values()];
        const target = moveTarget(list, stages);
        if (busy || !target.ok) return;
        startBusy();
        const outcome = await eachDeal(list,
            (deal) => supabase.from('deals').update({ stage_id: target.stage.id })
                .eq('id', deal.id).eq('stage_id', deal.stage_id).select('id'),
            (i, n) => { moveBtn.textContent = 'جارٍ النقل… ' + i + ' من ' + n; });
        finishBulk(bulkMessage('move', outcome.ok, outcome.failed, target.stage.name_ar, outcome.error ? errorText(outcome.error) : null));
    }

    // «خسرت» بلا سبب يرفضها القيد (23514)، فالسبب يُطلب أولاً كما في صفحة الصفقة، وهو نفسه للمحددة كلها
    async function openLostForm() {
        const list = [...selected.values()];
        const target = lostTarget(list, stages);
        if (busy || !target.ok) return;
        let reasons;
        try {
            reasons = await lostReasons();
        } catch (error) {
            return void fail(error, 'تعذّر تحميل أسباب الخسارة');
        }
        if (!root.isConnected) return;

        const reason = select(
            [{ value: '', label: 'اختر السبب' }].concat(reasons.map((r) => ({ value: String(r.id), label: r.name_ar }))),
            '', { 'aria-required': 'true' }
        );
        const note = el('textarea', { rows: 3, maxLength: 500, placeholder: 'تفاصيل إضافية (اختياري)' });
        const progressLine = el('p', { class: 'dl-progress', role: 'status' });
        const cancelBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal });
        const saveBtn = el('button', { type: 'submit', class: 'btn btn-danger btn-sm', text: 'تأكيد الخسارة' });
        const one = list.length === 1;
        const form = el('form', { class: 'dl-lost-form' }, [
            el('p', { class: 'dl-lost-intro', text: lostIntro(list.length) }),
            // المدير يحدد «تمت» أيضاً: خروجها من الإتمام يمسّ عمولتها (031)، فيُقال ذلك قبل التأكيد
            target.hasWon ? el('p', { class: 'dl-warn' }, [
                icon('alert'),
                el('span', {
                    text: (one ? 'هذه صفقة «تمت»: تُلغى عمولتها' : 'هذه صفقات «تمت»: تُلغى عمولة كل منها')
                        + ' إن لم يُحصَّل منها شيء، وإلا تُعلَّم «تحتاج مراجعة».'
                })
            ]) : null,
            el('div', { class: 'form-grid' }, [
                field('سبب الخسارة', reason, { required: true, span2: true }),
                field('ملاحظة', note, { span2: true })
            ]),
            progressLine,
            el('div', { class: 'btn-row btn-row-end' }, [cancelBtn, saveBtn])
        ]);

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (busy) return;
            if (!reason.value) {
                notify('اختر سبب الخسارة', 'error');
                reason.focus();
                return;
            }
            const patch = { stage_id: target.stage.id, lost_reason_id: Number(reason.value), lost_note: note.value.trim() || null };
            for (const control of [reason, note, cancelBtn, saveBtn]) control.disabled = true;
            startBusy();
            const outcome = await eachDeal(list,
                (deal) => supabase.from('deals').update(patch).eq('id', deal.id).eq('stage_id', deal.stage_id).select('id'),
                (i, n) => { progressLine.textContent = 'جارٍ التسجيل… ' + i + ' من ' + n; });
            // × وEsc يغلقان النافذة أثناء التسجيل (الحقول وحدها معطلة)، ولعل نافذة أخرى فُتحت بعدها: تُغلق هذه إن بقيت
            // مفتوحة ولا يُمسّ غيرها، والنتيجة تصل بالإشعار في الحالين
            if (form.isConnected) closeModal();
            finishBulk(bulkMessage('lost', outcome.ok, outcome.failed, target.stage.name_ar, outcome.error ? errorText(outcome.error) : null));
        });

        openModal(one ? 'تسجيل الصفقة «خسرت»' : 'تسجيل الصفقات «خسرت»', form, { narrow: true });
    }

    /* ---------- التحميل ---------- */

    const body = el('div', { class: 'dl-body' });

    replace(root, [
        pageHead('الصفقات', 'من الاهتمام حتى الإغلاق. تُفتح الصفقة من ملف العميل أو من مطابقة، وتنتقل بين المراحل من صفحتها.', [
            actionBtn('العملاء', 'users', { href: '#/clients' })
        ]),
        dealTabs('#/deals'),
        el('section', { class: 'crm-card dl-card', 'aria-label': 'قائمة الصفقات' }, [
            tabBar,
            el('div', { class: 'crm-toolbar dl-toolbar' }, [searchBox, extraBtn, extra]),
            announcer,
            body
        ])
    ]);
    revealTab();

    // البحث: العملاء المطابقون باسمهم أو جوالهم، والمشاريع المطابقة باسمها — ممن لهم صفقة يراها الموظف (deals!inner)،
    // فلا تملأ الحدَّ أسماءٌ شائعة بلا صفقات. يُحفظ لكل نص، فتبديل التبويب أو الصفحة لا يعيد السؤال.
    function lookup(term) {
        if (!lookups.has(term)) {
            const needle = phoneNeedle(term);
            const clients = supabase.from('clients').select('id, deals!inner(id)')
                .or('full_name.ilike.%' + term + '%,phone.ilike.%' + (needle || term) + '%')
                .order('id', { ascending: true })
                .range(0, LOOKUP_CAP - 1);
            // رقم جوال لا يكون اسم مشروع: العملاء وحدهم
            const projects = needle ? null : supabase.from('projects').select('id, deals!inner(id)')
                .ilike('name', '%' + term + '%')
                .order('id', { ascending: true })
                .range(0, LOOKUP_CAP - 1);
            const run = (query) => (query ? Promise.resolve(query).catch((error) => ({ error })) : Promise.resolve({ data: [] }));
            lookups.set(term, Promise.all([run(clients), run(projects)]).then(([c, p]) => {
                const error = c.error || p.error || null;
                if (error) {
                    lookups.delete(term);
                    return { error };
                }
                const clientIds = (c.data || []).map((row) => row.id);
                const projectIds = (p.data || []).map((row) => row.id);
                return { clientIds, projectIds, capped: clientIds.length >= LOOKUP_CAP || projectIds.length >= LOOKUP_CAP };
            }));
        }
        return lookups.get(term);
    }

    // شرطا الوسيط والبحث كما تكتبهما القائمة والعدّ معاً، فيطابق عدد التبويب ما يظهر حين يُضغط
    function narrow(query, clause) {
        if (view.broker) query = query.eq('broker_id', view.broker);
        if (clause) query = query.or(clause);
        return query;
    }

    // عدّ بلا صفوف (head) لكل مرحلة، و«الكل» مجموع الجارية. يُعاد حين يتغير البحث أو الوسيط أو بعد نقل، لا مع كل تبويب
    function countTabs(key, clause, nothing) {
        const mine = ++countSeq;
        countedKey = key;
        for (const tab of tabs) setTabCount(tab.key, null);
        const stageTabs = tabs.filter((tab) => tab.key !== TAB_ALL);
        Promise.all(stageTabs.map((tab) => (nothing
            ? { count: 0 }
            : Promise.resolve(narrow(supabase.from('deals').select('id', { count: 'exact', head: true }).in('stage_id', tab.stageIds), clause))
                .catch((error) => ({ error }))
        ))).then((results) => {
            if (mine !== countSeq || !root.isConnected) return;
            if (results.some((result) => result.error)) countedKey = null;   // يُعاد في التحميل التالي
            const raw = new Map(stageTabs.map((tab, i) => [tab.key, results[i].error ? null : results[i].count]));
            for (const [key, n] of tabCounts(tabs, raw)) setTabCount(key, n);
        });
    }

    async function load() {
        const mine = ++seq;
        selected.clear();
        rowNodes.clear();
        pageRows = [];
        allBox = null;
        syncSelection(false);
        replace(body, loading());

        const tab = findTab(tabs, view.tab);
        const term = sanitizeSearch(view.search);
        const filtered = Boolean(term || view.broker);

        let found = null;
        if (term) {
            found = await lookup(term);
            if (mine !== seq || !body.isConnected) return;
            if (found.error) return void put(errorBox(found.error, 'تعذّر البحث في الصفقات', load));
        }
        const clause = found ? searchOr(found.clientIds, found.projectIds) : null;
        const nothing = Boolean(found) && clause === null;
        const key = term + '\n' + view.broker;
        if (key !== countedKey) countTabs(key, clause, nothing);
        if (nothing) return void showEmpty(tab, true);

        const [from, to] = pageRange(view.page);
        let query = narrow(supabase.from('deals').select(DEAL_FIELDS, { count: 'exact' }).in('stage_id', tab.stageIds), clause);
        for (const order of sortOrder(view.sort, tab)) {
            query = query.order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst });
        }
        const result = await Promise.resolve(query.range(from, to)).catch((error) => ({ error }));
        if (mine !== seq || !body.isConnected) return;
        const back = pageBack(view.page, result);
        if (back !== null) { view.page = back; return load(); }
        const { data, error, count } = result;
        if (error) return void put(errorBox(error, 'تعذّر تحميل الصفقات', load));
        if (!data || data.length === 0) return void showEmpty(tab, filtered);

        const extras = await pageExtras(data, tab);
        if (mine !== seq || !body.isConnected) return;
        const total = count === null || count === undefined ? data.length : count;
        render(tab, data, total, extras, filtered, Boolean(found && found.capped));
    }

    // ما يحتاجه صف الصفحة من غير جدول الصفقات، كله معاً: سجل المراحل (استعلام واحد لصفوف الصفحة)، ولمن يرى العمولة
    // نسبة المشاريع والنسبة العامة (للمتوقعة والفائتة) أو صفوف العمولة (لـ«تمت»). تعذّر أيٍّ منها يترك خانته شرطة.
    async function pageExtras(rows, tab) {
        const ids = rows.map((row) => row.id);
        const needRates = seeCommission && tab.kind !== 'won';
        const needCommissions = seeCommission && tab.kind === 'won';
        const projectIds = needRates
            ? [...new Set(rows.map((row) => row.project_id).filter((id) => id !== null && id !== undefined))]
            : [];
        const settle = (query) => Promise.resolve(query).catch((error) => ({ error }));
        const [history, rate, projectRates, commissions] = await Promise.all([
            settle(supabase.from('deal_stage_history').select('deal_id, to_stage, changed_at').in('deal_id', ids)),
            needRates ? defaultRate() : null,
            needRates && projectIds.length
                ? settle(supabase.from('project_commission').select('project_id, rate').in('project_id', projectIds))
                : null,
            needCommissions ? settle(supabase.from('commissions').select('deal_id, gross_amount, status').in('deal_id', ids)) : null
        ]);
        const okRows = (result) => (result && !result.error && result.data) || [];
        return {
            history: history.error ? null : history.data || [],
            defaultRate: rate,
            projectRates: new Map(okRows(projectRates).map((row) => [Number(row.project_id), row.rate])),
            commissions: new Map(okRows(commissions).map((row) => [row.deal_id, row]))
        };
    }

    // النسبة العامة تتغير نادراً: تُقرأ مرة لكل فتح للصفحة، وتعذّرها يُسأل عنه ثانية في التحميل التالي
    function defaultRate() {
        if (!policy) {
            policy = Promise.resolve(supabase.from('commission_policy').select('default_rate').maybeSingle())
                .then(({ data, error }) => {
                    if (error) { policy = null; return null; }
                    return data ? data.default_rate : null;
                })
                .catch(() => { policy = null; return null; });
        }
        return policy;
    }

    function showEmpty(tab, filtered) {
        const text = emptyText(tab, filtered);
        const action = text.action === 'reset'
            ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'مسح التصفية', onclick: reset })
            : text.action === 'clients' ? el('a', { class: 'btn btn-outline btn-sm', href: '#/clients', text: 'افتح العملاء' }) : null;
        put(empty(text.title, text.hint, action));
    }

    // رسالة مكان القائمة (خطأ أو حالة فارغة). بعد نقل جماعي يأخذ التركيز (الزر الذي كان عليه اختفى مع الشريط)
    function put(node) {
        replace(body, node);
        if (focusAfter) { focusAfter = false; focusQuiet(node); }
    }

    function render(tab, rows, total, extras, filtered, capped) {
        pageRows = rows;
        const pick = tabSelectable(tab, admin);
        const now = Date.now();
        const today = localDayStart(0).slice(0, 10);

        const line = resultLine(dealsCount(total), filtered ? reset : null);
        if (capped) line.appendChild(el('span', { class: 'dl-hint', text: 'نتائج كثيرة: تظهر أول المطابقات، فاكتب أكثر لتضييق البحث.' }));

        allBox = pick ? el('input', { type: 'checkbox', 'aria-label': 'تحديد كل صفقات هذه الصفحة', onchange: (e) => toggleAll(e.target.checked) }) : null;
        const th = (text, cls) => el('th', { scope: 'col', class: cls, text });
        const head = el('tr', {}, [
            pick ? el('th', { scope: 'col', class: 'dl-c-check' }, el('label', { class: 'dl-check' }, allBox)) : null,
            th('العميل', 'dl-c-client'),
            th('العقار · الوحدة', 'dl-c-place'),
            th('المسار', 'dl-c-path'),
            admin ? th('الوسيط', 'dl-c-broker') : null,
            seeCommission ? th('العمولة', 'dl-c-com') : null,
            th('في المرحلة', 'dl-c-days'),
            th('القيمة (ر.س)', 'dl-c-value')
        ]);

        const table = el('table', { class: 'users-table crm-table crm-table-keep dl-table' + (pick ? ' dl-pick' : '') }, [
            el('caption', { class: 'dl-sr', text: (tab.key === TAB_ALL ? 'الصفقات الجارية' : 'صفقات «' + tab.label + '»') + '، الترتيب: ' + SORTS[view.sort] }),
            el('thead', {}, head),
            el('tbody', {}, rows.map((deal) => rowNode(deal, pick, extras, now, today)))
        ]);

        replace(body, [
            line,
            el('div', { class: 'crm-table-wrap' }, table),
            selbar,
            pager(view.page, total, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
        syncSelection(false);
        if (focusAfter) { focusAfter = false; focusQuiet(line.querySelector('.result-count') || line); }
    }

    // الصف: على الكمبيوتر سطر جدول، وعلى الجوال بطاقة (step2-deals-list.css): الاسم (وتحته «تجاوز موعد الإغلاق» إن
    // فات)، ثم العقار، ثم المسار والأيام، ثم القيمة، ثم العمولة، ثم الوسيط
    function rowNode(deal, pick, extras, now, today) {
        const facts = stageFacts(deal, stages, extras.history, now);
        const name = deal.client && deal.client.full_name ? deal.client.full_name : 'عميل';
        const place = placeText(deal);
        const box = pick && canSelect(facts.stage, admin)
            ? el('input', { type: 'checkbox', 'aria-label': 'تحديد صفقة ' + name + ' — ' + place, onchange: (e) => toggle(deal, e.target.checked) })
            : null;
        const tr = el('tr', { class: 'dl-row' }, [
            pick ? el('td', { class: 'dl-c-check' }, box ? el('label', { class: 'dl-check' }, box) : null) : null,
            el('td', { class: 'dl-c-client' }, [
                el('a', { class: 'dl-name', href: '#/deals/' + deal.id, text: name }),
                lateNode(lateClose(deal, facts.stage, today))
            ]),
            el('td', { class: 'dl-c-place', text: place }),
            el('td', { class: 'dl-c-path' }, pathNode(facts)),
            admin ? el('td', { class: 'dl-c-broker', text: staffName(names, deal.broker_id) }) : null,
            seeCommission ? el('td', { class: 'dl-c-com' }, commissionNode(deal, facts.stage, extras)) : null,
            el('td', { class: 'dl-c-days' }, daysNode(facts)),
            el('td', { class: 'dl-c-value' }, valueNode(deal.amount))
        ]);
        rowNodes.set(deal.id, { tr, box });
        return tr;
    }

    await load();
}

/* ===================== خانات الصف ===================== */

// المسار: خطوة لكل مرحلة (الجارية + «تمت») تمتلئ حتى مرحلة الصفقة، واسم المرحلة بجانبها. «تمت» أخضر، و«خسرت» باهت.
function pathNode(facts) {
    const { path, stage } = facts;
    const segs = [];
    for (let i = 0; i < path.total; i++) segs.push(el('i', { class: 'dl-seg' + (i < path.step ? ' dl-seg-on' : '') }));
    return el('span', { class: 'dl-path' + (path.won ? ' dl-path-won' : path.lost ? ' dl-path-lost' : '') }, [
        el('span', { class: 'dl-segs', 'aria-hidden': 'true' }, segs),
        el('span', { class: 'dl-stage', text: stage ? stage.name_ar : 'مرحلة غير معروفة' }),
        path.step > 0 && !path.won ? el('span', { class: 'dl-sr', text: '، الخطوة ' + path.step + ' من ' + path.total }) : null
    ]);
}

// الأيام في المرحلة، وبالأحمر مع علامة (لا باللون وحده) حين تتجاوز الحد وهي جارية
function daysNode(facts) {
    if (facts.days === null) return el('span', { class: 'dl-muted', text: EM_DASH });
    if (!facts.stuck) return el('span', { class: 'dl-days', text: daysText(facts.days) });
    return el('span', { class: 'dl-days dl-stuck', title: 'أكثر من ' + STUCK_DAYS + ' يوماً في هذه المرحلة' }, [
        icon('alert'),
        el('span', { text: daysText(facts.days) }),
        el('span', { class: 'dl-sr', text: '، واقفة' })
    ]);
}

// فات موعد الإغلاق المتوقع والصفقة جارية: بالأحمر مع علامة الساعة ونص بالتاريخ (لا باللون وحده، ولا يُخلط بعلامة
// «واقفة»). مكانه تحت اسم العميل لا تحت الأيام: على الجوال خانة الأيام عمود ضيق بجانب المسار، وسطر طويل فيها يوسّعه
// حتى يتراكب المسار عليه على 320px، أما تحت الاسم فيأخذ عرض البطاقة كله، وعلى الكمبيوتر هو أول ما يُقرأ في الصف.
function lateNode(date) {
    if (!date) return null;
    return el('span', { class: 'dl-late' }, [
        icon('clock'),
        el('span', {}, ['تجاوز موعد الإغلاق: ', el('span', { class: 'dl-late-date', text: fmtDate(date) })])
    ]);
}

// «ر.س» تظهر على الجوال وحده: على الكمبيوتر هي في رأس العمود
function valueNode(amount) {
    const text = money(amount);
    if (text === EM_DASH) return el('span', { class: 'dl-muted', text });
    return el('span', { class: 'dl-value' }, [el('span', { class: 'dl-num', text }), el('span', { class: 'dl-cur', text: ' ر.س' })]);
}

function commissionNode(deal, stage, extras) {
    const rate = rateFor(deal.project_id, extras.projectRates, extras.defaultRate);
    const facts = commissionFacts(deal, stage, rate, extras.commissions.get(deal.id) || null);
    if (!facts || facts.amount === null) return el('span', { class: 'dl-muted', text: EM_DASH });
    return el('span', { class: 'dl-com dl-tone-' + facts.tone }, [
        el('span', { class: 'dl-num', text: money(facts.amount) }),
        el('span', { class: 'dl-com-tag', text: facts.label })
    ]);
}

function brokerOptions(list) {
    return (list || [])
        .map((person) => ({ value: person.id, label: person.fullname || person.username || 'وسيط' }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}

// بعد نقل جماعي يختفي الزر الذي كان عليه التركيز: يُنقل إلى سطر النتيجة أو الحالة الفارغة بلا إطار للفأرة
function focusQuiet(node) {
    if (!node || !node.isConnected) return;
    node.setAttribute('tabindex', '-1');
    node.focus();
}
