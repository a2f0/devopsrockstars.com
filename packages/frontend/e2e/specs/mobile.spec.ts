import {afterAll, beforeAll, describe, it} from 'bun:test';
import assert from 'node:assert';
import {browser, expect, startBrowser, stopBrowser} from '../browser';
import {BasePage} from '../pageObjects/base';

beforeAll(startBrowser, 60000);
afterAll(stopBrowser, 60000);

const viewports = [
  {width: 320, height: 640},
  {width: 390, height: 844},
  {width: 412, height: 915},
  {width: 844, height: 390},
];

async function emulatePhone(width: number, height: number) {
  // Window resizing alone can hit Chrome's minimum desktop window width.
  await browser.sendCommand('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await browser.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: true,
  });
}

async function expectLayout(width: number) {
  const layout = await browser.execute(() => {
    const main = document.querySelector('main')?.getBoundingClientRect();
    const footer = document.querySelector('footer')?.getBoundingClientRect();
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainBottom: main?.bottom ?? 0,
      footerTop: footer?.top ?? null,
      links: [...document.querySelectorAll('nav a')].map(link => {
        const r = link.getBoundingClientRect();
        return {left: r.left, right: r.right, height: r.height};
      }),
    };
  });
  assert.strictEqual(layout.width, width, 'The page must not zoom out to fit');
  assert.ok(layout.scrollWidth <= width, 'No horizontal page scrolling');
  if (layout.footerTop !== null) {
    assert.ok(
      layout.footerTop >= layout.mainBottom - 1,
      'The footer must follow content, including on long checkout pages'
    );
  }
  for (const link of layout.links) {
    assert.ok(link.left >= 0 && link.right <= width);
    assert.ok(link.height >= 44, 'Navigation needs phone-sized tap targets');
  }
}

