// ‎#/whatsapp‎ — «عروض واتساب» (للمدير): مراجعة العروض الجديدة في مجموعات واتساب وإرسال المختار منها
// إلى المساعد الذكي، فيصير كل عرض طلباً «أضف هذا العرض كمشروع جديد» ومسودةً تنتظر الاعتماد.
//
// المصدر ملف «تصدير الدردشة» الذي يصدّره المالك من هاتفه — الواجهة الرسمية لا تقرأ المجموعات.
// قراءة الملف وفرز العروض تتم في المتصفح. حين يكون «فرز Jev» مفعّلاً يُرسل نص كل رسالة جديدة واسم مجموعتها إلى
// خدمة الفرز (وظيفة wa-triage) بلا المرسل (واسم المحادثة الفردية لا يُرسل: groupToSend)؛ والوظيفة تخفي أرقام الهواتف
// والبريد ثم ترسل النص إلى Jev، نموذج شركة خارجية (TypeSafe عبر OpenRouter)، ولا يُخزَّن نصها عندنا (بصمته وتسمياته
// فقط)؛ ولا يصل إلى المساعد إلا العرض الذي يرسله المالك.
//
// فرز Jev (whatsapp-triage.js): بعد كل تحميل تُرسل الرسائل الجديدة على دفعات في الخلفية، فيظهر على كل بطاقة
// حكمها («مقترح للإرسال» / «يحتاج نظرك» / «مستبعد»)، مع مرشّح بالحكم وتصحيح للمالك. الوضع في crm_settings
// (wa_triage_mode): متوقف / اقتراحات / تحديد المقترح تلقائياً. Jev يقترح فقط: الإرسال للمساعد بيد المالك
// دائماً، وتعذّر الفرز أو إيقافه يترك الصفحة كما كانت.
//
// قرار المالك (2026-09-27): استيراد واتساب يمر عبر المساعد وحده. مسودات طلبات المدير تدخل «بانتظار
// الاعتماد» مباشرة (agent-run). ما أُرسل سابقاً يُعرف ببصمة نص المصدر (agent_sources.sha256) فلا يُرسل
// مرتين، والمشروع الموجود في النظام تكشفه المسودة تحت «مكرّرات محتملة».
//
// ما الجديد؟ لكل مجموعة مؤشر «آخر مراجعة» في crm_settings (مفتاح wa_cursor:<المجموعة>).
// «إنهاء المراجعة» يقدّمه إلى آخر رسالة في الملف، فلا يظهر ما قبلها في المرة القادمة.

import { supabase } from './supabase.js';
import { myId } from './auth.js';
import { sha256Hex, createRequest, startExtraction, extractionStatus } from './agent.js';
import {
    parseChat, groupFromFileName, normalizeForDedupe, readZipIndex, readZipEntry, chatEntry
} from './whatsapp-parse.js';
import { el, replace, clear, notify, fail, errorText, errorBox, badge, empty, localDayStart } from './ui.js';
import {
    BUCKETS, DEFAULT_MODE, INTENTS, INTENT_AR, MODES, MODE_AR, MODE_HINT, MODE_KEY, REPORT_DAYS, SURFACED_AR, VERDICT_AR,
    bucketOf, countBuckets, createRunner, createStore, describe, isSurfaced, itemText, labelTriage, normalizeMode, outError,
    passesVerdictFilter, preselect, progressLine, reportView, resultFor, sendOrder, triageBatch, triageStatus
} from './whatsapp-triage.js';

const CURSOR_PREFIX = 'wa_cursor:';
const PAGE = 25;
const FIRST_LOOK_DAYS = 7;   // مجموعة بلا مراجعة سابقة: آخر أسبوع من الملف فقط
const INSTRUCTION = 'أضف هذا العرض كمشروع جديد';

const KIND_AR = { offer: 'عرض', update: 'تحديث', document: 'مستند', wanted: 'طلب شراء', other: 'رسالة أخرى' };
const KIND_TONE = { offer: 'green', update: 'blue', document: 'gold', wanted: 'orange', other: 'neutral' };

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

// عنوان الطلب: أول سطر فيه كلام، لا سطر رموز («👏:») ولا اسم مستند
function titleOf(group, block) {
    const first = (block.text || '').split('\n').map((s) => s.replace(/[*_~]/g, '').trim())
        .find((s) => /[\u0621-\u064aA-Za-z]{3,}/.test(s) && !/\.pdf\b/i.test(s)) || 'عرض';
    const title = 'واتساب · ' + group + ' · ' + first;
    return title.length > 110 ? title.slice(0, 109) + '…' : title;
}

/* ===================== النسخ ===================== */

// سجل واحد لكل عرض، لنسخ نصه كما نُشر.
function pickRecord(item) {
    const block = item.main.block;
    const others = [...new Set(item.copies.filter((c) => c !== item.main).map((c) => c.source.group))];
    return {
        group: item.main.source.group,
        sender: block.sender || null,
        posted_at: block.at,
        kind: block.kind,
        text: block.text,
        documents: block.documents,
        media_omitted: block.media && !block.attachments.length,
        times_posted: item.copies.length,
        also_in: others
    };
}

function pickText(record) {
    const head = '— ' + record.group + ' · ' + (record.sender || 'غير معروف') + ' · ' + showStamp(record.posted_at)
        + (record.also_in.length ? ' · نُشر أيضاً في: ' + record.also_in.join('، ') : '');
    const docs = record.documents.length ? '\n[مستندات: ' + record.documents.join('، ') + ']' : '';
    return head + '\n' + record.text + docs;
}

/* ===================== الصفحة ===================== */

