// الهوية: الجلسة من supabase.auth + صف profiles الخاص بالمتصل، لا شيء غير ذلك.
//
// فحوص الدور في الواجهة تجميلية فقط (إظهار/إخفاء حقل). الحماية الفعلية كلها في
// قاعدة البيانات: سياسات RLS ومشغّلات الحراسة التي تفرض المالك والمنشئ والفاعل.

import { supabase, config } from './supabase.js';

export const state = {
    session: null,
    profile: null
};

export const ROLE_AR = {
    admin: 'مدير',
    callcenter: 'مركز اتصال',
    field: 'وسيط'
};

// نفس تحويل اسم المستخدم إلى بريد المستخدم في اللوحة القديمة وفي دالة admin-users
export function toEmail(username) {
    const u = String(username || '').trim();
    return u.includes('@') ? u : u + '@' + (config.AUTH_EMAIL_DOMAIN || 'users.mulaem.sa');
}

// يقرأ الجلسة ثم ملف المستخدم. يرمي الخطأ كما هو ليُعرض للمستخدم.
export async function loadSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    state.session = data.session || null;
    state.profile = null;
    if (!state.session) return null;

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, legacy_id, username, fullname, role, is_blocked')
        .eq('id', state.session.user.id)
        .maybeSingle();
    if (profileError) throw profileError;

    state.profile = profile || null;
    return state.profile;
}

export async function signIn(username, password) {
    const { error } = await supabase.auth.signInWithPassword({
        email: toEmail(username),
        password: password
    });
    if (error) throw error;
    return loadSession();
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    state.session = null;
    state.profile = null;
}

export function myId() {
    return state.profile ? state.profile.id : null;
}

export function myRole() {
    return state.profile ? state.profile.role : null;
}

export function isAdmin() {
    return myRole() === 'admin';
}

// من يجوز له إسناد عميل إلى وسيط: المدير ومركز الاتصال (والخادم يرفض ما عدا ذلك)
export function canAssign() {
    const role = myRole();
    return role === 'admin' || role === 'callcenter';
}

export function displayName(profile) {
    if (!profile) return '';
    return profile.fullname || profile.username || '';
}
