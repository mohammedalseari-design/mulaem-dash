// «الربط مع مقسم»: نصوص الصفحة وحساباتها بلا DOM ولا شبكة، لتُختبر في node (tests/maqsam-link-model.test.mjs).
//
// الوظيفة maqsam-link هي التي تكلّم مقسم وتحفظ القيم مشفّرة. هذه الوحدة تقرأ ردها فقط: رمز الفحص أو رمز الخطأ إلى
// نص عربي يقول ما حدث وما يُفعل، وحالة الربط إلى شارة وصفوف، وأرقام آخر 7 أيام إلى صفوف وتحذيرات.
// لا تلمس القيم الحساسة أبداً: الرد لا يحملها أصلاً، والصفحة ترسلها ولا تخزنها.

const hasOwn = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

export const LINK_TITLE = 'الربط مع مقسم';
export const LINK_INTRO = 'يفحص النظام وصوله إلى مقسم ويعرض أرقام آخر 7 أيام، ولا يغيّر شيئاً في حسابكم هناك.';

// الرابط الأساسي لحساب ملائم في مقسم (ليس سراً): يظهر معبّأ في النموذج، ويبقى قابلاً للتغيير
export const DEFAULT_HOST = 'av.maqsam.com';

// نص يُرسل إلى دعم مقسم، ويُنسخ كما هو بسطوره
export const REQUEST_TEXT = [
    'السلام عليكم،',
    'نحن شركة ملائم العقارية، ونرغب في ربط مكالماتنا في مقسم مع نظامنا عن طريق الـAPI. نرجو تفعيل الـAPI على حسابنا، وتأكيد أن خدمة التفريغ والملخص مفعّلة لدينا.',
    'شكراً لكم.'
].join('\n');

// بعد الربط: الـAPI يعمل، والطلب إما تفعيل التفريغ والملخص وإما فحص خطأ
export const TEXTS_REQUEST = [
    'السلام عليكم،',
    'نحن شركة ملائم العقارية، ونقرأ مكالماتنا في مقسم عن طريق الـAPI. نرجو تفعيل خدمة التفريغ والملخص على حسابنا.',
    'شكراً لكم.'
].join('\n');

export const FAULT_REQUEST = [
    'السلام عليكم،',
    'نحن شركة ملائم العقارية، وقراءة مكالماتنا في مقسم عن طريق الـAPI لا تنجح عندنا. نرجو فحص الـAPI على حسابنا وإفادتنا بالسبب.',
    'شكراً لكم.'
].join('\n');

export const SUPPORT_EMAIL = 'support@maqsam.com';
const MAIL_SUBJECT = 'ربط مكالمات شركة ملائم العقارية مع مقسم';

// رابط بريد معبّأ بالموضوع والنص. فاصل السطور في mailto هو %0D%0A (RFC 6068)
export function mailHref(text) {
    return 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent(MAIL_SUBJECT) + '&body=' + encodeURIComponent(text.replace(/\n/g, '\r\n'));
}

/* ===================== نتيجة الفحص ===================== */

