// ‎#/financing‎ — «جهات التمويل» (تبويب في حاسبة التمويل، للمدير): نسب البنوك وجهات التمويل التي تقارن بها الحاسبة.
// المساعد يقرأ صفحة كل جهة من رابطها أسبوعياً، أو حين يضغط المدير «حدّث من المصادر»، ويقترح «معدل النسبة السنوي»
// مع الجملة التي ورد فيها (supabase/functions/agent-run/rates.ts). لا يتغير رقم في الحاسبة قبل أن يعتمده المدير.
// الحساب والتنظيف في financing-model.js؛ هنا العرض والحفظ في crm_settings فقط.

import { supabase } from './supabase.js';
import {
    el, replace, loading, errorBox, empty, pageHead, actionBtn, subTabs, field, input, badge, notify, fail,
    openModal, closeModal, fmtDate, parseNumber, icon
} from './ui.js';
import { TERMS } from './mortgage-calc.js';
import {
    ENTITIES_KEY, PROPOSALS_KEY, cleanEntities, cleanProposals, entityStatus, applyRate, dismissRate, upsertEntity,
    removeEntity, newEntityId, hostOf
} from './financing-model.js';

export const CALC_TABS = [
    { hash: '#/mortgage', label: 'الحاسبة', icon: 'calc' },
    { hash: '#/financing', label: 'جهات التمويل', icon: 'layers' }
];

export async function loadFinancing() {
    const { data, error } = await supabase.from('crm_settings').select('key, value').in('key', [ENTITIES_KEY, PROPOSALS_KEY]);
    if (error) throw error;
    const get = (key) => (data || []).find((row) => row.key === key);
    return { entities: cleanEntities(get(ENTITIES_KEY)?.value), proposals: cleanProposals(get(PROPOSALS_KEY)?.value) };
}

async function saveEntities(entities) {
    const { error } = await supabase.from('crm_settings')
        .upsert([{ key: ENTITIES_KEY, value: entities, updated_at: new Date().toISOString() }], { onConflict: 'key' });
    if (error) throw error;
}

const pct = (x) => String(Math.round(x * 100) / 100) + '%';
const today = () => new Date().toISOString().slice(0, 10);

