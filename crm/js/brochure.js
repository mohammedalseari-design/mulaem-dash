// ‎#/studio‎ — «استوديو البروشورات» (للمدير): بروشور ملائم من صفحات عريضة 16:9، من بروشور مطوّر يُرفع أو من مشروع في المخزون.
//
// من بروشور المطوّر: brochure-pdf.js يقرأ الملف في المتصفح (كل صفحة صورةً، وكل صورة ومخطط ملفاً قائماً)، فتُرسل الصفحات
// وأوراق المصغّرات طلبَ «بروشور» للمساعد (036، agent-run)، وتُرفع الصور إلى المخزن العام ومعها media.json. المساعد يكتب قراءته
// في agent_requests.result، وbrochure-read.js يجمعها بالصور، ثم يُرسم البروشور هنا. لا يدخل البروشور إلا ما قرأه المساعد بمصدره.
// المخطط من brochure-plan.js، والرسم هنا: عناصر DOM بـ el() لا HTML، فكل نص من قاعدة البيانات أو من البروشور يمرّ نصاً. الصفحة
// حاوية (container-type) وكل المقاسات بوحدة cqw، فالتصميم نفسه يصغر في المعاينة ويُطبع بمقاسه.
// الطباعة: نسخة من الصفحات في #broPrint، وbrochure.css يخفي ما سواها، ثم «حفظ كـ PDF» من نافذة المتصفح.
// الشعار ملف الشعار الرسمي نفسه (images/logo.jpg، مربع بلونه) كما هو، لا يُعاد رسمه.

