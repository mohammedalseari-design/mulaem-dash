// ‎#/assistant‎ — «المساعد الذكي»: الموظف يصف ما يريد بالعربية ويرفق المصدر،
// فتُنشأ مسودة تمر على اعتماد المدير. لا شيء هنا يكتب في المخزون.
//
// الاستخراج (الجولة B) تقوم به وظيفة agent-run في الخلفية: الطلب يُحفظ ومرفقاته تُرفع إلى
// المخزن الخاص، ثم تُنادى الوظيفة وتعود فوراً، ومهمة pg_cron تعيد استدعاء ما تعثّر.
// تعذّر الوصول إلى الوظيفة لا يعطّل شيئاً في اللوحة ولا في الـCRM، ولا يمنع حفظ الطلب.
// ما دام مفتاح الخدمة غير مضبوط تظهر «الاستخراج التلقائي غير مفعّل» ويفشل الطلب بهذا السبب.

import { supabase, PAGE_SIZE, pageRange } from './supabase.js';
import { isAdmin, myId, myRole } from './auth.js';
import { staffMap, staffName } from './data.js';
import {
    AGENT_KIND, AGENT_REQUEST_STATUS, AGENT_REQUEST_STATUS_TONE, AGENT_STAGE, AGENT_PICK_ERROR,
    AGENT_SOURCE_KIND, DRAFT_STATUS, DRAFT_STATUS_TONE, DRAFT_TARGET, AGENT_DECISION, label
} from './labels.js';
import {
    ACCEPT_ATTR, MAX_FILE_BYTES, MAX_FILES, MAX_PDF_PAGES,
    baseName, fileKind, safeUrl, signedUrl, sourceRows, sourceText, valueText, createRequest,
    extractionStatus, startExtraction, pickTarget
} from './agent.js';
import {
    el, append, clear, replace, loading, empty, errorBox, badge, pager, field, input,
    openModal, closeModal, notify, fail, errorText, fmtDateTime, number, dash, pageHead, actionBtn
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
        pageHead('المساعد الذكي', 'اختر نوع الطلب واكتب بالعربية وأرفق المصدر. ما يخرج منه مسودة يعتمدها المدير قبل أن تدخل النظام.', [
            isAdmin() ? actionBtn('طلبات الاعتماد', 'clipboard', { href: '#/approvals' }) : null
        ]),
        el('div', { class: 'crm-card' }, [
            statusBanner(),
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
            .select('id, kind, title, status, stage, candidates, error_ar, created_at, agent_sources(id), agent_drafts(id, status)',
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

// حالة وظيفة الاستخراج تُسأل مرة لكل جلسة. لا نعرض شيئاً كأنه نتيجة قبل تفعيل المفتاح.
function statusBanner() {
    const box = el('div', { class: 'crm-hidden' });
    extractionStatus().then((status) => {
        if (!box.isConnected) return;
        if (status.enabled) return;
        box.className = 'crm-warn-box';
        replace(box, status.reachable
            ? [
                el('strong', { text: 'الاستخراج التلقائي غير مفعّل' }),
                el('div', { class: 'crm-subtle', text: status.message || 'لم يُضبط مفتاح الخدمة بعد. يُحفظ الطلب ومرفقاته، ويفشل التنفيذ بهذا السبب حتى يُفعَّل المفتاح.' })
            ]
            : [
                el('strong', { text: 'تعذّر الوصول إلى خدمة الاستخراج' }),
                el('div', { class: 'crm-subtle', text: 'الطلبات تُحفظ كالمعتاد وتُنفَّذ لاحقاً في الخلفية. بقية النظام لا يتأثر.' })
            ]);
    });
    return box;
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
            el('td', {}, statusBadge(row)),
            el('td', { class: 'num', text: number((row.agent_sources || []).length) }),
            el('td', { class: 'num', text: drafts.length + (waiting ? ' (' + waiting + ' بانتظار الاعتماد)' : '') }),
            el('td', { class: 'crm-subtle', text: fmtDateTime(row.created_at) })
        ]));
    }
    return el('table', { class: 'users-table crm-table' }, [head, body]);
}

