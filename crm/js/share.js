// روابط «عروض العميل» القديمة (crm/share.html?token=): كانت تفتح كل عروض طلبه في صفحة واحدة، فأوقفها المالك (2026-11-04).
// المشاركة صارت عرضاً واحداً (crm/p.html، share-project.js)، ولا شيء في النظام يصنع هذا الرابط الآن. من يفتح رابطاً قديماً
// يرى أنه انتهى، ولا تُعرض له العروض ولا اسمه. get_client_share تُقرأ لرقم واتساب المكتب وحده، ورابط منتهٍ لا تعيد له شيئاً.

import { el, replace, waNumber } from './ui.js';

const CONTACT_TEXT = 'مرحباً، فتحت رابط عروض من ملائم العقارية وانتهى، وأرغب بعرض جديد.';

const root = document.getElementById('sharePage');
const token = new URLSearchParams(location.search).get('token');

load();

async function load() {
    let office = '';
    if (token) {
        try {
            const client = window.supabase.createClient(window.MULAEM_CONFIG.SUPABASE_URL, window.MULAEM_CONFIG.SUPABASE_KEY);
            const { data } = await client.rpc('get_client_share', { p_token: token });
            office = data && data.office_whatsapp ? waNumber(data.office_whatsapp) : '';
        } catch (error) {
            console.warn('[share] office number', error);
        }
    }
    replace(root, el('section', { class: 'share-hero' }, [
        el('img', { src: '../images/logo.jpg', alt: 'شعار ملائم', class: 'share-logo' }),
        el('h1', { text: 'هذا الرابط انتهى' }),
        el('p', { text: 'اطلب من مستشارك العقاري عرضاً جديداً، أو تواصل مع ملائم العقارية.' }),
        office ? el('a', {
            class: 'btn btn-success', target: '_blank', rel: 'noopener', text: 'تواصل عبر واتساب',
            href: 'https://wa.me/' + office + '?text=' + encodeURIComponent(CONTACT_TEXT)
        }) : null
    ]));
}
