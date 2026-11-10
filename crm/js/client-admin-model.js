// نصوص تحويل العميل وحذفه (043_client_transfer_delete.sql): دوال بلا صفحة ولا شبكة، يختبرها tests/client-admin-model.test.mjs.
//
// التحويل والحذف للمدير وحده، والقاعدة تفرض ذلك داخل transfer_client وdelete_client. هنا الكلام الذي يراه فقط.

// العدد مع المعدود: 1 و2 بلفظهما، و3-10 بالجمع، وما سواها بالمفرد (طلباً، متابعة، صفقة)
const NOUNS = {
    request: { one: 'طلب واحد', two: 'طلبان', few: 'طلبات', many: 'طلباً' },
    followUp: { one: 'متابعة واحدة', two: 'متابعتان', few: 'متابعات', many: 'متابعة' },
    openFollowUp: { one: 'متابعة مفتوحة', two: 'متابعتان مفتوحتان', few: 'متابعات مفتوحة', many: 'متابعة مفتوحة' },
    deal: { one: 'صفقة واحدة', two: 'صفقتان', few: 'صفقات', many: 'صفقة' },
    openDeal: { one: 'صفقة جارية', two: 'صفقتان جاريتان', few: 'صفقات جارية', many: 'صفقة جارية' }
};

export function countOf(n, noun) {
    const forms = NOUNS[noun];
    const count = Math.trunc(Number(n));
    if (!forms || !Number.isFinite(count) || count < 1) return '';
    if (count === 1) return forms.one;
    if (count === 2) return forms.two;
    const rest = count % 100;
    return count + ' ' + (rest >= 3 && rest <= 10 ? forms.few : forms.many);
}

// «أ، وب، وج»: الفارغ يسقط
export function joinAnd(parts) {
    const list = (parts || []).filter(Boolean);
    return list.length ? list[0] + list.slice(1).map((p) => '، و' + p).join('') : '';
}

const n0 = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
};

// ما يقوله الحوار قبل التحويل
// «النشطة» كلمة الصفحات للمفتوحة والمطابَقة معاً (requests.js)، وهي ما ينقله transfer_client من الطلبات.
// transfer_client ينقل الطلبات النشطة وما عند الوسيط الحالي، وما عند وسيط معطّل أو بلا مكلَّف؛
// وما أسنده المدير أو مركز الاتصال لموظف نشط آخر يبقى عنده (043)
export const TRANSFER_NOTE = 'ينتقل معه طلباته النشطة، وما عند الوسيط الحالي من متابعات مفتوحة وصفقات جارية. '
    + 'وما سوى ذلك من متابعاته المفتوحة وصفقاته الجارية يبقى عند من هو عنده، ولو كان عندك أو عند مركز الاتصال، '
    + 'إلا ما كان عند وسيط معطّل أو بلا مكلَّف فينتقل معه. '
    + 'والمنتهي من الطلبات والمتابعات والصفقات يبقى باسم من عمل عليه، والوسيط الحالي لا يعود يرى العميل.';

// عميل غير مسند أدخله وسيط: «إسناد» لا «تحويل»، وشغل ذلك الوسيط هو الذي ينتقل (043: v_from = created_by إن كان وسيطاً)
export const ASSIGN_NOTE = 'ينتقل معه طلباته النشطة، وما عند الوسيط الذي أدخله من متابعات مفتوحة وصفقات جارية، '
    + 'وذلك الوسيط لا يعود يرى العميل إلا إن أسندته إليه. '
    + 'وما سوى ذلك من متابعاته المفتوحة وصفقاته الجارية يبقى عند من هو عنده، ولو كان عندك أو عند مركز الاتصال، '
    + 'إلا ما كان عند وسيط معطّل أو بلا مكلَّف فينتقل معه.';

