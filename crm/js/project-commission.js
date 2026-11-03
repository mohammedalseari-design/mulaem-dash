// نافذة «عمولة المشروع» (للمدير): نسبة المشروع (العامة أو خاصة) و«مبلغ محدد» لأي نموذج، في مكان واحد.
// تُفتح من عمود العمولة في «العقارات» ومن بطاقة العمولة في «الإعدادات». الحفظ عبر دوال 037 التي تتحقق أن الكاتب مدير:
// set_project_commission (null = يرجع للعامة) و set_unit_commission (null = يمسح المبلغ المحدد).
// المعاينة هنا (العمولة بالنسبة وهي تُكتب) للعين فقط؛ الرقم المعتمد تحسبه القاعدة في v_units.

import { supabase } from './supabase.js';
import { sanitizeSearch } from './data.js';
import { el, replace, loading, errorBox, empty, openModal, closeModal, input, notify, fail, money, parseNumber, icon } from './ui.js';
import { parseRate, formatRate, commissionAt, overrideChange } from './commission-rate.js';

async function rpcOk(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    if (!data || data.ok !== true) {
        const code = data && data.code;
        throw new Error(code === 'forbidden' ? 'هذا للمدير فقط' : code === 'bad_value' ? 'القيمة خارج المسموح' : code === 'not_found' ? 'لم يُعثر على المشروع أو النموذج' : 'رفضت القاعدة الحفظ');
    }
    return data;
}

export async function loadPolicy() {
    const { data, error } = await supabase.from('commission_policy').select('default_rate, show_to_staff').maybeSingle();
    if (error) throw error;
    return { defaultRate: data ? Number(data.default_rate) : 2.5, showToStaff: Boolean(data && data.show_to_staff) };
}

// onSaved يُستدعى بعد حفظ ناجح (لإعادة تحميل الصفحة التي فتحت النافذة)
export async function openProjectCommission(projectId, onSaved = null) {
    const body = el('div', { class: 'pc' }, loading());
    openModal('عمولة المشروع', body);

    let policy, projectRate, units;
    try {
        const [p, pr, u] = await Promise.all([
            loadPolicy(),
            supabase.from('project_commission').select('rate').eq('project_id', projectId).maybeSingle(),
            supabase.from('v_units').select('project_name, district, unit_ord, unit_key, price, unit_commission, unit_commission_source')
                .eq('project_id', projectId).order('unit_ord', { ascending: true })
        ]);
        if (pr.error) throw pr.error;
        if (u.error) throw u.error;
        policy = p;
        projectRate = pr.data ? Number(pr.data.rate) : null;
        units = u.data || [];
    } catch (error) {
        if (body.isConnected) replace(body, errorBox(error, 'تعذّر تحميل عمولة المشروع', () => openProjectCommission(projectId, onSaved)));
        return;
    }
    if (!body.isConnected) return;
    if (!units.length) return void replace(body, empty('لا وحدات لهذا المشروع', 'أضف النماذج من صفحة المشاريع أولاً.'));

    let mode = projectRate === null ? 'default' : 'project';
    const head = el('p', { class: 'pc-project' }, [
        el('strong', { text: units[0].project_name || ('عقار #' + projectId) }),
        units[0].district ? el('span', { text: ' · ' + units[0].district }) : null
    ]);

    const rateBox = input({ inputMode: 'decimal', autocomplete: 'off', class: 'pc-rate', 'aria-label': 'نسبة المشروع',
        value: projectRate === null ? '' : String(projectRate), placeholder: String(policy.defaultRate) });
    const segDefault = el('button', { type: 'button', text: 'النسبة العامة (' + formatRate(policy.defaultRate) + ')', onclick: () => setMode('default') });
    const segProject = el('button', { type: 'button', text: 'نسبة خاصة', onclick: () => setMode('project') });
    const seg = el('div', { class: 'pc-seg', role: 'group', 'aria-label': 'نوع النسبة' }, [segDefault, segProject]);
    const rateRow = el('div', { class: 'pc-rate-row' }, [el('label', { for: rateBox.id || (rateBox.id = 'pcRate'), text: 'النسبة' }), rateBox, el('span', { text: '٪' })]);

    function effectiveRate() {
        if (mode === 'default') return policy.defaultRate;
        const r = parseRate(rateBox.value);
        return r === null || Number.isNaN(r) ? null : r;
    }

    // النماذج: «كامل العقار» (unit_ord 0) بلا مبلغ محدد، تُحسب بالنسبة دائماً
    const rows = units.map((u) => {
        const before = u.unit_commission_source === 'override' ? Number(u.unit_commission) : null;
        const computed = el('span', { class: 'pc-calc' });
        const box = u.unit_ord > 0
            ? input({ inputMode: 'numeric', autocomplete: 'off', class: 'pc-amount', 'aria-label': 'مبلغ محدد لـ' + u.unit_key,
                value: before === null ? '' : String(before), placeholder: 'بالنسبة' })
            : null;
        const clear = box ? el('button', { type: 'button', class: 'link-btn pc-clear', text: 'امسح', hidden: before === null,
            onclick: () => { box.value = ''; refresh(); box.focus(); } }) : null;
        if (box) box.addEventListener('input', refresh);
        return { u, before, computed, box, clear,
            node: el('tr', {}, [
                el('th', { scope: 'row' }, [el('span', { class: 'pc-name', text: u.unit_key }),
                    el('small', { text: u.price > 0 ? money(u.price) + ' ر.س' : 'بلا سعر' })]),
                el('td', { class: 'num' }, computed),
                el('td', { class: 'pc-amount-cell' }, box ? [box, clear] : el('span', { class: 'pr-none', text: '—' }))
            ]) };
    });

    function refresh() {
        const rate = effectiveRate();
        rateBox.disabled = mode === 'default';
        segDefault.setAttribute('aria-pressed', String(mode === 'default'));
        segProject.setAttribute('aria-pressed', String(mode === 'project'));
        rateRow.classList.toggle('is-off', mode === 'default');
        for (const r of rows) {
            const typed = r.box ? r.box.value.trim() : '';
            const value = typed ? parseNumber(typed) : null;
            const byRate = commissionAt(r.u.price, rate);
            r.computed.textContent = typed
                ? (value === null ? '—' : money(value) + ' ر.س (محدد)')
                : (byRate === null ? '—' : money(byRate) + ' ر.س');
            if (r.clear) r.clear.hidden = !typed;
        }
    }
    function setMode(next) {
        mode = next;
        refresh();
        if (mode === 'project') rateBox.focus();
    }
    rateBox.addEventListener('input', refresh);

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: 'حفظ' });
    const form = el('form', { class: 'pc-form' }, [
        head,
        policy.showToStaff ? null : el('p', { class: 'crm-subtle pc-note' }, [icon('key'), el('span', { text: 'الوسطاء ما يشوفون هذي الأرقام: «إظهار العمولة للوسطاء» مطفي في الإعدادات.' })]),
        el('div', { class: 'pc-block' }, [el('strong', { text: 'نسبة هذا المشروع' }), seg, rateRow]),
        el('div', { class: 'crm-table-wrap' }, el('table', { class: 'crm-table pc-table' }, [
            el('thead', {}, el('tr', {}, [
                el('th', { scope: 'col', text: 'النموذج' }),
                el('th', { scope: 'col', text: 'العمولة' }),
                el('th', { scope: 'col', text: 'مبلغ محدد (اختياري)' })
            ])),
            el('tbody', {}, rows.map((r) => r.node))
        ])),
        el('p', { class: 'crm-subtle', text: 'اترك «مبلغ محدد» فارغاً لتُحسب عمولة النموذج من نسبة المشروع.' }),
        el('div', { class: 'btn-row btn-row-end' }, saveBtn)
    ]);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const newRate = mode === 'default' ? null : parseRate(rateBox.value);
        if (mode === 'project' && (newRate === null || Number.isNaN(newRate))) {
            rateBox.focus();
            return void notify('اكتب نسبة المشروع رقماً من 0 إلى 100، مثل 2.5', 'error', 7000);
        }
        const changes = [];
        for (const r of rows) {
            if (!r.box) continue;
            const change = overrideChange(r.before, r.box.value, parseNumber);
            if (Number.isNaN(change)) {
                r.box.focus();
                return void notify('المبلغ المحدد لـ«' + r.u.unit_key + '» ليس رقماً صحيحاً', 'error', 7000);
            }
            if (change !== undefined) changes.push({ ord: r.u.unit_ord, amount: change });
        }
        const rateChanged = (newRate === null ? null : newRate) !== projectRate;
        if (!rateChanged && !changes.length) return void closeModal();

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        try {
            if (rateChanged) await rpcOk('set_project_commission', { p_project: projectId, p_rate: newRate });
            for (const c of changes) {
                await rpcOk('set_unit_commission', { p_project: projectId, p_unit_ord: c.ord, p_commission: c.amount });
            }
        } catch (error) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'حفظ';
            return void fail(error, 'تعذّر حفظ العمولة');
        }
        closeModal();
        notify('تم حفظ عمولة المشروع', 'success');
        if (onSaved) onSaved();
    });

    replace(body, form);
    refresh();
}

