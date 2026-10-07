#!/usr/bin/env bun
import {readdir, realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {
  cloudflareReader,
  type DeploymentEnvironment,
  deploymentTarget,
  inspectDeployment,
  type WorkerName,
} from './deploymentSafety';

interface DeploymentOperations {
  build(): Promise<void>;
  bundle(worker: WorkerName): Promise<void>;
  inspect(): Promise<string>;
  inputs(): Promise<string>;
  publish(worker: WorkerName): Promise<void>;
}

export async function guardedDeployment(
  operations: DeploymentOperations,
  {
    dryRun = false,
    migrationsOnly = false,
    worker,
  }: {
    dryRun?: boolean;
    migrationsOnly?: boolean;
    worker?: WorkerName;
  } = {}
) {
  await operations.build();
  const inputs = await operations.inputs();
  for (const workspace of ['backend', 'frontend'] as const)
    await operations.bundle(workspace);
  const identities = await operations.inspect();
  if (dryRun || migrationsOnly) return;
  const workers: WorkerName[] = worker ? [worker] : ['backend', 'frontend'];
  for (const workspace of workers) {
    if ((await operations.inputs()) !== inputs)
      throw new Error('Deployment held: inputs changed after preview');
    if ((await operations.inspect()) !== identities)
      throw new Error(
        'Deployment held: live resource identities changed after preview'
      );
    if ((await operations.inputs()) !== inputs)
      throw new Error('Deployment held: inputs changed during live inspection');
    await operations.publish(workspace);
  }
}

function git(root: string, arguments_: string[]) {
  const result = Bun.spawnSync(['git', ...arguments_], {cwd: root});
  if (result.exitCode) throw new Error('Cannot identify deployment commit');
  return result.stdout.toString().trim();
}

export function deploymentCommit(root: string, expected?: string) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (expected && head !== expected)
    throw new Error('Deployment held: checkout differs from validated commit');
  if (
    git(root, ['status', '--porcelain', '--untracked-files=all']) ||
    git(root, ['ls-files', '-v'])
      .split('\n')
      .some(line => /^[a-zS] /u.test(line))
  )
    throw new Error(
      'Deployment held: a clean committed checkout with no hidden files is required'
    );
  return head;
}

export async function deploymentInputs(root: string, committedHead?: string) {
  const head = committedHead
    ? deploymentCommit(root, committedHead)
    : git(root, ['rev-parse', 'HEAD']);
  const files = Bun.spawnSync(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {cwd: root}
  );
  if (files.exitCode) throw new Error('Cannot identify deployment inputs');
  const digest = new Bun.CryptoHasher('sha256');
  digest.update(`commit\0${head}\0`);
  const generated = (
    await readdir(path.join(root, 'packages/frontend/build'), {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)));
  // Resolve dependencies from the actual installed Wrangler package. Bun may
  // install these under its virtual store instead of the root node_modules.
  const wranglerManifest = await realpath(
    path.join(root, 'node_modules/wrangler/package.json')
  );
  const wranglerRequire = createRequire(wranglerManifest);
  const esbuildManifest = await realpath(
    wranglerRequire.resolve('esbuild/package.json')
  );
  const esbuildRequire = createRequire(esbuildManifest);
  const nativeEsbuild = `@esbuild/${process.platform}-${process.arch}`;
  const toolPaths = [
    'node_modules/.bin/wrangler',
    'node_modules/wrangler/package.json',
    'node_modules/wrangler/bin/wrangler.js',
    'node_modules/wrangler/wrangler-dist/cli.js',
    wranglerRequire.resolve('esbuild/package.json'),
    wranglerRequire.resolve('esbuild/lib/main.js'),
    wranglerRequire.resolve('esbuild/bin/esbuild'),
    esbuildRequire.resolve(`${nativeEsbuild}/package.json`),
    esbuildRequire.resolve(`${nativeEsbuild}/bin/esbuild`),
  ];
  const toolFiles = await Promise.all(
    toolPaths.map(async filename => {
      const absolute = path.resolve(root, filename);
      return {
        filename: path.relative(root, absolute),
        resolved: await realpath(absolute),
      };
    })
  );
  for (const tool of toolFiles)
    digest.update(`tool\0${tool.filename}\0${tool.resolved}\0`);
  const inputs = [
    ...files.stdout.toString().split('\0').filter(Boolean),
    ...generated,
    ...toolFiles.map(tool => tool.filename),
  ];
  for (const filename of inputs.sort()) {
    const file = Bun.file(path.join(root, filename));
    if (!(await file.exists())) {
      digest.update(`${filename}\0absent\0`);
      continue;
    }
    const contents = await file.arrayBuffer();
    digest.update(`${filename}\0${contents.byteLength}\0`);
    digest.update(contents);
  }
  return digest.digest('hex');
}

