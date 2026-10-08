import {expect, spyOn, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  deploymentCommit,
  deploymentInputs,
  guardedDeployment,
  parseDeploymentRequest,
  verifyDeploymentRuntime,
} from './deploy';
import {
  approvedPreviousWorkers,
  cloudflareReader,
  deploymentTarget,
  inspectDeployment,
  type ReadApi,
} from './deploymentSafety';

const root = path.resolve(import.meta.dir, '..');
const account = 'a'.repeat(32);
const zone = 'b'.repeat(32);
const otherZone = 'c'.repeat(32);

test('the disabled production store retains only its existing hash secret', async () => {
  const production = await deploymentTarget(root, 'prod');
  const staging = await deploymentTarget(root, 'staging');
  expect(production.workers.backend.secrets).toEqual(['CHECKOUT_HASH_SECRET']);
  expect(staging.workers.backend.secrets).toContain('STRIPE_SECRET_KEY');
});

test('every package remote deploy script uses the shared guard', async () => {
  const manifests = await Promise.all(
    ['.', 'packages/backend', 'packages/frontend'].map(directory =>
      Bun.file(path.join(root, directory, 'package.json')).json()
    )
  );
  expect(manifests[0].scripts['deploy:staging']).toBe(
    'bun scripts/deploy.ts staging'
  );
  expect(manifests[0].scripts['deploy:prod']).toBe(
    'bun scripts/deploy.ts prod'
  );
  for (const environment of ['staging', 'prod']) {
    expect(manifests[0].scripts[`db:check:${environment}`]).toBe(
      `bun run --filter @devopsrockstars/backend db:check:${environment}`
    );
    expect(manifests[1].scripts[`db:check:${environment}`]).toBe(
      `bun ../../scripts/deploy.ts ${environment} --check-migrations`
    );
    expect(manifests[0].scripts[`db:migrate:${environment}`]).toBeUndefined();
    expect(manifests[1].scripts[`db:migrate:${environment}`]).toBeUndefined();
  }
  for (const [index, worker] of [
    [1, 'backend'],
    [2, 'frontend'],
  ] as const) {
    expect(manifests[index].scripts['deploy:staging']).toBe(
      `bun ../../scripts/deploy.ts staging --worker=${worker}`
    );
    expect(manifests[index].scripts['deploy:prod']).toBe(
      `bun ../../scripts/deploy.ts prod --worker=${worker}`
    );
  }
});

test('deployment arguments reject bypasses and select preview or publication', async () => {
  expect(() => parseDeploymentRequest(['prod', '--skip-migrations'])).toThrow(
    'migration inspection cannot be skipped'
  );
  expect(() =>
    parseDeploymentRequest(['staging', '--worker=backend', '--worker=frontend'])
  ).toThrow('Choose only one Worker');
  expect(() => parseDeploymentRequest(['unknown'])).toThrow('Usage:');
  expect(() => parseDeploymentRequest(['prod', '--unknown'])).toThrow('Usage:');
  expect(parseDeploymentRequest(['staging', '--dry-run'])).toEqual({
    environment: 'staging',
    dryRun: true,
    migrationsOnly: false,
    worker: undefined,
  });
  expect(parseDeploymentRequest(['prod', '--check-migrations'])).toEqual({
    environment: 'prod',
    dryRun: false,
    migrationsOnly: true,
    worker: undefined,
  });
  const request = parseDeploymentRequest(['prod', '--worker=backend']);
  const {value, events} = operations();
  if (!request.worker) throw new Error('Missing selected Worker');
  await guardedDeployment(value, {worker: request.worker});
  expect(events).toContain('publish:backend');
  expect(events).not.toContain('publish:frontend');
});