export async function renderWhatsApp(root) {
    const page = {
        sources: [],        // المصادر المقروءة
        cursors: {},        // المجموعة → { last_at, reviewed_at }
        items: [],          // العروض بعد دمج المكرّر
        sent: new Map(),    // البصمة → { request_id, status } مما أُرسل للمساعد سابقاً
        checked: new Set(), // بصمات رجع استعلامها في agent_sources (أُرسلت أم لا)؛ التحديد المسبق لا يتجاوزها
        copied: new Set(),  // ما نُسخ في هذه الجلسة
        selected: new Set(),
        expanded: new Set(), // بطاقات فُتح نصها كاملاً، فلا تُطوى حين تُعاد القائمة
        shown: PAGE,
        // verdicts: شرائح حكم Jev الظاهرة (send | review | skip | untriaged)
        filters: { group: '', kinds: new Set(['offer', 'update', 'document']), since: 'cursor', hideSent: true, q: '', verdicts: new Set(BUCKETS) },
        remaining: null,    // ما بقي من حد طلبات المساعد اليومي
        cap: 20,
        extraction: null,   // هل الاستخراج مفعّل (المفتاح مضبوط)
        sending: false
    };

    // فرز Jev. status: رد إجراء status (null قبل وصوله). autoPicked: معرّفات ما حدده Jev لا المالك.
    // unticked: نصوص عناصر ألغى المالك تحديدها بيده، فلا يعيد التحديد المسبق تحديدها أبداً.
    const triage = { status: null, mode: DEFAULT_MODE };
    const store = createStore();
    const autoPicked = new Set();
    const unticked = new Set();
    const runner = createRunner({
        call: (items) => triageBatch(supabase, items),
        store: store,
        alive: () => root.isConnected,
        onBatch: onTriageBatch
    });

    const fileInput = el('input', { type: 'file', multiple: true, accept: '.zip,.txt' });
    const folderInput = el('input', { type: 'file', multiple: true });
    folderInput.webkitdirectory = true;
    const statusText = el('span', { text: 'لم تُرفع ملفات بعد.' });
    const triageText = el('span');   // تقدّم فرز Jev في سطر الحالة نفسه
    const status = el('div', { class: 'crm-subtle' }, [statusText, triageText]);
    const jevBox = el('div', { class: 'wa-jev-mode', hidden: true });
    const reportBody = el('div');
    const reportCard = el('details', { class: 'crm-card wa-jev-report', hidden: true }, [
        el('summary', { text: 'دقة Jev' }),
        el('p', { class: 'crm-subtle', text: 'آخر ' + REPORT_DAYS + ' يوماً: أحكام Jev وما أرسلته منها للمساعد، وثقته، وتصحيحاتك، وتكلفة الفرز.' }),
        reportBody
    ]);
    reportCard.addEventListener('toggle', () => { if (reportCard.open) loadReport(); });
    // حقل البحث واحد طوال عمر الصفحة: إعادة رسم القائمة (ومنها رسم كل دفعة فرز في الخلفية) تنقله ولا تبدّله،
    // فلا يضيع ما كُتب ولا مؤقّت الانتظار، ويعود إليه التركيز إن كان فيه.
    const search = el('input', { type: 'search', placeholder: 'بحث في النص أو المرسل…' });
    let searchTimer = null;
    search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { page.filters.q = search.value.trim(); page.shown = PAGE; drawList(true); }, 250);
    });
    const summary = el('div');
    const listHead = el('div');
    const list = el('div', { class: 'wa-list' });
    const more = el('div', { class: 'wa-more' });
    // آخر رسم كامل للقائمة (drawList)، لتُحدَّث في مكانها حين تصل دفعة فرز (refreshList) بدل أن تُعاد كلها:
    //   jev: هل ظهرت واجهة Jev، empty: هل كانت القائمة فارغة، count: «N عنصر»، chips: الشريحة ← نص عدّها،
    //   cards: معرّف العنصر ← أجزاء بطاقته (card)، more: زر «عرض المزيد» أو null
    let listView = null;
    // رسم كامل طلبته دفعة فرز والتركيز في القائمة أو مرشحاتها: يُطبَّق حين يخرج التركيز منها (drawListSoon)
    let redrawPending = false;
    for (const box of [listHead, list, more]) box.addEventListener('focusout', flushPending);
    const barCount = el('span', { text: 'لا شيء محدد' });
    const barQuota = el('span', { class: 'crm-subtle' });
    const sendBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'إرسال للمساعد', disabled: true, onclick: sendSelected });
    const copyBtn = el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'نسخ المحدد', disabled: true, onclick: copySelected });
    const bar = el('div', { class: 'wa-bar', hidden: true }, [
        el('div', { class: 'wa-bar-info' }, [barCount, barQuota]),
        el('div', { class: 'wa-bar-actions' }, [
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'تحديد الظاهر', onclick: selectVisible }),
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: 'إلغاء التحديد', onclick: clearSelection }),
            copyBtn,
            sendBtn
        ])
    ]);

    fileInput.addEventListener('change', () => { load(fileLoaders(Array.from(fileInput.files || []))); fileInput.value = ''; });
    folderInput.addEventListener('change', () => { load(folderGroups(Array.from(folderInput.files || []))); folderInput.value = ''; });

    replace(root, [
        el('div', { class: 'crm-card' }, [
            el('div', { class: 'crm-card-head' }, [
                el('h2', { text: 'عروض واتساب' }),
                el('a', { class: 'btn btn-outline btn-sm', href: '#/approvals', text: 'طلبات الاعتماد' })
            ]),
            el('p', { class: 'crm-subtle', text: 'ارفع تصدير محادثات المجموعات، فيظهر لك ما نُشر بعد آخر مراجعة مصنّفاً ومن غير تكرار. '
                + 'حدّد العروض واضغط «إرسال للمساعد»: يصير كل عرض طلباً للمساعد الذكي، وتظهر مسودته في «طلبات الاعتماد» خلال دقائق لتعتمدها قبل أن تدخل المخزون.' }),
            el('details', { class: 'wa-howto' }, [
                el('summary', { text: 'كيف أصدّر المحادثة من واتساب؟' }),
                el('ol', {}, [
                    el('li', { text: 'افتح المجموعة في واتساب، ثم اضغط على اسمها في الأعلى.' }),
                    el('li', { text: 'انزل إلى «تصدير الدردشة» واختر «بدون وسائط» — المساعد يقرأ نص العرض، والصور والمستندات لا تُرسل من هنا.' }),
                    el('li', { text: 'احفظ الملف (zip) في جهازك أو أرسله لنفسك، ثم ارفعه هنا. يمكن رفع عدة مجموعات معاً، أو اختيار مجلد فيه كل التصديرات.' })
                ]),
                el('p', { class: 'crm-subtle', text: 'قراءة الملف تتم في متصفحك. حين يكون «فرز Jev» مفعّلاً يُرسل نص كل رسالة جديدة واسم مجموعتها '
                    + '(بلا اسم المرسل، وبلا اسم المحادثة إن كانت فردية) إلى خدمة الفرز في ملائم، فتخفي منهما أرقام الهواتف والبريد ثم ترسلهما إلى '
                    + 'Jev، وهو نموذج ذكاء اصطناعي لشركة خارجية (TypeSafe عبر OpenRouter). الأسماء المكتوبة داخل الرسالة تصل كما هي. '
                    + 'لا تحفظ ملائم نص الرسالة، ولا يصل إلى المساعد إلا العرض الذي ترسله أنت.' })
            ]),
            el('div', { class: 'crm-import-files' }, [
                el('label', { class: 'crm-import-file' }, [el('strong', { text: 'ملفات التصدير' }), fileInput,
                    el('small', { class: 'crm-subtle', text: 'zip أو ‎_chat.txt‎ — يمكن اختيار أكثر من ملف. ملف ‎_chat.txt‎ وحده: سمّه باسم المجموعة قبل الرفع.' })]),
                el('label', { class: 'crm-import-file' }, [el('strong', { text: 'مجلد التصديرات' }), folderInput,
                    el('small', { class: 'crm-subtle', text: 'مجلد فيه مجلدات «WhatsApp Chat - …» أو ملفات zip' })])
            ]),
            jevBox,
            status,
            summary
        ]),
        reportCard,
        el('div', { class: 'crm-card' }, [listHead, list, more]),
        bar
    ]);

    refreshQuota();
    extractionStatus(true).then((st) => { page.extraction = st; drawBar(); });
    // فرز Jev: سؤال واحد عن حالته عند فتح الصفحة (لا يرمي). تعذّره أو تعطيله يترك الصفحة كما كانت.
    triageStatus(supabase).then(applyStatus).catch((error) => console.error('[CRM]', error));

    /* ---------- التحميل ---------- */

    async function load(loaders) {
        if (!loaders.length) return void notify('لم أجد ملف محادثة في ما اخترته', 'error', 6000);
        // جولة فرز جديدة: معرّفات العناصر ستتجدد، فردود الجولة السابقة تُهمل من الآن
        runner.reset();
        drawTriageLine();
        statusText.textContent = 'جارٍ قراءة ' + loaders.length + ' ملف…';
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
        statusText.textContent = 'مجموعات مقروءة: ' + page.sources.length + (problems.length ? ' — تعذّر: ' + problems.join('، ') : '');
        page.shown = PAGE;
        drawSummary();
        enqueueTriage();
        // ما له نتيجة من تحميل سابق في الصفحة نفسها لا يُرسل للفرز ثانية: يُحدَّد الآن (في وضعه)، لا عند دفعة لن تأتي
        applyPreselection();
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
                const item = { id: 'i' + (n++), main: copy, copies: [copy], sentRequest: null };
                if (key) byKey.set(key, item);
                items.push(item);
            }
        }
        items.sort((a, b) => (a.main.block.lastAt < b.main.block.lastAt ? 1 : -1));
        page.items = items;
        page.selected.clear();
        page.copied.clear();
        page.expanded.clear();
        autoPicked.clear();
        // المعرّفات تجددت: بطاقات الرسم السابق لا تُحدَّث في مكانها، والرسم التالي كامل
        listView = null;
        redrawPending = false;
        await refreshSent();
    }

    function isNew(item) {
        return item.copies.some((c) => c.block.lastAt > threshold(c.source));
    }

    // ما أُرسل سابقاً: بصمات نصوص المصدر في agent_sources. الطلب الفاشل أو الملغى لا يُحسب مرسلاً.
    // بصمات كل دفعة رجع استعلامها تُضاف إلى page.checked؛ ما تعذّر استعلامه أو لم يأتِ دوره بعد لا يُحدَّد مسبقاً.
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
            if (error) {
                // ما تعذّر استعلامه الآن لا يُعتمد فيه على استعلام أقدم: لا يُحدَّد مسبقاً حتى يرجع استعلامه
                for (const hash of hashes.slice(i)) page.checked.delete(hash);
                fail(error, 'تعذّر التحقق مما أُرسل سابقاً');
                return;
            }
            for (const row of data || []) {
                const st = row.agent_requests ? row.agent_requests.status : null;
                const prev = page.sent.get(row.sha256);
                if (prev && prev.status !== 'failed' && prev.status !== 'cancelled') continue;
                page.sent.set(row.sha256, { request_id: row.request_id, status: st });
            }
            for (const hash of chunk) page.checked.add(hash);
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

    // الحد اليومي لطلبات المساعد لكل مستخدم (القاعدة تفرضه؛ هنا للعرض ولإيقاف الإرسال قبله)
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
                el('small', { class: 'crm-subtle', text: 'يحفظ آخر رسالة في كل ملف كنقطة مراجعة؛ ما لم ترسله قبلها لن يظهر في «منذ آخر مراجعة» بعد ذلك.' })
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
        applyPreselection();   // ما خرج من «الجديد» بالنقطة الجديدة لا يبقى مما حدده Jev
        drawSummary();
        drawList();
    }

    /* ---------- القائمة ---------- */

    // كل المرشحات إلا مرشّح حكم Jev (عليها تُعدّ شرائحه). رسالة صنّفها القارئ «رسالة أخرى» أو «طلب شراء» وحكمُ
    // Jev فيها «مقترح للإرسال» تبقى ظاهرة ولو أُطفئت شريحة تصنيفها، بشارة «Jev: عرض فاته الفرز» (isSurfaced).
    function listedItems() {
        const f = page.filters;
        const q = f.q ? normalizeForDedupe(f.q) : '';
        const jev = jevVisible();
        return page.items.filter((item) => {
            const block = item.main.block;
            if (f.group && !item.copies.some((c) => c.source.group === f.group)) return false;
            if (!f.kinds.has(block.kind) && !(jev && isSurfaced(block.kind, resultOf(item)))) return false;
            if (!isNew(item)) return false;
            if (f.hideSent && isSent(item)) return false;
            if (q && normalizeForDedupe(block.text + ' ' + block.sender).indexOf(q) === -1) return false;
            return true;
        });
    }

    function visibleItems(listed) {
        const items = listed || listedItems();
        if (!jevVisible()) return items;
        return items.filter((item) => passesVerdictFilter(resultOf(item), page.filters.verdicts));
    }

    function drawFilters(listed) {
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
            drawSummary();
            enqueueTriage();       // ما صار جديداً بالمدة الأوسع يُفرز أيضاً (بصماته حُسبت للتو)
            applyPreselection();   // والتحديد المسبق يُعاد على ما صار ظاهراً بالمدة الجديدة
            drawList();
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

        const chips = new Map();
        return { node: el('div', {}, [
            el('div', { class: 'crm-toolbar' }, [groupSel, sinceSel, search]),
            el('div', { class: 'wa-filter-row' }, [kindChips,
                el('label', { class: 'chip' + (f.hideSent ? ' on' : '') }, [hideBox, 'إخفاء ما أُرسل للمساعد'])]),
            jevVisible() ? verdictChips(listed, chips) : null
        ]), search: search, chips: chips };
    }

    // مرشّح حكم Jev، والعدد بين القوسين مما تُظهره باقي المرشحات. نص كل شريحة يُحفظ في chips ليُحدَّث عدده في
    // مكانه مع كل دفعة (refreshList)، فلا تُبدَّل الشرائح والتركيز على إحداها.
    function verdictChips(listed, chips) {
        const f = page.filters;
        const counts = countBuckets(listed, resultOf);
        return el('div', { class: 'wa-filter-row' }, [
            el('span', { class: 'crm-subtle', text: 'فرز Jev:' }),
            el('div', { class: 'chips' }, BUCKETS.map((bucket) => {
                const box = el('input', { type: 'checkbox', checked: f.verdicts.has(bucket) });
                box.addEventListener('change', () => {
                    if (box.checked) f.verdicts.add(bucket); else f.verdicts.delete(bucket);
                    page.shown = PAGE; drawList();
                });
                const label = el('label', { class: 'chip' + (f.verdicts.has(bucket) ? ' on' : '') }, [box, chipText(bucket, counts)]);
                chips.set(bucket, label.lastChild);
                return label;
            }))
        ]);
    }

    function chipText(bucket, counts) {
        return VERDICT_AR[bucket] + ' (' + counts[bucket] + ')';
    }

    // رسم كامل: بعد كل فعل للمالك (مرشح، تحديد، تصحيح، إرسال) وبعد كل تحميل. دفعات الفرز في الخلفية لا تستعمله
    // إلا حين لا يُحدَّث ما تغيّر في مكانه (refreshList).
    function drawList(keepSearchFocus) {
        redrawPending = false;
        if (!page.sources.length) {
            listView = null;
            clear(listHead); clear(more);
            replace(list, empty('ارفع ملف تصدير واحداً على الأقل.'));
            bar.hidden = true;
            return;
        }
        const listed = listedItems();
        const items = visibleItems(listed);
        // نقل حقل البحث يُفقده التركيز: يُعاد إليه بموضع المؤشر نفسه، فلا تقطع إعادةُ الرسم الكتابة
        const focused = keepSearchFocus || document.activeElement === search;
        const caret = focused ? [search.selectionStart, search.selectionEnd] : null;
        const filters = drawFilters(listed);
        const count = el('span', { class: 'crm-subtle', text: items.length + ' عنصر' });
        replace(listHead, [
            el('div', { class: 'crm-card-head' }, [el('h2', { text: 'العروض الجديدة' }), count]),
            filters.node
        ]);
        if (focused) {
            const end = filters.search.value.length;
            filters.search.focus();
            try {
                filters.search.setSelectionRange(caret[0] === null ? end : caret[0], caret[1] === null ? end : caret[1]);
            } catch (_) { /* نوع حقل لا يقبل تحديد موضع المؤشر */ }
        }

        const cards = new Map();
        if (!items.length) {
            replace(list, nothingNew());
        } else {
            replace(list, items.slice(0, page.shown).map((item) => {
                const parts = card(item);
                cards.set(item.id, parts);
                return parts.node;
            }));
        }
        clear(more);
        const moreBtn = items.length > page.shown ? moreButton(items.length - page.shown) : null;
        if (moreBtn) more.appendChild(moreBtn);
        listView = { jev: jevVisible(), empty: !items.length, count: count, chips: filters.chips, cards: cards, more: moreBtn };
        bar.hidden = false;
        drawBar();
    }

    function moreButton(rest) {
        return el('button', { type: 'button', class: 'btn btn-outline btn-sm', text: moreText(rest),
            onclick: () => { page.shown += PAGE; drawList(); } });
    }

    function moreText(rest) {
        return 'عرض المزيد (' + rest + ' متبقٍ)';
    }

    function nothingNew() {
        return empty('لا جديد بهذه التصفية. جرّب «كل الملف» أو أظهر الأنواع الأخرى.');
    }

    // رد دفعة فرز في الخلفية: القائمة تُحدَّث في مكانها ولا تُعاد. البطاقة الباقية تبقى هي نفسها (مربع تحديدها
    // وقوائمها وأزرارها، والتركيز إن كان عليها)، ويتغير فيها ما تغيّر فقط: التحديد، وشارات Jev وسطره حين تصل
    // نتيجتها. البطاقة الجديدة (عرض فاته الفرز مثلاً) تُدرج في موضعها دون نقل غيرها، فيثبت موضع القراءة، والأعداد
    // تُحدَّث في نصوصها، والمرشحات لا تُمس. ما لا يُحدَّث في مكانه — غياب واجهة Jev (تعذّرت كل النداءات)، أو خروج
    // بطاقة أو زر عليه التركيز — رسمٌ كامل يُؤجَّل ما دام التركيز في القائمة أو مرشحاتها (drawListSoon).
    function refreshList() {
        if (!page.sources.length || !listView) return void drawListSoon();
        const listed = listedItems();
        const items = visibleItems(listed);
        if (jevVisible() !== listView.jev) return void drawListSoon();
        const shown = items.slice(0, page.shown);
        const rest = items.length - shown.length;
        const holder = focusedCard();
        if ((holder && !shown.some((item) => item.id === holder))
            || (!rest && listView.more && listView.more.contains(document.activeElement))) return void drawListSoon();

        listView.count.textContent = items.length + ' عنصر';
        if (listView.chips.size) {
            const counts = countBuckets(listed, resultOf);
            for (const [bucket, text] of listView.chips) text.nodeValue = chipText(bucket, counts);
        }
        const cards = new Map();
        const nodes = shown.map((item) => {
            const old = listView.cards.get(item.id);
            const parts = old && old.item === item ? patchCard(old) : card(item);
            cards.set(item.id, parts);
            return parts.node;
        });
        if (nodes.length) placeInOrder(list, nodes);   // يحل محل «لا جديد» إن كان ظاهراً
        else if (!listView.empty) replace(list, nothingNew());
        listView.cards = cards;
        listView.empty = !nodes.length;
        if (rest > 0 && listView.more) listView.more.textContent = moreText(rest);
        else if (rest > 0) more.appendChild(listView.more = moreButton(rest));
        else if (listView.more) { listView.more.remove(); listView.more = null; }
        drawBar();
    }

    // يضع العقد بالترتيب المطلوب دون نقل عقدة باقية (النقل يُسقط التركيز عنها ويضيّع موضع القراءة). البطاقات
    // الباقية والجديدة كلها بترتيب page.items، فيكفي حذف ما خرج وإدراج الجديد قبل أول باقٍ بعده.
    function placeInOrder(container, nodes) {
        const keep = new Set(nodes);
        for (const child of Array.from(container.children)) if (!keep.has(child)) child.remove();
        let cursor = container.firstElementChild;
        for (const node of nodes) {
            if (node === cursor) cursor = cursor.nextElementSibling;
            else container.insertBefore(node, cursor);
        }
    }

    // بطاقة باقية بعد دفعة: التحديد (قد يغيّره التحديد المسبق)، وشارات Jev وسطره إن تغيّرت نتيجتها. مربع التحديد
    // والنص والأزرار لا تُمس.
    function patchCard(parts) {
        const on = page.selected.has(parts.item.id);
        if (parts.check.checked !== on) parts.check.checked = on;
        parts.node.classList.toggle('wa-selected', on);
        const result = jevVisible() ? resultOf(parts.item) : null;
        const sig = jevSig(result);
        if (sig === parts.sig) return parts;
        const fresh = jevParts(parts.item, result);
        for (const node of parts.badges) node.remove();
        parts.kindBadge.after(...fresh.badges);
        parts.slot.replaceWith(fresh.slot);
        return Object.assign(parts, { badges: fresh.badges, slot: fresh.slot, fix: fresh.fix, sig: sig });
    }

    // ما يتغير به ما يعرضه Jev على البطاقة: النتيجة (بمفتاحها) وتصحيح المالك
    function jevSig(result) {
        return result ? result.key + '\n' + (result.owner_label || '') : '';
    }

    function focusedCard() {
        const active = document.activeElement;
        if (!active || !list.contains(active)) return null;
        for (const [id, parts] of listView.cards) if (parts.node.contains(active)) return id;
        return null;
    }

    // التركيز على عنصر يُعاد بناؤه مع الرسم الكامل (بطاقة، قائمة منسدلة، شريحة، «عرض المزيد»)؛ حقل البحث وحده
    // باقٍ في كل رسم، فلا يُحسب.
    function focusInList() {
        const active = document.activeElement;
        return Boolean(active) && active !== search && (listHead.contains(active) || list.contains(active) || more.contains(active));
    }

    // رسم كامل تطلبه دفعة في الخلفية: الآن إن لم يكن المالك يستعمل شيئاً في القائمة، وإلا حين يخرج التركيز منها.
    // شريط التحديد يُحدَّث في الحالين (التحديد المسبق قد غيّره).
    function drawListSoon() {
        if (!focusInList()) return void drawList();
        redrawPending = true;
        drawBar();
    }

    // خرج التركيز من عنصر في القائمة: يُعاد تقدير ما أُجِّل بعد أن يستقر التركيز، فإن بقي في القائمة على عنصر
    // آخر يُحدَّث ما يمكن في مكانه ويبقى الباقي مؤجلاً.
    function flushPending() {
        if (!redrawPending) return;
        setTimeout(() => {
            if (!redrawPending || !root.isConnected) return;
            redrawPending = false;
            refreshList();
        }, 0);
    }

    // بطاقة عنصر، وأجزاؤها التي تُحدَّث في مكانها مع دفعات الفرز (patchCard):
    //   { node, item, check, kindBadge, badges: شارات Jev بعد شارة التصنيف، slot: خانة سطر Jev، fix: «تصحيح Jev»، sig }
    function card(item) {
        const block = item.main.block;
        const source = item.main.source;
        const info = sentInfo(item);
        const sent = Boolean(info && !info.failed);

        const check = el('input', { type: 'checkbox', checked: page.selected.has(item.id), disabled: sent });
        check.addEventListener('change', () => {
            if (check.checked) {
                page.selected.add(item.id);
                unticked.delete(itemText(item));
            } else {
                page.selected.delete(item.id);
                noteUntick(item);
            }
            autoPicked.delete(item.id);   // صار تحديد المالك لا تحديد Jev
            node.classList.toggle('wa-selected', check.checked);
            drawBar();
        });

        const result = jevVisible() ? resultOf(item) : null;
        const jev = jevParts(item, result);
        const others = [...new Set(item.copies.filter((c) => c !== item.main).map((c) => c.source.group))];
        const kindBadge = badge(KIND_AR[block.kind], KIND_TONE[block.kind]);
        const badges = [kindBadge].concat(jev.badges);
        if (item.copies.length > 1) badges.push(badge('نُشر ' + item.copies.length + ' مرات', 'neutral'));
        if (block.attachments.length) badges.push(badge(block.attachments.length + ' مرفق', 'blue'));
        else if (block.documents.length) badges.push(badge('مستند لم يُصدَّر', 'orange'));
        else if (block.media) badges.push(badge('صور لم تُصدَّر', 'neutral'));
        if (sent) badges.push(badge('أُرسل للمساعد', 'green'));
        else if (info && info.failed) badges.push(badge('فشل إرسال سابق', 'red'));
        if (page.copied.has(item.id)) badges.push(badge('نُسخ', 'neutral'));

        const text = el('div', { class: 'agent-text wa-text', text: block.text || '(وسائط بلا نص)' });
        const long = (block.text || '').split('\n').length > 9 || (block.text || '').length > 600;
        if (long && !page.expanded.has(item.id)) text.classList.add('wa-clamped');

        const actions = [
            long ? el('button', { type: 'button', class: 'wa-link', text: page.expanded.has(item.id) ? 'طيّ النص' : 'عرض كامل النص',
                onclick: (e) => {
                    text.classList.toggle('wa-clamped');
                    const clamped = text.classList.contains('wa-clamped');
                    if (clamped) page.expanded.delete(item.id); else page.expanded.add(item.id);
                    e.currentTarget.textContent = clamped ? 'عرض كامل النص' : 'طيّ النص';
                } }) : null,
            el('button', { type: 'button', class: 'wa-link', text: 'نسخ النص', onclick: () => copyText(pickText(pickRecord(item))) }),
            info ? el('a', { class: 'wa-link', href: '#/assistant/' + info.request_id, text: 'فتح الطلب' }) : null
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
                jev.slot,
                el('div', { class: 'wa-card-actions' }, actions)
            ])
        ]);
        return { node: node, item: item, check: check, kindBadge: kindBadge, badges: jev.badges, slot: jev.slot, fix: jev.fix, sig: jevSig(result) };
    }

    // شارة حكم Jev (وبعدها «Jev: عرض فاته الفرز» لما فات القارئ) وسطره مع «تصحيح Jev». بلا نتيجة: لا شارة،
    // وخانة السطر فارغة كما كانت قبل Jev.
    function jevParts(item, result) {
        if (!result) return { badges: [], slot: el('span'), fix: null };
        const jev = describe(result);
        const verdict = badge(jev.badge.text, jev.badge.tone);
        if (jev.reason) verdict.title = jev.reason;
        const badges = [verdict];
        if (isSurfaced(item.main.block.kind, result)) badges.push(badge(SURFACED_AR, 'blue'));
        // حكم «تعذّر الفرز» لا تحفظه الوظيفة، فلا صف يقبل «تصحيح Jev» (إجراء label يردّ «غير موجود»)
        const unsaved = Array.isArray(result.reasons) && result.reasons.indexOf('error') !== -1;
        const fix = unsaved ? null : fixControl(item, result);
        const slot = el('span', { class: 'wa-jev' }, [
            el('span', { class: 'crm-subtle', text: jev.note ? jev.footer + ' — ' + jev.note : jev.footer }),
            fix ? fix.node : null
        ]);
        return { badges: badges, slot: slot, fix: fix ? fix.select : null };
    }

    // «تصحيح Jev»: نية الرسالة كما يراها المالك. تُحفظ في الوظيفة (إجراء label) فتقيس «دقة Jev»، ويتغير بها
    // الحكم هنا. النص نفسه في أكثر من عنصر يشترك في النتيجة، فيتصحح معها. اختيار القيمة لا يحفظها — سهم واحد على
    // القائمة وهي مغلقة يغيّر قيمتها، ولا يُمحى تصحيح محفوظ — بل زر «حفظ» يظهر حين تختلف عن المحفوظة.
    function fixControl(item, result) {
        const select = el('select', { class: 'wa-kind', title: 'تصحيح Jev' },
            [el('option', { value: '', text: 'تصحيح Jev' })]
                .concat(INTENTS.map((intent) => el('option', { value: intent, text: INTENT_AR[intent] }))));
        select.value = result.owner_label || '';
        const save = el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'حفظ', hidden: true, disabled: true });
        const dirty = () => Boolean(select.value) && select.value !== (result.owner_label || '');
        const showSave = () => { save.hidden = save.disabled = !dirty(); };
        select.addEventListener('change', showSave);
        save.addEventListener('click', async () => {
            if (!dirty()) return;
            const label = select.value;
            select.disabled = save.disabled = true;
            const out = await labelTriage(supabase, result.key, label);
            if (!root.isConnected) return;
            select.disabled = false;
            if (!out.ok) {
                select.value = result.owner_label || '';
                showSave();
                if (out.error) console.warn('[CRM] wa-triage label', out.error);
                return void fail(outError(out), 'تعذّر حفظ تصحيح Jev');
            }
            const refocus = [save, select, document.body, null].indexOf(document.activeElement) !== -1;
            // ما أخفاه التصحيح من القائمة (عرض فاته الفرز صار «ليس عرضاً» مثلاً) لا يبقى محدداً وهو مخفي،
            // وما حدده Jev ثم لم يعد حكمه «مقترح للإرسال» يُلغى تحديده
            let dropped = keepSelectionVisible(() => { result.owner_label = label; });
            if (bucketOf(result) !== 'send') {
                for (const other of page.items) {
                    if (autoPicked.has(other.id) && resultOf(other) === result) {
                        page.selected.delete(other.id);
                        autoPicked.delete(other.id);
                        dropped += 1;
                    }
                }
            }
            notify('حُفظ تصحيح Jev: ' + INTENT_AR[label] + (dropped ? '، وأُلغي تحديد الرسالة' : ''), 'success', 3000);
            drawList();
            // يعود التركيز إلى «تصحيح Jev» في البطاقة نفسها إن بقيت ظاهرة، فلا يضيع موضع من يستعمل لوحة المفاتيح
            const parts = refocus && listView ? listView.cards.get(item.id) : null;
            if (parts && parts.fix) parts.fix.focus();
        });
        return { node: el('span', { class: 'wa-fix' }, [select, save]), select: select };
    }

    // تغيّرٌ من جهة Jev (توقفه، أو تصحيح المالك) قد يُخفي بطاقات كانت ظاهرة: ما كان منها محدداً يُلغى تحديده، فلا
    // يُرسل ما لم يعد المالك يراه. ما يخفيه المالك بالمرشحات لا يمس التحديد، كما كان قبل Jev. يعيد عدد ما أُلغي.
    function keepSelectionVisible(change) {
        const before = page.sources.length ? visibleItems() : [];
        change();
        if (!before.length) return 0;
        const after = new Set(visibleItems().map((item) => item.id));
        let dropped = 0;
        for (const item of before) {
            if (after.has(item.id) || !page.selected.has(item.id)) continue;
            page.selected.delete(item.id);
            autoPicked.delete(item.id);
            dropped += 1;
        }
        return dropped;
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            notify('نُسخ النص', 'success', 2000);
            return true;
        } catch (_) {
            notify('تعذّر النسخ من المتصفح', 'error');
            return false;
        }
    }

    function selectVisible() {
        for (const item of visibleItems().slice(0, page.shown)) {
            page.selected.add(item.id);
            unticked.delete(itemText(item));
            autoPicked.delete(item.id);
        }
        drawList();
    }

    // «إلغاء التحديد» إلغاءٌ باليد لكل ما كان محدداً، فلا يعيد التحديد المسبق تحديده
    function clearSelection() {
        for (const item of page.items) if (page.selected.has(item.id)) noteUntick(item);
        page.selected.clear();
        autoPicked.clear();
        drawList();
    }

    function noteUntick(item) {
        const text = itemText(item);
        if (text) unticked.add(text);
    }

    function sendingBlocked() {
        return Boolean(page.extraction && page.extraction.reachable && !page.extraction.enabled);
    }

    function drawBar() {
        const n = page.selected.size;
        // ما حدده Jev قد يقع بعد البطاقات المعروضة: عدده هنا ليعرف المالك ما سيرسله
        barCount.textContent = n ? 'المحدد: ' + n + (autoPicked.size ? ' (حدّد Jev منها ' + autoPicked.size + ')' : '') : 'لا شيء محدد';
        barQuota.textContent = sendingBlocked() ? 'الإرسال متوقف: الاستخراج التلقائي غير مفعّل'
            : page.remaining === null ? '' : 'المتبقي من طلبات المساعد اليوم: ' + page.remaining + ' من ' + page.cap;
        sendBtn.disabled = n === 0 || page.sending || sendingBlocked() || page.remaining === 0;
        copyBtn.disabled = n === 0;
    }

    /* ---------- النسخ والإرسال ---------- */

    async function copySelected() {
        const chosen = page.items.filter((item) => page.selected.has(item.id));
        if (!chosen.length) return;
        if (!(await copyText(chosen.map((item) => pickText(pickRecord(item))).join('\n\n')))) return;
        for (const item of chosen) page.copied.add(item.id);
        drawList();
    }

    // كل عرض محدد ← طلب مستقل للمساعد بتعليمات ثابتة ونص المصدر، ثم يبدأ تنفيذه فوراً (والمُجدوِل
    // يلتقط ما لم يبدأ). ما أُرسل سابقاً لا يُرسل ثانية، والإرسال يتوقف عند الحد اليومي.
    // حين يوجد ما حدده Jev: ما حدده المالك أولاً بترتيبه المعتاد، ثم ما حدده Jev بثقة النية من الأعلى، فإن قطع
    // الحدُّ اليومي الإرسالَ سقط الأقل ثقة (sendOrder). بلا تحديد مسبق يبقى الترتيب كما كان.
    async function sendSelected() {
        const chosen = sendOrder(page.items.filter((item) => page.selected.has(item.id) && !isSent(item)),
            { auto: autoPicked, resultOf: resultOf });
        if (!chosen.length || page.sending) return;
        const limit = page.remaining === null ? chosen.length : Math.min(chosen.length, page.remaining);
        if (!limit) return void notify('بلغت الحد اليومي لطلبات المساعد', 'error');
        page.sending = true;
        drawBar();
        let done = 0;
        try {
            for (const item of chosen.slice(0, limit)) {
                sendBtn.textContent = 'جارٍ الإرسال ' + (done + 1) + ' من ' + limit + '…';
                const id = await createRequest('project', {
                    title: titleOf(item.main.source.group, item.main.block),
                    instruction: INSTRUCTION,
                    text: item.main.text,
                    textName: 'whatsapp'
                });
                item.sentRequest = id;
                page.selected.delete(item.id);
                autoPicked.delete(item.id);
                startExtraction(id);
                done += 1;
            }
        } catch (error) {
            fail(error, 'توقف الإرسال بعد ' + done + ' من ' + limit);
        } finally {
            page.sending = false;
            sendBtn.textContent = 'إرسال للمساعد';
            await refreshQuota();
            drawSummary();
            drawList();
        }
        if (done) notify('أُرسل ' + done + ' عرضاً للمساعد. تظهر مسوداتها في «طلبات الاعتماد» خلال دقائق.', 'success', 7000);
        if (chosen.length > limit) notify('لم يُرسل ' + (chosen.length - limit) + ' عرضاً لبلوغ الحد اليومي', 'error', 7000);
    }

    /* ---------- فرز Jev ---------- */
    // لا يبدأ فرز من drawList ولا card ولا drawBar: يبدأ بعد التحميل، وبعد توسيع المدة، وحين تصل حالة الفرز.

    function jevOn() {
        return Boolean(triage.status && triage.status.reachable && triage.status.enabled) && triage.mode !== 'off';
    }

    // واجهة Jev على القائمة حين يعمل الفرز أو توجد نتائج؛ إن تعذّرت كل النداءات عادت القائمة كما كانت
    function jevVisible() {
        return jevOn() && (store.byKey.size > 0 || runner.progress().busy);
    }

    function resultOf(item) {
        return resultFor(store, item);
    }

    function applyStatus(st) {
        if (!root.isConnected) return;
        // ما أظهره Jev وحده (عرض فاته الفرز) يختفي حين يتوقف: لا يبقى محدداً وهو مخفي
        keepSelectionVisible(() => {
            triage.status = st;
            triage.mode = st.mode;
        });
        drawJevControls();
        if (jevOn()) enqueueTriage(); else runner.reset();
        // التحديد المسبق يتبع الوضع: في «تحديد المقترح تلقائياً» يُحسب الآن مما وصل من نتائج (لا ينتظر دفعة قد لا
        // تأتي)، وفي غيره يُلغى كل ما حدده Jev — «اقتراحات»: التحديد بيد المالك، «متوقف»: الصفحة كما كانت قبل Jev
        if (jevOn() && triage.mode === 'preselect') applyPreselection(); else dropAutoPicks();
        drawTriageLine();
        if (page.sources.length) drawList();
    }

    function dropAutoPicks() {
        for (const id of autoPicked) page.selected.delete(id);
        autoPicked.clear();
    }

    // «فرز Jev: متوقف / اقتراحات / تحديد المقترح تلقائياً» — يظهر حين تردّ الوظيفة فقط. اختيار الوضع لا يحفظه
    // (سهم واحد على القائمة وهي مغلقة يغيّر قيمتها، والوضع للجميع)، بل زر «حفظ» يظهر حين يختلف عن المحفوظ.
    let modeSelect = null;   // قائمة الوضع الظاهرة، ليعود إليها التركيز بعد الحفظ
    function drawJevControls() {
        const st = triage.status;
        reportCard.hidden = !jevOn();
        modeSelect = null;
        if (!st || !st.reachable) {
            jevBox.hidden = true;
            clear(jevBox);
            return;
        }
        const modeSel = el('select', { class: 'wa-kind', title: 'وضع فرز Jev' }, MODES.map((mode) => el('option', { value: mode, text: MODE_AR[mode] })));
        modeSel.value = triage.mode;
        const save = el('button', { type: 'button', class: 'btn btn-outline btn-xs', text: 'حفظ', hidden: true, disabled: true });
        modeSel.addEventListener('change', () => { save.hidden = save.disabled = modeSel.value === triage.mode; });
        save.addEventListener('click', () => saveMode(modeSel, save));
        const note = triage.mode !== 'off' && !st.enabled ? (st.message || 'فرز Jev غير متاح الآن.') : MODE_HINT[triage.mode];
        replace(jevBox, [
            el('label', { class: 'wa-jev-pick' }, [el('strong', { text: 'فرز Jev:' }), modeSel]),
            save,
            el('small', { class: 'crm-subtle', text: note })
        ]);
        jevBox.hidden = false;
        modeSelect = modeSel;
    }

    // الحفظ كـ finishReview: crm_settings يكتبه المدير وحده (RLS). بعده تُسأل الوظيفة عن حالتها من جديد.
    async function saveMode(modeSel, save) {
        const mode = normalizeMode(modeSel.value);
        if (mode === triage.mode) return;
        modeSel.disabled = save.disabled = true;
        const savedAt = new Date().toISOString();
        const { error } = await supabase.from('crm_settings')
            .upsert([{ key: MODE_KEY, value: mode, updated_at: savedAt }], { onConflict: 'key' });
        if (!root.isConnected) return;
        if (error) {
            modeSel.disabled = false;
            modeSel.value = triage.mode;
            save.hidden = true;
            return void fail(error, 'تعذّر حفظ وضع فرز Jev');
        }
        notify('حُفظ وضع فرز Jev: ' + MODE_AR[mode], 'success');
        let st = Object.assign({}, triage.status, { mode: 'off', enabled: false });
        if (mode !== 'off') {
            triage.mode = mode;
            st = await triageStatus(supabase);
            if (!root.isConnected) return;
        }
        // إن بقي التركيز على قائمة الوضع أو زر الحفظ (أو ضاع) يعود إلى القائمة الجديدة
        const refocus = [modeSel, save, document.body, null].indexOf(document.activeElement) !== -1;
        applyStatus(st);
        if (refocus && modeSelect) modeSelect.focus();
    }

    // كل عنصر جديد بلا نتيجة، أياً كان تصنيفه، يُفرز في الخلفية
    function enqueueTriage() {
        if (jevOn() && page.sources.length) runner.add(page.items.filter(isNew));
        drawTriageLine();
    }

    function drawTriageLine() {
        const line = jevOn() ? progressLine(runner.progress()) : '';
        triageText.textContent = line ? ' · ' + line : '';
    }

    // رد دفعة من الجولة الحالية: تحديد مسبق (إن كان الوضع)، ثم سطر الحالة، ثم تحديث القائمة في مكانها
    function onTriageBatch(info) {
        if (info.failed && !info.out.skipped) console.warn('[CRM] wa-triage', info.out.error || info.out.message || info.out);
        if (!info.failed) applyPreselection();
        drawTriageLine();
        refreshList();
    }

    // وضع «تحديد المقترح تلقائياً» وحده. ما حدده Jev يُعاد حسابه من كل النتائج حتى الآن — مع كل دفعة، وبعد كل
    // تحميل، وحين تتغير المدة أو نقطة المراجعة، وحين يُختار الوضع — فيبقى المحدد هو الأعلى ثقة حتى حد اليوم، وبين
    // ما تُظهره المرشحات وحده. تحديد المالك لا يُمس.
    function applyPreselection() {
        if (!jevOn() || triage.mode !== 'preselect' || page.sending || !page.sources.length) return;
        for (const id of autoPicked) page.selected.delete(id);
        autoPicked.clear();
        const ids = preselect(visibleItems(), {
            resultOf: resultOf,
            selected: page.selected,
            unticked: unticked,
            cap: page.remaining === null ? page.cap : page.remaining,
            taken: page.items.filter((item) => page.selected.has(item.id) && !isSent(item)).length,
            // ما لم يرجع استعلام «أُرسل للمساعد» لكل نسخه (بصمة لم تُحسب، أو استعلام لم يأتِ دوره أو تعذّر)
            // لا يُعرف أأُرسل أم لا، فلا يُحدَّد: إرساله قد يكرر طلباً قائماً
            isSent: (item) => isSent(item) || item.copies.some((c) => !c.hash || !page.checked.has(c.hash))
        });
        for (const id of ids) {
            page.selected.add(id);
            autoPicked.add(id);
        }
    }

    // «دقة Jev»: يُقرأ التقرير عند كل فتح، والقراءة الأقدم التي تصل بعد أحدث تُهمل
    let reportSeq = 0;
    async function loadReport() {
        const seq = ++reportSeq;
        replace(reportBody, el('div', { class: 'crm-subtle', text: 'جارٍ تحميل دقة Jev…' }));
        let out;
        try {
            out = await supabase.rpc('wa_triage_report', { p_days: REPORT_DAYS });
        } catch (error) {
            out = { data: null, error: error };
        }
        if (seq !== reportSeq || !reportBody.isConnected) return;
        if (out.error) return void replace(reportBody, errorBox(out.error, 'تعذّر تحميل دقة Jev'));
        const view = reportView(out.data, KIND_AR);
        if (view.error) return void replace(reportBody, el('div', { class: 'crm-error', text: view.error }));
        replace(reportBody, [
            view.tables.map(reportTable),
            view.empty ? empty('لا فرز خلال آخر ' + REPORT_DAYS + ' يوماً.') : null
        ]);
    }

    function reportTable(table) {
        return el('div', { class: 'wa-jev-table' }, [
            el('h4', { text: table.title }),
            el('div', { class: 'crm-table-wrap' }, el('table', { class: 'crm-table' }, [
                el('thead', {}, el('tr', {}, table.head.map((h) => el('th', { text: h })))),
                el('tbody', {}, table.rows.map((row) => el('tr', {}, row.map((cell, i) => el('td', { class: i ? 'num' : null, text: cell })))))
            ]))
        ]);
    }
}
