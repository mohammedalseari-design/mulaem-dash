// بطاقة العمولة في صفحة الصفقة، ونموذج تحريرها للمدير.
//
// الصف نفسه ينشئه المشغّل عند وصول صفقة ذات قيمة إلى مرحلة "تمت"، ولا تُنشئه
// الواجهة. والحقول المحسوبة (gross_amount, vat_amount) تولّدها قاعدة البيانات
// ولا تُرسل أبداً؛ ما في النموذج من حساب حيّ عرضٌ مسبق لا أكثر.
//
// الحالة تُشتق من التحصيل (partial / collected) إلا "معفاة"، فالمدير لا يختار
// إلا بين "مشتقة" و"صدرت فاتورة" و"معفاة" (commissions_guard).
//
// القراءة متاحة لوسيط الصفقة (سياسة commissions_select عبر crm_can_see_deal)،
// والكتابة للمدير وحده — وإن حاول غيره ردّت القاعدة ولم نُظهر "تم".
//
// needs_review: تعديل قيمة صفقة عمولتها عليها مال محصَّل لا يغيّر السجل المالي،
// بل يرفع هذا العلم ويُسجَّل commission_base_mismatch (009_hardening.sql). المدير
// هو من يقرّر: يعدّل الأرقام يدوياً ثم يُنهي المراجعة.

import { supabase } from './supabase.js';
import { isAdmin } from './auth.js';
import { COMMISSION_STATUS, COMMISSION_STATUS_TONE, COMMISSION_STATUS_EDITABLE, label } from './labels.js';
import {
    el, replace, loading, empty, errorBox, badge, field, input, select, optionList,
    moneyInput, parseNumber, openModal, closeModal, money, number, fmtDate, dash, notify, fail
} from './ui.js';

export async function renderCommission(host, deal) {
    const body = el('div');
    replace(host, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'العمولة' })]),
        body
    ]));

    async function load() {
        replace(body, loading());
        const { data, error } = await supabase
            .from('commissions')
            .select('*')
            .eq('deal_id', deal.id)
            .maybeSingle();

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل العمولة'));
        if (!data) {
            return void replace(body, empty('لا توجد عمولة لهذه الصفقة — تُسجَّل تلقائياً عند إتمامها بقيمة معلومة'));
        }
        replace(body, card(data, deal, load));
    }

    await load();
}

export const REVIEW_BADGE = 'الأساس تغيّر — يحتاج مراجعة';
const REVIEW_WHY = 'قيمة الصفقة عُدِّلت بعد تسجيل مال على هذه العمولة، فلم يُمسّ السجل المالي.';
const REVIEW_HINT_ADMIN = REVIEW_WHY + ' راجع الأرقام ثم أنهِ المراجعة.';
const REVIEW_HINT_READER = REVIEW_WHY + ' المراجعة على المدير.';

// الزر للمدير وحده، ولا يظهر إلا والعلم مرفوع
function reviewedButton(commission, reload) {
    const button = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تمت المراجعة' });
    button.addEventListener('click', async () => {
        button.disabled = true;
        const { data, error } = await supabase
            .from('commissions')
            .update({ needs_review: false })
            .eq('id', commission.id)
            .select('id');
        button.disabled = false;

        if (error) return void fail(error, 'تعذّر إنهاء المراجعة');
        // صفر صفوف بلا خطأ = RLS رشّحت الصف (الكتابة للمدير وحده)
        if (!data || data.length === 0) return void notify('لا تملك صلاحية تعديل العمولات', 'error', 8000);
        notify('تمت المراجعة', 'success');
        reload();
    });
    return button;
}

