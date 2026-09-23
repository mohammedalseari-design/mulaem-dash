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
import { recordLink, targetRow, valueText } from './agent.js';
import { sourcesList, decisionsBox } from './assistant.js';
import {
    el, append, replace, loading, empty, errorBox, badge, pager, field, input,
    select, optionList, openModal, closeModal, notify, fail, fmtDateTime
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

    replace(root, el('div', { class: 'crm-card' }, [
        el('div', { class: 'crm-card-head' }, [
            el('h2', { text: 'طلبات الاعتماد' }),
            el('div', {}, [
                el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تنظيف التكرارات', onclick: () => cleanDuplicateProjects(load) }),
                el('a', { class: 'btn btn-outline btn-sm', href: '#/assistant', text: 'المساعد الذكي' })
            ])
        ]),
        el('p', { class: 'crm-subtle', text: 'لا يدخل النظام سجلٌّ من المساعد قبل اعتماد المدير. الاعتماد يكتب السجل مرة واحدة ويُسجَّل في سجل الأحداث.' }),
        el('div', { class: 'crm-toolbar' }, [statusBox, el('div', { class: 'crm-spacer' })]),
        body
    ]));

    let names = new Map();
    try {
        names = await staffMap();
    } catch (error) {
        return void replace(body, errorBox(error, 'تعذّر تحميل أسماء الموظفين'));
    }
    if (!body.isConnected) return;

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);

        // الترشيح على المسودات يتم في الخادم عبر ضم داخلي، فلا تُقرأ طلبات لا مسودات لها
        const embed = view.status ? 'agent_drafts!inner' : 'agent_drafts';
        let query = supabase
            .from('agent_requests')
            .select('id, kind, title, status, created_at, requested_by, agent_sources(id, kind),'
                + ' ' + embed + '(id, status, target_kind, target_id)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (view.status) query = query.eq('agent_drafts.status', view.status);

        const projectsQuery = supabase
            .from('projects')
            .select('id, name, type, city, district, address, purpose, availability, price, area, rooms, images, notes, employee, date_added, details', { count: 'exact' })
            .eq('status', 'pending')
            .order('date_added', { ascending: false });
        const [{ data, error, count }, { data: projects, error: projectsError }] = await Promise.all([query, projectsQuery]);
        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الطابور'));
        if (projectsError) return void replace(body, errorBox(projectsError, 'تعذّر تحميل مشاريع الاعتماد'));
        if ((!data || data.length === 0) && (!projects || projects.length === 0)) {
            return void replace(body, empty(view.status ? 'لا طلبات بهذه الحالة' : 'لا طلبات بعد'));
        }

        const content = [];
        if (projects && projects.length) content.push(projectApprovalSection(projects, load));
        if (data && data.length) content.push(
            el('h3', { class: 'crm-section-title', text: 'طلبات المساعد الذكي' }),
            el('div', { class: 'crm-table-wrap' }, queueTable(data, names)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        );
        replace(body, content);
    }

    await load();
}

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
            const details = Object.assign({}, original.details || {}, project.details || {});
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
                images: project.images && project.images.length ? project.images : original.images
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
        const imageUrl = images[0] || details.image_url;
        const image = imageUrl ? el('img', { class: 'crm-approval-project-image', src: imageUrl, alt: project.name || 'صورة المشروع' }) : null;
        const sourceUrl = details.source_url || project.notes?.match(/https?:\/\/\S+/)?.[0];
        const description = details.description || project.notes;
        list.appendChild(el('article', { class: 'crm-approval-project' }, [
            image || el('div', { class: 'crm-approval-project-image crm-approval-project-placeholder', text: 'بدون صورة' }),
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
                details.contact_phone ? el('a', { class: 'crm-subtle', href: 'tel:' + details.contact_phone, text: 'اتصال: ' + details.contact_phone }) : null,
                details.contact_email ? el('a', { class: 'crm-subtle', href: 'mailto:' + details.contact_email, text: details.contact_email }) : null,
                details.contact_url ? el('a', { class: 'crm-subtle', href: details.contact_url, target: '_blank', rel: 'noopener', text: 'صفحة التواصل' }) : null,
                details.brochure_url ? el('a', { class: 'crm-subtle', href: details.brochure_url, target: '_blank', rel: 'noopener', text: 'فتح البروشور PDF' }) : null,
                sourceUrl ? el('a', { class: 'crm-subtle', href: sourceUrl, target: '_blank', rel: 'noopener', text: 'المصدر الرسمي' }) : el('div', { class: 'crm-subtle', text: 'لا يوجد رابط مصدر' })
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
        const details = Object.assign({}, original.details || {}, project.details || {});
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
            images: project.images && project.images.length ? project.images : original.images
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

function queueTable(rows, names) {
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
        supabase.from('agent_sources').select('id, kind, storage_path, url, bytes, pages')
            .eq('request_id', requestId).order('created_at', { ascending: true }),
        supabase.from('agent_drafts')
            .select('id, target_kind, target_id, proposed, evidence, missing, conflicts, duplicates, suspicious,'
                + ' baseline_hash, content_hash, status, applied_record, created_by, updated_at')
            .eq('request_id', requestId).order('created_at', { ascending: true }),
        staffMap().catch(() => new Map())
    ]);
    if (!root.isConnected) return;

    const reload = () => renderApproval(root, requestId);

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
            sourcesList(sources.data || [], sources.error)
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'الحقول المستخرجة' })),
            drafts.error
                ? errorBox(drafts.error, 'تعذّر تحميل المسودات')
                : ((drafts.data || []).length
                    ? draftCards(drafts.data, names, reload)
                    : empty('لا مسودات على هذا الطلب'))
        ])
    ]);
}

