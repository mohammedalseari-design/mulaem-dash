// اختبار اختيار المسودات المكررة بوضوح لزر «ارفض المكررات» في طابور الاعتماد (crm/js/dupes.js).
// التشغيل: node tests/approvals-dupes.test.mjs   أو   deno run tests/approvals-dupes.test.mjs
import { REJECTABLE, clearDuplicates, projectRefs } from '../crm/js/dupes.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// مرشّح مشروع كما يكتبه agent_find_duplicates، وسطر توأم كما يكتبه twinEntry في agent-run
const project = (id, rank, status = 'approved', name = 'جوهرة الصفا', district = 'الصفا') =>
    ({ kind: 'project', id, name, district, type: 'شقة', status, units: 0, reason: 'الاسم مطابق بعد التطبيع', rank });
const twin = (draftId, reason = 'الاسم نفسه') => ({ kind: 'draft', id: 'req-' + draftId, draft_id: draftId, name: 'فيلا السامر', reason });
// المسودة كما يقرؤها فحص الطابور: اسمها وحيّها ومدينتها الآن من المقترح، وتعارضاتها ومكرّراتها
const draft = (id, duplicates, extra = {}) => ({
    id, request_id: 'req-' + id, status: 'submitted', target_kind: 'project', target_id: null, content_hash: 'h-' + id,
    name: 'جوهرة الصفا', district: 'الصفا', city: 'جدة', conflicts: [], duplicates, ...extra
});
const reasons = (list) => list.map((c) => c.draft.id + ': ' + c.reason);
const SAFA = 'يطابق المشروع #54 «جوهرة الصفا» (الصفا)';

t('only «بانتظار الاعتماد» is rejectable', REJECTABLE === 'submitted');

// (أ) مشروع قائم بالاسم نفسه (الرتبة 1)
const rank1 = draft('a', [project('54', '1')]);
let out = clearDuplicates([rank1], new Map());
t('rank-1 existing project → listed', out.length === 1 && out[0].draft === rank1, reasons(out));
t('rank-1 reason names the project and its district', out[0]?.reason === SAFA, out[0]?.reason);
t('rank-1 project still awaiting approval (pending) → listed', clearDuplicates([draft('a', [project('54', '1', 'pending')])], new Map()).length === 1);
t('rank 1 as a number → listed', clearDuplicates([draft('a', [project('54', 1)])], new Map()).length === 1);
for (const rank of ['2', '3', '4']) {
    t('rank-' + rank + ' match → not listed', clearDuplicates([draft('a', [project('54', rank)])], new Map()).length === 0);
}
t('rank-1 project that was rejected → not listed', clearDuplicates([draft('a', [project('54', '1', 'rejected')])], new Map()).length === 0);
t('rejected rank-1 skipped, the next standing rank-1 is used',
    clearDuplicates([draft('a', [project('54', '1', 'rejected'), project('77', '1', 'approved', 'مشروع جوهرة الصفا')])], new Map())[0]?.reason
    === 'يطابق المشروع #77 «مشروع جوهرة الصفا» (الصفا)');

// (أ) الاسم الآن لا كما سُجّل: الحارس يُبقي المكرّرات كما هي بعد تعديل المسودة
t('draft renamed since the check (no longer the project’s name) → not listed',
    clearDuplicates([draft('a', [project('54', '1')], { name: 'لؤلؤة الصفا' })], new Map()).length === 0);
for (const name of ['مشروع جوهره الصفا', 'جَوهرة  الصفـا', 'جوهرة الصفا.', 'جوهرة الصفا']) {
    t('same name after agent_norm_name («' + name + '») → listed', clearDuplicates([draft('a', [project('54', '1')], { name })], new Map()).length === 1);
}
for (const name of [null, undefined, '', '  ', 'مشروع']) {
    t('draft without a name (' + JSON.stringify(name) + ') → not listed', clearDuplicates([draft('a', [project('54', '1')], { name })], new Map()).length === 0);
}
// عنوان إعلان بقي اسماً (بلا حيّ ولا مدينة): مطابقته لمشروع بالعنوان نفسه ليست تكراراً
for (const name of ['فيلا للبيع', 'شقة للإيجار', 'أرض للتأجير شمال جدة']) {
    t('advert headline kept as the name («' + name + '») → not listed',
        clearDuplicates([draft('h', [project('9', '1', 'approved', name, null)], { name, district: null, city: null })], new Map()).length === 0);
}