export const CHECK_CODES = ['ok', 'unauthorized', 'not_found', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response'];

// ما حدث (title) وما يُفعل (action)
const CHECK_COPY = {
    ok: { title: 'نجح الفحص.', action: '' },
    unauthorized: { title: 'رفض مقسم هذه القيم.', action: 'تأكد من نسخ رقم مفتاح التعريف وكلمة السر كاملين.' },
    not_found: { title: 'لم نجد واجهة برمجة التطبيقات على هذا الرابط.', action: 'تأكد من الرابط الأساسي بزر «عرض الرابط الأساسي» في مقسم.' },
    rate_limited: { title: 'طلب مقسم التمهّل.', action: 'جرّب بعد دقيقة.' },
    timeout: { title: 'لم يرد مقسم في الوقت المحدد.', action: 'جرّب مرة ثانية بعد قليل.' },
    network: { title: 'تعذّر الوصول إلى مقسم.', action: 'تأكد من الرابط الأساسي، ثم جرّب مرة ثانية.' },
    server_error: { title: 'عند مقسم خطأ مؤقت.', action: 'جرّب بعد قليل. إذا تكرر فراسل دعمهم.' },
    bad_response: { title: 'رد مقسم بصيغة غير متوقعة.', action: 'جرّب مرة ثانية. إذا تكرر فراسل دعمهم.' }
};

// فشل قيم محفوظة: لا حقول على الشاشة والموظف لم ينسخ شيئاً، فالخطوة التالية هي «تغيير القيم». البقية كما في CHECK_COPY
const SAVED_COPY = {
    unauthorized: { title: 'رفض مقسم القيم المحفوظة.', action: 'ربما تغيّر المفتاح في مقسم. اضغط «تغيير القيم» والصق القيم الحالية.' },
    not_found: { title: 'لم نجد واجهة برمجة التطبيقات على الرابط المحفوظ.', action: 'قارنه بزر «عرض الرابط الأساسي» في مقسم. إذا اختلف فاضغط «تغيير القيم» وصحّحه.' },
    network: { title: 'تعذّر الوصول إلى مقسم.', action: 'جرّب مرة ثانية بعد قليل. إذا تكرر فقارن الرابط المحفوظ بزر «عرض الرابط الأساسي» في مقسم، وصحّحه من «تغيير القيم».' }
};

// رمز لا نعرفه يُقرأ «رد غير متوقع»، فلا تظهر رسالة فارغة
export function checkCopy(code) {
    return hasOwn(CHECK_COPY, code) ? CHECK_COPY[code] : CHECK_COPY.bad_response;
}

// الفحص فشل: ok ليست صحيحة، فلا يصح أن يقال «نجح» حتى لو جاء الرمز ok
function failureCopy(code) {
    return code === 'ok' ? CHECK_COPY.bad_response : checkCopy(code);
}

export const NOT_SAVED = 'لم تُحفظ القيم.';

// فشل اختبار القيم الجديدة: لم يتغير شيء، وتقول الجملة الأولى ذلك
export function saveFailureCopy(code) {
    const copy = failureCopy(code);
    return { title: NOT_SAVED + ' ' + copy.title, action: copy.action };
}

// فشل فحص القيم المحفوظة
export function savedFailureCopy(code) {
    return hasOwn(SAVED_COPY, code) ? SAVED_COPY[code] : failureCopy(code);
}

/* ===================== أخطاء الوظيفة ===================== */

export const ERROR_CODES = ['unauthenticated', 'forbidden', 'bad_request', 'invalid_host', 'invalid_key_id', 'invalid_secret', 'not_connected', 'server_error'];
export const FALLBACK_ERROR = 'تعذّر تنفيذ العملية';
export const UNREACHABLE_TEXT = 'تعذّر الوصول إلى خدمة الربط';
export const UNREACHABLE_HINT = 'جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.';

// رموز جوابها معروف. البقية (forbidden، bad_request، server_error) رسالتها من الخادم
const ERROR_COPY = {
    unauthenticated: 'انتهت الجلسة. أعد تحميل الصفحة وسجّل الدخول من جديد.',
    invalid_host: 'انسخ الرابط الأساسي كما يظهر بعد زر «عرض الرابط الأساسي» في مقسم، مثل av.maqsam.com.',
    invalid_key_id: 'رقم مفتاح التعريف غير صحيح. انسخه كاملاً بدون مسافات.',
    invalid_secret: 'كلمة السر غير صحيحة. انسخها كاملة.',
    not_connected: 'لا يوجد ربط محفوظ.'
};

// أي حقل يخصه الخطأ، ليُعلَّم ويذهب إليه التركيز
const ERROR_FIELD = { invalid_host: 'base_url', invalid_key_id: 'access_key_id', invalid_secret: 'access_secret' };

const HAS_ARABIC = /[؀-ۿ]/;

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

// جسم الرد، سواء جاء مع 2xx أو من error.context.json(). كل ما ليس بشكل العقد (404 لوظيفة لم تُنشر، صفحة خطأ من البوابة،
// لا جسم أصلاً) معناه أن الخدمة لم يُوصل إليها.
export function readReply(data) {
    if (isObject(data) && data.status === 'ok' && isLink(data.link)) {
        return { kind: 'ok', link: data.link, check: isObject(data.check) ? data.check : null, saved: data.saved === true };
    }
    if (isObject(data) && data.status === 'error') {
        const code = typeof data.code === 'string' ? data.code : 'server_error';
        return { kind: 'error', code, text: errorMessage(code, data.message), field: errorField(code) };
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
    const rows = [{ key: 'host', label: 'الرابط الأساسي', value: link.host || '', ltr: true }];
    if (link.key_hint) rows.push({ key: 'key', label: 'رقم مفتاح التعريف', value: '••••' + link.key_hint, ltr: true });
    rows.push({ key: 'by', label: 'رُبط بواسطة', value: link.connected_by_name || '', at: link.connected_at || null });
    rows.push({ key: 'checked', label: 'آخر فحص', value: '', at: (check && check.at) || null });
    return rows;
}

// لا شيء يحدّث الأرقام وحده، فأرقام فحص مضى عليه أكثر من يوم قديمة. تاريخ لا يُقرأ لا يُعدّ قديماً
const STALE_MS = 24 * 60 * 60 * 1000;
export const STALE_TEXT = 'هذه أرقام قديمة. اضغط «فحص الربط الآن».';

function isStale(at, nowMs) {
    const ms = Date.parse(at);
    return Number.isFinite(ms) && nowMs - ms > STALE_MS;
}

// الحالة كما تُرسم: الشارة بنصها، ورسالة الفشل، وصفوف البطاقة، وأرقام آخر فحص (null تُخفي بطاقة الأرقام) وتاريخه وهل هو قديم.
// التواريخ تبقى ISO في at، والصفحة تكتبها بتنسيق النظام.
export function statusView(link, nowMs = Date.now()) {
    if (!isLink(link) || !link.connected) return { connected: false, badge: STATE.off, problem: null, rows: [], stats: null, checkedAt: null, stale: false };
    const check = isObject(link.check) ? link.check : null;
    const failed = Boolean(check) && check.ok !== true;
    return {
        connected: true,
        badge: failed ? STATE.problem : STATE.on,
        problem: failed ? savedFailureCopy(check.code) : null,
        rows: linkRows(link, check),
        stats: !failed && check && isObject(check.stats) ? check.stats : null,
        checkedAt: (check && check.at) || null,
        stale: Boolean(check) && isStale(check.at, nowMs)
    };
}

// سطر الحالة في بطاقة الإعدادات، تحته سطر Zoho
export function settingsLine(link) {
    return 'مقسم: ' + statusView(link).badge.text;
}

/* ===================== أرقام آخر 7 أيام ===================== */

// value رقم، وnote نص جانبي، وat تاريخ ISO لآخر مكالمة
export function statsRows(stats) {
    const s = isObject(stats) ? stats : {};
    return [
        { key: 'calls', label: 'المكالمات', value: count(s.calls), note: s.capped ? 'أول 100' : null },
        { key: 'talked', label: 'تم الرد عليها', value: count(s.talked) },
        { key: 'long_enough', label: '30 ثانية فأكثر', value: count(s.long_enough) },
        { key: 'with_summary', label: 'فيها ملخص', value: count(s.with_summary) },
        { key: 'with_transcript', label: 'فيها نص', value: count(s.with_transcript) },
        { key: 'latest_at', label: 'آخر مكالمة', at: s.latest_at || null }
    ];
}

// الموظفون كما وصلوا مرتبين من الخادم، وعدد ما لم يُعرف موظفه
export function agentsView(stats) {
    const s = isObject(stats) ? stats : {};
    const list = Array.isArray(s.agents) ? s.agents : [];
    return {
        agents: list.filter((a) => isObject(a) && typeof a.email === 'string' && a.email).map((a) => ({ email: a.email, calls: count(a.calls) })),
        noAgent: count(s.no_agent)
    };
}

const OWN_USER = 'إذا كان الموظفون يتصلون بمستخدم واحد فيلزم أن يكون لكل موظف مستخدمه الخاص في مقسم، حتى تُنسب المكالمات لصاحبها.';

// مكالمات قصيرة لا يُنتظر لها نص ولا ملخص، فلا يُطلب شيء من مقسم إلا إذا وُجدت مكالمة طويلة بلاهما
function missingTexts(stats) {
    return count(stats.long_enough) > 0 && count(stats.with_transcript) === 0;
}

function missingSummaries(stats) {
    return count(stats.long_enough) > 0 && count(stats.with_summary) === 0;
}

// هل في التحذيرات ما يُطلب من مقسم، فيظهر تحتها عنوان دعمهم
export function asksMaqsam(stats) {
    return isObject(stats) && (missingTexts(stats) || missingSummaries(stats));
}

// ما يلزم المدير فعله: كل سطر لا يظهر إلا إذا صدق
export function advice(stats) {
    if (!isObject(stats)) return [];
    const calls = count(stats.calls);
    const talked = count(stats.talked);
    const agents = Array.isArray(stats.agents) ? stats.agents : [];
    const noAgent = count(stats.no_agent);
    const lines = [];
    if (calls === 0) lines.push('لا توجد مكالمات في الأيام السبعة قبل آخر فحص. إذا كان الموظفون يتصلون من جوالاتهم فلن تظهر مكالماتهم هنا.');
    if (missingTexts(stats)) lines.push('لم نجد نصوصاً في المكالمات. إذا لم تكن خدمة التفريغ مفعّلة فاطلب تفعيلها من مقسم.');
    if (missingSummaries(stats)) lines.push('لم نجد ملخصات في المكالمات. إذا لم تكن خدمة الملخص مفعّلة فاطلب تفعيلها من مقسم.');
    if (talked > 0 && agents.length === 0) lines.push('لم يظهر اسم أي موظف في المكالمات. ' + OWN_USER);
    if (talked > 0 && agents.length === 1) lines.push((noAgent ? 'ظهر موظف واحد فقط في المكالمات. ' : 'كل المكالمات باسم موظف واحد. ') + OWN_USER);
    return lines;
}
