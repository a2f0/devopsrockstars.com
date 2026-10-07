---
name: address-gemini-feedback
description: Triage and resolve Gemini PR review feedback on the current branch for devopsrockstars. Use when a PR has Gemini review comments, code changes are needed, and the agent should apply fixes, run validation, push updates, and reply in the original review threads. Works from either Claude Code or Codex.
---

# Address Gemini Feedback

Resolve Gemini review comments directly in GitHub PR threads.

## Guardrails

- Use `-R "$REPO"` with all `gh` commands.
- Do not use `gh pr review` for comment replies; it can create pending/draft reviews.
- Reply inside each review thread using the pull request review comment reply endpoint.
- Include `@gemini-code-assist` in each reply so Gemini is notified.

## Workflow

1. Determine repository and PR number for the current branch.

   ```bash
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   PR_NUMBER=$(gh pr view -R "$REPO" --json number -q .number)
   OWNER=${REPO%/*}
   REPO_NAME=${REPO#*/}
   ```

2. Fetch unresolved review threads for the PR.

   - Use GraphQL `reviewThreads` and paginate with `pageInfo.endCursor`.
   - Focus on unresolved threads with latest comments from `gemini-code-assist`.

3. Apply fixes for relevant feedback.

   - Make code changes scoped to the feedback.
   - For this repo, validate with the closest impacted commands:
   - `bun run compile` (TypeScript)
   - `bun run lint` (Biome)
   - `bun run test-headless` for WebdriverIO checks when behavior/UI is affected

4. Commit and push.

   - Use a conventional commit message, for example: `fix: address Gemini review feedback`.
   - Push to the PR branch.

5. Reply in each addressed thread using REST API.

   ```bash
   gh api -X POST \
     -H "Accept: application/vnd.github+json" \
     "/repos/$OWNER/$REPO_NAME/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" \
     -f body="@gemini-code-assist Addressed in $COMMIT_SHA: <short summary>."
   ```

6. Resolve thread when appropriate.

   - If the concern is fully addressed, resolve the review thread via GraphQL `resolveReviewThread`.
   - If partially addressed or blocked, leave the thread open and explain the blocker.

7. Repeat until no relevant unresolved Gemini threads remain.

## Response Quality

- Be explicit in replies: what changed, where, and why.
- Include file paths or command evidence when useful.
- If feedback is not actionable, explain clearly and politely in-thread.
