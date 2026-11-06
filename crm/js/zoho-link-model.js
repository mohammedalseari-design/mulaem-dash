// «ربط الأنظمة» و«ربط Zoho CRM»: نصوص الصفحة وحساباتها بلا DOM ولا شبكة، لتُختبر في node (tests/zoho-link-model.test.mjs).
//
// الوظيفة zoho-link هي التي تكلّم Zoho وتحفظ القيم مشفّرة وتكتب الملاحظات. هذه الوحدة تقرأ ردها فقط: رمز الفحص أو الخطأ إلى
// نص عربي يقول ما حدث وما يُفعل وهل يلزم رمز جديد، وحالة الربط والنقل إلى شارة وصفوف، والمعاينة إلى أرقام وعينات.
// لا تلمس القيم الحساسة أبداً: الرد لا يحملها أصلاً، والصفحة ترسلها ولا تخزنها.
// نص الملاحظة بيانات: كلام عميل مرّ بذكاء صناعي عند مقسم، فلا يُفسَّر هنا ولا يُغيَّر، ويدخل الصفحة نصاً (textContent).

import { NOT_SAVED, FALLBACK_ERROR, UNREACHABLE_TEXT, UNREACHABLE_HINT } from './maqsam-link-model.js';

const HAS_ARABIC = /[؀-ۿ]/;
const hasOwn = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

