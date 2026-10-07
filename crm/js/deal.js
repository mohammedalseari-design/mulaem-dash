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
import { staffMap, staffName, dealStages, lostReasons, brokerStaff } from './data.js';
import { isAdmin } from './auth.js';
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
        headerCard(deal, stage, names, reload),
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

function headerCard(deal, stage, names, reload) {
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
                    type: 'button', class: 'btn btn-outline btn-sm', text: 'تعديل الصفقة',
                    onclick: () => openDealEdit(deal, stage, reload)
                }),
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

// «تعديل الصفقة»: القيمة والوحدة والإغلاق المتوقع، والوسيط للمدير وحده (الخادم يُبقي وسيط الوسيط كما هو).
// العمولة تتبع القيمة الجديدة في قاعدة البيانات نفسها ما دام لم يُحصَّل منها شيء، وإلا تُعلَّم للمراجعة
// (deals_after في 009_hardening.sql)، فالنموذج يقول ذلك ولا يلمس جدول العمولات.
async function openDealEdit(deal, stage, reload) {
    let brokers = [];
    if (isAdmin()) {
        try {
            brokers = (await brokerStaff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        } catch (error) {
            return void fail(error, 'تعذّر تحميل أسماء الوسطاء');
        }
    }
    const amount = moneyInput({ value: deal.amount ?? '' });
    const unitKey = el('input', { type: 'text', value: deal.unit_key || '', maxLength: 120, placeholder: 'اسم الوحدة أو رقمها (اختياري)' });
    const expectedClose = el('input', { type: 'date', value: deal.expected_close_date || '' });
    const broker = isAdmin() ? select(brokers, deal.broker_id || '') : null;
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ التعديل' });

    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('قيمة الصفقة (ريال)', amount, {
                hint: stage && stage.is_won
                    ? 'الصفقة تمت: إن لم يُحصَّل شيء من العمولة تتبعها العمولة تلقائياً، وإلا تُعلَّم للمراجعة.'
                    : 'أساس العمولة عند الإتمام.'
            }),
            field('الإغلاق المتوقع', expectedClose),
            field('الوحدة', unitKey, { span2: true }),
            broker ? field('الوسيط', broker, { span2: true }) : null
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = parseNumber(amount.value);
        if (stage && stage.is_won && (value === null || value <= 0)) {
            return void notify('الصفقة تمت: قيمتها مطلوبة لأنها أساس العمولة', 'error', 7000);
        }
        const patch = {
            amount: value,
            unit_key: unitKey.value.trim() || null,
            expected_close_date: expectedClose.value || null
        };
        if (broker && broker.value) patch.broker_id = broker.value;

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { data, error } = await supabase.from('deals').update(patch).eq('id', deal.id).select('id');
        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ التعديل';
        if (error) return void fail(error, 'تعذّر تعديل الصفقة');
        if (!data || data.length === 0) return void notify('لا تملك صلاحية تعديل هذه الصفقة', 'error', 8000);
        closeModal();
        notify('تم حفظ تعديل الصفقة', 'success');
        reload();
    });

    openModal('تعديل الصفقة', form, { narrow: true });
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

