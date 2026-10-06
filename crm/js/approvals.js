// ‎#/approvals‎ — «طلبات الاعتماد» (للمدير).
//
// لا شيء هنا يكتب في projects / clients / client_requirements: الاعتماد ينادي
// public.agent_apply_draft ويمرّر بصمة المحتوى التي يراها المدير على الشاشة.
// إن تغيّرت المسودة أو تغيّر السجل الهدف بعد فتح الصفحة، تُرفض العملية ولا يُكتب شيء.
//
// المنع الحقيقي في قاعدة البيانات: الدالة ترفض غير المدير، وسياسة agent_decisions
// ترفض قرارات الاعتماد والرفض والإعادة من غيره. إخفاء الأزرار للراحة لا للحماية.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { staffMap, staffName } from './data.js';
import {
    AGENT_KIND, AGENT_APPLY_ERROR, AGENT_APPLIED_FIELDS, AGENT_FIELD,
    DRAFT_STATUS, DRAFT_STATUS_TONE, DRAFT_TARGET, label
} from './labels.js';
import { recheckTwins, recordLink, safeUrl, sourceRows, targetRow, valueText } from './agent.js';
import { sourcesList, decisionsBox } from './assistant.js';
import { REJECTABLE, clearDuplicates, projectRefs } from './dupes.js';
import {
    el, append, replace, loading, empty, errorBox, badge, pager, field, input,
    select, optionList, openModal, closeModal, notify, fail, errorText, fmtDateTime, toAsciiDigits, pageHead, actionBtn, money
} from './ui.js';

const QUEUE_FILTERS = {
    submitted: 'بانتظار الاعتماد',
    stale: 'قديمة — تغيّر السجل',
    returned: 'أُعيدت للموظف',
    rejected: 'مرفوضة',
    applied: 'طُبّقت'
};

/* ===================== الطابور ===================== */

export async function renderApprovals(root) {
    const view = { page: 0, status: 'submitted' };
    const body = el('div');

    const statusBox = select(optionList(QUEUE_FILTERS, 'كل الحالات'), 'submitted');
    statusBox.addEventListener('change', () => {
        view.status = statusBox.value;
        view.page = 0;
        load();
    });

    replace(root, [
        pageHead('طلبات الاعتماد', 'لا يدخل النظام سجلٌّ من المساعد قبل اعتمادك. الاعتماد يكتب السجل مرة واحدة ويُسجَّل في سجل الأحداث.', [
            actionBtn('المساعد الذكي', 'sparkle', { href: '#/assistant' })
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-toolbar' }, [statusBox, el('div', { class: 'crm-spacer' }),
                el('button', {
                    type: 'button', class: 'btn btn-outline btn-sm', text: 'ارفض المكررات',
                    title: 'رفض مسودات المشاريع الجديدة المكررة لمشروع قائم دفعة واحدة — الاعتماد يبقى واحدة واحدة',
                    onclick: (event) => rejectDuplicates(event.currentTarget, load)
                })
            ]),
            body
        ])
    ]);

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        return void replace(body, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
    }
    if (!body.isConnected) return;

    // تحميل أقدم (ترشيح أو صفحة سابقة) ينتهي بعد أحدث: يُهمل ولا يُعرض فوقه
    let loadSeq = 0;
    async function load() {
        const seq = ++loadSeq;
        const stale = () => !body.isConnected || seq !== loadSeq;
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        // الترشيح على المسودات يتم في الخادم عبر ضم داخلي، فلا تُقرأ طلبات لا مسودات لها
        const embed = view.status ? 'agent_drafts!inner' : 'agent_drafts';
        let query = supabase
            .from('agent_requests')
            .select('id, kind, title, status, created_at, requested_by, agent_sources(id, kind),'
                + ' ' + embed + '(id, status, target_kind, target_id, conflicts, duplicates)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (view.status) query = query.eq('agent_drafts.status', view.status);

        const projectsQuery = supabase
            .from('projects')
            .select('id, name, type, city, district, address, purpose, availability, price, area, rooms, images, notes, employee, date_added, details', { count: 'exact' })
            .eq('status', 'pending')
            .order('date_added', { ascending: false });
        const [{ data, error, count }, { data: projects, error: projectsError }] = await Promise.all([query, projectsQuery]);
        if (stale()) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الطابور'));
        if (projectsError) return void replace(body, errorBox(projectsError, 'تعذّر تحميل مشاريع الاعتماد'));
        if ((!data || data.length === 0) && (!projects || projects.length === 0)) {
            return void replace(body, empty(view.status ? 'لا طلبات بهذه الحالة' : 'لا طلبات بعد'));
        }

        const twinState = await twinStatuses((data || []).flatMap((row) => row.agent_drafts || []));
        if (stale()) return;

        const content = [];
        if (projects && projects.length) content.push(projectApprovalSection(projects, load));
        if (data && data.length) content.push(
            el('h3', { class: 'crm-section-title', text: 'طلبات المساعد الذكي' }),
            el('div', { class: 'crm-table-wrap' }, queueTable(data, names, twinState)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        );
        replace(body, content);
    }

    await load();
}

// زر «تنظيف التكرارات» مخفي من الطابور: يدمج المشاريع المعلّقة في أصولها المعتمدة ويحذفها دفعة واحدة
// بلا مراجعة، و«ارفض المكررات» مع «مطابقة مع الأصل» يغطيان الحالة اليومية. الدالة باقية لإعادته عند الحاجة.
// eslint-disable-next-line no-unused-vars
async function cleanDuplicateProjects(reload) {
    try {
        const result = await supabase.from('projects')
            .select('id,name,type,city,district,address,purpose,availability,price,area,rooms,notes,details,images,date_added,status')
            .order('date_added', { ascending: true });
        if (result.error) throw result.error;
        const projects = result.data || [];
        const approved = projects.filter((project) => project.status === 'approved');
        const pending = projects.filter((project) => project.status === 'pending');
        const duplicateIds = [];
        let merged = 0;
        for (const project of pending) {
            const original = findOriginalProject(project, approved);
            if (!original) continue;
            const details = mergedDetails(original, project);
            const patch = {
                details,
                address: project.address || original.address,
                city: project.city || original.city,
                district: project.district || original.district,
                purpose: project.purpose || original.purpose,
                price: project.price === null || project.price === undefined ? original.price : project.price,
                area: project.area === null || project.area === undefined ? original.area : project.area,
                rooms: project.rooms === null || project.rooms === undefined ? original.rooms : project.rooms,
                notes: project.notes || original.notes,
                images: carriedImages(project, original)
            };
            const updated = await supabase.from('projects').update(patch).eq('id', original.id).eq('status', 'approved');
            if (updated.error) throw updated.error;
            const removed = await supabase.from('projects').delete().eq('id', project.id).eq('status', 'pending');
            if (removed.error) throw removed.error;
            duplicateIds.push(project.id);
            merged += 1;
        }
        const groups = new Map();
        for (const project of pending.filter((item) => !duplicateIds.includes(item.id))) {
            const key = projectKey(project);
            const list = groups.get(key) || [];
            list.push(project); groups.set(key, list);
        }
        for (const list of groups.values()) {
            if (list.length < 2) continue;
            list.sort((a, b) => projectQuality(b) - projectQuality(a));
            for (const project of list.slice(1)) duplicateIds.push(project.id);
        }
        for (const id of duplicateIds.filter((id) => pending.some((project) => project.id === id))) {
            const removed = await supabase.from('projects').delete().eq('id', id).eq('status', 'pending');
            if (removed.error) throw removed.error;
        }
        notify(merged || duplicateIds.length ? 'تم تحديث ' + merged + ' مشروع أصلي وحذف ' + duplicateIds.length + ' نسخة مكررة.' : 'لا توجد نسخ مكررة.', 'success');
        reload();
    } catch (error) { fail(error, 'تعذر تنظيف التكرارات'); }
}

function normalizeProjectText(value) {
    return String(value || '').toLowerCase()
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/مشروع|مشاريع|كيان|الغزالي|شركة|التطوير|العقارية/g, '')
        .replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
}

function projectKey(project) {
    return [project.name, project.city, project.district].map(normalizeProjectText).join('|');
}

