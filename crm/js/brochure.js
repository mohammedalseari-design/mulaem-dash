// ‎#/studio‎ — «استوديو البروشورات» (للمدير): الموظف يرفع بروشور المطوّر، فيخرج بروشور ملائم بعدد صفحاته نفسه، صفحة لكل صفحة.
//
// brochure-pdf.js يقرأ الملف في المتصفح: كل صورة ومخطط ملفاً قائماً كما يظهر في الصفحة، وكل صفحة صورةً وتحتها صورها مرقّمة،
// فتُرسل الصفحات طلبَ «بروشور» للمساعد (036، agent-run يقرؤها مجموعاتٍ متوازية) وتُرفع الصور إلى المخزن العام ومعها media.json.
// المساعد يكتب لكل صفحة دورها ونصوصها كما طُبعت وأدوار صورها في agent_requests.result، وbrochure-read.js يبني منها مخطط
// الصفحات، ثم يُرسم البروشور هنا. لا يدخل البروشور إلا ما في بروشور المطوّر نفسه.
// الرسم: عناصر DOM بـ el() لا HTML، فكل نص من البروشور يمرّ نصاً. الصفحة حاوية (container-type) وكل المقاسات بوحدة cqw،
// فالتصميم نفسه يصغر في المعاينة ويُطبع بمقاسه. الطباعة: نسخة من الصفحات في #broPrint، وbrochure.css يخفي ما سواها،
// ثم «حفظ كـ PDF» من نافذة المتصفح. الشعار ملف الشعار الرسمي نفسه (images/logo.jpg) كما هو، لا يُعاد رسمه.
// الإخراج: لكل مشروع اتجاهه الفني (brochure-art.js) من المشروع نفسه — ألوانه وخطاه وغلافه وإيقاعه — وهوية ملائم ثابتة فيه بألوانه.

import { supabase } from './supabase.js';
import { brochureFacts, validateSpec, chaptersOf, groupOf, splitFigure, guaranteePage, numberRows, unprinted, restates, modelLabel } from './brochure-plan.js';
import { readingToBrochure } from './brochure-read.js';
import { readBrochurePdf, MAX_PAGES } from './brochure-pdf.js';
import { artDirection, directionStyle, directionLabel } from './brochure-art.js';
import { createRequest, startExtraction } from './agent.js';
import { el, replace, loading, empty, errorBox, errorText, pageHead, notify, money, fmtDate, fmtDateTime, badge } from './ui.js';

const LOGO = '../images/logo.jpg';
const SLOGAN = 'ملائم العقارية.. حيث تجد ما يناسبك';
// صور البروشور في المخزن العام لصور المشاريع (001: يرفع إليه المدير والميداني، ويُقرأ برابط عام)
const MEDIA_BUCKET = 'project-images';
const MAX_PDF_BYTES = 80 * 1024 * 1024;
const POLL_MS = 5000;
const STEPS = ['قراءة الملف', 'إرسال الصفحات للمساعد', 'رفع الصور', 'المساعد يقرأ البروشور', 'البروشور جاهز'];

/* ===================== الاستوديو ===================== */

export async function renderStudio(root) {
    const file = el('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'crm-hidden', 'aria-label': 'بروشور المطوّر PDF' });
    const status = el('div');
    const recent = el('div');
    file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (f) startBrochure(f, status);
    });
    replace(root, [
        pageHead('استوديو البروشورات', 'ارفع بروشور المطوّر، فيقرؤه المساعد صفحةً صفحة ويخرج منه بروشور ملائم بعدد صفحاته نفسه. لا يُكتب فيه إلا ما في البروشور نفسه.', [
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'ارفع بروشور مطوّر', onclick: () => file.click() })
        ]),
        file,
        status,
        recent
    ]);
    drawRecent(recent);
}

// آخر البروشورات المقروءة (طلبات «بروشور» للمدير)، لفتحها ثانية
async function drawRecent(box) {
    const { data, error } = await supabase.from('agent_requests').select('id, title, status, created_at')
        .eq('kind', 'brochure').order('created_at', { ascending: false }).limit(8);
    if (!box.isConnected || error || !data || !data.length) return;
    const tone = { ready: 'green', failed: 'red', cancelled: 'neutral' };
    const word = { ready: 'جاهز', failed: 'تعذّرت القراءة', cancelled: 'أُلغي', queued: 'ينتظر', running: 'يقرأ' };
    replace(box, el('div', { class: 'crm-card' }, [
        el('h3', { class: 'crm-section-title', text: 'بروشورات قرأها المساعد' }),
        el('div', { class: 'bro-picker' }, data.map((r) => el('a', { class: 'bro-pick', href: '#/studio/b/' + r.id }, [
            el('strong', { text: r.title || 'بروشور' }),
            el('span', { class: 'crm-subtle', text: fmtDateTime(r.created_at) }),
            el('span', {}, badge(word[r.status] || r.status, tone[r.status] || 'gold'))
        ])))
    ]));
}

// المراحل الحقيقية: كل مرحلة تُعلَّم حين تبدأ فعلاً، وسطر تحتها يصف ما يجري الآن («قراءة صفحة 5 من 32»)
function stepsView(current, detail) {
    return el('div', { class: 'crm-card bro-steps' }, [
        el('ol', {}, STEPS.map((s, i) => el('li', { class: i < current ? 'done' : i === current ? 'now' : '' }, s))),
        detail ? el('div', { class: 'crm-subtle', text: detail }) : null
    ]);
}

let busy = false;
async function startBrochure(file, status) {
    if (busy) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return void notify('ارفع ملف PDF', 'error');
    if (file.size > MAX_PDF_BYTES) return void notify('الملف أكبر من ' + Math.round(MAX_PDF_BYTES / 1048576) + ' ميغابايت', 'error');
    busy = true;
    const show = (i, detail) => { if (status.isConnected) replace(status, stepsView(i, detail)); };
    try {
        show(0, 'فتح الملف');
        const read = await readBrochurePdf(file, (t) => show(0, t));
        if (!read.pages.length) throw new Error('لم تُقرأ أي صفحة من الملف');
        const files = read.pages.map((p) => new File([p.blob], 'p' + String(p.n).padStart(2, '0') + '.jpg', { type: 'image/jpeg' }));
        show(1, read.pageCount > MAX_PAGES ? 'البروشور ' + read.pageCount + ' صفحة، يُقرأ أول ' + MAX_PAGES + ' منها' : read.pages.length + ' صفحة');
        const id = await createRequest('brochure', {
            title: file.name.replace(/\.pdf$/i, '').replace(/[‎‏‪-‮]/g, '').trim().slice(0, 80) || 'بروشور',
            instruction: 'اقرأ بروشور المطوّر هذا لاستوديو البروشورات.',
            files,
            progress: (t) => show(1, t)
        });
        show(2, read.images.length + ' صورة ومخطط');
        const media = { version: 2, file: file.name, pages: read.pageCount, read: read.pages.length, images: [], fills: read.fills || [], links: read.links || [] };
        const put = async (path, blob, type) => {
            const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: type === 'png' ? 'image/png' : 'image/jpeg', upsert: false });
            if (error) throw error;
            return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
        };
        for (const [i, img] of read.images.entries()) {
            show(2, 'رفع صورة ' + (i + 1) + ' من ' + read.images.length);
            const name = 'brochures/' + id + '/img-' + String(i + 1).padStart(2, '0');
            const url = await put(name + '.' + img.type, img.blob, img.type);
            // صور لوحة المطوّر كلٌّ وحدها (img-05-1.jpg …)، ورقم اللوحة تحت صفحتها واحد كما رآها المساعد
            const parts = [];
            for (const [k, p] of (img.parts || []).entries()) {
                parts.push({ url: await put(name + '-' + (k + 1) + '.' + p.type, p.blob, p.type), w: p.w, h: p.h, kind: p.kind, deep: p.deep, quiet: p.quiet, focus: p.focus, detail: p.detail, tall: p.tall, box: p.box, view: p.view });
            }
            media.images.push({ url, page: img.page, w: img.w, h: img.h, kind: img.kind, tone: img.tone, deep: img.deep, quiet: img.quiet, focus: img.focus, bg: img.bg,
                detail: img.detail, alpha: img.alpha, raster: img.raster, view: typeof img.view === 'string' ? img.view : null, vector: img.vector === true, text: typeof img.text === 'number' ? img.text : null, crop: img.crop, tall: img.tall, parts: parts.length >= 2 ? parts : null, on: img.on });
        }
        const manifest = new Blob([JSON.stringify(media)], { type: 'application/json' });
        const { error: mediaError } = await supabase.storage.from(MEDIA_BUCKET).upload('brochures/' + id + '/media.json', manifest, { contentType: 'application/json', upsert: true });
        if (mediaError) throw mediaError;
        startExtraction(id);
        location.hash = '#/studio/b/' + id;
    } catch (error) {
        console.error('[CRM] brochure', error);
        if (status.isConnected) replace(status, el('div', { class: 'crm-error', text: 'تعذّر تجهيز البروشور: ' + errorText(error) }));
    } finally {
        busy = false;
    }
}

/* ===================== بروشور قرأه المساعد ===================== */

async function mediaOf(id) {
    try {
        const url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl('brochures/' + id + '/media.json').data.publicUrl;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return null;
        const json = await res.json();
        return json && Array.isArray(json.images) ? json : null;
    } catch (_) {
        return null;
    }
}

