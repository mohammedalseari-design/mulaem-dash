// مُشغّل تقييم فرز Jev — يرسل عناصر مصنّفة إلى وظيفة wa-triage المنشورة بتذكرة تقييم، ويحفظ ردودها كما هي.
//
// لا بيانات في المستودع (عام): ملف العناصر والنتائج والتذكرة تبقى خارجه، مثلاً في مجلد scratchpad\eval.
// الأداة ترفض أي مسار داخل المستودع، قراءةً أو كتابة، إلا تحت data/ لأن git يتجاهله.
// التذكرة سرّ: تُقرأ من ملف ولا تُطبع ولا تُكتب في ملف نتائج ولا في رسالة خطأ؛ قاعدة البيانات تحفظ بصمتها فقط.
// طريقة إنشاء التذكرة وقراءة النتائج في scripts/jev-eval/README.md.
//
// التشغيل (Node 24، بلا مكتبات):
//   node scripts/jev-eval/run.mjs --items items.jsonl --ticket-file jev-ticket.txt --anon-key-file anon.jwt --out <dir>
//        [--qset wa-1 --qset wa-1-ar] [--batch 25] [--concurrency 2] [--limit N] [--resume] [--dry-run]
//   node scripts/jev-eval/run.mjs --make-ticket --ticket-file jev-ticket.txt [--max-items 3000] [--days 3] [--note "…"]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_URL = 'https://niykzsspdehexphewlxa.supabase.co/functions/v1/wa-triage';
export const TOOL = 'jev-eval/run.mjs v1';

const MAX_BATCH = 25;               // حدّ الوظيفة: 1..25 عنصراً في النداء الواحد (المواصفة §7)
const RETRY_DELAY_MS = 2000;        // إعادة واحدة للنداء الفاشل بعد ثانيتين...
const MAX_RETRY_AFTER_MS = 10000;   // ...أو بعد Retry-After إن أرسله الخادم، حتى 10 ث
// نداءات فاشلة متتالية: نتوقف كي لا تُستهلك التذكرة على خادم معطّل. النداء فاشل إن فشل هو نفسه بعد إعادته، أو نجح
// وبقي أكثر من نصف عناصره (عدا document) بلا جواب من Jev.
const MAX_FAILED_IN_A_ROW = 3;
// أخطاء عنصر تعني أن Jev معطّل في الوظيفة كلها لا في رسالة بعينها (classifyJevHttp في _shared/jev/client.ts):
// مفتاح OpenRouter مرفوض، أو نفد الرصيد، أو لا طريق للنموذج، أو طلب Jev نفسه مرفوض. كل نداء بعدها يفشل مثلها ويخصم
// من التذكرة، فنتوقف عند أول ظهور.
const JEV_DOWN = new Set(['auth', 'credits', 'no_route', 'bad_request']);
const KNOWN_KINDS = new Set(['offer', 'update', 'document', 'wanted', 'other']);

export const EXIT = { OK: 0, INPUT: 1, STOPPED: 2, PARTIAL: 3 };

// خطأ متوقَّع: تُطبع رسالته وحدها (بلا مكدّس) ويُخرج بالرمز المعطى.
export class Fatal extends Error {
    constructor(message, code = EXIT.INPUT) {
        super(message);
        this.code = code;
    }
}

const USAGE = `Usage:
  node scripts/jev-eval/run.mjs --items <items.jsonl> --ticket-file <path> --anon-key-file <path> --out <dir> [options]
  node scripts/jev-eval/run.mjs --make-ticket --ticket-file <path> [--max-items N] [--days D] [--note text]

Options:
  --items <file>          JSONL, one {id, text, group, regex_kind, split} per line
  --qset <name>           question set, repeatable (default wa-1)
  --url <url>             function URL (default ${DEFAULT_URL})
  --ticket-file <path>    file holding the eval ticket token (never printed)
  --anon-key-file <path>  file holding the project's legacy anon JWT (eyJ...), sent as Authorization: Bearer
  --out <dir>             results folder: writes <dir>/<qset>.jsonl
  --batch <n>             items per call, 1..25 (default 25)
  --concurrency <n>       calls in flight, 1..8 (default 2)
  --limit <n>             use only the first n items of the file
  --resume                skip items that already have an ok result in <dir>/<qset>.jsonl
                          (without it, an existing <dir>/<qset>.jsonl stops the run before any call)
  --timeout-ms <n>        per call (default 150000)
  --dry-run               check the inputs and print the plan; no network, no ticket needed
  --make-ticket           create the ticket file if missing and print the SQL that registers its sha256

Retries: one, after 2 s (or the server's Retry-After, up to 10 s), for network errors, timeouts,
         HTTP 408/429/5xx and invalid replies. Any other refusal is final.
Paths: every file and folder must be outside the repository (or under its git-ignored data/).

Exit codes: 0 done
            1 bad input, also when the function rejects a call (HTTP 400/404/413..., or a redirect)
            2 stopped: ticket or anon key refused (401/403), triage off (skipped), Jev failing inside
              the function (item error auth/credits/no_route/bad_request), or ${MAX_FAILED_IN_A_ROW} failed calls in a row
            3 done but some items failed (rerun with --resume)`;