/* ===================== نموذج الطلب ===================== */

// مواقع إعلانات ترفض القراءة الآلية دائماً (تجربة 2026-10-03 على sa.aqar.fm): الطلب برابطها وحده يفشل
// ويُحسب من الحد اليومي، فيُنبَّه الموظف قبل الإرسال ويُطلب منه النص أو صورة الشاشة.
const CLOSED_SITES = [
    { host: 'aqar.fm', name: 'عقار' },
    { host: 'bayut.sa', name: 'بيوت' },
    { host: 'bayut.com', name: 'بيوت' }
];

function closedSite(value) {
    let host;
    try { host = new URL(value).hostname.toLowerCase(); } catch (_) { return null; }
    return CLOSED_SITES.find((site) => host === site.host || host.endsWith('.' + site.host)) || null;
}

function closedSiteText(site) {
    return 'موقع «' + site.name + '» لا يسمح بقراءة إعلاناته آلياً. الصق نص الإعلان في «نص ملصوق» أو ارفع صورة شاشة له، ويبقى الرابط مرجعاً.';
}

// prefill: { title, instruction } من طلب سابق تعذّر تنفيذه («أعد المحاولة بطلب جديد»)
function openRequestForm(kind, prefill) {
    const title = input({ maxLength: 120, placeholder: 'مثال: كتيّب مشروع الياسمين', value: (prefill && prefill.title) || '' });
    const instruction = el('textarea', { rows: 4, required: true, placeholder: 'اكتب ما تريد من المساعد بالعربية…' });
    if (prefill && prefill.instruction) instruction.value = prefill.instruction;
    const pasted = el('textarea', { rows: 6, placeholder: 'ألصق نص الرسالة أو الإعلان هنا…' });
    const files = el('input', { type: 'file', multiple: true, accept: ACCEPT_ATTR });
    const link = input({ type: 'url', dir: 'ltr', placeholder: 'https://…' });
    const linkWarn = el('div', { class: 'link-warn', role: 'status', hidden: true });
    link.addEventListener('input', () => {
        const site = closedSite(link.value.trim());
        linkWarn.hidden = !site;
        linkWarn.textContent = site ? closedSiteText(site) : '';
    });
    const deep = el('input', { type: 'checkbox' });
    const deepChip = el('label', { class: 'chip' }, [deep, 'تفكير عميق (أبطأ وأغلى)']);
    deep.addEventListener('change', () => deepChip.classList.toggle('on', deep.checked));
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
            append(field('رابط', link, {
                span2: true,
                hint: 'يُقرأ إن كانت الصفحة عامة ويسمح الموقع بالقراءة الآلية، وتُحفظ نسخة منها مع الطلب. «عقار» و«بيوت» لا يسمحان: الصق نص الإعلان أو ارفع صورة شاشة له.'
            }), linkWarn),
            el('div', { class: 'form-group span-2' }, [
                deepChip,
                el('small', { class: 'hint', text: 'يبدأ بالنموذج الأقوى مباشرة بدل السريع — للمصادر المعقدة فقط، ويُحسب من سقف التصعيد اليومي.' })
            ])
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
        // رابط موقع مغلق وحده لا يُرسل: سيفشل ويُحسب من الحد اليومي
        const site = url ? closedSite(url) : null;
        if (site && !text && chosen.length === 0) return void notify(closedSiteText(site), 'error', 9000);

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
                deep: deep.checked,
                text: text,
                files: chosen,
                url: url,
                progress: (message) => { saveBtn.textContent = message; }
            });
            closeModal();
            notify('تم إنشاء الطلب', 'success');
            // النداء يعود فوراً والعمل في الخلفية؛ إن لم يصل فالمُجدوِل يلتقط الطلب خلال دقائق
            startExtraction(requestId);
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