function projectCode(project) {
    const match = String(project.name || '').match(/(?:^|\D)(\d{2,4})(?:\D|$)/);
    return match ? match[1] : '';
}

function findOriginalProject(project, approved) {
    const exact = approved.filter((candidate) => projectKey(candidate) === projectKey(project));
    if (exact.length === 1) return exact[0];
    const code = projectCode(project);
    if (!code) return null;
    const coded = approved.filter((candidate) => projectCode(candidate) === code
        && normalizeProjectText(candidate.city) === normalizeProjectText(project.city)
        && normalizeProjectText(candidate.district) === normalizeProjectText(project.district));
    return coded.length === 1 ? coded[0] : null;
}

function projectQuality(project) {
    const details = project.details || {};
    return Object.keys(details).length * 2 + (Array.isArray(project.images) ? project.images.length : 0) + (project.notes ? 1 : 0);
}

function projectApprovalSection(rows, reload) {
    const section = el('section', { class: 'crm-approval-projects' });
    section.appendChild(el('h3', { class: 'crm-section-title', text: 'مشاريع بانتظار الاعتماد (' + rows.length + ')' }));
    const list = el('div', { class: 'crm-approval-project-list' });
    for (const project of rows) {
        const details = project.details || {};
        const images = Array.isArray(project.images) ? project.images : [];
        // الصور والروابط هنا من إدخال موظف أو ملف مستورد لم يراجعه المدير بعد: لا يدخل منها src أو href
        // إلا ما قبله safeUrl (http/https فقط)، والصورة https فقط كما في اللوحة (shownImage)، وtel: لرقم
        // هاتف واحد مقروء فقط، وmailto: لعنوان سليم فقط (safeEmail). كل مرشّح يُفحص وحده، فإن رُفض الأول
        // بقي البديل الصالح بعده. والقيمة المرفوضة تُعرض نصاً (invalidLink) ولا تختفي عن المدير،
        // والفارغة أو المسافات وحدها كأنها غير موجودة (present).
        const rawImage = present(images[0]) ? images[0] : present(details.image_url) ? details.image_url : null;
        const imageUrl = shownImage(images[0]) || shownImage(details.image_url);
        const image = imageUrl ? el('img', { class: 'crm-approval-project-image', src: imageUrl, alt: project.name || 'صورة المشروع' }) : null;
        const sourceUrl = safeUrl(details.source_url);
        const notesUrl = project.notes?.match(/https?:\/\/\S+/)?.[0];
        const contactUrl = safeUrl(details.contact_url);
        const brochureUrl = safeUrl(details.brochure_url);
        // tel: لرقم واحد فقط: بعد حذف المسافات و- و. والأقواس لا يبقى إلا + في أوله و6 إلى 15 رقماً. ما فيه
        // أحرف أو / أو رقمان («0551234567 / 0569876543») يبقى نصاً، فأرقامه وحدها كانت تتصل برقم غير الظاهر
        const phoneDigits = toAsciiDigits(details.contact_phone).replace(/[\s\-().]/g, '');
        const phone = /^\+?\d{6,15}$/.test(phoneDigits) ? phoneDigits : '';
        const email = safeEmail(details.contact_email);
        const description = details.description || project.notes;
        list.appendChild(el('article', { class: 'crm-approval-project' }, [
            image || el('div', { class: 'crm-approval-project-image crm-approval-project-placeholder', text: rawImage ? 'صورة غير صالحة' : 'بدون صورة' }),
            el('div', { class: 'crm-approval-project-info' }, [
                el('strong', { text: project.name || 'مشروع بلا اسم' }),
                el('div', { class: 'crm-subtle', text: [project.type, project.city, project.district].filter(Boolean).join(' · ') || 'بيانات موقع غير مكتملة' }),
                el('div', { class: 'crm-subtle', text: project.price ? 'يبدأ من ' + Number(project.price).toLocaleString('en-US') + ' ريال' : 'السعر غير محدد' }),
                el('div', { class: 'crm-subtle', text: 'المطور: ' + (details.developer || 'غير محدد') }),
                el('div', { class: 'crm-subtle', text: [
                    details.units_count ? details.units_count + ' وحدة' : null,
                    details.buildings_count ? details.buildings_count + ' عمارة' : null,
                    project.area ? Number(project.area).toLocaleString('en-US') + ' م²' : null
                ].filter(Boolean).join(' · ') || 'تفاصيل الوحدات غير منشورة' }),
                description ? el('div', { class: 'crm-subtle', text: description }) : null,
                // شبكة اللوحة لا تعرض إلا images[0]: إن رُفضت ذُكرت دائماً ولو ظهرت هنا صورة image_url بدلاً
                // منها، وتلك البديلة تُعلَّم بأنها لن تظهر هناك
                present(images[0]) && !shownImage(images[0]) ? invalidLink('الصورة', images[0])
                    : !imageUrl && rawImage ? invalidLink('الصورة', rawImage) : null,
                imageUrl && !shownImage(images[0])
                    ? el('div', { class: 'crm-subtle', text: 'الصورة من رابط image_url — لن تظهر في اللوحة ما لم تُضف إلى صور المشروع' }) : null,
                phone ? el('a', { class: 'crm-subtle', href: 'tel:' + phone, text: 'اتصال: ' + details.contact_phone })
                    : present(details.contact_phone) ? el('div', { class: 'crm-subtle', text: 'اتصال: ' + details.contact_phone }) : null,
                email ? el('a', { class: 'crm-subtle', href: 'mailto:' + email, text: email })
                    : present(details.contact_email) ? invalidLink('البريد', details.contact_email) : null,
                contactUrl ? el('a', { class: 'crm-subtle', href: contactUrl, target: '_blank', rel: 'noopener', text: 'صفحة التواصل' })
                    : present(details.contact_url) ? invalidLink('صفحة التواصل', details.contact_url) : null,
                brochureUrl ? el('a', { class: 'crm-subtle', href: brochureUrl, target: '_blank', rel: 'noopener', text: 'فتح البروشور PDF' })
                    : present(details.brochure_url) ? invalidLink('البروشور', details.brochure_url) : null,
                // رابط في الملاحظات ليس المصدر الرسمي، فيُسمّى باسمه. والمصدر المرفوض يبقى ظاهراً بجانبه
                sourceUrl ? el('a', { class: 'crm-subtle', href: sourceUrl, target: '_blank', rel: 'noopener', text: 'المصدر الرسمي' })
                    : notesUrl ? el('a', { class: 'crm-subtle', href: notesUrl, target: '_blank', rel: 'noopener', text: 'رابط من الملاحظات' })
                    : present(details.source_url) ? null
                    : el('div', { class: 'crm-subtle', text: 'لا يوجد رابط مصدر' }),
                present(details.source_url) && !sourceUrl ? invalidLink('المصدر الرسمي', details.source_url) : null
            ]),
            el('div', { class: 'crm-approval-project-actions' }, [
                el('button', { type: 'button', class: 'btn btn-secondary btn-xs', text: 'مطابقة مع الأصل', onclick: () => matchPendingProject(project, reload) }),
                el('button', { type: 'button', class: 'btn btn-primary btn-xs', text: 'اعتماد', onclick: () => decideProject(project, 'approved', reload) }),
                el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'رفض', onclick: () => decideProject(project, 'rejected', reload) })
            ])
        ]));
    }
    section.appendChild(list);
    return section;
}

// قيمة رابط مرفوضة (مثل www.… بلا http، أو javascript:، أو بريد فيه ?bcc=): تُعرض نصاً فقط لا رابطاً،
// حتى لا تختفي عن المدير
function invalidLink(name, value) {
    return el('div', { class: 'crm-subtle' }, [
        el('span', { text: 'رابط ' + name + ' غير صالح: ' }),
        el('span', { dir: 'auto', style: 'word-break:break-word', text: valueText(value) })
    ]);
}