test('deployment refuses mismatched tools and unbound CI commits', () => {
  const manifest = {
    packageManager: `bun@${Bun.version}`,
    devDependencies: {wrangler: '4.147.0'},
  };
  const wrangler = {version: '4.147.0'};
  expect(
    verifyDeploymentRuntime(
      manifest,
      wrangler,
      Bun.version,
      false,
      undefined,
      false
    )
  ).toBeUndefined();
  expect(() =>
    verifyDeploymentRuntime(
      manifest,
      wrangler,
      Bun.version,
      true,
      undefined,
      false
    )
  ).toThrow('validated CI commit is missing');
  const head = 'a'.repeat(40);
  expect(
    verifyDeploymentRuntime(manifest, wrangler, Bun.version, true, head, false)
  ).toBe(head);
  expect(
    verifyDeploymentRuntime(
      manifest,
      wrangler,
      Bun.version,
      true,
      undefined,
      true
    )
  ).toBeUndefined();
  for (const invalid of [
    [{...manifest, packageManager: 'bun@0.0.0'}, wrangler],
    [manifest, {version: '0.0.0'}],
    [{...manifest, devDependencies: {}}, wrangler],
  ] as const)
    expect(() =>
      verifyDeploymentRuntime(
        invalid[0],
        invalid[1],
        Bun.version,
        false,
        undefined,
        false
      )
    ).toThrow('Deployment held');
});

async function fixture(environment: 'staging' | 'prod' = 'staging') {
  const target = await deploymentTarget(root, environment);
  const metadata: Record<string, unknown> = {
    '/zones': [
      {id: zone, name: 'devopsrockstars.com'},
      {id: otherZone, name: 'other.example'},
    ],
    '/workers/domains': Object.values(target.workers).flatMap(worker =>
      worker.domains.map((hostname, index) => ({
        id: `${worker.name}-${index}`,
        hostname,
        zone_id: zone,
        zone_name: 'devopsrockstars.com',
        service: worker.name,
        environment: 'production',
      }))
    ),
    [`/d1/database/${target.database.id}`]: {
      uuid: target.database.id,
      name: target.database.name,
    },
    [`/d1/database/${target.database.id}/query`]: [
      {
        success: true,
        meta: {changed_db: false},
        results: target.migrations.map(name => ({name})),
      },
    ],
    [`/zones/${zone}/workers/routes`]: [],
    [`/zones/${otherZone}/workers/routes`]: [],
  };
  for (const worker of Object.values(target.workers)) {
    const endpoint = `/workers/scripts/${worker.name}`;
    metadata[`${endpoint}/settings`] = {
      compatibility_date: worker.date,
      bindings: [
        ...worker.bindings,
        ...worker.secrets.map(name => ({name, type: 'secret_text'})),
      ],
    };
    metadata[`${endpoint}/subdomain`] = {
      enabled: false,
      previews_enabled: false,
    };
    metadata[`${endpoint}/schedules`] = {
      schedules: worker.crons.map(cron => ({cron})),
    };
  }
  const requests: {endpoint: string; sql: string | undefined}[] = [];
  const read: ReadApi = async (endpoint, sql) => {
    requests.push({endpoint, sql});
    if (!(endpoint in metadata)) throw new Error('Missing fixture metadata');
    return structuredClone(metadata[endpoint]);
  };
  return {target, metadata, read, requests};
}

test('complete fixture identities and existing migration metadata pass both environments', async () => {
  for (const environment of ['staging', 'prod'] as const) {
    const {target, read, requests} = await fixture(environment);
    expect(await inspectDeployment(target, read)).toContain(
      target.workers.backend.name
    );
    expect(
      requests.filter(request => request.sql).map(request => request.sql)
    ).toEqual(['SELECT name FROM d1_migrations ORDER BY id']);
  }
});

