// اختبار فرز Jev في صفحة عروض واتساب (crm/js/whatsapp-triage.js) بعينات مصطنعة: لا رسائل حقيقية ولا أرقام
// ولا أسماء أشخاص في المستودع. نداء الوظيفة يُختبر بعميل مزيّف، فلا شبكة ولا مفتاح.
// التشغيل: node tests/whatsapp-triage.test.mjs   أو   deno run tests/whatsapp-triage.test.mjs
import {
    BATCH, IN_FLIGHT, BUCKETS, VERDICT_AR, VERDICT_TONE, INTENT_AR, INTENTS, PROPERTY_AR, CITY_AR, REASON_AR, SURFACED_AR,
    MODE_AR, REGEX_MISSED, normalizeMode, itemText, normalizeResult, createStore, remember, resultFor, verdictOf, bucketOf,
    passesVerdictFilter, countBuckets, confidenceOf, isSurfaced, percentText, describe, preselect, sendOrder, jevOrder, chunk, buildEntries,
    payloadOf, createRunner, progressLine, invokeTriage, triageStatus, triageBatch, labelTriage, outError, reportView, groupToSend
} from '../crm/js/whatsapp-triage.js';
import { parseChat, groupFromFileName } from '../crm/js/whatsapp-parse.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// عنصر بشكل buildItems في whatsapp.js: { id, main: نسخة, copies, sentRequest }، والنسخة { source, block, text, hash }
function item(id, text, opts = {}) {
    const source = { group: opts.group || 'مجموعة تجربة' };
    const block = { text: text, kind: opts.kind || 'offer', sender: 'وسيط تجربة', at: '2026-09-21T10:00:00', lastAt: '2026-09-21T10:00:00',
        media: false, documents: [], attachments: [] };
    const hashes = opts.hashes === undefined ? ['h-' + id] : opts.hashes;
    const copies = (hashes.length ? hashes : [null]).map((hash) => ({ source: source, block: block, text: '', hash: hash }));
    return { id: id, main: copies[0], copies: copies, sentRequest: null };
}

// ItemResult كما تعيده الوظيفة (spec §7)
function raw(ref, key, verdict, intent, confidence, extra = {}) {
    return Object.assign({
        ref: ref, key: key, ok: true, cached: false, verdict: verdict, reasons: [intent], truncated: false,
        intent: { choice: intent, confidence: confidence }, kind: { choice: 'apartment', confidence: 0.9 },
        city: { choice: 'jeddah', confidence: 0.9 }, district: { choice: 'not_stated', confidence: null },
        multiple: 0.1, owner_label: null
    }, extra);
}
const result = (...args) => normalizeResult(raw(...args));

/* ===================== التسميات والوضع ===================== */

t('labels: verdicts per spec §10', VERDICT_AR.send === 'مقترح للإرسال' && VERDICT_AR.review === 'يحتاج نظرك'
    && VERDICT_AR.skip === 'مستبعد' && VERDICT_AR.untriaged === 'غير مفرز', VERDICT_AR);
t('labels: verdict tones green/gold/neutral', VERDICT_TONE.send === 'green' && VERDICT_TONE.review === 'gold' && VERDICT_TONE.skip === 'neutral');
t('labels: six intents in spec order', INTENTS.join() === 'sale_offer,rent_offer,status_update,wanted,not_property,other', INTENTS);
t('labels: intent, property, city and reason wording', INTENT_AR.not_property === 'ليس عرضاً' && PROPERTY_AR.commercial === 'تجاري'
    && PROPERTY_AR.none === '—' && CITY_AR.other_city === 'مدينة أخرى' && REASON_AR.document_only === 'ملف فقط — افتحه من الهاتف'
    && REASON_AR.low_confidence === 'Jev غير متأكد');
t('labels: surfaced badge and modes', SURFACED_AR === 'Jev: عرض فاته الفرز' && MODE_AR.off === 'متوقف'
    && MODE_AR.suggest === 'اقتراحات' && MODE_AR.preselect === 'تحديد المقترح تلقائياً');
t('mode: missing or unknown value means suggest', normalizeMode(undefined) === 'suggest' && normalizeMode('bogus') === 'suggest'
    && normalizeMode({ mode: 'off' }) === 'suggest');
t('mode: off and preselect kept', normalizeMode('off') === 'off' && normalizeMode('preselect') === 'preselect');

/* ===================== الدفعات ===================== */

const sixty = Array.from({ length: 60 }, (_, i) => i);
t('batching: 60 entries → 25 + 25 + 10', chunk(sixty).map((c) => c.length).join() === '25,25,10' && BATCH === 25 && IN_FLIGHT === 2);
t('batching: exact multiple and empty list', chunk(sixty.slice(0, 50)).length === 2 && chunk([]).length === 0);

const twinA = item('i0', 'شقة للبيع في حي تجربة بسعر 500 ألف', { hashes: ['h1', 'h2'], group: 'مجموعة أ' });
const twinB = item('i1', '  شقة للبيع في حي تجربة بسعر 500 ألف  ', { kind: 'other', hashes: ['h2', 'h3'] });
const noHash = item('i2', 'أرض للبيع مساحة 600 متر', { hashes: [] });
const blank = item('i3', '', { kind: 'other' });
const entries = buildEntries([twinA, twinB, noHash, blank]);
t('entries: same text after trim → one entry for both items', entries.length === 2 && entries[0].items.length === 2, entries.map((e) => e.items.length));
t('entries: empty text is never sent', entries.every((e) => e.textKey));
t('entries: source_shas = union of computed copy hashes only', entries[0].source_shas.join() === 'h1,h2,h3' && entries[1].source_shas.length === 0,
    entries.map((e) => e.source_shas));