// رقم يُعرض، وnull إن لم يُقرأ فيظهر «—»: عدّ فشل عند الخادم لا يصح أن يقال صفراً
export function numberOrNull(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/* ===================== الصفحة الواحدة: التبويبات والرابط ===================== */

export const LINKS_TITLE = 'ربط الأنظمة';
export const LINKS_INTRO = 'مقسم وZoho CRM في مكان واحد: الربط، والفحص، ونقل ملخصات المكالمات.';

export const LINK_TABS = [
    { key: 'maqsam', label: 'مقسم' },
    { key: 'zoho', label: 'Zoho CRM' }
];
export const DEFAULT_LINK_TAB = 'maqsam';
const TAB_KEYS = LINK_TABS.map((tab) => tab.key);

// لاحقة الرابط كما يمرّرها الموجّه («tab=zoho») إلى مفتاح التبويب. تبويب لا يُعرف يفتح الافتراضي
export function linksTab(query) {
    const m = /(?:^|&)tab=([a-z]+)(?:&|$)/.exec(String(query === null || query === undefined ? '' : query));
    return m && TAB_KEYS.includes(m[1]) ? m[1] : DEFAULT_LINK_TAB;
}

// الافتراضي بلا لاحقة، فيبقى الرابط كما تكتبه «الإعدادات»
export function linksHash(tab) {
    return tab && tab !== DEFAULT_LINK_TAB && TAB_KEYS.includes(tab) ? '#/settings/links?tab=' + tab : '#/settings/links';
}

/* ===================== الخطوات ===================== */

export const ZOHO_INTRO = 'يربط النظام بحساب شركتكم في Zoho، ويعرض أرقام آخر 7 أيام. لا يكتب شيئاً في Zoho حتى تطلب ذلك.';

// صفحة مفاتيح Zoho في مركز البيانات السعودي
export const CONSOLE_URL = 'https://api-console.zoho.sa/';

// الصلاحيات كما يلصقها المدير، حرفاً بحرف: تطلب كتابة الملاحظات من أول ربط، فلا يعيد الخطوة لاحقاً
export const SCOPES = 'ZohoCRM.org.READ,ZohoCRM.users.READ,ZohoCRM.coql.READ,ZohoCRM.modules.leads.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.calls.READ,ZohoCRM.modules.notes.READ,ZohoCRM.modules.notes.CREATE';

// أسماء الأزرار بالإنجليزية لأنها كذلك في صفحة Zoho
export const STEPS = {
    open: 'افتح صفحة مفاتيح Zoho وسجّل الدخول بحساب مدير',
    client: 'إذا لم يكن عندك Self Client: اضغط GET STARTED، ثم Self Client، ثم CREATE NOW، ثم CREATE، ثم OK. وإذا كان موجوداً فافتحه، ولا تحذفه أبداً.',
    values: 'من تبويب Client Secret انسخ Client ID وClient Secret، والصقهما هنا.',
    scope: 'في تبويب Generate Code: الصق الصلاحيات في Scope',
    code: 'واختر 10 minutes في Time Duration، واكتب Mulaem في Scope Description، ثم اضغط CREATE. اختر Mulaem تحت Production، ثم CREATE، ثم COPY.',
    paste: 'الصق الرمز هنا واضغط «اختبار وحفظ». الرمز يعمل مرة واحدة ولمدة قصيرة، فإذا فشل الاختبار يلزم رمز جديد.'
};

/* ===================== نتيجة الفحص ===================== */

export const CHECK_CODES = ['ok', 'invalid_client', 'invalid_code', 'throttled', 'no_refresh_token', 'wrong_environment', 'wrong_org', 'not_admin', 'token_revoked', 'scope_mismatch', 'no_permission', 'inactive_user', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response'];

// «3 دقائق» بعدد الثواني التي يردها الخادم. عدد لا يُقرأ: «بضع دقائق»، فلا تظهر رسالة بلا مدة
export function waitText(seconds) {
    const s = numberOrNull(seconds);
    if (s === null || s <= 0) return 'بضع دقائق';
    const minutes = Math.ceil(s / 60);
    if (minutes === 1) return 'دقيقة واحدة';
    if (minutes === 2) return 'دقيقتين';
    return minutes + (minutes <= 10 ? ' دقائق' : ' دقيقة');
}

// كم ثانية يلزم الانتظار: يقرؤها من الفحص كما يردها الخادم
function waitOf(check) {
    return isObject(check) ? check.wait_seconds : null;
}

function codeOf(check) {
    return isObject(check) ? check.code : check;
}

const USE_ADMIN = 'سجّل الدخول بحساب مدير في Zoho، وانسخ Client ID وClient Secret من Self Client الخاص به.';
// كل محاولة تستهلك الرمز ولو فشلت، والحقل يُفرَّغ بعدها: يقال ذلك في كل فشل
export const NEW_CODE = 'مسحنا الرمز لأنه لا يعمل مرة ثانية، فأنشئ رمزاً جديداً من Generate Code والصقه هنا.';

// ما حدث (title) وما يُفعل (action) لقيم جديدة في النموذج. الجملة عن الرمز تضاف في saveFailureCopy
const SAVE_COPY = {
    invalid_client: { title: 'رفض Zoho قيمة Client ID أو Client Secret.', action: 'انسخهما من جديد من تبويب Client Secret.' },
    invalid_code: { title: 'رفض Zoho الرمز: انتهت مدته أو استُعمل من قبل.', action: '' },
    throttled: { title: 'محاولات كثيرة في وقت قصير.', action: (check) => 'انتظر ' + waitText(waitOf(check)) + ' قبل المحاولة التالية.' },
    no_refresh_token: { title: 'لم يعطنا Zoho مفتاحاً دائماً بهذا الرمز.', action: '' },
    wrong_environment: { title: 'هذا الرمز ليس لبيئة الإنتاج في Zoho.', action: 'عند إنشاء الرمز اختر Mulaem تحت Production.' },
    wrong_org: { title: 'هذا الرمز لشركة أخرى في Zoho، لا لشركة ملائم.', action: 'سجّل الدخول بحساب ملائم، واختر Mulaem تحت Production.' },
    not_admin: { title: 'هذا الحساب في Zoho ليس مديراً، فالأرقام كانت ستظهر ناقصة.', action: USE_ADMIN },
    token_revoked: { title: 'ألغى Zoho المفتاح قبل حفظه.', action: 'جرّب مرة ثانية.' },
    scope_mismatch: { title: 'الرمز لا يحمل كل الصلاحيات المطلوبة.', action: 'انسخ الصلاحيات كاملة بزر «نسخ الصلاحيات» قبل إنشاء الرمز.' },
    no_permission: { title: 'هذا الحساب في Zoho لا يملك صلاحية القراءة المطلوبة.', action: USE_ADMIN },
    inactive_user: { title: 'هذا الحساب موقوف في Zoho.', action: USE_ADMIN },
    rate_limited: { title: 'طلب Zoho التمهّل.', action: 'جرّب بعد دقيقة.' },
    timeout: { title: 'لم يرد Zoho في الوقت المحدد، وربما استُعمل الرمز.', action: 'جرّب بعد قليل.' },
    network: { title: 'تعذّر الوصول إلى Zoho، وربما استُعمل الرمز.', action: 'جرّب بعد قليل.' },
    server_error: { title: 'عند Zoho خطأ مؤقت.', action: 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.' },
    bad_response: { title: 'رد Zoho بصيغة غير متوقعة.', action: 'جرّب مرة ثانية. إذا تكرر فأخبر مسؤول النظام.' }
};

// فشل قيم محفوظة: لا حقول على الشاشة، فالخطوة التالية إما «تغيير القيم» وإما إعادة الفحص
const SAVED_COPY = {
    invalid_client: { title: 'رفض Zoho قيمة Client ID أو Client Secret المحفوظة.', action: 'ربما حُذف Self Client أو تغيّرت قيمه. اضغط «تغيير القيم» واربط من جديد.', relink: true },
    invalid_code: { title: 'لم يعد Zoho يقبل هذا الربط.', action: 'اضغط «تغيير القيم» واربط برمز جديد.', relink: true },
    throttled: { title: 'طلب Zoho الانتظار.', action: (check) => 'انتظر ' + waitText(waitOf(check)) + '، ثم اضغط «فحص الربط الآن».' },
    no_refresh_token: { title: 'لم يعد Zoho يقبل هذا الربط.', action: 'اضغط «تغيير القيم» واربط برمز جديد.', relink: true },
    wrong_environment: { title: 'الربط المحفوظ ليس على بيئة الإنتاج في Zoho.', action: 'اضغط «تغيير القيم»، واختر Mulaem تحت Production عند إنشاء الرمز.', relink: true },
    wrong_org: { title: 'الربط المحفوظ لشركة أخرى في Zoho، لا لشركة ملائم.', action: 'اضغط «تغيير القيم» واربط بحساب ملائم.', relink: true },
    not_admin: { title: 'الحساب المربوط لم يعد مديراً في Zoho، فالأرقام قد تظهر ناقصة.', action: 'اضغط «تغيير القيم» واربط بحساب مدير.', relink: true },
    token_revoked: { title: 'ألغى Zoho هذا الربط.', action: 'ربما أُلغي من حساب Zoho أو تغيّرت كلمة مروره. اضغط «تغيير القيم» واربط من جديد.', relink: true },
    scope_mismatch: { title: 'الربط المحفوظ لا يحمل كل الصلاحيات المطلوبة.', action: 'اضغط «تغيير القيم»، وانسخ الصلاحيات كاملة عند إنشاء الرمز.', relink: true },
    no_permission: { title: 'لم يعد الحساب المربوط يملك صلاحية القراءة في Zoho.', action: 'أعد له الصلاحية في Zoho، أو اضغط «تغيير القيم» واربط بحساب مدير.' },
    inactive_user: { title: 'الحساب المربوط موقوف في Zoho.', action: 'فعّله في Zoho، أو اضغط «تغيير القيم» واربط بحساب مدير آخر.' },
    rate_limited: { title: 'طلب Zoho التمهّل.', action: 'جرّب بعد دقيقة.' },
    timeout: { title: 'لم يرد Zoho في الوقت المحدد.', action: 'جرّب مرة ثانية بعد قليل.' },
    network: { title: 'تعذّر الوصول إلى Zoho.', action: 'جرّب مرة ثانية بعد قليل.' },
    server_error: { title: 'عند Zoho خطأ مؤقت.', action: 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.' },
    bad_response: { title: 'رد Zoho بصيغة غير متوقعة.', action: 'جرّب مرة ثانية. إذا تكرر فأخبر مسؤول النظام.' }
};

function fillCopy(copy, check) {
    return { title: copy.title, action: typeof copy.action === 'function' ? copy.action(check) : copy.action };
}

// رمز لا نعرفه، وكذلك ok مع فشل، يُقرأ «رد غير متوقع»، فلا تظهر رسالة فارغة ولا يقال «نجح»
function failedCode(check) {
    const code = codeOf(check);
    return code !== 'ok' && hasOwn(SAVED_COPY, code) ? code : 'bad_response';
}

export const CHECK_OK = 'نجح الفحص.';

// فشل اختبار القيم الجديدة: لم يتغير شيء، وتقول الجملة الأولى ذلك، والأخيرة أن الرمز مُسح
export function saveFailureCopy(check) {
    const copy = fillCopy(SAVE_COPY[failedCode(check)], check);
    return { title: NOT_SAVED + ' ' + copy.title, action: [copy.action, NEW_CODE].filter(Boolean).join(' ') };
}

// فشل فحص القيم المحفوظة
export function savedFailureCopy(check) {
    return fillCopy(SAVED_COPY[failedCode(check)], check);
}

// خطأ من الوظيفة أو انقطاع أثناء الحفظ: الرمز مُسح هنا أيضاً، ولا إعادة محاولة بالرمز نفسه
export function saveErrorCopy(reply) {
    if (isObject(reply) && reply.kind === 'error') return { title: NOT_SAVED + ' ' + reply.text, action: NEW_CODE };
    return { title: NOT_SAVED + ' ' + UNREACHABLE_TEXT + '.', action: UNREACHABLE_HINT + ' ' + NEW_CODE };
}

/* ===================== أخطاء الوظيفة ===================== */

export const ERROR_CODES = ['unauthenticated', 'forbidden', 'bad_request', 'invalid_client_id', 'invalid_client_secret', 'invalid_code', 'not_connected', 'maqsam_not_connected', 'no_match', 'server_error'];

// رموز جوابها معروف. البقية (forbidden، bad_request، server_error) رسالتها من الخادم
const ERROR_COPY = {
    unauthenticated: 'انتهت الجلسة. أعد تحميل الصفحة وسجّل الدخول من جديد.',
    invalid_client_id: 'قيمة Client ID غير صحيحة. انسخها كاملة من تبويب Client Secret.',
    invalid_client_secret: 'قيمة Client Secret غير صحيحة. انسخها كاملة من تبويب Client Secret.',
    invalid_code: 'الرمز غير صحيح. انسخه كاملاً بزر COPY في صفحة Zoho.',
    not_connected: 'لا يوجد ربط محفوظ مع Zoho.',
    maqsam_not_connected: 'مقسم غير مربوط. اربطه أولاً من تبويب «مقسم».',
    no_match: 'لا يوجد ملف عميل بهذا الرقم في Zoho، فلم تُكتب الملاحظة.'
};

// تشغيل النقل يُرفض بالرمز not_connected لسببين: نقص أحد الربطين، أو ربط يحتاج إعادة ربط. رسالة الخادم تقول أيهما، وهذا النص إن لم تصل
export const START_REFUSED = 'لا يعمل النقل إلا إذا كان مقسم وZoho مربوطين معاً.';

export function startRefusal(reply) {
    return isObject(reply) && typeof reply.message === 'string' && HAS_ARABIC.test(reply.message) ? reply.message.trim() : START_REFUSED;
}

// أي حقل يخصه الخطأ، ليُعلَّم ويذهب إليه التركيز
const ERROR_FIELD = { invalid_client_id: 'client_id', invalid_client_secret: 'client_secret', invalid_code: 'code' };

// رسالة الخادم تُعرض إن كانت عربية؛ نص إنجليزي من بوابة أو مكتبة لا يفيد الموظف، فيحل محله النص العام
export function errorMessage(code, message) {
    if (hasOwn(ERROR_COPY, code)) return ERROR_COPY[code];
    return typeof message === 'string' && HAS_ARABIC.test(message) ? message.trim() : FALLBACK_ERROR;
}

export function errorField(code) {
    return hasOwn(ERROR_FIELD, code) ? ERROR_FIELD[code] : null;
}

/* ===================== قراءة الرد ===================== */

function isLink(link) {
    return isObject(link) && typeof link.connected === 'boolean';
}

function isSync(sync) {
    return isObject(sync) && typeof sync.enabled === 'boolean';
}

// رابط من رد الخادم لا يُفتح إلا إذا كان صفحة سجل في Zoho شركتنا: لا يصير رد غريب رابطاً في الصفحة
const RECORD_URL = /^https:\/\/crm\.zoho\.sa\/crm\/org150000145002\/tab\/[A-Za-z_]+\/[0-9A-Za-z_]+$/;

export function recordUrl(url) {
    return typeof url === 'string' && RECORD_URL.test(url) ? url : null;
}

function readMatch(match) {
    if (!isObject(match)) return null;
    return { module: text(match.module), id: match.id, url: recordUrl(match.url) };
}

const isCallId = (id) => (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id.trim() !== '');

function readSample(sample) {
    if (!isObject(sample) || !isCallId(sample.call_id) || typeof sample.note_text !== 'string') return null;
    return {
        callId: sample.call_id,
        title: typeof sample.note_title === 'string' ? sample.note_title : '',
        text: sample.note_text,
        match: readMatch(sample.match),
        ambiguous: sample.ambiguous === true,
        written: null,
        error: null
    };
}

function readPreview(preview) {
    if (!isObject(preview)) return null;
    return {
        counts: isObject(preview.counts) ? preview.counts : {},
        samples: (Array.isArray(preview.samples) ? preview.samples : []).map(readSample).filter(Boolean).slice(0, 5)
    };
}

function readWritten(written) {
    if (!isObject(written)) return null;
    return { noteId: written.note_id, module: text(written.module), recordId: written.record_id, url: recordUrl(written.url) };
}

// جسم الرد، سواء جاء مع 2xx أو من error.context.json(). كل ما ليس بشكل العقد (404 لوظيفة لم تُنشر، صفحة خطأ من البوابة،
// لا جسم أصلاً) معناه أن الخدمة لم يُوصل إليها.
export function readReply(data) {
    if (isObject(data) && data.status === 'ok' && (isLink(data.link) || isSync(data.sync))) {
        return {
            kind: 'ok',
            link: isLink(data.link) ? data.link : null,
            sync: isSync(data.sync) ? data.sync : null,
            // مدة الانتظار تأتي بجانب الفحص لا داخله، وتُقرأ معه
            check: isObject(data.check) ? (data.wait_seconds === undefined ? data.check : Object.assign({}, data.check, { wait_seconds: data.wait_seconds })) : null,
            saved: data.saved === true,
            // لم يؤكد Zoho إلغاء المفتاح عند الفصل، أو إلغاء المفتاح القديم عند استبداله: false صريحة وحدها، وغيابها لا يقلق أحداً
            notRevoked: data.revoked === false,
            oldNotRevoked: data.old_revoked === false,
            preview: readPreview(data.preview),
            written: readWritten(data.written)
        };
    }
    if (isObject(data) && data.status === 'error') {
        const code = typeof data.code === 'string' ? data.code : 'server_error';
        return { kind: 'error', code, text: errorMessage(code, data.message), field: errorField(code), message: data.message };
    }
    return { kind: 'unreachable' };
}

/* ===================== حالة الربط ===================== */

const STATE = {
    off: { text: 'غير مربوط', tone: 'neutral' },
    on: { text: 'مربوط', tone: 'green' },
    problem: { text: 'فيه مشكلة', tone: 'red' }
};

function linkRows(link, check) {
    const account = [text(link.user_name), text(link.user_profile)].filter(Boolean).join(' · ');
    const rows = [
        { key: 'org', label: 'الشركة', value: text(link.org_name), at: null },
        { key: 'user', label: 'حساب Zoho', value: account, at: null }
    ];
    if (link.client_hint) rows.push({ key: 'client', label: 'رقم Client ID', value: '••••' + link.client_hint, ltr: true });
    rows.push({ key: 'by', label: 'رُبط بواسطة', value: text(link.connected_by_name), at: link.connected_at || null });
    rows.push({ key: 'checked', label: 'آخر فحص', value: '', at: (check && check.at) || null });
    return rows;
}

// لا شيء يحدّث الأرقام وحده، فأرقام فحص مضى عليه أكثر من يوم قديمة. تاريخ لا يُقرأ لا يُعدّ قديماً
const STALE_MS = 24 * 60 * 60 * 1000;
export const STALE_TEXT = 'هذه أرقام قديمة. اضغط «فحص الربط الآن».';
export const COUNT_FAILED_TEXT = 'لم نستطع قراءة بعض الأرقام، فظهرت «—». اضغط «فحص الربط الآن» لاحقاً.';

function isOlder(at, nowMs, limitMs) {
    const ms = Date.parse(at);
    return Number.isFinite(ms) && nowMs - ms > limitMs;
}

// الحالة كما تُرسم: الشارة بنصها، ورسالة الفشل، وهل الحل ربط جديد، وصفوف البطاقة، وأرقام آخر فحص (null تُخفي بطاقة الأرقام).
// التواريخ تبقى ISO في at، والصفحة تكتبها بتنسيق النظام. sync: إذا رفض Zoho الربط أثناء النقل فالربط فيه مشكلة ولو نجح آخر فحص.
export function statusView(link, sync = null, nowMs = Date.now()) {
    if (!isLink(link) || !link.connected) return { connected: false, badge: STATE.off, problem: null, relink: false, rows: [], stats: null, checkedAt: null, stale: false, user: '' };
    const check = isObject(link.check) ? link.check : null;
    const failed = Boolean(check) && check.ok !== true;
    const reconnect = isSync(sync) && sync.needs_reconnect === true;
    return {
        connected: true,
        badge: failed || reconnect ? STATE.problem : STATE.on,
        problem: failed ? savedFailureCopy(check) : null,
        relink: reconnect || (failed && SAVED_COPY[failedCode(check)].relink === true),
        rows: linkRows(link, check),
        stats: !failed && check && isObject(check.stats) ? check.stats : null,
        checkedAt: (check && check.at) || null,
        stale: Boolean(check) && isOlder(check.at, nowMs, STALE_MS),
        user: text(link.user_name)
    };
}

// الربط مرتبط بشخص: إذا توقف حسابه توقف الربط، ولا يُفهم ذلك من الصفوف وحدها
export function accountLine(link) {
    const name = isLink(link) ? text(link.user_name) : '';
    return 'هذا الربط يعتمد على ' + (name ? 'حساب ' + name : 'حساب من ربطه') + ' في Zoho: إذا توقف هذا الحساب يتوقف الربط، ويلزم ربطه من جديد.';
}

// سطر الحالة في بطاقة الإعدادات
export function settingsLine(link, sync = null) {
    return 'Zoho CRM: ' + statusView(link, sync).badge.text;
}

/* ===================== أرقام آخر 7 أيام ===================== */

// value رقم أو null، وهي تظهر «—»
export function statsRows(stats) {
    const s = isObject(stats) ? stats : {};
    return [
        { key: 'calls', label: 'المكالمات', value: numberOrNull(s.calls) },
        { key: 'calls_linked', label: 'مربوطة بملف عميل', value: numberOrNull(s.calls_linked) },
        { key: 'long_enough', label: '30 ثانية فأكثر', value: numberOrNull(s.long_enough) },
        { key: 'leads_new', label: 'عملاء محتملون جدد', value: numberOrNull(s.leads_new) },
        { key: 'active_users', label: 'الموظفون النشطون', value: numberOrNull(s.active_users) }
    ];
}

// المكالمات لكل موظف كما وصلت مرتبة من الخادم
export function ownersView(stats) {
    const list = isObject(stats) && Array.isArray(stats.by_owner) ? stats.by_owner : [];
    return list.filter((o) => isObject(o) && text(o.name)).map((o) => ({ name: text(o.name), calls: numberOrNull(o.calls) }));
}

// ما يلزم أن يعرفه المدير فوق الأرقام: كل سطر لا يظهر إلا إذا صدق
export function statsNotes(view) {
    if (!isObject(view) || !isObject(view.stats)) return [];
    const notes = view.stale ? [STALE_TEXT] : [];
    if (statsRows(view.stats).some((row) => row.value === null)) notes.push(COUNT_FAILED_TEXT);
    return notes;
}

/* ===================== نقل الملخصات ===================== */

export const SYNC_TITLE = 'نقل ملخصات مقسم إلى Zoho';
export const SYNC_WHAT = 'يكتب ملاحظة في ملف العميل لكل مكالمة فيها ملخص. لا يغيّر أي حقل، ولا يرسل شيئاً للعميل.';
export const SYNC_RUNNING = 'يعمل في الخلفية كل 5 دقائق، ويكتب الملاحظات تلقائياً حتى تضغط «إيقاف النقل».';
export const MAQSAM_MISSING = 'مقسم غير مربوط، فلا يوجد ما يُنقل. اربطه أولاً من تبويب «مقسم».';
export const NOT_RUN_YET = 'لم يعمل بعد، وأول تشغيل خلال 5 دقائق';

const SYNC_STATE = {
    off: { text: 'متوقف', tone: 'neutral' },
    on: { text: 'يعمل', tone: 'green' },
    problem: { text: 'فيه مشكلة', tone: 'red' }
};

const RECONNECT = { title: 'توقف النقل لأن Zoho لم يعد يقبل هذا الربط.', action: 'اضغط «تغيير القيم» واربط من جديد بحساب مدير. لا يُكتب شيء في Zoho حتى ذلك الحين.' };
const MAQSAM_GONE = { title: 'النقل مفعّل ولكن مقسم غير مربوط، فلا يُكتب شيء.', action: 'اربط مقسم من تبويب «مقسم»، أو اضغط «إيقاف النقل».' };
const LATE = { title: 'لم يعمل النقل منذ أكثر من 30 دقيقة.', action: 'انتظر قليلاً وأعد فتح الصفحة. إذا تكرر فأخبر مسؤول النظام.' };

const AGAIN = 'سيُعاد التشغيل تلقائياً.';
const AGAIN_ZOHO = AGAIN + ' إذا تكرر فاضغط «فحص الربط الآن».';
const AGAIN_MAQSAM = AGAIN + ' إذا تكرر فافتح تبويب «مقسم» واضغط «فحص الربط الآن» هناك.';

// ما حدث في آخر تشغيل، لكل رمز تكتبه maqsam-sync (قيد last_run_code في 042). رموز رفض Zoho لها نص الفحص نفسه، فالحل ربط جديد
const RUN_COPY = {
    zoho_not_connected: { title: 'لم نجد ربط Zoho في آخر تشغيل، فلم يُكتب شيء.', action: 'اضغط «فحص الربط الآن». إذا فشل فاضغط «تغيير القيم» واربط من جديد.' },
    maqsam_not_connected: MAQSAM_GONE,
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
const RUN_UNKNOWN = { title: 'لم يكتمل آخر تشغيل.', action: 'سيُعاد التشغيل تلقائياً. إذا تكرر فأخبر مسؤول النظام.' };

// آخر تشغيل نجح (capped: بلغ سقف الدورة، والباقي في الدورة التالية)، أو لا تشغيل بعد: لا نص
export function runCopy(code) {
    if (code === null || code === undefined || code === '' || code === 'ok' || code === 'capped') return null;
    if (hasOwn(RUN_COPY, code)) return RUN_COPY[code];
    return hasOwn(SAVED_COPY, code) ? savedFailureCopy(code) : RUN_UNKNOWN;
}

const LATE_MS = 30 * 60 * 1000;

function syncRows(sync) {
    const week = numberOrNull(sync.written_7d);
    return [
        { key: 'last_run', label: 'آخر تشغيل', value: sync.last_run_at ? '' : (sync.enabled ? NOT_RUN_YET : ''), at: sync.last_run_at || null },
        { key: 'started', label: 'شغّله', value: text(sync.started_by_name), at: sync.started_at || null },
        { key: 'from', label: 'ينقل المكالمات من', value: '', at: sync.start_from || null },
        { key: 'written', label: 'كُتبت', value: numberOrNull(sync.written_total), note: week === null ? null : 'آخر 7 أيام: ' + week },
        { key: 'waiting', label: 'بانتظار ملخص أو ملف عميل', value: numberOrNull(sync.waiting) },
        { key: 'no_match', label: 'بلا ملف عميل', value: numberOrNull(sync.no_match_total) },
        { key: 'failed', label: 'فشلت', value: numberOrNull(sync.failed_total) },
        // تظهر متى صدقت: الرقم على أكثر من ملف، فذهبت الملاحظة إلى أحدثها
        ...(numberOrNull(sync.ambiguous_total) > 0 ? [{ key: 'ambiguous', label: 'منها برقم على أكثر من ملف', value: numberOrNull(sync.ambiguous_total) }] : [])
    ];
}

// حالة النقل كما تُرسم. maqsam: هل مقسم مربوط (true، false، أو null إن لم نعرف فلا نقول شيئاً عنه).
// متوقف ولم يعمل قط: لا صفوف، والبطاقة تقول ما سيفعله فقط.
export function syncView(sync, maqsam = null, nowMs = Date.now()) {
    const s = isSync(sync) ? sync : { enabled: false };
    const maqsamMissing = maqsam === false;
    const reconnect = s.needs_reconnect === true;
    let problem = null;
    if (reconnect) problem = RECONNECT;
    else if (s.enabled && maqsamMissing) problem = MAQSAM_GONE;
    else if (s.enabled) problem = runCopy(s.last_run_code) || (isOlder(s.last_run_at || s.started_at, nowMs, LATE_MS) ? LATE : null);
    const history = s.enabled || Boolean(s.last_run_at) || (numberOrNull(s.written_total) || 0) > 0;
    return {
        enabled: s.enabled,
        badge: problem ? SYNC_STATE.problem : s.enabled ? SYNC_STATE.on : SYNC_STATE.off,
        problem,
        reconnect,
        maqsamMissing,
        // المعاينة والتشغيل لمتوقف سليم: الربط المرفوض لا يقرأ شيئاً، ومقسم غير المربوط لا يعطي شيئاً
        canPreview: !s.enabled && !reconnect && !maqsamMissing,
        rows: history ? syncRows(s) : []
    };
}

// زر رئيسي واحد في الشاشة: الخطوة التالية للمدير. changing: نموذج القيم مفتوح. previewed: عرض المعاينة الآن.
// مقفل على المعاينة أولاً: لا يصير «تشغيل النقل» رئيسياً قبل أن يرى ما سيُكتب.
export function primaryAction(view, sync, changing, previewed) {
    if (changing || !view.connected) return 'save';
    if (view.relink) return 'change';
    if (!view.problem && sync.canPreview) return previewed ? 'start' : 'preview';
    return 'test';
}

export const START_CHOICES = [
    { value: 'now', label: 'من الآن', hint: 'المكالمات الجديدة فقط.' },
    { value: 'days30', label: 'ومعها آخر 30 يوماً', hint: 'المكالمات الجديدة، ومعها مكالمات آخر 30 يوماً التي فيها ملخص.' }
];
export const START_NOTE = 'بعد التشغيل يكتب النظام الملاحظات في Zoho تلقائياً كل 5 دقائق، بلا سؤال، حتى تضغط «إيقاف النقل».';

/* ===================== المعاينة ===================== */

export const NO_MATCH_TEXT = 'لا يوجد ملف عميل بهذا الرقم';
export const AMBIGUOUS_TEXT = 'بهذا الرقم أكثر من ملف عميل: تُكتب الملاحظة في آخر ملف تغيّر.';
export const PREVIEW_NOTE = 'هذا ما سيُكتب في Zoho كما هو. لم يُكتب شيء بعد.';
export const PREVIEW_EMPTY = 'لا توجد في آخر 7 أيام مكالمة فيها ملخص ولم تُكتب بعد.';
export const WRITE_NOTE = 'تُكتب هذه الملاحظة فعلاً في ملف العميل، ولا يمكن حذفها من هنا. لا يتغيّر أي حقل، ولا يصل شيء للعميل.';

// الوظيفة تقرأ أول صفحة من مقسم وحدها (100 مكالمة)، فالعدد عندها سقف لا مجموع. والملف يُبحث عنه للعينة وحدها (5 مكالمات على الأكثر)، فتقول صفوفه ذلك
const FIRST_PAGE = 100;

export function previewRows(preview) {
    const c = isObject(preview) && isObject(preview.counts) ? preview.counts : {};
    const calls = numberOrNull(c.calls);
    return [
        { key: 'calls', label: 'مكالمات آخر 7 أيام', value: calls, note: calls !== null && calls >= FIRST_PAGE ? 'أول 100' : null },
        { key: 'with_summary', label: 'فيها ملخص', value: numberOrNull(c.with_summary) },
        { key: 'already_written', label: 'كُتبت من قبل', value: numberOrNull(c.already_written) },
        { key: 'matched', label: 'من العينة: لها ملف عميل', value: numberOrNull(c.matched) },
        { key: 'no_match', label: 'من العينة: بلا ملف عميل', value: numberOrNull(c.no_match) },
        { key: 'ambiguous', label: 'من العينة: لها أكثر من ملف', value: numberOrNull(c.ambiguous) }
    ];
}