export async function renderBrochureReading(root, requestId, lastStage) {
    if (lastStage === undefined) replace(root, loading('جارٍ فتح البروشور'));
    const { data: req, error } = await supabase.from('agent_requests')
        .select('id, kind, title, status, stage, error_ar, result, created_at').eq('id', requestId).maybeSingle();
    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل البروشور'));
    if (!req || req.kind !== 'brochure') return void replace(root, empty('البروشور غير موجود'));
    const head = pageHead(req.title || 'بروشور', 'من بروشور المطوّر الذي رُفع ' + fmtDateTime(req.created_at) + '.', [
        el('a', { class: 'btn btn-outline btn-sm', href: '#/studio', text: 'الاستوديو' })
    ]);

    if (req.status === 'queued' || req.status === 'running') {
        const detail = req.status === 'running' && req.stage === 'extracting' ? 'يقرأ الصفحات الآن، كل أربع صفحات معاً'
            : req.error_ar ? req.error_ar : 'في الطابور';
        // تُعاد الرسمة حين يتغير ما يُعرض: الحالة أو المرحلة أو رسالة المحاولة المعادة (تبقى «في الانتظار» والرسالة تتغير)
        const mark = req.status + '|' + req.stage + '|' + (req.error_ar || '');
        if (lastStage !== mark) replace(root, [head, stepsView(3, detail + ' — تبقى الصفحة مفتوحة وتتحدث وحدها')]);
        setTimeout(() => {
            if (root.isConnected && location.hash === '#/studio/b/' + requestId) renderBrochureReading(root, requestId, mark);
        }, POLL_MS);
        return;
    }
    if (req.status !== 'ready' || !req.result) {
        return void replace(root, [head, el('div', { class: 'crm-error', text: 'تعذّرت قراءة البروشور: ' + (req.error_ar || 'لا قراءة') }),
            el('p', { class: 'crm-subtle', text: 'ارفع الملف مرة أخرى من الاستوديو، أو جرّب نسخة أوضح منه.' })]);
    }

    const [media, office] = await Promise.all([
        mediaOf(requestId),
        supabase.from('crm_settings').select('value').eq('key', 'office_whatsapp').maybeSingle()
    ]);
    if (!root.isConnected) return;
    const whatsapp = office && office.data ? office.data.value : null;
    // صور البروشور من مخزنه هو فقط (media.json في مخزن يرفع إليه الميداني أيضاً)
    const mediaPrefix = supabase.storage.from(MEDIA_BUCKET).getPublicUrl('brochures/' + requestId + '/').data.publicUrl;
    // «تصميم آخر» (variation) ينتقل بين بدائل الاتجاه الفني المتّسقة؛ والقراءة نفسها لا تتغير
    const build = (variation) => {
        const b = readingToBrochure(req.result, media || { images: [] }, { id: requestId, mediaPrefix });
        if (!b) return null;
        const facts = brochureFacts(b.project, { whatsapp });
        const direction = artDirection({ facts, spec: b.spec }, variation);
        return { facts, spec: directed(b.spec, direction), notes: b.notes, direction };
    };
    const first = build(0);
    if (!first) {
        return void replace(root, [head, el('div', { class: 'crm-error', text: 'هذه القراءة من نسخة سابقة من الاستوديو.' }),
            el('p', { class: 'crm-subtle', text: 'ارفع الملف مرة أخرى من الاستوديو، فيُقرأ صفحةً صفحة.' })]);
    }
    if (!media) first.notes.unshift('صور البروشور لم تُقرأ من المخزن — البروشور بالخط وحده.');
    // ملاحظة الخادم على قراءة اكتملت بما قُرئ (سقف اليوم، أو خطأ في الحساب بعد صفحات قُرئت)
    if (req.error_ar) first.notes.unshift(req.error_ar);
    showBrochure(root, {
        title: first.facts.name || req.title || 'بروشور',
        sub: 'من بروشور «' + (req.title || '') + '»، ' + pagesWord(first.spec.pages.length) + ' كأصله. راجع الملاحظات والصفحات ثم احفظه PDF.',
        notes: first.notes,
        build
    });
}

// عرض البروشور: زر PDF واحد في الرأس، و«تصميم آخر» رابطاً، وملاحظات القراءة إن وُجدت فوق الصفحات
function showBrochure(root, opts) {
    let variation = 0;
    let fontCheck = Promise.resolve();
    const pagesBox = el('div', { class: 'bro-pages' });
    const note = el('span', { class: 'crm-subtle' });
    // الفكرة الإبداعية في سطرين للموظف (دستور المصمم): الوعد الرئيسي كما طُبع في بروشور المطوّر، وزاوية الإخراج. لا يُطبع منها شيء
    const idea = el('p', { class: 'crm-subtle bro-idea' });
    const lost = el('ul', { class: 'agent-list' });
    const draw = () => {
        const { facts, spec, direction } = opts.build(variation);
        const errors = validateSpec(spec, facts);
        if (errors.length) return void replace(pagesBox, el('div', { class: 'crm-error', text: 'المخطط غير صالح: ' + errors.join('، ') }));
        note.textContent = pagesWord(spec.pages.length) + ' · ' + directionLabel(direction) + (facts.images.length ? '' : ' · بلا صور، فالغلاف بالخط وحده');
        idea.textContent = 'الفكرة: ' + (direction.idea.promise ? '«' + direction.idea.promise + '» — ' : '') + direction.idea.angle;
        const nodes = renderPages(spec, facts, direction);
        replace(pagesBox, nodes);
        fontCheck = unscaleIfMissing(nodes, direction.type);
        // كل نص قرأه المساعد يُطبع: ما لم يظهر في صفحته (نص أو رقم أو مكوّن) يُكتب هنا ليراجعه المدير
        const items = unprinted(spec, facts, nodes.map((n) => n.textContent)).map((x) => 'صفحة ' + x.page + ': لم يُطبع «' + x.text + '»');
        const show = (list) => { replace(lost, list.slice(0, 8).map((t) => el('li', { text: t }))); lostBox.hidden = !list.length; };
        show(items);
        // وفقرة لم يتسع مكانها لكل أسطرها فقُصّت: تُكتب كذلك، بعد تحميل الخط فتُقاس الأسطر كما تُطبع
        const token = ++drawn;
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => {
            if (token !== drawn) return;
            const cut = [];
            nodes.forEach((pg, i) => pg.querySelectorAll('p').forEach((p) => {
                if (p.clientHeight && p.scrollHeight > p.clientHeight + 2) cut.push('صفحة ' + (i + 1) + ': لم يتسع مكانه لكل النص «' + p.textContent.trim().slice(0, 48) + '…»');
            }));
            if (cut.length) show([...items, ...cut]);
        }));
    };
    let drawn = 0;
    const lostBox = el('div', { class: 'crm-warn-box bro-notes bro-lost', hidden: true }, [el('strong', { text: 'نص من بروشور المطوّر لم يُطبع — راجعه' }), lost]);
    replace(root, [
        pageHead(opts.title, opts.sub, [
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'تحميل PDF', onclick: () => printPages(pagesBox, fontCheck) })
        ]),
        el('div', { class: 'bro-bar' }, [
            el('a', { class: 'link-btn', href: '#/studio', text: 'الاستوديو' }),
            el('button', { type: 'button', class: 'link-btn', text: 'تصميم آخر', title: 'إخراج آخر يناسب المشروع، بالقراءة نفسها',
                onclick: () => { variation += 1; draw(); } }),
            note
        ]),
        idea,
        opts.notes && opts.notes.length ? el('div', { class: 'crm-warn-box bro-notes' }, [
            el('strong', { text: 'ملاحظات القراءة — راجعها قبل المشاركة' }),
            el('ul', { class: 'agent-list' }, opts.notes.map((n) => el('li', { text: n })))
        ]) : null,
        lostBox,
        pagesBox
    ]);
    draw();
}

// المخطط بغلاف الاتجاه الفني: نسق الغلاف (حتى خط القسمة، أو شريط، أو الصفحة كلها) لصورته نفسها؛ وغلاف بلا صورة يبقى بالخط
function directed(spec, direction) {
    const first = spec.pages[0];
    if (!first || first.kind !== 'cover' || first.variant === 'type' || direction.rhythm.cover === 'type' || first.variant === direction.rhythm.cover) return spec;
    return { ...spec, pages: [{ ...first, variant: direction.rhythm.cover }, ...spec.pages.slice(1)] };
}

// «12 صفحة»، «5 صفحات»
function pagesWord(n) {
    return n + (n >= 3 && n <= 10 ? ' صفحات' : ' صفحة');
}

// الطباعة: الصفحات وحدها بمقاسها بلا هوامش. تنتظر الخطوط والصور حتى لا تُطبع صفحة ناقصة. التنظيف بعد afterprint لا بعد
// window.print(): في Safari على الجوال ترجع print() فوراً قبل أن تُلتقط الصفحات، فحذفها بعدها مباشرة كان يطبع ورقة فارغة.
async function printPages(pagesBox, fontCheck) {
    // مقاس العناوين قبل النسخ: خط الزوج حُمّل، أو رجع إلى سلّمه (unscaleIfMissing)؛ ولا تنتظر الطباعة شبكة معلّقة أكثر من 4 ثوانٍ
    await Promise.race([fontCheck, new Promise((done) => setTimeout(done, 4000))]);
    document.getElementById('broPrint')?.remove();
    const holder = el('div', { id: 'broPrint' }, Array.from(pagesBox.querySelectorAll('.bro-page')).map((p) => p.cloneNode(true)));
    document.body.appendChild(holder);
    document.body.classList.add('bro-printing');
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('bro-printing');
        holder.remove();
    }, { once: true });
    await document.fonts.ready;
    await Promise.all(Array.from(holder.querySelectorAll('img')).map((img) => img.complete ? null
        : new Promise((done) => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); })));
    notify('في نافذة الطباعة اختر «حفظ كـ PDF»، والهوامش «بلا»', 'info', 7000);
    window.print();
}


// زوج خطوط بمقاس معدَّل (--dk: مركزي أصغر عيناً فيكبر 22%) يُعدَّل خطه هو لا البديل: إن لم يُحمَّل خط عناوينه (Google Fonts
// محجوب، أو فشل الملف) رجع المقاس إلى سلّمه، وإلا كبُر خط النظام البديل وفاض العنوان من حقله في الصفحة وفي PDF. يُطلب بنص
// عربي فيُحمَّل ملف العربية نفسه من أقسام الخط (unicode-range)
function unscaleIfMissing(nodes, type) {
    if (!type || type.k === 1 || !document.fonts || !document.fonts.load) return Promise.resolve();
    return document.fonts.load(type.w.title + ' 1em "' + type.display + '"', 'ابجد')
        .then((faces) => faces.some((f) => f.status === 'loaded'), () => false)
        .then((ok) => {
            if (!ok) nodes.forEach((n) => { n.style.setProperty('--dk', '1'); n.style.setProperty('--dl', '1'); });
        });
}


