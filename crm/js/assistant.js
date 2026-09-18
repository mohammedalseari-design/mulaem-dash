// ‎#/assistant‎ — «المساعد الذكي»: الموظف يصف ما يريد بالعربية ويرفق المصدر،
// فتُنشأ مسودة تمر على اعتماد المدير. لا شيء هنا يكتب في المخزون.
//
// في هذه الجولة لا يوجد استخراج آلي بعد (EXTRACTION_ENABLED = false): الطلب يُحفظ
// ومرفقاته تُرفع إلى المخزن الخاص، ولا يُنادى أي خادم خارجي — فتعذّر الوصول إلى
// وظيفة الاستخراج لا يعطّل شيئاً في اللوحة ولا في الـCRM.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { isAdmin, myId, myRole } from './auth.js';
import { staffMap, staffName } from './data.js';
import {
    AGENT_KIND, AGENT_REQUEST_STATUS, AGENT_REQUEST_STATUS_TONE,
    AGENT_SOURCE_KIND, DRAFT_STATUS, DRAFT_STATUS_TONE, DRAFT_TARGET, AGENT_DECISION, label
} from './labels.js';
import {
    ACCEPT_ATTR, EXTRACTION_ENABLED, MAX_FILE_BYTES, MAX_FILES, MAX_PDF_PAGES, BUCKET,
    baseName, fileKind, pdfPageCount, safeUrl, sha256Hex, signedUrl, sourceText, storageName, valueText
} from './agent.js';
import {
    el, append, clear, replace, loading, empty, errorBox, badge, pager, field, input,
    openModal, closeModal, notify, fail, errorText, fmtDateTime, number, dash
} from './ui.js';

/* ===================== البلاطات الأربع ===================== */

const TILES = [
    { kind: 'client',  hint: 'رسالة أو نص فيه بيانات عميل ومطلبه' },
    { kind: 'project', hint: 'كتيّب أو عرض سعر لمشروع أو وحدات' },
    { kind: 'update',  hint: 'تحديث سعر أو حالة أو بيانات مشروع قائم' },
    { kind: 'external', hint: 'عرض من موقع خارجي — يبقى مرجعاً ولا يُنشر باسم ملائم',
      adminOnly: true, soon: true }
];

export async function renderAssistant(root) {
    const tiles = el('div', { class: 'agent-tiles' });
    for (const tile of TILES) {
        if (tile.adminOnly && !isAdmin()) continue;
        // مركز الاتصال ينشئ طلبات العملاء وحدها — والقاعدة ترفض ما عداها على كل حال
        if (myRole() === 'callcenter' && tile.kind !== 'client') continue;
        const soon = Boolean(tile.soon);
        tiles.appendChild(el('button', {
            type: 'button',
            class: 'agent-tile' + (soon ? ' agent-tile-soon' : ''),
            disabled: soon,
            onclick: soon ? null : () => openRequestForm(tile.kind)
        }, [
            el('strong', { text: AGENT_KIND[tile.kind] }),
            el('span', { class: 'crm-subtle', text: tile.hint }),
            soon ? badge('غير متاح بعد', 'neutral') : null
        ]));
    }

    const body = el('div');
    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'المساعد الذكي' }),
                isAdmin() ? el('a', { class: 'btn btn-outline btn-sm', href: '#/approvals', text: 'طلبات الاعتماد' }) : null
            ]),
            el('p', { class: 'crm-subtle', text: 'اكتب ما تريد بالعربية وأرفق المصدر. ما يخرج منه مسودة يعتمدها المدير قبل أن تدخل النظام.' }),
            EXTRACTION_ENABLED ? null : el('div', { class: 'crm-warn-box' }, [
                el('strong', { text: 'الاستخراج التلقائي غير مفعّل' }),
                el('div', { class: 'crm-subtle', text: 'يُحفظ الطلب ومرفقاته الآن، ويبدأ الاستخراج بعد تفعيل مفتاح الخدمة. لا تُعرض أي نتيجة قبل ذلك.' })
            ]),
            tiles
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'طلباتي' })),
            body
        ])
    ]);

    const view = { page: 0 };

    async function load() {
        replace(body, loading());
        const [from, to] = pageRange(view.page);
        const { data, error, count } = await supabase
            .from('agent_requests')
            .select('id, kind, title, status, error_ar, created_at, agent_sources(id), agent_drafts(id, status)',
                    { count: 'exact' })
            .eq('requested_by', myId())
            .order('created_at', { ascending: false })
            .range(from, to);

        if (!body.isConnected) return;
        if (error) return void replace(body, errorBox(error, 'تعذّر تحميل الطلبات'));
        if (!data || data.length === 0) return void replace(body, empty('لا توجد طلبات بعد'));

        replace(body, [
            el('div', { class: 'crm-table-wrap' }, requestsTable(data)),
            pager(view.page, count || data.length, (p) => { view.page = p; load(); }, PAGE_SIZE)
        ]);
    }

    await load();
}