t('entries: group and regex_kind from the main copy of the first item', entries[0].group === 'مجموعة أ' && entries[0].regex_kind === 'offer');
t('entries: refs unique', new Set(entries.map((e) => e.ref)).size === entries.length);
const payload = payloadOf(entries[0]);
t('payload: exactly ref, text, group, regex_kind, source_shas (no sender, no header)',
    Object.keys(payload).sort().join() === 'group,ref,regex_kind,source_shas,text' && payload.text === twinA.main.block.text, payload);
let refN = 10;
t('entries: caller-supplied refs', buildEntries([noHash], () => 'x' + (refN++))[0].ref === 'x10');

// المحادثة الفردية (طرفان على الأكثر كتبا فيها) لا يُرسل اسمها — هو اسم الشخص؛ المجموعة (ثلاثة فأكثر) يبقى اسمها
const person = { group: 'وسيط تجربة', blocks: [{ sender: '~ وسيط تجربة', text: 'شقة للبيع' }, { sender: 'أنا', text: 'كم السعر' }] };
const room = { group: 'مجموعة عقار تجربة', blocks: [{ sender: 'وسيط تجربة' }, { sender: 'وسيط جدة' }, { sender: '+966 55 000 0001' }] };
t('group: a one-to-one chat is not sent', groupToSend(person) === '');
t('group: a group chat keeps its name', groupToSend(room) === 'مجموعة عقار تجربة');
t('group: a one-to-one export downloaded twice (« (1)») is still not sent',
    groupToSend({ group: 'وسيط تجربة (1)', blocks: [{ sender: 'وسيط تجربة' }, { sender: 'أنا' }] }) === '');
t('group: a one-to-one chat where only the owner wrote is not sent', groupToSend({ group: 'وسيط تجربة', blocks: [{ sender: 'أنا' }] }) === '');
t('group: no source, no name, no blocks', groupToSend(null) === '' && groupToSend({ group: '' }) === '' && groupToSend({ group: 'مجموعة', blocks: [] }) === '');
t('group: a source without a blocks list keeps its name (structure unknown)', groupToSend({ group: 'مجموعة' }) === 'مجموعة');
// عينة آيفون من اختبار القارئ: مجموعة «شركة تجربة» يكتب فيها حساب الشركة باسمها مع عضوين آخرين — يبقى اسمها
const RLM = '‏', LRE = '‪', PDF = '‬';
const company = parseChat([
    `[${RLM}1${RLM}/9${RLM}/2026، 8:00:00 ص] شركة تجربة: ${RLM}الرسائل والمكالمات مشفرة تمامًا بين الطرفين.`,
    `[${RLM}21${RLM}/9${RLM}/2026، 9:47:45 م] ${LRE}+966 55 000 0001${PDF}: *مشروع الربوة 102* شقة غرفتين بسعر ٢٧٩،٠٠٠`,
    `[${RLM}21${RLM}/9${RLM}/2026، 11:00:00 م] ~ وسيط جدة: مطلوب فيلا في أبحر الشمالية`,
    `[${RLM}22${RLM}/9${RLM}/2026، 12:30:00 م] شركة تجربة: تحديث: تم بيع الوحدة 5 والمتبقي 3 شقق بسعر 450 ألف`
].join('\n'), { group: groupFromFileName('WhatsApp Chat - شركة تجربة.zip') });
t('group: a group whose own account posts under its name keeps the name',
    groupToSend({ group: company.group, blocks: company.blocks }) === 'شركة تجربة', company.group);
// تصدير ضخم: يُحسب مرة لكل مصدر ويقف عند ثالث مرسل
const big = { group: 'مجموعة كبيرة', blocks: Array.from({ length: 50000 }, (_, i) => ({ sender: 'عضو ' + (i % 2), text: 'x' })) };
const many = Array.from({ length: 3000 }, (_, i) => ({ id: 'b' + i, main: { source: big, block: { text: 'عرض ' + i, kind: 'offer' } }, copies: [] }));
const started = Date.now();
const bigEntries = buildEntries(many);
t('group: 3000 entries from a 50,000-block export stay fast (cached per source)', Date.now() - started < 1500 && bigEntries.length === 3000 && bigEntries[0].group === '',
    Date.now() - started);
const personItem = item('i9', 'فيلا للبيع في حي تجربة', { group: 'وسيط تجربة' });
personItem.main.source.blocks = [personItem.main.block];
t('entries: a one-to-one chat entry carries no group', buildEntries([personItem])[0].group === '');

/* ===================== النتائج والمخزن ===================== */

t('result: ok:false is not a result', normalizeResult({ ref: 'r0', key: 'k', ok: false, error: 'deadline' }) === null);
t('result: unknown verdict or missing key rejected', normalizeResult(raw('r0', 'k', 'maybe', 'sale_offer', 0.9)) === null
    && normalizeResult(raw('r0', '', 'send', 'sale_offer', 0.9)) === null);
const clamp = result('r0', 'k1', 'send', 'sale_offer', 1.4, { owner_label: 'nonsense', multiple: 'x' });
t('result: confidence clamped to 0..1, bad owner_label and multiple dropped', clamp.intent.confidence === 1 && clamp.owner_label === null && clamp.multiple === null, clamp);
const noConf = result('r0', 'k2', 'review', 'sale_offer', null);
t('result: missing confidence stays null (treated as low)', noConf.intent.confidence === null && confidenceOf(noConf) === null);

