import { supabase } from './supabase.js';
import { el, replace, notify, fail, parseNumber } from './ui.js';

const PROJECT_FIELDS = ['project_ref', 'name', 'type', 'city', 'district', 'address', 'purpose', 'availability', 'construction_status', 'price', 'area', 'rooms', 'units_count', 'buildings_count', 'developer', 'contact_phone', 'contact_email', 'contact_url', 'source_url', 'brochure_url', 'image_url', 'latitude', 'longitude', 'notes'];
const UNIT_FIELDS = ['project_ref', 'unit_ref', 'unit_type', 'rooms', 'bathrooms', 'area', 'price', 'commission', 'status', 'count', 'developer'];

function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
        else if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && text[i + 1] === '\n') i += 1;
            row.push(cell.trim()); cell = '';
            if (row.some(Boolean)) rows.push(row);
            row = [];
        } else cell += ch;
    }
    if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map((value) => value.trim().toLowerCase());
    return rows.map((values, index) => {
        const result = { _row: index + 2 };
        headers.forEach((header, column) => { if (header) result[header] = (values[column] || '').trim(); });
        return result;
    });
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve([]);
        const reader = new FileReader();
        reader.onload = () => { try { resolve(parseCsv(String(reader.result || ''))); } catch (error) { reject(error); } };
        reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
        reader.readAsText(file, 'UTF-8');
    });
}

function cleanStatus(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['available', 'متاح', 'متاحة'].includes(normalized)) return 'available';
    if (['sold', 'مباع', 'مباعة'].includes(normalized)) return 'sold';
    if (['reserved', 'محجوز', 'محجوزة'].includes(normalized)) return 'reserved';
    return fallback;
}

function cleanPurpose(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['rent', 'إيجار', 'للايجار', 'للإيجار'].includes(normalized) ? 'rent' : 'sale';
}

function cleanDate(value) {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizedProject(value) {
    return String(value || '').toLowerCase()
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/مشروع|مشاريع|كيان|الغزالي|شركة|التطوير|العقارية/g, '')
        .replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
}

function projectCodeKey(project) {
    const match = String(project.name || '').match(/(?:^|\D)(\d{2,4})(?:\D|$)/);
    if (!match) return '';
    return [match[1], project.city, project.district].map(normalizedProject).join('|');
}

function validate(rows, kind) {
    const required = kind === 'projects'
        ? ['project_ref', 'name', 'type']
        : ['project_ref', 'unit_ref', 'unit_type'];
    const seen = new Set();
    return rows.map((row) => {
        const errors = [];
        required.forEach((key) => { if (!row[key]) errors.push('ناقص: ' + key); });
        const key = kind === 'projects' ? row.project_ref : row.project_ref + '|' + row.unit_ref;
        if (key && seen.has(key)) errors.push('تكرار داخل الملف');
        if (key) seen.add(key);
        ['price', 'area', 'rooms', 'bathrooms', 'commission', 'count', 'latitude', 'longitude'].forEach((field) => {
            if (!row[field]) return;
            const value = parseNumber(row[field]);
            if (value === null || value < 0) errors.push('قيمة رقمية غير صالحة: ' + field);
        });
        return Object.assign({}, row, { _errors: errors });
    });
}

function fileField(label, accept, onChange) {
    const input = el('input', { type: 'file', accept, onchange: onChange });
    return el('div', { class: 'crm-import-file' }, [el('strong', { text: label }), input, el('small', { class: 'crm-subtle', text: 'UTF-8 CSV' })]);
}