import { supabase, fetchAll } from './supabase.js';
import { brochureFacts, planBrochure, validateSpec } from './brochure-plan.js';
import { factsFromReading } from './brochure-read.js';
import { readBrochurePdf, contactSheets, MAX_PAGES } from './brochure-pdf.js';
import { createRequest, startExtraction } from './agent.js';
import { el, replace, loading, empty, errorBox, errorText, pageHead, notify, money, fmtDate, fmtDateTime, input, badge } from './ui.js';

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
    const list = el('div', { class: 'bro-picker' });
    const search = input({ type: 'search', placeholder: 'ابحث باسم المشروع أو الحي', 'aria-label': 'بحث في المشاريع' });
    file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (f) startBrochure(f, status);
    });
    replace(root, [
        pageHead('استوديو البروشورات', 'ارفع بروشور المطوّر، فيقرؤه المساعد ويصمّم منه بروشور ملائم. لا يُكتب فيه إلا ما قرأه من البروشور نفسه.', [
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'ارفع بروشور مطوّر', onclick: () => file.click() })
        ]),
        file,
        status,
        recent,
        el('div', { class: 'crm-card' }, [
            el('h3', { class: 'crm-section-title', text: 'أو من مشروع في المخزون' }),
            el('div', { class: 'crm-toolbar' }, [search]), list
        ])
    ]);
    drawRecent(recent);

    replace(list, loading());
    const { data, error } = await fetchAll(() => supabase.from('projects')
        .select('id, name, type, district, city, images, status').is('deleted_at', null).eq('status', 'approved')
        .order('id', { ascending: false }));
    if (!list.isConnected) return;
    if (error) return void replace(list, errorBox(error, 'تعذّر تحميل المشاريع'));
    const rows = data || [];
    const draw = () => {
        const q = search.value.trim();
        const shown = rows.filter((p) => !q || [p.name, p.district, p.city, String(p.id)].some((v) => String(v || '').includes(q))).slice(0, 60);
        if (!shown.length) return void replace(list, empty(q ? 'لا مشروع بهذا البحث' : 'لا مشاريع معتمدة بعد'));
        replace(list, shown.map((p) => {
            const photos = (Array.isArray(p.images) ? p.images : []).filter((u) => /^https:\/\//i.test(String(u && u.url ? u.url : u))).length;
            return el('a', { class: 'bro-pick', href: '#/studio/' + p.id }, [
                el('strong', { text: p.name || 'مشروع بلا اسم' }),
                el('span', { class: 'crm-subtle', text: [p.type, p.district, p.city].filter(Boolean).join(' · ') || '—' }),
                el('span', { class: 'crm-subtle', text: photos ? photos + ' صورة' : 'بلا صور — غلاف بالخط' })
            ]);
        }));
    };
    search.addEventListener('input', draw);
    draw();
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
        const sheets = await contactSheets(read.images);
        const files = [
            ...read.pages.map((p) => new File([p.blob], 'p' + String(p.n).padStart(2, '0') + '.jpg', { type: 'image/jpeg' })),
            ...sheets.map((b, i) => new File([b], 'sheet' + String(i + 1).padStart(2, '0') + '.jpg', { type: 'image/jpeg' }))
        ];
        show(1, read.pageCount > MAX_PAGES ? 'البروشور ' + read.pageCount + ' صفحة، يُقرأ أول ' + MAX_PAGES + ' منها' : read.pages.length + ' صفحة');
        const id = await createRequest('brochure', {
            title: file.name.replace(/\.pdf$/i, '').replace(/[‎‏‪-‮]/g, '').trim().slice(0, 80) || 'بروشور',
            instruction: 'اقرأ بروشور المطوّر هذا لاستوديو البروشورات.',
            files,
            progress: (t) => show(1, t)
        });
        show(2, read.images.length + ' صورة ومخطط');
        const media = { version: 1, file: file.name, pages: read.pageCount, images: [] };
        for (const [i, img] of read.images.entries()) {
            show(2, 'رفع صورة ' + (i + 1) + ' من ' + read.images.length);
            const path = 'brochures/' + id + '/img-' + String(i + 1).padStart(2, '0') + '.' + img.type;
            const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, img.blob, { contentType: img.type === 'png' ? 'image/png' : 'image/jpeg', upsert: false });
            if (error) throw error;
            media.images.push({ url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl,
                page: img.page, w: img.w, h: img.h, kind: img.kind, tone: img.tone, tall: img.tall });
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
        const detail = req.stage === 'validating' ? 'مراجعة القراءة' : req.stage === 'extracting' ? 'يقرأ الصفحات والنماذج والصور' : 'في الطابور';
        if (lastStage !== req.status + req.stage) replace(root, [head, stepsView(3, detail + ' — تبقى الصفحة مفتوحة وتتحدث وحدها')]);
        setTimeout(() => {
            if (root.isConnected && location.hash === '#/studio/b/' + requestId) renderBrochureReading(root, requestId, req.status + req.stage);
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
    const { project, notes } = factsFromReading(req.result, media || { images: [] }, { id: requestId });
    if (!media) notes.unshift('صور البروشور لم تُقرأ من المخزن — البروشور بالخط وحده.');
    const facts = brochureFacts(project, { whatsapp: office && office.data ? office.data.value : null });
    showBrochure(root, facts, {
        title: facts.name || req.title || 'بروشور',
        sub: 'من بروشور «' + (req.title || '') + '». راجع الملاحظات والصفحات ثم احفظه PDF.',
        notes
    });
}

/* ===================== البروشور من المخزون ===================== */

export async function renderBrochure(root, projectId) {
    replace(root, loading('جارٍ تجهيز البروشور'));
    const id = Number(projectId);
    if (!Number.isInteger(id)) return void replace(root, empty('المشروع غير موجود'));
    const [{ data: project, error }, office] = await Promise.all([
        supabase.from('projects').select('id, name, type, purpose, city, district, address, price, area, rooms, images, details, delivery_date, availability, status')
            .eq('id', id).is('deleted_at', null).maybeSingle(),
        supabase.from('crm_settings').select('value').eq('key', 'office_whatsapp').maybeSingle()
    ]);
    if (!root.isConnected) return;
    if (error) return void replace(root, errorBox(error, 'تعذّر تحميل المشروع'));
    if (!project) return void replace(root, empty('المشروع غير موجود أو محذوف'));
    const facts = brochureFacts(project, { whatsapp: office && office.data ? office.data.value : null });
    showBrochure(root, facts, { title: facts.name || 'بروشور', sub: 'بروشور ملائم من بيانات المشروع رقم ' + facts.id + '. راجع الصفحات ثم احفظه PDF.', notes: [] });
}

// عرض البروشور: زر PDF واحد في الرأس، و«تصميم آخر» رابطاً، وملاحظات القراءة إن وُجدت فوق الصفحات
function showBrochure(root, facts, opts) {
    let variation = 0;
    const pagesBox = el('div', { class: 'bro-pages' });
    const note = el('span', { class: 'crm-subtle' });
    const draw = () => {
        const spec = planBrochure(facts, { variation });
        const errors = validateSpec(spec, facts);
        if (errors.length) return void replace(pagesBox, el('div', { class: 'crm-error', text: 'المخطط غير صالح: ' + errors.join('، ') }));
        note.textContent = spec.pages.length + ' صفحات' + (facts.images.length ? '' : ' · بلا صور، فالغلاف بالخط وحده');
        replace(pagesBox, renderPages(spec, facts));
    };
    replace(root, [
        pageHead(opts.title, opts.sub, [
            el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'تحميل PDF', onclick: () => printPages(pagesBox) })
        ]),
        el('div', { class: 'bro-bar' }, [
            el('a', { class: 'link-btn', href: '#/studio', text: 'الاستوديو' }),
            el('button', { type: 'button', class: 'link-btn', text: 'تصميم آخر', title: 'غلاف وتوزيع آخر بالبيانات نفسها',
                onclick: () => { variation += 1; draw(); } }),
            note
        ]),
        opts.notes && opts.notes.length ? el('div', { class: 'crm-warn-box bro-notes' }, [
            el('strong', { text: 'ملاحظات القراءة — راجعها قبل المشاركة' }),
            el('ul', { class: 'agent-list' }, opts.notes.map((n) => el('li', { text: n })))
        ]) : null,
        pagesBox
    ]);
    draw();
}

