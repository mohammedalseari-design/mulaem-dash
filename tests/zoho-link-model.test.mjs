// اختبار crm/js/zoho-link-model.js: التبويبات والرابط، ونص كل رمز فحص وكل رمز خطأ، وقراءة رد الوظيفة، وحالة الربط والنقل، والأرقام، والمعاينة، والزر الرئيسي.
// النصوص تُقارن كما هي حرفياً، فأي تغيير في نص يظهر للموظف يظهر هنا أولاً.
// التشغيل: node tests/zoho-link-model.test.mjs
import {
    LINKS_TITLE, LINKS_INTRO, LINK_TABS, DEFAULT_LINK_TAB, ZOHO_INTRO, CONSOLE_URL, SCOPES, STEPS, CHECK_CODES, ERROR_CODES, NEW_CODE, CHECK_OK, START_REFUSED, STALE_TEXT, COUNT_FAILED_TEXT,
    SYNC_TITLE, SYNC_WHAT, SYNC_RUNNING, MAQSAM_MISSING, NOT_RUN_YET, START_CHOICES, START_NOTE, NO_MATCH_TEXT, AMBIGUOUS_TEXT, PREVIEW_NOTE, PREVIEW_EMPTY, WRITE_NOTE,
    numberOrNull, linksTab, linksHash, waitText, saveFailureCopy, savedFailureCopy, saveErrorCopy, startRefusal, errorMessage, errorField, recordUrl, readReply, statusView, accountLine, settingsLine,
    statsRows, ownersView, statsNotes, runCopy, syncView, primaryAction, previewRows
} from '../crm/js/zoho-link-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arabic = (text) => typeof text === 'string' && /[؀-ۿ]/.test(text);

/* ===================== الصفحة: التبويبات والرابط ===================== */

t('page title and subtitle', LINKS_TITLE === 'ربط الأنظمة' && LINKS_INTRO === 'مقسم وZoho CRM في مكان واحد: الربط، والفحص، ونقل ملخصات المكالمات.');
t('two tabs in order', same(LINK_TABS, [{ key: 'maqsam', label: 'مقسم' }, { key: 'zoho', label: 'Zoho CRM' }]) && DEFAULT_LINK_TAB === 'maqsam');
t('tab from the link', linksTab('tab=zoho') === 'zoho' && linksTab('tab=maqsam') === 'maqsam' && linksTab('x=1&tab=zoho') === 'zoho' && linksTab('tab=zoho&x=1') === 'zoho');
t('no tab or an unknown one opens the default', linksTab(undefined) === 'maqsam' && linksTab(null) === 'maqsam' && linksTab('') === 'maqsam' && linksTab('tab=other') === 'maqsam' && linksTab('tab=constructor') === 'maqsam' && linksTab('xtab=zoho') === 'maqsam');
t('the link of a tab: the default has no suffix', linksHash('maqsam') === '#/settings/links' && linksHash('zoho') === '#/settings/links?tab=zoho' && linksHash('other') === '#/settings/links' && linksHash(null) === '#/settings/links');
t('the link reads back as its tab', LINK_TABS.every((tab) => linksTab((linksHash(tab.key).split('?')[1] || '')) === tab.key));

/* ===================== الخطوات ===================== */

t('the console on the Saudi data center', CONSOLE_URL === 'https://api-console.zoho.sa/');
t('the scope string, letter by letter', SCOPES === 'ZohoCRM.org.READ,ZohoCRM.users.READ,ZohoCRM.coql.READ,ZohoCRM.modules.leads.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.calls.READ,ZohoCRM.modules.notes.READ,ZohoCRM.modules.notes.CREATE');
t('the scope asks for nothing wider: no ALL, no UPDATE, no DELETE, one CREATE on notes', !/ALL|UPDATE|DELETE|WRITE/.test(SCOPES) && SCOPES.split(',').filter((s) => !s.endsWith('.READ')).join() === 'ZohoCRM.modules.notes.CREATE');
t('step 1', STEPS.open === 'افتح صفحة مفاتيح Zoho وسجّل الدخول بحساب مدير');
t('step 2', STEPS.client === 'إذا لم يكن عندك Self Client: اضغط GET STARTED، ثم Self Client، ثم CREATE NOW، ثم CREATE، ثم OK. وإذا كان موجوداً فافتحه، ولا تحذفه أبداً.');
t('step 3', STEPS.values === 'من تبويب Client Secret انسخ Client ID وClient Secret، والصقهما هنا.');
t('step 4, before the scope', STEPS.scope === 'في تبويب Generate Code: الصق الصلاحيات في Scope');
t('step 4, after the scope', STEPS.code === 'واختر 10 minutes في Time Duration، واكتب Mulaem في Scope Description، ثم اضغط CREATE. اختر Mulaem تحت Production، ثم CREATE، ثم COPY.');
t('step 5', STEPS.paste === 'الصق الرمز هنا واضغط «اختبار وحفظ». الرمز يعمل مرة واحدة ولمدة قصيرة، فإذا فشل الاختبار يلزم رمز جديد.');
t('the tab line', ZOHO_INTRO === 'يربط النظام بحساب شركتكم في Zoho، ويعرض أرقام آخر 7 أيام. لا يكتب شيئاً في Zoho حتى تطلب ذلك.');

/* ===================== كل رمز له نص عربي ===================== */

