// ‎#/project/:id‎ — صفحة العقار: ترويسته وشريط أرقام وحداته، ثم ثلاثة تبويبات كمعاينة المالك (2026-11-04):
//   «البروفايل»: صوره (projects.images) وعارضها، و«عن المشروع» ومميزاته، و«معلومات المشروع» (المطوّر والحالة والتسليم وعدد
//     الوحدات ورخصة الإعلان بزر «نسخ»)، و«الموقع» برابط خرائط Google. وللمدير والوسيط «ارفع بروشور المطور (PDF)»: الملف
//     يصير طلب «تحديث» للمساعد على هذا المشروع بمسار «إضافة عرض» نفسه (createRequest في agent.js، والهدف كما يكتبه «حوّله
//     تحديثاً»)، وتتابع البطاقة مراحله حتى اعتماد المدير. لا شيء يتغيّر في المشروع قبل الاعتماد (شاشة الاعتماد كما هي).
//   «المخططات»: بطاقة لكل نموذج بمخططه إن وُجد وأرقامه وسعر المتر وما بقي منه، و«سجّل عميل على هذا النموذج».
//   «الحجوزات»: «لوحة الوحدات» (صف لكل نموذج ومربع لكل وحدة بلونها) ولوحة النموذج المختار كما كانت، وزرها الواحد يسجّل
//     عليه عميلاً: نموذج «صفقة جديدة» نفسه (deal-form.js) بالعقار والوحدة معبّأين.
// التبويب يُحفظ في الرابط (‎#/project/12?tab=plans‎) بلا إعادة تحميل، فالرجوع إلى الصفحة يعيده. الحساب الصافي كله في
// project-profile.js (الصور والوصف والحقائق والموقع والمخططات ومراحل البروشور) وunits-board.js (قسمة الوحدات).
//
// قراءة فقط لكل الأدوار، والسياسات تقرّر ما يُرى: projects (المعتمد غير المحذوف، وما أضافه الوسيط بنفسه)، و v_units
// بالسياسات نفسها (security_invoker)، و unit_holds يقرؤها كل موظف (030). العمولة لمن يرى العمولة (037)، ومن لا يراها لا خانة
// له ولا ذكر لها (قرار المالك 2026-11-04: كأنها غير موجودة)، والقاعدة لا تعطيه الأرقام أصلاً. مركز الاتصال لا عمولة له ولا
// صفقات ولا طلبات تحديث: لا زر تسجيل عنده، ولا رفع بروشور. «مشاركة مع عميل» (share-project.js) للعقار المعتمد غير المحذوف.
// التعديل في صفحة المشاريع (‎../projects.html‎) كما في «العقارات»، وهذه نافذة عليه.

import { supabase, fetchAll } from './supabase.js';
import { myId, myRole, isAdmin, canSeeCommission } from './auth.js';
import { openDealForm } from './deal-form.js';
import { openShareSheet } from './share-project.js';
import {
    createRequest, startExtraction, extractionStatus, pdfPageCount, MAX_FILE_BYTES, MAX_FILES, MAX_PDF_PAGES
} from './agent.js';
import { LISTING_PURPOSE, label } from './labels.js';
import { buildBoard, boardSummary, defaultOrd, availabilityText, takenText, MAX_CELLS } from './units-board.js';
import {
    PROJECT_TABS, DEFAULT_TAB, parseProjectRoute, projectHash, wrapIndex, firstText, constructionLabel,
    projectImages, galleryPlan, projectAbout, projectFeatures, projectFacts, mapsLink, placeLines, planCards, specsText,
    BROCHURE_TITLE_PREFIX, brochureTitle, brochureInstruction, latestBrochure, pdfName, fileProblem, pagesProblem,
    fileSizeText, uploadSummary, brochureProgress, uploadingProgress, showOnLoad
} from './project-profile.js';
import {
    el, replace, clear, loading, empty, errorBox, errorText, isMissingRelation, icon, pageHead, actionBtn, money, number,
    countText, fmtDate, fmtDateTime, dash, notify, fail, openModal
} from './ui.js';

const SAR = 'ر.س';
// مسافة لا ينكسر عندها السطر: الرقم ووحدته («ر.س»، «م²»، «غرف») لا يفترقان على الجوال، فينكسر السطر عند « · » وحدها
const NBSP = '\u00a0';

// الاستعلام لا يرمي: خطأ الشبكة يصل { error } كخطأ الخادم، فيُعرض في مربع واحد بزر «إعادة المحاولة»
const settle = (query) => Promise.resolve(query).catch((error) => ({ data: null, error }));

export async function renderProject(root, projectId) {
    replace(root, loading('جارٍ تحميل العقار', 'page'));
    // «12» أو «12?tab=plans» (التبويب المحفوظ في الرابط)
    const route = parseProjectRoute(projectId);
    // رقم العقار عدد صحيح دائماً (projects.id integer): رابط غيره خاطئ، فلا يُسأل الخادم عنه ولا تظهر رسالته الإنجليزية
    const pid = /^\d{1,10}$/.test(route.id) ? Number(route.id) : NaN;
    if (!(pid <= 2147483647)) return void replace(root, notFound());
    // show: الأرقام، none: لا خانة ولا ذكر للعمولة
    const seeCommission = canSeeCommission();
    const commission = seeCommission ? 'show' : 'none';

    const [projectResult, unitsResult, holdsResult] = await Promise.all([
        settle(supabase.from('projects')
            .select('id, name, type, purpose, city, district, address, latitude, longitude, availability, status, deleted_at,'
                + ' delivery_date, rega_ad_license, listing_expires_at, notes, images, details')
            .eq('id', pid)
            .maybeSingle()),
        // عمود العمولة لا يُطلب لمن لا يراها، كما في «العقارات»
        settle(fetchAll(() => supabase.from('v_units')
            .select('unit_ord, unit_key, unit_type, rooms, bathrooms, area, price, unit_count, unit_status' + (seeCommission ? ', unit_commission' : ''))
            .eq('project_id', pid)
            .order('unit_ord', { ascending: true }))),
        settle(fetchAll(() => supabase.from('unit_holds')
            .select('deal_id, unit_key, status')
            .eq('project_id', pid)
            .order('deal_id', { ascending: true })))
    ]);
    if (!root.isConnected) return;

    const retry = () => renderProject(root, projectId);
    if (projectResult.error) return void replace(root, errorBox(projectResult.error, 'تعذّر تحميل العقار', retry));
    const project = projectResult.data;
    if (!project) return void replace(root, notFound());
    if (unitsResult.error) return void replace(root, errorBox(unitsResult.error, 'تعذّر تحميل وحدات العقار', retry));
    // قاعدة قبل 030 لا حجوزات فيها، و v_units فيها تعرض الحالة اليدوية وحدها: اللوحة مثلها. أي خطأ آخر يُقال، فلا تُرسم
    // وحدات محجوزة خضراء
    const holdsMissing = Boolean(holdsResult.error) && isMissingRelation(holdsResult.error);
    if (holdsResult.error && !holdsMissing) {
        return void replace(root, errorBox(holdsResult.error, 'تعذّر تحميل حجوزات الوحدات', retry));
    }

    const rows = buildBoard(unitsResult.data || [], holdsMissing ? [] : holdsResult.data || [], project);
    // رفع البروشور: المدير والوسيط (مركز الاتصال لا ينشئ طلبات التحديث، 033)، ولا على عقار محذوف
    const canUpload = (myRole() === 'admin' || myRole() === 'field') && !project.deleted_at;
    const profile = profileTab(project, rows, canUpload);
    const plans = plansTab(project, rows, commission, canUpload);

    const head = pageHead(dash(project.name), subLine(project), headActions(project));
    // على الجوال يلتف الزران سطرين بدل شريط يُسحب: «مشاركة مع عميل» يبقى ظاهراً كله على 320
    const quick = head.querySelector('.w4-quick');
    if (quick) quick.classList.add('pj-head-actions');

    replace(root, [
        backLink(),
        head,
        statusNote(project),
        rows.length ? summaryStrip(boardSummary(rows), commission) : null,
        projectTabs(pid, route.tab || DEFAULT_TAB, {
            profile: profile.node,
            plans: plans.node,
            bookings: bookingsTab(project, rows, commission)
        }, { plans: plans.count })
    ]);
    Promise.resolve(profile.start()).catch((error) => console.warn('[CRM] brochure card', error));
    if (route.share && !project.deleted_at && project.status === 'approved') {
        history.replaceState(null, '', projectHash(pid, route.tab));
        openShareSheet(project);
    }
}

