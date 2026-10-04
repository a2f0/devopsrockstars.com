import assert from 'node:assert/strict';
import {test} from 'node:test';
import {headersFile, robotsMetaTags, robotsTxt} from './buildAssets';

const production = 'production';
const staging = 'staging';

test('production invites crawlers', () => {
  assert.deepEqual(robotsMetaTags(production), {});
  assert.match(robotsTxt(production), /^User-agent: \*\nAllow: \/\n$/u);
  assert.doesNotMatch(headersFile(production), /X-Robots-Tag/u);
});

test('staging refuses crawlers in the document, robots.txt, and headers', () => {
  assert.deepEqual(robotsMetaTags(staging), {robots: 'noindex, nofollow'});
  assert.match(robotsTxt(staging), /^User-agent: \*\nDisallow: \/\n$/u);
  assert.match(headersFile(staging), /^ {2}X-Robots-Tag: noindex, nofollow$/mu);
});

test('content-hashed bundles are cached immutably in every environment', () => {
  for (const headers of [headersFile(production), headersFile(staging)]) {
    assert.match(headers, /^\/\*$/mu);
    assert.match(
      headers,
      /^ {2}Cache-Control: public, no-cache, must-revalidate$/mu
    );
    assert.match(headers, /^\/assets\/\*$/mu);
    assert.match(
      headers,
      /^ {2}Cache-Control: public, max-age=31536000, immutable$/mu
    );
  }
});