/* ===================== أدوات مشتركة (يستوردها report.mjs أيضاً) ===================== */

// --name value  أو  --name=value. الأنواع: string | int | number | bool | list (يتكرر).
export function parseArgs(argv, flags) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const m = /^--([a-z][a-z0-9-]*)(?:=([\s\S]*))?$/.exec(argv[i]);
        if (!m) throw new Fatal(`unexpected argument: ${argv[i]} (see --help)`);
        const [, name, inline] = m;
        const type = flags[name];
        if (!type) throw new Fatal(`unknown option --${name} (see --help)`);
        if (type === 'bool') {
            if (inline !== undefined) throw new Fatal(`--${name} takes no value`);
            out[name] = true;
            continue;
        }
        let value = inline;
        if (value === undefined) {
            if (i + 1 >= argv.length) throw new Fatal(`--${name} needs a value`);
            value = argv[++i];
        }
        if (type === 'int') {
            if (!/^\d+$/.test(value)) throw new Fatal(`--${name} must be a whole number`);
            value = Number(value);
        } else if (type === 'number') {
            if (!/^\d+(\.\d+)?$/.test(value)) throw new Fatal(`--${name} must be a number`);
            value = Number(value);
        }
        if (type === 'list') (out[name] ||= []).push(value);
        else out[name] = value;
    }
    return out;
}

// JSONL: سطر لكل كائن، مع تحمّل BOM وCRLF والأسطر الفارغة. لا يُطبع محتوى أي سطر (قد يكون نص رسالة حقيقية).
// lenient: تُعدّ الأسطر التالفة بدل الفشل — لملفات النتائج التي قد ينقطع آخر سطر فيها.
export function readJsonl(file, what, { lenient = false } = {}) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new Fatal(`cannot read the ${what} (${file}): ${e.code || e.message}`);
    }
    const rows = [], bad = [];
    raw.replace(/^﻿/, '').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim()) return;
        try {
            rows.push({ line: i + 1, value: JSON.parse(line) });
        } catch {
            bad.push(i + 1);
        }
    });
    if (bad.length && !lenient) {
        throw new Fatal(`${what}: line ${bad[0]} is not valid JSON${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}`);
    }
    return { rows, bad };
}

export const idOf = (v) => (v && (typeof v.id === 'string' || typeof v.id === 'number') ? String(v.id).trim() : '');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function isUnder(child, parent) {
    const rel = path.relative(parent, child);
    return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
}

// المستودع عام: لا نتائج ولا تذكرة ولا مفاتيح داخله، إلا تحت data/ الذي يتجاهله git.
export function assertOutsideRepo(p, what) {
    if (!fs.existsSync(path.join(REPO, '.git'))) return; // نسخة منقولة خارج المستودع: لا شيء نحميه
    const abs = path.resolve(p);
    if (isUnder(abs, REPO) && !isUnder(abs, path.join(REPO, 'data'))) {
        throw new Fatal(`${what} is inside the repository (${abs}). The repo is public: keep eval data, results, `
            + 'tickets and keys outside it (e.g. the scratchpad), or under data/ which git ignores.');
    }
}

export const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* ===================== المدخلات ===================== */

export function readItems(file) {
    const { rows } = readJsonl(file, 'items file');
    const items = [], firstLine = new Map(), problems = [];
    let unknownKinds = 0;
    for (const { line, value: v } of rows) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) { problems.push(`line ${line}: not an object`); continue; }
        const id = idOf(v);
        if (!id) { problems.push(`line ${line}: missing id`); continue; }
        if (typeof v.text !== 'string' || !v.text.trim()) { problems.push(`line ${line}: missing text`); continue; }
        if (firstLine.has(id)) { problems.push(`line ${line}: duplicate id (first on line ${firstLine.get(id)})`); continue; }
        firstLine.set(id, line);
        const regexKind = typeof v.regex_kind === 'string' ? v.regex_kind : '';
        if (!KNOWN_KINDS.has(regexKind)) unknownKinds++;
        items.push({
            id,
            text: v.text,
            group: typeof v.group === 'string' ? v.group : '',
            regex_kind: regexKind,
            split: typeof v.split === 'string' ? v.split : ''
        });
    }
    if (problems.length) {
        throw new Fatal(`the items file has ${problems.length} bad line(s):\n  ${problems.slice(0, 10).join('\n  ')}`);
    }
    return { items, unknownKinds };
}

