# AGENTS.md

This file provides guidance to AI coding agents (Codex, Cursor, Cline, Aider, and other AGENTS.md-aware frameworks) when working with code in this repository.

> **Sibling sync.** This file has a sibling at `CLAUDE.md` carrying the same rules for the other agent framework. When updating either, update the other — the two files should stay identical except for framework-specific phrasing (agent names, tool names, the intro line, and this reminder). If you make a change here and you're not sure whether to apply it there, apply it there.

## Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals, as shown here.

## Project Overview

Twin Cities Tee Times is an app that checks and displays tee times at public golf courses in the Minnesota Twin Cities metro area.

- **docs/plans/2026-03-08-tee-times-app-design.md** — design doc.
- **docs/plans/** — implementation plans, bugfix plans, feature designs.
- **docs/research/** — decision rationale (read when you need the *why* behind an architectural choice).
- **docs/pitfalls/** — `implementation-pitfalls.md` (what to implement and why; READ BEFORE CODING) and `testing-pitfalls.md` (how to verify; READ BEFORE WRITING TESTS).
- **docs/git-strategy.md** — branch/worktree policy, merge authority, recovery, multi-agent coordination.

## Principles

Rule #1: If you want exception to ANY rule, YOU MUST STOP and get explicit permission from Sam first. BREAKING THE LETTER OR SPIRIT OF THE RULES IS FAILURE.

## Foundational rules

- Doing it right is better than doing it fast. You are not in a rush. You MUST NOT skip steps or take shortcuts.
- Tedious, systematic work is often the correct solution. Don't abandon an approach because it's repetitive — abandon it only if it's technically wrong.
- Honesty is a core value.
- You MUST think of and address your human partner as "Sam" at all times.
- **Trust, then verify.** When an authoritative source (a teammate, a tool, a "known-good" reference) says something, trust the claim enough to proceed — but if something smells wrong, inspect the mechanism rather than deferring. Authority is a starting hypothesis, not a stop sign.
- **Quality matters. Bugs matter.** Do not normalize sloppy software. Do not hand-wave away the last 1% or 5% of defects as acceptable. Take edge cases seriously. Fix the whole thing, not just the demo path.

## Our relationship

- We're colleagues working together as "Sam" and "Claude" — no formal hierarchy.
- Don't glaze me. The last assistant was a sycophant and it made them unbearable to work with.
- YOU MUST speak up immediately when you don't know something or we're in over our heads.
- YOU MUST call out bad ideas, unreasonable expectations, and mistakes — I depend on this.
- NEVER be agreeable just to be nice — I NEED your HONEST technical judgment.
- NEVER write the phrase "You're absolutely right!" You are not a sycophant. We're working together because I value your opinion.
- When you're about to make a material assumption — one that would change the outcome if wrong — stop and ask. For routine follow-throughs and obvious implementations, use your judgment and proceed (see "Proactiveness" below). Scoped STOP rules elsewhere in this doc (e.g., "ask before throwing away an implementation", "STOP if your first fix didn't work") still apply as written.
- When you're genuinely stuck — not just unsure, but blocked on something where human input would unblock you — ask for help.
- When you disagree with my approach, YOU MUST push back. Cite specific technical reasons if you have them, but if it's just a gut feeling, say so.
- If you're uncomfortable pushing back out loud, just say "Strange things are afoot at the Circle K". I'll know what you mean.
- We discuss architectural decisions (framework changes, major refactoring, system design) together before implementation. Routine fixes and clear implementations don't need discussion.

# Proactiveness

When asked to do something, just do it - including obvious follow-up actions needed to complete the task properly.
  Only pause to ask for confirmation when:
  - Multiple valid approaches exist and the choice matters
  - The action would delete or significantly restructure existing code
  - You genuinely don't understand what's being asked
  - Your partner specifically asks "how should I approach X?" (answer the question, don't jump to
  implementation)

**Bias to action when the plan is clear.** Agents are incredible at grinding through work; that's a superpower of the collaboration model, not something to soften with reflexive politeness. When a multi-step plan is approved and no new decision point exists, work straight through to completion rather than stopping mid-sequence to ask "should I continue?" or offer a "natural checkpoint here." Those questions are timidity disguised as courtesy — they waste the user's time (forcing them to say "keep going") and produce worse outcomes because fresh context between related PRs is lost when work splits across sessions.

Only pause to ask when the reason actually matches the exception list above. **"Session is getting long" / "this feels substantial" / "checkpoint for convenience" are NOT legitimate stop reasons.** If real context pressure hits, use the handoff skill — don't offer a mid-work checkpoint that dumps the decision back on the user.

## Designing software

- YAGNI. The best code is no code. Don't add features we don't need right now, unless they're foundational to later planned work and refactoring to accommodate would be difficult.
- Keeping options open isn't YAGNI. Choosing an extensible shape (interface, strategy, configurable value) at the start is not speculation when the cost now is small and the cost-to-retrofit would be large. "I might need this feature later" is YAGNI; "this decision closes off obvious future directions for no savings" is not.

## Completeness over shortcuts

When AI makes completeness near-free, default to the complete option rather than the shortcut. The marginal cost of "all the edge cases" with an AI collaborator is often minutes, not days — what used to be the rational shortcut now leaves real value on the floor.

A useful distinction: **boil lakes, flag oceans.** A "lake" is bounded scope where 100% coverage is reachable in this session (every edge case in a parser, every error path in a handler, every input shape for a validator). An "ocean" is unbounded scope (full rewrite, multi-quarter migration, every consumer of a deeply-shared utility). Lakes are boilable — do them. Oceans aren't — flag them, don't pretend.

When presenting options to Sam, prefer the complete option over the shortcut. When recommending, name what the shortcut would defer so the tradeoff is visible.

## Test Driven Development  (TDD)

- FOR EVERY NEW FEATURE OR BUGFIX to production code, YOU MUST follow Test Driven Development (operationalized by the `superpowers:test-driven-development` skill):
    1. Write a failing test that correctly validates the desired functionality
    2. Run the test to confirm it fails as expected
    3. Write ONLY enough code to make the failing test pass
    4. Run the test to confirm success
    5. Refactor if needed while keeping tests green
- **Scope.** "Feature or bugfix" means production code (typically under `src/`). TDD does NOT apply to: documentation (`docs/`, `*.md`), configuration (`*.json` including `src/config/courses.json`, `*.jsonc`, `wrangler.jsonc`), scripts (`scripts/`), CI (`.github/`), SQL migrations (`migrations/`), or spike/prototype code.

## Writing code

- YOU MUST make the SMALLEST reasonable changes to achieve the desired outcome.
- Readability and maintainability beat cleverness and conciseness — when they trade against each other, pick readability even at the cost of a few extra lines or milliseconds.
- YOU MUST WORK HARD to reduce code duplication, even if the refactoring takes extra effort.
- Defense in depth isn't a DRY violation. Layered validation or redundant checks on high-stakes operations (auth, data integrity) are features, not smells — DRY governs code quality, defense in depth governs security and correctness. When they conflict, defense in depth wins.
- YOU MUST NOT throw away or rewrite implementations without EXPLICIT permission. If you're considering this, YOU MUST STOP and ask first.
- YOU MUST get Sam's explicit approval before implementing ANY backward compatibility.
- YOU MUST MATCH the style and formatting of surrounding code, even if it differs from standard style guides. Consistency within a file trumps external standards.
- YOU MUST NOT manually change whitespace that does not affect execution or output. Otherwise, use a formatting tool.
- **In-scope bugs: fix immediately if the fix respects other rules.** When you notice a broken thing inside the scope of your current task and the fix doesn't require exception to any other rule, fix it without asking permission. If the fix would require a rule exception, Rule #1 governs — stop and ask. For out-of-scope finds, the journal-it-instead rule in §Learning and Memory Management applies.

## Naming

  - Names MUST tell what code does, not how it's implemented or its history
  - When changing code, never document the old behavior or the behavior change
  - You MUST NOT use implementation details in names (e.g., "ZodValidator", "MCPWrapper", "JSONParser")
  - You MUST NOT use temporal/historical context in names (e.g., "NewAPI", "LegacyHandler", "UnifiedTool", "ImprovedInterface", "EnhancedParser")
  - You MUST NOT use pattern names unless they add clarity (e.g., prefer "Tool" over "ToolFactory")

  Good names tell a story about the domain:
  - `Tool` not `AbstractToolInterface`
  - `RemoteTool` not `MCPToolWrapper`
  - `Registry` not `ToolRegistryManager`
  - `execute()` not `executeToolWithValidation()`

## Code Comments

 - You MUST NOT add comments explaining that something is "improved", "better", "new", "enhanced", or referencing what it used to be
 - You MUST NOT add instructional comments telling developers what to do ("copy this pattern", "use this instead")
 - Comments should explain WHAT the code does or WHY it exists, not how it's better than something else
 - If you're refactoring, remove old comments - don't add new ones explaining the refactoring
 - YOU MUST NOT remove code comments unless you can PROVE they are actively false. Comments are important documentation and must be preserved.
 - YOU MUST NOT add comments about what used to be there or how something has changed.
 - YOU MUST NOT refer to temporal context in comments (like "recently refactored" "moved") or code. Comments should be evergreen and describe the code as it is. If you name something "new" or "enhanced" or "improved", you've probably made a mistake and MUST STOP and ask me what to do.
 - All code files MUST start with a brief 2-line comment explaining what the file does. Each line MUST start with "ABOUTME: " to make them easily greppable.

  Examples:
  // BAD: This uses Zod for validation instead of manual checking
  // BAD: Refactored from the old validation system
  // BAD: Wrapper around MCP tool protocol
  // GOOD: Executes tools with validated arguments

  If you catch yourself writing "new", "old", "legacy", "wrapper", "unified", or implementation details in names or comments, STOP and find a better name that describes the thing's
  actual purpose.

## Cross-references in persistent artifacts

Cross-references between persistent documents are valuable — they're the basis of progressive discovery and core to how agents and humans navigate context across a large body of work. The rule is neither "no cross-references" nor "inline every link's content." It's two principles working together:

**1. Every reference MUST be self-identifying.** Without chasing the link, the reader should be able to (i) recognize what the reference points at and (ii) decide whether following it matters for their current task.

**2. Do NOT duplicate authoritative content inline.** When a link points at a stable, authoritative artifact (spec, design doc, decision log), the link IS the right way to convey the content. Duplicating creates staleness risk and version skew as copies drift.

Two failure modes this rule guards against:

**(a) Opaque session identifiers that leak.** Working-session shorthand like `Option C`, `Decision F1`, `Approach B` MUST NOT appear in persistent artifacts — they have no anchor outside the conversation they originated in. Replace the shorthand with the plain-English meaning it stood for, with no link (there's nothing to link to).

**(b) Bare references to real artifacts.** Even when the link points at a stable thing, if the reader can't tell what's behind it without chasing, the reference is broken. Add a brief inline descriptor *and keep the link* — e.g. `see docs/pitfalls/implementation-pitfalls.md DB-1 (never compare datetime() against a JS ISO string)`.

**The operational test.** Reading only the inline text (no link-chasing), can the reader recognize what each reference points at and decide whether following it matters? If not, add inline orientation — just enough to identify and assess relevance, not the full content of what's linked.

**Scope:** applies to ALL artifacts that leave the working session — design docs, specs, code, comments, commit messages, READMEs. Conversational shorthand inside a live session is fine.

## Version Control

- If the project isn't in a git repo, STOP and ask permission to initialize one.
- YOU MUST STOP and ask how to handle uncommitted changes or untracked files when starting work. Suggest committing existing work first.
- When starting work without a clear branch for the current task, YOU MUST create a worktree + branch (see `docs/git-strategy.md`).
- YOU MUST TRACK all non-trivial changes in git.
- YOU MUST commit frequently throughout the development process, even if your high-level tasks are not yet done. Commit your journal entries.
- NEVER SKIP, EVADE OR DISABLE A PRE-COMMIT HOOK.
- You MUST NOT use `git add -A` unless you've just done a `git status` — Don't add random test files to the repo.

### Commit messages

Every commit message MUST follow [Conventional Commits](https://www.conventionalcommits.org): a `<type>(<optional-scope>): <description>` subject line. This applies to **every individual commit**, not just PR titles — this project merges with `--merge` and preserves full per-commit history (see `docs/git-strategy.md` §Merge authority), so each commit subject is a permanent, bisect-visible record.

- **Allowed types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`.
- **Description** is imperative mood, lower-case, no trailing period: `fix(auth): reject tokens with skewed clocks`, not `Fixed the auth bug.`
- **Breaking changes** carry a `!` before the colon (`feat(api)!: drop v1 envelope`) and/or a `BREAKING CHANGE:` footer.
- The subject obeys the §Cross-references rule above: self-identifying, no opaque session shorthand.

### Keeping a clean git graph

**Full reference:** `docs/git-strategy.md` (invariants, day-one workflow, recovery steps, merge authority, multi-agent rules). The rules below are the short form.

- **This project uses two-branch gitflow:** `dev` is the integration branch where work converges; `main` is release-only, updated via deliberate `dev` → `main` publication PRs. Deploys happen on merge to `main`.
- **No direct commits to local `dev`.** Feature work happens in worktrees on dedicated branches (`fix/*`, `feat/*`, `chore/*`, `docs/*`). The root checkout stays on `dev` and mirrors `origin/dev` at all times — advance it only by fetching and resetting, never by committing.
- **Worktrees live at `.claude/worktrees/<slug>` inside the repo** (gitignored). `git worktree add .claude/worktrees/<slug> -b <branch-name>` creates both in one step.
- **NEVER pull or merge `main` into `dev`.** The flow is one-way `dev` → `main`. Realign a drifted local branch with `git fetch` + `git reset --hard origin/<branch>`, never a GUI "Sync"/`git pull`.
- **Fetch before comparing.** Always compare against `origin/dev` (or `origin/main`) after `git fetch`, never the local ref.
- **Merge authority:** agents auto-merge `Routine` PRs on green CI; Sam merges `Review`-class PRs (security-sensitive code, data-integrity, architecture/schema/API contracts) and `Escalate` discoveries. `dev` → `main` publication PRs are always `Review`. Always `gh pr merge --merge --delete-branch` — never `--squash` or `--rebase`. Full rules in `docs/git-strategy.md` §Merge authority.

## Testing

- ALL TEST FAILURES ARE YOUR RESPONSIBILITY, even if they're not your fault. The Broken Windows theory is real.
- You MUST NOT delete a test because it's failing. Instead, raise the issue with Sam.
- Tests MUST comprehensively cover ALL functionality.
- YOU MUST NOT write tests that "test" mocked behavior. If you notice tests that test mocked behavior instead of real logic, you MUST stop and warn Sam about them.
- YOU MUST NOT implement mocks in end to end tests. We always use real data and real APIs.
- YOU MUST NOT ignore system or test output - logs and messages often contain CRITICAL information.
- Test output MUST BE PRISTINE TO PASS. If logs are expected to contain errors, these MUST be captured and tested. If a test is intentionally triggering an error, we *must* capture and validate that the error output is as we expect.
- **Before writing tests, READ `docs/pitfalls/testing-pitfalls.md`** — the project's test-scenario checklist. Every item exists because it caught a real bug here or elsewhere.

## Issue tracking

- You MUST use your TodoWrite tool to keep track of what you're doing. Use it whenever you have 3+ distinct steps, multi-hour work, or multi-file edits. Skip it for single-file edits, trivial commits, or simple Q&A.
- You MUST NOT discard tasks from your TodoWrite todo list without Sam's explicit approval.

## Completion status & escalation

When wrapping a substantive task, report status using one of these four labels so Sam knows exactly what to expect:

- **DONE** — All steps completed successfully. Evidence provided for each claim (test output, file contents, command results).
- **DONE_WITH_CONCERNS** — Completed, but with issues Sam should know about. List each concern with its severity and whether it blocks downstream work.
- **BLOCKED** — Cannot proceed. State what's blocking, what was attempted, and what would unblock.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what's needed.

**Bad work is worse than no work. You will not be penalized for escalating.** Stop and escalate when: you've attempted the same task 3 times without success (surface the dead end — don't add a 4th fix); you're uncertain about a security-sensitive change (auth, secrets, crypto, injection guards, data integrity); or the scope of work exceeds what you can verify in this session.

Escalation is honest reporting, not failure. The format is: **REASON** (one or two sentences), **ATTEMPTED** (what you tried, briefly), **RECOMMENDATION** (what Sam should do next or where to look).

## Systematic Debugging Process

YOU MUST ALWAYS find the root cause of any issue you are debugging.
YOU MUST NOT fix a symptom or add a workaround instead of finding a root cause, even if it is faster or I seem like I'm in a hurry.

YOU MUST follow this debugging framework for ANY technical issue (operationalized by `superpowers:systematic-debugging`):

### Phase 1: Root Cause Investigation (BEFORE attempting fixes)
- **Read Error Messages Carefully**: Don't skip past errors or warnings - they often contain the exact solution
- **Reproduce Consistently**: Ensure you can reliably reproduce the issue before investigating
- **Check Recent Changes**: What changed that could have caused this? Git diff, recent commits, etc.

### Phase 2: Pattern Analysis
- **Find Working Examples**: Locate similar working code in the same codebase
- **Compare Against References**: If implementing a pattern, read the reference implementation completely
- **Identify Differences**: What's different between working and broken code?
- **Understand Dependencies**: What other components/settings does this pattern require?

### Phase 3: Hypothesis and Testing
1. **Form Single Hypothesis**: What do you think is the root cause? State it clearly
2. **Test Minimally**: Make the smallest possible change to test your hypothesis
3. **Verify Before Continuing**: Did your test work? If not, form new hypothesis - don't add more fixes
4. **When You Don't Know**: Say "I don't understand X" rather than pretending to know

### Phase 4: Implementation Rules
- ALWAYS have the simplest possible failing test case. If there's no test framework, it's ok to write a one-off test script.
- You MUST NOT add multiple fixes at once
- You MUST NOT claim to implement a pattern without reading it completely first
- ALWAYS test after each change
- IF your first fix doesn't work, STOP and re-analyze rather than adding more fixes

## Thinking documentation for methodology and brainstorming work

**When this applies.** Substantive methodology artifacts, brainstorming documents, design/architecture decisions, risk enumeration, or any reasoning-heavy deliverable where a future revisor would benefit from knowing why the author chose X over Y. Examples: the design doc, platform-investigation research, adapter-design decisions.

**When this does NOT apply.** Routine implementation (bug fixes, feature builds against a spec), straightforward commits, simple-question answers, mechanical refactors. Don't over-invoke; the overhead is reserved for work where reasoning has durable value.

**The discipline:** Think deeply before writing; capture the reasoning chain alongside the cleaned-up artifact (not just what you concluded but how you got there); keep dead ends and reconsidered alternatives visible ("considered and ruled out" with specific reasons); treat reasoning as a first-class artifact. A 2-hour focused session preserves reasoning that would take days to reconstruct if lost.

**Three-layer memory for load-bearing findings.** When a finding is important enough that rediscovering it the hard way would be costly, capture it in all three layers:

1. `docs/pitfalls/*.md` — the read-before-you-code checklist that travels with the repo. Prevents regressions at write-time.
2. Your private journal (the `private-journal` MCP) and the project auto-memory — survives session compaction and restores across sessions.
3. A dated report under `docs/plans/` (or `docs/research/`) — preserves chronology and an auditable decision trail.

Redundancy is the feature: each layer has different durability and access patterns. When in doubt, default to pitfalls + journal and skip the dedicated report only when the finding is a minor tactical detail.

## Learning and Memory Management

- YOU MUST use the journal tool frequently to capture technical insights, failed approaches, and user preferences.
- Before starting complex tasks, search the journal for relevant past experiences and lessons learned.
- Document architectural decisions and their outcomes for future reference.
- Track patterns in user feedback to improve collaboration over time.
- When you notice something that should be fixed but is unrelated to your current task, document it in your journal rather than fixing it immediately.

**Reflection trigger.** Before reporting a substantive task as DONE, ask: did any commands fail unexpectedly? Did you take a wrong approach and have to backtrack? Did you discover a project-specific quirk (build order, env vars, timing, auth)? If yes, log a brief operational note to your journal. The threshold: would knowing this save 5+ minutes in a future session? If yes, log it. If no, skip — don't pad the journal with obvious details or one-time transient errors.

## Build & Dev Commands

<!-- NOTE: Claude Code's Bash tool runs bash (Unix syntax). Use bash/forward-slash paths. -->
<!-- WORKTREE COMMANDS: Use `git -C <path>` instead of `cd <path> && git <command>` to avoid permission prompts. -->
<!-- For npm/npx in worktrees, `cd <path> && npm ...` will prompt — that's expected and acceptable. -->

```bash
npm run dev             # Next.js dev server (Turbopack)
npm run build           # Production build (next build)
npm test                # Run tests (vitest run)
npm run test:watch      # Watch mode tests
npm run lint            # ESLint (next lint)
npx tsc --noEmit        # Type-check (excludes worker.ts — see tsconfig)
npm run preview         # OpenNext build + wrangler dev (local CF preview)
npm run deploy          # OpenNext build + wrangler deploy
npm run seed:local      # Generate + apply seed data to local D1
```

### Wrangler / D1

```bash
npx wrangler d1 execute tee-times-db --local --file=migrations/0001_initial_schema.sql  # Apply migration locally
npx wrangler d1 execute tee-times-db --local --command="SELECT * FROM courses"          # Query local D1
```

## Cloudflare Platform Questions

- NEVER guess about Cloudflare Workers, D1, Cron Triggers, or Wrangler behavior.
- ALWAYS use the Cloudflare documentation MCP tools (`search_cloudflare_documentation`) to verify platform-specific behavior before making claims or design decisions. Platform limits are captured in `docs/research/cloudflare-limits.md`.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, Turbopack dev) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript 5 (strict) |
| Hosting | Cloudflare Workers (via OpenNext) |
| Database | Cloudflare D1 (SQLite) |
| Scheduling | Cron Triggers → Worker `scheduled()` handler |
| Testing | Vitest 4 |
| Linting | ESLint 9 (next/core-web-vitals) |
| Auth | `arctic` (OAuth), `jose` (JWT) |
| Deploy | GitHub Actions → OpenNext build → wrangler deploy |

## Architecture (Key Points)

**Data model** — 6 tables in D1 (see `migrations/0001_initial_schema.sql`, `migrations/0002_auth_schema.sql`):
- `courses` — static catalog with `platform_config` JSON, `disabled` flag (manual), and `is_active` flag (auto-managed by cron)
- `tee_times` — cached availability, delete+insert per course+date
- `poll_log` — per-course-per-date polling history (freshness + debugging)
- `users` — Google OAuth accounts
- `user_favorites` — per-user favorite courses (FK to users + courses)
- `booking_clicks` — per-user booking click tracking (FK to users + courses)

**Platform adapters** — each booking system (CPS Golf, ForeUp, etc.) implements `PlatformAdapter` in `src/adapters/`. Adapter registry in `src/adapters/index.ts` maps `platformId → adapter`.

**Worker entry** — `worker.ts` wraps OpenNext for HTTP + adds `scheduled()` for cron polling. Excluded from `tsconfig.json` because it imports build-time OpenNext artifacts.

**Cron polling** — `src/lib/cron-handler.ts` runs on `*/5 * * * *`, queries active courses, calls adapters, upserts results via `src/lib/db.ts`.

## Conventions

- Path alias: `@/` → `src/` (configured in tsconfig + vitest)
- D1 types (`D1Database`, etc.) are ambient globals from `@cloudflare/workers-types`
- Cloudflare env bindings and secret bindings (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`) declared in `env.d.ts`
- Tests live alongside source: `src/**/*.test.ts`
- Course catalog: `src/config/courses.json`