async function tap(selector: string) {
  const element = await browser.$(selector);
  await element.scrollIntoView({block: 'center'});
  const point = await element.getLocation();
  const size = await element.getSize();
  const scroll = await browser.execute(() => ({x: scrollX, y: scrollY}));
  await browser.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      {
        x: point.x - scroll.x + size.width / 2,
        y: point.y - scroll.y + size.height / 2,
      },
    ],
  });
  await browser.sendCommand('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

describe('mobile layouts', () => {
  it('keeps the production skyline at the viewport bottom through resizing', async () => {
    await BasePage.open('');
    for (const {width, height} of viewports) {
      for (const viewportHeight of [height, height - 100]) {
        await emulatePhone(width, viewportHeight);
        await BasePage.waitForAppReady();
        await browser.waitUntil(() =>
          browser.execute(() => {
            const skyline = document.querySelector('#skyline');
            return (
              skyline instanceof HTMLImageElement &&
              skyline.complete &&
              skyline.naturalWidth > 0 &&
              Math.abs(skyline.getBoundingClientRect().bottom - innerHeight) < 1
            );
          })
        );
        await expectLayout(width);
        await expect(await browser.$('#skyline > iframe')).not.toExist();
        await expect(await browser.$('a[href="/store"]')).not.toExist();
        await expect(await browser.$('a[href="/search"]')).not.toExist();
      }
    }
  });

  it('keeps contact links together and supports touch navigation', async () => {
    for (const {width, height} of viewports) {
      await emulatePhone(width, height);
      await BasePage.open('');
      await tap('nav a[href="/company"]');
      await expect(await browser.$('h1=Contact')).toExist();
      await expectLayout(width);
      const links = await browser.execute(() =>
        [...document.querySelectorAll('main a')].map(link => {
          const r = link.getBoundingClientRect();
          const children = [...link.children].map(child => {
            const bounds = child.getBoundingClientRect();
            return {left: bounds.left, right: bounds.right, top: bounds.top};
          });
          return {height: r.height, left: r.left, right: r.right, children};
        })
      );
      assert.strictEqual(links.length, 3);
      for (const link of links) {
        assert.ok(link.height >= 44);
        assert.ok(link.left >= 0 && link.right <= width);
        for (const child of link.children) {
          assert.ok(child.left >= link.left && child.right <= link.right + 1);
        }
      }
      await tap('footer a[href="/"]');
      await expect(await browser.$('img#skyline')).toExist();
      await BasePage.open('store');
      await expect(await browser.$('h1=Not found')).toExist();
      await expectLayout(width);
    }
  });

  it('fits staging search, cart, checkout, and receipts in portrait and landscape', async () => {
    const fixtures = await browser.addInitScript(() => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        const pathname = new URL(String(input), location.href).pathname;
        if (pathname === '/api/storefront') {
          return Response.json({
            products: [
              {
                id: 'hat-5950',
                name: 'DevOps Rockstars 59FIFTY',
                description: 'Fitted, black.\nEmbroidered in Chicago.',
                imagePath: '/static/image/store/5950.svg',
                variants: [
                  {
                    id: 'hat-5950-7-1-4',
                    label: '7 1/4',
                    unitAmount: 2000,
                    currency: 'usd',
                    availableQuantity: 2,
                  },
                ],
              },
            ],
            stripePublishableKey: 'pk_test_store',
          });
        }
        if (pathname.startsWith('/api/orders/')) {
          return Response.json({
            orderId: '12345678-1234-4234-8234-123456789abc',
            status: 'paid',
            totalAmount: 2000,
            currency: 'usd',
          });
        }
        // Layout coverage does not need another expensive model build. The
        // dedicated preview and skyline specs exercise the actual renderers.
        if (pathname === '/static/image/store/5950.svg') {
          throw new Error('Preview unavailable in the layout fixture');
        }
        return originalFetch(input, init);
      };
    });
    try {
      for (const {width, height} of viewports) {
        await emulatePhone(width, height);
        await BasePage.openStaging('search');
        await BasePage.waitForAppReady();
        await browser.execute(() => sessionStorage.clear());
        await expectLayout(width);
        const input = await browser.$('input[aria-label="Search"]');
        assert.ok((await input.getSize()).height >= 44);
        await input.setValue('devops');
        await browser.keys('Enter');
        await expect(await browser.$('[role="status"]')).toExist();
        await tap('nav a[href="/store"]');
        const size = await browser.$('[role="combobox"]');
        await expect(size).toBeEnabled();
        await size.click();
        const option = await browser.$('[role="option"]');
        await expect(option).toBeDisplayed();
        assert.ok((await option.getSize()).height >= 44);
        await option.click();
        await (await browser.$('button=Add to cart')).click();
        await expect(
          await browser.$('aside[aria-label="Shopping cart"]')
        ).toExist();
        await expectLayout(width);
        await (await browser.$('a=Checkout')).click();
        await (await browser.$('input[name="name"]')).waitForDisplayed();
        await expectLayout(width);
        const fields = await browser.execute(() =>
          [...document.querySelectorAll('main input')].map(input => ({
            fontSize: parseFloat(getComputedStyle(input).fontSize),
            height: input.getBoundingClientRect().height,
            right: input.getBoundingClientRect().right,
          }))
        );
        assert.ok(fields.length >= 7);
        for (const field of fields) {
          assert.ok(field.fontSize >= 16 && field.height >= 44);
          assert.ok(field.right <= width);
        }
        await browser.execute(() => {
          sessionStorage.setItem(
            'devopsrockstars.store.order.12345678-1234-4234-8234-123456789abc',
            'mobile-fixture-token'
          );
          scrollTo(0, document.body.scrollHeight);
        });
        await expectLayout(width);
        await BasePage.openStaging(
          'store/receipt?order=12345678-1234-4234-8234-123456789abc'
        );
        await expect(
          await browser.$('p=Thank you. Your payment is complete.')
        ).toExist();
        await expectLayout(width);
      }
    } finally {
      await fixtures.remove();
    }
  });
});
