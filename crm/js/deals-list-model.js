// قائمة الصفقات حسب المرحلة (‎#/deals‎، board.js): الحساب الصافي وحده — التبويبات، الترتيب، التحديد والنقل، وما يُكتب في
// كل خانة — بلا DOM ولا شبكة، فيُختبر وحده في tests/deals-list-model.test.mjs. مكان الصفقة في المسار، وأيامها في
// مرحلتها، والعمولة المتوقعة: من deal-path.js المشترك مع صفحة الصفقة و«عملي اليوم»، فلا يختلف حسابان لشيء واحد.
//
// القواعد التي تفرضها القاعدة نفسها ولا يغيّرها هذا الملف: «خسرت» بلا سبب يرفضه القيد (23514)، و«تمت» تحتاج السعر
// النهائي لأن العمولة تُنشأ منه، وصفقة «تمت» لا يغيّر مرحلتها غير المدير (034). هنا تُترجم إلى ما يُعرض ويُمنع في الشاشة.

import {
    openStages, wonStage, lostStage, stageOf, nextStage, progress, enteredAt, daysSince, isStuck,
    commissionState, COMMISSION_STATE_TEXT, COMMISSION_STATE_TONE, expectedCommission
} from './deal-path.js';
import { COMMISSION_STATUS } from './labels.js';
import { countText } from './ui.js';

/* ===================== التبويبات ===================== */

export const TAB_ALL = 'all';

// «الكل» (الجارية كلها) ثم تبويب لكل مرحلة جارية بترتيبها، ثم «تمت» و«خسرت». kind يقول ما يُسمح به في التبويب.
export function listTabs(stages) {
    const open = openStages(stages);
    const tabs = [{ key: TAB_ALL, label: 'الكل', stageIds: open.map((s) => s.id), kind: 'open', stage: null }];
    for (const stage of open) tabs.push({ key: 'stage-' + stage.id, label: stage.name_ar, stageIds: [stage.id], kind: 'open', stage });
    const won = wonStage(stages);
    const lost = lostStage(stages);
    if (won) tabs.push({ key: 'won', label: won.name_ar, stageIds: [won.id], kind: 'won', stage: won });
    if (lost) tabs.push({ key: 'lost', label: lost.name_ar, stageIds: [lost.id], kind: 'lost', stage: lost });
    return tabs;
}

// تبويب محفوظ من زيارة سابقة لم يعد موجوداً: يرجع إلى «الكل» بدل قائمة فارغة بلا سبب
export function findTab(tabs, key) {
    return (tabs || []).find((tab) => tab.key === key) || (tabs || [])[0] || null;
}

// عدد «الكل» مجموع المراحل الجارية (طلب عدّ أقل)، ولا يُكتب ما لم تصل أعدادها كلها: رقم ناقص أسوأ من لا رقم
export function tabCounts(tabs, counts) {
    const out = new Map(counts || []);
    let sum = 0;
    for (const tab of tabs || []) {
        if (tab.kind !== 'open' || tab.key === TAB_ALL) continue;
        const n = out.get(tab.key);
        if (n === null || n === undefined || !Number.isFinite(Number(n))) { sum = null; break; }
        sum += Number(n);
    }
    out.set(TAB_ALL, sum);
    return out;
}

/* ===================== الترتيب ===================== */

// الترتيب كله من الخادم (القائمة مرقّمة صفحات فيه)، والصفحة تُعرض بترتيبه كما هو، فيصدق اسمه على الصفحات كلها.
// «الأقدم في المرحلة» لا يُعرض هنا: لا عمود في deals لوقت دخول المرحلة يُرتَّب به على الخادم، وupdated_at يتجدد مع كل
// تعديل (القيمة، الوحدة، موعد الإغلاق، الوسيط)، فالصفقة الواقفة التي عُدّلت أمس كانت تهبط إلى آخر الصفحات تحت اسمٍ
// يَعِد بغير ذلك. يعود حين يُضاف عمود stage_entered_at يملؤه deals_guard ويُفهرس. حتى ذلك فالاسم ما يفعله الترتيب:
// الصفقة التي لم يمسّها أحد منذ أطول مدة أولاً (أيامها في مرحلتها ظاهرة في عمودها، والواقفة بالأحمر).
export const DEFAULT_SORT = 'updated';
export const SORTS = {
    updated: 'الأقدم تحديثاً أولاً',
    newest: 'الأحدث أولاً',
    amount: 'الأعلى قيمة'
};