// قيمة فارغة أو مسافات فقط (خلية CSV فيها مسافة مثلاً) كأنها غير موجودة: لا سطر «غير صالح» فارغ،
// ولا «اتصال:» بلا رقم، ولا تحجب «لا يوجد رابط مصدر»
function present(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

// صورة المشروع تظهر بعد الاعتماد في شبكة اللوحة، وهي لا تعرض إلا https (safeUrl في js/script.js):
// فلا نعرض هنا صورة لن تظهر هناك (وبديل image_url يُعلَّم في البطاقة بأنه لن يظهر)، ولا ننقلها إلى
// المشروع الأصلي فوق صوره الصالحة
function shownImage(value) {
    const url = safeUrl(value);
    return url && /^https:\/\//i.test(url) ? url : null;
}

// صور النسخة المعلّقة التي تظهر فعلاً، وإن لم يبقَ منها شيء تبقى صور الأصل كما هي
function carriedImages(project, original) {
    const usable = (Array.isArray(project.images) ? project.images : []).filter((url) => shownImage(url));
    return usable.length ? usable : original.images;
}

// تفاصيل النسخة المعلّقة فوق تفاصيل الأصل، إلا رابطاً أو بريداً ترفضه هذه الشاشة: يبقى مكانه ما في
// الأصل، كما تبقى صور الأصل في carriedImages
function mergedDetails(original, project) {
    const base = original.details || {};
    const merged = Object.assign({}, base, project.details || {});
    for (const key of ['source_url', 'contact_url', 'brochure_url']) {
        if (merged[key] && !safeUrl(merged[key])) merged[key] = base[key] ?? null;
    }
    if (merged.image_url && !shownImage(merged.image_url)) merged.image_url = base.image_url ?? null;
    if (merged.contact_email && !safeEmail(merged.contact_email)) merged.contact_email = base.contact_email ?? null;
    return merged;
}

// بريد لم يراجعه أحد: لا يدخل mailto: إلا عنوان واحد بلا مسافات وبلا ? & # % , ; — وإلا أضاف
// للرسالة رؤوساً لا يراها المدير (info@dev.sa?bcc=…) فتذهب نسخة منها إلى طرف آخر. ولا محارف اتجاه
// أو محارف خفية (U+061C، U+200B–U+200F، U+202A–U+202E، U+2060–U+2069): تُظهر للمدير عنواناً غير الذي يُرسَل إليه
function safeEmail(value) {
    const text = String(value || '').trim();
    return /^[^\s@?&#%,;\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069]+@[^\s@?&#%,;\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069]+\.[^\s@?&#%,;\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069]+$/.test(text) ? text : null;
}

async function matchPendingProject(project, reload) {
    const result = await supabase.from('projects')
        .select('id, name, type, city, district, address, purpose, availability, price, area, rooms, images, notes, details')
        .eq('status', 'approved')
        .order('name', { ascending: true });
    if (result.error) return void fail(result.error, 'تعذّر تحميل المشاريع الأصلية');
    const originals = result.data || [];
    if (!originals.length) return void notify('لا توجد مشاريع معتمدة للمطابقة معها', 'info');

    const choices = originals.map((original) => [original.id, [original.name, original.city, original.district].filter(Boolean).join(' · ')]);
    const originalBox = select(optionList(Object.fromEntries(choices), ''), '');
    const form = el('form', {}, [
        el('p', { class: 'crm-subtle', text: 'اختر المشروع الأصلي المعتمد الذي يطابق: ' + project.name }),
        field('المشروع الأصلي', originalBox, { required: true }),
        el('div', { class: 'btn-row' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'نقل التحديث إلى الأصل' })
        ])
    ]);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const original = originals.find((row) => String(row.id) === originalBox.value);
        if (!original) return void notify('اختر مشروعًا أصليًا أولًا', 'error');
        const details = mergedDetails(original, project);
        const updated = await supabase.from('projects').update({
            details,
            address: project.address || original.address,
            city: project.city || original.city,
            district: project.district || original.district,
            purpose: project.purpose || original.purpose,
            availability: project.availability === 'sold_out' ? 'sold_out' : (original.availability || project.availability),
            price: project.price === null || project.price === undefined ? original.price : project.price,
            area: project.area === null || project.area === undefined ? original.area : project.area,
            rooms: project.rooms === null || project.rooms === undefined ? original.rooms : project.rooms,
            notes: project.notes || original.notes,
            images: carriedImages(project, original)
        }).eq('id', original.id).eq('status', 'approved');
        if (updated.error) return void fail(updated.error, 'تعذّر تحديث المشروع الأصلي');
        const removed = await supabase.from('projects').delete().eq('id', project.id).eq('status', 'pending');
        if (removed.error) return void fail(removed.error, 'تم تحديث الأصل، لكن تعذّر حذف نسخة الاعتماد المكررة');
        closeModal();
        notify('تم تحديث الأصل المعتمد فقط؛ حُذفت نسخة الاعتماد المكررة', 'success');
        reload();
    });
    openModal('مطابقة مشروع مع الأصل', form, { narrow: true });
}

async function decideProject(project, status, reload) {
    const result = await supabase.from('projects').update({ status, rejection_reason: status === 'rejected' ? 'رفض من المدير بعد المراجعة' : null }).eq('id', project.id).eq('status', 'pending');
    if (result.error) return void fail(result.error, 'تعذّر تحديث اعتماد المشروع');
    notify(status === 'approved' ? 'تم اعتماد المشروع.' : 'تم رفض المشروع.', status === 'approved' ? 'success' : 'info');
    reload();
}

