// ‎#/help‎ — «كيف أبدأ؟»: دليل من خمس خطوات بكلمات بسيطة، لموظف جديد يفتح النظام أول مرة بلا تدريب
// (التصميم الخامس «أسهل»، 2026-10-22). كل خطوة فيها زر يفتح الصفحة المقصودة.

import { el, icon, pageHead } from './ui.js';
import { isAdmin, myRole } from './auth.js';

const STEPS = [
    { icon: 'today', title: 'ابدأ يومك من «عملي اليوم»',
        text: 'فيه المتابعات المتأخرة ومواعيد اليوم. بجانب كل عميل: اتصال، واتساب، و«تم» حين تنتهي.',
        go: '#/work', btn: 'افتح عملي اليوم' },
    { icon: 'users', title: 'عميل جديد أو بحث عن عميل',
        text: 'من «العملاء» اضغط «عميل جديد» واكتب الاسم والجوال. في ملف العميل أضف «طلب جديد» (ماذا يريد وبأي ميزانية)، فيعرض لك النظام العقارات المطابقة.',
        go: '#/clients', btn: 'افتح العملاء' },
    { icon: 'building', title: 'ابحث عن عقار',
        text: 'في «العقارات» ابحث بالاسم أو رشّح بالحي والسعر. من كل عقار: «فتح صفقة» أو «نسخ الوصف» لترسله للعميل. الخريطة من زر «المشاريع والخريطة».',
        go: '#/properties', btn: 'افتح العقارات' },
    { icon: 'sparkle', title: 'أضف عرضاً جديداً',
        text: 'عندك عرض من مطوّر أو رسالة واتساب أو رابط؟ الصقه في «إضافة عرض» ويكتب المساعد بيانات العقار، ثم يعتمده المدير ويظهر في العقارات.',
        go: '#/assistant', btn: 'أضف عرضاً', deny: 'callcenter' },
    { icon: 'briefcase', title: 'تابع صفقاتك',
        text: 'حين يهتم العميل افتح صفقة من العقار. في «الصفقات» تنقلها بين المراحل حتى «تمت»، وتُحسب العمولة تلقائياً.',
        go: '#/deals', btn: 'افتح الصفقات', deny: 'callcenter' }
];

export async function renderHelp(root) {
    root.appendChild(pageHead('كيف أبدأ؟', 'خمس خطوات تكفي ليوم العمل. كل خطوة لها زر يأخذك إلى مكانها.'));
    const steps = STEPS.filter((s) => !(s.deny && myRole() === s.deny));
    root.appendChild(el('ol', { class: 'help-steps' }, steps.map((step, i) => el('li', { class: 'help-step' }, [
        el('span', { class: 'help-num', text: String(i + 1) }),
        el('div', { class: 'help-body' }, [
            el('h2', {}, [icon(step.icon), el('span', { text: step.title })]),
            el('p', { text: step.text }),
            el('a', { class: 'btn btn-outline btn-sm', href: step.go, text: step.btn })
        ])
    ]))));
    if (isAdmin()) {
        root.appendChild(el('div', { class: 'crm-card help-admin' }, [
            el('h2', { text: 'للمدير' }),
            el('p', { text: 'كل أدواتك في صفحة «الإدارة»: طلبات الاعتماد، عروض واتساب، التقارير، المستخدمون، الإعدادات… وكل بطاقة تشرح نفسها.' }),
            el('a', { class: 'btn btn-outline btn-sm', href: '#/admin', text: 'افتح الإدارة' })
        ]));
    }
}