const store = createStore();
const stored = remember(store, itemText(twinA), raw('r0', 'k-twin', 'send', 'sale_offer', 0.93));
t('store: result kept by server key and found by item text', store.byKey.get('k-twin') === stored && resultFor(store, twinA) === stored);
t('store: another item with the same text shares the result', resultFor(store, twinB) === stored);
t('store: unknown item → null', resultFor(store, noHash) === null);

/* ===================== الحكم والمرشّح ===================== */

const send = result('r0', 'ks', 'send', 'sale_offer', 0.93);
const review = result('r0', 'kr', 'review', 'sale_offer', 0.6, { reasons: ['low_confidence'] });
const skip = result('r0', 'kk', 'skip', 'not_property', 0.95);
t('bucket: null → untriaged', bucketOf(null) === 'untriaged' && verdictOf(null) === null);
t('bucket: server verdicts', bucketOf(send) === 'send' && bucketOf(review) === 'review' && bucketOf(skip) === 'skip');
const owned = (base, label) => Object.assign({}, base, { owner_label: label });
t('bucket: owner "not an offer" / wanted / rent → skip', bucketOf(owned(send, 'not_property')) === 'skip'
    && bucketOf(owned(send, 'wanted')) === 'skip' && bucketOf(owned(send, 'rent_offer')) === 'skip');
t('bucket: owner sale offer on a skipped item → review, not send', bucketOf(owned(skip, 'sale_offer')) === 'review');
t('bucket: owner agrees with a send → send; owner "other" → review', bucketOf(owned(send, 'status_update')) === 'send'
    && bucketOf(owned(send, 'other')) === 'review');
t('filter: verdict set', passesVerdictFilter(send, new Set(['send'])) && !passesVerdictFilter(skip, new Set(['send', 'review']))
    && passesVerdictFilter(null, new Set(['untriaged'])) && !passesVerdictFilter(null, new Set(['send'])));
const pool = [item('a', 'نص أ'), item('b', 'نص ب'), item('c', 'نص ج'), item('d', 'نص د')];
const poolResults = new Map([['a', send], ['b', send], ['c', skip]]);
t('filter: counts per bucket', JSON.stringify(countBuckets(pool, (it) => poolResults.get(it.id) || null))
    === JSON.stringify({ send: 2, review: 0, skip: 1, untriaged: 1 }));
t('filter: bucket order for the chips', BUCKETS.join() === 'send,review,skip,untriaged');

// «Jev: عرض فاته الفرز»: ما صنّفه القارئ «رسالة أخرى» أو «طلب شراء» وحكم Jev فيه «مقترح للإرسال» — لا ما صنّفه عرضاً
t('surfaced: only parser kinds that are not offers', REGEX_MISSED.join() === 'other,wanted');
t('surfaced: other / wanted judged send', isSurfaced('other', send) && isSurfaced('wanted', send));
t('surfaced: parser offers, updates and documents never (the parser did not miss them)',
    !isSurfaced('offer', send) && !isSurfaced('update', send) && !isSurfaced('document', send));
t('surfaced: not when Jev did not say send, or had no result', !isSurfaced('other', review) && !isSurfaced('other', skip)
    && !isSurfaced('wanted', null));
t('surfaced: owner correction to «ليس عرضاً» ends it; «عرض بيع» on a send keeps it',
    !isSurfaced('other', owned(send, 'not_property')) && isSurfaced('other', owned(send, 'sale_offer')));

/* ===================== ما يُعرض على البطاقة ===================== */

const villa = result('r0', 'kv', 'send', 'sale_offer', 0.93, {
    kind: { choice: 'villa', confidence: 0.8 }, district: { choice: 'السامر', confidence: 0.7 }, city: { choice: 'jeddah', confidence: 0.9 }
});
const dv = describe(villa);
t('describe: footer line exactly as specified', dv.footer === 'Jev: عرض بيع 93% · فيلا · حي السامر · جدة', dv.footer);
t('describe: send badge green, no note', dv.badge.text === 'مقترح للإرسال' && dv.badge.tone === 'green' && dv.note === '' && dv.bucket === 'send', dv);
t('describe: reason text for the badge title', dv.reason === 'عرض بيع', dv.reason);
// أرقام ‎0-9‎ و% كباقي /crm (الأعداد ونسب «دقة Jev»)، لا الأرقام الهندية
t('percent: ASCII digits and %, like the rest of /crm', percentText(0.925) === '93%' && percentText(1) === '100%' && percentText(0) === '0%'
    && percentText(1.4) === '100%' && percentText(null) === '' && percentText(NaN) === '', [percentText(0.925), percentText(1), percentText(0)]);
t('percent: no Arabic-Indic digits anywhere in the card line', !/[٠-٩٪]/.test(dv.footer), dv.footer);

const makkah = describe(result('r0', 'km', 'review', 'sale_offer', 0.88, { reasons: ['outside_jeddah'], city: { choice: 'makkah', confidence: 0.8 } }));
t('describe: review outside Jeddah → gold badge, city in line, reason as note',
    makkah.badge.text === 'يحتاج نظرك' && makkah.badge.tone === 'gold' && makkah.footer === 'Jev: عرض بيع 88% · شقة · مكة'
    && makkah.note === 'خارج جدة', makkah);
