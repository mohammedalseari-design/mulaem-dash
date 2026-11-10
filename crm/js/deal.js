// ‎#/deals/:id‎ — صفحة الصفقة: بياناتها، مسار المراحل، سجل الانتقالات.
//
// كل انتقال مرحلة هو ‎update‎ واحد على ‎deals.stage_id‎؛ ما عداه يفعله الخادم:
// ‎closed_at‎ عند المراحل النهائية، مسح سبب الخسارة عند الخروج من "خسرت"، كتابة
// ‎deal_stage_history‎ والأحداث، وإنشاء صف العمولة عند الإتمام بقيمة معلومة
// (مشغّلات 007_deals_commissions.sql).
//
// "خسرت" بلا سبب يرفضه قيد ‎deals_lost_reason_required‎ برمز 23514، فالنموذج
// يطلب السبب قبل الإرسال بدل أن نُري المستخدم خطأ قاعدة بيانات.
//
// صفقة "تمت" يعيد فتحها ويعدّل قيمتها المدير وحده (‎deals_won_lock‎ في 034_won_deal_admin_lock.sql)،
// فلا تُعرض أزرار إعادة الفتح لغيره، وقيمتها في «تعديل الصفقة» للعرض فقط.
//
// بطاقة «مسار الصفقة» (2026-11-03) بدل شريط المراحل وزر لكل مرحلة: خطوات مرقّمة، وفوقها كم بقيت الصفقة في
// مرحلتها، وتحتها زر رئيسي واحد للمرحلة التالية وروابط نصية للباقي، وصندوق عمولة صغير لمن يرى العمولة. ما تعرضه
// يحسبه deal-page-model.js (يُختبر وحده)؛ هنا القراءة والرسم والانتقال نفسه (moveTo / applyStage كما كانا).
// أزرار المراحل لمن يكتب الصفقة وحده (المدير أو وسيطها، deals_update)؛ منشئها الذي صار وسيطها غيره يقرؤها (deals_select)
// فيرى المسار وملاحظة تقول من يغيّر مرحلتها.
// الجوال: بيانات الترويسة مطوية تحت «تفاصيل الصفقة»، فيلي «مسار الصفقة» العنوانَ وأزراره في أول الشاشة.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName, dealStages, lostReasons, brokerStaff } from './data.js';
import { isAdmin, myId, canSeeCommission } from './auth.js';
import { formatRate } from './commission-rate.js';
import { DEAL_STAGE_TONE } from './labels.js';
import {
    el, append, clear, replace, loading, empty, errorBox, badge, pager, field,
    select, moneyInput, parseNumber, openModal, closeModal,
    money, fmtDate, fmtDateTime, dash, notify, fail, icon
} from './ui.js';
import { renderCommission } from './commission.js';
import { commissionState } from './deal-path.js';
import { pathOrder, pathSteps, showLost, sinceLine, pathActions, commissionBox, unitPriceKey } from './deal-page-model.js';

export async function renderDeal(root, dealId) {
    replace(root, loading());

    // أول صفحة من سجل المراحل تُقرأ مع الصفقة نفسها: منها سطر «في «تفاوض» من 6 أيام» فوق المسار، وهي نفسها أول
    // صفحة في جدول السجل أسفل الصفحة، فلا تُطلب مرتين
    const [dealResult, stages, names, firstHistory] = await Promise.all([
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
        }),
        Promise.resolve(historyPage(dealId, 0)).catch((error) => ({ data: null, error, count: null }))
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
    const seeCommission = canSeeCommission();
    // من يكتب الصفقة: المدير أو وسيطها (deals_update). منشئها يقرؤها ولو صار وسيطها غيره ما دام يرى عميلها (043)، ولا يكتبها
    const me = myId();
    const canMove = isAdmin() || (me !== null && deal.broker_id === me);

    const historyBody = el('div');
    const commissionHost = el('div');
    const path = pathCard(deal, stages, firstHistory, seeCommission, canMove, reload);
    append(root, [
        headerCard(deal, stage, names, reload),
        path.card,
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'سجل المراحل' })]),
            historyBody
        ]),
        commissionHost
    ]);

    // العمولة لمن يراها فقط (037)؛ القاعدة لا تعطي غيره صفها أصلاً، ولا يُطلب له شيء منها
    await Promise.all([
        renderHistory(historyBody, deal, stages, names, firstHistory),
        seeCommission ? loadCommission(path.commission, commissionHost, deal, stage, canMove, reload) : null
    ]);
}