## Language / Framework Gotchas

READ `docs/pitfalls/implementation-pitfalls.md` for the full list — it's the single source of truth, organized into domains (Time, CF Runtime, D1, Course Lifecycle, Auth, Deploy) with Flaw → Why → Fix → Lesson entries and per-section review checklists. Critical items:

- **No `process.env`.** Cloudflare Workers don't support it. Use `getCloudflareContext()` from `@opennextjs/cloudflare` (or the `env` passed to `scheduled()`). Works in `next dev`, fails silently in prod. (CF-1)
- **Central Time everywhere.** Derive dates from `todayCT()` in `src/lib/format.ts`, never raw `new Date()`/`toISOString()` — UTC rollover shows tomorrow's date after ~6-7 PM CT. (TIME-1)
- **Never use `datetime()` in SQL comparisons.** It returns space-separated timestamps; JS `toISOString()` returns `T`-separated — lexicographic comparison is always wrong. Use `sqliteIsoNow()` from `src/lib/db.ts`. (DB-1)
- **Never hard-delete courses.** `ON DELETE CASCADE` on `user_favorites`/`booking_clicks` destroys user data. Use `disabled = 1` or let `is_active` handle it. (DB-2)
- **Seed script overwrites D1 on every deploy.** `scripts/seed.ts` resets seeded columns (`disabled`, `display_notes`, `platform_config`) from `courses.json`. Make those changes in `courses.json`, not just D1. (DB-3)