const notProp = describe(result('r0', 'kn', 'skip', 'not_property', 0.95, { kind: { choice: 'none', confidence: 0.9 }, city: { choice: 'not_stated', confidence: 0.9 } }));
t('describe: skip → neutral badge, «—» parts dropped, intent not repeated as note',
    notProp.badge.text === 'مستبعد' && notProp.badge.tone === 'neutral' && notProp.footer === 'Jev: ليس عرضاً 95%' && notProp.note === ''
    && notProp.reason === 'ليس عرضاً عقارياً', notProp);
const doc = describe(normalizeResult({ ref: 'r0', key: 'kd', ok: true, verdict: 'review', reasons: ['document_only'], intent: null, kind: null,
    city: null, district: null, multiple: null, owner_label: null }));
t('describe: document only (no Jev call) → reason is the line', doc.footer === 'Jev: ملف فقط — افتحه من الهاتف' && doc.note === '', doc);
const low = describe(result('r0', 'kl', 'review', 'sale_offer', null, { reasons: ['low_confidence'] }));
t('describe: missing confidence → no percent; low confidence note', low.footer === 'Jev: عرض بيع · شقة · جدة' && low.note === 'Jev غير متأكد', low);
const multi = describe(result('r0', 'kx', 'review', 'sale_offer', 0.9, { reasons: ['multiple'], district: { choice: 'حي الصفا', confidence: 0.6 } }));
t('describe: district already prefixed with «حي» is not doubled; multiple note',
    multi.footer === 'Jev: عرض بيع 90% · شقة · حي الصفا · جدة' && multi.note === 'عدة عقارات في رسالة واحدة', multi);
const fixed = describe(Object.assign({}, villa, { owner_label: 'not_property' }));
t('describe: owner correction shown and changes the badge', fixed.footer === 'Jev: عرض بيع 93% · فيلا · حي السامر · جدة — تصحيحك: ليس عرضاً'
    && fixed.badge.text === 'مستبعد' && fixed.reason === 'تصحيحك: ليس عرضاً' && fixed.note === '', fixed);
const none = describe(null);
t('describe: untriaged', none.badge.text === 'غير مفرز' && none.badge.tone === 'neutral' && none.footer === '' && none.bucket === 'untriaged');

/* ===================== التحديد المسبق وترتيب الإرسال ===================== */

// بترتيب القائمة (الأحدث أولاً)
const P = {
    a: item('a', 'عرض أ'), b: item('b', 'عرض ب'), c: item('c', 'عرض ج'), d: item('d', 'عرض د'),
    e: item('e', 'عرض هـ'), f: item('f', 'عرض و'), g: item('g', 'عرض ز'), h: item('h', 'عرض ح')
};
const R = new Map([
    ['a', result('r', 'ka', 'send', 'sale_offer', 0.80)],
    ['b', result('r', 'kb', 'send', 'sale_offer', 0.95)],
    ['c', result('r', 'kc', 'review', 'sale_offer', 0.99)],   // ليس «مقترحاً»
    ['d', result('r', 'kd', 'send', 'status_update', null)],   // ثقة غائبة: آخراً
    ['e', result('r', 'ke', 'send', 'sale_offer', 0.97)],      // أُرسل
    ['f', result('r', 'kf', 'send', 'sale_offer', 0.96)],      // ألغى المالك تحديده
    ['g', result('r', 'kg', 'send', 'sale_offer', 0.99)],      // محدد أصلاً
    ['h', result('r', 'kh', 'send', 'sale_offer', 0.80)]       // يعادل a، وa أحدث
]);
const list = Object.values(P);
const opts = (over) => Object.assign({
    resultOf: (it) => R.get(it.id) || null, isSent: (it) => it.id === 'e', selected: new Set(['g']),
    unticked: new Set([itemText(P.f)]), cap: 10, taken: 1
}, over);
t('preselect: send only, highest confidence first, null confidence last, ties → newest',
    preselect(list, opts()).join() === 'b,a,h,d', preselect(list, opts()));
t('preselect: capped at remaining quota minus what is already selected', preselect(list, opts({ cap: 3, taken: 1 })).join() === 'b,a',
    preselect(list, opts({ cap: 3, taken: 1 })));
t('preselect: manual untick respected', preselect(list, opts()).indexOf('f') === -1);
t('preselect: sent and already-selected excluded', preselect(list, opts()).indexOf('e') === -1 && preselect(list, opts()).indexOf('g') === -1);
t('preselect: no room → nothing', preselect(list, opts({ cap: 1, taken: 1 })).length === 0 && preselect(list, opts({ cap: null })).length === 0);

const chosen = [P.a, P.b, P.c, P.d];
t('send order: no preselected items → unchanged', sendOrder(chosen, { auto: new Set(), resultOf: (it) => R.get(it.id) }).map((i) => i.id).join() === 'a,b,c,d');
t('send order: owner picks first as listed, then Jev picks by confidence',
    sendOrder(chosen, { auto: new Set(['a', 'b', 'd']), resultOf: (it) => R.get(it.id) }).map((i) => i.id).join() === 'c,b,a,d',
    sendOrder(chosen, { auto: new Set(['a', 'b', 'd']), resultOf: (it) => R.get(it.id) }).map((i) => i.id));

