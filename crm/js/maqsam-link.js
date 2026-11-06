// تبويب «مقسم» في «ربط الأنظمة» (links.js، للمدير وحده). الرأس ورابط الرجوع في الصفحة الواحدة، وهنا ما تحتهما.
//
// يلصق المدير «رقم مفتاح التعريف» و«كلمة السر» من صفحة «مفاتيح واجهة برمجة التطبيقات» في مقسم (الرابط الأساسي معبّأ)، فتختبرها وظيفة maqsam-link وتحفظها مشفّرة إن نجح الاختبار،
// ثم يعرض التبويب حالة الربط وأرقام آخر 7 أيام: هل تظهر مكالمات الموظفين في مقسم أصلاً، وهل لها نصوص.
//
// قواعد هذا التبويب:
// - المتصفح لا يكلّم مقسم أبداً، وكل شيء عبر الوظيفة. القيم الحساسة تُرسل مرة وتبقى في حقولها فقط، فلا تُخزَّن ولا تُسجَّل،
//   وبعد نجاح الحفظ تختفي الحقول. بعد فشله تبقى عقد الحقول نفسها ليصحح المدير ما كتب.
// - كل ما يُرسم يأتي من آخر ربط ردّه الخادم، ونصوص الخادم تدخل نصاً (textContent) لا HTML.
// - زر رئيسي واحد في التبويب، والحالة بكلمة لا بلون وحده، والنتائج تُعلن في منطقة aria-live.

import { supabase } from './supabase.js';
import {
    el, replace, loading, errorBox, field, input, badge, icon, notify, openModal, closeModal,
    number, countText, fmtDateTime, EM_DASH
} from './ui.js';
import {
    LINK_INTRO, DEFAULT_HOST, REQUEST_TEXT, TEXTS_REQUEST, FAULT_REQUEST, SUPPORT_EMAIL, STALE_TEXT, UNREACHABLE_TEXT, UNREACHABLE_HINT,
    checkCopy, saveFailureCopy, savedFailureCopy, readReply, statusView, settingsLine, statsRows, agentsView, advice, asksMaqsam, mailHref
} from './maqsam-link-model.js';

const SAVE_TEXT = 'اختبار وحفظ';
const SAVE_BUSY = 'جارٍ الاختبار…';
const TEST_TEXT = 'فحص الربط الآن';
const TEST_BUSY = 'جارٍ الفحص…';
const EMPTY_TEXT = 'أكمل الحقول الفارغة.';
const COPIED_TEXT = 'تم نسخ نص الطلب.';
const SAVED_TEXT = 'تم الربط مع مقسم.';
const REMOVED_TEXT = 'تم فصل الربط مع مقسم.';
const KEEP_NOTE = 'القيم الحالية تبقى كما هي حتى تنجح القيم الجديدة في الاختبار.';
const FOOTNOTE = 'هذا فحص فقط: لا نحفظ كلام العملاء ولا أرقامهم، ولا يكتب الربط شيئاً في Zoho حالياً.';

// نداء الوظيفة. الخطأ العربي في جسم الرد حتى مع رمز غير 2xx (كما في users.js)، وكل ما عداه يصير «لم يُوصل إلى الخدمة»
async function callLink(payload) {
    try {
        const { data, error } = await supabase.functions.invoke('maqsam-link', { body: payload });
        if (!error) return readReply(data);
        const ctx = error.context;
        return readReply(ctx && typeof ctx.json === 'function' ? await ctx.json() : null);
    } catch (_) {
        return readReply(null);
    }
}

// الربط كما ردّه الخادم لمن يسأل من خارج التبويب: null إن لم تُقرأ الحالة، ومن يسأل يسكت عندها
export async function linkStatus() {
    const reply = await callLink({ action: 'status' });
    return reply.kind === 'ok' ? reply.link : null;
}

// سطر الحالة لبطاقة الإعدادات
export async function linkStatusLine() {
    const link = await linkStatus();
    return link ? settingsLine(link) : null;
}

/* ===================== عناصر التبويب: يستعملها تبويب Zoho أيضاً ===================== */

// el() تتخطى القيمة false، وخاصية spellcheck منطقية فلا تصح بالنص «false»: تُكتب صفة صريحة.
// اللصق يستبدل القيمة كلها: هذه قيم تُنسخ كاملة، وبعد رفضها تبقى في الحقل (نقاطاً في كلمة السر)، فلصق جديد فوقها كان يُضاف إليها دون أن يُرى.
export function credentialInput(attrs) {
    const node = input(Object.assign({ dir: 'ltr', autocapitalize: 'off', autocomplete: 'off' }, attrs));
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('autocorrect', 'off');
    node.addEventListener('paste', (event) => {
        const text = event.clipboardData && event.clipboardData.getData('text');
        if (!text) return;
        event.preventDefault();
        node.value = text.trim();
    });
    return node;
}