/* ===================== الترويسة ===================== */

function headerCard(deal, stage, names, reload) {
    const kv = (title, value) => el('div', { class: 'kv' }, [
        el('span', { text: title }),
        el('span', {}, value instanceof Node ? value : document.createTextNode(dash(value)))
    ]);

    // العميل لا يصل مع الصفقة حين لا يراه المستخدم (حُوّل لغيره، 043): اسمه نص بلا روابط إلى صفحات ترفضه
    const clientGone = !deal.client;
    const clientName = clientGone ? 'عميل ليس عندك' : deal.client.full_name;
    const projectText = deal.project
        ? deal.project.name + (deal.project.district ? ' — ' + deal.project.district : '')
        : (deal.project_id ? 'عقار رقم ' + deal.project_id : null);

    const rows = [
        kv('العميل', clientGone ? clientName : el('a', { href: '#/clients/' + deal.client_id, text: clientName })),
        kv('العقار', projectText),
        kv('الوحدة', deal.unit_key),
        kv('قيمة الصفقة', money(deal.amount) + ' ريال'),
        kv('الوسيط', staffName(names, deal.broker_id)),
        kv('أُنشئت بواسطة', staffName(names, deal.created_by)),
        kv('فُتحت في', fmtDateTime(deal.opened_at)),
        kv('الإغلاق المتوقع', fmtDate(deal.expected_close_date)),
        kv('أُغلقت في', deal.closed_at ? fmtDateTime(deal.closed_at) : null)
    ];
    if (deal.requirement_id && !clientGone) {
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
                clientGone ? null : el('a', { class: 'btn btn-secondary btn-sm', href: '#/clients/' + deal.client_id, text: 'ملف العميل' }),
                el('button', {
                    type: 'button', class: 'btn btn-outline btn-sm', text: 'تعديل الصفقة',
                    onclick: () => openDealEdit(deal, stage, reload)
                }),
                // بإطار لا ممتلئ: الزر الرئيسي في الصفحة «انقل إلى…» في بطاقة المسار تحت هذه (زر رئيسي واحد في المكان)
                // المستندات تحمل اسم العميل: من لم يعد العميل عنده لا يطبعها باسم بديل (المدير يطبعها)
                clientGone ? null : el('button', {
                    type: 'button', class: 'btn btn-outline btn-sm', text: 'المستندات',
                    onclick: () => openDocumentMenu(deal, stage, names)
                })
            ])
        ]),
        // سبب الخسارة صار مع حالة «خسرت» في بطاقة المسار (lostState)، فلا يتكرر هنا
        detailsFold(rows)
    ]);
}

// الجوال: البيانات تسعة سطور فوق «مسار الصفقة» تدفعه وزره الرئيسي تحت الشاشة الأولى، فتُطوى تحت «تفاصيل الصفقة» (مغلقة).
// الكمبيوتر: الطيّة مفتوحة وعنوانها مخفي (crm/v6.css، قسم dp-)، فتبقى البطاقة كما كانت. إن فُتحت الصفحة على الجوال ثم
// اتسعت الشاشة (تدوير) يظهر العنوان ما دامت مغلقة، فلا تختفي البيانات بلا باب.
function detailsFold(rows) {
    const fold = el('details', { class: 'dp-details' }, [
        el('summary', { text: 'تفاصيل الصفقة' }),
        el('div', { class: 'kv-grid' }, rows)
    ]);
    if (!window.matchMedia('(max-width: 700px)').matches) fold.open = true;
    return fold;
}

