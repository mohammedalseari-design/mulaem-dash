// المسودات المكررة بوضوح في طابور الاعتماد («ارفض المكررات») — بلا DOM وبلا شبكة، فتُختبر وحدها.
//
// الرفض جماعي والاعتماد لا: مدقّق نظيف لا يعني بيانات صحيحة، والمشروع المعتمد يصل للعملاء بروابط المشاركة،
// فالاعتماد يبقى واحداً واحداً. أما رفض مكرر واضح فلا يضيع به شيء. المكرر الواضح مسودة مشروع جديد بانتظار
// الاعتماد:
//   (أ) اسمها الآن بعد التطبيع اسم مشروع قائم غير مرفوض (مرشّح التكرار بالرتبة 1 من agent_find_duplicates) لا يناقضه حيّها؛
//   (ب) أو توأمها بالاسم نفسه (مسودة في طلب آخر تصف العرض نفسه) طُبّق وصار مشروعاً.
// وليس منه: اسم متقارب أو موقع قريب أو حي ونوع (الرتب 2–4)، ولا توأم ربطه الحي والنوع ورقمٌ واحد، ولا توأم ما زال
// معلّقاً (واحدة من الاثنتين تُعتمد)، ولا تعديل على سجل قائم، ولا مسودة لا يقبل الرفض حالتها، ولا مسودة قال مقدّم
// طلبها إنها مشروع آخر بالاسم نفسه. ما يُشكّ فيه يبقى لصفحة الطلب: الخطأ هنا رفضُ عرض حقيقي.

// الرفض من «بانتظار الاعتماد» وحدها (agent_drafts_guard)، كزر الرفض في صفحة الطلب
export const REJECTABLE = 'submitted';

// اختار مقدّم الطلب «أنشئه مشروعاً جديداً رغم تطابق الاسم» (forced_new في agent-run): الاسم مشترك بين مشروعين فعلاً،
// فلا يُحكم من الاسم بتكرار المسودة
const FORCED_NEW = 'forced_new';

function eligible(draft) {
    return Boolean(draft) && draft.status === REJECTABLE && draft.target_kind === 'project' && !present(draft.target_id)
        && !(Array.isArray(draft.conflicts) && draft.conflicts.some((c) => c && c.code === FORCED_NEW));
}

function present(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}

// مكرّرات المسودة كما كتبها فحص التكرار: مرشّحو المشاريع (kind = project) وسطور التوائم (kind = draft). ما تلف يُتجاهل
function entries(draft) {
    return (Array.isArray(draft.duplicates) ? draft.duplicates : []).filter((d) => d && typeof d === 'object');
}

// مشروع ما زال قائماً: غير مرفوض ولا محذوف. projects (حالته الآن: معرّف ← { status, deleted_at }) هي الحكم إن
// أُعطيت، والغائب عنها حُذف. وإلا يُكتفى بما سُجّل مع مرشّح التكرار عند إنشاء المسودة (recorded)
function standing(id, recorded, projects) {
    const now = projects ? projects.get(String(id)) : recorded;
    return Boolean(now) && now.status !== 'rejected' && !now.deleted_at;
}

// الحروف كما يطبّعها agent_norm_name في القاعدة (ترحيل 020): الصغيرة، والهمزات والتاء المربوطة والألف المقصورة
// والأرقام العربية، بلا تشكيل ولا تطويل
function letters(value) {
    return String(value ?? '').toLowerCase()
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[ً-ْـ]/g, '');
}

// agent_norm_name حرفاً بحرف، فبه طابق فحصُ التكرار الاسمين (الرتبة 1): بلا «مشروع/برج/مجمع…» ولا مسافات ولا ترقيم
function normName(value) {
    return letters(value).replace(/(^|\s)(مشروع|مشاريع|ابراج|برج|مجمع|سكني|عمارة|عمائر)(?=\s|$)|[^a-z0-9ء-ي]+/g, '');
}

// الاسم كما يفرّقه agent-run بين مشروعين (nameKey): الكلمة العامة تُحذف قبل الاسم أو بعده، إلا قبل رقم فهي جزء منه —
// «برج 12» و«مجمع 12» عند agent_norm_name اسم واحد («12») وهما مشروعان، فلا تُرفض إحداهما بالأخرى (sameNameProjects)
const FILLER = new Set(['مشروع', 'مشاريع', 'ابراج', 'برج', 'مجمع', 'سكني', 'عماره', 'عمائر']);
function fillerKey(value) {
    const words = letters(value).replace(/ڤ/g, 'ف').replace(/ئ/g, 'ي').replace(/ؤ/g, 'و')
        .split(/[^a-z0-9ء-ي]+/).filter(Boolean).map((word) => word.replace(/(.)ء$/, '$1'));
    const kept = words.filter((word) => !FILLER.has(word));
    return (kept.length && !/^\d/.test(kept[0]) ? kept : words).join(' ');
}
const keepsFiller = (key) => key.split(' ').some((word) => FILLER.has(word));

