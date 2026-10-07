#!/usr/bin/env bun
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const exactVersion = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
// Immutable GitHub commits are allowed; branches and tags are rejected.
const githubCommit = /^github:[^/#\s]+\/[^/#\s]+#[0-9a-f]{40}$/i;
const unpinned = [];
const manifests = [
  'package.json',
  ...readdirSync('packages', {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => path.join('packages', entry.name, 'package.json')),
];

for (const manifest of manifests) {
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));

  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[group] ?? {})) {
      if (
        !exactVersion.test(spec) &&
        !githubCommit.test(spec) &&
        spec !== 'workspace:*'
      ) {
        unpinned.push(`${manifest}: ${group}/${name}: ${spec}`);
      }
    }
  }
  for (const [selector, replacement] of Object.entries(pkg.overrides ?? {})) {
    const parentVersion = selector.slice(selector.lastIndexOf('@') + 1);
    if (!exactVersion.test(parentVersion))
      unpinned.push(
        `${manifest}: overrides/${selector}: parent selector is not exact`
      );
    if (typeof replacement !== 'object' || replacement === null) {
      if (!exactVersion.test(replacement))
        unpinned.push(`${manifest}: overrides/${selector}: ${replacement}`);
      continue;
    }
    for (const [name, spec] of Object.entries(replacement)) {
      if (typeof spec !== 'string' || !exactVersion.test(spec))
        unpinned.push(`${manifest}: overrides/${selector}/${name}: ${spec}`);
    }
  }
}

if (unpinned.length > 0) {
  console.error('Unpinned dependencies found:');
  for (const entry of unpinned) {
    console.error(`  ${entry}`);
  }
  process.exit(1);
}
console.log('All dependencies are pinned.');
