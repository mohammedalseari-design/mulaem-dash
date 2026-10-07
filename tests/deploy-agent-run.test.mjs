// Run: node tests/deploy-agent-run.test.mjs
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
function t(name, cond) {
    if (cond) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name); }
}

const workflow = readFileSync(new URL('../.github/workflows/deploy-agent-run.yml', import.meta.url), 'utf8');
const steps = workflow.split(/^      - /m).slice(1);
const freshness = steps.find((step) => step.includes('id: freshness\n'));
const script = freshness.split('        run: |\n')[1].split('\n')
    .filter((line) => line.startsWith('          ')).map((line) => line.slice(10)).join('\n');
const skipCondition = "        if: steps.freshness.outputs.stale != 'true'\n";

t('only first attempts check freshness; explicit rollback reruns bypass it',
    freshness.includes("        if: github.run_attempt == '1'\n"));
for (const label of [
    'Check the access token secret is set', 'denoland/setup-deno@',
    'Type-check and test agent-run', 'supabase/setup-cli@',
    'Record the live version', 'Deploy agent-run',
]) {
    t(`${label} is skipped for stale runs`, steps.find((step) => step.startsWith(`name: ${label}\n`)
        || step.startsWith(`uses: ${label}`))?.includes(skipCondition));
}
t('verification requires a successful live-version read',
    steps.find((step) => step.startsWith('name: Verify the live version'))
        ?.includes("steps.before.outcome == 'success'"));
t('freshness is checked before accessing the deployment secret',
    steps.indexOf(freshness) < steps.findIndex((step) => step.startsWith('name: Check the access token')));

function git(cwd, ...args) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}

function check(change, { invalidSha = false, brokenRemote = false } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'deploy-agent-run-test-'));
    try {
        const remote = join(root, 'remote'), checkout = join(root, 'checkout');
        mkdirSync(remote);
        git(remote, 'init', '--initial-branch=main');
        git(remote, 'config', 'user.name', 'Workflow Test');
        git(remote, 'config', 'user.email', 'workflow-test@example.invalid');
        const paths = [
            'supabase/functions/agent-run/index.ts',
            'supabase/functions/_shared/effort-router/index.ts',
            'supabase/config.toml',
            '.github/workflows/deploy-agent-run.yml',
            'README.md',
        ];
        for (const path of paths) {
            mkdirSync(dirname(join(remote, path)), { recursive: true });
            writeFileSync(join(remote, path), 'initial\n');
        }
        git(remote, 'add', '.');
        git(remote, 'commit', '-m', 'Initial files');
        const sha = git(remote, 'rev-parse', 'HEAD');
        git(root, 'clone', '--depth=1', `file://${remote}`, checkout);
        if (change) {
            writeFileSync(join(remote, change), 'newer\n');
            git(remote, 'add', '.');
            git(remote, 'commit', '-m', 'Newer files');
        }
        if (brokenRemote) git(checkout, 'remote', 'set-url', 'origin', join(root, 'missing'));
        const output = join(root, 'output'), summary = join(root, 'summary');
        writeFileSync(output, '');
        writeFileSync(summary, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
            cwd: checkout, encoding: 'utf8',
            env: { ...process.env, GITHUB_SHA: invalidSha ? 'invalid-commit' : sha,
                GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
        });
        return { ...result, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

for (const change of [null, 'README.md']) {
    const result = check(change);
    t(`${change ?? 'unchanged main'} allows deployment`, result.status === 0 && result.output === '');
}
for (const change of [
    'supabase/functions/agent-run/index.ts',
    'supabase/functions/_shared/effort-router/index.ts',
    'supabase/config.toml',
    '.github/workflows/deploy-agent-run.yml',
]) {
    const result = check(change);
    t(`${change} supersedes the run without failing`, result.status === 0 && result.output === 'stale=true\n');
    t(`${change} reports that nothing was deployed`,
        result.stdout.includes('::notice::main has changed agent-run')
        && result.summary.includes('لم يُنشر شيء') && result.stdout.includes(change));
}
for (const options of [{ invalidSha: true }, { brokenRemote: true }]) {
    const result = check(null, options);
    t(`git errors remain failures (${JSON.stringify(options)})`, result.status !== 0 && result.output === '');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
