// Run: node tests/deploy-zoho-link.test.mjs
//
// بوابة نشر zoho-link وmaqsam-sync: من main وحده، بموافقة المالك في production، بإصدارات مثبّتة، والرمز في الخطوات التي تحتاجه فقط، وzoho-link لا تُعفى
// من verify_jwt بينما maqsam-sync تأخذ --no-verify-jwt في أمر نشرها، ولا يمس أحدهما config.toml. وخطوات bash نفسها تُشغَّل هنا بـ curl مزيّف.
// نسخة العمل على ويندوز قد تكون CRLF، فتُطبَّع إلى LF قبل أي تحليل. لا مكتبات: يقرأ YAML نصاً كما يفعل deploy-maqsam-link.test.mjs.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function t(name, cond) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name); }
}

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const noComments = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const raw = read('deploy-zoho-link.yml');
const workflow = noComments(raw);
const reference = noComments(read('deploy-agent-run.yml'));
const maqsamWorkflow = noComments(read('deploy-maqsam-link.yml'));
const repoText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const WORKFLOW_PATH = '.github/workflows/deploy-zoho-link.yml';
const ZOHO_PATH = 'supabase/functions/zoho-link';
const SYNC_PATH = 'supabase/functions/maqsam-sync';
const SHARED_PATH = 'supabase/functions/maqsam-link';
const REPO_GUARD = "if: github.repository == 'mohammedalseari-design/mulaem-dash' && github.ref == 'refs/heads/main'";

const top = workflow.slice(0, workflow.indexOf('\njobs:\n'));
const gate = workflow.slice(workflow.indexOf('\n  gate:\n'), workflow.indexOf('\n  deploy:\n'));
const deploy = workflow.slice(workflow.indexOf('\n  deploy:\n'));
const stepsOf = (job) => job.split(/^ {6}- /m).slice(1);
const headOf = (job) => job.split(/^ {4}steps:$/m)[0];
const labelOf = (step) => /^name: (.+)$/m.exec(step)?.[1] ?? /^uses: ([^@\s]+)@/.exec(step)?.[1];
const gateSteps = stepsOf(gate);
const deploySteps = stepsOf(deploy);
const stepNamed = (name) => deploySteps.find((step) => labelOf(step) === name);

const RECORD = 'Record the live versions';
const DEPLOY_ZOHO = 'Deploy zoho-link';
const DEPLOY_SYNC = 'Deploy maqsam-sync';
const VERIFY_ZOHO = 'Verify zoho-link is live and verify_jwt is true';
const VERIFY_SYNC = 'Verify maqsam-sync is live and verify_jwt is false';
const TESTS = 'Type-check and test zoho-link and maqsam-sync';

/* ---------- متى يعمل ---------- */

t('the trigger is exactly a push to main on the two functions, what they import, and this workflow',
    workflow.slice(workflow.indexOf('\non:\n') + 1, workflow.indexOf('\npermissions:')).trim() === [
        'on:',
        '  push:',
        '    branches: [main]',
        '    paths:',
        `      - '${ZOHO_PATH}/**'`,
        `      - '${SYNC_PATH}/**'`,
        `      - '${SHARED_PATH}/**'`,
        `      - '${WORKFLOW_PATH}'`,
    ].join('\n'));
for (const trigger of ['pull_request_target', 'pull_request', 'workflow_run', 'workflow_dispatch', 'repository_dispatch', 'schedule', 'issue_comment']) {
    t(`no ${trigger} trigger anywhere`, !raw.includes(trigger));
}
t('supabase/config.toml is not a trigger', !top.includes('config.toml'));
t('nothing in the workflow touches supabase/config.toml', !workflow.includes('config.toml'));
t('config.toml still says nothing about these functions: touching it wakes deploy-agent-run',
    !repoText('supabase/config.toml').includes('zoho') && !repoText('supabase/config.toml').includes('maqsam'));
