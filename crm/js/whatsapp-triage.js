// فرز Jev لرسائل واتساب في صفحة «عروض واتساب» — بلا DOM، فيُختبر وحده مثل whatsapp-parse.js.
//
// الوظيفة wa-triage (للمدير وحده) تسأل Jev عن كل رسالة جديدة وتعيد تسميات فقط: الحكم
// (send «مقترح للإرسال» / review «يحتاج نظرك» / skip «مستبعد») وأسبابه، وما فهمه Jev من الرسالة
// (النية، نوع العقار، المدينة، الحي). نص الرسالة لا يُحفظ هناك: تُحفظ بصمته والتسميات.
// هنا ما تحتاجه الصفحة من ذلك: التسميات العربية، الدفعات، مخزن النتائج، مرشّح الحكم، التحديد المسبق،
// ترتيب الإرسال، نداء الوظيفة بلا رمي، وجداول «دقة Jev».
//
// قاعدة المالك: Jev يقترح فقط. لا يصل شيء إلى المساعد إلا بضغط المالك «إرسال للمساعد»، وتعذّر
// الوظيفة أو إيقافها يترك الصفحة كما كانت قبل Jev.

export const TRIAGE_FN = 'wa-triage';
export const MODE_KEY = 'wa_triage_mode';   // crm_settings: off | suggest | preselect، وغياب الصف = suggest
export const MODES = ['off', 'suggest', 'preselect'];
export const DEFAULT_MODE = 'suggest';
export const BATCH = 25;                    // عناصر النداء الواحد، وهو حد الوظيفة
export const IN_FLIGHT = 2;                 // نداءان على الأكثر في الوقت نفسه
export const MAX_ERRORS = 2;                // نداءان فاشلان متتاليان: الوظيفة معطلة لا متعثرة، فتتوقف الجولة
export const STATUS_MS = 10000;
export const TRIAGE_MS = 70000;             // الوظيفة لا تبدأ سؤالاً لـ Jev بعد 50 ث وتردّ قبل 55 ث
export const LABEL_MS = 15000;
export const REPORT_DAYS = 30;

/* ===================== التسميات ===================== */

export const VERDICT_AR = { send: 'مقترح للإرسال', review: 'يحتاج نظرك', skip: 'مستبعد', untriaged: 'غير مفرز' };
export const VERDICT_TONE = { send: 'green', review: 'gold', skip: 'neutral', untriaged: 'neutral' };
export const BUCKETS = ['send', 'review', 'skip', 'untriaged'];

// نية كاتب الرسالة كما يراها Jev، وهي أيضاً خيارات «تصحيح Jev»
export const INTENT_AR = {
    sale_offer: 'عرض بيع', rent_offer: 'عرض إيجار', status_update: 'تحديث عرض',
    wanted: 'طلب', not_property: 'ليس عرضاً', other: 'غير ذلك'
};
export const INTENTS = Object.keys(INTENT_AR);

// نوع العقار عند Jev — غير تصنيف القارئ (offer/update/…) في whatsapp-parse.js
export const PROPERTY_AR = {
    apartment: 'شقة', villa: 'فيلا', floor: 'دور', building: 'عمارة', land: 'أرض',
    commercial: 'تجاري', rest_house: 'استراحة', other: 'أخرى', none: '—'
};
export const CITY_AR = {
    jeddah: 'جدة', makkah: 'مكة', madinah: 'المدينة', riyadh: 'الرياض', other_city: 'مدينة أخرى', not_stated: '—'
};
export const REASON_AR = {
    sale_offer: 'عرض بيع', status_update: 'تحديث على عرض', not_property: 'ليس عرضاً عقارياً',
    wanted: 'طلب لا عرض', rent: 'إيجار', outside_jeddah: 'خارج جدة', multiple: 'عدة عقارات في رسالة واحدة',
    low_confidence: 'Jev غير متأكد', document_only: 'ملف فقط — افتحه من الهاتف', error: 'تعذّر الفرز'
};
// أسباب تزيد على النية نفسها، فتُكتب بعد سطر Jev على البطاقة
const NOTE_REASONS = ['outside_jeddah', 'multiple', 'low_confidence', 'document_only', 'error'];

