# Agent Notes

This file is the shared guidance for coding agents working in this repository.
The rule in `.claude/rules/repository.md` points Claude Code here without
maintaining a second copy of the project instructions.

## Repository Identification (Critical)

Never infer repository identity from the folder name. Always resolve the GitHub repo directly:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Use `-R "$REPO"` (or `--repo "$REPO"`) on `gh` commands when ambiguity is possible.

## Branch and Commit Rules

- Do not commit or push directly to `production` or `main`; work on a branch.
- Use conventional commits.
- Do not force-push unless explicitly requested.
- Do not add AI attribution/co-author footers.

## Review Feedback (Critical)

Fix valid findings from pull request review comments, scoped to the feedback,
and run the relevant validation (`bun run compile`, `bun run unit`,
`bun run ci-headless` as needed) before committing and pushing. Then reply in
each original review thread through
`POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`,
saying what changed and naming the fixing commit. Never reply with top-level PR
comments or `gh pr review`. Resolve a thread only when its finding is fully
addressed.

## Repo Validation Commands

Use the exact-pinned `@a2f0/agent-tool` npm package through
`bun run agent-tool`. Its managed skills in `.agents/skills` and
`.claude/skills` own the PR workflow; `agent-tool.json` supplies title and
required CI policy. Dependency maintenance follows the shared
`update-dependencies` skill and
[deployment preview policy](docs/dependency-maintenance.md). Update installed
skills with `bun run agents:sync` after changing the dependency pin, and check
them with `bun run agents:check`. Do not edit managed skills locally.
`scripts/check-agent-skills-in-sync.mjs` keeps skills present in both
`.agents/skills` and `.claude/skills` identical through the pre-commit hook.

Primary checks in this repo:

- `bun run lint:md`
- `bun run flags:check`
- `bun run compile`
- `bun run unit`
- `bun run ci-headless`
- `bun run agents:check`

Pre-commit hook entrypoint:

- `pre-commit run --all-files`

## Shipping and Production Verification

Use the shared `$ship-pr` skill. Run Markdown lint, compilation, unit tests,
format/lint, and pre-commit checks before shipping; run browser tests locally
when application or browser behavior changes. CI runs the full browser suite.
Integrate changed bases with normal merges and never force-push.

Keep `@a2f0/skyline` on its latest npm release while shipping. Before the first
review, run `bun run skyline:update` on the feature branch. When it moves the
pin, commit `packages/frontend/package.json` and `bun.lock` as
`chore(deps): update @a2f0/skyline to <version>`, run browser tests locally,
include that commit in the reviewed HEAD, and mention the update in the PR
description. A release published after the first review waits for the next
shipped PR. `bun run skyline:check` reports whether the pin is current without
changing it; CI does not run it, so an upstream release never fails a build.
The Home skyline renders with the frontend's `three` through
`@a2f0/skyline/three`, so keep `three` within the skyline's `three` peer range
when updating either; the staging browser tests fail if the viewer loads its
own copy.

Review with an agent other than the one that wrote the change: Codex from
Claude Code, Claude from Codex, then the remaining CLIs, reporting any fallback.
Require a complete non-blocking verdict on the final commit. Validate, commit, and re-review repairs until findings are addressed.
Report the reviewer, fallback, verdict, repair count, and reviewed commit.

Handle review comments on the PR with the reply rules above. Use the shared
exact-head squash helper; invoke `node_modules/.bin/agent-tool pr merge` directly
when passing an empty subject because `bun run` drops empty arguments. Per
`agent-tool.json`, it requires `code-quality` from `Github Actions` on the
reviewed head and refuses to merge unless the `production` ruleset enforces
strict status checks that the merging account cannot bypass.

After merging to `production`, wait for `.github/workflows/main.yml` to deploy
that merge commit successfully. Smoke-test Home and Company at phone and desktop
sizes, and verify navigation, routes, and the Home skyline match the committed
feature flag matrix for each deployed environment. Check the production
storefront API returns JSON. Mobile browser checks should emulate viewport and
touch input, including narrow portrait, landscape, and viewport height changes.
Verify branch identities and merge ancestry before deleting shipped branches.