/* ===================== الترويسة ===================== */

// «‹ العقارات» فوق الاسم: الصفحة الأم، وهي تعود كما تُركت (البحث والمرشّحات ومكان التمرير). السهم يشير يميناً: الرجوع في RTL
function backLink() {
    return el('a', { class: 'pj-backlink', href: '#/properties' }, [
        svgIcon(PATHS.back),
        el('span', { class: 'w4-sr', text: 'رجوع إلى ' }),
        el('span', { text: 'العقارات' })
    ]);
}

// «المشاريع والخريطة» بإطار، و«مشاركة مع عميل» الزر الرئيسي الوحيد في الترويسة. لا مشاركة لعقار غير معتمد أو محذوف:
// العميل لا يرى إلا المعتمد (get_client_share)، وغير المعتمد لا يراه حتى بقية الموظفين
function headActions(project) {
    const mapLink = actionBtn('المشاريع والخريطة', 'map', { href: '../projects.html' });
    mapLink.classList.add('pj-head-link');
    if (project.deleted_at || project.status !== 'approved' || openShareSheet.stub) return [mapLink];
    const share = actionBtn('مشاركة مع عميل', null, { onclick: () => openShareSheet(project) }, true);
    share.insertBefore(svgIcon(PATHS.share), share.firstChild);
    share.classList.add('pj-share');
    return [mapLink, share];
}

// الحي · المدينة · المطوّر · حالة البناء · التسليم، من صف العقار وتفاصيله (المطوّر بأسمائه الثلاثة كما يقرؤها v_units)
function subLine(project) {
    const details = project.details && typeof project.details === 'object' ? project.details : {};
    const developer = firstText(details.developer, details.developer_name, details.developerName);
    const delivery = firstText(details.delivery_time) || (project.delivery_date ? fmtDate(String(project.delivery_date).slice(0, 10)) : '');
    return [
        label(LISTING_PURPOSE, project.purpose, ''),
        firstText(project.district),
        firstText(project.city),
        developer ? 'المطوّر: ' + developer : '',
        constructionLabel(details.construction_status),
        delivery ? 'التسليم: ' + delivery : ''
    ].filter(Boolean).join(' · ');
}

// ما يغيّر معنى الصفحة يُقال تحت الترويسة: عقار محذوف (لا صفقات عليه)، أو لم يُعتمد بعد، أو نفد بالكامل.
// غير المعتمد والمرفوض يراهما المدير ومن أضافهما وحدهما (سياسة projects)، وهما من يفتح الصفحة: الجملة تقول ما يصدق عليهما
function statusNote(project) {
    if (project.deleted_at) return note('هذا العقار محذوف من المخزون، فلا تُفتح عليه صفقات جديدة.', 'danger');
    if (project.status === 'pending') return note('هذا العقار بانتظار اعتماد المدير؛ لا يراه بقية الموظفين حتى يُعتمد.', 'amber');
    if (project.status === 'rejected') return note('هذا العقار مرفوض؛ لا يراه بقية الموظفين.', 'danger');
    if (project.availability && project.availability !== 'available') return note('هذا العقار «نفد بالكامل»، فكل وحداته خارج البيع.', 'muted');
    return null;
}

function note(text, tone) {
    return el('p', { class: 'pj-note pj-note-' + tone }, [icon('alert'), el('span', { text })]);
}

function notFound() {
    return el('div', { class: 'crm-denied' }, [
        el('div', { class: 'crm-error', text: 'العقار غير موجود أو لا تملك صلاحية الاطلاع عليه.' }),
        el('a', { class: 'btn btn-outline btn-sm pj-back', href: '#/properties', text: 'رجوع إلى العقارات' })
    ]);
}

/* ===================== أيقونات الصفحة ===================== */

