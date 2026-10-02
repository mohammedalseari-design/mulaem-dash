// تقرير تقييم فرز Jev — يقارن نتائج run.mjs بالتسميات الذهبية (والفضية إن وُجدت) ويكتب report.json وreport.md.
//
// بلا شبكة وبلا مكتبات، ولا يقرأ نص الرسائل ولا يكتبه: يكفيه id وregex_kind وsplit من ملف العناصر.
// يرفض أي مسار داخل المستودع (عام)، مدخلاً أو مخرجاً، إلا تحت data/ الذي يتجاهله git.
// قواعد الحكم نسخة من المواصفة §6 (verdict.ts). التقرير يعدّ اختلاف حكم الخادم عن الحكم المعاد حسابه؛
// إن لم يكن صفراً فالعتبات المنشورة غير التي مُرّرت هنا (--th-send وأخواتها) أو تغيّرت القواعد.
// القراءة والتعريفات في scripts/jev-eval/README.md.
//
// التشغيل:
//   node scripts/jev-eval/report.mjs --items items.jsonl --gold gold.jsonl --results <dir> --out <dir>
//        [--silver silver.jsonl [--silver-results <dir>]] [--districts districts.json] [--qset wa-1] [--target 0.95]
//        [--th-send 0.75] [--th-skip 0.75] [--th-city 0.6] [--th-multiple 0.6]

import fs from 'node:fs';
import path from 'node:path';
import { EXIT, Fatal, assertOutsideRepo, idOf, parseArgs, readJsonl } from './run.mjs';

export const INTENTS = ['sale_offer', 'rent_offer', 'status_update', 'wanted', 'not_property', 'other'];
// نسخة من THRESHOLDS في supabase/functions/_shared/jev/verdict.ts (المواصفة §6).
export const THRESHOLDS = Object.freeze({ send: 0.75, skip: 0.75, city: 0.6, multiple: 0.6 });

const SEND_OK = new Set(['sale_offer', 'status_update']);           // «إرسال» صحيح إن كانت النية الذهبية منها
const SKIP_OK = new Set(['not_property', 'wanted', 'rent_offer']);  // «استبعاد» صحيح إن كانت منها
const OUTSIDE = new Set(['makkah', 'madinah', 'riyadh', 'other_city']);
const REGEX_TO_INTENT = new Map([['offer', 'sale_offer'], ['update', 'status_update'], ['wanted', 'wanted'], ['other', 'not_property']]);
const NO_DISTRICT = new Set(['', 'none', 'not_stated']);
const GRID = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map((k) => k / 100);
const SPLITS = ['dev', 'test', 'all'];
const NEVER = 1.01;                 // عتبة لا تبلغها أي ثقة: «لا أتمتة» حين لا تبلغ أي عتبة الدقة المطلوبة
const TOOL = 'jev-eval/report.mjs v1';

const USAGE = `Usage:
  node scripts/jev-eval/report.mjs --items <items.jsonl> --gold <gold.jsonl> --results <dir> --out <dir> [options]

Options:
  --silver <file>          JSONL of known offers ({id, ...}); recall = Jev intent in {sale_offer, status_update}
  --silver-results <dir>   run.mjs output for the silver items (default: --results)
  --districts <file>       districts.json ([{name, aliases}]) to fold aliases when comparing districts
  --qset <name>            report only these question sets (repeatable; default: every <qset>.jsonl found)
  --target <p>             precision the threshold sweep must reach on dev (default 0.95)
  --th-send/--th-skip/--th-city/--th-multiple <p>   verdict thresholds (default spec section 6: 0.75/0.75/0.6/0.6)
Writes <out>/report.json and <out>/report.md. Every path must be outside the repository (or under its git-ignored data/).`;

/* ===================== أدوات ===================== */

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
const choiceOf = (a) => (a && typeof a === 'object' && typeof a.choice === 'string' ? a.choice : null);
const ratio = (k, n) => ({ n, correct: k, accuracy: n ? k / n : null });
const counter = () => Object.create(null);
const bump = (o, k, by = 1) => { o[k] = (o[k] ?? 0) + by; };

function bool(x) {
    if (x === true || x === 'true') return true;
    if (x === false || x === 'false') return false;
    return null;
}

// حدّ ويلسون الأدنى (95 %) لنسبة k من n: الدقة على عينة صغيرة لا تُقرأ بلا هذا الهامش.
export function wilsonLow(k, n, z = 1.96) {
    if (!n) return null;
    const p = k / n, z2 = z * z;
    return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

// المئين بالاستيفاء الخطي بين أقرب رتبتين (طريقة numpy الافتراضية).
export function percentile(values, q) {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

// تطبيع أسماء الأحياء كما في الوظيفة نفسها (normDistrictText في supabase/functions/_shared/jev/districts.ts)،
// فـ«حي المروه» و«- حي حي المروة.» تطابقان «المروة». أي فرق بين التطبيعين يُنقص دقة الحي في التقرير بلا سبب.
export function normDistrict(s) {
    return String(s ?? '')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[\p{Cf}\p{Mn}ـ]/gu, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىی]/g, 'ي')
        .replace(/ک/g, 'ك')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(?:[^\p{L}\p{N}]+|(?:حي|مخطط)(?!\p{L}))+/u, '')
        .replace(/[^\p{L}\p{N}]+$/u, '');
}

// جواب Jev «none» أو «not_stated» (لا مرشح) يقابل ذهبياً «not_stated» أو «other_district» (حي خارج القائمة):
// كلاهما «لا حي من القائمة». غير ذلك يلزم الاسم نفسه بعد التطبيع.
export function districtMatch(pred, gold, canon = normDistrict) {
    if (typeof pred !== 'string' || !gold) return false;
    const g = canon(gold), p = canon(pred);
    const pNone = NO_DISTRICT.has(p) || p === 'other_district';
    if (NO_DISTRICT.has(g) || g === 'other_district') return pNone;
    return !pNone && p === g;
}

function districtGroup(gold, canon) {
    if (!gold) return null;
    const g = canon(gold);
    if (NO_DISTRICT.has(g)) return 'not_stated';
    if (g === 'other_district') return 'other_district';
    return 'has_district';
}

/* ===================== الحكم (المواصفة §6) ===================== */