test('reviewed runtime transitions accept only the old or desired state until publication', async () => {
  const fixtureValue = await fixture();
  const {metadata, read} = fixtureValue;
  const target = {
    ...fixtureValue.target,
    previousWorkers: approvedPreviousWorkers(
      fixtureValue.target.workers,
      {staging: {backend: {date: '2026-08-30'}}},
      'staging'
    ),
  };
  const priorDate = '2026-08-30';
  const endpoint = `/workers/scripts/${target.workers.backend.name}/settings`;
  const settings = metadata[endpoint] as {compatibility_date: string};
  settings.compatibility_date = priorDate;
  await inspectDeployment(target, read);
  await expect(inspectDeployment(target, read, ['backend'])).rejects.toThrow(
    'reviewed transition'
  );
  settings.compatibility_date = target.workers.backend.date;
  await inspectDeployment(target, read, ['backend']);
  settings.compatibility_date = '2026-07-01';
  await expect(inspectDeployment(target, read)).rejects.toThrow(
    'reviewed transition'
  );
});

test('planned transitions cannot change D1 or remove a bound variable', async () => {
  const {target} = await fixture();
  const original = target.workers.backend.bindings;
  expect(() =>
    approvedPreviousWorkers(
      target.workers,
      {
        staging: {
          backend: {
            bindings: original.filter(binding => binding['type'] !== 'd1'),
          },
        },
      },
      'staging'
    )
  ).toThrow('immutable resource identities');
  expect(() =>
    approvedPreviousWorkers(
      target.workers,
      {
        staging: {
          backend: {
            bindings: [
              ...original,
              {name: 'UNREVIEWED', type: 'plain_text', text: 'value'},
            ],
          },
        },
      },
      'staging'
    )
  ).toThrow('invalid or removed');
});

test.each(['pending', 'unknown', 'mutating query'])(
  'D1 %s prevents deployment',
  async kind => {
    const {target, metadata, read} = await fixture();
    metadata[`/d1/database/${target.database.id}/query`] = [
      {
        success: true,
        meta: {changed_db: kind === 'mutating query'},
        results: (kind === 'pending'
          ? target.migrations.slice(1)
          : [...target.migrations, 'unreviewed.sql']
        ).map(name => ({name})),
      },
    ];
    await expect(inspectDeployment(target, read)).rejects.toThrow(
      'Deployment held'
    );
  }
);

test('missing migration table is held without initialization', async () => {
  const {target, read} = await fixture();
  await expect(
    inspectDeployment(target, async (endpoint, sql) => {
      if (sql) throw new Error('no such table: d1_migrations');
      return read(endpoint);
    })
  ).rejects.toThrow('no such table');
});

test.each(['removed', 'replaced', 'unknown'])(
  'a %s live binding is held',
  async kind => {
    const {target, metadata, read} = await fixture();
    const bindings = target.workers.backend.bindings;
    metadata[`/workers/scripts/${target.workers.backend.name}/settings`] = {
      compatibility_date: target.workers.backend.date,
      bindings:
        kind === 'removed'
          ? []
          : kind === 'replaced'
            ? bindings.map(binding =>
                binding['type'] === 'd1'
                  ? {...binding, id: 'another-database'}
                  : binding
              )
            : [
                ...bindings,
                {name: 'UNREVIEWED', type: 'durable_object_namespace'},
              ],
    };
    await expect(inspectDeployment(target, read)).rejects.toThrow(
      'Deployment held'
    );
  }
);

test('a changed database identity, domain, route, or cron is held', async () => {
  for (const endpoint of ['database', 'domains', 'routes', 'cron']) {
    const {target, metadata, read} = await fixture();
    if (endpoint === 'database')
      metadata[`/d1/database/${target.database.id}`] = {
        uuid: 'replacement',
        name: target.database.name,
      };
    if (endpoint === 'domains') metadata['/workers/domains'] = [];
    if (endpoint === 'routes')
      metadata[`/zones/${zone}/workers/routes`] = [
        {script: target.workers.backend.name, pattern: '*'},
      ];
    if (endpoint === 'cron')
      metadata[`/workers/scripts/${target.workers.backend.name}/schedules`] = {
        schedules: [],
      };
    await expect(inspectDeployment(target, read)).rejects.toThrow(
      'Deployment held'
    );
  }
});