// «الأقدم تحديثاً» بآخر تعديل (updated_at) في كل تبويب. «الأحدث» في الجارية أحدث الصفقات فتحاً، وفي المغلقة أحدثها
// إغلاقاً. id آخراً حتى لا يتكرر صف بين صفحتين.
export function sortOrder(sortKey, tab) {
    const closed = Boolean(tab) && tab.kind !== 'open';
    const tie = { column: 'id', ascending: true };
    if (sortKey === 'amount') return [{ column: 'amount', ascending: false, nullsFirst: false }, tie];
    if (sortKey === 'newest') {
        return [closed ? { column: 'closed_at', ascending: false, nullsFirst: false } : { column: 'created_at', ascending: false }, tie];
    }
    return [{ column: 'updated_at', ascending: true }, tie];
}

/* ===================== البحث ===================== */

const UUID_RE = /^[0-9a-f-]{1,64}$/i;
const INT_RE = /^\d{1,12}$/;

// البحث باسم العميل أو جواله أو اسم المشروع: معرّفات العملاء والمشاريع المطابقة (من استعلامين قبله) شرطٌ واحد
// بـ «أو» على الصفقات، فتُرقَّم القائمة ويُعدّ كل تبويب بالشرط نفسه. null = لا مطابق، فلا داعي لسؤال الخادم.
// ما ليس معرّفاً سليماً يُسقط: الشرط يُكتب في عنوان الطلب، فلا يُفسده نص غريب.
export function searchOr(clientIds, projectIds) {
    const uniq = (list, re) => [...new Set((list || []).map((v) => (v === null || v === undefined ? '' : String(v))).filter((v) => re.test(v)))];
    const clients = uniq(clientIds, UUID_RE);
    const projects = uniq(projectIds, INT_RE);
    const parts = [];
    if (clients.length) parts.push('client_id.in.(' + clients.join(',') + ')');
    if (projects.length) parts.push('project_id.in.(' + projects.join(',') + ')');
    return parts.length ? parts.join(',') : null;
}

/* ===================== التحديد والإجراءات الجماعية ===================== */

// ما يُحدَّد: الجارية لكل من يراها، و«تمت» للمدير وحده (034 يرفض تغيير مرحلتها من غيره)، و«خسرت» لا شيء يُفعل بها هنا
export function canSelect(stage, admin) {
    if (!stage) return false;
    if (!stage.is_terminal) return true;
    return Boolean(stage.is_won) && Boolean(admin);
}

// التبويبات لا تخلط الجارية بالمغلقة، فعمود الاختيار كله أو لا شيء
export function tabSelectable(tab, admin) {
    if (!tab) return false;
    return tab.kind === 'open' || (tab.kind === 'won' && Boolean(admin));
}

export const MOVE_BLOCKED = {
    mixed: 'تُنقل الصفقات معاً حين تكون كلها في مرحلة واحدة.',
    closed: 'الصفقات المغلقة لا تُنقل من هنا.',
    won: '«تمت» تحتاج السعر النهائي لكل صفقة: افتح الصفقة وأتمّها من صفحتها.'
};

// «انقلها إلى: …»: المحددة كلها في مرحلة جارية واحدة، والتالية ليست «تمت» (الإتمام بالسعر النهائي لكل صفقة وحدها)
export function moveTarget(deals, stages) {
    const list = deals || [];
    if (!list.length) return { ok: false, stage: null, reason: 'empty' };
    if (new Set(list.map((d) => Number(d.stage_id))).size > 1) return { ok: false, stage: null, reason: 'mixed' };
    const current = stageOf(stages, list[0].stage_id);
    if (!current || current.is_terminal) return { ok: false, stage: null, reason: 'closed' };
    const next = nextStage(stages, current.id);
    if (!next) return { ok: false, stage: null, reason: 'closed' };
    if (next.is_terminal) return { ok: false, stage: next, reason: 'won' };
    return { ok: true, stage: next, reason: null };
}