// p: { intent: {choice, confidence}, city: {choice, confidence}, multiple } أو null عند الخطأ.
export function decide(p, regexKind, th = THRESHOLDS) {
    if (regexKind === 'document') return { verdict: 'review', reasons: ['document_only'] };
    const intent = p && p.intent;
    if (!intent || typeof intent.choice !== 'string') return { verdict: 'review', reasons: ['error'] };
    const conf = num(intent.confidence); // ثقة غائبة = منخفضة
    const atLeast = (t) => conf !== null && conf >= t;
    if ((intent.choice === 'not_property' || intent.choice === 'wanted') && atLeast(th.skip)) {
        return { verdict: 'skip', reasons: [intent.choice] };
    }
    if (intent.choice === 'rent_offer' && atLeast(th.skip)) return { verdict: 'skip', reasons: ['rent'] };
    if (SEND_OK.has(intent.choice) && atLeast(th.send)) {
        const multiple = num(p.multiple);
        if (multiple !== null && multiple >= th.multiple) return { verdict: 'review', reasons: ['multiple'] };
        const cityConf = p.city ? num(p.city.confidence) : null;
        if (p.city && OUTSIDE.has(p.city.choice) && cityConf !== null && cityConf >= th.city) {
            return { verdict: 'review', reasons: ['outside_jeddah'] };
        }
        return { verdict: 'send', reasons: [intent.choice] };
    }
    return { verdict: 'review', reasons: ['low_confidence'] };
}

/* ===================== المدخلات ===================== */

function loadItems(file) {
    const { rows } = readJsonl(file, 'items file');
    const items = new Map(), problems = [];
    for (const { line, value: v } of rows) {
        const id = idOf(v);
        if (!id) { problems.push(`line ${line}: missing id`); continue; }
        if (items.has(id)) { problems.push(`line ${line}: duplicate id`); continue; }
        items.set(id, { regex_kind: str(v.regex_kind) ?? '', split: str(v.split) ?? '' });
    }
    if (problems.length) throw new Fatal(`the items file has ${problems.length} bad line(s):\n  ${problems.slice(0, 10).join('\n  ')}`);
    return items;
}

function loadGold(file) {
    const { rows } = readJsonl(file, 'gold file');
    const gold = new Map(), problems = [];
    let unknownIntent = 0;
    for (const { line, value: v } of rows) {
        const id = idOf(v);
        if (!id) { problems.push(`line ${line}: missing id`); continue; }
        if (gold.has(id)) { problems.push(`line ${line}: duplicate id`); continue; }
        const g = {
            intent: str(v.intent), kind: str(v.kind), city: str(v.city), district: str(v.district),
            multiple: bool(v.multiple), sure: bool(v.sure)
        };
        if (g.intent && !INTENTS.includes(g.intent)) unknownIntent++;
        gold.set(id, g);
    }
    if (problems.length) throw new Fatal(`the gold file has ${problems.length} bad line(s):\n  ${problems.slice(0, 10).join('\n  ')}`);
    return { gold, unknownIntent };
}

function loadSilver(file) {
    const { rows } = readJsonl(file, 'silver file');
    const list = [], seen = new Set();
    let duplicates = 0;
    for (const { line, value: v } of rows) {
        const id = idOf(v);
        if (!id) throw new Fatal(`silver file: line ${line}: missing id`);
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        list.push({ id, regex_kind: str(v.regex_kind), split: str(v.split) });
    }
    return { list, duplicates };
}

function loadDistricts(file) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
        throw new Fatal(`cannot read the districts file (${file}): ${e.code || e.message}`);
    }
    const list = Array.isArray(data) ? data : data && (data.districts || data.JEDDAH_DISTRICTS || data.list);
    if (!Array.isArray(list)) throw new Fatal('districts file: expected [{name, aliases}] or {districts: [...]}');
    const map = new Map();
    for (const d of list) {
        const name = typeof d === 'string' ? d : d?.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const canonical = normDistrict(name);
        map.set(canonical, canonical);
        for (const a of Array.isArray(d?.aliases) ? d.aliases : []) {
            if (typeof a === 'string' && a.trim() && !map.has(normDistrict(a))) map.set(normDistrict(a), canonical);
        }
    }
    return map;
}

// ملفات <qset>.jsonl من run.mjs. لكل عنصر: آخر نتيجة ok إن وُجدت، وإلا آخر نتيجة.
function loadResults(dir, what) {
    let names;
    try {
        names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    } catch (e) {
        throw new Fatal(`cannot read the ${what} folder (${dir}): ${e.code || e.message}`);
    }
    const byQset = new Map();
    let bad = 0;
    for (const name of names) {
        const { rows, bad: b } = readJsonl(path.join(dir, name), `results file ${name}`, { lenient: true });
        bad += b.length;
        for (const { value: r } of rows) {
            if (!r || typeof r !== 'object') continue;
            const qset = typeof r.qset === 'string' ? r.qset : name.replace(/\.jsonl$/, '');
            let q = byQset.get(qset);
            if (!q) byQset.set(qset, (q = { recs: new Map(), batches: [], files: new Set() }));
            q.files.add(name);
            if (r.type === 'item' && typeof r.id === 'string') {
                const prev = q.recs.get(r.id);
                if (!prev || r.ok === true || prev.ok !== true) q.recs.set(r.id, r);
            } else if (r.type === 'batch') {
                q.batches.push(r);
            }
        }
    }
    return { byQset, bad, files: names.length };
}

function probsOf(x) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const out = counter();
    for (const [k, v] of Object.entries(x)) if (num(v) !== null) out[k] = v;
    return Object.keys(out).length ? out : null;
}

export function predFromRecord(rec) {
    if (!rec) return { status: 'missing' };
    const r = rec.result;
    if (rec.ok !== true || !r || typeof r !== 'object' || r.ok !== true) {
        return { status: 'error', error: String(rec.error ?? r?.error ?? 'error') };
    }
    const intent = choiceOf(r.intent)
        ? { choice: r.intent.choice, confidence: num(r.intent.confidence), probabilities: probsOf(r.intent.probabilities) }
        : null;
    const multiple = num(r.multiple) ?? (r.multiple && typeof r.multiple === 'object' ? num(r.multiple.noul) : null);
    return {
        status: intent ? 'answered' : 'no_intent',
        intent,
        kind: choiceOf(r.kind),
        city: choiceOf(r.city) ? { choice: r.city.choice, confidence: num(r.city.confidence) } : null,
        district: choiceOf(r.district),
        multiple,
        verdict: typeof r.verdict === 'string' ? r.verdict : null,
        reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : []
    };
}

