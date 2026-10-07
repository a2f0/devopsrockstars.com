# DevOps Rockstars

Use Bun **1.4.2** (see `.bun-version`) for all workspace commands. TypeScript
**7.0.2** checks types; Bun transpiles and bundles the application. Install Bun
from [bun.sh](https://bun.sh), then run `bun install`. Commit `bun.lock` with
dependency changes. Development rebuilds on source edits; refresh the browser
to load the updated bundle.

The interactive 3D skyline comes from the exact-pinned
[`@a2f0/skyline`](https://www.npmjs.com/package/@a2f0/skyline) npm package,
which ships built JavaScript and its own viewer assets, so installs run no
build step and need no sibling checkout. `bun run skyline:check` reports
whether the pin matches npm's latest release, and `bun run skyline:update`
moves it there; shipping a PR runs the update (see `AGENTS.md`).

## Workspace layout

- `packages/frontend` — React site, static assets, Bun build scripts, and
  browser tests
- `packages/backend` — Cloudflare Worker, D1 migrations, and Wrangler
  configuration
- `packages/shared-types` — API types shared by the frontend and backend

Root scripts orchestrate the packages, so the existing development, test, and
deployment commands remain stable.

## Agent tooling

PR tooling comes from the exact-pinned
[`@a2f0/agent-tool`](https://github.com/a2f0/agent-tool) npm package.
`agent-tool.json` sets the conventional title limit and the required
`code-quality` check in `Github Actions`. The managed shared skills in
`.agents/skills` and `.claude/skills` provide review, PR creation, shipping, and
cleanup; project validation and deployment rules stay in `AGENTS.md`.

```shell
bun run agent-tool --help
bun run agent-tool review claude
bun run agent-tool pr open 'feat: describe the change' < /tmp/pr-body.md
node_modules/.bin/agent-tool pr merge '' "$REVIEWED_SHA" "$BASE_REF"
bun run agents:check
```

Invoke the installed executable directly when passing an empty merge subject;
`bun run` drops empty positional arguments. To update the tooling, review the
upstream release, run `bun add --dev --exact @a2f0/agent-tool@<version>`, then
`bun run agents:sync`. Commit the manifest, lockfile, installed skills, and
`.agent-tool-skills.json` together. Hooks and CI reject missing or stale
skills. The shared package owns its tests; application checks stay in this repo.

## Development

```shell
pip install pre-commit==4.6.2
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

GitHub Actions deploys `production` to production and `staging` to staging, and
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

### Cloudflare setup

The following describes the original bootstrap requirements. The maintenance
deployment guard requires these resources and their migration table to already
exist; it cannot bootstrap a new environment. New resources or schema changes
need a separately reviewed execution preview before any mutation.

1. Add `devopsrockstars.com` to Cloudflare, review the imported record scan
   against Route 53 — the Google Workspace `MX` records especially — and only
   then move the registrar's nameservers. `terraform output
   cloudflare_nameservers` prints the pair to set.

2. Both D1 databases already exist and their `database_id`s are committed in
   `packages/backend/wrangler.jsonc`. A new environment would add one with:

   ```shell
   bun run --cwd packages/backend --bun wrangler d1 create \
     devopsrockstars-store-<env> --location=enam
   ```

3. The initial schema seeded the historical $20 price and zero stock as safe
   placeholders. `bun run db:check:prod` verifies the existing migration table
   and requires zero pending migrations; it applies no remote SQL. Schema,
   price and inventory changes require a separate reviewed migration rollout
   with a complete execution preview before remote SQL is run. There is no
   generic remote migration apply command in this maintenance workflow.

   ```shell
   bun run db:check:prod
   ```

4. Add the Stripe test keys and checkout hash secret to the staging Worker.
   Set only the checkout hash secret in production for the current disabled
   store configuration.

   The current production Worker has only `CHECKOUT_HASH_SECRET` while its
   store flag is off. Provisioning live Stripe secrets and enabling that flag
   require a separate reviewed rollout; dependency maintenance preserves the
   current secret set.

   ```shell
   for secret in STRIPE_PUBLISHABLE_KEY STRIPE_SECRET_KEY \
     STRIPE_WEBHOOK_SECRET CHECKOUT_HASH_SECRET; do
     bun run --cwd packages/backend --bun wrangler secret put \
       "$secret" --env staging
   done
   bun run --cwd packages/backend --bun wrangler secret put \
     CHECKOUT_HASH_SECRET --env prod
   ```

5. Register `https://store.devopsrockstars.com/api/webhooks/stripe` (and the
   `store-staging` equivalent) in Stripe for `payment_intent.succeeded`,
   `payment_intent.payment_failed`, and `payment_intent.canceled`. Use each
   endpoint's signing secret for that environment's `STRIPE_WEBHOOK_SECRET`.

6. Initial provisioning published the Workers before Terraform attached their
   custom domains. Maintenance deploys require the existing Workers and domains
   to pass the live inspection, so they never use that bootstrap sequence.
   Terraform changes require a complete refreshed saved plan against the real
   backend with no resource deletion or replacement before applying it.

   ```shell
   bun run deploy:staging
   bun run deploy:prod
   ```

   Terraform needs `TF_VAR_cloudflare_api_token` in the environment and
   `cloudflare_account_id` in `main.tfvars`. The token needs Workers Scripts
   Edit, Workers Routes Edit, DNS Edit, Zone Read, and Zone Settings Edit.
   Creating the zone itself needs Zone Create, which is easier to do once in
   the dashboard.

   Zone Settings Edit is required for `cloudflare_zone_setting.always_use_https`,
   which restores the HTTPS redirect CloudFront used to perform. **A token
   without it fails the whole apply on that resource**, and cannot read the
   setting either, so Terraform reports it as missing even when it is enabled in
   the dashboard. Toggling it under SSL/TLS → Edge Certificates fixes the
   behaviour immediately; widening the token is what makes Terraform agree.

7. Move the registrar's nameservers last, after Terraform has applied. The
   `MX` records must already exist in Cloudflare or mail stops the moment the
   delegation changes. Cloudflare only engages its proxy once the zone leaves
   `pending`, so
   the Worker hostnames cannot be tested before the move.

### Worker identity

Keep the existing Worker names, domains and database bindings during maintenance.
A rename or retirement is a separate infrastructure operation. The dependency
upgrade workflow never deletes, replaces, recreates or retires a resource; its
preview guard holds any identity change.
After a separately reviewed rename, confirm the new Worker serves traffic before
retiring the predecessor. The old Worker keeps its cron trigger and D1 binding
until it is retired; its secrets cannot be read back, so provision them on the
new Worker before cutover.

### Infrastructure

Terraform (`terraform/`) manages only Cloudflare now: the Worker custom
domains, the `www` hostname, and the Google Workspace `MX` records. The AWS
website stack it used to own — S3 buckets, CloudFront, the ACM certificate, the
Route 53 hosted zone, and the `s3-sync-devopsrockstars` IAM user — has been
destroyed. The only AWS dependency left is the S3 bucket holding Terraform
state, so `terraform` still needs AWS credentials for its backend.

Wrangler owns Worker and asset deployments; Terraform owns hostnames. Publish a
Worker before pointing a hostname at it.

### How the store works

D1 owns products, variants, inventory, orders, and processed Stripe event IDs.
Inventory is reserved atomically when checkout starts, restored when an order is
canceled, and protected from double-restock by the order-status transition
trigger. A one-minute cron cancels reservations that have been abandoned for ten
minutes, and customers can release a reservation immediately from checkout.

Checkout creation is limited to two attempts per minute, two active
reservations per salted network hash, twenty active reservations globally, and
two items per order. The edge limit uses Cloudflare's `CHECKOUT_RATE_LIMITER`
binding; D1 enforces the active-reservation caps and prevents accidental
duplicates for the same resumable browser session.

Signed Stripe events without the store's source metadata are acknowledged and
ignored. Store events that cannot be applied safely are recorded in
`stripe_event_alerts`; entries with `action = 'refund'` require operator action.
Check the open queue with:

```shell
bun run --cwd packages/backend --bun wrangler d1 execute \
  devopsrockstars-store --env prod --remote \
  --command "SELECT * FROM stripe_event_alerts WHERE status = 'open' ORDER BY created_at"
```

The configuration for the site is in the [terraform folder](terraform).