/* ===================== رسم الصفحات ===================== */
// نظام «مونوغراف» (brochure.css): حقل للكلام يميناً (60–96) وحقل للصورة أو المخطط أو الأرقام يساراً (4–52) يفصلهما خط
// القسمة عند 56. البروشور كتاب: فهرس في صفحة صورتها صارت الغلاف، وفصول مرقّمة (المشروع، الموقع، المميزات، الضمانات، النماذج،
// الملاحق، تواصل) يبدأ كل منها برقمه بلا رقم صفحة وعنوانه أكبر من أسماء الوحدات، وعنوان الفصل رأسُ كل صفحة فيه.
// الخط سلّم واحد من سبع درجات (--fs1 … --fs7 في brochure.css)، فلا مقاس خارجه.
// الألوان والخطوط من الاتجاه الفني (brochure-art.js) خصائصَ CSS على كل صفحة: ورق في أغلب الصفحات، ورمل للفهارس والفواصل،
// والحقل العميق لصفحات داكنة قليلة (عددها من الاتجاه) لا تتجاور، وللغلاف الخلفي؛ ودرجته الفاتحة لكتل الفصل الثاني من النماذج،
// والحجري للمباعة. وإيقاعه أصنافاً على الصفحة: الطابع وزوج الخطوط، والصور لوحات بهوامش (bro-r-framed)، وكتلة الكلام فوق الصورة
// الكاملة على الداكن (bro-pd)، ورقم الفصل الأكبر (bro-ob)؛ والغلاف على الحقل العميق حين يطلبه الاتجاه.
// هوية ملائم في كل صفحة بألوان المشروع: علامة الشعار في رأس الصفحة، والشعار الرسمي لوناً واحداً على الغلافين.
// لا تتجاور صفحتان بالتكوين نفسه: الثانية من لقطتين متتاليتين صورة كبيرة وصورتان صغيرتان، والثانية من صفحتي موقع تنعكس، وصفحات
// «عن المشروع» بصورة تتناوب الصورة يساراً ثم يميناً. وصفحة واحدة على الأقل صورة تملأ الصفحة (افتتاح الموقع)، و«تواصل معنا» شريط
// صورة الغلاف. ولا تُطبع صورة أكبر مما تحمل بكسلاتها: إطار أصغر بدل صورة لينة، والصورة المستعارة المعروضة في صفحة أخرى تفصيلٌ منها.

export function renderPages(spec, facts, direction) {
    const total = spec.pages.length;
    const chapters = chaptersOf(spec, facts);
    const d = direction || artDirection({ facts, spec }, 0);
    const style = directionStyle(d);
    const r = d.rhythm;
    const look = ['bro-m-' + d.mood, 'bro-y-' + d.type.name, r.photos === 'framed' ? 'bro-r-framed' : null, r.panel === 'deep' ? 'bro-pd' : null,
        r.opener === 'bold' ? 'bro-ob' : null].filter(Boolean);
    let group = -1, groupKey = null, lastTone = null, lastAlt = false, says = 0, dark = 0, splits = 0;
    return spec.pages.map((page, i) => {
        const prev = spec.pages[i - 1] || null;
        const at = chapters.of[i];
        const chapter = at >= 0 ? chapters.list[at] : null;
        const ctx = { n: i + 1, total, prev, next: spec.pages[i + 1] || null, group: 0, say: 0, chapters, spec, framed: r.photos === 'framed',
            section: chapter ? chapter.name : null, chap: chapter && chapter.page === i + 1 ? chapter : null };
        if (page.kind === 'model') {
            const key = groupOf(facts.models[page.model]);
            if (key !== groupKey) { group += 1; groupKey = key; }
            ctx.group = group;
        }
        if (page.kind === 'statement' && page.variant === 'say' && !(page.text && page.text.title)) ctx.say = says++;
        ctx.alt = Boolean(prev && prev.kind === page.kind && (page.kind === 'trio' || page.kind === 'location' || page.kind === 'pair') && !lastAlt);
        lastAlt = ctx.alt;
        ctx.mirror = (page.kind === 'about' && page.variant === 'split' && splits++ % 2 === 1) || ((page.kind === 'location' || page.kind === 'pair') && ctx.alt)
            || (page.kind === 'photo' && page.side === 'right');
        let tone = toneOf(page);
        // الغلاف بصورته على الحقل العميق حين يطلبه الاتجاه (الحضري)؛ وصفحتان داكنتان لا تتجاوران، ولا أكثر من عدد الاتجاه بالحقل
        // العميق غير الغلافين
        if (page.kind === 'cover' && page.variant !== 'type' && r.coverTone === 'deep') tone = 'deep';
        const inner = page.kind !== 'back' && page.kind !== 'cover';
        if (tone === 'deep' && inner && (lastTone === 'deep' || dark >= r.dark)) tone = 'sand';
        if (tone === 'deep' && inner) dark += 1;
        ctx.tone = tone;
        lastTone = tone;
        const cls = ['bro-page', 'bro-' + page.kind, 'bro-v-' + page.variant, 'bro-t-' + tone, ...look];
        if (ctx.alt) cls.push('bro-alt');
        if (ctx.mirror) cls.push('bro-mirror');
        if (ctx.chap) cls.push('is-chap');
        if (page.kind === 'model' && facts.models[page.model] && facts.models[page.model].sold) cls.push('bro-sold');
        const node = el('section', { class: cls.join(' '), style, 'aria-label': 'صفحة ' + (i + 1) });
        ctx.node = node;
        append(node, PAGES[page.kind](page, facts, ctx));
        return node;
    });
}

function toneOf(page) {
    const { kind, variant } = page;
    if (kind === 'back') return 'deep';
    if (kind === 'cover' && variant === 'type') return 'deep';
    if (kind === 'features' && variant === 'numbers') return 'deep';
    if (kind === 'statement' && variant === 'say') return page.text && page.text.title && figureIn(page.text.title) ? 'deep' : 'sand';
    if (kind === 'about' && variant === 'text' && !page.stats && items(page).length && !words(page, 'body')) return 'sand';
    return 'paper';
}

// أول عدد من رقمين إلى أربعة في جملة («بخبرة تمتد منذ عام 2010» ← 2010)
function figureIn(text) {
    const m = /(^|[^\d٠-٩])([\d٠-٩]{2,4})(?![\d٠-٩])/.exec(String(text || ''));
    return m ? m[2] : null;
}

function append(node, children) {
    for (const c of children) if (c) node.appendChild(c);
}

const PAGES = { cover, about, photo: photoPage, trio, pair, location: locationPage, model, features, back, statement };

// frame: { w, h } مقاس الإطار بـ cqw، فيُقصّ حول نقطة ثقل الصورة. الخريطة صورةً بلون المشروع؛ وخريطة الخطوط على شفاف حبرٌ على الورق
function img(facts, index, cls, frame) {
    const it = facts.images[index];
    return it ? el('div', { class: 'bro-img ' + (it.kind === 'map' ? (it.alpha ? 'bro-lines ' + (it.tone === 'light' ? 'is-light ' : '') : 'bro-duo ') : '') + (cls || '') },
        el('img', { src: it.url, alt: it.caption || facts.name || 'صورة المشروع', loading: 'eager', style: frame ? cropAt(it, frame.w, frame.h) : null })) : null;
}
// موضع القصّ حين يقصّ الإطار خُمس الصورة فأكثر: نقطة ثقلها (حيث تفاصيلها) في وسطه ما أمكن، فتُقصّ السماء الفارغة قبل الموضوع؛
// وصفحة المطوّر كاملةً صورةً (عنوانه مرسوم في سمائها) تُقصّ من أعلاها فلا يظهر نصف عنوانه بجانب عنوان ملائم
function cropAt(it, fw, fh) {
    if (!it || !it.w || !it.h || !fw || !fh) return null;
    const ir = it.w / it.h, fr = fw / fh;
    const f = it.focus || [0.5, 0.5];
    const clamp = (v) => Math.max(0, Math.min(1, v));
    if (ir < fr) {
        const seen = ir / fr;
        if (seen > 0.8 && !it.raster) return null;
        const y = it.raster ? 1 : clamp((f[1] - seen / 2) / (1 - seen));
        return 'object-position:50% ' + (y * 100).toFixed(1) + '%';
    }
    const seen = fr / ir;
    if (seen > 0.8) return null;
    return 'object-position:' + (clamp((f[0] - seen / 2) / (1 - seen)) * 100).toFixed(1) + '% 50%';
}

// 1cqw = 1% من عرض الصفحة = 8.42 نقطة مطبوعة (297 مم). لا تُطبع صورة أكبر مما تحمل بكسلاتها: تحت SOFT_DPI يصغر إطارها
// (لوحة بهوامش) بدل أن تُكبَّر فتلين، واللوحة نفسها بحد MIN_DPI
const PT_PER_CQW = 841.89 / 100, MIN_DPI = 150, SOFT_DPI = 135;
// دقة الصورة مطبوعةً في إطار w × h (بـ cqw) تملؤه، مقرّبةً zoom مرة
function dpiIn(it, w, h, zoom) {
    if (!it || !it.w || !it.h) return Infinity;
    const across = Math.min(it.w, it.h * (w / h));
    return (across / (zoom || 1)) / (w * PT_PER_CQW / 72);
}
// لوحة بنسبة الصورة (بين 2:3 و3:2) في صندوق box: { w, h } بـ cqw، بأكبر مقاس تحمله بكسلاتها. zoom > 1 تفصيل مقرّب من وسطها
// وأسفله قليلاً (موضوع صور العمارة تحت سمائها) في إطار 3:2 (أو 2:3 لصورة طولية)، لصورة عُرضت كاملةً في صفحة أخرى: الحجر والنحاس
// واللافتة من الواجهة، لا الواجهة نفسها مرة ثانية. ← { node, w, h }
function plate(facts, index, box, zoom, cls) {
    const it = facts.images[index];
    if (!it) return null;
    const r = zoom > 1 ? (it.w && it.h && it.h > it.w ? 2 / 3 : 1.5) : it.w && it.h ? Math.min(1.5, Math.max(2 / 3, it.w / it.h)) : 1;
    let w = Math.min(box.w, box.h * r);
    if (it.w && it.h) w = Math.min(w, ((Math.min(it.w, it.h * r) / zoom) / MIN_DPI) * 72 / PT_PER_CQW);
    const h = w / r;
    const node = el('div', { class: 'bro-img bro-plate-d ' + (it.kind === 'plan' ? 'is-plan ' : '') + (cls || ''), style: 'width:' + w.toFixed(2) + 'cqw;height:' + h.toFixed(2) + 'cqw' },
        el('img', { src: it.url, alt: it.caption || facts.name || 'صورة المشروع', loading: 'eager',
            style: zoom > 1 ? 'transform:scale(' + zoom + ');transform-origin:50% 62%' : null }));
    return { node, w, h };
}