// حالة الصف: answered (أجاب Jev) | document (لا نداء لـJev) | error (فشل أو جواب بلا نية) | missing (لا نتيجة).
function rowStatus(p, regexKind) {
    if (p.status === 'missing') return 'missing';
    if (regexKind === 'document') return 'document';
    return p.status === 'answered' ? 'answered' : 'error';
}

function buildRows(gold, items, recs) {
    const rows = [];
    for (const [id, g] of gold) {
        const it = items.get(id);
        if (!it) continue;
        const p = predFromRecord(recs.get(id));
        rows.push({ id, split: it.split, regex_kind: it.regex_kind, gold: g, p, status: rowStatus(p, it.regex_kind) });
    }
    return rows;
}

const forDecide = (r) => (r.p.status === 'answered' ? r.p : null);

// حكم الخادم كما رجع. عنصر فاشل لا حكم له في الصفحة («تعذّر الفرز»)، فهو مراجعة لا أتمتة.
function serverVerdict(r) {
    if (r.p.status === 'missing') return null;
    if (r.p.status === 'error') return 'review';
    return r.p.verdict;
}

/* ===================== المقاييس ===================== */

function fieldAccuracy(answered, cx) {
    const t = { intent: [0, 0], kind: [0, 0], city: [0, 0], district: [0, 0], multiple: [0, 0] };
    const add = (f, ok) => { t[f][1]++; if (ok) t[f][0]++; };
    for (const r of answered) {
        const g = r.gold, p = r.p;
        if (g.intent) add('intent', p.intent.choice === g.intent);
        if (g.kind) add('kind', p.kind === g.kind);
        if (g.city) add('city', !!p.city && p.city.choice === g.city);
        if (g.district) add('district', districtMatch(p.district, g.district, cx.canon));
        if (g.multiple !== null) add('multiple', p.multiple !== null && (p.multiple >= 0.5) === g.multiple);
    }
    return Object.fromEntries(Object.entries(t).map(([f, [k, n]]) => [f, ratio(k, n)]));
}

function multipleAt(answered, threshold) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const r of answered) {
        if (r.gold.multiple === null || r.p.multiple === null) continue;
        const pred = r.p.multiple >= threshold, g = r.gold.multiple;
        if (pred && g) tp++;
        else if (pred) fp++;
        else if (g) fn++;
        else tn++;
    }
    return { threshold, tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

function bySure(answered) {
    const b = { sure: [0, 0], unsure: [0, 0], missing: [0, 0] };
    for (const r of answered) {
        if (!r.gold.intent) continue;
        const k = r.gold.sure === true ? 'sure' : r.gold.sure === false ? 'unsure' : 'missing';
        b[k][1]++;
        if (r.p.intent.choice === r.gold.intent) b[k][0]++;
    }
    return { sure: ratio(...b.sure), unsure: ratio(...b.unsure), missing: ratio(...b.missing) };
}

function districtGroups(answered, cx) {
    const g = { has_district: [0, 0], not_stated: [0, 0], other_district: [0, 0] };
    for (const r of answered) {
        const grp = districtGroup(r.gold.district, cx.canon);
        if (!grp) continue;
        g[grp][1]++;
        if (districtMatch(r.p.district, r.gold.district, cx.canon)) g[grp][0]++;
    }
    return Object.fromEntries(Object.entries(g).map(([k, [c, n]]) => [k, ratio(c, n)]));
}

function confusion(answered) {
    const rows = answered.filter((r) => r.gold.intent);
    const labels = [...INTENTS];
    for (const r of rows) for (const l of [r.gold.intent, r.p.intent.choice]) if (!labels.includes(l)) labels.push(l);
    const matrix = counter();
    for (const g of labels) {
        matrix[g] = counter();
        for (const p of labels) matrix[g][p] = 0;
    }
    for (const r of rows) matrix[r.gold.intent][r.p.intent.choice]++;
    const per_label = labels.map((l) => {
        const gold = labels.reduce((s, p) => s + matrix[l][p], 0);
        const predicted = labels.reduce((s, g) => s + matrix[g][l], 0);
        const correct = matrix[l][l];
        return { label: l, gold, predicted, correct, recall: gold ? correct / gold : null, precision: predicted ? correct / predicted : null };
    });
    return { rows_are: 'gold', columns_are: 'jev', labels, matrix, per_label, n: rows.length };
}

function coverage(answered) {
    const rows = answered.filter((r) => r.gold.intent);
    const point = (t) => {
        const cov = rows.filter((r) => t === 0 || (r.p.intent.confidence !== null && r.p.intent.confidence >= t));
        const correct = cov.filter((r) => r.p.intent.choice === r.gold.intent).length;
        return { t, n: cov.length, coverage: rows.length ? cov.length / rows.length : null, correct, accuracy: cov.length ? correct / cov.length : null };
    };
    return [point(0), ...GRID.map(point)];
}

// احتمال الخيار المختار؛ إن غابت الاحتمالات يُستنتج من الثقة بعكس (n·p − 1)/(n − 1).
function pMaxOf(intent) {
    const probs = intent.probabilities;
    if (probs) {
        const own = num(probs[intent.choice]);
        if (own !== null) return { value: own, derived: false };
        return { value: Math.max(...Object.values(probs)), derived: false };
    }
    if (intent.confidence !== null) {
        const n = INTENTS.length;
        return { value: (intent.confidence * (n - 1) + 1) / n, derived: true };
    }
    return null;
}

function calibration(answered, bins = 10) {
    const rows = answered.filter((r) => r.gold.intent);
    const b = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sum: 0, correct: 0 }));
    let derived = 0, excluded = 0;
    for (const r of rows) {
        const pm = pMaxOf(r.p.intent);
        if (!pm) { excluded++; continue; }
        if (pm.derived) derived++;
        const x = b[Math.min(bins - 1, Math.max(0, Math.floor(pm.value * bins)))];
        x.n++;
        x.sum += pm.value;
        if (r.p.intent.choice === r.gold.intent) x.correct++;
    }
    const used = b.reduce((s, x) => s + x.n, 0);
    let ece = 0;
    const table = b.map((x) => {
        const mean = x.n ? x.sum / x.n : null, acc = x.n ? x.correct / x.n : null;
        if (x.n) ece += (x.n / used) * Math.abs(acc - mean);
        return { lo: x.lo, hi: x.hi, n: x.n, correct: x.correct, mean_p: mean, accuracy: acc, gap: x.n ? acc - mean : null };
    });
    return { bins, n: used, ece: used ? ece : null, derived_from_confidence: derived, excluded_no_probability: excluded, table };
}

