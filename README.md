# DevOps Rockstars

Use Bun **1.4.3** (see `.bun-version`) for all workspace commands. TypeScript
**7.0.2** checks types; Bun transpiles and bundles the application. Install Bun
from [bun.sh](https://bun.sh), then run `bun install`. Commit `bun.lock` with
dependency changes. Development rebuilds on source edits; refresh the browser
to load the updated bundle.

The interactive 3D skyline comes from the exact-pinned
[`@a2f0/skyline`](https://www.npmjs.com/package/@a2f0/skyline) npm package,
which ships built JavaScript and its own viewer assets, so installs run no
build step and need no sibling checkout.

## Workspace layout

- `packages/frontend` — React site, static assets, Bun build scripts, and
  browser tests
- `packages/backend` — Cloudflare Worker, D1 migrations, and Wrangler
  configuration
- `packages/shared-types` — API types shared by the frontend and backend

Root scripts orchestrate the packages, so the existing development, test, and
deployment commands remain stable.

Agent workflow and validation guidance live in [AGENTS.md](AGENTS.md). See
[dependency maintenance](docs/dependency-maintenance.md) for upgrade procedures,
active constraints, and security override removal conditions.

## Development

```shell
pip install pre-commit==4.7.0
pre-commit install
bun install
bun run start-server
```

The site and the store API are separate Workers, so local development runs
them side by side. Start the store Worker on port 8787 and the Bun server
proxies `/api` to it, keeping development same-origin. The local Worker
command allows the frontend origins on ports 8080, 8081, and 8082 for both
`localhost` and `127.0.0.1`; deployed Workers retain their domain-only origin
configuration:

```shell
cp packages/backend/.dev.vars.example packages/backend/.dev.vars
bun run db:migrate:local
bun run dev:cloudflare   # store Worker on :8787
bun run start-server     # site on :8080, proxying /api to :8787
```

The local store is deliberately sold out after the first migration. Add local
inventory before testing checkout:

```shell
bun run --cwd packages/backend --bun wrangler d1 execute \
  devopsrockstars-store-staging --env staging --local \
  --command "UPDATE product_variants SET inventory_quantity = 5"
```

To preview the committed staging flag configuration:

```shell
bun run start-staging-server   # :8082
```

Testing

```shell
bun run ci
bun run ci-headless
```

Start the testing Bun server (on different port than normal development server) and run tests manually.

```shell
bun run start-test-server      # :8081, production feature set
bun run start-staging-server   # :8082, staging feature set
# in a different console tab
bun run test
bun run test-headless
```

In CI, `e2e/specs/basic.spec.ts` runs against a production build on :8081 with
every flag off; `e2e/specs/staging.spec.ts` runs against a staging build on :8082
with every flag on. These fixed test profiles keep both behaviors covered when
the rollout configuration changes. The manual development servers above use
the committed matrix; use `bun run ci` or `bun run ci-headless` for the fixed
test profiles regardless of the current rollout.

`e2e/specs/feature-flags.spec.ts` also builds each flag enabled by itself in both
environments and checks navigation, routes, background preparation, viewer
assets, and the published flag manifest. Unit tests check the committed matrix
and reject incomplete or invalid configuration.

`e2e/specs/mobile.spec.ts` covers both environments with Chromium phone viewport
and touch emulation, including portrait, landscape, and viewport height changes.

Run tests whose names match a pattern

```shell
bun run --cwd packages/frontend test \
  --test-name-pattern="loads correctly"
```

## Feature flags

[feature-flags.json](feature-flags.json) is the versioned rollout configuration.
Every flag has an explicit boolean value for each environment. Run `bun run flags`
to see the current values; this file is the source of truth for rollout state.

| Flag | Controls |
| --- | --- |
| `store` | Store navigation, routes, inventory prefetch, and hat preparation |
| `search` | Search navigation and route |
| `skyline3d` | Interactive Home skyline and bundled viewer assets |

```shell
bun run flags          # Show the matrix and descriptions
bun run flags --json   # Print the validated configuration as JSON
bun run flags:check    # Validate without building or deploying
```

To release or disable a feature, change only its boolean in the target
environment's row in `feature-flags.json`, review the change, and redeploy that
environment through the normal shipping workflow. For example, a later 3D
skyline release would change `production.skyline3d` to `true`, leaving the store
and search settings alone.

The build validates the complete matrix and embeds only the selected
environment's values in the browser bundle. Missing flags or environments,
unknown names, and non-boolean values fail the build and pre-commit checks.
There are no browser, query-string, local-storage, or shell overrides. A running
dev server rebuilds when the configuration changes; refresh the page afterward.
Deployed values change only after rebuilding and deploying.

Each build publishes `/feature-flags.json` containing its `environment` and
resolved `flags`, so deployment checks can inspect the active configuration.
This is a read-only build artifact. Search-engine indexing is separate:
production remains indexable and staging remains `noindex`, regardless of flags.
The store flag governs the frontend; the store API's deployment is separate.

To add a flag, register its description in
`packages/frontend/src/featureFlags.ts`, add boolean values for both environments
in the matrix, gate the relevant UI and build assets with that flag, and cover
the enabled and disabled behavior in tests.

## Deployment

Both environments run entirely on Cloudflare. Each is a pair of Workers: a
static-assets Worker serving the Bun output, and a store Worker serving
`/api/*` against its own D1 database. Wrangler owns the Worker and asset
deployments; Terraform owns the custom domains.

| Environment | Site | Store API | Worker names |
| --- | --- | --- | --- |
| Production | `devopsrockstars.com` | `store.devopsrockstars.com` | `devopsrockstars-website-prod`, `devopsrockstars-store-prod` |
| Staging | `staging.devopsrockstars.com` | `store-staging.devopsrockstars.com` | `devopsrockstars-website-staging`, `devopsrockstars-store-staging` |

`www.devopsrockstars.com` is a second custom domain on the production website
Worker, serving the same content as the apex rather than redirecting to it,
which is what CloudFront did before the move. Neither Worker is reachable on
`workers.dev`, so the only hostnames are the ones above.

Disabled store/search flags hide their navigation links and routes, so those
paths serve a not-found page. When the store is enabled in staging, it uses
Stripe test keys. Staging builds with `PUBLIC_ENVIRONMENT=staging`, which also
adds a `noindex, nofollow` meta tag, an `X-Robots-Tag` response header, and a
`robots.txt` that disallows everything, so only production is offered to search
engines.

With `skyline3d` enabled, Home mounts the shared interactive 3D skyline from
`@a2f0/skyline` ([a2f0/skyline](https://github.com/a2f0/skyline)) in the page
itself, inside a shadow root, and gives it the site's own three.js through
`@a2f0/skyline/three`, so the skyline and the hat preview share one engine. Its
assets are included only in builds with that flag enabled. Leaving Home
destroys the viewer and releases its WebGL contexts. If the 3D skyline cannot
start, as without WebGL 2, Home shows the original SVG and the browser console
says why. If `store` is also enabled, the original SVG stays visible
while the background hat preview prepares; the 3D skyline starts after
preparation succeeds or fails so the two models build in sequence. With the
store disabled, the 3D skyline starts directly. Disabling `skyline3d` keeps the original `/static/image/skyline.svg`.

Cloudflare prepends its own managed `robots.txt` block whose `User-agent: *`
group merges with ours, and `Allow` wins that tie, so the header and meta tag
are what actually keep staging out of search results.

GitHub Actions deploys `main` to production and `staging` to staging, and
`workflow_dispatch` deploys any branch to staging. Deployments run locally the
same way:

```shell
bun run deploy:staging
bun run deploy:prod
bun scripts/deploy.ts staging --dry-run   # complete bundle and live-resource preview
```

Each deployment builds the site, dry-runs both Workers, and checks existing live
identities before publishing the store and site Workers. D1 must have zero
pending migrations; missing or incomplete resource evidence holds deployment.
Set the verified `CLOUDFLARE_ACCOUNT_ID` and API token. CI uses the repository
account variable, and serializes deployments per environment. See
[dependency maintenance](docs/dependency-maintenance.md#deployment-preview-gate)
for exact coverage, permissions, and the migration restriction.

See [deployment operations](docs/deployment.md) for Cloudflare provisioning,
Terraform setup (state in Cloudflare R2, credentials and variables from the
gitignored `.secrets` link to matrix-secrets), Worker identity changes, and the
store alert queue. Resource creation, secret changes, and schema rollouts
require separate review and a complete execution preview. Routine maintenance
preserves existing identities and never applies remote SQL.
