import {expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const checker = path.join(
  import.meta.dir,
  'check-for-unpinned-dependencies.mjs'
);

async function check(overrides: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), 'dependency-pins-'));
  try {
    await mkdir(path.join(root, 'packages'));
    await Bun.write(
      path.join(root, 'package.json'),
      JSON.stringify({overrides})
    );
    const result = Bun.spawnSync([process.execPath, checker], {cwd: root});
    return {exitCode: result.exitCode, output: result.stderr.toString()};
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('override pinning accepts exact parent and replacement versions', async () => {
  expect(
    (
      await check({
        '@scope/parent@1.2.3': {child: '2.3.4'},
        'other@3.4.5': '4.5.6',
        'smol-toml': '1.9.0',
      })
    ).exitCode
  ).toBe(0);
});

test.each([
  [{parent: {child: '2.3.4'}}, 'parent selector is not exact'],
  [{'@scope/parent': {child: '2.3.4'}}, 'parent selector is not exact'],
  [{'parent@1.2.3': {child: '^2.3.4'}}, 'overrides/parent@1.2.3/child'],
  [{'parent@1.2.3': '^2.3.4'}, 'overrides/parent@1.2.3'],
] as const)(
  'override selector and replacement must be exact',
  async (overrides, message) => {
    const result = await check(overrides);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(message);
  }
);