// «اقتراح Jev أولاً»: المقترح بالثقة (a 0.80 وh 0.80 تعادلا فالأحدث a أولاً، وd بلا ثقة آخر المقترح)، ثم ما يحتاج النظر،
// ثم غير المفرز بترتيب القائمة، ثم المستبعد
const ordered = [P.a, P.b, P.c, P.d, P.h, item('u1', 'بلا حكم 1'), item('s1', 'مستبعد 1'), item('u2', 'بلا حكم 2')];
const R2 = new Map([...R, ['s1', result('r', 'ks', 'skip', 'other', 0.99)]]);
t('jev order: send by confidence, then review, then untriaged as listed, then skip',
    jevOrder(ordered, (it) => R2.get(it.id) || null).map((i) => i.id).join() === 'b,a,h,d,c,u1,u2,s1',
    jevOrder(ordered, (it) => R2.get(it.id) || null).map((i) => i.id));
t('jev order: the input list is not changed', ordered.map((i) => i.id).join() === 'a,b,c,d,h,u1,s1,u2');

/* ===================== سطر الحالة ===================== */

t('progress: nothing queued → empty', progressLine({ total: 0 }) === '');
t('progress: before the first batch', progressLine({ total: 30, sorted: 0, failed: 0, busy: true }) === 'جارٍ فرز 30 رسالة بـ Jev…');
t('progress: while sorting', progressLine({ total: 30, sorted: 25, failed: 0, busy: true }) === 'فُرز 25 من 30');
t('progress: done with failures', progressLine({ total: 30, sorted: 25, failed: 5, busy: false }) === 'فُرز 25 من 30 — تعذّر فرز 5');
t('progress: stopped by the server', progressLine({ total: 30, sorted: 0, failed: 30, busy: false, message: 'بلغ فرز Jev سقفه اليومي' })
    === 'فُرز 0 من 30 — بلغ فرز Jev سقفه اليومي');

/* ===================== جولة الفرز ===================== */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// نداء مزيّف: كل نداء ينتظر حتى يُحسم من الاختبار
function fakeCalls() {
    const calls = [];
    const call = (items) => new Promise((resolve) => calls.push({ items: items, resolve: resolve }));
    return { calls: calls, call: call };
}
const okReply = (items, verdict = 'send') => ({ ok: true, data: { status: 'success', items: items.map((p, i) =>
    raw(p.ref, 'key:' + p.text, verdict, 'sale_offer', 0.5 + (i % 5) / 10)) } });

{
    const fake = fakeCalls();
    const s = createStore();
    const batches = [];
    const runner = createRunner({ call: fake.call, store: s, onBatch: (info) => batches.push(info) });
    const items = Array.from({ length: 60 }, (_, i) => item('i' + i, 'رسالة رقم ' + i));
    t('runner: add reports the items queued', runner.add(items) === 60);
    t('runner: two invokes in flight, 25 items each', fake.calls.length === 2 && runner.inFlight() === 2
        && fake.calls[0].items.length === 25 && fake.calls[1].items.length === 25, fake.calls.map((c) => c.items.length));
    t('runner: busy before any reply', runner.progress().busy && progressLine(runner.progress()) === 'جارٍ فرز 60 رسالة بـ Jev…');
    t('runner: re-adding queued items sends nothing new', runner.add(items) === 0 && fake.calls.length === 2);
    fake.calls[0].resolve(okReply(fake.calls[0].items));
    await tick();
    t('runner: third batch (10) starts when a slot frees', fake.calls.length === 3 && fake.calls[2].items.length === 10 && runner.inFlight() === 2);
    t('runner: one onBatch per batch, results mapped by ref', batches.length === 1 && batches[0].results.length === 25
        && batches[0].results.every((r) => r.result && r.result.key === 'key:' + r.entry.text));
    t('runner: progress after one batch', progressLine(runner.progress()) === 'فُرز 25 من 60');
    fake.calls[1].resolve(okReply(fake.calls[1].items));
    fake.calls[2].resolve(okReply(fake.calls[2].items));
    await tick();
    t('runner: all results stored and found by item', items.every((it) => resultFor(s, it) && resultFor(s, it).key === 'key:' + it.main.block.text));
    t('runner: idle and complete', !runner.progress().busy && runner.progress().sorted === 60 && batches.length === 3);
    t('runner: items with results are not sent again', runner.add(items) === 0 && fake.calls.length === 3);
}

{
    // تحميل جديد أثناء نداء: رد الجولة القديمة يُهمل حتى لو حمل ref يطابق بنداً في الجولة الجديدة
    const fake = fakeCalls();
    const s = createStore();
    let applied = 0;
    const runner = createRunner({ call: fake.call, store: s, onBatch: () => { applied += 1; } });
    const oldItem = item('i0', 'رسالة الجولة الأولى');
    runner.add([oldItem]);
    runner.reset();
    const newItem = item('i0', 'رسالة الجولة الثانية');
    runner.add([newItem]);
    t('stale: new round starts while the old call is still in flight (2 slots)', fake.calls.length === 2
        && fake.calls[0].items[0].ref === fake.calls[1].items[0].ref);
    fake.calls[0].resolve({ ok: true, data: { status: 'success', items: [raw(fake.calls[0].items[0].ref, 'k-old', 'send', 'sale_offer', 0.9)] } });
    await tick();
    t('stale: old reply dropped — no result stored, no redraw', applied === 0 && s.byKey.size === 0 && resultFor(s, newItem) === null
        && resultFor(s, oldItem) === null);
    t('stale: new round still busy', runner.progress().busy && runner.progress().sorted === 0);
    fake.calls[1].resolve({ ok: true, data: { status: 'success', items: [raw(fake.calls[1].items[0].ref, 'k-new', 'skip', 'not_property', 0.9)] } });
    await tick();
    t('stale: current reply applied', applied === 1 && resultFor(s, newItem) && resultFor(s, newItem).key === 'k-new');
}

