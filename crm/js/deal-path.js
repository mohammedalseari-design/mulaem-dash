// مسار الصفقة: حساب صافٍ مشترك بين صفحة الصفقة وقائمة الصفقات و«عملي اليوم» (بلا DOM ولا شبكة، يُختبر وحده في
// tests/deal-path.test.mjs). المراحل من deal_stages (007): مراحل جارية مرتبة بـ sort_order، ثم «تمت» (is_won) و«خسرت».
// القواعد التي لا يغيّرها هذا الملف وتفرضها القاعدة: «خسرت» تحتاج سبباً، و«تمت» تحتاج القيمة النهائية (منها تُنشأ العمولة)،
// وإعادة فتح صفقة «تمت» للمدير وحده (034).

import { COMMISSION_STATUS } from './labels.js';

const byOrder = (a, b) => (Number(a.sort_order) - Number(b.sort_order)) || (Number(a.id) - Number(b.id));

// المراحل الجارية بالترتيب (بلا «تمت» و«خسرت»)
export function openStages(stages) {
    return (stages || []).filter((s) => s && !s.is_terminal).slice().sort(byOrder);
}

export function wonStage(stages) {
    return (stages || []).find((s) => s && s.is_terminal && s.is_won) || null;
}

export function lostStage(stages) {
    return (stages || []).find((s) => s && s.is_terminal && !s.is_won) || null;
}

export function stageOf(stages, stageId) {
    return (stages || []).find((s) => s && Number(s.id) === Number(stageId)) || null;
}

// المرحلة التالية لصفقة جارية: الجارية بعدها، وبعد آخر جارية «تمت». الصفقة المغلقة لا تالية لها (تُعاد فتحاً أولاً).
export function nextStage(stages, stageId) {
    const current = stageOf(stages, stageId);
    if (!current || current.is_terminal) return null;
    const open = openStages(stages);
    const i = open.findIndex((s) => Number(s.id) === Number(current.id));
    if (i === -1) return null;
    return i < open.length - 1 ? open[i + 1] : wonStage(stages);
}

// المرحلة السابقة الجارية، أو null في أول مرحلة أو في صفقة مغلقة
export function prevStage(stages, stageId) {
    const current = stageOf(stages, stageId);
    if (!current || current.is_terminal) return null;
    const open = openStages(stages);
    const i = open.findIndex((s) => Number(s.id) === Number(current.id));
    return i > 0 ? open[i - 1] : null;
}

// مكان الصفقة في المسار: رقم الخطوة الحالية (يبدأ من 1) من مجموع الخطوات (الجارية + «تمت»)، وهل أُغلقت
export function progress(stages, stageId) {
    const open = openStages(stages);
    const total = open.length + (wonStage(stages) ? 1 : 0);
    const current = stageOf(stages, stageId);
    if (!current) return { step: 0, total, won: false, lost: false };
    if (current.is_terminal) return { step: current.is_won ? total : 0, total, won: Boolean(current.is_won), lost: !current.is_won };
    return { step: open.findIndex((s) => Number(s.id) === Number(current.id)) + 1, total, won: false, lost: false };
}

// متى دخلت الصفقة مرحلتها الحالية: أحدث سطر في deal_stage_history انتقل إلى مرحلتها (to_stage)، وإلا آخر ما يُعرف عنها.
// history: صفوف { deal_id, to_stage, changed_at } لصفقة واحدة أو لعدة صفقات.
export function enteredAt(deal, history) {
    if (!deal) return null;
    let best = null;
    for (const h of history || []) {
        if (!h || String(h.deal_id) !== String(deal.id) || Number(h.to_stage) !== Number(deal.stage_id) || !h.changed_at) continue;
        if (best === null || Date.parse(h.changed_at) > Date.parse(best)) best = h.changed_at;
    }
    return best || deal.created_at || deal.updated_at || null;
}

// الأيام الكاملة منذ وقت ما (0 لما دون يوم، null لوقت غير صالح أو في المستقبل البعيد)
export function daysSince(iso, now = Date.now()) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const d = Math.floor((now - t) / 86400000);
    return d < 0 ? 0 : d;
}

// «واقفة»: صفقة جارية مضى على مرحلتها أكثر من الحد (14 يوماً)
export const STUCK_DAYS = 14;
export function isStuck(stage, days, limit = STUCK_DAYS) {
    return Boolean(stage) && !stage.is_terminal && days !== null && days !== undefined && days > limit;
}

// حالة العمولة بحسب المرحلة: جارية = متوقعة، «تمت» = مستحقة، «خسرت» = فائتة
export function commissionState(stage) {
    if (!stage) return null;
    if (!stage.is_terminal) return 'expected';
    return stage.is_won ? 'due' : 'lost';
}
export const COMMISSION_STATE_TEXT = { expected: 'متوقعة', due: 'مستحقة', lost: 'فائتة' };
// اللون معنى: «متوقعة» محايدة (لم يحن شيء بعد)، «مستحقة» كهرمانية (حانت ولم تُحصَّل)، «فائتة» باهتة. الأخضر لـ«محصّلة» وحدها
// (dueCommissionLook)، فلا يبدو مالٌ لم يصل كأنه وصل.
export const COMMISSION_STATE_TONE = { expected: 'neutral', due: 'amber', lost: 'muted' };

// عمولة صفقة «تمت» بحسب صفّها في commissions، كما تعرضها صفحة الصفقة وقائمة الصفقات معاً: «محصّلة» خضراء، و«معفاة» باهتة،
// وما بقي منها شيء (مستحقة، صدرت فاتورة، محصّلة جزئياً) «مستحقة» كهرمانية. بلا صف مقروء: محايدة بنص «مستحقة»، لا أخضر.
export function dueCommissionLook(row) {
    if (!row) return { label: COMMISSION_STATE_TEXT.due, tone: 'neutral' };
    if (row.status === 'collected') return { label: COMMISSION_STATUS.collected, tone: 'ok' };
    if (row.status === 'waived') return { label: COMMISSION_STATUS.waived, tone: 'muted' };
    return { label: COMMISSION_STATE_TEXT.due, tone: COMMISSION_STATE_TONE.due };
}

// العمولة المتوقعة لصفقة جارية: القيمة × النسبة، مقرّبة لهللتين كما تحسبها القاعدة. null بلا قيمة أو نسبة.
export function expectedCommission(amount, rate) {
    if (rate === null || rate === undefined || rate === '') return null;
    const a = Number(amount), r = Number(rate);
    if (!(a > 0) || !Number.isFinite(r) || r < 0) return null;
    return Math.round(a * r) / 100;
}

// «6 أيام» و«يومان» و«يوم واحد» و«اليوم». بعد المئة يتبع التمييز آخر رقمين (n % 100): «103 أيام» و«111 يوماً»،
// و«100 يوم» و«102 يوم» حين ينتهي العدد بمئة أو مئة وواحد أو مئة واثنين
export function daysText(days) {
    if (days === null || days === undefined) return '';
    if (days <= 0) return 'اليوم';
    if (days === 1) return 'يوم واحد';
    if (days === 2) return 'يومان';
    const tail = days % 100;
    if (tail >= 3 && tail <= 10) return days + ' أيام';
    if (tail >= 11) return days + ' يوماً';
    return days + ' يوم';
}
