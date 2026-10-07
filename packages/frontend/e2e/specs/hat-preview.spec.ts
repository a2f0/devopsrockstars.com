import {afterAll, beforeAll, describe, it} from 'bun:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browser, expect, startBrowser, stopBrowser} from '../browser';
import {BasePage} from '../pageObjects/base';

beforeAll(startBrowser, 60000);
afterAll(stopBrowser, 60000);

const canvasSelector = 'canvas[aria-label$="interactive 3D preview"]';
const imageSelector = 'img[alt="DevOps Rockstars 59FIFTY"]';
const loadingSelector = '[data-hat-loading]';
const statusSelector = '[data-hat-preview-status]';

async function waitForPreparedPreview() {
  // The app allows 15 seconds for preparation. Software rendering on CI can
  // exceed WebDriver's default 10-second wait, especially on the Home page.
  await browser.waitUntil(
    async () =>
      String(
        await browser.$(statusSelector).getProperty('textContent')
      ).includes('3D preview ready'),
    {
      timeout: 20_000,
      timeoutMsg: 'The background 3D preview did not become ready',
    }
  );
}

async function expectUnavailable() {
  await browser.waitUntil(async () =>
    String(await browser.$(statusSelector).getProperty('textContent')).includes(
      '3D preview unavailable'
    )
  );
  await expect(await browser.$(canvasSelector)).not.toBeDisplayed();
  await expect(await browser.$(imageSelector)).not.toExist();
  await expect(await browser.$(loadingSelector)).not.toExist();
  await expect(await browser.$('p=Fitted, black.')).toBeDisplayed();
}

async function canvasSnapshot(elementId: string) {
  // Device emulation uses BiDi. Keep the screenshot on that protocol too:
  // Chrome's classic element endpoint can lose its crop offset afterward.
  const {data} = await browser.browsingContextCaptureScreenshot({
    context: await browser.getWindowHandle(),
    clip: {type: 'element', element: {sharedId: elementId}},
  });
  return data;
}

async function saveFailureRenders(renders: Record<string, string>) {
  const directory = join(
    process.env['RUNNER_TEMP'] ?? tmpdir(),
    'hat-preview-failures'
  );
  await mkdir(directory, {recursive: true});
  for (const [name, png] of Object.entries(renders)) {
    await writeFile(join(directory, `${name}.png`), Buffer.from(png, 'base64'));
  }
}

