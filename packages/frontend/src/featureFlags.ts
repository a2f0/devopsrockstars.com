import type {SiteEnvironment} from './environment';

// Add new flags here, then give them an explicit value in each environment
// in the repository's feature-flags.json. Nothing is enabled implicitly.
export const featureFlagDefinitions = {
  store: 'Store navigation, routes, inventory prefetch, and hat preview',
  search: 'Search navigation and page',
  skyline3d: 'Interactive 3D skyline and its viewer assets',
} as const;

type FeatureFlagName = keyof typeof featureFlagDefinitions;
export type FeatureFlags = Readonly<Record<FeatureFlagName, boolean>>;
export type FeatureFlagConfiguration = Readonly<
  Record<SiteEnvironment, FeatureFlags>
>;

export const featureFlagNames = Object.freeze(
  Object.keys(featureFlagDefinitions) as FeatureFlagName[]
);

function uniformFeatureFlags(enabled: boolean): FeatureFlags {
  return Object.freeze(
    Object.fromEntries(featureFlagNames.map(name => [name, enabled])) as Record<
      FeatureFlagName,
      boolean
    >
  );
}

export const disabledFeatureFlags = uniformFeatureFlags(false);
export const enabledFeatureFlags = uniformFeatureFlags(true);

// Unbundled execution fails closed. Browser builds receive only the resolved
// environment's flags, never a mutable client-side override or the matrix.
export const features: FeatureFlags = Object.freeze(
  globalThis.__FEATURE_FLAGS__ ?? disabledFeatureFlags
);