test('a route for an owned Worker in another account zone is held', async () => {
  const {target, metadata, read} = await fixture();
  metadata[`/zones/${otherZone}/workers/routes`] = [
    {script: target.workers.frontend.name, pattern: 'other.example/*'},
  ];
  await expect(inspectDeployment(target, read)).rejects.toThrow(
    'unexpected live Worker routes'
  );
});

function operations(failure?: string) {
  const events: string[] = [];
  let inspections = 0;
  const step = async (name: string) => {
    events.push(name);
    if (failure === name) throw new Error('incomplete preview');
  };
  return {
    events,
    value: {
      build: () => step('build'),
      inputs: async () =>
        (failure === 'inputs changed' && inspections > 0) ||
        (failure === 'inputs change during inspection' && inspections > 1)
          ? 'changed'
          : 'reviewed',
      bundle: (worker: string) => step(`preview:${worker}`),
      inspect: async () => {
        await step(`inspect:${++inspections}`);
        return failure === 'identities changed' && inspections > 1
          ? 'replacement'
          : 'existing';
      },
      publish: (worker: string) => step(`publish:${worker}`),
    },
  };
}

test('both previews and fresh inspection precede each publication', async () => {
  const {value, events} = operations();
  await guardedDeployment(value);
  expect(events).toEqual([
    'build',
    'preview:backend',
    'preview:frontend',
    'inspect:1',
    'inspect:2',
    'publish:backend',
    'inspect:3',
    'inspect:4',
    'publish:frontend',
    'inspect:5',
  ]);
});

test.each([
  'preview:backend',
  'preview:frontend',
  'inspect:1',
  'inspect:2',
  'inputs changed',
  'inputs change during inspection',
  'identities changed',
])('failed %s publishes no Worker', async failure => {
  const {value, events} = operations(failure);
  await expect(guardedDeployment(value)).rejects.toThrow();
  expect(events.some(event => event.startsWith('publish:'))).toBe(false);
});

test('a failed second inspection never publishes the site', async () => {
  const {value, events} = operations('inspect:3');
  await expect(guardedDeployment(value)).rejects.toThrow();
  expect(events).toContain('publish:backend');
  expect(events).not.toContain('publish:frontend');
});

test('dry runs and migration checks execute no mutation', async () => {
  for (const options of [{dryRun: true}, {migrationsOnly: true}]) {
    const {value, events} = operations();
    await guardedDeployment(value, options);
    expect(events).toEqual([
      'build',
      'preview:backend',
      'preview:frontend',
      'inspect:1',
    ]);
  }
});

test('incomplete API inventory and sensitive errors fail closed without leaking values', async () => {
  const read = cloudflareReader(account, 'SYNTHETIC_PRIVATE_TOKEN');
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      success: true,
      errors: [],
      result: [],
      result_info: {page: 1, total_pages: 2, total_count: 50},
    })
  );
  try {
    await expect(read('/workers/domains')).rejects.toThrow('incomplete');
    fetch.mockResolvedValue(
      Response.json({
        success: true,
        errors: null,
        result: [],
        result_info: {page: 1, total_pages: 1, total_count: 0},
      })
    );
    expect(await read('/workers/domains')).toEqual([]);
    fetch.mockResolvedValue(
      Response.json({
        success: true,
        errors: null,
        result: [{hostname: 'staging.devopsrockstars.com'}],
        // The live account's Workers Domains response used per_page: 27 on 2026-10-07.
        result_info: {page: 1, per_page: 27, count: 1, total_count: 1},
      })
    );
    expect(await read('/workers/domains')).toHaveLength(1);
    fetch.mockResolvedValue(
      Response.json({
        success: true,
        errors: null,
        result: [{id: zone}],
        result_info: {page: 1, per_page: 50, count: 1, total_count: 2},
      })
    );
    await expect(read('/zones')).rejects.toThrow('incomplete');
    fetch.mockResolvedValue(
      Response.json({
        success: true,
        errors: null,
        result: [{id: zone}],
        result_info: {page: 1, per_page: 50, count: 1, total_count: 1},
      })
    );
    expect(await read('/zones')).toHaveLength(1);
    expect(String(fetch.mock.calls.at(-1)?.[0])).toContain(
      `/zones?account.id=${account}`
    );
    fetch.mockResolvedValue(
      Response.json({success: true, errors: null, result: []})
    );
    expect(await read(`/zones/${zone}/workers/routes`)).toEqual([]);
    fetch.mockResolvedValue(
      Response.json({
        success: false,
        errors: [{message: 'SYNTHETIC_PRIVATE_TOKEN'}],
      })
    );
    await expect(read('/workers/domains')).rejects.toThrow(
      'Deployment preview API did not succeed'
    );
  } finally {
    fetch.mockRestore();
  }
});