describe('3D hat preview', () => {
  // Rotation and recoloring each construct several independent WebGL scenes.
  // Software shader compilation on CI needs more time than a single page test.
  let fixtures: Awaited<ReturnType<typeof browser.addInitScript>>;

  beforeAll(async () => {
    fixtures = await browser.addInitScript(() => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        if (String(input).endsWith('/api/storefront')) {
          const requests =
            Number(
              document.documentElement.dataset['storefrontRequests'] ?? '0'
            ) + 1;
          document.documentElement.dataset['storefrontRequests'] =
            String(requests);
          if (
            requests > 1 &&
            document.documentElement.hasAttribute('data-hold-store-refresh')
          ) {
            await new Promise<void>(resolve => {
              window.addEventListener(
                'release-store-refresh',
                () => resolve(),
                {
                  once: true,
                }
              );
            });
          }
          const response = Response.json({
            products: [
              {
                id: 'hat-5950',
                name: 'DevOps Rockstars 59FIFTY',
                description: 'Fitted, black.',
                imagePath: '/static/image/store/5950.svg',
                variants: [
                  {
                    id: 'hat-small',
                    label: '7',
                    unitAmount: 2000,
                    currency: 'usd',
                    availableQuantity: 1,
                  },
                ],
              },
            ],
          });
          const readJson = response.json.bind(response);
          response.json = async () => {
            const body = await readJson();
            document.documentElement.setAttribute('data-storefront-read', '');
            return body;
          };
          return response;
        }
        return originalFetch(input, init);
      };
    });
  });

  afterAll(async () => fixtures.remove());

  it('shows the store while the preview builds and keeps the layout stable', async () => {
    const delayArtwork = await browser.addInitScript(() => {
      const artworkReady = new Promise<void>(resolve => {
        window.addEventListener('release-hat-artwork', () => resolve(), {
          once: true,
        });
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (String(input).endsWith('/static/image/store/5950.svg')) {
          await artworkReady;
        }
        return response;
      };
    });
    try {
      await BasePage.openStaging('store');
      const loading = await browser.$(loadingSelector);
      await expect(loading).toHaveText('');
      const status = await browser.$(statusSelector);
      const statusId = await status.elementId;
      const star = await loading.$('img');
      await expect(star).toBeDisplayed();
      await browser.waitUntil(() =>
        browser.execute(selector => {
          const image = document.querySelector<HTMLImageElement>(
            `${selector} img`
          );
          return Boolean(image?.complete && image.naturalWidth > 0);
        }, loadingSelector)
      );
      await expect(await browser.$(imageSelector)).not.toExist();
      const canvas = await browser.$(canvasSelector);
      await expect(canvas).not.toBeDisplayed();
      await expect(canvas).toHaveAttribute('tabindex', '-1');
      const size = await browser.$('[role="combobox"][aria-label$="size"]');
      await expect(size).toBeDisplayed();
      await expect(await browser.$('button=Add to cart')).toBeDisplayed();
      await expect(await browser.$('p=Fitted, black.')).toBeDisplayed();
      await expect(await browser.$('[data-product-price]')).toBeDisplayed();
      const {starCenter, stage} = await browser.execute(() => {
        const star = document.querySelector('[data-hat-loading] img');
        const stage = star?.closest('[data-hat-loading]')?.parentElement;
        if (!star || !stage) throw new Error('The preview spinner is missing.');
        const {left, top, width, height} = star.getBoundingClientRect();
        const bounds = stage.getBoundingClientRect();
        return {
          starCenter: {x: left + width / 2, y: top + height / 2},
          stage: {
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          },
        };
      });
      assert.ok(Math.abs(stage.x - starCenter.x) < 1);
      assert.ok(Math.abs(stage.y - starCenter.y) < 1);
      const position = await size.getLocation();
      const transform = await star.getCSSProperty('transform');
      await browser.waitUntil(
        async () =>
          (await star.getCSSProperty('transform')).value !== transform.value
      );
      await browser.sendCommand('Emulation.setEmulatedMedia', {
        features: [{name: 'prefers-reduced-motion', value: 'reduce'}],
      });
      await browser.waitUntil(() =>
        browser.execute(selector => {
          const loading = document.querySelector(selector);
          return (
            matchMedia('(prefers-reduced-motion: reduce)').matches &&
            loading?.getAnimations({subtree: true}).length === 0
          );
        }, loadingSelector)
      );
      await browser.execute(() => {
        window.dispatchEvent(new Event('release-hat-artwork'));
      });
      await canvas.waitForDisplayed();
      await expect(loading).not.toExist();
      await expect(await browser.$(imageSelector)).not.toExist();
      await browser.waitUntil(async () =>
        String(await status.getProperty('textContent')).includes(
          '3D preview ready'
        )
      );
      assert.equal(await browser.$(statusSelector).elementId, statusId);
      await expect(canvas).toHaveAttribute('tabindex', '0');
      await expect(size).toBeEnabled();
      await expect(await browser.$('button=Add to cart')).toBeDisplayed();
      await expect(await browser.$('p=Fitted, black.')).toBeDisplayed();
      await expect(await browser.$('[data-product-price]')).toBeDisplayed();
      assert.deepEqual(await size.getLocation(), position);
    } finally {
      await browser.execute(() => {
        window.dispatchEvent(new Event('release-hat-artwork'));
        sessionStorage.removeItem('devopsrockstars.store.cart');
      });
      await browser.sendCommand('Emulation.setEmulatedMedia', {features: []});
      await delayArtwork.remove();
    }
  });

  it('prepares and renders the model on Home and Company before Store navigation', async () => {
    const probe = await browser.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      const contexts = new Set<RenderingContext>();
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type,
        ...args
      ) {
        const context = getContext.call(this, type, ...args);
        // The Home skyline renders its own labelled canvas in this document.
        if (
          context &&
          type === 'webgl2' &&
          this.matches('canvas[aria-label$="interactive 3D preview"]')
        ) {
          contexts.add(context);
          document.documentElement.dataset['previewContexts'] = String(
            contexts.size
          );
        }
        return context;
      } as typeof getContext;
      const draw = WebGL2RenderingContext.prototype.drawElements;
      WebGL2RenderingContext.prototype.drawElements = function (...args) {
        if (this.canvas instanceof HTMLCanvasElement) {
          this.canvas.dataset['drawCalls'] = String(
            Number(this.canvas.dataset['drawCalls'] ?? 0) + 1
          );
        }
        return draw.apply(this, args);
      };
    });
    try {
      for (const path of ['', 'company']) {
        await BasePage.openStaging(path);
        await waitForPreparedPreview();
        const canvas = await browser.$(canvasSelector);
        const canvasId = await canvas.elementId;
        await expect(canvas).not.toBeDisplayed();
        assert.ok(
          Number(await canvas.getAttribute('data-draw-calls')) > 0,
          'The hidden preview must finish a GPU render before navigation'
        );
        assert.equal(
          await browser.execute(() => {
            const canvas =
              document.querySelector<HTMLCanvasElement>('canvas[aria-label]');
            canvas?.focus();
            return document.activeElement === canvas;
          }),
          false,
          'The parked preview must not receive keyboard focus'
        );

        for (let visit = 0; visit < 2; visit++) {
          const firstFrame = await browser.execute(async () => {
            const canvas =
              document.querySelector<HTMLCanvasElement>('canvas[aria-label]');
            // The router may defer committing the next route. Inspect the
            // first Store commit before paint, without waiting for its preview.
            const storeMounted = new Promise<void>(resolve => {
              const observer = new MutationObserver(() => {
                if (!document.querySelector('[data-product-price]')) return;
                observer.disconnect();
                resolve();
              });
              observer.observe(document.body, {childList: true, subtree: true});
            });
            document
              .querySelector<HTMLAnchorElement>('a[href="/store"]')
              ?.click();
            await storeMounted;
            return {
              path: location.pathname,
              sameCanvas:
                canvas === document.querySelector('canvas[aria-label]'),
              visible: canvas?.checkVisibility({
                opacityProperty: true,
                visibilityProperty: true,
              }),
              interactive: !canvas?.closest('[inert]'),
              loading: Boolean(document.querySelector('[data-hat-loading]')),
              oldImage: Boolean(
                document.querySelector('img[alt="DevOps Rockstars 59FIFTY"]')
              ),
              contexts: document.documentElement.dataset['previewContexts'],
            };
          });
          assert.deepEqual(firstFrame, {
            path: '/store',
            sameCanvas: true,
            visible: true,
            interactive: true,
            loading: false,
            oldImage: false,
            contexts: '1',
          });
          assert.equal(await browser.$(canvasSelector).elementId, canvasId);
          await (await browser.$('a[href="/company"]')).click();
          await expect(canvas).not.toBeDisplayed();
        }
      }
    } finally {
      await probe.remove();
    }
  });

  it('continues a preview build across navigation without losing its context', async () => {
    const probe = await browser.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      let armed = true;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type,
        ...args
      ) {
        const context = getContext.call(this, type, ...args);
        if (
          armed &&
          type === 'webgl2' &&
          this.matches('canvas[aria-label$="interactive 3D preview"]')
        ) {
          armed = false;
          this.addEventListener('webglcontextlost', () => {
            document.documentElement.setAttribute(
              'data-preview-context-lost',
              ''
            );
          });
          // Navigate during the first yielded model-building task.
          setTimeout(() => {
            document
              .querySelector<HTMLAnchorElement>('a[href="/company"]')
              ?.click();
          }, 0);
        }
        return context;
      } as typeof getContext;
    });
    try {
      await BasePage.openStaging('store');
      await waitForPreparedPreview();
      assert.deepEqual(
        await browser.execute(() => ({
          lost: document.documentElement.hasAttribute(
            'data-preview-context-lost'
          ),
          path: location.pathname,
        })),
        {lost: false, path: '/company'}
      );
      const canvasId = await browser.$(canvasSelector).elementId;
      await (await browser.$('a[href="/store"]')).click();
      await expect(await browser.$(canvasSelector)).toBeDisplayed();
      assert.equal(await browser.$(canvasSelector).elementId, canvasId);
    } finally {
      await probe.remove();
    }
  });

  it('rebuilds a lost parked context when the Store is opened', async () => {
    await BasePage.openStaging('');
    await waitForPreparedPreview();
    const parkedCanvasId = await browser.$(canvasSelector).elementId;
    assert.ok(
      await browser.execute(() => {
        const canvas =
          document.querySelector<HTMLCanvasElement>('canvas[aria-label]');
        const extension = canvas
          ?.getContext('webgl2')
          ?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return Boolean(extension);
      })
    );
    await browser.waitUntil(async () =>
      String(
        await browser.$(statusSelector).getProperty('textContent')
      ).includes('3D preview unavailable')
    );
    await (await browser.$('a[href="/store"]')).click();
    await waitForPreparedPreview();
    assert.notEqual(await browser.$(canvasSelector).elementId, parkedCanvasId);
    await expect(await browser.$(canvasSelector)).toBeDisplayed();
    await expect(await browser.$(imageSelector)).not.toExist();
  });

  it('shows a restored cart while the preview finishes loading', async () => {
    const restoreCart = await browser.addInitScript(() => {
      sessionStorage.setItem(
        'devopsrockstars.store.cart',
        JSON.stringify([{variantId: 'hat-small', quantity: 1}])
      );
      const artworkReady = new Promise<void>(resolve => {
        window.addEventListener('release-hat-artwork', () => resolve(), {
          once: true,
        });
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (String(input).endsWith('/static/image/store/5950.svg')) {
          await artworkReady;
        }
        return response;
      };
    });
    try {
      await BasePage.openStaging('store');
      await expect(await browser.$(loadingSelector)).toExist();
      await expect(await browser.$('p=Fitted, black.')).toBeDisplayed();
      await expect(
        await browser.$('aside[aria-label="Shopping cart"]')
      ).toBeDisplayed();
      await browser.execute(() => {
        window.dispatchEvent(new Event('release-hat-artwork'));
      });
      await expect(
        await browser.$('aside[aria-label="Shopping cart"]')
      ).toBeDisplayed();
    } finally {
      await browser.execute(() => {
        window.dispatchEvent(new Event('release-hat-artwork'));
        sessionStorage.removeItem('devopsrockstars.store.cart');
      });
      await restoreCart.remove();
    }
  });

  it('shows cached inventory from Company while refreshing and building the preview', async () => {
    const advanceClock = await browser.addInitScript(() => {
      const now = Date.now.bind(Date);
      let offset = 0;
      Date.now = () => now() + offset;
      window.addEventListener('advance-store-clock', () => {
        offset = 31_000;
      });
    });
    const delayArtwork = await browser.addInitScript(() => {
      const artworkReady = new Promise<void>(resolve => {
        window.addEventListener('release-hat-artwork', () => resolve(), {
          once: true,
        });
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        if (String(input).endsWith('/static/image/store/5950.svg')) {
          await artworkReady;
        }
        return response;
      };
    });
    try {
      await BasePage.openStaging('company');
      await browser.waitUntil(() =>
        browser.execute(() =>
          document.documentElement.hasAttribute('data-storefront-read')
        )
      );
      await browser.execute(() => {
        window.dispatchEvent(new Event('advance-store-clock'));
        document.documentElement.setAttribute('data-hold-store-refresh', '');
      });
      await (await browser.$('a[href="/store"]')).click();
      await expect(await browser.$(loadingSelector)).toExist();
      await expect(await browser.$(imageSelector)).not.toExist();
      await expect(await browser.$('p=Fitted, black.')).toBeDisplayed();
      await expect(await browser.$('[data-product-price]')).toBeDisplayed();
      await expect(await browser.$('button=Add to cart')).toBeDisplayed();
      await expect(await browser.$('button=Add to cart')).toBeDisabled();
      await expect(await browser.$('p=Updating inventory…')).toBeDisplayed();
      const sizePosition = await (
        await browser.$('[role="combobox"][aria-label$="size"]')
      ).getLocation();
      assert.equal(
        await browser.execute(() =>
          document.body.textContent?.includes('Loading inventory…')
        ),
        false
      );
      await browser.execute(() => {
        document.documentElement.removeAttribute('data-hold-store-refresh');
        window.dispatchEvent(new Event('release-store-refresh'));
        window.dispatchEvent(new Event('release-hat-artwork'));
      });
      await expect(await browser.$(canvasSelector)).toBeDisplayed();
      await expect(await browser.$('button=Add to cart')).toBeEnabled();
      await expect(await browser.$('p=Updating inventory…')).not.toExist();
      await expect(await browser.$('[data-product-price]')).toBeDisplayed();
      assert.deepEqual(
        await (
          await browser.$('[role="combobox"][aria-label$="size"]')
        ).getLocation(),
        sizePosition
      );
    } finally {
      await browser.execute(() => {
        document.documentElement.removeAttribute('data-hold-store-refresh');
        window.dispatchEvent(new Event('release-store-refresh'));
        window.dispatchEvent(new Event('release-hat-artwork'));
      });
      await delayArtwork.remove();
      await advanceClock.remove();
    }
  });

  it('renders a full turn, responds to dragging and keys, and resets', async () => {
    await BasePage.openStaging('store');
    const canvas = await browser.$(canvasSelector);
    await canvas.waitForDisplayed();
    await expect(await browser.$(imageSelector)).not.toBeDisplayed();
    // Compare rendered pixels, so changing UI state without rotating the model
    // cannot satisfy the test. Capture only the canvas to exclude page changes.
    const snapshot = async () => canvasSnapshot(await canvas.elementId);
    const renderState = () =>
      browser.execute(() => {
        const target = document.querySelector('canvas');
        const gl = target?.getContext('webgl2');
        const rect = target?.getBoundingClientRect();
        return {
          density: devicePixelRatio,
          viewport: [innerWidth, innerHeight],
          buffer: gl && [gl.drawingBufferWidth, gl.drawingBufferHeight],
          antialias: gl?.getContextAttributes()?.antialias,
          bounds: rect && [rect.x, rect.y, rect.width, rect.height],
        };
      });
    await canvas.click();
    const initial = await snapshot();
    const initialState = await renderState();
    for (let step = 0; step < 12; step++) await browser.keys('ArrowRight');
    assert.notEqual(await snapshot(), initial);
    for (let step = 0; step < 12; step++) await browser.keys('ArrowRight');
    assert.equal(await snapshot(), initial);

    await canvas.dragAndDrop({x: 90, y: 25}, {duration: 300});
    assert.notEqual(await snapshot(), initial);
    await canvas.click();
    await browser.keys('Home');
    assert.equal(await snapshot(), initial);

    const viewport = await browser.execute(() => ({
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
    }));
    const restoreDevice = await browser.emulate('device', 'iPhone 12');
    try {
      await expect(canvas).toBeDisplayed();
      const beforeTouch = await snapshot();
      await browser
        .action('pointer', {parameters: {pointerType: 'touch'}})
        .move({origin: canvas, x: 0, y: 0})
        .down({button: 0})
        .move({origin: canvas, x: 70, y: 20, duration: 300})
        .up({button: 0})
        .perform();
      assert.notEqual(await snapshot(), beforeTouch);
      assert.ok(
        await browser.execute(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      );
    } finally {
      await restoreDevice();
      // WebdriverIO restores its Desktop Chrome preset, not the viewport
      // from before emulation. Pixel comparisons need the original layout.
      await browser.setViewport(viewport);
    }

    // Navigation parks the existing context and controls; returning reuses them.
    await (await browser.$('a[href="/company"]')).click();
    await (await browser.$('a[href="/store"]')).click();
    await expect(await browser.$(canvasSelector)).toBeDisplayed();
    // A fresh page constructs the same textures, pose and render pipeline,
    // even when it reports a different display density at initialization.
    const displayScale = await browser.addInitScript(() => {
      Object.defineProperty(window, 'devicePixelRatio', {value: 3});
    });
    try {
      await BasePage.openStaging('store');
      const recreated = await browser.$(canvasSelector);
      await recreated.waitForDisplayed();
      await recreated.click();
      const recreatedState = await renderState();
      assert.deepEqual(recreatedState.bounds, initialState.bounds);
      const fresh = await canvasSnapshot(await recreated.elementId);
      if (fresh !== initial) await saveFailureRenders({initial, fresh});
      assert.ok(
        fresh === initial,
        `A fresh page at another display density must render identically: ${JSON.stringify({initialState, recreatedState})}`
      );
    } finally {
      await displayScale.remove();
    }
  });

  it('renders the white flag on the side and white Batterman on the back', async () => {
    for (const {asset, steps} of [
      {asset: 'new-era-flag.svg', steps: 3},
      {asset: 'mlb-batterman.svg', steps: 12},
    ]) {
      const snapshot = async () => {
        await BasePage.openStaging('store');
        const canvas = await browser.$(canvasSelector);
        await canvas.waitForDisplayed();
        await canvas.click();
        for (let step = 0; step < steps; step++)
          await browser.keys('ArrowRight');
        return canvasSnapshot(await canvas.elementId);
      };
      const original = await snapshot();
      // Recolor only this asset, then require its white stitches to turn red in
      // the expected view. An omitted badge or a badge on the far side fails.
      const recolor = await browser.addInitScript(asset => {
        const originalFetch = globalThis.fetch.bind(globalThis);
        const browserWindow: Window = window;
        browserWindow.fetch = async (input, init) => {
          const response = await originalFetch(input, init);
          if (String(input).endsWith(`/static/image/store/${asset}`)) {
            return new Response(
              (await response.text()).replaceAll('#f4f4f4', '#ff0000'),
              {headers: {'Content-Type': 'image/svg+xml'}}
            );
          }
          return response;
        };
      }, asset);
      try {
        const recolored = await snapshot();
        const changedStitches = await browser.execute(
          async (original, recolored) => {
            const pixels = async (png: string) => {
              const image = new Image();
              image.src = `data:image/png;base64,${png}`;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Could not read the badge pixels.');
              context.drawImage(image, 0, 0);
              return context.getImageData(0, 0, canvas.width, canvas.height)
                .data;
            };
            const before = await pixels(original);
            const after = await pixels(recolored);
            let count = 0;
            for (let i = 0; i < before.length; i += 4) {
              const [r = 0, g = 0, b = 0] = before.slice(i, i + 3);
              const [red = 0, green = 0, blue = 0] = after.slice(i, i + 3);
              if (
                Math.min(r, g, b) > 80 &&
                Math.max(r, g, b) - Math.min(r, g, b) < 30 &&
                red > 100 &&
                red > green * 1.5 &&
                red > blue * 1.5
              ) {
                count++;
              }
            }
            return count;
          },
          original,
          recolored
        );
        if (changedStitches <= 20) {
          await saveFailureRenders({
            [`${asset}-original`]: original,
            [`${asset}-recolored`]: recolored,
          });
        }
        assert.ok(
          changedStitches > 20,
          `${asset} must be visibly embroidered (${changedStitches} matching pixels)`
        );
      } finally {
        await recolor.remove();
      }
    }
  });

  it('stops loading and keeps purchase controls when WebGL is unavailable', async () => {
    const disableWebGL = await browser.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type,
        ...args
      ) {
        if (type === 'webgl2') {
          document.documentElement.dataset['webglAttempted'] = 'true';
          return null;
        }
        return getContext.call(this, type, ...args);
      } as typeof getContext;
    });
    try {
      await BasePage.openStaging('store');
      await browser.waitUntil(() =>
        browser.execute(
          () => document.documentElement.dataset['webglAttempted'] === 'true'
        )
      );
      await expectUnavailable();
      await (await browser.$('button=Add to cart')).click();
      await expect(
        await browser.$('aside[aria-label="Shopping cart"]')
      ).toExist();
    } finally {
      await disableWebGL.remove();
    }
  });

  it('falls back if model construction takes too long', async () => {
    const shortenModelTimeout = await browser.addInitScript(() => {
      const originalSetTimeout = window.setTimeout;
      const originalWarn = console.warn.bind(console);
      console.warn = (...args) => {
        if (args[0] === '3D hat preview timed out while building the model.') {
          document.documentElement.dataset['modelTimedOut'] = 'true';
        }
        originalWarn(...args);
      };
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
      await BasePage.openStaging('store');
      await expectUnavailable();
      await browser.waitUntil(() =>
        browser.execute(
          () => document.documentElement.dataset['modelTimedOut'] === 'true'
        )
      );
      await expect(
        await browser.$('[role="combobox"][aria-label$="size"]')
      ).toBeEnabled();
      await expect(await browser.$('button=Add to cart')).toBeDisplayed();
    } finally {
      await shortenModelTimeout.remove();
    }
  });

  it('shows an unavailable message if the graphics context is lost', async () => {
    await BasePage.openStaging('store');
    await (await browser.$(canvasSelector)).waitForDisplayed();
    assert.ok(
      await browser.execute(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas');
        const extension = canvas
          ?.getContext('webgl2')
          ?.getExtension('WEBGL_lose_context');
        extension?.loseContext();
        return Boolean(extension);
      })
    );
    await expectUnavailable();
  });

  it('releases the graphics context and falls back when model construction fails', async () => {
    const malformedArtwork = await browser.addInitScript(() => {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const browserWindow: Window = window;
      browserWindow.fetch = async (input, init) => {
        if (String(input).endsWith('/static/image/store/5950.svg')) {
          // No front logo: fails after the fabric and interior are allocated.
          return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
            headers: {'Content-Type': 'image/svg+xml'},
          });
        }
        return originalFetch(input, init);
      };
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type,
        ...args
      ) {
        if (type === 'webgl2') {
          this.addEventListener(
            'webglcontextlost',
            () => {
              document.documentElement.dataset['failedBuildContextLost'] =
                'true';
            },
            {once: true}
          );
        }
        return getContext.call(this, type, ...args);
      } as typeof getContext;
    });
    try {
      await BasePage.openStaging('store');
      await browser.waitUntil(() =>
        browser.execute(
          () =>
            document.documentElement.dataset['failedBuildContextLost'] ===
            'true'
        )
      );
      await expectUnavailable();
      await expect(
        await browser.$('[role="combobox"][aria-label$="size"]')
      ).toBeEnabled();
    } finally {
      await malformedArtwork.remove();
    }
  });

  it('stops loading if either embroidery asset cannot be loaded', async () => {
    for (const asset of ['new-era-flag.svg', 'mlb-batterman.svg']) {
      const failAsset = await browser.addInitScript(asset => {
        const originalFetch = globalThis.fetch.bind(globalThis);
        const originalWarn = console.warn.bind(console);
        let rejected = false;
        console.warn = (...args) => {
          if (rejected && args[0] === 'Could not load the 3D hat preview:') {
            document.documentElement.setAttribute('data-failed-artwork', asset);
          }
          originalWarn(...args);
        };
        const browserWindow: Window = window;
        browserWindow.fetch = async (input, init) => {
          if (String(input).endsWith(`/static/image/store/${asset}`)) {
            rejected = true;
            return new Response('', {status: 503});
          }
          return originalFetch(input, init);
        };
      }, asset);
      try {
        await BasePage.openStaging('store');
        await browser.waitUntil(() =>
          browser.execute(
            asset =>
              document.documentElement.getAttribute('data-failed-artwork') ===
              asset,
            asset
          )
        );
        await expectUnavailable();
        await expect(
          await browser.$('[role="combobox"][aria-label$="size"]')
        ).toBeEnabled();
      } finally {
        await failAsset.remove();
      }
    }
  });
});
