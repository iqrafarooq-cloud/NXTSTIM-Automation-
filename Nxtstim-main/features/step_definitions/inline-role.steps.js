/**
 * inline-role.steps.js — the "+ Create a new role" path that hangs off the
 * BOTTOM of the Add New User wizard's Role dropdown
 * (features/UserManagement/User.feature, @inline-role).
 *
 * Role.feature covers Create A Role from the Roles tab. This file covers the
 * other entry point, where the interesting behaviour is the HAND-BACK: does the
 * wizard survive the drawer, does the new role reach the dropdown, and does the
 * role's clinic scope drive the wizard's step count.
 *
 * Things worth knowing before editing:
 *
 *   1. While the drawer is open, MUI marks the wizard `aria-hidden`, so
 *      getByRole('dialog') stops matching it and UsersPage.isDialogOpen() /
 *      stepCounter() report it as gone. Every "is the wizard still there" read
 *      here goes through UsersPage.wizardSnapshot(), which reads the raw DOM.
 *
 *   2. The role popover stays OPEN underneath, both after Cancel and after
 *      Create Role. It has to be dismissed with UsersPage.closeAnyPopover()
 *      before the wizard is readable again — and never with a bare Escape,
 *      which with no popover mounted closes the whole wizard.
 *
 *   3. The dropdown does NOT refresh after a role is created from inside it
 *      (verified 2026-07-27: 23 options before, 23 after, 24 after a page
 *      reload). The scenario asserting the correct behaviour therefore carries
 *      @known-issue and is excluded from the default run.
 *
 *   4. Each run creates a real role. The After hook below deletes it again so
 *      the QA environment does not silt up; failure to clean up is logged, not
 *      thrown, so it can never mask the scenario's own result.
 */
