# Dependency maintenance

Keep reusable upgrade procedures and active constraints here. Update or remove
guidance as it stops applying; keep each run's version inventory, audit findings,
validation, and preview evidence in its PR instead of accumulating a journal.
[PR #841](https://github.com/a2f0/devopsrockstars.com/pull/841) records the upgrade
and guard rollout that introduced the constraints below. Historical findings
and previews are not current audit or live-state evidence.

Use the managed `update-dependencies` skill for both Codex and Claude. Inventory
all workspace manifests, `bun.lock`, Bun and CI runtimes, Actions, pre-commit,
Terraform core/providers, and intentional patches. Query official releases and
registries, read migrations, and choose compatible groups before changing pins.
Cached metadata must retain its observation date; unavailable fresh metadata is
a reported coverage limit, never a reason to downgrade newer installed versions.

## Compatibility constraints

- Read current pins from workspace manifests, `bun.lock`, and tool configuration.
  Agent-tool's installer generates both harnesses' skills and
  `.agent-tool-skills.json`; commit them with its manifest and `bun.lock`.
- Skyline mounts a region in an open shadow root. The React
  effect handles `ready`, shares the host's Three.js through
  `@a2f0/skyline/three`, and always destroys the viewer on cleanup. Browser tests
  use the region/shadow DOM and verify readiness, controls, and navigation cleanup.
  The asset build uses a fresh dedicated temporary directory and removes
  the previous build before writing a complete new asset set. Keep Three and its
  types within Skyline's supported peer range. See its
  [migration guide](https://github.com/a2f0/skyline/blob/main/docs/package.md).
- TypeScript runs as the native CLI compiler here. Repository
  scripts do not import its removed JavaScript compiler API; Knip uses Oxc
  analysis. Compile and actual Knip checks must pass before shipping.
- Preserve `expect@30.5.2.patch` for Bun's CommonJS interoperability and
  `miniflare@5.20261012.1-beta.patch` for its installed Undici transport.
  Remove either only after the actual browser/Worker regressions pass unpatched.
- Keep the store Worker's `upload_source_maps: false` explicit and checked by
  the deployment guard. [Wrangler 4.150](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.150.0)
  enables uploads by default; tool updates must preserve the existing policy.
- WebdriverIO 10 and expect-webdriverio 8 must move together. Use
  `setDefaultOptions` and selectors that identify a single element; strict `$`
  checks expose ambiguous selectors. Chrome does not yet implement every BiDi
  override used by device presets; the mobile suites use CDP viewport and touch
  emulation, assert the effective metrics, and restore them afterward.
  Validate fresh driver downloads and the
  full software-rendered browser suite under pinned Bun. See the
  [migration guide](https://webdriver.io/docs/v10-migration).
- Keep CI's exact pre-commit pin and Python line compatible. Changing the
  interpreter needs actual hook environment validation.

Run `skyline:update` before the first review, as required by `AGENTS.md`. A
verified published cached release permits a local candidate, but a failed fresh
query or unavailable browser tests holds review/shipping; do not claim that gate
passed. The common merge subject is `chore: update dependencies`.

## Audits and security constraints

Run the configured registry's read-only `bun audit --json` against baseline and
candidate locks, including development and native dependencies. The existing
production-critical CI audit is retained; it does not cover all tooling findings.
Record unavailable audit refreshes and unresolved findings in the upgrade PR.

`markdownlint-cli2@0.23.3` pins vulnerable Smol-TOML 1.8. The exact-owner nested
override selects 1.9 to address
[GHSA-r4xh-jqrq-34v2](https://github.com/advisories/GHSA-r4xh-jqrq-34v2).
Its parser returns null-prototype objects, so `markdownlint@0.41.1.patch` preserves
nested rule options that the library otherwise silently drops. The actual CLI
test proves custom limits and disabled rules fail without the patch and pass
with it; glob ignores and malformed configuration retain their behavior.
This repository's current lint config is JSONC; the tested TOML path is a
compatibility safeguard for the installed CLI, rather than a current config
requirement.
Remove the override when the owner naturally selects a fixed parser; remove the
patch when upstream preserves those options and the CLI regression passes
unpatched. Repository maintainers review both by **2026-11-07** or on either
owner's next upgrade, whichever comes first.

The following owner constraints need compatible upstream fixes. Recheck current
advisories and owner releases during each upgrade.

| Locked dependency | Owning path and exposure | Fix or hold |
| --- | --- | --- |
| Braces 3.0.3 | Markdownlint CLI2 → Micromatch 4.0.8; repository-controlled glob patterns | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high; no published fix listed. Do not feed untrusted patterns into this tooling. |
| KaTeX 0.16.47 | Markdownlint → Micromark Math 3.1; Markdown tooling, outside the deployed app | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7), low; fixed in 0.18.2. Exploitation requires existing prototype pollution; the pinned owner needs tested compatibility before replacing its renderer. |

Repository maintainers review each hold by **2026-11-07**, on the owning
dependency's next release, or when the blocked validation becomes available,
whichever happens first. Remove a hold when the owner selects a fixed compatible
graph and its actual CLI, browser or native integration passes. Scope overrides
to the audited owner and test the owning manager's resolution; an unavailable
integration does not justify forcing a security override into the lock.

## Deployment preview gate

Every maintenance deployment must pass this guard before publication. See
[deployment operations](deployment.md) for provisioning and infrastructure
procedures; a successful bundle alone does not establish deployment safety.

All owned remote deploy and migration commands route through `scripts/deploy.ts`,
including workspace entrypoints and GitHub Actions. Set the real
`CLOUDFLARE_ACCOUNT_ID` and API token; CI reads the account ID from the repository
variable of that name. The account variable must be verified before shipping.
The token needs permission to read Worker settings/domains, zone routes and D1
metadata as well as the existing deployment permissions. Cloudflare's
[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
accepts `D1 Read` for the fixed migration-table `SELECT`, even though the HTTP
method is POST; this preview does not require D1 Write.

The gate checks the unchanged supported configuration and installed tool pins,
builds once, dry-runs **both** Workers, and inspects the real account's existing
Worker names, complete bindings and secret names, rate-limit namespaces,
compatibility date, disabled `workers.dev`/preview URLs, cron triggers, custom
domains, zone IDs, and the live observability enabled setting. The settings API
does not expose the site's asset manifest; bundle dry-runs and post-deploy smoke
checks cover asset behavior. It rejects unreviewed resource types, routes, incomplete
API inventories, missing resources, and identity changes. It rechecks source,
generated assets, and installed Wrangler and esbuild entrypoints plus live
identities before each publication. The backend currently has no third-party
runtime dependencies; adding one requires expanding this input check. This is a
targeted digest of installed entrypoints, not a checksum of all `node_modules`;
CI's frozen install binds the package graph to `bun.lock`.
The expected identities are intentionally fixed independently of Wrangler's
configuration: editing a Worker name, D1 binding, namespace, runtime date,
domain, cron, or secret set requires its own reviewed infrastructure change
and a new complete live preview. Deriving expectations from the changed config
would let an accidental resource replacement pass this guard.
The deployment calls Wrangler with `--keep-vars` so publishing cannot remove
existing Worker variables that are absent from the new bundle; the live binding
inventory must still match the reviewed configuration before either upload.
The guard requires complete `result_info` pagination from the Workers Domains
API. A different or incomplete page holds deployment. Zone route pagination is
also checked when the API supplies `result_info`.
The committed production store flag is off. The guard expects only
`CHECKOUT_HASH_SECRET` in production and the three Stripe secrets as well in
staging, verifying those exact sets during each live preview. A production store
launch needs a separate reviewed secret and flag rollout.
Publishing also requires a clean committed tree without assume-unchanged or
skip-worktree flags. The captured commit must match GitHub Actions' validated
checkout SHA in CI and remain unchanged before each upload. Preview-only modes
may inspect an uncommitted local candidate; that proof never authorizes publication.
Custom Wrangler build hooks are unsupported, so a deployment cannot rerun an
uninspected build after capturing the preview inputs.
CI serializes deployments per environment without canceling an active deployment.
Worker publication is sequential. If the backend succeeds and a later site
preview or upload fails, the guard stops with a partial deployment; inspect the
live backend and site identities, then rerun the same reviewed commit once the
failure is resolved. Never bypass the guard or delete a Worker to recover.
For changes to the deployment guard, verify its complete preview with the CI
token on the exact reviewed feature-branch commit before shipping. When a
staging deployment is authorized, manually dispatch the staging workflow; it
must pass that preview before any upload. Ordinary feature-branch pushes do not
receive deployment credentials.

**D1 migrations must already be applied.** The gate reads only
`SELECT name FROM d1_migrations ORDER BY id` from the existing database and checks
the complete local filename set. A missing table, failed read, pending migration,
or unknown applied migration holds deployment. It never initializes schema or
applies remote SQL. `--skip-migrations` is rejected; remote
`db:check:*` scripts perform the same full compile, frontend build, two Worker
bundle dry-runs, and live-resource preview before reporting zero pending
migrations. They are deliberately full deployment checks, not quick metadata
queries. They do not apply SQL. New migrations need a separate reviewed rollout with a
scoped apply command and meaningful execution preview before
this restriction can be changed. Local disposable database tests retain explicit
`--local` commands.
Check migration state afresh for each deployment. Blocking publication until a
schema rollout is independently reviewed is intentional; an unscoped remote
apply command is not an approved path.

For a planned runtime date or plain-text variable change, edit the fixed desired
values in `deploymentSafety.ts` and the matching Wrangler configuration in the
same PR. Commit `deployment-transition.json` with the previously observed date
or bindings for each affected Worker, grouped under `staging` and `prod`. The
guard accepts only that exact old or desired live state during the transition,
requires the desired state after each Worker upload, and still forbids D1,
rate-limit, secret, cron, domain, or Worker identity changes. For example:

```json
{
  "staging": {
    "backend": {"date": "2026-08-31"},
    "frontend": {"date": "2026-08-31"}
  }
}
```

The transition file is bound to the reviewed commit and preview input digest.
After both Workers have reached the desired state, remove it in a subsequent
reviewed PR. Secret provisioning and D1 migrations require their own scoped
rollout commands and preview; they cannot use this Worker transition path.

`--dry-run` means that the complete bundle and live-resource gate succeeded,
not just that uploads were disabled. A bundle alone and fixture metadata are not
production safety evidence. No Worker or database is created, deleted, replaced,
recreated, renamed or retired by this maintenance workflow. Failed or unavailable
proof holds deployment and shipping.

The read paths follow Cloudflare's
[Worker settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/),
[domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/),
and [D1 metadata API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/).
Do not substitute `wrangler d1 migrations list --remote`: its implementation
initializes the migration table before listing.

Terraform core/provider upgrades remain pinned until a complete refreshed saved
plan against the real R2 backend and the `.secrets/prod/main.tfvars` variables
establishes safety. That variable file and the `.secrets` credentials described
in [deployment operations](deployment.md#infrastructure) live outside the
repository, so their absence from a checkout alone is not proof that they do not
exist; inspect documented key availability without exposing secrets. Never
substitute other credentials, migrate backend state, provision replacement
resources, or run destruction to work around unavailable state.
