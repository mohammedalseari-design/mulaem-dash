// صفحة الصفقة: بطاقة «مسار الصفقة» محسوبةً بلا DOM ولا شبكة، فتُختبر وحدها (tests/deal-page-model.test.mjs).
// القواعد كلها من deal-path.js (الترتيب، التالية والسابقة، متى دخلت الصفقة مرحلتها، «واقفة»، حالة العمولة ومبلغها
// المتوقع)؛ هذا الملف يرتّبها للشاشة: حالة كل خطوة، وسطر المدة فوق المسار، والإجراءات المسموحة في كل حالة، وصندوق
// العمولة الصغير. ما يرفضه الخادم لا يُعرض أصلاً: صفقة «تمت» يعيد فتحها المدير وحده (034)، و«خسرت» تحتاج سبباً،
// و«تمت» تحتاج السعر النهائي (منه تُنشأ العمولة).

import {
    openStages, wonStage, lostStage, stageOf, nextStage, prevStage, enteredAt, daysSince, isStuck, STUCK_DAYS,
    commissionState, COMMISSION_STATE_TEXT, COMMISSION_STATE_TONE, expectedCommission, daysText
} from './deal-path.js';
import { formatRate } from './commission-rate.js';
import { COMMISSION_STATUS } from './labels.js';

const NUM = new Intl.NumberFormat('en-US');

// المبالغ في هذه البطاقة بـ«ر.س»: الصندوق صغير، وسطره الواحد يجمع النسبة والأساس
export function sar(value) {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? NUM.format(n) + ' ر.س' : '—';
}

/* ===================== خطوات المسار ===================== */

// ترتيب الخطوات المعروضة: المراحل الجارية ثم «تمت». «خسرت» ليست خطوة: هي حالة تُكتب فوق المسار.
export function pathOrder(stages) {
    const won = wonStage(stages);
    return won ? openStages(stages).concat([won]) : openStages(stages);
}

// status: open | won | lost | unknown (مرحلة لا تُعرف). state لكل خطوة:
// done = مرّت بها، current = هي فيها، todo = لم تصلها، won = «تمت» وقد تمّت، off = خسرت فالمسار كله رمادي.
// الخاسرة لا تُلوَّن خطواتها «منجزة»: «خسرت» آخر المراحل ترتيباً، فكانت كل المراحل قبلها تبدو كأن الصفقة مرّت بها.
export function pathSteps(stages, stageId) {
    const list = pathOrder(stages);
    const current = stageOf(stages, stageId);
    const status = !current ? 'unknown' : !current.is_terminal ? 'open' : current.is_won ? 'won' : 'lost';
    const at = status === 'open' ? list.indexOf(current) : -1;
    const steps = list.map((s, i) => {
        let state = 'todo';
        if (status === 'lost') state = 'off';
        else if (status === 'won') state = s.is_won ? 'won' : 'done';
        else if (status === 'open') state = i < at ? 'done' : i === at ? 'current' : 'todo';
        return { id: s.id, n: i + 1, name: s.name_ar, state, final: Boolean(s.is_won) };
    });
    return { status, steps };
}

// رقم «خسرت» في deal_stages (007)، كما في moveTo بصفحة الصفقة. حالة «خسرت» (سببها وملاحظتها) تُعرض بالمراحل، فإن
// تعذّر تحميلها (status: unknown) فبرقم المرحلة وحده كما كانت الترويسة تعرضها: لا يختفي السبب مع قائمة المراحل.
export const LOST_STAGE_ID = 7;
export function showLost(model, stageId) {
    if (!model) return false;
    return model.status === 'lost' || (model.status === 'unknown' && Number(stageId) === LOST_STAGE_ID);
}

/* ===================== المدة في المرحلة ===================== */