function requestsTable(rows) {
    const head = el('thead', {}, el('tr', {}, [
        el('th', { text: 'النوع' }),
        el('th', { text: 'العنوان' }),
        el('th', { text: 'الحالة' }),
        el('th', { text: 'المرفقات' }),
        el('th', { text: 'المسودات' }),
        el('th', { text: 'التاريخ' })
    ]));

    const body = el('tbody');
    for (const row of rows) {
        const drafts = row.agent_drafts || [];
        const waiting = drafts.filter((d) => d.status === 'submitted').length;
        body.appendChild(el('tr', {
            class: 'clickable',
            onclick: () => { location.hash = '#/assistant/' + row.id; }
        }, [
            el('td', { text: label(AGENT_KIND, row.kind) }),
            el('td', {}, el('strong', { text: dash(row.title) })),
            el('td', {}, badge(label(AGENT_REQUEST_STATUS, row.status),
                               AGENT_REQUEST_STATUS_TONE[row.status] || 'neutral')),
            el('td', { class: 'num', text: number((row.agent_sources || []).length) }),
            el('td', { class: 'num', text: drafts.length + (waiting ? ' (' + waiting + ' بانتظار الاعتماد)' : '') }),
            el('td', { class: 'crm-subtle', text: fmtDateTime(row.created_at) })
        ]));
    }
    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

/* ===================== نموذج الطلب ===================== */

function openRequestForm(kind) {
    const title = input({ maxLength: 120, placeholder: 'مثال: كتيّب مشروع الياسمين' });
    const instruction = el('textarea', { rows: 4, required: true, placeholder: 'اكتب ما تريد من المساعد بالعربية…' });
    const pasted = el('textarea', { rows: 6, placeholder: 'ألصق نص الرسالة أو الإعلان هنا…' });
    const files = el('input', { type: 'file', multiple: true, accept: ACCEPT_ATTR });
    const link = input({ type: 'url', dir: 'ltr', placeholder: 'https://…' });
    const notice = el('div', { class: 'crm-hidden' });

    const saveBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'إنشاء الطلب' });
    const form = el('form', {}, [
        notice,
        el('div', { class: 'form-grid' }, [
            field('عنوان مختصر', title),
            field('التعليمات', instruction, { required: true, span2: true }),
            field('نص ملصوق', pasted, { span2: true, hint: 'يُحفظ ملفاً نصياً في المخزن الخاص، ولا يُقرأ إلا برابط موقّع.' }),
            field('ملفات', files, {
                span2: true,
                hint: 'PDF أو صور أو CSV/XLSX — حتى ' + MAX_FILES + ' ملفات، ' + (MAX_FILE_BYTES / 1048576)
                    + ' ميغابايت للملف، و' + MAX_PDF_PAGES + ' صفحة للـPDF.'
            }),
            field('رابط', link, { span2: true, hint: 'يُسجَّل كمصدر فقط؛ لا يُفتح ولا يُنسخ محتواه في هذه الجولة.' })
        ]),
        el('div', { class: 'btn-row btn-row-end' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء', onclick: closeModal }),
            saveBtn
        ])
    ]);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = pasted.value.trim();
        const chosen = Array.from(files.files || []);
        const url = link.value.trim();

        if (!instruction.value.trim()) return void notify('التعليمات مطلوبة', 'error');
        if (!text && chosen.length === 0 && !url) {
            return void notify('أضف مصدراً واحداً على الأقل: نصاً أو ملفاً أو رابطاً', 'error', 7000);
        }
        if (url && !safeUrl(url)) return void notify('الرابط يجب أن يبدأ بـ http:// أو https://', 'error');

        const total = chosen.length + (text ? 1 : 0) + (url ? 1 : 0);
        if (total > MAX_FILES) return void notify('حد المرفقات ' + MAX_FILES + ' لكل طلب', 'error');
        for (const file of chosen) {
            if (file.size > MAX_FILE_BYTES) {
                return void notify('الملف «' + file.name + '» يتجاوز ' + (MAX_FILE_BYTES / 1048576) + ' ميغابايت', 'error', 7000);
            }
            if (!fileKind(file.name)) {
                return void notify('نوع الملف «' + file.name + '» غير مدعوم', 'error', 7000);
            }
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'جارٍ الحفظ…';
        clear(notice).className = 'crm-hidden';

        try {
            const requestId = await createRequest(kind, {
                title: title.value.trim(),
                instruction: instruction.value.trim(),
                text: text,
                files: chosen,
                url: url,
                progress: (message) => { saveBtn.textContent = message; }
            });
            closeModal();
            notify('تم إنشاء الطلب', 'success');
            location.hash = '#/assistant/' + requestId;
        } catch (error) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'إنشاء الطلب';
            notice.className = 'crm-error';
            replace(notice, el('div', { text: 'تعذّر إنشاء الطلب: ' + errorText(error) }));
        }
    });

    openModal(AGENT_KIND[kind], form);
}

