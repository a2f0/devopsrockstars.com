#!/usr/bin/env bun
import {watch} from 'node:fs';
import path from 'node:path';
import {parseSiteEnvironment} from '../src/environment';
import {bundleFrontend, type FrontendBuildOptions, frontendRoot} from './build';
import {featureFlagsPath} from './featureFlags';

export async function startFrontendServer({
  port = 8080,
  environment = parseSiteEnvironment(process.env['PUBLIC_ENVIRONMENT']),
  featureFlags,
  storeApiOrigin = process.env['STORE_API_ORIGIN'] ?? '',
  apiProxy = process.env['STORE_API_PROXY'] ?? 'http://127.0.0.1:8787',
  watchSources = false,
  minify = false,
}: FrontendBuildOptions & {
  port?: number;
  apiProxy?: string;
  watchSources?: boolean;
} = {}) {
  const options = {
    environment,
    storeApiOrigin,
    minify,
    ...(featureFlags ? {featureFlags} : {}),
  };
  let assets = await bundleFrontend(options);
  const staticRoot = path.join(frontendRoot, 'static');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const url = new URL(request.url);
      // Loopback binding alone does not stop a remote hostname from resolving
      // to this server. Validate Host before exposing files or the API proxy.
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        Number(url.port || 80) !== server.port
      ) {
        return new Response('Forbidden host', {status: 403});
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const upstream = new URL(apiProxy);
        upstream.pathname = url.pathname;
        upstream.search = url.search;
        const proxyRequest = new Request(upstream, request);
        proxyRequest.headers.delete('host');
        try {
          const response = await fetch(proxyRequest, {redirect: 'manual'});
          // Fetch decodes compressed bodies while preserving the upstream
          // headers. Forward the decoded stream with matching headers so the
          // browser does not try to decompress the JSON a second time.
          const headers = new Headers(response.headers);
          headers.delete('content-encoding');
          headers.delete('content-length');
          headers.delete('transfer-encoding');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } catch {
          return new Response('Store API unavailable', {status: 502});
        }
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return new Response('Method not allowed', {
          status: 405,
          headers: {Allow: 'GET, HEAD'},
        });
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Bad path', {status: 400});
      }
      let body = assets.get(pathname);
      if (pathname.startsWith('/static/')) {
        const filename = path.resolve(
          staticRoot,
          pathname.slice('/static/'.length)
        );
        if (!filename.startsWith(`${staticRoot}${path.sep}`))
          return new Response('Not found', {status: 404});
        const file = Bun.file(filename);
        if (await file.exists()) body = file;
      } else if (!body && !path.extname(pathname)) {
        body = assets.get('/index.html');
      }
      if (!body) return new Response('Not found', {status: 404});
      const headers = new Headers({
        'Content-Type': body.type || 'application/octet-stream',
        'Cache-Control': 'no-cache, must-revalidate',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
      });
      if (environment !== 'production')
        headers.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(request.method === 'HEAD' ? null : body, {headers});
    },
  });
  let rebuild = Promise.resolve();
  const rebuildFrontend = () => {
    rebuild = rebuild
      .then(async () => {
        assets = await bundleFrontend(options);
        console.log('Frontend rebuilt; refresh the browser to load changes.');
      })
      .catch(error => console.error('Frontend rebuild failed:', error));
  };
  const watchers = watchSources
    ? [
        ...['src', 'static', 'index.html'].map(name =>
          watch(
            path.join(frontendRoot, name),
            {recursive: name !== 'index.html'},
            rebuildFrontend
          )
        ),
        // Watch the directory so editors that save by atomic rename do not
        // detach the configuration watcher after the first edit.
        watch(path.dirname(featureFlagsPath), (_event, filename) => {
          if (
            filename === null ||
            filename === path.basename(featureFlagsPath)
          ) {
            rebuildFrontend();
          }
        }),
      ]
    : [];
  return {
    url: server.url,
    stop() {
      for (const watcher of watchers) watcher.close();
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length &&
    (arguments_.length !== 2 || arguments_[0] !== '--port')
  )
    throw new Error('Usage: bun tooling/server.ts [--port <port>]');
  const port = arguments_.length ? Number(arguments_[1]) : 8080;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid server port');
  const server = await startFrontendServer({port, watchSources: true});
  console.log(`Frontend listening at ${server.url}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      server.stop();
      process.exit(0);
    });
}