// (أ) كلمة عامة قبل رقم جزء من الاسم كما في agent-run (sameNameProjects): «برج 12» غير «مجمع 12» وإن طبّعهما agent_norm_name «12»
const n12 = (name, draftName, district = 'النرجس') => clearDuplicates([draft('n', [project('80', '1', 'approved', name, district)], { name: draftName, district })], new Map()).length;
t('«برج 12» vs existing «مجمع 12» → not listed', n12('مجمع 12', 'برج 12') === 0);
t('«12» vs existing «مجمع 12» → not listed', n12('مجمع 12', '12') === 0);
t('«برج 12» vs existing «برج ١٢» → listed', n12('برج ١٢', 'برج 12') === 1);
t('«أبراج 7» vs existing «ابراج 7» → listed', n12('ابراج 7', 'أبراج 7') === 1);
t('«مشروع جوهرة الصفا» vs existing «جوهرة الصفا» still listed (no number after the word)',
    clearDuplicates([draft('a', [project('54', '1')], { name: 'مشروع جوهرة الصفا' })], new Map()).length === 1);

// (أ) الحي: حيٌّ يناقض حيّ المسودة يسقط المرشّح، والفارغ في أي جهة لا يمنع
t('same name in another district → not listed', clearDuplicates([draft('a', [project('54', '1')], { district: 'السامر' })], new Map()).length === 0);
t('draft without a district → listed', clearDuplicates([draft('a', [project('54', '1')], { district: null })], new Map()).length === 1);
out = clearDuplicates([draft('a', [project('54', '1', 'approved', 'جوهرة الصفا', null)])], new Map());
t('project without a district → listed, reason without one', out[0]?.reason === 'يطابق المشروع #54 «جوهرة الصفا»', out[0]?.reason);
for (const district of ['حي الصفا', 'الحي: الصفا', 'صفا', ' الصفا ']) {
    t('district «' + district + '» = «الصفا» → listed', clearDuplicates([draft('a', [project('54', '1')], { district })], new Map()).length === 1);
}
t('district not reconciled («حي الصفا، جدة») → not listed (left to the request page)',
    clearDuplicates([draft('a', [project('54', '1')], { district: 'حي الصفا، جدة' })], new Map()).length === 0);
t('a rank-1 in another district is skipped, the one in the draft’s district is used',
    clearDuplicates([draft('a', [project('54', '1'), project('90', '1', 'approved', 'جوهرة الصفا', 'السامر')], { district: 'السامر' })], new Map())[0]?.reason
    === 'يطابق المشروع #90 «جوهرة الصفا» (السامر)');

// مقدّم الطلب اختار «أنشئه مشروعاً جديداً رغم تطابق الاسم» (forced_new): لا يُحكم من الاسم بتكراره
const forcedNote = { field: 'name', note: 'أُنشئت مسودة مشروع جديد رغم أن اسمه يطابق «جوهرة الصفا» (#54، الصفا)، باختيار مقدّم الطلب', code: 'forced_new' };
t('forced_new draft with a rank-1 match → not listed', clearDuplicates([draft('f', [project('54', '1')], { conflicts: [forcedNote] })], new Map()).length === 0);
t('other notes on the draft do not block',
    clearDuplicates([draft('f', [project('54', '1')], { conflicts: [null, { code: 'name_suggested' }, { code: 'district_from_name' }] })], new Map()).length === 1);
t('conflicts missing or not a list → listed',
    clearDuplicates([draft('f', [project('54', '1')], { conflicts: undefined }), draft('g', [project('54', '1')], { conflicts: { code: 'forced_new' } })], new Map()).length === 2);