function captionOf(facts, index, page) {
    const it = facts.images[index];
    return it && it.caption ? it.caption : page && page.text && page.text.title ? page.text.title : null;
}

// نص الصفحة كما قرأه المساعد
function words(page, key) {
    return page.text && page.text[key] ? page.text[key] : null;
}
function items(page) {
    return page.text && Array.isArray(page.text.bullets) ? page.text.bullets.filter(Boolean) : [];
}
function figures(page) {
    return page.text && Array.isArray(page.text.figures) ? page.text.figures.filter((f) => f && f.value) : [];
}

function place(facts) {
    return [facts.district ? facts.district.replace(/^حي\s+/, '') : null, facts.city].filter(Boolean).join(' – ');
}

// الكلمة الأولى نفسها («تواصل» و«تواصل معنا…»، «الضمانات» و«الضمانات»)
function startsWith(text, name) {
    const a = String(text || '').trim().split(/\s+/)[0], b = String(name || '').trim().split(/\s+/)[0];
    return Boolean(a && b) && a.replace(/^ال/, '') === b.replace(/^ال/, '');
}

// رأس الصفحة: رقمها واسم فصلها في الزاوية العليا. أول صفحة في الفصل: رقم الفصل واسمه، بلا رقم صفحة كعادة الكتب، والاسم يُترك
// إن بدأ به عنوان الصفحة نفسه («تواصل» فوق «تواصل معنا…»)
function folio(ctx) {
    return String(ctx.n).padStart(2, '0');
}
function run(ctx, headText) {
    if (ctx.chap) {
        return el('div', { class: 'bro-chap' }, [mark(), el('span', { class: 'bro-chap-n', text: ctx.chap.n }),
            startsWith(headText, ctx.chap.name) ? null : el('span', { class: 'bro-chap-t', text: ctx.chap.name })]);
    }
    return el('div', { class: 'bro-run' }, [mark(), el('span', { class: 'bro-num', text: folio(ctx) }), ctx.section ? el('span', { class: 'bro-run-t', text: ctx.section }) : null]);
}
// علامة ملائم قبل رقم الصفحة: رمز الشعار الرسمي نفسه (الجبال) مقصوصاً من ملفه بلون الإبراز، توقيعٌ في كل بروشور
function mark() {
    return el('span', { class: 'bro-mark', 'aria-hidden': 'true' }, el('img', { src: LOGO, alt: '' }));
}
function seam() {
    return el('div', { class: 'bro-seam', 'aria-hidden': 'true' });
}
// العنوان بدرجتين: عنوان أول صفحة في الفصل (--fs6) أكبر من أسماء الوحدات وعناوين الصفحات (--fs5)، والطويل درجة أصغر
function heading(text, ctx, extra) {
    if (!text) return null;
    const level = ctx && ctx.chap && text.length <= 30 ? ' is-chap' : text.length > 48 ? ' is-long' : '';
    return el('h2', { class: 'bro-h' + level + (extra ? ' ' + extra : ''), text });
}
function lead(page) {
    return words(page, 'subtitle') ? el('p', { class: 'bro-lead', text: words(page, 'subtitle') }) : null;
}
function ord(i) {
    return el('span', { class: 'bro-ord', text: String(i + 1).padStart(2, '0') });
}
// الرقم بخط الأرقام في اتجاه الأرقام («+700» لا تنقلب «700+»)، ووحدته صغيرة على خط رأسه: الوحدة العربية بعده في اتجاه الصفحة
// («ريال»، «سنوات»)، واللاتينية ملتصقة به في اتجاهه («300,000m»)
function figValue(n, unit, cls) {
    const latin = unit && /^[A-Za-z²%]+$/.test(unit);
    return el('div', { class: 'bro-fig-v' + (cls ? ' ' + cls : '') }, [
        el('span', { class: 'bro-fig-n' }, [n, latin ? el('small', { text: unit }) : null]),
        unit && !latin ? el('small', { text: unit }) : null
    ]);
}
function fig(label, value, unit, cls) {
    return el('div', { class: 'bro-fig' + (cls ? ' ' + cls : '') }, [
        label ? el('div', { class: 'bro-label', text: label }) : null,
        figValue(value, unit, String(value).replace(/\D/g, '').length >= 9 ? 'is-9' : '')
    ]);
}
// أرقام الصفحة البارزة كما طُبعت (سجل التطوير: «+700 عملاء»): سطر لكل رقم، العنوان يميناً والرقم كبيراً يساراً
function ledger(list, cls) {
    return el('dl', { class: 'bro-ledger' + (cls ? ' ' + cls : '') }, list.slice(0, 8).map((f) => {
        const s = splitFigure(f.value);
        return el('div', { class: 'bro-ledger-row' }, [
            el('dt', { text: f.label || '' }),
            el('dd', {}, s.n ? figValue(s.n, s.unit) : el('span', { class: 'bro-ledger-t', text: f.value }))
        ]);
    }));
}
function short(text) {
    return text && text.length <= 260 ? ' is-short' : '';
}
// «مباعة» علامة واضحة هادئة، لا أكبر كلمة في الصفحة
function soldTag() {
    return el('div', { class: 'bro-sold-fig' }, [el('div', { class: 'bro-label', text: 'الحالة' }), el('div', { class: 'bro-sold-v', text: 'مباعة' })]);
}
// شعار ملائم الرسمي (الملف نفسه) لوناً واحداً بألوان المشروع: بحبر اللوحة على الورق، وبلون الكلام على الداكن — مرشّح على الصورة
// لا شعار يُعاد رسمه
function logo(cls, light) {
    return el('span', { class: 'bro-logo ' + cls + (light ? ' is-light' : ''), role: 'img', 'aria-label': 'ملائم العقارية' }, el('img', { src: LOGO, alt: '' }));
}
// «ملائم العقارية.. حيث تجد ما يناسبك» سطرين بلا «..»
function sloganLines() {
    return SLOGAN.split(/\s*\.{2,}\s*/).filter(Boolean);
}

/* ---------- الغلاف ---------- */
// low: الصورة البانورامية شريط عريض بعرض الصفحة والاسم كبيراً تحته؛ side: الصورة حتى خط القسمة والاسم في حقل الكلام؛
// type: بلا صورة، حقل الصورة بلون المشروع. شعار ملائم صغيراً في هامش الورق
// وسطر الغلاف ما طبعه المطوّر تحت اسم مشروعه («وحدات سكنية جاهزه»)، وإلا شعار المشروع. type: بلا صورة في البروشور كله، غلاف
// بلون المشروع كله: الاسم كبيراً بعرض الصفحة، وسطره، وأرقام المشروع (السعر من، والمساحات، وعدد الوحدات) صفاً في أسفله.
// full: الصورة تملأ الصفحة، والاسم وبياناته وشعار ملائم على كتلة في زاويتها السفلى الأهدأ. والغلاف على الحقل العميق (الاتجاه
// الحضري) شعاره بلون الكلام على الداكن
function cover(page, facts, ctx) {
    const name = facts.name || 'مشروع';
    const line = page.text && page.text.subtitle ? page.text.subtitle : facts.tagline;
    const dark = Boolean(ctx && ctx.tone === 'deep');
    if (page.variant === 'type') {
        const figs = [...projectFigures(facts), facts.units_count ? fig('عدد الوحدات', String(facts.units_count)) : null].filter(Boolean);
        return [
            el('div', { class: 'bro-cover-name bro-type-name' }, [
                el('h1', { class: 'bro-title' + (name.length > 26 ? ' is-long' : ''), text: name }),
                facts.nameLatin ? el('div', { class: 'bro-latin', text: facts.nameLatin }) : null,
                line ? el('div', { class: 'bro-type-line', text: line }) : null
            ]),
            el('div', { class: 'bro-type-foot' }, [
                figs.length ? el('div', { class: 'bro-mini' }, figs) : null,
                el('div', { class: 'bro-cover-foot' }, [
                    place(facts) ? el('span', { class: 'bro-kicker', text: place(facts) }) : null,
                    facts.developer ? el('span', { text: 'تطوير ' + facts.developer }) : null,
                    facts.license ? el('span', { text: facts.license }) : null
                ])
            ]),
            logo('bro-logo-tab', true)
        ];
    }
    const low = page.variant === 'low';
    const nameBlock = el('div', { class: 'bro-cover-name' }, [
        el('h1', { class: 'bro-title' + (name.length > 26 ? ' is-longer' : name.length > 14 ? ' is-long' : ''), text: name }),
        facts.nameLatin ? el('div', { class: 'bro-latin', text: facts.nameLatin }) : null
    ]);
    const kicker = place(facts) ? el('div', { class: 'bro-kicker', text: place(facts) }) : null;
    const tagline = line ? el('div', { class: 'bro-tagline', text: line }) : null;
    const sold = facts.soldOut ? el('div', { class: 'bro-tag', text: 'نفدت الوحدات' }) : null;
    const foot = facts.developer || facts.license ? el('div', { class: 'bro-cover-foot' }, [
        facts.developer ? el('span', { text: 'تطوير ' + facts.developer }) : null,
        facts.license ? el('span', { text: facts.license }) : null
    ]) : null;
    if (page.variant === 'full') {
        const it = facts.images[page.images[0]];
        return [img(facts, page.images[0], 'bro-cover-photo', ctx && ctx.framed ? { w: 92, h: 48.25 } : { w: 100, h: 56.25 }),
            el('div', { class: 'bro-cover-card' + (it && it.quiet === 'left' ? ' is-left' : '') }, [kicker, nameBlock, tagline, sold,
                el('div', { class: 'bro-cover-end' }, [foot, logo('bro-logo-tab', dark)])])];
    }
    return [
        img(facts, page.images[0], 'bro-cover-photo', low ? { w: 100, h: 34 } : { w: 56, h: 56.25 }),
        nameBlock,
        el('div', { class: 'bro-cover-meta' }, [kicker, tagline, sold, foot]),
        logo('bro-logo-tab', dark)
    ];
}

// المساحة بلا وحدتها: «41–225» أو «165»
function areaValue(facts) {
    if (facts.areaRange) return facts.areaRange[0] === facts.areaRange[1] ? money(facts.areaRange[0]) : money(facts.areaRange[0]) + '–' + money(facts.areaRange[1]);
    return facts.area ? money(facts.area) : null;
}

