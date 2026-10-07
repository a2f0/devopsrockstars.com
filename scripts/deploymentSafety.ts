import {readdir} from 'node:fs/promises';
import path from 'node:path';

export type DeploymentEnvironment = 'staging' | 'prod';
export type WorkerName = 'backend' | 'frontend';
type ObjectValue = Record<string, unknown>;
export type ReadApi = (endpoint: string, sql?: string) => Promise<unknown>;
const migrationMetadataQuery = 'SELECT name FROM d1_migrations ORDER BY id';

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Deployment preview returned incomplete metadata');
  return value as ObjectValue;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error('Deployment preview returned an incomplete list');
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(object(value))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

function equal(actual: unknown, expected: unknown, description: string) {
  if (canonical(actual) !== canonical(expected))
    throw new Error(
      `Deployment held: ${description} differs from configuration`
    );
}

function keys(value: ObjectValue, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('Deployment held: unreviewed infrastructure configuration');
}

interface WorkerTarget {
  name: string;
  date: string;
  bindings: ObjectValue[];
  secrets: string[];
  crons: string[];
  domains: string[];
}

export interface DeploymentTarget {
  readonly workers: Record<WorkerName, WorkerTarget>;
  readonly previousWorkers?: Partial<Record<WorkerName, WorkerTarget>>;
  readonly database: {id: string; name: string};
  readonly migrations: string[];
}

export function approvedPreviousWorkers(
  workers: Record<WorkerName, WorkerTarget>,
  document: unknown,
  environment: DeploymentEnvironment
): Partial<Record<WorkerName, WorkerTarget>> {
  const plan = object(document);
  keys(plan, ['staging', 'prod']);
  const selected = object(plan[environment] ?? {});
  keys(selected, ['backend', 'frontend']);
  const previous: Partial<Record<WorkerName, WorkerTarget>> = {};
  for (const workspace of ['backend', 'frontend'] as const) {
    if (selected[workspace] === undefined) continue;
    const before = object(selected[workspace]);
    keys(before, ['date', 'bindings']);
    const desired = workers[workspace];
    const date = before['date'] ?? desired.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date))
      throw new Error('Deployment held: invalid planned runtime date');
    const bindings =
      before['bindings'] === undefined
        ? desired.bindings
        : array(before['bindings']).map(normalizedBinding);
    equal(
      sortedBindings(
        bindings.filter(binding => binding['type'] !== 'plain_text')
      ),
      sortedBindings(
        desired.bindings.filter(binding => binding['type'] !== 'plain_text')
      ),
      'planned immutable resource identities'
    );
    const desiredVariables = new Set(
      desired.bindings
        .filter(binding => binding['type'] === 'plain_text')
        .map(binding => binding['name'])
    );
    const oldVariables = bindings.filter(
      binding => binding['type'] === 'plain_text'
    );
    if (
      oldVariables.some(
        binding =>
          typeof binding['name'] !== 'string' ||
          typeof binding['text'] !== 'string' ||
          !desiredVariables.has(binding['name'])
      ) ||
      new Set(bindings.map(binding => binding['name'])).size !== bindings.length
    )
      throw new Error(
        'Deployment held: planned variables are invalid or removed'
      );
    previous[workspace] = {...desired, date, bindings};
  }
  return previous;
}