export async function renderFinancing(root) {
    const refreshBtn = actionBtn('حدّث من المصادر', 'refresh', { onclick: refresh }, true);
    root.appendChild(pageHead('جهات التمويل',
        'نسب البنوك وجهات التمويل في الحاسبة. المساعد يقرأ صفحة كل جهة أسبوعياً ويقترح النسبة، ولا يتغير رقم قبل أن تعتمده.', refreshBtn));
    root.appendChild(subTabs('أقسام حاسبة التمويل', CALC_TABS, '#/financing'));
    const body = el('div');
    root.appendChild(body);
    let state = null;
    await load();

    async function load() {
        replace(body, loading());
        try {
            state = await loadFinancing();
        } catch (error) {
            if (body.isConnected) replace(body, errorBox(error, 'تعذّر تحميل جهات التمويل', load));
            return;
        }
        if (body.isConnected) draw();
    }

    function draw() {
        const now = new Date();
        replace(body, [
            el('section', { class: 'crm-card fin-list' }, [
                el('div', { class: 'crm-card-head' }, [
                    el('h2', { text: 'الجهات' }),
                    el('button', { type: 'button', class: 'link-btn', onclick: () => edit(null) }, [icon('plus'), el('span', { text: 'إضافة جهة' })])
                ]),
                state.entities.length
                    ? el('ul', { class: 'fin-rows' }, state.entities.map((e) => row(e, state.proposals[e.id], entityStatus(e, state.proposals[e.id], now))))
                    : empty('لا جهات بعد', 'أضف بنكاً أو جهة تمويل برابط صفحة منتجها العقاري، فيقرأ المساعد نسبتها.')
            ]),
            el('p', { class: 'fin-note', text: 'المساعد يقرأ من رابط كل جهة «معدل النسبة السنوي» كما تنشره، مع الجملة التي ورد فيها. هذه نسب «تبدأ من» يعلنها البنك، والعرض الفعلي يتحدد براتب العميل وجهة عمله. بعض المواقع لا تسمح للمساعد بالقراءة، فحدّث نسبتها يدوياً من «تعديل».' })
        ]);
    }

    function row(e, p, st) {
        let fresh;
        if (e.rate === null) fresh = badge('بلا نسبة بعد', 'neutral');
        else if (!st.lastAt) fresh = badge('لم تُؤكَّد', 'orange');
        else fresh = el('span', { class: 'fin-when' }, [
            el('span', { text: (st.lastBy === 'agent' ? 'تحقق المساعد ' : 'اعتُمدت ') + fmtDate(st.lastAt) }),
            st.stale ? badge('قديمة', 'orange') : null
        ]);
        return el('li', { class: 'fin-row' + (e.active ? '' : ' is-off') }, [
            el('div', { class: 'fin-head' }, [
                el('strong', { class: 'fin-name', text: e.name }),
                e.active ? null : badge('موقوفة', 'neutral'),
                el('span', { class: 'fin-rate', text: e.rate === null ? '—' : pct(e.rate) })
            ]),
            el('div', { class: 'fin-meta' }, [
                fresh,
                e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer', text: hostOf(e.url) }) : el('span', { text: 'بلا رابط: تُحدَّث يدوياً' }),
                el('button', { type: 'button', class: 'link-btn', text: 'تعديل', onclick: () => edit(e) })
            ]),
            proposal(e, p, st)
        ]);
    }

    function proposal(e, p, st) {
        if (!p || !st.pending) return null;
        if (st.pending === 'rate') {
            return el('div', { class: 'fin-prop' }, [
                el('p', { class: 'fin-prop-title', text: 'اقترح المساعد ' + pct(p.rate) + '، قرأها في ' + fmtDate(p.checkedAt) + ':' }),
                p.quote ? el('blockquote', { class: 'fin-quote', text: p.quote }) : null,
                el('div', { class: 'fin-actions' }, [
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'اعتماد ' + pct(p.rate), onclick: () => approve(e, p.rate, p.quote) }),
                    el('button', { type: 'button', class: 'link-btn', text: 'تجاهل', onclick: () => persist(dismissRate(state.entities, e.id, p.rate), 'تجاهلت الاقتراح') })
                ])
            ]);
        }
        if (st.pending === 'choose') {
            return el('div', { class: 'fin-prop' }, [
                el('p', { class: 'fin-prop-title', text: 'وجد المساعد أكثر من نسبة في الصفحة. اختر نسبة شراء المسكن:' }),
                el('ul', { class: 'fin-cands' }, p.candidates.map((c) => el('li', {}, [
                    el('blockquote', { class: 'fin-quote', text: c.quote }),
                    el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'اعتماد ' + pct(c.rate), onclick: () => approve(e, c.rate, c.quote) })
                ])))
            ]);
        }
        return el('p', { class: 'fin-error', text: p.error + ' (' + fmtDate(p.checkedAt) + ')' });
    }

    function approve(e, rate, quote) {
        return persist(applyRate(state.entities, e.id, rate, quote, today()), 'اعتُمدت ' + pct(rate) + ' لـ«' + e.name + '»');
    }

    async function persist(next, okText) {
        try {
            await saveEntities(next);
        } catch (error) {
            fail(error, 'تعذّر الحفظ');
            return false;
        }
        state.entities = next;
        if (body.isConnected) draw();
        notify(okText);
        return true;
    }

    async function refresh() {
        if (!state) return;
        if (!state.entities.some((e) => e.active && e.url)) {
            notify('أضف رابط صفحة لجهة واحدة على الأقل، ثم اطلب التحديث');
            return;
        }
        refreshBtn.disabled = true;
        const { data, error } = await supabase.functions.invoke('agent-run', { body: { action: 'refresh_rates' } });
        refreshBtn.disabled = false;
        if (error || !data || data.status !== 'accepted') {
            fail(error || new Error((data && data.message) || ''), 'تعذّر تشغيل المساعد');
            return;
        }
        notify('بدأ المساعد قراءة صفحات الجهات. تظهر اقتراحاته هنا خلال دقيقة.');
        setTimeout(() => { if (body.isConnected) load(); }, 45000);
    }

    function edit(e) {
        const base = e || {
            id: newEntityId(state.entities), name: '', url: null, rate: null, cap: TERMS.cap, endAge: TERMS.endAge,
            maxYears: TERMS.maxYears, minDownPct: TERMS.minDownPct, quote: '', confirmedAt: null, dismissedRate: null, active: true
        };
        const val = (v) => (v === null || v === undefined ? '' : String(v));
        const f = {
            name: input({ value: base.name, maxLength: 80, autocomplete: 'off' }),
            url: input({ value: val(base.url), type: 'url', dir: 'ltr', placeholder: 'https://', autocomplete: 'off' }),
            rate: input({ value: val(base.rate), inputMode: 'decimal', placeholder: 'يقرؤها المساعد' }),
            cap: input({ value: val(base.cap), inputMode: 'decimal' }),
            endAge: input({ value: val(base.endAge), inputMode: 'numeric' }),
            maxYears: input({ value: val(base.maxYears), inputMode: 'numeric' }),
            minDownPct: input({ value: val(base.minDownPct), inputMode: 'decimal' }),
            active: el('input', { type: 'checkbox', checked: base.active })
        };
        for (const key of Object.keys(f)) f[key].id = 'fin_' + key;
        const problem = el('p', { class: 'crm-warn', hidden: true });
        let armed = false;
        const removeBtn = e ? el('button', { type: 'button', class: 'link-btn fin-remove', text: 'حذف الجهة', onclick: async () => {
            if (!armed) { armed = true; removeBtn.textContent = 'اضغط مرة ثانية للتأكيد'; return; }
            if (await persist(removeEntity(state.entities, base.id), 'حُذفت «' + base.name + '»')) closeModal();
        } }) : null;

        const form = el('form', { class: 'form-grid fin-form', noValidate: true, onsubmit: async (ev) => {
            ev.preventDefault();
            const name = f.name.value.trim();
            const url = f.url.value.trim();
            const rate = f.rate.value.trim() === '' ? null : parseNumber(f.rate.value);
            const nums = { cap: parseNumber(f.cap.value), endAge: parseNumber(f.endAge.value), maxYears: parseNumber(f.maxYears.value), minDownPct: parseNumber(f.minDownPct.value) };
            let msg = '';
            if (name.length < 2) msg = 'اكتب اسم الجهة';
            else if (url && !/^https:\/\/\S+$/i.test(url)) msg = 'الرابط يبدأ بـ https://';
            else if (rate !== null && !(rate > 0 && rate <= 30)) msg = 'النسبة بين 0 و30';
            else if (!(nums.cap > 0 && nums.cap <= 100) || !(nums.endAge >= 40 && nums.endAge <= 80) || !(nums.maxYears >= 1 && nums.maxYears <= 40) || !(nums.minDownPct >= 0 && nums.minDownPct <= 100)) msg = 'راجع الشروط: الاستقطاع حتى 100، والعمر بين 40 و80، والمدة بين 1 و40';
            problem.textContent = msg;
            problem.hidden = !msg;
            if (msg) return;
            // نسبة كُتبت يدوياً أو تغيّرت: اعتماد بتاريخ اليوم
            const typed = rate !== base.rate;
            const next = {
                ...base, name, url: url || null, ...nums, active: f.active.checked,
                rate, quote: typed ? (rate === null ? '' : 'إدخال يدوي') : base.quote,
                confirmedAt: typed ? (rate === null ? null : today()) : base.confirmedAt,
                dismissedRate: typed ? null : base.dismissedRate
            };
            if (await persist(upsertEntity(state.entities, next), e ? 'حُفظت «' + name + '»' : 'أُضيفت «' + name + '»')) closeModal();
        } }, [
            field('اسم الجهة', f.name, { required: true, span2: true }),
            field('رابط صفحة المنتج', f.url, { span2: true, hint: 'الصفحة الرسمية التي تذكر «معدل النسبة السنوي» للتمويل العقاري. منها يقرأ المساعد' }),
            field('معدل النسبة السنوي %', f.rate, { hint: 'اتركه فارغاً ليقرأه المساعد من الرابط' }),
            field('حد الاستقطاع %', f.cap),
            field('آخر عمر للتمويل', f.endAge),
            field('أقصى مدة (سنوات)', f.maxYears),
            field('أقل دفعة أولى %', f.minDownPct),
            el('label', { class: 'chip fin-active' }, [f.active, el('span', { text: 'مفعّلة في الحاسبة' })]),
            el('div', { class: 'span-2' }, [problem]),
            el('div', { class: 'fin-actions span-2' }, [el('button', { type: 'submit', class: 'btn btn-primary', text: e ? 'حفظ' : 'إضافة' }), removeBtn])
        ]);
        openModal(e ? 'تعديل «' + base.name + '»' : 'إضافة جهة تمويل', form);
    }
}