function projectFigures(facts) {
    const area = areaValue(facts);
    const ranged = facts.areaRange && facts.areaRange[0] !== facts.areaRange[1];
    return [
        facts.price ? fig(facts.priceFrom ? 'الأسعار تبدأ من' : 'السعر', money(facts.price), 'ريال') : null,
        area ? fig(ranged ? 'المساحات' : 'المساحة', area, 'م²') : null
    ].filter(Boolean);
}

// بيانات المشروع صفاً واحداً: عنوان صغير فوق كل قيمة
function factRows(facts) {
    const rows = [
        ['الموقع', place(facts)],
        ['المطوّر', facts.developer],
        ['عدد الوحدات', facts.units_count ? String(facts.units_count) : null],
        ['التسليم', facts.delivery_date ? fmtDate(facts.delivery_date) : facts.construction_status],
        ['الترخيص', facts.license]
    ].filter((r) => r[1]);
    return rows.length ? el('dl', { class: 'bro-facts', style: '--n:' + Math.min(3, rows.length) }, rows.map(([k, v]) => el('div', { class: 'bro-fact' }, [el('dt', { text: k }), el('dd', { text: v })]))) : null;
}

// بطاقة المشروع في حقل الأرقام: السعر والمساحات كبيرة، وتحتها بياناته
function projectSheet(facts) {
    const figs = projectFigures(facts);
    const rows = factRows(facts);
    if (!figs.length && !rows) return null;
    return el('div', { class: 'bro-fl bro-sheet' }, [figs.length ? el('div', { class: 'bro-figs' }, figs) : el('span'), rows]);
}

function near(list) {
    return list.length ? el('ul', { class: 'bro-near' + (list.length < 3 ? ' is-one' : '') }, list.slice(0, 8).map((l) => el('li', { text: l }))) : null;
}
function register(list, cls, max) {
    return el('ol', { class: cls }, list.slice(0, max || 16).map((x, j) => el('li', {}, [ord(j), el('span', { text: x })])));
}

// سطر واحد قصير تحت نص «عن المشروع» («مفهوم بصري يوازن بين العمارة…»): قراءة ثانية بخط العناوين، لا سطر صغير في الذيل
function quoteOf(list) {
    return list.length === 1 && list[0].length <= 90 ? el('p', { class: 'bro-quote', text: list[0] }) : null;
}

function about(page, facts, ctx) {
    const body = page.text ? words(page, 'body') : facts.description;
    const list = items(page);
    const figs = figures(page);
    const quote = quoteOf(list);
    const stats = page.stats === true || (!page.text && page.stats !== false);
    const title = words(page, 'title') || facts.tagline || facts.name || '';
    const head = [heading(title, ctx), lead(page)];
    const para = body ? el('p', { class: 'bro-p' + short(body), text: body }) : null;
    if (page.variant === 'split') {
        // الصورة يساراً في الأولى ويميناً في التالية (bro-mirror)، والكلام في الحقل المقابل
        const nums = figs.length ? figs.map((f) => { const s = splitFigure(f.value); return s.n ? fig(f.label, s.n, s.unit) : null; }).filter(Boolean)
            : stats ? projectFigures(facts) : [];
        return [img(facts, page.images[0], ctx.mirror ? 'bro-bleed-r' : 'bro-bleed-l'), run(ctx, title), el('div', { class: 'bro-fr' }, [
            ...head, para, quote || near(list),
            nums.length ? el('div', { class: 'bro-mini' }, nums.slice(0, 3)) : null
        ])];
    }
    // صفحة كلام: البطاقة، أو أرقام الصفحة سجلاً كبيراً في حقل الأرقام، أو فهرس القائمة الطويلة، أو النص كبيراً في حقل الأرقام
    if (stats) return [run(ctx, title), el('div', { class: 'bro-fr' }, [...head, para, quote || near(list)]), seam(), projectSheet(facts)];
    if (figs.length) {
        return [run(ctx, title), el('div', { class: 'bro-fr' }, [...head, para, quote || (list.length ? register(list, 'bro-index', 12) : null)]), seam(),
            el('div', { class: 'bro-fl bro-fl-figs' }, ledger(figs))];
    }
    if (list.length && !body && !quote) {
        // قائمة قصيرة وحدها (فهرس المطوّر، أسماء أقسامه): كبيرة في منتصف الحقل المقابل لا أسطراً صغيرة في أسفله
        const field = list.length <= 8 ? el('ol', { class: 'bro-fl bro-places' + (list.length > 5 ? ' is-more' : '') }, list.map((x, j) => el('li', {}, [ord(j), el('span', { text: x })])))
            : register(list, 'bro-fl bro-index');
        return [run(ctx, title), el('div', { class: 'bro-fr' }, [heading(title, ctx, 'is-list'), head[1]]), seam(), field];
    }
    return [run(ctx, title), el('div', { class: 'bro-fr' }, [...head, quote || near(list)]), seam(),
        body ? el('div', { class: 'bro-fl' }, el('p', { class: 'bro-big-p', text: body })) : null];
}

// صفحة صورة: full عريضة بعرض الصفحة وشريط ورق تحتها برقم الصفحة (أو رقم الفصل واسمه في أوله) وتعليقها؛ tall طولية بنسبتها
// وارتفاع الصفحة كله عند حافتها، وحقل ورق بجانبها فيه رأس الصفحة وتعليقها؛ plate لوحة بهوامش بحد بكسلاتها
function photoPage(page, facts, ctx) {
    const i = page.images[0], it = facts.images[i];
    const cap = captionOf(facts, i, page);
    const head = ctx.chap ? [mark(), el('span', { class: 'bro-chap-n bro-strip-n', text: ctx.chap.n }), el('span', { class: 'bro-chap-t', text: ctx.chap.name })]
        : [mark(), el('span', { class: 'bro-num', text: folio(ctx) })];
    if (page.variant === 'tall' && it && it.w && it.h) {
        // حتى خط القسمة (56) إن بقي ثلاثة أرباع ارتفاعها فأكثر وحملت بكسلاتها العرض، وإلا بنسبتها كاملة
        const own = 56.25 * (it.w / it.h);
        const w = own / 56 >= 0.72 && dpiIn(it, 56, 56.25) >= SOFT_DPI ? 56 : Math.min(52, own);
        const photo = img(facts, i, 'bro-tall', { w, h: 56.25 });
        if (photo) photo.style.width = w.toFixed(2) + 'cqw';
        return [photo, el('div', { class: 'bro-tall-field', style: '--w:' + w.toFixed(2) + 'cqw' }, [run(ctx, cap), cap ? el('p', { class: 'bro-tall-cap', text: cap }) : null])];
    }
    // اللوحة في وسط الصفحة بين هامشين، وتعليقها تحتها على حافتها. والطولية في المعرض (هدوء فاخر) بارتفاع الصفحة كله كغيرها:
    // لوحةً في الوسط صغرت صور الجوال الطولية وتتابعت صفحاتٍ فارغة (حكما الجولة 2026-10-28)
    if (page.variant === 'plate' || page.variant === 'tall') {
        const box = page.variant === 'tall' ? { w: 62, h: 46, top: 5.4 } : { w: 62, h: 42, top: 7.4 };
        const p = plate(facts, i, box, 1, 'bro-plate-photo');
        if (p) {
            const top = box.top + (box.h - p.h) / 2, right = (100 - p.w) / 2;
            p.node.style.top = top.toFixed(2) + 'cqw';
            p.node.style.right = right.toFixed(2) + 'cqw';
            return [run(ctx, cap), p.node, cap ? el('p', { class: 'bro-plate-cap', style: 'top:' + (top + p.h + 0.8).toFixed(2) + 'cqw;right:' + right.toFixed(2) + 'cqw', text: cap }) : null];
        }
    }
    return [img(facts, i, 'bro-plate', { w: 100, h: 50 }), el('div', { class: 'bro-strip' }, [...head, cap ? el('span', { class: 'bro-cap', text: cap }) : null])];
}

// لقطات: ثلاث لوحات بهوامش وتعليق تحت كل منها؛ والتالية مباشرة صورة كبيرة تنزف من الحافة وصورتان صغيرتان، والتعليقات على سطر واحد
function trio(page, facts, ctx) {
    const panel = (i, cls) => el('figure', { class: cls || '' }, [img(facts, i), el('figcaption', { text: (facts.images[i] && facts.images[i].caption) || '' })]);
    if (!ctx.alt) return [run(ctx), el('div', { class: 'bro-panels' }, page.images.map((i) => panel(i)))];
    const list = page.images.slice(0, 3);
    const big = list[list.length - 1];
    return [run(ctx), panel(big, 'bro-big'), el('div', { class: 'bro-smalls' }, list.slice(0, -1).map((i) => panel(i)))];
}

// صورتان: الكبيرة تنزف حتى خط القسمة والصغيرة في حقل الكلام؛ والتالية مباشرة منعكسة (الكبيرة يميناً)
function pair(page, facts, ctx) {
    const cap = captionOf(facts, page.images[1]) || captionOf(facts, page.images[0]);
    return [img(facts, page.images[0], ctx.alt ? 'bro-bleed-r' : 'bro-bleed-l', { w: 56, h: 56.25 }), run(ctx),
        words(page, 'title') ? el('div', { class: 'bro-fr' }, heading(words(page, 'title'), ctx)) : null,
        img(facts, page.images[1], 'bro-pair-b', { w: 36, h: 27.85 }), cap ? el('span', { class: 'bro-cap', text: cap }) : null];
}

