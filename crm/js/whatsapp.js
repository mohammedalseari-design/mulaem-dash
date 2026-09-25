// ‎#/whatsapp‎ — «عروض واتساب» (للمدير): مراجعة العروض الجديدة في مجموعات واتساب
// وإرسال المختار منها إلى المساعد الذكي، فيخرج كل عرض مسودة تمر على الاعتماد.
//
// المصدر ملف «تصدير الدردشة» الذي يصدّره المالك من هاتفه — الواجهة الرسمية لا تقرأ المجموعات.
// قراءة الملف وفرز العروض تتم في المتصفح؛ لا يُرفع شيء إلا العرض الذي يختاره المدير.
//
// ما الجديد؟ لكل مجموعة مؤشر «آخر مراجعة» في crm_settings (مفتاح wa_cursor:<المجموعة>).
// «إنهاء المراجعة» يقدّمه إلى آخر رسالة في الملف، فلا يظهر ما قبلها في المرة القادمة.
// وما أُرسل سابقاً يُعرف ببصمة نص المصدر (agent_sources.sha256) فلا يُرسل مرتين.

import { supabase } from './supabase.js';
import { myId } from './auth.js';
import {
    MAX_FILE_BYTES, MAX_FILES, fileKind, sha256Hex, createRequest, startExtraction, extractionStatus
} from './agent.js';
import {
    parseChat, groupFromFileName, normalizeForDedupe, readZipIndex, readZipEntry, chatEntry
} from './whatsapp-parse.js';
import { el, replace, clear, notify, fail, errorText, badge, empty, localDayStart } from './ui.js';

const CURSOR_PREFIX = 'wa_cursor:';
const PAGE = 25;
const FIRST_LOOK_DAYS = 7;   // مجموعة بلا مراجعة سابقة: آخر أسبوع من الملف فقط

const KIND_AR = { offer: 'عرض', update: 'تحديث', document: 'مستند', wanted: 'طلب شراء', other: 'رسالة أخرى' };
const KIND_TONE = { offer: 'green', update: 'blue', document: 'gold', wanted: 'orange', other: 'neutral' };
// نوع طلب المساعد الافتراضي لكل نوع رسالة
const SEND_KIND = { offer: 'project', document: 'project', update: 'update', wanted: 'client', other: 'project' };
const SEND_KIND_AR = { project: 'عرض أو مشروع جديد', update: 'تحديث مشروع قائم', client: 'عميل وطلبه' };

const SINCE_OPTIONS = [
    { value: 'cursor', label: 'منذ آخر مراجعة' },
    { value: '3', label: 'آخر 3 أيام' },
    { value: '7', label: 'آخر 7 أيام' },
    { value: '30', label: 'آخر 30 يوماً' },
    { value: 'all', label: 'كل الملف' }
];

/* ===================== أوقات محلية كنص ===================== */
// أوقات واتساب محلية بلا منطقة زمنية ("2026-09-21T09:47:45")، فتُحسب كلها بالطريقة نفسها.

const pad = (n) => String(n).padStart(2, '0');

function shiftStamp(stamp, days) {
    const t = Date.parse(stamp + 'Z');
    return isNaN(t) ? '' : new Date(t - days * 86400000).toISOString().slice(0, 19);
}

function nowStamp() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function showStamp(stamp) {
    if (!stamp) return '—';
    return stamp.slice(0, 10) + ' ' + stamp.slice(11, 16);
}

// التاريخ والساعة أرقام بلا حروف، فتنقلب في سطر عربي ما لم تُعزل باتجاه ثابت.
function stampNode(stamp) {
    return el('span', { dir: 'ltr', class: 'wa-stamp', text: showStamp(stamp) });
}

/* ===================== قراءة الملفات ===================== */