{
    // ما بقي في الطريق من جولة سابقة يُحسب في حد النداءين
    const fake = fakeCalls();
    const runner = createRunner({ call: fake.call, store: createStore(), inFlight: 1 });
    runner.add([item('a', 'نص قديم')]);
    runner.reset();
    runner.add([item('a', 'نص جديد')]);
    t('stale: in-flight limit counts the old round', fake.calls.length === 1);
    fake.calls[0].resolve({ ok: false, message: null });
    await tick();
    t('stale: queued batch of the new round starts after the old one settles', fake.calls.length === 2 && fake.calls[1].items[0].text === 'نص جديد');
}

{
    // الوظيفة تقول «متوقف» أو بلغ السقف: لا نداء بعده في هذه الجولة
    const fake = fakeCalls();
    const runner = createRunner({ call: fake.call, store: createStore() });
    runner.add(Array.from({ length: 80 }, (_, i) => item('i' + i, 'نص ' + i)));
    fake.calls[0].resolve({ ok: false, skipped: true, message: 'بلغ فرز Jev سقفه اليومي' });
    await tick();
    const p = runner.progress();
    t('skipped: queue dropped, message kept', fake.calls.length === 2 && p.stopped && p.message === 'بلغ فرز Jev سقفه اليومي' && p.failed === 55, p);
    fake.calls[1].resolve({ ok: true, data: { status: 'success', items: [] } });
    await tick();
    t('skipped: nothing else is sent', fake.calls.length === 2 && !runner.progress().busy);
}

{
    // الوظيفة معطلة: نداءان فاشلان متتاليان يوقفان الجولة
    const fake = fakeCalls();
    const batches = [];
    const runner = createRunner({ call: fake.call, store: createStore(), onBatch: (info) => batches.push(info) });
    runner.add(Array.from({ length: 100 }, (_, i) => item('i' + i, 'نص ' + i)));
    const down = { ok: false, error: new Error('boom'), message: null };
    fake.calls[0].resolve(down);
    fake.calls[1].resolve(down);
    await tick();
    // الفشل الأول حرّر مكاناً قبل وصول الثاني فبدأت دفعة ثالثة؛ الثاني أوقف الجولة وأسقط الرابعة
    const p = runner.progress();
    t('errors: two failures in a row stop the round and drop the queue', fake.calls.length === 3 && p.stopped && p.failed === 75 && p.busy, p);
    fake.calls[2].resolve(down);
    await tick();
    const end = runner.progress();
    t('errors: nothing more is sent', fake.calls.length === 3 && end.failed === 100 && !end.busy, end);
    t('errors: each failed batch reported once', batches.length === 3 && batches.every((b) => b.failed));
    t('errors: status line', progressLine(end) === 'فُرز 0 من 100 — تعذّر فرز 100', progressLine(end));
}

{
    // بعد توقف بخطأين متتاليين، إعادة الإضافة (توسيع «منذ»): عدّاد الأخطاء من الصفر، وما أُعيد يُعدّ مرة واحدة
    const fake = fakeCalls();
    const runner = createRunner({ call: fake.call, store: createStore() });
    const items = Array.from({ length: 50 }, (_, i) => item('i' + i, 'نص متعثر ' + i));
    runner.add(items);
    const down = { ok: false, error: new Error('boom'), message: null };
    fake.calls[0].resolve(down);
    fake.calls[1].resolve(down);
    await tick();
    const first = runner.progress();
    t('error stop, re-add: the first run stopped', first.stopped && first.failed === 50 && first.total === 50 && !first.busy, first);
    const more = items.concat([item('n1', 'نص جديد 1'), item('n2', 'نص جديد 2'), item('n3', 'نص جديد 3')]);
    t('error stop, re-add: the 50 failed and 3 new are queued', runner.add(more) === 53 && fake.calls.length === 4, fake.calls.length);
    const p = runner.progress();
    t('error stop, re-add: counted once — total 53, nothing failed yet', p.total === 53 && p.failed === 0 && p.sorted === 0 && !p.stopped
        && p.message === null && p.busy, p);
    fake.calls[2].resolve(down);
    await tick();
    const q = runner.progress();
    t('error stop, re-add: one failure does not stop the resumed run', !q.stopped && fake.calls.length === 5 && q.failed === 25 && q.busy, q);
    for (const c of fake.calls.slice(3)) c.resolve(okReply(c.items));
    await tick();
    const r = runner.progress();
    t('error stop, re-add: status line', !r.busy && progressLine(r) === 'فُرز 28 من 53 — تعذّر فرز 25', progressLine(r));
}

