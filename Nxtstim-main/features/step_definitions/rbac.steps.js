/**
 * rbac.steps.js — features/UserManagement/RBAC-verification.feature.
 *
 * Two jobs:
 *
 *   1. The account LIFECYCLE for a role, end to end against the live app:
 *        add user (Add New User wizard) → Pending
 *        → invitation OTP email → set password → Active
 *        → 4 forgot-password requests → Suspended
 *        → admin: Suspended tab ⋮ "Reactivate Account" → email → Pending
 *        → reset link → set password → Active again
 *
 *   2. The PERMISSION sweep: log in as that user and walk every section of the
 *      RBAC sheet, comparing each row to what the UI actually offers.
 *
 * Deliberate reuse — this file adds no machinery that already exists:
 *   - inactiveUserFlow  → admin login (incl. the email-MFA challenge), unique
 *                         plus-tag aliases, password generation, id lookup.
 *   - emailHelper       → the real inbox (Gmail IMAP) for OTP and reset links.
 *   - testApi           → set-first-password, forgot-password, status probing.
 *   - AdminUsersPage    → the Suspended/Pending row 3-dot recovery actions that
 *                         accountHealer.js already proved live.
 *   - UsersPage         → the Add New User wizard.
 *   - PermissionsPage   → reads what the acting role can see/do.
 *   - user.steps.js     → this file writes its state into `world.uu`, the same
 *                         scratch object user.steps.js uses, so its existing
 *                         steps ("the new user should appear in the '…' sub-tab",
 *                         "a set-password email should be sent to the new user",
 *                         "the user completes the password setup", "the new user
 *                         should have the role '…'") compose with the flow here
 *                         instead of being reimplemented.
 *
 * Suspension mechanism: the FIRST reset request goes through the real
 * forgot-password screen; the remaining ones go through the documented
 * forgot-password API. The UI enforces a ~60s cooldown per resend, so driving
 * all four through the screen would add ~5 minutes of pure waiting per role for
 * no extra coverage — the lockout itself is still asserted in the admin UI (the
 * user has to appear under the Suspended sub-tab).
 */
const { Given, When, Then, pending } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

const flow = require('../support/inactiveUserFlow');
const emailHelper = require('../support/emailHelper');
const testApi = require('../support/testApi');
const pwStore = require('../support/passwordStore');
const matrix = require('../support/rbacMatrix');

const SLOW = { timeout: 180_000 };
const VERY_SLOW = { timeout: 300_000 };
const EMAIL_WAIT_MS = 150_000;
const CLOCK_SKEW_MS = 5_000;

/** Reset/reactivation emails both carry a set-password link. */
const RESET_EMAIL_SUBJECT = /Account Reactivation|Action Required:\s*Reset Your NXTSTIM Password|NXTSTIM Password Reset Request/i;

/**
 * Per-scenario scratch — the SAME object user.steps.js uses (`world.uu`), so its
 * steps and these interoperate. Extra keys used here: `roleLabel`, `resetLink`,
 * `reactivatedAt`.
 */
function state(world) {
  world.uu = world.uu || {};
  return world.uu;
}

function usersBase() {
  return process.env.USERS_EMAIL || 'users@iqra.anonaddy.com';
}

/** Log out completely: HttpOnly cookies AND web storage, then land on /login. */
async function logout(world) {
  await world.context.clearCookies().catch(() => {});
  await world.pages.login.open();
  await world.page
    .evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ }
    })
    .catch(() => {});
}

/** Attach a readable block to the Cucumber report. */
async function report(world, title, lines) {
  await world.attach(`${title}\n${'─'.repeat(title.length)}\n${lines.join('\n')}`, 'text/plain');
}

// =========================================================================
// LIFECYCLE — create
// =========================================================================