// الموقع: المسافات المطبوعة («7 دقائق عن جدة سوبردوم») سجلاً في كل نسق، ورابط الخرائط كما وضعه المطوّر. بلا خريطة: الكلام يميناً،
// والمسافات (أو المعالم كبيرة إن قلّت) في الحقل المقابل
function locationPage(page, facts, ctx) {
    const body = page.text ? words(page, 'body') : facts.address;
    const list = items(page).length ? items(page) : facts.landmarks;
    const figs = figures(page);
    const title = words(page, 'title') || place(facts);
    // مسافات كثيرة بجانب الصورة: العنوان درجة أصغر فيبقى للنص سطراه وللمسافات مكانها
    const head = [heading(title, ctx, figs.length >= 4 && page.variant !== 'text' ? 'is-long' : null), lead(page)];
    const para = body ? el('p', { class: 'bro-p', text: body }) : null;
    const link = page.link && /^https:\/\//.test(page.link) ? el('a', { class: 'bro-maplink', href: page.link, target: '_blank', rel: 'noopener', text: 'الموقع على الخرائط' }) : null;
    const dist = figs.length ? ledger(figs, 'is-compact') : null;
    if (page.variant === 'hero') {
        // الصورة الجوية تملأ الصفحة، والكلام على كتلة ورق بعرض حقل الكلام (44) في الزاوية السفلى الأهدأ من الصورة (quiet في
        // media.json)، فيبقى موضوعها (الحي المضاء على القناة) ظاهراً. العنوان فيها بدرجة عنوان الصفحة ورقم الفصل فوقه
        const it = facts.images[page.images[0]];
        return [img(facts, page.images[0], 'bro-full'), el('div', { class: 'bro-panel is-site' + (it && it.quiet === 'left' ? ' is-left' : '') }, [
            run(ctx, title), heading(title, null), lead(page), para, near(list), dist, link
        ])];
    }
    if (page.variant === 'map') {
        const fr = el('div', { class: 'bro-fr' }, [...head, para, near(list), dist, link]);
        // الثانية بعد صفحة موقع تنعكس: الصورة تنزف يميناً، والكلام على كتلة بدرجة لون المشروع الفاتحة يساراً
        if (ctx.alt) return [img(facts, page.images[0], 'bro-bleed-r'), el('div', { class: 'bro-block bro-block-l bro-pale' }, [run(ctx, title), fr])];
        return [img(facts, page.images[0], 'bro-bleed-l'), run(ctx, title), fr];
    }
    if (figs.length) {
        return [run(ctx, title), el('div', { class: 'bro-fr' }, [...head, para, near(list), link]), seam(), el('div', { class: 'bro-fl bro-fl-figs' }, ledger(figs))];
    }
    const field = !list.length ? null : list.length <= 4 ? el('ol', { class: 'bro-fl bro-places' }, list.map((x, j) => el('li', {}, [ord(j), el('span', { text: x })])))
        : register(list, 'bro-fl bro-index', 16);
    return [run(ctx, title), el('div', { class: 'bro-fr' }, [...head, para, link]), seam(), field];
}

/* ---------- النموذج ---------- */
// المواصفات: المساحة والغرف ودورات المياه، ومساحات الأجزاء المكتوبة في مكوّناته («165م² مباني»، «60م² سطح»)؛ والمكوّنات
// بلا تكرار وبلا سطر يعيد عدد دورات المياه نفسه
const AREA_PART = /^([\d٠-٩]+(?:[.,][\d٠-٩]+)?)\s*(?:م²|م2)\s+(\S.*)$/;
function latinDigits(t) {
    return String(t).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}
// وسطر يكمل ما قبله («يحتوي على غرفه ملابس + دورة مياة») يُطبع تحته لا بنداً مستقلاً
const CONTINUES = /^(?:يحتوي|تحتوي|يشمل|تشمل|ويحتوي|وتحتوي|مع\s|\+)/;
function specOf(m) {
    const extra = [], parts = [], seen = new Set();
    for (const p of m.parts) {
        const a = AREA_PART.exec(p);
        if (a) { extra.push([a[2].trim(), latinDigits(a[1])]); continue; }
        if (restates(p, m)) continue;
        if (CONTINUES.test(p) && parts.length) { parts[parts.length - 1].subs.push(p); continue; }
        if (!seen.has(p)) { seen.add(p); parts.push({ text: p, subs: [] }); }
    }
    const dims = [
        m.area ? ['المساحة', money(m.area), 'م²'] : null,
        m.rooms ? ['الغرف', String(m.rooms)] : null,
        m.bathrooms ? ['دورات المياه', String(m.bathrooms)] : null,
        ...extra.map(([k, v]) => [k, v, 'م²'])
    ].filter(Boolean);
    return { dims, parts, extra };
}

// شريط القياسات: ثلاث خانات في الصف، والصف الثاني على أعمدة الأول، ولكل خانة شعرتها تحتها
function dimsGrid(dims) {
    return dims.length ? el('div', { class: 'bro-dims' }, dims.map(([k, v, unit]) => el('div', { class: 'bro-dim' }, [
        el('div', { class: 'bro-label', text: k }),
        el('div', { class: 'bro-dim-v' }, [el('span', { text: v }), unit ? el('small', { text: unit }) : null])
    ]))) : null;
}

// المخطط في حقله (48 × 42 من عرض الصفحة): مخطط الوحدة مقصوصاً من لوحة المطوّر بأكبر حجم، ومخطط الدور صغيراً بجانبه أو
// تحته (أيهما ترك مخطط الوحدة أكبر)، والاثنان مجموعة واحدة في وسط حقلها، ومقاساتهما محسوبة هنا فتُطبع كما تُعرض.
// بلا قصّ: المخطط كله بنسبته
const PLAN_W = 48, PLAN_H = 42, PLAN_TOP = 6.4, KEY_AREA = 150, CAP_H = 2.6;
function fit(ratio, w, h) {
    return ratio > w / h ? { w, h: w / ratio } : { w: h * ratio, h };
}
function cropped(m, box, w, h, cls) {
    const [x0, y0, x1, y1] = box;
    const pct = (v) => (Math.round(v * 10000) / 100) + '%';
    const im = el('img', { src: m.plan, alt: 'مخطط ' + (m.name || 'النموذج'),
        style: 'width:' + pct(1 / (x1 - x0)) + ';height:' + pct(1 / (y1 - y0)) + ';left:' + pct(-x0 / (x1 - x0)) + ';top:' + pct(-y0 / (y1 - y0)) });
    return el('div', { class: 'bro-plan ' + cls + ' bro-plan-' + m.planTone + (m.planBoard ? ' bro-plan-board' : ''), style: 'width:' + w.toFixed(2) + 'cqw;height:' + h.toFixed(2) + 'cqw' }, im);
}
function planView(m, caption) {
    const ratio = m.planRatio;
    if (!ratio) {
        return [el('div', { class: 'bro-plan bro-plan-free bro-plan-' + m.planTone + (m.planBoard ? ' bro-plan-board' : '') }, el('img', { src: m.plan, alt: 'مخطط ' + (m.name || 'النموذج') })),
            el('div', { class: 'bro-plan-cap bro-plan-cap-free', text: caption })];
    }
    const unitBox = m.planUnit || [0, 0, 1, 1];
    const ru = ((unitBox[2] - unitBox[0]) * ratio) / (unitBox[3] - unitBox[1]);
    const key = m.planKey;
    let u = fit(ru, PLAN_W, PLAN_H), k = null, side = false;
    if (key) {
        const rk = ((key[2] - key[0]) * ratio) / (key[3] - key[1]);
        const kw = Math.sqrt(KEY_AREA * rk), kh = Math.sqrt(KEY_AREA / rk);
        const beside = fit(ru, PLAN_W - kw - 2.4, PLAN_H), below = fit(ru, PLAN_W, PLAN_H - kh - 3.2);
        side = beside.w * beside.h >= below.w * below.h;
        u = side ? beside : below;
        k = { w: kw, h: kh };
    }
    // المجموعة (الوحدة وتعليقها ومخطط الدور) في وسط الحقل: مخطط الوحدة جهة خط القسمة، ومخطط الدور جهة الحافة أسفلَ بجانبه أو تحته
    const gw = !k ? u.w : side ? u.w + 2.4 + k.w : Math.max(u.w, k.w);
    const gh = !k ? u.h + CAP_H : side ? Math.max(u.h, k.h) + CAP_H : u.h + CAP_H + 0.6 + k.h;
    const right = 52 - (PLAN_W - gw) / 2;
    const top = PLAN_TOP + (PLAN_H + CAP_H - gh) / 2;
    const ut = side && k.h > u.h ? top + k.h - u.h : top;
    const unit = cropped(m, unitBox, u.w, u.h, 'bro-plan-unit');
    unit.style.right = (100 - right).toFixed(2) + 'cqw';
    unit.style.top = ut.toFixed(2) + 'cqw';
    const out = [unit, el('div', { class: 'bro-plan-cap', style: 'right:' + (100 - right).toFixed(2) + 'cqw;top:' + (ut + u.h + 0.8).toFixed(2) + 'cqw', text: caption })];
    if (k) {
        const inset = cropped(m, key, k.w, k.h, 'bro-plan-key');
        if (side) {
            inset.style.left = (right - gw).toFixed(2) + 'cqw';
            inset.style.top = (ut + u.h - k.h).toFixed(2) + 'cqw';
        } else {
            inset.style.right = (100 - right).toFixed(2) + 'cqw';
            inset.style.top = (ut + u.h + CAP_H + 0.6).toFixed(2) + 'cqw';
        }
        out.push(inset);
    }
    return out;
}

// صفحة النموذج قالب واحد بمخطط وبلا مخطط: الاسم، والسعر أكبر رقم فيها (أو «مباعة»)، وشريط القياسات بالمساحة والغرف ودورات
// المياه، والمكوّنات، في الكتلة يميناً. وحقل المخطط: المخطط، وإلا صورة من صور المشروع بتعليقها، وإلا حقل هادئ بلون المشروع الفاتح
// اسم النموذج كما قُرئ؛ وبلا اسم عنوانُ صفحته المطبوع، ثم نوعه أو مساحته («وحدة 282 م²») — لا «النموذج» عنواناً لكل الصفحات
function modelName(m, page) {
    return modelLabel(m, page && page.text ? page.text.title : null, money);
}
function partsList(parts, label, cls) {
    return parts.length ? el('div', { class: 'bro-parts' + (cls ? ' ' + cls : '') }, [el('div', { class: 'bro-label', text: label }),
        el('ul', {}, parts.map((p) => el('li', {}, [p.text, ...p.subs.map((x) => el('span', { class: 'bro-sub', text: x }))])))]) : null;
}