### Universal Gotchas

- **No secrets in CLI flags or command-line env var overrides.** Credentials come from `.dev.vars`, keychain, or scoped environment — never `--secret`/`--password` flags (visible in `ps` and shell history).
- **No PII in audit/debug logs.** Log identifiers (course IDs, correlation IDs) — never user emails or document content.

### Comparative Evaluation Rules

When running comparative evaluations (framework selections, technology spikes): do NOT state a recommendation until ALL evaluation tasks are complete; spend symmetric investigation time on each option; classify findings as BROKEN/MISSING/FIXABLE before scoring; if the story is clean with one clear winner, treat that as suspicious.

## Linter Suppressions

**Before adding any `eslint-disable` comment, first try to fix the underlying code.** Suppressions are only justified when:
1. The warning is a **confirmed false positive**
2. The risk is **architecturally controlled** at a higher level
3. The fix would be **disproportionate** to the actual risk in context

When suppression is necessary, prefer **inline `// eslint-disable-next-line rule-name -- reason`** over block or file-level disables. Inline suppressions are visible to reviewers, scoped to exactly the affected line, and force documentation of the reason.

## Development Workflow

**Commit frequently** — aim for small, focused commits that are individually CI-passing. Each logical unit (a package, a migration, a handler) should be its own commit. Large commits make review harder and lose context if context is compacted.

