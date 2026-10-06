// ‎#/clients/:id‎ — ملف العميل: بطاقة بياناته وثلاثة ألسنة (الطلبات، المتابعات، السجل).

import { supabase } from './supabase.js';
import { myRole } from './auth.js';
import { staffMap, staffName } from './data.js';
import { CLIENT_STATUS, CLIENT_STATUS_TONE, CLIENT_TYPE, label } from './labels.js';
import { el, append, clear, replace, loading, errorBox, badge, fmtDateTime, dash, fail, waNumber, actionBtn } from './ui.js';
import { openClientForm } from './client-form.js';
import { renderRequirements } from './requirements.js';
import { renderFollowUps } from './followups.js';
import { renderTimeline } from './timeline.js';
import { renderDeals } from './deals.js';

// deny: دور لا يُبنى له اللسان. مركز الاتصال لا يرى الصفقات، والقاعدة ترفضها له
// أصلاً (سياسات deals في 007_deals_commissions.sql).
const TABS = [
    { key: 'requirements', label: 'الطلبات', render: renderRequirements },
    { key: 'followups', label: 'المتابعات', render: renderFollowUps },
    { key: 'deals', label: 'الصفقات', render: renderDeals, deny: 'callcenter' },
    { key: 'timeline', label: 'السجل', render: renderTimeline }
];

// آخر تبويب لكل عميل ما دامت الصفحة مفتوحة: الرجوع من مطابقة أو صفقة يعيدك إلى التبويب نفسه
const lastTab = new Map();

function visibleTabs() {
    return TABS.filter((tab) => !tab.deny || tab.deny !== myRole());
}

export async function renderClient(root, clientId) {
    replace(root, loading());

    const [{ data: client, error }, names] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
        // فشل دليل الموظفين لا يمنع عرض الملف، لكنه يُعلن مرة واحدة بدل أن تظهر
        // الأسماء كلها "مستخدم غير معروف" بلا سبب ظاهر
        staffMap().catch((staffError) => {
            fail(staffError, 'تعذّر تحميل أسماء الموظفين');
            return new Map();
        })
    ]);
    if (!root.isConnected) return;

    clear(root);
    if (error) return void root.appendChild(errorBox(error, 'تعذّر تحميل بيانات العميل'));
    if (!client) {
        root.appendChild(el('div', { class: 'crm-error', text: 'العميل غير موجود أو لا تملك صلاحية الاطلاع عليه.' }));
        root.appendChild(el('div', { class: 'btn-row', style: 'margin-top:14px' },
            el('a', { class: 'btn btn-outline btn-sm', href: '#/clients', text: 'رجوع إلى العملاء' })));
        return;
    }

    // الترويسة: اسم العميل عنواناً للصفحة وأزرار التواصل بجانبه، ثم بطاقة بياناته (renderHeader)
    const header = el('div', { class: 'client-top' });
    const tabsBar = el('div', { class: 'admin-tabs crm-tabs' });
    const tabBody = el('div');
    append(root, [header, tabsBar, tabBody]);

    const context = { client: client, names: names, reload: () => renderClient(root, clientId) };
    renderHeader(header, context);

    const tabs = visibleTabs();
    let active = tabs.some((t) => t.key === lastTab.get(clientId)) ? lastTab.get(clientId) : tabs[0].key;
    for (const tab of tabs) {
        tabsBar.appendChild(el('button', {
            type: 'button', class: 'admin-tab', text: tab.label,
            dataset: { tab: tab.key },
            onclick: () => selectTab(tab.key)
        }));
    }

    function selectTab(key) {
        active = key;
        lastTab.set(clientId, key);
        for (const button of tabsBar.querySelectorAll('.admin-tab')) {
            button.classList.toggle('active', button.dataset.tab === key);
        }
        clear(tabBody);
        const panel = el('div');
        tabBody.appendChild(panel);
        const tab = tabs.find((t) => t.key === key);
        Promise.resolve(tab.render(panel, context)).catch((err) => {
            if (panel.isConnected) replace(panel, errorBox(err, 'تعذّر تحميل المحتوى'));
        });
    }

    selectTab(active);
}

function renderHeader(host, context) {
    const client = context.client;

    const kv = (title, value) => el('div', { class: 'kv' }, [
        el('span', { text: title }),
        el('span', {}, value instanceof Node ? value : document.createTextNode(dash(value)))
    ]);

    const phone = client.phone || null;

    replace(host, [
        el('header', { class: 'w4-head pg-head' }, [
            el('div', { class: 'w4-title' }, [
                el('h1', { text: client.full_name }),
                el('div', { class: 'pg-badges' }, [
                    badge(label(CLIENT_STATUS, client.status), CLIENT_STATUS_TONE[client.status] || 'neutral'),
                    badge(label(CLIENT_TYPE, client.client_type), 'neutral'),
                    client.city ? el('span', { class: 'w4-sub', text: client.city }) : null
                ])
            ]),
            el('div', { class: 'w4-quick' }, [
                phone ? actionBtn('اتصال', 'phone', { href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), title: 'اتصال: ' + phone }) : null,
                phone ? actionBtn('واتساب', 'chat', { href: 'https://wa.me/' + waNumber(phone), target: '_blank', rel: 'noopener', title: 'واتساب: ' + phone }) : null,
                actionBtn('تعديل البيانات', null, { onclick: () => openClientForm(client, () => context.reload()) }, true),
                actionBtn('رجوع', null, { href: '#/clients' })
            ])
        ]),
        el('div', { class: 'crm-card client-info' }, [
        el('div', { class: 'kv-grid' }, [
            kv('الجوال', phone ? el('span', { class: 'phone-num', text: phone }) : dash(null)),
            kv('جوال إضافي', client.phone_alt),
            kv('البريد الإلكتروني', client.email),
            kv('المدينة', client.city),
            kv('المصدر', client.source),
            kv('الوسيط المسؤول', staffName(context.names, client.owner_id)),
            kv('أُضيف بواسطة', staffName(context.names, client.created_by)),
            kv('تاريخ الإضافة', fmtDateTime(client.created_at)),
            kv('آخر تحديث', fmtDateTime(client.updated_at))
        ]),
        client.notes
            ? el('div', { class: 'kv', style: 'margin-top:16px' }, [
                el('span', { text: 'ملاحظات' }),
                el('span', { class: 'tl-body', text: client.notes })
            ])
            : null
        ])
    ]);
}
