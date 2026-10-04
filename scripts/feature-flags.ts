#!/usr/bin/env bun
import {
  featureFlagDefinitions,
  featureFlagNames,
} from '../packages/frontend/src/featureFlags';
import {loadFeatureFlagConfiguration} from '../packages/frontend/tooling/featureFlags';

const [option, ...extra] = process.argv.slice(2);
if (extra.length || (option && !['--check', '--json'].includes(option))) {
  throw new Error('Usage: bun run flags [--check|--json]');
}
const configuration = await loadFeatureFlagConfiguration();
if (option === '--check') {
  console.log('Feature flag configuration is valid.');
} else if (option === '--json') {
  console.log(JSON.stringify(configuration, null, 2));
} else {
  console.table(
    featureFlagNames.map(flag => ({
      flag,
      production: configuration.production[flag] ? 'on' : 'off',
      staging: configuration.staging[flag] ? 'on' : 'off',
      description: featureFlagDefinitions[flag],
    }))
  );
}
