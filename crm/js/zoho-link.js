// تبويب «Zoho CRM» في «ربط الأنظمة» (links.js، للمدير وحده).
//
// يلصق المدير Client ID وClient Secret ورمزاً قصير العمر من صفحة مفاتيح Zoho، فتختبرها وظيفة zoho-link وتحفظها مشفّرة إن نجح الاختبار،
// ثم يعرض التبويب حالة الربط وأرقام آخر 7 أيام، وبطاقة «نقل ملخصات مقسم إلى Zoho»: معاينة ما سيُكتب، وكتابة ملاحظة واحدة حقيقية، ثم التشغيل.
//
// قواعد هذا التبويب:
// - المتصفح لا يكلّم Zoho أبداً، وكل شيء عبر الوظيفة. القيم الحساسة تُرسل مرة وتبقى في حقولها فقط، فلا تُخزَّن ولا تُسجَّل، وبعد نجاح الحفظ
//   تختفي الحقول. الرمز يعمل مرة واحدة: يُفرَّغ حقله مع كل محاولة، ولا إعادة محاولة بالرمز نفسه.
// - كل ما يُرسم يأتي من آخر ربط ونقل ردّهما الخادم، ونصوص الخادم ونص الملاحظة تدخل نصاً (textContent) لا HTML.
// - المعاينة فيها كلام عملاء: في الذاكرة فقط، ولا تدخل أي تخزين، وتُرمى عند مغادرة التبويب ولو جاء ردها بعد المغادرة.
// - زر رئيسي واحد في الشاشة (primaryAction)، والحالة بكلمة لا بلون وحده، والنتائج تُعلن في منطقة aria-live.
// - النقرة الثانية من نقرة مزدوجة تُهمل (press): بعد الرد يُرسم التبويب من جديد، فقد يقع تحت المؤشر زر آخر، وقد يكون زر تأكيد في نافذة.

import { supabase } from './supabase.js';
import {
    el, replace, loading, field, badge, notify, openModal, closeModal,
    countText, fmtDateTime, EM_DASH
} from './ui.js';
import { credentialInput, cardHead, failBox, unreachableBox, factRows } from './maqsam-link.js';
import { UNREACHABLE_TEXT } from './maqsam-link-model.js';
import {
    ZOHO_INTRO, CONSOLE_URL, SCOPES, STEPS, CHECK_OK, SYNC_TITLE, SYNC_WHAT, SYNC_RUNNING, MAQSAM_MISSING,
    START_CHOICES, START_NOTE, NO_MATCH_TEXT, AMBIGUOUS_TEXT, PREVIEW_NOTE, PREVIEW_EMPTY, WRITE_NOTE,
    saveFailureCopy, savedFailureCopy, saveErrorCopy, startRefusal, readReply, statusView, accountLine, settingsLine,
    statsRows, ownersView, statsNotes, syncView, primaryAction, previewRows
} from './zoho-link-model.js';

const SAVE_TEXT = 'اختبار وحفظ';
const SAVE_BUSY = 'جارٍ الاختبار…';
const TEST_TEXT = 'فحص الربط الآن';
const TEST_BUSY = 'جارٍ الفحص…';
const CHANGE_TEXT = 'تغيير القيم';
const PREVIEW_TEXT = 'معاينة';
const START_TEXT = 'تشغيل النقل';
const STOP_TEXT = 'إيقاف النقل';
const WRITE_TEXT = 'اكتب هذه الملاحظة في Zoho';
const EMPTY_TEXT = 'أكمل الحقول الفارغة.';
const COPIED_TEXT = 'تم نسخ الصلاحيات.';
const SAVED_TEXT = 'تم الربط مع Zoho.';
const REMOVED_TEXT = 'تم فصل الربط مع Zoho.';
const WRITTEN_TEXT = 'كُتبت الملاحظة في Zoho.';
const STARTED_TEXT = 'بدأ النقل. أول تشغيل خلال 5 دقائق.';
const STOPPED_TEXT = 'توقف النقل.';
const KEEP_NOTE = 'القيم الحالية تبقى كما هي حتى تنجح القيم الجديدة في الاختبار.';
const AFTER_FORM = 'نجرّب القيم أولاً، ولا تُحفظ إلا إذا نجح الاختبار.';
const SECRET_HINT = 'تُحفظ مشفّرة، ولا تظهر لأحد بعد الحفظ، حتى للمدير.';
const FOOTNOTE = 'لا نحفظ كلام العملاء ولا أرقامهم. ولا يُكتب في Zoho شيء إلا ملاحظة الملخص، وبعد ضغطة من المدير فقط.';
const NOT_REVOKED = { title: 'فُصل الربط هنا، لكن Zoho لم يؤكد إلغاء المفتاح.', action: 'لن يستعمله النظام بعد الآن. لإلغائه نهائياً أخبر مسؤول النظام.' };
const OLD_NOT_REVOKED = { title: 'تم الربط الجديد، لكن Zoho لم يؤكد إلغاء المفتاح القديم.', action: 'لن يستعمله النظام بعد الآن. لإلغائه نهائياً أخبر مسؤول النظام.' };