export const SURFACED_AR = 'Jev: عرض فاته الفرز';
export const MODE_AR = { off: 'متوقف', suggest: 'اقتراحات', preselect: 'تحديد المقترح تلقائياً' };
export const MODE_HINT = {
    off: 'لا يُرسل شيء إلى خدمة الفرز، والصفحة كما كانت قبله.',
    suggest: 'يظهر حكم Jev على كل رسالة جديدة، والتحديد والإرسال بيدك.',
    preselect: 'عند وصول نتائج Jev يُحدَّد ما اقترحه، الأعلى ثقة أولاً حتى حد اليوم. الإرسال بيدك.'
};

export function normalizeMode(value) {
    return MODES.indexOf(value) === -1 ? DEFAULT_MODE : value;
}

/* ===================== النتائج ===================== */

// النص الذي يُفرز: نص الكتلة الرئيسية للعنصر بلا مسافات طرفية (الوظيفة تبصمه بعد trim أيضاً)
export function itemText(item) {
    const block = item && item.main && item.main.block;
    return block && block.text ? String(block.text).trim() : '';
}

function answerOf(value) {
    if (!value || typeof value !== 'object' || typeof value.choice !== 'string') return null;
    const raw = value.confidence;
    const n = typeof raw === 'number' ? raw : NaN;
    return { choice: value.choice, confidence: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null };
}

// ItemResult من الوظيفة ← نتيجة نظيفة، أو null لما لا يُعتمد عليه (ok:false أو حكم غير معروف أو بلا مفتاح)
export function normalizeResult(raw) {
    if (!raw || typeof raw !== 'object' || raw.ok !== true) return null;
    if (typeof raw.key !== 'string' || !raw.key) return null;
    if (['send', 'review', 'skip'].indexOf(raw.verdict) === -1) return null;
    return {
        key: raw.key,
        verdict: raw.verdict,
        reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((r) => typeof r === 'string') : [],
        cached: raw.cached === true,
        truncated: raw.truncated === true,
        intent: answerOf(raw.intent),
        kind: answerOf(raw.kind),
        city: answerOf(raw.city),
        district: answerOf(raw.district),
        multiple: typeof raw.multiple === 'number' && Number.isFinite(raw.multiple) ? raw.multiple : null,
        owner_label: INTENTS.indexOf(raw.owner_label) === -1 ? null : raw.owner_label
    };
}

// المخزن: النتيجة بمفتاح الوظيفة (بصمة النص)، والنص ← المفتاح. معرّفات العناصر تتجدد مع كل تحميل،
// فالعنصر يجد نتيجته بنصه لا بمعرّفه، والنص نفسه في عنصرين يحمل النتيجة نفسها.
export function createStore() {
    return { byKey: new Map(), keyByText: new Map() };
}

export function remember(store, text, raw) {
    const result = normalizeResult(raw);
    if (!result || !text) return null;
    store.byKey.set(result.key, result);
    store.keyByText.set(text, result.key);
    return result;
}

export function resultFor(store, item) {
    const key = store.keyByText.get(itemText(item));
    return key ? store.byKey.get(key) || null : null;
}

/* ===================== الحكم والمرشّح ===================== */

// الحكم بعد تصحيح المالك: نيته تغلب نية Jev. «ليس عرضاً» و«طلب» و«عرض إيجار» تُستبعد، و«غير ذلك» يحتاج
// نظرك، و«عرض بيع»/«تحديث عرض» يبقى مقترحاً إن اقترحه Jev، وإلا يحتاج نظرك (المدينة وتعدد العقارات لم
// يُحكم فيهما بنية المالك).
export function verdictOf(result) {
    if (!result) return null;
    const label = result.owner_label;
    if (!label) return result.verdict;
    if (label === 'sale_offer' || label === 'status_update') return result.verdict === 'send' ? 'send' : 'review';
    if (label === 'other') return 'review';
    return 'skip';
}

export function bucketOf(result) {
    return verdictOf(result) || 'untriaged';
}

export function passesVerdictFilter(result, buckets) {
    return buckets.has(bucketOf(result));
}

export function countBuckets(items, resultOf) {
    const counts = { send: 0, review: 0, skip: 0, untriaged: 0 };
    for (const item of items) counts[bucketOf(resultOf(item))] += 1;
    return counts;
}

export function confidenceOf(result) {
    return result && result.intent && typeof result.intent.confidence === 'number' ? result.intent.confidence : null;
}