// عميل غير مسند لم يُدخله وسيط نشط (أدخله مركز الاتصال أو المدير أو المساعد، أو وسيط عُطّل): لا يخرج منه أحد يعمل،
// ولا تنتقل إلا طلباته وما عند وسيط معطّل أو بلا مكلَّف (043). والتطبيق لا يترك متابعة ولا صفقة بلا مكلَّف:
// «حسب مالك العميل» على عميل غير مسند تذهب لمن أنشأها (follow_ups_guard وdeals_guard)، فتبقى عند المدير أو مركز الاتصال
export const ASSIGN_LEAD_NOTE = 'ينتقل معه طلباته النشطة. ومتابعاته المفتوحة وصفقاته الجارية تبقى عند من هي عنده، ولو كانت عندك أو عند مركز الاتصال، '
    + 'إلا ما كان عند وسيط معطّل أو بلا مكلَّف فينتقل معه.';

// نص الحوار: تحويل من وسيط، أو إسناد عميل أدخله وسيط، أو إسناد عميل لم يُدخله وسيط
export function transferNote(assigning, addedByBroker) {
    if (!assigning) return TRANSFER_NOTE;
    return addedByBroker ? ASSIGN_NOTE : ASSIGN_LEAD_NOTE;
}

export function transferTitle(assigning) {
    return assigning ? 'إسناد العميل لوسيط' : 'تحويل العميل لوسيط';
}

// رد transfer_client: { changed, requirements, follow_ups, deals }
export function transferDoneText(clientName, brokerName, result, assigning = false) {
    const who = clientName || 'العميل';
    const to = brokerName || 'الوسيط';
    const r = result || {};
    if (r.changed === false && !n0(r.requirements) && !n0(r.follow_ups) && !n0(r.deals)) {
        return who + ' عند ' + to + ' أصلاً.';
    }
    const moved = joinAnd([
        countOf(r.requirements, 'request'),
        countOf(r.follow_ups, 'openFollowUp'),
        countOf(r.deals, 'openDeal')
    ]);
    return (assigning ? 'أُسند ' : 'حُوّل ') + who + ' إلى ' + to + '.' + (moved ? ' انتقل معه: ' + moved + '.' : '');
}

// قبل الحذف: counts = { deals, requirements, follow_ups } من عدّ الصفحة
export function deleteBlocked(counts) {
    return n0(counts && counts.deals) > 0;
}

export function deleteBlockedText(clientName, deals) {
    const who = clientName || 'هذا العميل';
    return 'لدى ' + who + ' ' + (countOf(deals, 'deal') || 'صفقات') + '، فلا يُحذف حتى لا تضيع الصفقات والعمولات. '
        + 'إذا لم تعد تتعامل معه فغيّر حالته إلى «غير نشط» من «تعديل البيانات».';
}

export function deleteWarnText(clientName, counts) {
    const who = clientName || 'هذا العميل';
    const c = counts || {};
    const requests = countOf(c.requirements, 'request');
    const withIt = joinAnd([
        requests ? requests + (n0(c.requirements) === 1 ? ' ومطابقاته' : n0(c.requirements) === 2 ? ' ومطابقاتهما' : ' ومطابقاتها') : '',
        countOf(c.follow_ups, 'followUp'),
        'سجله'
    ]);
    return 'حذف ' + who + ' نهائي ولا يُسترجع. يُحذف معه: ' + withIt + '.';
}

export function deleteDoneText(clientName) {
    return 'حُذف ' + (clientName || 'العميل') + '.';
}

// الدالة غير موجودة في القاعدة: 043 لم يُطبَّق بعد، أو تُراجع عنه
export function isMissingFunction(error) {
    return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(String(error.message || '')));
}

export const NOT_READY_TEXT = 'هذه الميزة تنتظر تحديث قاعدة البيانات. أعد المحاولة بعد اعتماده.';

// خطأ delete_client حين تُضاف صفقة بين العدّ والحذف: hint = has_deals
export function isHasDealsError(error) {
    return Boolean(error) && (error.hint === 'has_deals' || /صفقة/.test(String(error.message || '')));
}