/* ===================== صفحة الطلب ===================== */

// رسائل الفشل كما تعني قارئها. سقف الصرف اليومي يُفشل الطلب نهائياً (agent-run: Stop بلا إعادة)، فعبارة
// الخادم «يُستأنف غداً» غير صحيحة وتُستبدل. ومشكلات المفتاح والرصيد للمدير وحده؛ الموظف يرى الخطوة التالية.
function failureText(text) {
    const message = String(text || '');
    const retryHint = '، ثم اضغط «أعد المحاولة بطلب جديد».';
    if (/سقفه/.test(message)) {
        return isAdmin()
            ? message.replace(/يُستأنف غداً أو يرفع المدير السقف/g, 'هذا الطلب لن يُستأنف تلقائياً: أعد إرساله غداً')
            : 'توقف المساعد اليوم لأنه بلغ حد الصرف اليومي، وهذا الطلب لن يُكمل تلقائياً. انتظر إلى الغد' + retryHint;
    }
    if (!isAdmin() && /OpenRouter|مفتاح|رصيد/.test(message)) {
        return 'المساعد متوقف مؤقتاً لسبب فني عند المدير. أبلغه بذلك' + retryHint;
    }
    return message;
}

// الحالة كما يراها الموظف: استلام، قراءة، استخراج، تحقق، جاهز للمراجعة، تعذّر التنفيذ.
// "جاهز" مع مرشّحين يعني أن الوكيل لم يجزم بالسجل المقصود وينتظر اختيار الموظف.
function statusBadge(request) {
    const waiting = request.status === 'ready' && Array.isArray(request.candidates) && request.candidates.length > 0;
    if (waiting) return badge('بانتظار اختيارك', 'orange');
    if (request.status === 'running' && request.stage && AGENT_STAGE[request.stage]) {
        return badge(AGENT_STAGE[request.stage] + '…', AGENT_REQUEST_STATUS_TONE.running);
    }
    return badge(label(AGENT_REQUEST_STATUS, request.status), AGENT_REQUEST_STATUS_TONE[request.status] || 'neutral');
}

// صفحة الطلب تُعاد قراءتها كل بضع ثوانٍ ما دام التنفيذ جارياً، وتتوقف حين يغادرها المستخدم.
const POLL_MS = 4000;

export async function renderAgentRequest(root, requestId) {
    replace(root, loading());
    await drawAgentRequest(root, requestId);
}