// تصنيفات القارئ التي ليست عرضاً (رسالة أخرى، طلب شراء). ما حكم فيه Jev منها «مقترح للإرسال» عرضٌ فاته الفرز:
// يظهر ولو كانت شريحة تصنيفه مطفأة، بشارة «Jev: عرض فاته الفرز». ما صنّفه القارئ عرضاً أو تحديثاً لم يفته الفرز،
// فإطفاء المالك شريحته يُخفيه كما كان قبل Jev.
export const REGEX_MISSED = ['other', 'wanted'];

export function isSurfaced(regexKind, result) {
    return REGEX_MISSED.indexOf(regexKind) !== -1 && bucketOf(result) === 'send';
}

/* ===================== ما يُعرض على البطاقة ===================== */

// 0.93 → «93%» بأرقام ‎0-9‎ كباقي أرقام /crm (الأعداد، النسب في «دقة Jev»)
export function percentText(confidence) {
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return '';
    return Math.round(Math.min(1, Math.max(0, confidence)) * 100) + '%';
}

function reasonText(reasons, only) {
    return (reasons || []).filter((r) => REASON_AR[r] && (!only || only.indexOf(r) !== -1))
        .map((r) => REASON_AR[r]).join('، ');
}

// الحي اسم من قائمة أحياء جدة (بلا «حي» في أوله)، أو none / not_stated حين لا يُذكر
function districtText(answer) {
    const name = answer && typeof answer.choice === 'string' ? answer.choice.trim() : '';
    if (!name || name === 'none' || name === 'not_stated') return '';
    return /^حي\s/.test(name) ? name : 'حي ' + name;
}

// شارة الحكم، وسطر «Jev: عرض بيع 93% · فيلا · حي السامر · جدة»، وسبب الحكم (يظهر عند الوقوف على الشارة)،
// وملاحظة تُكتب بعد السطر حين يزيد السبب على النية (خارج جدة، عدة عقارات، Jev غير متأكد).
export function describe(result) {
    const bucket = bucketOf(result);
    const out = { bucket: bucket, badge: { text: VERDICT_AR[bucket], tone: VERDICT_TONE[bucket] }, footer: '', reason: '', note: '' };
    if (!result) return out;
    const intent = result.intent ? INTENT_AR[result.intent.choice] : null;
    if (intent) {
        const pct = percentText(result.intent.confidence);
        const parts = [pct ? intent + ' ' + pct : intent];
        const kind = result.kind ? PROPERTY_AR[result.kind.choice] : null;
        if (kind && kind !== '—') parts.push(kind);
        const district = districtText(result.district);
        if (district) parts.push(district);
        const city = result.city ? CITY_AR[result.city.choice] : null;
        if (city && city !== '—') parts.push(city);
        out.footer = 'Jev: ' + parts.join(' · ');
    } else {
        // حكم بلا سؤال لـ Jev (مستند وحده) أو بلا إجابة: السبب هو السطر
        out.footer = 'Jev: ' + (reasonText(result.reasons) || VERDICT_AR[result.verdict]);
    }
    if (result.owner_label) {
        out.reason = 'تصحيحك: ' + INTENT_AR[result.owner_label];
        out.footer += ' — ' + out.reason;
    } else {
        out.reason = reasonText(result.reasons);
        if (intent) out.note = reasonText(result.reasons, NOTE_REASONS);
    }
    return out;
}

/* ===================== التحديد المسبق وترتيب الإرسال ===================== */

const rank = (confidence) => (confidence === null ? -1 : confidence);
const byConfidence = (a, b) => rank(b.confidence) - rank(a.confidence) || a.index - b.index;

// وضع «تحديد المقترح تلقائياً» وحده، وبعد وصول دفعة فقط: ما حكمه «مقترح للإرسال»، ولم يُرسل، ولم يُلغِ المالك
// تحديده بيده، وليس محدداً أصلاً — الأعلى ثقةً بالنية أولاً، حتى يبلغ المحدد كله ما بقي من حد طلبات اليوم.
// items بترتيب القائمة (الأحدث أولاً)، فالتعادل للأحدث. يعيد معرّفات ما يُحدَّد.
//   opts: { resultOf, isSent, selected: Set(id), unticked: Set(نص), cap, taken }
export function preselect(items, opts) {
    const room = Math.max(0, Math.floor(Number(opts.cap) || 0) - (opts.taken || 0));
    if (!room) return [];
    const picks = [];
    items.forEach((item, index) => {
        const result = opts.resultOf(item);
        if (bucketOf(result) !== 'send') return;
        if (opts.selected.has(item.id) || opts.isSent(item)) return;
        if (opts.unticked && opts.unticked.has(itemText(item))) return;
        picks.push({ id: item.id, index: index, confidence: confidenceOf(result) });
    });
    picks.sort(byConfidence);
    return picks.slice(0, room).map((p) => p.id);
}

