// اختبار أدوات التقييم بلا شبكة ولا مفاتيح حقيقية: خادم محلي يحاكي عقد wa-triage (المواصفة §7) بإجابات ثابتة،
// ثم run.mjs ثم report.mjs كعمليات منفصلة، ثم مقارنة أرقام التقرير بحساب يدوي مكتوب في التعليقات.
// بيانات مصطنعة فقط (لا أرقام هواتف ولا أسماء أشخاص ولا مشاريع حقيقية). يكتب في مجلد مؤقت ويحذفه في النهاية
// (JEV_EVAL_KEEP=1 يبقيه للاطلاع).
// التشغيل: node scripts/jev-eval/mock-test.mjs

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, districtMatch, normDistrict, percentile, wilsonLow } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RUN = path.join(HERE, 'run.mjs');
const REPORT = path.join(HERE, 'report.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-eval-test-'));

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const near = (a, b, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= eps;
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== البيانات المصطنعة ===================== */

const GROUP = 'مجموعة اختبار';
const ITEMS = [
    { id: 's01', split: 'dev', regex_kind: 'offer', text: 'شقة للبيع في حي الروضة بجدة، 4 غرف، السعر 850 ألف' },
    { id: 's02', split: 'dev', regex_kind: 'update', text: 'تحديث: تم بيع شقتين والمتبقي 3 شقق بالسعر نفسه' },
    { id: 's03', split: 'dev', regex_kind: 'offer', text: 'فيلا دوبلكس في الصفا بجدة، المساحة 400 متر، السعر على السوم' },
    { id: 's04', split: 'dev', regex_kind: 'wanted', text: 'مطلوب فيلا في أبحر الشمالية بجدة لعميل جاهز' },
    { id: 's05', split: 'dev', regex_kind: 'offer', text: 'متوسط سعر المتر في السوق ارتفع هذا الشهر' },
    { id: 's06', split: 'dev', regex_kind: 'document', text: 'بروشور المشروع.pdf • 12 صفحة' },
    { id: 's07', split: 'test', regex_kind: 'offer', text: 'للبيع: فيلا في حي السامر بجدة وأرض في الروضة' },
    { id: 's08', split: 'test', regex_kind: 'other', text: 'صباح الخير يا شباب، جمعة مباركة' },
    { id: 's09', split: 'test', regex_kind: 'offer', text: 'أرض للبيع في مكة المكرمة، حي الشرائع، 600 متر' },
    { id: 's10', split: 'test', regex_kind: 'offer', text: 'شقة للإيجار السنوي في حي النعيم بجدة، 3 غرف، 45 ألف' }
];
const GOLD = [
    { id: 's01', intent: 'sale_offer', kind: 'apartment', city: 'jeddah', district: 'الروضة', multiple: false, sure: true },
    { id: 's02', intent: 'status_update', kind: 'apartment', city: 'not_stated', district: 'not_stated', multiple: false, sure: true },
    { id: 's03', intent: 'sale_offer', kind: 'villa', city: 'jeddah', district: 'الصفا', multiple: false, sure: false },
    { id: 's04', intent: 'wanted', kind: 'villa', city: 'jeddah', district: 'حي ابحر الشماليه', multiple: false, sure: true },
    { id: 's05', intent: 'not_property', kind: 'none', city: 'not_stated', district: 'not_stated', multiple: false, sure: true },
    { id: 's06', intent: 'other', kind: 'none', city: 'not_stated', district: 'not_stated', multiple: false, sure: true },
    { id: 's07', intent: 'sale_offer', kind: 'villa', city: 'jeddah', district: 'السامر', multiple: true, sure: true },
    { id: 's08', intent: 'not_property', kind: 'none', city: 'not_stated', district: 'not_stated', multiple: false, sure: true },
    { id: 's09', intent: 'sale_offer', kind: 'land', city: 'makkah', district: 'other_district', multiple: false, sure: true },
    { id: 's10', intent: 'rent_offer', kind: 'apartment', city: 'jeddah', district: 'النعيم', multiple: false, sure: false }
];
// عروض «فضية» معروفة (ملف عناصر مستقل يُشغَّل وحده).
const SILVER = [
    { id: 'v01', regex_kind: 'offer', text: 'شقق تمليك في حي الصفا بجدة، غرفتين وثلاث غرف، تبدأ من 550 ألف' },
    { id: 'v02', regex_kind: 'other', text: 'زودنا العمولة على وحدات المشروع لفترة محدودة' },
    { id: 'v03', regex_kind: 'offer', text: 'دور أرضي للبيع في حي المروة بجدة، 3 غرف' }
];

// أجوبة الخادم المحاكى (wa-1). intent: [الخيار، احتماله]؛ الثقة = (6p − 1)/5:
//   .92→.904  .84→.808  .86→.832  .96→.952  .72→.664  .91→.892  .97→.964  .88→.856  .81→.772  .90→.880  .85→.820  .80→.760
// city: [الخيار، احتماله] والثقة بالصيغة نفسها (s09 مكة .84→.808 ≥ 0.6). district: null = لا مرشحين (not_stated من الكود).
// الحكم مشتق يدوياً من المواصفة §6 بالعتبات الافتراضية؛ report.mjs يعيد حسابه، والفرق يجب أن يكون صفراً.
const JEV = {
    s01: { intent: ['sale_offer', 0.92], kind: 'apartment', city: ['jeddah', 0.90], district: 'الروضة', multiple: 0.10, tokens: 410, verdict: 'send', reasons: ['sale_offer'] },
    s02: { intent: ['status_update', 0.84], kind: 'apartment', city: ['not_stated', 0.92], district: null, multiple: 0.05, tokens: 380, verdict: 'send', reasons: ['status_update'] },
    s03: { intent: ['not_property', 0.86], kind: 'none', city: ['jeddah', 0.76], district: 'none', multiple: 0.20, tokens: 520, verdict: 'skip', reasons: ['not_property'] },
    s04: { intent: ['wanted', 0.96], kind: 'villa', city: ['jeddah', 0.92], district: 'أبحر الشمالية', multiple: 0.05, tokens: 300, verdict: 'skip', reasons: ['wanted'] },
    s05: { intent: ['sale_offer', 0.72], kind: 'apartment', city: ['not_stated', 0.84], district: null, multiple: 0.10, tokens: 450, verdict: 'review', reasons: ['low_confidence'] },
    s06: { document: true },
    s07: { intent: ['sale_offer', 0.91], kind: 'villa', city: ['jeddah', 0.92], district: 'الروضة', multiple: 0.70, tokens: 600, verdict: 'review', reasons: ['multiple'] },
    s08: { intent: ['not_property', 0.97], kind: 'none', city: ['not_stated', 0.96], district: null, multiple: 0.02, tokens: 250, verdict: 'skip', reasons: ['not_property'] },
    s09: { intent: ['sale_offer', 0.88], kind: 'land', city: ['makkah', 0.84], district: null, multiple: 0.10, tokens: 480, verdict: 'review', reasons: ['outside_jeddah'] },
    s10: { intent: ['sale_offer', 0.81], kind: 'apartment', city: ['not_stated', 0.68], district: 'النعيم', multiple: 0.30, tokens: 390, verdict: 'send', reasons: ['sale_offer'] },
    v01: { intent: ['sale_offer', 0.90], kind: 'apartment', city: ['jeddah', 0.90], district: 'الصفا', multiple: 0.10, tokens: 420, verdict: 'send', reasons: ['sale_offer'] },
    v02: { intent: ['status_update', 0.85], kind: 'apartment', city: ['not_stated', 0.90], district: null, multiple: 0.10, tokens: 330, verdict: 'send', reasons: ['status_update'] },
    v03: { intent: ['not_property', 0.80], kind: 'floor', city: ['jeddah', 0.90], district: 'المروة', multiple: 0.10, tokens: 360, verdict: 'skip', reasons: ['not_property'] }
};
// wa-1-ar: مثل wa-1 إلا s05 (تصيب النية: not_property .90 → ثقة .88 → skip) وs10 (يفشل العنصر: deadline).
const JEV_AR = { ...JEV, s05: { ...JEV.s05, intent: ['not_property', 0.90], verdict: 'skip', reasons: ['not_property'] }, s10: { error: 'deadline' } };

const INTENT_KEYS = ['sale_offer', 'rent_offer', 'status_update', 'wanted', 'not_property', 'other'];
const KIND_KEYS = ['apartment', 'villa', 'floor', 'building', 'land', 'commercial', 'rest_house', 'other', 'none'];
const CITY_KEYS = ['jeddah', 'makkah', 'madinah', 'riyadh', 'other_city', 'not_stated'];
const round3 = (x) => Math.round(x * 1000) / 1000;

function choiceAnswer(choice, p, keys) {
    const rest = (1 - p) / (keys.length - 1);
    const probabilities = Object.fromEntries(keys.map((k) => [k, k === choice ? p : round3(rest)]));
    return { choice, confidence: round3((keys.length * p - 1) / (keys.length - 1)), probabilities };
}

/* ===================== الخادم المحاكى ===================== */

// يحاكي البوابة (verify_jwt: Bearer لا بد أن يكون المفتاح العام) ثم الوظيفة: التذكرة ببصمة sha256 وسقف عناصرها،
// 1..25 عنصراً، qset معروف، وأجوبة ثابتة. failOnce: أول نداء فيه هذا المرجع يُرفض بـ 503 مرة واحدة.
const QSETS = new Set(['wa-1', 'wa-1-ar', 'wa-1-nogroup', 'mock-off']);

function fixtureFor(ref, qset) {
    const table = qset === 'wa-1-ar' ? JEV_AR : JEV;
    if (table[ref]) return table[ref];
    // مرجع غير معروف: أجوبة حتمية من بصمة المرجع، ثقة النية دائماً < 0.75 فحكمها low_confidence كما في §6.
    const h = crypto.createHash('sha256').update(ref).digest();
    return {
        intent: [INTENT_KEYS[h[0] % 6], 0.3 + (h[1] / 255) * 0.29], kind: KIND_KEYS[h[2] % 9], city: [CITY_KEYS[h[3] % 6], 0.5],
        district: null, multiple: 0.1, tokens: 300, verdict: 'review', reasons: ['low_confidence']
    };
}

function itemResult(it, qset) {
    const key = sha256(String(it.text).trim());
    const fx = fixtureFor(it.ref, qset);
    if (fx.error) return { ref: it.ref, key, ok: false, error: fx.error };
    if (fx.document || it.regex_kind === 'document') {
        return { ref: it.ref, key, ok: true, cached: false, verdict: 'review', reasons: ['document_only'], truncated: false,
            intent: null, kind: null, city: null, district: null, multiple: null, owner_label: null };
    }
    const district = fx.district === null
        ? { choice: 'not_stated', confidence: null, by: 'code' }
        : { choice: fx.district, confidence: 0.6, probabilities: { [fx.district]: 0.8, [fx.district === 'none' ? 'مرشح' : 'none']: 0.2 } };
    return {
        ref: it.ref, key, ok: true, cached: false, verdict: fx.verdict, reasons: fx.reasons, truncated: false,
        intent: choiceAnswer(fx.intent[0], fx.intent[1], INTENT_KEYS),
        kind: choiceAnswer(fx.kind, 0.8, KIND_KEYS),
        city: choiceAnswer(fx.city[0], fx.city[1], CITY_KEYS),
        district,
        multiple: fx.multiple,
        owner_label: null
    };
}

function startMock({ anon, tickets, failOnce }) {
    const stats = { requests: 0, itemsTaken: 0, bodies: [], headers: [] };
    const failed = new Set();
    const server = http.createServer((req, res) => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (c) => { raw += c; });
        req.on('end', async () => {
            stats.requests++;
            const reply = (status, body) => {
                res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(body));
            };
            if (req.method !== 'POST') return reply(405, { status: 'error', message: 'طلب غير مدعوم' });
            if (req.headers.authorization !== `Bearer ${anon}`) return reply(401, { code: 401, message: 'Invalid JWT' });
            let body;
            try { body = JSON.parse(raw); } catch { return reply(400, { status: 'error', message: 'طلب غير صالح' }); }
            stats.bodies.push(body);
            stats.headers.push(req.headers);
            const token = req.headers['x-triage-ticket'];
            const ticket = typeof token === 'string' ? tickets.get(sha256(token)) : undefined;
            // خادم سيئ السلوك يعيد الرمز في رسالته: run.mjs يجب أن يحجبه قبل الطباعة والحفظ.
            if (!ticket) return reply(401, { status: 'error', message: `غير مصرح (${token})` });
            if (body.action !== 'triage') return reply(400, { status: 'error', message: 'إجراء غير معروف' });
            const items = Array.isArray(body.items) ? body.items : [];
            if (items.length < 1 || items.length > 25) return reply(400, { status: 'error', message: 'عدد العناصر غير صالح' });
            if (!QSETS.has(body.qset)) return reply(400, { status: 'error', message: 'مجموعة أسئلة غير معروفة' });
            if (ticket.used + items.length > ticket.max) return reply(401, { status: 'error', message: 'غير مصرح' });
            ticket.used += items.length;
            stats.itemsTaken += items.length;
            if (body.qset === 'mock-off') return reply(200, { status: 'skipped', message: 'فرز Jev متوقف' });
            const trigger = items.find((it) => failOnce.has(it.ref) && !failed.has(it.ref));
            if (trigger) {
                failed.add(trigger.ref);
                return reply(503, { status: 'error', message: 'خطأ داخلي' });
            }
            await sleep(20 * items.length);
            const results = items.map((it) => itemResult(it, body.qset));
            // wa-1-nogroup هنا خادم سيئ السلوك يعيد الرمز داخل كل ItemResult: يجب ألا يصل إلى ملف النتائج.
            if (body.qset === 'wa-1-nogroup') for (const x of results) x.owner_label = token;
            let calls = 0, tokens = 0, errors = 0;
            for (const r of results) {
                if (!r.ok) { errors++; continue; }
                if (r.intent) { calls++; tokens += fixtureFor(r.ref, body.qset).tokens; }
            }
            reply(200, {
                status: 'success', model: 'typesafe/jev-1.13-mock', qset: body.qset, items: results,
                usage: { jev_calls: calls, cached: 0, errors, input_tokens: tokens, cost_usd: tokens * 0.042 / 1e6 },
                spent_today_usd: 0, cap_usd: 0.5
            });
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, stats, url: `http://127.0.0.1:${server.address().port}/functions/v1/wa-triage` });
        });
    });
}

