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

## PR Review Thread Replies (Critical)

When addressing Gemini or reviewer feedback:

- Always reply inside the original review thread.
- Never use top-level PR comments for review feedback replies.
- Never use `gh pr review` to reply to individual review comments.
- Use the PR comment reply endpoint:
  - `POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/replies`
- Tag `@gemini-code-assist` in replies intended for Gemini.
- Include what changed and the commit SHA when relevant.

## Addressing Gemini Feedback Workflow

1. Determine repo and PR number for the current branch.
2. Fetch unresolved review threads (`reviewThreads`) and prioritize Gemini comments.
3. Implement fixes scoped to valid feedback.
4. Run relevant validation (`bun run compile`, `bun run unit`, `bun run ci-headless` as needed).
5. Commit and push.
6. Reply in each addressed thread via the REST reply endpoint.
7. Resolve threads only when fully addressed.

## Repo Validation Commands

Use the commit-pinned shared `agent-tool` package through `bun run agent-tool`.
Its managed skills in `.agents/skills` and `.claude/skills` own the PR workflow;
`agent-tool.json` supplies title and required CI policy. Update installed skills
with `bun run agents:sync` after changing the dependency pin, and check them
with `bun run agents:check`. Do not edit managed skills locally.
The project `address-gemini-feedback` skill handles review-thread replies;
`scripts/check-agent-skills-in-sync.mjs` keeps project skills identical between
`.agents/skills` and `.claude/skills` through the pre-commit hook.

Primary checks in this repo:

- `bun run lint:md`
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

For Codex use Claude as the independent reviewer, falling back to the independent
Codex CLI if unavailable. Require a complete non-blocking verdict on the final
commit. Validate, commit, and re-review repairs until findings are addressed.
Report the reviewer, fallback, verdict, repair count, and reviewed commit.

Allow Gemini at least 60 seconds after opening or updating a PR, then fetch
unresolved review threads and follow the reply rules above. Use the shared
exact-head squash helper; invoke `node_modules/.bin/agent-tool pr merge` directly
when passing an empty subject because `bun run` drops empty arguments. Per
`agent-tool.json`, it requires `code-quality` from `Github Actions` on the
reviewed head and refuses to merge unless the `production` ruleset enforces
strict status checks that the merging account cannot bypass.

After merging to `production`, wait for `.github/workflows/main.yml` to deploy
that merge commit successfully. Smoke-test Home and Company at phone and desktop
sizes, confirm store and search remain hidden and Home uses the SVG skyline, and
check the production storefront API returns JSON. For staging, verify
store/search and the 3D skyline remain available. Mobile browser checks should emulate viewport and touch input,
including narrow portrait, landscape, and viewport height changes.
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
pip install pre-commit
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
- **Routing**: react-router with production routes `/` and `/company` and staging-only store/search routes
- **Build**: Bun bundler with ES modules output
- **Testing**: WebDriverIO (WDIO) for end-to-end testing
- **Package Manager**: Bun for dependency management

### Application Structure

- **Layout**: Flexbox-based layout system using custom styled components
- **Home**: Original SVG skyline in production; shared interactive 3D skyline in staging
- **Responsive Design**: Component-based responsive layout with flex containers

### Key Components

- `packages/frontend/src/index.tsx` - Main router and app entry point
- `packages/frontend/src/Header.tsx` - Navigation header with company link
- `packages/frontend/src/Footer.tsx` - Footer (hidden on main page)
- `packages/frontend/src/Skyline.tsx` - Main page content
- `packages/frontend/src/Company.tsx` - Company information page
- `packages/frontend/src/Map.tsx` - Full-screen Leaflet map component
- `packages/frontend/src/NotFound.tsx` - Catch-all route for unmatched paths
- `packages/frontend/src/environment.ts` - Per-environment feature flags

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
  which builds the site for the environment, applies D1 migrations, then
  publishes the store and site Workers in that order
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

`packages/frontend/src/environment.ts` derives the environment from
`PUBLIC_ENVIRONMENT`, injected at build time by Bun's `define` option.

- The store, search, and 3D skyline remain **staging-only**. Production hides
  store/search links and routes and keeps the original SVG skyline. The
  `skyline3d` feature controls the 3D viewer; its assets ship only in staging
- Staging prepares the hat preview before starting the 3D skyline to avoid
  competing model builds; the original SVG stays visible during preparation
- **Staging** adds a `noindex` meta tag, an `X-Robots-Tag` header, and a
  disallow-all `robots.txt`, so only production is indexable
- The store JavaScript is still present in the production bundle; it simply has
  no link or route reaching it
- `packages/frontend/buildAssets.ts` generates `robots.txt` and `_headers`;
  both are covered by unit and e2e tests
