// نقطة الدخول: التحقق من الجلسة، هيكل الصفحة، وموجّه المسارات (hash router).

import { supabase } from './supabase.js';
import { state, loadSession, signIn, signOut, isAdmin, myRole, ROLE_AR, displayName } from './auth.js';
import { el, clear, append, notify, fail, errorText, initModal, closeModal } from './ui.js';
import { renderClients } from './clients.js';
import { renderClient } from './client.js';
import { renderRequirementMatches } from './matching.js';
import { renderWork } from './work.js';
import { renderProperties } from './properties.js';
import { renderInventory } from './inventory.js';
import { renderSettings } from './settings.js';
import { renderBoard } from './board.js';
import { renderDeal } from './deal.js';
import { renderDashboard } from './dashboard.js';
import { renderAssistant, renderAgentRequest } from './assistant.js';
import { renderApprovals, renderApproval } from './approvals.js';
import { renderCalendar } from './calendar.js';
import { renderReports } from './reports.js';
import { renderImports } from './imports.js';
import { renderWhatsApp } from './whatsapp.js';

/* ===================== المسارات ===================== */

const DEFAULT_ROUTE = '#/work';

const ROUTES = [
    { pattern: /^#\/work\/?$/, view: renderWork, nav: '#/work' },
    { pattern: /^#\/clients\/([^/]+)\/requirements\/([^/]+)$/, view: renderRequirementMatches, nav: '#/clients' },
    { pattern: /^#\/clients\/([^/]+)$/, view: renderClient, nav: '#/clients' },
    { pattern: /^#\/clients\/?$/, view: renderClients, nav: '#/clients' },
    { pattern: /^#\/properties\/?$/, view: renderProperties, nav: '#/properties' },
    { pattern: /^#\/calendar\/?$/, view: renderCalendar, nav: '#/calendar' },
    { pattern: /^#\/assistant\/?$/, view: renderAssistant, nav: '#/assistant' },
    { pattern: /^#\/assistant\/([^/]+)$/, view: renderAgentRequest, nav: '#/assistant' },
    { pattern: /^#\/approvals\/?$/, view: renderApprovals, nav: '#/approvals', admin: true },
    { pattern: /^#\/approvals\/([^/]+)$/, view: renderApproval, nav: '#/approvals', admin: true },
    { pattern: /^#\/deals\/?$/, view: renderBoard, nav: '#/deals', deny: 'callcenter' },
    { pattern: /^#\/deals\/([^/]+)$/, view: renderDeal, nav: '#/deals', deny: 'callcenter' },
    { pattern: /^#\/dashboard\/?$/, view: renderDashboard, nav: '#/dashboard', admin: true },
    { pattern: /^#\/reports\/?$/, view: renderReports, nav: '#/reports', admin: true },
    { pattern: /^#\/imports\/?$/, view: renderImports, nav: '#/imports', admin: true },
    { pattern: /^#\/whatsapp\/?$/, view: renderWhatsApp, nav: '#/whatsapp', admin: true },
    { pattern: /^#\/inventory\/?$/, view: renderInventory, nav: '#/inventory', admin: true },
    { pattern: /^#\/settings\/?$/, view: renderSettings, nav: '#/settings', admin: true }
];

// admin: بند للمدير وحده. deny: دور محروم من الباب (مركز الاتصال لا صفقات له).
// في الحالتين يُخفى البند من القائمة ويُرفض المسار إن كُتب بالعنوان.
// external: رابط يغادر الصفحة (اللوحة القديمة) — لا يمر على موجّه الهاش ولا يُضاء أبداً.
const NAV = [
    { href: '../index.html', label: 'المشاريع والخريطة', external: true },
    { hash: '#/work', label: 'عملي اليوم' },
    { hash: '#/clients', label: 'العملاء' },
    { hash: '#/properties', label: 'العقارات' },
    { hash: '#/calendar', label: 'المواعيد' },
    // المساعد الذكي في القائمة لمن يضيف المشاريع (المدير والميداني — سياسة projects_insert)، وطلبات
    // الاعتماد للمدير وحده. أُعيدا بقرار المالك 2026-09-27 مع إرسال عروض واتساب إلى المساعد.
    { hash: '#/assistant', label: 'المساعد الذكي', deny: 'callcenter' },
    { hash: '#/deals', label: 'الصفقات', deny: 'callcenter' },
    { hash: '#/approvals', label: 'طلبات الاعتماد', admin: true },
    { hash: '#/whatsapp', label: 'عروض واتساب', admin: true },
    // more: صفحات المدير الأقل استعمالاً، في قائمة «المزيد» على الكمبيوتر بدل صف ثانٍ من البنود
    { hash: '#/dashboard', label: 'لوحة الإدارة', admin: true, more: true },
    { hash: '#/reports', label: 'التقارير', admin: true, more: true },
    { hash: '#/imports', label: 'استيراد المشاريع', admin: true, more: true },
    { hash: '#/inventory', label: 'جودة المخزون', admin: true, more: true },
    { hash: '#/settings', label: 'الإعدادات', admin: true, more: true }
];

// شريط الجوال السفلي: أهم أربع صفحات لكل دور، و«المزيد» يفتح القائمة كلها.
// الاسم المختصر يتسع تحت الأيقونة؛ الاسم الكامل في «المزيد» وفي شريط الكمبيوتر.
const TABS = {
    admin: ['#/work', '#/approvals', '#/whatsapp', '#/clients'],
    field: ['#/work', '#/clients', '#/properties', '#/assistant'],
    callcenter: ['#/work', '#/clients', '#/calendar', '#/properties']
};
const TAB_LABEL = {
    '#/work': 'اليوم', '#/approvals': 'الاعتماد', '#/whatsapp': 'واتساب', '#/clients': 'العملاء',
    '#/properties': 'العقارات', '#/assistant': 'المساعد', '#/calendar': 'المواعيد', '#/deals': 'الصفقات'
};

// أيقونات خطية بسيطة (مسارات SVG تُبنى بـ createElementNS، لا innerHTML)
const ICONS = {
    '#/work': ['M8 2v4M16 2v4M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 15l2 2 4-4'],
    '#/clients': ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
    '#/properties': ['M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16', 'M16 9h2a2 2 0 0 1 2 2v10', 'M2 21h20', 'M8 7h4M8 11h4M8 15h4'],
    '#/assistant': ['M12 3l1.8 4.6 4.7 1.9-4.7 1.9L12 16l-1.8-4.6-4.7-1.9 4.7-1.9z', 'M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
    '#/approvals': ['M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z', 'M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2', 'M9 14l2 2 4-4'],
    '#/whatsapp': ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', 'M9 10h.01M12 10h.01M15 10h.01'],
    '#/calendar': ['M8 2v4M16 2v4M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 13h3v3H8z'],
    more: ['M4 6h16M4 12h16M4 18h16']
};

/* ===================== الموجّه ===================== */

let routeToken = 0;
// الموجّه لا يعمل قبل اكتمال الهوية: تغيير الهاش وشاشة الدخول ظاهرة كان يبني
// الصفحة خلفها ويطلق استعلاماتها بلا جلسة صالحة.
let appReady = false;

async function route() {
    if (!appReady) return;
    const hash = location.hash || DEFAULT_ROUTE;
    const container = document.getElementById('view');

    for (const entry of ROUTES) {
        const match = hash.match(entry.pattern);
        if (!match) continue;

        const token = ++routeToken;
        closeModal();
        setActiveNav(entry.nav);
        clear(container);
        const root = el('div', { class: 'crm-view' });
        container.appendChild(root);

        // الحماية الفعلية في قاعدة البيانات؛ هذا منع مبكر حتى لا تُفتح صفحة فارغة
        if (entry.admin && !isAdmin()) {
            root.appendChild(el('div', { class: 'crm-error', text: 'هذه الصفحة للمدير فقط.' }));
            return;
        }
        if (entry.deny && myRole() === entry.deny) {
            root.appendChild(el('div', { class: 'crm-error', text: 'هذه الصفحة غير متاحة لدورك.' }));
            return;
        }

        try {
            await entry.view(root, ...match.slice(1));
        } catch (error) {
            if (token !== routeToken) return;
            clear(root);
            root.appendChild(el('div', { class: 'crm-error', text: 'تعذّر عرض الصفحة: ' + errorText(error) }));
            console.error('[CRM]', error);
        }
        return;
    }

    location.hash = DEFAULT_ROUTE;
}

function visibleNav() {
    return NAV.filter((item) => !(item.admin && !isAdmin()) && !(item.deny && myRole() === item.deny));
}

function navLink(item, attrs = {}) {
    if (item.external) return el('a', Object.assign({ href: item.href, class: 'nav-ext', text: item.label }, attrs));
    const link = el('a', Object.assign({ href: item.hash, dataset: { hash: item.hash } }, attrs), [
        el('span', { text: item.label }),
        item.hash === '#/approvals' ? countBadge() : null
    ]);
    return link;
}

function countBadge() {
    const badge = el('span', { class: 'nav-count', dataset: { count: 'approvals' }, hidden: true });
    if (approvalCount > 0) { badge.textContent = approvalCount > 99 ? '99+' : String(approvalCount); badge.hidden = false; }
    return badge;
}

function icon(key) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'tab-icon');
    for (const d of ICONS[key] || ICONS.more) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

function renderNav() {
    const nav = document.getElementById('crmNav');
    clear(nav);
    const items = visibleNav();
    const extra = [];
    for (const item of items) {
        if (item.more) extra.push(item);
        else nav.appendChild(navLink(item));
    }
    if (extra.length) {
        const more = el('details', { class: 'nav-more' }, [
            el('summary', { text: 'المزيد' }),
            el('div', { class: 'nav-more-menu' }, extra.map((item) => navLink(item)))
        ]);
        // القائمة تُغلق عند الضغط خارجها أو على أحد بنودها
        more.addEventListener('click', (event) => { if (event.target.closest('a')) more.open = false; });
        document.addEventListener('click', (event) => { if (more.open && !more.contains(event.target)) more.open = false; });
        nav.appendChild(more);
    }
    renderTabbar(items);
}

// الجوال: شريط سفلي ثابت بأهم أربع صفحات للدور، و«المزيد» يفتح كل الصفحات فوقه
function renderTabbar(items) {
    for (const old of document.querySelectorAll('.tabbar, .nav-sheet')) old.remove();
    const tabs = (TABS[myRole()] || TABS.field)
        .map((hash) => items.find((item) => item.hash === hash))
        .filter(Boolean);
    if (!tabs.length) return;

    const sheet = el('div', { class: 'nav-sheet', id: 'navSheet' }, el('nav', {
        class: 'nav-sheet-panel', 'aria-label': 'كل الصفحات'
    }, [
        // اسم الحساب ودوره: الترويسة تخفيه على أضيق الجوالات
        el('div', { class: 'nav-sheet-who', text: displayName(state.profile) + ' · ' + (ROLE_AR[myRole()] || myRole()) }),
        ...items.map((item) => navLink(item))
    ]));
    sheet.addEventListener('click', (event) => {
        if (event.target === sheet || event.target.closest('a')) toggleSheet(false);
    });

    const moreBtn = el('button', {
        type: 'button', class: 'tab-more', 'aria-expanded': 'false', 'aria-controls': 'navSheet',
        onclick: () => toggleSheet(!sheet.classList.contains('open'))
    }, [icon('more'), el('span', { text: 'المزيد' })]);

    const bar = el('nav', { class: 'tabbar', 'aria-label': 'التنقل السريع' }, [
        ...tabs.map((item) => el('a', { href: item.hash, dataset: { hash: item.hash } }, [
            icon(item.hash),
            el('span', { text: TAB_LABEL[item.hash] || item.label }),
            item.hash === '#/approvals' ? countBadge() : null
        ])),
        moreBtn
    ]);

    document.body.appendChild(sheet);
    document.body.appendChild(bar);
    document.body.classList.add('has-tabbar');
}

function toggleSheet(open) {
    const sheet = document.getElementById('navSheet');
    if (!sheet) return;
    sheet.classList.toggle('open', open);
    const button = document.querySelector('.tabbar .tab-more');
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setActiveNav(hash) {
    for (const link of document.querySelectorAll('#crmNav a, .tabbar a, .nav-sheet a')) {
        link.classList.toggle('active', link.dataset.hash === hash);
    }
    const more = document.querySelector('#crmNav .nav-more');
    if (more) {
        more.classList.toggle('active', Boolean(more.querySelector('a.active')));
        more.open = false;
    }
    // «المزيد» في شريط الجوال يُضاء حين تكون الصفحة الحالية خارج البنود الأربعة
    const moreTab = document.querySelector('.tabbar .tab-more');
    if (moreTab) moreTab.classList.toggle('active', !document.querySelector('.tabbar a.active'));
    toggleSheet(false);
    revealActiveNav();
    refreshApprovalCount(hash === '#/approvals').catch(() => {});
}

/* ===================== عدّاد طلبات الاعتماد ===================== */

// ما ينتظر المدير: مسودات المساعد «بانتظار الاعتماد» ومشاريع اللوحة المعلّقة. يُحدَّث مع كل تنقّل،
// ولا يُسأل الخادم أكثر من مرة كل 20 ثانية.
let approvalCount = 0;
let countAsked = 0;

async function refreshApprovalCount(force = false) {
    if (!isAdmin()) return;
    if (!force && Date.now() - countAsked < 20000) return;
    countAsked = Date.now();
    const [drafts, projects] = await Promise.all([
        supabase.from('agent_drafts').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    ]);
    if (drafts.error || projects.error) return;
    approvalCount = (drafts.count || 0) + (projects.count || 0);
    for (const badge of document.querySelectorAll('.nav-count[data-count="approvals"]')) {
        badge.textContent = approvalCount > 99 ? '99+' : String(approvalCount);
        badge.hidden = approvalCount === 0;
        badge.setAttribute('aria-label', approvalCount + ' بانتظار الاعتماد');
    }
}

/* ===================== الجداول على الجوال ===================== */

// على الجوال يصير كل صف بطاقة (css/theme.css)، وكل خانة تحمل اسم عمودها في data-label.
// تُوسم الجداول بعد كل رسم في #view، فلا تحتاج أي صفحة إلى تعديل.
function labelTables(scope) {
    for (const table of scope.querySelectorAll('table.crm-table')) {
        const headRow = table.tHead && table.tHead.rows[0];
        if (!headRow) continue;
        const heads = [];
        for (const th of headRow.cells) {
            for (let i = 0; i < (th.colSpan || 1); i++) heads.push(i === 0 ? th.textContent.trim() : '');
        }
        for (const body of table.tBodies) {
            for (const row of body.rows) {
                let col = 0;
                for (const cell of row.cells) {
                    const text = cell.colSpan > 1 ? '' : (heads[col] || '');
                    if (text) { if (cell.dataset.label !== text) cell.dataset.label = text; }
                    else if (cell.hasAttribute('data-label')) cell.removeAttribute('data-label');
                    col += cell.colSpan || 1;
                }
            }
        }
    }
}

function watchTables() {
    const view = document.getElementById('view');
    if (!view) return;
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; labelTables(view); });
    }).observe(view, { childList: true, subtree: true });
}

// على الجوال القائمة شريط يتمرر أفقياً، فكان بند الصفحة الحالية يقع خارج الشاشة.
// يُمرَّر الشريط وحده أفقياً — لا الصفحة — حتى يظهر البند النشط.
function revealActiveNav() {
    const nav = document.getElementById('crmNav');
    const link = nav && nav.querySelector('a.active');
    if (!link || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    if (item.left < box.left) nav.scrollBy({ left: item.left - box.left - 12 });
    else if (item.right > box.right) nav.scrollBy({ left: item.right - box.right + 12 });
}

/* ===================== الهيكل ===================== */

function hideBoot() {
    const boot = document.getElementById('bootScreen');
    if (boot) boot.classList.add('crm-hidden');
}

function showLogin(message) {
    appReady = false;
    hideBoot();
    document.getElementById('appScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.remove('crm-hidden');
    const box = document.getElementById('loginError');
    // .login-error مخفي أصلاً في css/style.css (display:none) واللوحة القديمة تُظهره بـ style.display،
    // فإزالة crm-hidden وحدها كانت تترك نموذج الدخول بلا سبب المنع أو الخطأ
    if (message) {
        box.textContent = message;
        box.classList.remove('crm-hidden');
        box.style.display = 'block';
    } else {
        box.textContent = '';
        box.classList.add('crm-hidden');
        box.style.display = '';
    }
}

function showApp() {
    hideBoot();
    document.getElementById('loginScreen').classList.add('crm-hidden');
    document.getElementById('appScreen').classList.add('active');

    const badge = document.getElementById('userBadge');
    clear(badge);
    append(badge, [
        displayName(state.profile),
        el('small', { text: ROLE_AR[state.profile.role] || state.profile.role })
    ]);

    renderNav();
    appReady = true;
    route();
}

function wireLogin() {
    const form = document.getElementById('loginForm');
    const button = document.getElementById('loginBtn');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) return;

        button.disabled = true;
        button.textContent = 'جارٍ الدخول…';
        try {
            const profile = await signIn(username, password);
            if (!profile) {
                await endSession();
                showLogin('لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع المدير.');
            } else if (profile.is_blocked) {
                await endSession();
                showLogin('هذا الحساب موقوف. راجع المدير.');
            } else {
                document.getElementById('password').value = '';
                showApp();
            }
        } catch (error) {
            showLogin('تعذّر تسجيل الدخول: ' + errorText(error));
        } finally {
            button.disabled = false;
            button.textContent = 'دخول';
        }
    });
}

function wireLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await signOut();
            location.reload();
        } catch (error) {
            fail(error, 'تعذّر تسجيل الخروج');
        }
    });
}

function wireTheme() {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const saved = localStorage.getItem('mulaem-theme');
    if (saved === 'dark') document.body.classList.add('crm-dark');
    updateThemeButton(button);
    button.addEventListener('click', () => {
        document.body.classList.toggle('crm-dark');
        localStorage.setItem('mulaem-theme', document.body.classList.contains('crm-dark') ? 'dark' : 'light');
        updateThemeButton(button);
    });
}

function updateThemeButton(button) {
    const dark = document.body.classList.contains('crm-dark');
    button.textContent = dark ? '☀' : '◐';
    button.setAttribute('aria-label', dark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي');
    button.title = dark ? 'الوضع النهاري' : 'الوضع الليلي';
}

/* ===================== الإقلاع ===================== */

// إنهاء جلسة نصف صالحة (بلا صف profiles، أو لحساب موقوف) قبل عرض سبب المنع.
// بدونه تبقى الجلسة في mulaem-auth فترثها اللوحة القديمة في /index.html.
let selfSignOut = false;

async function endSession() {
    selfSignOut = true;
    await signOut().catch(() => {});
}

// حذف mulaem-auth في تبويب آخر وهذا التبويب ما زال يقرأ الجلسة (appReady=false): يُتذكَّر، فيعيد boot
// التحميل بدل أن يعرض التطبيق لجلسة لم تعد محفوظة
let authDropped = false;

async function boot() {
    initModal();
    watchTables();
    wireTheme();
    wireLogin();
    wireLogout();
    window.addEventListener('hashchange', route);

    // خروج من تبويب آخر يشارك نفس التخزين (mulaem-auth). أما خروج بدأناه نحن
    // لعرض سبب المنع فلا يُعاد التحميل معه، وإلا ضاعت الرسالة قبل أن تُقرأ.
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && !selfSignOut) location.reload();
    });
    // خروج اللوحة القديمة: يحذف الشيم mulaem-auth بنفسه ولا يُبثّ SIGNED_OUT (dropSession في
    // js/supabase-shim.js). حدث storage يصل هذا التبويب أياً كان من حذف المفتاح، فلا تبقى بيانات العملاء ظاهرة
    window.addEventListener('storage', (event) => {
        if (event.key !== 'mulaem-auth' || event.newValue !== null) return;
        if (appReady) location.reload();
        else authDropped = true;
    });

    let profile;
    try {
        profile = await loadSession();
    } catch (error) {
        showLogin('تعذّر قراءة الجلسة: ' + errorText(error));
        return;
    }

    if (!state.session) return showLogin();
    if (!profile) {
        await endSession();
        return showLogin('لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع المدير.');
    }
    if (profile.is_blocked) {
        await endSession();
        return showLogin('هذا الحساب موقوف. راجع المدير.');
    }
    if (authDropped) return void location.reload();
    showApp();
}

boot().catch((error) => {
    notify('تعذّر بدء التطبيق: ' + errorText(error), 'error', 10000);
    console.error('[CRM]', error);
});