// «سجّلها «خسرت»»: لكل محددة جارية أو «تمت» (المدير). hasWon: النموذج ينبّه أن عمولتها تُلغى أو تُعلَّم للمراجعة (031)
export function lostTarget(deals, stages) {
    const lost = lostStage(stages);
    const list = deals || [];
    if (!lost || !list.length) return { ok: false, stage: lost, hasWon: false };
    let hasWon = false;
    for (const deal of list) {
        const stage = stageOf(stages, deal.stage_id);
        if (!stage || (stage.is_terminal && !stage.is_won)) return { ok: false, stage: lost, hasWon: false };
        if (stage.is_won) hasWon = true;
    }
    return { ok: true, stage: lost, hasWon };
}

// نتيجة تعديل كل صفقة على حدة: صف عاد = نجح، وخطأ أو صفر صفوف (رشّحته RLS، أو تغيّرت مرحلته قبلنا) = تعذّر
export function tallyResults(results) {
    let ok = 0;
    let failed = 0;
    let error = null;
    for (const result of results || []) {
        if (result && !result.error && Array.isArray(result.data) && result.data.length > 0) ok += 1;
        else {
            failed += 1;
            if (result && result.error && !error) error = result.error;
        }
    }
    return { ok, failed, error };
}

/* ===================== النصوص ===================== */

const DEALS = ['صفقة واحدة', 'صفقتان', 'صفقات', 'صفقة'];
// بعد «تحديد» و«نقل» و«تسجيل» يُجرّ المثنى
const DEALS_GEN = ['صفقة واحدة', 'صفقتين', 'صفقات', 'صفقة'];

export function dealsCount(n) {
    return countText(n, DEALS);
}

export function selectionText(n) {
    return 'تم تحديد ' + countText(n, DEALS_GEN);
}

// ما يُقال بعد النقل أو الخسارة الجماعية: كم نجح وكم تعذّر ولماذا (why: نص الخطأ الأول إن وُجد)
export function bulkMessage(action, ok, failed, stageName, why) {
    const reason = why || 'ربما تغيّرت مرحلتها أو لا تملك صلاحية تعديلها';
    const move = action === 'move';
    const into = move ? ' إلى «' + stageName + '»' : ' «خسرت»';
    const done = (move ? 'نُقلت ' : 'سُجّلت ') + countText(ok, DEALS) + into;
    const notDone = move ? 'تعذّر نقل ' : 'تعذّر تسجيل ';
    if (!failed) return { kind: 'success', text: done };
    if (!ok) return { kind: 'error', text: notDone + (failed === 1 ? 'الصفقة' : 'الصفقات') + (move ? '' : ' «خسرت»') + ': ' + reason };
    return { kind: 'error', text: done + '، و' + notDone + countText(failed, DEALS_GEN) + ': ' + reason };
}

// السطر الأول في نموذج الخسارة الجماعية
export function lostIntro(n) {
    return n === 1 ? 'ستُسجَّل صفقة واحدة «خسرت».' : 'ستُسجَّل ' + countText(n, DEALS) + ' «خسرت» بالسبب نفسه.';
}

// القائمة الفارغة: ما الذي لا يوجد، وما يُفعل (action: reset = مسح التصفية، clients = فتح العملاء)
export function emptyText(tab, filtered) {
    if (filtered) {
        return { title: 'لا نتائج مطابقة', hint: 'جرّب جزءاً من اسم العميل أو المشروع أو آخر أرقام الجوال، أو امسح التصفية.', action: 'reset' };
    }
    if (!tab || tab.key === TAB_ALL) {
        return { title: 'لا صفقات جارية', hint: 'الصفقة تُفتح من ملف العميل أو من مطابقة، وتبقى هنا حتى تُغلق.', action: 'clients' };
    }
    if (tab.kind === 'won') return { title: 'لا صفقات «' + tab.label + '» بعد', hint: 'الصفقة تُتمّ من صفحتها بعد تأكيد السعر النهائي.', action: null };
    if (tab.kind === 'lost') return { title: 'لا صفقات «' + tab.label + '»', hint: null, action: null };
    return { title: 'لا صفقات في «' + tab.label + '»', hint: 'اختر مرحلة أخرى من الأعلى.', action: null };
}