function queueTable(rows, names, twinState) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'النوع' }),
        el('th', { text: 'مقدّم الطلب' }),
        el('th', { text: 'المصدر' }),
        el('th', { text: 'الوقت' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'إضافات' }),
        el('th', { text: 'تعديلات' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const drafts = row.agent_drafts || [];
        const additions = drafts.filter((d) => !d.target_id).length;
        const edits = drafts.length - additions;
        const sources = row.agent_sources || [];
        const kinds = [];
        for (const source of sources) if (!kinds.includes(source.kind)) kinds.push(source.kind);

        body.appendChild(el('tr', {
            class: 'clickable',
            onclick: () => { location.hash = '#/approvals/' + row.id; }
        }, [
            el('td', {}, [
                el('strong', { text: label(AGENT_KIND, row.kind) }),
                drafts.some((d) => priceAlerts(d).length) ? badge('تنبيه سعر', 'red') : null,
                drafts.some((d) => OPEN_DRAFT.includes(d.status) && liveTwins(d, twinState).length) ? badge('مسودة مكررة', 'gold') : null,
                row.title ? el('div', { class: 'crm-subtle', text: row.title }) : null
            ]),
            el('td', { text: staffName(names, row.requested_by) }),
            el('td', { class: 'crm-subtle', text: sources.length ? sources.length + ' مصدر' : '—' }),
            el('td', { class: 'crm-subtle', text: fmtDateTime(row.created_at) }),
            el('td', {}, statusBadges(drafts)),
            el('td', { class: 'num', text: String(additions) }),
            el('td', { class: 'num', text: String(edits) })
        ]));
    }
    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

// كل ملاحظة للمدقق على حقل سعر: سعر لم يُستخرج (نصه في الملاحظات)، أو أُسقط بتعارض أو لأنه مستنتج،
// أو سعر متر بلا إجمالي، أو سعر غير معقول
const PRICE_FIELD = /(^|\.)(price|price_per_m)$/;
function priceAlerts(draft) {
    return (Array.isArray(draft.conflicts) ? draft.conflicts : [])
        .filter((c) => c && PRICE_FIELD.test(String(c.field || '')));
}

// مسودة معلّقة أخرى (طلب آخر) تصف العرض نفسه: فحص التكرار يضعها في duplicates بنوع draft على المسودتين
const OPEN_DRAFT = ['draft', 'submitted', 'returned'];
function draftTwins(draft) {
    return (Array.isArray(draft.duplicates) ? draft.duplicates : [])
        .filter((d) => d && d.kind === 'draft' && d.id);
}

// حالة التوائم الآن: قد تكون اعتُمدت أو رُفضت أو حُذفت بعد تسجيلها. null إن تعذّرت القراءة (يُعرض ما سُجّل)
async function twinStatuses(drafts) {
    const ids = [...new Set(drafts.flatMap(draftTwins).map((t) => t.draft_id).filter(Boolean))];
    const { data, error } = await rowsByIds('agent_drafts', 'id, status, applied_record', ids);
    if (error) return null;
    return new Map(data.map((row) => [row.id, row]));
}

// صفوف بقائمة معرّفات، مئةً مئة: قائمة in تُرسل في الرابط، والطابور كله (رفض المكررات) قد يذكر مئات المعرّفات
async function rowsByIds(table, columns, ids) {
    const data = [];
    for (let i = 0; i < ids.length; i += 100) {
        const result = await supabase.from(table).select(columns).in('id', ids.slice(i, i + 100));
        if (result.error) return { data: null, error: result.error };
        data.push(...(result.data || []));
    }
    return { data, error: null };
}

// التوائم التي تستحق التنبيه: ما زالت معلّقة، أو طُبّقت (فهذه مكررة لمشروع صار قائماً). المرفوضة والمحذوفة تسقط
function liveTwins(draft, twinState) {
    return draftTwins(draft).filter((t) => {
        if (!twinState) return true;
        const now = twinState.get(t.draft_id);
        return Boolean(now) && (OPEN_DRAFT.includes(now.status) || now.status === 'applied');
    });
}

function statusBadges(drafts) {
    const counts = new Map();
    for (const draft of drafts) counts.set(draft.status, (counts.get(draft.status) || 0) + 1);
    const box = el('span');
    for (const [status, count] of counts) {
        box.appendChild(badge(label(DRAFT_STATUS, status) + (count > 1 ? ' ×' + count : ''),
                              DRAFT_STATUS_TONE[status] || 'neutral'));
    }
    return box;
}

/* ===================== صفحة الاعتماد ===================== */

export async function renderApproval(root, requestId) {
    replace(root, loading());

    const { data: request, error } = await supabase
        .from('agent_requests')
        .select('id, kind, title, instruction, status, error_ar, created_at, requested_by')
        .eq('id', requestId)
        .maybeSingle();
    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل الطلب'));
    if (!request) return void replace(root, empty('الطلب غير موجود'));

    const [sources, drafts, names] = await Promise.all([
        sourceRows(requestId),
        supabase.from('agent_drafts')
            .select('id, target_kind, target_id, proposed, evidence, missing, conflicts, duplicates, suspicious,'
                + ' baseline_hash, content_hash, status, applied_record, created_by, updated_at')
            .eq('request_id', requestId).order('created_at', { ascending: true }),
        staffMap().catch(() => new Map())
    ]);
    if (!root.isConnected) return;

    const reload = () => renderApproval(root, requestId);
    const twinState = drafts.error ? new Map() : await twinStatuses(drafts.data || []);
    if (!root.isConnected) return;

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: label(AGENT_KIND, request.kind) + (request.title ? ' — ' + request.title : '') }),
                el('a', { class: 'btn btn-outline btn-sm', href: '#/approvals', text: 'رجوع للطابور' })
            ]),
            el('div', { class: 'kv-grid' }, [
                el('div', { class: 'kv' }, [el('span', { text: 'مقدّم الطلب' }),
                    el('span', { text: staffName(names, request.requested_by) })]),
                el('div', { class: 'kv' }, [el('span', { text: 'الوقت' }),
                    el('span', { text: fmtDateTime(request.created_at) })])
            ]),
            el('h3', { text: 'التعليمات' }),
            el('div', { class: 'agent-text', text: request.instruction })
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'المصدر' })),
            sourcesList(sources.data || [], sources.error, request.status)
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'الحقول المستخرجة' })),
            drafts.error
                ? errorBox(drafts.error, 'تعذّر تحميل المسودات')
                : ((drafts.data || []).length
                    ? draftCards(drafts.data, names, reload, twinState)
                    : empty('لا مسودات على هذا الطلب'))
        ])
    ]);
}

function draftCards(rows, names, reload, twinState) {
    const holder = el('div');
    for (const draft of rows) holder.appendChild(draftCard(draft, names, reload, twinState));
    return holder;
}

function draftCard(draft, names, reload, twinState) {
    const card = el('div', { class: 'agent-draft' });
    const isNew = !draft.target_id;
    const titleNode = el('strong', { text: isNew ? 'سجل جديد' : 'تعديل على سجل قائم — ' + draft.target_id });

    card.appendChild(el('div', { class: 'agent-source-head' }, [
        badge(label(DRAFT_TARGET, draft.target_kind), 'blue'),
        titleNode,
        badge(label(DRAFT_STATUS, draft.status), DRAFT_STATUS_TONE[draft.status] || 'neutral'),
        el('span', { class: 'crm-subtle', text: 'أعدّها ' + staffName(names, draft.created_by) })
    ]));

    const alerts = priceAlerts(draft);
    if (alerts.length) {
        card.appendChild(el('div', { class: 'crm-warn-box' }, [
            el('strong', { text: 'تنبيه السعر — راجعه قبل الاعتماد' }),
            el('ul', { class: 'agent-list' }, alerts.map((c) => el('li', { text: c.note + (c.quote ? ' — ' + c.quote : '') })))
        ]));
    }

    const existing = isNew && OPEN_DRAFT.includes(draft.status)
        ? (draft.duplicates || []).filter((d) => d && d.kind === 'project' && d.id) : [];
    if (existing.length) {
        card.appendChild(el('div', { class: 'crm-warn-box dup-strong' }, [
            el('strong', { text: 'يطابق مشروعاً قائماً — تأكد قبل الاعتماد أنه ليس مكرراً، أو استعمل «مطابقة مع الأصل»' }),
            el('ul', { class: 'agent-list' }, existing.slice(0, 3).map((d) => el('li', {
                text: 'المشروع رقم ' + d.id + (d.name ? ' «' + d.name + '»' : '') + (d.district ? ' (' + d.district + ')' : '')
                    + (d.reason ? ' — ' + d.reason : '')
            })))
        ]));
    }

    const twins = OPEN_DRAFT.includes(draft.status) ? liveTwins(draft, twinState) : [];
    if (twins.length) {
        const applied = twins.filter((t) => twinState && twinState.get(t.draft_id)?.status === 'applied');
        card.appendChild(el('div', { class: 'crm-warn-box' }, [
            el('strong', { text: applied.length
                ? 'مسودة مطابقة لهذه اعتُمدت وصارت مشروعاً — هذه مكررة له على الأرجح'
                : 'مسودة معلّقة أخرى تطابق هذه — اعتمد واحدة فقط، وارفض الأخرى' }),
            el('ul', { class: 'agent-list' }, twins.map((t) => twinLine(t, twinState)))
        ]));
    }

    const fieldsBox = el('div');
    card.appendChild(fieldsBox);

    // جدول قبل/بعد يحتاج الصف الهدف؛ يُقرأ مرة واحدة لكل مسودة
    if (isNew) {
        replace(fieldsBox, fieldsTable(draft, null));
    } else {
        replace(fieldsBox, loading('جارٍ قراءة السجل الهدف'));
        targetRow(draft.target_kind, draft.target_id).then((row) => {
            if (!fieldsBox.isConnected) return;
            if (row) titleNode.textContent = 'تعديل على: ' + targetName(draft, row);
            replace(fieldsBox, [
                row ? null : el('div', { class: 'crm-warn-box', text: 'تعذّرت قراءة السجل الهدف — المقارنة غير متاحة، والاعتماد سيتحقق منه على الخادم.' }),
                fieldsTable(draft, row)
            ]);
        });
    }

    if ((draft.missing || []).length) {
        card.appendChild(el('div', { class: 'agent-block' }, [
            el('h4', { text: 'حقول لم يذكرها المصدر' }),
            chips(draft.missing)
        ]));
    }
    card.appendChild(listBlock('تعارضات', draft.conflicts, 'لا تعارضات'));
    card.appendChild(duplicatesBlock(draft.duplicates, twinState));
    card.appendChild(suspiciousBlock(draft.suspicious));
    card.appendChild(touchedBlock(draft));
    card.appendChild(actionsRow(draft, reload));
    card.appendChild(decisionsBox(draft.id));
    return card;
}