// ترتيب مقصود: صف الطلب أولاً (معرّفه هو مجلد المخزن الذي تسمح به سياسة الرفع)،
// ثم رفع كل مصدر، ثم صفّه في agent_sources. فشل أي مرفق يحذف الطلب كله حتى لا
// يبقى طلب نصف مكتمل يُستخرج من مصادر ناقصة.
async function createRequest(kind, payload) {
    const { data: request, error } = await supabase
        .from('agent_requests')
        .insert({ kind: kind, title: payload.title || null, instruction: payload.instruction })
        .select('id')
        .maybeSingle();
    if (error) throw error;
    if (!request) throw new Error('لا تملك صلاحية إنشاء هذا الطلب');

    try {
        let index = 0;
        if (payload.text) {
            index += 1;
            payload.progress('جارٍ رفع النص…');
            const blob = new Blob([payload.text], { type: 'text/plain;charset=utf-8' });
            const buffer = await blob.arrayBuffer();
            await putSource(request.id, index + '-pasted.txt', blob, 'text/plain;charset=utf-8', {
                kind: 'text', bytes: blob.size, sha256: await sha256Hex(buffer)
            });
        }
        for (const file of payload.files) {
            index += 1;
            payload.progress('جارٍ رفع ' + file.name + '…');
            const spec = fileKind(file.name);
            const buffer = await file.arrayBuffer();
            const pages = spec.kind === 'pdf' ? pdfPageCount(buffer) : null;
            if (pages !== null && pages > MAX_PDF_PAGES) {
                throw new Error('الملف «' + file.name + '» يتجاوز ' + MAX_PDF_PAGES + ' صفحة');
            }
            await putSource(request.id, storageName(index, file.name), file, spec.mime, {
                kind: spec.kind, bytes: file.size, pages: pages, sha256: await sha256Hex(buffer)
            });
        }
        if (payload.url) {
            const { error: urlError } = await supabase.from('agent_sources')
                .insert({ request_id: request.id, kind: 'url', url: payload.url });
            if (urlError) throw urlError;
        }
    } catch (uploadError) {
        await supabase.from('agent_requests').delete().eq('id', request.id);
        throw uploadError;
    }

    return request.id;
}

async function putSource(requestId, name, body, contentType, row) {
    const path = requestId + '/' + name;
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
        contentType: contentType, upsert: false
    });
    if (error) throw error;
    const { error: rowError } = await supabase.from('agent_sources').insert(Object.assign({
        request_id: requestId, storage_path: path
    }, row));
    if (rowError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw rowError;
    }
}

/* ===================== صفحة الطلب ===================== */

