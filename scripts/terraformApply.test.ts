import {expect, test} from 'bun:test';
import {chmod, mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const source = path.resolve(import.meta.dir, '../terraform/apply.sh');

async function runApply(checkExit: number, response: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'terraform-apply-gate-'));
  try {
    const terraform = path.join(root, 'terraform');
    const bin = path.join(root, 'bin');
    const agentBin = path.join(root, 'node_modules/.bin');
    await Promise.all([
      mkdir(terraform),
      mkdir(bin),
      mkdir(agentBin, {recursive: true}),
    ]);
    await Bun.write(
      path.join(terraform, 'apply.sh'),
      await Bun.file(source).text()
    );
    await Bun.write(
      path.join(bin, 'terraform'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  plan)
    for arg in "$@"; do
      case "$arg" in -out=*) plan_file=\${arg#-out=};; esac
    done
    printf 'saved plan' > "$plan_file"
    printf 'generated artifact' > "$(dirname "$plan_file")/extra.tmp"
    printf '%s\\n' "$plan_file" > "$PLAN_LOG"
    ;;
  show)
    if [ "$2" = '-json' ]; then printf '{"complete":true}\\n'; else printf 'reviewed plan\\n'; fi
    ;;
esac
`
    );
    await Bun.write(
      path.join(agentBin, 'agent-tool'),
      `#!/bin/sh
printf 'gate\\n' >> "$CALL_LOG"
exit "$CHECK_EXIT"
`
    );
    await Promise.all([
      chmod(path.join(bin, 'terraform'), 0o755),
      chmod(path.join(agentBin, 'agent-tool'), 0o755),
    ]);
    const callLog = path.join(root, 'calls.log');
    const planLog = path.join(root, 'plan.log');
    const result = Bun.spawnSync(
      ['/bin/bash', path.join(terraform, 'apply.sh')],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH']}`,
          CALL_LOG: callLog,
          PLAN_LOG: planLog,
          CHECK_EXIT: String(checkExit),
        },
        stdin: Buffer.from(`${response}\n`),
      }
    );
    const calls = await readFile(callLog, 'utf8');
    const plan = (await readFile(planLog, 'utf8')).trim();
    return {
      exitCode: result.exitCode,
      calls,
      planRemoved: !(await Bun.file(plan).exists()),
      directoryRemoved: await stat(path.dirname(plan)).then(
        () => false,
        () => true
      ),
    };
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('a rejected Terraform plan cannot reach apply and cleans private files', async () => {
  const result = await runApply(1, 'APPLY');
  expect(result.exitCode).not.toBe(0);
  expect(result.calls).toContain('gate');
  expect(result.calls).not.toContain('apply ');
  expect(result.planRemoved).toBe(true);
  expect(result.directoryRemoved).toBe(true);
});

test('an unapproved Terraform plan cannot reach apply', async () => {
  const result = await runApply(0, 'NO');
  expect(result.exitCode).not.toBe(0);
  expect(result.calls).not.toContain('apply ');
  expect(result.planRemoved).toBe(true);
});

test('an approved checked plan is the only plan passed to apply', async () => {
  const result = await runApply(0, 'APPLY');
  expect(result.exitCode).toBe(0);
  expect(result.calls).toContain('apply ');
  expect(result.planRemoved).toBe(true);
  expect(result.directoryRemoved).toBe(true);
});

test('the installed agent-tool rejects a saved plan with a delete action', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'terraform-plan-check-'));
  try {
    const plan = path.join(root, 'plan.json');
    await Bun.write(
      plan,
      JSON.stringify({
        format_version: '1.2',
        terraform_version: '1.14.0',
        complete: true,
        planned_values: {},
        configuration: {},
        resource_changes: [
          {
            address: 'cloudflare_workers_script.existing',
            mode: 'managed',
            change: {actions: ['delete']},
          },
        ],
      })
    );
    const cli = path.resolve(
      import.meta.dir,
      '../node_modules/.bin/agent-tool'
    );
    const result = Bun.spawnSync([
      cli,
      'dependencies',
      'check-terraform-plan',
      plan,
    ]);
    expect(result.exitCode).toBe(1);
    const verdict = JSON.parse(result.stdout.toString()) as {
      ok: boolean;
      issues: string[];
    };
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.join(' ')).toContain(
      'deletion or replacement is forbidden'
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
