export const siteEnvironments = ['production', 'staging'] as const;
export type SiteEnvironment = (typeof siteEnvironments)[number];

export function parseSiteEnvironment(
  value: string | undefined
): SiteEnvironment {
  return value === 'staging' ? 'staging' : 'production';
}

// An empty origin means same-origin, which is what the Bun dev server and
// the browser tests use.
export const storeApiOrigin = globalThis.__STORE_API_ORIGIN__ ?? '';
