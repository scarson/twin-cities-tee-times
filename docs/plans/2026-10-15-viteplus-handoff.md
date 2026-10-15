# Vite+ evaluation and Workers test-plugin move: session handoff

**Session:** 2026-10-15, cloud session.
**Last updated:** 2026-10-15 ~05:00 UTC.

## Headline state

- **`main`** is at `06e923c` (merge of release PR #187), and the deploy from it succeeded (Deploy run #104: Worker, Lambda proxy, migrations and seed all green).
- **`dev`** is at `2fa50ee` (merge of PR #186). After #187, `dev` and `main` have identical file trees.
- **Nothing is in flight.** Both PRs are merged and no follow-up work was started.

## What shipped

- **PR #186 → `dev` (Routine):** smoke tests moved from the deprecated `@cloudflare/vitest-pool-workers@^0.18.6` to `@cloudflare/vitest-plugin@^1.4.2`.
  - The config change is a one-line import swap in `vitest.smoke.config.mts`.
  - Smoke results were identical before and after: 21 passed, 3 skipped (the TeeWire skips are intentional).
  - A throwaway probe confirmed the suite still executes in `workerd`.
- **PR #187 → `main` (`Review — publication`, Sam approved landing it):** publishes #186. Its Adapter Smoke Tests run was the first CI run under the new plugin, and the job log shows the same 21 passed / 3 skipped.

## Vite+ decision

**Deferred, not rejected.** The full evaluation is in [`docs/research/2026-10-15-viteplus-evaluation.md`](../research/2026-10-15-viteplus-evaluation.md). It covers what Vite+ is, how each of its pieces fits this Next.js + OpenNext app, the options considered, and the triggers for revisiting.

In short:
- Vite+'s build half doesn't apply to a Next.js app.
- Its Vitest half is a small gain.
- Its Oxlint swap risks silently losing `eslint-config-next` coverage.
- Its formatter would be a whole-repo reformat.

The one hard blocker was the Workers pool package's Vitest-4-only cap, and #186 removed it.

## Deferred items

- **Narrow Vite+ migration** (Vitest via `vite-plus/test`, keep ESLint, no formatter). Unblock condition: a revisit trigger in the research doc fires, such as Vitest 4 support ending or a Vitest 5 feature we need.
- **Unused devDependency `@vitejs/plugin-react`.** Nothing imports it; its only other mention is the Phase 1 plan's original install line. It was out of scope here, so it wasn't removed. Removing it is a one-line Routine cleanup. Confirm `npm test` (the component tests use the `@vitest-environment jsdom` docblock) and the OpenNext build still pass after removal.
- **Stale remote branch `ccr-8fbad59d-x1yl8h`.** The cloud session's git proxy refused branch deletion: the connection drops while git reports success. Delete it from the GitHub UI after this handoff's PR merges.

## Operational guardrails from this session

- **Install with Node 24 / npm 11.** On a box whose default is Node 22, put a Node 24 install first on `PATH` before `npm ci`. npm 10 rejects the lockfile over the nested Wrangler's optional `@cloudflare/workers-types@^5` peer. CI is unaffected because it runs Node 24.
- **Read a codemod's source before running it.** Cloudflare's `vitest:pool-workers-to-vitest-plugin` is a blind find-and-replace across all `*.json` files, and would corrupt `package-lock.json`.
- **A green smoke CI result is not evidence on its own.** `test:smoke` uses `--pass-with-no-tests`, so read the job log's test counts.
- **Diff the lockfile's top-level versions after a dependency change.** A JSON comparison of `packages` entries before and after shows hoisting side effects. This change moved `semver` 7.7.4 → 7.8.5 and `zod` 4.3.6 → 4.6.5, both within their ranges.