export async function renderAgentRequest(root, requestId) {
    replace(root, loading());

    const { data: request, error } = await supabase
        .from('agent_requests')
        .select('id, kind, title, instruction, status, error_ar, created_at, updated_at, requested_by, tokens_used')
        .eq('id', requestId)
        .maybeSingle();
    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل الطلب'));
    if (!request) return void replace(root, empty('الطلب غير موجود أو غير مرئي لك'));

    const [sources, drafts, names] = await Promise.all([
        supabase.from('agent_sources').select('id, kind, storage_path, url, bytes, pages').eq('request_id', requestId)
            .order('created_at', { ascending: true }),
        supabase.from('agent_drafts')
            .select('id, target_kind, target_id, status, content_hash, missing, updated_at, applied_record')
            .eq('request_id', requestId).order('created_at', { ascending: true }),
        staffMap().catch(() => new Map())
    ]);
    if (!root.isConnected) return;

    const draftRows = drafts.data || [];
    const canDelete = request.status === 'queued' && draftRows.length === 0 && request.requested_by === myId();

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: label(AGENT_KIND, request.kind) + (request.title ? ' — ' + request.title : '') }),
                el('div', { class: 'btn-row' }, [
                    el('a', { class: 'btn btn-outline btn-sm', href: '#/assistant', text: 'رجوع' }),
                    canDelete ? el('button', {
                        type: 'button', class: 'btn btn-danger btn-sm', text: 'حذف الطلب',
                        onclick: async () => {
                            const { data, error: delError } = await supabase.from('agent_requests')
                                .delete().eq('id', requestId).select('id');
                            if (delError) return void fail(delError, 'تعذّر حذف الطلب');
                            if (!data || data.length === 0) return void notify('لا تملك صلاحية', 'error');
                            notify('حُذف الطلب', 'success');
                            location.hash = '#/assistant';
                        }
                    }) : null
                ])
            ]),
            el('div', { class: 'kv-grid' }, [
                kv('الحالة', badge(label(AGENT_REQUEST_STATUS, request.status),
                                   AGENT_REQUEST_STATUS_TONE[request.status] || 'neutral')),
                kv('مقدّم الطلب', staffName(names, request.requested_by)),
                kv('أُنشئ', fmtDateTime(request.created_at)),
                kv('آخر تحديث', fmtDateTime(request.updated_at))
            ]),
            request.error_ar ? el('div', { class: 'crm-error', text: request.error_ar }) : null,
            EXTRACTION_ENABLED || draftRows.length ? null : el('div', { class: 'crm-warn-box' }, [
                el('strong', { text: 'الاستخراج التلقائي غير مفعّل' }),
                el('div', { class: 'crm-subtle', text: 'الطلب محفوظ ومرفقاته مخزَّنة. لن تظهر أي حقول مستخرجة قبل تفعيل مفتاح الخدمة.' })
            ]),
            el('h3', { text: 'التعليمات' }),
            el('div', { class: 'agent-text', text: request.instruction })
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'المصادر' })),
            sourcesList(sources.data || [], sources.error)
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'المسودات' })),
            draftsList(draftRows, drafts.error, requestId, () => renderAgentRequest(root, requestId))
        ])
    ]);
}

function kv(labelText, value) {
    return el('div', { class: 'kv' }, [el('span', { text: labelText }), el('span', {}, value)]);
}

export function sourcesList(rows, error) {
    if (error) return errorBox(error, 'تعذّر تحميل المصادر');
    if (!rows.length) return empty('لا مصادر');

    const list = el('div', { class: 'agent-sources' });
    for (const row of rows) {
        const preview = el('div');
        const header = el('div', { class: 'agent-source-head' }, [
            badge(label(AGENT_SOURCE_KIND, row.kind), 'blue'),
            el('span', { text: row.kind === 'url' ? dash(row.url) : baseName(row.storage_path) }),
            el('span', { class: 'crm-subtle', text: sourceMeta(row) })
        ]);

        if (row.kind === 'url') {
            const href = safeUrl(row.url);
            header.appendChild(href
                ? el('a', { class: 'btn btn-outline btn-xs', href: href, target: '_blank', rel: 'noopener noreferrer', text: 'فتح الرابط' })
                : el('span', { class: 'crm-subtle', text: 'رابط غير صالح' }));
        } else {
            header.appendChild(el('button', {
                type: 'button', class: 'btn btn-outline btn-xs', text: 'عرض المصدر',
                onclick: (event) => showSource(row, preview, event.currentTarget)
            }));
        }
        list.appendChild(el('div', { class: 'agent-source' }, [header, preview]));
    }
    return list;
}

function sourceMeta(row) {
    const parts = [];
    if (row.bytes) parts.push(Math.max(1, Math.round(row.bytes / 1024)) + ' ك.ب');
    if (row.pages) parts.push(row.pages + ' صفحة');
    return parts.join(' — ');
}

// الرابط الموقّع يُطلب عند الضغط لا عند بناء الصفحة: عمره دقيقتان ولا يُخزَّن.
async function showSource(row, holder, button) {
    button.disabled = true;
    replace(holder, loading('جارٍ إصدار رابط موقّع'));
    try {
        if (row.kind === 'text') {
            const text = await sourceText(row.storage_path);
            replace(holder, el('div', { class: 'agent-text', text: text }));
        } else if (row.kind === 'image') {
            const url = await signedUrl(row.storage_path);
            replace(holder, el('img', { class: 'agent-image', src: url, alt: baseName(row.storage_path) }));
        } else {
            const url = await signedUrl(row.storage_path);
            replace(holder, el('a', {
                class: 'btn btn-secondary btn-xs', href: url, target: '_blank', rel: 'noopener noreferrer',
                text: 'فتح الملف في تبويب جديد (رابط صالح دقيقتين)'
            }));
        }
    } catch (error) {
        replace(holder, errorBox(error, 'تعذّر عرض المصدر'));
    } finally {
        button.disabled = false;
    }
}