// أيام التقويم بتوقيت الجهاز بين وقتٍ ما والآن (كما dayText في ui.js): 0 = اليوم نفسه، 1 = أمس ولو قبل ساعات.
// بها يُكتب السطر، فلا يُكتب «اليوم» لما كان مساء أمس. «واقفة» تبقى بالأيام الكاملة (daysSince) فلا يتغير حدّها.
export function calendarDays(iso, now = Date.now()) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const midnight = (ms) => new Date(ms).setHours(0, 0, 0, 0);
    // round لا floor: يوم تغيير الساعة الصيفية 23 أو 25 ساعة
    const days = Math.round((midnight(now) - midnight(t)) / 86400000);
    return days < 0 ? 0 : days;
}

// «اليوم» و«أمس» بأسمائهما، وبعد «من» و«قبل» يُجرّ المثنى: daysText تكتب «يومان» وهي صحيحة وحدها، وهنا «من يومين»
function dayWord(days) {
    if (days === 0) return 'اليوم';
    if (days === 1) return 'أمس';
    return days === 2 ? 'يومين' : daysText(days);
}

// من أي مرحلة خسرت الصفقة: السطر الذي أدخلها «خسرت» (أحدثها، بوقته من enteredAt) ومرحلته السابقة.
// null لغير الخاسرة، أو حين لا يُعرف السطر، أو حين جاءت من مرحلة مغلقة.
export function lostFrom(stages, deal, history) {
    const current = deal ? stageOf(stages, deal.stage_id) : null;
    if (!current || !current.is_terminal || current.is_won) return null;
    // صفقة بلا تاريخ إنشاء: enteredAt لا ترجع إلا وقت السطر نفسه
    const at = enteredAt({ id: deal.id, stage_id: deal.stage_id }, history);
    if (!at) return null;
    const row = (history || []).find((h) => h && String(h.deal_id) === String(deal.id)
        && Number(h.to_stage) === Number(current.id) && h.changed_at === at);
    const from = row && row.from_stage !== null && row.from_stage !== undefined ? stageOf(stages, row.from_stage) : null;
    return from && !from.is_terminal ? from : null;
}

// السطر فوق المسار: «في «تفاوض» من 6 أيام» للجارية (أحمر مع «واقفة» بعد STUCK_DAYS)، و«تمّت قبل 3 أيام»، و«خسرت قبل
// يومين وهي في «تفاوض»». history: صفوف deal_stage_history للصفقة، أو null إن تعذّرت قراءتها. المغلقة بلا سطرها في
// السجل تكفيها closed_at (يكتبها الخادم لحظة دخول المرحلة النهائية) لا تاريخ إنشائها. والجارية بلا سجل لا يُكتب لها
// شيء: تاريخ إنشائها ليس تاريخ دخولها مرحلتها، والرقم الخاطئ أسوأ من غيابه.
// النص بأيام التقويم («من أمس» لما دخلتها مساء أمس)، وdays والحكم «واقفة» بالأيام الكاملة (حدّ isStuck كما هو).
export function sinceLine(stages, deal, history, now = Date.now()) {
    const stage = deal ? stageOf(stages, deal.stage_id) : null;
    if (!stage) return null;
    const entered = stage.is_terminal
        ? (history && enteredAt({ id: deal.id, stage_id: deal.stage_id }, history)) || deal.closed_at || null
        : (history ? enteredAt(deal, history) : null);
    const days = entered ? daysSince(entered, now) : null;
    const dates = entered ? calendarDays(entered, now) : null;
    if (days === null || dates === null) return null;
    if (!stage.is_terminal) {
        const stuck = isStuck(stage, days);
        return {
            text: 'في «' + stage.name_ar + '» من ' + dayWord(dates),
            days,
            stuck,
            flag: stuck ? 'واقفة' : null,
            title: stuck ? 'مضى عليها أكثر من ' + daysText(STUCK_DAYS) + ' في هذه المرحلة' : null
        };
    }
    const from = stage.is_won ? null : lostFrom(stages, deal, history);
    return {
        // «تمّت اليوم» و«تمّت أمس» ثم «تمّت قبل يومين» (لا «قبل أمس»: معناها اليوم الذي قبله)
        text: (stage.is_won ? 'تمّت' : 'خسرت') + (dates > 1 ? ' قبل ' : ' ') + dayWord(dates)
            + (from ? ' وهي في «' + from.name_ar + '»' : ''),
        days,
        stuck: false,
        flag: null,
        title: null
    };
}