async function printDealDocument(deal, stage, names, kind) {
    const clientName = deal.client ? deal.client.full_name : 'العميل';
    const projectName = deal.project ? deal.project.name : (deal.project_id ? 'عقار رقم ' + deal.project_id : 'غير محدد');
    const brokerName = staffName(names, deal.broker_id);
    const amount = deal.amount === null || deal.amount === undefined ? 'غير محددة' : money(deal.amount) + ' ريال';
    const titles = { summary: 'ملخص الصفقة', offer: 'عرض عقاري', eoi: 'خطاب إبداء رغبة', invoice: 'فاتورة عمولة' };
    const title = titles[kind] || titles.summary;
    // بلا noopener/noreferrer: أيٌّ منهما يجعل window.open تُرجع null دائماً، فكان المستند لا يُكتب أبداً
    // ويظهر «اسمح بالنوافذ المنبثقة» مع نافذة فارغة. نقطع opener بأنفسنا قبل الكتابة، وnull بعدها حظرٌ حقيقي.
    // النافذة تُفتح قبل أي انتظار (حاجب النوافذ يسمح بها داخل الضغطة فقط)، ثم تُقرأ تفاصيل الوحدة للعرض.
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) return void notify('اسمح بالنوافذ المنبثقة لطباعة المستند', 'error', 8000);
    popup.opener = null;
    const unitRows = kind === 'offer' ? await offerRows(deal) : null;
    const rows = documentRows(kind, deal, stage, clientName, projectName, brokerName, amount, unitRows);

    const cells = rows.map((row) => '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join('');
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>' + escapeHtml(title) + ' - ' + escapeHtml(clientName) + '</title>'
        + '<style>body{font-family:Tahoma,Arial,sans-serif;color:#1f2937;padding:48px;line-height:1.8}h1{font-size:24px;border-bottom:2px solid #c5a880;padding-bottom:12px}p{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{border:1px solid #d1d5db;padding:12px;text-align:right}th{width:28%;background:#f8f5ef}.signature{display:flex;justify-content:space-between;margin-top:80px}.signature span{border-top:1px solid #9ca3af;padding-top:8px;width:35%;text-align:center}@media print{button{display:none}}</style></head><body>'
        + '<h1>ملائم العقاري — ' + escapeHtml(title) + '</h1><p>تم إنشاء المستند بتاريخ ' + escapeHtml(fmtDateTime(new Date().toISOString())) + '</p><table>' + cells + '</table>'
        + (kind === 'eoi' ? '<div class="signature"><span>توقيع العميل</span><span>توقيع الوسيط</span></div>' : '')
        + '<script>window.onload=function(){window.print()}<\/script></body></html>');
    popup.document.close();
}

// «عرض عقاري» يُعطى للعميل: مواصفات الوحدة وموقعها من v_units، لا المرحلة الداخلية ولا تاريخ الإغلاق المتوقع
async function offerRows(deal) {
    if (!deal.project_id) return [];
    let query = supabase.from('v_units')
        .select('unit_key, unit_type, district, city, rooms, bathrooms, area, price, construction_status, developer, latitude, longitude')
        .eq('project_id', deal.project_id)
        .order('unit_ord', { ascending: true })
        .range(0, 0);
    if (deal.unit_key) query = query.eq('unit_key', deal.unit_key);
    const { data, error } = await query;
    const unit = !error && data && data[0];
    if (!unit) return [];
    const has = (value) => value !== null && value !== undefined && value !== '';
    const rows = [];
    if (has(unit.unit_type)) rows.push(['نوع الوحدة', unit.unit_type]);
    const place = [unit.district, unit.city].filter(Boolean).join('، ');
    if (place) rows.push(['الموقع', place]);
    if (has(unit.rooms)) rows.push(['الغرف', String(unit.rooms)]);
    if (has(unit.bathrooms)) rows.push(['دورات المياه', String(unit.bathrooms)]);
    if (has(unit.area)) rows.push(['المساحة', money(unit.area) + ' م²']);
    if (has(unit.construction_status)) rows.push(['الحالة الإنشائية', unit.construction_status]);
    if (has(unit.developer)) rows.push(['المطوّر', unit.developer]);
    if (has(unit.price)) rows.push(['السعر المعروض', money(unit.price) + ' ريال']);
    const lat = Number(unit.latitude);
    const lng = Number(unit.longitude);
    if (has(unit.latitude) && has(unit.longitude) && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        rows.push(['الخريطة', 'https://www.google.com/maps?q=' + lat + ',' + lng]);
    }
    return rows;
}

