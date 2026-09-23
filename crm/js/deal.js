// ‎#/deals/:id‎ — صفحة الصفقة: بياناتها، مسار المراحل، سجل الانتقالات.
//
// كل انتقال مرحلة هو ‎update‎ واحد على ‎deals.stage_id‎؛ ما عداه يفعله الخادم:
// ‎closed_at‎ عند المراحل النهائية، مسح سبب الخسارة عند الخروج من "خسرت"، كتابة
// ‎deal_stage_history‎ والأحداث، وإنشاء صف العمولة عند الإتمام بقيمة معلومة
// (مشغّلات 007_deals_commissions.sql).
//
// "خسرت" بلا سبب يرفضه قيد ‎deals_lost_reason_required‎ برمز 23514، فالنموذج
// يطلب السبب قبل الإرسال بدل أن نُري المستخدم خطأ قاعدة بيانات.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, dealStages, lostReasons } from './data.js';
import { DEAL_STAGE_TONE } from './labels.js';
import {
    el, append, clear, replace, loading, empty, errorBox, badge, pager, field,
    select, moneyInput, parseNumber, openModal, closeModal,
    money, fmtDate, fmtDateTime, dash, notify, fail
} from './ui.js';
import { renderCommission } from './commission.js';

export async function renderDeal(root, dealId) {
    replace(root, loading());

    const [dealResult, stages, names] = await Promise.all([
        supabase
            .from('deals')
            .select('*, client:clients(id, full_name, phone), project:projects(id, name, district)')
            .eq('id', dealId)
            .maybeSingle(),
        dealStages().catch((error) => {
            fail(error, 'تعذّر تحميل مراحل الصفقات');
            return [];
        }),
        staffMap().catch((error) => {
            fail(error, 'تعذّر تحميل أسماء الموظفين');
            return new Map();
        })
    ]);
    if (!root.isConnected) return;

    clear(root);
    if (dealResult.error) return void root.appendChild(errorBox(dealResult.error, 'تعذّر تحميل الصفقة'));

    const deal = dealResult.data;
    if (!deal) {
        root.appendChild(el('div', { class: 'crm-error', text: 'الصفقة غير موجودة أو لا تملك صلاحية الاطلاع عليها.' }));
        root.appendChild(el('div', { class: 'btn-row', style: 'margin-top:14px' },
            el('a', { class: 'btn btn-outline btn-sm', href: '#/deals', text: 'رجوع إلى الصفقات' })));
        return;
    }

    const stage = stages.find((s) => s.id === deal.stage_id) || null;
    const reload = () => renderDeal(root, dealId);

    const historyBody = el('div');
    const commissionHost = el('div');
    append(root, [
        el('div', { class: 'page-intro' }, [
            el('div', {}, [
                el('h1', { text: 'ملف الصفقة' }),
                el('p', { text: 'مراحل الصفقة، سجل الحركة، والعمولة المرتبطة بها.' })
            ]),
            el('span', { class: 'page-intro-meta', text: 'Deal record' })
        ]),
        headerCard(deal, stage, names),
        stageCard(deal, stages, reload),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'سجل المراحل' })]),
            historyBody
        ]),
        commissionHost
    ]);

    await Promise.all([
        renderHistory(historyBody, deal, stages, names),
        renderCommission(commissionHost, deal)
    ]);
}

/* ===================== الترويسة ===================== */