function card(commission, deal, reload) {
    const outstanding = Math.max(0, Number(commission.gross_amount || 0) - Number(commission.collected_amount || 0));

    const kv = (title, value) => el('div', { class: 'kv' }, [
        el('span', { text: title }),
        el('span', {}, value instanceof Node ? value : document.createTextNode(dash(value)))
    ]);

    const rows = [
        kv('أساس الاحتساب', money(commission.base_amount) + ' ريال'),
        kv('النسبة', number(commission.rate_percent) + '%'),
        kv('إجمالي العمولة', money(commission.gross_amount) + ' ريال'),
        kv('ضريبة القيمة المضافة (' + number(commission.vat_rate) + '%)', money(commission.vat_amount) + ' ريال'),
        kv('حصة الشركة', money(commission.company_share) + ' ريال'),
        kv('حصة الوسيط', money(commission.broker_share) + ' ريال'),
        kv('حصة خارجية', money(commission.external_share) + ' ريال'),
        kv('الطرف الخارجي', commission.external_party),
        kv('الحالة', badge(label(COMMISSION_STATUS, commission.status), COMMISSION_STATUS_TONE[commission.status] || 'neutral')),
        kv('المحصَّل', money(commission.collected_amount) + ' ريال'),
        kv('المتبقي', money(outstanding) + ' ريال'),
        kv('تاريخ التحصيل', commission.collected_at ? fmtDate(commission.collected_at) : null),
        kv('رقم الفاتورة', commission.invoice_no)
    ];

    return [
        commission.needs_review
            ? el('div', { class: 'crm-error', style: 'margin-bottom:12px' }, [
                badge(REVIEW_BADGE, 'orange'),
                el('div', {
                    class: 'tl-body', style: 'margin-top:8px',
                    text: isAdmin() ? REVIEW_HINT_ADMIN : REVIEW_HINT_READER
                })
            ])
            : null,
        isAdmin()
            ? el('div', { class: 'btn-row btn-row-end', style: 'margin-bottom:10px' }, [
                commission.needs_review ? reviewedButton(commission, reload) : null,
                el('button', {
                    type: 'button', class: 'btn btn-secondary btn-sm', text: 'تعديل العمولة',
                    onclick: () => openCommissionForm(deal, commission, reload)
                })
            ])
            : el('div', { class: 'crm-subtle', style: 'margin-bottom:10px', text: 'العرض للقراءة فقط — تحرير العمولة للمدير.' }),
        el('div', { class: 'kv-grid', style: 'margin-top:0;padding-top:0;border-top:0' }, rows),
        commission.notes
            ? el('div', { class: 'kv', style: 'margin-top:16px' }, [
                el('span', { text: 'ملاحظات' }),
                el('span', { class: 'tl-body', text: commission.notes })
            ])
            : null
    ];
}

/* ===================== نموذج التحرير (للمدير) ===================== */