const { When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

const SLOW = { timeout: 180000 };

/** Per-scenario scratch, kept apart from world.uu / world.ul. */
function s(world) {
  world.ir = world.ir || {};
  return world.ir;
}

/** A name unique per run, so reruns never collide on the duplicate-name rule. */
function newRoleName(world) {
  const state = s(world);
  if (!state.roleName) {
    state.roleName = `QA Inline Role ${String(Date.now()).slice(-6)}`;
    state.description = 'Created from the Add New User wizard by the automated suite';
  }
  return state.roleName;
}

// ---- The drawer, opened from inside the wizard ---------------------------

Then('the Create A Role drawer should require a role name and a description', async function () {
  const roles = this.pages.roles;
  expect(await roles.isCreateDrawerOpen(), 'the Create A Role drawer should be open').toBeTruthy();
  await expect(roles.roleNameField(), 'a Role Name input').toBeVisible();
  await expect(roles.descriptionField(), 'a Describe The Role input').toBeVisible();
  // Both captions carry the asterisk the app uses to mark a required field.
  const required = await roles.requiredFieldLabels();
  expect(required.join(' | '), 'Role Name should be marked required').toMatch(/Role Name\*/i);
  expect(required.join(' | '), 'Describe The Role should be marked required').toMatch(/Describe The Role\*/i);
});

Then('the {string} button in the drawer should be disabled', async function (label) {
  const enabled = await this.pages.roles.isCreateEnabled();
  expect(enabled, `Expected the drawer's "${label}" button to be disabled`).toBeFalsy();
});

Then('the {string} button in the drawer should be enabled', async function (label) {
  const enabled = await this.pages.roles.isCreateEnabled();
  expect(enabled, `Expected the drawer's "${label}" button to be enabled`).toBeTruthy();
});

Then('the clinic assignment toggle should be off', async function () {
  expect(await this.pages.roles.isClinicToggleOn(),
    '"Make clinic assignment part of this role" should default to off').toBeFalsy();
});

Then('no permission should be enabled by default', async function () {
  // The clinic toggle is the first switch in the drawer and is not a
  // permission, so a fresh form must show zero switches on.
  expect(await this.pages.roles.enabledPermissionCount(),
    'a brand-new role should start with every permission off').toBe(0);
});

Then('the Add New User wizard should still be open behind the drawer', async function () {
  const wizard = await this.pages.users.wizardSnapshot();
  expect(wizard.mounted, 'the wizard should still be mounted under the drawer').toBeTruthy();
  expect(wizard.painted, 'the wizard should still be painted under the drawer').toBeTruthy();
  expect(wizard.counter, 'the wizard should still advertise a step counter').not.toBeNull();
});

When('I fill in the new role name and description', SLOW, async function () {
  const state = s(this);
  await this.pages.roles.fillNewRole({
    name: newRoleName(this),
    description: state.description
  });
});

When('I enable the clinic assignment toggle', async function () {
  await this.pages.roles.setClinicToggle(true);
});

Then('the drawer should offer the clinic scopes {string} and {string}', async function (a, b) {
  const options = await this.pages.roles.clinicScopeOptions();
  expect(options, `clinic scopes offered: ${JSON.stringify(options)}`).toContain(a);
  expect(options, `clinic scopes offered: ${JSON.stringify(options)}`).toContain(b);
});

Then('{string} should be preselected as the clinic scope', async function (scope) {
  expect(await this.pages.roles.selectedClinicScope()).toBe(scope);
});

When('I choose the {string} clinic scope', async function (scope) {
  const state = s(this);
  state.clinicScope = scope;
  await this.pages.roles.chooseClinicScope(scope);
  expect(await this.pages.roles.selectedClinicScope(),
    `"${scope}" should be selected after clicking it`).toBe(scope);
});

// ---- Leaving the drawer ---------------------------------------------------

When('I cancel the Create A Role drawer', SLOW, async function () {
  await this.pages.roles.cancelDrawer();
  // The role popover is still open on top of the wizard; drop it so the
  // wizard is readable (and clickable) again.
  await this.pages.users.closeAnyPopover();
});

When('I submit the Create A Role drawer', SLOW, async function () {
  const roles = this.pages.roles;
  await roles.submitNewRole();
  s(this).created = true;
  s(this).toast = await roles.toastText();
  await this.pages.users.closeAnyPopover();
});

Then('the Create A Role drawer should be closed', async function () {
  expect(await this.pages.roles.isDrawerOpen(), 'the drawer should have closed').toBeFalsy();
});

Then('a success message {string} should confirm the role was created', async function (expected) {
  const toast = s(this).toast || (await this.pages.roles.toastText());
  expect(toast, `toast text was "${toast}"`).toMatch(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

Then('the Add New User wizard should still be on Step {int}', async function (step) {
  const wizard = await this.pages.users.wizardSnapshot();
  expect(wizard.painted, 'the wizard should still be open').toBeTruthy();
  expect(wizard.counter && wizard.counter.current,
    `wizard counter was ${JSON.stringify(wizard.counter)}`).toBe(step);
});

// ---- Does the wizard pick the new role up? --------------------------------

Then('the new role should be offered in the Role dropdown', SLOW, async function () {
  const users = this.pages.users;
  // Read the popover FRESH: the one left open behind the drawer still holds the
  // list as it was before the role existed.
  await users.closeAnyPopover();
  const options = await users.roleOptions();
  expect(options, `the dropdown offered ${options.length} roles, newest tail: ${JSON.stringify(options.slice(-4))}`)
    .toContain(newRoleName(this));
});

When('I reload the Users screen and reopen the Add New User wizard', SLOW, async function () {
  const users = this.pages.users;
  await users.closeAnyPopover();
  await users.open();
  await users.openAddUser();
});

When('I select the new role from the Role dropdown', SLOW, async function () {
  await this.pages.users.selectRoles(newRoleName(this));
});

// ---- The Roles tab as the source of truth ---------------------------------

Then('the new role should appear on the Roles tab', SLOW, async function () {
  await this.pages.roles.open();
  expect(await this.pages.roles.hasRole(newRoleName(this)),
    `"${newRoleName(this)}" should be listed on the Roles tab`).toBeTruthy();
});

Then('the new role should not exist on the Roles tab', SLOW, async function () {
  await this.pages.roles.open();
  expect(await this.pages.roles.hasRole(newRoleName(this)),
    `a cancelled drawer must not create "${newRoleName(this)}"`).toBeFalsy();
});

// ---- Cleanup --------------------------------------------------------------

/**
 * Delete the role the scenario created. Registered here rather than in
 * hooks.js so it stays next to the steps that create the thing; Cucumber runs
 * After hooks in reverse registration order, so this runs while the browser
 * context is still alive (hooks.js closes it).
 *
 * Best-effort by design: a cleanup failure is logged, never thrown, so it
 * cannot turn a passing scenario red or mask a failing one.
 */
After({ tags: '@inline-role', ...SLOW }, async function () {
  const state = this.ir;
  if (!state || !state.created || !state.roleName) return;
  try {
    await this.pages.users.closeAnyPopover();
    await this.pages.roles.open();
    const gone = await this.pages.roles.deleteRole(state.roleName);
    console.log(`[inline-role] cleanup: "${state.roleName}" ${gone ? 'deleted' : 'STILL PRESENT — delete it by hand'}`);
  } catch (err) {
    console.log(`[inline-role] cleanup failed for "${state.roleName}": ${err.message.split('\n')[0]}`);
  }
});
