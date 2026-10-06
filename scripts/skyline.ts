#!/usr/bin/env bun
// Keeps the frontend's exact @a2f0/skyline pin on npm's latest release.
import path from 'node:path';

const packageName = '@a2f0/skyline';
const frontend = path.resolve(import.meta.dir, '../packages/frontend');

type Run = (command: string[]) => string;

export function run(command: string[]) {
  const result = Bun.spawnSync(command, {
    cwd: frontend,
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (result.exitCode)
    throw new Error(`${command.join(' ')} exited with ${result.exitCode}`);
  return result.stdout.toString().trim();
}

// Returns whether the pin ends current. Only an update run may install.
export function syncSkyline(pinned: unknown, check: boolean, execute: Run) {
  if (typeof pinned !== 'string')
    throw new Error(`${packageName} is not a frontend dependency`);
  const latest = execute(['bun', 'info', packageName, 'dist-tags.latest']);
  if (!/^\d+\.\d+\.\d+$/u.test(latest))
    throw new Error(`Unexpected ${packageName} latest version: ${latest}`);

  if (pinned === latest) {
    return {current: true, message: `${packageName} ${pinned} is current.`};
  }
  if (Bun.semver.satisfies(pinned, `>${latest}`))
    throw new Error(`${packageName} ${pinned} is newer than latest ${latest}`);
  if (check) {
    return {
      current: false,
      message: `${packageName} ${pinned} is behind ${latest}; run bun run skyline:update.`,
    };
  }
  execute(['bun', 'add', '--exact', `${packageName}@${latest}`]);
  return {
    current: true,
    message: `Updated ${packageName} from ${pinned} to ${latest}.`,
  };
}

if (import.meta.main) {
  const [option, ...extra] = process.argv.slice(2);
  if (extra.length || (option && option !== '--check')) {
    throw new Error('Usage: bun run skyline:update | bun run skyline:check');
  }
  const manifest = await Bun.file(path.join(frontend, 'package.json')).json();
  const result = syncSkyline(
    manifest.dependencies?.[packageName],
    option === '--check',
    run
  );
  if (!result.current) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
