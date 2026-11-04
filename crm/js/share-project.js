// «مشاركة المشروع مع عميل»: نافذة المعاينة المعتمدة (ShareSheet) — تختار الصيغة (رابط صفحة، بطاقة صورة، بروفايل PDF)
// وترى معاينتها، ثم زر واحد «أرسل عبر واتساب»، وبجانبه نسخ الرابط أو تنزيل الصورة أو الملف.
//
// openShareSheet({ id, name, district, city }, { unit, phone, lead, onClose }) من صفحة المشروع («مشاركة مع عميل»)، ومن
// «مشاركاتي» (my-shares.js)، ومن مطابقات طلب العميل (matching.js: unit نموذج المطابقة، وphone جوال العميل فتُفتح محادثته).
// عرض واحد (قرار المالك): مشروع له نماذج يختار الوسيط أحدها، والرسالة والرابط والبطاقة والبروفايل لهذا النموذج وحده.
// عند الفتح: share_project بلا صيغة يعطي رمز الرابط الثابت لهذا الموظف في هذا المشروع ولا يُحسب إرسالاً (038)، ثم
// get_project_share بالرمز يعطي ما تعرضه صفحة العميل بالضبط (ومن داخل النظام لا يُحسب فتحاً)، فترسم منه المعاينة والبطاقة.
// كل إرسال يستدعي share_project بصيغته أولاً فيُسجَّل في «مشاركاتي»، والفعل نفسه (واتساب، الحافظة، التنزيل، المشاركة من
// الجوال) في الضغطة ذاتها: المتصفح يمنعها بعد انتظار الشبكة، والرمز جاهز من الفتح.
//
// بطاقة الصورة تُرسم هنا على canvas بمقاس 1080×1080 كما في ShareCard: صورة المشروع إن أمكن رسمها (تُطلب بـ CORS، وإن
// رفض مصدرها أو تعذّر تحميلها فالبديل الهادئ)، والاسم والحي و«يبدأ من» وثلاث حقائق، والمستشار باسمه ورقم ملائم، و«ملائم
// العقارية» ورخصة الإعلان، ورمز QR يفتح الرابط نفسه. لا عمولة ولا ملاحظات في أي صيغة: لا تصل من الخادم أصلاً.
// رقم التواصل في كل الصيغ واتساب المكتب من الإعدادات (قرار المالك 2026-11-04).

import { supabase } from './supabase.js';
import { canSeeCommission } from './auth.js';
import { el, replace, openModal, closeModal, notify, fail, errorText, icon, loading, money, number } from './ui.js';
import {
    FORMATS, FORMAT_LABEL, FORMAT_HINT, FORMAT_ICON, SH_ICONS, CARD_COLORS, SAR, OFFICE_NAME,
    publicView, placeText, shareLink, shareMessage, waLink, cardFacts, availableText, modelSpecs, priceText,
    sheetStatsText, cardFileName, qrMatrix, defaultOffer, offerLabel
} from './share-model.js';

// الاستعلام لا يرمي: خطأ الشبكة يصل { error } كخطأ الخادم
const settle = (query) => Promise.resolve(query).catch((error) => ({ data: null, error }));

const NOTES = {
    link: 'الرابط ثابت لك في هذا المشروع، وكل من يفتحه يُحسب في «مشاركاتي».',
    card: 'رمز البطاقة يفتح نفس رابطك، فكل من يمسحه يُحسب في «مشاركاتي».',
    pdf: 'يوصل الملف للعميل كرابط تحميل باسمك، وكل من يفتحه يُحسب في «مشاركاتي».'
};

// أيقونة خطية: من share-model (SH_ICONS) وإلا من ui.js. sh-ico يرسمها حيث لا يُحمَّل app.css
export function shIcon(name, cls = 'ico sh-ico') {
    const paths = SH_ICONS[name];
    if (!paths) return icon(name, cls);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', cls);
    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    }
    return svg;
}

// الرابط العام: crm/p.html بجانب صفحة النظام، بلا استعلام ولا هاش
function publicBase() {
    return new URL('p.html', location.origin + location.pathname).href;
}

// دالة 038 لم تُطبَّق بعد على القاعدة: جملة عربية بدل رسالة PostgREST الإنجليزية
function isMissingFunction(error) {
    return Boolean(error) && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(String(error.message || '')));
}

function problem(error, retry) {
    if (isMissingFunction(error)) {
        return el('div', { class: 'crm-error', role: 'alert', text: 'المشاركة لم تُفعَّل بعد في قاعدة البيانات (التحديث 038). راجع المدير.' });
    }
    return el('div', { class: 'crm-error crm-error-retry', role: 'alert' }, [
        el('span', { class: 'crm-error-text', text: 'تعذّر تجهيز المشاركة: ' + errorText(error) }),
        retry ? el('button', { type: 'button', class: 'btn btn-outline btn-xs crm-retry', onclick: retry }, [icon('refresh'), el('span', { text: 'إعادة المحاولة' })]) : null
    ]);
}

