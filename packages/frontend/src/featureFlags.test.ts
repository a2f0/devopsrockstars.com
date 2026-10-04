import {expect, test} from 'bun:test';
import {
  disabledFeatureFlags,
  enabledFeatureFlags,
  features,
} from './featureFlags';

test('execution without build-time flag injection fails closed', () => {
  expect(features).toEqual({store: false, search: false, skyline3d: false});
  expect(features).toEqual(disabledFeatureFlags);
  expect(Object.isFrozen(features)).toBe(true);
});

test('the all-on test profile enables every flag and is immutable', () => {
  expect(enabledFeatureFlags).toEqual({
    store: true,
    search: true,
    skyline3d: true,
  });
  expect(Object.isFrozen(enabledFeatureFlags)).toBe(true);
});
