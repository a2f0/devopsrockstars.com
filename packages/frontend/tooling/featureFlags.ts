import {fileURLToPath} from 'node:url';
import {siteEnvironments} from '../src/environment';
import {
  type FeatureFlagConfiguration,
  type FeatureFlags,
  featureFlagNames,
} from '../src/featureFlags';

export const featureFlagsPath = fileURLToPath(
  new URL('../../../feature-flags.json', import.meta.url)
);

function configurationObject(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key))
      throw new Error(`Unknown setting: ${label}.${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`Missing setting: ${label}.${key}`);
    }
  }
  return value as Record<string, unknown>;
}

export function parseFeatureFlags(
  value: unknown,
  label = 'feature flags'
): FeatureFlags {
  const flags = configurationObject(value, featureFlagNames, label);
  for (const name of featureFlagNames) {
    if (typeof flags[name] !== 'boolean') {
      throw new Error(`${label}.${name} must be a boolean`);
    }
  }
  return Object.freeze({...flags}) as FeatureFlags;
}

export function parseFeatureFlagConfiguration(
  value: unknown
): FeatureFlagConfiguration {
  const matrix = configurationObject(
    value,
    siteEnvironments,
    'feature-flags.json'
  );
  return Object.freeze(
    Object.fromEntries(
      siteEnvironments.map(environment => [
        environment,
        parseFeatureFlags(
          matrix[environment],
          `feature-flags.json.${environment}`
        ),
      ])
    )
  ) as FeatureFlagConfiguration;
}

export async function loadFeatureFlagConfiguration() {
  // Read on each build, including dev-server rebuilds, rather than caching a
  // JSON module. A bad edit leaves the previous successful dev build intact.
  return parseFeatureFlagConfiguration(await Bun.file(featureFlagsPath).json());
}
