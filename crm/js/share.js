import { el, replace, empty, errorBox, money, number, dash, fmtDate, waNumber } from './ui.js';

// الحقول image و latitude/longitude و broker_name و office_whatsapp تعيدها get_client_share منذ 029؛
// قبلها تغيب، فتُعرض البطاقة كما كانت بلا صورة ولا خريطة ولا زر «أنا مهتم».

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
    const office = data.office_whatsapp ? waNumber(data.office_whatsapp) : '';
    replace(root, [
        el('section', { class: 'share-hero' }, [
            el('img', { src: '../images/logo.jpg', alt: 'شعار ملائم', class: 'share-logo' }),
            el('h1', { text: 'العروض العقارية المقترحة' }),
            el('p', { text: data.client_name ? 'مرحبًا ' + data.client_name : 'عروض مختارة من ملائم العقارية' }),
            data.broker_name ? el('p', { class: 'share-broker', text: 'يخدمك: ' + data.broker_name + ' — ملائم العقارية' }) : null,
            el('div', { class: 'crm-subtle', text: 'صالح حتى ' + fmtDate(data.expires_at) })
        ]),
        properties.length
            ? el('section', { class: 'share-grid' }, properties.map((property) => propertyCard(property, data.client_name, office)))
            : empty('لا توجد عروض متاحة حاليًا')
    ]);
}

function propertyCard(property, clientName, office) {
    const facts = [];
    if (property.unit_type) facts.push(property.unit_type);
    if (property.rooms !== null && property.rooms !== undefined) facts.push(number(property.rooms) + ' غرف');
    if (property.area !== null && property.area !== undefined) facts.push(number(property.area) + ' م²');
    const photo = photoOf(property);
    const map = mapLink(property);
    return el('article', { class: 'share-property' }, [
        photo,
        el('h2', { text: dash(property.project_name) }),
        el('p', { class: 'share-location', text: [property.district, property.unit_key].filter(Boolean).join(' · ') || 'تفاصيل العقار' }),
        el('p', { class: 'share-facts', text: facts.join(' · ') }),
        el('strong', { class: 'share-price', text: priceText(property) }),
        el('div', { class: 'share-actions' }, [
            office ? el('a', {
                class: 'btn btn-success btn-sm', target: '_blank', rel: 'noopener',
                href: 'https://wa.me/' + office + '?text=' + encodeURIComponent(interestText(property, clientName)),
                text: 'أنا مهتم — واتساب'
            }) : null,
            map ? el('a', { class: 'btn btn-outline btn-sm', href: map, target: '_blank', rel: 'noopener', text: 'الموقع على الخريطة' }) : null,
            el('button', {
                type: 'button', class: 'btn ' + (office ? 'btn-outline' : 'btn-primary') + ' btn-sm', text: 'نسخ تفاصيل العقار',
                onclick: (event) => copyProperty(event.currentTarget, property)
            })
        ])
    ]);
}

function priceText(property) {
    return property.price === null || property.price === undefined ? 'السعر عند التواصل' : money(property.price) + ' ريال';
}

// الصورة من القاعدة لا تُقبل إلا https:// (الشرط نفسه في الهجرة)؛ إن تعذّر تحميلها تُزال ولا يبقى إطار فارغ
function photoOf(property) {
    const src = typeof property.image === 'string' && property.image.slice(0, 8).toLowerCase() === 'https://' ? property.image : '';
    if (!src) return null;
    const img = el('img', { class: 'share-photo', src: src, alt: dash(property.project_name), loading: 'lazy', referrerPolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    return img;
}

function mapLink(property) {
    const lat = Number(property.latitude);
    const lng = Number(property.longitude);
    if (property.latitude === null || property.latitude === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return '';
    return 'https://www.google.com/maps?q=' + lat + ',' + lng;
}

function interestText(property, clientName) {
    const unit = [property.project_name, property.unit_key, property.district].filter(Boolean).join(' — ');
    return 'مرحباً، ' + (clientName ? 'أنا ' + clientName + '. ' : '') + 'أنا مهتم بهذا العرض: ' + unit + ' (' + priceText(property) + ').';
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