When('I add a new {string} user through the Add New User wizard', SLOW, async function (role) {
  const s = state(this);
  const label = matrix.roleLabel(role);
  s.roleLabel = label;
  s.roles = [label];
  s.email = s.email || flow.uniqueEmail(usersBase());
  s.firstName = 'Rbac';
  s.lastName = label.replace(/[^A-Za-z]/g, '') || 'Role';
  // Stamped BEFORE submitting so the invitation email is matched by arrival time.
  s.createdAfter = Date.now() - CLOCK_SKEW_MS;

  const users = this.pages.users;
  await users.open();
  await users.createUser({
    roles: label,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)'
  });

  s.toast = await users.captureToast(8000);
  expect(
    /error|failed|already exist|invalid/i.test(s.toast || ''),
    `creating the ${label} user failed: "${s.toast}"`
  ).toBe(false);

  // The wizard must have closed — an open dialog means validation rejected it.
  if (await users.isDialogOpen()) {
    const errors = await users.validationMessages();
    throw new Error(
      `the Add New User wizard is still open after submitting the ${label} user: ` +
      `${errors.join(' | ') || 'no inline error shown'}`
    );
  }

  s.userId = await flow.lookupUserId(s.email).catch(() => null);
  await report(this, `Created a ${label} user`, [
    `Email   : ${s.email}`,
    `Name    : ${s.firstName} ${s.lastName}`,
    `User ID : ${s.userId || '(resolved from the grid later — the listing API needs a bearer token this suite does not hold)'}`,
    `Toast   : ${s.toast || '(auto-dismissed before capture)'}`
  ]);
});

// =========================================================================
// LIFECYCLE — Active → Suspended (forgot password more than 3 times)
// =========================================================================

When('the new user requests a password reset {int} times', VERY_SLOW, async function (times) {
  const s = state(this);
  expect(s.email, 'no user has been created in this scenario yet').toBeTruthy();
  testApi.requireConfigured('forgot-password lockout');

  // The admin session must go: the forgot-password screen is a logged-out one.
  await logout(this);

  const outcomes = [];

  // Request #1 through the real screen the user would use.
  await this.pages.forgotPassword.navigate(`${this.pages.users.origin()}/forgot-password`);
  await this.pages.forgotPassword.waitForLoaded();
  s.resetRequestedAt = Date.now() - CLOCK_SKEW_MS;
  await this.pages.forgotPassword.request(s.email);
  const confirmed = await this.pages.forgotPassword.hasConfirmationMessage(10000).catch(() => false);
  outcomes.push(`#1 via the forgot-password screen → ${confirmed ? 'confirmation shown' : 'no confirmation message'}`);

  // Requests #2..N through the API — the screen's Resend control is gated by a
  // ~60s cooldown each time, which would add minutes of waiting per role.
  for (let i = 2; i <= times; i += 1) {
    try {
      const r = await testApi.forgotPassword(s.email);
      outcomes.push(`#${i} via API → ${JSON.stringify(r).slice(0, 160)}`);
    } catch (err) {
      // Once the limit is reached the endpoint REJECTS the request — that
      // rejection is the lockout, not a failure of this step.
      const body = JSON.stringify(err.body || err.message || '').slice(0, 200);
      outcomes.push(`#${i} via API → rejected: ${body}`);
    }
    await this.page.waitForTimeout(1500);
  }

  s.lockedOutAt = Date.now();
  const status = await require('../support/accountHealer').detectStatus(s.email, s.password);
  outcomes.push(`login probe after ${times} requests → account reports "${status}"`);
  s.statusAfterLockout = status;

  await report(this, `${times} password-reset requests for ${s.email}`, outcomes);
});

Then('the account should report the {string} state to the backend', SLOW, async function (expected) {
  const s = state(this);
  const status = s.statusAfterLockout || (await require('../support/accountHealer').detectStatus(s.email, s.password));
  expect(status, `the login probe reports "${status}", not "${expected}"`).toBe(expected.toLowerCase());
});

// =========================================================================
// LIFECYCLE — Suspended → Pending (admin reactivation email)
// =========================================================================

When('I reactivate the new user from the Suspended sub-tab', SLOW, async function () {
  const s = state(this);
  await flow.loginAsAdmin(this);
  const admin = this.pages.adminUsers;
  await admin.openUsersPage();

  s.reactivatedAt = Date.now() - CLOCK_SKEW_MS;
  // Suspended tab → the user's row 3-dot → "Reactivate Account". Locating by
  // numeric User ID when known (the search box is User-ID-only), else by the
  // email text on the visible page.
  const toast = await admin.reactivateSuspendedUser({ userId: s.userId, email: s.email });
  s.reactivationToast = toast;

  await report(this, 'Reactivation requested from the Suspended sub-tab', [
    `User    : ${s.email}${s.userId ? ` (id ${s.userId})` : ''}`,
    `Action  : ⋮ → "Reactivate Account"`,
    `Toast   : ${toast || '(auto-dismissed before capture)'}`
  ]);
});

