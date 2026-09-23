// ‎#/settings‎ — إعدادات المطابقة والمدينة الافتراضية (للمدير وحده).
//
// crm_settings مقروء لكل من سجّل دخوله، والكتابة عليه مقصورة على is_admin() في
// سياسات RLS. فإن رفض الخادم عُرض خطؤه كما هو ولا نخفيه خلف رسالة عامة.
//
// الأوزان تُقرأ داخل match_requirement عند كل استدعاء، فتغييرها يظهر في النتيجة
// التالية مباشرة بلا نشر ولا ترحيل.

import { supabase } from './supabase.js';
import {
    el, replace, loading, errorBox, field, input, parseNumber,
    notify, fail, number
} from './ui.js';

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
        .in('key', ['match_weights', 'default_city']);

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
    replace(root, form);
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
