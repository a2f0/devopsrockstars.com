import {expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {siteEnvironments} from '../src/environment';
import {disabledFeatureFlags, featureFlagNames} from '../src/featureFlags';
import {
  featureFlagsPath,
  loadFeatureFlagConfiguration,
  parseFeatureFlagConfiguration,
  parseFeatureFlags,
} from './featureFlags';

function configuration() {
  return {
    production: {...disabledFeatureFlags},
    staging: {...disabledFeatureFlags},
  };
}

test('unreadable and malformed configuration errors identify the file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feature-flags-'));
  const filename = join(directory, 'feature-flags.json');
  try {
    await expect(loadFeatureFlagConfiguration(filename)).rejects.toThrow(
      filename
    );
    await Bun.write(filename, '{"production":');
    await expect(loadFeatureFlagConfiguration(filename)).rejects.toThrow(
      filename
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('the committed matrix validates and preserves every explicit value', async () => {
  const raw = await Bun.file(featureFlagsPath).json();
  expect(await loadFeatureFlagConfiguration()).toEqual(raw);
});

test('each flag can be enabled independently in either environment', () => {
  for (const environment of siteEnvironments) {
    for (const flag of featureFlagNames) {
      const input = configuration();
      input[environment][flag] = true;
      const parsed = parseFeatureFlagConfiguration(input);
      expect(parsed).toEqual(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      for (const name of siteEnvironments) {
        expect(Object.isFrozen(parsed[name])).toBe(true);
      }
      input[environment][flag] = false;
      expect(parsed[environment][flag]).toBe(true);
    }
  }
});

test('configuration rejects invalid or incomplete environments', () => {
  for (const input of [null, [], true, 'staging']) {
    expect(() => parseFeatureFlagConfiguration(input)).toThrow(
      'must be an object'
    );
  }
  expect(() => parseFeatureFlagConfiguration({})).toThrow('Missing setting');
  expect(() =>
    parseFeatureFlagConfiguration({production: disabledFeatureFlags})
  ).toThrow('staging');
  expect(() =>
    parseFeatureFlagConfiguration({...configuration(), prod: {}})
  ).toThrow('Unknown setting');
  expect(() =>
    parseFeatureFlagConfiguration({...configuration(), staging: []})
  ).toThrow('must be an object');
});

test('missing flags, typos, and truthy strings cannot enable features', () => {
  for (const flag of featureFlagNames) {
    const incomplete: Record<string, unknown> = {...disabledFeatureFlags};
    delete incomplete[flag];
    expect(() => parseFeatureFlags(incomplete)).toThrow(
      `Missing setting: feature flags.${flag}`
    );
    for (const value of ['true', 'false', 1, 0, null, undefined, {}]) {
      expect(() =>
        parseFeatureFlags({...disabledFeatureFlags, [flag]: value})
      ).toThrow(`${flag} must be a boolean`);
    }
  }
  for (const typo of ['skyline3D', 'stores', 'indexable']) {
    expect(() =>
      parseFeatureFlags({...disabledFeatureFlags, [typo]: true})
    ).toThrow(`Unknown setting: feature flags.${typo}`);
  }
});