Then('a reactivation email should be sent to the new user', SLOW, async function () {
  const s = state(this);
  const mail = await emailHelper.waitForLatestEmail(s.email, {
    after: (s.reactivatedAt || Date.now()) - CLOCK_SKEW_MS,
    subjectMatch: RESET_EMAIL_SUBJECT,
    timeoutMs: EMAIL_WAIT_MS,
    pollIntervalMs: 3000
  });
  const link = emailHelper.extractResetLink(mail.body);
  expect(link, `no set-password link found in the "${mail.subject}" email`).toBeTruthy();
  s.resetLink = link;
  await report(this, 'Reactivation email received', [`Subject : ${mail.subject}`, `Link    : ${String(link).slice(0, 120)}…`]);
});

When('the new user sets a password from the reactivation email', SLOW, async function () {
  const s = state(this);
  expect(s.resetLink, 'no reset link was captured from the reactivation email').toBeTruthy();

  // The Create-New-Password screen only renders for a LOGGED-OUT session; with
  // the admin session still live the app bounces the link to /monitoring.
  await logout(this);
  await this.pages.createPassword.navigate(s.resetLink);
  await this.pages.createPassword.waitForLoaded();

  const fresh = pwStore.generatePassword();
  await this.pages.createPassword.resetPassword(fresh, fresh);

  const ok = await this.pages.createPassword.hasSuccessMessage(10000).catch(() => false);
  if (!ok) await this.page.waitForURL(/\/login/i, { timeout: 10000 }).catch(() => {});
  s.password = fresh;
  await report(this, 'Password set from the reactivation link', [`User : ${s.email}`, `Confirmation shown : ${ok}`]);
});

// =========================================================================
// PERMISSIONS — act as the new user
// =========================================================================

When('I log in as the newly created user', SLOW, async function () {
  const s = state(this);
  expect(s.email && s.password, 'the new user has no known password yet').toBeTruthy();

  await flow.freshLogin(this, s.email, s.password);
  await this.pages.login.expectNavigatedAwayFromLogin();
  // The URL changes a beat before the shell paints; wait for the sidebar to
  // mount, then decline the "set up MFA" nag that greets a new account (it
  // overlays the app and would eat every subsequent click).
  await this.pages.permissions.waitForShell();
  await this.pages.permissions.dismissMfaPrompt();
  // Fresh actor ⇒ drop every cached observation and teach the POM who is acting:
  // the email so it skips this user's own grid row (a user's own row never offers
  // "Mark as Inactive"), and the display name so "own notes" can be told from
  // other people's when checking own-only permissions.
  this.pages.permissions.reset(s.email, `${s.firstName} ${s.lastName}`);

  const sections = await this.pages.permissions.navSections();
  s.navSections = sections;
  await report(this, `Logged in as the new ${s.roleLabel} user`, [
    `Email    : ${s.email}`,
    `Sidebar  : ${sections.join(', ')}`
  ]);
});

Then('the sidebar should offer the sections permitted for {string}', SLOW, async function (role) {
  const s = state(this);
  const sections = s.navSections || (await this.pages.permissions.navSections());
  expect(sections.length, 'the sidebar rendered no navigation at all').toBeGreaterThan(0);

  // A section is expected iff the sheet grants this role at least one permission
  // that is actually reachable from it.
  const NAV_FOR_SECTION = {
    Clinics: 'Clinic Management',
    Patients: 'Patient Management',
    Reports: 'Reports',
    Invoices: 'Billing'
  };
  const lines = [];
  const failures = [];
  for (const [nav, section] of Object.entries(NAV_FOR_SECTION)) {
    const rows = matrix.rowsFor(section, role);
    const granted = rows.some((r) => matrix.isAllowed(r.expected));
    const present = sections.some((x) => new RegExp(`^${nav}$`, 'i').test(x));
    lines.push(`${present ? '✅' : '❌'} ${nav.padEnd(10)} — sheet grants ${section}: ${granted ? 'yes' : 'no'}`);
    if (granted && !present) failures.push(`"${nav}" is missing although the sheet grants ${section} permissions`);
    if (!granted && present) failures.push(`"${nav}" is offered although the sheet grants nothing in ${section}`);
  }
  await report(this, `Sidebar sections for ${matrix.roleLabel(role)}`, lines.concat([`Rendered: ${sections.join(', ')}`]));
  expect(failures, `sidebar does not match the RBAC sheet:\n  - ${failures.join('\n  - ')}`).toHaveLength(0);
});

