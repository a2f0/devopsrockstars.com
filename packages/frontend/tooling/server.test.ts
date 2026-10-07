import {afterAll, beforeAll, expect, test} from 'bun:test';
import {hasAllowedOrigin} from '../../backend/src/http';
import {siteEnvironments} from '../src/environment';
import {disabledFeatureFlags, enabledFeatureFlags} from '../src/featureFlags';
import {loadFeatureFlagConfiguration} from './featureFlags';
import {startFrontendServer} from './server';

// Use the actual local Worker command's configuration, so a proxy request must
// satisfy the same origin validation as checkout and cancellation in dev.
const backendManifest = (await Bun.file(
  new URL('../../backend/package.json', import.meta.url)
).json()) as {scripts: {dev: string}};
const localOrigins = backendManifest.scripts.dev.match(
  /--var STOREFRONT_ORIGINS:(\S+)/u
)?.[1];
if (!localOrigins)
  throw new Error('Local Worker command must configure storefront origins');
const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (!hasAllowedOrigin(request, localOrigins))
      return new Response('Forbidden', {status: 403});
    if (new URL(request.url).pathname === '/api/compressed')
      return new Response(Bun.gzipSync(JSON.stringify({ok: true})), {
        headers: {
          'Content-Encoding': 'gzip',
          'Content-Type': 'application/json',
        },
      });
    return Response.json(
      {
        method: request.method,
        path: new URL(request.url).pathname,
        query: new URL(request.url).search,
        body: await request.text(),
      },
      {status: 201, headers: {'X-API': 'proxied'}}
    );
  },
});
let production: Awaited<ReturnType<typeof startFrontendServer>>;
let staging: typeof production;
beforeAll(async () => {
  production = await startFrontendServer({
    port: 0,
    environment: 'production',
    featureFlags: disabledFeatureFlags,
    apiProxy: upstream.url.href,
  });
  staging = await startFrontendServer({
    port: 0,
    environment: 'staging',
    featureFlags: enabledFeatureFlags,
    apiProxy: upstream.url.href,
  });
}, 30000);
afterAll(() => {
  production?.stop();
  staging?.stop();
  upstream.stop(true);
});

test('simultaneous environments serve isolated HTML, hashed modules and robots rules', async () => {
  for (const [server, indexable] of [
    [production, true],
    [staging, false],
  ] as const) {
    const page = await fetch(new URL('/store/receipt', server.url));
    const html = await page.text();
    expect(html.includes('noindex, nofollow')).toBe(!indexable);
    expect(page.headers.has('X-Robots-Tag')).toBe(!indexable);
    const entry = html.match(/src="(\/assets\/[^"]+\.js)"/u)?.[1];
    expect(entry).toBeDefined();
    const module = await fetch(new URL(entry as string, server.url));
    expect(module.status).toBe(200);
    expect(module.headers.get('Content-Type')).toContain('javascript');
    const robots = await (
      await fetch(new URL('/robots.txt', server.url))
    ).text();
    expect(robots).toContain(indexable ? 'Allow: /' : 'Disallow: /');
  }
});

test('static assets have correct MIME types and missing files never become HTML', async () => {
  const svg = await fetch(
    new URL('/static/image/white-star-only.svg', production.url)
  );
  expect(svg.status).toBe(200);
  expect(svg.headers.get('Content-Type')).toContain('image/svg+xml');
  const head = await fetch(
    new URL('/static/image/white-star-only.svg', production.url),
    {method: 'HEAD'}
  );
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  for (const pathname of [
    '/assets/missing.js',
    '/static/missing',
    '/static/%2e%2e%2fpackage.json',
  ]) {
    expect((await fetch(new URL(pathname, production.url))).status).toBe(404);
  }
  expect(
    (await fetch(new URL('/', production.url), {method: 'POST'})).status
  ).toBe(405);
});