// الحقول: المقترح ودليله، ومع التعديل القيمةُ الحالية بجانبه.
// ما لا تكتبه دالة الاعتماد يُعلَّم صراحة حتى لا يُعتمد شيء يُظن أنه سيُحفظ.
function fieldsTable(draft, current) {
    const proposed = draft.proposed || {};
    const evidence = draft.evidence || {};
    const allowed = AGENT_APPLIED_FIELDS[draft.target_kind] || [];
    const keys = Object.keys(proposed);
    if (!keys.length) return empty('المسودة بلا حقول مقترحة');

    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'الحقل' }),
        current ? el('th', { text: 'القيمة الحالية' }) : null,
        el('th', { text: 'القيمة المقترحة' }),
        el('th', { text: 'الدليل من المصدر' })
    ]));

    const body = el('tbody');
    // القيم المركّبة التي تكتبها وظيفة الاستخراج (التفاصيل، الطلب المرفق، الوحدات) تُفرد صفوفاً
    // بدليل كل حقل فرعي على حدة، بدل نص JSON واحد لا يُراجَع.
    const addRow = (displayKey, value, ev, skipped, cur, rawKey) => {
        const changed = current ? valueText(cur) !== valueText(value) : true;
        const isMoney = PRICE_KEY.test(rawKey || '') && amountOf(value) !== null;
        const before = current ? (isMoney && amountOf(cur) !== null ? money(amountOf(cur)) + ' ريال' : valueText(cur)) : null;
        const after = isMoney ? money(amountOf(value)) + ' ريال' : valueText(value);
        const diff = current && isMoney && changed ? priceDiff(amountOf(cur), amountOf(value)) : null;
        body.appendChild(el('tr', { class: changed ? '' : 'agent-row-same' }, [
            el('td', {}, [
                el('strong', { text: displayKey }),
                skipped ? el('div', {}, badge('لن يُكتب', 'red')) : null,
                isSuggested(ev, value) ? el('div', {}, badge('اسم مقترح', 'gold')) : null
            ]),
            current ? el('td', { class: 'crm-subtle', text: before }) : null,
            el('td', {}, [el('span', { text: after }), diff]),
            el('td', { class: 'crm-subtle' }, evidenceCell(ev, value))
        ]));
    };

    for (const key of keys) {
        const skipped = allowed.indexOf(key) === -1;
        const value = proposed[key];
        const nested = value && typeof value === 'object' && !Array.isArray(value) && (key === 'details' || key === 'requirement');
        if (!nested) {
            addRow(label(AGENT_FIELD, key, key), value, evidence[key], skipped, current ? current[key] : undefined, key);
            continue;
        }
        const currentSub = current && current[key] && typeof current[key] === 'object' ? current[key] : {};
        for (const sub of Object.keys(value)) {
            if (sub === 'models' && Array.isArray(value.models)) continue;
            addRow(label(AGENT_FIELD, key, key) + ' — ' + label(AGENT_FIELD, sub, sub), value[sub],
                   evidence[key + '.' + sub], skipped, currentSub[sub], sub);
        }
    }
    const table = el('table', { class: 'users-table crm-table' }, [head, body]);
    const models = proposed.details && Array.isArray(proposed.details.models) ? proposed.details.models : null;
    if (!models) return table;
    return el('div', {}, [table, unitsTable(models, evidence, allowed.indexOf('details') === -1)]);
}

// حقول المال تُعرض بفواصل وريال. النص لا يُعدّ رقماً إلا إن كان أرقاماً وفواصل فقط («يبدأ من 600 ألف» يبقى نصاً).
const PRICE_KEY = /price|budget|amount|commission/i;

function amountOf(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^\s*[\d٠-٩.,٬\s]+\s*$/.test(value)) return null;
    const n = Number(toAsciiDigits(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && value.trim() !== '' ? n : null;
}

// مقدار التغيير ونسبته تحت القيمة المقترحة؛ أكثر من 15% يُلوَّن تنبيهاً
function priceDiff(before, after) {
    if (before === null || after === null || before === after) return null;
    const delta = after - before;
    const pct = before ? (delta / before) * 100 : null;
    const sign = delta > 0 ? '+' : '−';
    const text = (delta > 0 ? 'زيادة ' : 'نقص ') + money(Math.abs(delta)) + ' ريال'
        + (pct === null ? '' : ' (' + sign + Math.abs(pct).toFixed(1) + '%)');
    return el('div', { class: 'price-diff' + (pct === null || Math.abs(pct) > 15 ? ' price-diff-big' : '') }, text);
}

// اسم السجل الهدف لعنوان مسودة التعديل، مع رقمه
function targetName(draft, row) {
    const id = ' (رقم ' + draft.target_id + ')';
    if (draft.target_kind === 'project') return (row.name || 'مشروع') + id;
    if (draft.target_kind === 'client') return (row.full_name || 'عميل') + id;
    if (draft.target_kind === 'unit') return 'وحدة «' + (row.name || row.type || '—') + '»' + id;
    return label(DRAFT_TARGET, draft.target_kind) + id;
}

// وحدات المشروع المقترحة: صف لكل نموذج، والدليل مجمَّع أسفل الجدول لكل خلية لها اقتباس.
const UNIT_COLUMNS = ['name', 'type', 'rooms', 'bathrooms', 'area', 'price', 'price_per_m', 'count', 'status'];

function unitsTable(models, evidence, skipped) {
    const head = el('thead', {}, el('tr', {}, UNIT_COLUMNS.map((c) => el('th', { text: label(AGENT_FIELD, c, c) }))));
    const body = el('tbody');
    const quotes = el('ul', { class: 'agent-list' });
    models.forEach((m, i) => {
        body.appendChild(el('tr', {}, UNIT_COLUMNS.map((c) => {
            const value = m ? m[c] : null;
            const amount = PRICE_KEY.test(c) ? amountOf(value) : null;
            return el('td', { text: amount !== null ? money(amount) : valueText(value) });
        })));
        for (const c of UNIT_COLUMNS) {
            const ev = evidence['units.' + i + '.' + c];
            if (!ev || !ev.quote) continue;
            quotes.appendChild(el('li', {}, [
                el('span', { text: (i + 1) + ' — ' + label(AGENT_FIELD, c, c) + ': ' }),
                evidenceCell(ev)
            ]));
        }
    });
    return el('div', { class: 'agent-block' }, [
        el('h4', {}, [el('span', { text: 'الوحدات المقترحة (' + models.length + ')' }), skipped ? badge('لن تُكتب', 'red') : null]),
        el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, body])),
        quotes.firstChild ? quotes : el('div', { class: 'crm-subtle', text: 'بلا اقتباسات' })
    ]);
}

// الدليل: الاقتباس والصفحة والمصدر، وهل وُجد الاقتباس فعلاً في نص المصدر (verified)،
// والقيمة السابقة وسبب التغيير لمسودات التحديث.
// اسم وصفي اقترحه المساعد لعرض لا يذكر المصدر اسمه (agent-run: evidence.suggested). بعد تعديل المدير
// للاسم في المسودة لا يعود «مقترحاً»، فالعلامة لا تظهر إلا والقيمة هي المقترحة نفسها.
function isSuggested(ev, value) {
    return Boolean(ev && typeof ev === 'object' && typeof ev.suggested === 'string' && ev.suggested === value);
}

function evidenceCell(ev, value) {
    if (!ev) return el('span', { text: '— بلا دليل' });
    if (typeof ev !== 'object') return el('span', { text: valueText(ev) });
    const box = el('div');
    if (ev.quote) box.appendChild(el('div', { class: 'agent-quote', text: '«' + String(ev.quote) + '»' }));
    const meta = [];
    if (ev.page !== undefined && ev.page !== null) meta.push('صفحة ' + ev.page);
    if (ev.source_id) meta.push('مصدر ' + String(ev.source_id).slice(0, 8));
    if (typeof ev.suggested === 'string') {
        meta.push(value === undefined || isSuggested(ev, value) ? 'اسم مقترح من المساعد — سببه في «تعارضات» أدناه'
            : 'عُدّل بعد اقتراح المساعد («' + ev.suggested + '»)');
    }
    else if (ev.verified === true) meta.push('الاقتباس موجود في النص');
    else if (ev.verified === false) meta.push('لم يُتحقق من الاقتباس آلياً (ملف أو صورة)');
    if (meta.length) box.appendChild(el('div', { text: meta.join(' — ') }));
    if (ev.before !== undefined) box.appendChild(el('div', { text: 'القيمة السابقة: ' + valueText(ev.before) }));
    if (ev.reason) box.appendChild(el('div', { text: 'السبب: ' + String(ev.reason) }));
    if (!box.firstChild) box.appendChild(el('span', { text: valueText(ev) }));
    return box;
}