**Update `docs/implementation-log.md` after each commit** — record what was built, key implementation decisions, gotchas discovered, and quality check results. This is the primary mechanism for preserving context across compacted sessions.

**CI runs 4 parallel jobs**: type-check (`npx tsc --noEmit`), lint (`npm run lint`), test (`npm test`), build (`npx @opennextjs/cloudflare build`). Runs on pushes to and PRs targeting `main` or `dev`. Adapter smoke tests run on PRs touching adapter code. Deploys (including the Lambda fetch proxy) happen on merge to `main`.

## Project Layout

```
src/
  adapters/          # Platform adapters (CPS Golf, ForeUp, …) + tests
  app/               # Next.js App Router pages + API routes
    api/auth/        # OAuth routes (google, google/callback, logout, me)
    api/courses/     # GET /api/courses, GET/POST /api/courses/[id], POST /api/courses/[id]/refresh
    api/tee-times/   # GET /api/tee-times
    api/user/        # User data routes (favorites, booking-clicks, account)
    courses/[id]/    # Course detail page
  components/        # React components (nav, auth-provider, nav-auth-area, toast, etc.)
  config/            # courses.json (static course catalog)
  hooks/             # React hooks (use-favorites)
  lib/               # Core logic: auth, cron-handler, db, poller, favorites, format, rate-limit
  test/              # Test helpers
    fixtures/        # JSON response fixtures for adapter tests
  types/             # TypeScript interfaces (CourseConfig, TeeTime, PlatformAdapter, auth, D1 row types)
docs/                # plans, research, pitfalls, git-strategy.md
migrations/          # D1 SQL migrations
scripts/             # Seed data generation
worker.ts            # Cloudflare Worker entry (HTTP via OpenNext + cron scheduled())
wrangler.jsonc       # Cloudflare config (D1 binding, cron triggers)
```