test('missing account credentials fail before an API call', () => {
  expect(() => cloudflareReader(undefined, undefined)).toThrow(
    'explicit CLOUDFLARE_ACCOUNT_ID'
  );
});

test('D1 migration inspection sends the fixed read-only query to the account database', async () => {
  const read = cloudflareReader(account, 'SYNTHETIC_PRIVATE_TOKEN');
  const database = '35891cf5-2187-43f8-b844-8b96a16e70dc';
  const sql = 'SELECT name FROM d1_migrations ORDER BY id';
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({success: true, errors: null, result: []})
  );
  try {
    expect(await read(`/d1/database/${database}/query`, sql)).toEqual([]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({sql}),
    });
  } finally {
    fetch.mockRestore();
  }
});

test('the API reader rejects other SQL or SQL endpoints before making a request', async () => {
  const read = cloudflareReader(account, 'SYNTHETIC_PRIVATE_TOKEN');
  const fetch = spyOn(globalThis, 'fetch');
  try {
    await expect(
      read(
        '/d1/database/35891cf5-2187-43f8-b844-8b96a16e70dc/query',
        'CREATE TABLE d1_migrations (id INTEGER)'
      )
    ).rejects.toThrow('only migration metadata reads');
    await expect(
      read('/workers/domains', 'SELECT name FROM d1_migrations ORDER BY id')
    ).rejects.toThrow('only migration metadata reads');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

async function committedFixture() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'deployment-safety-'));
  const repository = path.join(temporary, 'repo');
  const run = (arguments_: string[]) => {
    const result = Bun.spawnSync(['git', ...arguments_], {cwd: temporary});
    if (result.exitCode)
      throw new Error('Cannot create local committed fixture');
    return result.stdout.toString().trim();
  };
  // Copy the committed HEAD without relying on shared objects from a shallow CI checkout.
  run(['clone', '--no-local', '--no-checkout', root, repository]);
  run(['-C', repository, 'checkout', '--detach', 'HEAD']);
  return {
    temporary,
    repository,
    run: (arguments_: string[]) => run(['-C', repository, ...arguments_]),
  };
}