function model(page, facts, ctx) {
    const m = facts.models[page.model];
    const plan = page.variant === 'plan';
    const name = modelName(m, page);
    const sub = [m.type && !name.startsWith(m.type) ? m.type : null, m.orientation].filter(Boolean).join(' · ');
    const { dims, parts, extra } = specOf(m);
    const price = m.sold ? soldTag() : m.price ? fig('السعر', money(m.price), 'ريال', 'bro-price') : null;
    // صفحة دورٍ من النموذج: اسمه ثم الدور تحته، ومكوّناته «مكوّنات الدور» لا الوحدة كلها
    const what = m.floor ? 'الدور' : 'الوحدة';
    const head = [el('h2', { class: 'bro-model-name' + (name.length > 14 ? ' is-long' : ''), text: name }),
        m.floor ? el('div', { class: 'bro-model-floor', text: m.floor }) : null,
        sub ? el('div', { class: 'bro-model-sub', text: sub }) : null];
    const tint = m.sold ? ' bro-stone' : ctx.group % 2 ? ' bro-pale' : '';
    if (page.variant === 'wide') {
        // بلا مخطط ولا صورة: الاسم والسعر في الكتلة، والقياسات والمكوّنات كبيرة في الحقل المقابل
        return [el('div', { class: 'bro-block' + tint }, [run(ctx), el('div', { class: 'bro-spec' }, [...head, price])]),
            el('div', { class: 'bro-wide' }, [dimsGrid(dims), partsList(parts, 'مكوّنات ' + what, 'is-wide')])];
    }
    const spec = el('div', { class: 'bro-spec' }, [...head, price, dimsGrid(dims), partsList(parts, 'مكوّنات ' + what)]);
    // تعليق المخطط: ومساحة المباني إن كُتبت في مكوّناته، فلا يبدو رقم المخطط («مساحتها 165م²») مناقضاً لمساحة الملحق كلها
    const built = extra.find(([k]) => /مبان/.test(k));
    const caption = 'مخطط ' + what + (built ? ' · ' + built[0] + ' ' + built[1] + ' م²' : '');
    const photo = !plan && (page.images || []).length ? page.images[0] : null;
    // صورة مستعارة من صور المشروع لا تخص هذه الوحدة: «صورة توضيحية» تحتها، فلا تُقرأ صورةً للوحدة نفسها
    const cap = photo === null ? null : page.lent ? [captionOf(facts, photo), 'صورة توضيحية'].filter(Boolean).join(' · ') : captionOf(facts, photo);
    const it = photo !== null ? facts.images[photo] : null;
    const small = photo !== null && (page.detail || dpiIn(it, 56, 50) < SOFT_DPI);
    const p = small ? plate(facts, photo, { w: 44, h: 40 }, page.detail ? 2 : 1, 'bro-plate-unit') : null;
    const visual = plan ? planView(m, caption)
        : p ? [p.node, el('div', { class: 'bro-plate-cap', style: 'top:' + (8 + p.h + 0.8).toFixed(2) + 'cqw', text: cap || '' })]
            : photo !== null ? [el('figure', { class: 'bro-unit-photo' }, [img(facts, photo), el('figcaption', { text: cap || '' })])]
                : [el('div', { class: 'bro-quiet', 'aria-hidden': 'true' })];
    return [...visual, el('div', { class: 'bro-block' + tint }, [run(ctx), spec])];
}

/* ---------- المزايا والضمانات ---------- */

// عنوان من كلمة واحدة وتتمته في السطر التالي («ضمانات» ثم «المشروع») عنوانٌ واحد
function joinedTitle(page) {
    const t = words(page, 'title'), s = words(page, 'subtitle');
    return t && s && !/\s/.test(t) && s.split(/\s+/).length <= 2 && !/ضمان/.test(s) ? t + ' ' + s : null;
}

function features(page, facts, ctx) {
    const list = items(page).length ? items(page) : facts.amenities;
    const joined = joinedTitle(page);
    const title = joined || words(page, 'title');
    // صفحة الضمانات تُعنون باسم قسمها حين يكرر المطوّر عليها عنوان صفحة سابقة («مميزات المشروع» مرتين)
    const repeated = title && ctx.spec.pages.slice(0, ctx.n - 1).some((p) => p.text && p.text.title === title);
    const headText = guaranteePage(page) && (repeated || !title) ? 'الضمانات' : title || 'مميزات المشروع';
    const head = heading(headText, ctx, 'bro-feat-h');
    const sub = joined ? null : lead(page);
    const body = words(page, 'body') ? el('p', { class: 'bro-p' + short(words(page, 'body')), text: words(page, 'body') }) : null;
    if (page.variant === 'numbers') {
        // العنوان والأرقام كتلة واحدة في وسط الصفحة: العدد كبيراً، ووحدته ثم بنده وشرطه تحته؛ حتى 12 رقماً صفّين، وسطر بلا عدد
        // («تأمين ضد العيوب الخفية») تحت الأرقام
        const rows = numberRows(page.text).slice(0, 12);
        const cols = rows.length <= 6 ? rows.length : Math.ceil(rows.length / 2);
        return [run(ctx, headText), el('div', { class: 'bro-nums-wrap' }, [el('div', {}, [head, sub]), el('ol', { class: 'bro-nums' + (rows.length > 6 ? ' is-many' : ''), style: '--cols:' + cols },
            rows.map((r) => el('li', {}, [
                el('div', { class: 'bro-nums-v', text: r.n }),
                r.unit ? el('div', { class: 'bro-nums-u', text: r.unit }) : null,
                r.label ? el('div', { class: 'bro-nums-k', text: r.label }) : null,
                r.note ? el('div', { class: 'bro-nums-c', text: r.note }) : null
            ]))), (page.extra || []).length ? el('p', { class: 'bro-nums-foot', text: page.extra.join(' · ') }) : null])];
    }
    // قائمة المزايا ومعها أرقام الصفحة البارزة: القائمة يميناً تحت العنوان، والأرقام سجلاً في الحقل المقابل تحت عنوانها الفرعي
    // («المميزات» ثم «الضمانات»)
    if (page.variant === 'mixed') {
        return [run(ctx, headText), el('div', { class: 'bro-fr' }, [head, register(list, 'bro-feats' + (list.length > 5 ? ' is-two' : ''), 16)]), seam(),
            el('div', { class: 'bro-fl bro-fl-figs' }, [words(page, 'subtitle') && !joined ? el('h3', { class: 'bro-h is-long bro-figs-h', text: words(page, 'subtitle') }) : null, ledger(figures(page))])];
    }
    // بجانب الصورة: القائمة عمودان إن طالت، فيبقى لعنوان الفصل الكبير مكانه فوقها. صورة عُرضت كاملة في صفحة أخرى (مستعارة) أو
    // صغيرة على الصفحة كلها: لوحة في حقل الصورة بحد بكسلاتها، تفصيلاً مقرّباً إن كانت مستعارة، عند خط القسمة وعلى سطر القائمة الأخير
    if (page.variant === 'photo') {
        const copy = el('div', { class: 'bro-fr' }, [head, sub, body, register(list, 'bro-feats' + (list.length > 5 ? ' is-two' : ''), 16)]);
        const it = facts.images[page.images[0]];
        if (page.detail || dpiIn(it, 56, 56.25) < SOFT_DPI) {
            const p = plate(facts, page.images[0], { w: 48, h: 44 }, page.detail ? 2 : 1, 'bro-plate-feat');
            return [run(ctx, headText), copy, seam(), p ? p.node : null];
        }
        return [img(facts, page.images[0], 'bro-bleed-l', { w: 56, h: 56.25 }), run(ctx, headText), copy];
    }
    // قائمة قصيرة (ستة أسطر فأقل): كبيرة في منتصف الحقل المقابل لا سطرين صغيرين في أسفله
    const field = list.length <= 6 ? el('ol', { class: 'bro-fl bro-places' }, list.map((x, j) => el('li', {}, [ord(j), el('span', { text: x })])))
        : register(list, 'bro-fl bro-feats' + (list.length > 12 ? ' is-three' : ''), 16);
    return [run(ctx, headText), el('div', { class: 'bro-fr' }, [head, sub, body]), seam(), field];
}

/* ---------- الصفحة الفاصلة، والفهرس، وافتتاح النماذج، و«تواصل معنا» ---------- */
// جملة كبيرة على الرمل، وقفة مقصودة لا صفحة ناقصة؛ وجملة فيها عدد («منذ عام 2010») بلون المشروع والعدد كبيراً جداً في موضعه
// من الجملة. الفواصل بلا نص تتناوب: شعار المشروع، ثم اسمه، ثم موقعه، ثم شعار ملائم
function statement(page, facts, ctx) {
    if (page.variant === 'chapter') return chapter(page, facts, ctx);
    if (page.variant === 'contents') return contents(page, facts, ctx);
    const t = page.text;
    if (t && t.title) {
        if (page.call || (ctx.next && ctx.next.kind === 'back')) return call(page, facts, ctx);
        const big = ctx.tone === 'deep' ? figureIn(t.title) : null;
        if (big) {
            // العدد يُكتب مرة واحدة كبيراً في موضعه من الجملة («بخبرة تمتد منذ عام [2010]»)، والجملة بدرجة عنوان الفصل
            const at = t.title.indexOf(big);
            const before = t.title.slice(0, at).trim(), after = t.title.slice(at + big.length).replace(/^[\s.،]+$/, '').trim();
            const level = ctx.chap ? ' is-chap' : '';
            return [run(ctx, t.title), el('h2', { class: 'bro-h bro-h-fig' + level }, [
                before ? el('span', { text: before }) : null,
                el('span', { class: 'bro-giant', text: big }),
                after ? el('span', { text: after }) : null
            ]), t.subtitle || t.body ? el('div', { class: 'bro-say-foot' }, [
                t.subtitle ? el('p', { class: 'bro-lead', text: t.subtitle }) : null,
                t.body ? el('p', { class: 'bro-p', text: t.body }) : null
            ]) : null];
        }
        return [run(ctx, t.title), el('div', { class: 'bro-say' }, [
            el('div', { class: 'bro-say-text' + (ctx.chap ? ' is-chap' : ''), text: t.title }),
            t.subtitle ? el('div', { class: 'bro-say-by', text: t.subtitle }) : null,
            t.body ? el('p', { class: 'bro-say-p', text: t.body }) : null,
            figures(page).length ? el('div', { class: 'bro-mini' }, figures(page).slice(0, 4).map((f) => { const s = splitFigure(f.value); return s.n ? fig(f.label, s.n, s.unit) : null; })) : null
        ])];
    }
    const lines = [
        facts.tagline ? [facts.tagline, facts.name] : null,
        facts.name ? [facts.name, facts.nameLatin] : null,
        place(facts) ? [place(facts), facts.name] : null,
        sloganLines()
    ].filter(Boolean);
    const [say, by] = lines[ctx.say % lines.length];
    return [run(ctx), el('div', { class: 'bro-say' }, [
        el('div', { class: 'bro-say-text', text: say }),
        by && by !== say ? el('div', { class: 'bro-say-by', text: by }) : null
    ])];
}

