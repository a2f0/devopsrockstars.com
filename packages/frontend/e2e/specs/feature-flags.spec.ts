import {afterAll, beforeAll, describe, it} from 'bun:test';
import assert from 'node:assert/strict';
import {siteEnvironments} from '../../src/environment';
import {disabledFeatureFlags, featureFlagNames} from '../../src/featureFlags';
import {startFrontendServer} from '../../tooling/server';
import {browser, expect, startBrowser, stopBrowser} from '../browser';

beforeAll(startBrowser, 60000);
afterAll(stopBrowser, 60000);

describe('independent feature flags', () => {
  for (const environment of siteEnvironments) {
    for (const flag of featureFlagNames) {
      it(`enables only ${flag} in ${environment}`, async () => {
        const flags = {...disabledFeatureFlags, [flag]: true};
        const server = await startFrontendServer({
          port: 0,
          environment,
          featureFlags: flags,
          minify: true,
        });
        let fixtures:
          | Awaited<ReturnType<typeof browser.addInitScript>>
          | undefined;
        try {
          fixtures = await browser.addInitScript(() => {
            const originalFetch = globalThis.fetch.bind(globalThis);
            const browserWindow: Window = window;
            browserWindow.fetch = async (input, init) => {
              if (String(input).endsWith('/api/storefront')) {
                document.documentElement.dataset['storefrontRequested'] =
                  'true';
                return Response.json({products: [], stripePublishableKey: ''});
              }
              // Rendering quality and recovery have dedicated preview specs.
              if (String(input).endsWith('/static/image/store/5950.svg')) {
                throw new Error('No hat model needed for flag routing tests');
              }
              return originalFetch(input, init);
            };
          });
          const manifest = await fetch(
            new URL('/feature-flags.json', server.url)
          );
          assert.deepEqual(await manifest.json(), {environment, flags});
          assert.equal(
            manifest.headers.has('X-Robots-Tag'),
            environment === 'staging'
          );
          assert.equal(
            (
              await fetch(new URL('/static/skyline/index.html', server.url), {
                method: 'HEAD',
              })
            ).status,
            flags.skyline3d ? 200 : 404
          );
          await browser.url(server.url.href);
          await (await browser.$('a[href="/company"]')).waitForExist();
          assert.equal(
            await browser.$('nav a[href="/store"]').isExisting(),
            flags.store
          );
          assert.equal(
            await browser.$('nav a[href="/search"]').isExisting(),
            flags.search
          );
          if (flags.skyline3d) {
            await (
              await browser.$('#skyline > [role="region"]')
            ).waitForExist();
            await expect(await browser.$('img#skyline')).not.toExist();
          } else {
            await expect(await browser.$('img#skyline')).toExist();
            await expect(
              await browser.$('#skyline > [role="region"]')
            ).not.toExist();
          }
          if (flags.store) {
            await browser.waitUntil(() =>
              browser.execute(
                () =>
                  document.documentElement.dataset['storefrontRequested'] ===
                  'true'
              )
            );
            await expect(
              await browser.$('[data-hat-preview-status]')
            ).toExist();
          } else {
            assert.equal(
              await browser.execute(
                () => document.documentElement.dataset['storefrontRequested']
              ),
              undefined
            );
            await expect(
              await browser.$('[data-hat-preview-status]')
            ).not.toExist();
          }
          for (const route of [
            'search',
            'store',
            'store/checkout',
            'store/receipt',
          ]) {
            await browser.url(new URL(route, server.url).href);
            await (await browser.$('a[href="/company"]')).waitForExist();
            const enabled = route === 'search' ? flags.search : flags.store;
            assert.equal(
              await browser.$('h1=Not found').isExisting(),
              !enabled
            );
            if (route === 'search' && enabled) {
              await expect(
                await browser.$('input[aria-label="Search"]')
              ).toExist();
            }
          }
        } finally {
          server.stop();
          try {
            await fixtures?.remove();
          } finally {
            await browser.url('about:blank');
          }
        }
      });
    }
  }
});