function draftsList(rows, error, requestId, reload) {
    if (error) return errorBox(error, 'تعذّر تحميل المسودات');
    if (!rows.length) return empty('لا مسودات على هذا الطلب بعد');

    const list = el('div', { class: 'agent-drafts' });
    for (const row of rows) {
        const canSubmit = row.status === 'draft' || row.status === 'returned';
        const card = el('div', { class: 'agent-draft' }, [
            el('div', { class: 'agent-source-head' }, [
                badge(label(DRAFT_TARGET, row.target_kind), 'neutral'),
                el('strong', { text: row.target_id ? 'تعديل على سجل قائم' : 'سجل جديد' }),
                badge(label(DRAFT_STATUS, row.status), DRAFT_STATUS_TONE[row.status] || 'neutral'),
                el('span', { class: 'crm-subtle', text: fmtDateTime(row.updated_at) })
            ]),
            (row.missing || []).length
                ? el('div', { class: 'crm-subtle', text: 'حقول لم يذكرها المصدر: ' + valueText(row.missing) })
                : null
        ]);

        const actions = el('div', { class: 'btn-row' });
        if (canSubmit) {
            actions.appendChild(el('button', {
                type: 'button', class: 'btn btn-primary btn-xs', text: 'إرسال للاعتماد',
                onclick: (event) => submitDraft(row, event.currentTarget, reload)
            }));
        }
        if (isAdmin()) {
            actions.appendChild(el('a', {
                class: 'btn btn-outline btn-xs', href: '#/approvals/' + requestId, text: 'شاشة الاعتماد'
            }));
        }
        card.appendChild(actions);
        card.appendChild(decisionsBox(row.id));
        list.appendChild(card);
    }
    return list;
}

async function submitDraft(draft, button, reload) {
    button.disabled = true;
    button.textContent = 'جارٍ الإرسال…';
    // القرار يُسجَّل ببصمة ما كان الموظف ينظر إليه، ثم تتغيّر الحالة بشرط أن
    // البصمة لم تتبدّل بينهما — فلا تُرسَل نسخة غير التي رآها.
    const { error: decisionError } = await supabase.from('agent_decisions')
        .insert({ draft_id: draft.id, decision: 'submit', content_hash: draft.content_hash });
    if (decisionError) {
        button.disabled = false;
        button.textContent = 'إرسال للاعتماد';
        return void fail(decisionError, 'تعذّر تسجيل الإرسال');
    }
    const { data, error } = await supabase.from('agent_drafts')
        .update({ status: 'submitted' })
        .eq('id', draft.id)
        .eq('content_hash', draft.content_hash)
        .select('id');
    button.disabled = false;
    button.textContent = 'إرسال للاعتماد';
    if (error) return void fail(error, 'تعذّر إرسال المسودة');
    if (!data || data.length === 0) return void notify('لا تملك صلاحية أو تغيّرت المسودة', 'error', 8000);
    notify('أُرسلت المسودة للاعتماد', 'success');
    if (reload) reload();
}

// سجل القرارات على المسودة: من أرسل ومن ردّ ولماذا.
export function decisionsBox(draftId) {
    const holder = el('div', { class: 'agent-decisions' });
    supabase.from('agent_decisions')
        .select('id, decision, reason, actor_id, created_at')
        .eq('draft_id', draftId)
        .order('created_at', { ascending: true })
        .then(async ({ data, error }) => {
            if (!holder.isConnected || error || !data || data.length === 0) return;
            const names = await staffMap().catch(() => new Map());
            const list = el('ul', { class: 'timeline' });
            for (const row of data) {
                list.appendChild(el('li', {}, [
                    el('div', { class: 'tl-head' }, [
                        el('span', { class: 'tl-title', text: label(AGENT_DECISION, row.decision) }),
                        el('span', { class: 'tl-meta', text: staffName(names, row.actor_id) + ' — ' + fmtDateTime(row.created_at) })
                    ]),
                    row.reason ? el('div', { class: 'tl-body', text: row.reason }) : null
                ]));
            }
            append(clear(holder), list);
        });
    return holder;
}