// أيقونات ليست في ui.js، بالنمط نفسه (خطية، aria-hidden، class ico فتأخذ لونها وسمكها من crm/app.css)
const PATHS = {
    back: ['M9 6l6 6-6 6'],
    forward: ['M5 12h14', 'M12 5l7 7-7 7'],
    share: ['M18 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
        'M18 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M8.2 13.2l7.6 4.6M15.8 6.2l-7.6 4.6'],
    copy: ['M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M5 15V5a1 1 0 0 1 1-1h10'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    zoom: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3', 'M11 8v6M8 11h6'],
    fileUp: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M12 18v-6', 'M9.5 14.5L12 12l2.5 2.5']
};

function svgIcon(paths, cls = 'ico') {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls);
    for (const d of paths) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

/* ===================== التبويبات ===================== */

// ثلاثة تبويبات (نمط tablist: الأسهم تنقل بينها وتفتحها، وHome/End أولها وآخرها). كل لوحة تُبنى مرة وتُخفى وتُظهر، فلا
// يُعاد طلب شيء من الخادم. الاختيار يُكتب في الرابط بـ replaceState: لا hashchange فلا يُعاد رسم الصفحة، ولا سطر جديد في
// تاريخ المتصفح، والرجوع إلى الصفحة يفتح التبويب نفسه. counts: { plans } عدد النماذج بجانب «المخططات»
function projectTabs(pid, start, panes, counts) {
    const keys = PROJECT_TABS.map((tab) => tab.key);
    const tabs = new Map();
    const panels = new Map();
    let current = null;
    const list = el('div', { class: 'pj-tabs', role: 'tablist', 'aria-label': 'أقسام المشروع' });
    for (const tab of PROJECT_TABS) {
        const count = counts[tab.key];
        // المسافة بين الاسم والعدد لقارئ الشاشة («المخططات 4»)؛ الفراغ بينهما على الشاشة من gap
        const text = [el('span', { text: tab.label }), count ? [' ', el('span', { class: 'pj-tab-count', text: number(count) })] : null];
        const button = el('button', {
            type: 'button', class: 'pj-tab', role: 'tab', id: 'pjTab-' + tab.key,
            'aria-controls': 'pjPane-' + tab.key, 'aria-selected': 'false', tabindex: '-1',
            onclick: () => choose(tab.key, true)
        }, text);
        list.appendChild(button);
        tabs.set(tab.key, button);
        panels.set(tab.key, el('div', {
            class: 'pj-pane', role: 'tabpanel', id: 'pjPane-' + tab.key, 'aria-labelledby': 'pjTab-' + tab.key, hidden: true
        }, panes[tab.key]));
    }
    list.addEventListener('keydown', (event) => {
        const at = keys.indexOf(current);
        const rtl = getComputedStyle(list).direction !== 'ltr';
        let next = null;
        if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = wrapIndex(at + 1, keys.length);
        else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = wrapIndex(at - 1, keys.length);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = keys.length - 1;
        if (next === null) return;
        event.preventDefault();
        choose(keys[next], true);
        tabs.get(keys[next]).focus();
    });

    function choose(key, byUser) {
        if (key === current || !tabs.has(key)) return;
        current = key;
        for (const [k, button] of tabs) {
            button.setAttribute('aria-selected', k === key ? 'true' : 'false');
            button.tabIndex = k === key ? 0 : -1;
        }
        for (const [k, panel] of panels) panel.hidden = k !== key;
        if (byUser) rememberTab(pid, key);
    }

    choose(keys.includes(start) ? start : DEFAULT_TAB, false);
    return el('div', { class: 'pj-tabbed' }, [list, ...panels.values()]);
}

function rememberTab(pid, key) {
    const hash = projectHash(pid, key);
    if (location.hash === hash) return;
    try {
        history.replaceState(history.state, '', hash);
    } catch (_) {
        // متصفح يمنع تعديل الرابط: يبقى التبويب في الصفحة المفتوحة وحدها
    }
}

/* ===================== «البروفايل» ===================== */

// العمود العريض: الصور، ثم «عن المشروع»، ثم «ارفع بروشور المطور» (وبلا صور: البروشور أولاً، فهو الذي يأتي بالمحتوى). والضيق:
// «معلومات المشروع» و«الموقع». start: يقرأ آخر بروشور رفعه الموظف لهذا المشروع بعد رسم الصفحة
function profileTab(project, rows, canUpload) {
    const images = projectImages(project);
    const about = projectAbout(project);
    const features = projectFeatures(project);
    const brochure = canUpload ? brochureCard(project) : null;
    const gallery = images.length ? galleryBlock(images, project) : null;
    const aboutNode = about.text || features.length ? aboutCard(about, features) : null;
    const main = (gallery ? [gallery, aboutNode, brochure && brochure.node] : [brochure && brochure.node, aboutNode]).filter(Boolean);
    const side = [infoCard(projectFacts(project, rows, todayIso())), locationCard(project)].filter(Boolean);
    return {
        node: el('div', { class: 'pj-prof' + (main.length ? '' : ' pj-prof-solo') }, [
            main.length ? el('div', { class: 'pj-prof-main' }, main) : null,
            el('div', { class: 'pj-prof-side' }, side)
        ]),
        start: brochure ? brochure.start : () => {}
    };
}

function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// صورة كبيرة وأربع صغيرة على الأكثر (galleryPlan)، وكل صورة زر يفتحها في العارض، و«كل الصور (N)» في زاوية الشبكة
function galleryBlock(images, project) {
    const name = firstText(project.name) || 'المشروع';
    const plan = galleryPlan(images.length);
    const tiles = images.slice(0, plan.shown).map((image, i) => {
        const tile = el('div', { class: 'pj-gal-item' });
        const img = el('img', { src: image.url, alt: '', loading: i ? 'lazy' : 'eager', decoding: 'async' });
        // رابط صورة لا يفتح: مكانها هادئ بدل أيقونة المتصفح المكسورة
        img.addEventListener('error', () => tile.classList.add('pj-gal-broken'), { once: true });
        return replace(tile, [
            el('button', {
                type: 'button', class: 'pj-gal-btn',
                'aria-label': 'كبّر الصورة ' + number(i + 1) + ' من ' + number(images.length) + (image.caption ? ': ' + image.caption : ''),
                onclick: () => openViewer(images, i, name)
            }, img),
            image.caption ? el('span', { class: 'pj-gal-cap', 'aria-hidden': 'true', text: image.caption }) : null
        ]);
    });
    return el('section', { class: 'pj-gal pj-gal-' + plan.shown, 'aria-label': 'صور المشروع' }, [
        ...tiles,
        plan.all ? el('button', {
            type: 'button', class: 'pj-gal-all', onclick: () => openViewer(images, 0, name)
        }, [icon('grid'), el('span', { text: 'كل الصور (' + number(plan.all) + ')' })]) : null
    ]);
}

// عارض الصور في النافذة: الصورة كاملة، والسابقة والتالية والعدد، وصف صغير من الصور يختار منه. الأسهم في لوحة المفاتيح تنقل
// (في RTL: اليسار التالية)
function openViewer(images, start, name) {
    const many = images.length > 1;
    let index = wrapIndex(start, images.length);
    const img = el('img', { class: 'pj-viewer-img', alt: '' });
    const count = el('span', { class: 'pj-viewer-count', 'aria-live': 'polite' });
    const caption = el('p', { class: 'pj-viewer-cap', hidden: true });
    const thumbs = many ? images.map((image, i) => el('button', {
        type: 'button', class: 'pj-viewer-thumb', 'aria-label': 'الصورة ' + number(i + 1), onclick: () => show(i)
    }, el('img', { src: image.url, alt: '', loading: 'lazy', decoding: 'async' }))) : [];

    function show(i) {
        index = wrapIndex(i, images.length);
        const image = images[index];
        img.src = image.url;
        img.alt = image.caption || 'صورة ' + number(index + 1) + ' من ' + name;
        count.textContent = 'الصورة ' + number(index + 1) + ' من ' + number(images.length);
        caption.textContent = image.caption || '';
        caption.hidden = !image.caption;
        thumbs.forEach((button, k) => button.setAttribute('aria-current', k === index ? 'true' : 'false'));
    }
    show(index);

    const body = el('div', { class: 'pj-viewer' }, [
        el('div', { class: 'pj-viewer-stage' }, img),
        many ? el('div', { class: 'pj-viewer-bar' }, [
            el('button', { type: 'button', class: 'pj-viewer-nav', 'aria-label': 'الصورة السابقة', onclick: () => show(index - 1) }, svgIcon(PATHS.forward)),
            count,
            el('button', { type: 'button', class: 'pj-viewer-nav', 'aria-label': 'الصورة التالية', onclick: () => show(index + 1) }, icon('arrow'))
        ]) : null,
        caption,
        many ? el('div', { class: 'pj-viewer-thumbs', role: 'group', 'aria-label': 'كل الصور' }, thumbs) : null
    ]);
    const holder = document.getElementById('modalContent');
    const onKey = (event) => {
        if (!many || event.altKey || event.ctrlKey || event.metaKey) return;
        const rtl = getComputedStyle(holder).direction !== 'ltr';
        if (event.key === 'ArrowLeft') { event.preventDefault(); show(index + (rtl ? 1 : -1)); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); show(index + (rtl ? -1 : 1)); }
    };
    openModal('صور ' + name, body, { onClose: () => holder.removeEventListener('keydown', onKey) });
    holder.classList.add('pj-viewer-modal');
    holder.addEventListener('keydown', onKey);
}