// (ب) توأم طُبّق وصار مشروعاً
const twins = new Map([
    ['t-applied', { id: 't-applied', status: 'applied', applied_record: '321' }],
    ['t-pending', { id: 't-pending', status: 'submitted', applied_record: null }],
    ['t-draft', { id: 't-draft', status: 'draft', applied_record: null }],
    ['t-returned', { id: 't-returned', status: 'returned', applied_record: null }],
    ['t-rejected', { id: 't-rejected', status: 'rejected', applied_record: null }],
    ['t-no-record', { id: 't-no-record', status: 'applied', applied_record: null }],
    ['t-stale', { id: 't-stale', status: 'stale', applied_record: '999' }]
]);
const applied = draft('b', [twin('t-applied')]);
out = clearDuplicates([applied], twins);
t('applied twin → listed with its applied_record', out.length === 1 && out[0].reason === 'مسودة مطابقة طُبّقت كمشروع رقم 321', reasons(out));
for (const id of ['t-pending', 't-draft', 't-returned']) {
    t('pending twin (' + twins.get(id).status + ') → not listed', clearDuplicates([draft('b', [twin(id)])], twins).length === 0);
}
t('rejected twin → not listed', clearDuplicates([draft('b', [twin('t-rejected')])], twins).length === 0);
t('twin gone from the lookup (deleted) → not listed', clearDuplicates([draft('b', [twin('t-gone')])], twins).length === 0);
t('applied twin without a record → not listed', clearDuplicates([draft('b', [twin('t-no-record')])], twins).length === 0);
t('only «applied» counts, even with a record on the twin', clearDuplicates([draft('b', [twin('t-stale')])], twins).length === 0);
t('a pending twin does not hide an applied one', clearDuplicates([draft('b', [twin('t-pending'), twin('t-applied')])], twins).length === 1);
t('twin statuses unreadable (null) → no twin verdicts, rank-1 still listed',
    JSON.stringify(reasons(clearDuplicates([applied, rank1], null))) === JSON.stringify(['a: ' + SAFA]));
t('draft line without draft_id is not a twin', clearDuplicates([draft('b', [{ kind: 'draft', id: 'req-x' }])], twins).length === 0);
t('rank-1 and applied twin together → one entry, the project reason',
    JSON.stringify(reasons(clearDuplicates([draft('c', [twin('t-applied'), project('54', '1')])], twins)))
    === JSON.stringify(['c: ' + SAFA]));
// الربط بالحي والنوع ورقمٍ واحد (twinReason) يجمع فيلّتين مختلفتين على قطعة 300م: لا يُرفض به
for (const reason of ['الحي والنوع نفساهما والمساحة', 'الحي والنوع نفساهما والسعر', 'الحي نفسه والسعر والمساحة', null]) {
    t('applied twin linked by «' + reason + '» → not listed', clearDuplicates([draft('b', [twin('t-applied', reason)])], twins).length === 0);
}
t('applied twin line without a reason → not listed',
    clearDuplicates([draft('b', [{ kind: 'draft', id: 'req-t-applied', draft_id: 't-applied', name: 'فيلا السامر' }])], twins).length === 0);
t('a fuzzy applied twin does not hide a same-name one',
    clearDuplicates([draft('b', [twin('t-applied', 'الحي والنوع نفساهما والمساحة'), twin('t-applied')])], twins).length === 1);
t('forced_new draft with an applied same-name twin → not listed',
    clearDuplicates([draft('b', [twin('t-applied')], { conflicts: [forcedNote] })], twins).length === 0);

// المسودة نفسها: حالة يقبل منها الرفض، ومشروع جديد لا تعديل
for (const status of ['draft', 'returned', 'rejected', 'applied', 'approved', 'stale']) {
    t('draft in status ' + status + ' → not listed',
        clearDuplicates([draft('d', [project('54', '1'), twin('t-applied')], { status })], twins).length === 0);
}
t('update of an existing project (target_id set) → not listed',
    clearDuplicates([draft('e', [project('54', '1'), twin('t-applied')], { target_id: '54' })], twins).length === 0);
t('unit draft → not listed', clearDuplicates([draft('e', [project('54', '1')], { target_kind: 'unit' })], twins).length === 0);
t('client draft → not listed', clearDuplicates([draft('e', [{ kind: 'client', id: 'c1', rank: '1' }], { target_kind: 'client' })], twins).length === 0);

// ما تلف لا يُسقط شيئاً
t('missing, null or non-list duplicates → not listed, no throw',
    clearDuplicates([draft('f', null), draft('g', undefined), draft('h', { kind: 'project', id: '54', rank: '1' }), draft('i', [null, 'x', 3])], twins).length === 0);
