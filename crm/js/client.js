// ‎#/clients/:id‎ — ملف العميل: بطاقة بياناته وثلاثة ألسنة (الطلبات، المتابعات، السجل).

import { supabase } from './supabase.js';
import { staffMap, staffName } from './data.js';
import { CLIENT_STATUS, CLIENT_STATUS_TONE, CLIENT_TYPE, label } from './labels.js';
import { el, append, clear, replace, loading, errorBox, badge, fmtDateTime, dash } from './ui.js';
import { openClientForm } from './client-form.js';
import { renderRequirements } from './requirements.js';
import { renderFollowUps } from './followups.js';
import { renderTimeline } from './timeline.js';

const TABS = [
    { key: 'requirements', label: 'الطلبات', render: renderRequirements },
    { key: 'followups', label: 'المتابعات', render: renderFollowUps },
    { key: 'timeline', label: 'السجل', render: renderTimeline }
];

export async function renderClient(root, clientId) {
    replace(root, loading());

    const [{ data: client, error }, names] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
        staffMap().catch(() => new Map())
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

    const header = el('div', { class: 'crm-card' });
    const tabsBar = el('div', { class: 'admin-tabs crm-tabs' });
    const tabBody = el('div');
    append(root, [header, tabsBar, tabBody]);

    const context = { client: client, names: names, reload: () => renderClient(root, clientId) };
    renderHeader(header, context);

    let active = TABS[0].key;
    for (const tab of TABS) {
        tabsBar.appendChild(el('button', {
            type: 'button', class: 'admin-tab', text: tab.label,
            dataset: { tab: tab.key },
            onclick: () => selectTab(tab.key)
        }));
    }

    function selectTab(key) {
        active = key;
        for (const button of tabsBar.querySelectorAll('.admin-tab')) {
            button.classList.toggle('active', button.dataset.tab === key);
        }
        clear(tabBody);
        const panel = el('div');
        tabBody.appendChild(panel);
        const tab = TABS.find((t) => t.key === key);
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

    const phoneLink = client.phone
        ? el('a', { href: 'tel:' + client.phone, text: client.phone, dir: 'ltr' })
        : null;

    replace(host, [
        el('div', { class: 'client-head' }, [
            el('div', {}, [
                el('h2', { text: client.full_name }),
                el('div', { class: 'btn-row' }, [
                    badge(label(CLIENT_STATUS, client.status), CLIENT_STATUS_TONE[client.status] || 'neutral'),
                    badge(label(CLIENT_TYPE, client.client_type), 'neutral')
                ])
            ]),
            el('div', { class: 'btn-row' }, [
                el('a', { class: 'btn btn-outline btn-sm', href: '#/clients', text: 'رجوع' }),
                el('button', {
                    type: 'button', class: 'btn btn-secondary btn-sm', text: 'تعديل البيانات',
                    onclick: () => openClientForm(client, () => context.reload())
                })
            ])
        ]),
        el('div', { class: 'kv-grid' }, [
            kv('الجوال', phoneLink || dash(null)),
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
    ]);
}