Then('the {string} permissions for {string} should match the RBAC matrix', VERY_SLOW, async function (role, section) {
  const rows = matrix.rowsFor(section, role);
  expect(rows.length, `the RBAC sheet has no "${section}" section`).toBeGreaterThan(0);

  const pom = this.pages.permissions;
  const lines = [];
  const failures = [];
  let passed = 0;
  let notVerifiable = 0;

  for (const row of rows) {
    const observation = {};
    if (row.check && row.check.read) observation.read = await pom.observe(row.check.read);
    if (row.check && row.check.write) observation.write = await pom.observe(row.check.write);

    const verdict = matrix.verdictFor(row.expected, observation, row.check);
    const icon = verdict.status === 'pass' ? '✅' : verdict.status === 'pending' ? '⏳' : '❌';
    lines.push(`${icon} ${row.permission} [sheet: ${row.expected}]\n     ${verdict.message}`);

    if (verdict.status === 'pass') passed += 1;
    else if (verdict.status === 'pending') notVerifiable += 1;
    else failures.push(`${section} → ${row.permission} (sheet: "${row.expected}"): ${verdict.message}`);
  }

  await report(
    this,
    `RBAC — ${matrix.roleLabel(role)} · ${section}  (${passed} verified, ${failures.length} mismatched, ${notVerifiable} not verifiable)`,
    lines
  );

  // Mismatches are COLLECTED, not thrown here. A thrown assertion would abort the
  // scenario at the first offending section and skip every screen after it, so a
  // run would surface one defect at a time; the whole point of the sweep is to
  // report every mismatch the role has. The final step fails the scenario.
  const s = state(this);
  s.rbacFailures = (s.rbacFailures || []).concat(failures);
  s.rbacTotals = {
    passed: (s.rbacTotals?.passed || 0) + passed,
    notVerifiable: (s.rbacTotals?.notVerifiable || 0) + notVerifiable
  };
});

Then('the RBAC verification should report no permission mismatches', async function () {
  const s = state(this);
  const failures = s.rbacFailures || [];
  const totals = s.rbacTotals || { passed: 0, notVerifiable: 0 };
  await report(this, 'RBAC verification summary', [
    `Role            : ${s.roleLabel}`,
    `User            : ${s.email}`,
    `Verified        : ${totals.passed}`,
    `Mismatched      : ${failures.length}`,
    `Not verifiable  : ${totals.notVerifiable}`,
    ...(failures.length ? ['', 'Mismatches:', ...failures.map((f) => `  ❌ ${f}`)] : [])
  ]);
  expect(
    failures,
    `${s.roleLabel} deviates from the RBAC sheet in ${failures.length} place(s):\n  - ${failures.join('\n  - ')}`
  ).toHaveLength(0);
});

/**
 * Notes live in a drawer opened from an icon-only button in the patient header,
 * and the per-note Edit/Delete controls are icon-only too — so this step also
 * asserts the sweep left the notes alone (PermissionsPage identifies those
 * controls by opening and dismissing them; nothing may actually be deleted).
 */
Then('the Notes sweep should have left every note intact', SLOW, async function () {
  const result = await this.pages.permissions.noteActions('others');
  if (!result.found) return; // nothing was probed, nothing to protect
  expect(
    result.intact,
    'the Notes permission probe changed the note list — it must only open and dismiss ' +
    'the Edit/Delete controls, never confirm them'
  ).toBe(true);
});

// =========================================================================
// The generic Add-New-User steps used by the @adduser scenario in this feature.
// They are role-agnostic on purpose ("any available role"), which is why they
// live here rather than alongside the role-specific wizard steps in
// user.steps.js. State goes into `world.uu` so that file's assertion steps
// ("the user should be created successfully", "the new user should appear in the
// 'Pending' sub-tab", "the new user's email and role should be accurately
// displayed") work unchanged.
// =========================================================================

/** Roles the app generates at runtime are unstable choices for "any role". */
const SYNTHETIC_ROLE = /^(Automated Role|New role|.*custom role)/i;

