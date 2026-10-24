// اختبار طابور المراجعة في #/approvals (crm/js/review.js): عمر الانتظار، وقوة مطابقة المشروع القائم، والحقول الناقصة.
// التشغيل: node tests/approvals-review.test.mjs   أو   deno run tests/approvals-review.test.mjs
import { LATE_DAYS, waitDays, waitText, isLate, strongMatches, weakMatches, fillableFields, parseFill, matchedProjects } from '../crm/js/review.js';

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

const DAY = 86400000;
const now = Date.parse('2026-10-24T12:00:00Z');
const ago = (days) => new Date(now - days * DAY).toISOString();

t('waitDays: 9.3 days → 9', waitDays(ago(9.3), now) === 9);
t('waitDays: 3 hours → 0', waitDays(ago(0.125), now) === 0);
t('waitDays: future (device clock behind) → 0', waitDays(ago(-1), now) === 0);
t('waitDays: missing or bad date → null', waitDays(null, now) === null && waitDays('not a date', now) === null);
t('waitText forms', [0, 1, 2, 3, 10, 11, 27].map(waitText).join('|') === 'أقل من يوم|يوم|يومان|3 أيام|10 أيام|11 يوماً|27 يوماً',
  [0, 1, 2, 3, 10, 11, 27].map(waitText));
t('waitText: unknown → dash', waitText(null) === '—');
t('isLate from LATE_DAYS on', LATE_DAYS === 2 && !isLate(1) && isLate(2) && isLate(27) && !isLate(null));

const p = (id, rank) => ({ kind: 'project', id, name: 'م ' + id, rank });
const dups = [p('1', '1'), p('2', '2'), p('3', '3'), p('4', '4'), { kind: 'draft', id: 'req', draft_id: 'd' }, p('5', undefined), null, { kind: 'project' }];
t('strongMatches: ranks 1, 2 and legacy (no rank)', strongMatches(dups).map((d) => d.id).join() === '1,2,5', strongMatches(dups));
t('weakMatches: ranks 3 and 4 only', weakMatches(dups).map((d) => d.id).join() === '3,4', weakMatches(dups));
t('strongMatches: numeric rank too', strongMatches([p('9', 1), p('8', 4)]).map((d) => d.id).join() === '9');
t('matches: not an array → empty', strongMatches(null).length === 0 && weakMatches('x').length === 0);

const draft = (proposed, extra = {}) => ({ target_kind: 'project', target_id: null, proposed, ...extra });
t('fillableFields: missing and blank keys of a new project',
  fillableFields(draft({ name: 'س', price: null, district: '  ', type: 'شقة', purpose: 'sale', availability: 'available' })).join() === 'price,area,rooms,delivery_date,district',
  fillableFields(draft({ name: 'س', price: null, district: '  ', type: 'شقة', purpose: 'sale', availability: 'available' })));
t('fillableFields: none on an update of an existing project', fillableFields(draft({ price: 1 }, { target_id: '101' })).length === 0);
t('fillableFields: none on client, unit, nothing', fillableFields(draft({}, { target_kind: 'client' })).length === 0
  && fillableFields(draft({}, { target_kind: 'unit' })).length === 0 && fillableFields(null).length === 0);

t('parseFill: price with commas and Arabic digits', parseFill('price', '٦٥٠,٠٠٠').value === 650000);
t('parseFill: «600 ألف» is refused, not read as 600', Boolean(parseFill('price', '600 ألف').error));
t('parseFill: zero refused', Boolean(parseFill('area', '0').error));
t('parseFill: rooms must be whole', Boolean(parseFill('rooms', '3.5').error) && parseFill('rooms', '4').value === 4);
t('parseFill: blank → skip', parseFill('price', '  ').skip === true && parseFill('unknown', 'x').skip === true);
t('parseFill: date', parseFill('delivery_date', '2027-03-01').value === '2027-03-01' && Boolean(parseFill('delivery_date', '2027/03/01').error));
t('parseFill: availability and purpose from the lists only', parseFill('availability', 'sold_out').value === 'sold_out'
  && Boolean(parseFill('availability', 'sold').error) && parseFill('purpose', 'rent').value === 'rent' && Boolean(parseFill('purpose', 'x').error));
t('parseFill: text trimmed', parseFill('district', '  الصفا ').value === 'الصفا');

// رسالة الخادم كما يكتبها existingProjectMatch (agent-run/validate.ts)
const stopOne = 'اسم العرض «أوس 102» يطابق مشروعاً قائماً: «أوس 102» (#599، الصفا) — لم تُنشأ مسودة مشروع جديد. لتحديث المشروع القائم أرسل المصدر نفسه بطلب «تحديث مشروع أو وحدة»، وإن كان مشروعاً آخر بالاسم نفسه فاختر «أنشئه مشروعاً جديداً».';
const stopTwo = 'اسم العرض «برج 12» يطابق مشاريع قائمة: «برج 12» (#12)، «مجمع 12» (#40، النعيم) — لم تُنشأ مسودة مشروع جديد.';
t('matchedProjects: one project, quoted names that are not projects ignored', JSON.stringify(matchedProjects(stopOne)) === JSON.stringify([{ id: '599', name: 'أوس 102' }]), matchedProjects(stopOne));
t('matchedProjects: two projects, with and without district', matchedProjects(stopTwo).map((p) => p.id + ':' + p.name).join('|') === '12:برج 12|40:مجمع 12', matchedProjects(stopTwo));
t('matchedProjects: another message or nothing → empty', matchedProjects('تعذّر تحديد المشروع المقصود بثقة').length === 0 && matchedProjects(null).length === 0);

console.log(`passed ${pass}, failed ${fail}`);
if (fail) {
    if (typeof Deno !== 'undefined') Deno.exit(1);
    else if (typeof process !== 'undefined') process.exit(1);
}