// نص في المصدر حاول توجيه المساعد (اعتمد، تجاهل التعليمات...): يُعرض للمدير كما هو، وقد تُجوهل.
function suspiciousBlock(rows) {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) return el('div', { class: 'crm-hidden' });
    const list = el('ul', { class: 'agent-list' });
    for (const item of items) {
        list.appendChild(el('li', {}, [
            el('span', { class: 'agent-quote', text: '«' + valueText(item && item.quote) + '»' }),
            el('span', { class: 'crm-subtle', text: valueText(item && item.reason) })
        ]));
    }
    return el('div', { class: 'crm-error' }, [
        el('h4', { text: 'محتوى مريب في المصدر (' + items.length + ') — لم يُنفَّذ منه شيء' }),
        el('div', { class: 'crm-subtle', text: 'المصدر بيانات لا تعليمات. هذا النص اقتُبس هنا للمراجعة فقط ولم يؤثر في المقترح.' }),
        list
    ]);
}

function chips(values) {
    const box = el('div', { class: 'chips' });
    for (const value of values) box.appendChild(el('span', { class: 'chip', text: label(AGENT_FIELD, value, value) }));
    return box;
}

function listBlock(title, rows, emptyText) {
    const items = Array.isArray(rows) ? rows : [];
    const box = el('div', { class: 'agent-block' }, el('h4', { text: title }));
    if (!items.length) {
        box.appendChild(el('div', { class: 'crm-subtle', text: emptyText }));
        return box;
    }
    const list = el('ul', { class: 'agent-list' });
    for (const item of items) list.appendChild(el('li', { text: itemText(item) }));
    box.appendChild(list);
    return box;
}

function itemText(item) {
    if (!item || typeof item !== 'object') return valueText(item);
    const parts = [];
    for (const key of Object.keys(item)) {
        // رمز التعارض للنظام لا للقارئ، واسم الحقل يُعرض بالعربية
        if (key === 'code') continue;
        const value = key === 'field' && typeof item[key] === 'string' ? label(AGENT_FIELD, item[key], item[key]) : valueText(item[key]);
        parts.push(label(AGENT_FIELD, key, key) + ': ' + value);
    }
    return parts.join(' — ');
}

// المكرّرات: مرشّحون موجودون فعلاً في النظام. الرابط يُبنى فقط لما نعرف صفحته.
// سطر التوأم: اسمه وسبب المطابقة وحالته الآن (ورقم المشروع إن طُبّق)، ورابط طلبه
function twinLine(t, twinState) {
    const now = twinState ? twinState.get(t.draft_id) : undefined;
    const state = !twinState ? '' : !now ? ' (حُذفت)' : now.status === 'applied'
        ? ' (طُبّقت كمشروع رقم ' + (now.applied_record || '—') + ')'
        : now.status === 'rejected' ? ' (رُفضت)' : '';
    return el('li', {}, [
        el('span', { text: (t.name || 'بلا اسم') + (t.reason ? ' — ' + t.reason : '') + state + ' ' }),
        el('a', { class: 'btn btn-outline btn-xs', href: '#/approvals/' + encodeURIComponent(t.id), text: 'فتح الطلب' })
    ]);
}

function duplicatesBlock(rows, twinState) {
    const items = Array.isArray(rows) ? rows : [];
    const box = el('div', { class: 'agent-block' }, el('h4', { text: 'مكرّرات محتملة' }));
    if (!items.length) {
        box.appendChild(el('div', { class: 'crm-subtle', text: 'لا مرشّحين' }));
        return box;
    }
    const list = el('ul', { class: 'agent-list' });
    for (const item of items) {
        if (item && item.kind === 'draft' && item.id) {
            const line = twinLine(item, twinState);
            line.prepend(el('span', { text: 'مسودة في طلب آخر: ' }));
            list.appendChild(line);
            continue;
        }
        const line = el('li', {}, el('span', { text: itemText(item) }));
        if (item && item.kind === 'client' && item.id) {
            line.appendChild(el('a', { class: 'btn btn-outline btn-xs', href: '#/clients/' + item.id, text: 'فتح العميل' }));
        }
        list.appendChild(line);
    }
    box.appendChild(list);
    return box;
}

function touchedBlock(draft) {
    const allowed = AGENT_APPLIED_FIELDS[draft.target_kind] || [];
    const keys = Object.keys(draft.proposed || {}).filter((k) => allowed.indexOf(k) !== -1);
    const target = draft.target_id ? 'تعديل ' + label(DRAFT_TARGET, draft.target_kind) + ' رقم ' + draft.target_id
                                   : draft.target_kind === 'unit'
                                       ? 'إضافة وحدة إلى المشروع رقم ' + valueText((draft.proposed || {}).project_id)
                                       : 'إنشاء ' + label(DRAFT_TARGET, draft.target_kind) + ' جديد';
    return el('div', { class: 'agent-block' }, [
        el('h4', { text: 'ما سيُكتب عند الاعتماد' }),
        el('div', { text: target }),
        el('div', { class: 'crm-subtle', text: keys.length
            ? 'الحقول: ' + keys.map((k) => label(AGENT_FIELD, k, k)).join('، ')
            : 'لا حقول قابلة للكتابة في هذه المسودة' }),
        draft.applied_record ? el('div', { class: 'crm-subtle', text: 'السجل الناتج: ' + draft.applied_record }) : null
    ]);
}

/* ===================== الإجراءات ===================== */

function actionsRow(draft, reload) {
    const row = el('div', { class: 'btn-row' });
    if (draft.status !== 'submitted') {
        row.appendChild(el('span', { class: 'crm-subtle', text: 'لا إجراء متاح على مسودة في هذه الحالة.' }));
        if (draft.status === 'applied' && draft.applied_record) {
            const link = el('span');
            recordLink(draft.target_kind, draft.applied_record).then((target) => {
                if (target && link.isConnected) {
                    append(link, el('a', { class: 'btn btn-secondary btn-xs', href: target.href, text: target.text }));
                }
            });
            row.appendChild(link);
        }
        return row;
    }

    append(row, [
        el('button', {
            type: 'button', class: 'btn btn-outline btn-xs', text: 'تعديل المسودة',
            onclick: () => openDraftEditor(draft, reload)
        }),
        el('button', {
            type: 'button', class: 'btn btn-primary btn-xs', text: 'اعتماد',
            onclick: (event) => approve(draft, event.currentTarget, reload)
        }),
        el('button', {
            type: 'button', class: 'btn btn-danger btn-xs', text: 'رفض مع سبب',
            onclick: () => openDecision(draft, 'reject', reload)
        }),
        el('button', {
            type: 'button', class: 'btn btn-secondary btn-xs', text: 'إعادة للموظف',
            onclick: () => openDecision(draft, 'return', reload)
        })
    ]);
    return row;
}

// الاعتماد يمرّر بصمة ما هو معروض. الدالة ترفض إن تغيّرت المسودة أو الصف الهدف.
async function approve(draft, button, reload) {
    button.disabled = true;
    button.textContent = 'جارٍ الاعتماد…';
    const { data, error } = await supabase.rpc('agent_apply_draft', {
        p_draft: draft.id,
        p_content_hash: draft.content_hash
    });
    button.disabled = false;
    button.textContent = 'اعتماد';

    if (error) return void fail(error, 'تعذّر الاعتماد');
    const result = data || {};
    if (!result.ok) {
        const message = AGENT_APPLY_ERROR[result.code] || 'تعذّر الاعتماد';
        notify(message, 'error', 9000);
        if (result.code === 'record_changed') showChanged(result.current);
        return void reload();
    }

    const target = await recordLink(result.record_kind, result.record_id);
    notify(result.code === 'already_applied' ? 'هذه المسودة مطبَّقة أصلاً — لم يُكتب سجل ثانٍ' : 'تم الاعتماد وكُتب السجل',
           'success', 9000);
    if (target) {
        openModal('تم الاعتماد', el('div', {}, [
            el('p', { text: label(DRAFT_TARGET, result.record_kind) + ' رقم ' + result.record_id }),
            el('div', { class: 'btn-row' }, [
                el('a', { class: 'btn btn-primary btn-sm', href: target.href, text: target.text, onclick: closeModal }),
                el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إغلاق', onclick: closeModal })
            ])
        ]), { narrow: true, onClose: reload });
    } else {
        reload();
    }
}

