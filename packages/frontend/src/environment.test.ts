import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseSiteEnvironment} from './environment';

test('site environment falls back to production for unknown values', () => {
  assert.equal(parseSiteEnvironment('staging'), 'staging');
  assert.equal(parseSiteEnvironment('production'), 'production');
  assert.equal(parseSiteEnvironment(undefined), 'production');
  assert.equal(parseSiteEnvironment(''), 'production');
  assert.equal(parseSiteEnvironment('Staging'), 'production');
});