const strictOk = (g) => (!g.city || g.city === 'jeddah' || g.city === 'not_stated') && g.multiple !== true;

function verdictStats(rows, th, withServer = false) {
    const pop = rows.filter((r) => r.status !== 'missing' && r.gold.intent);
    const counts = { send: 0, review: 0, skip: 0 }, reasons = counter();
    let sendOk = 0, sendStrictOk = 0, skipOk = 0, mismatch = 0, serverMissing = 0;
    const wrongSends = [], skippedOffers = [];
    for (const r of pop) {
        const d = decide(forDecide(r), r.regex_kind, th);
        counts[d.verdict]++;
        for (const x of d.reasons) bump(reasons, x);
        const gi = r.gold.intent;
        if (d.verdict === 'send') {
            if (SEND_OK.has(gi)) {
                sendOk++;
                if (strictOk(r.gold)) sendStrictOk++;
            } else {
                wrongSends.push(r.id);
            }
        } else if (d.verdict === 'skip') {
            if (SKIP_OK.has(gi)) skipOk++;
            if (SEND_OK.has(gi)) skippedOffers.push(r.id);
        }
        if (withServer) {
            const sv = serverVerdict(r);
            if (sv === null) serverMissing++;
            else if (sv !== d.verdict) mismatch++;
        }
    }
    const n = pop.length;
    const out = {
        thresholds: { ...th },
        n,
        counts,
        reasons,
        send_correct: sendOk,
        send_precision: counts.send ? sendOk / counts.send : null,
        send_precision_lo95: wilsonLow(sendOk, counts.send),
        send_precision_strict: counts.send ? sendStrictOk / counts.send : null,
        skip_correct: skipOk,
        skip_precision: counts.skip ? skipOk / counts.skip : null,
        skip_precision_lo95: wilsonLow(skipOk, counts.skip),
        automated: n ? (counts.send + counts.skip) / n : null,
        offers_skipped: skippedOffers.length,
        wrong_sends: wrongSends.length,
        ids: { wrong_sends: wrongSends.slice(0, 200), skipped_offers: skippedOffers.slice(0, 200) }
    };
    if (withServer) Object.assign(out, { server_mismatch: mismatch, server_missing: serverMissing });
    return out;
}

// أعلى تغطية تحقق الدقة المطلوبة؛ عند التعادل الأعلى عتبة (المجموعة نفسها على dev، وأحذر على الجديد).
function pick(points) {
    const ok = points.filter((x) => x.meets);
    if (!ok.length) return null;
    const best = Math.max(...ok.map((x) => x.n));
    return Math.max(...ok.filter((x) => x.n === best).map((x) => x.t));
}

// عتبة send لا تمسّ إلا نيات الإرسال وعتبة skip لا تمسّ إلا نيات الاستبعاد، فيُمسح كل منهما وحده بلا تقريب.
function sweep(rows, cx) {
    const dev = rows.filter((r) => r.split === 'dev'), test = rows.filter((r) => r.split === 'test');
    const devPop = dev.filter((r) => r.status !== 'missing' && r.gold.intent);
    const point = (t, action, okSet) => {
        const th = { ...cx.th, [action]: t };
        let n = 0, correct = 0;
        for (const r of devPop) {
            if (decide(forDecide(r), r.regex_kind, th).verdict !== action) continue;
            n++;
            if (okSet.has(r.gold.intent)) correct++;
        }
        const precision = n ? correct / n : null;
        return {
            t, n, correct, precision, lo95: wilsonLow(correct, n),
            share: devPop.length ? n / devPop.length : null, meets: precision !== null && precision >= cx.target
        };
    };
    const send = GRID.map((t) => point(t, 'send', SEND_OK));
    const skip = GRID.map((t) => point(t, 'skip', SKIP_OK));
    const recommended = { send: pick(send), skip: pick(skip) };
    const thRec = { ...cx.th, send: recommended.send ?? NEVER, skip: recommended.skip ?? NEVER };
    const strip = (v) => { const { ids: _ids, ...rest } = v; return rest; };
    return {
        target: cx.target,
        dev_items: devPop.length,
        send,
        skip,
        recommended,
        note: recommended.send === null || recommended.skip === null
            ? 'no grid threshold reaches the target on dev for the action marked null: keep it on review (threshold off)'
            : null,
        at_recommended: { dev: strip(verdictStats(dev, thRec)), test: strip(verdictStats(test, thRec)) },
        at_default: { dev: strip(verdictStats(dev, cx.th)), test: strip(verdictStats(test, cx.th)) }
    };
}

function regexBaseline(answered) {
    const rows = answered.filter((r) => r.gold.intent && REGEX_TO_INTENT.has(r.regex_kind));
    let regex = 0, jev = 0, both = 0, onlyJev = 0, onlyRegex = 0, neither = 0;
    for (const r of rows) {
        const a = REGEX_TO_INTENT.get(r.regex_kind) === r.gold.intent, b = r.p.intent.choice === r.gold.intent;
        if (a) regex++;
        if (b) jev++;
        if (a && b) both++;
        else if (b) onlyJev++;
        else if (a) onlyRegex++;
        else neither++;
    }
    return {
        mapping: Object.fromEntries(REGEX_TO_INTENT),
        n: rows.length,
        excluded_unmapped_kind: answered.filter((r) => r.gold.intent && !REGEX_TO_INTENT.has(r.regex_kind)).length,
        regex: ratio(regex, rows.length),
        jev: ratio(jev, rows.length),
        both_correct: both, only_jev: onlyJev, only_regex: onlyRegex, both_wrong: neither
    };
}

