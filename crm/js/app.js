// نقطة الدخول: التحقق من الجلسة، هيكل الصفحة، وموجّه المسارات (hash router).

import { supabase } from './supabase.js';
import { state, loadSession, signIn, signOut, ROLE_AR, displayName } from './auth.js';
import { el, clear, append, notify, fail, errorText, initModal, closeModal } from './ui.js';
import { renderClients } from './clients.js';
import { renderClient } from './client.js';
import { renderRequirementMatches } from './matching.js';

/* ===================== المسارات ===================== */

const DEFAULT_ROUTE = '#/clients';

const ROUTES = [
    { pattern: /^#\/clients\/([^/]+)\/requirements\/([^/]+)$/, view: renderRequirementMatches, nav: '#/clients' },
    { pattern: /^#\/clients\/([^/]+)$/, view: renderClient, nav: '#/clients' },
    { pattern: /^#\/clients\/?$/, view: renderClients, nav: '#/clients' }
];

const NAV = [
    { hash: '#/clients', label: 'العملاء' }
];

/* ===================== الموجّه ===================== */

let routeToken = 0;

async function route() {
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

function renderNav() {
    const nav = document.getElementById('crmNav');
    clear(nav);
    for (const item of NAV) {
        nav.appendChild(el('a', { href: item.hash, text: item.label, dataset: { hash: item.hash } }));
    }
}

function setActiveNav(hash) {
    for (const link of document.querySelectorAll('#crmNav a')) {
        link.classList.toggle('active', link.dataset.hash === hash);
    }
}

/* ===================== الهيكل ===================== */

function hideBoot() {
    const boot = document.getElementById('bootScreen');
    if (boot) boot.classList.add('crm-hidden');
}

function showLogin(message) {
    hideBoot();
    document.getElementById('appScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.remove('crm-hidden');
    const box = document.getElementById('loginError');
    if (message) {
        box.textContent = message;
        box.classList.remove('crm-hidden');
    } else {
        box.textContent = '';
        box.classList.add('crm-hidden');
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
                showLogin('لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع المدير.');
            } else if (profile.is_blocked) {
                await signOut();
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

/* ===================== الإقلاع ===================== */

async function boot() {
    initModal();
    wireLogin();
    wireLogout();
    window.addEventListener('hashchange', route);

    // خروج من تبويب آخر يشارك نفس التخزين (mulaem-auth)
    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') location.reload();
    });

    let profile;
    try {
        profile = await loadSession();
    } catch (error) {
        showLogin('تعذّر قراءة الجلسة: ' + errorText(error));
        return;
    }

    if (!state.session) return showLogin();
    if (!profile) return showLogin('لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع المدير.');
    if (profile.is_blocked) {
        await signOut().catch(() => {});
        return showLogin('هذا الحساب موقوف. راجع المدير.');
    }
    showApp();
}

boot().catch((error) => {
    notify('تعذّر بدء التطبيق: ' + errorText(error), 'error', 10000);
    console.error('[CRM]', error);
});