function headerCard(deal, stage, names) {
    const kv = (title, value) => el('div', { class: 'kv' }, [
        el('span', { text: title }),
        el('span', {}, value instanceof Node ? value : document.createTextNode(dash(value)))
    ]);

    const clientName = deal.client ? deal.client.full_name : 'العميل';
    const projectText = deal.project
        ? deal.project.name + (deal.project.district ? ' — ' + deal.project.district : '')
        : (deal.project_id ? 'عقار رقم ' + deal.project_id : null);

    const rows = [
        kv('العميل', el('a', { href: '#/clients/' + deal.client_id, text: clientName })),
        kv('العقار', projectText),
        kv('الوحدة', deal.unit_key),
        kv('قيمة الصفقة', money(deal.amount) + ' ريال'),
        kv('الوسيط', staffName(names, deal.broker_id)),
        kv('أُنشئت بواسطة', staffName(names, deal.created_by)),
        kv('فُتحت في', fmtDateTime(deal.opened_at)),
        kv('الإغلاق المتوقع', fmtDate(deal.expected_close_date)),
        kv('أُغلقت في', deal.closed_at ? fmtDateTime(deal.closed_at) : null)
    ];
    if (deal.requirement_id) {
        rows.push(kv('الطلب المرتبط', el('a', {
            href: '#/clients/' + deal.client_id + '/requirements/' + deal.requirement_id,
            text: 'فتح الطلب والمطابقات'
        })));
    }

    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'client-head' }, [
            el('div', {}, [
                el('h2', { text: 'صفقة: ' + clientName }),
                el('div', { class: 'btn-row' }, [
                    badge(stage ? stage.name_ar : 'مرحلة ' + dash(deal.stage_id), DEAL_STAGE_TONE[deal.stage_id] || 'neutral'),
                    deal.amount ? badge(money(deal.amount) + ' ريال', 'neutral') : null
                ])
            ]),
            el('div', { class: 'btn-row' }, [
                el('a', { class: 'btn btn-outline btn-sm', href: '#/deals', text: 'رجوع إلى اللوحة' }),
                el('a', { class: 'btn btn-secondary btn-sm', href: '#/clients/' + deal.client_id, text: 'ملف العميل' }),
                el('button', {
                    type: 'button', class: 'btn btn-primary btn-sm', text: 'المستندات',
                    onclick: () => openDocumentMenu(deal, stage, names)
                })
            ])
        ]),
        el('div', { class: 'kv-grid' }, rows),
        deal.stage_id === 7 ? lostBox(deal) : null
    ]);
}

function printDealSummary(deal, stage, names) {
    printDealDocument(deal, stage, names, 'summary');
}

function openDocumentMenu(deal, stage, names) {
    const options = [
        ['summary', 'ملخص الصفقة'],
        ['offer', 'عرض عقاري'],
        ['eoi', 'خطاب إبداء رغبة'],
        ['invoice', 'فاتورة عمولة']
    ];
    const buttons = options.map(([kind, title]) => el('button', {
        type: 'button', class: 'btn btn-outline btn-sm', text: title,
        onclick: () => { closeModal(); printDealDocument(deal, stage, names, kind); }
    }));
    openModal('اختيار المستند', el('div', { class: 'btn-row' }, buttons), { narrow: true });
}

function printDealDocument(deal, stage, names, kind) {
    const clientName = deal.client ? deal.client.full_name : 'العميل';
    const projectName = deal.project ? deal.project.name : (deal.project_id ? 'عقار رقم ' + deal.project_id : 'غير محدد');
    const brokerName = staffName(names, deal.broker_id);
    const amount = deal.amount === null || deal.amount === undefined ? 'غير محددة' : money(deal.amount) + ' ريال';
    const titles = { summary: 'ملخص الصفقة', offer: 'عرض عقاري', eoi: 'خطاب إبداء رغبة', invoice: 'فاتورة عمولة' };
    const title = titles[kind] || titles.summary;
    const rows = documentRows(kind, deal, stage, clientName, projectName, brokerName, amount);
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!popup) return void notify('اسمح بالنوافذ المنبثقة لطباعة المستند', 'error', 8000);

    const cells = rows.map((row) => '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join('');
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + escapeHtml(title) + ' - ' + escapeHtml(clientName) + '</title>'
        + '<style>body{font-family:Tahoma,Arial,sans-serif;color:#1f2937;padding:48px;line-height:1.8}h1{font-size:24px;border-bottom:2px solid #c5a880;padding-bottom:12px}p{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{border:1px solid #d1d5db;padding:12px;text-align:right}th{width:28%;background:#f8f5ef}.signature{display:flex;justify-content:space-between;margin-top:80px}.signature span{border-top:1px solid #9ca3af;padding-top:8px;width:35%;text-align:center}@media print{button{display:none}}</style></head><body>'
        + '<h1>ملائم العقاري — ' + escapeHtml(title) + '</h1><p>تم إنشاء المستند بتاريخ ' + escapeHtml(fmtDateTime(new Date().toISOString())) + '</p><table>' + cells + '</table>'
        + (kind === 'eoi' ? '<div class="signature"><span>توقيع العميل</span><span>توقيع الوسيط</span></div>' : '')
        + '<script>window.onload=function(){window.print()}<\/script></body></html>');
    popup.document.close();
}

