# Vite+ evaluation (2026-10-15)

**Question (Sam):** should this project migrate to Vite+ now that it is stable? Prompted by InfoQ's [Vite+ 1.0 announcement](https://www.infoq.com/news/2026/10/cloudflare-viteplus-stable/).

**Verdict:** not now. Of Vite+'s pieces, only its Vitest bundle is a clean fit for this Next.js app, and that gain is small. Its linter swap carries real coverage risk. The one hard blocker was the Workers smoke-test pool's Vitest version cap, and PR #186 removed it by moving to `@cloudflare/vitest-plugin`. Revisit when either trigger under §Revisit triggers fires.

## What Vite+ is

Vite+ 1.0 (VoidZero, now owned by Cloudflare; MIT) is a unified toolchain behind one `vp` command, configured from one `vite.config.ts`:

- build/dev: Vite 8 + Rolldown, plus tsdown for library packing;
- test: Vitest 5, re-exported as `vite-plus/test`;
- lint/format: Oxlint and Oxfmt;
- `vp hooks` / `vp staged` in place of Husky and lint-staged;
- Node runtime and package-manager management.

`vite-plus@1.2.0` pins `vitest@5.0.4`, `oxlint@1.88.0` and `oxfmt@0.73.0`, and replaces the `vite` package with `@voidzero-dev/vite-plus-core`. `vp migrate` rewrites imports (`vitest` → `vite-plus/test`, `vitest/config` → `vite-plus`), merges tool configs into `vite.config.ts` and rewrites scripts. VoidZero's own guide says most projects still need manual follow-up. Prerequisites are Vite 7+ and Vitest 4+, which this project already meets (Vite 8.1, Vitest 4.1).

## How each Vite+ piece applies here

| Piece | Applies? | Reasoning |
|---|---|---|
| `vp dev` / `vp build` | **No** | `next build` produces the app (Turbopack), and OpenNext packages its output for Workers. Vite+ cannot replace Next's bundler. The only Vite-native path is Cloudflare's **vinext**, a Vite-based reimplementation of the Next.js API. That would be a framework change, not a tooling change, and is out of scope here. |
| Vitest | **Yes, small gain** | The unit suite already runs on Vitest. Migration means Vitest 4 → 5 plus import rewrites. That is roughly neutral for us, not a speed or capability win we need. |
| Workers smoke-test pool | **Was the hard blocker; fixed** | `@cloudflare/vitest-pool-workers` peers on Vitest `^4.1.0` only, including its final 0.23.0, and is now deprecated. `@cloudflare/vitest-plugin` v1 peers on `^4.1.0 \|\| ^5.0.0`. Fixed in PR #186. |
| Oxlint in place of ESLint | **Risky** | Oxlint has built-in `nextjs`, `react` (including hooks), `jsx-a11y` and `import` plugins, but none are on by default, and its React Compiler rules are experimental. `eslint-config-next@16` pulls in `eslint-plugin-react-hooks@7`, whose Compiler-era rules we currently get for free. A swap can silently drop lint checks. Our lint run is already fast, so the speed gain buys little. |
| Oxfmt | **Optional, high churn** | The repo has no formatter today. Adopting one reformats every file in one commit and conflicts with any in-flight branch. This is a separate decision from Vite+. |
| `vp hooks` / `vp staged` | Minor | We have no pre-commit tooling to consolidate. |
| Runtime management | Minor | CI pins Node 24 via `actions/setup-node`. Vite+ requires `^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0`, which our runtime already satisfies. |

## Options considered

1. **Full `vp migrate`** (Vitest + Oxlint + Oxfmt + hooks). Ruled out: the Oxlint swap risks silent loss of Next.js and React-hooks lint coverage, Oxfmt is a whole-repo reformat, and the build half of Vite+ doesn't apply to a Next.js app. Most of the cost would buy nothing.
2. **Narrow migration: Vitest only via `vite-plus/test`, keep ESLint, no formatter.** Viable, but its payoff is only Vitest 5. Deferred rather than rejected; see revisit triggers.
3. **Do nothing.** Ruled out, because the Workers pool package was deprecated with a Vitest-4-only cap, which would eventually strand the smoke suite.
4. **Rename the Workers pool package only** (chosen; PR #186). This is needed regardless of Vite+, cheap, and removes the hard blocker.

## Revisit triggers

- **vinext becomes a serious option.** If we ever move off Next.js onto Cloudflare's Vite-based Next-compatible framework, the whole Vite+ stack applies and the evaluation changes.
- **Vitest 4 support ends, or we need a Vitest 5 feature.** Then do option 2. Before migrating, read the Vitest 5 migration guide and check the `vp migrate` plan output.
- **Oxlint's Next.js/React coverage reaches parity** with `eslint-config-next`, including the React Compiler rules being non-experimental. Only then is the lint half worth evaluating, as a rule-by-rule diff, not a blind swap.

## Gotchas found during the work

- **Cloudflare's `vitest:pool-workers-to-vitest-plugin` codemod (`@cloudflare/codemods` 0.5.0) is a blind `replaceAll` across every `*.json` file, `package-lock.json` included.** It would rename lockfile keys while leaving the old `resolved`/`integrity` values. Do the rename by hand and regenerate the lockfile with `npm install`.
- **The lockfile needs npm 11 (Node 24, as CI uses).** npm 10 (Node 22) rejects `npm ci` because of the nested Wrangler's optional `@cloudflare/workers-types@^5` peer. That predates PR #186 and was not changed by it.
- **The plugin pins a pre-release `miniflare`** (`5.20261012.0-beta` at 1.4.2). The old package was already on a miniflare 5 alpha by 0.23.0, so this is Cloudflare's normal cadence for this package rather than new risk.
- **A green smoke CI run doesn't prove tests ran.** `test:smoke` passes `--pass-with-no-tests`, so check the job log's test counts after any change to the smoke config or plugin.
- **The smoke workflow runs only on PRs to `main`**, so `dev` PRs that touch it need a local `npm run test:smoke` run as their evidence.

## Sources

- [InfoQ: Vite+ 1.0 stable](https://www.infoq.com/news/2026/10/cloudflare-viteplus-stable/)
- [Vite+ migration guide](https://viteplus.dev/guide/migrate)
- [Vite+ lint guide](https://viteplus.dev/guide/lint)
- [Oxlint built-in plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html)
- [Oxlint: migrating from ESLint](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration)
- npm registry metadata for `vite-plus@1.2.0`, `@cloudflare/vitest-pool-workers@0.23.0` and `@cloudflare/vitest-plugin@1.4.2` (peer dependencies, deprecation notice), checked 2026-10-15