// «تعديل الصفقة»: القيمة والوحدة والإغلاق المتوقع، والوسيط للمدير وحده (الخادم يُبقي وسيط الوسيط كما هو).
// العمولة تتبع القيمة الجديدة في قاعدة البيانات نفسها ما دام لم يُحصَّل منها شيء، وإلا تُعلَّم للمراجعة
// (deals_after في 009_hardening.sql)، فالنموذج يقول ذلك ولا يلمس جدول العمولات.
// قيمة صفقة «تمت» للمدير وحده (034): تظهر لغيره للعلم ولا تُرسل.
async function openDealEdit(deal, stage, reload) {
    let brokers = [];
    if (isAdmin()) {
        try {
            brokers = (await brokerStaff()).map((p) => ({ value: p.id, label: p.fullname || p.username }));
        } catch (error) {
            return void fail(error, 'تعذّر تحميل أسماء الوسطاء');
        }
    }
    const amountLocked = Boolean(stage && stage.is_won && !isAdmin());
    const amount = moneyInput({ value: deal.amount ?? '', disabled: amountLocked });
    const unitKey = el('input', { type: 'text', value: deal.unit_key || '', maxLength: 120, placeholder: 'اسم الوحدة أو رقمها (اختياري)' });
    const expectedClose = el('input', { type: 'date', value: deal.expected_close_date || '' });
    const broker = isAdmin() ? select(brokers, deal.broker_id || '') : null;
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ التعديل' });

    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, [
            field('قيمة الصفقة (ريال)', amount, {
                hint: amountLocked
                    ? 'الصفقة تمت: تعديل قيمتها للمدير فقط.'
                    : stage && stage.is_won
                        ? 'الصفقة تمت: إن لم يُحصَّل شيء من العمولة تتبعها العمولة تلقائياً، وإلا تُعلَّم للمراجعة.'
                        : canSeeCommission() ? 'أساس العمولة عند الإتمام.' : null
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
        if (!amountLocked && stage && stage.is_won && (value === null || value <= 0)) {
            return void notify('الصفقة تمت: قيمتها مطلوبة لأنها أساس العمولة', 'error', 7000);
        }
        const patch = {
            unit_key: unitKey.value.trim() || null,
            expected_close_date: expectedClose.value || null
        };
        if (!amountLocked) patch.amount = value;
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
        canSeeCommission() ? ['invoice', 'فاتورة عمولة'] : null
    ].filter(Boolean);
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

/* ===================== مسار الصفقة ===================== */

// البطاقة: رأسها الاسم وسطر المدة، ثم حالة «خسرت» إن خسرت، ثم الخطوات، ثم الإجراءات وصندوق العمولة.
// firstHistory: أول صفحة من سجل المراحل ({ data, error }) — إن تعذّرت قراءتها يُعامل السجل كمجهول لا كفارغ.
// canMove: هل يكتب المستخدم الصفقة؛ وإلا فلا أزرار مراحل، بل ملاحظة (pathActions).
// يرجع البطاقة وصندوق العمولة (فارغاً حتى تصل أرقامه في loadCommission، أو null لمن لا يرى العمولة).
// مرحلة لا تُعرف (تعذّر تحميل المراحل) لا حالة عمولة لها، فلا صندوق: لا «جارٍ الحساب…» يختفي بعدها.
function pathCard(deal, stages, firstHistory, seeCommission, canMove, reload) {
    const history = firstHistory && !firstHistory.error ? (firstHistory.data || []) : null;
    const model = pathSteps(stages, deal.stage_id);
    const since = sinceLine(stages, deal, history);
    // العميل لا يصل مع الصفقة حين لا يراه المستخدم (حُوّل لغيره): المغلقة لا يعيد فتحها إلا المدير (deals_reopen_guard، 043)
    const actions = pathActions(stages, deal.stage_id, isAdmin(), canMove, !deal.client);

    const commission = seeCommission && model.status !== 'unknown'
        ? el('div', { class: 'dp-com dp-loading', role: 'group', 'aria-label': 'العمولة', 'aria-busy': 'true' }, [
            el('div', { class: 'dp-com-head' }, el('span', { class: 'dp-com-title', text: 'العمولة' })),
            el('span', { class: 'dp-com-detail', text: 'جارٍ الحساب…' })
        ])
        : null;

    const buttons = actionButtons(deal, stages, actions, reload);
    const foot = buttons.length || actions.note || commission
        ? el('div', { class: 'dp-foot' }, [
            buttons.length ? el('div', { class: 'dp-actions' }, buttons) : null,
            actions.note ? el('p', { class: 'dp-note', text: actions.note }) : null,
            commission
        ])
        : null;

    const card = el('section', { class: 'crm-card dp-card', 'aria-labelledby': 'dpTitle' }, [
        el('div', { class: 'crm-card-head dp-head' }, [
            el('h2', { id: 'dpTitle', text: 'مسار الصفقة' }),
            since
                ? el('p', { class: 'dp-since' + (since.stuck ? ' dp-late' : ''), title: since.title }, [
                    el('span', { text: since.text }),
                    since.flag ? el('span', { class: 'dp-flag', text: since.flag }) : null
                ])
                : null
        ]),
        // بالمراحل، أو برقم «خسرت» إن تعذّر تحميلها: السبب والملاحظة لا يختفيان (كانا في الترويسة برقم المرحلة)
        showLost(model, deal.stage_id) ? lostState(deal) : null,
        model.steps.length ? stepList(model) : null,
        foot
    ]);
    return { card, commission };
}

// ما يُقرأ لقارئ الشاشة بعد اسم الخطوة. الرقم والعلامة ✓ رسم فقط (الترتيب تقوله القائمة المرقّمة نفسها)، والحالية
// و«تمت» تقولهما aria-current، فلا يُكتب لهما نص يُقرأ مرتين
const STEP_SR = { done: 'منجزة' };

function stepList(model) {
    return el('ol', {
        class: 'dp-steps',
        // list-style: none يُسقط معنى القائمة في Safari، فيُعاد صريحاً
        role: 'list',
        'aria-label': 'مراحل الصفقة',
        style: '--dp-n:' + model.steps.length
    }, model.steps.map((step) => el('li', {
        // dp-done | dp-current | dp-todo | dp-won | dp-off (حالات pathSteps)
        class: 'dp-step dp-' + step.state,
        'aria-current': step.state === 'current' || step.state === 'won' ? 'step' : null
    }, [
        el('span', { class: 'dp-dot', 'aria-hidden': 'true' },
            step.state === 'done' || step.state === 'won' ? icon('check') : String(step.n)),
        el('span', { class: 'dp-name', text: step.name }),
        STEP_SR[step.state] ? el('span', { class: 'w4-sr', text: '، ' + STEP_SR[step.state] }) : null
    ])));
}

// زر رئيسي واحد (المرحلة التالية)، والباقي روابط نصية. المغلقة: «أعد فتحها…» زر بإطار (ليس الإجراء المعتاد)،
// أو لا شيء حين تكون «تمت» والمستخدم غير المدير، أو حين لا يكتب الصفقة أصلاً (الملاحظة تقول لماذا). الزر الذي يفتح نافذة
// يقول ذلك لقارئ الشاشة (aria-haspopup) قبل الضغط.
function actionButtons(deal, stages, actions, reload) {
    const list = [];
    const dialog = 'dialog';
    if (actions.primary) {
        const next = actions.primary;
        const button = el('button', {
            type: 'button', class: 'btn btn-primary btn-sm dp-next', 'aria-haspopup': next.won ? dialog : null
        }, [
            el('span', { text: next.text }),
            icon(next.won ? 'check' : 'arrow')
        ]);
        button.addEventListener('click', () => moveTo(button, deal, next.stage, reload));
        list.push(button);
    }
    if (actions.back) {
        const back = actions.back;
        // الوجهة مكتوبة لقارئ الشاشة، والتلميح نصّ الاسم نفسه حرفاً فلا يُقرأ مرتين
        const button = el('button', { type: 'button', class: 'link-btn dp-link', title: back.text + ' ' + back.target }, [
            el('span', { text: back.text }),
            el('span', { class: 'w4-sr', text: ' ' + back.target })
        ]);
        button.addEventListener('click', () => moveTo(button, deal, back.stage, reload));
        list.push(button);
    }
    if (actions.other) {
        list.push(el('button', {
            type: 'button', class: 'link-btn dp-link', text: actions.other.text, 'aria-haspopup': dialog,
            onclick: () => openStagePicker(deal, stages, actions.other, reload)
        }));
    }
    if (actions.lose) {
        list.push(el('button', {
            type: 'button', class: 'link-btn dp-link dp-link-lost', text: actions.lose.text, 'aria-haspopup': dialog,
            onclick: () => openLostForm(deal, actions.lose.stage, reload)
        }));
    }
    if (actions.reopen) {
        list.push(el('button', {
            type: 'button', class: 'btn btn-outline btn-sm dp-reopen', text: actions.reopen.text, 'aria-haspopup': dialog,
            onclick: () => openStagePicker(deal, stages, actions.reopen, reload)
        }));
    }
    return list;
}

// «مرحلة أخرى…» و«أعد فتحها…»: النافذة تقول القاعدة ثم تعرض المراحل المسموحة بأرقامها في المسار. الضغط moveTo نفسه
// («تمت» تفتح نموذج السعر النهائي مكانها، والباقي تحديث واحد)، والنافذة تُغلق بعد نجاحه في applyStage.
function openStagePicker(deal, stages, choice, reload) {
    const order = pathOrder(stages);
    const options = choice.stages.map((stage) => {
        const button = el('button', { type: 'button', class: 'dp-pick-btn' }, [
            el('span', { class: 'dp-pick-n', 'aria-hidden': 'true', text: String(order.indexOf(stage) + 1) }),
            el('span', { class: 'dp-pick-name', text: stage.name_ar }),
            stage.is_won ? el('span', { class: 'dp-pick-hint', text: 'يُطلب السعر النهائي' }) : null
        ]);
        button.addEventListener('click', () => moveTo(button, deal, stage, reload));
        return el('li', {}, button);
    });
    openModal(choice.title, [
        el('p', { class: 'crm-subtle dp-pick-note', text: choice.note }),
        el('ul', { class: 'dp-pick', role: 'list' }, options),
        el('div', { class: 'btn-row btn-row-end' },
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }))
    ], { narrow: true });
}

// «خسرت»: الحالة وسببها وملاحظتها فوق المسار الرمادي. السبب محفوظ رقماً على الصفقة، فيُقرأ اسمه عند العرض
function lostState(deal) {
    const hasReason = deal.lost_reason_id !== null && deal.lost_reason_id !== undefined;
    const why = hasReason ? el('span', { class: 'dp-lost-why', text: 'السبب: …' }) : null;
    if (why) {
        lostReasonName(deal.lost_reason_id).then((name) => {
            if (why.isConnected) why.textContent = 'السبب: ' + name;
        });
    }
    return el('div', { class: 'dp-lost' }, [
        el('p', { class: 'dp-lost-line' }, [
            el('span', { class: 'dp-lost-tag' }, [icon('close'), el('span', { text: 'خسرت' })]),
            why
        ]),
        deal.lost_note ? el('p', { class: 'dp-lost-note', text: deal.lost_note }) : null
    ]);
}

// القائمة المخزّنة للأسباب النشطة وحدها؛ سبب أُوقف بعد تسجيله يُقرأ صفه وحده (سياسة القراءة تشمل الموقوف)،
// فلا يظهر رقمه بدل اسمه
async function lostReasonName(id) {
    try {
        const found = (await lostReasons()).find((r) => r.id === id);
        if (found) return found.name_ar;
        const { data } = await supabase.from('lost_reasons').select('name_ar').eq('id', id).maybeSingle();
        return data ? data.name_ar : dash(id);
    } catch {
        return dash(id);
    }
}

// صندوق العمولة الصغير، وبطاقة العمولة المفصّلة أسفل الصفحة. «متوقعة» تحتاج النسبة (نسبة المشروع أو العامة) والأساس
// (قيمة الصفقة، وإلا سعر الوحدة من v_units)؛ «مستحقة» من صف العمولة نفسه. البطاقة المفصّلة للصفقة التي تمت، ولأي صفقة
// بقي لها صف: صفقة خرجت من «تمت» بعد تحصيل شيء من عمولتها يبقى صفها «تحتاج مراجعة» (031) وعلى المدير أن يراه.
// صفقة جارية بلا صف لا بطاقة لها بعد اليوم: كانت تقول «لا توجد عمولة» تحت صندوق يقول المتوقعة.
// canMove: من لا يكتب الصفقة لا يُعرض له رابط «اكتب قيمة الصفقة…» (commissionBox: canEdit).
async function loadCommission(box, cardHost, deal, stage, canMove, reload) {
    // «تمت»: البطاقة المفصّلة تقرأ الصف، وكل قراءة لها (الأولى، وبعد «تعديل العمولة» و«إضافة دفعة» و«تمت المراجعة») تملأ
    // الصندوق من الصف نفسه، فلا يبقى فيه مبلغ أو نسبة أو حالة قديمة. تبدأ فوراً مع الصندوق، لا بعده. «مستحقة» رقمها من
    // الصف وحده: إن تعذّرت قراءته يقال ذلك، لا «لم تُسجَّل عمولة»
    if (commissionState(stage) === 'due') {
        await renderCommission(cardHost, deal, ({ data, error }) => {
            if (!box || !box.isConnected) return;
            fillCommissionBox(box, error ? null : commissionBox({ stage, amount: deal.amount, row: data || null }), deal, stage, reload);
        });
        return;
    }
    const key = Number(deal.amount) > 0 ? null : unitPriceKey(deal);
    const [rowResult, found, unitPrice] = await Promise.all([
        Promise.resolve(supabase
            .from('commissions')
            .select('id')
            .eq('deal_id', deal.id)
            .maybeSingle()).catch((error) => ({ data: null, error })),
        effectiveDealRate(deal.project_id).catch(() => null),
        key ? unitPriceOf(key) : null
    ]);

    if (box && box.isConnected) {
        fillCommissionBox(box, commissionBox({
            stage, amount: deal.amount, unitPrice, row: null, canEdit: canMove,
            rate: found && Number.isFinite(found.rate) ? found.rate : null,
            rateFrom: found ? found.from : ''
        }), deal, stage, reload);
    }
    // صف باقٍ لصفقة غير «تمت» (031) تُعرض بطاقته. وتعذّرت قراءة الصف: لا يُعرف أله عمولة، فتُعرض البطاقة كما كانت تُعرض
    // دائماً (تقول خطأها بنفسها)
    if (cardHost.isConnected && (rowResult.error || rowResult.data)) await renderCommission(cardHost, deal);
}

// سعر الوحدة المعروض: صف واحد من v_units بمفتاح unitPriceKey. أي خطأ = لا سعر، فيطلب الصندوق قيمة الصفقة
async function unitPriceOf(key) {
    try {
        let query = supabase.from('v_units').select('price').eq('project_id', key.project_id);
        query = key.unit_key !== undefined ? query.eq('unit_key', key.unit_key) : query.eq('unit_ord', key.unit_ord);
        const { data, error } = await query.order('unit_ord', { ascending: true }).range(0, 0);
        return !error && data && data[0] ? data[0].price : null;
    } catch {
        return null;
    }
}

// model: من commissionBox (null لمرحلة لا تُعرف: لا صندوق)، أو null مع صفقة تمت تعذّرت قراءة عمولتها.
// يُستدعى مرة لكل قراءة لصف العمولة (loadCommission)، فيُعاد رسم الصندوق كله في كل مرة.
function fillCommissionBox(box, model, deal, stage, reload) {
    box.removeAttribute('aria-busy');
    const failed = !model && commissionState(stage) === 'due';
    if (!model && !failed) {
        // لا يبقى ذيل البطاقة فارغاً بخطه العلوي إن كان الصندوق كل ما فيه
        const foot = box.parentNode;
        box.remove();
        if (foot && foot.classList.contains('dp-foot') && !foot.childNodes.length) foot.remove();
        return;
    }
    // dp-neutral | dp-amber | dp-ok | dp-muted (COMMISSION_STATE_TONE وdueCommissionLook). صف «تمت» لم يُقرأ: محايد،
    // لا أخضر ولا باهت
    box.className = 'dp-com dp-' + (model ? model.tone : 'neutral');
    const head = el('div', { class: 'dp-com-head' }, [
        el('span', { class: 'dp-com-title', text: 'العمولة' }),
        model ? el('span', { class: 'dp-com-state', text: model.label }) : null
    ]);
    if (!model) return void replace(box, [head, el('span', { class: 'dp-com-detail', text: 'تعذّرت قراءة العمولة' })]);
    replace(box, [
        head,
        model.value !== null ? el('strong', { class: 'dp-com-value num', text: model.valueText }) : null,
        model.detail ? el('span', { class: 'dp-com-detail', text: model.detail }) : null,
        model.hint && model.askAmount
            // الجملة نفسها رابط: تفتح «تعديل الصفقة» وأول حقولها القيمة
            ? el('button', { type: 'button', class: 'link-btn dp-com-ask', text: model.hint, onclick: () => openDealEdit(deal, stage, reload) })
            : model.hint ? el('span', { class: 'dp-com-detail', text: model.hint }) : null
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

// المعاينة تحسب كما يحسب الخادم: العمولة تُنشأ عند «تمت» بنسبة مشروع الصفقة أو النسبة العامة (commissions_apply_rate
// في 037)، والضريبة 15% (007). النسبة تُعدَّل بعد الإتمام من قسم العمولة في صفحة الصفقة. لا نسبة احتياطية: ما لم تُقرأ
// النسبة فعلاً لا تُعرض أرقام، بل سطر يقول إن العمولة تُحسب بنسبة المشروع عند الإتمام.
const DEFAULT_VAT = 15;
const round2 = (n) => Math.round(n * 100) / 100;
const NO_RATE_LINE = 'العمولة تُحسب بنسبة المشروع عند الإتمام';

// نسبة الصفقة: نسبة مشروعها إن كانت له نسبة خاصة، وإلا النسبة العامة. لا شيء ما لم يصل صف commission_policy: 037 يحجبه
// مع نسب المشاريع عمّن أخفى المدير عنه العمولة (ولو بعد دخوله)، فلا يُحسب رقم من نسب ناقصة (كما expectedTotal في
// work-queue.js وrateFor في deals-list-model.js)
async function effectiveDealRate(projectId) {
    const [policy, project] = await Promise.all([
        supabase.from('commission_policy').select('default_rate').maybeSingle(),
        projectId === null || projectId === undefined
            ? Promise.resolve({ data: null, error: null })
            : supabase.from('project_commission').select('rate').eq('project_id', projectId).maybeSingle()
    ]);
    if (policy.error || !policy.data) return null;
    if (!project.error && project.data) return { rate: Number(project.data.rate), from: 'نسبة المشروع' };
    return { rate: Number(policy.data.default_rate), from: 'النسبة العامة' };
}

// نموذج الإتمام: السعر النهائي أساس العمولة، ولا إتمام بلا قيمة، ومعه معاينة العمولة قبل التأكيد
function openAmountForm(deal, stage, reload) {
    const amount = moneyInput({ value: deal.amount ?? '', required: true });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-success btn-sm', text: 'تأكيد الإتمام' });
    // من لا يرى العمولة (037) يؤكد السعر فقط، بلا معاينة عمولة
    const seeCommission = canSeeCommission();
    // أسطر المعاينة (dl) حين تُقرأ النسبة، وقبلها أو إن تعذّرت سطر واحد بلا أرقام (يُوضع مرة، فلا يُعاد إعلانه مع كل حرف)
    const preview = seeCommission ? el('div', { class: 'won-preview-host', 'aria-live': 'polite' }) : null;
    const noRate = seeCommission ? el('p', { class: 'won-preview won-preview-none', text: NO_RATE_LINE }) : null;
    let rate = null;
    let rateFrom = '';

    const line = (label, value, strong) => el('div', { class: 'won-line' + (strong ? ' won-total' : '') }, [
        el('dt', { text: label }),
        el('dd', { class: 'num', text: value === null ? '—' : money(value) + ' ريال' })
    ]);
    function updatePreview() {
        if (!preview) return;
        if (rate === null) {
            if (preview.firstChild !== noRate) replace(preview, noRate);
            return;
        }
        const value = parseNumber(amount.value);
        const base = value !== null && value > 0 ? value : null;
        const gross = base === null ? null : round2(base * rate / 100);
        const vat = base === null ? null : round2(base * rate / 100 * DEFAULT_VAT / 100);
        replace(preview, el('dl', { class: 'won-preview' }, [
            line('العمولة (' + formatRate(rate) + (rateFrom ? ' ' + rateFrom : '') + ')', gross),
            line('ضريبة العمولة (' + DEFAULT_VAT + '%)', vat),
            line('العمولة مع الضريبة', gross === null ? null : round2(gross + vat), true)
        ]));
    }
    amount.addEventListener('input', updatePreview);
    updatePreview();
    if (seeCommission) {
        effectiveDealRate(deal.project_id).then((found) => {
            if (!found || !Number.isFinite(found.rate)) return;
            rate = found.rate;
            rateFrom = found.from;
            updatePreview();
        }).catch(() => {});
    }

    const form = el('form', {}, [
        el('p', {
            class: 'crm-subtle', style: 'margin-bottom:14px',
            text: seeCommission
                ? 'تأكد من السعر النهائي قبل الإتمام: عليه تُحسب العمولة، وتُنشأ تلقائياً عند الإتمام.'
                : 'تأكد من السعر النهائي قبل الإتمام.'
        }),
        el('div', { class: 'form-grid' }, [field('السعر النهائي للصفقة (ريال)', amount, { required: true, span2: true })]),
        preview,
        seeCommission ? el('p', { class: 'crm-subtle won-note', text: 'النسبة تُعدَّل بعد الإتمام من قسم العمولة في صفحة الصفقة.' }) : null,
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

// صفحة من سجل المراحل، الأحدث أولاً (المعرّف يفصل بين سطرين في اللحظة نفسها فلا تتبدّل الصفحات).
// deal_id في الأعمدة لأن enteredAt تطابق به السطر وصفقته.
function historyPage(dealId, page) {
    const [from, to] = pageRange(page);
    return supabase
        .from('deal_stage_history')
        .select('id, deal_id, from_stage, to_stage, note, changed_by, changed_at', { count: 'exact' })
        .eq('deal_id', dealId)
        .order('changed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
}

// first: الصفحة الأولى كما قرأتها renderDeal مع الصفقة؛ تُعرض كما هي، وما بعدها (أو العودة إليها) يُقرأ من جديد
async function renderHistory(host, deal, stages, names, first = null) {
    const view = { page: 0 };
    let initial = first;
    const stageById = new Map();
    for (const stage of stages) stageById.set(stage.id, stage.name_ar);
    const name = (id) => (id === null || id === undefined ? 'البداية' : (stageById.get(id) || 'مرحلة ' + id));

    async function load() {
        let result = view.page === 0 ? initial : null;
        initial = null;
        if (!result) {
            replace(host, loading());
            result = await Promise.resolve(historyPage(deal.id, view.page)).catch((error) => ({ data: null, error, count: null }));
        }
        const { data, error, count } = result;

        if (!host.isConnected) return;
        if (error) return void replace(host, errorBox(error, 'تعذّر تحميل سجل المراحل', () => load()));
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