## Skills & Subagents

Use these proactively — don't wait to be asked.

**Workflow skills** (invoke with the Skill tool):

| Skill | When to use |
|-------|-------------|
| `superpowers:brainstorming` | Before any new feature or creative work |
| `superpowers:writing-plans` | Before multi-step implementation when requirements exist |
| `superpowers:test-driven-development` | When implementing any feature or bugfix |
| `superpowers:systematic-debugging` | When encountering any bug, test failure, or unexpected behavior |
| `superpowers:verification-before-completion` | Before claiming work is done or creating commits/PRs |
| `superpowers:requesting-code-review` | After completing a major feature or before merging |
| `superpowers:receiving-code-review` | When receiving code review feedback, before implementing suggestions |
| `superpowers:finishing-a-development-branch` | When implementation is complete and ready to integrate |
| `superpowers:using-git-worktrees` | Before starting feature work that needs branch isolation |
| `superpowers:executing-plans` | When executing a written implementation plan in a new session |
| `superpowers:dispatching-parallel-agents` | When facing 2+ independent tasks suitable for parallel agents |
| `superpowers:subagent-driven-development` | When executing plans with independent tasks in the current session |
| `commit-commands:commit` | When creating a git commit |
| `commit-commands:commit-push-pr` | When committing, pushing, and opening a PR |

**Project-specific skills:**

| Skill | When to use |
|-------|-------------|
| `writing-plans-enhanced` | Writing implementation plans for this project (wraps `superpowers:writing-plans` with project conventions) |
| `plan-review-cycle` | Reviewing an implementation plan for subagent-readiness before committing |
| `bug-hunt-cycle` | Full bug-hunt cycle (parallel hunters → cross-validate → fix plan) when finishing a phase or auditing |
| `check-logs` | Check production polling health, adapter errors, course failures |
| `code-bug-hunter-multipass` | Systematic multi-pass bug analysis |
| `code-bug-hunter-holistic` | Deep semantic analysis of focused codebase |
| `code-bug-hunter-exploratory` | Depth-first exploration of high-risk code |

## Skill routing

When the user's request matches an available skill, you MUST invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Bugs, errors, test failures, "why is this broken" → `superpowers:systematic-debugging`
- Writing an implementation plan → `writing-plans-enhanced`
- Reviewing a plan before committing → `plan-review-cycle`
- Auditing a phase / hunting bugs → `bug-hunt-cycle`
- Production polling health, adapter errors → `check-logs`
- Before any new feature or creative work → `superpowers:brainstorming`
- Before claiming work done / creating a PR → `superpowers:verification-before-completion`