// مخطط نموذج مكبَّراً في النافذة
function openPlan(url, name) {
    openModal('مخطط ' + name, el('div', { class: 'pj-viewer' }, el('div', { class: 'pj-viewer-stage pj-viewer-plan' },
        el('img', { class: 'pj-viewer-img', src: url, alt: 'مخطط ' + name }))));
    document.getElementById('modalContent').classList.add('pj-viewer-modal');
}

function aboutCard(about, features) {
    return el('section', { class: 'crm-card pj-about', 'aria-labelledby': 'pjAboutTitle' }, [
        el('h2', { class: 'pj-ctitle', id: 'pjAboutTitle', text: 'عن المشروع' }),
        about.text ? el('p', { class: 'pj-about-text', text: about.text }) : null,
        about.notes ? el('div', { class: 'pj-about-more' }, [
            el('h3', { class: 'pj-subtitle', text: 'ملاحظات' }),
            el('p', { class: 'pj-about-text', text: about.notes })
        ]) : null,
        features.length ? el('div', { class: 'pj-about-more' }, [
            el('h3', { class: 'pj-subtitle', text: 'المميزات' }),
            // list-style: none يُسقط معنى القائمة في Safari، فيُعاد صريحاً
            el('ul', { class: 'pj-feats', role: 'list' }, features.map((text) => el('li', { class: 'pj-feat' }, [icon('check'), el('span', { text })])))
        ]) : null
    ]);
}

// «معلومات المشروع»: خمس حقائق ثابتة، والناقص «—». رخصة الإعلان رقمها وزر «نسخ»، وتاريخ انتهائها بلونه (أحمر انتهت،
// كهرماني خلال 30 يوماً) كما ينبّه «المخزون»؛ وبلا رخصة «غير مسجّلة»
function infoCard(facts) {
    const row = (title, value) => el('div', { class: 'pj-kv-row' }, [el('dt', { text: title }), el('dd', {}, value)]);
    const delivery = facts.delivery ? facts.delivery.text || fmtDate(facts.delivery.date) : '—';
    return el('section', { class: 'crm-card pj-info', 'aria-labelledby': 'pjInfoTitle' }, [
        el('h2', { class: 'pj-ctitle', id: 'pjInfoTitle', text: 'معلومات المشروع' }),
        el('dl', { class: 'pj-kv' }, [
            row('المطور', facts.developer || '—'),
            row('الحالة', facts.status || '—'),
            row('التسليم', delivery),
            row('عدد الوحدات', facts.units ? countText(facts.units, ['وحدة واحدة', 'وحدتان', 'وحدات', 'وحدة']) : '—'),
            row('رخصة الإعلان', licenseValue(facts))
        ]),
        facts.license ? el('p', { class: 'pj-kv-hint', text: 'يظهر الرقم تلقائياً في مشاركاتك، وانسخه لإعلاناتك.' }) : null
    ]);
}

function licenseValue(facts) {
    if (!facts.license) return el('span', { class: 'pj-muted', text: 'غير مسجّلة' });
    const copy = el('button', { type: 'button', class: 'pj-copy', 'aria-label': 'نسخ رقم رخصة الإعلان' }, [svgIcon(PATHS.copy), el('span', { text: 'نسخ' })]);
    copy.addEventListener('click', () => copyText(copy, facts.license, 'نُسخ رقم رخصة الإعلان'));
    const state = facts.licenseState;
    return [
        el('span', { class: 'pj-lic' }, [el('span', { class: 'pj-lic-num', dir: 'ltr', text: facts.license }), copy]),
        facts.licenseExpiry ? el('small', {
            class: 'pj-lic-exp' + (state === 'expired' ? ' pj-late' : state === 'soon' ? ' pj-soon' : ''),
            text: (state === 'expired' ? 'انتهت في ' : 'تنتهي في ') + fmtDate(facts.licenseExpiry)
        }) : null
    ];
}

async function copyText(button, text, done) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return void notify('النسخ إلى الحافظة غير متاح في هذا المتصفح', 'error', 8000);
    }
    button.disabled = true;
    try {
        await navigator.clipboard.writeText(text);
        notify(done, 'success');
    } catch (error) {
        fail(error, 'تعذّر النسخ إلى الحافظة');
    } finally {
        button.disabled = false;
    }
}

// «الموقع»: الحي والمدينة، والعنوان المكتوب إن زاد عليهما، ورابط خرائط Google بالإحداثيات (ومعه رسم هادئ يقول إن الموقع
// محدد)، وإلا بحثاً بالعنوان. لا شيء يدل على المكان: لا بطاقة
function locationCard(project) {
    const link = mapsLink(project);
    const lines = placeLines(project);
    if (!link && !lines.place && !lines.address) return null;
    return el('section', { class: 'crm-card pj-loc', 'aria-labelledby': 'pjLocTitle' }, [
        el('h2', { class: 'pj-ctitle', id: 'pjLocTitle', text: 'الموقع' }),
        link && link.exact ? el('div', { class: 'pj-map', 'aria-hidden': 'true' }, icon('pin')) : null,
        el('div', { class: 'pj-loc-lines' }, [
            lines.place ? el('strong', { class: 'pj-loc-place', text: lines.place }) : null,
            lines.address ? el('span', { class: 'pj-loc-sub', text: lines.address }) : null,
            link ? null : el('span', { class: 'pj-loc-sub', text: 'الموقع الدقيق غير مسجّل.' })
        ]),
        link ? el('a', { class: 'pj-loc-link', href: link.href, target: '_blank', rel: 'noopener noreferrer' }, [
            el('span', { text: link.exact ? 'افتح في خرائط Google' : 'ابحث عن العنوان في خرائط Google' }),
            svgIcon(PATHS.external),
            el('span', { class: 'w4-sr', text: ' (يفتح في تبويب جديد)' })
        ]) : null
    ]);
}

/* ===================== «ارفع بروشور المطور» ===================== */

// صفحة الطلب في المساعد تُقرأ كل 4 ثوانٍ أثناء التنفيذ؛ هذه البطاقة مثلها، وتتوقف حين تُغادر الصفحة أو ينتهي التنفيذ
const POLL_MS = 4000;
const REQUEST_COLUMNS = 'id, title, status, stage, candidates, error_ar, created_at, updated_at, requested_by,'
    + ' agent_sources(kind, bytes, pages), agent_drafts(id, status)';
