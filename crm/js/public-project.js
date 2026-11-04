// صفحة المشروع للعميل: crm/p.html?c=رمز — بلا دخول، من get_project_share وحدها (038)، كما في المعاينة المعتمدة
// (ClientPage): الصور، والاسم والحي، و«يبدأ من» والغرف والتسليم، و«عن المشروع»، والنماذج بالمتاح منها، ومخططاتها،
// والمميزات، والموقع، ورخصة الإعلان، ثم لوحة المستشار بزر واحد «تواصل عبر واتساب» وزر «اتصال» ورابط «احجز زيارة».
//
// الاتصال كما في share.js حرفياً: عميل supabase بلا جلسة (ليس مفتاح تخزين النظام)، فالطلب طلب زائر (anon).
// الزائر يُعرف بمعرّف عشوائي يحفظه متصفحه (mulaem-visitor) فيُحسب في «مشاركاتي» مرة في اليوم مهما فتح؛ وإن منع المتصفح
// التخزين فمعرّف لهذه الزيارة وحدها. جهاز موظف داخل النظام (علامة mulaem-signed-in من app.js) لا يُحسب: الوسيط يجرّب
// رابطه فلا يرى نفسه عميلاً.
// ?print=1: البروفايل (PDF) — الصفحة نفسها بترتيب الطباعة، وصور المشروع، واسم المستشار ورقم ملائم أسفل كل صفحة، ونافذة الطباعة
// تُفتح بعد تحميل الصور. لا innerHTML: كل نص يمر عبر el() من ui.js.

import { el, replace, loading, money } from './ui.js';
import {
    SH_ICONS, OFFICE_NAME, SAR, readParams, isVisitorId, newVisitorId, publicView, stripFacts, unitsLine, modelPill, modelSpecs,
    contactMessage, waLink, initialOf
} from './share-model.js';

const VISITOR_KEY = 'mulaem-visitor';
const root = document.getElementById('shPage');
const params = readParams(location.search);
const client = window.supabase && window.MULAEM_CONFIG
    ? window.supabase.createClient(window.MULAEM_CONFIG.SUPABASE_URL, window.MULAEM_CONFIG.SUPABASE_KEY)
    : null;
let memoryVisitor = null;
let printed = false;

if (params.print) document.body.classList.add('sh-print-mode');
if (!client) showError();
else if (!params.code) showGone(params.given ? 'gone' : 'missing');
else load();

// الطباعة من المتصفح (Ctrl+P) بلا وضع الطباعة: صور القسم المطبوع لا تنتظر التمرير إليها
window.addEventListener('beforeprint', () => {
    for (const img of document.querySelectorAll('.sh-photos img, .sh-plans img, .sh-hero img')) img.loading = 'eager';
});

/* ===================== الزائر ===================== */

function staffDevice() {
    try {
        return localStorage.getItem('mulaem-signed-in') === '1';
    } catch (_) {
        return false;
    }
}

function randomVisitor() {
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return newVisitorId(bytes);
}

function visitorId() {
    if (staffDevice()) return null;
    try {
        const saved = localStorage.getItem(VISITOR_KEY);
        if (isVisitorId(saved)) return saved;
        const fresh = randomVisitor();
        localStorage.setItem(VISITOR_KEY, fresh);
        return fresh;
    } catch (_) {
        if (!memoryVisitor) memoryVisitor = randomVisitor();
        return memoryVisitor;
    }
}

/* ===================== التحميل ===================== */

async function load() {
    replace(root, loading('جارٍ تحميل المشروع'));
    let result;
    try {
        result = await client.rpc('get_project_share', { p_code: params.code, p_visitor: visitorId() });
    } catch (error) {
        result = { data: null, error };
    }
    if (result.error) return void showError();
    const view = publicView(result.data);
    if (!view) return void showGone('gone');
    render(view);
}

function svg(name, cls = 'sh-ico') {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    node.setAttribute('class', cls);
    for (const d of SH_ICONS[name] || []) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        node.appendChild(path);
    }
    return node;
}

