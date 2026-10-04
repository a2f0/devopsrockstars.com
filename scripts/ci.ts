#!/usr/bin/env bun
import path from 'node:path';
import {
  disabledFeatureFlags,
  enabledFeatureFlags,
} from '../packages/frontend/src/featureFlags';
import {startFrontendServer} from '../packages/frontend/tooling/server';

const production = await startFrontendServer({
  port: 8081,
  environment: 'production',
  // Keep testing both feature states even after the rollout matrix changes.
  featureFlags: disabledFeatureFlags,
  minify: true,
});
let staging: Awaited<ReturnType<typeof startFrontendServer>> | undefined;
let tests: ReturnType<typeof Bun.spawn> | undefined;
const stop = () => {
  tests?.kill();
  staging?.stop();
  production.stop();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stop();
    process.exit(1);
  });
try {
  staging = await startFrontendServer({
    port: 8082,
    environment: 'staging',
    featureFlags: enabledFeatureFlags,
    minify: true,
  });
  tests = Bun.spawn(
    [
      process.execPath,
      'run',
      '--no-orphans',
      process.argv.includes('--headless') ? 'test:headless' : 'test',
    ],
    {
      cwd: path.resolve(import.meta.dir, '../packages/frontend'),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }
  );
  process.exitCode = await tests.exited;
} finally {
  stop();
}
