// ‎#/users‎ — «المستخدمون» (للمدير وحده): حسابات الموظفين، نُقلت من لوحة الصفحة القديمة.
//
// القراءة من profiles (سياسة القراءة للمدير)، والكتابة كلها عبر وظيفة admin-users بمفتاح الخدمة: هي التي تتحقق
// أن المتصل مدير غير معطَّل، وتنشئ الحساب أو تغيّر كلمة المرور أو تعطّله أو تحذفه. الوظيفة تعرف الموظف برقمه
// (legacy_id)، ولا تسمح للمدير بتعطيل حسابه أو حذفه.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { myId, ROLE_AR } from './auth.js';
import {
    el, replace, loading, empty, errorBox, badge, pager, field, input, select,
    openModal, closeModal, notify, fail, fmtDate, dash, pageHead, actionBtn
} from './ui.js';

const MIN_PASSWORD = 8;
const ROLE_OPTIONS = [
    { value: 'field', label: ROLE_AR.field },
    { value: 'callcenter', label: ROLE_AR.callcenter },
    { value: 'admin', label: ROLE_AR.admin }
];

export async function renderUsers(root) {
    const view = { page: 0 };
    const body = el('div');

    replace(root, [
        pageHead('المستخدمون', 'حسابات الموظفين: إضافة، وكلمة المرور، والتعطيل. الدخول باسم المستخدم وكلمة المرور.', [
            actionBtn('مستخدم جديد', 'userPlus', { onclick: () => openCreateForm(load) }, true)
        ]),
        el('div', { class: 'crm-card' }, body)
    ]);

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('profiles')
            .select('id, legacy_id, username, fullname, role, is_blocked, created_at', { count: 'exact' })
            .order('is_blocked', { ascending: true })
            .order('fullname', { ascending: true })
            .range(from, to);
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل المستخدمين'));
        if (!data || !data.length) return void replace(body, empty('لا مستخدمين'));
        replace(body, [
            el('div', { class: 'crm-table-wrap' }, usersTable(data, load)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function usersTable(rows, reload) {
    const head = el('thead', {}, el('tr', {}, ['الاسم', 'اسم المستخدم', 'الدور', 'الحالة', 'أُضيف', ''].map((t) => el('th', { text: t }))));
    const body = el('tbody');
    for (const row of rows) {
        const self = row.id === myId();
        body.appendChild(el('tr', {}, [
            el('td', {}, [el('strong', { text: dash(row.fullname) }), self ? el('span', { class: 'crm-subtle', text: ' (أنت)' }) : null]),
            el('td', { dir: 'ltr', class: 'crm-subtle', text: row.username }),
            el('td', { text: ROLE_AR[row.role] || row.role }),
            el('td', {}, row.is_blocked ? badge('معطّل', 'red') : badge('نشط', 'green')),
            el('td', { class: 'crm-subtle', text: fmtDate(row.created_at) }),
            el('td', { class: 'cell-actions' }, el('div', { class: 'btn-row' }, [
                el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'كلمة المرور', onclick: () => openPasswordForm(row) }),
                self ? null : el('button', {
                    type: 'button', class: 'btn btn-outline btn-xs', text: row.is_blocked ? 'تفعيل' : 'تعطيل',
                    onclick: () => confirmBlock(row, reload)
                }),
                self ? null : el('button', {
                    type: 'button', class: 'btn btn-outline btn-xs', text: 'حذف', onclick: () => confirmDelete(row, reload)
                })
            ]))
        ]));
    }
    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

// نداء admin-users: الوظيفة ترد {status, message}؛ ورسالة الخطأ العربية في جسم الرد حتى مع رمز خطأ
async function callAdmin(payload) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });
    if (error) {
        let message = 'تعذّر تنفيذ العملية';
        try {
            const ctx = error.context;
            if (ctx && typeof ctx.json === 'function') {
                const j = await ctx.json();
                if (j && j.message) message = j.message;
            }
        } catch (_) { /* تبقى الرسالة العامة */ }
        throw new Error(message);
    }
    if (data && data.status === 'error') throw new Error(data.message || 'تعذّر تنفيذ العملية');
    return data;
}

// كلمة مرور مقترحة من 12 حرفاً ورقماً، بلا الحروف المتشابهة (0/O و1/l)
function suggestPassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function passwordField(box) {
    const suggest = el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'اقترح كلمة مرور', onclick: () => { box.type = 'text'; box.value = suggestPassword(); } });
    return field('كلمة المرور', el('div', { class: 'pw-row' }, [box, suggest]), {
        required: true, hint: 'ثماني خانات على الأقل. أعطها للموظف، ويغيّرها من «كلمة المرور» هنا متى أراد.'
    });
}