function logo() {
    return el('img', { class: 'sh-gone-logo', src: '../images/logo.jpg', alt: 'شعار ملائم العقارية' });
}

// رمز مجهول أو مُبطل، أو مشروع لم يعد معروضاً: صفحة هادئة تقول ما يفعله العميل
function showGone(kind) {
    document.title = 'الرابط غير متاح · ' + OFFICE_NAME;
    replace(root, el('section', { class: 'sh-gone', 'aria-labelledby': 'shGoneTitle' }, [
        logo(),
        el('h1', { id: 'shGoneTitle', text: kind === 'missing' ? 'الرابط ناقص' : 'هذا الرابط غير متاح' }),
        el('p', {
            text: kind === 'missing'
                ? 'افتح الرابط كما وصلك في الرسالة كاملاً.'
                : 'ربما انتهى عرض هذا المشروع أو تغيّر الرابط. اطلب من مستشارك العقاري رابطاً جديداً.'
        })
    ]));
}

function showError() {
    document.title = OFFICE_NAME;
    replace(root, el('section', { class: 'sh-gone', role: 'alert' }, [
        logo(),
        el('h1', { text: 'تعذّر تحميل الصفحة' }),
        el('p', { text: 'تحقق من الإنترنت ثم أعد المحاولة.' }),
        client ? el('button', { type: 'button', class: 'sh-btn sh-btn-outline', text: 'إعادة المحاولة', onclick: load }) : null
    ]));
}

/* ===================== الصفحة ===================== */

function render(view) {
    document.title = view.name + ' · ' + OFFICE_NAME;
    const gallery = view.images.length > 1 ? galleryDialog(view) : null;
    // جدول للطباعة وحدها: تذييله (اسم المستشار ورقم ملائم) يتكرر أسفل كل صفحة مطبوعة ويُحجز له مكانه. على الشاشة كتل عادية
    const doc = el('table', { class: 'sh-doc', role: 'presentation' }, [
        el('tfoot', {}, el('tr', {}, el('td', {}, printFoot(view)))),
        el('tbody', {}, el('tr', {}, el('td', {}, [
            hero(view, gallery),
            intro(view),
            view.description ? el('section', { class: 'sh-sec sh-card', 'aria-labelledby': 'shAbout' }, [
                el('h2', { id: 'shAbout', text: 'عن المشروع' }),
                el('p', { class: 'sh-about', text: view.description })
            ]) : null,
            modelsSection(view),
            plansSection(view),
            view.features.length ? featuresSection(view) : null,
            view.mapUrl ? locationSection(view) : null,
            photosSection(view),
            footer(view)
        ])))
    ]);
    replace(root, [params.print ? printBar() : null, doc, gallery]);
    for (const old of document.querySelectorAll('.sh-contact')) old.remove();
    root.insertAdjacentElement('afterend', contactPanel(view));
    if (params.print) printWhenReady();
}

// بديل الصورة: أبراج هادئة بألوان الخطوط، بلا نص
function heroArt() {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 390 276');
    node.setAttribute('preserveAspectRatio', 'xMidYMax slice');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('class', 'sh-hero-art');
    const shapes = [
        ['sh-art-ground', 'M0 240h390v36H0z'],
        ['sh-art-low', 'M0 240V206h24v-16h28v22h20v28zM326 240v-30h22v-20h20v14h22v36z'],
        ['sh-art-mid', 'M84 108h62v132H84zM248 84h66v156h-66z'],
        ['sh-art-high', 'M156 52h82v188h-82zM176 40h42v12h-42z']
    ];
    for (const [cls, d] of shapes) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', cls);
        path.setAttribute('d', d);
        node.appendChild(path);
    }
    return node;
}