// الطباعة: الصفحات وحدها بمقاسها بلا هوامش. تنتظر الخطوط والصور حتى لا تُطبع صفحة ناقصة. التنظيف بعد afterprint لا بعد
// window.print(): في Safari على الجوال ترجع print() فوراً قبل أن تُلتقط الصفحات، فحذفها بعدها مباشرة كان يطبع ورقة فارغة.
async function printPages(pagesBox) {
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

/* ===================== رسم الصفحات ===================== */

export function renderPages(spec, facts) {
    const total = spec.pages.length;
    let models = 0;
    let y = COVER_THREAD_Y;
    return spec.pages.map((page, i) => {
        const ctx = { n: i + 1, total, letter: page.kind === 'model' ? String.fromCharCode(65 + models++) : null };
        const node = el('section', { class: 'bro-page bro-' + page.kind + ' bro-v-' + page.variant, 'aria-label': 'صفحة ' + (i + 1) });
        append(node, PAGES[page.kind](page, facts, ctx));
        if (page.kind !== 'cover') {
            const path = threadPath(page, y);
            node.appendChild(thread(path.points, page.kind === 'back'));
            y = path.out;
        }
        if (page.kind !== 'cover' && page.kind !== 'back') node.appendChild(el('span', { class: 'bro-num', text: String(i + 1).padStart(2, '0') }));
        return node;
    });
}

/* ---------- خيط ملائم ----------
   خط ذهبي واحد يبدأ تحت اسم المشروع في الغلاف، ويدخل كل صفحة من حافتها اليمنى على ارتفاع خروجه من سابقتها، فيمشي في
   فراغاتها وينكسر بزوايا قائمة إلى ارتفاع جديد، ويخرج من حافتها اليسرى، حتى ينتهي تحت «حيث تجد ما يناسبك» في الغلاف الخلفي.
   المسار لكل نوع صفحة مرسوم على فراغاتها (بين الصور وتحت العناوين)، فلا يقطع نصاً. الإحداثيات بـ cqw: x من اليسار 0–100،
   وy من الأعلى 0–56.25 (16:9). */
const COVER_THREAD_Y = 38;
const H = 56.25;
const SPINE_X = 95.4;

function threadPath(page, yin) {
    const k = page.kind;
    let pts;
    if (k === 'about') pts = [[100, yin], [51.5, yin], [51.5, 7], [0, 7]];
    else if (k === 'photo') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 48.5], [0, 48.5]];
    else if (k === 'trio') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 54.2], [0, 54.2]];
    else if (k === 'pair') pts = [[100, yin], [38.7, yin], [38.7, 8], [0, 8]];
    else if (k === 'location') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 41], [0, 41]];
    else if (k === 'model') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 36], [60, 36], [60, 53.4], [0, 53.4]];
    else if (k === 'features') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 13], [0, 13]];
    else if (k === 'back') pts = [[100, yin], [SPINE_X, yin], [SPINE_X, 33.6], [50, 33.6]];
    else pts = [[100, yin], [0, yin]];
    // دخولٌ وخروجٌ على الارتفاع نفسه لا يحتاجان كسرة
    pts = pts.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    return { points: pts, out: pts[pts.length - 1][1] };
}

