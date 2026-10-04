import {expect, test} from 'bun:test';
import {disabledFeatureFlags, features} from './featureFlags';

test('execution without build-time flag injection fails closed', () => {
  expect(features).toEqual({store: false, search: false, skyline3d: false});
  expect(features).toEqual(disabledFeatureFlags);
  expect(Object.isFrozen(features)).toBe(true);
});