function evaluateSplit(rows, cx) {
    const withResult = rows.filter((r) => r.status !== 'missing');
    const answered = rows.filter((r) => r.status === 'answered');
    return {
        population: {
            gold: rows.length,
            with_result: withResult.length,
            answered: answered.length,
            documents: rows.filter((r) => r.status === 'document').length,
            errors: rows.filter((r) => r.status === 'error').length,
            missing: rows.length - withResult.length
        },
        accuracy: fieldAccuracy(answered, cx),
        multiple_at_threshold: multipleAt(answered, cx.th.multiple),
        intent_by_sure: bySure(answered),
        district: districtGroups(answered, cx),
        regex_baseline: regexBaseline(answered),
        confusion: confusion(answered),
        coverage: coverage(answered),
        calibration: calibration(answered),
        verdicts: verdictStats(withResult, cx.th, true)
    };
}

function silverStats(silver, items, recs, cx) {
    const rows = silver.list.map((s) => {
        const it = items.get(s.id);
        const regexKind = s.regex_kind ?? it?.regex_kind ?? '';
        const p = predFromRecord(recs?.get(s.id));
        return { id: s.id, regex_kind: regexKind, split: s.split ?? it?.split ?? '', p, status: rowStatus(p, regexKind) };
    });
    const one = (rs) => {
        const withResult = rs.filter((r) => r.status !== 'missing');
        const answered = rs.filter((r) => r.status === 'answered');
        const hit = (r) => SEND_OK.has(r.p.intent.choice);
        const recalled = answered.filter(hit).length;
        const verdicts = { send: 0, review: 0, skip: 0 };
        for (const r of withResult) verdicts[decide(forDecide(r), r.regex_kind, cx.th).verdict]++;
        const byKind = counter();
        for (const r of answered) {
            const k = r.regex_kind || '(none)';
            byKind[k] ??= { answered: 0, recalled: 0, recall: null };
            byKind[k].answered++;
            if (hit(r)) byKind[k].recalled++;
        }
        for (const v of Object.values(byKind)) v.recall = v.answered ? v.recalled / v.answered : null;
        return {
            n: rs.length,
            with_result: withResult.length,
            answered: answered.length,
            documents: rs.filter((r) => r.status === 'document').length,
            errors: rs.filter((r) => r.status === 'error').length,
            missing: rs.length - withResult.length,
            recalled,
            recall: answered.length ? recalled / answered.length : null,
            recall_lo95: wilsonLow(recalled, answered.length),
            verdicts,
            skipped_share: withResult.length ? verdicts.skip / withResult.length : null,
            by_regex_kind: byKind,
            ids_missed: answered.filter((r) => !hit(r)).map((r) => r.id).slice(0, 200)
        };
    };
    return Object.fromEntries(SPLITS.map((s) => [s, one(s === 'all' ? rows : rows.filter((r) => r.split === s))]));
}

// زمن الدفعة يقيسه run.mjs حول النداء كله؛ زمن العنصر = زمن دفعته ÷ عدد عناصرها (الخادم يعالجها متوازية).
function costStats(batches) {
    const ok = batches.filter((b) => b.status === 'success');
    const batchMs = ok.map((b) => num(b.latency_ms)).filter((x) => x !== null);
    const itemMs = [];
    let items = 0, calls = 0, tokens = 0, cost = 0, costKnown = 0;
    for (const b of ok) {
        const n = num(b.n) ?? 0, u = b.usage && typeof b.usage === 'object' ? b.usage : {};
        items += n;
        if (num(b.latency_ms) !== null && n) for (let i = 0; i < n; i++) itemMs.push(b.latency_ms / n);
        calls += num(u.jev_calls) ?? 0;
        tokens += num(u.input_tokens) ?? 0;
        if (num(u.cost_usd) !== null) { cost += u.cost_usd; costKnown++; }
    }
    return {
        calls_ok: ok.length,
        calls_failed: batches.filter((b) => b.status === 'failed').length,
        calls_stopped: batches.filter((b) => b.status === 'stopped').length,
        calls_retried: batches.filter((b) => (num(b.attempts) ?? 1) > 1).length,
        items,
        jev_calls: calls,
        input_tokens: tokens,
        cost_usd: cost,
        cost_reported_calls: costKnown,
        latency_batch_ms: { n: batchMs.length, p50: percentile(batchMs, 0.5), p95: percentile(batchMs, 0.95) },
        latency_item_ms: { n: itemMs.length, p50: percentile(itemMs, 0.5), p95: percentile(itemMs, 0.95) },
        input_tokens_per_jev_call: calls ? tokens / calls : null,
        input_tokens_per_item: items ? tokens / items : null,
        usd_per_jev_call: calls ? cost / calls : null,
        usd_per_item: items ? cost / items : null,
        models: [...new Set(ok.map((b) => b.model).filter((m) => typeof m === 'string'))]
    };
}

/* ===================== Markdown ===================== */

const pct = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(1)}%`);
const f3 = (x) => (x === null || x === undefined ? '—' : x.toFixed(3));
const acc = (r) => (r && r.n ? `${pct(r.accuracy)} (${r.correct}/${r.n})` : '—');
const frac = (k, n) => (n ? `${pct(k / n)} (${k}/${n})` : '—');
const thr = (x) => (x === null || x === undefined ? 'none' : x > 1 ? 'off' : x.toFixed(2));
const ms = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)} ms`);
const usd = (x) => (x === null || x === undefined ? '—' : `$${Number(x.toPrecision(4))}`);

function table(head, rows) {
    const esc = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    return [
        `| ${head.map(esc).join(' | ')} |`,
        `|${head.map(() => '---').join('|')}|`,
        ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)
    ].join('\n');
}

const precCell = (v, kind) => frac(v[`${kind}_correct`], v.counts[kind]);

function verdictRow(label, v) {
    return [label, v.n, v.counts.send, precCell(v, 'send'), v.counts.skip, precCell(v, 'skip'), pct(v.automated), v.offers_skipped];
}