t('non-list drafts → empty', clearDuplicates(null, twins).length === 0 && clearDuplicates(undefined, null).length === 0);
t('rank-1 without an id → not listed', clearDuplicates([draft('j', [{ kind: 'project', rank: '1', name: 'جوهرة الصفا' }])], twins).length === 0);
t('order follows the input',
    JSON.stringify(clearDuplicates([draft('z', [project('1', '1')]), draft('m', [twin('t-applied')]), draft('n', [project('2', '2')]), draft('a2', [project('3', '1')])], twins)
        .map((c) => c.draft.id)) === JSON.stringify(['z', 'm', 'a2']));

// حالة المشاريع الآن (اختيارية): المحذوف أو الغائب أو المرفوض بعد تسجيل المرشّح لا يُرفض المكرر لأجله
const live = new Map([
    ['54', { id: 54, status: 'approved', deleted_at: null }],
    ['55', { id: 55, status: 'approved', deleted_at: '2026-09-30T10:00:00' }],
    ['56', { id: 56, status: 'rejected', deleted_at: null }],
    ['57', { id: 57, status: 'approved', deleted_at: null }],
    ['321', { id: 321, status: 'approved', deleted_at: null }]
]);
t('live: standing project → listed', clearDuplicates([draft('k', [project('54', '1')])], twins, live).length === 1);
t('live: project deleted since → not listed', clearDuplicates([draft('k', [project('55', '1')])], twins, live).length === 0);
t('live: project rejected since → not listed', clearDuplicates([draft('k', [project('56', '1')])], twins, live).length === 0);
t('live: project gone (hard delete) → not listed', clearDuplicates([draft('k', [project('99', '1')])], twins, live).length === 0);
t('live: recorded as rejected but standing now → listed', clearDuplicates([draft('k', [project('57', '1', 'rejected')])], twins, live).length === 1);
t('live: applied twin whose project stands → listed', clearDuplicates([applied], twins, live).length === 1);
t('live: applied twin whose project is gone → not listed', clearDuplicates([applied], twins, new Map()).length === 0);
t('live: applied twin whose project was deleted → not listed',
    clearDuplicates([applied], twins, new Map([['321', { id: 321, status: 'approved', deleted_at: '2026-09-30T10:00:00' }]])).length === 0);

// حالات المراجعة معاً، بالبيانات كما تكتبها agent-run: لا تُرفض واحدة منها جماعياً
const review = [
    draft('forced', [project('54', '1')], { conflicts: [forcedNote] }),
    draft('otherDistrict', [project('54', '1')], { district: 'السامر' }),
    draft('renamed', [project('54', '1')], { name: 'لؤلؤة المروة', district: 'المروة' }),
    draft('weakTwin', [twin('t-applied', 'الحي والنوع نفساهما والمساحة')], { name: 'فيلا – حي السامر – 300م', district: 'السامر' })
];
t('review scenarios (forced, other district, renamed, weak twin) → none listed', clearDuplicates(review, twins, live).length === 0, reasons(clearDuplicates(review, twins, live)));

// المعرّفات التي تُقرأ حالتها: الرتبة 1 ومشاريع التوائم المطبَّقة لمسودات يقبل الرفض حالتها، أرقاماً بلا تكرار
const refs = projectRefs([
    draft('p', [project('54', '1'), project('60', '2'), twin('t-applied'), twin('t-pending')]),
    draft('q', [project('54', '1'), project('abc', '1')]),
    draft('r', [project('70', '1')], { status: 'returned' }),
    draft('s', [project('71', '1')], { target_id: '71' }),
    draft('u', [project('72', '1')], { conflicts: [forcedNote] })
], twins);
t('projectRefs: rank-1 and applied-twin ids of eligible drafts, numeric, once', JSON.stringify(refs) === JSON.stringify(['54', '321']), refs);
t('projectRefs: twin statuses unreadable → rank-1 only', JSON.stringify(projectRefs([draft('p', [project('54', '1'), twin('t-applied')])], null)) === JSON.stringify(['54']));
t('projectRefs: nothing → empty', projectRefs(null, null).length === 0);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