// ترتيب الإرسال حين يوجد ما حدده Jev: ما حدده المالك بيده أولاً بترتيبه المعتاد (الأحدث أولاً)، ثم ما حدده
// Jev بثقة النية من الأعلى؛ فإن قطع حدُّ اليوم الإرسالَ سقط الأقل ثقة لا الأقدم. بلا تحديد مسبق: كما كان تماماً.
//   opts: { auto: Set(id) ما حدده Jev، resultOf }
export function sendOrder(chosen, opts) {
    const auto = opts.auto;
    if (!auto || !chosen.some((item) => auto.has(item.id))) return chosen.slice();
    const manual = chosen.filter((item) => !auto.has(item.id));
    const picked = chosen.map((item, index) => ({ item: item, index: index, confidence: confidenceOf(opts.resultOf(item)) }))
        .filter((p) => auto.has(p.item.id))
        .sort(byConfidence)
        .map((p) => p.item);
    return manual.concat(picked);
}

/* ===================== الدفعات ===================== */

export function chunk(list, size = BATCH) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

// عناصر الصفحة ← بنود النداء. النص نفسه يُفرز مرة واحدة ولو تكرر في أكثر من عنصر (رسائل «أخرى» لا تُدمج في
// الصفحة). يُرسل نص الكتلة الرئيسية ومجموعتها وتصنيف القارئ، وبصمات نصوص المصدر المحسوبة فقط (refreshSent)
// ليعرف التقرير ما أُرسل منها للمساعد. لا يُرسل المرسل ولا رأس الرسالة، وما بلا نص لا يُرسل أصلاً.
export function buildEntries(items, nextRef) {
    let n = 0;
    const ref = typeof nextRef === 'function' ? nextRef : () => 'r' + (n++);
    const byText = new Map();
    const entries = [];
    for (const item of items) {
        const text = itemText(item);
        if (!text) continue;
        let entry = byText.get(text);
        if (!entry) {
            const block = item.main.block;
            entry = {
                ref: ref(), textKey: text, text: block.text, group: item.main.source.group || '',
                regex_kind: block.kind || 'other', source_shas: [], items: []
            };
            byText.set(text, entry);
            entries.push(entry);
        }
        entry.items.push(item);
        for (const copy of item.copies || []) {
            if (copy.hash && entry.source_shas.indexOf(copy.hash) === -1) entry.source_shas.push(copy.hash);
        }
    }
    return entries;
}

export function payloadOf(entry) {
    return { ref: entry.ref, text: entry.text, group: entry.group, regex_kind: entry.regex_kind, source_shas: entry.source_shas.slice() };
}