test('publication rejects commit drift, dirty files, and hidden-worktree flags', async () => {
  const {temporary, repository, run} = await committedFixture();
  try {
    const head = deploymentCommit(repository);
    expect(deploymentCommit(repository, head)).toBe(head);
    expect(() => deploymentCommit(repository, '0'.repeat(40))).toThrow(
      'validated commit'
    );
    const readme = path.join(repository, 'README.md');
    const original = await Bun.file(readme).text();
    await Bun.write(readme, `${original}\nchanged after validation\n`);
    expect(() => deploymentCommit(repository, head)).toThrow(
      'clean committed checkout'
    );
    await Bun.write(readme, original);
    for (const flag of ['assume-unchanged', 'skip-worktree']) {
      run(['update-index', `--${flag}`, 'README.md']);
      expect(() => deploymentCommit(repository, head)).toThrow(
        'no hidden files'
      );
      run(['update-index', `--no-${flag}`, 'README.md']);
    }
    expect(deploymentCommit(repository, head)).toBe(head);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});

test('generated assets and the installed Wrangler invalidate captured inputs', async () => {
  const {temporary, repository} = await committedFixture();
  try {
    await mkdir(path.join(repository, 'packages/frontend/build'), {
      recursive: true,
    });
    await mkdir(path.join(repository, 'node_modules/wrangler/wrangler-dist'), {
      recursive: true,
    });
    await mkdir(path.join(repository, 'node_modules/wrangler/bin'), {
      recursive: true,
    });
    await mkdir(path.join(repository, 'node_modules/.bin'), {
      recursive: true,
    });
    await mkdir(
      path.join(repository, 'node_modules/wrangler/node_modules/esbuild/lib'),
      {recursive: true}
    );
    await mkdir(
      path.join(repository, 'node_modules/wrangler/node_modules/esbuild/bin'),
      {recursive: true}
    );
    const nativeBinary = path.join(
      repository,
      `node_modules/wrangler/node_modules/esbuild/node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`
    );
    await mkdir(path.dirname(nativeBinary), {recursive: true});
    const asset = path.join(repository, 'packages/frontend/build/index.html');
    const tool = path.join(
      repository,
      'node_modules/wrangler/wrangler-dist/cli.js'
    );
    await Bun.write(asset, 'previewed asset');
    await Bun.write(
      path.join(repository, 'node_modules/wrangler/package.json'),
      '{}'
    );
    await Bun.write(tool, 'previewed CLI');
    const toolFiles = [
      'node_modules/.bin/wrangler',
      'node_modules/wrangler/bin/wrangler.js',
      'node_modules/wrangler/node_modules/esbuild/package.json',
      'node_modules/wrangler/node_modules/esbuild/lib/main.js',
      'node_modules/wrangler/node_modules/esbuild/bin/esbuild',
      `node_modules/wrangler/node_modules/esbuild/node_modules/@esbuild/${process.platform}-${process.arch}/package.json`,
    ];
    for (const filename of toolFiles)
      await Bun.write(
        path.join(repository, filename),
        filename.endsWith('/package.json') ? '{}' : 'previewed tool'
      );
    await Bun.write(nativeBinary, 'previewed native binary');
    const head = deploymentCommit(repository);
    const initial = await deploymentInputs(repository, head);
    await Bun.write(asset, 'changed asset');
    expect(await deploymentInputs(repository, head)).not.toBe(initial);
    await Bun.write(asset, 'previewed asset');
    expect(await deploymentInputs(repository, head)).toBe(initial);
    await Bun.write(tool, 'changed CLI');
    expect(await deploymentInputs(repository, head)).not.toBe(initial);
    await Bun.write(tool, 'previewed CLI');
    for (const executable of [
      path.join(repository, 'node_modules/wrangler/bin/wrangler.js'),
      nativeBinary,
    ]) {
      await Bun.write(executable, 'changed executable');
      expect(await deploymentInputs(repository, head)).not.toBe(initial);
      await Bun.write(
        executable,
        executable === nativeBinary
          ? 'previewed native binary'
          : 'previewed tool'
      );
    }
    const beforeDeletion = await deploymentInputs(repository);
    await rm(path.join(repository, 'README.md'));
    expect(await deploymentInputs(repository)).not.toBe(beforeDeletion);
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});

test('uninspected Wrangler build hooks are rejected', async () => {
  const {temporary, repository} = await committedFixture();
  try {
    const filename = path.join(repository, 'packages/frontend/wrangler.jsonc');
    const original = Bun.JSONC.parse(await Bun.file(filename).text()) as {
      build?: {command: string};
      env: {staging: {build?: {command: string}}};
    };
    for (const scope of ['root', 'environment']) {
      const config = structuredClone(original);
      if (scope === 'root')
        config.build = {command: 'bun uninspected-build.ts'};
      else config.env.staging.build = {command: 'bun uninspected-build.ts'};
      await Bun.write(filename, JSON.stringify(config));
      await expect(deploymentTarget(repository, 'staging')).rejects.toThrow(
        'unreviewed infrastructure configuration'
      );
    }
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
});
