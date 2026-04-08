# Accessibility Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two layers of automated accessibility testing — component-level (vitest-axe) and E2E page-level (Playwright + @axe-core/playwright) — then audit and fix all existing violations.

**Architecture:** Layer 1 adds `vitest-axe` assertions to existing component render tests (runs in `npm test`). Layer 2 adds Playwright tests against the local Wrangler preview server, run on-demand via `npm run test:a11y`. Both layers target WCAG 2.1 AA. The audit-then-fix approach means we write the tests first, see what fails, then fix the source components.

**Tech Stack:** vitest-axe (wraps axe-core for Vitest), @axe-core/playwright (wraps axe-core for Playwright), @playwright/test (E2E runner)

**Task dependencies:** Tasks are strictly sequential. Each task depends on all prior tasks being complete.

---

## Layer 1: Component-Level Accessibility Testing (vitest-axe)

### Task 1: Install vitest-axe and configure matcher

**Depends on:** Nothing (first task).

**Files:**
- Modify: `package.json` (new devDependency)
- Create: `vitest-setup.ts` (project root)
- Modify: `vitest.config.ts:4-10` (add setupFiles)

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Follow TDD: write failing test → implement → verify green.

**Step 1: Install vitest-axe**

Run: `npm install --save-dev vitest-axe`
Expected: Package added to devDependencies in package.json

**Step 2: Create vitest setup file**

Create `vitest-setup.ts` at project root:

```ts
// ABOUTME: Global vitest setup — registers custom matchers.
// ABOUTME: Imported by vitest.config.ts setupFiles.
import "vitest-axe/extend-expect";
```

This registers the `toHaveNoViolations()` matcher globally for all tests. It does NOT require jsdom — it just extends the `expect` object, so it's safe to run for node-environment tests too.

**Step 3: Update vitest.config.ts to use setup file**

Add `setupFiles` to the test config. The only change is adding the `setupFiles` line — do NOT change any other config:

```ts
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.smoke.test.{ts,tsx}"],
    pool: "forks",
    setupFiles: ["./vitest-setup.ts"],
  },
  // ... resolve stays the same
});
```

**Step 4: Run existing tests to verify nothing broke**

Run: `npm test`
Expected: All existing tests pass. The new setup file just adds a matcher — no behavioral change.

**Step 5: Commit**

```
feat: add vitest-axe and configure accessibility matcher
```

BEFORE marking this task complete:
1. Verify all existing tests still pass (`npm test`)
2. Confirm `vitest-setup.ts` exists and `vitest.config.ts` references it

---

### Task 2: Add axe assertions to existing component render tests and fix violations

**Depends on:** Task 1 (vitest-axe must be installed and setup file configured).

**Context:** There are 6 existing `.test.tsx` files that render React components. Each gets one new `it("has no accessibility violations")` test that renders the component and runs axe-core on it. After adding all tests, run the suite, then fix any violations found in the source components.

**Important:** The `axe()` function is async. Each test must `await` it. Use `import { axe } from "vitest-axe"` in each file.

**Important:** For isolated component tests, disable the `region` rule. axe-core expects all content to be inside landmark regions (`<main>`, `<nav>`, etc.), but isolated components rendered in a test won't have a wrapping landmark. This is NOT a real violation — the full page provides the landmarks. Configure with: `axe(container, { rules: { region: { enabled: false } } })`.

**Do NOT** when fixing violations:
- Restructure or refactor components beyond the minimal a11y fix
- Change visual appearance (no CSS changes unless axe specifically flags contrast)
- Add complex ARIA widget patterns — prefer simple fixes (labels, roles, heading levels)
- Suppress axe rules to make tests pass
- Add `aria-hidden="true"` to hide problems

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Follow TDD: write failing test → implement → verify green.

**Files to modify (add one test to each):**

1. `src/components/tee-time-list.render.test.tsx`
2. `src/components/toast.test.tsx`
3. `src/components/share-dialog.test.tsx`
4. `src/components/auth-provider.test.tsx`
5. `src/app/courses/page.test.tsx`
6. `src/app/about/page.test.tsx`

**Step 1: Add axe import and a11y test to each file**

The pattern for each file is identical. Add this import at the top (alongside existing imports):

```ts
import { axe } from "vitest-axe";
```

Then add one test inside the existing `describe` block:

```ts
it("has no accessibility violations", async () => {
  const { container } = render(<ComponentUnderTest {...requiredProps} />);
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**Per-file specifics:**

**tee-time-list.render.test.tsx** — render with sample data so the full list renders (not the empty/loading state). The `makeTeeTimeItem` helper already exists in this file:
```ts
it("has no accessibility violations", async () => {
  const teeTimes = [
    makeTeeTimeItem({ course_id: "course-a", time: "08:00" }),
    makeTeeTimeItem({ course_id: "course-b", time: "09:00" }),
  ];
  const { container } = render(<TeeTimeList teeTimes={teeTimes} loading={false} />);
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**toast.test.tsx** — render with a visible message:
```ts
it("has no accessibility violations", async () => {
  const { container } = render(<Toast message="Test notification" onDismiss={() => {}} />);
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**share-dialog.test.tsx** — render with course data:
```ts
it("has no accessibility violations", async () => {
  const courses = [
    { id: "braemar", name: "Braemar" },
    { id: "edinburgh-usa", name: "Edinburgh USA" },
  ];
  const { container } = render(
    <ShareDialog courses={courses} onAccept={() => {}} onCancel={() => {}} />
  );
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**auth-provider.test.tsx** — render the AuthProvider with a simple consumer. Note: `mockFetch` is already defined at module scope in this file (`const mockFetch = vi.fn(); global.fetch = mockFetch;`). Use it to mock the /api/auth/me call:
```ts
it("has no accessibility violations", async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  const { container } = render(
    <AuthProvider>
      <div>child</div>
    </AuthProvider>
  );
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**courses/page.test.tsx** — render the page. All mocks (`courses.json`, `use-favorites`, `next/link`, `use-location`) are already defined at module scope in this file:
```ts
it("has no accessibility violations", async () => {
  const { container } = render(<CoursesPage />);
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**about/page.test.tsx** — render the page. No mocks needed — it's a static content component:
```ts
it("has no accessibility violations", async () => {
  const { container } = render(<AboutPage />);
  const results = await axe(container, {
    rules: { region: { enabled: false } },
  });
  expect(results).toHaveNoViolations();
});
```

**Step 2: Run tests — audit violations**

Run: `npm test`

Record which tests fail and what violations axe-core reports. Common violations to expect:
- Missing form labels (search input, filter controls)
- Missing button accessible names
- Heading hierarchy issues
- Missing link text

**Step 3: Fix violations in source components**

For each violation reported by axe-core:
1. Read the violation report (it includes the rule ID, affected HTML nodes, and a suggested fix)
2. Fix the source component (the `.tsx` file, NOT the test)
3. Run the specific test file to verify the violation is resolved
4. Move to the next violation

Common minimal fixes:
- Missing label → add `aria-label="..."` attribute or a `<label>` element
- Missing button name → add text content or `aria-label`
- Missing link purpose → add `aria-label` describing the destination
- Dialog semantics → add `role="dialog"` and `aria-labelledby`
- Toast notifications → add `role="alert"` for screen reader announcement
- Heading hierarchy → adjust heading levels (h1 → h2 → h3, no skipping)

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL tests pass, including the 6 new a11y assertions AND all existing tests.

**Step 5: Commit**

```
feat: add component-level accessibility tests and fix violations

Add vitest-axe assertions to 6 component render tests.
Fix violations: [list specific fixes applied]
```

BEFORE marking this task complete:
1. Verify all tests pass (`npm test`) — both new a11y tests and existing tests
2. Confirm each of the 6 test files has the new `axe` import and a11y test
3. Run `npx tsc --noEmit` to verify no type errors

---

### Layer 1 Review Checkpoint

After completing Tasks 1-2:
Review the batch from multiple perspectives. Minimum 3 review rounds.
If round 3 still finds issues, keep going until clean.

Verify:
- All 6 a11y component tests exist and pass
- No existing tests were broken
- Source component fixes are minimal (no unnecessary refactoring)
- `npm test` is green
- `npx tsc --noEmit` passes

---

## Layer 2: E2E Page-Level Accessibility Testing (Playwright)

### Task 3: Install Playwright and configure E2E infrastructure

**Depends on:** Layer 1 complete (Tasks 1-2). Component violations should already be fixed so E2E tests focus on page-level issues.

**Files:**
- Modify: `package.json` (new devDependencies + new script)
- Create: `playwright.config.ts` (project root)
- Create: `e2e/a11y/` directory (empty for now)
- Modify: `.gitignore` (add Playwright artifacts)

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Follow TDD: write failing test → implement → verify green.

**Step 1: Install Playwright and axe-core integration**

Run: `npm install --save-dev @playwright/test @axe-core/playwright`
Then: `npx playwright install chromium`

We only need Chromium — no need for Firefox/WebKit for a11y testing. Do NOT install all browsers.

**Step 2: Create playwright.config.ts**

```ts
// ABOUTME: Playwright config for on-demand accessibility testing.
// ABOUTME: Runs axe-core against the local Wrangler preview server.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8787",
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:8787",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
```

Key decisions:
- `reuseExistingServer: true` — if you already have `npm run preview` running, Playwright uses it instead of starting a new one. This avoids the slow OpenNext build step on repeated runs.
- `timeout: 120_000` for webServer — `npm run preview` runs `opennextjs-cloudflare build && wrangler dev`, which takes time.
- Port 8787 — Wrangler's default.

**Step 3: Add npm script to package.json**

Add this entry to the `"scripts"` object in `package.json`:
```json
"test:a11y": "npx playwright test"
```

**Step 4: Update .gitignore**

Add these lines at the end of `.gitignore`:
```
# Playwright
test-results/
playwright-report/
```

**Step 5: Verify Playwright is installed**

Run: `npx playwright --version`
Expected: Prints version number. Confirms Playwright is installed correctly.

**Step 6: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests pass. Playwright packages should have no effect on Vitest.

**Step 7: Commit**

```
feat: add Playwright infrastructure for E2E accessibility testing
```

BEFORE marking this task complete:
1. Verify `npx playwright --version` prints a version number
2. Verify `npm test` still passes
3. Verify `playwright.config.ts` exists at project root
4. Verify `.gitignore` includes `test-results/` and `playwright-report/`

---

### Task 4: Write E2E accessibility tests and fix violations

**Depends on:** Task 3 (Playwright must be installed and configured).

**Prerequisites:** Local D1 must be seeded (`npm run seed:local`) and `.dev.vars` must have secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`).

**Files to create:**
- `e2e/a11y/home.a11y.test.ts`
- `e2e/a11y/courses.a11y.test.ts`
- `e2e/a11y/course-detail.a11y.test.ts`
- `e2e/a11y/about.a11y.test.ts`

**Do NOT** when fixing violations:
- Use `.exclude()` on AxeBuilder to hide violations
- Add `aria-hidden="true"` to suppress problems
- Disable axe rules unless it's a confirmed false positive (document why with a code comment if so)
- Restructure page layout or component hierarchy
- Change visual design

BEFORE starting work:
1. Invoke /superpowers:test-driven-development
2. Follow TDD: write failing test → implement → verify green.

**Important:** All tests use the same pattern — navigate to page, wait for content, run AxeBuilder, assert zero violations. Target WCAG 2.1 AA using all four tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. You need all four because `wcag21aa` alone only covers rules *added* in 2.1, not the base 2.0 rules.

**Step 1: Create e2e/a11y/home.a11y.test.ts**

```ts
// ABOUTME: E2E accessibility test for the home page.
// ABOUTME: Runs axe-core against the fully rendered page with real CSS.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Home page accessibility", () => {
  test("has no WCAG 2.1 AA violations", async ({ page }) => {
    await page.goto("/");
    // Page shows "Loading tee times..." then either results or "No tee times found"
    await page.locator("text=No tee times found")
      .or(page.locator("text=tee time"))
      .first()
      .waitFor({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
```

**Note:** The home page fetches tee times from the API. With seeded data but no polling, the tee_times table may be empty, so we'll likely see the "No tee times found" state. This still exercises the page chrome (nav, filters, date picker).

**Step 2: Create e2e/a11y/courses.a11y.test.ts**

```ts
// ABOUTME: E2E accessibility test for the courses listing page.
// ABOUTME: Runs axe-core against the fully rendered page with real CSS.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Courses page accessibility", () => {
  test("has no WCAG 2.1 AA violations", async ({ page }) => {
    await page.goto("/courses");
    // Courses come from static JSON import, so they render quickly
    await page.locator("text=Courses").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
```

**Step 3: Create e2e/a11y/course-detail.a11y.test.ts**

```ts
// ABOUTME: E2E accessibility test for the course detail page.
// ABOUTME: Runs axe-core against the fully rendered page with real CSS.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("Course detail page accessibility", () => {
  test("has no WCAG 2.1 AA violations", async ({ page }) => {
    // theodore-wirth-18 is always present in seed data (src/config/courses.json, first entry)
    await page.goto("/courses/theodore-wirth-18");
    await page.locator("text=Theodore Wirth").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
```

**Step 4: Create e2e/a11y/about.a11y.test.ts**

```ts
// ABOUTME: E2E accessibility test for the about/how-it-works page.
// ABOUTME: Runs axe-core against the fully rendered page with real CSS.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe("About page accessibility", () => {
  test("has no WCAG 2.1 AA violations", async ({ page }) => {
    await page.goto("/about");
    await page.locator("text=How It Works").waitFor();

    const results = await new AxeBuilder({ page })
      .withTags(wcagTags)
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
```

**Step 5: Run the E2E a11y tests — audit violations**

Ensure local D1 is seeded: `npm run seed:local`

Run: `npm run test:a11y`

If preview server isn't already running, Playwright will start it (slow first time due to OpenNext build). Record all violations. Common E2E-specific violations:
- Color contrast issues (axe-core can check real computed styles here)
- Missing skip navigation link
- Missing page-level landmarks (main, nav)

**Step 6: Fix violations in source components**

For each violation reported:
1. Read the violation report (rule ID, affected HTML, suggested fix)
2. Fix the source component (`.tsx` file)
3. Re-run `npm run test:a11y` to verify the fix

Files likely to need fixes (some may have already been modified in Task 2 — that's expected, apply additional fixes as needed):
- `src/app/layout.tsx` — page-level landmarks (`<main>`, skip-nav link)
- `src/components/nav.tsx` — `<nav>` landmark element
- `src/components/date-picker.tsx` — interactive widget labels
- `src/components/time-filter.tsx` — filter button labels
- `src/components/location-filter.tsx` — form input labels

**Step 7: Verify both test suites pass**

Run: `npm run test:a11y` (E2E)
Run: `npm test` (unit + component)

Both must pass.

**Step 8: Commit**

```
feat: add E2E accessibility tests and fix page-level violations

Four Playwright tests cover /, /courses, /courses/[id], /about.
Violations fixed: [list specific fixes]
```

BEFORE marking this task complete:
1. All 4 E2E a11y tests pass (`npm run test:a11y`)
2. All unit/component tests still pass (`npm test`)
3. `npx tsc --noEmit` passes
4. Each of the 4 test files exists in `e2e/a11y/`

---

### Layer 2 Review Checkpoint

After completing Tasks 3-4:
Review the batch from multiple perspectives. Minimum 3 review rounds.
If round 3 still finds issues, keep going until clean.

Verify:
- All 4 E2E a11y tests pass
- Component-level tests still pass
- Source fixes are minimal
- Playwright config correctly references preview server on port 8787
- `.gitignore` updated

---

## Final Verification

### Task 5: Verify both layers pass and document in CLAUDE.md

**Depends on:** Tasks 1-4 all complete.

**Step 1: Run both test suites**

Run: `npm test` (component-level a11y + all unit tests)
Run: `npm run test:a11y` (E2E page-level a11y)

Both must pass.

**Step 2: Run type-check and lint**

Run: `npx tsc --noEmit`
Run: `npm run lint`

Both must pass.

**Step 3: Update CLAUDE.md Build & Dev Commands section**

Add `npm run test:a11y` to the commands list in the `## Build & Dev Commands` section:

```
npm run test:a11y      # On-demand Playwright accessibility audit (needs seed:local + .dev.vars)
```

**Step 4: Commit**

```
docs: add test:a11y command to CLAUDE.md
```

BEFORE marking this task complete:
1. Both `npm test` and `npm run test:a11y` pass
2. `npx tsc --noEmit` and `npm run lint` pass
3. CLAUDE.md includes the new command

---

## Notes

- **WCAG 2.1 AA** is the target for both layers. This is the industry standard and covers the vast majority of real-world a11y issues.
- **Color contrast** can only be checked by Layer 2 (E2E). jsdom has no computed styles, so vitest-axe skips contrast rules by default.
- **Auth-gated states** are not tested in this pass. All tests run as an anonymous/logged-out user. Auth-state a11y testing can be added later.
- **The `region` rule** is disabled for component-level tests because isolated components don't have page-level landmarks. The E2E tests check landmarks at the page level.
- **`npm run preview`** runs `opennextjs-cloudflare build && wrangler dev`. The build step is slow (~30s). Use `reuseExistingServer: true` in Playwright config so repeat runs skip the build.
- **Pitfalls docs** (`docs/pitfalls/`) do not exist in this project yet. No known pitfalls apply to this plan.
