# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — run all Cucumber scenarios (default Chromium, **headed** by default; see "Headed vs headless" below). Runs through `scripts/run-tests.js`, which regenerates the readable HTML report after the run.
- `npm run test:login` — run only `features/login.feature`.
- `npm run test:mfa` — run only `features/MFA-auth/`.
- `npm run test:headed` — equivalent to `npm test` (sets `HEADED=true` explicitly via `cross-env`).
- Headless run: `cross-env HEADED=false npm test` (or `npx cucumber-js` with `HEADED=false` set in the shell — see the report caveat below).
- Single scenario by name: `npm test -- --name "User enables MFA via Authenticator App"` (extra args after `--` pass through to Cucumber). `npx cucumber-js --name "..."` also works but skips report generation.
- By tag: `npm test -- --tags "@authenticator-app"` (other tags in use: `@settings`, `@login`, `@trusted-device`, `@recovery-codes`, `@negative`, `@RateLimit`).
- Single feature file: `npm test -- features/login.feature`.
- Report generation: **runs automatically after any `npm test*` command** via the `scripts/run-tests.js` wrapper — it spawns Cucumber, waits for it to fully exit (so the `json:` formatter has flushed), then runs `scripts/generate-cucumber-report.js` to build a self-contained, readable `reports/cucumber-report.html` from `reports/cucumber-report.json`. Generated on both pass and fail; Cucumber's exit code is propagated. To rebuild the HTML from an existing JSON without re-running tests: `npm run test:report`.
- **Report caveat:** the report is intentionally NOT generated from a Cucumber `AfterAll` hook — Cucumber's file formatters flush on `testRunFinished`, which fires *after* `AfterAll`, so a hook would read a half-written JSON (`Unexpected end of JSON input`). If you invoke `npx cucumber-js` directly (bypassing the wrapper), run `npm run test:report` afterward to refresh the HTML.

There is no lint or type-check step; the project is plain JavaScript with CommonJS `require`.

### Headed vs headless

`features/support/hooks.js` reads `process.env.HEADED !== 'false'`, so the browser runs **headed by default**. To run headless you must explicitly set `HEADED=false`. `slowMo: 50` is also enabled in headed mode.

## Architecture

This is a Playwright + Cucumber BDD framework using a Page Object Model. The pieces fit together as follows:

1. **`cucumber.js`** registers everything under `features/support/**` and `features/step_definitions/**`, runs all `features/**/*.feature`, and sets a 60s default timeout.
2. **`features/support/world.js`** defines `CustomWorld` — a per-scenario context that holds `browser`, `context`, `page`, and `pages` (the instantiated POM objects). All step definitions read/write through `this`.
3. **`features/support/hooks.js`** owns the Playwright lifecycle:
   - `BeforeAll` launches a single shared `chromium` browser.
   - `Before` creates a fresh `context` + `page` per scenario and instantiates `this.pages.login` and `this.pages.dashboard` against that page.
   - `After` attaches a full-page screenshot to the Cucumber report on failure (saved to `reports/screenshots/`) and tears down the context.
   - `AfterAll` closes the browser. It does **not** build the HTML report (see the report caveat in Commands) — the `scripts/run-tests.js` wrapper does that after Cucumber exits.
4. **`features/pages/`** — Page Objects. `BasePage` provides shared actions (`navigate`, `type`, `click`, `getText`, etc.). Every concrete page extends it. **New pages must be wired into `hooks.js`'s `Before` block** and exposed on `this.pages` so step definitions can reach them — there is no auto-discovery.
5. **`features/step_definitions/login.steps.js`** — all step definitions live here today (logout flow included). When adding new domains, create a sibling `*.steps.js` file; Cucumber will pick it up via the glob.

### Selector strategy (important)

Page Objects do **not** use single selectors — each locator is a comma-separated list layered from most-stable to most-fragile:

```
data-testid → ARIA role / name → semantic HTML (input[type=...]) → MUI/notistack structural classes → text-content fallback
```

This is deliberate: the app under test is a Material-UI + notistack frontend with few `data-testid` hooks today. The layered selectors let the suite tolerate small DOM changes and survive partial test-id rollout. When extending a Page Object, follow the same pattern — prepend a `data-testid` candidate even if the current build doesn't expose one yet, so the suite auto-upgrades when the app team adds them.

### RBAC verification (`features/UserManagement/RBAC-verification.feature`)