function hero(view, gallery) {
    const fig = el('figure', { class: 'sh-hero' });
    const src = view.images[0];
    const empty = () => { fig.classList.add('sh-hero-empty'); fig.insertBefore(heroArt(), fig.firstChild); };
    if (src) {
        const img = el('img', { referrerPolicy: 'no-referrer', alt: 'صورة ' + view.name, src });
        img.setAttribute('fetchpriority', 'high');
        img.addEventListener('error', () => { img.remove(); empty(); });
        fig.appendChild(img);
    } else {
        empty();
    }
    fig.appendChild(el('span', { class: 'sh-brand', text: OFFICE_NAME }));
    if (gallery) {
        fig.appendChild(el('button', {
            type: 'button', class: 'sh-gallery-btn', onclick: (event) => openGallery(gallery, event.currentTarget)
        }, [svg('image'), el('span', { text: 'كل الصور (' + view.images.length + ')' })]));
    }
    return fig;
}

function intro(view) {
    const facts = stripFacts(view);
    const purpose = view.purpose === 'rent' ? 'للإيجار' : view.purpose === 'sale' ? 'للبيع' : '';
    const pills = [view.status, purpose].filter(Boolean);
    const whole = !view.models.length && view.summary.total > 0;
    return el('section', { class: 'sh-intro', 'aria-labelledby': 'shName' }, [
        pills.length ? el('div', { class: 'sh-pills' }, pills.map((text) => el('span', { class: 'sh-pill', text }))) : null,
        el('h1', { id: 'shName', text: view.name }),
        view.place ? el('p', { class: 'sh-loc' }, [svg('pin'), el('span', { text: view.place })]) : null,
        el('div', { class: 'sh-facts sh-facts-' + facts.length, role: 'group', 'aria-label': 'المشروع في سطر' }, facts.map((fact) => el('div', { class: 'sh-fact' }, [
            el('span', { text: fact.label }),
            el('strong', {}, [fact.value, fact.unit ? el('small', { text: ' ' + fact.unit }) : null])
        ]))),
        whole ? el('p', { class: 'sh-avail ' + (view.summary.available > 0 ? 'sh-avail-ok' : 'sh-avail-closed'), text: unitsLine(view.summary) }) : null
    ]);
}

// كل نموذج بطاقة: اسمه والمتاح منه، ومواصفاته، وسعره. مع رقم للتواصل تصير البطاقة رابط سؤال عنه في واتساب
function modelsSection(view) {
    if (!view.models.length) return null;
    const phone = view.consultant.phone;
    return el('section', { class: 'sh-sec', 'aria-labelledby': 'shModels' }, [
        el('div', { class: 'sh-sec-head' }, [
            el('h2', { id: 'shModels', text: 'النماذج' }),
            el('span', { class: 'sh-sec-meta', text: unitsLine(view.summary) })
        ]),
        el('ul', { class: 'sh-models', role: 'list' }, view.models.map((model) => {
            const pill = modelPill(model);
            const specs = modelSpecs(model);
            const inner = [
                el('span', { class: 'sh-mdl-top' }, [
                    el('b', { text: model.name }),
                    el('span', { class: 'sh-pill sh-pill-' + pill.tone, text: pill.text })
                ]),
                specs ? el('span', { class: 'sh-mdl-sz', text: specs }) : null,
                el('strong', { class: 'sh-mdl-price' }, model.price !== null
                    ? [money(model.price), el('small', { text: ' ' + SAR })]
                    : 'السعر عند التواصل')
            ];
            if (!phone) return el('li', {}, el('div', { class: 'sh-mdl' }, inner));
            const ask = 'اسأل عن ' + model.name + ' عبر واتساب';
            return el('li', {}, el('a', {
                class: 'sh-mdl', href: waLink(phone, contactMessage(view, 'model', model)), target: '_blank', rel: 'noopener', title: ask
            }, inner.concat(el('span', { class: 'sh-sr', text: '، ' + ask }))));
        }))
    ]);
}

// مخططات النماذج: كل مخطط يُفتح كاملاً في نافذة جديدة ليكبّره العميل. صورة لا تُحمَّل تُزال، ومعها القسم إن لم يبق منه شيء
function plansSection(view) {
    const list = view.models.filter((model) => model.plan);
    if (!list.length) return null;
    const grid = el('ul', { class: 'sh-plans-grid', role: 'list' });
    const section = el('section', { class: 'sh-sec sh-plans', 'aria-labelledby': 'shPlans' }, [el('h2', { id: 'shPlans', text: 'المخططات' }), grid]);
    for (const model of list) {
        const img = el('img', { referrerPolicy: 'no-referrer', alt: 'مخطط ' + model.name, loading: params.print ? 'eager' : 'lazy', src: model.plan });
        const item = el('li', {}, el('a', { class: 'sh-plan', href: model.plan, target: '_blank', rel: 'noopener noreferrer' }, [
            img, el('span', { text: model.name })
        ]));
        img.addEventListener('error', () => {
            item.remove();
            if (!grid.children.length) section.remove();
        });
        grid.appendChild(item);
    }
    return section;
}