function documentRows(kind, deal, stage, clientName, projectName, brokerName, amount, unitRows) {
    const common = [
        ['العميل', clientName],
        ['العقار', projectName],
        ['الوحدة', deal.unit_key || 'كامل العقار'],
        ['قيمة الصفقة', amount],
        ['الوسيط', brokerName]
    ];
    if (kind === 'offer') return common.concat(unitRows && unitRows.length ? unitRows : [['تفاصيل الوحدة', 'غير مسجّلة في النظام']]);
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
    // «خسرت» آخر المراحل ترتيباً، فكانت كل المراحل قبلها تُلوَّن «منجزة» كأن الصفقة مرّت بها
    const lost = Boolean(current && current.is_terminal && !current.is_won);

    for (const stage of stages) {
        if (stage.is_terminal) continue;
        const done = !lost && stage.sort_order < currentOrder;
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

    // الصفقة المغلقة (تمت أو خسرت) تُعاد إلى مرحلة جارية أولاً، فلا تُتمّ صفقة خاسرة بضغطة
    // ولا تُقلب صفقة تمت إلى خاسرة مباشرة.
    const closed = Boolean(current && current.is_terminal);
    const actions = el('div', { class: 'btn-row' });
    for (const stage of stages) {
        if (stage.id === deal.stage_id) continue;
        if (closed && stage.is_terminal) continue;
        const button = el('button', {
            type: 'button',
            class: 'btn btn-xs ' + (stage.is_terminal ? (stage.is_won ? 'btn-success' : 'btn-danger') : 'btn-outline'),
            text: (closed ? 'إعادة فتح إلى ' : 'الانتقال إلى ') + stage.name_ar
        });
        button.addEventListener('click', () => moveTo(button, deal, stage, reload));
        actions.appendChild(button);
    }

    return el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'المرحلة' })]),
        steps,
        closed
            ? el('div', { class: 'crm-subtle deal-reopen-note', text: current.is_won
                ? 'الصفقة مغلقة («تمت»). لإعادة فتحها اختر مرحلة: تُلغى عمولتها إن لم يُحصَّل منها شيء، وإلا تُعلَّم «تحتاج مراجعة».'
                : 'الصفقة مغلقة («خسرت»). لإعادة فتحها اختر مرحلة، ثم تُغلق بـ«تمت» أو «خسرت» من جديد.' })
            : el('div', { class: 'crm-subtle', style: 'margin:14px 0 8px', text: 'الانتقال إلى مرحلة أخرى:' }),
        actions
    ]);
}

function moveTo(button, deal, stage, reload) {
    // "خسرت": القيد في قاعدة البيانات يرفضها بلا سبب، فالسبب يُطلب أولاً
    if (stage.id === 7) return void openLostForm(deal, stage, reload);
    // "تمت": القيمة النهائية أساس العمولة التي ينشئها المشغّل، فتُؤكَّد في كل إتمام ولو كانت معبأة
    if (stage.is_won) return void openAmountForm(deal, stage, reload);
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

// النسبتان الافتراضيتان لجدول commissions (007_deals_commissions.sql): المعاينة تحسب كما يحسب الخادم،
// والنسبة تُعدَّل بعد الإتمام من قسم العمولة في صفحة الصفقة.
const DEFAULT_RATE = 2.5;
const DEFAULT_VAT = 15;
const round2 = (n) => Math.round(n * 100) / 100;

// نموذج الإتمام: السعر النهائي أساس العمولة، ولا إتمام بلا قيمة، ومعه معاينة العمولة قبل التأكيد
function openAmountForm(deal, stage, reload) {
    const amount = moneyInput({ value: deal.amount ?? '', required: true });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-success btn-sm', text: 'تأكيد الإتمام' });
    const preview = el('dl', { class: 'won-preview', 'aria-live': 'polite' });

    const line = (label, value, strong) => el('div', { class: 'won-line' + (strong ? ' won-total' : '') }, [
        el('dt', { text: label }),
        el('dd', { class: 'num', text: value === null ? '—' : money(value) + ' ريال' })
    ]);
    function updatePreview() {
        const value = parseNumber(amount.value);
        const base = value !== null && value > 0 ? value : null;
        const gross = base === null ? null : round2(base * DEFAULT_RATE / 100);
        const vat = base === null ? null : round2(base * DEFAULT_RATE / 100 * DEFAULT_VAT / 100);
        replace(preview, [
            line('العمولة (' + DEFAULT_RATE + '%)', gross),
            line('ضريبة العمولة (' + DEFAULT_VAT + '%)', vat),
            line('العمولة مع الضريبة', gross === null ? null : round2(gross + vat), true)
        ]);
    }
    amount.addEventListener('input', updatePreview);
    updatePreview();

    const form = el('form', {}, [
        el('p', {
            class: 'crm-subtle', style: 'margin-bottom:14px',
            text: 'تأكد من السعر النهائي قبل الإتمام: عليه تُحسب العمولة، وتُنشأ تلقائياً عند الإتمام.'
        }),
        el('div', { class: 'form-grid' }, [field('السعر النهائي للصفقة (ريال)', amount, { required: true, span2: true })]),
        preview,
        el('p', { class: 'crm-subtle won-note', text: 'النسبة تُعدَّل بعد الإتمام من قسم العمولة في صفحة الصفقة.' }),
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