// جولة الفرز في الخلفية: دفعات من BATCH، ونداءان على الأكثر في الوقت نفسه (بما فيها ما بقي في الطريق من جولة
// سابقة). reset() مع كل تحميل يبدأ جولة جديدة: ردود الجولة السابقة تُهمل حين تصل، فلا تُنسب نتيجة إلى عنصر
// تجدد معرّفه أو لم يعد موجوداً. لا ترمي.
//   call(items) → Promise<{ ok, data?, skipped?, message? }> (triageBatch)      store: من createStore()
//   onBatch({ results: [{ entry, result|null }], out, failed }) للجولة الحالية فقط، مرة لكل دفعة
//   alive() → false حين تُغلق الصفحة، فلا يبدأ نداء ولا يُطبَّق رد
export function createRunner(options) {
    const call = options.call;
    const store = options.store;
    const onBatch = options.onBatch || (() => {});
    const alive = options.alive || (() => true);
    const size = options.batchSize || BATCH;
    const limit = options.inFlight || IN_FLIGHT;
    const maxErrors = options.maxErrors || MAX_ERRORS;
    let seq = 0;
    let active = 0;      // النداءات في الطريق من أي جولة
    let mine = 0;        // نداءات الجولة الحالية في الطريق
    let refs = 0;
    let queue = [];
    let pending = new Set();
    let failedItems = new Map();   // نص ← عدد عناصره المحسوبة في «تعذّر فرز» في هذه الجولة
    let stats = blank();

    function blank() {
        return { total: 0, sorted: 0, failed: 0, errorsInRow: 0, stopped: false, message: null };
    }

    function reset() {
        seq += 1;
        mine = 0;
        refs = 0;
        queue = [];
        pending = new Set();
        failedItems = new Map();
        stats = blank();
    }

    // عناصر للجولة الحالية: ما له نتيجة أو في الطريق أو بلا نص لا يُرسل. يعيد عدد العناصر المضافة.
    // جولة متوقفة تُستأنف بإضافة جديدة (توسيع «منذ» مثلاً) بعدّاد أخطاء من الصفر؛ وما تعذّر فرزه فيها ثم أُعيد
    // يُعدّ مرة واحدة في «فُرز X من N»: يخرج من «تعذّر» ولا يُزاد على N.
    function add(items) {
        const fresh = items.filter((item) => {
            const text = itemText(item);
            return text && !pending.has(text) && !resultFor(store, item);
        });
        const entries = buildEntries(fresh, () => 'r' + (refs++));
        if (!entries.length) return 0;
        if (stats.stopped) {
            stats.stopped = false;
            stats.message = null;
            stats.errorsInRow = 0;
        }
        let count = 0;
        for (const entry of entries) {
            pending.add(entry.textKey);
            const before = failedItems.get(entry.textKey) || 0;
            failedItems.delete(entry.textKey);
            stats.failed -= before;
            stats.total += entry.items.length - before;
            count += entry.items.length;
        }
        for (const part of chunk(entries, size)) queue.push(part);
        pump();
        return count;
    }

    function markFailed(entry) {
        pending.delete(entry.textKey);
        stats.failed += entry.items.length;
        failedItems.set(entry.textKey, (failedItems.get(entry.textKey) || 0) + entry.items.length);
    }

    function pump() {
        while (active < limit && queue.length && alive()) {
            const batch = queue.shift();
            active += 1;
            mine += 1;
            send(batch, seq).catch((error) => console.error('[CRM] wa-triage', error));
        }
    }

    // الوظيفة قالت «متوقف» أو بلغ الفرز سقفه، أو تعطلت: ما بقي في الطابور لا يُرسل في هذه الجولة
    function stop(message) {
        stats.stopped = true;
        stats.message = message;
        for (const batch of queue) for (const entry of batch) markFailed(entry);
        queue = [];
    }

    async function send(batch, round) {
        let out;
        try {
            out = await call(batch.map(payloadOf));
        } catch (error) {
            out = { ok: false, error: error, message: null };
        }
        out = out && typeof out === 'object' ? out : { ok: false, message: null };
        active -= 1;
        if (round !== seq) return void pump();     // رد جولة سابقة: يُهمل، ويبدأ ما ينتظر من الجولة الحالية
        mine -= 1;
        if (!alive()) return;
        const rows = out.ok && out.data && Array.isArray(out.data.items) ? out.data.items : null;
        const byRef = new Map();
        if (rows) for (const raw of rows) if (raw && typeof raw.ref === 'string') byRef.set(raw.ref, raw);
        const results = batch.map((entry) => {
            const result = byRef.has(entry.ref) ? remember(store, entry.textKey, byRef.get(entry.ref)) : null;
            if (result) {
                pending.delete(entry.textKey);
                stats.sorted += entry.items.length;
            } else {
                markFailed(entry);
            }
            return { entry: entry, result: result };
        });
        if (rows) stats.errorsInRow = 0;
        else if (out.skipped) stop(out.message || 'فرز Jev متوقف');
        else {
            stats.errorsInRow += 1;
            if (stats.errorsInRow >= maxErrors) stop(null);
        }
        try {
            onBatch({ results: results, out: out, failed: !rows });
        } catch (error) {
            console.error('[CRM] wa-triage', error);
        }
        pump();
    }

    function progress() {
        return {
            total: stats.total, sorted: stats.sorted, failed: stats.failed,
            busy: mine > 0 || queue.length > 0, stopped: stats.stopped, message: stats.message
        };
    }

    return { reset: reset, add: add, progress: progress, inFlight: () => active };
}

