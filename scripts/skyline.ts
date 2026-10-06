#!/usr/bin/env bun
// Keeps the frontend's exact @a2f0/skyline pin on npm's latest release.
import path from 'node:path';

const packageName = '@a2f0/skyline';
const frontend = path.resolve(import.meta.dir, '../packages/frontend');

function run(command: string[]) {
  const result = Bun.spawnSync(command, {
    cwd: frontend,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (result.exitCode)
    throw new Error(`${command.join(' ')} exited with ${result.exitCode}`);
  return result.stdout.toString().trim();
}

const [option, ...extra] = process.argv.slice(2);
if (extra.length || (option && option !== '--check')) {
  throw new Error('Usage: bun run skyline:update | bun run skyline:check');
}
const manifest = await Bun.file(path.join(frontend, 'package.json')).json();
const pinned: unknown = manifest.dependencies?.[packageName];
if (typeof pinned !== 'string')
  throw new Error(`${packageName} is not a frontend dependency`);
const latest = run(['bun', 'info', packageName, 'dist-tags.latest']);
if (!/^\d+\.\d+\.\d+$/u.test(latest))
  throw new Error(`Unexpected ${packageName} latest version: ${latest}`);

if (pinned === latest) {
  console.log(`${packageName} ${pinned} is the latest release.`);
} else if (Bun.semver.satisfies(pinned, `>${latest}`)) {
  throw new Error(`${packageName} ${pinned} is newer than latest ${latest}`);
} else if (option === '--check') {
  console.error(
    `${packageName} ${pinned} is behind ${latest}; run bun run skyline:update.`
  );
  process.exit(1);
} else {
  run(['bun', 'add', '--exact', `${packageName}@${latest}`]);
  console.log(`Updated ${packageName} from ${pinned} to ${latest}.`);
}
