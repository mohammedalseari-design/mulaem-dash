// العمولة بالنسبة (037): قراءة النسبة كما يكتبها المدير، ونصها، ومن أين جاءت عمولة الوحدة. دوال صافية بلا DOM ولا شبكة،
// فتُختبر وحدها (tests/commission-rate.test.mjs). الحساب الحقيقي في القاعدة (v_units)؛ هذا للمعاينة والنص فقط.

const DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

const round2 = (n) => Math.round(n * 100) / 100;

// «2.5» و«٢٫٥» و«2,5» و«2.5%» و«٢٫٥٪». فارغ = null، وما ليس نسبة بين 0 و100 = NaN (الحقل يقول «اكتب نسبة»).
export function parseRate(text) {
    if (text === null || text === undefined) return null;
    let s = String(text).trim();
    if (!s) return null;
    s = s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]).replace(/[٫,]/g, '.').replace(/[%٪\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
    return round2(n);
}

// 3 → «3٪»، 2.5 → «2.5٪»، 2.75 → «2.75٪»
export function formatRate(rate) {
    const n = Number(rate);
    if (rate === null || rate === undefined || rate === '' || !Number.isFinite(n)) return '';
    return String(round2(n)) + '٪';
}

// عمولة سعر بنسبة، مقرّبة لهللتين كما تقرّبها القاعدة
export function commissionAt(price, rate) {
    const p = Number(price), r = Number(rate);
    if (!(p > 0) || !Number.isFinite(r) || r < 0) return null;
    return round2((p * r) / 100);
}

// السطر الصغير بجانب المبلغ: «3٪ المشروع» أو «2.5٪ العامة» أو «مبلغ محدد»
export function sourceText(source, rate) {
    if (source === 'override') return 'مبلغ محدد';
    if (source === 'project') return formatRate(rate) + ' المشروع';
    if (source === 'default') return formatRate(rate) + ' العامة';
    return '';
}

// ما يُرسل إلى set_unit_commission لنموذج واحد: undefined = لا تغيير، null = امسح المبلغ المحدد، رقم = احفظه.
// before: المبلغ المحدد الحالي (null إن لم يوجد)، text: ما في الحقل الآن.
export function overrideChange(before, text, parseAmount) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    const now = raw === '' ? null : parseAmount(raw);
    if (raw !== '' && (now === null || !Number.isFinite(now) || now < 0 || now > 100000000)) return NaN;
    const was = before === null || before === undefined ? null : round2(Number(before));
    const next = now === null ? null : round2(now);
    return was === next ? undefined : next;
}