// ملف سرّ بسطر واحد من حروف base64/base64url: تصلح في ترويسة HTTP (fetch يذكر القيمة الخاطئة في رسالة خطئه)،
// ولا يغيّرها JSON.stringify فيبقى حجبها في الأسطر المحفوظة ممكناً.
function readTokenFile(file, what) {
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        throw new Fatal(`cannot read the ${what} file (${file}): ${e.code || e.message}`);
    }
    const value = raw.replace(/^﻿/, '').trim();
    if (!value) throw new Fatal(`the ${what} file is empty (${file})`);
    if (/\s/.test(value)) throw new Fatal(`the ${what} file must hold one line without spaces (${file})`);
    if (!/^[A-Za-z0-9._~+/=-]+$/.test(value)) {
        throw new Fatal(`the ${what} file must hold one token of letters, digits and . _ ~ + / = - only (${file})`);
    }
    return value;
}

// بوابة Supabase مع verify_jwt لا تفهم إلا المفاتيح القديمة بصيغة JWT؛ ومفتاح الخدمة لا مكان له هنا أبداً.
function readAnonKey(file) {
    const value = readTokenFile(file, 'anon key');
    if (/^sb_secret_/.test(value)) {
        throw new Fatal(`the anon key file holds a SECRET key (sb_secret_...). Never use it here; delete that file (${file}).`);
    }
    if (/^sb_publishable_/.test(value)) {
        throw new Fatal('the anon key file holds the publishable key (sb_publishable_...), which is not a JWT: the gateway '
            + '(verify_jwt) answers "Invalid JWT". Use the legacy anon key (eyJ...) - see README.');
    }
    const parts = value.split('.');
    let payload = null;
    if (parts.length === 3) {
        try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { payload = null; }
    }
    if (!payload || typeof payload !== 'object') {
        throw new Fatal(`the anon key file does not hold a JWT (expected the legacy anon key, eyJ...) (${file})`);
    }
    if (payload.role === 'service_role') {
        throw new Fatal(`the anon key file holds the service_role key. Never put it in a file for this tool; delete it (${file}).`);
    }
    if (payload.role !== 'anon') warn(`the anon key file holds a JWT with role "${payload.role ?? '(none)'}", expected "anon"`);
    return value;
}

/* ===================== التذكرة ===================== */