{
    // بعد توقف «بلغ السقف» (skipped): إعادة الإضافة تستأنف، وما تعذّر قبلُ لا يُعدّ مرتين
    const fake = fakeCalls();
    const s = createStore();
    const runner = createRunner({ call: fake.call, store: s });
    const items = Array.from({ length: 30 }, (_, i) => item('i' + i, 'نص موقوف ' + i));
    runner.add(items);
    fake.calls[0].resolve({ ok: false, skipped: true, message: 'بلغ فرز Jev سقفه اليومي' });
    await tick();
    fake.calls[1].resolve(okReply(fake.calls[1].items));
    await tick();
    const p = runner.progress();
    t('skipped stop, re-add: before', p.stopped && p.message === 'بلغ فرز Jev سقفه اليومي' && p.failed === 25 && p.sorted === 5 && p.total === 30
        && progressLine(p) === 'فُرز 5 من 30 — بلغ فرز Jev سقفه اليومي', p);
    const again = runner.add(items);   // الخمسة المفروزة لها نتائج فلا تُرسل
    const q = runner.progress();
    t('skipped stop, re-add: only the 25 unsorted are sent, counted once', again === 25 && fake.calls.length === 3 && q.total === 30
        && q.failed === 0 && q.sorted === 5 && !q.stopped && q.message === null && q.busy, q);
    t('skipped stop, re-add: status line', progressLine(q) === 'فُرز 5 من 30', progressLine(q));
    fake.calls[2].resolve({ ok: false, skipped: true, message: 'بلغ فرز Jev سقفه اليومي' });
    await tick();
    const r = runner.progress();
    t('skipped stop, re-add: skipped again → stopped with the message, still counted once', r.stopped && r.total === 30 && r.failed === 25
        && progressLine(r) === 'فُرز 5 من 30 — بلغ فرز Jev سقفه اليومي', r);
}

{
    // النص نفسه في عنصر جديد بعد أن تعذّر فرزه: العناصر تُعدّ مرة واحدة (الجديد يُزاد، القديم لا يتكرر)
    const fake = fakeCalls();
    const runner = createRunner({ call: fake.call, store: createStore() });
    const x = item('x', 'نص مكرر في مجموعتين', { kind: 'other' });
    runner.add([x]);
    fake.calls[0].resolve({ ok: false, message: null });
    await tick();
    const twin = item('y', 'نص مكرر في مجموعتين', { kind: 'other', group: 'مجموعة ب' });
    t('failed text re-added with a new copy: both items queued', runner.add([x, twin]) === 2 && runner.progress().total === 2
        && runner.progress().failed === 0, runner.progress());
    fake.calls[1].resolve(okReply(fake.calls[1].items));
    await tick();
    t('failed text re-added with a new copy: «فُرز 2 من 2»', progressLine(runner.progress()) === 'فُرز 2 من 2', runner.progress());
}

{
    // رد ناقص: البند الذي لا رد له أو ok:false (deadline) يبقى غير مفرز
    const fake = fakeCalls();
    const s = createStore();
    const runner = createRunner({ call: fake.call, store: s });
    const a = item('a', 'نص له رد'), b = item('b', 'نص انتهت مهلته');
    runner.add([a, b]);
    const [ra, rb] = fake.calls[0].items.map((p) => p.ref);
    fake.calls[0].resolve({ ok: true, data: { status: 'success', items: [raw(ra, 'ka', 'send', 'sale_offer', 0.9), { ref: rb, ok: false, error: 'deadline' }] } });
    await tick();
    t('partial: ok item stored, deadline item untriaged', resultFor(s, a) && resultFor(s, b) === null
        && runner.progress().sorted === 1 && runner.progress().failed === 1);
}

{
    const fake = fakeCalls();
    const runner = createRunner({ call: fake.call, store: createStore(), alive: () => false });
    runner.add([item('a', 'نص')]);
    t('closed page: no invoke at all', fake.calls.length === 0);
}

/* ===================== نداء الوظيفة بعميل مزيّف ===================== */

function client(handler) {
    const seen = [];
    return { seen: seen, functions: { invoke: (name, options) => { seen.push({ name: name, body: options.body }); return handler(options.body); } } };
}

{
    const c = client(() => Promise.resolve({ data: { status: 'success', items: [] }, error: null }));
    const out = await triageBatch(c, [{ ref: 'r0', text: 'نص' }]);
    t('invoke: success → ok, function wa-triage, action triage with items', out.ok && c.seen[0].name === 'wa-triage'
        && c.seen[0].body.action === 'triage' && c.seen[0].body.items[0].ref === 'r0', c.seen);
}
{
    const httpError = { message: 'Edge Function returned a non-2xx status code',
        context: { clone() { return this; }, json: () => Promise.resolve({ status: 'error', message: 'غير موجود' }) } };
    const c = client(() => Promise.resolve({ data: null, error: httpError }));
    const out = await labelTriage(c, 'k1', 'sale_offer');
    t('invoke: label body', c.seen[0].body.action === 'label' && c.seen[0].body.key === 'k1' && c.seen[0].body.label === 'sale_offer');
    t('invoke: HTTP error → ok:false with the function\'s Arabic message', !out.ok && out.message === 'غير موجود' && out.error === httpError, out);
    t('invoke: outError carries that message', outError(out).message === 'غير موجود');
}
{
    const c = client(() => Promise.resolve({ data: null, error: new Error('Failed to fetch') }));
    const out = await invokeTriage(c, { action: 'triage', items: [] });
    t('invoke: network error → ok:false, generic Arabic text', !out.ok && out.message === null
        && outError(out).message === 'تعذّر الوصول إلى خدمة الفرز');
}
{
    const c = client(() => new Promise(() => {}));   // لا يرد أبداً
    const started = Date.now();
    const out = await invokeTriage(c, { action: 'status' }, 30);
    t('invoke: timeout → ok:false timedOut, within the deadline', !out.ok && out.timedOut === true && Date.now() - started < 1000, out);
    t('invoke: timeout text', outError(out).message === 'انتهت مهلة خدمة الفرز');
}
{
    const thrower = { functions: { invoke: () => { throw new Error('sync boom'); } } };
    const rejecter = client(() => Promise.reject(new Error('async boom')));
    const a = await invokeTriage(thrower, { action: 'status' });
    const b = await invokeTriage(rejecter, { action: 'status' });
    const c = await invokeTriage(null, { action: 'status' });
    t('invoke: never throws (sync throw, rejection, no client)', !a.ok && !b.ok && !c.ok);
}
{
    const c = client(() => Promise.resolve({ data: { status: 'skipped', message: 'فرز Jev متوقف' }, error: null }));
    const out = await triageBatch(c, []);
    t('invoke: skipped reply', !out.ok && out.skipped === true && out.message === 'فرز Jev متوقف', out);
    const e = client(() => Promise.resolve({ data: { status: 'error', message: 'عدد العناصر غير صالح' }, error: null }));
    const bad = await triageBatch(e, []);
    t('invoke: error status with message', !bad.ok && !bad.skipped && bad.message === 'عدد العناصر غير صالح');
}
{
    const on = await triageStatus(client(() => Promise.resolve({ data: { status: 'success', enabled: true, mode: 'preselect', model: 'm', message: null }, error: null })));
    t('status: enabled preselect', on.reachable && on.enabled && on.mode === 'preselect' && on.message === null, on);
    const off = await triageStatus(client(() => Promise.resolve({ data: { status: 'success', enabled: false, mode: 'off', message: 'فرز Jev متوقف' }, error: null })));
    t('status: disabled with message', off.reachable && !off.enabled && off.mode === 'off' && off.message === 'فرز Jev متوقف', off);
    const old = await triageStatus(client(() => Promise.resolve({ data: { status: 'success', enabled: true }, error: null })));
    t('status: missing mode → suggest', old.mode === 'suggest');
    const down = await triageStatus(client(() => Promise.resolve({ data: null, error: new Error('404') })));
    t('status: unreachable → page as today', !down.reachable && !down.enabled, down);
    const late = await triageStatus(client(() => new Promise(() => {})), 20);
    t('status: timeout → unreachable', !late.reachable);
}

