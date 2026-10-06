import assert from 'node:assert/strict';
import {test} from 'node:test';
import {run, syncSkyline} from './skyline';

const info = ['bun', 'info', '@a2f0/skyline', 'dist-tags.latest'];

function registry(latest: string, failInstall = false) {
  const commands: string[][] = [];
  const execute = (command: string[]) => {
    commands.push(command);
    if (command[1] === 'info') return latest;
    if (failInstall) throw new Error('bun add exited with 1');
    return '';
  };
  return {commands, execute};
}

test('a current pin passes check and update without installing', () => {
  for (const check of [true, false]) {
    const {commands, execute} = registry('0.1.5');
    assert.deepEqual(syncSkyline('0.1.5', check, execute), {
      current: true,
      message: '@a2f0/skyline 0.1.5 is current.',
    });
    assert.deepEqual(commands, [info]);
  }
});

test('check reports an outdated pin without installing', () => {
  const {commands, execute} = registry('0.1.6');
  const result = syncSkyline('0.1.5', true, execute);
  assert.equal(result.current, false);
  assert.match(result.message, /0\.1\.5 is behind 0\.1\.6/u);
  assert.deepEqual(commands, [info]);
});

test('update installs the exact latest release', () => {
  const {commands, execute} = registry('0.2.0');
  assert.deepEqual(syncSkyline('0.1.5', false, execute), {
    current: true,
    message: 'Updated @a2f0/skyline from 0.1.5 to 0.2.0.',
  });
  assert.deepEqual(commands, [
    info,
    ['bun', 'add', '--exact', '@a2f0/skyline@0.2.0'],
  ]);
});

test('a non-version pin is replaced by the latest release', () => {
  const {commands, execute} = registry('0.1.5');
  syncSkyline('github:a2f0/skyline#d7406d2', false, execute);
  assert.deepEqual(commands.at(-1), [
    'bun',
    'add',
    '--exact',
    '@a2f0/skyline@0.1.5',
  ]);
});

test('a pin newer than latest is never downgraded', () => {
  for (const check of [true, false]) {
    const {commands, execute} = registry('0.1.5');
    assert.throws(
      () => syncSkyline('0.1.6', check, execute),
      /0\.1\.6 is newer than latest 0\.1\.5/u
    );
    assert.deepEqual(commands, [info]);
  }
});

test('a missing dependency fails before querying the registry', () => {
  const {commands, execute} = registry('0.1.5');
  assert.throws(
    () => syncSkyline(undefined, false, execute),
    /is not a frontend dependency/u
  );
  assert.deepEqual(commands, []);
});

test('unexpected registry output fails without installing', () => {
  for (const latest of ['', 'latest', '0.2.0-beta.1']) {
    const {commands, execute} = registry(latest);
    assert.throws(
      () => syncSkyline('0.1.5', false, execute),
      /Unexpected @a2f0\/skyline latest version/u
    );
    assert.deepEqual(commands, [info]);
  }
});

test('registry and install failures propagate', () => {
  assert.throws(
    () =>
      syncSkyline('0.1.5', false, () => {
        throw new Error('bun info exited with 1');
      }),
    /bun info exited with 1/u
  );
  const {execute} = registry('0.1.6', true);
  assert.throws(
    () => syncSkyline('0.1.5', false, execute),
    /bun add exited with 1/u
  );
});

test('run returns trimmed output and rejects a failing command', () => {
  assert.equal(run(['bun', '-e', 'console.log(" 0.1.5 ")']), '0.1.5');
  assert.throws(() => run(['bun', '-e', 'process.exit(3)']), /exited with 3/u);
});
