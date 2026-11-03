// لوحة الوحدات في صفحة العقار (‎#/project/:id‎): حساب صافٍ بلا DOM ولا شبكة، يُختبر وحده في tests/units-board.test.mjs.
//
// v_units تعطي النموذج حالة واحدة («محجوزة» حتى تُحجز كل وحداته، ثم «مباعة» حين تُباع كلها)، واللوحة تحتاج القسمة:
// مربع لكل وحدة بلونها. القسمة هنا بقاعدة v_units نفسها في 030_unit_holds.sql، حتى لا تختلف اللوحة عن «العقارات»
// والمطابقة وصفحة المشاريع:
//   • الحالة اليدوية (ما كتبه الموظف في النموذج) إن لم تكن «متاحة» تغطي النموذج كله.
//   • وإلا فحجوزات الصفقات (unit_holds: «محجوزة» عند «عربون» و«عقد وإفراغ»، «مباعة» عند «تمت») تُطابق باسم الوحدة
//     حرفياً كما يطابقها العرض (unit_key، وبلا اسم لصف «كامل العقار»)، والباقي متاح. حجوزات أكثر من عدد الوحدات
//     لا تنزل بالمتاح تحت الصفر، والمباع لا يتجاوز العدد.
// وزيادة على v_units: عقار «نفد بالكامل» (projects.availability) لا يبقى فيه متاح ولو بقيت نماذجه «متاحة»، لأن
// «العقارات» والمطابقة تستبعدانه أصلاً (availability = 'available'). ومثله العقار المحذوف (deleted_at): خارج المخزون
// ولا تُفتح عليه صفقات. فاللوحة لا تُري وحدة خضراء ولا «يبدأ من» لما لا يُعرض في مكان آخر.

const num = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

// عدد وحدات النموذج كما في v_units (count، وإلا 1). لا يقل عن وحدة: نموذج كُتب عدده 0 يبقى وحدة كما تعامله صفحة المشاريع
export function unitTotal(count) {
    const n = Math.floor(Number(count));
    return Number.isFinite(n) && n >= 1 ? n : 1;
}

// لون المربع: «متاحة» و«محجوزة» بلونيهما، وكل حالة أخرى (مباعة، نفدت بالكامل، أو قيمة لا تُعرف) خارج البيع = رمادي
export function kindOf(status) {
    if (status === 'available') return 'available';
    if (status === 'reserved') return 'reserved';
    return 'sold';
}

// الحجوزات بحسب اسم الوحدة كما يجمعها v_units: held كل حجوزات الاسم، و sold المباعة منها. null مفتاح «كامل العقار»
export function holdTally(holds) {
    const map = new Map();
    for (const hold of holds || []) {
        if (!hold) continue;
        const key = hold.unit_key === null || hold.unit_key === undefined ? null : String(hold.unit_key);
        const tally = map.get(key) || { held: 0, sold: 0 };
        tally.held += 1;
        if (hold.status === 'sold') tally.sold += 1;
        map.set(key, tally);
    }
    return map;
}

// الحالة اليدوية لصف من v_units: details.models[ord-1].status للنموذج (فارغة = متاحة، كما في v_units)، و
// projects.availability لصف «كامل العقار» (ord 0). عقار غير «متاح» يغطي نماذجه كلها، والمحذوف ('deleted') مثله.
// null حين لا تُعرف (تغيّرت النماذج بين قراءة العقار وقراءة وحداته)، فتُستنتج من حالة v_units (inferManual).
export function manualStatus(project, ord) {
    const p = project || {};
    const availability = p.deleted_at ? 'deleted'
        : p.availability === null || p.availability === undefined || p.availability === '' ? 'available' : String(p.availability);
    const n = Number(ord);
    if (n === 0) return availability;
    if (availability !== 'available') return availability;
    const models = p.details && typeof p.details === 'object' && Array.isArray(p.details.models) ? p.details.models : null;
    if (!models || !Number.isInteger(n) || n < 1 || n > models.length) return null;
    const model = models[n - 1];
    const status = model && typeof model === 'object' && !Array.isArray(model) ? model.status : null;
    return status === null || status === undefined || status === '' ? 'available' : String(status);
}