export async function deploymentTarget(
  root: string,
  environment: DeploymentEnvironment
): Promise<DeploymentTarget> {
  // Fixed identities are reviewed deployment policy; see docs/dependency-maintenance.md#deployment-preview-gate.
  const configurations: Partial<DeploymentTarget['workers']> = {};
  let database: DeploymentTarget['database'] | undefined;
  for (const workspace of ['backend', 'frontend'] as const) {
    const config = object(
      Bun.JSONC.parse(
        await Bun.file(
          path.join(root, 'packages', workspace, 'wrangler.jsonc')
        ).text()
      )
    );
    keys(config, [
      '$schema',
      'main',
      'compatibility_date',
      'triggers',
      'observability',
      'env',
      'assets',
    ]);
    const selected = object(object(config['env'])[environment]);
    keys(selected, [
      'name',
      'workers_dev',
      'preview_urls',
      'vars',
      'd1_databases',
      'ratelimits',
    ]);
    const name = `devopsrockstars-${workspace === 'backend' ? 'store' : 'website'}-${environment}`;
    equal(selected['name'], name, 'Worker identity');
    equal(selected['workers_dev'], false, 'workers.dev policy');
    equal(selected['preview_urls'], false, 'preview URL policy');
    // A planned date bump also records the old live date in deployment-transition.json.
    equal(
      config['compatibility_date'],
      '2026-08-31',
      'runtime compatibility date'
    );
    equal(config['observability'], {enabled: true}, 'observability policy');
    const bindings: ObjectValue[] = [];
    const origins =
      environment === 'staging'
        ? 'https://staging.devopsrockstars.com'
        : 'https://devopsrockstars.com,https://www.devopsrockstars.com';
    if (workspace === 'backend') {
      equal(selected['vars'], {STOREFRONT_ORIGINS: origins}, 'store origins');
      bindings.push({
        name: 'STOREFRONT_ORIGINS',
        type: 'plain_text',
        text: origins,
      });
      const databases = array(selected['d1_databases']).map(object);
      equal(databases.length, 1, 'D1 binding count');
      const db = databases[0];
      if (!db) throw new Error('Missing D1 binding');
      const id =
        environment === 'staging'
          ? '35891cf5-2187-43f8-b844-8b96a16e70dc'
          : '3c4ece27-9b96-4978-b747-77a9fa67b7e2';
      const databaseName =
        environment === 'staging'
          ? 'devopsrockstars-store-staging'
          : 'devopsrockstars-store';
      equal(
        db,
        {
          binding: 'DB',
          database_name: databaseName,
          database_id: id,
          migrations_dir: './migrations',
        },
        'D1 identity'
      );
      database = {id, name: databaseName};
      bindings.push({name: 'DB', type: 'd1', id});
      const namespace = environment === 'staging' ? '5950754' : '5950753';
      equal(
        selected['ratelimits'],
        [
          {
            name: 'CHECKOUT_RATE_LIMITER',
            namespace_id: namespace,
            simple: {limit: 2, period: 60},
          },
        ],
        'rate-limit identity'
      );
      bindings.push({
        name: 'CHECKOUT_RATE_LIMITER',
        type: 'ratelimit',
        namespace_id: namespace,
        simple: {limit: 2, period: 60},
      });
      equal(config['main'], './src/index.ts', 'store entrypoint');
      equal(config['triggers'], {crons: ['* * * * *']}, 'store cron');
      equal(config['assets'], undefined, 'store asset configuration');
    } else {
      equal(
        config['assets'],
        {directory: './build', not_found_handling: 'single-page-application'},
        'site assets'
      );
      for (const key of ['vars', 'd1_databases', 'ratelimits'])
        equal(selected[key], undefined, `site ${key}`);
      equal(config['main'], undefined, 'site entrypoint');
      equal(config['triggers'], undefined, 'site triggers');
    }
    configurations[workspace] = {
      name,
      date: '2026-08-31',
      bindings,
      secrets:
        workspace === 'backend'
          ? environment === 'prod'
            ? ['CHECKOUT_HASH_SECRET']
            : [
                'CHECKOUT_HASH_SECRET',
                'STRIPE_PUBLISHABLE_KEY',
                'STRIPE_SECRET_KEY',
                'STRIPE_WEBHOOK_SECRET',
              ]
          : [],
      crons: workspace === 'backend' ? ['* * * * *'] : [],
      domains:
        workspace === 'backend'
          ? [
              environment === 'staging'
                ? 'store-staging.devopsrockstars.com'
                : 'store.devopsrockstars.com',
            ]
          : environment === 'staging'
            ? ['staging.devopsrockstars.com']
            : ['devopsrockstars.com', 'www.devopsrockstars.com'],
    };
  }
  if (!database || !configurations.backend || !configurations.frontend)
    throw new Error('Missing Worker or database identity');
  const migrations = (
    await readdir(path.join(root, 'packages/backend/migrations'))
  ).sort();
  if (
    !migrations.length ||
    migrations.some(name => !/^\d+_[\w-]+\.sql$/u.test(name))
  )
    throw new Error('Deployment held: unreviewed migration directory');
  const workers = {
    backend: configurations.backend,
    frontend: configurations.frontend,
  };
  const transition = Bun.file(path.join(root, 'deployment-transition.json'));
  const previousWorkers = (await transition.exists())
    ? approvedPreviousWorkers(workers, await transition.json(), environment)
    : {};
  return {
    workers,
    previousWorkers,
    database,
    migrations,
  };
}