function showChanged(current) {
    if (!current || typeof current !== 'object') return;
    const rows = el('tbody');
    for (const key of Object.keys(current)) {
        rows.appendChild(el('tr', {}, [
            el('td', { text: label(AGENT_FIELD, key, key) }),
            el('td', { text: valueText(current[key]) })
        ]));
    }
    openModal('السجل الهدف بعد التغيير', el('div', {}, [
        el('p', { class: 'crm-subtle', text: 'لم يُكتب شيء. هذه قيم السجل الآن؛ أعِد بناء المسودة على أساسها.' }),
        el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, rows))
    ]));
}

function openDecision(draft, decision, reload) {
    const reason = el('textarea', { rows: 3, required: decision === 'reject' });
    const saveBtn = el('button', {
        type: 'submit', class: decision === 'reject' ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm',
        text: decision === 'reject' ? 'رفض المسودة' : 'إعادتها للموظف'
    });

    const form = el('form', {}, [
        el('div', { class: 'form-grid' }, field('السبب', reason, {
            span2: true, required: decision === 'reject',
            hint: 'يظهر للموظف في سجل المسودة.'
        })),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = reason.value.trim();
        if (decision === 'reject' && !text) return void notify('السبب مطلوب عند الرفض', 'error');

        saveBtn.disabled = true;
        const failure = await recordDecision(draft, decision, text);
        saveBtn.disabled = false;
        if (failure && failure.error) return void fail(failure.error, failure.prefix);
        if (failure) return void notify(failure.message, 'error', 8000);
        closeModal();
        notify(decision === 'reject' ? 'رُفضت المسودة' : 'أُعيدت المسودة للموظف', 'success');
        reload();
    });

    openModal(decision === 'reject' ? 'رفض المسودة' : 'إعادة المسودة للموظف', form, { narrow: true });
}

// القرار أولاً ببصمة ما رآه المدير، ثم الحالة بشرط أن البصمة لم تتغيّر. رفض المكررات يمرّ من هنا أيضاً.
// null: نجح. وإلا { error, prefix } لخطأ من الخادم، أو { message } إن لم يتغيّر صف
async function recordDecision(draft, decision, text) {
    const { error: decisionError } = await supabase.from('agent_decisions')
        .insert({ draft_id: draft.id, decision: decision, reason: text || null, content_hash: draft.content_hash });
    if (decisionError) return { error: decisionError, prefix: 'تعذّر تسجيل القرار' };
    const { data, error } = await supabase.from('agent_drafts')
        .update({ status: decision === 'reject' ? 'rejected' : 'returned' })
        .eq('id', draft.id)
        .eq('content_hash', draft.content_hash)
        .select('id');
    if (error) return { error, prefix: 'تعذّر حفظ القرار' };
    if (!data || data.length === 0) return { message: 'لا تملك صلاحية أو تغيّرت المسودة' };
    return null;
}

/* ===================== رفض المكررات ===================== */
// مسودات مشاريع جديدة بانتظار الاعتماد تكرّر مشروعاً قائماً أو توأماً طُبّق (dupes.js): تُقرأ من الطابور كله لا من
// الصفحة المعروضة، ويُبقي المدير علامة ما يرفضه، ثم تُرفض واحدة بعد أخرى بمسار زر الرفض نفسه (recordDecision).
// لا اعتماد جماعي: مدقّق نظيف لا يعني بيانات صحيحة، والمشروع المعتمد يصل للعملاء بروابط المشاركة.
// الطابور يُقرأ صفحةً صفحة (500 في القراءة): ما ليس مكرراً يبقى بانتظار الاعتماد، فلا يحجب أقدمُه ما بعده. السقف احتياط
const DUPES_PAGE = 500;
const DUPES_PAGES = 20;

async function rejectDuplicates(button, reload) {
    const caption = button.textContent;
    button.disabled = true;
    button.textContent = 'جارٍ الفحص…';
    let found = null;
    try {
        found = await duplicateCandidates();
    } catch (error) {
        fail(error, 'تعذّر فحص المكررات');
    } finally {
        button.disabled = false;
        button.textContent = caption;
    }
    if (!found) return;
    if (!found.list.length) {
        return void notify(!found.checked ? 'لا مسودات مشاريع جديدة بانتظار الاعتماد'
            : 'لا مكرر واضح بين ' + (found.capped ? 'أقدم ' : '') + found.checked + ' مسودة مشروع جديد بانتظار الاعتماد'
                + (found.capped ? ' — ما بعدها لم يُفحص' : ''), 'info');
    }
    openDuplicates(found, reload);
}

// { list: [{ draft, reason }], checked: عدد المسودات المفحوصة, capped: بلغت السقف }، أو null بعد إبلاغ الخطأ
async function duplicateCandidates() {
    const drafts = [];
    for (let page = 0; page < DUPES_PAGES; page++) {
        const [from, to] = pageRange(page, DUPES_PAGE);
        const { data, error } = await supabase.from('agent_drafts')
            .select('id, request_id, status, target_kind, target_id, content_hash, conflicts, duplicates,'
                + ' name:proposed->>name, city:proposed->>city, district:proposed->>district')
            .eq('target_kind', 'project').is('target_id', null).eq('status', REJECTABLE)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);
        if (error) return fail(error, 'تعذّر تحميل المسودات');
        drafts.push(...(data || []));
        if (!data || data.length < DUPES_PAGE) break;
    }
    const twins = await twinStatuses(drafts);
    if (!twins) {
        notify('تعذّرت قراءة حالة المسودات المطابقة — أعد المحاولة', 'error', 8000);
        return null;
    }
    // مرشّح التكرار سُجّل عند إنشاء المسودة، والمشروع قد يُحذف أو يُرفض بعدها: تُقرأ حالته الآن
    const live = await rowsByIds('projects', 'id, status, deleted_at', projectRefs(drafts, twins));
    if (live.error) return fail(live.error, 'تعذّر تحميل المشاريع المطابقة');
    const projects = new Map(live.data.map((row) => [String(row.id), row]));
    return { list: clearDuplicates(drafts, twins, projects), checked: drafts.length, capped: drafts.length >= DUPES_PAGE * DUPES_PAGES };
}