// مقاطع أفقية ورأسية متصلة؛ والنهاية في الغلاف الخلفي نقطة
function thread(points, ends) {
    const box = el('div', { class: 'bro-thread', 'aria-hidden': 'true' });
    for (let i = 1; i < points.length; i++) {
        const [x1, y1] = points[i - 1];
        const [x2, y2] = points[i];
        const style = y1 === y2
            ? 'left:' + Math.min(x1, x2) + 'cqw;top:' + y1 + 'cqw;width:' + (Math.abs(x2 - x1) + 0.12) + 'cqw'
            : 'left:' + x1 + 'cqw;top:' + Math.min(y1, y2) + 'cqw;height:' + (Math.abs(y2 - y1) + 0.12) + 'cqw';
        box.appendChild(el('span', { class: y1 === y2 ? 'bro-th-h' : 'bro-th-v', style }));
    }
    if (ends) {
        const [x, y] = points[points.length - 1];
        box.appendChild(el('span', { class: 'bro-th-dot', style: 'left:' + x + 'cqw;top:' + y + 'cqw' }));
    }
    return box;
}

function append(node, children) {
    for (const c of children) if (c) node.appendChild(c);
}

const PAGES = { cover, about, photo: photoPage, trio, pair, location: locationPage, model, features, back };

function img(facts, index, cls) {
    const it = facts.images[index];
    return it ? el('div', { class: 'bro-img ' + (cls || '') }, el('img', { src: it.url, alt: it.caption || facts.name || 'صورة المشروع', loading: 'eager' })) : null;
}

function caption(facts, index) {
    const it = facts.images[index];
    return it && it.caption ? el('span', { class: 'bro-cap', text: it.caption }) : null;
}

function stamp(cls) {
    return el('img', { class: 'bro-stamp ' + (cls || ''), src: LOGO, alt: 'ملائم العقارية' });
}

function place(facts) {
    return [facts.district ? facts.district.replace(/^حي\s+/, '') : null, facts.city].filter(Boolean).join(' – ');
}

// عنوان القسم الصغير أعلى الصفحة، في الموضع نفسه في كل الصفحات
function section(title) {
    return el('div', { class: 'bro-sec', text: title });
}