When('I select any available role from the Role dropdown', SLOW, async function () {
  const s = state(this);
  const users = this.pages.users;
  // The Background step ("the 'Add New User' modal is open") may already have
  // opened the wizard — reopening it from scratch would discard that state.
  if (!(await users.isDialogOpen())) {
    await users.open();
    await users.openAddUser();
  }
  const options = await users.roleOptions();
  await users.dismissPopover();
  expect(options.length, 'the Role dropdown offered no roles').toBeGreaterThan(0);

  // Prefer a real product role over the throwaway roles other scenarios create,
  // and prefer one with no extra clinic step so "any role" stays quick.
  const preferred = ['Support Staff', 'Executive Admin', 'Billing Admin', 'Monitoring Admin'];
  const chosen =
    preferred.find((p) => options.some((o) => o.toLowerCase() === p.toLowerCase())) ||
    options.find((o) => !SYNTHETIC_ROLE.test(o)) ||
    options[0];

  s.roleLabel = chosen;
  s.roles = [chosen];
  await users.selectRoles(chosen);
  // Read the selection back off the wizard, not off the popover: selectRoles()
  // closes the portal, and UsersPage.selectedRoles() inspects the popover's
  // checkboxes — so it only answers while the picker is still open. Once chosen,
  // the role replaces the "Select A Role" placeholder with a chip on Step 1.
  const dialogText = await users.dialogText();
  expect(dialogText, `"${chosen}" was not selected in the Role dropdown`).toMatch(
    new RegExp(chosen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  );
});

Then('I should be on the next step based on the selected role', SLOW, async function () {
  const counter = await this.pages.users.stepCounter();
  expect(counter, 'the wizard is not showing a "Step N/M" counter').toBeTruthy();
  expect(counter.current, 'clicking Next should have advanced the wizard').toBeGreaterThan(1);
  // Step 2 is Basic Details for every role — clinic-scoped roles get a 3rd step.
  await this.pages.users.field('Enter First Name').waitFor({ state: 'visible', timeout: 15000 });
  state(this).stepTotal = counter.total;
});

When('I complete all required fields for the current step', SLOW, async function () {
  const s = state(this);
  const users = this.pages.users;
  s.email = s.email || flow.uniqueEmail(usersBase());
  s.firstName = s.firstName || 'Auto';
  s.lastName = s.lastName || 'QAUser';
  s.createdAfter = s.createdAfter || Date.now() - CLOCK_SKEW_MS;
  await users.fillBasicDetails({
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)'
  });
});

When('I continue through each step until the final step', SLOW, async function () {
  const s = state(this);
  const users = this.pages.users;
  const counter = await users.stepCounter();
  // Clinic-scoped roles (Nurse / Supervisor) add a Permissions step: advance and
  // satisfy whichever clinic control that step mounts.
  if (counter && counter.total > 2 && counter.current < counter.total) {
    await users.clickNext();
    s.clinics = [await users.selectFirstAvailableClinic()];
    if (await users.hasAllowProgramCreation()) {
      const value = await users.allowProgramCreationValue();
      if (!value) await users.selectAllowProgramCreation('No');
    }
  }
  const final = await users.stepCounter();
  expect(final.current, 'the wizard did not reach its final step').toBe(final.total);
});

Then('the new user should have the selected role', SLOW, async function () {
  const s = state(this);
  const row = s.row || (await this.pages.users.findRow('email', s.email));
  expect(row, `${s.email} is not listed`).toBeTruthy();
  expect(row.roles, `the row shows "${row.roles}", not the selected "${s.roleLabel}"`).toMatch(
    new RegExp(String(s.roleLabel).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  );
});

Then(
  'the {string} column should display the selected clinic or clinics, if applicable',
  SLOW,
  async function (_column) {
    const s = state(this);
    const row = s.row || (await this.pages.users.findRow('email', s.email));
    expect(row, `${s.email} is not listed`).toBeTruthy();
    const cell = row.associatedClinicsDisplay || '';
    if (!s.clinics || !s.clinics.length) {
      // A role with no clinic step must render the empty placeholder, not a clinic.
      expect(cell.trim(), `no clinic was selected, but the cell shows "${cell}"`).toMatch(/^(-|—|)$/);
      return;
    }
    for (const clinic of s.clinics) {
      expect(cell, `"${clinic}" is missing from the Associated Clinic cell ("${cell}")`).toMatch(
        new RegExp(String(clinic).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      );
    }
  }
);