function renderQset(L, name, q, rep) {
    const S = q.splits;
    L.push(`## qset \`${name}\``, '');
    L.push(`Results: ${q.results} item record(s) in ${q.files.map((f) => `\`${f}\``).join(', ')}`
        + `${q.cost.models.length ? ` · model: ${q.cost.models.map((m) => `\`${m}\``).join(', ')}` : ''}.`, '');

    L.push('### Population', '');
    L.push(table(['split', 'gold items', 'with result', 'answered', 'documents (no Jev call)', 'errors', 'missing'],
        SPLITS.map((s) => { const p = S[s].population; return [s, p.gold, p.with_result, p.answered, p.documents, p.errors, p.missing]; })), '');

    L.push('### Field accuracy (answered items)', '');
    L.push(table(['field', 'dev', 'test', 'all'],
        ['intent', 'kind', 'city', 'district', 'multiple'].map((f) => [f, ...SPLITS.map((s) => acc(S[s].accuracy[f]))])));
    const m = S.all.multiple_at_threshold;
    L.push('', `\`multiple\` counts P(yes) ≥ 0.5 as yes. At the verdict threshold ${m.threshold} (all): `
        + `precision ${pct(m.precision)}, recall ${pct(m.recall)} (tp ${m.tp}, fp ${m.fp}, fn ${m.fn}, tn ${m.tn}).`, '');

    L.push('### Intent accuracy by gold `sure`', '');
    L.push(table(['gold sure', 'dev', 'test', 'all'],
        [['true', 'sure'], ['false', 'unsure'], ['missing', 'missing']]
            .filter(([, k]) => SPLITS.some((s) => S[s].intent_by_sure[k].n))
            .map(([label, k]) => [label, ...SPLITS.map((s) => acc(S[s].intent_by_sure[k]))])), '');

    L.push('### District accuracy', '');
    L.push(table(['gold district', 'dev', 'test', 'all'], [
        ['has a district (canonical name)', 'has_district'], ['not_stated', 'not_stated'], ['other_district (not in the list)', 'other_district']
    ].map(([label, k]) => [label, ...SPLITS.map((s) => acc(S[s].district[k]))])));
    L.push('', 'Jev `none` / code `not_stated` count as right for gold `not_stated` and `other_district`.', '');

    L.push('### Regex baseline on the same items', '');
    L.push('offer→sale_offer, update→status_update, wanted→wanted, other→not_property; `document` excluded.', '');
    L.push(table(['split', 'items', 'regex', 'Jev', 'both right', 'only Jev right', 'only regex right', 'both wrong'],
        SPLITS.map((s) => { const b = S[s].regex_baseline; return [s, b.n, acc(b.regex), acc(b.jev), b.both_correct, b.only_jev, b.only_regex, b.both_wrong]; })), '');

    for (const s of SPLITS) {
        const c = S[s].confusion;
        if (!c.n) continue;
        L.push(`### Intent confusion — ${s} (rows: gold, columns: Jev)`, '');
        const rows = c.labels.map((g) => {
            const pl = c.per_label.find((x) => x.label === g);
            return [g, ...c.labels.map((p) => c.matrix[g][p] || ''), pl.gold, pct(pl.recall)];
        });
        rows.push(['precision', ...c.labels.map((l) => pct(c.per_label.find((x) => x.label === l).precision)), c.n, '']);
        L.push(table(['gold \\ Jev', ...c.labels, 'total', 'recall'], rows), '');
    }

    L.push('### Coverage vs accuracy (intent confidence ≥ t)', '');
    L.push(table(['t', 'dev coverage', 'dev accuracy', 'test coverage', 'test accuracy', 'all coverage', 'all accuracy'],
        S.all.coverage.map((pt, i) => [pt.t === 0 ? 'none' : pt.t.toFixed(2),
            ...SPLITS.flatMap((s) => { const x = S[s].coverage[i]; return [frac(x.n, S[s].coverage[0].n), acc({ n: x.n, correct: x.correct, accuracy: x.accuracy })]; })])));
    L.push('', 'Coverage = share of answered items at or above t; accuracy = intent accuracy among them.', '');

    L.push('### Calibration (intent p_max, 10 bins)', '');
    L.push(`ECE: ${SPLITS.map((s) => `${s} ${f3(S[s].calibration.ece)} (n=${S[s].calibration.n})`).join(' · ')}.`
        + (S.all.calibration.derived_from_confidence ? ` p_max derived from confidence for ${S.all.calibration.derived_from_confidence} item(s).` : ''), '');
    L.push('Reliability (all):', '');
    L.push(table(['p_max bin', 'n', 'mean p_max', 'accuracy', 'gap (accuracy − p)'],
        S.all.calibration.table.filter((b) => b.n).map((b) => [`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`, b.n, f3(b.mean_p), f3(b.accuracy), f3(b.gap)])), '');

    const th = rep.thresholds;
    L.push(`### Verdicts at the default thresholds (send ${th.send}, skip ${th.skip}, city ${th.city}, multiple ${th.multiple})`, '');
    L.push(table(['split', 'n', 'send', 'review', 'skip', 'send precision', 'send precision (strict)', 'skip precision', 'automated', 'offers skipped', 'server ≠ recomputed'],
        SPLITS.map((s) => {
            const v = S[s].verdicts;
            return [s, v.n, v.counts.send, v.counts.review, v.counts.skip, precCell(v, 'send'), pct(v.send_precision_strict),
                precCell(v, 'skip'), pct(v.automated), v.offers_skipped, `${v.server_mismatch}${v.server_missing ? ` (+${v.server_missing} without verdict)` : ''}`];
        })));
    L.push('', 'Send is right when gold intent ∈ {sale_offer, status_update}; strict also needs gold city jeddah/not_stated and not multiple. '
        + 'Skip is right when gold ∈ {not_property, wanted, rent_offer}. Offers skipped = gold sale_offer/status_update that got skip.', '');
    const reasons = [...new Set(SPLITS.flatMap((s) => Object.keys(S[s].verdicts.reasons)))].sort();
    if (reasons.length) {
        L.push(table(['reason', 'dev', 'test', 'all'], reasons.map((x) => [x, ...SPLITS.map((s) => S[s].verdicts.reasons[x] ?? 0)])), '');
    }

    const w = q.sweep;
    L.push(`### Threshold sweep (dev → test, precision ≥ ${w.target})`, '');
    if (!w.dev_items) {
        L.push('No dev items with results: nothing to sweep.', '');
    } else {
        for (const [label, list] of [['Send', w.send], ['Skip', w.skip]]) {
            L.push(`${label} threshold on dev (${w.dev_items} items):`, '');
            L.push(table(['t', label === 'Send' ? 'sends' : 'skips', 'precision', 'lower 95%', 'share of dev', `≥ ${w.target}`],
                list.map((x) => [x.t.toFixed(2), x.n, frac(x.correct, x.n), pct(x.lo95), pct(x.share), x.meets ? 'yes' : ''])), '');
        }
        L.push(`Recommended: send **${thr(w.recommended.send)}**, skip **${thr(w.recommended.skip)}**${w.note ? ` (${w.note})` : ''}.`, '');
        const ar = w.at_recommended, ad = w.at_default;
        L.push(table(['applied to', 'send t', 'skip t', 'n', 'send', 'send precision', 'skip', 'skip precision', 'automated', 'offers skipped'], [
            ['dev @ recommended', ar.dev], ['test @ recommended', ar.test], ['dev @ default', ad.dev], ['test @ default', ad.test]
        ].map(([label, v]) => { const r = verdictRow(label, v); return [r[0], thr(v.thresholds.send), thr(v.thresholds.skip), ...r.slice(1)]; })), '');
    }

    if (q.silver) {
        L.push('### Silver recall (Jev intent ∈ {sale_offer, status_update})', '');
        const sv = q.silver;
        if (!sv.all.with_result) {
            L.push('No silver results for this qset.', '');
        } else {
            L.push(table(['split', 'silver items', 'answered', 'recall', 'lower 95%', 'send', 'review', 'skip', 'documents', 'errors', 'missing'],
                SPLITS.filter((s) => sv[s].n).map((s) => {
                    const x = sv[s];
                    return [s, x.n, x.answered, frac(x.recalled, x.answered), pct(x.recall_lo95), x.verdicts.send, x.verdicts.review, x.verdicts.skip, x.documents, x.errors, x.missing];
                })), '');
            const kinds = Object.entries(sv.all.by_regex_kind);
            if (kinds.length) {
                L.push('By regex kind (all) — `other` = offers the regex hid:', '');
                L.push(table(['regex kind', 'answered', 'recalled', 'recall'], kinds.map(([k, v]) => [k, v.answered, v.recalled, pct(v.recall)])), '');
            }
        }
    }

    const c = q.cost;
    L.push('### Latency and cost', '');
    L.push(table(['metric', 'value'], [
        ['calls ok / failed / stopped', `${c.calls_ok} / ${c.calls_failed} / ${c.calls_stopped}`],
        ['calls that needed the retry', c.calls_retried],
        ['latency per call p50 / p95', `${ms(c.latency_batch_ms.p50)} / ${ms(c.latency_batch_ms.p95)}`],
        ['latency per item p50 / p95 (call ÷ items)', `${ms(c.latency_item_ms.p50)} / ${ms(c.latency_item_ms.p95)}`],
        ['items in ok calls / Jev calls', `${c.items} / ${c.jev_calls}`],
        ['input tokens per Jev call / per item (documents included)', `${c.input_tokens_per_jev_call === null ? '—' : Math.round(c.input_tokens_per_jev_call)}`
            + ` / ${c.input_tokens_per_item === null ? '—' : Math.round(c.input_tokens_per_item)}`],
        ['USD per Jev call', usd(c.usd_per_jev_call)],
        ['USD per item (documents included)', usd(c.usd_per_item)],
        ['total input tokens / USD', `${c.input_tokens} / ${usd(c.cost_usd)}`]
    ]), '');
}