function refusal(code) {
    const text = code === 'not_found' ? 'لا يُشارك إلا مشروع معتمد غير محذوف، وهذا المشروع غير متاح للمشاركة الآن.'
        : code === 'expired' ? 'انتهت رخصة إعلان هذا المشروع، فلا يُشارك حتى تُجدَّد من صفحة المشاريع.'
            : code === 'forbidden' ? 'لا تملك صلاحية المشاركة. راجع المدير.'
            : 'تعذّر تجهيز المشاركة.';
    return el('div', { class: 'crm-error', role: 'alert', text });
}

// رابط يُفتح في نافذة جديدة من الضغطة نفسها (واتساب، وصفحة الطباعة)
function openUrl(url) {
    const a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'sh-sr' });
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name, class: 'sh-sr' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ===================== النافذة ===================== */

export function openShareSheet(project, options = {}) {
    const id = Number(project && project.id);
    if (!Number.isInteger(id) || id <= 0) return;
    const base = publicBase();
    const state = {
        id, format: 'link', code: null, raw: null, full: null, ord: null, view: null, stats: null, card: null, cardJob: null, cardFrame: null, copyField: null
    };

    const sub = el('p', { class: 'sh-sub', text: [project.name, placeText(project.district, project.city)].filter(Boolean).join(' · ') });
    const main = el('div', { class: 'sh-main' }, loading('جارٍ تجهيز المشاركة'));
    const body = el('div', { class: 'sh-sheet' }, [sub, options.lead ? el('p', { class: 'sh-lead', text: options.lead }) : null, main]);
    openModal('مشاركة المشروع مع عميل', body, { onClose: options.onClose || null });
    const holder = document.getElementById('modalContent');
    if (holder) holder.classList.add('sh-modal');

    let previewHost = null;
    let whoHost = null;
    let actionsHost = null;
    let statsSlot = null;

    boot();

    async function boot() {
        replace(main, loading('جارٍ تجهيز المشاركة'));
        const res = await settle(supabase.rpc('share_project', { p_project: id, p_format: null }));
        if (!body.isConnected) return;
        if (res.error) return void replace(main, problem(res.error, boot));
        if (!res.data || res.data.ok !== true || !res.data.code) return void replace(main, refusal(res.data && res.data.code));
        state.code = res.data.code;
        if (!(await loadView())) return;
        render();
        loadStats();
        prepareCard();
    }

    // ما يراه العميل الآن
    async function loadView() {
        const res = await settle(supabase.rpc('get_project_share', { p_code: state.code, p_visitor: null }));
        if (!body.isConnected) return false;
        const full = res.error ? null : publicView(res.data);
        if (!full) {
            replace(main, res.error ? problem(res.error, boot) : refusal('not_found'));
            return false;
        }
        state.raw = res.data;
        state.full = full;
        state.ord = defaultOffer(full, options.unit);
        const view = publicView(res.data, state.ord);
        state.view = view;
        sub.textContent = [view.name, view.place].filter(Boolean).join(' · ');
        return true;
    }

    async function loadStats() {
        const res = await settle(supabase.rpc('my_project_shares', { p_all: false }));
        if (!body.isConnected || res.error) return;
        state.stats = (res.data || []).find((row) => Number(row.project_id) === id) || null;
        paintStats();
    }

    function render() {
        previewHost = el('div', { class: 'sh-pv' });
        whoHost = el('div', { class: 'sh-who-host' });
        actionsHost = el('div', { class: 'sh-acts' });
        replace(main, [offerPicker(), formatPicker(), previewHost, whoHost, actionsHost]);
        paintPreview();
        paintWho();
        paintActions();
    }

    /* ---------- العرض ---------- */

    // مشروع له نموذجان فأكثر: يختار الوسيط العرض الذي يرسله، ولا يخرج غيره في الرسالة ولا في الرابط
    function offerPicker() {
        if (state.full.models.length < 2) return null;
        return el('div', { class: 'sh-offer' }, [
            el('label', { for: 'shOffer', text: 'اختر العرض' }),
            el('select', { id: 'shOffer', onchange: (event) => chooseOffer(Number(event.target.value)) }, state.full.models.map((model) => el('option', {
                value: String(model.ord), selected: model.ord === state.ord, text: offerLabel(model)
            })))
        ]);
    }

    function chooseOffer(ord) {
        state.ord = ord;
        state.view = publicView(state.raw, ord);
        state.card = null;
        state.copyField = null;
        paintPreview();
        paintWho();
        paintActions();
        if (state.format === 'card') prepareCard();
    }

    /* ---------- الصيغة ---------- */

    function formatPicker() {
        return el('fieldset', { class: 'sh-formats' }, [
            el('legend', { text: 'اختر الصيغة' }),
            el('div', { class: 'sh-opts' }, FORMATS.map((f) => el('label', { class: 'sh-opt' }, [
                el('input', { type: 'radio', name: 'shFormat', value: f, checked: f === state.format, onchange: () => choose(f) }),
                el('b', { text: FORMAT_LABEL[f] }),
                shIcon(FORMAT_ICON[f]),
                el('small', { text: FORMAT_HINT[f] })
            ])))
        ]);
    }

    function choose(format) {
        state.format = format;
        state.copyField = null;
        paintPreview();
        paintActions();
        if (format === 'card') prepareCard();
    }

    /* ---------- المعاينة ---------- */

    function paintPreview() {
        const view = state.view;
        state.cardFrame = null;
        replace(previewHost, state.format === 'card' ? cardPreview(view) : state.format === 'pdf' ? pdfPreview(view) : linkPreview(view));
    }

    function checks(items) {
        return el('ul', { class: 'sh-checks', role: 'list' }, items.filter(Boolean).map((text) => el('li', {}, [shIcon('check'), el('span', { text })])));
    }

    function note(iconName, text) {
        return el('p', { class: 'sh-nb' }, [shIcon(iconName), el('span', { text })]);
    }

    // الصورة الأولى أو البديل الهادئ. CORS كالبطاقة، فلا يختلف ما يُرى هنا عمّا يُرسم فيها
    function photoBox(view, cls) {
        const box = el('div', { class: cls + ' sh-ph' });
        const src = view.images[0];
        if (src) {
            // crossOrigin قبل src: تغييره بعد بدء التحميل يعيد الطلب
            const img = el('img', { crossOrigin: 'anonymous', referrerPolicy: 'no-referrer', alt: '', loading: 'lazy', src });
            img.addEventListener('error', () => img.remove());
            box.appendChild(img);
        }
        return box;
    }

    function linkBullets(view) {
        const pics = view.images.length > 0;
        const where = Boolean(view.mapUrl);
        const n = view.models.length;
        const c = view.consultant;
        return [
            pics && where ? 'صور المشروع وموقعه على الخريطة' : pics ? 'صور المشروع' : where ? 'موقع المشروع على الخريطة' : null,
            n > 2 ? 'النماذج كلها بأسعارها، والمتاح منها يتحدّث وحده'
                : n === 2 ? 'النموذجان بسعريهما، والمتاح منهما يتحدّث وحده'
                    : n === 1 ? 'النموذج بسعره، والمتاح منه يتحدّث وحده' : 'السعر والمتاح، ويتحدّث وحده',
            view.features.length ? 'المميزات: ' + view.features.slice(0, 3).join('، ') : null,
            c.phone ? 'اسمك، وزر اتصال وواتساب يوصله لرقم ملائم' : 'اسمك'
        ];
    }

    function linkPreview(view) {
        const s = view.summary;
        const first = view.models[0];
        const free = availableText(s);
        return el('div', { class: 'sh-pvb sh-pvb-link' }, [
            el('div', { class: 'sh-phone', role: 'img', 'aria-label': 'معاينة أعلى صفحة المشروع على جوال العميل' },
                el('div', { class: 'sh-phone-screen', 'aria-hidden': 'true' }, [
                    el('div', { class: 'sh-phone-bar', text: OFFICE_NAME }),
                    photoBox(view, 'sh-phone-photo'),
                    el('div', { class: 'sh-phone-body' }, [
                        el('b', { class: 'sh-phone-name', text: view.name }),
                        el('span', { class: 'sh-phone-place', text: [view.place, view.delivery ? 'التسليم ' + view.delivery : ''].filter(Boolean).join(' · ') }),
                        el('span', { class: 'sh-phone-price' }, [
                            el('b', { text: s.fromPrice === null ? 'السعر عند التواصل' : s.priceLabel + ' ' + priceText(s.fromPrice) }),
                            free ? el('span', { class: 'sh-pill sh-pill-ok', text: free }) : null
                        ])
                    ]),
                    el('div', { class: 'sh-phone-who' }, [
                        el('span', { class: 'sh-phone-who-text' }, [el('small', { text: 'مستشارك العقاري' }), el('b', { text: view.consultant.name || OFFICE_NAME })]),
                        el('span', { class: 'sh-phone-ico' }, shIcon('phone')),
                        el('span', { class: 'sh-phone-ico sh-phone-ico-main' }, shIcon('chat'))
                    ]),
                    first ? el('div', { class: 'sh-phone-model' }, [
                        el('span', { text: [first.name, modelSpecs(first)].filter(Boolean).join(' · ') }),
                        first.price !== null ? el('b', { text: priceText(first.price) }) : null
                    ]) : null
                ])),
            el('div', { class: 'sh-pvt' }, [
                el('h3', { text: 'اللي يشوفه العميل' }),
                checks(linkBullets(view)),
                // من لا يرى العمولة لا تُذكر له أصلاً (قرار المالك)
                note('lock', canSeeCommission() ? 'العمولة والملاحظات الداخلية ما تظهر له أبداً.' : 'الملاحظات الداخلية ما تظهر له أبداً.')
            ])
        ]);
    }

    function cardPreview(view) {
        state.cardFrame = el('div', { class: 'sh-card-frame' }, state.card ? state.card.canvas : el('span', { class: 'sh-card-wait', text: 'البطاقة تتجهّز…' }));
        return el('div', { class: 'sh-pvb' }, [
            state.cardFrame,
            el('div', { class: 'sh-pvt' }, [
                el('h3', { text: 'صورة مربعة للمحادثة أو الحالة' }),
                checks([
                    view.summary.fromPrice === null ? 'الاسم والحي' : 'الاسم والحي والسعر الابتدائي',
                    [view.summary.rooms ? 'الغرف' : null, view.summary.area ? (view.models.length ? 'المساحات' : 'المساحة') : null, view.delivery ? 'موعد التسليم' : null]
                        .filter(Boolean).join(' و'),
                    ['اسمك', view.consultant.phone ? 'رقم ملائم' : null, view.license ? 'رخصة الإعلان' : null].filter(Boolean).join(' و'),
                    'رمز يمسحه العميل فتنفتح له صفحة المشروع'
                ]),
                view.license ? null : el('p', { class: 'sh-warn' }, [shIcon('info'), el('span', { text: 'رقم رخصة الإعلان غير مسجّل لهذا المشروع، فلا يظهر في البطاقة. يُضاف من صفحة المشاريع.' })]),
                note('info', 'ما نكتب فيها عدد المتاح لأنه يتغيّر، والرمز يفتح الصفحة المحدّثة.')
            ])
        ]);
    }

    function pdfPreview(view) {
        const rows = view.models.length ? view.models : view.whole ? [Object.assign({}, view.whole, { name: view.type || 'العقار' })] : [];
        return el('div', { class: 'sh-pvb' }, [
            el('div', { class: 'sh-pages-wrap' }, [
                el('div', { class: 'sh-pages', role: 'img', 'aria-label': 'معاينة أول صفحتين من البروفايل' }, [
                    el('div', { class: 'sh-page sh-page-cover', 'aria-hidden': 'true' }, [
                        photoBox(view, 'sh-page-photo'),
                        el('div', { class: 'sh-page-title' }, [
                            el('b', { text: view.name }),
                            el('span', { text: ['بروفايل المشروع', view.place].filter(Boolean).join(' · ') })
                        ]),
                        el('div', { class: 'sh-page-foot' }, [el('b', { text: OFFICE_NAME }), el('span', { text: view.consultant.name })])
                    ]),
                    el('div', { class: 'sh-page sh-page-list', 'aria-hidden': 'true' }, [
                        el('b', { class: 'sh-page-h', text: view.models.length ? 'النماذج والأسعار' : 'تفاصيل العقار' }),
                        ...rows.slice(0, 5).map((m) => el('div', { class: 'sh-page-row' }, [
                            el('span', { text: [m.name, m.area !== null ? number(m.area) + ' م²' : ''].filter(Boolean).join(' · ') }),
                            el('span', { text: m.price !== null ? money(m.price) : '—' })
                        ])),
                        view.features.length ? el('b', { class: 'sh-page-h sh-page-h2', text: 'المميزات' }) : null,
                        ...view.features.slice(0, 3).map((f) => el('span', { class: 'sh-page-line', text: f }))
                    ])
                ]),
                el('span', { class: 'sh-pages-cap', text: 'يتجهّز من صفحة المشروع لحظة الإرسال' })
            ]),
            el('div', { class: 'sh-pvt' }, [
                el('h3', { text: 'ملف للعميل اللي يبي التفاصيل كاملة' }),
                checks([
                    view.images.length ? 'الغلاف والصور' : 'الغلاف',
                    view.models.length ? 'جدول النماذج بالغرف والمساحات والأسعار' : 'السعر والمساحة والغرف',
                    [view.features.length ? 'المميزات' : null, view.description ? 'الوصف' : null, view.mapUrl ? 'الموقع' : null].filter(Boolean).join(' و'),
                    view.consultant.phone ? 'اسمك ورقم ملائم في كل صفحة' : 'اسمك في كل صفحة'
                ]),
                note('info', 'يتجهّز من بيانات المشروع لحظة الإرسال، فالأسعار فيه دائماً آخر نسخة.')
            ])
        ]);
    }

    /* ---------- الاسم والرقم ---------- */

    // كل الصيغ تحمل اسم الموظف ورقم ملائم للتواصل، والرقم من الإعدادات. إن لم يُسجَّل يُقال ذلك هنا
    function paintWho() {
        const c = state.view.consultant;
        replace(whoHost, [
            el('p', { class: 'sh-who' }, [
                shIcon('idcard'),
                el('span', { class: 'sh-who-text' }, c.display ? [
                    'كلها تحمل اسمك ورقم ملائم للتواصل: ',
                    el('b', {}, [c.name ? c.name + ' · ' : '', el('bdi', { dir: 'ltr', text: c.display })])
                ] : ['كلها تحمل اسمك: ', el('b', { text: c.name || OFFICE_NAME })])
            ]),
            c.display ? null : el('p', { class: 'sh-warn' }, [
                shIcon('info'),
                el('span', { text: 'رقم واتساب المكتب غير مسجّل، فلن يظهر للعميل رقم للتواصل. يضيفه المدير من الإعدادات.' })
            ])
        ]);
    }

    /* ---------- الأزرار ---------- */

    function paintActions() {
        const f = state.format;
        const send = el('button', { type: 'button', class: 'btn btn-primary sh-send', onclick: sendWhatsApp }, [
            shIcon('chat'), el('span', { text: 'أرسل عبر واتساب' })
        ]);
        const alt = f === 'card' ? altButton('download', 'تنزيل الصورة', downloadCard)
            : f === 'pdf' ? altButton('download', 'تنزيل الملف', openPdf)
                : altButton('copy', 'نسخ الرابط', copyLink);
        statsSlot = f === 'link' ? el('span', { class: 'sh-stats-slot' }) : null;
        replace(actionsHost, [
            el('div', { class: 'sh-acts-row' }, [send, alt, statsSlot]),
            state.copyField,
            el('p', { class: 'sh-note', text: NOTES[f] })
        ]);
        paintStats();
    }

    function altButton(iconName, text, onclick) {
        return el('button', { type: 'button', class: 'btn btn-outline sh-alt', onclick }, [shIcon(iconName), el('span', { text })]);
    }

    function paintStats() {
        if (!statsSlot || !statsSlot.isConnected) return;
        const text = sheetStatsText(state.stats);
        replace(statsSlot, text ? el('a', {
            class: 'sh-stats', href: '#/shares', text,
            onclick: () => { if (location.hash === '#/shares') closeModal(); }
        }) : null);
    }

    // يُسجَّل الإرسال في «مشاركاتي» (لا ينتظره الفعل). رمز تغيّر بين الفتح والإرسال (أبطله المدير): يُقال، ويُعاد الرسم به
    function record(format) {
        settle(supabase.rpc('share_project', { p_project: id, p_format: format })).then((res) => {
            if (res.error) return void fail(res.error, 'لم تُسجَّل هذه المشاركة في «مشاركاتي»');
            if (!res.data || res.data.ok !== true) {
                return void notify('لم تُسجَّل هذه المشاركة: المشروع لم يعد متاحاً للمشاركة.', 'error', 8000);
            }
            if (res.data.code && res.data.code !== state.code) {
                state.code = res.data.code;
                state.card = null;
                state.copyField = null;
                if (body.isConnected) { paintPreview(); paintActions(); prepareCard(); }
                notify('تغيّر رابطك لهذا المشروع، فأعد الإرسال ليصل العميل الرابط الجديد.', 'error', 9000);
            }
            if (typeof options.onShared === 'function') options.onShared(format);
            if (body.isConnected) loadStats();
        });
    }

    function sendWhatsApp() {
        const f = state.format;
        const text = shareMessage(f, state.view, shareLink(base, state.code, f, state.ord));
        if (f === 'card') return void sendCard(text);
        record(f);
        openUrl(waLink(options.phone || null, text));
    }

    function copyLink() {
        const link = shareLink(base, state.code, 'link', state.ord);
        record('link');
        const done = () => notify('نُسخ الرابط. الصقه في محادثة العميل.', 'success');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => showCopyField(link));
        else showCopyField(link);
    }

    // الحافظة ممنوعة (متصفح قديم أو إذن مرفوض): الرابط في حقل محدَّد يُنسخ باليد
    function showCopyField(link) {
        const field = el('input', { class: 'sh-copy-field', type: 'text', readOnly: true, value: link, dir: 'ltr', id: 'shCopyField' });
        state.copyField = el('div', { class: 'sh-copy' }, [el('label', { for: 'shCopyField', text: 'انسخ الرابط من هنا:' }), field]);
        paintActions();
        field.focus();
        field.select();
    }

    function openPdf() {
        record('pdf');
        openUrl(shareLink(base, state.code, 'pdf', state.ord));
    }

    function cardNotReady() {
        notify('البطاقة تتجهّز، أعد الضغط بعد لحظة.', 'info');
        prepareCard();
    }

    function downloadCard() {
        if (!state.card) return void cardNotReady();
        record('card');
        saveBlob(state.card.blob, cardFileName(state.view.name));
        notify('نُزّلت البطاقة.', 'success');
    }

    // الجوال: المشاركة من النظام نفسه (الصورة والرسالة معاً إلى واتساب). الكمبيوتر: تُنزَّل الصورة ويُفتح واتساب بالرسالة
    function sendCard(text) {
        if (!state.card) return void cardNotReady();
        const name = cardFileName(state.view.name);
        const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        if (touch && typeof File === 'function' && navigator.share && navigator.canShare) {
            const file = new File([state.card.blob], name, { type: 'image/png' });
            let can = false;
            try { can = navigator.canShare({ files: [file] }); } catch (_) { can = false; }
            if (can) {
                // من ألغى نافذة المشاركة في الجوال لم يرسل شيئاً، فلا يُحسب في «مشاركاتي»
                navigator.share({ files: [file], text }).then(() => record('card'), (error) => {
                    if (error && error.name === 'AbortError') return;
                    record('card');
                    cardFallback(text, name);
                });
                return;
            }
        }
        record('card');
        cardFallback(text, name);
    }

    function cardFallback(text, name) {
        saveBlob(state.card.blob, name);
        openUrl(waLink(options.phone || null, text));
        notify('نُزّلت البطاقة. أرفقها في محادثة العميل مع الرسالة.', 'info', 8000);
    }

    // تُرسم البطاقة مرة عند الفتح، فتكون جاهزة قبل الضغط
    function prepareCard() {
        if (state.card || state.cardJob || !state.view || !state.code) return;
        const view = state.view;
        const code = state.code;
        state.cardJob = renderCard(view, shareLink(base, code, 'card', state.ord)).then((card) => {
            state.cardJob = null;
            if (state.view !== view || state.code !== code) return void prepareCard();
            card.canvas.className = 'sh-card-canvas';
            card.canvas.setAttribute('role', 'img');
            card.canvas.setAttribute('aria-label', 'بطاقة صورة مربعة لمشروع ' + view.name);
            state.card = card;
            if (state.cardFrame && state.cardFrame.isConnected) replace(state.cardFrame, card.canvas);
        }).catch((error) => {
            state.cardJob = null;
            console.error('[CRM]', error);
            if (state.cardFrame && state.cardFrame.isConnected) {
                replace(state.cardFrame, el('span', { class: 'sh-card-wait', text: 'تعذّر رسم البطاقة في هذا المتصفح. أرسل الرابط بدلها.' }));
            }
        });
    }
}