function featuresSection(view) {
    return el('section', { class: 'sh-sec sh-card', 'aria-labelledby': 'shFeatures' }, [
        el('h2', { id: 'shFeatures', text: 'المميزات' }),
        el('ul', { class: 'sh-feats', role: 'list' }, view.features.map((text) => el('li', {}, [svg('check'), el('span', { text })])))
    ]);
}

// خريطة للزينة (شوارع ودبوس)، والموقع الحقيقي في خرائط Google
function mapArt() {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 324 140');
    node.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    node.setAttribute('aria-hidden', 'true');
    const parts = [
        ['sh-map-road', 'M0 44H324M0 104H324M108 0V140M216 0V140'],
        ['sh-map-lane', 'M54 0V44M54 104V140M270 44V104M108 74H216'],
        ['sh-map-pin', 'M162 84c-8-9-14-16-14-24a14 14 0 0 1 28 0c0 8-6 15-14 24z'],
        ['sh-map-dot', 'M162 65a5 5 0 1 0 0-10 5 5 0 0 0 0 10z']
    ];
    for (const [cls, d] of parts) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', cls);
        path.setAttribute('d', d);
        node.appendChild(path);
    }
    return el('div', { class: 'sh-map' }, node);
}

function locationSection(view) {
    return el('section', { class: 'sh-sec sh-card', 'aria-labelledby': 'shWhere' }, [
        el('h2', { id: 'shWhere', text: 'الموقع' }),
        view.place ? el('p', { class: 'sh-where', text: view.place }) : null,
        mapArt(),
        el('a', { class: 'sh-btn sh-btn-plain sh-btn-block sh-map-link', href: view.mapUrl, target: '_blank', rel: 'noopener' }, [
            svg('external'), el('span', { text: 'افتح في خرائط Google' })
        ])
    ]);
}

// صور المشروع في البروفايل المطبوع (الشاشة لها «كل الصور»)
function photosSection(view) {
    const list = view.images.slice(1, 7);
    if (!list.length) return null;
    const grid = el('div', { class: 'sh-photos-grid' });
    const section = el('section', { class: 'sh-sec sh-photos', 'aria-labelledby': 'shPhotos' }, [el('h2', { id: 'shPhotos', text: 'الصور' }), grid]);
    list.forEach((src, i) => {
        const img = el('img', { referrerPolicy: 'no-referrer', alt: 'صورة ' + (i + 2) + ' من ' + view.images.length, loading: params.print ? 'eager' : 'lazy', src });
        img.addEventListener('error', () => {
            img.remove();
            if (!grid.children.length) section.remove();
        });
        grid.appendChild(img);
    });
    return section;
}

function footer(view) {
    return el('footer', { class: 'sh-pub-foot' }, [
        view.license ? el('p', { text: 'رخصة الإعلان ' + view.license }) : null,
        el('p', { text: 'الأسعار والمتاح حسب آخر تحديث.' })
    ]);
}