async function drawAgentRequest(root, requestId) {
    const { data: request, error } = await supabase
        .from('agent_requests')
        .select('id, kind, title, instruction, status, stage, candidates, target_id, attempts, error_ar,'
            + ' created_at, updated_at, requested_by, tokens_used, effort_hint, cost_usd')
        .eq('id', requestId)
        .maybeSingle();
    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل الطلب'));
    if (!request) return void replace(root, empty('الطلب غير موجود أو غير مرئي لك'));

    const [sources, drafts, names, calls] = await Promise.all([
        sourceRows(requestId),
        supabase.from('agent_drafts')
            .select('id, target_kind, target_id, status, content_hash, missing, suspicious, updated_at, applied_record')
            .eq('request_id', requestId).order('created_at', { ascending: true }),
        staffMap().catch(() => new Map()),
        // سجل نداءات النموذج للمدير وحده (RLS تسمح بالقراءة للمدير فقط)
        isAdmin()
            ? supabase.from('agent_model_calls').select('id, attempt, tier, model, provider, reasoning, escalated, cost_usd, outcome, error, created_at')
                .eq('request_id', requestId).order('id', { ascending: true })
            : Promise.resolve(null)
    ]);
    if (!root.isConnected) return;

    const draftRows = drafts.data || [];
    const canDelete = request.status === 'queued' && draftRows.length === 0 && request.requested_by === myId();
    const canCancel = (request.status === 'queued' || request.status === 'running') && request.requested_by === myId();
    const canRetry = request.status === 'failed' && request.requested_by === myId();
    const candidates = Array.isArray(request.candidates) ? request.candidates : [];
    const waitingChoice = request.status === 'ready' && candidates.length > 0;
    const inProgress = request.status === 'queued' || request.status === 'running';
    const reload = () => drawAgentRequest(root, requestId);

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: label(AGENT_KIND, request.kind) + (request.title ? ' — ' + request.title : '') }),
                el('div', { class: 'btn-row' }, [
                    el('a', { class: 'btn btn-outline btn-sm', href: '#/assistant', text: 'رجوع' }),
                    canRetry ? el('button', {
                        type: 'button', class: 'btn btn-primary btn-sm', text: 'أعد المحاولة بطلب جديد',
                        onclick: () => openRequestForm(request.kind, { title: request.title, instruction: request.instruction })
                    }) : null,
                    canCancel ? el('button', {
                        type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء التنفيذ',
                        onclick: async () => {
                            const { data, error: cancelError } = await supabase.from('agent_requests')
                                .update({ status: 'cancelled', error_ar: 'أُلغي من الموظف' })
                                .eq('id', requestId).in('status', ['queued', 'running']).select('id');
                            if (cancelError) return void fail(cancelError, 'تعذّر الإلغاء');
                            if (!data || data.length === 0) return void notify('لا تملك صلاحية أو انتهى التنفيذ', 'error');
                            notify('أُلغي الطلب', 'success');
                            reload();
                        }
                    }) : null,
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
                kv('الحالة', statusBadge(request)),
                kv('مقدّم الطلب', staffName(names, request.requested_by)),
                kv('أُنشئ', fmtDateTime(request.created_at)),
                kv('آخر تحديث', fmtDateTime(request.updated_at)),
                request.tokens_used ? kv('الرموز المستهلكة', number(request.tokens_used)) : null,
                request.attempts > 1 ? kv('المحاولات', number(request.attempts)) : null
            ]),
            progressSteps(request),
            request.error_ar && !waitingChoice ? el('div', { class: request.status === 'failed' ? 'crm-error' : 'crm-warn-box', text: failureText(request.error_ar) }) : null,
            waitingChoice ? candidatePicker(request, candidates, reload) : null,
            request.status === 'ready' && !waitingChoice && draftRows.length === 0
                ? el('div', { class: 'crm-warn-box', text: 'انتهى التنفيذ دون مسودات.' }) : null,
            el('h3', { text: 'التعليمات' }),
            el('div', { class: 'agent-text', text: request.instruction }),
            calls ? modelCalls(request, calls.data || [], calls.error) : null
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'المصادر' })),
            sourcesList(sources.data || [], sources.error, request.status)
        ]),
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, el('h2', { text: 'المسودات' })),
            draftsList(draftRows, drafts.error, requestId, reload)
        ])
    ]);

    if (inProgress) {
        setTimeout(() => {
            if (root.isConnected && location.hash === '#/assistant/' + requestId) drawAgentRequest(root, requestId);
        }, POLL_MS);
    }
}

function kv(labelText, value) {
    return el('div', { class: 'kv' }, [el('span', { text: labelText }), el('span', {}, value)]);
}

// محاولات النموذج للمدير: أي نموذج ومن خدمه، وهل عمل التفكير، وكم كلّفت. التكلفة من ردّ OpenRouter نفسه،
// والمزوّد من خدم النداء أو من رفضه، ومع الخطأ سببه كما ردّه المزوّد.
const CALL_OUTCOME = { ok: 'مقبولة', invalid: 'رفضها المدقق', error: 'خطأ من الخدمة' };
const usd = (value) => (value === null || value === undefined ? '—' : '$' + Number(value).toFixed(4));