const BAND_H = 30;
// رقم واتساب المكتب كما يحفظه «الإعدادات» (966551234567) ← «+966 55 123 4567»، وغيره كما هو؛ ورابطه wa.me فيُفتح من الـPDF
function phoneText(value) {
    const m = /^966(5\d)(\d{3})(\d{4})$/.exec(String(value).replace(/\D/g, ''));
    return m ? '+966 ' + m[1] + ' ' + m[2] + ' ' + m[3] : String(value);
}
function phoneLink(value, cls) {
    const digits = String(value).replace(/\D/g, '');
    return digits.length >= 8 ? el('a', { class: cls, href: 'https://wa.me/' + digits, text: phoneText(value) }) : el('span', { class: cls, text: phoneText(value) });
}

// «تواصل معنا…» قبل الغلاف الخلفي: صفحة الدعوة بصورة الغلاف خاتمةً للكتاب والجملة كاملة بلون واحد — العنوان وتتمته
// («الخاصة بعملاء الكاش والدفعات») جملة واحدة — ورقم واتساب المكتب رابطاً. بلا صورة تحملها الصفحة: الجملة والرقم في الحقلين
function call(page, facts, ctx) {
    const t = page.text;
    ctx.node.classList.add('bro-cta');
    const sentence = el('h2', { class: 'bro-h bro-call-h' + (t.title.length + (t.subtitle || '').length > 60 ? ' is-long' : '') }, [
        el('span', { text: t.title }), t.subtitle ? ' ' : null, t.subtitle ? el('span', { class: 'bro-h-more', text: t.subtitle }) : null
    ]);
    const phone = facts.office.whatsapp ? el('div', { class: 'bro-call' }, [el('div', { class: 'bro-label', text: 'واتساب ملائم العقارية' }), phoneLink(facts.office.whatsapp, 'bro-call-n')]) : null;
    // كلام المطوّر الطويل في صفحة التواصل (إخلاء المسؤولية) سطرٌ صغير، والرقم هو العنصر الأول
    const body = t.body ? el('p', { class: t.body.length > 180 ? 'bro-fine-p' : 'bro-p', text: t.body }) : null;
    const it = (page.images || []).length ? facts.images[page.images[0]] : null;
    // صورة بانورامية (صورة الغلاف): شريط بعرض الصفحة في أسفلها بارتفاع تحمله بكسلاتها، صدى الغلاف في آخر الكتاب، والجملة
    // يميناً والرقم يساراً على الورق فوقه
    if (it && it.wide && dpiIn(it, 100, BAND_H) >= SOFT_DPI) {
        ctx.node.classList.add('bro-banded');
        return [run(ctx, t.title), el('div', { class: 'bro-call-text' }, [sentence, body]), phone ? el('div', { class: 'bro-call-side' }, phone) : null,
            img(facts, page.images[0], 'bro-band')];
    }
    if (it && dpiIn(it, 100, 56.25) >= SOFT_DPI) {
        ctx.node.classList.add('bro-hero');
        return [img(facts, page.images[0], 'bro-full'), el('div', { class: 'bro-panel' }, [run(ctx, t.title), sentence, body, phone])];
    }
    return [run(ctx, t.title), el('div', { class: 'bro-fr' }, [sentence, body]), seam(), phone ? el('div', { class: 'bro-fl bro-fl-call' }, phone) : null];
}

// الفهرس: فصول البروشور بأرقامها وأول صفحة في كل منها، وبطاقة المشروع (السعر من، والمساحات، والموقع والمطوّر والترخيص)
function contents(page, facts, ctx) {
    const list = ctx.chapters.list;
    return [run(ctx), el('div', { class: 'bro-fr' }, [
        el('h2', { class: 'bro-h', text: 'المحتويات' }),
        el('ol', { class: 'bro-toc' }, list.map((c) => el('li', {}, [
            el('span', { class: 'bro-toc-n', text: c.n }),
            el('span', { class: 'bro-toc-t', text: c.name }),
            el('span', { class: 'bro-toc-p', text: String(c.page).padStart(2, '0') })
        ])))
    ]), seam(), projectSheet(facts)];
}

// «17 نموذجًا»، «5 نماذج»، «نموذجان»
function modelsWord(n) {
    return n === 1 ? 'نموذج واحد' : n === 2 ? 'نموذجان' : n <= 10 ? n + ' نماذج' : n + ' نموذجًا';
}
// «3 أدوار»، «دوران»
function floorsWord(n) {
    return n === 1 ? 'دور واحد' : n === 2 ? 'دوران' : n <= 10 ? n + ' أدوار' : n + ' دورًا';
}

// فهرس النماذج التي تلي الصفحة بأسمائها ومساحاتها وأسعارها وصفحاتها كما قُرئت (المباعة «مباعة» باهتة في آخر مجموعتها): عمود لكل
// مجموعة إن كانتا اثنتين، وإلا عمود أو عمودان بالتساوي؛ وتحت العنوان عدد النماذج والمباع منها
function chapter(page, facts, ctx) {
    const t = page.text || {};
    const [from, to] = page.models;
    const pageOf = new Map();
    ctx.spec.pages.forEach((p, k) => { if (p.kind === 'model' && !pageOf.has(p.model)) pageOf.set(p.model, k + 1); });
    const list = facts.models.slice(from, to + 1).map((m, k) => ({ m, page: pageOf.get(from + k) }));
    const groups = [];
    for (const row of list) {
        const g = groupOf(row.m);
        if (!groups.length || groups[groups.length - 1].key !== g) groups.push({ key: g, rows: [] });
        groups[groups.length - 1].rows.push(row);
    }
    const half = Math.ceil(list.length / 2);
    const cols = groups.length === 2 && Math.max(groups[0].rows.length, groups[1].rows.length) <= 14 ? groups.map((g) => g.rows)
        : list.length > 10 ? [list.slice(0, half), list.slice(half)] : [list];
    const sold = list.filter((r) => r.m.sold).length;
    // نموذج واحد بأدواره (فاصل «نموذج A» قبل صفحات أدواره): فهرس أدواره بصفحاتها، و«3 أدوار»؛ وإلا فهرس النماذج بأعمدة ما قُرئ
    // منها فقط (لا عمود كله «—»)، وعددها بأسمائها لا بصفحاتها
    const names = [...new Set(list.map((r) => r.m.name).filter(Boolean))];
    const floors = names.length <= 1 && list.length > 1 && list.some((r) => r.m.floor);
    const fields = floors ? [['الدور', (m) => m.floor || '—', 'bro-ix-n']]
        : [['النموذج', (m) => modelName(m), 'bro-ix-n'],
            list.some((r) => r.m.area) ? ['م²', (m) => (m.area ? money(m.area) : '—'), 'bro-ix-v'] : null,
            list.some((r) => r.m.price || r.m.sold) ? ['السعر', (m) => (m.sold ? 'مباعة' : m.price ? money(m.price) : '—'), 'bro-ix-v'] : null].filter(Boolean);
    // صفوف قليلة (أدوار نموذج، أو نموذجان أو ثلاثة): كبيرة في منتصف الحقل
    const few = list.length <= 5;
    const table = el('div', { class: 'bro-fl bro-ix' + (few ? ' is-few' : ''), style: '--cols:' + cols.length }, cols.map((rows) => el('div', { class: 'bro-ix-col', style: 'grid-template-columns:1fr' + ' max-content'.repeat(fields.length) }, [
        ...fields.map(([k, , c], j) => el('span', { class: 'bro-ix-k' + (j ? ' bro-ix-v' : ''), text: k })),
        el('span', { class: 'bro-ix-k bro-ix-v', text: 'ص' }),
        ...rows.slice(0, 16).flatMap(({ m, page: at }, r) => {
            const s = (m.sold ? ' is-sold' : '') + (r === Math.min(rows.length, 16) - 1 ? ' is-last' : '');
            return [...fields.map(([, v, c]) => el('span', { class: c + s, text: v(m) })),
                el('span', { class: 'bro-ix-v bro-ix-p' + s, text: at ? String(at).padStart(2, '0') : '' })];
        })
    ])));
    const many = floors ? floorsWord(list.length) : modelsWord(names.length || list.length);
    return [run(ctx, t.title || 'النماذج'), el('div', { class: 'bro-fr' }, [
        heading(t.title || 'النماذج', ctx),
        t.subtitle ? el('p', { class: 'bro-lead', text: t.subtitle }) : null,
        el('p', { class: 'bro-count', text: many + (sold ? '، المباع منها ' + sold : '') }),
        (page.images || []).length ? img(facts, page.images[0], 'bro-chapter-img') : null
    ]), seam(), table];
}

// الغلاف الخلفي، توقيع ملائم بتركيب واحد في كل بروشور وبألوان مشروعه: الحقل العميق، وشعار ملائم بلون الكلام عليه بهواء حوله،
// وسطره «ملائم العقارية.. حيث تجد ما يناسبك» سطرين، والدعوة الواحدة (واتساب المكتب) إن لم تحملها صفحة «تواصل معنا» قبله
function back(page, facts, ctx) {
    const prev = ctx.prev;
    const called = prev && prev.kind === 'statement' && prev.variant === 'say' && prev.text && prev.text.title;
    // عنوان صفحة المطوّر الأخيرة حين كان فيها كلام («افراغ فوري»): سطرٌ بلون الإبراز فوق شعار ملائم
    const closing = page.text && page.text.title ? [page.text.title, page.text.subtitle].filter(Boolean).join(' — ') : null;
    return [
        el('div', { class: 'bro-back-mid' }, [
            closing ? el('div', { class: 'bro-back-line', text: closing }) : null,
            logo('bro-logo-back', true),
            el('div', { class: 'bro-slogan' }, sloganLines().map((s) => el('span', { text: s }))),
            // الدعوة الواحدة: واتساب المكتب رابطاً، إن لم تحمله صفحة «تواصل معنا» قبله
            facts.office.whatsapp && !called ? el('div', { class: 'bro-back-call' }, [el('div', { class: 'bro-label', text: 'واتساب' }), phoneLink(facts.office.whatsapp, 'bro-phone')]) : null
        ]),
        el('p', { class: 'bro-fine', text: 'البيانات من بروشور المطوّر كما قُرئ لدى ملائم العقارية بتاريخ ' + fmtDate(new Date().toISOString())
            + '، والأسعار والتوفر قابلة للتغيير.' + (facts.developer ? ' المشروع من تطوير ' + facts.developer + '.' : '') })
    ];
}