export function openCommissionForm(deal, commission, onSaved) {
    const base = Number(commission.base_amount || 0);
    const vatRate = Number(commission.vat_rate || 0);

    const rate = input({
        inputMode: 'decimal', autocomplete: 'off', class: 'crm-money',
        value: commission.rate_percent === null || commission.rate_percent === undefined ? '' : String(commission.rate_percent)
    });
    const companyShare = moneyInput({ value: commission.company_share || '' });
    const brokerShare = moneyInput({ value: commission.broker_share || '' });
    const externalShare = moneyInput({ value: commission.external_share || '' });
    const externalParty = input({ value: commission.external_party || '', maxLength: 120 });
    const collected = moneyInput({ value: commission.collected_amount || '' });
    const invoiceNo = input({ value: commission.invoice_no || '', maxLength: 60 });
    const notes = el('textarea', { value: commission.notes || '', rows: 3 });
    const status = select(
        optionList(COMMISSION_STATUS_EDITABLE),
        commission.status === 'invoiced' || commission.status === 'waived' ? commission.status : 'due'
    );

    // عرض مسبق فقط: القيم النهائية تحسبها قاعدة البيانات بعد الحفظ
    const preview = el('div', { class: 'crm-subtle' });

    function grossPreview() {
        const value = parseNumber(rate.value);
        return value === null ? 0 : Math.round(base * value) / 100;
    }

    function refreshPreview() {
        const gross = grossPreview();
        const vat = Math.round(gross * vatRate) / 100;
        const shares = (parseNumber(companyShare.value) || 0) + (parseNumber(brokerShare.value) || 0)
            + (parseNumber(externalShare.value) || 0);
        const collectedValue = parseNumber(collected.value) || 0;

        const over = shares > gross + 0.01;
        const overCollected = collectedValue > gross + 0.01;
        preview.className = 'crm-subtle' + (over || overCollected ? ' crm-warn' : '');
        preview.textContent = 'إجمالي العمولة: ' + money(gross) + ' ريال · الضريبة: ' + money(vat)
            + ' ريال · مجموع الحصص: ' + money(shares) + ' ريال · المحصَّل: ' + money(collectedValue) + ' ريال'
            + (over ? ' — الحصص تتجاوز الإجمالي، والقاعدة سترفض الحفظ' : '')
            + (overCollected ? ' — المحصَّل يتجاوز الإجمالي، والقاعدة سترفض الحفظ' : '');
    }

    for (const node of [rate, companyShare, brokerShare, externalShare, collected]) {
        node.addEventListener('input', refreshPreview);
        node.addEventListener('blur', refreshPreview);
    }
    refreshPreview();

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ العمولة' });
    const form = el('form', {}, [
        el('div', {
            class: 'crm-subtle', style: 'margin-bottom:14px',
            text: 'أساس الاحتساب ' + money(base) + ' ريال، وهو قيمة الصفقة ولا يُحرَّر هنا.'
        }),
        el('div', { class: 'form-grid' }, [
            field('النسبة %', rate, { required: true }),
            field('الحالة', status, { hint: 'الجزئي والمحصَّل يُشتقّان من المبلغ المحصَّل' }),
            field('حصة الشركة (ريال)', companyShare),
            field('حصة الوسيط (ريال)', brokerShare),
            field('حصة خارجية (ريال)', externalShare),
            field('الطرف الخارجي', externalParty),
            field('المحصَّل (ريال)', collected),
            field('رقم الفاتورة', invoiceNo),
            field('ملاحظات', notes, { span2: true })
        ]),
        preview,
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const rateValue = parseNumber(rate.value);
        if (rateValue === null || rateValue <= 0) return void notify('أدخل نسبة العمولة', 'error');

        const gross = grossPreview();
        const shares = (parseNumber(companyShare.value) || 0) + (parseNumber(brokerShare.value) || 0)
            + (parseNumber(externalShare.value) || 0);
        const collectedValue = parseNumber(collected.value) || 0;
        // القيدان commissions_shares_balance و commissions_collected_range يرفضان
        // هذا برمز 23514؛ نمنعه هنا برسالة مفهومة بدل خطأ قاعدة بيانات
        if (shares > gross + 0.01) return void notify('مجموع الحصص يتجاوز إجمالي العمولة', 'error', 8000);
        if (collectedValue > gross + 0.01) return void notify('المبلغ المحصَّل يتجاوز إجمالي العمولة', 'error', 8000);

        const payload = {
            rate_percent: rateValue,
            company_share: parseNumber(companyShare.value) || 0,
            broker_share: parseNumber(brokerShare.value) || 0,
            external_share: parseNumber(externalShare.value) || 0,
            external_party: externalParty.value.trim() || null,
            collected_amount: collectedValue,
            invoice_no: invoiceNo.value.trim() || null,
            notes: notes.value.trim() || null,
            status: status.value
        };

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        const { data, error } = await supabase
            .from('commissions')
            .update(payload)
            .eq('id', commission.id)
            .select('id');
        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ العمولة';

        if (error) return void fail(error, 'تعذّر حفظ العمولة');
        // صفر صفوف بلا خطأ = RLS رشّحت الصف (الكتابة للمدير وحده)
        if (!data || data.length === 0) return void notify('لا تملك صلاحية تعديل العمولات', 'error', 8000);

        closeModal();
        notify('تم حفظ العمولة', 'success');
        if (onSaved) onSaved();
    });

    openModal('تعديل العمولة' + (deal && deal.client ? ' — ' + deal.client.full_name : ''), form);
}