// سطر الحالة: «جارٍ فرز N رسالة بـ Jev…» حتى تعود أول دفعة، ثم «فُرز X من N»
export function progressLine(p) {
    if (!p || !p.total) return '';
    if (p.busy && !p.sorted && !p.failed) return 'جارٍ فرز ' + p.total + ' رسالة بـ Jev…';
    let line = 'فُرز ' + p.sorted + ' من ' + p.total;
    if (p.message) line += ' — ' + p.message;
    else if (!p.busy && p.failed) line += ' — تعذّر فرز ' + p.failed;
    return line;
}

/* ===================== نداء الوظيفة (لا يرمي) ===================== */
// مثل recheckTwins في agent.js: مهلة بسباق Promise.race، وكل فشل يعود { ok:false } بدل أن يُرمى، فلا يوقف
// فشلُ الفرز شيئاً في الصفحة. العميل (supabase) يُمرَّر معاملاً فتختبره الاختبارات بعميل مزيّف.
//   { ok:true, data } | { ok:false, skipped?, timedOut?, message (عربي من الوظيفة أو null), error? }

function settleWithin(promise, ms, fallback) {
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// رسالة الوظيفة العربية من رد غير 2xx («غير موجود»، «هذه العملية للمدير فقط»…)، أو null
async function serverMessage(error) {
    const response = error && error.context;
    if (!response || typeof response.json !== 'function') return null;
    try {
        const body = await settleWithin(Promise.resolve().then(() =>
            (typeof response.clone === 'function' ? response.clone() : response).json()), 2000, null);
        return body && typeof body.message === 'string' && body.message ? body.message : null;
    } catch (_) {
        return null;
    }
}

export async function invokeTriage(client, body, ms = TRIAGE_MS) {
    const LATE = { late: true };
    try {
        const out = await settleWithin(Promise.resolve().then(() => client.functions.invoke(TRIAGE_FN, { body: body })), ms, LATE);
        if (out === LATE) return { ok: false, timedOut: true, message: null };
        if (!out || typeof out !== 'object') return { ok: false, message: null };
        if (out.error) return { ok: false, error: out.error, message: await serverMessage(out.error) };
        const data = out.data;
        if (!data || typeof data !== 'object') return { ok: false, message: null };
        if (data.status === 'success') return { ok: true, data: data };
        const message = typeof data.message === 'string' && data.message ? data.message : null;
        if (data.status === 'skipped') return { ok: false, skipped: true, message: message, data: data };
        return { ok: false, message: message, data: data };
    } catch (error) {
        return { ok: false, error: error, message: null };
    }
}

// حالة الفرز عند فتح الصفحة. أي تعذّر = غير متاح، فتبقى الصفحة كما كانت.
export async function triageStatus(client, ms = STATUS_MS) {
    const out = await invokeTriage(client, { action: 'status' }, ms);
    if (!out.ok) return { reachable: false, enabled: false, mode: DEFAULT_MODE, message: null };
    const data = out.data;
    return {
        reachable: true,
        enabled: data.enabled === true,
        mode: normalizeMode(data.mode),
        message: typeof data.message === 'string' && data.message ? data.message : null
    };
}

export function triageBatch(client, items, ms = TRIAGE_MS) {
    return invokeTriage(client, { action: 'triage', items: items }, ms);
}

export function labelTriage(client, key, label, ms = LABEL_MS) {
    return invokeTriage(client, { action: 'label', key: key, label: label }, ms);
}

// فشل نداء ← خطأ برسالة عربية لـ fail() في ui.js
export function outError(out) {
    if (out && out.message) return new Error(out.message);
    if (out && out.timedOut) return new Error('انتهت مهلة خدمة الفرز');
    return new Error('تعذّر الوصول إلى خدمة الفرز');
}

/* ===================== «دقة Jev» ===================== */
// wa_triage_report (الترحيل 026) يعيد لكل مجموعة أسئلة: الأحكام وما أُرسل منها للمساعد، وشرائح ثقة النية،
// وتصحيحات المالك، وتصنيف القارئ × الحكم، والتكلفة (الشكل في تعليق الدالة). هنا تصير جداول بسيطة
// { title, head, rows } نصوصاً جاهزة للعرض، بلا رسوم. jsonb لا يحفظ ترتيب المفاتيح، فالترتيب من هنا.

const BAND_AR = {
    '>=0.9': '90% فأكثر', '0.75-0.9': 'من 75% إلى أقل من 90%',
    '0.5-0.75': 'من 50% إلى أقل من 75%', '<0.5': 'أقل من 50%'
};
const REGEX_ORDER = ['offer', 'update', 'document', 'wanted', 'other', 'none'];

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) + '%' : '—');