## Markdown Linting

Markdown lint is enforced in CI and hooks:

- Script: `bun run lint:md`
- Tool: `markdownlint-cli2`
- Config: `.markdownlint-cli2.jsonc`

## Issue Handling

Do not create GitHub issues unless the user explicitly requests it.

## Development Commands

### Setup and Installation

```bash
pip install pre-commit==4.6.2
pre-commit install
bun install
```

### Development Server

```bash
bun run start-server           # Development server (default port)
bun run start-test-server      # Test server on port 8081 (production features)
bun run start-staging-server   # Test server on port 8082 (staging features)
bun run dev:cloudflare         # Store API Worker on port 8787
```

The Bun dev server proxies `/api` to `http://127.0.0.1:8787`, so the site
and the store API stay same-origin in development.

### Build and Production

```bash
bun run build                 # Production Bun build
bun run compile              # TypeScript 7 type checking (without emitting JavaScript)
```

### Code Quality

```bash
bun run lint                 # Biome linting with auto-fix
bun run format              # Biome formatting
```

### Testing

```bash
bun run test                 # Run e2e tests (requires test server running)
bun run test-headless       # Run e2e tests in headless mode
bun run ci                  # Full CI: start server + run tests
bun run ci-headless        # Full CI in headless mode

# Run specific test spec
bun run --cwd packages/frontend test \
  --test-name-pattern="loads correctly"
```

## Package Management

This project uses **Bun 1.4.2** for package management, TypeScript execution,
bundling, development servers, and unit/browser test execution. The version is
pinned in `.bun-version` and `package.json`; CI installs that same version.

Use `bun install`, `bun add --exact <package>`, and `bun run <script>`.
Commit `bun.lock` with dependency changes. JavaScript CLIs run with
`bun run --bun <command>` so their Node hashbangs also execute under Bun.
Third-party lifecycle scripts are disabled with `trustedDependencies: []`.

## Architecture Overview

This is a Bun monorepo for the DevOps Rockstars React site and Cloudflare
store backend.

### Workspace packages

- `packages/frontend` — React application, assets, Bun tooling, and browser tests
- `packages/backend` — Cloudflare Worker, D1 migrations, and Wrangler config
- `packages/shared-types` — shared API request and response types

### Core Stack

- **Frontend**: React 19+ with TypeScript in strict mode
- **Styling**: styled-components with CSS-in-JS architecture
- **Routing**: react-router with `/` and `/company` plus flag-controlled store/search routes
- **Build**: Bun bundler with ES modules output
- **Testing**: WebDriverIO (WDIO) for end-to-end testing
- **Package Manager**: Bun for dependency management

### Application Structure

- **Layout**: Flexbox-based layout system using custom styled components
- **Home**: Original SVG skyline, or shared interactive 3D skyline when `skyline3d` is enabled
- **Responsive Design**: Component-based responsive layout with flex containers

### Key Components

- `packages/frontend/src/index.tsx` - Main router and app entry point
- `packages/frontend/src/Header.tsx` - Navigation header with company link
- `packages/frontend/src/Footer.tsx` - Footer (hidden on main page)
- `packages/frontend/src/Skyline.tsx` - Main page content
- `packages/frontend/src/Company.tsx` - Company information page
- `packages/frontend/src/Map.tsx` - Full-screen Leaflet map component
- `packages/frontend/src/NotFound.tsx` - Catch-all route for unmatched paths
- `feature-flags.json` - Explicit production/staging rollout values
- `packages/frontend/src/featureFlags.ts` - Typed flag registry and browser values
- `packages/frontend/src/environment.ts` - Environment parsing and store API origin

### Styled Components System

Located in `packages/frontend/src/styled-components/`, these files provide
reusable layout primitives:

- Flex container components for different alignments
- Header/Footer/Main layout components
- Menu item components
- Global styling with CSS custom properties

### Static Assets

- SVG icons and logos in `packages/frontend/static/image/`
- Contact files in `packages/frontend/static/contact/`
- Favicon in `packages/frontend/static/favicon/`

## Configuration Details

### TypeScript

- Extends `@tsconfig/strictest` for maximum type safety
- Configured for ESNext modules with React JSX
- Bun types included for scripts and test execution
- WebdriverIO browser types come from its standalone API

### Code Quality (Biome)

- Replaces ESLint/Prettier with single tool
- 2-space indentation, single quotes, 80-character line width
- Auto-organizes imports and fixes lint issues

### Bun bundler

- ES module output format
- Content hashing for production builds
- Source changes rebuild automatically; refresh the browser to load them
- Static SVG URLs served directly from `/static/`
- Copies static assets to build directory
- `patches/expect@30.5.2.patch` preserves Jest's named exports under Bun
  by using a namespace import for its CommonJS module

### Testing

- Bun test runner with WebdriverIO standalone browser automation
- Chrome browser automation
- Page object model in `packages/frontend/e2e/pageObjects/`
- Tests validate page loading and component visibility

## Deployment

Everything runs on Cloudflare. Each environment is a pair of Workers: a
static-assets Worker for the site and a store Worker for `/api/*` with its own
D1 database.

| Environment | Site | Store API |
| --- | --- | --- |
| Production | `devopsrockstars.com` | `store.devopsrockstars.com` |
| Staging | `staging.devopsrockstars.com` | `store-staging.devopsrockstars.com` |

- `bun run deploy:staging` and `bun run deploy:prod` wrap `scripts/deploy.ts`,
  which builds the site, dry-runs both Workers, verifies live resource identities
  and zero pending D1 migrations, then publishes the store and site Workers
- `patches/miniflare@5.20261001.0-alpha.patch` resolves Miniflare's installed
  Undici transport to avoid Bun's incomplete built-in dispatcher
- Wrangler owns Worker and asset deployments; Terraform (`terraform/`) owns the
  custom domains, including `www` (which serves the production site)
- GitHub Actions deploys the `production` branch to production and the
  `staging` branch to staging; `workflow_dispatch` deploys any branch to staging
- Frontend build artifacts are generated in `packages/frontend/build/`
- Terraform manages Cloudflare only. The AWS website stack (S3, CloudFront,
  ACM, Route 53) is destroyed; the S3 Terraform state backend is all that
  remains, so `terraform` still needs AWS credentials

### Environment feature flags

`feature-flags.json` is the versioned rollout matrix. `PUBLIC_ENVIRONMENT`
selects the row during the build; Bun injects the validated booleans into the
browser. `bun run flags` shows the matrix and `bun run flags:check` validates it.
Flag changes require a new deployment. See README's Feature flags section for
the update workflow and registry conventions.

- Store/search flags control their links and routes. The `skyline3d` flag
  controls the 3D viewer and asset inclusion, with the SVG used when off or when
  the viewer cannot start. Each flag is
  independent; do not couple a flag's value to whether the environment is staging
- When `store` and `skyline3d` are both on, hat preparation finishes before the
  skyline starts to avoid competing model builds; the SVG stays visible meanwhile
- **Staging** adds a `noindex` meta tag, an `X-Robots-Tag` header, and a
  disallow-all `robots.txt`, so only production is indexable
- Disabling the store removes its links and routes; its implementation JavaScript
  can still be present in the bundle
- `packages/frontend/buildAssets.ts` generates `robots.txt` and `_headers`;
  both are covered by unit and e2e tests
- Indexing stays tied to the environment, outside the feature flag registry
- Each deployment publishes its resolved settings at `/feature-flags.json`;
  verify that manifest along with the live UI after a rollout
- CI exercises fixed all-off/all-on browser profiles plus each flag independently
  in both environments, so coverage survives future changes to the rollout matrix