function makeTicket(args) {
    const file = args['ticket-file'];
    if (!file) throw new Fatal('--make-ticket needs --ticket-file <path>');
    assertOutsideRepo(file, 'the ticket file');
    const maxItems = args['max-items'] ?? 2000;
    const days = args.days ?? 3;
    if (maxItems < 1) throw new Fatal('--max-items must be at least 1');
    if (!(days > 0)) throw new Fatal('--days must be above 0');
    let token;
    if (fs.existsSync(file)) {
        token = readTokenFile(file, 'ticket');
        console.log(`Using the token already in ${file} (not printed). Delete that file first to make a new one.`);
    } else {
        token = crypto.randomBytes(32).toString('base64url');
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        console.log(`New ticket token written to ${file} (not printed). Keep that file private and out of the repo.`);
    }
    const note = String(args.note ?? `jev eval ${new Date().toISOString().slice(0, 10)}`).replace(/'/g, "''");
    console.log('\nRegister it once in the Supabase SQL editor (only the sha256 is stored):\n');
    console.log('insert into public.wa_triage_tickets (token_hash, note, max_items, expires_at)');
    console.log(`values ('${sha256Hex(token)}', '${note}', ${maxItems}, now() + interval '${days} days');`);
    console.log('\nEvery call uses one item per message it carries: a retried call and every extra --qset count again.');
    return EXIT.OK;
}

/* ===================== التشغيل ===================== */

const FLAGS = {
    items: 'string', qset: 'list', url: 'string', 'ticket-file': 'string', 'anon-key-file': 'string', out: 'string',
    batch: 'int', concurrency: 'int', limit: 'int', resume: 'bool', 'timeout-ms': 'int', 'dry-run': 'bool',
    'make-ticket': 'bool', 'max-items': 'int', days: 'number', note: 'string', help: 'bool'
};

const log = (...a) => console.log(...a);
function warn(msg) { console.error(`warning: ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finiteOr0 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
// كلفة Jev بأجزاء من المليون من الدولار: التقريب لست خانات يمحوها، فنقرّب لعشر خانات (ضجيج الجمع العشري فقط).
const roundUsd = (x) => Math.round(x * 1e10) / 1e10;
const fmtUsd = (x) => `$${Number(x.toPrecision(4))}`;

// كل نص يأتي من الخارج يمرّ من هنا قبل طباعته أو حفظه، فلا تظهر التذكرة ولا المفتاح ولو أعادهما الخادم.
let scrub = (s) => String(s ?? '');
function setSecrets(secrets) {
    const list = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
    scrub = (s) => {
        let out = String(s ?? '');
        for (const v of list) out = out.split(v).join('[redacted]');
        return out;
    };
}

function checkUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { throw new Fatal(`--url is not a valid URL: ${raw}`); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
        throw new Fatal('--url must use https (plain http is allowed only for localhost): the ticket travels in a header');
    }
    return u.toString();
}

async function main(argv) {
    const args = parseArgs(argv, FLAGS);
    if (args.help) { log(USAGE); return EXIT.OK; }
    if (args['make-ticket']) return makeTicket(args);

    if (!args.items) throw new Fatal(`--items is required\n\n${USAGE}`);
    if (!args.out) throw new Fatal(`--out is required\n\n${USAGE}`);
    const dryRun = !!args['dry-run'];
    const resume = !!args.resume;
    const qsets = [...new Set(args.qset?.length ? args.qset : ['wa-1'])];
    const byLower = new Map();
    for (const q of qsets) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(q)) throw new Fatal(`bad --qset name: ${q}`);
        // ويندوز لا يفرّق بين حالتي الحروف في أسماء الملفات: wa-1 وWA-1 ملف نتائج واحد
        const k = q.toLowerCase();
        if (byLower.has(k)) throw new Fatal(`--qset ${byLower.get(k)} and --qset ${q} differ only in letter case: they would share one results file`);
        byLower.set(k, q);
    }
    let batch = args.batch ?? MAX_BATCH;
    if (batch < 1) throw new Fatal('--batch must be at least 1');
    if (batch > MAX_BATCH) { warn(`--batch ${batch} is above the function's limit; using ${MAX_BATCH}`); batch = MAX_BATCH; }
    const concurrency = args.concurrency ?? 2;
    if (concurrency < 1 || concurrency > 8) throw new Fatal('--concurrency must be 1..8');
    const timeoutMs = args['timeout-ms'] ?? 150000;
    if (timeoutMs < 1000) throw new Fatal('--timeout-ms must be at least 1000');
    const url = checkUrl(args.url ?? DEFAULT_URL);

    assertOutsideRepo(args.out, 'the --out folder');
    assertOutsideRepo(args.items, 'the items file');
    // ملفات النتائج كلها تُفحص قبل أول نداء، وفي --dry-run أيضاً: لا تُرسل مجموعة أسئلة (نداءات مدفوعة تخصم من التذكرة)
    // ثم يُرفض التشغيل عند مجموعة بعدها لأن ملفها موجود.
    if (!resume) {
        const existing = qsets.map((q) => path.join(args.out, `${q}.jsonl`)).filter((f) => fs.existsSync(f));
        if (existing.length) {
            throw new Fatal(`${existing.length === 1 ? `${existing[0]} already exists` : `these results files already exist: ${existing.join(', ')}`}. `
                + `Nothing was sent. Use --resume to continue ${existing.length === 1 ? 'it' : 'them'}, or pick another --out folder.`);
        }
    }
    const { items, unknownKinds } = readItems(args.items);
    if (unknownKinds) warn(`${unknownKinds} item(s) have a regex_kind outside offer/update/document/wanted/other`);
    const selected = args.limit !== undefined ? items.slice(0, args.limit) : items;

    let ticket = null, anon = null;
    if (!dryRun) {
        if (!args['ticket-file']) throw new Fatal('--ticket-file is required (README: "creating a ticket")');
        if (!args['anon-key-file']) {
            throw new Fatal('--anon-key-file is required: the function is deployed with verify_jwt, so the gateway needs the anon JWT');
        }
        assertOutsideRepo(args['ticket-file'], 'the ticket file');
        assertOutsideRepo(args['anon-key-file'], 'the anon key file');
        ticket = readTokenFile(args['ticket-file'], 'ticket');
        if (ticket.length < 16) throw new Fatal('the ticket token is too short (16 characters at least)');
        anon = readAnonKey(args['anon-key-file']);
        setSecrets([ticket, anon]);
        fs.mkdirSync(args.out, { recursive: true });
    }

    const ctx = { url, ticket, anon, timeoutMs, batch, concurrency, dryRun, resume, out: args.out, itemsFile: args.items };
    let partial = false;
    for (const qset of qsets) {
        const code = await runQset(ctx, qset, selected);
        if (code === EXIT.STOPPED || code === EXIT.INPUT) return code; // توقف: لا تُبدأ المجموعات التالية
        if (code === EXIT.PARTIAL) partial = true;
    }
    return partial ? EXIT.PARTIAL : EXIT.OK;
}

// المعرّفات التي لها نتيجة ok في ملف النتائج: يتخطاها --resume. سطر أخير مقطوع (انقطاع سابق) لا يُفشل الاستئناف.
function doneIds(file) {
    const { rows, bad } = readJsonl(file, `results file ${path.basename(file)}`, { lenient: true });
    if (bad.length) warn(`${path.basename(file)}: ${bad.length} unreadable line(s) ignored`);
    const done = new Set();
    for (const { value: r } of rows) if (r && r.type === 'item' && r.ok === true && typeof r.id === 'string') done.add(r.id);
    return done;
}

function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

async function runQset(ctx, qset, selected) {
    const file = path.join(ctx.out, `${qset}.jsonl`);
    const exists = fs.existsSync(file);
    // main فحص الملفات قبل أول نداء؛ هنا ملف ظهر بعد ذلك (تشغيل آخر يكتب في المجلد نفسه): لا نخلط التشغيلين.
    if (exists && !ctx.resume && !ctx.dryRun) {
        throw new Fatal(`${file} appeared after this run started (another run writing to the same --out folder?). `
            + 'Use --resume to continue it, or pick another --out folder.');
    }
    const done = exists && ctx.resume ? doneIds(file) : new Set();
    const todo = selected.filter((it) => !done.has(it.id));
    const batches = chunk(todo, ctx.batch).map((items, i) => ({ no: i + 1, items }));
    log(`[${qset}] ${selected.length} item(s) selected, ${selected.length - todo.length} already done, `
        + `${todo.length} to send in ${batches.length} call(s) of up to ${ctx.batch}`);
    if (ctx.dryRun || !batches.length) {
        if (!batches.length) log(`[${qset}] nothing to send`);
        return EXIT.OK;
    }

    const run = new Date().toISOString();
    // الحجب على السطر كله: لو أعاد الخادم سرّاً داخل ItemResult لا يصل إلى الملف. الرمز والمفتاح من حروف base64url
    // فاستبدالهما لا يكسر JSON.
    const write = (rec) => fs.appendFileSync(file, scrub(JSON.stringify(rec)) + '\n', 'utf8');
    write({
        type: 'run', qset, run, url: ctx.url, items_file: path.basename(ctx.itemsFile), selected: selected.length,
        to_send: todo.length, batch: ctx.batch, concurrency: ctx.concurrency, resume: ctx.resume, tool: TOOL, node: process.version
    });
    const state = {
        qset, run, write, total: batches.length, okItems: 0, failedItems: 0, itemsSent: 0, retries: 0,
        tokens: 0, cost: 0, failedInARow: 0, stop: null, unexpectedRefs: 0, warnedQset: false
    };
    const queue = batches.slice();
    const worker = async () => {
        while (!state.stop && queue.length) await runBatch(ctx, state, queue.shift());
    };
    await Promise.all(Array.from({ length: Math.min(ctx.concurrency, batches.length) }, worker));

    // لم يُعالَج: دفعة رُفضت (401/403/skipped) أو لم تُرسل بعد التوقف. --resume يرسلها.
    const notProcessed = todo.length - state.okItems - state.failedItems;
    write({
        type: 'run_end', qset, run, ended_at: new Date().toISOString(), ok_items: state.okItems, failed_items: state.failedItems,
        not_processed: notProcessed, items_sent: state.itemsSent, retries: state.retries, input_tokens: state.tokens,
        cost_usd: roundUsd(state.cost), stopped: state.stop ? state.stop.reason : null
    });
    if (state.unexpectedRefs) warn(`[${qset}] the server returned ${state.unexpectedRefs} result(s) for refs that were not sent`);
    log(`[${qset}] ${state.okItems} ok, ${state.failedItems} failed, ${notProcessed} not processed · ${state.retries} retried call(s) · `
        + `items sent incl. retries ${state.itemsSent} · ${state.tokens} input tokens · ${fmtUsd(state.cost)} · ${file}`);
    if (state.stop) {
        console.error(stopMessage(state.stop, file));
        // رفض الوظيفة للطلب نفسه (400، 404، تحويل...) مدخلات خاطئة؛ غيره توقف
        return state.stop.reason === 'rejected' ? EXIT.INPUT : EXIT.STOPPED;
    }
    if (state.failedItems) log(`[${qset}] rerun with --resume to send the failed items again`);
    return state.failedItems ? EXIT.PARTIAL : EXIT.OK;
}

async function runBatch(ctx, state, b) {
    const body = JSON.stringify({
        action: 'triage',
        qset: state.qset,
        items: b.items.map((it) => ({ ref: it.id, text: it.text, group: it.group, regex_kind: it.regex_kind }))
    });
    let res = await callOnce(ctx, body);
    state.itemsSent += b.items.length;
    let attempts = 1, firstError = null;
    if (res.kind === 'fail' && !state.stop) {
        firstError = res.error;
        state.retries++;
        // Retry-After من الخادم (429 غالباً) يُحترم حتى 10 ث؛ بدونه ثانيتان
        const retryAfter = res.retryAfterMs ?? null;
        const wait = retryAfter === null ? RETRY_DELAY_MS : Math.min(retryAfter, MAX_RETRY_AFTER_MS);
        log(`[${state.qset}] call ${b.no}/${state.total} failed (${res.error}); retrying in ${Math.round(wait / 100) / 10} s`
            + `${retryAfter === null ? '' : ' (Retry-After)'}`);
        await sleep(wait);
        if (!state.stop) {
            res = await callOnce(ctx, body);
            state.itemsSent += b.items.length;
            attempts = 2;
        }
    }

    const base = { qset: state.qset, run: state.run, batch: b.no, at: new Date().toISOString() };
    const ids = b.items.map((it) => it.id);
    const head = `[${state.qset}] call ${b.no}/${state.total} · ${ids.length} item(s) · ${res.ms} ms`;

    if (res.kind === 'fatal') {
        // لم تُعالَج عناصر هذه الدفعة: لا أسطر لها، و--resume يرسلها لاحقاً.
        if (!state.stop) state.stop = res;
        state.write({ type: 'batch', ...base, n: ids.length, ids, attempts, http: res.http, latency_ms: res.ms, status: 'stopped', error: res.error, first_error: firstError });
        log(`${head} · stopped (${res.error})`);
        return;
    }
    if (res.kind === 'fail') {
        state.failedItems += ids.length;
        for (const id of ids) state.write({ type: 'item', ...base, id, ok: false, error: `batch_failed: ${res.error}`, result: null });
        state.write({ type: 'batch', ...base, n: ids.length, ids, attempts, http: res.http, latency_ms: res.ms, status: 'failed', error: res.error, first_error: firstError });
        log(`${head} · ${attempts === 2 ? 'failed again' : 'failed, not retried (run stopping)'} (${res.error})`);
        failedCall(state, res.http, res.error, false);
        return;
    }

    const data = res.data;
    const byRef = new Map();
    for (const r of data.items) if (r && typeof r === 'object' && typeof r.ref === 'string') byRef.set(r.ref, r);
    const sent = new Set(ids);
    for (const ref of byRef.keys()) if (!sent.has(ref)) state.unexpectedRefs++;
    // رد 200 لا يعني أن Jev أجاب: الوظيفة تردّ أخطاء OpenRouter (المفتاح، الرصيد، النموذج، المهلة) داخل العناصر.
    // asked: العناصر التي تحتاج Jev (كلها عدا document، فحكمه من الكود)، وunanswered: ما بقي منها بلا جواب، ومنه
    // نتيجة ok بلا نية (حكم review ["error"] في المواصفة §6).
    const docs = new Set(b.items.filter((it) => it.regex_kind === 'document').map((it) => it.id));
    const kinds = new Map();
    let ok = 0, bad = 0, asked = 0, unanswered = 0, down = null;
    for (const id of ids) {
        const r = byRef.get(id);
        const needsJev = !docs.has(id);
        if (needsJev) asked++;
        if (r && r.ok === true) {
            ok++;
            state.write({ type: 'item', ...base, id, ok: true, result: r });
            if (needsJev && !(r.intent && typeof r.intent.choice === 'string')) {
                unanswered++;
                kinds.set('no_intent', (kinds.get('no_intent') ?? 0) + 1);
            }
        } else {
            bad++;
            const error = r ? scrub(r.error ?? 'error').slice(0, 200) : 'missing_in_response';
            state.write({ type: 'item', ...base, id, ok: false, error, result: r ?? null });
            if (needsJev) unanswered++;
            kinds.set(error, (kinds.get(error) ?? 0) + 1);
            if (!down && JEV_DOWN.has(error)) down = error;
        }
    }
    const usage = data.usage && typeof data.usage === 'object' ? data.usage : null;
    state.okItems += ok;
    state.failedItems += bad;
    state.tokens += finiteOr0(usage?.input_tokens);
    state.cost += finiteOr0(usage?.cost_usd);
    if (typeof data.qset === 'string' && data.qset !== state.qset && !state.warnedQset) {
        state.warnedQset = true;
        warn(`[${state.qset}] the server answered with qset "${data.qset}"; results are still filed under "${state.qset}"`);
    }
    state.write({
        type: 'batch', ...base, n: ids.length, ids, attempts, http: res.http, latency_ms: res.ms, status: 'success',
        served_qset: typeof data.qset === 'string' ? data.qset : null, model: typeof data.model === 'string' ? data.model : null,
        usage, spent_today_usd: data.spent_today_usd ?? null, cap_usd: data.cap_usd ?? null, first_error: firstError
    });
    log(`${head} · ok ${ok}${bad ? ` · failed ${bad}` : ''}${kinds.size ? ` (${tally(kinds)})` : ''}`
        + ` · ${usage?.input_tokens ?? '?'} tokens · ${fmtUsd(finiteOr0(usage?.cost_usd))}`);

    if (down && !state.stop) {
        state.stop = { kind: 'fatal', reason: 'jev', http: res.http, jevError: down, error: `Jev failed inside the function (item error "${down}")` };
    }
    // نداء أغلب عناصره بلا جواب فاشل كنداء لم يصل؛ والعدّاد لا يُصفَّر إلا بنداء أجاب Jev فيه عن أكثرها.
    // نداء كل عناصره document لا يقول شيئاً عن Jev فلا يغيّر العدّاد.
    if (asked) {
        if (unanswered * 2 > asked) failedCall(state, res.http, `${unanswered} of ${asked} item(s) without an answer: ${tally(kinds)}`, true);
        else state.failedInARow = 0;
    }
}

const tally = (m) => [...m].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');

// نداء فاشل: الثالث على التوالي يوقف التشغيل. items: الفشل في عناصر رد 200 (Jev) لا في النداء نفسه.
function failedCall(state, http, error, items) {
    state.failedInARow++;
    if (state.failedInARow >= MAX_FAILED_IN_A_ROW && !state.stop) {
        state.stop = { kind: 'fatal', reason: 'failures', http, items, error: `${MAX_FAILED_IN_A_ROW} calls in a row failed (last: ${error})` };
    }
}

// Retry-After بالثواني أو بتاريخ HTTP، بالمللي ثانية، أو null.
function retryAfterMs(headers) {
    const raw = (headers.get('retry-after') ?? '').trim();
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw) * 1000;
    const at = Date.parse(raw);
    return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

// نداء واحد. الناتج: ok | fail (يُعاد مرة: شبكة، مهلة، 408، 429، 5xx، رد غير صالح) | fatal (لا فائدة من الإعادة:
// 401/403، «skipped»، أو رفض ثابت للطلب نفسه: 4xx أخرى أو تحويل).
async function callOnce(ctx, body) {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.anon}`,
        apikey: ctx.anon,
        'x-triage-ticket': ctx.ticket,
        'x-client-info': TOOL
    };
    const t0 = performance.now();
    let resp, text;
    try {
        // redirect: manual — fetch يتبع التحويل افتراضياً وترويسة التذكرة معه، ولو إلى مضيف آخر أو إلى http.
        resp = await fetch(ctx.url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(ctx.timeoutMs) });
        text = await resp.text();
    } catch (e) {
        const ms = Math.round(performance.now() - t0);
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
            return { kind: 'fail', http: null, ms, error: `timeout after ${Math.round(ctx.timeoutMs / 1000)} s` };
        }
        return { kind: 'fail', http: null, ms, error: `network: ${scrub(e?.cause?.code || e?.message || e).slice(0, 200)}` };
    }
    const ms = Math.round(performance.now() - t0);
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    const moved = resp.status >= 300 && resp.status < 400;
    const message = scrub(
        moved
            ? `redirect to ${resp.headers.get('location') || '(no Location header)'}`
            : (data && (data.message ?? data.msg ?? data.error?.message ?? (typeof data.error === 'string' ? data.error : null)))
                ?? text.slice(0, 200)
    ).replace(/\s+/g, ' ').slice(0, 200);
    if (resp.status === 401 || resp.status === 403) {
        return {
            kind: 'fatal', reason: 'auth', http: resp.status, ms, message,
            fromFunction: !!(data && data.status === 'error'), error: `http ${resp.status}: ${message}`
        };
    }
    const httpError = `http ${resp.status}${message ? `: ${message}` : ''}`;
    if (resp.status === 408 || resp.status === 429 || resp.status >= 500) {
        return { kind: 'fail', http: resp.status, ms, retryAfterMs: retryAfterMs(resp.headers), error: httpError };
    }
    // 400 (مجموعة أسئلة أو عنصر غير صالح)، 404 (رابط خاطئ)، 413، تحويل...: الإعادة تعطي الرد نفسه. الوظيفة تتحقق من
    // الطلب قبل أن تخصم من التذكرة، فعناصر النداء لم تُعالَج و--resume يرسلها بعد الإصلاح.
    if (!resp.ok) return { kind: 'fatal', reason: 'rejected', http: resp.status, ms, message, error: httpError };
    if (!data || typeof data !== 'object') return { kind: 'fail', http: resp.status, ms, error: 'response is not JSON' };
    if (data.status === 'skipped') return { kind: 'fatal', reason: 'skipped', http: resp.status, ms, message, error: `skipped: ${message}` };
    if (data.status !== 'success' || !Array.isArray(data.items)) {
        return { kind: 'fail', http: resp.status, ms, error: `status ${scrub(data.status)}${message ? `: ${message}` : ''}` };
    }
    return { kind: 'ok', http: resp.status, ms, data };
}

// ما يُصلح كل خطأ عنصر يعني أن Jev معطّل في الوظيفة (JEV_DOWN).
const JEV_DOWN_HINT = {
    auth: "OpenRouter refused the function's key: check the OPENROUTER_API_KEY secret of the project in Supabase.",
    credits: 'OpenRouter reports no credits left for OPENROUTER_API_KEY: top up the OpenRouter account.',
    no_route: 'OpenRouter has no route for the model: check AGENT_TRIAGE_MODEL (default typesafe/jev-1.13) and that TypeSafe still serves it.',
    bad_request: 'OpenRouter rejected the Jev request itself: check the question set (--qset; supabase/functions/_shared/jev/questions.ts). '
        + 'If it is always the same message (its item record carries error "bad_request"), take that item out of the items file.'
};

function rejectHint(http) {
    if (http >= 300 && http < 400) {
        return 'The URL redirects, and this tool does not follow redirects (the ticket header would go along): pass the final https URL with --url.';
    }
    if (http === 404) return 'Wrong --url, or the wa-triage function is not deployed.';
    if (http === 413) return 'The call is too large for the gateway: use a smaller --batch.';
    if (http === 400 || http === 422) {
        return 'The function refused the request itself: --qset must be a key of QSETS in supabase/functions/_shared/jev/questions.ts, '
            + 'and every item needs a unique id of at most 200 characters and a text.';
    }
    return 'Check --url and the function logs.';
}

function stopMessage(stop, file) {
    const lines = [];
    if (stop.reason === 'auth') {
        lines.push(`Stopped: the function answered HTTP ${stop.http}${stop.message ? ` ("${stop.message}")` : ''}.`);
        if (stop.fromFunction) {
            lines.push('The eval ticket was refused: unknown token, expired, or used up (used_items + items in the call > max_items).',
                'Check it with the SQL in scripts/jev-eval/README.md, or make a new one with --make-ticket.');
        } else {
            lines.push('The Supabase gateway refused the anon key (the function is deployed with verify_jwt).',
                "--anon-key-file must hold the project's legacy anon JWT (eyJ...); the sb_publishable_... key is not accepted there.");
        }
    } else if (stop.reason === 'skipped') {
        lines.push(`Stopped: the function skipped the call ("${stop.message}"). Jev triage is off (crm_settings `
            + 'wa_triage_mode = "off") or unavailable; retrying will not help.');
    } else if (stop.reason === 'rejected') {
        lines.push(`Stopped: the function rejected the call (HTTP ${stop.http}${stop.message ? `: "${stop.message}"` : ''}); `
            + 'retrying would get the same answer, so nothing was retried.', rejectHint(stop.http));
    } else if (stop.reason === 'jev') {
        lines.push(
            `Stopped: Jev failed inside the function with item error "${stop.jevError}". Every later call would fail the same way and still use the ticket.`,
            JEV_DOWN_HINT[stop.jevError] ?? 'Check the function logs.',
            'The newest wa_triage_calls rows (column error) hold the provider message.'
        );
    } else if (stop.items) {
        lines.push(`Stopped: ${stop.error}. The newest wa_triage_calls rows (column error) hold the provider message.`,
            'If the items failed with rate_limit, timeout or deadline, a lower --concurrency or --batch can help.');
    } else {
        lines.push(`Stopped: ${stop.error}. Check the function logs, then rerun with --resume.`);
    }
    lines.push(`Results so far are in ${file}; rerun with --resume to send only what is missing.`);
    return lines.join('\n');
}

const isMain = import.meta.main
    ?? (!!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase());

if (isMain) {
    main(process.argv.slice(2)).then(
        (code) => { process.exitCode = code; },
        (e) => {
            if (e instanceof Fatal) console.error(`error: ${scrub(e.message)}`);
            else console.error(scrub(e?.stack || e));
            process.exitCode = e instanceof Fatal ? e.code : EXIT.INPUT;
        }
    );
}