function cover(page, facts) {
    // بداية خيط ملائم: نقطة تحت أول الاسم، ومنها الخط إلى حافة الصفحة اليسرى
    const words = [
        place(facts) ? el('div', { class: 'bro-kicker', text: place(facts) }) : null,
        el('h1', { class: 'bro-title', text: facts.name || 'مشروع' }),
        facts.nameLatin ? el('div', { class: 'bro-latin', text: facts.nameLatin }) : null,
        el('div', { class: 'bro-thread-start', 'aria-hidden': 'true' }),
        facts.tagline ? el('div', { class: 'bro-tagline', text: facts.tagline }) : null,
        facts.soldOut ? el('div', { class: 'bro-tag', text: 'نفدت الوحدات' }) : null
    ];
    const foot = el('div', { class: 'bro-cover-foot' }, [
        facts.developer ? el('span', { text: 'تطوير ' + facts.developer }) : null,
        facts.license ? el('span', { text: facts.license }) : null
    ].filter(Boolean));
    if (page.variant === 'type') return [stamp('bro-stamp-cover'), el('div', { class: 'bro-cover-words' }, words), foot];
    return [img(facts, page.images[0], 'bro-bleed'), el('div', { class: 'bro-veil' }), stamp('bro-stamp-cover'), el('div', { class: 'bro-cover-words' }, words), foot];
}

// المساحة بلا وحدتها (تُكتب الوحدة صغيرة بجانبها): «97 – 225» أو «165»
function areaValue(facts) {
    if (facts.areaRange) return facts.areaRange[0] === facts.areaRange[1] ? money(facts.areaRange[0]) : money(facts.areaRange[0]) + ' – ' + money(facts.areaRange[1]);
    return facts.area ? money(facts.area) : null;
}

// أرقام المشروع جالسة على الخيط كما في صفحة النموذج: لغة واحدة للأرقام في البروشور كله
function about(page, facts) {
    const words = el('div', { class: 'bro-about-words' }, [
        el('h2', { class: 'bro-h', text: facts.tagline || facts.name || '' }),
        facts.description ? el('p', { class: 'bro-p', text: facts.description }) : null
    ]);
    const area = areaValue(facts);
    const stats = el('div', { class: 'bro-stats' }, [
        stat(facts.priceFrom ? 'يبدأ من' : 'السعر', facts.price ? money(facts.price) : null, facts.price ? 'ريال' : null),
        stat(facts.areaRange ? 'المساحات' : 'المساحة', area, area ? 'م²' : null),
        stat('عدد الوحدات', facts.units_count ? String(facts.units_count) : null),
        stat('التسليم', facts.delivery_date ? fmtDate(facts.delivery_date) : facts.construction_status)
    ].filter(Boolean));
    return [section('عن المشروع'), page.variant === 'split' ? img(facts, page.images[0], 'bro-about-img bro-marks') : null, words,
        stats.childNodes.length ? stats : null];
}

function photoPage(page, facts) {
    return [section('المشروع'), img(facts, page.images[0], 'bro-bleed'), caption(facts, page.images[0])];
}

function trio(page, facts) {
    return [section('من الداخل'), el('div', { class: 'bro-panels' }, page.images.map((i) => el('figure', {}, [img(facts, i), caption(facts, i)])))];
}

function pair(page, facts) {
    return [section('تفاصيل'), img(facts, page.images[0], 'bro-pair-a'), img(facts, page.images[1], 'bro-pair-b bro-marks'), caption(facts, page.images[0])];
}

function locationPage(page, facts) {
    const words = el('div', { class: 'bro-loc-words' }, [
        place(facts) ? el('h2', { class: 'bro-h', text: place(facts) }) : null,
        facts.address ? el('p', { class: 'bro-p', text: facts.address }) : null,
        facts.landmarks.length ? el('ul', { class: 'bro-near' }, facts.landmarks.map((l) => el('li', { text: l }))) : null
    ]);
    return [section('الموقع'), page.variant === 'map' ? img(facts, page.images[0], 'bro-bleed') : null, page.variant === 'map' ? el('div', { class: 'bro-veil bro-veil-loc' }) : null, words];
}