// الحي للمقارنة: «حي الصفا» = «الحي: الصفا» = «صفا». أبسط من placeKey في agent-run، فإملاءٌ لا يُوفَّق بينه
// («حي الصفا، جدة») يُعدّ حيّاً آخر وتبقى المسودة لصفحة الطلب
function districtKey(value) {
    return letters(value).split(/[^a-z0-9ء-ي]+/)
        .filter((word) => word && !['حي', 'بحي', 'الحي'].includes(word))
        .map((word) => word.replace(/^ال/, '')).filter(Boolean).join(' ');
}

// عنوان إعلان بقي اسماً لأن المسودة بلا حيّ ولا مدينة يُبنى منهما اسم: الاسم الحقيقي تُحذف منه «للبيع/للإيجار» قبل
// حفظه (stripName في agent-run)، فما بقيت فيه عنوانٌ، ومطابقته لمشروع بالعنوان نفسه ليست تكراراً
const SALE = /(^|[^a-z0-9ء-ي])لل(بيع|ايجار|تاجير)(?![a-z0-9ء-ي])/;

// (أ) مرشّح بالرتبة 1 ما زال يصدق الآن: الحارس يُبقي المكرّرات كما سُجّلت وإن عُدّل اسم المسودة بعدها، فاسمها الآن
// يُطبَّع إلى اسمه، وحيّاهما لا يتناقضان (حيٌّ فارغ في أي جهة لا يمنع، كما في sameNameProjects)
function existingProject(draft, projects) {
    const key = normName(draft.name);
    if (!key || SALE.test(letters(draft.name))) return null;
    const mine = districtKey(draft.district);
    const own = fillerKey(draft.name);
    const match = entries(draft).find((d) => {
        if (d.kind !== 'project' || String(d.rank) !== '1' || !present(d.id) || normName(d.name) !== key) return false;
        const other = fillerKey(d.name);
        if (other !== own && (keepsFiller(own) || keepsFiller(other))) return false;
        const theirs = districtKey(d.district);
        return !(mine && theirs && mine !== theirs) && standing(d.id, d, projects);
    });
    if (!match) return null;
    const place = present(match.district) ? ' (' + String(match.district).replace(/\s+/g, ' ').trim() + ')' : '';
    return 'يطابق المشروع #' + match.id + ' «' + match.name + '»' + place;
}

// (ب) سبب الربط «الاسم نفسه» وحده (twinReason في agent-run: اسمان حقيقيان متساويان لا يناقضهما حيّ ولا نوع ولا رقم).
// «الحي والنوع نفساهما والمساحة» يربط فيلّتين مختلفتين على قطعة 300م في حيّ واحد: نظير الرتبة 4، لا يُرفض به
const SAME_NAME = 'الاسم نفسه';

function appliedTwin(draft, twins, projects) {
    if (!twins) return null;
    for (const t of entries(draft)) {
        if (t.kind !== 'draft' || !t.draft_id || t.reason !== SAME_NAME) continue;
        const now = twins.get(t.draft_id);
        if (!now || now.status !== 'applied' || !present(now.applied_record)) continue;
        if (projects && !standing(now.applied_record, null, projects)) continue;
        return 'مسودة مطابقة طُبّقت كمشروع رقم ' + now.applied_record;
    }
    return null;
}

// المكررات الواضحة بترتيب drafts، وسبب قصير لكل مسودة: [{ draft, reason }]. المسودة كما يقرؤها الفحص: اسمها وحيّها
// الآن (name، district) مع conflicts و duplicates.
// twins: حالة التوائم الآن كما تعيدها twinStatuses (معرّف المسودة ← { status, applied_record })، أو null إن تعذّرت
// قراءتها فلا يُحكم بتوأم. projects اختيارية: حالة المشاريع الآن (standing)
export function clearDuplicates(drafts, twins, projects) {
    const out = [];
    for (const draft of Array.isArray(drafts) ? drafts : []) {
        if (!eligible(draft)) continue;
        const reason = existingProject(draft, projects) || appliedTwin(draft, twins, projects);
        if (reason) out.push({ draft, reason });
    }
    return out;
}

// معرّفات المشاريع التي تُقرأ حالتها الآن قبل الحكم: مرشّحو الرتبة 1 ومشاريع التوائم المطبَّقة، لمسودات يقبل الرفض
// حالتها. أرقام فقط (projects.id عدد صحيح) وبلا تكرار
export function projectRefs(drafts, twins) {
    const ids = new Set();
    for (const draft of Array.isArray(drafts) ? drafts : []) {
        if (!eligible(draft)) continue;
        for (const d of entries(draft)) {
            if (d.kind === 'project' && String(d.rank) === '1') ids.add(String(d.id));
            const now = d.kind === 'draft' && d.draft_id && twins ? twins.get(d.draft_id) : null;
            if (now && now.status === 'applied') ids.add(String(now.applied_record));
        }
    }
    return [...ids].filter((id) => /^\d+$/.test(id));
}