// «+ نسبة خاصة لمشروع» في الإعدادات: ابحث عن المشروع ثم تُفتح نافذته
export function pickProjectForCommission(onSaved = null) {
    const search = input({ type: 'search', class: 'crm-search', placeholder: 'اكتب اسم المشروع أو الحي…', autocomplete: 'off',
        'aria-label': 'بحث عن مشروع' });
    const results = el('div', { class: 'pc-results' });
    let seq = 0;
    let timer = null;
    async function run() {
        const term = sanitizeSearch(search.value);
        const mine = ++seq;
        if (term.length < 2) return void replace(results, el('p', { class: 'crm-subtle', text: 'اكتب حرفين على الأقل.' }));
        replace(results, loading());
        const { data, error } = await supabase.from('projects').select('id, name, district')
            .eq('status', 'approved').is('deleted_at', null)
            .or('name.ilike.%' + term + '%,district.ilike.%' + term + '%')
            .order('name', { ascending: true }).limit(12);
        if (mine !== seq || !results.isConnected) return;
        if (error) return void replace(results, errorBox(error, 'تعذّر البحث'));
        if (!data || !data.length) return void replace(results, el('p', { class: 'crm-subtle', text: 'لا مشروع بهذا الاسم.' }));
        replace(results, el('ul', { class: 'pc-pick' }, data.map((p) => el('li', {}, el('button', {
            type: 'button', class: 'pc-pick-btn',
            onclick: () => openProjectCommission(p.id, onSaved)
        }, [el('strong', { text: p.name || ('عقار #' + p.id) }), p.district ? el('span', { text: p.district }) : null])))));
    }
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
    openModal('نسبة خاصة لمشروع', [search, results], { narrow: true });
    replace(results, el('p', { class: 'crm-subtle', text: 'اختر المشروع، ثم اكتب نسبته.' }));
}