t('deploy-agent-run does not wake up for these functions', !reference.includes('zoho-link') && !reference.includes('maqsam-sync'));
t('deploy-maqsam-link does not wake up for these functions', !maqsamWorkflow.includes('zoho-link') && !maqsamWorkflow.includes('maqsam-sync'));
t('both jobs run only on main of this repository',
    headOf(gate).includes(REPO_GUARD) && headOf(deploy).includes(REPO_GUARD));

// كل ما تستورده الوظيفتان من خارج مجلديهما مسارٌ في الإجراء، وإلا نُشرت نسخة قديمة منه بلا تنبيه
const importsOf = (path) => [...repoText(path).matchAll(/from "\.\.\/([a-z_-]+)\//g)].map((match) => match[1]);
const importedFolders = new Set([
    ...['zoho-link/core.ts', 'zoho-link/notes.ts', 'zoho-link/store.ts', 'zoho-link/handler.ts', 'zoho-link/index.ts', 'maqsam-sync/tick.ts', 'maqsam-sync/index.ts']
        .flatMap((file) => importsOf(`supabase/functions/${file}`)),
]);
t('every folder the two functions import from is in the path list',
    importedFolders.size > 0 && [...importedFolders].every((folder) => top.includes(`supabase/functions/${folder}/**`)));

/* ---------- الموافقة والصلاحيات ---------- */

t('deploy waits behind the production environment', /^ {4}environment: production$/m.test(headOf(deploy)));
t('deploy needs gate', /^ {4}needs: gate$/m.test(headOf(deploy)));
t('gate has no environment: it runs before the approval', !gate.includes('environment:'));
t('gate holds no secret', !gate.includes('secrets.'));
t('deploys never overlap and are never cut off',
    /^ {6}group: deploy-zoho-link$/m.test(headOf(deploy)) && /^ {6}cancel-in-progress: false$/m.test(headOf(deploy)));
t('the workflow default permission is read-only', /^permissions:\n {2}contents: read\n/m.test(top));
t('deploy takes no extra permission', !headOf(deploy).includes('permissions:'));
t('only gate can write, and only to cancel older runs',
    [...workflow.matchAll(/^\s+([a-z-]+): write$/gm)].map((match) => match[1]).join() === 'actions'
    && /permissions:\n {6}contents: read\n {6}actions: write\n/.test(headOf(gate)));
t('gate cancels only runs of this workflow', gateSteps[0].includes('--workflow deploy-zoho-link.yml'));
t('gate writes the Arabic summary for the owner on the approval page',
    labelOf(gateSteps[1]).includes('Arabic summary') && gateSteps[1].includes('$GITHUB_STEP_SUMMARY')
    && gateSteps[1].includes('## ما الذي سيُنشر في الربط مع Zoho ونقل الملخصات'));
t('the summary lists only these functions and this workflow',
    [ZOHO_PATH, SYNC_PATH, SHARED_PATH].every((path) => gateSteps[1].includes(`startswith("${path}/")`)) && gateSteps[1].includes(`. == "${WORKFLOW_PATH}"`));
t('the summary says to approve the migration first', gateSteps[1].includes('**migrate**') && gateSteps[1].includes('أولاً') && gateSteps[1].includes('042'));
t('the summary says the deploy writes nothing in Zoho', gateSteps[1].includes('لا يكتب شيئاً في Zoho'));

/* ---------- الإصدارات المثبّتة ---------- */

const usesOf = (text) => [...text.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1]);
const uses = usesOf(workflow);
t('every action is pinned to a full commit SHA', uses.length === 3 && uses.every((use) => /^[\w./-]+@[0-9a-f]{40}$/.test(use)));
const pinned = new Map(usesOf(reference).map((use) => use.split('@')));
t('the same SHAs as deploy-agent-run', uses.every((use) => pinned.get(use.split('@')[0]) === use.split('@')[1]));
t('the same tool versions as deploy-agent-run',
    /deno-version: 2\.9\.7/.test(workflow) && /deno-version: 2\.9\.7/.test(reference)
    && /version: 2\.119\.0/.test(workflow) && /version: 2\.119\.0/.test(reference));
const checkouts = deploySteps.filter((step) => step.startsWith('uses: actions/checkout@'));
t('every checkout drops the credentials',
    checkouts.length === 1 && workflow.match(/actions\/checkout@/g).length === 1 && checkouts.every((step) => step.includes('persist-credentials: false')));
t('no checkout of a pull request head or another ref', !workflow.includes('ref:') && !workflow.includes('repository:'));

/* ---------- الرمز ---------- */

const TOKEN_LINE = 'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}';
const NEEDS_TOKEN = ['Check the access token secret is set', RECORD, DEPLOY_ZOHO, DEPLOY_SYNC, VERIFY_ZOHO, VERIFY_SYNC];
t('the token sits only on the steps that need it',
    deploySteps.filter((step) => step.includes('SUPABASE_ACCESS_TOKEN: ')).map(labelOf).join() === NEEDS_TOKEN.join());
t('each of those steps carries it in its own env',
    NEEDS_TOKEN.every((name) => stepNamed(name)?.includes(`          ${TOKEN_LINE}\n`)));
t('it is not in the job env or the workflow env',
    !headOf(deploy).includes('SUPABASE_ACCESS_TOKEN') && !top.includes('SUPABASE_ACCESS_TOKEN'));
t('it is the only secret the workflow reads',
    [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].every((match) => match[1] === 'SUPABASE_ACCESS_TOKEN'));
t('the tests that read env run without it', !stepNamed(TESTS).includes('secrets.'));

/* ---------- ترتيب الخطوات ---------- */

t('the steps run in the safe order', deploySteps.map(labelOf).join('|') === [
    'actions/checkout',
    'Skip a run older than main',
    'Check the access token secret is set',
    'denoland/setup-deno',
    TESTS,
    'supabase/setup-cli',
    RECORD,
    DEPLOY_ZOHO,
    DEPLOY_SYNC,
    VERIFY_ZOHO,
    VERIFY_SYNC,
].join('|'));
const skipCondition = "        if: steps.freshness.outputs.stale != 'true'\n";
for (const name of ['Check the access token secret is set', 'denoland/setup-deno', TESTS, 'supabase/setup-cli', RECORD, DEPLOY_ZOHO, DEPLOY_SYNC]) {
    t(`${name} is skipped for stale runs`, deploySteps.find((step) => labelOf(step) === name)?.includes(skipCondition));
}
t('only first attempts check freshness; explicit rollback reruns bypass it',
    stepNamed('Skip a run older than main').includes("        if: github.run_attempt == '1'\n"));
for (const name of [VERIFY_ZOHO, VERIFY_SYNC]) {
    t(`${name} requires a successful live-version read and runs even after a failed deploy`,
        stepNamed(name).includes("if: ${{ !cancelled() && steps.before.outcome == 'success' }}"));
}

/* ---------- الأوامر ---------- */

t('the deno check and the tests come before the deploy, on both functions and what they import',
    stepNamed(TESTS).includes(`deno check ${ZOHO_PATH}/index.ts ${SYNC_PATH}/index.ts\n`)
    && stepNamed(TESTS).includes(`deno test --allow-read --allow-env ${ZOHO_PATH}/ ${SYNC_PATH}/ ${SHARED_PATH}/\n`));
t('zoho-link deploys exactly as agreed, with the platform checking the token',
    stepNamed(DEPLOY_ZOHO).includes('        run: supabase functions deploy zoho-link --project-ref "$PROJECT_REF" --use-api\n'));
t('maqsam-sync deploys exactly as agreed, with --no-verify-jwt on the command',
    stepNamed(DEPLOY_SYNC).includes('        run: supabase functions deploy maqsam-sync --project-ref "$PROJECT_REF" --no-verify-jwt --use-api\n'));
t('--no-verify-jwt appears on that one command and nowhere else', workflow.match(/no-verify-jwt/g).length === 1);
t('it deploys these two functions and no other', workflow.match(/supabase functions deploy/g).length === 2
    && [...workflow.matchAll(/supabase functions deploy (\S+)/g)].map((match) => match[1]).join() === 'zoho-link,maqsam-sync');
t('each verify step reads its own function, with its own expected value',
    stepNamed(VERIFY_ZOHO).includes('FN: zoho-link\n') && stepNamed(VERIFY_ZOHO).includes("EXPECTED_VERIFY_JWT: 'true'\n") && stepNamed(VERIFY_ZOHO).includes('BEFORE: ${{ steps.before.outputs.zoho_link }}')
    && stepNamed(VERIFY_SYNC).includes('FN: maqsam-sync\n') && stepNamed(VERIFY_SYNC).includes("EXPECTED_VERIFY_JWT: 'false'\n") && stepNamed(VERIFY_SYNC).includes('BEFORE: ${{ steps.before.outputs.maqsam_sync }}'));

/* ---------- تشغيل الخطوات فعلاً ---------- */

const scriptOf = (step) => step.split('        run: |\n')[1].split('\n')
    .filter((line) => line.startsWith('          ')).map((line) => line.slice(10)).join('\n');

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

// بديل لـ jq حين لا يوجد (ويندوز): الصيغ الثلاث التي تستعملها الخطوات فقط. في CI يعمل jq الحقيقي.
const JQ_SHIM = `
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const [filter, file] = args.filter((arg) => !arg.startsWith('-'));
const strict = args.some((arg) => arg.startsWith('-') && arg.includes('e'));
let value;
try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { process.exit(2); }
const out = value[/^\\.([a-z_]+)/.exec(filter)[1]];
if (filter.includes('numbers') && typeof out !== 'number') process.exit(strict ? 4 : 0);
console.log(out === undefined ? 'null' : String(out));
`;

const FAKE_CURL = `#!/bin/bash
printf '%s\\n' "$@" >> "$FAKE_DIR/args"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
n=$(( $(cat "$FAKE_DIR/count") + 1 ))
echo "$n" > "$FAKE_DIR/count"
file="$FAKE_DIR/response$n"
[ -f "$file" ] || file="$FAKE_DIR/response_last"
code=$(head -n 1 "$file")
if [ "$code" = "down" ]; then
  echo "curl: (7) Failed to connect" >&2
  exit 7
fi
tail -n +2 "$file" > "$out"
printf '%s' "$code"
`;

// responses: [رمز الحالة، الجسم] لكل نداء بالترتيب، والأخير يتكرر. 'down' يعني أن curl نفسه فشل.
function runStep(name, responses, env = {}) {
    const root = mkdtempSync(join(tmpdir(), 'deploy-zoho-link-test-')).replace(/\\/g, '/');
    try {
        const bin = join(root, 'bin');
        mkdirSync(bin);
        const executable = (file, text) => {
            writeFileSync(join(bin, file), text);
            chmodSync(join(bin, file), 0o755);
        };
        executable('curl', FAKE_CURL);
        executable('sleep', '#!/bin/sh\nexit 0\n');
        if (!hasJq) {
            writeFileSync(join(root, 'jq-shim.mjs'), JQ_SHIM);
            executable('jq', `#!/bin/sh\nexec node "${root}/jq-shim.mjs" "$@"\n`);
        }
        writeFileSync(join(root, 'count'), '0\n');
        responses.forEach(([code, body = ''], index) => {
            writeFileSync(join(root, `response${index + 1}`), `${code}\n${body}\n`);
            if (index === responses.length - 1) writeFileSync(join(root, 'response_last'), `${code}\n${body}\n`);
        });
        const output = `${root}/output`, summary = `${root}/summary`;
        writeFileSync(output, '');
        writeFileSync(summary, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', scriptOf(stepNamed(name))], {
            encoding: 'utf8',
            env: {
                ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_DIR: root, RUNNER_TEMP: root,
                GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, PROJECT_REF: 'test-ref', SUPABASE_ACCESS_TOKEN: 'fake-token', ...env,
            },
        });
        return {
            status: result.status,
            stdout: result.stdout,
            output: readFileSync(output, 'utf8'),
            summary: readFileSync(summary, 'utf8'),
            calls: Number(readFileSync(join(root, 'count'), 'utf8')),
            args: readFileSync(join(root, 'args'), 'utf8'),
        };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const live = (fields) => JSON.stringify({ slug: 'x', version: 1, status: 'ACTIVE', verify_jwt: true, ...fields });

let run = runStep(RECORD, [[200, live({ version: 3 })], [200, live({ version: 8, verify_jwt: false })]]);
t('record: both live functions give their versions', run.status === 0 && run.output === 'zoho_link=3\nmaqsam_sync=8\n');
t('record: it reads each function with the token',
    run.args.includes('https://api.supabase.com/v1/projects/test-ref/functions/zoho-link') && run.args.includes('https://api.supabase.com/v1/projects/test-ref/functions/maqsam-sync') && run.args.includes('Authorization: Bearer fake-token'));

run = runStep(RECORD, [[404, '{"message":"Function not found"}']]);
t('record: the first deploy tolerates a 404 as version 0, for each', run.status === 0 && run.output === 'zoho_link=0\nmaqsam_sync=0\n' && run.stdout.includes('first deploy'));
run = runStep(RECORD, [[200, live({ version: 4 })], [404, '{"message":"Function not found"}']]);
t('record: one live and one new', run.status === 0 && run.output === 'zoho_link=4\nmaqsam_sync=0\n');

for (const code of [401, 403, 500, 503]) {
    run = runStep(RECORD, [[code, '{"message":"no"}']]);
    t(`record: HTTP ${code} stops the run with a clear error`, run.status !== 0 && run.output === '' && run.stdout.includes('::error::cannot read zoho-link') && run.stdout.includes(`HTTP ${code}`));
    run = runStep(RECORD, [[200, live({ version: 3 })], [code, '{"message":"no"}']]);
    t(`record: HTTP ${code} on the second function stops it too`, run.status !== 0 && run.stdout.includes('::error::cannot read maqsam-sync'));
}
run = runStep(RECORD, [['down']]);
t('record: curl failing stops the run', run.status !== 0 && run.output === '' && run.stdout.includes('::error::'));
run = runStep(RECORD, [[200, 'not json']]);
t('record: a 200 that is not JSON stops the run', run.status !== 0 && run.output === '');
run = runStep(RECORD, [[200, '{"version":"three"}']]);
t('record: a 200 without a numeric version stops the run', run.status !== 0 && run.output === '');

const ENV_ZOHO = { FN: 'zoho-link', EXPECTED_VERIFY_JWT: 'true' };
const ENV_SYNC = { FN: 'maqsam-sync', EXPECTED_VERIFY_JWT: 'false' };

// الخطوتان بنص واحد، فكل ما يُختبر هنا على إحداهما يصدق على الأخرى
t('the two verify steps run the same script', scriptOf(stepNamed(VERIFY_ZOHO)) === scriptOf(stepNamed(VERIFY_SYNC)));

for (const [step, env, jwt, other] of [[VERIFY_ZOHO, ENV_ZOHO, true, false], [VERIFY_SYNC, ENV_SYNC, false, true]]) {
    const good = (fields) => live({ verify_jwt: jwt, ...fields });
    run = runStep(step, [[200, good({ version: 1 })]], { BEFORE: '0', ...env });
    t(`${env.FN}: the first deploy passes when it is live with verify_jwt ${jwt}`, run.status === 0 && run.calls === 1 && run.summary.includes('✓'));
    t(`${env.FN}: it reports what it saw`, run.stdout.includes(`live ${env.FN}: version 0 -> 1, verify_jwt ${jwt}, status ACTIVE`));
    t(`${env.FN}: it reads its own address`, run.args.includes(`https://api.supabase.com/v1/projects/test-ref/functions/${env.FN}`));
    run = runStep(step, [[404], [404], [200, good({ version: 1 })]], { BEFORE: '0', ...env });
    t(`${env.FN}: a 404 right after the first deploy is retried`, run.status === 0 && run.calls === 3);
    run = runStep(step, [[200, good({ version: 4 })], [200, good({ version: 5 })]], { BEFORE: '4', ...env });
    t(`${env.FN}: it waits for the version to advance`, run.status === 0 && run.calls === 2);
    run = runStep(step, [[200, good({ version: 4 })]], { BEFORE: '4', ...env });
    t(`${env.FN}: a version that never advances fails`, run.status !== 0 && run.calls === 6 && run.stdout.includes('did not advance'));
    run = runStep(step, [[404]], { BEFORE: '0', ...env });
    t(`${env.FN}: a function that never appears fails`, run.status !== 0 && run.calls === 6 && run.stdout.includes('did not advance'));
    run = runStep(step, [[200, live({ version: 2, verify_jwt: other })]], { BEFORE: '1', ...env });
    t(`${env.FN}: verify_jwt ${other} fails`, run.status !== 0 && run.stdout.includes(`::error::verify_jwt is ${other}`) && !run.summary.includes('✓'));
    run = runStep(step, [[200, JSON.stringify({ version: 2, status: 'ACTIVE' })]], { BEFORE: '1', ...env });
    t(`${env.FN}: a missing verify_jwt fails`, run.status !== 0 && run.stdout.includes('::error::verify_jwt is null'));
    run = runStep(step, [[200, good({ version: 2, status: 'REMOVED' })]], { BEFORE: '1', ...env });
    t(`${env.FN}: a function that is not ACTIVE fails`, run.status !== 0 && run.stdout.includes('not ACTIVE') && !run.summary.includes('✓'));
    run = runStep(step, [[401]], { BEFORE: '1', ...env });
    t(`${env.FN}: an HTTP error stops at once`, run.status !== 0 && run.calls === 1 && run.stdout.includes('HTTP 401'));
    run = runStep(step, [['down']], { BEFORE: '1', ...env });
    t(`${env.FN}: curl failing stops at once`, run.status !== 0 && run.calls === 1 && run.stdout.includes('::error::'));
}

/* ---------- الأقدم من main ---------- */

function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}

function freshness(change, { invalidSha = false, brokenRemote = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'deploy-zoho-link-test-'));
    try {
        const remote = join(root, 'remote'), checkout = join(root, 'checkout');
        mkdirSync(remote);
        git(remote, 'init', '--initial-branch=main');
        git(remote, 'config', 'user.name', 'Workflow Test');
        git(remote, 'config', 'user.email', 'workflow-test@example.invalid');
        const paths = [
            `${ZOHO_PATH}/index.ts`,
            `${ZOHO_PATH}/core.ts`,
            `${SYNC_PATH}/tick.ts`,
            `${SHARED_PATH}/core.ts`,
            WORKFLOW_PATH,
            'supabase/config.toml',
            'supabase/functions/agent-run/index.ts',
            'supabase/migrations/042_zoho_link.sql',
            'README.md',
        ];
        for (const path of paths) {
            mkdirSync(dirname(join(remote, path)), { recursive: true });
            writeFileSync(join(remote, path), 'initial\n');
        }
        git(remote, 'add', '.');
        git(remote, 'commit', '-m', 'Initial files');
        const sha = git(remote, 'rev-parse', 'HEAD');
        git(root, 'clone', '--depth=1', pathToFileURL(remote).href, checkout);
        if (change) {
            writeFileSync(join(remote, change), 'newer\n');
            git(remote, 'add', '.');
            git(remote, 'commit', '-m', 'Newer files');
        }
        if (brokenRemote) git(checkout, 'remote', 'set-url', 'origin', join(root, 'missing'));
        const output = join(root, 'output'), summary = join(root, 'summary');
        writeFileSync(output, '');
        writeFileSync(summary, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', scriptOf(stepNamed('Skip a run older than main'))], {
            cwd: checkout, encoding: 'utf8',
            env: { ...process.env, GITHUB_SHA: invalidSha ? 'invalid-commit' : sha, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
        });
        return { ...result, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

for (const change of [null, 'README.md', 'supabase/config.toml', 'supabase/functions/agent-run/index.ts', 'supabase/migrations/042_zoho_link.sql']) {
    const result = freshness(change);
    t(`${change ?? 'unchanged main'} allows deployment`, result.status === 0 && result.output === '');
}
for (const change of [`${ZOHO_PATH}/index.ts`, `${ZOHO_PATH}/core.ts`, `${SYNC_PATH}/tick.ts`, `${SHARED_PATH}/core.ts`, WORKFLOW_PATH]) {
    const result = freshness(change);
    t(`${change} supersedes the run without failing`, result.status === 0 && result.output === 'stale=true\n');
    t(`${change} reports that nothing was deployed`,
        result.stdout.includes('::notice::main has changed zoho-link')
        && result.summary.includes('لم يُنشر شيء') && result.stdout.includes(change));
}
for (const options of [{ invalidSha: true }, { brokenRemote: true }]) {
    const result = freshness(null, options);
    t(`git errors remain failures (${JSON.stringify(options)})`, result.status !== 0 && result.output === '');
}

/* ---------- دليل الاسترجاع والتراجع يعرفان الوظيفتين ---------- */

const recovery = repoText('docs/RECOVERY.md');
const recoveryStep = (number) => {
    const rest = recovery.slice(recovery.indexOf(`\n### ${number}. `) + 1);
    return rest.slice(0, rest.search(/\n#{2,3} /));
};
t('recovery step 4 lists this workflow, which holds the project ref', workflow.includes('PROJECT_REF: niykzsspdehexphewlxa') && recoveryStep(4).includes(WORKFLOW_PATH));
t('recovery step 4 rewrites the sync tick, which holds the project address, and renews its secret and job',
    ['maqsam_sync_cron_tick', 'maqsam_sync_cron_secret', 'maqsam-sync-tick', '042_zoho_link.sql'].every((word) => recoveryStep(4).includes(word))
    && repoText('supabase/migrations/042_zoho_link.sql').includes('niykzsspdehexphewlxa.supabase.co/functions/v1/maqsam-sync'));
t('recovery step 5 asks for no SQL for the Zoho keys', recoveryStep(5).includes('Zoho') && !/zoho_/.test(recoveryStep(5)));
t('recovery step 6 deploys both functions by that push and its approval, with no Run workflow button to look for',
    recoveryStep(6).includes('`zoho-link`') && recoveryStep(6).includes('`maqsam-sync`') && recoveryStep(6).includes('**deploy-zoho-link**') && recoveryStep(6).includes('بلا زر Run workflow'));
t('recovery step 8 says the page shows «مربوط» until someone re-links Zoho, and that no note is written twice',
    recoveryStep(8).includes('Zoho') && recoveryStep(8).includes('رمز جديد') && recoveryStep(8).includes('maqsam_sync_calls'));
t('the Maqsam guide lines are still there', recoveryStep(4).includes('.github/workflows/deploy-maqsam-link.yml') && !/maqsam_/.test(recoveryStep(5)) && recoveryStep(6).includes('**deploy-maqsam-link**'));

const deployDoc = repoText('docs/DEPLOY.md');
t('the deploy guide names this workflow', deployDoc.includes('.github/workflows/deploy-zoho-link.yml'));
t('the rollback section says how to stop the first version of each', deployDoc.includes('أول نسخة من `zoho-link`') && deployDoc.includes('`maqsam-sync`') && deployDoc.includes('**Edge Functions**'));
t('the rollback note in 042 points there', repoText('supabase/migrations/042_zoho_link.sql').includes('docs/DEPLOY.md'));
t('the guide gives the stop that works without the page', deployDoc.includes('select public.maqsam_sync_stop();'));
t('the guide says migrate first', deployDoc.includes('042') && deployDoc.includes('migrate'));

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