/* ===================== بطاقة الصورة (1080×1080) ===================== */

const CARD = 1080;
const PAD = 52;
const PHOTO_H = 580;
const FOOT_H = 236;
const QR_BOX = 176;
const FONT_FAMILY = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
const font = (weight, size) => weight + ' ' + size + 'px ' + FONT_FAMILY;

// ألوان v6 النهارية من :root (الوضع الليلي على body وحده، فلا يغيّرها)، وإلا النسخة في share-model
function cardColors() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
        bg: pick('--bg', CARD_COLORS.bg), surface: pick('--surface', CARD_COLORS.surface), hover: pick('--hover', CARD_COLORS.hover),
        ink: pick('--ink', CARD_COLORS.ink), ink2: pick('--ink-2', CARD_COLORS.ink2), muted: pick('--muted', CARD_COLORS.muted),
        line: pick('--line', CARD_COLORS.line), line2: pick('--line-2', CARD_COLORS.line2), brand: pick('--brand', CARD_COLORS.brand)
    };
}

// الخط قبل الرسم، وإلا رُسم النص بخط النظام. لا ينتظر أكثر من ثانيتين ونصف
async function fontsReady() {
    if (!document.fonts || typeof document.fonts.load !== 'function') return;
    const wait = new Promise((resolve) => setTimeout(resolve, 2500));
    const load = Promise.all(['400', '600', '700'].map((w) => document.fonts.load(font(w, 40), 'ملائم 0123'))).catch(() => null);
    await Promise.race([load, wait]);
}