function normalizedBinding(value: unknown): ObjectValue {
  const binding = object(value);
  switch (binding['type']) {
    case 'plain_text':
      return {name: binding['name'], type: 'plain_text', text: binding['text']};
    case 'd1':
      return {name: binding['name'], type: 'd1', id: binding['id']};
    case 'ratelimit':
      return {
        name: binding['name'],
        type: 'ratelimit',
        namespace_id: binding['namespace_id'],
        simple: binding['simple'],
      };
    case 'secret_text':
      return {name: binding['name'], type: 'secret_text'};
    default:
      throw new Error('Deployment held: unsupported live resource binding');
  }
}

function sortedBindings(bindings: ObjectValue[]) {
  return bindings.toSorted((left, right) =>
    String(left['name']) < String(right['name'])
      ? -1
      : String(left['name']) > String(right['name'])
        ? 1
        : 0
  );
}

// The only POST is a fixed metadata SELECT against an existing table. Missing
// tables hold deployment; this never initializes schema or applies migrations.
export async function inspectDeployment(
  target: DeploymentTarget,
  read: ReadApi,
  requireDesired: readonly WorkerName[] = []
) {
  const domains = array(await read('/workers/domains')).map(object);
  const database = object(await read(`/d1/database/${target.database.id}`));
  equal(database['uuid'], target.database.id, 'live D1 UUID');
  equal(database['name'], target.database.name, 'live D1 name');
  const query = array(
    await read(
      `/d1/database/${target.database.id}/query`,
      migrationMetadataQuery
    )
  );
  equal(query.length, 1, 'D1 migration metadata query');
  const result = object(query[0]);
  equal(result['success'], true, 'D1 migration metadata status');
  equal(object(result['meta'])['changed_db'], false, 'read-only D1 metadata');
  equal(
    array(result['results'])
      .map(value => object(value)['name'])
      .toSorted(),
    target.migrations,
    'pending or unknown D1 migrations'
  );
  const identities: ObjectValue[] = [];
  for (const workspace of ['backend', 'frontend'] as const) {
    const worker = target.workers[workspace];
    const endpoint = `/workers/scripts/${worker.name}`;
    const settings = object(await read(`${endpoint}/settings`));
    equal(settings['compatibility_flags'] ?? [], [], 'live runtime flags');
    const bindings = array(settings['bindings']).map(normalizedBinding);
    const alternatives = [worker];
    const previous = target.previousWorkers?.[workspace];
    if (previous && !requireDesired.includes(workspace))
      alternatives.push(previous);
    if (
      !alternatives.some(
        expected =>
          canonical({
            date: settings['compatibility_date'],
            bindings: sortedBindings(bindings),
          }) ===
          canonical({
            date: expected.date,
            bindings: sortedBindings([
              ...expected.bindings,
              ...expected.secrets.map(name => ({name, type: 'secret_text'})),
            ]),
          })
      )
    )
      throw new Error(
        'Deployment held: live runtime, bindings, or secrets differ from the reviewed transition'
      );
    const subdomain = object(await read(`${endpoint}/subdomain`));
    equal(subdomain['enabled'], false, 'live workers.dev policy');
    equal(subdomain['previews_enabled'], false, 'live preview URL policy');
    const schedules = object(await read(`${endpoint}/schedules`));
    equal(
      array(schedules['schedules'])
        .map(value => object(value)['cron'])
        .toSorted(),
      worker.crons.toSorted(),
      'live cron triggers'
    );
    const bound = domains.filter(domain => domain['service'] === worker.name);
    equal(
      bound.map(domain => domain['hostname']).toSorted(),
      worker.domains.toSorted(),
      'live custom domains'
    );
    for (const domain of bound) {
      equal(domain['zone_name'], 'devopsrockstars.com', 'live domain zone');
      equal(
        domain['environment'],
        'production',
        'live Worker service environment'
      );
      if (
        typeof domain['id'] !== 'string' ||
        typeof domain['zone_id'] !== 'string'
      )
        throw new Error('Deployment held: incomplete custom domain identity');
      identities.push({
        id: domain['id'],
        zone: domain['zone_id'],
        hostname: domain['hostname'],
        service: worker.name,
      });
    }
  }
  const zones = array(await read('/zones')).map(object);
  for (const identity of identities) {
    const zone = zones.find(zone => zone['id'] === identity['zone']);
    if (!zone)
      throw new Error(
        'Deployment held: custom domain zone is not in account inventory'
      );
    equal(zone['name'], 'devopsrockstars.com', 'live account zone');
  }
  for (const zone of zones) {
    const id = zone['id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/u.test(id))
      throw new Error('Deployment held: invalid live zone identity');
    const routes = array(await read(`/zones/${id}/workers/routes`)).map(object);
    if (
      routes.some(route =>
        Object.values(target.workers).some(
          worker => route['script'] === worker.name
        )
      )
    )
      throw new Error('Deployment held: unexpected live Worker routes');
  }
  return canonical(
    identities.sort((a, b) =>
      String(a['hostname']).localeCompare(String(b['hostname']))
    )
  );
}

export function cloudflareReader(
  account: string | undefined,
  token: string | undefined
): ReadApi {
  if (!account || !/^[a-f0-9]{32}$/u.test(account) || !token)
    throw new Error(
      'Deployment held: explicit CLOUDFLARE_ACCOUNT_ID and API token are required'
    );
  return async (endpoint, sql) => {
    if (
      sql !== undefined &&
      (sql !== migrationMetadataQuery ||
        !/^\/d1\/database\/[a-f0-9-]{36}\/query$/u.test(endpoint))
    )
      throw new Error(
        'Deployment held: only migration metadata reads are allowed'
      );
    const apiPath =
      endpoint === '/zones'
        ? `/zones?account.id=${account}&per_page=50&page=1`
        : endpoint.startsWith('/zones/')
          ? endpoint
          : `/accounts/${account}${endpoint}`;
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${apiPath}`,
      {
        method: sql ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(sql ? {body: JSON.stringify({sql})} : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      }
    );
    if (!response.ok)
      throw new Error(`Deployment preview API failed (${response.status})`);
    const body = object(await response.json());
    if (
      body['success'] !== true ||
      (body['errors'] !== null && array(body['errors']).length)
    )
      throw new Error('Deployment preview API did not succeed');
    if (endpoint === '/workers/domains' || endpoint === '/zones') {
      const pages = object(body['result_info']);
      const count = array(body['result']).length;
      if (
        pages['page'] !== 1 ||
        pages['total_count'] !== count ||
        (pages['total_pages'] !== undefined && pages['total_pages'] !== 1) ||
        (pages['count'] !== undefined && pages['count'] !== count) ||
        (pages['per_page'] !== undefined &&
          (typeof pages['per_page'] !== 'number' || pages['per_page'] < count))
      )
        throw new Error('Deployment held: resource inventory is incomplete');
    }
    return body['result'];
  };
}
