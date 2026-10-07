import {afterAll, beforeAll, describe, it} from 'bun:test';
import assert from 'node:assert';
import {browser, expect, startBrowser, stopBrowser} from '../browser';
import {BasePage} from '../pageObjects/base';

beforeAll(startBrowser, 60000);
afterAll(stopBrowser, 60000);

async function expectNoHatPreparation() {
  await expect(
    await browser.$('canvas[aria-label$="interactive 3D preview"]')
  ).not.toExist();
  await expect(await browser.$('[data-hat-preview-status]')).not.toExist();
  assert.deepStrictEqual(
    await browser.execute(() =>
      performance
        .getEntriesByType('resource')
        .filter(
          entry =>
            new URL(entry.name).pathname === '/static/image/store/5950.svg'
        )
        .map(entry => entry.name)
    ),
    [],
    'Production must not fetch the hat embroidery artwork'
  );
}

describe('index page', () => {
  it('loads correctly', async () => {
    await BasePage.open('');
    await BasePage.waitForAppReady();
    const title = await browser.getTitle();
    assert.strictEqual(title, '\u200E');
    await expect(BasePage.skyline).toExist();
    assert.strictEqual(await BasePage.skyline.getTagName(), 'img');
    assert.strictEqual(
      await BasePage.skyline.getAttribute('src'),
      '/static/image/skyline.svg'
    );
    await expect(
      await browser.$(
        '[role="region"][aria-label="Interactive Chicago skyline"]'
      )
    ).not.toExist();
    assert.deepStrictEqual(
      await browser.execute(() =>
        performance
          .getEntriesByType('resource')
          .filter(entry =>
            new URL(entry.name).pathname.startsWith('/static/skyline/')
          )
          .map(entry => entry.name)
      ),
      []
    );
    await expectNoHatPreparation();
  });
});

describe('company page', () => {
  it('loads correctly', async () => {
    await BasePage.open('company');
    await BasePage.waitForAppReady();
    await expect(browser).toHaveUrl(expect.stringContaining('/company'));
    await expect(BasePage.skyline).not.toExist();
    await expect(await browser.$('h1=Contact')).toExist();
    const title = await browser.getTitle();
    assert.strictEqual(title, '\u200E');
    await expectNoHatPreparation();
  });
});

describe('production feature flags', () => {
  it('hides the unlaunched search and store from the navigation', async () => {
    await BasePage.open('');
    await BasePage.waitForAppReady();

    await expect(await browser.$('a[href="/search"]')).not.toExist();
    await expect(await browser.$('a[href="/store"]')).not.toExist();
    await expect(await browser.$('a[href="/company"]')).toExist();
  });

  it('routes the unlaunched pages to the not found page', async () => {
    for (const path of ['search', 'store', 'store/checkout']) {
      await BasePage.open(path);
      await BasePage.waitForAppReady();
      await expect(await browser.$('h1=Not found')).toExist();
    }
  });

  it('invites crawlers', async () => {
    await BasePage.open('');
    await BasePage.waitForAppReady();
    await expect(await browser.$('meta[name="robots"]')).not.toExist();
  });
});