The RBAC suite is spec-driven rather than assertion-by-hand:

- **`features/support/rbacMatrix.js`** is the two spreadsheets in `Files/` (NXT-1362) transcribed as data — one entry per sheet row × 12 role columns — plus a `CHECKS` table naming the live affordance that proves each permission (a button, a tab, a row-menu item, a report card…). It also owns `verdictFor()`, which turns "sheet value + observation" into pass / fail / pending. Values keep the sheet's qualifiers (`view-only`, `own-only`, `clinic-only`, `no-timer`…) because several change *what the UI must show*, not just whether it shows.
- **`features/pages/PermissionsPage.js`** is a pure observer: it reads what the currently logged-in role can see and do (sidebar, `/users` rows + Add-User role options + row menus + user-detail tabs, `/clinics` and clinic detail, `/patients` and the patient record, `/reports` cards, `/invoices`, and the patient Notes drawer) and never mutates. Surfaces are cached per scenario.
- **`features/step_definitions/rbac.steps.js`** drives the lifecycle (add → invitation email → Active → 4 reset requests → Suspended → admin ⋮ "Reactivate Account" → Pending → reset link → Active) and then the permission sweep. It writes its state into `world.uu`, the same scratch object `user.steps.js` uses, so those existing steps compose instead of being reimplemented.

Things that will bite you when extending it:

- **Mismatches are collected, not thrown per section.** Each section step banks its findings and the final step (`the RBAC verification should report no permission mismatches`) fails the scenario, so one run reports every deviation instead of stopping at the first screen.
- **Read only VISIBLE controls.** MUI keeps the panels of previously-visited tabs mounted, so an unfiltered button read returns another tab's controls and over-reports permissions. Same for `[role="menuitem"]`: closed menus linger, so menu items are read from the one visible popover.
- **Wait for grids, and tell "no permission" from "no data".** This preview host paints grids unevenly (1.5s to 8s+); a still-loading grid reads as zero rows, which looks like "this role sees nothing". `waitForGrid()` settles on rows *or* the empty-state overlay, and read access counts as proven when the screen renders at all.
- **A role's users may be past page 1.** The search box never searches by role, so `findUserRowByRole()` falls back to the Roles filter, then re-finds the row by email search before probing it.
- **Notes are easy to miss.** They are not a tab: the drawer opens from an icon-only button in the patient header (`aria-label="Show All Notes"`, beside "Report"), and the per-note Edit/Delete controls are icon-only and hover-only. Because nothing labels them, `noteActions()` identifies them by activating each and reading what appears (delete-confirmation vs inline editor), then always dismissing ("Keep It" / "Cancel") — and the scenario asserts afterwards that every note is still there.
- **One tagged `Examples` block per role.** `@support-staff` runs today; the other ten carry `@role-pending`, which `cucumber.js` excludes by default because each block is a full live lifecycle. Switch one on with its own tag: `npm test -- --tags "@executive-admin"`.

### Validation assertions

Several `Then` steps assert "validation occurred" disjunctively — e.g. `a validation message should be displayed for the email field` passes if **either** an inline helper-text error is visible **or** the submit button is disabled. This is intentional: different MUI form states surface validation differently, and both are acceptable feedback. Keep this pattern when adding similar steps.

## App under test

- Login URL is hardcoded in `features/pages/LoginPage.js` (`https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login`). To point at a different environment, change it there.
- Test accounts (valid / invalid / suspended / pending) are in `test-data/users.json`. The `_note` fields document backend state assumptions: the `suspended` and `pending` scenarios pass cleanly only if the backend has those accounts in the right state — otherwise they fall back to a generic invalid-credentials assertion.

## Probe scripts

`scripts/probe-*.js` are standalone Playwright scripts used to interactively discover/verify selectors against the live app (e.g., `node scripts/probe-dashboard.js`). They are dev-only utilities, not part of the test run, and are not wired into `cucumber.js`.

## Notes

- `features/add supervisor.feature` is wired to `features/step_definitions/supervisor.steps.js` and the `SupervisorsPage` POM — it runs against the admin "Add Supervisor" modal.
- Email-driven scenarios read from a Gmail inbox over IMAP via `features/support/gmailClient.js`. The 7 subject lines NXTSTIM sends are registered in `features/support/emailTypes.js`; subject + extractor (OTP / reset link / reactivation link) live in that single file.
- `reports/` is gitignored and regenerated each run.