/* ===================== «دقة Jev» ===================== */

const report = {
    ok: true, days: 30, since: '2026-09-02T00:00:00Z',
    cost: { today_usd: 0.0021, window_usd: 0.015, today_jev_calls: 50, window_jev_calls: 357 },
    qsets: { 'wa-1': {
        total: 309, sent: 12,
        // ترتيب jsonb للمفاتيح لا يُعتمد عليه
        verdicts: { skip: { count: 169, sent: 0 }, send: { count: 40, sent: 10 }, review: { count: 100, sent: 2 } },
        confidence: [{ band: '>=0.9', count: 150, sent: 9 }, { band: '0.75-0.9', count: 60, sent: 2 },
            { band: '0.5-0.75', count: 40, sent: 1 }, { band: '<0.5', count: 30, sent: 0 }],
        corrections: { count: 12, agree: 9 },
        regex_kind: { other: { send: { count: 3, sent: 1 }, review: { count: 5, sent: 0 }, skip: { count: 90, sent: 0 } },
            offer: { send: { count: 30, sent: 9 }, review: { count: 50, sent: 2 }, skip: { count: 20, sent: 0 } } }
    } }
};
const view = reportView(report, { offer: 'عرض', other: 'رسالة أخرى' });
const byTitle = (part) => view.tables.find((tb) => tb.title.indexOf(part) !== -1);
t('report: five tables, no error', !view.error && !view.empty && view.tables.length === 5, view.tables.map((tb) => tb.title));
t('report: cost in dollars with Jev calls', JSON.stringify(byTitle('تكلفة').rows) === JSON.stringify([['اليوم', '$0.0021', '50'], ['آخر 30 يوماً', '$0.015', '357']]),
    byTitle('تكلفة').rows);
const verdictRows = byTitle('أحكام Jev').rows;
t('report: verdicts in send/review/skip order with sent and rate', verdictRows.map((r) => r[0]).join('|') === 'مقترح للإرسال|يحتاج نظرك|مستبعد'
    && verdictRows[0].join('|') === 'مقترح للإرسال|40|10|25%' && byTitle('أحكام Jev').title.indexOf('309 رسالة') !== -1, verdictRows);
t('report: confidence bands kept in order with readable labels', byTitle('ثقة').rows.map((r) => r[0]).join('|')
    === '90% فأكثر|من 75% إلى أقل من 90%|من 50% إلى أقل من 75%|أقل من 50%', byTitle('ثقة').rows);
t('report: corrections agreement', byTitle('تصحيحاتك').rows[0].join('|') === '12|9|75%', byTitle('تصحيحاتك').rows);
const matrix = byTitle('تصنيف القارئ');
t('report: regex kind × verdict matrix, parser order, sent in brackets', matrix.rows.map((r) => r[0]).join('|') === 'عرض|رسالة أخرى'
    && matrix.rows[0].join('|') === 'عرض|30 (9)|50 (2)|20 (0)', matrix.rows);
t('report: forbidden', reportView({ ok: false, code: 'forbidden' }).error === 'تقرير Jev للمدير وحده');
t('report: unexpected reply', reportView(null).error !== null && reportView('x').tables.length === 0);
const emptyView = reportView({ ok: true, days: 30, cost: { today_usd: 0, window_usd: 0, today_jev_calls: 0, window_jev_calls: 0 }, qsets: {} });
t('report: no rows in the window → empty with cost only', emptyView.empty && emptyView.tables.length === 1 && emptyView.tables[0].rows[0][1] === '$0',
    emptyView);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
