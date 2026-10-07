import {expect, test} from 'bun:test';

function assertOverrideParents(selectors: readonly string[], source: string) {
  const lockfile: unknown = Bun.JSONC.parse(source);
  if (
    typeof lockfile !== 'object' ||
    lockfile === null ||
    !('packages' in lockfile) ||
    typeof lockfile.packages !== 'object' ||
    lockfile.packages === null
  ) {
    throw new Error('bun.lock: missing resolved packages');
  }
  const packages = new Set(
    Object.values(lockfile.packages).map((entry: unknown) => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') {
        throw new Error('bun.lock: invalid resolved package entry');
      }
      return entry[0];
    })
  );
  for (const selector of selectors) {
    // Only exact version-scoped overrides become stale on a parent upgrade.
    if (!/@\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(selector)) continue;
    const parent = selector.slice(0, selector.lastIndexOf('@'));
    const identities = [...packages].filter(entry =>
      entry.startsWith(`${parent}@`)
    );
    if (identities.length !== 1 || identities[0] !== selector) {
      throw new Error(
        `Remove or update stale dependency override ${selector}; its parent is absent from bun.lock. Re-run the dependency audit.`
      );
    }
  }
}

test('temporary overrides still match resolved parent versions', async () => {
  const source = await Bun.file(new URL('../bun.lock', import.meta.url)).text();
  const manifest = (await Bun.file(
    new URL('../package.json', import.meta.url)
  ).json()) as {
    overrides: Record<string, unknown>;
  };
  assertOverrideParents(Object.keys(manifest.overrides), source);
});

test('the Markdownlint override resolves only the patched Smol-TOML', async () => {
  const source = await Bun.file(new URL('../bun.lock', import.meta.url)).text();
  const lockfile = Bun.JSONC.parse(source) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  const nested = Object.entries(lockfile.packages).filter(
    ([name]) =>
      name.startsWith('markdownlint-cli2/') && name.endsWith('/smol-toml')
  );
  const resolved = nested.length
    ? nested
    : Object.entries(lockfile.packages).filter(
        ([name]) => name === 'smol-toml'
      );
  expect(resolved.length).toBeGreaterThan(0);
  expect(resolved.map(([, entry]) => entry[0])).toEqual(
    resolved.map(() => 'smol-toml@1.9.0')
  );
});

const selectors = ['@scope/parent@1.2.3', 'parent@2.0.0-alpha'];
const resolved = {
  nested: [selectors[0]],
  parent: [selectors[1]],
};

test('parent matching uses resolved identities, including nested packages', () => {
  assertOverrideParents(selectors, JSON.stringify({packages: resolved}));
});

test.each(['upgrade', 'removal'])(
  'a parent %s requires explicit override maintenance',
  change => {
    const packages = {
      ...resolved,
      nested: change === 'upgrade' ? ['@scope/parent@1.2.4'] : undefined,
    };
    expect(() =>
      assertOverrideParents(selectors, JSON.stringify({packages}))
    ).toThrow('Remove or update stale dependency override @scope/parent@1.2.3');
  }
);

test('an additional parent version requires a new compatibility review', () => {
  const packages = {...resolved, additional: ['@scope/parent@1.2.4']};
  expect(() =>
    assertOverrideParents(selectors, JSON.stringify({packages}))
  ).toThrow('Remove or update stale dependency override @scope/parent@1.2.3');
});
