# Dependency maintenance

Use the managed `update-dependencies` skill for both Codex and Claude. Inventory
all workspace manifests, `bun.lock`, Bun and CI runtimes, Actions, pre-commit,
Terraform core/providers, and intentional patches. Query official releases and
registries, read migrations, and choose compatible groups before changing pins.
Cached metadata must retain its observation date; unavailable fresh metadata is
a reported coverage limit, never a reason to downgrade newer installed versions.

## Current upgrades and compatibility

- Agent-tool 0.1.10 is the published exact npm pin. Its installer generates both
  harnesses' skills and `.agent-tool-skills.json`; keep them with `bun.lock`.
- Skyline 0.2.2 mounts a region in an open shadow root, replacing the iframe.
  The React effect handles `ready`, shares the host's Three.js through
  `@a2f0/skyline/three`, and always destroys the viewer on cleanup. Browser tests
  use the region/shadow DOM and verify readiness, controls, and navigation cleanup.
  The asset build uses a fresh dedicated temporary directory and removes the
  previous build before writing a complete new asset set. Three 0.186.1 and its
  0.186 types follow Skyline's supported peer range. See the installed package's
  [migration guide](https://github.com/a2f0/skyline/blob/main/docs/package.md).
- TypeScript 7.0.2 remains the native CLI compiler here. Repository scripts do
  not import its removed JavaScript compiler API; Knip 6.40 uses its own Oxc
  analysis. Compile and actual Knip checks must pass before shipping.
- Preserve `expect@30.5.2.patch` for Bun's CommonJS interoperability and
  `miniflare@5.20261001.0-alpha.patch` for its installed Undici transport.
  Remove either only after the actual browser/Worker regressions pass unpatched.
- CI installs pre-commit 4.6.2 exactly; the existing Python 3.13 line remains
  supported. Changing the interpreter needs actual hook environment validation.

Run `skyline:update` before the first review, as required by `AGENTS.md`. A
verified published cached release permits a local candidate, but a failed fresh
query or unavailable browser tests holds review/shipping; do not claim that gate
passed. The common merge subject is `chore: update dependencies`.

## Audits and the parser fix

Run the configured registry's read-only `bun audit --json` against baseline and
candidate locks, including development and native dependencies. The existing
production-critical CI audit is retained; it does not cover all tooling findings.
Keep unavailable audit refreshes and unresolved findings in the upgrade ledger.

`markdownlint-cli2@0.23.3` pins vulnerable Smol-TOML 1.8. The exact-owner nested
override selects 1.9 to address
[GHSA-r4xh-jqrq-34v2](https://github.com/advisories/GHSA-r4xh-jqrq-34v2).
Its parser returns null-prototype objects, so `markdownlint@0.41.1.patch` preserves
nested rule options that the library otherwise silently drops. The actual CLI
test proves custom limits and disabled rules fail without the patch and pass
with it; glob ignores and malformed configuration retain their behavior.
Remove the override when the owner naturally selects a fixed parser; remove the
patch when upstream preserves those options and the CLI regression passes
unpatched. Repository maintainers review both by **2026-11-07** or on either
owner's next upgrade, whichever comes first.

The fresh candidate registry audit on 2026-10-07 retains the following findings.

| Locked dependency | Owning path and exposure | Fix or hold |
| --- | --- | --- |
| Sharp 0.35.4 | Wrangler 4.147 → Miniflare 5.20261001 alpha; native SVG decoder in local Worker tooling | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), high; fixed in 0.35.5 with librsvg 2.63.2, but forcing a new native decoder into Miniflare lacks a validated owner update and native compatibility proof. |
| Basic-FTP 5.3.1 | WebdriverIO 9.32 → Puppeteer Browsers 2.13.2 → proxy-agent → get-uri 6.0.5; browser-download proxy tooling | [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r), high; fixed in 6.2.1. Owner pins and browser compatibility need a validated upgrade. |
| Extract-ZIP 2.0.1 | WebdriverIO → Puppeteer Browsers 2.13.2; downloaded browser archive extraction | [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3), high; neither advisory lists a patched version. |
| Braces 3.0.3 | Markdownlint CLI2 → Micromatch 4.0.8; repository-controlled glob patterns | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high; no published fix listed. Do not feed untrusted patterns into this tooling. |
| KaTeX 0.16.47 | Markdownlint → Micromark Math 3.1; Markdown tooling, outside the deployed app | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7), low; fixed in 0.18.2. Exploitation requires existing prototype pollution; the pinned owner needs tested compatibility before replacing its renderer. |

Repository maintainers review each hold by **2026-11-07**, on the owning
dependency's next release, or when the blocked validation becomes available,
whichever happens first. Remove a hold when the owner selects a fixed compatible
graph and its actual CLI, browser or native integration passes. Scope overrides
to the audited owner and test the owning manager's resolution; an unavailable
integration does not justify forcing a security override into the lock.

## Deployment preview gate

This guard ships atomically with the dependency sweep because merging the pins
alone would trigger the existing production workflow, which previously applied
remote D1 migrations and published Workers without a complete account preview.
The guard is a prerequisite for this sweep's production release, and the PR
description calls out the operational change for reviewers.

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
domains and zone IDs. It rejects unreviewed resource types, routes, incomplete
API inventories, missing resources, and identity changes. It rechecks source,
generated assets and Wrangler inputs plus live identities before each publication.
The expected identities are intentionally fixed independently of Wrangler's
configuration: editing a Worker name, D1 binding, namespace, runtime date,
domain, cron, or secret set requires its own reviewed infrastructure change
and a new complete live preview. Deriving expectations from the changed config
would let an accidental resource replacement pass this guard.
The deployment calls Wrangler with `--keep-vars` so publishing cannot remove
existing Worker variables that are absent from the new bundle; the live binding
inventory must still match the reviewed configuration before either upload.
The account's Workers Domains API returned complete `result_info` pagination
in the authenticated 2026-10-07 preview. A different or incomplete page holds
deployment.
The production store flag is off, and its existing Worker has only
`CHECKOUT_HASH_SECRET`; staging also has the three Stripe secrets. The guard
preserves those exact live secret sets. A production store launch needs a
separate reviewed secret and flag rollout.
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
Before merging this guarded deployment change, manually dispatch the staging
workflow on the exact reviewed feature-branch commit and confirm that its
complete preview passes with the CI token before any staging upload. Ordinary
feature-branch pushes do not receive deployment credentials.

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
There are no pending migrations in either current remote database. Blocking a
future deployment until its schema rollout is independently reviewed is
intentional; the former unscoped remote apply command is not an approved path.

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

`--dry-run` now means that the complete bundle and live-resource gate succeeded,
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
plan against the real S3 backend and decrypted variables establishes safety.
Encrypted backend and variable files exist, so missing plaintext alone is not
proof that credentials are absent; inspect documented key availability without
exposing secrets. Never guess an AWS profile, migrate backend state, provision
replacement resources, or run destruction to work around unavailable state.