function renderMd(rep) {
    const L = [];
    const th = rep.thresholds, inp = rep.inputs;
    L.push('# Jev triage evaluation', '');
    L.push(`Generated ${rep.generated_at} by \`scripts/jev-eval/report.mjs\`.`, '');
    L.push(`- Items: \`${inp.items_file}\` (${inp.items}) · gold: \`${inp.gold_file}\` (${inp.gold} labels`
        + `${inp.gold_without_item ? `, ${inp.gold_without_item} without an item` : ''}`
        + `${inp.gold_unknown_intent ? `, ${inp.gold_unknown_intent} with an unknown intent key` : ''}) · results: \`${inp.results_dir}\``);
    if (inp.silver_file) L.push(`- Silver: \`${inp.silver_file}\` (${inp.silver}) · silver results: \`${inp.silver_results_dir}\``);
    L.push(`- Verdict rules: spec §6 with send ${th.send} · skip ${th.skip} · city ${th.city} · multiple ${th.multiple}. `
        + `Sweep target: precision ≥ ${rep.target} on dev.`);
    L.push('- Accuracy counts only items Jev answered: regex `document` items get no Jev call; errors are counted apart.');
    if (inp.unreadable_result_lines) L.push(`- ${inp.unreadable_result_lines} unreadable line(s) in the results were ignored.`);
    L.push('');

    const names = Object.keys(rep.qsets);
    // الملخص على test؛ إن لم يكن في الملفات split فعلى الكل.
    const sum = names.some((n) => rep.qsets[n].splits.test.population.answered) ? 'test' : 'all';
    L.push('## Summary', '', `Accuracy on the ${sum} split${sum === 'test' ? ' (dev and all per qset below)' : ' (no test items found)'}:`, '');
    L.push(table(['qset', 'answered', 'intent', 'kind', 'city', 'district', 'multiple', 'regex (same items)', 'ECE'],
        names.map((n) => {
            const s = rep.qsets[n].splits[sum];
            return [n, s.population.answered, ...['intent', 'kind', 'city', 'district', 'multiple'].map((f) => acc(s.accuracy[f])), acc(s.regex_baseline.regex), f3(s.calibration.ece)];
        })), '');
    L.push('Verdicts (send/skip precision, share automated):', '');
    L.push(table(['qset', 'applied to', 'send t', 'skip t', 'n', 'send', 'send precision', 'skip', 'skip precision', 'automated', 'offers skipped'],
        names.flatMap((n) => {
            const w = rep.qsets[n].sweep;
            return [['test @ default', w.at_default.test], ['dev @ recommended', w.at_recommended.dev], ['test @ recommended', w.at_recommended.test]]
                .map(([label, v]) => { const r = verdictRow(label, v); return [n, r[0], thr(v.thresholds.send), thr(v.thresholds.skip), ...r.slice(1)]; });
        })), '');

    for (const n of names) renderQset(L, n, rep.qsets[n], rep);

    L.push('## Definitions', '');
    L.push('- **answered**: Jev returned an intent. Documents (regex `document`) never reach Jev; errors are failed or empty results.');
    L.push('- **coverage at t**: share of answered items whose intent confidence is ≥ t (missing confidence counts as low).');
    L.push('- **ECE**: Σ over bins of (bin share) × |accuracy − mean p_max|, 10 equal bins of the chosen intent\'s probability.');
    L.push('- **automated**: (send + skip) ÷ items with a result, documents and errors included (they are always review).');
    L.push('- **lower 95%**: Wilson lower bound of the precision; small samples can show 100% with a low bound.');
    L.push('- **sweep**: for each grid t, verdicts are recomputed with only that threshold changed; the recommended t has the most automated '
        + 'items on dev with precision ≥ target (ties → the higher t), then the pair is applied unchanged to test.');
    L.push('');
    return L.join('\n');
}

