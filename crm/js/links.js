// ‎#/settings/links‎ — «ربط الأنظمة» (للمدير وحده، ويُفتح من بطاقة في «الإعدادات»): صفحة واحدة بتبويبي «مقسم» و«Zoho CRM».
//
//   • التبويب من الرابط: ‎#/settings/links?tab=zoho‎، و«مقسم» بلا لاحقة، والرابط القديم ‎#/settings/maqsam‎ يفتح «مقسم».
//   • نمط tablist كما في صفحة العقار (project.js): الأسهم تنقل بينها وتفتحها، وHome/End أولها وآخرها، والاختيار يُكتب في الرابط
//     بـ replaceState: لا hashchange فلا يُعاد رسم الصفحة، ولا سطر جديد في تاريخ المتصفح.
//   • كل لوحة تُبنى عند أول فتح وتُخفى وتُظهر بعده، فتبقى القيم المكتوبة. فشل لوحة لا يمس الأخرى.
//   • تحت اسم كل تبويب حالته بكلمة: من اللوحة إن فُتحت، وإلا من قراءة واحدة للحالة. تعذرت القراءة فتبقى فارغة.

import { el, replace, icon, pageHead, errorBox } from './ui.js';
import { wrapIndex } from './project-profile.js';
import { renderMaqsamLink, linkStatus } from './maqsam-link.js';
import { statusView as maqsamView } from './maqsam-link-model.js';
import { zohoTab, zohoStatus } from './zoho-link.js';
import { statusView as zohoView, LINKS_TITLE, LINKS_INTRO, LINK_TABS, linksTab, linksHash } from './zoho-link-model.js';

// السهم في ui.js يشير يساراً (إلى الأمام في العربية)، ويُعكس في v6.css ليشير إلى الرجوع
function backLink() {
    return el('a', { class: 'pj-backlink mq-back', href: '#/settings' }, [
        icon('arrow'),
        el('span', { class: 'w4-sr', text: 'رجوع إلى ' }),
        el('span', { text: 'الإعدادات' })
    ]);
}

function rememberTab(key) {
    const hash = linksHash(key);
    if (location.hash === hash) return;
    try {
        history.replaceState(history.state, '', hash);
    } catch (_) {
        // متصفح يمنع تعديل الرابط: يبقى التبويب في الصفحة المفتوحة وحدها
    }
}

// query: لاحقة الرابط كما يمرّرها الموجّه («tab=zoho»)، ولا شيء في الرابط القديم
export async function renderLinks(root, query) {
    const keys = LINK_TABS.map((tab) => tab.key);
    const tabs = new Map();
    let current = null;

    const list = el('div', { class: 'pj-tabs lk-tabs', role: 'tablist', 'aria-label': LINKS_TITLE });
    for (const tab of LINK_TABS) {
        const word = el('span', { class: 'lk-tab-state' });
        // المسافة بين الاسم والحالة لقارئ الشاشة («مقسم مربوط»)
        const button = el('button', {
            type: 'button', class: 'pj-tab lk-tab', role: 'tab', id: 'lkTab-' + tab.key,
            'aria-controls': 'lkPane-' + tab.key, 'aria-selected': 'false', tabindex: '-1',
            onclick: () => { choose(tab.key, true); }
        }, [el('span', { text: tab.label }), ' ', word]);
        const pane = el('div', { class: 'lk-pane', role: 'tabpanel', id: 'lkPane-' + tab.key, 'aria-labelledby': 'lkTab-' + tab.key, hidden: true });
        list.appendChild(button);
        tabs.set(tab.key, { button, pane, word, started: false, reported: false });
    }

    list.addEventListener('keydown', (event) => {
        const at = keys.indexOf(current);
        const rtl = getComputedStyle(list).direction !== 'ltr';
        let next = null;
        if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = wrapIndex(at + 1, keys.length);
        else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = wrapIndex(at - 1, keys.length);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = keys.length - 1;
        if (next === null) return;
        event.preventDefault();
        choose(keys[next], true);
        tabs.get(keys[next]).button.focus();
    });

    function setWord(key, state) {
        const tab = tabs.get(key);
        tab.reported = true;
        tab.word.textContent = state.text;
        tab.word.dataset.tone = state.tone;
    }

    function onMaqsam(link) {
        const view = maqsamView(link);
        setWord('maqsam', view.badge);
        zoho.setMaqsam(view.connected);
    }

    // من اللوحتين إلى الكلمتين. تعذرت القراءة فلا تتغير الكلمة، ويبقى ما لا نعرفه «لا نعرف» عند تبويب Zoho
    function readMaqsam() {
        return linkStatus().catch(() => null).then((link) => {
            if (link && root.isConnected) onMaqsam(link);
        });
    }

    const zoho = zohoTab(tabs.get('zoho').pane, {
        maqsam: null,
        onState: (state) => setWord('zoho', state),
        recheckMaqsam: readMaqsam,
        openMaqsam: () => {
            choose('maqsam', true);
            tabs.get('maqsam').button.focus();
        }
    });

    const bodies = {
        maqsam: { start: () => renderMaqsamLink(tabs.get('maqsam').pane, { onState: onMaqsam }) },
        zoho: { start: zoho.start, enter: zoho.enter, leave: zoho.leave }
    };

    // أول فتح يبني اللوحة، وما بعده يخبرها فقط. خطأ في بنائها يبقى داخلها ومعه إعادة المحاولة
    async function open(key) {
        const tab = tabs.get(key);
        if (tab.started) {
            if (bodies[key].enter) await bodies[key].enter();
            return;
        }
        tab.started = true;
        try {
            await bodies[key].start();
        } catch (error) {
            console.error('[CRM]', error);
            if (!root.isConnected) return;
            tab.started = false;
            replace(tab.pane, errorBox(error, 'تعذّر عرض هذا القسم', () => open(key)));
        }
    }

    function choose(key, byUser) {
        if (key === current || !tabs.has(key)) return null;
        if (current && bodies[current].leave) bodies[current].leave();
        current = key;
        for (const [k, tab] of tabs) {
            tab.button.setAttribute('aria-selected', k === key ? 'true' : 'false');
            tab.button.tabIndex = k === key ? 0 : -1;
            tab.pane.hidden = k !== key;
        }
        if (byUser) rememberTab(key);
        return open(key);
    }

    replace(root, [
        backLink(),
        pageHead(LINKS_TITLE, LINKS_INTRO),
        el('div', { class: 'lk-tabbed' }, [list, ...Array.from(tabs.values()).map((tab) => tab.pane)])
    ]);

    // كلمة التبويب الآخر قبل فتحه. تبويب مقسم إن فُتح يقول حالته بنفسه، وإلا فتبويب Zoho يحتاجها ليعرف هل يوجد ما يُنقل
    const start = linksTab(query);
    if (start !== 'maqsam') readMaqsam();
    if (start !== 'zoho') {
        zohoStatus().catch(() => null).then((status) => {
            if (status && root.isConnected && !tabs.get('zoho').reported) setWord('zoho', zohoView(status.link, status.sync).badge);
        });
    }
    await choose(start, false);
}