function usd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const text = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return '$' + text;
}

//   kindLabels: تسميات تصنيف القارئ (KIND_AR في whatsapp.js)
//   ← { error: نص | null, empty: لا فرز في المدة, tables: [{ title, head, rows }] }
export function reportView(report, kindLabels) {
    const kinds = Object.assign({ none: 'بلا تصنيف' }, kindLabels || {});
    if (!isPlain(report)) return { error: 'ردّ غير متوقع من تقرير Jev', empty: false, tables: [] };
    if (report.ok !== true) {
        const error = report.code === 'forbidden' ? 'تقرير Jev للمدير وحده'
            : report.code === 'invalid_days' ? 'مدة التقرير غير صالحة' : 'تعذّر إعداد تقرير Jev';
        return { error: error, empty: false, tables: [] };
    }
    const days = count(report.days) || REPORT_DAYS;
    const tables = [];
    if (isPlain(report.cost)) {
        const c = report.cost;
        tables.push({
            title: 'تكلفة الفرز',
            head: ['', 'التكلفة', 'نداءات Jev'],
            rows: [
                ['اليوم', usd(c.today_usd), String(count(c.today_jev_calls))],
                ['آخر ' + days + ' يوماً', usd(c.window_usd), String(count(c.window_jev_calls))]
            ]
        });
    }
    const qsets = isPlain(report.qsets) ? report.qsets : {};
    const names = Object.keys(qsets).filter((q) => isPlain(qsets[q])).sort();
    for (const qset of names) {
        const q = qsets[qset];
        const prefix = names.length > 1 ? qset + ': ' : '';
        const total = count(q.total);
        if (isPlain(q.verdicts)) {
            tables.push({
                title: prefix + 'أحكام Jev (' + total + ' رسالة، أُرسل منها للمساعد ' + count(q.sent) + ')',
                head: ['الحكم', 'العدد', 'أُرسل للمساعد', 'نسبة الإرسال'],
                rows: ['send', 'review', 'skip'].map((v) => {
                    const row = isPlain(q.verdicts[v]) ? q.verdicts[v] : {};
                    return [VERDICT_AR[v], String(count(row.count)), String(count(row.sent)), share(count(row.sent), count(row.count))];
                })
            });
        }
        if (Array.isArray(q.confidence)) {
            tables.push({
                title: prefix + 'ثقة Jev في نية الرسالة',
                head: ['الثقة', 'العدد', 'أُرسل للمساعد', 'نسبة الإرسال'],
                rows: q.confidence.filter(isPlain).map((b) => [
                    BAND_AR[b.band] || String(b.band), String(count(b.count)), String(count(b.sent)), share(count(b.sent), count(b.count))
                ])
            });
        }
        if (isPlain(q.corrections)) {
            const fixes = count(q.corrections.count);
            const agree = count(q.corrections.agree);
            tables.push({
                title: prefix + 'تصحيحاتك',
                head: ['التصحيحات', 'وافقت نية Jev', 'نسبة الموافقة'],
                rows: [[String(fixes), String(agree), share(agree, fixes)]]
            });
        }
        if (isPlain(q.regex_kind)) {
            const keys = Object.keys(q.regex_kind).filter((k) => isPlain(q.regex_kind[k]));
            keys.sort((a, b) => {
                const ia = REGEX_ORDER.indexOf(a), ib = REGEX_ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0);
            });
            tables.push({
                title: prefix + 'تصنيف القارئ × حكم Jev (بين القوسين ما أُرسل للمساعد)',
                head: ['تصنيف القارئ', VERDICT_AR.send, VERDICT_AR.review, VERDICT_AR.skip],
                rows: keys.map((k) => [kinds[k] || k].concat(['send', 'review', 'skip'].map((v) => {
                    const cell = isPlain(q.regex_kind[k][v]) ? q.regex_kind[k][v] : {};
                    return count(cell.count) + ' (' + count(cell.sent) + ')';
                })))
            });
        }
    }
    return { error: null, empty: names.length === 0, tables: tables };
}