test('each environment serves skyline assets only when its flag is enabled', async () => {
  for (const [server, environment, flags] of [
    [production, 'production', disabledFeatureFlags],
    [staging, 'staging', enabledFeatureFlags],
  ] as const) {
    for (const pathname of [
      '/static/skyline/index.html',
      '/static/skyline/skyline-viewer.js',
      '/static/skyline/viewer.css',
      '/static/skyline/three-engine.js',
      '/static/skyline/skyline-3d.html',
      '/static/skyline/skyline-3d.js',
      '/static/skyline/skyline-viewer.js',
      '/static/skyline/viewer.css',
      '/static/skyline/models/crain-geographic.js',
      '/static/skyline/vendor/three-r186.js',
      '/static/skyline/stars.svg',
    ]) {
      const response = await fetch(new URL(pathname, server.url));
      expect(response.status).toBe(flags.skyline3d ? 200 : 404);
      if (flags.skyline3d) {
        expect(response.headers.has('X-Robots-Tag')).toBe(
          environment === 'staging'
        );
        if (pathname.endsWith('.js'))
          expect(response.headers.get('Content-Type')).toContain('javascript');
      }
    }
  }
  expect(
    (await fetch(new URL('/static/skyline/missing.js', staging.url))).status
  ).toBe(404);
});

test('build manifests expose only the flags resolved for that environment', async () => {
  const configuration = await loadFeatureFlagConfiguration();
  for (const environment of siteEnvironments) {
    const server = await startFrontendServer({port: 0, environment});
    try {
      const response = await fetch(new URL('/feature-flags.json', server.url));
      expect(response.headers.get('Content-Type')).toContain(
        'application/json'
      );
      expect(response.headers.get('Cache-Control')).toContain('no-cache');
      expect(await response.json()).toEqual({
        environment,
        flags: configuration[environment],
      });
    } finally {
      server.stop();
    }
  }
});

test('API proxy preserves method, body, query, response status and headers', async () => {
  const response = await fetch(new URL('/api/checkouts?test=1', staging.url), {
    method: 'POST',
    body: 'order',
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('X-API')).toBe('proxied');
  expect(await response.json()).toEqual({
    method: 'POST',
    path: '/api/checkouts',
    query: '?test=1',
    body: 'order',
  });
});

test('local browser checkout and cancellation pass the backend origin check', async () => {
  for (const origin of localOrigins.split(',')) {
    for (const endpoint of [
      '/api/checkouts',
      '/api/orders/10000000-0000-4000-8000-000000000001/cancel',
    ]) {
      const response = await fetch(new URL(endpoint, staging.url), {
        method: 'POST',
        headers: {Origin: origin, 'Sec-Fetch-Site': 'same-origin'},
        body: '{}',
      });
      expect(response.status).toBe(201);
    }
  }
});

test('proxy preserves rejection of cross-site browser requests', async () => {
  for (const headers of [
    {Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site'},
    {'Sec-Fetch-Site': 'cross-site'},
  ]) {
    const response = await fetch(new URL('/api/checkouts', staging.url), {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(response.status).toBe(403);
  }
});

test('proxy forwards compressed upstream JSON as a readable decoded response', async () => {
  const response = await fetch(new URL('/api/compressed', staging.url));
  expect(response.headers.has('Content-Encoding')).toBe(false);
  expect(await response.json()).toEqual({ok: true});
});

test('server rejects DNS rebinding hosts before serving pages, assets or proxy responses', async () => {
  for (const pathname of [
    '/',
    '/static/image/white-star-only.svg',
    '/api/checkouts',
  ]) {
    for (const host of [
      'attacker.example',
      'localhost.attacker.example',
      '127.0.0.1.attacker.example',
    ]) {
      const response = await fetch(new URL(pathname, staging.url), {
        headers: {Host: `${host}:${staging.url.port}`},
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Forbidden host');
    }
  }
  const wrongPort = await fetch(staging.url, {headers: {Host: '127.0.0.1:1'}});
  expect(wrongPort.status).toBe(403);
  for (const host of ['localhost', '127.0.0.1']) {
    const response = await fetch(staging.url, {
      headers: {Host: `${host}:${staging.url.port}`},
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('type="module"');
  }
});