// ما يُقال قبل كل مرحلة لقارئ الشاشة (الأيقونة للعين وحدها)
const STEP_SR = { done: 'تم: ', now: 'الآن: ', wait: 'ينتظر: ', fail: 'تعذّر: ', off: 'انتهى: ', todo: 'التالي: ' };

// مربع إفلات هادئ وزر «اختر الملف» (بإطار: الزر الرئيسي في الترويسة)، ثم بطاقة «قراءة البروشور» بمراحل الطلب. الملف يصير
// طلب «تحديث» بمسار «إضافة عرض» (createRequest ثم startExtraction)، بالعنوان الذي يعرّفه وبهدف المشروع (035 يُبقيه لطلب المدير؛
// طلب الوسيط يطابقه المساعد بالاسم والرقم المكتوبين في التعليمات، وإن لم يجزم سأل الموظف في صفحة الطلب)
function brochureCard(project) {
    let busy = false;
    let blocked = false;
    // أسماء الملفات كما اختارها الموظف في هذه الجلسة (المخزن يحفظها بحروف لاتينية)
    let names = null;
    let shownId = null;
    let poll = 0;
    let lastSig = '';

    const input = el('input', { type: 'file', accept: '.pdf,application/pdf', multiple: true, hidden: true });
    const pick = el('button', {
        type: 'button', class: 'btn btn-outline btn-sm pj-bro-pick', 'aria-describedby': 'pjBroHint',
        onclick: () => { if (!busy && !blocked) input.click(); }
    }, [icon('upload'), el('span', { text: 'اختر الملف' })]);
    const message = el('p', { class: 'pj-bro-msg', hidden: true });
    const live = el('span', { class: 'w4-sr', 'aria-live': 'polite' });
    const holder = el('div', { class: 'pj-bro-holder' });
    const zone = el('div', { class: 'pj-bro-drop' }, [
        el('span', { class: 'pj-bro-ico', 'aria-hidden': 'true' }, svgIcon(PATHS.fileUp)),
        el('div', { class: 'pj-bro-text' }, [
            el('h2', { class: 'pj-bro-title', id: 'pjBroTitle', text: 'ارفع بروشور المطور (PDF)' }),
            el('p', { class: 'pj-bro-sub', id: 'pjBroHint', text: 'اسحب الملف هنا أو اختره من جهازك — المساعد يقرأه ويقترح ما تغيّر: الأسعار والنماذج والتسليم.' }),
            el('p', { class: 'pj-bro-note', text: 'ما يتغيّر شيء في المشروع قبل ما يعتمده المدير · حتى ' + number(MAX_PDF_PAGES) + ' صفحة و'
                + fileSizeText(MAX_FILE_BYTES) + ' للملف.' })
        ]),
        pick,
        input
    ]);

    input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = '';
        upload(files);
    });

    // السحب: الإفلات هنا لهذا المربع وحده. stopPropagation يمنع حارس الصفحة (wireFileDrop في ui.js) من رفض الإفلات، فهو
    // لا يعرف إلا مربعات النماذج
    const carriesFiles = (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes('Files');
    const over = (on) => zone.classList.toggle('pj-bro-over', on && !busy && !blocked);
    for (const type of ['dragenter', 'dragover']) {
        zone.addEventListener(type, (event) => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = busy || blocked ? 'none' : 'copy';
            over(true);
        });
    }
    zone.addEventListener('dragleave', (event) => {
        if (!event.relatedTarget || !zone.contains(event.relatedTarget)) over(false);
    });
    zone.addEventListener('drop', (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        over(false);
        upload(Array.from(event.dataTransfer.files || []));
    });

    // رسالة تحت المربع: خطأ (role=alert يُعلن فوراً) أو إخبار هادئ
    function say(text, kind = 'error') {
        message.hidden = !text;
        message.className = 'pj-bro-msg' + (kind === 'error' ? ' pj-bro-err' : '');
        message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        message.textContent = text || '';
    }

    async function upload(files) {
        if (busy || blocked || !files.length) return;
        say(null);
        const pdfs = files.map((file) => ({ file, name: pdfName(file.name, file.type) })).filter((f) => f.name);
        if (!pdfs.length) return void say('البروشور يُرفع ملف PDF فقط.');
        if (pdfs.length < files.length) notify('رُفعت ملفات PDF وحدها، وتُرك ما سواها.', 'info');
        if (pdfs.length > MAX_FILES) return void say('الحد ' + number(MAX_FILES) + ' ملفات في الرفعة الواحدة.');
        // ملف PDF بلا امتداد (بعض الجوالات): يُسمّى بامتداده، فالمساعد يعرف نوعه من الاسم
        const chosen = pdfs.map((f) => (f.name === f.file.name ? f.file : new File([f.file], f.name, { type: 'application/pdf' })));
        for (const file of chosen) {
            const problem = fileProblem(file, MAX_FILE_BYTES);
            if (problem) return void say(problem);
        }

        busy = true;
        pick.disabled = true;
        poll += 1;
        lastSig = '';
        showSteps(uploadingProgress('جارٍ تجهيز الملف…'), null);
        try {
            // الصفحات تُعدّ قبل إنشاء الطلب: ما فوق الحد لا يُنشئ طلباً يُحذف بعده
            for (const file of chosen) {
                const problem = pagesProblem(file.name, pdfPageCount(await file.arrayBuffer()), MAX_PDF_PAGES);
                if (problem) throw new Error(problem);
            }
            const id = await createRequest('update', {
                title: brochureTitle(project),
                instruction: brochureInstruction(project),
                files: chosen,
                target: String(project.id),
                progress: (text) => showSteps(uploadingProgress(text), null)
            });
            // يبدأ التنفيذ ويعود فوراً؛ إن لم يصل فالمُجدوِل يلتقط الطلب خلال دقائق
            startExtraction(id);
            names = chosen.map((file) => file.name);
            shownId = id;
            notify('رُفع البروشور، والمساعد يقرؤه الآن.', 'success');
            await refresh(id);
        } catch (error) {
            say('تعذّر رفع البروشور: ' + errorText(error));
            if (shownId) refresh(shownId);
            else clear(holder);
        } finally {
            busy = false;
            pick.disabled = blocked;
        }
    }

    // يقرأ الطلب ويرسمه، ويعيد القراءة ما دام في الانتظار أو التنفيذ. poll يقطع أي سلسلة أقدم (رفع جديد، أو إلغاء)
    async function refresh(id) {
        const token = ++poll;
        const { data, error } = await settle(supabase.from('agent_requests').select(REQUEST_COLUMNS).eq('id', id).maybeSingle());
        if (token !== poll || !holder.isConnected) return;
        if (error) {
            lastSig = '';
            return void replace(holder, errorBox(error, 'تعذّر تحميل حالة البروشور', () => refresh(id)));
        }
        if (!data) {
            shownId = null;
            return void clear(holder);
        }
        const state = draw(data);
        if (state.polling) {
            setTimeout(() => { if (token === poll && holder.isConnected) refresh(id); }, POLL_MS);
        }
    }

    function draw(request) {
        const state = brochureProgress(request, request.agent_drafts, isAdmin());
        const sent = uploadSummary(request.agent_sources, request.id === shownId ? names : null);
        state.steps[0] = Object.assign({}, state.steps[0], {
            label: sent.label,
            note: [fmtDateTime(request.created_at), sent.size].filter(Boolean).join(' · ')
        });
        // ما لم يتغيّر لا يُعاد رسمه، فلا يُعلن قارئ الشاشة المرحلة نفسها كل 4 ثوانٍ
        const sig = JSON.stringify([request.id, state.steps, state.cancellable]);
        if (sig !== lastSig) {
            lastSig = sig;
            showSteps(state, request);
        }
        return state;
    }

    function showSteps(state, request) {
        const current = state.steps.find((step) => step.state === 'now' || step.state === 'wait' || step.state === 'fail')
            || state.steps[state.steps.length - 1];
        live.textContent = current ? current.label : '';
        const waitsAdmin = Boolean(request) && isAdmin() && state.awaitingApproval;
        replace(holder, el('section', { class: 'crm-card pj-bro-prog', 'aria-labelledby': 'pjBroProgTitle' }, [
            el('div', { class: 'pj-bro-head' }, [
                el('h3', { class: 'pj-bro-ptitle', id: 'pjBroProgTitle', text: 'قراءة البروشور' }),
                request && state.cancellable && request.requested_by === myId() ? el('button', {
                    type: 'button', class: 'pj-bro-cancel', text: 'إلغاء القراءة',
                    onclick: (event) => cancelReading(request.id, event.currentTarget)
                }) : null
            ]),
            el('ol', { class: 'pj-bro-steps', 'aria-label': 'مراحل قراءة البروشور' }, state.steps.map((step, i) => el('li', {
                class: 'pj-bro-step pj-st-' + step.state,
                'aria-current': step.state === 'now' || step.state === 'wait' ? 'step' : null
            }, [
                el('span', { class: 'pj-bro-dot', 'aria-hidden': 'true' }, stepMark(step.state, i)),
                el('div', { class: 'pj-bro-stext' }, [
                    el('span', { class: 'pj-bro-label' }, [el('span', { class: 'w4-sr', text: STEP_SR[step.state] || '' }), step.label]),
                    step.note ? el('small', { class: 'pj-bro-snote', text: step.note }) : null
                ])
            ]))),
            el('div', { class: 'pj-bro-foot' }, [
                el('span', { class: 'pj-bro-after', text: 'بعد الاعتماد يتحدّث المشروع هنا تلقائياً: الأسعار والنماذج والتسليم.' }),
                request ? el('span', { class: 'pj-bro-links' }, [
                    waitsAdmin ? el('a', { class: 'pj-bro-link', href: '#/approvals/' + request.id }, [el('span', { text: 'افتح شاشة الاعتماد' }), icon('arrow')]) : null,
                    el('a', { class: 'pj-bro-link', href: '#/assistant/' + request.id }, [el('span', { text: 'افتح صفحة الطلب' }), icon('arrow')])
                ]) : null
            ])
        ]));
    }

    async function cancelReading(id, button) {
        button.disabled = true;
        // كما «إلغاء التنفيذ» في صفحة الطلب: صاحب الطلب يلغيه ما دام في الانتظار أو التنفيذ، والحارس يرفض غير ذلك
        const { data, error } = await settle(supabase.from('agent_requests')
            .update({ status: 'cancelled', error_ar: 'أُلغي من الموظف' })
            .eq('id', id).in('status', ['queued', 'running']).select('id'));
        if (error) {
            button.disabled = false;
            return void fail(error, 'تعذّر إلغاء القراءة');
        }
        notify(data && data.length ? 'أُلغيت قراءة البروشور' : 'انتهت القراءة قبل الإلغاء', data && data.length ? 'success' : 'info');
        refresh(id);
    }

    // بعد رسم الصفحة: هل القراءة الآلية مفعّلة (بلا مفتاح يفشل الطلب فوراً، فيُوقف الرفع ويُقال السبب)، وآخر بروشور رفعه الموظف
    // لهذا المشروع، يُعرض ما دام مفتوحاً أو انتهى خلال أسبوع. تعذّر القراءة لا يوقف الرفع
    async function start() {
        extractionStatus().then((status) => {
            if (!zone.isConnected || status.enabled || !status.reachable) return;
            blocked = true;
            pick.disabled = true;
            say('القراءة الآلية متوقفة الآن، فالرفع موقوف حتى يفعّلها المدير.', 'info');
        });
        const { data, error } = await settle(supabase.from('agent_requests').select(REQUEST_COLUMNS)
            .eq('kind', 'update')
            .eq('requested_by', myId())
            .like('title', BROCHURE_TITLE_PREFIX + project.id + '%')
            .order('created_at', { ascending: false })
            .limit(5));
        if (!holder.isConnected || busy || shownId) return;
        if (error) return void console.warn('[CRM] brochure request', error);
        const request = latestBrochure(data, project.id);
        if (!request || !showOnLoad(brochureProgress(request, request.agent_drafts, isAdmin()), request, Date.now())) return;
        shownId = request.id;
        const state = draw(request);
        if (state.polling) {
            const token = ++poll;
            setTimeout(() => { if (token === poll && holder.isConnected) refresh(request.id); }, POLL_MS);
        }
    }

    return {
        node: el('section', { class: 'pj-bro', 'aria-labelledby': 'pjBroTitle' }, [zone, message, holder, live]),
        start
    };
}