if (import.meta.main) {
  const [environment, ...flags] = process.argv.slice(2);
  const allowed = [
    '--dry-run',
    '--migrations-only',
    '--worker=backend',
    '--worker=frontend',
  ];
  if (flags.includes('--skip-migrations'))
    throw new Error(
      'Deployment held: D1 migration inspection cannot be skipped'
    );
  if (
    !['staging', 'prod'].includes(environment ?? '') ||
    flags.some(flag => !allowed.includes(flag))
  )
    throw new Error(
      'Usage: bun scripts/deploy.ts <staging|prod> [--dry-run] [--migrations-only] [--worker=backend|frontend]'
    );
  const selected = environment as DeploymentEnvironment;
  if (flags.includes('--worker=backend') && flags.includes('--worker=frontend'))
    throw new Error('Choose only one Worker');
  const manifest = await Bun.file(
    new URL('../package.json', import.meta.url)
  ).json();
  const wrangler = await Bun.file(
    new URL('../node_modules/wrangler/package.json', import.meta.url)
  ).json();
  if (
    manifest.packageManager !== `bun@${Bun.version}` ||
    wrangler.version !== manifest.devDependencies.wrangler
  )
    throw new Error(
      'Deployment held: installed tools do not match repository pins'
    );
  const root = path.resolve(import.meta.dir, '..');
  const previewOnly =
    flags.includes('--dry-run') || flags.includes('--migrations-only');
  const ciHead = process.env['GITHUB_SHA'];
  if (
    !previewOnly &&
    process.env['GITHUB_ACTIONS'] === 'true' &&
    !/^[a-f0-9]{40}$/u.test(ciHead ?? '')
  )
    throw new Error('Deployment held: validated CI commit is missing');
  const committedHead = previewOnly
    ? undefined
    : deploymentCommit(
        root,
        process.env['GITHUB_ACTIONS'] === 'true' ? ciHead : undefined
      );
  const env = {
    ...process.env,
    PUBLIC_ENVIRONMENT: selected === 'staging' ? 'staging' : 'production',
    STORE_API_ORIGIN:
      selected === 'staging'
        ? 'https://store-staging.devopsrockstars.com'
        : 'https://store.devopsrockstars.com',
    WRANGLER_SEND_METRICS: 'false',
  };
  function run(arguments_: string[], workspace?: WorkerName) {
    const result = Bun.spawnSync([process.execPath, ...arguments_], {
      cwd: workspace ? path.join(root, 'packages', workspace) : root,
      env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (result.exitCode)
      throw new Error(`Deployment command failed (${result.exitCode})`);
  }
  const read = cloudflareReader(
    process.env['CLOUDFLARE_ACCOUNT_ID'],
    process.env['CLOUDFLARE_API_TOKEN']
  );
  const target = await deploymentTarget(root, selected);
  const publish = (workspace: WorkerName, preview: boolean) =>
    run(
      [
        'run',
        '--bun',
        'wrangler',
        'deploy',
        '--env',
        selected,
        '--keep-vars',
        ...(preview ? ['--dry-run'] : []),
      ],
      workspace
    );
  const worker = flags.includes('--worker=backend')
    ? 'backend'
    : flags.includes('--worker=frontend')
      ? 'frontend'
      : undefined;
  await guardedDeployment(
    {
      build: async () => {
        run(['run', 'compile']);
        run(['run', '--filter', '@devopsrockstars/frontend', 'build']);
      },
      bundle: async workspace => publish(workspace, true),
      inspect: () => inspectDeployment(target, read),
      inputs: () => deploymentInputs(root, committedHead),
      publish: async workspace => publish(workspace, false),
    },
    {
      dryRun: flags.includes('--dry-run'),
      migrationsOnly: flags.includes('--migrations-only'),
      ...(worker ? {worker} : {}),
    }
  );
  console.log(
    flags.includes('--dry-run')
      ? `Cloudflare preview verified (${selected}).`
      : flags.includes('--migrations-only')
        ? 'No pending D1 migrations; no database mutation performed.'
        : `Cloudflare deployment completed (${selected}).`
  );
}