/* ===================== أدوات الاختبار ===================== */

function runNode(script, args) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const child = spawn(process.execPath, [script, ...args], { cwd: TMP });
        let out = '', err = '';
        child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
        child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
        child.on('close', (code) => resolve({ code, out, err, ms: Date.now() - t0 }));
    });
}

const writeJsonl = (file, rows) => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
const readJsonlFile = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${crypto.randomBytes(24).toString('base64url')}`;

function allFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...allFiles(p));
        else out.push(p);
    }
    return out;
}

/* ===================== وحدات report.mjs ===================== */

const D = (choice, confidence, extra = {}) => ({ intent: { choice, confidence }, city: null, multiple: null, ...extra });
t('decide: document comes first', decide(D('sale_offer', 0.99), 'document').reasons[0] === 'document_only');
t('decide: missing intent → review error', decide(null, 'offer').reasons[0] === 'error');
t('decide: wanted ≥ skip → skip wanted', decide(D('wanted', 0.8), 'wanted').verdict === 'skip');
t('decide: rent ≥ skip → skip rent', decide(D('rent_offer', 0.8), 'offer').reasons[0] === 'rent');
t('decide: null confidence counts as low', decide(D('not_property', null), 'other').reasons[0] === 'low_confidence');
t('decide: multiple is checked before the city',
    decide(D('sale_offer', 0.9, { city: { choice: 'makkah', confidence: 0.9 }, multiple: 0.9 }), 'offer').reasons[0] === 'multiple');
t('decide: outside city with low city confidence still sends',
    decide(D('sale_offer', 0.9, { city: { choice: 'riyadh', confidence: 0.5 }, multiple: 0.1 }), 'offer').verdict === 'send');
t('decide: status_update below send → low_confidence', decide(D('status_update', 0.74), 'update').reasons[0] === 'low_confidence');
const TH = { send: 0.9, skip: 0.7, city: 0.6, multiple: 0.6 };
t('decide: rent uses the skip threshold, not send', decide(D('rent_offer', 0.8), 'offer', TH).verdict === 'skip'
    && decide(D('sale_offer', 0.8), 'offer', TH).verdict === 'review');
t('decide: confidence equal to the threshold passes (≥)', decide(D('wanted', 0.75), 'wanted').verdict === 'skip'
    && decide(D('sale_offer', 0.75), 'offer').verdict === 'send');
t('percentile: median of 4 values interpolates', percentile([4, 1, 3, 2], 0.5) === 2.5);
t('percentile: p95 of two values', near(percentile([10, 20], 0.95), 19.5));
t('wilson: 19/20 lower bound ≈ 0.764', near(wilsonLow(19, 20), 0.7639, 1e-3), wilsonLow(19, 20));
t('normDistrict: حي prefix, ة/ه and hamza fold', normDistrict('حي ابحر الشماليه') === normDistrict('أبحر الشمالية'));
t('districtMatch: Jev none matches gold other_district', districtMatch('none', 'other_district'));
t('districtMatch: missing answer is wrong even for not_stated', !districtMatch(null, 'not_stated'));

/* ===================== من البداية إلى النهاية ===================== */

const TICKET = crypto.randomBytes(32).toString('base64url');
const SMALL_TICKET = crypto.randomBytes(32).toString('base64url');
const ANON = fakeJwt({ iss: 'supabase', ref: 'mock', role: 'anon' });
const tickets = new Map([[sha256(TICKET), { max: 1000, used: 0 }], [sha256(SMALL_TICKET), { max: 5, used: 0 }]]);
const mock = await startMock({ anon: ANON, tickets, failOnce: new Set(['s07']) });

const P = (name) => path.join(TMP, name);
writeJsonl(P('items.jsonl'), ITEMS.map((it) => ({ ...it, group: GROUP })));
writeJsonl(P('gold.jsonl'), GOLD.map((g) => ({ ...g, note: '' })));
writeJsonl(P('silver.jsonl'), SILVER.map((it) => ({ ...it, group: GROUP })));
fs.writeFileSync(P('ticket.txt'), `${TICKET}\r\n`);           // سطر جديد بنهاية ويندوز: يُقصّ قبل الإرسال
fs.writeFileSync(P('small-ticket.txt'), SMALL_TICKET);
const WRONG_TICKET = crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(P('wrong-ticket.txt'), WRONG_TICKET);
fs.writeFileSync(P('anon.jwt'), `﻿${ANON}\n`);           // BOM كما يكتبه Out-File في PowerShell 5.1
fs.writeFileSync(P('wrong-anon.jwt'), fakeJwt({ iss: 'supabase', ref: 'other', role: 'anon' }));
fs.writeFileSync(P('publishable.key'), 'sb_publishable_EXAMPLEexampleEXAMPLE123');
fs.writeFileSync(P('service.jwt'), fakeJwt({ iss: 'supabase', ref: 'mock', role: 'service_role' }));

const common = ['--url', mock.url, '--anon-key-file', P('anon.jwt')];
const outputs = [];
const record = (res) => { outputs.push(res.out, res.err); return res; };

// (1) التشغيل الرئيسي: دفعات من 4 → 3 نداءات لكل qset؛ الدفعة الثانية (s05..s08) تُرفض 503 مرة ثم تُعاد بعد ثانيتين.
const OUT = P('out');
let r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--qset', 'wa-1', '--qset', 'wa-1-ar', '--ticket-file', P('ticket.txt'),
    '--out', OUT, '--batch', '4', '--concurrency', '2', ...common]));
t('main run: exit 3 (wa-1-ar has a failed item)', r.code === 3, { code: r.code, err: r.err });
t('main run: the retry waited 2 s', r.ms >= 2000, r.ms);
t('main run: 7 requests (wa-1 3 + 1 retry, wa-1-ar 3)', mock.stats.requests === 7, mock.stats.requests);
t('main run: 24 ticket items used (14 + 10)', mock.stats.itemsTaken === 24, mock.stats.itemsTaken);
const body0 = mock.stats.bodies[0];
t('request body: exactly {action, qset, items}', JSON.stringify(Object.keys(body0).sort()) === '["action","items","qset"]', Object.keys(body0));
t('request body: action triage, qset wa-1', body0.action === 'triage' && body0.qset === 'wa-1');
t('request items: exactly {ref, text, group, regex_kind}',
    body0.items.every((it) => JSON.stringify(Object.keys(it).sort()) === '["group","ref","regex_kind","text"]'), body0.items[0]);
t('request items: group and regex_kind passed through', body0.items.every((it) => it.group === GROUP && typeof it.regex_kind === 'string'));
const h0 = mock.stats.headers[0];
t('headers: ticket trimmed and sent as x-triage-ticket', h0['x-triage-ticket'] === TICKET);
t('headers: anon JWT (BOM stripped) as Bearer and apikey', h0.authorization === `Bearer ${ANON}` && h0.apikey === ANON);

const W1 = readJsonlFile(path.join(OUT, 'wa-1.jsonl'));
const W1items = W1.filter((x) => x.type === 'item'), W1batches = W1.filter((x) => x.type === 'batch');
t('wa-1 file: 10 ok item records', W1items.length === 10 && W1items.every((x) => x.ok), W1items.length);
t('wa-1 file: full ItemResult kept (probabilities, key)',
    W1items.find((x) => x.id === 's01').result.intent.probabilities.sale_offer === 0.92
    && /^[0-9a-f]{64}$/.test(W1items.find((x) => x.id === 's01').result.key));
t('wa-1 file: 3 batch records, one with 2 attempts', W1batches.length === 3 && W1batches.filter((b) => b.attempts === 2).length === 1,
    W1batches.map((b) => b.attempts));
t('wa-1 file: batch records carry latency and usage',
    W1batches.every((b) => b.latency_ms >= 0 && b.usage && b.usage.jev_calls >= 0 && b.model === 'typesafe/jev-1.13-mock'));
const end1 = W1.find((x) => x.type === 'run_end');
t('wa-1 run_end: 10 ok, 14 items sent incl. retry, 1 retry, 3780 tokens, $0.00015876 unrounded',
    end1.ok_items === 10 && end1.items_sent === 14 && end1.retries === 1 && end1.input_tokens === 3780
    && end1.not_processed === 0 && near(end1.cost_usd, 0.00015876, 1e-12), end1);
const AR = readJsonlFile(path.join(OUT, 'wa-1-ar.jsonl')).filter((x) => x.type === 'item');
t('wa-1-ar file: s10 recorded as failed with the server error', AR.find((x) => x.id === 's10').ok === false
    && AR.find((x) => x.id === 's10').error === 'deadline');

// (2) ملف موجود بلا --resume: يُرفض بلا نداء.
const before = mock.stats.requests;
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('ticket.txt'), '--out', OUT, ...common]));
t('existing results without --resume: exit 1, no call', r.code === 1 && mock.stats.requests === before && /--resume/.test(r.err), r.err);

// (3) --resume: wa-1 لا شيء؛ wa-1-ar يعيد s10 وحده (ويفشل مجدداً).
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--qset', 'wa-1', '--qset', 'wa-1-ar', '--ticket-file', P('ticket.txt'),
    '--out', OUT, '--batch', '4', '--resume', ...common]));
const last = mock.stats.bodies[mock.stats.bodies.length - 1];
t('resume: one call with only s10', mock.stats.requests === before + 1 && last.items.length === 1 && last.items[0].ref === 's10',
    { requests: mock.stats.requests - before });
t('resume: exit 3 (s10 still fails), wa-1 nothing to send', r.code === 3 && /\[wa-1\] nothing to send/.test(r.out), r.out);

// (4) عناصر فضية في مجلد نتائج مستقل.
const SOUT = P('silver-out');
r = record(await runNode(RUN, ['--items', P('silver.jsonl'), '--ticket-file', P('ticket.txt'), '--out', SOUT, ...common]));
t('silver run: exit 0, 3 ok items', r.code === 0 && readJsonlFile(path.join(SOUT, 'wa-1.jsonl')).filter((x) => x.type === 'item' && x.ok).length === 3, r.err);

// (5) --limit: أول 3 عناصر فقط (بـ wa-1-nogroup حيث يعيد الخادم المحاكى الرمز داخل النتائج).
const LOUT = P('limit-out');
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--qset', 'wa-1-nogroup', '--ticket-file', P('ticket.txt'), '--out', LOUT, '--limit', '3', ...common]));
const Lraw = fs.readFileSync(path.join(LOUT, 'wa-1-nogroup.jsonl'), 'utf8');
const L = readJsonlFile(path.join(LOUT, 'wa-1-nogroup.jsonl')).filter((x) => x.type === 'item');
t('limit 3: one call, items s01..s03', r.code === 0 && L.map((x) => x.id).join() === 's01,s02,s03', L.map((x) => x.id));
t('token echoed inside ItemResult is redacted in the results file', !Lraw.includes(TICKET) && L.every((x) => x.result.owner_label === '[redacted]'));
fs.writeFileSync(P('quote-ticket.txt'), 'abcdefghijklmnop"qrstuvwxyz');
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('quote-ticket.txt'), '--out', P('quote-out'), ...common]));
t('ticket with characters outside base64/base64url refused', r.code === 1 && /letters, digits/.test(r.err), r.err);

// (6) تذكرة خاطئة: 401 من الوظيفة → توقف برسالة واضحة، لا عناصر.
let n0 = mock.stats.requests;
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('wrong-ticket.txt'), '--out', P('bad-ticket'), '--concurrency', '1', ...common]));
t('wrong ticket: exit 2 after one call', r.code === 2 && mock.stats.requests === n0 + 1, { code: r.code, calls: mock.stats.requests - n0 });
t('wrong ticket: message names the ticket', /ticket was refused/.test(r.err), r.err);
t('wrong ticket: no item records', readJsonlFile(path.join(P('bad-ticket'), 'wa-1.jsonl')).filter((x) => x.type === 'item').length === 0);
t('wrong ticket: the token the server echoed is redacted', !r.err.includes(WRONG_TICKET) && r.err.includes('[redacted]'), r.err);

// (7) مفتاح عام خاطئ: 401 من البوابة → رسالة عن المفتاح العام.
n0 = mock.stats.requests;
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('ticket.txt'), '--out', P('bad-anon'), '--concurrency', '1',
    '--url', mock.url, '--anon-key-file', P('wrong-anon.jwt')]));
t('wrong anon key: exit 2 after one call', r.code === 2 && mock.stats.requests === n0 + 1, r.code);
t('wrong anon key: message names the anon key', /gateway refused the anon key/.test(r.err), r.err);

// (8) تذكرة سقفها 5: الدفعة الأولى (4) تمر والثانية (4) تُرفض → توقف، والنتائج الأولى محفوظة.
n0 = mock.stats.requests;
const COUT = P('cap-out');
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('small-ticket.txt'), '--out', COUT, '--batch', '4', '--concurrency', '1', ...common]));
const C = readJsonlFile(path.join(COUT, 'wa-1.jsonl'));
t('ticket cap: exit 2 after 2 calls', r.code === 2 && mock.stats.requests === n0 + 2, { code: r.code, calls: mock.stats.requests - n0 });
t('ticket cap: first 4 items kept, stopped batch logged',
    C.filter((x) => x.type === 'item' && x.ok).length === 4 && C.some((x) => x.type === 'batch' && x.status === 'stopped'));
const capEnd = C.find((x) => x.type === 'run_end');
t('ticket cap: run_end tallies 4 ok + 6 not processed (refused call + unsent call)',
    capEnd.ok_items === 4 && capEnd.failed_items === 0 && capEnd.not_processed === 6 && capEnd.stopped === 'auth', capEnd);

// (9) الفرز متوقف («skipped»): توقف بلا إعادة.
n0 = mock.stats.requests;
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--qset', 'mock-off', '--ticket-file', P('ticket.txt'), '--out', P('off-out'), '--concurrency', '1', ...common]));
t('triage off: exit 2 after one call, says skipped', r.code === 2 && mock.stats.requests === n0 + 1 && /skipped/.test(r.err), r.err);
const offEnd = readJsonlFile(path.join(P('off-out'), 'mock-off.jsonl')).find((x) => x.type === 'run_end');
t('triage off: all 10 items not processed', offEnd.not_processed === 10 && offEnd.stopped === 'skipped', offEnd);

// (10) مفاتيح مرفوضة قبل أي نداء.
n0 = mock.stats.requests;
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('ticket.txt'), '--out', P('pk-out'), '--url', mock.url, '--anon-key-file', P('publishable.key')]));
t('publishable key refused: exit 1, no call', r.code === 1 && mock.stats.requests === n0 && /publishable/.test(r.err), r.err);
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('ticket.txt'), '--out', P('sr-out'), '--url', mock.url, '--anon-key-file', P('service.jwt')]));
t('service_role key refused: exit 1, no call', r.code === 1 && mock.stats.requests === n0 && /service_role/.test(r.err), r.err);
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--ticket-file', P('ticket.txt'), '--out', P('http-out'), '--url', 'http://example.com/functions/v1/wa-triage', '--anon-key-file', P('anon.jwt')]));
t('plain http to a remote host refused', r.code === 1 && /https/.test(r.err), r.err);

// (11) --dry-run: لا شبكة ولا تذكرة.
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--out', P('dry-out'), '--dry-run', '--batch', '4']));
t('dry run: exit 0, plan printed, no call, no results file',
    r.code === 0 && mock.stats.requests === n0 && /10 to send in 3 call/.test(r.out) && !fs.existsSync(path.join(P('dry-out'), 'wa-1.jsonl')), r.out);

// (12) الحماية من الكتابة داخل المستودع.
const inRepo = path.join(REPO, 'scripts', 'jev-eval', 'should-not-exist');
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--out', inRepo, '--dry-run']));
t('out folder inside the repo refused', r.code === 1 && !fs.existsSync(inRepo) && /inside the repository/.test(r.err), r.err);
fs.rmSync(inRepo, { recursive: true, force: true });
const ticketInRepo = path.join(REPO, 'should-not-exist-ticket.txt');
r = record(await runNode(RUN, ['--make-ticket', '--ticket-file', ticketInRepo]));
t('ticket file inside the repo refused', r.code === 1 && !fs.existsSync(ticketInRepo), r.err);
fs.rmSync(ticketInRepo, { force: true });

r = record(await runNode(REPORT, ['--items', P('items.jsonl'), '--gold', P('gold.jsonl'), '--results', OUT, '--out', inRepo]));
t('report --out inside the repo refused', r.code === 1 && !fs.existsSync(inRepo), r.err);
fs.rmSync(inRepo, { recursive: true, force: true });
r = record(await runNode(RUN, ['--help']));
const r2 = record(await runNode(REPORT, ['--help']));
t('--help: both tools print usage and exit 0', r.code === 0 && /Usage:/.test(r.out) && r2.code === 0 && /Usage:/.test(r2.out));
r = record(await runNode(RUN, ['--items', P('items.jsonl'), '--bogus']));
t('unknown option: exit 1', r.code === 1 && /unknown option --bogus/.test(r.err), r.err);

// (13) --make-ticket: ملف جديد وSQL ببصمته، والرمز لا يُطبع.
r = record(await runNode(RUN, ['--make-ticket', '--ticket-file', P('new-ticket.txt'), '--max-items', '1500', '--days', '2', '--note', "eval o'clock"]));
const made = fs.readFileSync(P('new-ticket.txt'), 'utf8').trim();
t('make-ticket: exit 0, file holds a 43-char token', r.code === 0 && /^[A-Za-z0-9_-]{43}$/.test(made), r.err);
t('make-ticket: prints the insert with sha256, max_items and expiry',
    r.out.includes(`values ('${sha256(made)}', 'eval o''clock', 1500, now() + interval '2 days');`), r.out);
t('make-ticket: the token itself is not printed', !r.out.includes(made) && !r.err.includes(made));
r = record(await runNode(RUN, ['--make-ticket', '--ticket-file', P('new-ticket.txt')]));
t('make-ticket again: reuses the existing token', r.code === 0 && /already in/.test(r.out) && r.out.includes(sha256(made))
    && fs.readFileSync(P('new-ticket.txt'), 'utf8').trim() === made);

// (14) التقرير.
const REP = P('report');
r = record(await runNode(REPORT, ['--items', P('items.jsonl'), '--gold', P('gold.jsonl'), '--results', OUT, '--out', REP,
    '--silver', P('silver.jsonl'), '--silver-results', SOUT]));
t('report: exit 0, both files written', r.code === 0 && fs.existsSync(path.join(REP, 'report.json')) && fs.existsSync(path.join(REP, 'report.md')), r.err);
const R = JSON.parse(fs.readFileSync(path.join(REP, 'report.json'), 'utf8'));
const MD = fs.readFileSync(path.join(REP, 'report.md'), 'utf8');
const Q = R.qsets['wa-1'], Dv = Q.splits.dev, Ts = Q.splits.test, Al = Q.splits.all;
const accIs = (x, k, n) => x.correct === k && x.n === n;

t('report: both qsets present', Object.keys(R.qsets).join() === 'wa-1,wa-1-ar', Object.keys(R.qsets));
// العدّ: dev 6 (s06 مستند)، test 4.
t('population dev: 6 gold, 5 answered, 1 document', JSON.stringify(Dv.population) === JSON.stringify({ gold: 6, with_result: 6, answered: 5, documents: 1, errors: 0, missing: 0 }), Dv.population);
t('population test: 4 gold, 4 answered', Ts.population.answered === 4 && Ts.population.documents === 0, Ts.population);
// النية: dev ✓s01 ✓s02 ✗s03 ✓s04 ✗s05 = 3/5؛ test ✓s07 ✓s08 ✓s09 ✗s10 = 3/4؛ all 6/9.
t('intent accuracy dev 3/5, test 3/4, all 6/9', accIs(Dv.accuracy.intent, 3, 5) && accIs(Ts.accuracy.intent, 3, 4) && accIs(Al.accuracy.intent, 6, 9));
// النوع: dev ✗s03 (none≠villa) ✗s05 (apartment≠none) = 3/5؛ test 4/4.
t('kind accuracy dev 3/5, test 4/4, all 7/9', accIs(Dv.accuracy.kind, 3, 5) && accIs(Ts.accuracy.kind, 4, 4) && accIs(Al.accuracy.kind, 7, 9));
// المدينة: test ✗s10 (not_stated≠jeddah).
t('city accuracy dev 5/5, test 3/4, all 8/9', accIs(Dv.accuracy.city, 5, 5) && accIs(Ts.accuracy.city, 3, 4) && accIs(Al.accuracy.city, 8, 9));
// الحي: dev ✗s03 (none مع الصفا)، s04 يطابق بعد التطبيع؛ test ✗s07 (الروضة≠السامر).
t('district accuracy dev 4/5, test 3/4, all 7/9', accIs(Dv.accuracy.district, 4, 5) && accIs(Ts.accuracy.district, 3, 4) && accIs(Al.accuracy.district, 7, 9));
t('multiple accuracy 9/9 (s07 .70 → yes)', accIs(Al.accuracy.multiple, 9, 9));
t('multiple at 0.6: tp 1, fp 0, fn 0, tn 8', ['tp', 'fp', 'fn', 'tn'].map((k) => Al.multiple_at_threshold[k]).join() === '1,0,0,8', Al.multiple_at_threshold);
// sure: dev صحيح {s01,s02,s04,s05✗}=3/4 وغير متأكد {s03✗}=0/1؛ test {s07,s08,s09}=3/3 و{s10✗}=0/1.
t('intent by sure: dev 3/4 & 0/1, test 3/3 & 0/1, all 6/7 & 0/2',
    accIs(Dv.intent_by_sure.sure, 3, 4) && accIs(Dv.intent_by_sure.unsure, 0, 1) && accIs(Ts.intent_by_sure.sure, 3, 3)
    && accIs(Ts.intent_by_sure.unsure, 0, 1) && accIs(Al.intent_by_sure.sure, 6, 7) && accIs(Al.intent_by_sure.unsure, 0, 2));
// الحي حسب الذهبي: لها حي {s01✓,s03✗,s04✓,s07✗,s10✓}=3/5؛ not_stated {s02,s05,s08}=3/3؛ other_district {s09}=1/1.
t('district groups all: has 3/5, not_stated 3/3, other 1/1',
    accIs(Al.district.has_district, 3, 5) && accIs(Al.district.not_stated, 3, 3) && accIs(Al.district.other_district, 1, 1), Al.district);
t('district groups dev: has 2/3, not_stated 2/2', accIs(Dv.district.has_district, 2, 3) && accIs(Dv.district.not_stated, 2, 2));
// خط الأساس: dev regex ✓s01 ✓s02 ✓s03 ✓s04 ✗s05 = 4/5 (Jev 3/5)؛ test ✓s07 ✓s08 ✓s09 ✗s10 = 3/4.
t('regex baseline dev 4/5 vs Jev 3/5; only regex right 1, both wrong 1',
    accIs(Dv.regex_baseline.regex, 4, 5) && accIs(Dv.regex_baseline.jev, 3, 5) && Dv.regex_baseline.only_regex === 1 && Dv.regex_baseline.both_wrong === 1);
t('regex baseline test 3/4, all 7/9', accIs(Ts.regex_baseline.regex, 3, 4) && accIs(Al.regex_baseline.regex, 7, 9));
const M = Al.confusion.matrix;
t('confusion all: sale→sale 3, sale→not_property 1, not_property→sale 1, rent→sale 1, n 9',
    M.sale_offer.sale_offer === 3 && M.sale_offer.not_property === 1 && M.not_property.sale_offer === 1
    && M.rent_offer.sale_offer === 1 && M.not_property.not_property === 1 && M.wanted.wanted === 1 && Al.confusion.n === 9);
// التغطية (all) بالثقات .904 .808 .832 .952 .664 .892 .964 .856 .772.
const cov = (split, tt) => split.coverage.find((x) => near(x.t, tt));
t('coverage all: t.50 9 (6 right), .70 8 (6), .80 7 (6), .85 5 (5), .90 3 (3), .95 2 (2)',
    [[0.5, 9, 6], [0.7, 8, 6], [0.75, 8, 6], [0.8, 7, 6], [0.85, 5, 5], [0.9, 3, 3], [0.95, 2, 2]]
        .every(([tt, n, c]) => cov(Al, tt).n === n && cov(Al, tt).correct === c), Al.coverage.map((x) => [x.t, x.n, x.correct]));
t('coverage dev: .65 5, .70 4 (3 right), .85 2 (2), .95 1', cov(Dv, 0.65).n === 5 && cov(Dv, 0.7).n === 4 && cov(Dv, 0.7).correct === 3
    && cov(Dv, 0.85).n === 2 && cov(Dv, 0.95).n === 1);
t('coverage test: .75 4 (3), .80 3 (3), .90 1', cov(Ts, 0.75).n === 4 && cov(Ts, 0.75).correct === 3 && cov(Ts, 0.8).n === 3 && cov(Ts, 0.9).n === 1);
// ECE: dev = (.72 + 2×.35 + 2×.06)/5 = .308؛ test = (2×.345 + 2×.06)/4 = .2025؛ all = (.72 + 4×.3475 + 4×.06)/9 = 2.35/9.
t('ECE dev 0.308', near(Dv.calibration.ece, 0.308, 1e-9), Dv.calibration.ece);
t('ECE test 0.2025', near(Ts.calibration.ece, 0.2025, 1e-9), Ts.calibration.ece);
t('ECE all 2.35/9', near(Al.calibration.ece, 2.35 / 9, 1e-9), Al.calibration.ece);
const bin = (i) => Al.calibration.table[i];
t('reliability all: 0.7 bin 1 (0 right), 0.8 bin 4 (mean .8475, 2 right), 0.9 bin 4 (all right)',
    bin(7).n === 1 && bin(7).correct === 0 && bin(8).n === 4 && near(bin(8).mean_p, 0.8475) && bin(8).correct === 2
    && bin(9).n === 4 && bin(9).correct === 4 && near(bin(9).mean_p, 0.94));
// الأحكام بالعتبات الافتراضية: dev send {s01,s02} skip {s03✗,s04} review {s05,s06}.
const v = (x) => [x.counts.send, x.counts.review, x.counts.skip, x.send_correct, x.skip_correct].join();
t('verdicts dev: send 2 (2 right), review 2, skip 2 (1 right), automated 4/6, 1 offer skipped',
    v(Dv.verdicts) === '2,2,2,2,1' && near(Dv.verdicts.automated, 4 / 6) && Dv.verdicts.offers_skipped === 1, Dv.verdicts);
t('verdicts test: send 1 (0 right: s10 is rent), review 2, skip 1 (right), automated 1/2',
    v(Ts.verdicts) === '1,2,1,0,1' && near(Ts.verdicts.automated, 0.5) && Ts.verdicts.send_precision === 0, Ts.verdicts);
t('verdicts all: 3/4/3, send precision 2/3, skip precision 2/3, automated 0.6',
    v(Al.verdicts) === '3,4,3,2,2' && near(Al.verdicts.send_precision, 2 / 3) && near(Al.verdicts.skip_precision, 2 / 3) && near(Al.verdicts.automated, 0.6));
t('verdicts: server verdict equals the §6 recomputation everywhere', [Dv, Ts, Al].every((s) => s.verdicts.server_mismatch === 0 && s.verdicts.server_missing === 0));
t('verdict reasons all', JSON.stringify(Al.verdicts.reasons) === JSON.stringify({ sale_offer: 2, status_update: 1, not_property: 2, wanted: 1, low_confidence: 1, document_only: 1, multiple: 1, outside_jeddah: 1 }), Al.verdicts.reasons);
t('harmful ids: s03 skipped offer, s10 wrong send', Al.verdicts.ids.skipped_offers.join() === 's03' && Al.verdicts.ids.wrong_sends.join() === 's10');
// المسح على dev: send .50–.65 → {s01,s02,s05✗}؛ .70–.80 → {s01,s02} دقة 1 ← أعلى عتبة بالتغطية القصوى .80.
//               skip .50–.80 → {s03✗,s04} دقة .5؛ .85–.95 → {s04} ← .95.
const sp = (list, tt) => list.find((x) => near(x.t, tt));
t('sweep send: .60 → 3 sends 2 right; .80 → 2/2 meets; .95 → none',
    sp(Q.sweep.send, 0.6).n === 3 && sp(Q.sweep.send, 0.6).correct === 2 && !sp(Q.sweep.send, 0.6).meets
    && sp(Q.sweep.send, 0.8).n === 2 && sp(Q.sweep.send, 0.8).meets && sp(Q.sweep.send, 0.95).n === 0);
t('sweep skip: .80 → 2 skips 1 right; .85 → 1/1 meets', sp(Q.sweep.skip, 0.8).n === 2 && sp(Q.sweep.skip, 0.8).correct === 1
    && sp(Q.sweep.skip, 0.85).meets && sp(Q.sweep.skip, 0.95).meets);
t('sweep recommends send 0.80, skip 0.95', Q.sweep.recommended.send === 0.8 && Q.sweep.recommended.skip === 0.95, Q.sweep.recommended);
const ard = Q.sweep.at_recommended.dev, art = Q.sweep.at_recommended.test;
t('dev @ recommended: send 2, skip 1, automated 0.5, both precisions 1',
    ard.counts.send === 2 && ard.counts.skip === 1 && near(ard.automated, 0.5) && ard.send_precision === 1 && ard.skip_precision === 1, ard);
t('test @ recommended: send 0 (s10 .772 < .80), skip 1 (s08), automated 0.25',
    art.counts.send === 0 && art.send_precision === null && art.counts.skip === 1 && art.skip_precision === 1 && near(art.automated, 0.25), art);
// الفضي: v01 ✓ v02 ✓ v03 ✗ → 2/3؛ offer 1/2، other 1/1.
const SV = Q.silver.all;
t('silver recall 2/3; send 2, skip 1', SV.answered === 3 && SV.recalled === 2 && near(SV.recall, 2 / 3) && SV.verdicts.send === 2 && SV.verdicts.skip === 1, SV);
t('silver by regex kind: offer 1/2, other 1/1', SV.by_regex_kind.offer.recalled === 1 && SV.by_regex_kind.offer.answered === 2
    && SV.by_regex_kind.other.recalled === 1 && SV.by_regex_kind.other.answered === 1);
t('silver for wa-1-ar: no results', R.qsets['wa-1-ar'].silver.all.with_result === 0);
// الكلفة wa-1: 9 نداءات Jev، 3780 رمزاً → 420 لكل نداء؛ 3780 × 0.042e-6 = 0.00015876$.
const K = Q.cost;
t('cost wa-1: 3 ok calls, 1 retried, 9 Jev calls, 420 tokens per call',
    K.calls_ok === 3 && K.calls_retried === 1 && K.jev_calls === 9 && K.input_tokens === 3780 && near(K.input_tokens_per_jev_call, 420), K);
t('cost wa-1: 378 input tokens per item (3780 ÷ 10, the document included)', near(K.input_tokens_per_item, 378), K.input_tokens_per_item);
t('cost wa-1: $0.00015876 total, $0.00001764 per Jev call, $0.000015876 per item',
    near(K.cost_usd, 0.00015876, 1e-12) && near(K.usd_per_jev_call, 0.00001764, 1e-12) && near(K.usd_per_item, 0.000015876, 1e-12), K);
t('latency: per-call p50 ≥ 40 ms (mock waits 20 ms per item) and p95 ≥ p50; per item = call ÷ items',
    K.latency_batch_ms.p50 >= 40 && K.latency_batch_ms.p95 >= K.latency_batch_ms.p50 && K.latency_item_ms.n === 10
    && K.latency_item_ms.p50 <= K.latency_batch_ms.p50, { b: K.latency_batch_ms, i: K.latency_item_ms });
// wa-1-ar: s05 تصيب، s10 خطأ → 7/8؛ الأحكام send {s01,s02} skip {s03✗,s04,s05,s08} review {s06,s07,s09,s10}.
const A2 = R.qsets['wa-1-ar'].splits.all;
t('wa-1-ar: 8 answered, 1 error, intent 7/8', A2.population.answered === 8 && A2.population.errors === 1 && accIs(A2.accuracy.intent, 7, 8), A2.population);
t('wa-1-ar verdicts: send 2 (2 right), review 4, skip 4 (3 right), automated 0.6, no mismatch',
    v(A2.verdicts) === '2,4,4,2,3' && near(A2.verdicts.automated, 0.6) && A2.verdicts.server_mismatch === 0, A2.verdicts);
t('wa-1-ar: 4 ok calls (3 + resume), 8 Jev calls, 3390 tokens', R.qsets['wa-1-ar'].cost.calls_ok === 4
    && R.qsets['wa-1-ar'].cost.jev_calls === 8 && R.qsets['wa-1-ar'].cost.input_tokens === 3390, R.qsets['wa-1-ar'].cost);
// Markdown: صفوف بعينها.
t('md: intent accuracy row', MD.includes('| intent | 60.0% (3/5) | 75.0% (3/4) | 66.7% (6/9) |'));
t('md: recommendation line', MD.includes('Recommended: send **0.80**, skip **0.95**.'));
t('md: verdict row for all', MD.includes('| all | 10 | 3 | 4 | 3 | 66.7% (2/3) |'));
t('md: ECE line', MD.includes('ECE: dev 0.308 (n=5) · test ') && MD.includes(' · all 0.261 (n=9).'));

// (15) لا رمز تذكرة ولا مفتاح في أي مخرج، ولا نص رسالة في ملفات النتائج والتقرير.
const files = allFiles(TMP).filter((f) => !/ticket\.txt$|\.jwt$|\.key$|items\.jsonl$|silver\.jsonl$|gold\.jsonl$/.test(f));
const blobs = [...outputs.filter((x) => typeof x === 'string'), ...files.map((f) => fs.readFileSync(f, 'utf8'))];
t('no ticket token in any output or file', [TICKET, SMALL_TICKET, WRONG_TICKET, made].every((s) => blobs.every((b) => !b.includes(s))));
t('no anon key in any output or file', blobs.every((b) => !b.includes(ANON)));
t('no message text in results or report', [...ITEMS, ...SILVER].every((it) => files.every((f) => !fs.readFileSync(f, 'utf8').includes(it.text))));

mock.server.close();
if (process.env.JEV_EVAL_KEEP) console.log(`kept: ${TMP}`);
else fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