function documentRows(kind, deal, stage, clientName, projectName, brokerName, amount) {
    const common = [
        ['العميل', clientName],
        ['العقار', projectName],
        ['الوحدة', deal.unit_key || 'كامل العقار'],
        ['قيمة الصفقة', amount],
        ['الوسيط', brokerName]
    ];
    if (kind === 'offer') return common.concat([['المرحلة', stage ? stage.name_ar : dash(deal.stage_id)], ['الإغلاق المتوقع', fmtDate(deal.expected_close_date)]]);
    if (kind === 'eoi') return common.concat([['نوع المستند', 'خطاب إبداء رغبة غير ملزم حتى توقيع العقد النهائي'], ['تاريخ العرض', fmtDate(new Date().toISOString())]]);
    if (kind === 'invoice') return common.concat([['نوع المستند', 'فاتورة عمولة'], ['حالة الصفقة', stage ? stage.name_ar : dash(deal.stage_id)], ['رقم الصفقة', deal.id]]);
    return common.concat([['المرحلة', stage ? stage.name_ar : dash(deal.stage_id)], ['الإغلاق المتوقع', fmtDate(deal.expected_close_date)], ['تاريخ الإنشاء', fmtDateTime(deal.opened_at)]]);
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// سبب الخسارة يُخزَّن على الصفقة نفسها، والمعرّف وحده لا يكفي فنقرأ الاسم عند العرض
function lostBox(deal) {
    const box = el('div', { class: 'crm-error', style: 'margin-top:16px' }, [
        el('div', { text: 'سبب الخسارة: …' }),
        deal.lost_note ? el('div', { class: 'tl-body', text: deal.lost_note }) : null
    ]);
    const line = box.firstChild;

    lostReasons().then((reasons) => {
        if (!line.isConnected) return;
        const reason = reasons.find((r) => r.id === deal.lost_reason_id);
        line.textContent = 'سبب الخسارة: ' + (reason ? reason.name_ar : dash(deal.lost_reason_id));
    }).catch(() => {
        if (line.isConnected) line.textContent = 'سبب الخسارة: ' + dash(deal.lost_reason_id);
    });

    return box;
}

/* ===================== مسار المراحل ===================== */

function stageCard(deal, stages, reload) {
    const steps = el('div', { class: 'deal-steps' });
    const current = stages.find((s) => s.id === deal.stage_id) || null;
    const currentOrder = current ? current.sort_order : 0;

    for (const stage of stages) {
        if (stage.is_terminal) continue;
        const done = stage.sort_order < currentOrder;
        const on = stage.id === deal.stage_id;
        steps.appendChild(el('div', {
            class: 'deal-step' + (on ? ' on' : '') + (done ? ' done' : ''),
            text: stage.sort_order + '. ' + stage.name_ar
        }));
    }
    for (const stage of stages) {
        if (!stage.is_terminal) continue;
        steps.appendChild(el('div', {
            class: 'deal-step deal-step-end' + (stage.id === deal.stage_id ? (stage.is_won ? ' won' : ' lost') : ''),
            text: stage.name_ar
        }));
    }

    const actions = el('div', { class: 'btn-row' });
    for (const stage of stages) {
        if (stage.id === deal.stage_id) continue;
        const button = el('button', {
            type: 'button',
            class: 'btn btn-xs ' + (stage.is_terminal ? (stage.is_won ? 'btn-success' : 'btn-danger') : 'btn-outline'),
            text: 'الانتقال إلى ' + stage.name_ar
        });
        button.addEventListener('click', () => moveTo(button, deal, stage, reload));
        actions.appendChild(button);
    }

    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'المرحلة' })]),
        steps,
        el('div', { class: 'crm-subtle', style: 'margin:14px 0 8px', text: 'الانتقال إلى مرحلة أخرى:' }),
        actions
    ]);
}

function moveTo(button, deal, stage, reload) {
    // "خسرت": القيد في قاعدة البيانات يرفضها بلا سبب، فالسبب يُطلب أولاً
    if (stage.id === 7) return void openLostForm(deal, stage, reload);
    // "تمت" بلا قيمة: القيمة هي أساس العمولة التي ينشئها المشغّل، فتُؤكَّد الآن
    if (stage.is_won && (deal.amount === null || deal.amount === undefined || deal.amount === '')) {
        return void openAmountForm(deal, stage, reload);
    }
    applyStage(button, deal, { stage_id: stage.id }, stage, reload);
}