function draftCards(rows, names, reload) {
    const holder = el('div');
    for (const draft of rows) holder.appendChild(draftCard(draft, names, reload));
    return holder;
}

function draftCard(draft, names, reload) {
    const card = el('div', { class: 'agent-draft' });
    const isNew = !draft.target_id;

    card.appendChild(el('div', { class: 'agent-source-head' }, [
        badge(label(DRAFT_TARGET, draft.target_kind), 'blue'),
        el('strong', { text: isNew ? 'سجل جديد' : 'تعديل على سجل قائم — ' + draft.target_id }),
        badge(label(DRAFT_STATUS, draft.status), DRAFT_STATUS_TONE[draft.status] || 'neutral'),
        el('span', { class: 'crm-subtle', text: 'أعدّها ' + staffName(names, draft.created_by) })
    ]));

    const fieldsBox = el('div');
    card.appendChild(fieldsBox);

    // جدول قبل/بعد يحتاج الصف الهدف؛ يُقرأ مرة واحدة لكل مسودة
    if (isNew) {
        replace(fieldsBox, fieldsTable(draft, null));
    } else {
        replace(fieldsBox, loading('جارٍ قراءة السجل الهدف'));
        targetRow(draft.target_kind, draft.target_id).then((row) => {
            if (!fieldsBox.isConnected) return;
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
    card.appendChild(duplicatesBlock(draft.duplicates));
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
    const addRow = (displayKey, value, ev, skipped, cur) => {
        const before = current ? valueText(cur) : null;
        const after = valueText(value);
        const changed = current ? before !== after : true;
        body.appendChild(el('tr', { class: changed ? '' : 'agent-row-same' }, [
            el('td', {}, [
                el('strong', { text: displayKey }),
                skipped ? el('div', {}, badge('لن يُكتب', 'red')) : null
            ]),
            current ? el('td', { class: 'crm-subtle', text: before }) : null,
            el('td', { text: after }),
            el('td', { class: 'crm-subtle' }, evidenceCell(ev))
        ]));
    };

    for (const key of keys) {
        const skipped = allowed.indexOf(key) === -1;
        const value = proposed[key];
        const nested = value && typeof value === 'object' && !Array.isArray(value) && (key === 'details' || key === 'requirement');
        if (!nested) {
            addRow(label(AGENT_FIELD, key, key), value, evidence[key], skipped, current ? current[key] : undefined);
            continue;
        }
        const currentSub = current && current[key] && typeof current[key] === 'object' ? current[key] : {};
        for (const sub of Object.keys(value)) {
            if (sub === 'models' && Array.isArray(value.models)) continue;
            addRow(label(AGENT_FIELD, key, key) + ' — ' + label(AGENT_FIELD, sub, sub), value[sub],
                   evidence[key + '.' + sub], skipped, currentSub[sub]);
        }
    }
    const table = el('table', { class: 'users-table crm-table' }, [head, body]);
    const models = proposed.details && Array.isArray(proposed.details.models) ? proposed.details.models : null;
    if (!models) return table;
    return el('div', {}, [table, unitsTable(models, evidence, allowed.indexOf('details') === -1)]);
}

// وحدات المشروع المقترحة: صف لكل نموذج، والدليل مجمَّع أسفل الجدول لكل خلية لها اقتباس.
const UNIT_COLUMNS = ['name', 'type', 'rooms', 'bathrooms', 'area', 'price', 'count', 'status'];

function unitsTable(models, evidence, skipped) {
    const head = el('thead', {}, el('tr', {}, UNIT_COLUMNS.map((c) => el('th', { text: label(AGENT_FIELD, c, c) }))));
    const body = el('tbody');
    const quotes = el('ul', { class: 'agent-list' });
    models.forEach((m, i) => {
        body.appendChild(el('tr', {}, UNIT_COLUMNS.map((c) => el('td', { text: valueText(m ? m[c] : null) }))));
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
function evidenceCell(ev) {
    if (!ev) return el('span', { text: '— بلا دليل' });
    if (typeof ev !== 'object') return el('span', { text: valueText(ev) });
    const box = el('div');
    if (ev.quote) box.appendChild(el('div', { class: 'agent-quote', text: '«' + String(ev.quote) + '»' }));
    const meta = [];
    if (ev.page !== undefined && ev.page !== null) meta.push('صفحة ' + ev.page);
    if (ev.source_id) meta.push('مصدر ' + String(ev.source_id).slice(0, 8));
    if (ev.verified === true) meta.push('الاقتباس موجود في النص');
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
        parts.push(label(AGENT_FIELD, key, key) + ': ' + valueText(item[key]));
    }
    return parts.join(' — ');
}

// المكرّرات: مرشّحون موجودون فعلاً في النظام. الرابط يُبنى فقط لما نعرف صفحته.
function duplicatesBlock(rows) {
    const items = Array.isArray(rows) ? rows : [];
    const box = el('div', { class: 'agent-block' }, el('h4', { text: 'مكرّرات محتملة' }));
    if (!items.length) {
        box.appendChild(el('div', { class: 'crm-subtle', text: 'لا مرشّحين' }));
        return box;
    }
    const list = el('ul', { class: 'agent-list' });
    for (const item of items) {
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
        // القرار أولاً ببصمة ما رآه المدير، ثم الحالة بشرط أن البصمة لم تتغيّر
        const { error: decisionError } = await supabase.from('agent_decisions')
            .insert({ draft_id: draft.id, decision: decision, reason: text || null, content_hash: draft.content_hash });
        if (decisionError) {
            saveBtn.disabled = false;
            return void fail(decisionError, 'تعذّر تسجيل القرار');
        }
        const { data, error } = await supabase.from('agent_drafts')
            .update({ status: decision === 'reject' ? 'rejected' : 'returned' })
            .eq('id', draft.id)
            .eq('content_hash', draft.content_hash)
            .select('id');
        saveBtn.disabled = false;
        if (error) return void fail(error, 'تعذّر حفظ القرار');
        if (!data || data.length === 0) return void notify('لا تملك صلاحية أو تغيّرت المسودة', 'error', 8000);
        closeModal();
        notify(decision === 'reject' ? 'رُفضت المسودة' : 'أُعيدت المسودة للموظف', 'success');
        reload();
    });

    openModal(decision === 'reject' ? 'رفض المسودة' : 'إعادة المسودة للموظف', form, { narrow: true });
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
        saveBtn.disabled = false;
        if (saveError) return void fail(saveError, 'تعذّر حفظ المقترح');
        if (!saved || saved.length === 0) return void notify('لا تملك صلاحية تعديل هذه المسودة', 'error', 8000);
        closeModal();
        notify('حُفظ التعديل وأُعيدت المسودة للموظف لإعادة إرسالها', 'success', 9000);
        reload();
    });

    openModal('تعديل المسودة', form);
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number');
}