function contactPanel(view) {
    const c = view.consultant;
    const who = c.name || OFFICE_NAME;
    return el('aside', { class: 'sh-contact', 'aria-label': 'تواصل مع مستشارك العقاري' }, [
        el('div', { class: 'sh-who-row' }, [
            el('span', { class: 'sh-avatar', 'aria-hidden': 'true', text: initialOf(who) }),
            el('div', { class: 'sh-who-id' }, [
                el('span', { text: 'مستشارك العقاري' }),
                el('strong', { text: c.name ? c.name + ' · ' + OFFICE_NAME : OFFICE_NAME })
            ]),
            c.phone ? el('a', {
                class: 'sh-visit', href: waLink(c.phone, contactMessage(view, 'visit')), target: '_blank', rel: 'noopener', text: 'احجز زيارة'
            }) : null
        ]),
        c.phone ? el('div', { class: 'sh-cta' + (c.tel ? '' : ' sh-cta-one') }, [
            el('a', { class: 'sh-btn sh-btn-primary', href: waLink(c.phone, contactMessage(view, 'ask')), target: '_blank', rel: 'noopener' }, [
                svg('chat'), el('span', { text: 'تواصل عبر واتساب' })
            ]),
            c.tel ? el('a', { class: 'sh-btn sh-btn-outline', href: c.tel, 'aria-label': 'اتصال بـ ' + OFFICE_NAME + ' على ' + c.display }, [
                svg('phone'), el('span', { text: 'اتصال' })
            ]) : null
        ]) : el('p', { class: 'sh-no-phone', text: 'للتواصل ردّ على رسالة مستشارك التي وصلك منها هذا الرابط.' })
    ]);
}

/* ===================== الصور ===================== */

function galleryDialog(view) {
    const close = el('button', { type: 'button', class: 'sh-gallery-close', 'aria-label': 'إغلاق الصور' }, svg('close'));
    const dialog = el('dialog', { class: 'sh-gallery', 'aria-labelledby': 'shGalleryTitle' }, [
        el('div', { class: 'sh-gallery-head' }, [el('h2', { id: 'shGalleryTitle', text: 'صور ' + view.name }), close]),
        el('ul', { class: 'sh-gallery-list', role: 'list' }, view.images.map((src, i) => {
            const img = el('img', { referrerPolicy: 'no-referrer', loading: 'lazy', alt: 'صورة ' + (i + 1) + ' من ' + view.images.length, src });
            const item = el('li', {}, img);
            img.addEventListener('error', () => item.remove());
            return item;
        }))
    ]);
    close.addEventListener('click', () => closeGallery(dialog));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) closeGallery(dialog); });
    dialog.addEventListener('close', () => {
        if (dialog.opener && dialog.opener.isConnected) dialog.opener.focus();
    });
    return dialog;
}

function openGallery(dialog, opener) {
    dialog.opener = opener || null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    const close = dialog.querySelector('.sh-gallery-close');
    if (close) close.focus();
}

function closeGallery(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else {
        dialog.removeAttribute('open');
        if (dialog.opener && dialog.opener.isConnected) dialog.opener.focus();
    }
}

/* ===================== البروفايل (PDF) ===================== */

function printBar() {
    return el('div', { class: 'sh-print-bar' }, [
        el('span', { text: 'نسخة البروفايل للطباعة: احفظها PDF من نافذة الطباعة.' }),
        el('button', { type: 'button', class: 'sh-btn sh-btn-outline', onclick: () => window.print() }, [svg('printer'), el('span', { text: 'حفظ PDF' })])
    ]);
}

// يتكرر أسفل كل صفحة مطبوعة
function printFoot(view) {
    const c = view.consultant;
    return el('div', { class: 'sh-print-foot' }, [
        el('span', {}, [
            c.name ? c.name + ' · ' : '',
            c.display ? el('bdi', { dir: 'ltr', text: c.display }) : null,
            c.display ? ' · ' : '',
            OFFICE_NAME
        ]),
        view.license ? el('span', { text: 'رخصة الإعلان ' + view.license }) : null
    ]);
}

// نافذة الطباعة مرة واحدة بعد تحميل الصور (أو بعد أربع ثوانٍ)
function printWhenReady() {
    const images = Array.from(document.querySelectorAll('.sh-hero img, .sh-plans img, .sh-photos img'));
    const waits = images.map((img) => (img.complete ? null : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
    })));
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    Promise.race([Promise.all(waits), timeout]).then(() => {
        if (printed) return;
        printed = true;
        setTimeout(() => {
            try { window.print(); } catch (_) { /* متصفح بلا طباعة: الصفحة نفسها تُقرأ */ }
        }, 250);
    });
}
