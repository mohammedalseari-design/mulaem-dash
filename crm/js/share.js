import { el, replace, empty, errorBox, money, number, dash, fmtDate } from './ui.js';

const client = window.supabase.createClient(window.MULAEM_CONFIG.SUPABASE_URL, window.MULAEM_CONFIG.SUPABASE_KEY);
const root = document.getElementById('sharePage');
const token = new URLSearchParams(location.search).get('token');

if (!token) {
    replace(root, errorBox(new Error('الرابط ناقص'), 'رابط العرض غير صالح'));
} else {
    load();
}

async function load() {
    const { data, error } = await client.rpc('get_client_share', { p_token: token });
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل العرض'));
    if (!data) return void replace(root, errorBox(new Error('الرابط منتهي أو ملغى'), 'العرض غير متاح'));

    const properties = Array.isArray(data.properties) ? data.properties : [];
    replace(root, [
        el('section', { class: 'share-hero' }, [
            el('img', { src: '../images/logo.jpg', alt: 'شعار ملائم', class: 'share-logo' }),
            el('h1', { text: 'العروض العقارية المقترحة' }),
            el('p', { text: data.client_name ? 'مرحبًا ' + data.client_name : 'عروض مختارة من ملائم العقارية' }),
            el('div', { class: 'crm-subtle', text: 'صالح حتى ' + fmtDate(data.expires_at) })
        ]),
        properties.length ? el('section', { class: 'share-grid' }, properties.map(propertyCard)) : empty('لا توجد عروض متاحة حاليًا')
    ]);
}

function propertyCard(property) {
    const facts = [];
    if (property.unit_type) facts.push(property.unit_type);
    if (property.rooms !== null && property.rooms !== undefined) facts.push(number(property.rooms) + ' غرف');
    if (property.area !== null && property.area !== undefined) facts.push(number(property.area) + ' م²');
    return el('article', { class: 'share-property' }, [
        el('h2', { text: dash(property.project_name) }),
        el('p', { class: 'share-location', text: [property.district, property.unit_key].filter(Boolean).join(' · ') || 'تفاصيل العقار' }),
        el('p', { class: 'share-facts', text: facts.join(' · ') }),
        el('strong', { class: 'share-price', text: property.price === null || property.price === undefined ? 'السعر عند التواصل' : money(property.price) + ' ريال' }),
        el('button', {
            type: 'button', class: 'btn btn-primary btn-sm', text: 'نسخ تفاصيل العقار',
            onclick: (event) => copyProperty(event.currentTarget, property)
        })
    ]);
}

async function copyProperty(button, property) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return void window.alert('النسخ غير متاح في هذا المتصفح');
    }
    const facts = [property.unit_type, property.rooms ? number(property.rooms) + ' غرف' : null,
        property.area ? number(property.area) + ' م²' : null].filter(Boolean);
    const lines = [property.project_name, property.unit_key, property.district,
        facts.join(' · '), property.price === null || property.price === undefined ? 'السعر عند التواصل' : money(property.price) + ' ريال'];
    button.disabled = true;
    try {
        await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
        button.textContent = 'تم النسخ';
    } catch (error) {
        window.alert('تعذّر نسخ التفاصيل');
    } finally {
        setTimeout(() => { if (button.isConnected) { button.disabled = false; button.textContent = 'نسخ تفاصيل العقار'; } }, 1800);
    }
}