/* ===================== الإجراءات ===================== */

// نصوص الصفقة المغلقة كما كانت في بطاقة المرحلة: تقول القاعدة قبل الضغط
export const LOCKED_NOTE = 'الصفقة مغلقة («تمت»). إعادة فتحها وتعديل قيمتها للمدير فقط.';
export const REOPEN_WON_NOTE = 'الصفقة مغلقة («تمت»). لإعادة فتحها اختر مرحلة: تُلغى عمولتها إن لم يُحصَّل منها شيء، وإلا تُعلَّم «تحتاج مراجعة».';
export const REOPEN_LOST_NOTE = 'الصفقة مغلقة («خسرت»). لإعادة فتحها اختر مرحلة، ثم تُغلق بـ«تمت» أو «خسرت» من جديد.';
export const PICK_NOTE = 'اختر المرحلة التي وصلت إليها الصفقة فعلاً، ولو تخطّت مرحلة. «تمت» تطلب السعر النهائي.';

// ما تحت المسار. الجارية: زر رئيسي واحد للمرحلة التالية («تمّت الصفقة…» حين تكون التالية «تمت»: نموذج السعر النهائي)،
// وروابط نصية: «رجّعها مرحلة» (لا تظهر في الأولى)، و«مرحلة أخرى…» لمن تخطّت مرحلة (كانت كل المراحل أزراراً قبل هذا
// التصميم، فلا يضيع القفز ولا تُسجَّل مراحل لم تحدث)، و«سجّلها «خسرت»» (نموذج السبب).
// المغلقة تُعاد إلى مرحلة جارية أولاً، فلا تُتمّ خاسرة بضغطة ولا تُقلب «تمت» خاسرة، و«تمت» يعيد فتحها المدير وحده (034):
// لغيره ملاحظة فقط.
export function pathActions(stages, stageId, admin) {
    const current = stageOf(stages, stageId);
    const result = { primary: null, back: null, other: null, lose: null, reopen: null, note: null };
    if (current && current.is_terminal) {
        if (current.is_won && !admin) result.note = LOCKED_NOTE;
        else result.reopen = { text: 'أعد فتحها…', title: 'إعادة فتح الصفقة', note: current.is_won ? REOPEN_WON_NOTE : REOPEN_LOST_NOTE, stages: openStages(stages) };
        return result;
    }
    const next = current ? nextStage(stages, current.id) : null;
    const prev = current ? prevStage(stages, current.id) : null;
    const lost = lostStage(stages);
    const others = pathOrder(stages).filter((s) => !current || Number(s.id) !== Number(current.id));
    if (next) result.primary = { stage: next, won: Boolean(next.is_won), text: next.is_won ? 'تمّت الصفقة…' : 'انقل إلى: ' + next.name_ar };
    if (prev) result.back = { stage: prev, text: 'رجّعها مرحلة', target: 'إلى «' + prev.name_ar + '»' };
    if (others.length) result.other = { text: 'مرحلة أخرى…', title: 'انقل الصفقة إلى مرحلة', note: PICK_NOTE, stages: others };
    if (lost) result.lose = { stage: lost, text: 'سجّلها «خسرت»' };
    return result;
}

/* ===================== صندوق العمولة ===================== */

// أساس العمولة المتوقعة: قيمة الصفقة إن كُتبت، وإلا سعر الوحدة المعروض في المخزون. null حين لا يوجد أيٌّ منهما.
export function commissionBase(amount, unitPrice) {
    const a = Number(amount);
    if (amount !== null && amount !== '' && Number.isFinite(a) && a > 0) return { base: a, from: 'deal' };
    const p = Number(unitPrice);
    if (unitPrice !== null && unitPrice !== '' && Number.isFinite(p) && p > 0) return { base: p, from: 'unit' };
    return null;
}