// الصورة بطلب CORS: مصدر يسمح (مخزن الصور) تُرسم ولا تلوّث اللوحة؛ ومصدر يرفض أو صورة لا تُحمَّل = البديل
function loadPhoto(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        const timer = setTimeout(() => resolve(null), 8000);
        img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0 ? img : null); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = url;
    });
}

function toBlob(canvas) {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('تعذّر إنشاء الصورة'))), 'image/png');
        } catch (error) {
            reject(error);
        }
    });
}

// لوحة جديدة في كل محاولة: اللوحة الملوّثة بصورة من مصدر آخر لا تعود نظيفة، فتُعاد الرسمة بلا صورة على لوحة أخرى
async function renderCard(view, link) {
    const colors = cardColors();
    await fontsReady();
    const photo = await loadPhoto(view.images[0]);
    const qr = qrMatrix(link);
    let canvas = paintCard(view, colors, photo, qr);
    try {
        return { canvas, blob: await toBlob(canvas) };
    } catch (error) {
        if (!photo) throw error;
        canvas = paintCard(view, colors, null, qr);
        return { canvas, blob: await toBlob(canvas) };
    }
}

function drawIcon(ctx, name, x, y, size, color) {
    const paths = SH_ICONS[name];
    if (!paths || typeof Path2D !== 'function') return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of paths) ctx.stroke(new Path2D(d));
    ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// الصورة تملأ مساحتها وتُقصّ أطرافها (cover)
