// ‎#/settings‎ — إعدادات المطابقة والمدينة الافتراضية (للمدير وحده).
//
// crm_settings مقروء لكل من سجّل دخوله، والكتابة عليه مقصورة على is_admin() في
// سياسات RLS. فإن رفض الخادم عُرض خطؤه كما هو ولا نخفيه خلف رسالة عامة.
//
// الأوزان تُقرأ داخل match_requirement عند كل استدعاء، فتغييرها يظهر في النتيجة
// التالية مباشرة بلا نشر ولا ترحيل.
//
// حدود المساعد اليومية تُقرأ قبل كل نداء نموذج (agent_router_budget في 022_agent_router.sql،
// وwa_triage_daily_usd_cap في 026_wa_triage.sql)، فتغييرها يسري على الطلب التالي. ورقم واتساب
// المكتب يظهر في صفحة العروض للعميل («أنا مهتم») متى أعادته get_client_share (029).

import { supabase } from './supabase.js';
import {
    el, replace, loading, errorBox, field, input, parseNumber,
    notify, fail, number, pageHead, waNumber
} from './ui.js';

// الحدود اليومية: مفتاح crm_settings، والقيمة الافتراضية كما في الترحيل، وأقصى ما يُقبل من الشاشة
const LIMITS = [
    { key: 'agent_daily_usd_cap', label: 'حد صرف المساعد اليومي (دولار)', fallback: 2, max: 50, step: 'any',
      hint: 'إذا بلغه المساعد توقفت طلبات اليوم وتفشل، ويعيد الموظف إرسالها غداً. الدولار ≈ 3.75 ريال.' },
    { key: 'agent_daily_escalations', label: 'حد الانتقال إلى النماذج الأقوى يومياً', fallback: 10, max: 200, step: '1',
      hint: 'عدد المرات التي يُسمح فيها بالنموذج الأغلى في اليوم.' },
    { key: 'wa_triage_daily_usd_cap', label: 'حد صرف فرز واتساب (Jev) اليومي (دولار)', fallback: 0.5, max: 20, step: 'any',
      hint: 'يخص صفحة «عروض واتساب» وحدها.' }
];

// مفاتيح jsonb كما هي في قاعدة البيانات، والنص المقابل للعرض فقط
const WEIGHTS = [
    { key: 'district', label: 'الحي' },
    { key: 'budget', label: 'الميزانية' },
    { key: 'area', label: 'المساحة' },
    { key: 'rooms', label: 'الغرف' },
    { key: 'delivery', label: 'التسليم' }
];

const DEFAULT_WEIGHTS = { district: 35, budget: 30, area: 20, rooms: 10, delivery: 5 };

export async function renderSettings(root) {
    replace(root, loading());

    const { data, error } = await supabase
        .from('crm_settings')
        .select('key, value')
        .in('key', ['match_weights', 'default_city', 'office_whatsapp'].concat(LIMITS.map((l) => l.key)));

    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل الإعدادات'));

    const stored = {};
    for (const row of data || []) stored[row.key] = row.value;

    const weights = Object.assign({}, DEFAULT_WEIGHTS, isObject(stored.match_weights) ? stored.match_weights : {});
    const city = typeof stored.default_city === 'string' ? stored.default_city : '';

    const boxes = WEIGHTS.map((w) => ({
        key: w.key,
        label: w.label,
        node: input({
            inputMode: 'numeric', autocomplete: 'off',
            value: weights[w.key] === null || weights[w.key] === undefined ? '' : String(weights[w.key])
        })
    }));

    const cityInput = input({ value: city, maxLength: 60 });
    const totalLine = el('div', { class: 'crm-subtle' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ الإعدادات' });

    function readWeights() {
        const out = {};
        for (const box of boxes) out[box.key] = parseNumber(box.node.value) || 0;
        return out;
    }

    function total(values) {
        let sum = 0;
        for (const box of boxes) sum += values[box.key];
        return sum;
    }

    // المجموع لا يلزم أن يكون 100: match_requirement تقسم على المجموع أياً كان،
    // فالتنبيه إرشادي. أما المجموع صفراً فقسمة على صفر، وهو وحده ما يمنع الحفظ.
    function refreshTotal() {
        const sum = total(readWeights());
        totalLine.className = sum === 100 ? 'crm-subtle' : 'crm-subtle crm-warn';
        totalLine.textContent = sum === 100
            ? 'المجموع: 100'
            : 'المجموع: ' + number(sum) + ' — المعتاد أن يكون 100، والحفظ مسموح على أي حال.';
    }

    for (const box of boxes) box.node.addEventListener('input', refreshTotal);
    refreshTotal();

    const form = el('form', {}, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'أوزان المطابقة' })]),
            el('div', { class: 'form-grid' }, boxes.map((box) => field(box.label, box.node))),
            totalLine,
            el('div', { class: 'crm-subtle', style: 'margin-top:10px', text: 'التغيير يؤثر على نتائج المطابقة فوراً ولا يحتاج نشراً' })
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'المدينة الافتراضية' })]),
            el('div', { class: 'form-grid' }, [
                field('المدينة', cityInput, { hint: 'تُستعمل للعملاء والطلبات الجديدة حين لا تُذكر مدينة' })
            ]),
            el('div', { class: 'btn-row btn-row-end' }, saveBtn)
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = readWeights();
        const sum = total(values);
        if (sum <= 0) {
            return void notify('مجموع الأوزان صفر — المطابقة تقسم على المجموع فلا يصحّ', 'error', 8000);
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';

        const { data: saved, error: saveError } = await supabase
            .from('crm_settings')
            .upsert(
                [
                    { key: 'match_weights', value: values },
                    { key: 'default_city', value: cityInput.value.trim() }
                ],
                { onConflict: 'key' }
            )
            .select('key');

        saveBtn.disabled = false;
        saveBtn.textContent = 'حفظ الإعدادات';

        if (saveError) return void fail(saveError, 'تعذّر حفظ الإعدادات');
        // صفر صفوف بلا خطأ = RLS رشّحت الصفوف (الكتابة للمدير وحده)
        if (!saved || saved.length === 0) {
            return void notify('لا تملك صلاحية تعديل الإعدادات', 'error', 8000);
        }

        notify('تم حفظ الإعدادات', 'success');
    });

    if (!root.isConnected) return;
    replace(root, [
        pageHead('الإعدادات', 'أوزان المطابقة، والمدينة الافتراضية، وحدود المساعد اليومية، ورقم واتساب المكتب. التغيير يسري فوراً.'),
        form,
        limitsForm(stored),
        officeForm(stored)
    ]);
}