/* ===================== التشغيل ===================== */

const FLAGS = {
    items: 'string', gold: 'string', results: 'string', out: 'string', silver: 'string', 'silver-results': 'string',
    districts: 'string', qset: 'list', target: 'number', 'th-send': 'number', 'th-skip': 'number', 'th-city': 'number',
    'th-multiple': 'number', help: 'bool'
};

function main(argv) {
    const args = parseArgs(argv, FLAGS);
    if (args.help) { console.log(USAGE); return EXIT.OK; }
    for (const k of ['items', 'gold', 'results', 'out']) if (!args[k]) throw new Fatal(`--${k} is required\n\n${USAGE}`);
    // المدخلات فيها نصوص واتساب حقيقية أو تسمياتها: لا تُقرأ من المستودع العام، كما لا يُكتب التقرير فيه
    for (const [k, what] of [['out', 'the --out folder'], ['items', 'the items file'], ['gold', 'the gold file'],
        ['results', 'the --results folder'], ['silver', 'the silver file'], ['silver-results', 'the --silver-results folder'],
        ['districts', 'the districts file']]) {
        if (args[k]) assertOutsideRepo(args[k], what);
    }
    const th = {
        send: args['th-send'] ?? THRESHOLDS.send, skip: args['th-skip'] ?? THRESHOLDS.skip,
        city: args['th-city'] ?? THRESHOLDS.city, multiple: args['th-multiple'] ?? THRESHOLDS.multiple
    };
    for (const [k, v] of Object.entries(th)) if (!(v >= 0 && v <= 1)) throw new Fatal(`--th-${k} must be between 0 and 1`);
    const target = args.target ?? 0.95;
    if (!(target > 0 && target <= 1)) throw new Fatal('--target must be above 0 and at most 1');

    const items = loadItems(args.items);
    const { gold, unknownIntent } = loadGold(args.gold);
    const results = loadResults(args.results, '--results');
    const silver = args.silver ? loadSilver(args.silver) : null;
    const silverResults = silver ? (args['silver-results'] ? loadResults(args['silver-results'], '--silver-results') : results) : null;
    const aliases = args.districts ? loadDistricts(args.districts) : null;
    const canon = (s) => { const n = normDistrict(s); return aliases?.get(n) ?? n; };
    const cx = { th, target, canon };

    let qsets = [...results.byQset.keys()].sort();
    if (args.qset?.length) {
        for (const q of args.qset) if (!results.byQset.has(q)) console.error(`warning: no results for qset ${q}`);
        qsets = qsets.filter((q) => args.qset.includes(q));
    }
    if (!qsets.length) throw new Fatal(`no results found in ${args.results} (expected <qset>.jsonl files from run.mjs)`);

    const report = {
        generated_at: new Date().toISOString(),
        tool: TOOL,
        inputs: {
            items_file: path.basename(args.items), items: items.size,
            gold_file: path.basename(args.gold), gold: gold.size,
            gold_without_item: [...gold.keys()].filter((id) => !items.has(id)).length,
            gold_unknown_intent: unknownIntent,
            results_dir: path.basename(path.resolve(args.results)),
            unreadable_result_lines: results.bad + (silverResults && silverResults !== results ? silverResults.bad : 0),
            silver_file: silver ? path.basename(args.silver) : null,
            silver: silver ? silver.list.length : null,
            silver_results_dir: silver ? path.basename(path.resolve(args['silver-results'] ?? args.results)) : null,
            districts_file: args.districts ? path.basename(args.districts) : null
        },
        thresholds: th,
        target,
        qsets: {}
    };
    for (const q of qsets) {
        const data = results.byQset.get(q);
        const rows = buildRows(gold, items, data.recs);
        report.qsets[q] = {
            files: [...data.files],
            results: data.recs.size,
            results_without_gold: [...data.recs.keys()].filter((id) => !gold.has(id)).length,
            splits: Object.fromEntries(SPLITS.map((s) => [s, evaluateSplit(s === 'all' ? rows : rows.filter((r) => r.split === s), cx)])),
            sweep: sweep(rows, cx),
            silver: silver ? silverStats(silver, items, silverResults.byQset.get(q)?.recs, cx) : null,
            cost: costStats(data.batches)
        };
    }

    fs.mkdirSync(args.out, { recursive: true });
    const jsonPath = path.join(args.out, 'report.json'), mdPath = path.join(args.out, 'report.md');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, renderMd(report), 'utf8');
    const sum = qsets.some((q) => report.qsets[q].splits.test.population.answered) ? 'test' : 'all';
    for (const q of qsets) {
        const r = report.qsets[q], t = r.splits[sum], w = r.sweep;
        console.log(`[${q}] ${sum}: intent ${acc(t.accuracy.intent)} · regex ${acc(t.regex_baseline.regex)} · send precision `
            + `${pct(t.verdicts.send_precision)} · skip precision ${pct(t.verdicts.skip_precision)} · automated ${pct(t.verdicts.automated)} · `
            + `recommended send ${thr(w.recommended.send)} / skip ${thr(w.recommended.skip)}`);
    }
    console.log(`wrote ${jsonPath}\nwrote ${mdPath}`);
    return EXIT.OK;
}

if (import.meta.main ?? process.argv[1]?.toLowerCase().endsWith('report.mjs')) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(e instanceof Fatal ? `error: ${e.message}` : e?.stack || e);
        process.exitCode = e instanceof Fatal ? e.code : EXIT.INPUT;
    }
}