/* ===================== خانات الصف ===================== */

// «العقار · الوحدة»: اسم المشروع، وإن لم يُرَ (محذوف أو بانتظار الاعتماد) رقمه
export function placeText(deal) {
    const d = deal || {};
    const project = d.project && d.project.name
        ? d.project.name
        : (d.project_id !== null && d.project_id !== undefined ? 'عقار رقم ' + d.project_id : 'بدون عقار');
    const unit = d.unit_key ? String(d.unit_key).trim() : '';
    return unit ? project + ' · ' + unit : project;
}

// مرحلة الصفقة ومكانها في المسار وأيامها فيها. history = null: تعذّرت قراءة السجل، فلا أيام ولا «واقفة» بدل رقم خاطئ
export function stageFacts(deal, stages, history, now = Date.now()) {
    const stageId = deal ? deal.stage_id : null;
    const stage = stageOf(stages, stageId);
    const days = history ? daysSince(enteredAt(deal, history), now) : null;
    return { stage, path: progress(stages, stageId), days, stuck: isStuck(stage, days) };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// موعد الإغلاق المتوقع فات والصفقة ما زالت جارية: يُعاد تاريخه (YYYY-MM-DD) ليُكتب «تجاوز موعد الإغلاق»، وإلا null.
// today: اليوم المحلي بالصيغة نفسها. الموعد تاريخ بلا وقت، فيومه نفسه ليس تأخراً — كما يعدّ «عملي اليوم» المتأخرةَ
// (‎.lt('expected_close_date', today)‎) ويحيل إلى هذه القائمة. المغلقة («تمت» و«خسرت») لا تُعدّ متأخرة: لا موعد تنتظره.
export function lateClose(deal, stage, today) {
    const date = deal && deal.expected_close_date ? String(deal.expected_close_date).slice(0, 10) : '';
    if (!ISO_DAY.test(date) || !ISO_DAY.test(String(today || '')) || !stage || stage.is_terminal) return null;
    return date < today ? date : null;
}

const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// النسبة الفعلية لصفقة: نسبة مشروعها إن وُجدت، وإلا النسبة العامة (كما يحسبها commissions_apply_rate في 037)
export function rateFor(projectId, projectRates, defaultRate) {
    if (projectId !== null && projectId !== undefined && projectRates) {
        const rate = projectRates.get(Number(projectId));
        if (finite(rate)) return Number(rate);
    }
    return finite(defaultRate) ? Number(defaultRate) : null;
}

// خانة العمولة: الجارية «متوقعة» (القيمة × النسبة)، و«تمت» «مستحقة» من صف العمولة نفسه (قد تكون نسبتها عُدّلت بعد
// الإتمام)، والمعفاة تقول ذلك بدل «مستحقة»، و«خسرت» «فائتة» بما كانت ستكونه. amount = null: لا قيمة أو لا نسبة أو لا صف.
export function commissionFacts(deal, stage, rate, commission) {
    const state = commissionState(stage);
    if (!state) return null;
    if (state === 'due') {
        const waived = Boolean(commission) && commission.status === 'waived';
        return {
            state,
            amount: commission && finite(commission.gross_amount) ? Number(commission.gross_amount) : null,
            label: waived ? COMMISSION_STATUS.waived : COMMISSION_STATE_TEXT.due,
            tone: waived ? 'muted' : COMMISSION_STATE_TONE.due
        };
    }
    return {
        state,
        amount: expectedCommission(deal ? deal.amount : null, rate),
        label: COMMISSION_STATE_TEXT[state],
        tone: COMMISSION_STATE_TONE[state]
    };
}