async function applyStage(button, deal, patch, stage, reload) {
    if (button) button.disabled = true;
    const { data, error } = await supabase
        .from('deals')
        .update(patch)
        .eq('id', deal.id)
        .select('id');
    if (button) button.disabled = false;

    if (error) return void fail(error, 'تعذّر تغيير مرحلة الصفقة');
    // صفر صفوف بلا خطأ = RLS رشّحت الصف
    if (!data || data.length === 0) return void notify('لا تملك صلاحية تعديل هذا السجل', 'error', 8000);

    closeModal();
    notify('تم الانتقال إلى: ' + stage.name_ar, 'success');
    reload();
}

// نموذج الخسارة: السبب إلزامي هنا قبل أن يصل الطلب إلى الخادم
async function openLostForm(deal, stage, reload) {
    let reasons = [];
    try {
        reasons = await lostReasons();
    } catch (error) {
        return void fail(error, 'تعذّر تحميل أسباب الخسارة');
    }

    const reason = select(
        [{ value: '', label: 'اختر السبب' }].concat(reasons.map((r) => ({ value: String(r.id), label: r.name_ar }))),
        ''
    );
    const note = el('textarea', { rows: 3, placeholder: 'تفاصيل إضافية (اختياري)' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-danger btn-sm', text: 'تأكيد الخسارة' });

    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('سبب الخسارة', reason, { required: true, span2: true }),
            field('ملاحظة', note, { span2: true })
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!reason.value) return void notify('اختر سبب الخسارة', 'error');
        applyStage(saveBtn, deal, {
            stage_id: stage.id,
            lost_reason_id: Number(reason.value),
            lost_note: note.value.trim() || null
        }, stage, reload);
    });

    openModal('إغلاق الصفقة كخسارة', form, { narrow: true });
}

// نموذج الإتمام: القيمة النهائية أساس العمولة، ولا إتمام بلا قيمة
function openAmountForm(deal, stage, reload) {
    const amount = moneyInput({ value: deal.amount || '', required: true });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-success btn-sm', text: 'تأكيد الإتمام' });

    const form = el('form', {}, [
        el('p', {
            class: 'crm-subtle', style: 'margin-bottom:14px',
            text: 'قيمة الصفقة النهائية هي أساس احتساب العمولة، وتُنشأ العمولة تلقائياً عند الإتمام.'
        }),
        el('div', { class: 'form-grid' }, [field('قيمة الصفقة (ريال)', amount, { required: true, span2: true })]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = parseNumber(amount.value);
        if (value === null || value <= 0) return void notify('أدخل قيمة الصفقة', 'error');
        applyStage(saveBtn, deal, { stage_id: stage.id, amount: value }, stage, reload);
    });

    openModal('تأكيد إتمام الصفقة', form, { narrow: true });
}

/* ===================== سجل المراحل ===================== */

async function renderHistory(host, deal, stages, names) {
    const view = { page: 0 };
    const stageById = new Map();
    for (const stage of stages) stageById.set(stage.id, stage.name_ar);
    const name = (id) => (id === null || id === undefined ? 'البداية' : (stageById.get(id) || 'مرحلة ' + id));

    async function load() {
        replace(host, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('deal_stage_history')
            .select('id, from_stage, to_stage, note, changed_by, changed_at', { count: 'exact' })
            .eq('deal_id', deal.id)
            .order('changed_at', { ascending: false })
            .range(from, to);

        if (!host.isConnected) return;
        if (error) return void replace(host, errorBox(error, 'تعذّر تحميل سجل المراحل'));
        if (!data || data.length === 0) return void replace(host, empty('لا توجد انتقالات مسجّلة'));

        const head = el('thead', {}, el('tr', {}, [
            el('th', { text: 'التاريخ' }),
            el('th', { text: 'من' }),
            el('th', { text: 'إلى' }),
            el('th', { text: 'ملاحظة' }),
            el('th', { text: 'بواسطة' })
        ]));

        const body = el('tbody');
        for (const row of data) {
            body.appendChild(el('tr', {}, [
                el('td', { class: 'crm-subtle', text: fmtDateTime(row.changed_at) }),
                el('td', { text: name(row.from_stage) }),
                el('td', {}, badge(name(row.to_stage), DEAL_STAGE_TONE[row.to_stage] || 'neutral')),
                el('td', { class: 'crm-subtle', text: dash(row.note) }),
                el('td', { text: staffName(names, row.changed_by) })
            ]));
        }

        replace(host, [
            el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, body])),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}
