---
name: package-update-and-verify
description: Follow the shared dependency upgrade workflow with DevOps Rockstars validation and deployment gates.
---

# Package Update And Verify

Use the installed `update-dependencies` skill for inventory, upstream migrations,
compatibility groups, audits, and non-destructive previews. Do not blindly update
all manifests to latest or force incompatible transitive resolutions.

Follow `AGENTS.md`, README, and `docs/dependency-maintenance.md`. Use pinned Bun,
regenerate `bun.lock` with its owning manager, preserve intentional patches until
actual regressions pass without them, and sync managed skills for both harnesses.

Run compile, unit, flag, Biome, Markdown, Knip, pre-commit, and actual browser
checks required by repository policy. Run `skyline:update` before the first
review; migrate its viewer and copy the complete published asset set together.
Report blocked checks rather than weakening their scope.

Deployment always uses `scripts/deploy.ts`, including workspace and CI commands.
Both Worker bundle previews and the real account-scoped resource inspection must
succeed before publication. Pending D1 migrations hold deployment; never use
remote migration list/apply as a read-only test. Never delete, replace, recreate,
retire, or reset infrastructure. Terraform upgrades require the real backend's
complete refreshed non-destructive plan; unavailable state holds that group.

Use `ship-pr` only within existing shipping authorization, independently review
the exact committed candidate, and retain the repository's merge/CI policy.
Report dependency decisions, audit exceptions, previews, validation limits, and
shipping/deployment status without exposing secrets or state.