function modelCalls(request, rows, error) {
    if (error) return errorBox(error, 'تعذّر تحميل محاولات النموذج');
    if (!rows.length) return null;
    const head = el('thead', {}, el('tr', {}, ['المحاولة', 'النموذج', 'المزوّد', 'التفكير', 'النتيجة', 'التكلفة'].map((t) => el('th', { text: t }))));
    const body = el('tbody', {}, rows.map((row) => el('tr', {}, [
        el('td', { class: 'num', text: String(row.attempt) }),
        el('td', { dir: 'ltr', text: row.model + (row.escalated ? ' ↑' : '') }),
        el('td', { dir: 'ltr', text: row.provider || '—' }),
        el('td', { text: row.reasoning === 'off' ? 'متوقف' : 'يعمل' }),
        el('td', {}, [
            el('span', { text: CALL_OUTCOME[row.outcome] || row.outcome }),
            row.error ? el('small', { class: 'crm-subtle', dir: 'ltr', style: 'display:block', title: row.error, text: row.error.slice(0, 160) }) : null
        ]),
        el('td', { class: 'num', dir: 'ltr', text: usd(row.cost_usd) })
    ])));
    return el('div', {}, [
        el('h3', { text: 'محاولات النموذج' + (request.effort_hint === 'deep' ? ' — طُلب تفكير عميق' : '') }),
        el('div', { class: 'crm-table-wrap' }, el('table', { class: 'users-table crm-table' }, [head, body])),
        el('small', { class: 'hint', text: 'التكلفة الإجمالية للطلب: ' + usd(request.cost_usd) + ' — السهم ↑ يعني محاولة تُحسب في سقف التصعيد اليومي.' })
    ]);
}

// شريط المراحل: استلام ← قراءة ← استخراج ← تحقق ← جاهز للمراجعة (أو تعذّر التنفيذ)
function progressSteps(request) {
    const steps = [
        ['queued', 'استلام'], ['reading', 'قراءة'], ['extracting', 'استخراج'], ['validating', 'تحقق'], ['ready', 'جاهز للمراجعة']
    ];
    const order = steps.map((s) => s[0]);
    let current;
    if (request.status === 'queued') current = 0;
    else if (request.status === 'running') current = Math.max(1, order.indexOf(request.stage || 'reading'));
    else if (request.status === 'ready') current = 4;
    else current = -1;

    const box = el('div', { class: 'chips' });
    for (let i = 0; i < steps.length; i++) {
        const done = current >= 0 && i < current;
        const active = i === current;
        box.appendChild(el('span', {
            class: 'chip' + (active ? ' on' : ''),
            style: done ? 'opacity:.55' : (active ? '' : 'opacity:.35'),
            text: (done ? '✓ ' : '') + steps[i][1]
        }));
    }
    if (request.status === 'failed') box.appendChild(badge('تعذّر التنفيذ', 'red'));
    if (request.status === 'cancelled') box.appendChild(badge('أُلغي', 'neutral'));
    return box;
}