// الحالة اليدوية مستنتجة من حالة v_units المجمّعة: «متاحة» تعني يدوية متاحة. وغيرها يفسّره الحجز إن غطّى كل الوحدات وأعطى
// الحالة نفسها (فاليدوية متاحة)، وإلا فهي يدوية تغطي النموذج. الالتباس الوحيد: «محجوزة» يدوياً ونموذج محجوز كله بصفقات
// بعضها مباع؛ الاستنتاج يأخذ الصفقات، والمتاح صفر في الحالين.
export function inferManual(combined, total, held = 0, sold = 0) {
    if (combined === null || combined === undefined || combined === '' || combined === 'available') return 'available';
    const t = unitTotal(total);
    const h = Math.max(0, Number(held) || 0);
    const s = Math.max(0, Number(sold) || 0);
    if (h >= t && (s >= t ? 'sold' : 'reserved') === combined) return 'available';
    return String(combined);
}

// قسمة نموذج واحد: { total, available, reserved, sold }. held كل حجوزات اسمه، و sold المباعة منها
export function splitUnits(total, manual, held = 0, sold = 0) {
    const t = unitTotal(total);
    const status = manual === null || manual === undefined || manual === '' ? 'available' : String(manual);
    if (status !== 'available') {
        const reserved = kindOf(status) === 'reserved';
        return { total: t, available: 0, reserved: reserved ? t : 0, sold: reserved ? 0 : t };
    }
    const h = Math.max(0, Math.floor(Number(held) || 0));
    const s = Math.min(Math.max(0, Math.floor(Number(sold) || 0)), h);
    const available = Math.max(t - h, 0);
    const soldCount = Math.min(s, t);
    return { total: t, available, reserved: t - available - soldCount, sold: soldCount };
}

// حالة النموذج كله كما تكتبها v_units: متاح ما بقيت وحدة، ومباع حين تُباع كلها، ومحجوز فيما بينهما
export function statusOf(split) {
    if (!split || split.available > 0) return 'available';
    return split.sold >= split.total ? 'sold' : 'reserved';
}

// نموذج بعدد كبير يُرسم في هذا العدد من المربعات بالنسبة نفسها، والعدد الدقيق في النص بجانبه
export const MAX_CELLS = 100;

// المربعات بترتيب الامتلاء: المباع ثم المحجوز ثم المتاح، فتأتي المتاحة آخر الصف بجانب «متاح N من M».
// أكثر من max وحدة: تُصغَّر الأعداد إلى max بأكبر الباقي، وكل فئة فيها وحدة تبقى مربعاً على الأقل.
export function cellsOf(split, max = MAX_CELLS) {
    const kinds = ['sold', 'reserved', 'available'];
    let counts = kinds.map((kind) => Math.max(0, Math.floor(Number(split && split[kind]) || 0)));
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > max) counts = scaleCounts(counts, max);
    const cells = [];
    kinds.forEach((kind, i) => { for (let j = 0; j < counts[i]; j++) cells.push(kind); });
    return cells;
}

function scaleCounts(counts, max) {
    const total = counts.reduce((a, b) => a + b, 0);
    const exact = counts.map((n) => (n * max) / total);
    const out = exact.map((x) => Math.floor(x));
    let left = max - out.reduce((a, b) => a + b, 0);
    const byRemainder = exact.map((x, i) => i).sort((a, b) => (exact[b] - out[b]) - (exact[a] - out[a]) || a - b);
    for (const i of byRemainder) {
        if (left <= 0) break;
        out[i] += 1;
        left -= 1;
    }
    for (let i = 0; i < out.length; i++) {
        if (counts[i] === 0 || out[i] > 0) continue;
        let largest = 0;
        for (let k = 1; k < out.length; k++) if (out[k] > out[largest]) largest = k;
        out[largest] -= 1;
        out[i] = 1;
    }
    return out;
}

