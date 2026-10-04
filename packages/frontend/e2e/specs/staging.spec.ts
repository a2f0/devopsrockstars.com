import {afterAll, beforeAll, describe, it} from 'bun:test';
import assert from 'node:assert';
import {browser, expect, startBrowser, stopBrowser} from '../browser';
import {Base, BasePage} from '../pageObjects/base';

beforeAll(startBrowser, 60000);
afterAll(stopBrowser, 60000);

describe('staging environment', () => {
  it('keeps search and store in the navigation for testing', async () => {
    await BasePage.openStaging('');
    await BasePage.waitForAppReady();

    await expect(await browser.$('a[href="/search"]')).toExist();
    await expect(await browser.$('a[href="/store"]')).toExist();
    await expect(await browser.$('a[href="/company"]')).toExist();
  });

  it('tells crawlers not to index the document', async () => {
    await BasePage.openStaging('');
    await BasePage.waitForAppReady();

    const robots = await browser.$('meta[name="robots"]');
    assert.strictEqual(
      await robots.getAttribute('content'),
      'noindex, nofollow'
    );
  });

  it('serves a robots.txt that disallows everything', async () => {
    await browser.url(`${Base.stagingOrigin}/robots.txt`);
    const body = await browser.$('body');
    assert.match(await body.getText(), /User-agent: \*\s+Disallow: \//u);
  });
});

describe('staging 3D skyline', () => {
  it('keeps the SVG visible until background hat preparation finishes', async () => {
    const delayArtwork = await browser.addInitScript(() => {
      const artworkReady = new Promise<void>(resolve => {
        window.addEventListener('release-hat-artwork', () => resolve(), {
          once: true,
        });
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        if (String(input).endsWith('/static/image/store/5950.svg')) {
          await artworkReady;
        }
        return originalFetch(input, init);
      };
    });
    try {
      await BasePage.openStaging('');
      await BasePage.waitForAppReady();
      await expect(await browser.$('img#skyline')).toExist();
      assert.strictEqual(await browser.$$('#skyline > iframe').length, 0);
      await browser.execute(() =>
        window.dispatchEvent(new Event('release-hat-artwork'))
      );
      await browser.waitUntil(
        async () =>
          String(
            await browser
              .$('[data-hat-preview-status]')
              .getProperty('textContent')
          ).includes('3D preview ready'),
        {timeout: 20_000}
      );
      await (await browser.$('#skyline > iframe')).waitForExist({
        timeout: 30_000,
      });
      await expect(await browser.$('img#skyline')).not.toExist();
    } finally {
      await browser.execute(() =>
        window.dispatchEvent(new Event('release-hat-artwork'))
      );
      await delayArtwork.remove();
    }
  });

  it('starts the skyline even when background hat preparation times out', async () => {
    const shortenTimeout = await browser.addInitScript(() => {
      const originalSetTimeout = window.setTimeout;
      window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
        const [handler, delay, ...rest] = args;
        return originalSetTimeout(
          handler,
          delay === 15_000 ? 0 : delay,
          ...rest
        );
      }) as typeof window.setTimeout;
    });
    try {
      await BasePage.openStaging('');
      await browser.waitUntil(async () =>
        String(
          await browser
            .$('[data-hat-preview-status]')
            .getProperty('textContent')
        ).includes('3D preview unavailable')
      );
      await (await browser.$('#skyline > iframe')).waitForExist({
        timeout: 30_000,
      });
    } finally {
      await shortenTimeout.remove();
    }
  });

  it('renders, keeps controls usable, and cleans up on desktop and mobile navigation', async () => {
    try {
      for (const [width, height] of [
        [1280, 900],
        [390, 844],
      ] as const) {
        await browser.sendCommand('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 600,
        });
        await BasePage.openStaging('');
        await BasePage.waitForAppReady();
        const viewer = await browser.$('#skyline > iframe');
        await viewer.waitForExist({timeout: 30000});
        assert.deepStrictEqual(
          await browser.execute(() => {
            const frame = document
              .querySelector('#skyline > iframe')
              ?.getBoundingClientRect();
            return [innerWidth, frame?.top, frame?.bottom];
          }),
          [width, 0, height]
        );
        await expect(await browser.$('img#skyline')).not.toExist();
        await expect(viewer).toHaveAttribute(
          'title',
          'Interactive Chicago skyline'
        );
        await browser.switchFrame(viewer);
        await expect(await browser.$('nav.controls')).not.toBeDisplayed();
        const scene = await browser.$('#skyline-3d-scene');
        await scene.waitForExist({timeout: 30000});
        await browser.switchFrame(scene);
        await browser.waitUntil(
          () =>
            browser.execute(() =>
              Boolean(
                (window as Window & {__buildingStudy?: {ready: boolean}})
                  .__buildingStudy?.ready
              )
            ),
          {
            timeout: 30000,
            timeoutMsg: 'The shared 3D skyline must render its first frame',
          }
        );
        await expect(await browser.$('canvas#building')).toBeDisplayed();
        await (await browser.$('#menu-toggle')).click();
        await expect(await browser.$('#show-original')).toBeDisplayed();
        await (await browser.$('#show-original')).click();
        await browser.switchFrame(null);
        await browser.switchFrame(await browser.$('#skyline > iframe'));
        await expect(await browser.$('#return-skyline-3d')).toBeDisplayed();
        await (await browser.$('#return-skyline-3d')).click();
        await expect(scene).toBeDisplayed();
        await browser.switchFrame(null);
        // The host navigation stays above the viewer and remains clickable.
        await (await browser.$('a[href="/company"]')).click();
        await expect(await browser.$('h1=Contact')).toExist();
        await expect(BasePage.skyline).not.toExist();
        await expect(
          await browser.$('iframe[title="Interactive Chicago skyline"]')
        ).not.toExist();
        await (await browser.$('footer a[href="/"]')).click();
        await expect(await browser.$('#skyline > iframe')).toExist();
        assert.strictEqual(await browser.$$('#skyline > iframe').length, 1);
      }
    } finally {
      await browser.switchFrame(null);
      await browser.sendCommand('Emulation.clearDeviceMetricsOverride', {});
      await browser.setWindowSize(1280, 1000);
    }
  });
});