function coverImage(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

// بديل الصورة: أبراج هادئة بألوان الخطوط، بلا نص
function placeholder(ctx, c, w, h) {
    ctx.fillStyle = c.line;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.line2;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, h - 92, w, 92);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(300, 228, 104, 260);
    ctx.fillRect(604, 192, 124, 296);
    ctx.globalAlpha = 0.95;
    ctx.fillRect(428, 120, 152, 368);
    ctx.fillRect(464, 92, 80, 28);
    ctx.globalAlpha = 1;
}

function paintCard(view, c, photo, qr) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD;
    canvas.height = CARD;
    const ctx = canvas.getContext('2d');
    // اتجاه النص: direction حيث يدعمه المتصفح، وإلا علامات تضمين يونيكود حول النص
    const directed = 'direction' in ctx;
    const rtl = (text) => (directed ? text : '‫' + text + '‬');
    const ltr = (text) => (directed ? text : '‪' + text + '‬');
    const dir = (value) => { if (directed) ctx.direction = value; };
    const fit = (text, weight, max, min, width) => {
        for (let size = max; size > min; size -= 2) {
            ctx.font = font(weight, size);
            if (ctx.measureText(text).width <= width) return size;
        }
        return min;
    };
    const clip = (text, width) => {
        if (ctx.measureText(rtl(text)).width <= width) return rtl(text);
        const chars = Array.from(text);
        while (chars.length > 1 && ctx.measureText(rtl(chars.join('') + '…')).width > width) chars.pop();
        return rtl(chars.join('').trim() + '…');
    };

    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, CARD, CARD);
    if (photo) coverImage(ctx, photo, 0, 0, CARD, PHOTO_H);
    else placeholder(ctx, c, CARD, PHOTO_H);
    ctx.textBaseline = 'alphabetic';
    dir('rtl');

    const right = CARD - PAD;
    const top = PHOTO_H + 40;
    const s = view.summary;

    // السعر في آخر السطر (يسار): «يبدأ من»، ثم الرقم وبيساره «ر.س»
    let priceW;
    ctx.textAlign = 'left';
    if (s.fromPrice !== null) {
        const amount = money(s.fromPrice);
        ctx.font = font(600, 28);
        const unitW = ctx.measureText(rtl(SAR)).width;
        ctx.font = font(400, 26);
        const labelW = ctx.measureText(rtl(s.priceLabel)).width;
        ctx.fillStyle = c.muted;
        ctx.fillText(rtl(s.priceLabel), PAD, top + 26);
        ctx.font = font(600, 28);
        ctx.fillStyle = c.ink2;
        ctx.fillText(rtl(SAR), PAD, top + 82);
        ctx.font = font(700, 46);
        ctx.fillStyle = c.ink;
        dir('ltr');
        ctx.fillText(ltr(amount), PAD + unitW + 10, top + 82);
        dir('rtl');
        priceW = Math.max(labelW, unitW + 10 + ctx.measureText(ltr(amount)).width);
    } else {
        ctx.font = font(600, 28);
        ctx.fillStyle = c.ink2;
        ctx.fillText(rtl('السعر عند التواصل'), PAD, top + 76);
        priceW = ctx.measureText(rtl('السعر عند التواصل')).width;
    }

    // الاسم والحي في أول السطر (يمين)
    const nameMax = right - PAD - priceW - 40;
    ctx.textAlign = 'right';
    ctx.fillStyle = c.ink;
    ctx.font = font(700, fit(rtl(view.name), 700, 60, 40, nameMax));
    ctx.fillText(clip(view.name, nameMax), right, top + 52);
    if (view.place) {
        drawIcon(ctx, 'pin', right - 30, top + 76, 30, c.muted);
        ctx.font = font(400, 30);
        ctx.fillStyle = c.ink2;
        ctx.fillText(clip(view.place, nameMax - 42), right - 42, top + 102);
    }

    // ثلاث حقائق تحت خط رفيع، من اليمين
    const factsY = PHOTO_H + 182;
    ctx.fillStyle = c.line;
    ctx.fillRect(PAD, factsY, CARD - PAD * 2, 2);
    ctx.font = font(400, 30);
    let x = right;
    for (const fact of cardFacts(view)) {
        const text = rtl(fact.text);
        const w = ctx.measureText(text).width;
        if (x - 46 - w < PAD) break;
        drawIcon(ctx, fact.icon, x - 34, factsY + 24, 34, c.muted);
        ctx.fillStyle = c.ink2;
        ctx.textAlign = 'right';
        ctx.fillText(text, x - 46, factsY + 52);
        x = x - 46 - w - 48;
    }

    // الشريط السفلي: المستشار يميناً، ثم «ملائم العقارية» والرخصة، والرمز يساراً
    const fy = CARD - FOOT_H;
    ctx.fillStyle = c.surface;
    ctx.fillRect(0, fy, CARD, FOOT_H);
    ctx.fillStyle = c.line;
    ctx.fillRect(0, fy, CARD, 2);

    const who = view.consultant;
    const blockMax = 320;
    ctx.textAlign = 'right';
    ctx.font = font(400, 25);
    ctx.fillStyle = c.muted;
    ctx.fillText(rtl('مستشارك العقاري'), right, fy + 70);
    let rightW = ctx.measureText(rtl('مستشارك العقاري')).width;
    ctx.font = font(600, 38);
    ctx.fillStyle = c.ink;
    ctx.font = font(600, fit(rtl(who.name || OFFICE_NAME), 600, 38, 28, blockMax));
    const name = clip(who.name || OFFICE_NAME, blockMax);
    ctx.fillText(name, right, fy + 120);
    rightW = Math.max(rightW, ctx.measureText(name).width);
    if (who.display) {
        drawIcon(ctx, 'phone', right - 30, fy + 142, 30, c.muted);
        ctx.font = font(600, 34);
        dir('ltr');
        ctx.textAlign = 'right';
        ctx.fillText(ltr(who.display), right - 42, fy + 170);
        rightW = Math.max(rightW, 42 + ctx.measureText(ltr(who.display)).width);
        dir('rtl');
    }
    rightW = Math.min(rightW, blockMax);

    const divX = right - rightW - 36;
    ctx.fillStyle = c.line;
    ctx.fillRect(divX, fy + 48, 2, FOOT_H - 96);

    const scanLeft = PAD + QR_BOX + 20;
    ctx.font = font(400, 24);
    const scanW = Math.max(ctx.measureText(rtl('امسح لفتح')).width, ctx.measureText(rtl('الصفحة')).width);
    const midRight = divX - 36;
    const midWidth = midRight - (qr ? scanLeft + scanW + 24 : PAD);
    ctx.textAlign = 'right';
    ctx.fillStyle = c.brand;
    ctx.font = font(700, fit(rtl(OFFICE_NAME), 700, 30, 22, midWidth));
    ctx.fillText(rtl(OFFICE_NAME), midRight, fy + 112);
    if (view.license) {
        const text = rtl('رخصة الإعلان ' + view.license);
        ctx.font = font(400, fit(text, 400, 23, 16, midWidth));
        ctx.fillStyle = c.muted;
        ctx.fillText(text, midRight, fy + 150);
    }

    if (qr) {
        const qy = fy + (FOOT_H - QR_BOX) / 2;
        roundedRect(ctx, PAD, qy, QR_BOX, QR_BOX, 12);
        ctx.fillStyle = c.surface;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.line2;
        ctx.stroke();
        // هامش هادئ من ثلاث وحدات داخل الإطار، والمربعات بأعداد صحيحة لتبقى حادة
        const quiet = 3;
        const cells = qr.size + quiet * 2;
        const cell = Math.max(1, Math.floor((QR_BOX - 4) / cells));
        const off = Math.floor((QR_BOX - cell * cells) / 2) + quiet * cell;
        ctx.fillStyle = c.ink;
        for (let y = 0; y < qr.size; y++) {
            for (let qx = 0; qx < qr.size; qx++) {
                if (qr.modules[y][qx]) ctx.fillRect(PAD + off + qx * cell, qy + off + y * cell, cell, cell);
            }
        }
        ctx.textAlign = 'left';
        ctx.font = font(400, 24);
        ctx.fillStyle = c.muted;
        ctx.fillText(rtl('امسح لفتح'), scanLeft, fy + 112);
        ctx.fillText(rtl('الصفحة'), scanLeft, fy + 146);
    }
    return canvas;
}