function model(page, facts, ctx) {
    const m = facts.models[page.model];
    // «نـــمـــوذج» بالكشيدة: ثلاث مدّات بين الحروف المتصلة، فتظهر في الخط ولا تكسر الوصل كما يكسره letter-spacing
    const title = el('div', { class: 'bro-model-title' }, [
        el('span', { class: 'bro-letter', text: ctx.letter }),
        el('span', { class: 'bro-kashida', text: 'نـــمـــوذج' }),
        m.name ? el('span', { class: 'bro-model-name', text: m.name }) : null
    ].filter(Boolean));
    const stats = el('div', { class: 'bro-stats' }, [
        stat(m.sold ? 'الحالة' : 'السعر', m.sold ? 'مباعة' : m.price ? money(m.price) : null, m.sold || !m.price ? null : 'ريال'),
        stat('المساحة', m.area ? money(m.area) : null, m.area ? 'م²' : null),
        stat('الغرف', m.rooms ? String(m.rooms) : null),
        stat('دورات المياه', m.bathrooms ? String(m.bathrooms) : null)
    ].filter(Boolean));
    const visual = page.variant === 'plan'
        ? el('div', { class: 'bro-plan bro-plan-' + m.planTone }, el('img', { src: m.plan, alt: 'مخطط ' + (m.name || 'النموذج') }))
        : el('div', { class: 'bro-ghost', 'aria-hidden': 'true', text: ctx.letter });
    return [
        section('النماذج'), visual, title,
        m.orientation || m.type ? el('div', { class: 'bro-orient', text: [m.type, m.orientation].filter(Boolean).join(' · ') }) : null,
        stats.childNodes.length ? stats : null,
        m.parts.length ? el('div', { class: 'bro-parts-head', text: 'مكوّنات الوحدة' }) : null,
        m.parts.length ? el('ul', { class: 'bro-parts' }, m.parts.map((p) => el('li', { text: p }))) : null
    ];
}

function stat(label, value, unit) {
    return value ? el('div', { class: 'bro-stat' }, [
        el('div', { class: 'bro-stat-v' }, [el('span', { text: value }), unit ? el('small', { text: ' ' + unit }) : null].filter(Boolean)),
        el('div', { class: 'bro-stat-k', text: label })
    ]) : null;
}

function features(page, facts) {
    return [
        section('مميزات المشروع'),
        page.variant === 'photo' ? img(facts, page.images[0], 'bro-feat-img bro-marks') : null,
        el('h2', { class: 'bro-h bro-feat-h', text: 'ما يميّز ' + (facts.name || 'المشروع') }),
        el('ol', { class: 'bro-feats' }, facts.amenities.map((a, i) => el('li', {}, [el('span', { class: 'bro-feat-n', text: String(i + 1).padStart(2, '0') }), el('span', { text: a })])))
    ];
}

// رقم واتساب المكتب كما يحفظه «الإعدادات» (966551234567) ← «+966 55 123 4567»، وغيره كما هو
function phoneText(value) {
    const m = /^966(5\d)(\d{3})(\d{4})$/.exec(String(value).replace(/\D/g, ''));
    return m ? '+966 ' + m[1] + ' ' + m[2] + ' ' + m[3] : String(value);
}

function back(page, facts) {
    return [
        el('div', { class: 'bro-back-mid' }, [
            stamp('bro-stamp-back'),
            el('div', { class: 'bro-brand', text: 'ملائم العقارية' }),
            el('div', { class: 'bro-brand-latin', text: 'MULAEM REAL ESTATE' }),
            el('div', { class: 'bro-slogan', text: SLOGAN })
        ]),
        el('div', { class: 'bro-back-foot' }, [
            facts.office.whatsapp ? el('span', { dir: 'ltr', class: 'bro-phone', text: phoneText(facts.office.whatsapp) }) : null,
            el('span', { class: 'bro-fine', text: 'البيانات من سجل المشروع لدى ملائم العقارية بتاريخ ' + fmtDate(new Date().toISOString())
                + '، والأسعار والتوفر قابلة للتغيير.' + (facts.developer ? ' المشروع من تطوير ' + facts.developer + '.' : '') })
        ].filter(Boolean))
    ];
}
