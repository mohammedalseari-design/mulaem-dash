// اختبار crm/js/maqsam-link-model.js: نص كل رمز فحص وكل رمز خطأ، وقراءة رد الوظيفة، وحالة الربط، وصفوف الأرقام، وسطور التحذير.
// النصوص تُقارن كما هي حرفياً، فأي تغيير في نص يظهر للموظف يظهر هنا أولاً.
// التشغيل: node tests/maqsam-link-model.test.mjs
import {
    LINK_TITLE, LINK_INTRO, DEFAULT_HOST, REQUEST_TEXT, TEXTS_REQUEST, FAULT_REQUEST, SUPPORT_EMAIL, STALE_TEXT, CHECK_CODES, ERROR_CODES, NOT_SAVED, FALLBACK_ERROR, UNREACHABLE_TEXT, UNREACHABLE_HINT,
    checkCopy, saveFailureCopy, savedFailureCopy, errorMessage, errorField, readReply, statusView, settingsLine, statsRows, agentsView, advice, asksMaqsam, mailHref
} from '../crm/js/maqsam-link-model.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arabic = (text) => typeof text === 'string' && /[؀-ۿ]/.test(text);

/* ===================== كل رمز له نص عربي ===================== */

t('the eight check codes of the contract', same(CHECK_CODES, ['ok', 'unauthorized', 'not_found', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response']));
t('the eight error codes of the contract', same(ERROR_CODES, ['unauthenticated', 'forbidden', 'bad_request', 'invalid_host', 'invalid_key_id', 'invalid_secret', 'not_connected', 'server_error']));
for (const code of CHECK_CODES) t('check code has Arabic text: ' + code, arabic(checkCopy(code).title));
for (const code of CHECK_CODES.filter((c) => c !== 'ok')) t('failed check says what to do: ' + code, arabic(checkCopy(code).action));
for (const code of ERROR_CODES) t('error code has Arabic text without a server message: ' + code, arabic(errorMessage(code)));

/* ===================== نصوص الفحص ===================== */

const FAILURES = {
    unauthorized: ['رفض مقسم هذه القيم.', 'تأكد من نسخ رقم مفتاح التعريف وكلمة السر كاملين.'],
    not_found: ['لم نجد واجهة برمجة التطبيقات على هذا الرابط.', 'تأكد من الرابط الأساسي بزر «عرض الرابط الأساسي» في مقسم.'],
    rate_limited: ['طلب مقسم التمهّل.', 'جرّب بعد دقيقة.'],
    timeout: ['لم يرد مقسم في الوقت المحدد.', 'جرّب مرة ثانية بعد قليل.'],
    network: ['تعذّر الوصول إلى مقسم.', 'تأكد من الرابط الأساسي، ثم جرّب مرة ثانية.'],
    server_error: ['عند مقسم خطأ مؤقت.', 'جرّب بعد قليل. إذا تكرر فراسل دعمهم.'],
    bad_response: ['رد مقسم بصيغة غير متوقعة.', 'جرّب مرة ثانية. إذا تكرر فراسل دعمهم.']
};
// القيم المحفوظة: لا حقول على الشاشة، فالنص يقول إلى أين يذهب. البقية كنص النموذج
const SAVED_FAILURES = {
    ...FAILURES,
    unauthorized: ['رفض مقسم القيم المحفوظة.', 'ربما تغيّر المفتاح في مقسم. اضغط «تغيير القيم» والصق القيم الحالية.'],
    not_found: ['لم نجد واجهة برمجة التطبيقات على الرابط المحفوظ.', 'قارنه بزر «عرض الرابط الأساسي» في مقسم. إذا اختلف فاضغط «تغيير القيم» وصحّحه.'],
    network: ['تعذّر الوصول إلى مقسم.', 'جرّب مرة ثانية بعد قليل. إذا تكرر فقارن الرابط المحفوظ بزر «عرض الرابط الأساسي» في مقسم، وصحّحه من «تغيير القيم».']
};
for (const [code, [title, action]] of Object.entries(FAILURES)) {
    t('check copy: ' + code, checkCopy(code).title === title && checkCopy(code).action === action, checkCopy(code));
    t('failed save is prefixed: ' + code, saveFailureCopy(code).title === 'لم تُحفظ القيم. ' + title && saveFailureCopy(code).action === action, saveFailureCopy(code));
}
for (const [code, [title, action]] of Object.entries(SAVED_FAILURES)) {
    t('saved values failing: ' + code, savedFailureCopy(code).title === title && savedFailureCopy(code).action === action, savedFailureCopy(code));
}
t('saved values failing: no copying talk, and the next step is named', ['unauthorized', 'not_found', 'network'].every((code) => !savedFailureCopy(code).action.includes('نسخ') && savedFailureCopy(code).action.includes('«تغيير القيم»')));
t('saved values failing: a passed code or an unknown one reads as an unexpected reply', same(savedFailureCopy('ok'), checkCopy('bad_response')) && same(savedFailureCopy('constructor'), checkCopy('bad_response')) && same(savedFailureCopy(undefined), checkCopy('bad_response')));
t('staff-facing failure text does not say API', Object.values(SAVED_FAILURES).concat(Object.values(FAILURES)).every(([title, action]) => !/API/.test(title + action)));
t('the failed-save prefix', NOT_SAVED === 'لم تُحفظ القيم.');
t('an unknown check code reads as an unexpected reply', same(checkCopy('new_code'), checkCopy('bad_response')));
t('a prototype key is not a check code', same(checkCopy('constructor'), checkCopy('bad_response')) && same(checkCopy(undefined), checkCopy('bad_response')));
t('a failed save with no code', saveFailureCopy(undefined).title === 'لم تُحفظ القيم. رد مقسم بصيغة غير متوقعة.');
t('a failed save never says the check passed', saveFailureCopy('ok').title === 'لم تُحفظ القيم. رد مقسم بصيغة غير متوقعة.');

/* ===================== نصوص الأخطاء ===================== */

const INVALID_HOST = 'انسخ الرابط الأساسي كما يظهر بعد زر «عرض الرابط الأساسي» في مقسم، مثل av.maqsam.com.';

t('invalid_host copy, whatever the server said', errorMessage('invalid_host', 'x') === INVALID_HOST);
t('unauthenticated copy, whatever the server said', errorMessage('unauthenticated', 'يلزم تسجيل الدخول') === 'انتهت الجلسة. أعد تحميل الصفحة وسجّل الدخول من جديد.');
t('invalid_key_id copy', errorMessage('invalid_key_id') === 'رقم مفتاح التعريف غير صحيح. انسخه كاملاً بدون مسافات.');
t('invalid_secret copy', errorMessage('invalid_secret') === 'كلمة السر غير صحيحة. انسخها كاملة.');
t('not_connected copy', errorMessage('not_connected') === 'لا يوجد ربط محفوظ.');
for (const code of ['forbidden', 'bad_request', 'server_error']) {
    t('server message shown: ' + code, errorMessage(code, 'رسالة الخادم') === 'رسالة الخادم');
    t('fallback without a message: ' + code, errorMessage(code) === 'تعذّر تنفيذ العملية' && errorMessage(code, '') === 'تعذّر تنفيذ العملية');
    t('fallback for an English message: ' + code, errorMessage(code, 'Internal Server Error') === 'تعذّر تنفيذ العملية');
}
t('the fallback text', FALLBACK_ERROR === 'تعذّر تنفيذ العملية');
t('the unreachable text', UNREACHABLE_TEXT === 'تعذّر الوصول إلى خدمة الربط' && UNREACHABLE_HINT === 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.');
t('a non-string message is ignored', errorMessage('forbidden', { a: 1 }) === 'تعذّر تنفيذ العملية');
t('each field error points at its input', errorField('invalid_host') === 'base_url' && errorField('invalid_key_id') === 'access_key_id' && errorField('invalid_secret') === 'access_secret');
t('other errors point at no input', errorField('forbidden') === null && errorField('constructor') === null && errorField(undefined) === null);

/* ===================== قراءة الرد ===================== */

const OFF = { connected: false, host: null, key_hint: null, connected_at: null, connected_by_name: null, check: null };
const STATS = {
    window_days: 7, calls: 42, capped: false, talked: 30, long_enough: 18, with_summary: 12, with_transcript: 9, latest_at: '2026-11-04T09:30:00.000Z',
    agents: [{ email: 'salem@example.test', calls: 25 }, { email: 'noura@example.test', calls: 15 }], no_agent: 2
};
const OK_CHECK = { ok: true, code: 'ok', at: '2026-11-05T10:00:00.000Z', stats: STATS };
const ON = { connected: true, host: 'acme.maqsam.com', key_hint: '5678', connected_at: '2026-11-01T08:00:00.000Z', connected_by_name: 'مدير تجريبي', check: OK_CHECK };

t('reply: status', same(readReply({ status: 'ok', link: OFF }), { kind: 'ok', link: OFF, check: null, saved: false }));
t('reply: a saved save', same(readReply({ status: 'ok', saved: true, check: OK_CHECK, link: ON }), { kind: 'ok', link: ON, check: OK_CHECK, saved: true }));
t('reply: a refused save', readReply({ status: 'ok', saved: false, check: { ok: false, code: 'unauthorized', at: 'x', stats: null }, link: OFF }).saved === false);
t('reply: saved must be exactly true', readReply({ status: 'ok', saved: 'true', link: OFF }).saved === false);
t('reply: a contract error', same(readReply({ status: 'error', code: 'invalid_host', message: 'x' }), { kind: 'error', code: 'invalid_host', text: INVALID_HOST, field: 'base_url' }));
t('reply: an error with no code is a server error', same(readReply({ status: 'error', message: 'تعطل' }), { kind: 'error', code: 'server_error', text: 'تعطل', field: null }));
t('reply: the 404 of a function not deployed yet', readReply({ code: 'NOT_FOUND', message: 'Requested function was not found' }).kind === 'unreachable');
t('reply: a gateway 401', readReply({ code: 401, message: 'Invalid JWT' }).kind === 'unreachable');
t('reply: nothing, text, array', readReply(null).kind === 'unreachable' && readReply(undefined).kind === 'unreachable' && readReply('<html>').kind === 'unreachable' && readReply([]).kind === 'unreachable');
t('reply: ok without a link', readReply({ status: 'ok' }).kind === 'unreachable' && readReply({ status: 'ok', link: { host: 'x' } }).kind === 'unreachable');

/* ===================== حالة الربط ===================== */

const off = statusView(OFF);
t('not connected: badge', off.connected === false && off.badge.text === 'غير مربوط' && off.badge.tone === 'neutral');
t('not connected: no rows, problem or stats', same(off.rows, []) && off.problem === null && off.stats === null);
t('no link at all is not connected', statusView(null).connected === false && statusView(undefined).badge.text === 'غير مربوط');

const on = statusView(ON);
t('connected, last check ok: badge', on.connected === true && on.badge.text === 'مربوط' && on.badge.tone === 'green' && on.problem === null);
t('connected: row labels in order', same(on.rows.map((r) => r.label), ['الرابط الأساسي', 'رقم مفتاح التعريف', 'رُبط بواسطة', 'آخر فحص']));
t('connected: host and key are left-to-right', on.rows[0].value === 'acme.maqsam.com' && on.rows[0].ltr === true && on.rows[1].value === '••••5678' && on.rows[1].ltr === true);
t('connected: who and when', on.rows[2].value === 'مدير تجريبي' && on.rows[2].at === '2026-11-01T08:00:00.000Z');
t('connected: last check date', on.rows[3].at === '2026-11-05T10:00:00.000Z');
t('connected: stats from the last check', on.stats === STATS);

const noHint = statusView(Object.assign({}, ON, { key_hint: null }));
t('no key hint: the row is left out', same(noHint.rows.map((r) => r.label), ['الرابط الأساسي', 'رُبط بواسطة', 'آخر فحص']));

const noCheck = statusView(Object.assign({}, ON, { check: null }));
t('no check yet: still «مربوط», no problem, no stats', noCheck.badge.text === 'مربوط' && noCheck.problem === null && noCheck.stats === null);
t('no check yet: last check has no date', noCheck.rows[noCheck.rows.length - 1].at === null);

const nullStats = statusView(Object.assign({}, ON, { check: { ok: true, code: 'ok', at: 'x', stats: null } }));
t('ok check without stats: the numbers are hidden', nullStats.badge.text === 'مربوط' && nullStats.stats === null);

for (const [code, [title, action]] of Object.entries(SAVED_FAILURES)) {
    const view = statusView(Object.assign({}, ON, { check: { ok: false, code, at: '2026-11-05T10:00:00.000Z', stats: null } }));
    t('failed check: badge, copy, no stats: ' + code, view.badge.text === 'فيه مشكلة' && view.badge.tone === 'red' && view.problem.title === title && view.problem.action === action && view.stats === null);
}
const staleStats = statusView(Object.assign({}, ON, { check: { ok: false, code: 'timeout', at: 'x', stats: STATS } }));
t('failed check hides numbers even if some came along', staleStats.stats === null);
t('a failed check never reads as passed', statusView(Object.assign({}, ON, { check: { ok: false, code: 'ok', at: 'x', stats: null } })).problem.title === 'رد مقسم بصيغة غير متوقعة.');

const AT = Date.parse('2026-11-05T10:00:00.000Z');
const HOUR = 3600 * 1000;
t('not connected: never stale, no date', statusView(OFF).stale === false && statusView(OFF).checkedAt === null);
t('stale: the date of the last check comes along', statusView(ON, AT).checkedAt === '2026-11-05T10:00:00.000Z');
t('stale: a check today is not stale', statusView(ON, AT + HOUR).stale === false);
t('stale: exactly 24 hours is not stale yet', statusView(ON, AT + 24 * HOUR).stale === false);
t('stale: past 24 hours it is', statusView(ON, AT + 24 * HOUR + 1).stale === true);
t('stale: three weeks old keeps its numbers and says so', statusView(ON, AT + 21 * 24 * HOUR).stale === true && statusView(ON, AT + 21 * 24 * HOUR).stats === STATS);
t('stale: an unreadable date does not count', statusView(Object.assign({}, ON, { check: Object.assign({}, OK_CHECK, { at: 'x' }) }), AT + 21 * 24 * HOUR).stale === false);
t('stale: no check is not stale', statusView(Object.assign({}, ON, { check: null }), AT).stale === false && statusView(Object.assign({}, ON, { check: null }), AT).checkedAt === null);
t('stale: the text names the button', STALE_TEXT === 'هذه أرقام قديمة. اضغط «فحص الربط الآن».');

t('settings line: not connected', settingsLine(OFF) === 'الحالة: غير مربوط');
t('settings line: connected', settingsLine(ON) === 'الحالة: مربوط');
t('settings line: problem', settingsLine(Object.assign({}, ON, { check: { ok: false, code: 'timeout', at: 'x', stats: null } })) === 'الحالة: فيه مشكلة');

/* ===================== الأرقام ===================== */

const rows = statsRows(STATS);
t('stats: labels in order', same(rows.map((r) => r.label), ['المكالمات', 'تم الرد عليها', '30 ثانية فأكثر', 'فيها ملخص', 'فيها نص', 'آخر مكالمة']));
t('stats: values', same(rows.slice(0, 5).map((r) => r.value), [42, 30, 18, 12, 9]) && rows[5].at === '2026-11-04T09:30:00.000Z');
t('stats: no note when not capped', rows[0].note === null);
t('stats: «أول 100» when capped', statsRows(Object.assign({}, STATS, { calls: 100, capped: true }))[0].note === 'أول 100');
t('stats: no latest call', statsRows(Object.assign({}, STATS, { latest_at: null }))[5].at === null);
t('stats: missing numbers read as zero', same(statsRows({}).slice(0, 5).map((r) => r.value), [0, 0, 0, 0, 0]) && same(statsRows(null).slice(0, 5).map((r) => r.value), [0, 0, 0, 0, 0]));

t('agents: as sent, with the no-agent count', same(agentsView(STATS), { agents: STATS.agents, noAgent: 2 }));
t('agents: only what has an email', same(agentsView({ agents: [{ email: 'a@example.test', calls: 1 }, { calls: 3 }, 'x', null] }).agents, [{ email: 'a@example.test', calls: 1 }]));
t('agents: nothing', same(agentsView(null), { agents: [], noAgent: 0 }) && same(agentsView({ agents: 'x' }), { agents: [], noAgent: 0 }));

/* ===================== التحذيرات ===================== */

const NO_CALLS = 'لا توجد مكالمات في الأيام السبعة قبل آخر فحص. إذا كان الموظفون يتصلون من جوالاتهم فلن تظهر مكالماتهم هنا.';
const NO_TEXT = 'لم نجد نصوصاً في المكالمات. إذا لم تكن خدمة التفريغ مفعّلة فاطلب تفعيلها من مقسم.';
const NO_SUMMARY = 'لم نجد ملخصات في المكالمات. إذا لم تكن خدمة الملخص مفعّلة فاطلب تفعيلها من مقسم.';
const OWN_USER = 'إذا كان الموظفون يتصلون بمستخدم واحد فيلزم أن يكون لكل موظف مستخدمه الخاص في مقسم، حتى تُنسب المكالمات لصاحبها.';
const ONE_AGENT = 'كل المكالمات باسم موظف واحد. ' + OWN_USER;
const ONE_AND_NONE = 'ظهر موظف واحد فقط في المكالمات. ' + OWN_USER;
const NO_AGENT = 'لم يظهر اسم أي موظف في المكالمات. ' + OWN_USER;
const A2 = [{ email: 'a@example.test', calls: 1 }, { email: 'b@example.test', calls: 1 }];
const base = { calls: 5, talked: 4, long_enough: 3, with_summary: 2, with_transcript: 2, agents: A2 };

t('advice: a healthy week says nothing', same(advice(base), []));
t('advice: no stats says nothing', same(advice(null), []) && same(advice(undefined), []));
t('advice: no calls', same(advice({ calls: 0, talked: 0, with_summary: 0, with_transcript: 0, agents: [] }), [NO_CALLS]));
t('advice: no transcripts', same(advice(Object.assign({}, base, { with_transcript: 0 })), [NO_TEXT]));
t('advice: no summaries', same(advice(Object.assign({}, base, { with_summary: 0 })), [NO_SUMMARY]));
t('advice: one agent', same(advice(Object.assign({}, base, { agents: [A2[0]] })), [ONE_AGENT]));
t('advice: one agent, and some calls with none', same(advice(Object.assign({}, base, { agents: [A2[0]], no_agent: 2 })), [ONE_AND_NONE]));
t('advice: no employee on any call is not called one employee', same(advice(Object.assign({}, base, { agents: [], no_agent: 5 })), [NO_AGENT]));
t('advice: all three, in order', same(advice({ calls: 5, talked: 4, long_enough: 3, with_summary: 0, with_transcript: 0, agents: [A2[0]] }), [NO_TEXT, NO_SUMMARY, ONE_AGENT]));
t('advice: nobody answered, so nothing about texts', same(advice({ calls: 5, talked: 0, with_summary: 0, with_transcript: 0, agents: A2 }), []));
t('advice: one short answered call proves nothing about texts', same(advice({ calls: 1, talked: 1, long_enough: 0, with_summary: 0, with_transcript: 0, agents: [A2[0]] }), [ONE_AGENT]));
t('advice: calls nobody answered say nothing about employees: no agent', same(advice({ calls: 5, talked: 0, with_summary: 0, with_transcript: 0, agents: [], no_agent: 5 }), []));
t('advice: calls nobody answered say nothing about employees: one rang', same(advice({ calls: 5, talked: 0, with_summary: 0, with_transcript: 0, agents: [A2[0]], no_agent: 4 }), []));

t('support line: only when the warnings ask Maqsam for something', asksMaqsam(Object.assign({}, base, { with_transcript: 0 })) && asksMaqsam(Object.assign({}, base, { with_summary: 0 })));
t('support line: not for a healthy week, no calls, short calls or an employee warning', !asksMaqsam(base) && !asksMaqsam({ calls: 0, agents: [] }) && !asksMaqsam({ calls: 1, talked: 1, long_enough: 0, with_summary: 0, with_transcript: 0 }) && !asksMaqsam(Object.assign({}, base, { agents: [A2[0]] })) && !asksMaqsam(null));

/* ===================== نصوص ثابتة ===================== */

t('the prefilled base_url', DEFAULT_HOST === 'av.maqsam.com');
t('page title and subtitle', LINK_TITLE === 'الربط مع مقسم' && LINK_INTRO === 'يفحص النظام وصوله إلى مقسم ويعرض أرقام آخر 7 أيام، ولا يغيّر شيئاً في حسابكم هناك.');
t('the request text, line by line', REQUEST_TEXT === 'السلام عليكم،\nنحن شركة ملائم العقارية، ونرغب في ربط مكالماتنا في مقسم مع نظامنا عن طريق الـAPI. نرجو تفعيل الـAPI على حسابنا، وتأكيد أن خدمة التفريغ والملخص مفعّلة لدينا.\nشكراً لكم.');

t('the request for texts asks for nothing already working', TEXTS_REQUEST === 'السلام عليكم،\nنحن شركة ملائم العقارية، ونقرأ مكالماتنا في مقسم عن طريق الـAPI. نرجو تفعيل خدمة التفريغ والملخص على حسابنا.\nشكراً لكم.');
t('the request for a fault', FAULT_REQUEST === 'السلام عليكم،\nنحن شركة ملائم العقارية، وقراءة مكالماتنا في مقسم عن طريق الـAPI لا تنجح عندنا. نرجو فحص الـAPI على حسابنا وإفادتنا بالسبب.\nشكراً لكم.');
t('the support address', SUPPORT_EMAIL === 'support@maqsam.com');
const mail = new URL(mailHref(REQUEST_TEXT));
t('the mail link: address, subject and body, lines as RFC 6068 wants them',
    mail.protocol === 'mailto:' && mail.pathname === 'support@maqsam.com' && mail.searchParams.get('subject') === 'ربط مكالمات شركة ملائم العقارية مع مقسم'
    && mail.searchParams.get('body') === REQUEST_TEXT.replace(/\n/g, '\r\n') && !/[\s\u0600-\u06ff]/.test(mail.href));
t('the mail link carries the text it was given', new URL(mailHref(FAULT_REQUEST)).searchParams.get('body') === FAULT_REQUEST.replace(/\n/g, '\r\n'));

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