// علامة المرحلة: ✓ تم، ونقطة بلون الشعار للجارية، وساعة لما ينتظر أحداً، وتنبيه لما تعذّر، و× لما أُغلق، والرقم لما لم يأتِ
function stepMark(state, i) {
    if (state === 'done') return icon('check');
    if (state === 'wait') return icon('clock');
    if (state === 'fail') return icon('alert');
    if (state === 'off') return icon('close');
    if (state === 'now') return el('i', { class: 'pj-bro-pulse' });
    return number(i + 1);
}

/* ===================== «المخططات» ===================== */

// بطاقة لكل نموذج (planCards): المخطط إن وُجد زرٌّ يكبّره، والاسم و«آخر وحدة»، والمواصفات، والسعر وسعر المتر، وما بقي منه،
// و«عمولتي» لمن يرى العمولة وحده، ورابط «سجّل عميل على هذا النموذج» (لا لمركز الاتصال ولا على عقار محذوف أو نموذج نفد)
function plansTab(project, rows, commission, canUpload) {
    const cards = planCards(project, rows);
    if (!cards.length) {
        return {
            count: 0,
            node: empty('لا نماذج مسجّلة لهذا العقار',
                'النماذج وأسعارها تُضاف من صفحة المشاريع' + (canUpload ? '، أو ارفع بروشور المطور من «البروفايل».' : '.'))
        };
    }
    const canRegister = myRole() !== 'callcenter' && !project.deleted_at;
    return {
        count: cards.length,
        node: [
            el('div', { class: 'pj-plans' }, cards.map((card) => planCard(project, card, commission, canRegister))),
            cards.some((card) => card.plan) ? el('p', { class: 'pj-plans-hint' }, [svgIcon(PATHS.zoom), el('span', { text: 'اضغط المخطط لتكبيره' })]) : null
        ]
    };
}