function preview(title, rows, fields) {
    const box = el('div', { class: 'crm-import-preview' });
    box.appendChild(el('h3', { text: title + ' (' + rows.length + ')' }));
    if (!rows.length) { box.appendChild(el('div', { class: 'crm-subtle', text: 'لم يتم اختيار بيانات' })); return box; }
    const table = el('table', { class: 'crm-table crm-import-table' });
    const head = el('tr');
    ['السطر', ...fields.slice(0, 6), 'النتيجة'].forEach((label) => head.appendChild(el('th', { text: label })));
    table.appendChild(el('thead', {}, head));
    const body = el('tbody');
    rows.slice(0, 8).forEach((row) => {
        const tr = el('tr');
        [row._row, ...fields.slice(0, 6).map((field) => row[field] || '—'), row._errors.length ? row._errors.join('، ') : 'جاهز'].forEach((value) => tr.appendChild(el('td', { text: value })));
        body.appendChild(tr);
    });
    table.appendChild(body); box.appendChild(table);
    if (rows.length > 8) box.appendChild(el('small', { class: 'crm-subtle', text: 'تظهر أول 8 سجلات فقط في المعاينة.' }));
    return box;
}

export async function renderImports(root) {
    let projects = [], units = [];
    const previewBox = el('div');
    const status = el('div', { class: 'crm-subtle', text: 'لم يتم اختيار ملفات بعد.' });
    const approve = el('button', { type: 'button', class: 'btn btn-primary', text: 'إرسال للاعتماد', disabled: true });
    const updateExisting = el('input', { type: 'checkbox', checked: true, disabled: true });
    const updateExistingLabel = el('label', { class: 'chip' }, [updateExisting, 'تحديث الموجود تلقائيًا؛ المطابق لا يدخل الاعتماد']);
    const projectInput = fileField('ملف المشاريع', '.csv,text/csv', async (event) => {
        try { projects = validate(await readFile(event.target.files[0]), 'projects'); refresh(); } catch (error) { fail(error, 'تعذر قراءة ملف المشاريع'); }
    });
    const unitInput = fileField('ملف الوحدات (اختياري)', '.csv,text/csv', async (event) => {
        try { units = validate(await readFile(event.target.files[0]), 'units'); refresh(); } catch (error) { fail(error, 'تعذر قراءة ملف الوحدات'); }
    });
    function refresh() {
        const errors = [...projects, ...units].filter((row) => row._errors.length).length;
        status.textContent = 'مشاريع: ' + projects.length + ' | وحدات: ' + units.length + ' | أخطاء: ' + errors;
        approve.disabled = !projects.length || errors > 0;
        replace(previewBox, [preview('معاينة المشاريع', projects, PROJECT_FIELDS), preview('معاينة الوحدات', units, UNIT_FIELDS)]);
    }
    approve.addEventListener('click', async () => {
        approve.disabled = true; approve.textContent = 'جارٍ الحفظ…';
        try {
            const existing = await supabase.from('projects').select('id,name,city,district,address,availability,price,area,rooms,notes,images,details');
            if (existing.error) throw existing.error;
            const byRef = new Map((existing.data || []).map((row) => [row.details && row.details.import_ref, row]));
            const byNaturalKey = new Map((existing.data || []).map((row) => [
                [row.name, row.city, row.district].map((value) => String(value || '').trim().toLowerCase()).join('|'), row
            ]));
            const byCode = new Map();
            for (const row of existing.data || []) {
                const key = projectCodeKey(row);
                if (!key) continue;
                const list = byCode.get(key) || [];
                list.push(row); byCode.set(key, list);
            }
            const naturalKeys = new Set(byNaturalKey.keys());
            const projectRefs = new Set(projects.map((row) => row.project_ref));
            const saved = new Map();
            // ما طابق سجلاً قائماً حُدِّث في مكانه؛ لا يُدرج مرة ثانية (كان يُنشئ نسخة مكررة معلّقة).
            const matchedRefs = new Set();
            for (const ref of new Set(units.map((row) => row.project_ref))) {
                if (!projectRefs.has(ref) && !byRef.has(ref)) throw new Error('الوحدات تشير إلى مشروع غير موجود: ' + ref);
            }
            for (const row of projects) {
                const naturalKey = [row.name, row.city, row.district].map((value) => String(value || '').trim().toLowerCase()).join('|');
                const codeMatches = byCode.get(projectCodeKey(row)) || [];
                const existingRow = byRef.get(row.project_ref) || byNaturalKey.get(naturalKey)
                    || (codeMatches.length === 1 ? codeMatches[0] : null);
                // أي تطابق مؤكد يحدّث السجل الأصلي مباشرة؛ لا ننشئ طلب اعتماد ثانيًا.
                if (existingRow) {
                    const currentDetails = existingRow.details || {};
                    const enrichment = Object.assign({}, currentDetails, {
                        developer: row.developer || currentDetails.developer || null,
                        construction_status: row.construction_status || currentDetails.construction_status || null,
                        units_count: parseNumber(row.units_count) || currentDetails.units_count || null,
                        buildings_count: parseNumber(row.buildings_count) || currentDetails.buildings_count || null,
                        contact_phone: row.contact_phone || currentDetails.contact_phone || null,
                        contact_email: row.contact_email || currentDetails.contact_email || null,
                        contact_url: row.contact_url || currentDetails.contact_url || null,
                        source_url: row.source_url || currentDetails.source_url || null,
                        brochure_url: row.brochure_url || currentDetails.brochure_url || null,
                        image_url: row.image_url || currentDetails.image_url || null,
                        description: row.description || currentDetails.description || null,
                        import_source: row.notes || currentDetails.import_source || null,
                        import_ref: row.project_ref || currentDetails.import_ref || null
                    });
                    const patch = {
                        details: enrichment,
                        city: row.city || existingRow.city || null,
                        district: row.district || existingRow.district || null,
                        address: row.address || existingRow.address || null,
                        purpose: row.purpose ? cleanPurpose(row.purpose) : existingRow.purpose,
                        availability: row.availability === 'sold_out' ? 'sold_out' : (existingRow.availability || 'available'),
                        price: row.price ? parseNumber(row.price) : existingRow.price,
                        area: row.area ? parseNumber(row.area) : existingRow.area,
                        rooms: row.rooms ? parseNumber(row.rooms) : existingRow.rooms,
                        notes: row.notes || existingRow.notes || null
                    };
                    if (row.price === '0') patch.price = null;
                    if (row.image_url) patch.images = row.image_url.split(';').map((url) => url.trim()).filter(Boolean);
                    if (row.source_url && !existingRow.notes) patch.notes = 'المصدر: ' + row.source_url;
                    const updated = await supabase.from('projects').update(patch).eq('id', existingRow.id);
                    if (updated.error) throw updated.error;
                    saved.set(row.project_ref, existingRow.id);
                    matchedRefs.add(row.project_ref);
                    continue;
                }
                if (byRef.has(row.project_ref)) throw new Error('المشروع مكرر في النظام: ' + row.project_ref);
                if (naturalKeys.has(naturalKey)) throw new Error('المشروع مكرر بالاسم والموقع: ' + row.name);
                naturalKeys.add(naturalKey);
            }
            for (const row of projects) {
                if (matchedRefs.has(row.project_ref)) continue;
                const details = {
                    import_ref: row.project_ref,
                    developer: row.developer || null,
                    construction_status: row.construction_status || null,
                    units_count: parseNumber(row.units_count),
                    buildings_count: parseNumber(row.buildings_count),
                    contact_phone: row.contact_phone || null,
                    contact_email: row.contact_email || null,
                    contact_url: row.contact_url || null,
                    source_url: row.source_url || null,
                    brochure_url: row.brochure_url || null,
                    image_url: row.image_url || null,
                    description: row.description || null,
                    models: []
                };
                const inserted = await supabase.from('projects').insert({
                    name: row.name, type: row.type, city: row.city || null, district: row.district || null, address: row.address || null,
                    purpose: cleanPurpose(row.purpose), availability: row.availability === 'sold_out' ? 'sold_out' : 'available', status: 'pending',
                    price: parseNumber(row.price), area: parseNumber(row.area), rooms: parseNumber(row.rooms), rega_ad_license: row.rega_ad_license || null,
                    listing_expires_at: cleanDate(row.listing_expires_at), latitude: parseNumber(row.latitude), longitude: parseNumber(row.longitude),
                    notes: row.notes || null,
                    images: row.image_url ? row.image_url.split(';').map((url) => url.trim()).filter(Boolean) : [],
                    details
                }).select('id').single();
                if (inserted.error) throw inserted.error;
                const pending = await supabase.from('projects').update({ status: 'pending' }).eq('id', inserted.data.id);
                if (pending.error) throw pending.error;
                saved.set(row.project_ref, inserted.data.id);
            }
            for (const group of new Set(units.map((row) => row.project_ref))) {
                const projectId = saved.get(group) || byRef.get(group)?.id;
                if (!projectId) throw new Error('الوحدات تشير إلى مشروع غير موجود: ' + group);
                const current = projects.find((row) => row.project_ref === group);
                // التفاصيل الحالية تُقرأ من القاعدة وتُكمَّل فقط: كتابة كائن جديد مكانها كانت تمسح
                // حقولاً مثل حالة الإنشاء ورابط الصورة وكل ما أُدخل يدوياً في اللوحة.
                const fresh = await supabase.from('projects').select('details').eq('id', projectId).maybeSingle();
                if (fresh.error) throw fresh.error;
                const details = Object.assign({}, (fresh.data && fresh.data.details) || {});
                if (current) {
                    const fromFile = {
                        import_ref: current.project_ref,
                        developer: current.developer,
                        units_count: parseNumber(current.units_count),
                        buildings_count: parseNumber(current.buildings_count),
                        contact_phone: current.contact_phone,
                        contact_email: current.contact_email,
                        contact_url: current.contact_url,
                        source_url: current.source_url,
                        brochure_url: current.brochure_url,
                        description: current.description
                    };
                    for (const key of Object.keys(fromFile)) {
                        const value = fromFile[key];
                        if (value !== null && value !== undefined && value !== '') details[key] = value;
                    }
                }
                details.models = units.filter((row) => row.project_ref === group).map((row) => ({
                    name: row.unit_ref, type: row.unit_type, rooms: parseNumber(row.rooms) || 0, bathrooms: parseNumber(row.bathrooms) || 0,
                    area: parseNumber(row.area) || 0, price: parseNumber(row.price) || 0, commission: parseNumber(row.commission) || 0,
                    status: cleanStatus(row.status, 'available'), count: parseNumber(row.count) || 1, developer: row.developer || null
                }));
                const updated = await supabase.from('projects').update({ details: details }).eq('id', projectId).select('id');
                if (updated.error) throw updated.error;
                if (!updated.data || !updated.data.length) throw new Error('لا تملك صلاحية تعديل المشروع ' + group);
            }
            notify('تم إرسال ' + saved.size + ' مشروع إلى طلبات الاعتماد.', 'success', 8000);
            status.textContent = 'تم الإرسال للمراجعة. يمكنك رفع ملف جديد.';
            projects = []; units = []; refresh();
        } catch (error) { fail(error, 'تعذر اعتماد الاستيراد'); }
        approve.disabled = false; approve.textContent = 'إرسال للاعتماد';
    });
    replace(root, el('div', { class: 'crm-card crm-import-page' }, [
        el('div', { class: 'crm-card-head' }, [el('div', {}, [el('h1', { text: 'استيراد المشاريع' }), el('p', { class: 'crm-subtle', text: 'ارفع المشاريع والوحدات مرة واحدة، راجع الأخطاء، ثم اعتمد الحفظ.' })])]),
        el('div', { class: 'crm-import-files' }, [projectInput, unitInput]), updateExistingLabel, status, previewBox,
        el('div', { class: 'crm-actions' }, [approve])
    ]));
}