export function cardHead(id, title, side) {
    return el('div', { class: 'crm-card-head' }, [el('h2', { id, tabindex: '-1', text: title }), side]);
}

// ما حدث وما يُفعل، بلون الخطأ ونصه
export function failBox(copy, retry) {
    return el('div', { class: 'crm-error mq-fail' }, [
        el('strong', { text: copy.title }),
        copy.action ? el('span', { class: 'mq-fail-do', text: copy.action }) : null,
        retry ? el('button', { type: 'button', class: 'btn btn-outline btn-xs crm-retry', onclick: () => retry() }, [icon('refresh'), el('span', { text: 'إعادة المحاولة' })]) : null
    ]);
}

// الوظيفة لم يُوصل إليها (لم تُنشر بعد، أو انقطع الاتصال). errorBox يترجم انقطاع الإنترنت، ودوره alert فيُعلن نفسه
export function unreachableBox(retry) {
    return errorBox(new Error(UNREACHABLE_HINT), UNREACHABLE_TEXT, () => retry());
}

function dateValue(row) {
    return [row.value, row.at ? fmtDateTime(row.at) : ''].filter(Boolean).join(' · ') || EM_DASH;
}

// القيم اللاتينية داخل span باتجاهها حتى تبقى الخانة نفسها عربية الاتجاه، فتلاصق القيمة اسمها
function factValue(row) {
    if (row.ltr) return el('span', { dir: 'ltr', text: row.value || EM_DASH });
    if (row.at !== undefined) return dateValue(row);
    return [number(row.value), row.note ? badge(row.note, 'neutral') : null];
}

function factRow(row) {
    return el('div', {}, [
        el('dt', { text: row.label }),
        el('dd', { dataset: { key: row.key } }, factValue(row))
    ]);
}

export function factRows(rows) {
    return el('dl', { class: 'mq-rows' }, rows.map(factRow));
}

function resultCard(view, onCopy) {
    const stats = view.stats;
    const lines = (view.stale ? [STALE_TEXT] : []).concat(advice(stats));
    const { agents, noAgent } = agentsView(stats);
    const callsText = (n) => countText(n, ['مكالمة واحدة', 'مكالمتان', 'مكالمات', 'مكالمة']);
    const hasPeople = agents.length > 0 || noAgent > 0;
    return el('section', { class: 'crm-card mq-result-card', 'aria-labelledby': 'mqResultTitle' }, [
        cardHead('mqResultTitle', 'ما وجدناه في الأيام السبعة قبل آخر فحص', el('span', { class: 'crm-subtle', text: fmtDateTime(view.checkedAt) })),
        lines.length ? el('ul', { class: 'crm-warn-box mq-advice', role: 'list' }, lines.map((line) => el('li', { text: line }))) : null,
        asksMaqsam(stats) ? supportLine(TEXTS_REQUEST, onCopy) : null,
        factRows(statsRows(stats)),
        hasPeople ? el('h3', { class: 'mq-sub', text: 'الموظفون في مقسم' }) : null,
        hasPeople ? el('ul', { class: 'mq-agents', role: 'list' }, [
            ...agents.map((agent) => el('li', {}, [
                el('span', { class: 'mq-agent-mail', dir: 'ltr', text: agent.email }),
                el('span', { class: 'mq-agent-count', text: callsText(agent.calls) })
            ])),
            noAgent ? el('li', {}, [
                el('span', { class: 'mq-agent-none', text: 'بلا موظف' }),
                el('span', { class: 'mq-agent-count', text: callsText(noAgent) })
            ]) : null
        ]) : null
    ]);
}

function stepsCard(view, onCopy) {
    return el('section', { class: 'crm-card', 'aria-labelledby': 'mqStepsTitle' }, [
        cardHead('mqStepsTitle', 'خطوات الربط', badge(view.badge.text, view.badge.tone)),
        el('ol', { class: 'mq-steps', role: 'list' }, [
            el('li', { text: 'افتح مقسم، ثم «التكاملات وواجهة برمجة التطبيقات»، ثم «مفاتيح واجهة برمجة التطبيقات».' }),
            el('li', { text: 'انسخ «رقم مفتاح التعريف» و«كلمة السر» من هناك.' }),
            el('li', { text: 'الصقهما هنا واضغط «اختبار وحفظ».' })
        ]),
        el('p', { class: 'mq-line mq-after mq-ask' }, [
            el('span', { text: 'إذا لم تظهر «مفاتيح واجهة برمجة التطبيقات» في مقسم، ادخل بحساب مالك الحساب في مقسم. وإن لم تظهر راسل' }),
            ...contact(REQUEST_TEXT, onCopy)
        ])
    ]);
}