describe('search page', () => {
  it('shows the original search frontend', async () => {
    await BasePage.openStaging('search');
    await BasePage.waitForAppReady();

    const logo = await browser.$(
      'img[src="/static/image/devopsrockstars-solr.svg"]'
    );
    await expect(logo).toBeDisplayed();

    const searchInput = await browser.$('input[aria-label="Search"]');
    await searchInput.setValue('continuous delivery');
    await browser.keys('Enter');

    await expect(await browser.$('[role="status"]')).toHaveText(
      'Search results are not connected yet. Stay tuned.'
    );
  });
});

describe('store page', () => {
  it('reserves, resumes, edits, and polls a checkout with mocked APIs', async () => {
    const orderId = '12345678-1234-4234-8234-123456789abc';
    const replacementOrderId = '87654321-4321-4321-8321-cba987654321';
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const fixtures = {
      checkout: {
        clientSecret: 'pi_store_secret_test',
        currency: 'usd',
        expiresAt,
        lines: [
          {
            currency: 'usd',
            productName: 'DevOps Rockstars 59FIFTY',
            quantity: 1,
            unitAmount: 2000,
            variantId: 'hat-5950-7-1-4',
            variantLabel: '7 1/4',
          },
        ],
        orderId,
        orderToken: 'order-token',
        totalAmount: 2000,
      },
      replacement: {
        clientSecret: 'pi_replacement_secret_test',
        orderId: replacementOrderId,
        orderToken: 'replacement-token',
      },
      storefront: {
        products: [
          {
            id: 'hat-5950',
            slug: 'devops-rockstars-59fifty',
            name: 'DevOps Rockstars 59FIFTY',
            manufacturer: 'New Era',
            description:
              'Embroidered New Era Low Crown 59FIFTY\nFitted, black.',
            imagePath: '/static/image/store/5950.svg',
            variants: [
              {
                id: 'hat-5950-7-1-8',
                label: '7 1/8',
                sku: 'DOR-5950-7-1-8',
                unitAmount: 2000,
                currency: 'usd',
                availableQuantity: 1,
              },
              {
                id: 'hat-5950-7-1-4',
                label: '7 1/4',
                sku: 'DOR-5950-7-1-4',
                unitAmount: 2000,
                currency: 'usd',
                availableQuantity: 1,
              },
            ],
          },
        ],
        stripePublishableKey: 'pk_test_store',
      },
    };
    const resetFixtures = await browser.addInitScript(fixtures => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        const inputUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const url = new URL(inputUrl, globalThis.location.href);
        if (url.pathname === '/api/storefront') {
          return Response.json(fixtures.storefront);
        }
        if (url.pathname === '/api/checkouts' && init?.method === 'POST') {
          const calls = Number(
            sessionStorage.getItem('__store_test_checkout_calls') ?? '0'
          );
          sessionStorage.setItem(
            '__store_test_checkout_calls',
            String(calls + 1)
          );
          sessionStorage.setItem(
            '__store_test_checkout_body',
            String(init.body)
          );
          // Reserving again after an address change fails twice, then
          // returns a new order.
          if (calls === 1 || calls === 2) {
            return Response.json(
              {
                error: {
                  code: 'checkout_unavailable',
                  message:
                    'The store is busy. Please try again in a few minutes.',
                },
              },
              {status: 503}
            );
          }
          return Response.json(
            calls === 0
              ? fixtures.checkout
              : {...fixtures.checkout, ...fixtures.replacement},
            {status: 201}
          );
        }
        const order = /^\/api\/orders\/([^/]+)(\/cancel)?$/u.exec(url.pathname);
        if (order?.[1] && order[2] && init?.method === 'POST') {
          sessionStorage.setItem(
            '__store_test_canceled',
            `${order[1]} ${new Headers(init.headers).get('X-Order-Token')}`
          );
          return Response.json({
            currency: 'usd',
            expiresAt: fixtures.checkout.expiresAt,
            orderId: order[1],
            status: 'canceled',
            totalAmount: 2000,
          });
        }
        if (order?.[1] && !order[2]) {
          const calls = Number(
            sessionStorage.getItem('__store_test_order_calls') ?? '0'
          );
          sessionStorage.setItem('__store_test_order_calls', String(calls + 1));
          return Response.json({
            currency: 'usd',
            expiresAt: fixtures.checkout.expiresAt,
            orderId: order[1],
            status: calls === 0 ? 'awaiting_payment' : 'paid',
            totalAmount: 2000,
          });
        }
        return originalFetch(input, init);
      };
    }, fixtures);

    try {
      // A known width keeps the product copy's line count deterministic.
      await browser.setWindowSize(1280, 1000);
      await BasePage.openStaging('');
      await browser.execute(() => sessionStorage.clear());
      await BasePage.openStaging('store');
      await BasePage.waitForAppReady();
      const size = await browser.$('[role="combobox"][aria-label$="size"]');
      await expect(size).toBeEnabled();
      // The description keeps the line breaks the catalog stores: copy that
      // would fit on one line at this width still renders as two.
      assert.strictEqual(
        await browser.execute(() => {
          const copy = document.querySelector('main p');
          if (!copy) return 0;
          const lineHeight = parseFloat(getComputedStyle(copy).lineHeight);
          return Math.round(copy.getBoundingClientRect().height / lineHeight);
        }),
        2
      );
      // The first variant is selected by default. The caret beneath the box
      // opens the list, and clicking elsewhere closes it.
      await expect(size).toHaveText('7 1/8');
      const caret = await browser.$('[data-size-caret]');
      const sizes = await browser.$('[role="listbox"][aria-label$="size"]');
      await caret.click();
      await expect(sizes).toBeDisplayed();
      await (await browser.$('[data-product-price]')).click();
      await expect(sizes).not.toBeDisplayed();
      await caret.click();
      await (await sizes.$('[role="option"]=7 1/4')).click();
      await expect(sizes).not.toBeDisplayed();
      await expect(size).toHaveText('7 1/4');
      // Move off the option so hover cannot compete with keyboard focus
      // when the list reopens beneath the pointer.
      await (await browser.$('[data-product-price]')).moveTo();
      // The keyboard walks the list; Escape keeps the size, and Enter or
      // Space picks one without reopening the list.
      await browser.keys(['ArrowDown', 'ArrowUp', 'Escape']);
      await expect(size).toHaveText('7 1/4');
      await browser.keys(['ArrowDown', 'ArrowUp', 'Enter']);
      await expect(size).toHaveText('7 1/8');
      await browser.keys(['ArrowDown', 'ArrowDown', ' ']);
      await expect(sizes).not.toBeDisplayed();
      await expect(size).toHaveText('7 1/4');
      await (await browser.$('button=Add to cart')).click();
      await expect(
        await browser.$('aside[aria-label="Shopping cart"]')
      ).toHaveText('7 1/4', {containing: true});
      await (await browser.$('a=Checkout')).click();

      const customerName = await browser.$('input[name="name"]');
      await customerName.waitForDisplayed();
      await expect(await browser.$('h1 img[alt="checkout"]')).toBeDisplayed();
      await browser.waitUntil(() =>
        browser.execute(() => {
          const image = document.querySelector('h1 img[alt="checkout"]');
          return (
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0
          );
        })
      );
      await customerName.setValue('Grace Hopper');
      await (await browser.$('input[name="email"]')).setValue(
        'grace@example.com'
      );
      await (await browser.$('input[name="address-line1"]')).setValue(
        '1 Navy Way'
      );
      await (await browser.$('input[name="city"]')).setValue('New York');
      await (await browser.$('input[name="state"]')).setValue('NY');
      await (await browser.$('input[name="postal-code"]')).setValue('10001');
      await (await browser.$('button=Continue to payment')).click();

      const shippingAddress = await browser.$('[data-shipping-address]');
      const testCalls = () =>
        browser.execute(() => ({
          canceled: sessionStorage.getItem('__store_test_canceled'),
          checkout: sessionStorage.getItem('__store_test_checkout_calls'),
        }));
      await expect(await browser.$('h2=Payment')).toExist();
      // The reserved address replaces the form with a compact summary.
      await expect(shippingAddress).toHaveText(
        'Grace Hopper\ngrace@example.com\n1 Navy Way\nNew York, NY 10001'
      );
      await expect(await browser.$('input[name="name"]')).not.toExist();
      assert.strictEqual(
        await browser.execute(() =>
          sessionStorage.getItem('__store_test_checkout_calls')
        ),
        '1'
      );
      assert.ok(
        await browser.execute(() =>
          sessionStorage.getItem('devopsrockstars.store.pending-checkout')
        )
      );

      await browser.refresh();
      await BasePage.waitForAppReady();
      await expect(await browser.$('h2=Payment')).toExist();
      await expect(shippingAddress).toHaveText('Grace Hopper', {
        containing: true,
      });
      assert.deepStrictEqual(await testCalls(), {
        canceled: null,
        checkout: '1',
      });

      // Editing reopens the filled form and hides payment. Canceling the edit,
      // or saving the same address, keeps the reservation.
      await (await browser.$('button=Edit')).click();
      const addressLine1 = await browser.$('input[name="address-line1"]');
      await expect(addressLine1).toHaveValue('1 Navy Way');
      await expect(await browser.$('input[name="name"]')).toBeFocused();
      await expect(await browser.$('h2=Payment')).not.toExist();
      await addressLine1.setValue('2 Navy Way');
      await (await browser.$('button=Cancel')).click();
      await expect(shippingAddress).toHaveText('1 Navy Way', {
        containing: true,
      });
      await expect(await browser.$('h2=Payment')).toExist();
      await (await browser.$('button=Edit')).click();
      await expect(addressLine1).toHaveValue('1 Navy Way');
      await (await browser.$('button=Continue to payment')).click();
      await expect(shippingAddress).toHaveText('1 Navy Way', {
        containing: true,
      });
      assert.deepStrictEqual(await testCalls(), {
        canceled: null,
        checkout: '1',
      });

      // A new address cancels the order and reserves the same items again
      // with new credentials, even after the cart changed and a reload
      // followed failed replacement attempts. The reload restores the
      // address of the latest attempt.
      await browser.execute(() =>
        sessionStorage.setItem(
          'devopsrockstars.store.cart',
          JSON.stringify([{variantId: 'hat-5950-7-1-8', quantity: 2}])
        )
      );
      await browser.refresh();
      await BasePage.waitForAppReady();
      await (await browser.$('button=Edit')).click();
      await addressLine1.setValue('2 Navy Way');
      await (await browser.$('input[name="address-line2"]')).setValue('Apt 4');
      const busyStatus = await browser.$(
        'p=The store is busy. Please try again in a few minutes.'
      );
      await (await browser.$('button=Continue to payment')).click();
      await expect(busyStatus).toExist();
      const addressLine2 = await browser.$('input[name="address-line2"]');
      await addressLine2.setValue('Apt 5');
      await (await browser.$('button=Continue to payment')).click();
      await browser.waitUntil(async () => (await testCalls()).checkout === '3');
      await expect(busyStatus).toExist();
      await browser.refresh();
      await BasePage.waitForAppReady();
      await expect(addressLine1).toHaveValue('2 Navy Way');
      await expect(addressLine2).toHaveValue('Apt 5');
      await expect(
        await browser.$('span=DevOps Rockstars 59FIFTY — 7 1/4 × 1')
      ).toExist();
      await (await browser.$('button=Continue to payment')).click();
      await expect(shippingAddress).toHaveText('2 Navy Way, Apt 5', {
        containing: true,
      });
      await expect(await browser.$('h2=Payment')).toExist();
      assert.deepStrictEqual(await testCalls(), {
        canceled: `${orderId} order-token`,
        checkout: '4',
      });
      const replacement = await browser.execute(
        id => ({
          request: JSON.parse(
            sessionStorage.getItem('__store_test_checkout_body') ?? 'null'
          ),
          pending: JSON.parse(
            sessionStorage.getItem('devopsrockstars.store.pending-checkout') ??
              'null'
          ),
          token: sessionStorage.getItem(`devopsrockstars.store.order.${id}`),
          draft: sessionStorage.getItem('devopsrockstars.store.shipping-draft'),
        }),
        replacementOrderId
      );
      assert.deepStrictEqual(replacement.request.items, [
        {variantId: 'hat-5950-7-1-4', quantity: 1},
      ]);
      assert.strictEqual(
        replacement.request.shipping.addressLine1,
        '2 Navy Way'
      );
      assert.strictEqual(replacement.request.shipping.addressLine2, 'Apt 5');
      assert.deepStrictEqual(
        replacement.pending.shipping,
        replacement.request.shipping
      );
      assert.strictEqual(
        replacement.pending.checkout.orderId,
        replacementOrderId
      );
      assert.strictEqual(
        replacement.pending.checkout.clientSecret,
        'pi_replacement_secret_test'
      );
      assert.strictEqual(replacement.token, 'replacement-token');
      assert.strictEqual(replacement.draft, null);

      await BasePage.openStaging(`store/receipt?order=${replacementOrderId}`);
      await expect(
        await browser.$('p=Thank you. Your payment is complete.')
      ).toExist();
      await browser.waitUntil(async () =>
        browser.execute(
          () => Number(sessionStorage.getItem('__store_test_order_calls')) >= 2
        )
      );
      assert.strictEqual(
        await browser.execute(() =>
          sessionStorage.getItem('devopsrockstars.store.cart')
        ),
        '[]'
      );
    } finally {
      await resetFixtures.remove();
    }
  });

  it('fills the whole shipping form from one saved address', async () => {
    const storefront = await browser.addInitScript(() => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) =>
        String(input).endsWith('/api/storefront')
          ? Response.json({
              products: [
                {
                  id: 'hat-5950',
                  name: 'DevOps Rockstars 59FIFTY',
                  description: 'Fitted, black.',
                  imagePath: '/static/image/store/5950.svg',
                  variants: [
                    {
                      id: 'hat-5950-7-1-4',
                      label: '7 1/4',
                      unitAmount: 2000,
                      currency: 'usd',
                      availableQuantity: 1,
                    },
                  ],
                },
              ],
              stripePublishableKey: 'pk_test_store',
            })
          : originalFetch(input, init);
    });

    try {
      await BasePage.openStaging('');
      await browser.execute(() =>
        sessionStorage.setItem(
          'devopsrockstars.store.cart',
          JSON.stringify([{variantId: 'hat-5950-7-1-4', quantity: 1}])
        )
      );
      await BasePage.openStaging('store/checkout');
      await BasePage.waitForAppReady();
      await (await browser.$('input[name="address-line1"]')).waitForDisplayed();

      // The DevTools protocol drives the browser's own address autofill.
      // Starting from the street field, one saved address fills the name and
      // email too, and its full state name becomes the state code.
      const {root} = await browser.sendCommandAndGetResult('DOM.getDocument', {
        depth: 0,
      });
      const {nodeId} = await browser.sendCommandAndGetResult(
        'DOM.querySelector',
        {nodeId: root.nodeId, selector: 'input[name="address-line1"]'}
      );
      const {node} = await browser.sendCommandAndGetResult('DOM.describeNode', {
        nodeId,
      });
      await browser.sendCommandAndGetResult('Autofill.trigger', {
        fieldId: node.backendNodeId,
        address: {
          fields: [
            {name: 'NAME_FULL', value: 'Grace Hopper'},
            {name: 'EMAIL_ADDRESS', value: 'grace@example.com'},
            {name: 'ADDRESS_HOME_LINE1', value: '1 Navy Way'},
            {name: 'ADDRESS_HOME_LINE2', value: 'Apt 4'},
            {name: 'ADDRESS_HOME_CITY', value: 'New York'},
            {name: 'ADDRESS_HOME_STATE', value: 'New York'},
            {name: 'ADDRESS_HOME_ZIP', value: '10001'},
            {name: 'ADDRESS_HOME_COUNTRY', value: 'US'},
          ],
        },
      });

      const expected = {
        name: 'Grace Hopper',
        email: 'grace@example.com',
        'address-line1': '1 Navy Way',
        'address-line2': 'Apt 4',
        city: 'New York',
        state: 'NY',
        'postal-code': '10001',
      };
      for (const [name, value] of Object.entries(expected)) {
        await expect(await browser.$(`input[name="${name}"]`)).toHaveValue(
          value
        );
      }
      // Autofilled fields keep the store's dark look rather than the browser's
      // light autofill colors.
      assert.deepEqual(
        await browser.execute(() => {
          const input = document.querySelector('input[name="name"]');
          if (!input) return null;
          const style = getComputedStyle(input);
          return [style.webkitTextFillColor, style.boxShadow];
        }),
        ['rgb(255, 255, 255)', 'rgb(8, 8, 8) 0px 0px 0px 1000px inset']
      );
    } finally {
      await browser.execute(() => sessionStorage.clear());
      await storefront.remove();
    }
  });

  it('shows a graceful unavailable state without the Worker API', async () => {
    await BasePage.openStaging('store');
    await BasePage.waitForAppReady();

    await expect(
      await browser.$('p=The store is temporarily unavailable.')
    ).toExist();
  });
});