// كل مصدر: { group, blocks, firstAt, lastAt, files: Map(اسم → () => Promise<Blob>) }
async function loadZip(file) {
    const buffer = await file.arrayBuffer();
    const entries = readZipIndex(buffer);
    const chat = chatEntry(entries);
    if (!chat) throw new Error('لا يوجد ملف محادثة داخل «' + file.name + '»');
    const text = new TextDecoder('utf-8').decode(await readZipEntry(buffer, chat));
    const files = new Map();
    for (const entry of entries) {
        if (entry === chat || !entry.base || entry.name.endsWith('/')) continue;
        files.set(entry.base, async () => new Blob([await readZipEntry(buffer, entry)]));
    }
    return { name: file.name, group: groupFromFileName(file.name), text: text, files: files };
}

// مجلد كامل (مثل مجلد التنزيلات): كل مجلد فيه ‎_chat.txt‎ مجموعة، وملفاته مرفقاتها.
function folderGroups(fileList) {
    const byDir = new Map();
    for (const file of fileList) {
        const path = file.webkitRelativePath || file.name;
        const parts = path.split('/');
        const dir = parts.slice(0, -1).join('/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(file);
    }
    const loaders = [];
    for (const [dir, files] of byDir) {
        const chat = files.find((f) => /^_?chat\.txt$/i.test(f.name));
        if (chat) {
            const folderName = dir.split('/').pop();
            const others = new Map(files.filter((f) => f !== chat).map((f) => [f.name, async () => f]));
            loaders.push(async () => ({ name: folderName, group: groupFromFileName(folderName), text: await chat.text(), files: others }));
        }
        // في مجلد عام (كالتنزيلات) لا يُفتح إلا أرشيف يبدو تصدير واتساب
        for (const f of files) {
            if (/\.zip$/i.test(f.name) && /whatsapp|واتساب|محادثة/i.test(f.name)) loaders.push(() => loadZip(f));
        }
    }
    return loaders;
}

function fileLoaders(fileList) {
    const loaders = [];
    for (const file of fileList) {
        if (/\.zip$/i.test(file.name)) loaders.push(() => loadZip(file));
        else if (/\.txt$/i.test(file.name)) {
            loaders.push(async () => ({ name: file.name, group: groupFromFileName(file.name), text: await file.text(), files: new Map() }));
        }
    }
    return loaders;
}

/* ===================== نص المصدر وبصمته ===================== */

// النص الذي يُرفع إلى المساعد. ثابت لنفس الرسالة، فبصمته تكشف إعادة الإرسال
// حين يُرفع تصدير جديد يتداخل مع القديم.
function sourceTextOf(group, block) {
    const lines = [
        'مصدر: مجموعة واتساب «' + group + '»',
        'المرسل: ' + (block.sender || 'غير معروف'),
        'وقت النشر: ' + showStamp(block.at)
    ];
    if (block.documents.length) lines.push('مستندات أُرسلت مع الرسالة ولم تُصدَّر: ' + block.documents.join('، '));
    else if (block.media && !block.attachments.length) lines.push('في الرسالة صور أو وسائط لم تُصدَّر.');
    return lines.join('\n') + '\n----\n' + block.text;
}

async function textHash(text) {
    return sha256Hex(new TextEncoder().encode(text).buffer);
}

function instructionOf(kind, group) {
    if (kind === 'update') {
        return 'تحديث منشور في مجموعة واتساب «' + group + '». حدّد المشروع أو الوحدة كما تسمّيها الرسالة المرفقة، '
            + 'وسجّل ما تغيّر كما ورد فيها فقط.';
    }
    if (kind === 'client') {
        return 'طلب منشور في مجموعة واتساب «' + group + '» من وسيط. سجّل صاحب الطلب ومطلبه كما وردا في الرسالة المرفقة فقط؛ '
            + 'رقم المرسل رقم الوسيط.';
    }
    return 'عرض منشور في مجموعة واتساب «' + group + '». أضف المشروع ووحداته كما وردت في الرسالة المرفقة فقط؛ '
        + 'رقم المرسل رقم وسيط أو مطوّر لا عميل.';
}

function titleOf(group, block) {
    const first = (block.text || '').split('\n').map((s) => s.replace(/[*_~]/g, '').trim()).find(Boolean) || 'عرض';
    const title = 'واتساب · ' + group + ' · ' + first;
    return title.length > 110 ? title.slice(0, 109) + '…' : title;
}

/* ===================== الصفحة ===================== */

export async function renderWhatsApp(root) {
    const page = {
        sources: [],        // المصادر المقروءة
        cursors: {},        // المجموعة → { last_at, reviewed_at }
        items: [],          // العروض بعد دمج المكرّر
        sent: new Map(),    // البصمة → { request_id, status }
        selected: new Set(),
        shown: PAGE,
        filters: { group: '', kinds: new Set(['offer', 'update', 'document']), since: 'cursor', hideSent: true, q: '' },
        remaining: null,
        cap: 20,
        extraction: null
    };

    const fileInput = el('input', { type: 'file', multiple: true, accept: '.zip,.txt' });
    const folderInput = el('input', { type: 'file', multiple: true });
    folderInput.webkitdirectory = true;
    const status = el('div', { class: 'crm-subtle', text: 'لم تُرفع ملفات بعد.' });
    const banner = el('div');
    const summary = el('div');
    const listHead = el('div');
    const list = el('div', { class: 'wa-list' });
    const more = el('div', { class: 'wa-more' });
    const barCount = el('span', { text: 'لا شيء محدد' });
    const barQuota = el('span', { class: 'crm-subtle' });
    const sendBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'إرسال المحدد للمساعد', disabled: true });
    const bar = el('div', { class: 'wa-bar', hidden: true }, [
        el('div', { class: 'wa-bar-info' }, [barCount, barQuota]),
        el('div', { class: 'wa-bar-actions' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تحديد الظاهر', onclick: selectVisible }),
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء التحديد', onclick: () => { page.selected.clear(); drawList(); } }),
            sendBtn
        ])
    ]);
    sendBtn.addEventListener('click', sendSelected);

    fileInput.addEventListener('change', () => { load(fileLoaders(Array.from(fileInput.files || []))); fileInput.value = ''; });
    folderInput.addEventListener('change', () => { load(folderGroups(Array.from(folderInput.files || []))); folderInput.value = ''; });

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'عروض واتساب' }),
                el('a', { class: 'btn btn-outline btn-sm', href: '#/assistant', text: 'المساعد الذكي' })
            ]),
            el('p', { class: 'crm-subtle', text: 'ارفع تصدير محادثات المجموعات، فيظهر لك ما نُشر بعد آخر مراجعة مصنّفاً ومن غير تكرار. '
                + 'اختر العروض المهمة وأرسلها للمساعد، فيصير كل عرض مسودة تعتمدها في «طلبات الاعتماد» قبل أن تدخل المخزون.' }),
            el('details', { class: 'wa-howto' }, [
                el('summary', { text: 'كيف أصدّر المحادثة من واتساب؟' }),
                el('ol', {}, [
                    el('li', { text: 'افتح المجموعة في واتساب، ثم اضغط على اسمها في الأعلى.' }),
                    el('li', { text: 'انزل إلى «تصدير الدردشة» واختر «إرفاق الوسائط» إن أردت إرسال الصور والبروشورات مع العرض، أو «بدون وسائط» لملف أصغر.' }),
                    el('li', { text: 'احفظ الملف (zip) في جهازك أو أرسله لنفسك، ثم ارفعه هنا. يمكن رفع عدة مجموعات معاً، أو اختيار مجلد فيه كل التصديرات.' })
                ]),
                el('p', { class: 'crm-subtle', text: 'قراءة الملف تتم في متصفحك. لا يُرفع إلى النظام إلا العرض الذي تضغط «إرسال» عليه.' })
            ]),
            el('div', { class: 'crm-import-files' }, [
                el('label', { class: 'crm-import-file' }, [el('strong', { text: 'ملفات التصدير' }), fileInput,
                    el('small', { class: 'crm-subtle', text: 'zip أو ‎_chat.txt‎ — يمكن اختيار أكثر من ملف. ملف ‎_chat.txt‎ وحده: سمّه باسم المجموعة قبل الرفع.' })]),
                el('label', { class: 'crm-import-file' }, [el('strong', { text: 'مجلد التصديرات' }), folderInput,
                    el('small', { class: 'crm-subtle', text: 'مجلد فيه مجلدات «WhatsApp Chat - …» أو ملفات zip' })])
            ]),
            status,
            banner,
            summary
        ]),
        el('div', { class: 'crm-card' }, [listHead, list, more]),
        bar
    ]);

    refreshQuota();
    extractionStatus(true).then((s) => { page.extraction = s; drawBanner(); drawBar(); });

    /* ---------- التحميل ---------- */

    async function load(loaders) {
        if (!loaders.length) return void notify('لم أجد ملف محادثة في ما اخترته', 'error', 6000);
        status.textContent = 'جارٍ قراءة ' + loaders.length + ' ملف…';
        const problems = [];
        for (const loader of loaders) {
            try {
                const raw = await loader();
                const parsed = parseChat(raw.text, { group: raw.group, files: Array.from(raw.files.keys()) });
                const group = parsed.group || raw.group || raw.name;
                if (!parsed.messages.length) { problems.push('«' + raw.name + '» ليس تصدير محادثة واتساب'); continue; }
                // نفس المجموعة مرفوعة مرتين: يبقى الأحدث
                page.sources = page.sources.filter((s) => s.group !== group);
                page.sources.push({ group: group, blocks: parsed.blocks, firstAt: parsed.firstAt, lastAt: parsed.lastAt, files: raw.files });
            } catch (error) {
                problems.push(errorText(error));
            }
        }
        await loadCursors();
        await buildItems();
        status.textContent = 'مجموعات مقروءة: ' + page.sources.length + (problems.length ? ' — تعذّر: ' + problems.join('، ') : '');
        page.shown = PAGE;
        drawSummary();
        drawList();
    }

    async function loadCursors() {
        const { data, error } = await supabase.from('crm_settings').select('key, value').like('key', CURSOR_PREFIX + '%');
        if (error) return void fail(error, 'تعذّر قراءة آخر مراجعة');
        page.cursors = {};
        for (const row of data || []) page.cursors[row.key.slice(CURSOR_PREFIX.length)] = row.value || {};
    }

    function threshold(source) {
        const since = page.filters.since;
        if (since === 'all') return '';
        if (since === 'cursor') {
            const cursor = page.cursors[source.group];
            if (cursor && cursor.last_at) return cursor.last_at;
            return shiftStamp(source.lastAt, FIRST_LOOK_DAYS);
        }
        return shiftStamp(nowStamp(), Number(since));
    }

    // كتل كل المصادر ← عناصر، والعرض المنشور في أكثر من مجموعة أو أكثر من مرة يصير عنصراً واحداً
    // يحمل أحدث نسخة، مع قائمة الأماكن الأخرى التي نُشر فيها.
    async function buildItems() {
        const byKey = new Map();
        const items = [];
        let n = 0;
        for (const source of page.sources) {
            for (const block of source.blocks) {
                const copy = { source: source, block: block, text: sourceTextOf(source.group, block) };
                const norm = block.text ? normalizeForDedupe(block.text) : '';
                const key = norm.length >= 20 && block.kind !== 'other' ? norm : null;
                const existing = key ? byKey.get(key) : null;
                if (existing) {
                    existing.copies.push(copy);
                    if (block.lastAt > existing.main.block.lastAt) existing.main = copy;
                    continue;
                }
                const item = { id: 'i' + (n++), main: copy, copies: [copy], sendKind: SEND_KIND[block.kind], sentRequest: null };
                if (key) byKey.set(key, item);
                items.push(item);
            }
        }
        items.sort((a, b) => (a.main.block.lastAt < b.main.block.lastAt ? 1 : -1));
        page.items = items;
        page.selected.clear();
        await refreshSent();
    }

    function isNew(item) {
        return item.copies.some((c) => c.block.lastAt > threshold(c.source));
    }

    // ما أُرسل سابقاً: بصمات نصوص المصدر في agent_sources. الطلب الفاشل أو الملغى لا يُحسب مرسلاً.
    async function refreshSent() {
        const candidates = page.items.filter(isNew);
        for (const item of candidates) {
            for (const copy of item.copies) if (!copy.hash) copy.hash = await textHash(copy.text);
        }
        const hashes = [...new Set(candidates.flatMap((i) => i.copies.map((c) => c.hash)).filter(Boolean))]
            .filter((h) => !page.sent.has(h));
        for (let i = 0; i < hashes.length; i += 100) {
            const chunk = hashes.slice(i, i + 100);
            const { data, error } = await supabase.from('agent_sources')
                .select('sha256, request_id, agent_requests(status)').in('sha256', chunk);
            if (error) { fail(error, 'تعذّر التحقق مما أُرسل سابقاً'); return; }
            for (const row of data || []) {
                const st = row.agent_requests ? row.agent_requests.status : null;
                const prev = page.sent.get(row.sha256);
                if (prev && prev.status !== 'failed' && prev.status !== 'cancelled') continue;
                page.sent.set(row.sha256, { request_id: row.request_id, status: st });
            }
        }
    }

    function sentInfo(item) {
        if (item.sentRequest) return { request_id: item.sentRequest, status: 'queued' };
        let failed = null;
        for (const copy of item.copies) {
            const info = copy.hash ? page.sent.get(copy.hash) : null;
            if (!info) continue;
            if (info.status === 'failed' || info.status === 'cancelled') failed = info;
            else return info;
        }
        return failed ? Object.assign({ failed: true }, failed) : null;
    }

    function isSent(item) {
        const info = sentInfo(item);
        return Boolean(info && !info.failed);
    }

    /* ---------- الحصة اليومية وحالة الاستخراج ---------- */

    async function refreshQuota() {
        const [capRes, countRes] = await Promise.all([
            supabase.rpc('agent_daily_cap'),
            supabase.from('agent_requests').select('id', { count: 'exact', head: true })
                .eq('requested_by', myId()).gte('created_at', localDayStart(0))
        ]);
        if (!capRes.error && Number.isInteger(capRes.data)) page.cap = capRes.data;
        page.remaining = countRes.error ? null : Math.max(0, page.cap - (countRes.count || 0));
        drawBar();
    }

    function sendingBlocked() {
        return page.extraction && page.extraction.reachable && !page.extraction.enabled;
    }

    function drawBanner() {
        if (sendingBlocked()) {
            replace(banner, el('div', { class: 'crm-warn-box' }, [
                el('strong', { text: 'الإرسال للمساعد متوقف: الاستخراج التلقائي غير مفعّل' }),
                el('div', { class: 'crm-subtle', text: 'لم يُضبط مفتاح خدمة الذكاء الاصطناعي بعد، والطلب المرسل الآن يفشل ولا يُعاد تشغيله ويُحسب من الحد اليومي. '
                    + 'المراجعة والفرز يعملان، ويمكن نسخ نص أي عرض. يُفتح الإرسال تلقائياً حين يُضبط المفتاح.' })
            ]));
        } else clear(banner);
    }

    /* ---------- ملخص المجموعات ---------- */

    function drawSummary() {
        if (!page.sources.length) return void clear(summary);
        const table = el('table', { class: 'crm-table' });
        table.appendChild(el('thead', {}, el('tr', {}, [
            el('th', { text: 'المجموعة' }), el('th', { text: 'آخر رسالة في الملف' }),
            el('th', { text: 'آخر مراجعة' }), el('th', { text: 'عروض جديدة' })
        ])));
        const body = el('tbody');
        const sorted = page.sources.slice().sort((a, b) => a.group.localeCompare(b.group, 'ar'));
        for (const source of sorted) {
            const cursor = page.cursors[source.group];
            const fresh = page.items.filter((item) => item.main.source === source && isNew(item)
                && ['offer', 'update', 'document'].includes(item.main.block.kind) && !isSent(item)).length;
            body.appendChild(el('tr', {}, [
                el('td', {}, el('button', { type: 'button', class: 'wa-link', text: source.group,
                    onclick: () => { page.filters.group = source.group; page.shown = PAGE; drawList(); } })),
                el('td', { class: 'crm-subtle' }, stampNode(source.lastAt)),
                el('td', { class: 'crm-subtle' }, cursor && cursor.last_at ? stampNode(cursor.last_at) : 'لم تُراجع بعد'),
                el('td', { class: 'num', text: String(fresh) })
            ]));
        }
        table.appendChild(body);
        const finish = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إنهاء المراجعة لهذه المجموعات', onclick: finishReview });
        replace(summary, [
            el('div', { class: 'crm-import-preview' }, table),
            el('div', { class: 'wa-finish' }, [
                finish,
                el('small', { class: 'crm-subtle', text: 'يحفظ آخر رسالة في كل ملف كنقطة مراجعة؛ ما لم تُرسله قبلها لن يظهر في «منذ آخر مراجعة» بعد ذلك.' })
            ])
        ]);
    }

    async function finishReview(event) {
        const button = event.currentTarget;
        button.disabled = true;
        const reviewedAt = new Date().toISOString();
        const rows = page.sources.map((s) => ({
            key: CURSOR_PREFIX + s.group,
            value: { last_at: s.lastAt, reviewed_at: reviewedAt, reviewed_by: myId() },
            updated_at: reviewedAt
        }));
        const { error } = await supabase.from('crm_settings').upsert(rows, { onConflict: 'key' });
        button.disabled = false;
        if (error) return void fail(error, 'تعذّر حفظ نقطة المراجعة');
        notify('حُفظت نقطة المراجعة لـ ' + rows.length + ' مجموعة', 'success');
        await loadCursors();
        await refreshSent();
        drawSummary();
        drawList();
    }

    /* ---------- القائمة ---------- */

    function visibleItems() {
        const f = page.filters;
        const q = f.q ? normalizeForDedupe(f.q) : '';
        return page.items.filter((item) => {
            const block = item.main.block;
            if (f.group && !item.copies.some((c) => c.source.group === f.group)) return false;
            if (!f.kinds.has(block.kind)) return false;
            if (!isNew(item)) return false;
            if (f.hideSent && isSent(item)) return false;
            if (q && normalizeForDedupe(block.text + ' ' + block.sender).indexOf(q) === -1) return false;
            return true;
        });
    }

    function drawFilters() {
        const f = page.filters;
        const groupSel = el('select', {}, [el('option', { value: '', text: 'كل المجموعات' })]
            .concat(page.sources.map((s) => el('option', { value: s.group, text: s.group }))));
        groupSel.value = f.group;
        groupSel.addEventListener('change', () => { f.group = groupSel.value; page.shown = PAGE; drawList(); });

        const sinceSel = el('select', {}, SINCE_OPTIONS.map((o) => el('option', { value: o.value, text: o.label })));
        sinceSel.value = f.since;
        sinceSel.addEventListener('change', async () => {
            f.since = sinceSel.value; page.shown = PAGE;
            await refreshSent();
            drawSummary(); drawList();
        });

        const search = el('input', { type: 'search', placeholder: 'بحث في النص أو المرسل…', value: f.q });
        let timer = null;
        search.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => { f.q = search.value.trim(); page.shown = PAGE; drawList(true); }, 250);
        });

        const kindChips = el('div', { class: 'chips' }, Object.keys(KIND_AR).map((kind) => {
            const box = el('input', { type: 'checkbox', checked: f.kinds.has(kind) });
            box.addEventListener('change', () => {
                if (box.checked) f.kinds.add(kind); else f.kinds.delete(kind);
                page.shown = PAGE; drawList();
            });
            return el('label', { class: 'chip' + (f.kinds.has(kind) ? ' on' : '') }, [box, KIND_AR[kind]]);
        }));
        const hideBox = el('input', { type: 'checkbox', checked: f.hideSent });
        hideBox.addEventListener('change', () => { f.hideSent = hideBox.checked; page.shown = PAGE; drawList(); });

        return { node: el('div', {}, [
            el('div', { class: 'crm-toolbar' }, [groupSel, sinceSel, search]),
            el('div', { class: 'wa-filter-row' }, [kindChips,
                el('label', { class: 'chip' + (f.hideSent ? ' on' : '') }, [hideBox, 'إخفاء ما أُرسل سابقاً'])])
        ]), search: search };
    }

    function drawList(keepSearchFocus) {
        if (!page.sources.length) {
            clear(listHead); clear(more);
            replace(list, empty('ارفع ملف تصدير واحداً على الأقل.'));
            bar.hidden = true;
            return;
        }
        const items = visibleItems();
        const filters = drawFilters();
        replace(listHead, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'العروض الجديدة' }),
                el('span', { class: 'crm-subtle', text: items.length + ' عنصر' })
            ]),
            filters.node
        ]);
        if (keepSearchFocus) { filters.search.focus(); filters.search.setSelectionRange(filters.search.value.length, filters.search.value.length); }

        if (!items.length) {
            replace(list, empty('لا جديد بهذه التصفية. جرّب «كل الملف» أو أظهر الأنواع الأخرى.'));
        } else {
            replace(list, items.slice(0, page.shown).map(card));
        }
        clear(more);
        if (items.length > page.shown) {
            more.appendChild(el('button', { type: 'button', class: 'btn btn-outline btn-sm',
                text: 'عرض المزيد (' + (items.length - page.shown) + ' متبقٍ)',
                onclick: () => { page.shown += PAGE; drawList(); } }));
        }
        bar.hidden = false;
        drawBar();
    }

    function card(item) {
        const block = item.main.block;
        const source = item.main.source;
        const info = sentInfo(item);
        const sent = info && !info.failed;

        const check = el('input', { type: 'checkbox', checked: page.selected.has(item.id), disabled: sent });
        check.addEventListener('change', () => {
            if (check.checked) page.selected.add(item.id); else page.selected.delete(item.id);
            node.classList.toggle('wa-selected', check.checked);
            drawBar();
        });
        const kindSel = el('select', { class: 'wa-kind', disabled: sent },
            Object.keys(SEND_KIND_AR).map((k) => el('option', { value: k, text: SEND_KIND_AR[k] })));
        kindSel.value = item.sendKind;
        kindSel.addEventListener('change', () => { item.sendKind = kindSel.value; });

        const others = [...new Set(item.copies.filter((c) => c !== item.main).map((c) => c.source.group))];
        const badges = [badge(KIND_AR[block.kind], KIND_TONE[block.kind])];
        if (item.copies.length > 1) badges.push(badge('نُشر ' + item.copies.length + ' مرات', 'neutral'));
        if (block.attachments.length) badges.push(badge(block.attachments.length + ' مرفق', 'blue'));
        else if (block.documents.length) badges.push(badge('مستند لم يُصدَّر', 'orange'));
        else if (block.media) badges.push(badge('صور لم تُصدَّر', 'neutral'));
        if (sent) badges.push(badge('أُرسل للمساعد', 'green'));
        else if (info && info.failed) badges.push(badge('فشل إرسال سابق', 'red'));

        const text = el('div', { class: 'agent-text wa-text', text: block.text || '(وسائط بلا نص)' });
        const long = (block.text || '').split('\n').length > 9 || (block.text || '').length > 600;
        if (long) text.classList.add('wa-clamped');

        const actions = [
            long ? el('button', { type: 'button', class: 'wa-link', text: 'عرض كامل النص',
                onclick: (e) => { text.classList.toggle('wa-clamped'); e.currentTarget.textContent = text.classList.contains('wa-clamped') ? 'عرض كامل النص' : 'طيّ النص'; } }) : null,
            el('button', { type: 'button', class: 'wa-link', text: 'نسخ النص', onclick: () => copyText(item.main.text) }),
            sent && info.request_id ? el('a', { class: 'wa-link', href: '#/assistant/' + info.request_id, text: 'فتح الطلب' }) : null
        ];

        const node = el('div', { class: 'agent-source wa-card' + (page.selected.has(item.id) ? ' wa-selected' : '') + (sent ? ' wa-sent' : '') }, [
            el('div', { class: 'agent-source-head' }, [
                el('label', { class: 'wa-pick' }, [check]),
                el('strong', { text: source.group }),
                el('span', { class: 'crm-subtle' }, [el('span', { dir: 'auto', text: block.sender || '—' }), ' · ', stampNode(block.at)]),
                ...badges
            ]),
            text,
            block.documents.length ? el('div', { class: 'crm-subtle wa-docs', text: 'مستندات: ' + block.documents.join('، ') }) : null,
            others.length ? el('div', { class: 'crm-subtle', text: 'نُشر أيضاً في: ' + others.join('، ') }) : null,
            el('div', { class: 'wa-card-foot' }, [
                el('label', { class: 'crm-subtle' }, ['يُرسل كـ ', kindSel]),
                el('div', { class: 'wa-card-actions' }, actions)
            ])
        ]);
        return node;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            notify('نُسخ النص', 'success', 2000);
        } catch (_) {
            notify('تعذّر النسخ من المتصفح', 'error');
        }
    }

    function selectVisible() {
        for (const item of visibleItems().slice(0, page.shown)) if (!isSent(item)) page.selected.add(item.id);
        drawList();
    }

    function drawBar() {
        const n = page.selected.size;
        barCount.textContent = n ? 'المحدد: ' + n : 'لا شيء محدد';
        barQuota.textContent = page.remaining === null ? '' : 'المتبقي من طلبات المساعد اليوم: ' + page.remaining + ' من ' + page.cap;
        sendBtn.disabled = n === 0 || sendingBlocked() || page.remaining === 0;
        sendBtn.title = sendingBlocked() ? 'الاستخراج التلقائي غير مفعّل' : '';
    }

    /* ---------- الإرسال ---------- */

    async function attachmentFiles(item) {
        const block = item.main.block;
        const files = [];
        const skipped = [];
        for (const name of block.attachments) {
            const spec = fileKind(name);
            const getter = item.main.source.files.get(name);
            if (!spec || !getter) { skipped.push(name); continue; }
            if (files.length >= MAX_FILES - 1) { skipped.push(name); continue; }
            const blob = await getter();
            if (blob.size > MAX_FILE_BYTES) { skipped.push(name); continue; }
            files.push(new File([blob], name, { type: spec.mime }));
        }
        return { files: files, skipped: skipped };
    }

    async function sendSelected() {
        const queue = page.items.filter((item) => page.selected.has(item.id) && !isSent(item));
        if (!queue.length) return;
        if (sendingBlocked()) return void notify('الاستخراج التلقائي غير مفعّل — لم يُرسل شيء', 'error', 7000);
        let limit = queue.length;
        if (page.remaining !== null && queue.length > page.remaining) {
            limit = page.remaining;
            notify('الحد اليومي يسمح بـ ' + page.remaining + ' طلب فقط؛ يُرسل الأحدث أولاً والباقي يبقى محدداً', 'info', 7000);
        }
        sendBtn.disabled = true;
        let done = 0;
        const skippedAll = [];
        for (const item of queue.slice(0, limit)) {
            const group = item.main.source.group;
            try {
                sendBtn.textContent = 'جارٍ الإرسال ' + (done + 1) + ' من ' + limit + '…';
                const { files, skipped } = await attachmentFiles(item);
                skippedAll.push(...skipped);
                const id = await createRequest(item.sendKind, {
                    title: titleOf(group, item.main.block),
                    instruction: instructionOf(item.sendKind, group),
                    text: item.main.text,
                    textName: 'whatsapp',
                    files: files
                });
                item.sentRequest = id;
                if (item.main.hash) page.sent.set(item.main.hash, { request_id: id, status: 'queued' });
                page.selected.delete(item.id);
                done += 1;
                startExtraction(id);
            } catch (error) {
                fail(error, 'توقف الإرسال عند عرض من «' + group + '»');
                break;
            }
        }
        sendBtn.textContent = 'إرسال المحدد للمساعد';
        if (done) notify('أُرسل ' + done + ' عرض للمساعد. تجد المسودات في «طلبات الاعتماد» حين تجهز.', 'success', 7000);
        if (skippedAll.length) notify('مرفقات لم تُرسل (نوع غير مدعوم أو حجم كبير أو تجاوز العدد): ' + skippedAll.length, 'info', 7000);
        await refreshQuota();
        drawSummary();
        drawList();
    }
}