// قراءة رقم من jsonb كما تقرؤه agent_setting_number: رقم أو نص رقمي، وإلا الافتراضي
function storedNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) return Number(value);
    return fallback;
}

function limitsForm(stored) {
    const boxes = LIMITS.map((limit) => ({
        limit,
        node: input({ type: 'number', min: '0', max: String(limit.max), step: limit.step, inputMode: 'decimal',
            value: String(storedNumber(stored[limit.key], limit.fallback)) })
    }));
    const spent = el('div', { class: 'crm-subtle', text: 'صرف المساعد اليوم: جارٍ الحساب…' });
    todaySpend().then((value) => {
        if (!spent.isConnected) return;
        spent.textContent = value === null ? '' : 'صرف المساعد اليوم حتى الآن: ' + value.toFixed(2) + ' دولار.';
    });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ الحدود' });
    const form = el('form', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'حدود المساعد اليومية' })]),
        el('div', { class: 'form-grid' }, boxes.map((box) => field(box.limit.label, box.node, { hint: box.limit.hint }))),
        spent,
        el('div', { class: 'btn-row btn-row-end' }, saveBtn)
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const rows = [];
        for (const box of boxes) {
            const value = parseNumber(box.node.value);
            if (value === null || value < 0 || value > box.limit.max) {
                return void notify('«' + box.limit.label + '» يجب أن يكون بين 0 و' + box.limit.max, 'error', 7000);
            }
            rows.push({ key: box.limit.key, value: box.limit.step === '1' ? Math.round(value) : value });
        }
        await saveRows(saveBtn, 'حفظ الحدود', rows, 'تم حفظ الحدود — تسري على الطلب التالي');
    });
    return form;
}

// صرف اليوم (توقيت الرياض) من سجل نداءات النموذج — مقروء للمدير وحده، فغيره لا يرى سطراً
async function todaySpend() {
    const now = new Date();
    const riyadh = new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000);
    const start = new Date(Date.UTC(riyadh.getFullYear(), riyadh.getMonth(), riyadh.getDate()) - 180 * 60000);
    const { data, error } = await supabase.from('agent_model_calls').select('cost_usd')
        .gte('created_at', start.toISOString()).range(0, 999);
    if (error) return null;
    return (data || []).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
}

function officeForm(stored) {
    const phone = input({ type: 'tel', dir: 'ltr', maxLength: 20, placeholder: '05xxxxxxxx',
        value: typeof stored.office_whatsapp === 'string' ? stored.office_whatsapp : '' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ الرقم' });
    const form = el('form', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [el('h2', { text: 'واتساب المكتب' })]),
        el('div', { class: 'form-grid' }, [
            field('رقم واتساب المكتب', phone, { hint: 'يظهر للعميل في صفحة العروض بزر «أنا مهتم — واتساب». اتركه فارغاً لإخفاء الزر.' })
        ]),
        el('div', { class: 'btn-row btn-row-end' }, saveBtn)
    ]);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = phone.value.trim();
        if (value && !/^9665\d{8}$/.test(waNumber(value))) {
            return void notify('اكتب رقم جوال سعودياً، مثل 0551234567', 'error', 7000);
        }
        await saveRows(saveBtn, 'حفظ الرقم', [{ key: 'office_whatsapp', value: value ? waNumber(value) : '' }], 'تم حفظ رقم واتساب المكتب');
    });
    return form;
}

async function saveRows(button, label, rows, done) {
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ…';
    const { data, error } = await supabase.from('crm_settings').upsert(rows, { onConflict: 'key' }).select('key');
    button.disabled = false;
    button.textContent = label;
    if (error) return void fail(error, 'تعذّر الحفظ');
    if (!data || data.length === 0) return void notify('لا تملك صلاحية تعديل الإعدادات', 'error', 8000);
    notify(done, 'success');
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