// عنوان دعم مقسم معبّأ بالطلب المناسب، وزر ينسخه لمن لا يفتح البريد من المتصفح
function contact(text, onCopy) {
    return [
        el('a', { class: 'mq-mail', dir: 'ltr', href: mailHref(text), text: SUPPORT_EMAIL }),
        el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'نسخ نص الطلب', onclick: () => onCopy(text) })
    ];
}

// تحت ما يطلب شيئاً من مقسم بعد الربط، فلا يبحث الموظف عن العنوان
function supportLine(text, onCopy) {
    return el('p', { class: 'mq-line mq-ask' }, [el('span', { text: 'دعم مقسم:' }), ...contact(text, onCopy)]);
}

/* ===================== التبويب ===================== */

// hooks.onState(link): كلما رُسمت حالة الربط، ليقولها اسم التبويب ويعرفها تبويب Zoho
export async function renderMaqsamLink(root, hooks = {}) {
    const live = el('div', { class: 'w4-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const body = el('div', { class: 'mq-page' }, loading());
    let link = null;      // آخر ربط ردّه الخادم
    let form = null;      // النموذج ما دام مفتوحاً، بعقده نفسها فتبقى القيم بين الرسمات
    let notice = null;    // رسالة فوق البطاقات لما لا يخص النموذج
    let testBtn = null;   // زر الفحص الحالي: يُعاد بناؤه مع كل رسم
    let busy = false;
    let liveTimer = 0;

    replace(root, [el('p', { class: 'mq-line lk-intro', text: LINK_INTRO }), live, body]);
    await load();

    // المنطقة تُفرَّغ أولاً حتى تُقرأ الرسالة نفسها إذا تكررت
    function announce(text) {
        clearTimeout(liveTimer);
        live.textContent = '';
        liveTimer = setTimeout(() => { live.textContent = text; }, 60);
    }

    async function copyRequest(text) {
        try {
            await navigator.clipboard.writeText(text);
            if (!root.isConnected) return;
            notify(COPIED_TEXT, 'success');
            announce(COPIED_TEXT);
        } catch (_) {
            if (!root.isConnected) return;
            // متصفح يمنع النسخ التلقائي: يُعرض النص ليُنسخ باليد (كما في mortgage.js)
            const box = el('textarea', { class: 'mort-copy', rows: 8, readOnly: true, value: text });
            openModal('نص الطلب', [box, el('p', { class: 'hint', text: 'حدد النص وانسخه.' })], { narrow: true });
            box.select();
        }
    }

    async function load() {
        replace(body, loading());
        const reply = await callLink({ action: 'status' });
        if (!root.isConnected) return;
        if (reply.kind === 'ok') {
            link = reply.link;
            paint();
        } else if (reply.kind === 'error') {
            // انتهاء الجلسة لا تصلحه إعادة المحاولة: رسالته تقول ما يُفعل
            replace(body, failBox({ title: reply.text }, reply.code === 'unauthenticated' ? null : load));
            announce(reply.text);
        } else {
            replace(body, unreachableBox(load));
        }
    }

    function paint() {
        const view = statusView(link);
        if (!view.connected && !form) form = newForm(DEFAULT_HOST);
        if (hooks.onState) hooks.onState(link);
        replace(body, [notice].concat(view.connected ? connectedCards(view) : [stepsCard(view, copyRequest), formNode(false), el('p', { class: 'mq-foot', text: FOOTNOTE })]));
    }

    function connectedCards(view) {
        const changing = Boolean(form);
        // زر رئيسي واحد: ما دام النموذج مفتوحاً فـ«اختبار وحفظ» هو الرئيسي
        testBtn = el('button', { type: 'button', class: 'btn btn-sm ' + (changing ? 'btn-outline' : 'btn-primary'), text: TEST_TEXT, onclick: test });
        return [
            el('section', { class: 'crm-card', 'aria-labelledby': 'mqStatusTitle' }, [
                cardHead('mqStatusTitle', 'حالة الربط', badge(view.badge.text, view.badge.tone)),
                view.problem ? failBox(view.problem) : null,
                view.problem ? supportLine(FAULT_REQUEST, copyRequest) : null,
                factRows(view.rows),
                el('div', { class: 'btn-row mq-actions' }, [
                    testBtn,
                    // يبقى في مكانه معطلاً والنموذج مفتوح: لو اختفى لانزلق «فصل الربط» تحت الضغطة الثانية من نقرة مزدوجة
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تغيير القيم', disabled: changing, onclick: openForm }),
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'فصل الربط', onclick: confirmDisconnect })
                ])
            ]),
            changing ? formNode(true) : null,
            view.stats ? resultCard(view, copyRequest) : null,
            el('p', { class: 'mq-foot', text: FOOTNOTE })
        ];
    }

    /* ---------- النموذج ---------- */

    function newForm(host) {
        const baseUrl = credentialInput({ value: host });
        const keyId = credentialInput({});
        // one-time-code: كروم لا يعدّها كلمة مرور، فلا يعرض حفظ القيم كدخول لهذا الموقع ولا يملأ الحقل منها
        const secret = credentialInput({ type: 'password', autocomplete: 'one-time-code' });
        const title = el('h2', { id: 'mqFormTitle' });
        const note = el('div');
        const result = el('div', { class: 'mq-result' });
        const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: SAVE_TEXT });
        const actions = el('div', { class: 'btn-row mq-actions' });
        const node = el('form', { class: 'crm-card mq-form', 'aria-labelledby': 'mqFormTitle', noValidate: true, autocomplete: 'off' }, [
            el('div', { class: 'crm-card-head' }, title),
            note,
            el('div', { class: 'form-grid' }, [
                field('الرابط الأساسي (base_url)', baseUrl, { hint: 'معبّأ لحساب ملائم. غيّره فقط إذا أظهر زر «عرض الرابط الأساسي» في مقسم رابطاً آخر.' }),
                field('رقم مفتاح التعريف (access_key_id)', keyId),
                field('كلمة السر (access_secret)', secret, { hint: 'تُحفظ مشفّرة، ولا تظهر لأحد بعد الحفظ، حتى للمدير.' })
            ]),
            result,
            actions,
            el('p', { class: 'mq-line mq-after', text: 'نجرّب القيم أولاً، ولا تُحفظ إلا إذا نجح الاختبار.' })
        ]);
        node.addEventListener('submit', (event) => {
            event.preventDefault();
            save();
        });
        return { node, baseUrl, keyId, secret, title, note, result, submit, actions };
    }

    // النموذج نفسه للربط الأول ولتغيير القيم، والفرق في العنوان والملاحظة وزر الإلغاء
    function formNode(changing) {
        form.title.textContent = changing ? 'تغيير القيم' : 'قيم الربط';
        replace(form.note, changing ? el('p', { class: 'mq-line', text: KEEP_NOTE }) : null);
        replace(form.actions, [form.submit, changing ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeForm }) : null]);
        return form.node;
    }

    function openForm() {
        if (busy) return;
        form = newForm((link && link.host) || DEFAULT_HOST);
        notice = null;
        paint();
        form.keyId.focus();
    }

    function closeForm() {
        if (busy) return;
        dropForm();
        paint();
        testBtn.focus();
    }

    // لا تبقى القيم في عقد منفصلة بعد اختفاء الحقول
    function dropForm() {
        if (!form) return;
        for (const box of [form.baseUrl, form.keyId, form.secret]) box.value = '';
        form = null;
    }

    function formResult(current, node) {
        replace(current.result, node);
        current.result.scrollIntoView({ block: 'nearest' });
    }

    async function save() {
        if (busy || !form) return;
        const current = form;
        const boxes = { base_url: current.baseUrl, access_key_id: current.keyId, access_secret: current.secret };
        for (const box of Object.values(boxes)) box.removeAttribute('aria-invalid');
        const missing = Object.values(boxes).filter((box) => !box.value.trim());
        if (missing.length) {
            for (const box of missing) box.setAttribute('aria-invalid', 'true');
            formResult(current, failBox({ title: EMPTY_TEXT }));
            announce(EMPTY_TEXT);
            missing[0].focus();
            return;
        }

        replace(current.result, null);
        const reply = await act(current.submit, SAVE_BUSY, {
            action: 'save',
            base_url: current.baseUrl.value.trim(),
            access_key_id: current.keyId.value.trim(),
            access_secret: current.secret.value.trim()
        });
        if (!reply) return;

        if (reply.kind === 'ok' && reply.saved) {
            link = reply.link;
            dropForm();
            paint();
            notify(SAVED_TEXT, 'success');
            announce(SAVED_TEXT);
            focusFromTop();
            return;
        }
        if (reply.kind === 'ok') link = reply.link;
        paint();
        if (reply.kind === 'unreachable') {
            announce('');
            formResult(current, unreachableBox(() => current.node.requestSubmit()));
        } else {
            const copy = reply.kind === 'ok' ? saveFailureCopy(reply.check && reply.check.code) : { title: reply.text, action: '' };
            formResult(current, failBox(copy));
            announce(copy.title + (copy.action ? ' ' + copy.action : ''));
        }
        const wrong = reply.kind === 'error' && boxes[reply.field];
        if (wrong) wrong.setAttribute('aria-invalid', 'true');
        // على الجوال يفتح التركيز على الحقل لوحة المفاتيح فتغطي الرسالة تحته: يبقى الحقل معلَّماً، والتركيز على الزر بجانب الرسالة
        const target = wrong && !matchMedia('(pointer: coarse)').matches ? wrong : current.submit;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
    }

    /* ---------- الفحص والفصل ---------- */

    // الزر يقول ما يجري، وكل أزرار الصفحة معطلة حتى يصل الرد. null: غادر المدير الصفحة قبل الرد
    async function act(button, busyText, payload) {
        busy = true;
        notice = null;
        const label = button.textContent;
        for (const b of root.querySelectorAll('button')) b.disabled = true;
        button.textContent = busyText;
        announce(busyText);
        const reply = await callLink(payload);
        if (!root.isConnected) return null;
        busy = false;
        for (const b of root.querySelectorAll('button')) b.disabled = false;
        button.textContent = label;
        return reply;
    }

    async function test() {
        if (busy) return;
        const reply = await act(testBtn, TEST_BUSY, { action: 'test' });
        if (!reply) return;
        if (reply.kind === 'ok') {
            link = reply.link;
            paint();
            const passed = Boolean(reply.check) && reply.check.ok === true;
            const copy = passed ? checkCopy('ok') : savedFailureCopy(reply.check && reply.check.code);
            if (passed) notify(copy.title, 'success');
            announce(copy.title + (copy.action ? ' ' + copy.action : ''));
        } else if (reply.kind === 'error') {
            // الربط حُذف من مكان آخر: not_connected تعني أن لا شيء محفوظ، فتعود الصفحة إلى خطوات الربط
            if (reply.code === 'not_connected') {
                link = null;
                dropForm();
            }
            notice = failBox({ title: reply.text });
            paint();
            announce(reply.text);
        } else {
            notice = unreachableBox(test);
            paint();
            announce('');
        }
        focusAfterRepaint();
    }

    function confirmDisconnect() {
        if (busy) return;
        const stay = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal });
        const go = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'فصل الربط' });
        go.addEventListener('click', () => disconnect(go, stay));
        openModal('فصل الربط مع مقسم', [
            el('p', { text: 'تُحذف القيم المحفوظة نهائياً، ويلزم إدخالها من جديد لإعادة الربط.' }),
            el('div', { class: 'btn-row btn-row-end' }, [stay, go])
        ], { narrow: true });
    }

    async function disconnect(go, stay) {
        if (busy) return;
        go.disabled = true;
        stay.disabled = true;
        const reply = await act(go, 'جارٍ الفصل…', { action: 'disconnect' });
        if (!reply) return;
        closeModal();
        if (reply.kind === 'ok') {
            link = reply.link;
            dropForm();
            paint();
            notify(REMOVED_TEXT, 'success');
            announce(REMOVED_TEXT);
            focusFromTop();
            return;
        }
        notice = reply.kind === 'error' ? failBox({ title: reply.text }) : unreachableBox(confirmDisconnect);
        paint();
        announce(reply.kind === 'error' ? reply.text : '');
        focusAfterRepaint();
    }

    // الزر الذي كان عليه التركيز أُعيد بناؤه: يعود التركيز إلى زر الفحص، أو عنوان الخطوات إن لم يبق ربط، لا إلى أول الصفحة
    function focusAfterRepaint() {
        const target = statusView(link).connected ? testBtn : body.querySelector('#mqStepsTitle');
        if (target) target.focus();
    }

    // بعد الحفظ أو الفصل تتغير الصفحة كلها: تبدأ من أولها، فالحالة أول ما يُرى
    function focusFromTop() {
        // الرد وصل والمدير في التبويب الآخر: لا تتحرك صفحته
        if (!root.hidden) window.scrollTo(0, 0);
        const target = statusView(link).connected ? testBtn : body.querySelector('#mqStepsTitle');
        if (target) target.focus({ preventScroll: true });
    }
}