function planCard(project, card, commission, canRegister) {
    const row = card.row;
    const name = dash(row.key);
    const titleId = 'pjPlan-' + row.ord;
    const specs = specsText(row);
    const taken = row.total > 1 ? takenText(row, number) : '';
    return el('article', { class: 'crm-card pj-plan' + (card.plan ? '' : ' pj-plan-text'), 'aria-labelledby': titleId }, [
        card.plan ? el('button', {
            type: 'button', class: 'pj-plan-img', 'aria-label': 'مخطط ' + name + '، اضغط لتكبيره', onclick: () => openPlan(card.plan, name)
        }, [
            el('span', { class: 'pj-plan-zoom', 'aria-hidden': 'true' }, svgIcon(PATHS.zoom)),
            el('img', { src: card.plan, alt: '', loading: 'lazy', decoding: 'async' }),
            el('span', { class: 'pj-plan-cap', 'aria-hidden': 'true', text: 'مخطط ' + name })
        ]) : null,
        el('div', { class: 'pj-plan-body' }, [
            el('div', { class: 'pj-plan-head' }, [
                el('h2', { class: 'pj-plan-name', id: titleId, text: name }),
                card.last ? el('span', { class: 'pj-plan-last', text: 'آخر وحدة' }) : null
            ]),
            specs ? el('p', { class: 'pj-plan-specs', text: specs }) : null,
            card.price
                ? el('p', { class: 'pj-plan-price' }, [money(card.price) + NBSP, el('small', { text: SAR })])
                : el('p', { class: 'pj-plan-price pj-plan-noprice', text: 'بلا سعر مسجّل' }),
            card.perMeter ? el('p', { class: 'pj-plan-perm', text: money(card.perMeter) + NBSP + SAR + ' للمتر' }) : null,
            el('p', { class: 'pj-plan-avail' }, [
                el('b', { class: 'pj-tone-' + toneOf(row), text: availabilityText(row, number) }),
                taken ? ' · ' + taken : null
            ]),
            commission === 'show' && row.commission !== null
                ? el('p', { class: 'pj-plan-com', text: 'عمولتي: ' + money(row.commission) + NBSP + SAR }) : null,
            canRegister && row.available > 0 ? el('button', {
                type: 'button', class: 'pj-plan-reg', onclick: () => registerClient(project, row)
            }, [icon('userPlus'), el('span', { text: 'سجّل عميل على هذا النموذج' })]) : null
        ])
    ]);
}

/* ===================== شريط الأرقام ===================== */

// خمس خانات ثابتة: المتاح من الكل، والمحجوز، والمباع، وأقل سعر بين المتاح، وعمولة الوحدة — وأربع لمن لا يرى العمولة:
// pj-sum-4 يوزّع الخانات الأربع فلا تبقى خانة فارغة في الشريط. commission: show | none
function summaryStrip(s, commission) {
    const none = commission === 'none';
    return el('div', { class: 'pj-sum' + (none ? ' pj-sum-4' : ''), role: 'group', 'aria-label': 'ملخص وحدات العقار' }, [
        sumCell('متاح', [number(s.available), unit('من ' + number(s.total))], { tone: s.available > 0 ? 'ok' : null }),
        sumCell('محجوز', number(s.reserved), { tone: s.reserved > 0 ? 'amber' : null }),
        sumCell('مباع', number(s.sold)),
        sumCell('يبدأ من', s.fromPrice === null ? '—' : [money(s.fromPrice), unit(SAR)], {
            wide: true, sub: s.fromPrice !== null ? null : s.available > 0 ? 'بلا سعر مسجّل' : 'لا وحدة متاحة'
        }),
        none ? null : commissionCell(s)
    ]);
}

function sumCell(title, value, options = {}) {
    return el('div', { class: 'pj-sum-cell' + (options.wide ? ' pj-sum-wide' : '') }, [
        el('span', { class: 'pj-sum-label', text: title }),
        el('span', { class: 'pj-sum-num' + (options.tone ? ' pj-tone-' + options.tone : '') }, value),
        options.sub ? el('span', { class: 'pj-sum-sub', text: options.sub }) : null
    ]);
}

const unit = (text) => el('small', { class: 'pj-sum-unit', text });

// «عمولتي»: مدى عمولة الوحدة بين النماذج المتاحة (أو قيمتها الواحدة)، لمن يرى العمولة وحده
function commissionCell(s) {
    if (!s.commission) return sumCell('عمولتي', '—', { wide: true, sub: s.available > 0 ? 'غير محسوبة' : 'لا وحدة متاحة' });
    const { min, max } = s.commission;
    // المدى لا ينكسر داخل الرقم، بل عند الشرطة إن ضاقت الخانة
    const value = min === max
        ? [money(min)]
        : [el('span', { class: 'pj-nw', text: money(min) }), ' – ', el('span', { class: 'pj-nw', text: money(max) })];
    return sumCell('عمولتي', value.concat(unit(SAR)), { wide: true, sub: 'للوحدة الواحدة' });
}

/* ===================== «الحجوزات»: لوحة الوحدات ===================== */

// اللوحة ولوحة النموذج المختار كما كانتا قبل التبويبات: اختيار نموذج يُضغط زره وحده وتُرسم تفاصيله في اللوحة الجانبية
function bookingsTab(project, rows, commission) {
    const panel = el('aside', { class: 'crm-card pj-panel', id: 'pjPanel', 'aria-labelledby': 'pjPanelTitle' });
    const buttons = new Map();

    // byUser: ضغطة الموظف (لا الاختيار الأول)
    function select(ord, byUser) {
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', key === ord ? 'true' : 'false');
        replace(panel, panelBody(project, rows.find((row) => row.ord === ord), commission));
        if (byUser) revealPanel(panel);
    }

    const list = rows.map((row) => {
        const button = modelButton(row, () => select(row.ord, true));
        buttons.set(row.ord, button);
        return button;
    });

    const first = defaultOrd(rows);
    if (first !== null) select(first, false);
    return el('div', { class: 'pj-layout' + (rows.length ? '' : ' pj-layout-empty') }, [
        boardCard(rows, list),
        rows.length ? panel : null
    ]);
}

const KINDS = [['available', 'متاح'], ['reserved', 'محجوز'], ['sold', 'مباع']];

// list-style: none يُسقط معنى القائمة في Safari، فيُعاد صريحاً
function legend() {
    return el('ul', { class: 'pj-legend', role: 'list', 'aria-label': 'معنى الألوان' }, KINDS.map(([kind, text]) => el('li', {}, [
        el('span', { class: 'pj-sq pj-sq-' + kind, 'aria-hidden': 'true' }),
        el('span', { text })
    ])));
}