// نداء الوظيفة. الخطأ العربي في جسم الرد حتى مع رمز غير 2xx، وكل ما عداه يصير «لم يُوصل إلى الخدمة»
async function callLink(payload) {
    try {
        const { data, error } = await supabase.functions.invoke('zoho-link', { body: payload });
        if (!error) return readReply(data);
        const ctx = error.context;
        return readReply(ctx && typeof ctx.json === 'function' ? await ctx.json() : null);
    } catch (_) {
        return readReply(null);
    }
}

// حالة الربط لمن يسأل من خارج التبويب: null إن لم تُقرأ، ومن يسأل يسكت عندها
export async function zohoStatus() {
    const reply = await callLink({ action: 'status' });
    return reply.kind === 'ok' && reply.link ? { link: reply.link, sync: reply.sync } : null;
}

// سطر الحالة لبطاقة الإعدادات
export async function zohoStatusLine() {
    const status = await zohoStatus();
    return status ? settingsLine(status.link, status.sync) : null;
}

// النقرة الثانية من نقرة مزدوجة لا تعمل شيئاً
const press = (action) => (event) => {
    if (event.detail > 1) return;
    action(event);
};

// hooks: onState(badge) كلما تغيرت الحالة، وopenMaqsam() يفتح تبويب مقسم، وrecheckMaqsam() يعيد قراءة حالته،
// وmaqsam: هل مقسم مربوط عند البدء (null: لا نعرف بعد). start() أول فتح، وenter() وleave() مع كل فتح ومغادرة بعده، وsetMaqsam() إذا تغيرت حالة مقسم
export function zohoTab(root, hooks = {}) {
    const live = el('div', { class: 'w4-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const body = el('div', { class: 'mq-page zh-page' });
    let link = null;      // آخر ربط ردّه الخادم
    let sync = null;      // آخر حالة نقل ردّها الخادم
    let maqsam = hooks.maqsam === undefined ? null : hooks.maqsam;
    let form = null;      // النموذج ما دام مفتوحاً، بعقده نفسها فتبقى القيم بين الرسمات
    let notice = null;    // رسالة فوق البطاقات لما لا يخص النموذج
    let syncNotice = null; // رسالة داخل بطاقة النقل
    let preview = null;   // المعاينة المعروضة: في الذاكرة فقط
    let previewRun = 0;   // يتغير مع كل طلب معاينة ومع مغادرة التبويب: رد قديم يُهمل
    let testBtn = null;   // زر الفحص الحالي: يُعاد بناؤه مع كل رسم
    let previewBtn = null;
    let stopBtn = null;
    let busy = false;
    let loaded = false;
    let liveTimer = 0;

    return { start: load, enter, leave, setMaqsam };

    // المنطقة تُفرَّغ أولاً حتى تُقرأ الرسالة نفسها إذا تكررت
    function announce(message) {
        clearTimeout(liveTimer);
        live.textContent = '';
        liveTimer = setTimeout(() => { live.textContent = message; }, 60);
    }

    // اللوحة فارغة حتى تُفتح. وبعد خطأ في بنائها تكتب links.js رسالته فيها، فتُركَّب من جديد مع إعادة المحاولة
    async function load() {
        if (body.parentNode !== root) replace(root, [el('p', { class: 'mq-line lk-intro', text: ZOHO_INTRO }), live, body]);
        replace(body, loading());
        const reply = await callLink({ action: 'status' });
        if (!root.isConnected) return;
        if (reply.kind === 'ok' && reply.link) {
            link = reply.link;
            sync = reply.sync;
            loaded = true;
            paint();
        } else if (reply.kind === 'error') {
            // انتهاء الجلسة لا تصلحه إعادة المحاولة: رسالته تقول ما يُفعل
            replace(body, failBox({ title: reply.text }, reply.code === 'unauthenticated' ? null : load));
            announce(reply.text);
        } else {
            replace(body, unreachableBox(load));
        }
    }

    // العودة إلى التبويب: أرقام النقل تتحرك في الخلفية، فتُقرأ من جديد بلا مسح. تعذرت قراءتها فيبقى المعروض
    async function enter() {
        if (!loaded) return load();
        if (busy) return;
        const reply = await callLink({ action: 'status' });
        if (!root.isConnected || busy || reply.kind !== 'ok' || !reply.link) return;
        link = reply.link;
        sync = reply.sync;
        repaintQuietly();
    }

    // مغادرة التبويب: تُرمى المعاينة بما فيها من كلام عملاء، ورد لم يصل بعد يُهمل
    function leave() {
        previewRun += 1;
        if (!preview) return;
        preview = null;
        const shown = body.querySelector('.zh-preview');
        if (shown) shown.remove();
    }

    function setMaqsam(value) {
        if (maqsam === value) return;
        maqsam = value;
        if (loaded) repaintQuietly();
    }

    // رسم لم يطلبه المدير: لا يبدّل ما تحت نافذة مفتوحة، ويعيد التركيز إلى حيث كان: الحقول هي نفسها، والعناوين والأزرار تُبنى من جديد
    function repaintQuietly() {
        if (busy || document.getElementById('modal').classList.contains('active')) return;
        const was = root.contains(document.activeElement) ? document.activeElement : null;
        const id = was ? was.id : '';
        const label = was && was.tagName === 'BUTTON' ? was.textContent : '';
        paint();
        if (!was) return;
        const again = was.isConnected ? was : id ? body.querySelector('#' + id) : Array.from(body.querySelectorAll('button')).find((b) => b.textContent === label);
        if (again) again.focus({ preventScroll: true });
    }

    function paint() {
        const view = statusView(link, sync);
        if (!view.connected) {
            preview = null;
            if (!form) form = newForm();
        }
        if (hooks.onState) hooks.onState(view.badge);
        replace(body, [notice].concat(view.connected ? connectedCards(view) : [stepsCard(view.badge), formNode(false), foot()]));
    }

    function foot() {
        return el('p', { class: 'mq-foot', text: FOOTNOTE });
    }

    /* ---------- الخطوات ---------- */

    async function copyScopes() {
        try {
            await navigator.clipboard.writeText(SCOPES);
            if (!root.isConnected) return;
            notify(COPIED_TEXT, 'success');
            announce(COPIED_TEXT);
        } catch (_) {
            if (!root.isConnected) return;
            // متصفح يمنع النسخ التلقائي: يُعرض النص ليُنسخ باليد (كما في mortgage.js)
            const box = el('textarea', { class: 'mort-copy', rows: 5, readOnly: true, dir: 'ltr', value: SCOPES });
            openModal('الصلاحيات', [box, el('p', { class: 'hint', text: 'حدد النص وانسخه.' })], { narrow: true });
            box.select();
        }
    }

    // الشارة للربط الأول. عند «تغيير القيم» حالة الربط في بطاقتها، فلا تتكرر
    function stepsCard(state) {
        return el('section', { class: 'crm-card', 'aria-labelledby': 'zhStepsTitle' }, [
            cardHead('zhStepsTitle', 'خطوات الربط', state ? badge(state.text, state.tone) : null),
            el('ol', { class: 'mq-steps', role: 'list' }, [
                el('li', {}, [
                    el('span', { text: STEPS.open }),
                    el('div', { class: 'zh-step-do' }, el('a', { class: 'btn btn-outline btn-sm', href: CONSOLE_URL, target: '_blank', rel: 'noopener', text: 'فتح صفحة مفاتيح Zoho' }))
                ]),
                el('li', { text: STEPS.client }),
                el('li', { text: STEPS.values }),
                el('li', {}, [
                    el('span', { text: STEPS.scope }),
                    el('code', { class: 'zh-scope', dir: 'ltr', text: SCOPES }),
                    el('div', { class: 'zh-step-do' }, el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'نسخ الصلاحيات', onclick: press(copyScopes) })),
                    el('span', { class: 'zh-step-more', text: STEPS.code })
                ]),
                el('li', { text: STEPS.paste })
            ])
        ]);
    }

    /* ---------- النموذج ---------- */

    function newForm() {
        const clientId = credentialInput({});
        // one-time-code: كروم لا يعدّها كلمة مرور، فلا يعرض حفظ القيم كدخول لهذا الموقع ولا يملأ الحقل منها
        const clientSecret = credentialInput({ type: 'password', autocomplete: 'one-time-code' });
        const code = credentialInput({});
        const title = el('h2', { id: 'zhFormTitle' });
        const note = el('div');
        const result = el('div', { class: 'mq-result' });
        // فشل الأولى مسح الرمز: الثانية من نقرة مزدوجة كانت ستكتب «أكمل الحقول الفارغة» فوق سبب الفشل
        const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: SAVE_TEXT, onclick: (event) => { if (event.detail > 1) event.preventDefault(); } });
        const actions = el('div', { class: 'btn-row mq-actions' });
        const node = el('form', { class: 'crm-card mq-form', 'aria-labelledby': 'zhFormTitle', noValidate: true, autocomplete: 'off' }, [
            el('div', { class: 'crm-card-head' }, title),
            note,
            el('div', { class: 'form-grid' }, [
                field('Client ID', clientId),
                field('Client Secret', clientSecret, { hint: SECRET_HINT }),
                field('الرمز (Code)', code)
            ]),
            result,
            actions,
            el('p', { class: 'mq-line mq-after', text: AFTER_FORM })
        ]);
        node.addEventListener('submit', (event) => {
            event.preventDefault();
            save();
        });
        return { node, clientId, clientSecret, code, title, note, result, submit, actions };
    }

    // النموذج نفسه للربط الأول ولتغيير القيم، والفرق في العنوان والملاحظة وزر الإلغاء
    function formNode(changing) {
        form.title.textContent = changing ? CHANGE_TEXT : 'قيم الربط';
        replace(form.note, changing ? el('p', { class: 'mq-line', text: KEEP_NOTE }) : null);
        replace(form.actions, [form.submit, changing ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: press(closeForm) }) : null]);
        return form.node;
    }

    function openForm() {
        if (busy) return;
        form = newForm();
        notice = null;
        paint();
        form.clientId.focus();
    }

    function closeForm() {
        if (busy) return;
        dropForm();
        paint();
        if (testBtn) testBtn.focus();
    }

    // لا تبقى القيم في عقد منفصلة بعد اختفاء الحقول
    function dropForm() {
        if (!form) return;
        for (const box of [form.clientId, form.clientSecret, form.code]) box.value = '';
        form = null;
    }

    function formResult(current, node) {
        replace(current.result, node);
        current.result.scrollIntoView({ block: 'nearest' });
    }

    async function save() {
        if (busy || !form) return;
        const current = form;
        const boxes = { client_id: current.clientId, client_secret: current.clientSecret, code: current.code };
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
        const payload = {
            action: 'save',
            client_id: current.clientId.value.trim(),
            client_secret: current.clientSecret.value.trim(),
            code: current.code.value.trim()
        };
        // الرمز يعمل مرة واحدة: يُمسح مع إرساله أياً كانت النتيجة، وClient ID وClient Secret يبقيان للتصحيح
        current.code.value = '';
        const reply = await act(current.submit, SAVE_BUSY, payload);
        if (!reply) return;

        if (reply.kind === 'ok') {
            if (reply.link) link = reply.link;
            if (reply.sync) sync = reply.sync;
        }
        if (reply.kind === 'ok' && reply.saved) {
            dropForm();
            dropPreview();
            notice = reply.oldNotRevoked ? warnBox(OLD_NOT_REVOKED) : null;
            paint();
            notify(SAVED_TEXT, 'success');
            announce(reply.oldNotRevoked ? OLD_NOT_REVOKED.title + ' ' + OLD_NOT_REVOKED.action : SAVED_TEXT);
            focusFromTop();
            return;
        }
        paint();
        const copy = reply.kind === 'ok' ? saveFailureCopy(reply.check) : saveErrorCopy(reply);
        formResult(current, failBox(copy));
        announce(copy.title + ' ' + copy.action);
        const wrong = reply.kind === 'error' && boxes[reply.field];
        if (wrong) wrong.setAttribute('aria-invalid', 'true');
        // على الجوال يفتح التركيز على الحقل لوحة المفاتيح فتغطي الرسالة تحته: يبقى الحقل معلَّماً، والتركيز على الزر بجانب الرسالة
        const target = wrong && !matchMedia('(pointer: coarse)').matches ? wrong : current.submit;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest' });
    }

    /* ---------- الربط القائم ---------- */

    function connectedCards(view) {
        const changing = Boolean(form);
        const syncState = syncView(sync, maqsam);
        const primary = primaryAction(view, syncState, changing, Boolean(preview));
        // زر رئيسي واحد: ما يليق بالخطوة التالية، وما سواه هادئ
        const cls = (action) => 'btn btn-sm ' + (primary === action ? 'btn-primary' : 'btn-outline');
        testBtn = el('button', { type: 'button', class: cls('test'), text: TEST_TEXT, onclick: press(test) });
        return [
            el('section', { class: 'crm-card', 'aria-labelledby': 'zhStatusTitle' }, [
                cardHead('zhStatusTitle', 'حالة الربط', badge(view.badge.text, view.badge.tone)),
                view.problem ? failBox(view.problem) : null,
                factRows(view.rows),
                el('p', { class: 'mq-line mq-after zh-account', text: accountLine(link) }),
                el('div', { class: 'btn-row mq-actions' }, [
                    testBtn,
                    // يبقى في مكانه معطلاً والنموذج مفتوح: لو اختفى لانزلق «فصل الربط» تحت الضغطة الثانية من نقرة مزدوجة
                    el('button', { type: 'button', class: cls('change'), text: CHANGE_TEXT, disabled: changing, onclick: press(openForm) }),
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'فصل الربط', onclick: press(confirmDisconnect) })
                ])
            ]),
            changing ? stepsCard(null) : null,
            changing ? formNode(true) : null,
            syncCard(syncState, cls),
            view.stats ? statsCard(view) : null,
            foot()
        ];
    }

    function statsCard(view) {
        const notes = statsNotes(view);
        const owners = ownersView(view.stats);
        const callsText = (n) => (n === null ? EM_DASH : countText(n, ['مكالمة واحدة', 'مكالمتان', 'مكالمات', 'مكالمة']));
        return el('section', { class: 'crm-card mq-result-card', 'aria-labelledby': 'zhResultTitle' }, [
            cardHead('zhResultTitle', 'ما وجدناه في الأيام السبعة قبل آخر فحص', el('span', { class: 'crm-subtle', text: fmtDateTime(view.checkedAt) })),
            notes.length ? el('ul', { class: 'crm-warn-box mq-advice', role: 'list' }, notes.map((line) => el('li', { text: line }))) : null,
            factRows(statsRows(view.stats)),
            owners.length ? el('h3', { class: 'mq-sub', text: 'المكالمات لكل موظف' }) : null,
            owners.length ? el('ul', { class: 'mq-agents', role: 'list' }, owners.map((owner) => el('li', {}, [
                el('span', { class: 'zh-owner', text: owner.name }),
                el('span', { class: 'mq-agent-count', text: callsText(owner.calls) })
            ]))) : null
        ]);
    }

    /* ---------- النقل ---------- */

    function syncCard(state, cls) {
        previewBtn = state.canPreview ? el('button', { type: 'button', class: cls('preview'), text: PREVIEW_TEXT, onclick: press(askPreview) }) : null;
        stopBtn = state.enabled ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: STOP_TEXT, onclick: press(stopSync) }) : null;
        return el('section', { class: 'crm-card', 'aria-labelledby': 'zhSyncTitle' }, [
            cardHead('zhSyncTitle', SYNC_TITLE, badge(state.badge.text, state.badge.tone)),
            state.problem ? failBox(state.problem) : null,
            state.enabled ? el('p', { class: 'mq-line', text: SYNC_RUNNING }) : el('p', { class: 'mq-line', text: SYNC_WHAT }),
            state.maqsamMissing && !state.enabled ? el('p', { class: 'mq-line zh-maqsam-missing', text: MAQSAM_MISSING }) : null,
            state.rows.length ? factRows(state.rows) : null,
            syncNotice,
            state.maqsamMissing && hooks.openMaqsam ? el('div', { class: 'btn-row mq-actions' }, el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'فتح تبويب مقسم', onclick: press(() => hooks.openMaqsam()) })) : null,
            previewBtn || stopBtn ? el('div', { class: 'btn-row mq-actions' }, [previewBtn, stopBtn]) : null,
            state.canPreview && preview ? previewNode(cls) : null
        ]);
    }

    function dropPreview() {
        previewRun += 1;
        preview = null;
        syncNotice = null;
    }

    async function askPreview() {
        if (busy) return;
        const run = ++previewRun;
        const reply = await act(previewBtn, 'جارٍ القراءة…', { action: 'preview' });
        if (!reply) return;
        if (reply.sync) sync = reply.sync;
        // غادر التبويب والرد في الطريق: لا تبقى منه كلمة
        if (run !== previewRun) {
            if (loaded) paint();
            return;
        }
        if (reply.kind === 'ok' && reply.preview) {
            preview = reply.preview;
            paint();
            announce('المعاينة جاهزة. لم يُكتب شيء بعد.');
            focusNode(body.querySelector('#zhPreviewTitle'));
            return;
        }
        if (reply.kind === 'error' && reply.code === 'not_connected') {
            lostLink(reply.text);
            return;
        }
        if (reply.kind === 'error' && reply.code === 'maqsam_not_connected') maqsamLost();
        syncNotice = reply.kind === 'error' ? failBox({ title: reply.text }) : unreachableBox(askPreview);
        paint();
        announce(reply.kind === 'error' ? reply.text : '');
        focusNode(previewBtn || body.querySelector('#zhSyncTitle'));
        if (reply.kind === 'error') reread(reply.text);
    }

    // رفض الخادم لأن مقسم غير مربوط: تقول البطاقة ذلك فوراً، والصفحة تعيد قراءة حالته
    function maqsamLost() {
        maqsam = false;
        if (hooks.recheckMaqsam) hooks.recheckMaqsam();
    }

    function previewNode(cls) {
        const samples = preview.samples;
        return el('div', { class: 'zh-preview' }, [
            el('h3', { class: 'mq-sub', id: 'zhPreviewTitle', tabindex: '-1', text: 'معاينة الملاحظات' }),
            el('p', { class: 'mq-line', text: PREVIEW_NOTE }),
            factRows(previewRows(preview)),
            samples.length
                ? el('ul', { class: 'zh-samples', role: 'list' }, samples.map(sampleNode))
                : el('p', { class: 'mq-line zh-none', text: PREVIEW_EMPTY }),
            el('div', { class: 'btn-row mq-actions' }, el('button', { type: 'button', class: cls('start'), text: START_TEXT, onclick: press(confirmStart) }))
        ]);
    }

    function sampleNode(sample) {
        const written = sample.written;
        const open = written && written.url ? el('a', { class: 'btn btn-outline btn-sm zh-open', href: written.url, target: '_blank', rel: 'noopener', text: 'افتح في Zoho' }) : null;
        sample.node = el('li', { class: 'zh-sample' }, [
            el('strong', { class: 'zh-note-title', dir: 'auto', text: sample.title }),
            el('div', { class: 'zh-note', text: sample.text }),
            sampleTarget(sample),
            sample.error ? failBox(sample.error) : null,
            written
                ? el('div', { class: 'btn-row mq-actions zh-written' }, [badge('كُتبت', 'green'), open])
                : sample.match
                    ? el('div', { class: 'btn-row mq-actions' }, el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: WRITE_TEXT, onclick: press(() => confirmWrite(sample)) }))
                    : null
        ]);
        return sample.node;
    }

    // إلى أين تذهب الملاحظة: رابط ملف العميل، أو أنه لا يوجد
    function sampleTarget(sample) {
        if (sample.written) return null;
        if (!sample.match) return el('p', { class: 'mq-line zh-target', text: NO_MATCH_TEXT });
        return [
            sample.match.url ? el('p', { class: 'zh-target' }, el('a', { class: 'zh-record', href: sample.match.url, target: '_blank', rel: 'noopener', text: 'ملف العميل في Zoho' })) : null,
            sample.ambiguous ? el('p', { class: 'mq-line zh-target', text: AMBIGUOUS_TEXT }) : null
        ];
    }

    function confirmWrite(sample) {
        if (busy) return;
        const stay = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: press(closeModal) });
        const go = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'اكتب الملاحظة' });
        go.addEventListener('click', press(() => writeOne(sample, go, stay)));
        openModal('كتابة الملاحظة في Zoho', [
            el('p', { dir: 'auto', class: 'zh-modal-title', text: sample.title }),
            el('p', { text: WRITE_NOTE }),
            el('div', { class: 'btn-row btn-row-end' }, [stay, go])
        ], { narrow: true });
    }

    async function writeOne(sample, go, stay) {
        if (busy) return;
        go.disabled = true;
        stay.disabled = true;
        const reply = await act(go, 'جارٍ الكتابة…', { action: 'write_one', call_id: sample.callId });
        if (!reply) return;
        closeModal();
        if (reply.sync) sync = reply.sync;
        if (reply.kind === 'ok' && reply.written) {
            sample.written = reply.written;
            sample.error = null;
            paint();
            notify(WRITTEN_TEXT, 'success');
            announce(WRITTEN_TEXT);
            focusNode((sample.node && sample.node.querySelector('.zh-open')) || body.querySelector('#zhPreviewTitle'));
            return;
        }
        if (reply.kind === 'error' && reply.code === 'not_connected') {
            lostLink(reply.text);
            return;
        }
        if (reply.kind === 'error' && reply.code === 'maqsam_not_connected') maqsamLost();
        if (reply.kind === 'error' && reply.code === 'no_match') sample.match = null;
        sample.error = reply.kind === 'error' ? { title: reply.text } : { title: UNREACHABLE_TEXT, action: 'لا نعرف هل كُتبت الملاحظة. اضغط الزر مرة ثانية: لا تُكتب مرتين.' };
        paint();
        announce(sample.error.title + (sample.error.action ? ' ' + sample.error.action : ''));
        focusNode(body.querySelector('#zhPreviewTitle'));
        if (reply.kind === 'error') reread(reply.text);
    }

    function confirmStart() {
        if (busy) return;
        const choices = START_CHOICES.map((choice, i) => el('label', { class: 'zh-choice' }, [
            el('input', { type: 'radio', name: 'zhFrom', value: choice.value, checked: i === 0 }),
            el('span', { class: 'zh-choice-text' }, [
                el('strong', { text: choice.label }),
                el('span', { class: 'zh-choice-hint', text: choice.hint })
            ])
        ]));
        const stay = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: press(closeModal) });
        const go = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: START_TEXT });
        go.addEventListener('click', press(() => {
            const picked = choices.map((c) => c.querySelector('input')).find((b) => b.checked);
            startSync(go, stay, picked ? picked.value : START_CHOICES[0].value);
        }));
        openModal(START_TEXT, [
            el('p', { text: START_NOTE }),
            el('div', { class: 'zh-choices', role: 'radiogroup', 'aria-label': 'ماذا يُنقل؟' }, choices),
            el('div', { class: 'btn-row btn-row-end' }, [stay, go])
        ], { narrow: true });
    }

    async function startSync(go, stay, from) {
        if (busy) return;
        go.disabled = true;
        stay.disabled = true;
        const reply = await act(go, 'جارٍ التشغيل…', { action: 'sync_start', from });
        if (!reply) return;
        closeModal();
        if (reply.sync) sync = reply.sync;
        if (reply.kind === 'ok') {
            dropPreview();
            paint();
            notify(STARTED_TEXT, 'success');
            announce(STARTED_TEXT);
            focusNode(body.querySelector('#zhSyncTitle'));
            return;
        }
        // not_connected هنا: نقص أحد الربطين أو ربط يحتاج إعادة ربط، فتُقرأ الحالتان من جديد
        const refused = reply.kind === 'error' && reply.code === 'not_connected';
        const words = reply.kind === 'error' ? (refused ? startRefusal(reply) : reply.text) : '';
        if (reply.kind === 'error' && reply.code === 'maqsam_not_connected') maqsam = false;
        syncNotice = reply.kind === 'error' ? failBox({ title: words }) : unreachableBox(confirmStart);
        paint();
        announce(words);
        focusNode(body.querySelector('#zhSyncTitle'));
        if (reply.kind === 'error') {
            if (hooks.recheckMaqsam) hooks.recheckMaqsam();
            reread(words);
        }
    }

    // رد الرفض لا يحمل حالة الربط، وقد يكون الخادم رفع معه علامة «يحتاج إعادة ربط» أو انقطع الربط: تُقرأ من جديد والرسالة باقية.
    // انقطع ربط Zoho نفسه: تختفي بطاقة النقل مع رسالتها، فتصير الرسالة فوق خطوات الربط
    async function reread(message) {
        const reply = await callLink({ action: 'status' });
        if (!root.isConnected || busy || reply.kind !== 'ok' || !reply.link) return;
        link = reply.link;
        sync = reply.sync;
        if (!link.connected) notice = failBox({ title: message });
        repaintQuietly();
    }

    async function stopSync() {
        if (busy || !stopBtn) return;
        const reply = await act(stopBtn, 'جارٍ الإيقاف…', { action: 'sync_stop' });
        if (!reply) return;
        if (reply.sync) sync = reply.sync;
        if (reply.kind === 'ok') {
            paint();
            notify(STOPPED_TEXT, 'success');
            announce(STOPPED_TEXT);
        } else {
            syncNotice = reply.kind === 'error' ? failBox({ title: reply.text }) : unreachableBox(stopSync);
            paint();
            announce(reply.kind === 'error' ? reply.text : '');
        }
        focusNode(body.querySelector('#zhSyncTitle'));
    }

    /* ---------- الفحص والفصل ---------- */

    // الزر يقول ما يجري، وكل أزرار التبويب معطلة حتى يصل الرد. null: غادر المدير الصفحة قبل الرد
    async function act(button, busyText, payload) {
        busy = true;
        notice = null;
        syncNotice = null;
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

    // الربط حُذف من مكان آخر: not_connected تعني أن لا شيء محفوظ، فيعود التبويب إلى خطوات الربط
    function lostLink(message) {
        link = null;
        dropForm();
        dropPreview();
        notice = failBox({ title: message });
        paint();
        announce(message);
        focusAfterRepaint();
    }

    async function test() {
        if (busy) return;
        const reply = await act(testBtn, TEST_BUSY, { action: 'test' });
        if (!reply) return;
        if (reply.kind === 'ok') {
            if (reply.link) link = reply.link;
            if (reply.sync) sync = reply.sync;
            const passed = Boolean(reply.check) && reply.check.ok === true;
            // تغيّر الربط أثناء الفحص: الخادم يرد ما هو قائم الآن، وقد لا يكون له فحص
            const copy = !reply.check ? null : passed ? { title: CHECK_OK, action: '' } : savedFailureCopy(reply.check);
            // فشل لا يُكتب على آخر فحص (الحد الزمني): لا يظهر في بطاقة الحالة، فتقوله رسالة فوق البطاقات
            const onCard = link && link.check && link.check.code === (reply.check && reply.check.code);
            if (copy && !passed && !onCard) notice = failBox(copy);
            paint();
            if (copy && passed) notify(copy.title, 'success');
            announce(copy ? copy.title + (copy.action ? ' ' + copy.action : '') : '');
        } else if (reply.kind === 'error') {
            if (reply.code === 'not_connected') {
                lostLink(reply.text);
                return;
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
        const stay = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: press(closeModal) });
        const go = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'فصل الربط' });
        go.addEventListener('click', press(() => disconnect(go, stay)));
        openModal('فصل الربط مع Zoho', [
            el('p', { text: 'نلغي المفتاح عند Zoho ونحذف القيم المحفوظة نهائياً، ويتوقف نقل الملخصات. لإعادة الربط يلزم إدخال القيم ورمز جديد.' }),
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
            if (reply.link) link = reply.link;
            if (reply.sync) sync = reply.sync;
            dropForm();
            dropPreview();
            // لم يؤكد Zoho الإلغاء: يبقى السبب وما يُفعل فوق البطاقات، لا رسالة تختفي
            notice = reply.notRevoked ? warnBox(NOT_REVOKED) : null;
            paint();
            notify(REMOVED_TEXT, 'success');
            announce(reply.notRevoked ? NOT_REVOKED.title + ' ' + NOT_REVOKED.action : REMOVED_TEXT);
            focusFromTop();
            return;
        }
        notice = reply.kind === 'error' ? failBox({ title: reply.text }) : unreachableBox(confirmDisconnect);
        paint();
        announce(reply.kind === 'error' ? reply.text : '');
        focusAfterRepaint();
    }

    function warnBox(copy) {
        return el('div', { class: 'crm-warn-box zh-warn' }, [el('strong', { text: copy.title }), el('span', { text: copy.action })]);
    }

    function focusNode(node) {
        if (!node) return;
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: 'nearest' });
    }

    // الزر الذي كان عليه التركيز أُعيد بناؤه: يعود التركيز إلى زر الفحص، أو عنوان الخطوات إن لم يبق ربط، لا إلى أول الصفحة
    function focusAfterRepaint() {
        const target = statusView(link).connected ? testBtn : body.querySelector('#zhStepsTitle');
        if (target) target.focus();
    }

    // بعد الحفظ أو الفصل تتغير الصفحة كلها: تبدأ من أولها، فالحالة أول ما يُرى
    function focusFromTop() {
        if (!root.hidden) window.scrollTo(0, 0);
        const target = statusView(link).connected ? testBtn : body.querySelector('#zhStepsTitle');
        if (target) target.focus({ preventScroll: true });
    }
}