t('the check codes of the contract', same(CHECK_CODES, ['ok', 'invalid_client', 'invalid_code', 'throttled', 'no_refresh_token', 'wrong_environment', 'wrong_org', 'not_admin', 'token_revoked', 'scope_mismatch', 'no_permission', 'inactive_user', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response']));
t('the error codes of the contract', same(ERROR_CODES, ['unauthenticated', 'forbidden', 'bad_request', 'invalid_client_id', 'invalid_client_secret', 'invalid_code', 'not_connected', 'maqsam_not_connected', 'no_match', 'server_error']));
const FAILING = CHECK_CODES.filter((code) => code !== 'ok');
for (const code of FAILING) {
    t('failed save has text and says what to do: ' + code, arabic(saveFailureCopy(code).title) && arabic(saveFailureCopy(code).action));
    t('failed saved values have text and say what to do: ' + code, arabic(savedFailureCopy(code).title) && arabic(savedFailureCopy(code).action));
}
for (const code of ERROR_CODES) t('error code has Arabic text without a server message: ' + code, arabic(errorMessage(code)));

/* ===================== نصوص الفحص: النموذج ===================== */

const THE_CODE = 'مسحنا الرمز لأنه لا يعمل مرة ثانية، فأنشئ رمزاً جديداً من Generate Code والصقه هنا.';
const USE_ADMIN = 'سجّل الدخول بحساب مدير في Zoho، وانسخ Client ID وClient Secret من Self Client الخاص به.';
const FORM = {
    invalid_client: ['رفض Zoho قيمة Client ID أو Client Secret.', 'انسخهما من جديد من تبويب Client Secret.'],
    invalid_code: ['رفض Zoho الرمز: انتهت مدته أو استُعمل من قبل.', ''],
    throttled: ['محاولات كثيرة في وقت قصير.', 'انتظر بضع دقائق قبل المحاولة التالية.'],
    no_refresh_token: ['لم يعطنا Zoho مفتاحاً دائماً بهذا الرمز.', ''],
    wrong_environment: ['هذا الرمز ليس لبيئة الإنتاج في Zoho.', 'عند إنشاء الرمز اختر Mulaem تحت Production.'],
    wrong_org: ['هذا الرمز لشركة أخرى في Zoho، لا لشركة ملائم.', 'سجّل الدخول بحساب ملائم، واختر Mulaem تحت Production.'],
    not_admin: ['هذا الحساب في Zoho ليس مديراً، فالأرقام كانت ستظهر ناقصة.', USE_ADMIN],
    token_revoked: ['ألغى Zoho المفتاح قبل حفظه.', 'جرّب مرة ثانية.'],
    scope_mismatch: ['الرمز لا يحمل كل الصلاحيات المطلوبة.', 'انسخ الصلاحيات كاملة بزر «نسخ الصلاحيات» قبل إنشاء الرمز.'],
    no_permission: ['هذا الحساب في Zoho لا يملك صلاحية القراءة المطلوبة.', USE_ADMIN],
    inactive_user: ['هذا الحساب موقوف في Zoho.', USE_ADMIN],
    rate_limited: ['طلب Zoho التمهّل.', 'جرّب بعد دقيقة.'],
    timeout: ['لم يرد Zoho في الوقت المحدد، وربما استُعمل الرمز.', 'جرّب بعد قليل.'],
    network: ['تعذّر الوصول إلى Zoho، وربما استُعمل الرمز.', 'جرّب بعد قليل.'],
    server_error: ['عند Zoho خطأ مؤقت.', 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.'],
    bad_response: ['رد Zoho بصيغة غير متوقعة.', 'جرّب مرة ثانية. إذا تكرر فأخبر مسؤول النظام.']
};
t('the code sentence', NEW_CODE === THE_CODE);
t('every failure code has its form copy here', same(Object.keys(FORM), FAILING));
for (const [code, [title, action]] of Object.entries(FORM)) {
    const copy = saveFailureCopy({ code });
    t('failed save, prefix and copy: ' + code, copy.title === 'لم تُحفظ القيم. ' + title, copy);
    t('failed save says the code is gone: ' + code, copy.action === [action, THE_CODE].filter(Boolean).join(' '), copy);
}
t('a code alone reads as the check that carries it', same(saveFailureCopy('timeout'), saveFailureCopy({ code: 'timeout' })));
t('a failed save never says the check passed', saveFailureCopy('ok').title === 'لم تُحفظ القيم. رد Zoho بصيغة غير متوقعة.');
t('a failed save with no code', saveFailureCopy(undefined).title === 'لم تُحفظ القيم. رد Zoho بصيغة غير متوقعة.' && saveFailureCopy(null).title === 'لم تُحفظ القيم. رد Zoho بصيغة غير متوقعة.');
t('a prototype key is not a check code', same(saveFailureCopy('constructor'), saveFailureCopy('bad_response')) && same(savedFailureCopy('constructor'), savedFailureCopy('bad_response')) && same(savedFailureCopy('__proto__'), savedFailureCopy('bad_response')));
t('a timeout does not blame the values', !/Client|القيم غير/.test(saveFailureCopy('timeout').title + saveFailureCopy('network').title));

/* ===================== مدة الانتظار ===================== */

t('wait: a minute or less', waitText(30) === 'دقيقة واحدة' && waitText(60) === 'دقيقة واحدة');
t('wait: rounds up', waitText(61) === 'دقيقتين' && waitText(120) === 'دقيقتين' && waitText(121) === '3 دقائق');
t('wait: 3 to 10 minutes take the plural', waitText(600) === '10 دقائق' && waitText(300) === '5 دقائق');
t('wait: past 10 minutes the singular', waitText(660) === '11 دقيقة');
t('wait: unknown or nonsense says a few minutes', waitText(null) === 'بضع دقائق' && waitText(undefined) === 'بضع دقائق' && waitText(0) === 'بضع دقائق' && waitText(-5) === 'بضع دقائق' && waitText('x') === 'بضع دقائق' && waitText({}) === 'بضع دقائق');
const THROTTLED = readReply({ status: 'ok', saved: false, check: { ok: false, code: 'throttled', at: 'x', stats: null }, wait_seconds: 420, link: { connected: false }, sync: { enabled: false } }).check;
t('throttled: the wait beside the check reads with it', THROTTLED.code === 'throttled' && THROTTLED.wait_seconds === 420);
t('throttled on save says how long', saveFailureCopy(THROTTLED).action === 'انتظر 7 دقائق قبل المحاولة التالية. ' + THE_CODE, saveFailureCopy(THROTTLED));
t('throttled on saved values says how long, and no new code', savedFailureCopy(THROTTLED).action === 'انتظر 7 دقائق، ثم اضغط «فحص الربط الآن».', savedFailureCopy(THROTTLED));

/* ===================== نصوص الفحص: القيم المحفوظة ===================== */

const SAVED = {
    invalid_client: ['رفض Zoho قيمة Client ID أو Client Secret المحفوظة.', 'ربما حُذف Self Client أو تغيّرت قيمه. اضغط «تغيير القيم» واربط من جديد.'],
    invalid_code: ['لم يعد Zoho يقبل هذا الربط.', 'اضغط «تغيير القيم» واربط برمز جديد.'],
    throttled: ['طلب Zoho الانتظار.', 'انتظر بضع دقائق، ثم اضغط «فحص الربط الآن».'],
    no_refresh_token: ['لم يعد Zoho يقبل هذا الربط.', 'اضغط «تغيير القيم» واربط برمز جديد.'],
    wrong_environment: ['الربط المحفوظ ليس على بيئة الإنتاج في Zoho.', 'اضغط «تغيير القيم»، واختر Mulaem تحت Production عند إنشاء الرمز.'],
    wrong_org: ['الربط المحفوظ لشركة أخرى في Zoho، لا لشركة ملائم.', 'اضغط «تغيير القيم» واربط بحساب ملائم.'],
    not_admin: ['الحساب المربوط لم يعد مديراً في Zoho، فالأرقام قد تظهر ناقصة.', 'اضغط «تغيير القيم» واربط بحساب مدير.'],
    token_revoked: ['ألغى Zoho هذا الربط.', 'ربما أُلغي من حساب Zoho أو تغيّرت كلمة مروره. اضغط «تغيير القيم» واربط من جديد.'],
    scope_mismatch: ['الربط المحفوظ لا يحمل كل الصلاحيات المطلوبة.', 'اضغط «تغيير القيم»، وانسخ الصلاحيات كاملة عند إنشاء الرمز.'],
    no_permission: ['لم يعد الحساب المربوط يملك صلاحية القراءة في Zoho.', 'أعد له الصلاحية في Zoho، أو اضغط «تغيير القيم» واربط بحساب مدير.'],
    inactive_user: ['الحساب المربوط موقوف في Zoho.', 'فعّله في Zoho، أو اضغط «تغيير القيم» واربط بحساب مدير آخر.'],
    rate_limited: ['طلب Zoho التمهّل.', 'جرّب بعد دقيقة.'],
    timeout: ['لم يرد Zoho في الوقت المحدد.', 'جرّب مرة ثانية بعد قليل.'],
    network: ['تعذّر الوصول إلى Zoho.', 'جرّب مرة ثانية بعد قليل.'],
    server_error: ['عند Zoho خطأ مؤقت.', 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.'],
    bad_response: ['رد Zoho بصيغة غير متوقعة.', 'جرّب مرة ثانية. إذا تكرر فأخبر مسؤول النظام.']
};
t('every failure code has its saved copy here', same(Object.keys(SAVED), FAILING));
for (const [code, [title, action]] of Object.entries(SAVED)) {
    t('saved values failing: ' + code, same(savedFailureCopy({ code }), { title, action }), savedFailureCopy({ code }));
    t('saved values failing do not say to paste a code on a screen without one: ' + code, !savedFailureCopy({ code }).action.includes('مسحنا'));
}
t('saved values failing: a passed code or an unknown one reads as an unexpected reply', same(savedFailureCopy('ok'), savedFailureCopy('bad_response')) && same(savedFailureCopy(undefined), savedFailureCopy('bad_response')) && same(savedFailureCopy('new_code'), savedFailureCopy('bad_response')));
t('staff-facing failure text does not say API or token', Object.values(SAVED).concat(Object.values(FORM)).every(([title, action]) => !/\bAPI\b|token/i.test(title + action)));
t('the passed check', CHECK_OK === 'نجح الفحص.');

/* ===================== أخطاء الوظيفة ===================== */

t('unauthenticated copy, whatever the server said', errorMessage('unauthenticated', 'يلزم تسجيل الدخول') === 'انتهت الجلسة. أعد تحميل الصفحة وسجّل الدخول من جديد.');
t('invalid_client_id copy', errorMessage('invalid_client_id', 'x') === 'قيمة Client ID غير صحيحة. انسخها كاملة من تبويب Client Secret.');
t('invalid_client_secret copy', errorMessage('invalid_client_secret') === 'قيمة Client Secret غير صحيحة. انسخها كاملة من تبويب Client Secret.');
t('invalid_code copy', errorMessage('invalid_code') === 'الرمز غير صحيح. انسخه كاملاً بزر COPY في صفحة Zoho.');
t('not_connected copy', errorMessage('not_connected') === 'لا يوجد ربط محفوظ مع Zoho.');
t('maqsam_not_connected copy', errorMessage('maqsam_not_connected') === 'مقسم غير مربوط. اربطه أولاً من تبويب «مقسم».');
t('no_match copy', errorMessage('no_match') === 'لا يوجد ملف عميل بهذا الرقم في Zoho، فلم تُكتب الملاحظة.');
t('start refused copy', START_REFUSED === 'لا يعمل النقل إلا إذا كان مقسم وZoho مربوطين معاً.');
t('start refused: the server says which reason', startRefusal({ kind: 'error', code: 'not_connected', text: 'x', message: 'الربط يحتاج إعادة ربط.' }) === 'الربط يحتاج إعادة ربط.');
t('start refused: no server words, or not Arabic: the general text', startRefusal({ message: 'Not connected' }) === START_REFUSED && startRefusal({}) === START_REFUSED && startRefusal(null) === START_REFUSED && startRefusal({ message: 5 }) === START_REFUSED);
for (const code of ['forbidden', 'bad_request', 'server_error']) {
    t('server message shown: ' + code, errorMessage(code, 'رسالة الخادم') === 'رسالة الخادم');
    t('fallback without a message: ' + code, errorMessage(code) === 'تعذّر تنفيذ العملية' && errorMessage(code, '') === 'تعذّر تنفيذ العملية');
    t('fallback for an English message: ' + code, errorMessage(code, 'Internal Server Error') === 'تعذّر تنفيذ العملية');
}
t('a non-string message is ignored', errorMessage('forbidden', { a: 1 }) === 'تعذّر تنفيذ العملية');
t('each field error points at its input', errorField('invalid_client_id') === 'client_id' && errorField('invalid_client_secret') === 'client_secret' && errorField('invalid_code') === 'code');
t('other errors point at no input', errorField('forbidden') === null && errorField('constructor') === null && errorField(undefined) === null);
t('a save refused by the server: its reason and the code sentence', same(saveErrorCopy({ kind: 'error', text: 'سبب' }), { title: 'لم تُحفظ القيم. سبب', action: THE_CODE }));
t('a save that reached nothing: no blame, and the code sentence', same(saveErrorCopy({ kind: 'unreachable' }), { title: 'لم تُحفظ القيم. تعذّر الوصول إلى خدمة الربط.', action: 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام. ' + THE_CODE }));

/* ===================== قراءة الرد ===================== */

const OFF = { connected: false, org_name: null, user_name: null, user_profile: null, client_hint: null, connected_at: null, connected_by_name: null, check: null };
const STATS = { window_days: 7, calls: 40, calls_linked: 31, long_enough: 22, by_owner: [{ name: 'alsaiari', calls: 25 }, { name: 'سالم', calls: 15 }], leads_new: 9, active_users: 6 };
const OK_CHECK = { ok: true, code: 'ok', at: '2026-11-05T10:00:00.000Z', stats: STATS };
const ON = { connected: true, org_name: 'Mulaem', user_name: 'Mohammed', user_profile: 'Administrator', client_hint: 'A1B2', connected_at: '2026-11-01T08:00:00.000Z', connected_by_name: 'مدير تجريبي', check: OK_CHECK };
const SYNC_OFF = { enabled: false, started_at: null, start_from: null, started_by_name: null, last_run_at: null, last_run_code: null, written_total: 0, written_7d: 0, no_match_total: 0, waiting: 0, failed_total: 0, needs_reconnect: false };
const SYNC_ON = { enabled: true, started_at: '2026-11-05T09:00:00.000Z', start_from: '2026-11-05T09:00:00.000Z', started_by_name: 'مدير تجريبي', last_run_at: '2026-11-05T09:55:00.000Z', last_run_code: 'ok', written_total: 12, written_7d: 7, no_match_total: 3, waiting: 2, failed_total: 1, needs_reconnect: false };
const NOW = Date.parse('2026-11-05T10:00:00.000Z');

t('reply: status', (() => { const r = readReply({ status: 'ok', link: OFF, sync: SYNC_OFF }); return r.kind === 'ok' && r.link === OFF && r.sync === SYNC_OFF && r.check === null && r.saved === false && r.notRevoked === false && r.preview === null && r.written === null; })());
t('reply: a saved save', (() => { const r = readReply({ status: 'ok', saved: true, check: OK_CHECK, link: ON, sync: SYNC_OFF }); return r.saved === true && r.check === OK_CHECK && r.link === ON; })());
t('reply: saved must be exactly true', readReply({ status: 'ok', saved: 'true', link: OFF, sync: SYNC_OFF }).saved === false);
t('reply: sync alone is enough', (() => { const r = readReply({ status: 'ok', sync: SYNC_ON }); return r.kind === 'ok' && r.link === null && r.sync === SYNC_ON; })());
t('reply: a disconnect Zoho did not confirm', readReply({ status: 'ok', revoked: false, link: OFF, sync: SYNC_OFF }).notRevoked === true);
t('reply: a disconnect Zoho confirmed, or no word about it', readReply({ status: 'ok', revoked: true, link: OFF, sync: SYNC_OFF }).notRevoked === false && readReply({ status: 'ok', link: OFF, sync: SYNC_OFF }).notRevoked === false);
t('reply: a contract error', same(readReply({ status: 'error', code: 'invalid_client_id', message: 'x' }), { kind: 'error', code: 'invalid_client_id', text: 'قيمة Client ID غير صحيحة. انسخها كاملة من تبويب Client Secret.', field: 'client_id', message: 'x' }));
t('reply: an error with no code is a server error', same(readReply({ status: 'error', message: 'تعطل' }), { kind: 'error', code: 'server_error', text: 'تعطل', field: null, message: 'تعطل' }));
t('reply: replacing a link when Zoho did not confirm the old key is gone', readReply({ status: 'ok', saved: true, old_revoked: false, link: ON, sync: SYNC_OFF }).oldNotRevoked === true);
t('reply: replacing a link, confirmed or no word about it', readReply({ status: 'ok', saved: true, old_revoked: true, link: ON, sync: SYNC_OFF }).oldNotRevoked === false && readReply({ status: 'ok', saved: true, link: ON, sync: SYNC_OFF }).oldNotRevoked === false);
t('reply: the 404 of a function not deployed yet', readReply({ code: 'NOT_FOUND', message: 'Requested function was not found' }).kind === 'unreachable');
t('reply: a gateway 401', readReply({ code: 401, message: 'Invalid JWT' }).kind === 'unreachable');
t('reply: nothing, text, array', readReply(null).kind === 'unreachable' && readReply(undefined).kind === 'unreachable' && readReply('<html>').kind === 'unreachable' && readReply([]).kind === 'unreachable');
t('reply: ok without a link or a sync', readReply({ status: 'ok' }).kind === 'unreachable' && readReply({ status: 'ok', link: { host: 'x' } }).kind === 'unreachable' && readReply({ status: 'ok', sync: { waiting: 1 } }).kind === 'unreachable');

const NOTE = 'مكالمة مقسم: 5 نوفمبر 4:51 م، صادرة، 3 د 12 ث\nالموظف: سالم\nالملخص: اتفقا على موعد معاينة.';
const RECORD = 'https://crm.zoho.sa/crm/org150000145002/tab/Leads/1234567890';
const SAMPLE = { call_id: 12345678, at: 1762350660, direction: 'outbound', duration: 192, agent: 'سالم', note_title: 'مكالمة مقسم #12345678', note_text: NOTE, match: { module: 'Leads', id: '1234567890', url: RECORD }, ambiguous: false };
const PREVIEW = { counts: { calls: 40, with_summary: 12, already_written: 2, matched: 7, no_match: 2, ambiguous: 1 }, samples: [SAMPLE, Object.assign({}, SAMPLE, { call_id: 2, note_title: 'مكالمة مقسم #2', match: null }), Object.assign({}, SAMPLE, { call_id: 3, ambiguous: true })] };

const read = readReply({ status: 'ok', preview: PREVIEW, sync: SYNC_OFF }).preview;
t('preview: read', read.samples.length === 3 && read.counts === PREVIEW.counts);
t('preview: a sample as it will be written, nothing touched', read.samples[0].callId === 12345678 && read.samples[0].title === 'مكالمة مقسم #12345678' && read.samples[0].text === NOTE);
t('preview: where it goes', same(read.samples[0].match, { module: 'Leads', id: '1234567890', url: RECORD }) && read.samples[0].ambiguous === false);
t('preview: no match, and a flag for more than one', read.samples[1].match === null && read.samples[2].ambiguous === true);
t('preview: starts unwritten', read.samples[0].written === null && read.samples[0].error === null);
t('preview: at most five samples', readReply({ status: 'ok', sync: SYNC_OFF, preview: { counts: {}, samples: [1, 2, 3, 4, 5, 6, 7].map((n) => Object.assign({}, SAMPLE, { call_id: n })) } }).preview.samples.length === 5);
t('preview: what is not a sample is dropped', readReply({ status: 'ok', sync: SYNC_OFF, preview: { samples: [null, 'x', {}, { call_id: 1 }, { note_text: 'x' }, { call_id: '', note_text: 'x' }, { call_id: {}, note_text: 'x' }] } }).preview.samples.length === 0);
t('preview: markup in a summary stays as it came, for textContent', readReply({ status: 'ok', sync: SYNC_OFF, preview: { samples: [Object.assign({}, SAMPLE, { note_text: '<img src=x onerror=1>' })] } }).preview.samples[0].text === '<img src=x onerror=1>');
t('preview: none in the reply', readReply({ status: 'ok', sync: SYNC_OFF }).preview === null && readReply({ status: 'ok', sync: SYNC_OFF, preview: 'x' }).preview === null);

t('record link: the contract form', recordUrl(RECORD) === RECORD && recordUrl('https://crm.zoho.sa/crm/org150000145002/tab/Contacts/99') !== null);
for (const bad of ['http://crm.zoho.sa/crm/org150000145002/tab/Leads/1', 'https://crm.zoho.sa.evil.test/crm/org150000145002/tab/Leads/1', 'https://evil.test/https://crm.zoho.sa/crm/org150000145002/tab/Leads/1', 'https://crm.zoho.com/crm/org150000145002/tab/Leads/1', 'https://crm.zoho.sa/crm/org1/tab/Leads/1', 'https://crm.zoho.sa/crm/org150000145002/tab/Leads/1/../../x', 'https://crm.zoho.sa/crm/org150000145002/tab/Leads/1?x=1', 'javascript:alert(1)', '', null, undefined, 5]) {
    t('record link refused: ' + bad, recordUrl(bad) === null);
}
t('preview: a match with a strange link stays writable, with no link', (() => { const s = readReply({ status: 'ok', sync: SYNC_OFF, preview: { samples: [Object.assign({}, SAMPLE, { match: { module: 'Leads', id: '1', url: 'https://evil.test/' } })] } }).preview.samples[0]; return s.match && s.match.url === null; })());
t('written: read', same(readReply({ status: 'ok', sync: SYNC_ON, written: { note_id: 'n1', module: 'Leads', record_id: '1234567890', url: RECORD } }).written, { noteId: 'n1', module: 'Leads', recordId: '1234567890', url: RECORD }));
t('written: a strange link is not kept', readReply({ status: 'ok', sync: SYNC_ON, written: { note_id: 'n1', module: 'Leads', record_id: '1', url: 'javascript:alert(1)' } }).written.url === null);

/* ===================== حالة الربط ===================== */

const off = statusView(OFF);
t('not connected: badge', off.connected === false && off.badge.text === 'غير مربوط' && off.badge.tone === 'neutral');
t('not connected: no rows, problem or stats', same(off.rows, []) && off.problem === null && off.stats === null && off.relink === false);
t('no link at all is not connected', statusView(null).connected === false && statusView(undefined).badge.text === 'غير مربوط');

const on = statusView(ON, SYNC_OFF, NOW);
t('connected, last check ok: badge', on.connected === true && on.badge.text === 'مربوط' && on.badge.tone === 'green' && on.problem === null && on.relink === false);
t('connected: row labels in order', same(on.rows.map((r) => r.label), ['الشركة', 'حساب Zoho', 'رقم Client ID', 'رُبط بواسطة', 'آخر فحص']));
t('connected: the company', on.rows[0].value === 'Mulaem');
t('connected: the account and its profile', on.rows[1].value === 'Mohammed · Administrator');
t('connected: the hint is left-to-right, and only the hint', on.rows[2].value === '••••A1B2' && on.rows[2].ltr === true);
t('connected: who and when', on.rows[3].value === 'مدير تجريبي' && on.rows[3].at === '2026-11-01T08:00:00.000Z');
t('connected: last check date', on.rows[4].at === '2026-11-05T10:00:00.000Z');
t('connected: stats from the last check', on.stats === STATS);
t('no hint: the row is left out', same(statusView(Object.assign({}, ON, { client_hint: null })).rows.map((r) => r.label), ['الشركة', 'حساب Zoho', 'رُبط بواسطة', 'آخر فحص']));
t('no profile: the name alone', statusView(Object.assign({}, ON, { user_profile: null })).rows[1].value === 'Mohammed');
t('no check yet: still «مربوط», no problem, no stats', (() => { const v = statusView(Object.assign({}, ON, { check: null })); return v.badge.text === 'مربوط' && v.problem === null && v.stats === null && v.rows[v.rows.length - 1].at === null; })());
t('ok check without stats: the numbers are hidden', statusView(Object.assign({}, ON, { check: { ok: true, code: 'ok', at: 'x', stats: null } })).stats === null);

for (const [code, [title, action]] of Object.entries(SAVED)) {
    const view = statusView(Object.assign({}, ON, { check: { ok: false, code, at: '2026-11-05T10:00:00.000Z', stats: null } }));
    t('failed check: badge, copy, no stats: ' + code, view.badge.text === 'فيه مشكلة' && view.badge.tone === 'red' && same(view.problem, { title, action }) && view.stats === null);
}
const needsLink = ['invalid_client', 'invalid_code', 'no_refresh_token', 'wrong_environment', 'wrong_org', 'not_admin', 'token_revoked', 'scope_mismatch'];
for (const code of FAILING) t('failed check: only a new link helps, or not: ' + code, statusView(Object.assign({}, ON, { check: { ok: false, code, at: 'x', stats: null } })).relink === needsLink.includes(code));
t('failed check hides numbers even if some came along', statusView(Object.assign({}, ON, { check: { ok: false, code: 'timeout', at: 'x', stats: STATS } })).stats === null);
t('a failed check never reads as passed', statusView(Object.assign({}, ON, { check: { ok: false, code: 'ok', at: 'x', stats: null } })).problem.title === 'رد Zoho بصيغة غير متوقعة.');
const refused = Object.assign({}, SYNC_ON, { needs_reconnect: true });
t('the sync says Zoho refused: the link has a problem though the last check passed', (() => { const v = statusView(ON, refused, NOW); return v.badge.text === 'فيه مشكلة' && v.relink === true && v.problem === null && v.stats === STATS; })());

const HOUR = 3600 * 1000;
t('stale: not connected, no date', statusView(OFF).stale === false && statusView(OFF).checkedAt === null);
t('stale: the date of the last check comes along', statusView(ON, null, NOW).checkedAt === '2026-11-05T10:00:00.000Z');
t('stale: a check today is not stale', statusView(ON, null, NOW + HOUR).stale === false);
t('stale: exactly 24 hours is not stale yet', statusView(ON, null, NOW + 24 * HOUR).stale === false);
t('stale: past 24 hours it is, and keeps its numbers', statusView(ON, null, NOW + 24 * HOUR + 1).stale === true && statusView(ON, null, NOW + 24 * HOUR + 1).stats === STATS);
t('stale: an unreadable date does not count', statusView(Object.assign({}, ON, { check: Object.assign({}, OK_CHECK, { at: 'x' }) }), null, NOW + 21 * 24 * HOUR).stale === false);
t('stale: no check is not stale', statusView(Object.assign({}, ON, { check: null }), null, NOW).stale === false);
t('stale: the text names the button', STALE_TEXT === 'هذه أرقام قديمة. اضغط «فحص الربط الآن».');

t('the account line names the person', accountLine(ON) === 'هذا الربط يعتمد على حساب Mohammed في Zoho: إذا توقف هذا الحساب يتوقف الربط، ويلزم ربطه من جديد.');
t('the account line with no name', accountLine(Object.assign({}, ON, { user_name: null })) === 'هذا الربط يعتمد على حساب من ربطه في Zoho: إذا توقف هذا الحساب يتوقف الربط، ويلزم ربطه من جديد.');

t('settings line: not connected', settingsLine(OFF, SYNC_OFF) === 'Zoho CRM: غير مربوط');
t('settings line: connected', settingsLine(ON, SYNC_OFF) === 'Zoho CRM: مربوط' && settingsLine(ON) === 'Zoho CRM: مربوط');
t('settings line: a failed check', settingsLine(Object.assign({}, ON, { check: { ok: false, code: 'timeout', at: 'x', stats: null } }), SYNC_OFF) === 'Zoho CRM: فيه مشكلة');
t('settings line: Zoho refused the sync', settingsLine(ON, refused) === 'Zoho CRM: فيه مشكلة');

/* ===================== الأرقام ===================== */

const rows = statsRows(STATS);
t('stats: labels in order', same(rows.map((r) => r.label), ['المكالمات', 'مربوطة بملف عميل', '30 ثانية فأكثر', 'عملاء محتملون جدد', 'الموظفون النشطون']));
t('stats: values', same(rows.map((r) => r.value), [40, 31, 22, 9, 6]));
t('stats: a count that failed stays null, a real zero stays zero', same(statsRows(Object.assign({}, STATS, { calls: null, leads_new: 0 })).map((r) => r.value), [null, 31, 22, 0, 6]));
t('stats: nothing at all is null, never zero', statsRows(null).every((r) => r.value === null) && statsRows({}).every((r) => r.value === null));
t('numbers: what is not a number is null', numberOrNull(null) === null && numberOrNull('') === null && numberOrNull('x') === null && numberOrNull({}) === null && numberOrNull(NaN) === null && numberOrNull(undefined) === null && numberOrNull(true) === null && numberOrNull('7') === 7 && numberOrNull(0) === 0);
t('owners: as sent', same(ownersView(STATS), [{ name: 'alsaiari', calls: 25 }, { name: 'سالم', calls: 15 }]));
t('owners: only what has a name; a failed number stays null', same(ownersView({ by_owner: [{ name: 'a', calls: null }, { calls: 3 }, 'x', null, { name: '  ', calls: 1 }] }), [{ name: 'a', calls: null }]));
t('owners: nothing', same(ownersView(null), []) && same(ownersView({ by_owner: 'x' }), []));
t('notes: a healthy week says nothing', same(statsNotes(statusView(ON, null, NOW)), []));
t('notes: old numbers', same(statsNotes(statusView(ON, null, NOW + 25 * HOUR)), [STALE_TEXT]));
t('notes: a count that failed', same(statsNotes(statusView(Object.assign({}, ON, { check: Object.assign({}, OK_CHECK, { stats: Object.assign({}, STATS, { calls: null }) }) }), null, NOW)), [COUNT_FAILED_TEXT]));
t('notes: the text of a failed count', COUNT_FAILED_TEXT === 'لم نستطع قراءة بعض الأرقام، فظهرت «—». اضغط «فحص الربط الآن» لاحقاً.');
t('notes: no numbers, no notes', same(statsNotes(statusView(OFF)), []) && same(statsNotes(null), []));

/* ===================== نقل الملخصات ===================== */

t('sync: texts', SYNC_TITLE === 'نقل ملخصات مقسم إلى Zoho' && SYNC_WHAT === 'يكتب ملاحظة في ملف العميل لكل مكالمة فيها ملخص. لا يغيّر أي حقل، ولا يرسل شيئاً للعميل.'
    && SYNC_RUNNING === 'يعمل في الخلفية كل 5 دقائق، ويكتب الملاحظات تلقائياً حتى تضغط «إيقاف النقل».' && MAQSAM_MISSING === 'مقسم غير مربوط، فلا يوجد ما يُنقل. اربطه أولاً من تبويب «مقسم».');

const AGAIN = 'سيُعاد التشغيل تلقائياً.';
const AGAIN_ZOHO = AGAIN + ' إذا تكرر فاضغط «فحص الربط الآن».';
const AGAIN_MAQSAM = AGAIN + ' إذا تكرر فافتح تبويب «مقسم» واضغط «فحص الربط الآن» هناك.';
const RUNS = {
    zoho_not_connected: { title: 'لم نجد ربط Zoho في آخر تشغيل، فلم يُكتب شيء.', action: 'اضغط «فحص الربط الآن». إذا فشل فاضغط «تغيير القيم» واربط من جديد.' },
    maqsam_not_connected: { title: 'النقل مفعّل ولكن مقسم غير مربوط، فلا يُكتب شيء.', action: 'اربط مقسم من تبويب «مقسم»، أو اضغط «إيقاف النقل».' },
    maqsam_unauthorized: { title: 'رفض مقسم القيم المحفوظة في آخر تشغيل.', action: 'افتح تبويب «مقسم» واضغط «فحص الربط الآن» هناك.' },
    maqsam_not_found: { title: 'لم نجد مكالمات مقسم على الرابط المحفوظ في آخر تشغيل.', action: 'افتح تبويب «مقسم» واضغط «فحص الربط الآن» هناك.' },
    maqsam_rate_limited: { title: 'طلب مقسم التمهّل في آخر تشغيل.', action: AGAIN },
    maqsam_timeout: { title: 'لم يرد مقسم في الوقت المحدد في آخر تشغيل.', action: AGAIN_MAQSAM },
    maqsam_network: { title: 'تعذّر الوصول إلى مقسم في آخر تشغيل.', action: AGAIN_MAQSAM },
    maqsam_server_error: { title: 'كان عند مقسم خطأ مؤقت في آخر تشغيل.', action: AGAIN_MAQSAM },
    maqsam_bad_response: { title: 'رد مقسم بصيغة غير متوقعة في آخر تشغيل.', action: AGAIN_MAQSAM },
    throttled: { title: 'طلب Zoho الانتظار في آخر تشغيل.', action: AGAIN },
    rate_limited: { title: 'طلب Zoho التمهّل في آخر تشغيل.', action: AGAIN },
    timeout: { title: 'لم يرد Zoho في الوقت المحدد في آخر تشغيل.', action: AGAIN_ZOHO },
    network: { title: 'تعذّر الوصول إلى Zoho في آخر تشغيل.', action: AGAIN_ZOHO },
    server_error: { title: 'كان عند Zoho خطأ مؤقت في آخر تشغيل.', action: AGAIN_ZOHO },
    bad_response: { title: 'رد Zoho بصيغة غير متوقعة في آخر تشغيل.', action: AGAIN_ZOHO }
};

const stopped = syncView(SYNC_OFF, true, NOW);
t('stopped: badge, no problem, no rows, can preview', stopped.badge.text === 'متوقف' && stopped.badge.tone === 'neutral' && stopped.enabled === false && stopped.problem === null && same(stopped.rows, []) && stopped.canPreview === true);
t('no sync at all reads as stopped', syncView(null, true, NOW).badge.text === 'متوقف' && syncView(undefined, null, NOW).canPreview === true);
t('stopped, Maqsam unknown: previews, and the server decides', syncView(SYNC_OFF, null, NOW).canPreview === true && syncView(SYNC_OFF, null, NOW).maqsamMissing === false);
t('stopped, Maqsam not linked: says so, no preview', (() => { const v = syncView(SYNC_OFF, false, NOW); return v.maqsamMissing === true && v.canPreview === false && v.problem === null && v.badge.text === 'متوقف'; })());
const hadRun = syncView(Object.assign({}, SYNC_ON, { enabled: false, last_run_code: 'timeout' }), true, NOW);
t('stopped after a run: its numbers stay; an old failure is no alarm', hadRun.badge.text === 'متوقف' && hadRun.problem === null && hadRun.rows.length === 7 && hadRun.canPreview === true);

const running = syncView(SYNC_ON, true, NOW);
t('running: badge', running.badge.text === 'يعمل' && running.badge.tone === 'green' && running.enabled === true && running.problem === null && running.canPreview === false);
t('running: row labels in order', same(running.rows.map((r) => r.label), ['آخر تشغيل', 'شغّله', 'ينقل المكالمات من', 'كُتبت', 'بانتظار ملخص أو ملف عميل', 'بلا ملف عميل', 'فشلت']));
t('running: last run date', running.rows[0].at === SYNC_ON.last_run_at && running.rows[0].value === '');
t('running: who and when', running.rows[1].value === 'مدير تجريبي' && running.rows[1].at === SYNC_ON.started_at);
t('running: from a date', running.rows[2].at === SYNC_ON.start_from);
t('running: the numbers', same(running.rows.slice(3).map((r) => r.value), [12, 2, 3, 1]));
t('running: written this week beside the total', running.rows[3].note === 'آخر 7 أيام: 7');
t('running: a number the server could not read stays null', syncView(Object.assign({}, SYNC_ON, { waiting: null, written_7d: null }), true, NOW).rows[4].value === null && syncView(Object.assign({}, SYNC_ON, { written_7d: null }), true, NOW).rows[3].note === null);
t('running: not run yet says when', (() => { const v = syncView(Object.assign({}, SYNC_ON, { started_at: new Date(NOW - 60000).toISOString(), last_run_at: null, last_run_code: null }), true, NOW); return v.rows[0].value === NOT_RUN_YET && v.rows[0].at === null && v.problem === null; })());
t('running: never run for over half an hour counts as late', syncView(Object.assign({}, SYNC_ON, { started_at: new Date(NOW - 31 * 60000).toISOString(), last_run_at: null, last_run_code: null }), true, NOW).problem.title === 'لم يعمل النقل منذ أكثر من 30 دقيقة.');

const reconnect = syncView(refused, true, NOW);
t('needs reconnect: red, says what to do', reconnect.badge.text === 'فيه مشكلة' && reconnect.badge.tone === 'red' && reconnect.reconnect === true && same(reconnect.problem, { title: 'توقف النقل لأن Zoho لم يعد يقبل هذا الربط.', action: 'اضغط «تغيير القيم» واربط من جديد بحساب مدير. لا يُكتب شيء في Zoho حتى ذلك الحين.' }));
t('needs reconnect while stopped: same, and no preview', (() => { const v = syncView(Object.assign({}, SYNC_OFF, { needs_reconnect: true }), true, NOW); return v.badge.text === 'فيه مشكلة' && v.canPreview === false; })());
t('running, Maqsam not linked', same(syncView(SYNC_ON, false, NOW).problem, { title: 'النقل مفعّل ولكن مقسم غير مربوط، فلا يُكتب شيء.', action: 'اربط مقسم من تبويب «مقسم»، أو اضغط «إيقاف النقل».' }));
t('running, the last run failed: its Arabic text', (() => { const v = syncView(Object.assign({}, SYNC_ON, { last_run_code: 'timeout' }), true, NOW); return v.badge.text === 'فيه مشكلة' && same(v.problem, RUNS.timeout); })());
t('running, the cap of one run is no problem: the rest goes in the next', syncView(Object.assign({}, SYNC_ON, { last_run_code: 'capped' }), true, NOW).problem === null && syncView(Object.assign({}, SYNC_ON, { last_run_code: 'capped' }), true, NOW).badge.text === 'يعمل');
t('running, a run code we do not know: a general Arabic text', (() => { const v = syncView(Object.assign({}, SYNC_ON, { last_run_code: 'something_new' }), true, NOW); return same(v.problem, { title: 'لم يكتمل آخر تشغيل.', action: 'سيُعاد التشغيل تلقائياً. إذا تكرر فأخبر مسؤول النظام.' }); })());
const MIN = 60 * 1000;
t('running, the last run half an hour ago is on time', syncView(Object.assign({}, SYNC_ON, { last_run_at: new Date(NOW - 30 * MIN).toISOString() }), true, NOW).problem === null);
t('running, nothing for over half an hour: says so', same(syncView(Object.assign({}, SYNC_ON, { last_run_at: new Date(NOW - 30 * MIN - 1).toISOString() }), true, NOW).problem, { title: 'لم يعمل النقل منذ أكثر من 30 دقيقة.', action: 'انتظر قليلاً وأعد فتح الصفحة. إذا تكرر فأخبر مسؤول النظام.' }));
t('run code: ok or nothing has no text', runCopy('ok') === null && runCopy(null) === null && runCopy(undefined) === null && runCopy('') === null);
t('run code: capped has no text', runCopy('capped') === null);
for (const [code, copy] of Object.entries(RUNS)) t('run code: ' + code, same(runCopy(code), copy), runCopy(code));
// رموز رفض Zoho: نص الفحص نفسه، فالحل واحد
for (const code of ['invalid_client', 'token_revoked', 'scope_mismatch', 'no_permission', 'inactive_user', 'wrong_environment']) t('run code reads as the saved check: ' + code, same(runCopy(code), savedFailureCopy(code)));
t('run code: a prototype key is no code', same(runCopy('constructor'), { title: 'لم يكتمل آخر تشغيل.', action: 'سيُعاد التشغيل تلقائياً. إذا تكرر فأخبر مسؤول النظام.' }));

/* ===================== الزر الرئيسي ===================== */

const healthy = statusView(ON, SYNC_OFF, NOW);
const failedCheck = statusView(Object.assign({}, ON, { check: { ok: false, code: 'timeout', at: 'x', stats: null } }), SYNC_OFF, NOW);
const revokedCheck = statusView(Object.assign({}, ON, { check: { ok: false, code: 'token_revoked', at: 'x', stats: null } }), SYNC_OFF, NOW);
t('primary: not connected or the form open: save', primaryAction(statusView(OFF), stopped, false, false) === 'save' && primaryAction(healthy, stopped, true, false) === 'save' && primaryAction(healthy, stopped, true, true) === 'save');
t('primary: healthy and stopped: preview first', primaryAction(healthy, stopped, false, false) === 'preview');
t('primary: the preview on screen: start', primaryAction(healthy, stopped, false, true) === 'start');
t('primary: running: check', primaryAction(healthy, running, false, false) === 'test');
t('primary: Maqsam not linked: check', primaryAction(healthy, syncView(SYNC_OFF, false, NOW), false, false) === 'test');
t('primary: a passing moment of failure: check', primaryAction(failedCheck, stopped, false, false) === 'test');
t('primary: only a new link helps: change', primaryAction(revokedCheck, stopped, false, false) === 'change' && primaryAction(statusView(ON, refused, NOW), reconnect, false, false) === 'change');

t('start: the two choices, the safer first', same(START_CHOICES.map((c) => [c.value, c.label]), [['now', 'من الآن'], ['days30', 'ومعها آخر 30 يوماً']]) && START_CHOICES.every((c) => arabic(c.hint)));
t('start: states that notes are written automatically', START_NOTE === 'بعد التشغيل يكتب النظام الملاحظات في Zoho تلقائياً كل 5 دقائق، بلا سؤال، حتى تضغط «إيقاف النقل».');

/* ===================== المعاينة ===================== */

const pRows = previewRows(PREVIEW);
t('preview rows: labels in order', same(pRows.map((r) => r.label), ['مكالمات آخر 7 أيام', 'فيها ملخص', 'كُتبت من قبل', 'من العينة: لها ملف عميل', 'من العينة: بلا ملف عميل', 'من العينة: لها أكثر من ملف']));
t('preview rows: values', same(pRows.map((r) => r.value), [40, 12, 2, 7, 2, 1]));
t('preview rows: under the first page, no note', pRows[0].note === null);
t('preview rows: a full first page says so', previewRows({ counts: { calls: 100 } })[0].note === 'أول 100');
t('preview rows: nothing is null', previewRows(null).every((r) => r.value === null) && previewRows({}).every((r) => r.value === null));
t('preview: texts', NO_MATCH_TEXT === 'لا يوجد ملف عميل بهذا الرقم' && PREVIEW_NOTE === 'هذا ما سيُكتب في Zoho كما هو. لم يُكتب شيء بعد.' && PREVIEW_EMPTY === 'لا توجد في آخر 7 أيام مكالمة فيها ملخص ولم تُكتب بعد.'
    && WRITE_NOTE === 'تُكتب هذه الملاحظة فعلاً في ملف العميل، ولا يمكن حذفها من هنا. لا يتغيّر أي حقل، ولا يصل شيء للعميل.' && AMBIGUOUS_TEXT === 'بهذا الرقم أكثر من ملف عميل: تُكتب الملاحظة في آخر ملف تغيّر.');

t('sync: a shared number is counted only when it happened', syncView(SYNC_ON, true, NOW).rows.every((r) => r.key !== 'ambiguous')
    && syncView(Object.assign({}, SYNC_ON, { ambiguous_total: 0 }), true, NOW).rows.every((r) => r.key !== 'ambiguous')
    && syncView(Object.assign({}, SYNC_ON, { ambiguous_total: 2 }), true, NOW).rows.find((r) => r.key === 'ambiguous').value === 2
    && syncView(Object.assign({}, SYNC_ON, { ambiguous_total: 2 }), true, NOW).rows.find((r) => r.key === 'ambiguous').label === 'منها برقم على أكثر من ملف');

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
