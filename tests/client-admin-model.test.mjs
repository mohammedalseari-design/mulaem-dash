// اختبار crm/js/client-admin-model.js: العدد مع المعدود، ونص التحويل، ونصوص الحذف ومنعه.
// التشغيل: node tests/client-admin-model.test.mjs
import {
    countOf, joinAnd, TRANSFER_NOTE, transferDoneText, deleteBlocked, deleteBlockedText, deleteWarnText, deleteDoneText, isHasDealsError,
    isMissingFunction, NOT_READY_TEXT, ASSIGN_NOTE, transferTitle
} from '../crm/js/client-admin-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

/* ===================== العدد مع المعدود ===================== */

t('count: 1 and 2 by their own word', countOf(1, 'request') === 'طلب واحد' && countOf(2, 'request') === 'طلبان'
    && countOf(1, 'followUp') === 'متابعة واحدة' && countOf(2, 'deal') === 'صفقتان');
t('count: 3 to 10 take the plural', countOf(3, 'request') === '3 طلبات' && countOf(10, 'followUp') === '10 متابعات'
    && countOf(7, 'openDeal') === '7 صفقات جارية');
t('count: 11 and up take the singular', countOf(11, 'request') === '11 طلباً' && countOf(25, 'followUp') === '25 متابعة'
    && countOf(100, 'deal') === '100 صفقة');
t('count: 103 and 110 take the plural again', countOf(103, 'request') === '103 طلبات' && countOf(110, 'deal') === '110 صفقات');
t('count: zero, negative, text and unknown nouns give nothing', countOf(0, 'request') === '' && countOf(-2, 'request') === ''
    && countOf('x', 'request') === '' && countOf(null, 'request') === '' && countOf(3, 'nope') === '');
t('count: a numeric string works', countOf('4', 'request') === '4 طلبات');

t('join: «أ، وب، وج» and empty parts drop', joinAnd(['أ', '', 'ب', null, 'ج']) === 'أ، وب، وج');
t('join: one part, none', joinAnd(['أ']) === 'أ' && joinAnd([]) === '' && joinAnd(null) === '');

/* ===================== التحويل ===================== */

t('transfer note says what moves and what stays', /طلباته المفتوحة/.test(TRANSFER_NOTE) && /ما عند الوسيط الحالي من متابعات مفتوحة وصفقات جارية/.test(TRANSFER_NOTE)
    && /يبقى باسم من عمل عليه/.test(TRANSFER_NOTE) && /ما أسندته لموظف آخر يبقى عنده/.test(TRANSFER_NOTE) && /لا يعود يرى العميل/.test(TRANSFER_NOTE));
t('transfer done: names and what moved',
    transferDoneText('محمد', 'نجود', { changed: true, requirements: 2, follow_ups: 1, deals: 3 })
    === 'حُوّل محمد إلى نجود. انتقل معه: طلبان، ومتابعة مفتوحة، و3 صفقات جارية.',
    transferDoneText('محمد', 'نجود', { changed: true, requirements: 2, follow_ups: 1, deals: 3 }));
t('transfer done: nothing else to move', transferDoneText('محمد', 'نجود', { changed: true, requirements: 0, follow_ups: 0, deals: 0 })
    === 'حُوّل محمد إلى نجود.');
t('transfer done: only deals', transferDoneText('محمد', 'نجود', { changed: true, deals: 1 }) === 'حُوّل محمد إلى نجود. انتقل معه: صفقة جارية.');
t('transfer done: already with that broker', transferDoneText('محمد', 'نجود', { changed: false, requirements: 0, follow_ups: 0, deals: 0 })
    === 'محمد عند نجود أصلاً.');
t('transfer done: same broker but leftovers moved still reports them',
    transferDoneText('محمد', 'نجود', { changed: false, requirements: 0, follow_ups: 2, deals: 0 }) === 'حُوّل محمد إلى نجود. انتقل معه: متابعتان مفتوحتان.');
t('transfer done: missing names and reply', transferDoneText('', '', null) === 'حُوّل العميل إلى الوسيط.');
t('assign: title, note and toast say «إسناد»', transferTitle(true) === 'إسناد العميل لوسيط' && transferTitle(false) === 'تحويل العميل لوسيط'
    && /الوسيط الذي أدخله/.test(ASSIGN_NOTE) && /لا يعود يرى العميل/.test(ASSIGN_NOTE)
    && transferDoneText('محمد', 'نجود', { changed: true, requirements: 1, follow_ups: 0, deals: 1 }, true) === 'أُسند محمد إلى نجود. انتقل معه: طلب واحد، وصفقة جارية.');

/* ===================== الحذف ===================== */

t('delete blocked only with a deal', deleteBlocked({ deals: 1 }) === true && deleteBlocked({ deals: 0, requirements: 5 }) === false
    && deleteBlocked(null) === false && deleteBlocked({ deals: '2' }) === true);
t('blocked text: count, reason, and the way out', deleteBlockedText('محمد', 2)
    === 'لدى محمد صفقتان، فلا يُحذف حتى لا تضيع الصفقات والعمولات. إذا لم تعد تتعامل معه فغيّر حالته إلى «غير نشط» من «تعديل البيانات».',
    deleteBlockedText('محمد', 2));
t('blocked text without a count (a deal added meanwhile)', /^لدى محمد صفقات، فلا يُحذف/.test(deleteBlockedText('محمد', null)));
t('warn text: everything that goes with it', deleteWarnText('محمد', { requirements: 2, follow_ups: 5 })
    === 'حذف محمد نهائي ولا يُسترجع. يُحذف معه: طلبان ومطابقاتهما، و5 متابعات، وسجله.', deleteWarnText('محمد', { requirements: 2, follow_ups: 5 }));
t('warn text: three requests take «ومطابقاتها»', deleteWarnText('محمد', { requirements: 3, follow_ups: 0 }) === 'حذف محمد نهائي ولا يُسترجع. يُحذف معه: 3 طلبات ومطابقاتها، وسجله.');
t('warn text: one request', deleteWarnText('محمد', { requirements: 1, follow_ups: 1 })
    === 'حذف محمد نهائي ولا يُسترجع. يُحذف معه: طلب واحد ومطابقاته، ومتابعة واحدة، وسجله.');
t('warn text: an empty client still mentions its log', deleteWarnText('محمد', { requirements: 0, follow_ups: 0 })
    === 'حذف محمد نهائي ولا يُسترجع. يُحذف معه: سجله.');
t('done text', deleteDoneText('محمد') === 'حُذف محمد.' && deleteDoneText('') === 'حُذف العميل.');
t('has-deals error by hint or message', isHasDealsError({ hint: 'has_deals' }) && isHasDealsError({ message: 'للعميل 1 صفقة، فلا يُحذف' })
    && !isHasDealsError({ message: 'لا تملك صلاحية' }) && !isHasDealsError(null));
t('missing function: PGRST202, 42883 or the PostgREST wording', isMissingFunction({ code: 'PGRST202' }) && isMissingFunction({ code: '42883' })
    && isMissingFunction({ message: 'Could not find the function public.transfer_client(p_client, p_to) in the schema cache' })
    && !isMissingFunction({ code: '42501', message: 'تحويل العميل للمدير فقط' }) && !isMissingFunction(null));
t('not-ready text is Arabic and says what to wait for', /تحديث قاعدة البيانات/.test(NOT_READY_TEXT));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
