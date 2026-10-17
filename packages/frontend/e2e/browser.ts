import {expect, setDefaultOptions} from 'expect-webdriverio';
import {remote} from 'webdriverio';

export {expect};
export let browser: WebdriverIO.Browser;

export async function startBrowser() {
  const headless = process.env['HEADLESS'] === 'true';
  browser = await remote({
    logLevel: 'silent',
    waitforTimeout: 10000,
    connectionRetryTimeout: 90000,
    connectionRetryCount: 3,
    capabilities: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          ...(headless ? ['--headless'] : []),
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--disable-features=NetworkService',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--window-size=1366,2160',
        ],
      },
    },
  });
  setDefaultOptions({wait: 10000, interval: 100});
}

export async function stopBrowser() {
  if (browser) await browser.deleteSession();
}

export const $ = (selector: string) => browser.$(selector);