// صفوف اللوحة بترتيب unit_ord: صف لكل صف من v_units (النماذج، أو «كامل العقار» حين لا نماذج) بقسمته ومربعاته.
// units: صفوف v_units للعقار، holds: صفوف unit_holds له، project: صفه من projects (availability و deleted_at و details.models).
export function buildBoard(units, holds, project) {
    const tally = holdTally(holds);
    return (units || [])
        .filter((u) => u && u.unit_ord !== null && u.unit_ord !== undefined && Number.isFinite(Number(u.unit_ord)))
        .sort((a, b) => Number(a.unit_ord) - Number(b.unit_ord))
        .map((u) => {
            const ord = Number(u.unit_ord);
            const name = u.unit_key === null || u.unit_key === undefined ? null : String(u.unit_key);
            // مفتاح المطابقة كما في v_units: اسم النموذج، و null لصف «كامل العقار»
            const hold = tally.get(ord === 0 ? null : name) || { held: 0, sold: 0 };
            const total = unitTotal(u.unit_count);
            const known = manualStatus(project, ord);
            const manual = known === null ? inferManual(u.unit_status, total, hold.held, hold.sold) : known;
            const split = splitUnits(total, manual, hold.held, hold.sold);
            return {
                ord, key: name, type: u.unit_type || null,
                rooms: num(u.rooms), bathrooms: num(u.bathrooms), area: num(u.area), price: num(u.price),
                commission: num(u.unit_commission),
                manual,
                total: split.total, available: split.available, reserved: split.reserved, sold: split.sold,
                status: statusOf(split),
                cells: cellsOf(split)
            };
        });
}

// أرقام الشريط أعلى الصفحة: مجموع الوحدات وأقسامها، وأقل سعر ومدى العمولة بين النماذج التي فيها وحدة متاحة.
// سعر صفر أو بلا سعر لا يُحسب «يبدأ من»، والعمولة null (لا سعر ولا مبلغ محدد، أو مخفية) لا تدخل المدى.
export function boardSummary(rows) {
    const list = rows || [];
    const sum = (key) => list.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const open = list.filter((row) => row.available > 0);
    const prices = open.map((row) => row.price).filter((price) => price !== null && price !== undefined && price > 0);
    const commissions = open.map((row) => row.commission).filter((c) => c !== null && c !== undefined && c >= 0);
    return {
        models: list.length,
        total: sum('total'),
        available: sum('available'),
        reserved: sum('reserved'),
        sold: sum('sold'),
        fromPrice: prices.length ? Math.min(...prices) : null,
        commission: commissions.length ? { min: Math.min(...commissions), max: Math.max(...commissions) } : null
    };
}

// النموذج المختار عند فتح الصفحة: أول نموذج فيه وحدة متاحة، وإلا الأول، وبلا صفوف null
export function defaultOrd(rows) {
    const list = rows || [];
    const open = list.find((row) => row.available > 0);
    if (open) return open.ord;
    return list.length ? list[0].ord : null;
}

// «متاح 3 من 8» لنموذج بعدة وحدات، والوحدة الواحدة بكلمة: «متاح» أو «محجوز» أو «مباع». fmt ينسّق الأرقام
export function availabilityText(row, fmt = String) {
    if (!row) return '';
    if (row.total === 1) return row.available > 0 ? 'متاح' : row.reserved > 0 ? 'محجوز' : 'مباع';
    return 'متاح ' + fmt(row.available) + ' من ' + fmt(row.total);
}

// ما خرج من البيع في النموذج: «محجوز 2 · مباع 3»، بلا الأقسام الفارغة
export function takenText(row, fmt = String) {
    if (!row) return '';
    const parts = [];
    if (row.reserved > 0) parts.push('محجوز ' + fmt(row.reserved));
    if (row.sold > 0) parts.push('مباع ' + fmt(row.sold));
    return parts.join(' · ');
}
