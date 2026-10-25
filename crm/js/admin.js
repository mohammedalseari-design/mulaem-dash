// ‎#/admin‎ — «الإدارة»: كل أدوات المدير في صفحة واحدة بدل تسعة بنود في القائمة (التصميم الخامس «أسهل»، 2026-10-22).
// الصفحات نفسها لم تتغير ومساراتها كما هي؛ هذه الصفحة بوابتها فقط، وكل بطاقة تقول بكلمة ما تفعله الصفحة.

import { el, icon, pageHead } from './ui.js';

// الترتيب: ما يحتاجه المدير كل يوم أولاً (الاعتماد وعروض واتساب)، ثم المتابعة، ثم الإعداد.
const TOOLS = [
    { hash: '#/approvals', label: 'طلبات الاعتماد', icon: 'clipboard', count: 'approvals',
        desc: 'مسودات العروض من الموظفين والمساعد: اعتمد أو أعد أو ارفض.' },
    { hash: '#/whatsapp', label: 'عروض واتساب', icon: 'chat',
        desc: 'ارفع ملف تصدير محادثة واتساب، فيفرز العروض ويرسل المختار إلى المساعد.' },
    { hash: '#/studio', label: 'استوديو البروشورات', icon: 'file',
        desc: 'ارفع بروشور المطوّر فيقرؤه المساعد، أو اختر مشروعاً من المخزون: بروشور بهوية ملائم جاهز لـPDF.' },
    { hash: '#/dashboard', label: 'لوحة الإدارة', icon: 'grid',
        desc: 'أرقام الفريق اليوم وحالة النظام والنسخ الاحتياطي.' },
    { hash: '#/reports', label: 'التقارير', icon: 'chart',
        desc: 'المبيعات والعمولات والمتابعات حسب الموظف والفترة.' },
    { hash: '#/imports', label: 'استيراد المشاريع', icon: 'upload',
        desc: 'إضافة مشاريع كثيرة دفعة واحدة من ملف.' },
    { hash: '#/inventory', label: 'جودة المخزون', icon: 'layers',
        desc: 'عقارات ناقصة البيانات أو مكررة أو بسعر غريب، لتصحيحها.' },
    { hash: '#/users', label: 'المستخدمون', icon: 'userPlus',
        desc: 'الموظفون وأدوارهم وكلمات المرور والتعطيل.' },
    { hash: '#/activity', label: 'سجل النشاطات', icon: 'clock',
        desc: 'من فعل ماذا ومتى.' },
    { hash: '#/settings', label: 'الإعدادات', icon: 'settings',
        desc: 'رقم واتساب المكتب، وحدود المساعد اليومية، والعمولة الافتراضية.' }
];

export async function renderAdmin(root) {
    root.appendChild(pageHead('الإدارة', 'كل أدوات المدير هنا. الموظفون لا يرون هذه الصفحة.'));
    root.appendChild(el('div', { class: 'hub' }, TOOLS.map((tool) => el('a', { class: 'hub-card', href: tool.hash }, [
        el('span', { class: 'hub-ico' }, icon(tool.icon)),
        el('span', { class: 'hub-text' }, [
            el('strong', {}, [
                el('span', { text: tool.label }),
                // عدّاد ما ينتظر الاعتماد: يحدّثه app.js مع بقية الشارات (data-count)
                tool.count ? el('span', { class: 'nav-count', dataset: { count: tool.count }, hidden: true }) : null
            ]),
            el('span', { class: 'hub-desc', text: tool.desc })
        ]),
        icon('arrow', 'hub-arrow')
    ]))));
}