function openCreateForm(reload) {
    const fullname = input({ maxLength: 80, required: true, placeholder: 'مثال: خالد العتيبي' });
    const username = input({ maxLength: 40, required: true, dir: 'ltr', autocomplete: 'off', placeholder: 'khalid' });
    const role = select(ROLE_OPTIONS, 'field');
    const password = input({ type: 'password', minLength: MIN_PASSWORD, required: true, autocomplete: 'new-password', dir: 'ltr' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'إضافة المستخدم' });

    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('الاسم الكامل', fullname, { required: true }),
            field('اسم المستخدم', username, { required: true, hint: 'حروف إنجليزية وأرقام، للدخول.' }),
            field('الدور', role),
            passwordField(password)
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = username.value.trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(name)) return void notify('اسم المستخدم: حروف إنجليزية صغيرة وأرقام فقط (3 خانات على الأقل)', 'error', 7000);
        if (password.value.length < MIN_PASSWORD) return void notify('كلمة المرور ثماني خانات على الأقل', 'error');
        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الإضافة…';
        try {
            await callAdmin({ action: 'create', username: name, fullname: fullname.value.trim(), role: role.value, password: password.value });
            closeModal();
            notify('أُضيف ' + fullname.value.trim() + ' — اسم الدخول: ' + name, 'success', 8000);
            reload();
        } catch (error) {
            fail(error, 'تعذّر إضافة المستخدم');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'إضافة المستخدم';
        }
    });
    openModal('مستخدم جديد', form, { narrow: true });
}

function openPasswordForm(row) {
    const password = input({ type: 'password', minLength: MIN_PASSWORD, required: true, autocomplete: 'new-password', dir: 'ltr' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'تغيير كلمة المرور' });
    const form = el('form', {}, [
        el('p', { class: 'crm-subtle', style: 'margin-bottom:12px', text: 'لـ ' + (row.fullname || row.username) + ' (' + row.username + ')' }),
        el('div', { class: 'form-grid' }, [passwordField(password)]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (password.value.length < MIN_PASSWORD) return void notify('كلمة المرور ثماني خانات على الأقل', 'error');
        saveBtn.disabled = true;
        try {
            await callAdmin({ action: 'change_password', id: row.legacy_id, password: password.value });
            closeModal();
            notify('تغيّرت كلمة مرور ' + (row.fullname || row.username), 'success');
        } catch (error) {
            fail(error, 'تعذّر تغيير كلمة المرور');
        } finally {
            saveBtn.disabled = false;
        }
    });
    openModal('كلمة المرور', form, { narrow: true });
}

// تأكيد داخل نافذة (لا confirm من المتصفح): التعطيل يمنع الدخول فوراً، والتفعيل يعيده
function confirmBlock(row, reload) {
    const blocking = !row.is_blocked;
    const go = el('button', { type: 'button', class: 'btn btn-sm ' + (blocking ? 'btn-danger' : 'btn-primary'), text: blocking ? 'تعطيل الحساب' : 'تفعيل الحساب' });
    go.addEventListener('click', async () => {
        go.disabled = true;
        try {
            await callAdmin({ action: 'toggle_block', id: row.legacy_id, is_blocked: blocking });
            closeModal();
            notify((blocking ? 'عُطّل حساب ' : 'فُعّل حساب ') + (row.fullname || row.username), 'success');
            reload();
        } catch (error) {
            go.disabled = false;
            fail(error, 'تعذّر تحديث الحساب');
        }
    });
    openModal(blocking ? 'تعطيل الحساب' : 'تفعيل الحساب', [
        el('p', { text: blocking
            ? (row.fullname || row.username) + ' لن يستطيع الدخول من الآن، ويخرج من جلسته المفتوحة. بياناته وعملاؤه تبقى كما هي.'
            : (row.fullname || row.username) + ' يستطيع الدخول من جديد بكلمة مروره.' }),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }), go
        ])
    ], { narrow: true });
}

// الحذف نهائي: يُطلب كتابة اسم المستخدم للتأكيد، ويُقترح التعطيل بديلاً
function confirmDelete(row, reload) {
    const typed = input({ dir: 'ltr', autocomplete: 'off', placeholder: row.username });
    const go = el('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'حذف نهائي' });
    go.addEventListener('click', async () => {
        if (typed.value.trim().toLowerCase() !== row.username) return void notify('اكتب اسم المستخدم كما هو للتأكيد', 'error');
        go.disabled = true;
        try {
            await callAdmin({ action: 'delete', id: row.legacy_id });
            closeModal();
            notify('حُذف حساب ' + (row.fullname || row.username), 'success');
            reload();
        } catch (error) {
            go.disabled = false;
            fail(error, 'تعذّر حذف الحساب');
        }
    });
    openModal('حذف الحساب', [
        el('p', { text: 'حذف ' + (row.fullname || row.username) + ' نهائي ولا يُسترجع. إن كان سيعود يوماً فالأفضل «تعطيل».' }),
        field('اكتب اسم المستخدم للتأكيد (' + row.username + ')', typed),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }), go
        ])
    ], { narrow: true });
}