function boardCard(rows, buttons) {
    // صف «كامل العقار» وحده (عقار بلا نماذج) لا يُعدّ نماذج
    const hasModels = rows.length > 0 && rows[0].ord > 0;
    const models = hasModels ? countText(rows.length, ['نموذج واحد', 'نموذجان', 'نماذج', 'نموذجاً']) : null;
    return el('section', { class: 'crm-card pj-board', 'aria-labelledby': 'pjBoardTitle' }, [
        el('div', { class: 'crm-card-head pj-board-head' }, [
            el('div', { class: 'pj-board-title' }, [
                el('h2', { id: 'pjBoardTitle', text: 'لوحة الوحدات' }),
                models ? el('span', { class: 'pj-board-count', text: models }) : null
            ]),
            rows.length ? legend() : null
        ]),
        rows.length
            ? el('div', { class: 'pj-models', role: 'group', 'aria-label': hasModels ? 'النماذج: اختر نموذجاً لتظهر تفاصيله' : 'وحدات العقار' }, buttons)
            : empty('لا وحدات مسجّلة لهذا العقار', 'النماذج وأعداد وحداتها تُضاف من صفحة المشاريع.')
    ]);
}

// لون نص الحالة: أخضر ما بقي متاح، وكهرماني لنموذج محجوز، ورمادي لما بيع كله
const toneOf = (row) => (row.available > 0 ? 'ok' : row.status === 'reserved' ? 'amber' : 'muted');

// صف النموذج زر واحد: الاسم ومواصفاته، ثم مربع لكل وحدة، ثم «متاح N من M». المربعات للعين (aria-hidden)، وقارئ الشاشة
// يقرأ المحجوز والمباع نصاً
function modelButton(row, onSelect) {
    const specs = [
        row.rooms > 0 ? countText(row.rooms, ['غرفة واحدة', 'غرفتان', 'غرف', 'غرفة']).replace(/ /g, NBSP) : null,
        row.area > 0 ? number(row.area) + NBSP + 'م²' : null,
        row.price > 0 ? money(row.price) + NBSP + SAR : null
    ].filter(Boolean).join(' · ');
    const taken = row.total > 1 ? takenText(row, number) : '';
    const perCell = row.total > MAX_CELLS ? Math.max(1, Math.round(row.total / MAX_CELLS)) : 0;
    return el('button', {
        type: 'button', class: 'pj-model', 'aria-pressed': 'false', 'aria-controls': 'pjPanel', onclick: onSelect
    }, [
        el('span', { class: 'pj-model-main' }, [
            el('strong', { class: 'pj-model-name', text: dash(row.key) }),
            specs ? el('span', { class: 'pj-model-specs', text: specs }) : null
        ]),
        el('span', {
            class: 'pj-cells', 'aria-hidden': 'true',
            title: perCell ? 'كل مربع نحو ' + countText(perCell, ['وحدة واحدة', 'وحدتين', 'وحدات', 'وحدة']) : null
        }, row.cells.map((kind) => el('span', { class: 'pj-sq pj-sq-' + kind }))),
        el('span', { class: 'pj-model-count pj-tone-' + toneOf(row) }, [
            availabilityText(row, number),
            taken ? el('span', { class: 'w4-sr', text: '، ' + taken.replace(/ · /g, '، ') }) : null
        ])
    ]);
}

/* ===================== لوحة النموذج المختار ===================== */

function fact(title, value) {
    return el('div', { class: 'pj-fact' }, [el('dt', { text: title }), el('dd', {}, value)]);
}

// commission: show | none. سطر «عمولتي» لمن يرى العمولة وحده
function panelBody(project, row, commission) {
    if (!row) return null;
    // صف «كامل العقار» (unit_ord 0) ليس نموذجاً: العقار كله وحدة واحدة
    const whole = row.ord === 0;
    const taken = row.total > 1 ? takenText(row, number) : '';
    const canRegister = myRole() !== 'callcenter' && !project.deleted_at;
    return [
        whole ? null : el('p', { class: 'pj-panel-kicker', text: 'النموذج المختار' }),
        el('h2', { class: 'pj-panel-title', id: 'pjPanelTitle', text: dash(row.key) }),
        row.type ? el('p', { class: 'pj-panel-type', text: row.type }) : null,
        el('dl', { class: 'pj-facts' }, [
            row.rooms > 0 ? fact('الغرف', number(row.rooms)) : null,
            row.bathrooms > 0 ? fact('دورات المياه', number(row.bathrooms)) : null,
            row.area > 0 ? fact('المساحة', number(row.area) + NBSP + 'م²') : null,
            fact('السعر', row.price > 0 ? money(row.price) + NBSP + SAR : '—'),
            fact('الوحدات', [
                el('span', { class: 'pj-tone-' + toneOf(row), text: availabilityText(row, number) }),
                taken ? el('small', { text: taken }) : null
            ]),
            commission === 'show' ? fact('عمولتي', row.commission === null ? '—' : money(row.commission) + NBSP + SAR) : null
        ]),
        row.available > 0 ? null : el('p', { class: 'pj-panel-note', text: whole ? 'العقار غير متاح الآن.' : 'لا وحدة متاحة الآن في هذا النموذج.' }),
        canRegister ? el('button', {
            type: 'button', class: 'btn btn-primary pj-register', onclick: () => registerClient(project, row),
            text: whole ? 'سجّل عميل على هذا العقار' : 'سجّل عميل على هذا النموذج'
        }) : null,
        canRegister ? el('p', {
            class: 'pj-panel-hint',
            text: (whole ? 'يفتح صفقة جديدة على هذا العقار، ويُحجز' : 'يفتح صفقة جديدة على هذا النموذج، والوحدة تُحجز') + ' تلقائياً من مرحلة «عربون».'
        }) : null
    ];
}

// نموذج «صفقة جديدة» كما يفتحه «فتح صفقة» في «العقارات»: العميل يُختار فيه، والعقار والوحدة والسعر معبّأة.
// صف «كامل العقار» ليس وحدة، فلا يُكتب اسمه في unit_key (الحجز يطابق العقار كله حين لا وحدة)
function registerClient(project, row) {
    openDealForm(null, {
        project_id: project.id,
        unit_key: row.ord > 0 ? row.key : null,
        amount: row.price > 0 ? row.price : null
    }, (deal) => { location.hash = '#/deals/' + deal.id; });
}

// الجوال واللوحي: لوحة النموذج تحت قائمة النماذج (crm/v6.css، قسم صفحة المشروع، حتى 1000px)، فإن بقيت خارج الشاشة بعد
// الاختيار يُنزل إليها (التركيز يبقى على الزر)
function revealPanel(panel) {
    if (!window.matchMedia('(max-width: 1000px)').matches) return;
    const top = panel.getBoundingClientRect().top;
    if (top >= 0 && top <= window.innerHeight - 200) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
}