// الوكيل لم يجزم بالمشروع أو الوحدة: الموظف يختار من المرشّحين الذين كتبهم الخادم فقط،
// ثم يعود الطلب إلى الانتظار ويُعاد تنفيذه على السجل المختار.
// طلب مشروع اسمه يطابق مشروعاً قائماً لم تُنشأ له مسودة: خياره الوحيد «أنشئه مشروعاً جديداً» (project_new)، والرسالة
// (error_ar) تسمّي المشروع القائم وتدلّ على طلب التحديث
function candidatePicker(request, candidates, reload) {
    const onlyNew = candidates.every((c) => c && c.kind === 'project_new');
    const list = el('div', { class: 'agent-list' });
    const buttons = [];
    for (const c of candidates) {
        const button = el('button', {
            type: 'button', class: 'btn btn-outline btn-xs',
            text: 'اختيار',
            onclick: async () => {
                for (const b of buttons) b.disabled = true;
                try {
                    const result = await pickTarget(request.id, String(c.id));
                    if (!result.ok) {
                        for (const b of buttons) b.disabled = false;
                        return void notify(AGENT_PICK_ERROR[result.code] || 'تعذّر الاختيار', 'error', 8000);
                    }
                    notify('حُفظ اختيارك وأُعيد الطلب للتنفيذ', 'success');
                    startExtraction(request.id);
                    reload();
                } catch (error) {
                    for (const b of buttons) b.disabled = false;
                    fail(error, 'تعذّر الاختيار');
                }
            }
        });
        buttons.push(button);
        list.appendChild(el('div', { class: 'agent-source-head' }, [
            badge(c.kind === 'unit' ? 'وحدة' : c.kind === 'project_new' ? 'مشروع جديد' : 'مشروع', 'blue'),
            el('strong', { text: dash(c.label) }),
            el('span', { class: 'crm-subtle', text: dash(c.reason) }),
            button
        ]));
    }
    return el('div', { class: 'crm-warn-box' }, [
        el('strong', { text: request.error_ar || 'اختر السجل المقصود' }),
        el('div', { class: 'crm-subtle', text: onlyNew
            ? 'لن يُنشأ مشروع ثانٍ بالاسم نفسه إلا باختيارك. إن كان العرض للمشروع القائم فلا تختر شيئاً هنا، وأنشئ طلب «'
                + AGENT_KIND.update + '» بالمصدر نفسه.'
            : 'لن يُخمَّن السجل نيابةً عنك. إن لم يكن المقصود في القائمة فأعد صياغة التعليمات أو أرفق مصدراً أوضح.' }),
        list
    ]);
}

// status: حالة الطلب؛ رابط لم يُفتح «يُفتح عند التشغيل» ما دام الطلب ينتظر أو يعمل، وبعدها «لم يُفتح»
export function sourcesList(rows, error, status) {
    if (error) return errorBox(error, 'تعذّر تحميل المصادر');
    if (!rows.length) return empty('لا مصادر');

    const list = el('div', { class: 'agent-sources' });
    for (const row of rows) {
        const preview = el('div');
        const header = el('div', { class: 'agent-source-head' }, [
            badge(label(AGENT_SOURCE_KIND, row.kind), 'blue'),
            el('span', { text: row.kind === 'url' ? (row.title || dash(row.url)) : baseName(row.storage_path) }),
            el('span', { class: 'crm-subtle', text: sourceMeta(row) })
        ]);

        if (row.kind === 'url') {
            const href = safeUrl(row.url);
            header.appendChild(href
                ? el('a', { class: 'btn btn-outline btn-xs', href: href, target: '_blank', rel: 'noopener noreferrer', text: 'فتح الرابط' })
                : el('span', { class: 'crm-subtle', text: 'رابط غير صالح' }));
            // الصفحة المقروءة محفوظة مع الطلب: تُعرض كما قرأها المساعد لا كما هي على الموقع الآن
            if (row.storage_path) {
                header.appendChild(el('button', {
                    type: 'button', class: 'btn btn-outline btn-xs', text: 'عرض المصدر',
                    onclick: (event) => showSource(row, preview, event.currentTarget)
                }));
            }
            header.appendChild(el('span', {
                class: 'crm-subtle',
                text: row.storage_path ? 'قُرئت ' + fmtDateTime(row.fetched_at)
                    : row.fetch_error ? '⚠ ' + row.fetch_error
                    : (status === 'queued' || status === 'running') ? 'يُفتح عند تشغيل الطلب'
                    : 'لم يُفتح'
            }));
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
        // صفحة قُرئت من رابط تُحفظ نصاً (أو ملف PDF إن كان الرابط ملفاً)
        if (row.kind === 'text' || (row.kind === 'url' && !/\.pdf$/i.test(row.storage_path || ''))) {
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
                : null,
            Array.isArray(row.suspicious) && row.suspicious.length
                ? el('div', { class: 'crm-error', text: 'في المصدر نص يشبه أوامر موجّهة للمساعد (' + row.suspicious.length + ') — تم تجاهله وسيراه المدير' })
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