// أي صف من v_units يُقرأ منه سعر الوحدة: الوحدة باسمها في مشروع الصفقة، أو صف «كامل العقار» (unit_ord 0) حين لا وحدة.
// لا يُؤخذ أول نموذج بدلاً منها: صفقة على مشروع بعدة نماذج بلا وحدة لا سعر واحداً لها. null بلا مشروع.
export function unitPriceKey(deal) {
    if (!deal || deal.project_id === null || deal.project_id === undefined || deal.project_id === '') return null;
    const key = String(deal.unit_key || '').trim();
    return key ? { project_id: deal.project_id, unit_key: key } : { project_id: deal.project_id, unit_ord: 0 };
}

export const NO_BASE_HINT = 'اكتب قيمة الصفقة لتظهر العمولة المتوقعة';

// الصندوق الصغير تحت المسار، لمن يرى العمولة وحده (037؛ الشاشة لا تستدعيه لغيره). الحالة من المرحلة:
//   جارية «متوقعة» = الأساس × نسبة المشروع أو العامة، كما ستُنشأ العمولة عند «تمت» (commissions_apply_rate)،
//   «تمت» «مستحقة» = إجمالي صف العمولة نفسه (gross_amount)، ومعه حالة التحصيل إن تجاوزت «مستحقة»،
//   «خسرت» «فائتة» = ما كانت ستكونه، بلون باهت.
// input: { stage, amount, unitPrice, rate, rateFrom, row } — row: صف commissions أو null.
// صف «تمت» حالته «معفاة» ليس مستحقاً: يُكتب «معفاة» بلون باهت (المبلغ ما كانت ستكونه، كـ«فائتة»)، و«محصّلة» تُكتب
// بحالتها خضراء، فلا يناقض الصندوقُ شارةَ الحالة في بطاقة العمولة تحته. state يبقى حالة المرحلة (due).
export function commissionBox(input) {
    const { stage, amount, unitPrice, rate, rateFrom, row } = input || {};
    const state = commissionState(stage);
    if (!state) return null;
    const box = {
        state, label: COMMISSION_STATE_TEXT[state], tone: COMMISSION_STATE_TONE[state],
        value: null, valueText: '—', detail: null, hint: null, askAmount: false
    };
    if (state === 'due') {
        if (!row) return Object.assign(box, { hint: 'لم تُسجَّل عمولة لهذه الصفقة' });
        const value = Number(row.gross_amount);
        const parts = [formatRate(row.rate_percent) + ' من ' + sar(row.base_amount)];
        const ownTone = row.status === 'waived' ? 'muted' : row.status === 'collected' ? 'ok' : null;
        if (ownTone) Object.assign(box, { label: COMMISSION_STATUS[row.status], tone: ownTone });
        else if (row.status && row.status !== 'due' && COMMISSION_STATUS[row.status]) parts.push(COMMISSION_STATUS[row.status]);
        return Object.assign(box, {
            value: row.gross_amount !== null && row.gross_amount !== undefined && Number.isFinite(value) ? value : null,
            valueText: sar(row.gross_amount),
            detail: parts.join(' · ')
        });
    }
    const base = commissionBase(amount, unitPrice);
    if (!base) return Object.assign(box, state === 'expected' ? { hint: NO_BASE_HINT, askAmount: true } : { hint: 'لا قيمة مسجّلة لهذه الصفقة' });
    const value = expectedCommission(base.base, rate);
    if (value === null) return Object.assign(box, { hint: 'تعذّرت قراءة نسبة العمولة' });
    return Object.assign(box, {
        value,
        valueText: sar(value),
        detail: formatRate(rate) + (rateFrom ? ' (' + rateFrom + ')' : '') + ' من '
            + (base.from === 'deal' ? 'قيمة الصفقة ' : 'سعر الوحدة المعروض ') + sar(base.base)
    });
}