function openDuplicates(found, reload) {
    const rows = found.list.map((item) => {
        const draft = item.draft;
        const box = el('input', { type: 'checkbox', checked: true });
        const mark = el('span');
        const place = [draft.district, draft.city].filter(Boolean).join(' · ');
        return { item, box, mark, line: el('li', {}, [
            el('label', {}, [box, ' ', el('strong', { text: draft.name || 'بلا اسم' })]),
            place ? el('span', { class: 'crm-subtle', text: place }) : null,
            el('span', { text: '— ' + item.reason }),
            // تبويب جديد: الانتقال في هذا التبويب يغلق النافذة وتضيع العلامات
            el('a', { class: 'btn btn-outline btn-xs', href: '#/approvals/' + encodeURIComponent(draft.request_id),
                target: '_blank', rel: 'noopener', text: 'فتح الطلب' }),
            mark
        ]) };
    });
    const reason = el('textarea', { rows: 2, required: true, value: 'مكرر مع مشروع موجود' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-danger btn-sm' });
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal });
    const footer = el('div', {}, el('div', { class: 'btn-row btn-row-end' }, [cancelBtn, saveBtn]));
    const chosen = () => rows.filter((row) => row.box.checked);
    const count = () => {
        saveBtn.textContent = 'رفض المحدد (' + chosen().length + ')';
        saveBtn.disabled = chosen().length === 0;
    };
    for (const row of rows) row.box.addEventListener('change', count);
    count();

    const form = el('form', {}, [
        el('p', { class: 'crm-subtle', text: 'من ' + found.checked + ' مسودة مشروع جديد بانتظار الاعتماد، هذه ' + rows.length
            + ' مكررة بوضوح: يطابق اسمها مشروعاً قائماً لا يناقضه حيّها، أو طُبّقت مسودة بالاسم نفسه. '
            + 'أزل العلامة عمّا لا تريد رفضه، وافتح الطلب عند الشك. الاعتماد لا يكون جماعياً.' }),
        found.capped ? el('p', { class: 'crm-subtle', text: 'فُحصت أقدم ' + found.checked + ' مسودة فقط — أعد الفحص بعد الرفض لما بعدها.' }) : null,
        el('div', { style: 'max-height:50vh;overflow:auto' }, el('ul', { class: 'agent-list' }, rows.map((row) => row.line))),
        el('div', { class: 'form-grid' }, field('سبب الرفض', reason, {
            span2: true, required: true,
            hint: 'يُسجَّل لكل مسودة مع سبب تكرارها، ويظهر للموظف في سجل المسودة.'
        })),
        footer
    ]);

    // إغلاق النافذة أثناء الرفض (إيقاف، Esc، أو الانتقال لصفحة أخرى) يوقفه بعد المسودة الجارية
    let closed = false;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = reason.value.trim();
        if (!text) return void notify('السبب مطلوب عند الرفض', 'error');
        const picked = chosen();
        if (!picked.length) return;

        for (const control of form.querySelectorAll('input, textarea')) control.disabled = true;
        saveBtn.disabled = true;
        cancelBtn.textContent = 'إيقاف';
        const failed = [];
        let done = 0;
        for (const [i, row] of picked.entries()) {
            if (closed) break;
            saveBtn.textContent = 'جارٍ الرفض ' + (i + 1) + ' من ' + picked.length + '…';
            let failure;
            try {
                failure = await recordDecision(row.item.draft, 'reject', text + ' — ' + row.item.reason);
            } catch (error) {
                failure = { error, prefix: 'تعذّر الرفض' };
            }
            if (failure && failure.error) console.error('[CRM]', failure.error);
            if (failure) failed.push({ row, text: failure.error ? failure.prefix + ': ' + errorText(failure.error) : failure.message });
            else done += 1;
            replace(row.mark, failure ? badge('تعذّر الرفض', 'orange') : badge(label(DRAFT_STATUS, 'rejected'), DRAFT_STATUS_TONE.rejected));
        }

        reload();
        const tally = 'رُفضت ' + done + ' من ' + picked.length + (failed.length ? '، وتعذّر رفض ' + failed.length : '');
        const stopped = done + failed.length < picked.length;
        notify((stopped ? 'أُوقف رفض المكررات: ' : '') + tally, failed.length ? 'error' : stopped ? 'info' : 'success', 9000);
        if (closed) return;
        replace(footer, [
            el('div', { class: failed.length ? 'crm-warn-box' : 'crm-subtle' }, [
                el('div', { text: tally + (failed.length ? ':' : '.') }),
                failed.length ? el('ul', { class: 'agent-list' }, failed.map((f) =>
                    el('li', { text: (f.row.item.draft.name || 'بلا اسم') + ' — ' + f.text }))) : null
            ]),
            el('div', { class: 'btn-row btn-row-end' },
                el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'إغلاق', onclick: closeModal }))
        ]);
    });

    openModal('رفض المسودات المكررة', form, { onClose: () => { closed = true; } });
}

/* ===================== تعديل المسودة ===================== */
// حقل لكل مفتاح في المقترح، بنفس نوع القيمة الأصلية. القيم المركّبة (كائن أو
// مصفوفة كائنات) تُعرض ولا تُحرَّر هنا حتى لا يُفسد تحرير نصي بنية السجل.
// أي تعديل يغيّر content_hash في المشغّل، فيسقط أي اعتماد بُني على النسخة القديمة.

function openDraftEditor(draft, reload) {
    const proposed = draft.proposed || {};
    const keys = Object.keys(proposed);
    const controls = new Map();
    const grid = el('div', { class: 'form-grid' });

    for (const key of keys) {
        const value = proposed[key];
        const complex = value !== null && typeof value === 'object' && !isStringArray(value);
        if (complex) {
            grid.appendChild(field(label(AGENT_FIELD, key, key),
                el('div', { class: 'agent-text', text: valueText(value) }),
                { span2: true, hint: 'قيمة مركّبة — تُعتمد كما هي.' }));
            continue;
        }
        const control = isStringArray(value)
            ? input({ value: value.join('، ') })
            : input({ value: value === null || value === undefined ? '' : String(value) });
        controls.set(key, { control: control, isArray: isStringArray(value), isNumber: typeof value === 'number' });
        grid.appendChild(field(label(AGENT_FIELD, key, key), control,
            { hint: 'اتركه فارغاً ليُحذف الحقل من المقترح' }));
    }

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'حفظ التعديل' });
    const form = el('form', {}, [
        el('p', { class: 'crm-subtle', text: 'التعديل يغيّر بصمة المسودة، فتُعاد إلى الموظف فعلياً: أي اعتماد سابق لهذه النسخة يسقط.' }),
        grid,
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const next = {};
        for (const key of keys) {
            const entry = controls.get(key);
            if (!entry) {
                next[key] = proposed[key];
                continue;
            }
            const raw = entry.control.value.trim();
            if (raw === '') continue;
            if (entry.isArray) {
                next[key] = raw.split(/[،,]/).map((part) => part.trim()).filter(Boolean);
            } else if (entry.isNumber) {
                const n = Number(raw);
                next[key] = Number.isFinite(n) ? n : raw;
            } else {
                next[key] = raw;
            }
        }

        saveBtn.disabled = true;
        // المسودة تعود إلى "أُعيدت للموظف": المدير عدّل المحتوى، ومن أعدّها يراجع
        // ويعيد إرسالها. لا طريق من التعديل إلى الاعتماد في خطوة واحدة.
        const { error: decisionError } = await supabase.from('agent_decisions')
            .insert({ draft_id: draft.id, decision: 'edit', reason: 'تعديل المدير على المسودة', content_hash: draft.content_hash });
        if (decisionError) {
            saveBtn.disabled = false;
            return void fail(decisionError, 'تعذّر تسجيل التعديل');
        }
        const { data, error } = await supabase.from('agent_drafts')
            .update({ status: 'returned' })
            .eq('id', draft.id)
            .eq('content_hash', draft.content_hash)
            .select('id');
        if (error) {
            saveBtn.disabled = false;
            return void fail(error, 'تعذّر تعديل المسودة');
        }
        if (!data || data.length === 0) {
            saveBtn.disabled = false;
            return void notify('لا تملك صلاحية أو تغيّرت المسودة', 'error', 8000);
        }
        const { data: saved, error: saveError } = await supabase.from('agent_drafts')
            .update({ proposed: next })
            .eq('id', draft.id)
            .select('id');
        if (saveError || !saved || saved.length === 0) {
            saveBtn.disabled = false;
            if (saveError) return void fail(saveError, 'تعذّر حفظ المقترح');
            return void notify('لا تملك صلاحية تعديل هذه المسودة', 'error', 8000);
        }
        // التوائم (مسودات معلّقة أخرى تطابق هذه) حُسبت على المقترح القديم: تُعاد مطابقتها على الجديد قبل إعادة العرض.
        // تعذّرها لا يوقف شيئاً — التعديل محفوظ. وإن انتهت المهلة أكمل الخادم الفحص فيظهر أثره عند التحميل التالي.
        // التعديل حُفظ فعلاً: أزرار النافذة تُعطَّل حتى لا يبدو «إلغاء» تراجعاً عنه
        if (draft.target_kind === 'project' && !draft.target_id) {
            for (const button of form.querySelectorAll('button')) button.disabled = true;
            saveBtn.textContent = 'جارٍ فحص المسودات المكررة…';
            await recheckTwins(draft.id);
        }
        if (form.isConnected) closeModal();
        notify('حُفظ التعديل وأُعيدت المسودة للموظف لإعادة إرسالها', 'success', 9000);
        reload();
    });

    openModal('تعديل المسودة', form);
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number');
}
