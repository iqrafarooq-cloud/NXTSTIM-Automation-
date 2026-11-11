/**
 * user.steps.js — the whole User Management suite (features/UserManagement/User.feature).
 *
 * Covers NXT-1999 (navigation restructure, Users tab), NXT-2000 (the Add New
 * User wizard) AND the list toolbar (@UserList: Search By / Filters / Sort By /
 * Export CSV / row actions / the Create A Role drawer). Drives the live /users
 * screen through the UsersPage POM and reuses the existing provisioning/email
 * stack for the lifecycle scenarios:
 *   - inactiveUserFlow → admin login, unique aliases, id lookup, passwords.
 *   - emailHelper / testApi → set-first-password via the real invitation OTP.
 *
 * Things worth knowing before editing:
 *
 *   1. Admin session caching. The Background logs in for every scenario, and a
 *      real login costs an MFA email round-trip. The first successful login's
 *      storageState is cached in-process and replayed into each new browser
 *      context, falling back to a full login if the replay does not land.
 *
 *   2. `the {string} button should be disabled/enabled` is intentionally NOT
 *      defined here — inactive-user.steps.js already owns those and its
 *      implementation resolves the same live Next/Add User buttons. Redefining
 *      them would make Cucumber throw on ambiguous step definitions.
 *
 *   3. Search and sort persist SERVER-SIDE per admin account. The Background's
 *      "the users list state is reset" clears them, otherwise one scenario's
 *      "99999999" leaves the next one staring at "0 Users".
 *
 *   4. The grid is virtualised (only ~9 of 10 rows mount) and paged, so every
 *      order/export assertion runs against collectSortedIds()/collectAllRows()
 *      — the FULL list — rather than whatever happens to be on screen.
 *
 * Two independent per-scenario scratch objects are in play: `world.uu` (the
 * wizard/lifecycle steps, via `state()`) and `world.ul` (the toolbar steps, via
 * `s()`). They are deliberately kept apart.
 */
const { Given, When, Then, pending } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

const { UsersPage } = require('../pages/UsersPage');
const flow = require('../support/inactiveUserFlow');
const emailHelper = require('../support/emailHelper');
const testApi = require('../support/testApi');

const SLOW = { timeout: 180000 };
const USERS_BASE = () => process.env.USERS_EMAIL || 'users@iqra.anonaddy.com';

/** Per-scenario scratch for the user this scenario creates. */
function state(world) {
  world.uu = world.uu || {};
  return world.uu;
}

// ---- Admin session cache -------------------------------------------------

let adminStorageState = null;

async function restoreAdminSession(world) {
  if (!adminStorageState) return false;
  try {
    await world.context.addCookies(adminStorageState.cookies || []);
    const origin = world.pages.users.origin();
    await world.page.goto(`${origin}/users`, { waitUntil: 'domcontentloaded' });
    const stored = (adminStorageState.origins || []).find((o) => o.origin === origin);
    if (stored) {
      await world.page.evaluate((items) => {
        items.forEach(({ name, value }) => {
          try { localStorage.setItem(name, value); } catch { /* ignore */ }
        });
      }, stored.localStorage || []);
      await world.page.reload({ waitUntil: 'domcontentloaded' });
    }
    await world.pages.users.tab('Active').waitFor({ state: 'visible', timeout: 15000 });
    return true;
  } catch {
    adminStorageState = null;
    return false;
  }
}

async function loginAsAdmin(world) {
  if (await restoreAdminSession(world)) return;
  await flow.loginAsAdmin(world);
  adminStorageState = await world.context.storageState().catch(() => null);
}

/** Make sure we are sitting on a rendered /users grid. */
async function ensureUsersPage(world) {
  const users = world.pages.users;
  if (/\/users\/?$/.test(await users.currentPath()) && (await users.isTabVisible('Active'))) return;
  await users.open();
}

// ---- Test-data helpers ---------------------------------------------------

function newUserDetails(world, overrides = {}) {
  const s = state(world);
  s.email = s.email || flow.uniqueEmail(USERS_BASE());
  s.firstName = overrides.firstName || s.firstName || 'Auto';
  s.lastName = overrides.lastName || s.lastName || 'QAUser';
  s.createdAfter = s.createdAfter || Date.now() - 5000;
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)',
    ...overrides
  };
}

/** Locate the scenario's newly created user under a status sub-tab. */
async function findNewUser(world, tab) {
  const s = state(world);
  const users = world.pages.users;
  await ensureUsersPage(world);
  await users.openTab(tab);
  if (!s.userId) s.userId = await flow.lookupUserId(s.email).catch(() => null);
  // Narrow the grid to the one user we are after. Without a search the row can
  // simply be on another page — the id lookup is best-effort (the admin listing
  // endpoint 401s without a bearer token this suite does not hold), so fall
  // back to searching on the email, which always works.
  if (s.userId) await users.searchUserId(s.userId);
  else await users.searchInField('Email', s.email);
  let row = await users.findRow('email', s.email);
  if (!row) row = await users.findRow('username', `${s.firstName} ${s.lastName}`);
  if (row && !s.userId) s.userId = row.id;
  return row;
}

/** Walk the wizard to Step 2 for the given role, from wherever we are. */
async function openWizardToStep2(world, role) {
  const users = world.pages.users;
  // Shut whatever the previous block left open BEFORE probing the page. An open
  // wizard puts the grid behind `aria-hidden`, so getByRole('tab') stops
  // matching and ensureUsersPage() would answer with a full page reload.
  await users.closeAnyPopover();
  if (await users.isDialogOpen()) await users.closeDialog().catch(() => {});
  await ensureUsersPage(world);
  await users.openAddUser();
  await users.selectRoles(role);
  await users.clickNext();
  await users.field('Enter First Name').waitFor({ state: 'visible', timeout: 15000 });
}

// =========================================================================
// Authentication
// =========================================================================

Given('I am logged in as an {string} user', SLOW, async function (role) {
  if (!/^admin$/i.test(role)) {
    return pending(`"${role}" is not the Admin actor — use the "a <role> user" step`);
  }
  await loginAsAdmin(this);
});

Given('I am logged in as a {string} user', SLOW, async function (role) {
  const key = role.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const email = process.env[`TEST_${key}_EMAIL`];
  const password = process.env[`TEST_${key}_PASSWORD`];
  if (!email || !password) {
    return pending(
      `No credentials for the "${role}" actor. Set TEST_${key}_EMAIL and ` +
      `TEST_${key}_PASSWORD in .env to run this scenario.`
    );
  }
  await flow.freshLogin(this, email, password);
  await this.pages.login.expectNavigatedAwayFromLogin();
});

// =========================================================================
// NXT-1999 — sidebar navigation
// =========================================================================

When('I view the sidebar navigation', SLOW, async function () {
  await ensureUsersPage(this);
});

Then('I should see {string} as an independent top-level navigation item', async function (name) {
  expect(await this.pages.users.hasTopLevelNavItem(name),
    `"${name}" should be a top-level sidebar item`).toBeTruthy();
});

Then('the {string} dropdown grouping should not be present', async function (name) {
  expect(await this.pages.users.hasAccountsGrouping(),
    `the "${name}" grouping should have been removed from the sidebar`).toBeFalsy();
});

When('I click on the {string} top-level tab in the sidebar', SLOW, async function (tab) {
  await this.pages.users.openSidebarItem(tab);
});

Then('I should land on the {string} page', async function (path) {
  expect(await this.pages.users.currentPath()).toBe(path);
});

When('I navigate to the {string} tab', SLOW, async function (tab) {
  if (/users/i.test(tab)) return this.pages.users.open();
  await this.pages.users.openSidebarItem(tab);
});

Given('I am on the {string} tab', SLOW, async function (tab) {
  if (/users/i.test(tab)) return ensureUsersPage(this);
  await this.pages.users.openSidebarItem(tab);
});

Then('I should see the Users list page with {string} sub-tab selected', async function (sub) {
  expect(await this.pages.users.selectedTab()).toMatch(new RegExp(sub, 'i'));
});

// =========================================================================
// NXT-1999 — grid columns
// =========================================================================

Then('the Users table should display the following columns:', async function (table) {
  const expected = table.rawTable.slice(1).map(([c]) => c.trim());
  const actual = await this.pages.users.columnHeaders();
  for (const column of expected) {
    expect(actual.some((a) => a.toLowerCase() === column.toLowerCase()),
      `column "${column}" missing — grid shows: ${actual.join(', ')}`).toBeTruthy();
  }
});

/**
 * Column label (as written in Gherkin) -> the DataGrid `data-field` that
 * readRows() keys on. Lookup is normalised (lower-cased, spaces collapsed) so
 * the feature file can say "phone number" or "Phone Number" interchangeably.
 */
const GRID_FIELD_BY_LABEL = {
  'user id': 'id',
  username: 'username',
  'first name': 'firstName',
  'last name': 'lastName',
  roles: 'roles',
  email: 'email',
  'email address': 'email',
  'phone number': 'phoneNumber',
  'onboarding date': 'created_at',
  'associated clinic': 'associatedClinicsDisplay',
  'associated clinics': 'associatedClinicsDisplay'
};

const gridFieldFor = (label) =>
  GRID_FIELD_BY_LABEL[String(label).trim().toLowerCase().replace(/\s+/g, ' ')];

// Regex (not a Cucumber expression) so the step accepts any number of quoted
// column labels. The 9-column list in the feature would otherwise need nine
// {string} params, and adding a tenth column would silently undefine the step.
Then(/^every row should populate (.+)$/, async function (columnList) {
  const labels = [...columnList.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  expect(labels.length, `no quoted column labels found in: ${columnList}`).toBeGreaterThan(0);

  const unknown = labels.filter((l) => !gridFieldFor(l));
  expect(unknown, `unmapped column label(s) — add them to GRID_FIELD_BY_LABEL`).toEqual([]);

  const rows = await this.pages.users.readRows();
  expect(rows.length, 'the Active tab should list at least one user').toBeGreaterThan(0);
  for (const row of rows) {
    for (const label of labels) {
      const value = row[gridFieldFor(label)];
      expect(value, `row ${row.id} has an empty "${label}"`).toBeTruthy();
    }
  }
});

// =========================================================================
// NXT-1999 — status sub-tabs
// =========================================================================

Then('I should see the following sub-tabs:', async function (table) {
  const expected = table.rawTable.slice(1).map(([c]) => c.trim());
  const actual = await this.pages.users.tabNames();
  for (const tab of expected) {
    expect(actual.some((a) => a.toLowerCase() === tab.toLowerCase()),
      `sub-tab "${tab}" missing — found: ${actual.join(', ')}`).toBeTruthy();
  }
});

Then('the {string} sub-tab should be selected by default', async function (name) {
  expect(await this.pages.users.selectedTab()).toMatch(new RegExp(`^${name}$`, 'i'));
});

When('I click on the {string} sub-tab', SLOW, async function (name) {
  await this.pages.users.openTab(name);
});

Then('the {string} sub-tab should be highlighted as active', async function (name) {
  expect(await this.pages.users.selectedTab()).toMatch(new RegExp(`^${name}$`, 'i'));
});

Then('the table should either list users or show the empty state', async function () {
  const users = this.pages.users;
  const count = await users.rowCount();
  if (count > 0) return;
  expect(await users.emptyStateText(),
    'an empty sub-tab must render the grid empty state').toBeTruthy();
});

// =========================================================================
// NXT-1999 — filters
// =========================================================================

When('I open the Filters panel', SLOW, async function () {
  await this.pages.users.openFilters();
});

Then('I should see a {string} filter tab', async function (name) {
  await expect(this.pages.users.filterPopover()
    .getByRole('tab', { name: new RegExp(name, 'i') })).toBeVisible();
});

Then('I should see an {string} filter tab', async function (name) {
  await expect(this.pages.users.filterPopover()
    .getByRole('tab', { name: new RegExp(name, 'i') })).toBeVisible();
});

When('I apply the {string} filter with value {string}', SLOW, async function (tab, value) {
  await this.pages.users.applyFilter(tab, value);
});

Given('I have applied the {string} filter with value {string}', SLOW, async function (tab, value) {
  await ensureUsersPage(this);
  await this.pages.users.applyFilter(tab, value);
});

Then('the table should display only users with the {string} role', async function (role) {
  const rows = await this.pages.users.readRows();
  expect(rows.length, `no users returned for role "${role}"`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.roles, `row ${row.id} has roles "${row.roles}"`)
      .toMatch(new RegExp(role, 'i'));
  }
});

Then('the table should display only users associated with {string}', async function (clinic) {
  const rows = await this.pages.users.readRows();
  expect(rows.length, `no users returned for clinic "${clinic}"`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.associatedClinicsDisplay, `row ${row.id} shows "${row.associatedClinicsDisplay}"`)
      .toMatch(new RegExp(`${clinic}|All Clinics`, 'i'));
  }
});

Then(
  'the table should display only users who are {string} AND associated with {string}',
  async function (role, clinic) {
    const rows = await this.pages.users.readRows();
    expect(rows.length, `no users matched ${role} + ${clinic}`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roles).toMatch(new RegExp(role, 'i'));
      expect(row.associatedClinicsDisplay).toMatch(new RegExp(`${clinic}|All Clinics`, 'i'));
    }
  }
);

When('I deselect the {string} filter value {string}', SLOW, async function (tab, value) {
  await this.pages.users.clearFilter(tab, value);
});

Then('the table should display users with roles other than {string}', async function (role) {
  const rows = await this.pages.users.readRows();
  expect(rows.length, 'the unfiltered grid should list users').toBeGreaterThan(0);
  expect(rows.some((r) => !new RegExp(role, 'i').test(r.roles || '')),
    `every row is still "${role}" — the filter was not cleared`).toBeTruthy();
});

Then('the {string} filter should remain applied with value {string}', SLOW, async function (tab, value) {
  const users = this.pages.users;
  await users.openFilters();
  await users.openFilterTab(tab);
  const checked = await this.page.evaluate((wanted) => {
    const p = document.querySelector('.MuiPopover-paper.MuiMenu-paper');
    return [...p.querySelectorAll('label')]
      .filter((l) => l.querySelector('input[type="checkbox"]')?.checked)
      .map((l) => l.textContent.trim())
      .includes(wanted);
  }, value);
  await users.closeFilters();
  expect(checked, `"${value}" should still be ticked after switching sub-tabs`).toBeTruthy();
});

When('I search for the User ID {string}', SLOW, async function (id) {
  await this.pages.users.searchUserId(id);
});

Then('the table should display the empty state', async function () {
  const users = this.pages.users;
  const count = await users.rowCount();
  const overlay = await users.emptyStateText();
  await report(this, '🚫 EMPTY STATE expected', [
    `Search By field : ${await users.getSelectedSearchField()}`,
    `Query           : ${JSON.stringify(await users.searchBox.inputValue().catch(() => ''))}`,
    `Rows rendered   : ${count}`,
    `Total counter   : ${await users.getTotalCount().catch(() => null)}`,
    count === 0 && overlay ? `✓ no-data overlay shown: "${overlay}"` : '✗ the grid still shows rows',
    ...(count ? ['', ...formatUsers(await users.harvestVisibleRows())] : [])
  ]);
  expect(count).toBe(0);
  expect(overlay, 'the grid should render its no-data overlay').toBeTruthy();
});

// =========================================================================
// NXT-1999 — Associated Clinics column
// =========================================================================

Then(
  'the {string} column should show {string} for every user with role {string}',
  SLOW,
  async function (_column, expected, role) {
    const users = this.pages.users;
    await users.applyFilter('Roles', role);
    const rows = await users.readRows();
    if (!rows.length) return pending(`no "${role}" users exist in this environment`);
    for (const row of rows) {
      expect(row.associatedClinicsDisplay, `row ${row.id} (${row.roles})`).toBe(expected);
    }
  }
);

Then('the {string} column should show a real clinic name for every listed user', async function (_column) {
  const rows = await this.pages.users.readRows();
  expect(rows.length, 'expected at least one clinic-scoped user').toBeGreaterThan(0);
  for (const row of rows) {
    const value = row.associatedClinicsDisplay;
    expect(value, `row ${row.id} has no clinic`).toBeTruthy();
    expect(value, `row ${row.id} should name a clinic, got "${value}"`).not.toBe('-');
  }
});

// =========================================================================
// NXT-1999 — RBAC
// =========================================================================

Then('I should see users spanning more than one role', async function () {
  const rows = await this.pages.users.readRows();
  const roles = new Set(rows.map((r) => r.roles).filter(Boolean));
  expect(roles.size, `admin should see multiple roles, saw: ${[...roles].join(', ')}`)
    .toBeGreaterThan(1);
});

Then('I should see users spanning more than one clinic', async function () {
  const rows = await this.pages.users.readRows();
  const clinics = new Set(
    rows.map((r) => r.associatedClinicsDisplay).filter((c) => c && c !== '-')
  );
  expect(clinics.size, `admin should see multiple clinics, saw: ${[...clinics].join(', ')}`)
    .toBeGreaterThan(1);
});

Then('I should only see users the Nurse role is permitted to view', async function () {
  const rows = await this.pages.users.readRows();
  expect(rows.length, 'a scoped actor should still see their own permitted users')
    .toBeGreaterThan(0);
  expect(rows.every((r) => !/Executive Admin/i.test(r.roles || '')),
    'a Nurse actor should not see Executive Admin users').toBeTruthy();
});

Then('the {string} action should not be available for any user', SLOW, async function (action) {
  const users = this.pages.users;
  const rows = await users.readRows();
  if (!rows.length) return pending('no rows visible for this actor — nothing to assert');
  await users.openRowMenu(rows[0].id);
  const items = await users.rowMenuItems();
  await this.page.keyboard.press('Escape').catch(() => {});
  expect(items.some((i) => new RegExp(action, 'i').test(i)),
    `"${action}" should be hidden for this actor, menu had: ${items.join(', ')}`).toBeFalsy();
});

// =========================================================================
// NXT-2000 — opening the wizard
// =========================================================================

When('I click the {string} button', SLOW, async function (label) {
  const users = this.pages.users;
  if (/add new user/i.test(label)) return users.openAddUser();
  if (/^next$/i.test(label)) return users.clickNext();
  if (/^add user$/i.test(label)) {
    // The toast is captured as part of the click rather than in the following
    // Then: notistack auto-dismisses within a few seconds, and BOTH outcomes
    // are read from it afterwards — the success confirmation and the
    // duplicate-email rejection ("User with this email already exists or
    // deleted", the only place that error ever surfaces).
    await users.addUserButton().click();
    state(this).toast = await users.captureToast(9000);
    await this.page.waitForTimeout(1500);
    return;
  }
  return pending(`button "${label}" is not wired`);
});

Given('the {string} modal is open', SLOW, async function (label) {
  if (!/add new user/i.test(label)) return pending(`modal "${label}" is not wired`);
  await ensureUsersPage(this);
  await this.pages.users.openAddUser();
});

Then('a multi-step modal should open', async function () {
  await expect(this.pages.users.dialog()).toBeVisible();
  expect(await this.pages.users.stepCounter(),
    'the wizard header should carry a "Step N/M" counter').toBeTruthy();
});

Then('a step indicator should be displayed', async function () {
  const names = await this.pages.users.indicatorStepNames();
  expect(names).toContain('Role Selection');
  expect(names).toContain('Basic Details');
});

Then('Step {int} {string} should be the active step', async function (index, name) {
  const counter = await this.pages.users.stepCounter();
  expect(counter.current).toBe(index);
  await expect(this.pages.users.dialog().getByText(new RegExp(name, 'i')).first()).toBeVisible();
});

Then('the step indicator should show each step with its name and description', async function () {
  const text = await this.pages.users.dialogText();
  expect(text).toMatch(/Role Selection/i);
  expect(text).toMatch(/Select the users role to determine the permissions/i);
  expect(text).toMatch(/Basic Details/i);
  expect(text).toMatch(/Enter user's personal information/i);
});

// =========================================================================
// NXT-2000 — Step 1: role selection
// =========================================================================

When('I click on the {string} dropdown', SLOW, async function (name) {
  if (/^role$/i.test(name)) return this.pages.users.openRoleDropdown();
  if (/allow program creation/i.test(name)) {
    state(this).apcOptions = await this.pages.users.allowProgramCreationOptions();
    return;
  }
  return pending(`dropdown "${name}" is not wired`);
});

Then('I should see all available system roles in the dropdown list', async function () {
  const options = await this.pages.users.roleOptions();
  expect(options.length, 'the role picker should list the system roles').toBeGreaterThan(1);
  // Anchor on roles the live build is known to expose.
  for (const role of ['Nurse', 'Executive Admin', 'Support Staff']) {
    expect(options, `"${role}" missing from: ${options.join(', ')}`).toContain(role);
  }
});

Then('I should see a {string} option at the bottom of the list', async function (label) {
  expect(await this.pages.users.hasCreateNewRoleOption(),
    `"${label}" should be offered in the role picker footer`).toBeTruthy();
  await this.pages.users.dismissPopover();
});

Given('the {string} button is disabled', async function (label) {
  expect(await this.pages.users.isActionEnabled(),
    `the "${label}" button should start out disabled`).toBeFalsy();
});

Then('the {string} button should become enabled', async function (label) {
  await expect(this.pages.users.actionButton(),
    `the "${label}" button should be enabled once a role is chosen`).toBeEnabled();
});

When('I select {string} from the Role dropdown', SLOW, async function (role) {
  state(this).roles = [role];
  await this.pages.users.selectRoles(role);
});

Given('I have selected {string} from the Role dropdown', SLOW, async function (role) {
  state(this).roles = [role];
  await this.pages.users.selectRoles(role);
});

When('I also select {string} from the Role dropdown', SLOW, async function (role) {
  state(this).roles = (state(this).roles || []).concat(role);
  await this.pages.users.selectRoles(role);
});

Then('both {string} and {string} should be shown as the selected roles', async function (a, b) {
  const text = await this.pages.users.dialogText();
  expect(text, `Step 1 should show "${a}"`).toMatch(new RegExp(a, 'i'));
  expect(text, `Step 1 should show "${b}"`).toMatch(new RegExp(b, 'i'));
});

Then('the step indicator should display {int} steps total', async function (count) {
  const counter = await this.pages.users.stepCounter();
  expect(counter.total, `the wizard advertised "Step ${counter.current}/${counter.total}"`)
    .toBe(count);
  expect((await this.pages.users.indicatorStepNames()).length).toBe(count);
});

Then('the {string} step should be visible', async function (name) {
  expect(await this.pages.users.indicatorStepNames()).toContain(name);
});

Then('the {string} step should not be visible', async function (name) {
  expect(await this.pages.users.indicatorStepNames()).not.toContain(name);
});

When('I select the {string} option', SLOW, async function (label) {
  if (!/create a new role/i.test(label)) return pending(`option "${label}" is not wired`);
  await this.pages.users.clickCreateNewRole();
});

Then('the {string} form should open', async function (title) {
  expect(await this.pages.users.isCreateRoleDrawerOpen(),
    `the "${title}" form should have opened`).toBeTruthy();
});

When('I deselect {string} and select {string} from the Role dropdown', SLOW, async function (off, on) {
  const users = this.pages.users;
  await users.selectRoles(off); // toggling a ticked role unticks it
  await users.selectRoles(on);
  state(this).roles = [on];
});

Then('I should be on Step {int} {string}', SLOW, async function (index, name) {
  const counter = await this.pages.users.stepCounter();
  expect(counter.current, `expected Step ${index}, wizard says ${counter.current}`).toBe(index);
  if (/basic details/i.test(name)) {
    await expect(this.pages.users.field('Enter First Name')).toBeVisible();
  }
  if (/permissions/i.test(name)) {
    expect(await this.pages.users.dialogText()).toMatch(/Clinics?\*/i);
  }
});

Then('Step {int} should show a completed status in the indicator', async function (index) {
  const states = await this.pages.users.stepStates();
  const step = states.find((s) => s.index === index);
  expect(step.completed, `Step ${index} ("${step.name}") should be marked complete`).toBeTruthy();
});

Then('Step {string} should be marked completed', async function (name) {
  const step = (await this.pages.users.stepStates()).find((s) => s.name === name);
  expect(step, `step "${name}" is not in the indicator`).toBeTruthy();
  expect(step.completed, `"${name}" should be marked complete`).toBeTruthy();
});

Then('Step {string} should not be marked completed', async function (name) {
  const step = (await this.pages.users.stepStates()).find((s) => s.name === name);
  expect(step, `step "${name}" is not in the indicator`).toBeTruthy();
  expect(step.completed, `"${name}" is the current step and should not be complete`).toBeFalsy();
});

// =========================================================================
// NXT-2000 — Step 2: basic details
// =========================================================================

Given('I am on Step {int} {string} for the {string} role', SLOW, async function (index, _name, role) {
  state(this).roles = [role];
  await openWizardToStep2(this, role);
  if (index === 3) {
    await this.pages.users.fillBasicDetails(newUserDetails(this));
    await this.pages.users.clickNext();
    const counter = await this.pages.users.stepCounter();
    expect(counter.current, `"${role}" did not reach Step 3`).toBe(3);
  }
});

Then('I should see the following required fields:', async function (table) {
  const expected = table.rawTable.slice(1).map(([f]) => f.trim());
  const text = await this.pages.users.dialogText();
  for (const field of expected) {
    expect(text, `"${field}" should be present and marked required`)
      .toMatch(new RegExp(`${field}\\s*\\*`, 'i'));
  }
});

// Cucumber checks the handler's arity against the expression's placeholders at
// EXECUTION time (a --dry-run never exercises it), so every {string} must be
// named in the signature even when the body ignores it.
Then('the {string} field should include a country code selector', async function (_field) {
  expect(await this.pages.users.hasPhoneCountrySelector(),
    'the phone field should expose a country-code selector').toBeTruthy();
});

// Registered once only — Cucumber matches on step TEXT, so a Given/When pair
// with the same phrasing is an ambiguous-definition error, not an overload.
When('I fill in valid basic details', SLOW, async function () {
  await this.pages.users.fillBasicDetails(newUserDetails(this));
});

Then('clicking {string} should proceed to Step {int} {string}', SLOW, async function (_label, index, _name) {
  await this.pages.users.clickNext();
  expect((await this.pages.users.stepCounter()).current).toBe(index);
});

Then('the action button should display {string}', async function (label) {
  expect(await this.pages.users.actionButtonLabel()).toMatch(new RegExp(`^${label}$`, 'i'));
});

When('I fill in all required fields except {string}', SLOW, async function (field) {
  const users = this.pages.users;
  await users.fillBasicDetails(newUserDetails(this));
  const clear = {
    'First Name': () => users.field('Enter First Name').fill(''),
    'Last Name': () => users.field('Enter Last Name').fill(''),
    'Email Address': () => users.field('Enter Email Address').fill(''),
    'Phone Number': () => users.field('Enter Phone Number').fill(''),
    Gender: () => users.field('Select Gender').fill(''),
    Language: () => users.field('Select Language').fill('')
  }[field];
  expect(clear, `no way to clear "${field}"`).toBeTruthy();
  await clear();
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(800);
});

When('I attempt to proceed', SLOW, async function () {
  const users = this.pages.users;
  // A disabled action button IS the validation feedback for this app; clicking
  // it would just time out, so only click when it is actually actionable.
  if (await users.isActionEnabled()) {
    await users.actionButton().click();
    await this.page.waitForTimeout(2000);
  }
});

Then('I should see a validation error for the {string} field', async function (field) {
  expect(await this.pages.users.hasValidationFor(field),
    `expected inline validation for "${field}" or a blocked action button`).toBeTruthy();
});

Then('I should remain on Step {int}', async function (index) {
  expect(await this.pages.users.isDialogOpen(), 'the wizard should still be open').toBeTruthy();
  expect((await this.pages.users.stepCounter()).current).toBe(index);
});

When('I enter {string} in the Email Address field', SLOW, async function (value) {
  await this.pages.users.field('Enter Email Address').fill(value);
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(800);
});

Then('I should see a validation error indicating invalid email format', async function () {
  expect(await this.pages.users.hasValidationFor('email'),
    'an invalid email should be rejected inline or block the action button').toBeTruthy();
});

When('I enter an email address that already exists', SLOW, async function () {
  const existing = process.env.BASE_EMAIL || 'adminuser+2@iqra.anonaddy.com';
  state(this).duplicateEmail = existing;
  await this.pages.users.field('Enter Email Address').fill(existing);
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(800);
});

Then('the user should not be created', SLOW, async function () {
  const users = this.pages.users;
  if (await users.isActionEnabled()) {
    await users.actionButton().click();
    await this.page.waitForTimeout(2500);
  }
  const stillOpen = await users.isDialogOpen();
  const messages = stillOpen ? await users.validationMessages() : [];
  const toast = await users.captureToast(3000);
  expect(stillOpen || /exist|duplicate|already/i.test(toast) || messages.length > 0,
    `a duplicate email should be rejected (toast: "${toast}")`).toBeTruthy();
});

Then('the email should be accepted as valid', async function () {
  const messages = await this.pages.users.validationMessages();
  expect(messages.filter((m) => /email/i.test(m)),
    `email was rejected: ${messages.join(' | ')}`).toHaveLength(0);
});

When('I enter {string} in the First Name field', SLOW, async function (value) {
  await this.pages.users.field('Enter First Name').fill(value);
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(600);
});

When('I enter {string} in the Last Name field', SLOW, async function (value) {
  await this.pages.users.field('Enter Last Name').fill(value);
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(600);
});

Then('the names should be accepted as valid', async function () {
  const messages = await this.pages.users.validationMessages();
  expect(messages.filter((m) => /name/i.test(m)),
    `names were rejected: ${messages.join(' | ')}`).toHaveLength(0);
});

When('I enter a name with {int} characters in the First Name field', SLOW, async function (n) {
  await this.pages.users.field('Enter First Name').fill('A'.repeat(n));
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(800);
});

Then('the form should either accept it or show a maximum length validation error', async function () {
  const users = this.pages.users;
  const messages = await users.validationMessages();
  const value = await users.fieldValue('Enter First Name');
  expect(messages.some((m) => /max|length|character/i.test(m)) || value.length > 0,
    'the field should either hold the value or explain the length limit').toBeTruthy();
});

Then('the modal should still be usable', async function () {
  expect(await this.pages.users.isDialogOpen(), 'the wizard must not have crashed').toBeTruthy();
  expect(await this.pages.users.stepCounter()).toBeTruthy();
});

// =========================================================================
// NXT-2000 — Step 3: permissions
// =========================================================================

Then('I should see the {string} field', async function (label) {
  expect(await this.pages.users.dialogText())
    .toMatch(new RegExp(`${label}\\s*\\*`, 'i'));
});

Then('the {string} field should allow selecting more than one clinic', SLOW, async function (_field) {
  expect(await this.pages.users.isClinicMultiSelect(),
    'Supervisor Step 3 should offer a multi-select clinic picker').toBeTruthy();
});

Then('I should see the options {string} and {string}', async function (a, b) {
  const options = state(this).apcOptions || (await this.pages.users.allowProgramCreationOptions());
  expect(options).toContain(a);
  expect(options).toContain(b);
});

Then('the {string} field should not be present', async function (label) {
  if (/allow program creation/i.test(label)) {
    expect(await this.pages.users.hasAllowProgramCreation(),
      'Nurse Step 3 should not offer Allow Program Creation').toBeFalsy();
    return;
  }
  expect(await this.pages.users.dialogText()).not.toMatch(new RegExp(label, 'i'));
});

When('I select {string} as the clinic', SLOW, async function (clinic) {
  state(this).clinics = [clinic];
  await this.pages.users.selectClinics(clinic);
});

When('I select the clinics {string}, {string} and {string}', SLOW, async function (a, b, c) {
  state(this).clinics = [a, b, c];
  await this.pages.users.selectClinics([a, b, c]);
});

When('I select {string} from the {string} dropdown', SLOW, async function (value, field) {
  if (!/allow program creation/i.test(field)) return pending(`dropdown "${field}" is not wired`);
  await this.pages.users.selectAllowProgramCreation(value);
});

/**
 * Step 3's "Allow Program Creation" is not an empty required field — the live
 * build hands it over already answered. Asserting the default explicitly is what
 * justifies the sibling expectation that "Add User" unlocks on the clinic alone.
 */
Then('the {string} dropdown should default to {string}', SLOW, async function (field, expected) {
  if (!/allow program creation/i.test(field)) return pending(`dropdown "${field}" is not wired`);
  const actual = await this.pages.users.allowProgramCreationValue();
  expect(actual, `"${field}" should arrive pre-filled with "${expected}"`)
    .toMatch(new RegExp(`^${expected}$`, 'i'));
});

// =========================================================================
// NXT-2000 — closing the modal
// =========================================================================

When('I click the {string} close icon on the modal', SLOW, async function (_icon) {
  await this.pages.users.closeDialog();
});

Then('the modal should close', async function () {
  await expect(this.pages.users.dialog()).toBeHidden({ timeout: 10000 });
});

Then('a fresh modal should open on Step 1', async function () {
  const counter = await this.pages.users.stepCounter();
  expect(counter.current, 'a reopened wizard should start at Step 1').toBe(1);
});

Then('no pre-filled data should be present from the previous attempt', async function () {
  const text = await this.pages.users.dialogText();
  expect(text, 'the role field should be back to its placeholder')
    .toMatch(/Select A Role/i);
});

Then('the user should not have been created', SLOW, async function () {
  const s = state(this);
  if (!s.email) return;
  const id = await flow.lookupUserId(s.email).catch(() => null);
  expect(id, `${s.email} should not exist after cancelling`).toBeFalsy();
});

// =========================================================================
// NXT-2000 / E2E — creation outcomes
// =========================================================================

/**
 * Creation actually SUCCEEDED — the wizard closed and the account now exists.
 * The toast is captured here (it auto-dismisses within a few seconds) so the
 * "a success message should confirm the user was added" step can assert on it
 * afterwards without racing the notistack timeout.
 */
Then('the user should be created successfully', SLOW, async function () {
  const s = state(this);
  const users = this.pages.users;
  await this.page.waitForTimeout(1500);
  if (s.toast === undefined) s.toast = await users.captureToast(4000);

  const inlineErrors = (await users.isDialogOpen()) ? await users.validationMessages() : [];
  expect(
    inlineErrors,
    `the wizard is still showing errors: ${inlineErrors.join(' | ')}`
  ).toHaveLength(0);
  expect(
    /error|failed|exist|invalid/i.test(s.toast || ''),
    `creation reported a failure: "${s.toast}"`
  ).toBe(false);

  // Prove the account really landed. The admin listing endpoint needs a bearer
  // token this suite does not hold (it 401s), so an id lookup alone is not
  // evidence of anything — fall back to the Pending grid, which is where a
  // freshly created user always appears.
  s.userId = await flow.lookupUserId(s.email).catch(() => null);
  if (!s.userId) {
    const row = await findNewUser(this, 'Pending');
    if (row) {
      s.row = row;
      s.userId = row.id;
    }
  }
  expect(
    s.userId,
    `${s.email} does not exist after submitting the wizard (toast: "${s.toast}")`
  ).toBeTruthy();
});

/** The explicit "user added" confirmation NXT-2000 expects on submission. */
Then('a success message should confirm the user was added', SLOW, async function () {
  const s = state(this);
  const toast = s.toast !== undefined ? s.toast : await this.pages.users.captureToast();
  expect(
    /success|added|created/i.test(toast || ''),
    `expected an "added successfully" confirmation, got: "${toast}"`
  ).toBe(true);
});

/** The same, for the Create A Role drawer. */
Then('a success message should confirm the role was created', SLOW, async function () {
  const toast = s(this).lastToast !== undefined ? s(this).lastToast : await this.pages.users.captureToast();
  expect(
    /success|created|added/i.test(toast || ''),
    `expected a "role created successfully" confirmation, got: "${toast}"`
  ).toBe(true);
});

Then('the new user should appear in the {string} sub-tab', SLOW, async function (tab) {
  const row = await findNewUser(this, tab);
  expect(row, `${state(this).email} should be listed under "${tab}"`).toBeTruthy();
  state(this).row = row;
});

Then('the new user should have the role {string}', async function (role) {
  const row = state(this).row || (await findNewUser(this, 'Pending'));
  expect(row.roles).toMatch(new RegExp(role, 'i'));
});

Then('the {string} column for the new user should display {string}', SLOW, async function (_col, expected) {
  const row = state(this).row || (await findNewUser(this, 'Pending'));
  expect(row.associatedClinicsDisplay).toBe(expected);
});

Then('the {string} column for the new user should display the selected clinics', SLOW, async function (_col) {
  const row = state(this).row || (await findNewUser(this, 'Pending'));
  for (const clinic of state(this).clinics || []) {
    expect(row.associatedClinicsDisplay, `"${clinic}" missing from the clinics cell`)
      .toMatch(new RegExp(clinic, 'i'));
  }
});

Then("the new user's email and role should be accurately displayed", SLOW, async function () {
  const s = state(this);
  const row = s.row || (await findNewUser(this, 'Pending'));
  expect(row.email.toLowerCase()).toBe(s.email.toLowerCase());
  expect(row.roles).toMatch(new RegExp((s.roles || ['Support Staff'])[0], 'i'));
});

Then('the new user should be present in the filtered results', SLOW, async function () {
  const s = state(this);
  const row = await this.pages.users.findRow('email', s.email);
  expect(row, `${s.email} should survive the Roles filter`).toBeTruthy();
});

Given('I have added a new {string} user via the Add New User flow', SLOW, async function (role) {
  state(this).roles = [role];
  await ensureUsersPage(this);
  await this.pages.users.createUser({ roles: role, ...newUserDetails(this) });
  state(this).userId = await flow.lookupUserId(state(this).email).catch(() => null);
});

Given(
  'I have added a new {string} user associated with {string} via the Add New User flow',
  SLOW,
  async function (role, clinic) {
    const s = state(this);
    s.roles = [role];
    s.clinics = [clinic];
    await ensureUsersPage(this);
    await this.pages.users.createUser({ roles: role, clinics: [clinic], ...newUserDetails(this) });
    s.userId = await flow.lookupUserId(s.email).catch(() => null);
  }
);

// =========================================================================
// E2E lifecycle — invitation email → Active → details → Inactive
// =========================================================================

Then('a set-password email should be sent to the new user', SLOW, async function () {
  const s = state(this);
  const res = await emailHelper.getActionableFromEmail(s.email, 'otp', {
    after: s.createdAfter,
    timeoutMs: 120000,
    pollIntervalMs: 3000
  });
  expect(res.value, 'the invitation email should carry an OTP').toBeTruthy();
  s.otp = res.value;
});

When('the user completes the password setup', SLOW, async function () {
  const s = state(this);
  s.password = flow.generatePassword();
  let otp = s.otp;
  if (!otp) {
    const res = await emailHelper.getActionableFromEmail(s.email, 'otp', {
      after: s.createdAfter,
      timeoutMs: 120000,
      pollIntervalMs: 3000
    });
    otp = res.value;
  }
  const r = await testApi.setFirstLoginPassword({ email: s.email, otp, password: s.password });
  expect(r && (r.success || /success/i.test(JSON.stringify(r))),
    'set-first-password should succeed').toBeTruthy();
});

Then('the user should move from Pending to Active', SLOW, async function () {
  expect(await findNewUser(this, 'Active'), 'the activated user should be Active').toBeTruthy();
  expect(await findNewUser(this, 'Pending'), 'the user should have left Pending').toBeFalsy();
});

When('I open the details of the new user', SLOW, async function () {
  const s = state(this);
  await ensureUsersPage(this);
  await this.pages.users.openTab('Active');
  if (!s.userId) s.userId = await this.pages.users.resolveUserId(s.email);
  expect(s.userId, `could not resolve the id for ${s.email}`).toBeTruthy();
  await this.pages.users.openUserDetails(s.userId);
});

Then('the user details should be displayed', async function () {
  expect(await this.pages.users.isUserDetailsOpen(state(this).userId),
    'the user detail view should be open').toBeTruthy();
});

When('I mark the new user as Inactive', SLOW, async function () {
  const s = state(this);
  await ensureUsersPage(this);
  await this.pages.users.openTab('Active');
  if (!s.userId) s.userId = await this.pages.users.resolveUserId(s.email);
  await this.pages.users.markUserInactive(s.userId);
});

// =========================================================================
// USERS LIST TOOLBAR — Search By / Filters / Sort By / Export CSV /
// row actions / Create A Role drawer (@UserList scenarios)
// =========================================================================

/** Per-scenario scratch, separate from user.steps.js's own `world.uu`. */
function s(world) {
  world.ul = world.ul || {};
  return world.ul;
}

async function usersPage(world) {
  const users = world.pages.users;
  if (!/\/users\/?$/.test(await users.currentPath())) await users.open();
  return users;
}

/**
 * A distinctive, non-empty reference row from the current unfiltered grid.
 *
 * Cached per scenario. The multi-sub-tab sweep clears the cache as it moves from
 * one sub-tab to the next, so each sub-tab is searched with a row of its own.
 */
async function pickReference(world) {
  const st = s(world);
  if (st.ref) return st.ref;
  const users = await usersPage(world);
  // The grid can still be refetching — the Background reset clears a term that
  // persisted server-side, and the rows land a beat later. Give it a few settles
  // before declaring the sub-tab empty, so a slow refetch is not read as no data.
  let rows = await users.readRows();
  for (let i = 0; i < 4 && !rows.length; i++) {
    await users.waitForListSettle();
    rows = await users.readRows();
  }
  if (!rows.length) {
    // Attached before the assertion: an empty grid here is almost always list
    // state that persisted SERVER-SIDE for the admin account (a leftover term or
    // an applied filter), so the report has to name what was actually on screen.
    await report(world, '🚫 NO ROWS TO PICK A REFERENCE FROM', [
      `Sub-tab         : ${await users.selectedTab().catch(() => '—')}`,
      `Search By field : ${await users.getSelectedSearchField().catch(() => '—')}`,
      `Search box      : ${JSON.stringify(await users.searchBox.inputValue().catch(() => null))}`,
      `"Clear All"     : ${(await users.hasClearAll().catch(() => false))
        ? 'VISIBLE — a filter is still applied'
        : 'not shown — no filter applied'}`,
      `Total counter   : ${await users.getTotalCount().catch(() => null)}`,
      `Empty state     : "${await users.emptyStateText().catch(() => '')}"`,
      `URL             : ${await users.getCurrentUrl().catch(() => '—')}`
    ]);
  }
  expect(rows.length, 'the current sub-tab must hold at least one user').toBeGreaterThan(0);
  // Prefer a row whose every searchable cell carries a real value, so the
  // field-scoped searches below have something to match on.
  const complete = rows.find(
    (r) => r.id && r.username && r.firstName && r.lastName && r.email && /\d/.test(r.phoneNumber || '')
  );
  st.ref = complete || rows[0];
  return st.ref;
}

/** The value the reference user holds for a Search By field label. */
function refValue(ref, field) {
  return String(ref[UsersPage.FIELD_KEY[field]] || '').trim();
}

/**
 * The query used to look a reference row up by its OWN value.
 *
 * The COMPLETE cell value is searched — "Support Staff", not the longest token
 * "Support". Searching a fragment proved only that substring matching works; it
 * never proved the full value a user actually reads off the row finds that row.
 * The deliberately partial cases (UPPERCASE / fragment / padded) build their own
 * terms and are unaffected.
 *
 * Phone numbers are the one exception: they render as "+1 (155) 512-3456" but
 * the backend matches on digits, so the longest digit run is used.
 */
function searchTermFor(field, value) {
  if (field === 'Phone Number') {
    return (String(value).match(/\d{3,}/g) || []).sort((a, b) => b.length - a.length)[0] || value;
  }
  return String(value == null ? '' : value).trim();
}

function isAscending(list) {
  return list.every((v, i) => i === 0 || v >= list[i - 1]);
}

function isDescending(list) {
  return list.every((v, i) => i === 0 || v <= list[i - 1]);
}

/** "07-25-2026" → sortable "2026-07-25". */
function dateKey(text) {
  const m = String(text).match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : String(text);
}

async function hasAppError(world) {
  const text = (await world.page.locator('body').innerText().catch(() => '')) || '';
  return /something went wrong|unexpected error|application error|failed to fetch/i.test(text);
}

// =========================================================================
// Report attachments — "show me the records you searched"
//
// Same contract as clinics.steps.js: every search step attaches a titled
// plain-text block naming the Search By field, the exact query, the backend's
// total and the ROWS THEMSELVES, so the HTML report proves what the search
// returned instead of just saying the assertion passed.
// =========================================================================

/** Attaches a titled, plain-text block to the current step in the report. */
async function report(world, title, lines) {
  const body = [title, '─'.repeat(Math.max(title.length, 28)), ...lines].join('\n');
  await world.attach(body, 'text/plain');
}

function truncate(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Renders grid rows as report lines: id · username · email · phone · date. */
function formatUsers(rows, limit = 15) {
  if (!rows || !rows.length) return ['  (no users displayed — empty state)'];
  const lines = rows
    .slice(0, limit)
    .map(
      (r) =>
        `  • ${String(r.id || '?').padEnd(7)} ${truncate(r.username, 26).padEnd(27)} ` +
        `${truncate(r.email, 34).padEnd(35)} ${String(r.phoneNumber || '—').padEnd(18)} ${r.created_at || '—'}`
    );
  if (rows.length > limit) lines.push(`  … and ${rows.length - limit} more row(s) on this page`);
  return lines;
}

/**
 * Snapshots the applied search and attaches it to the report. Returns the
 * snapshot so the calling step can keep asserting on it.
 */
async function reportSearch(world, title, extra = []) {
  const snap = await world.pages.users.searchSnapshot();
  const tab = await world.pages.users.selectedTab().catch(() => null);
  await report(world, title, [
    `Sub-tab         : ${tab || '—'}`,
    `Search By field : ${snap.field || '—'}`,
    `Query           : ${JSON.stringify(snap.term)}`,
    `Records found   : ${snap.total == null ? snap.rows.length : snap.total}` +
      ` (showing ${snap.rows.length} on this page)`,
    ...(snap.empty ? [`Empty state     : "${snap.emptyState}"`] : []),
    ...extra,
    '',
    ...formatUsers(snap.rows)
  ]);
  s(world).lastSnapshot = snap;
  return snap;
}

/**
 * Does `rowValue` satisfy a search for `term` under `field`?
 *
 * Phone numbers render as "+1 (155) 512-3456" but are searched as digits, so
 * punctuation is stripped from both sides.
 *
 * Onboarding Date is matched EXACTLY on the date the row displays — no ±1 day
 * window. A search for "07-25-2026" that comes back holding a row displaying
 * "07-26-2026" is a wrong result, not a tolerable local-vs-UTC artifact, and the
 * suite now says so. (Substring queries such as "2026" or "07-2026" still match,
 * which is the documented behaviour of this field.)
 */
function rowMatchesSearch(field, rowValue, term) {
  const value = String(rowValue == null ? '' : rowValue);
  const needle = String(term == null ? '' : term).trim();
  if (field === 'Onboarding Date') return value.toLowerCase().includes(needle.toLowerCase());
  const strip = (t) => t.toLowerCase().replace(/[\s()+-]/g, '');
  return strip(value).includes(strip(needle));
}

// =========================================================================
// Background / shared
// =========================================================================

Given('the users list state is reset', SLOW, async function () {
  const users = await usersPage(this);
  await users.resetListState();
  await users.waitForListSettle();
});

Then('no application error should be shown', async function () {
  expect(await hasAppError(this), 'an application error surfaced').toBe(false);
});

Then('a success message should be displayed', async function () {
  const toast = s(this).lastToast !== undefined ? s(this).lastToast : await this.pages.users.captureToast();
  expect(
    /success|created|updated|inactive|added/i.test(toast || ''),
    `expected a success toast, got: "${toast}"`
  ).toBe(true);
});

When('I click {string}', async function (label) {
  await this.pages.users.dismissAnyMenu();
  await this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await this.pages.users.waitForListSettle();
});

// =========================================================================
// Search By
// =========================================================================

When('I open the Search By dropdown', async function () {
  const options = await (await usersPage(this)).searchFieldOptions();
  s(this).searchFieldOptions = options;
  await report(this, '🔽 SEARCH BY dropdown', [
    `Options offered : ${options.length}`,
    ...options.map((o, i) => `  ${i + 1}. ${o}`)
  ]);
});

Then('the Search By dropdown should offer:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const actual = s(this).searchFieldOptions || (await this.pages.users.searchFieldOptions());
  for (const field of expected) expect(actual, `missing Search By field "${field}"`).toContain(field);
  expect(actual.length).toBe(expected.length);
});

When('I select {string} as the Search By field', async function (field) {
  await (await usersPage(this)).selectSearchField(field);
  await reportSearch(this, `🔀 SEARCH BY field switched to ${field}`, [
    `Placeholder     : "${await this.pages.users.searchPlaceholder()}"`,
    'Note            : switching the field RE-SCOPES whatever text is already typed'
  ]);
});

Then('the selected Search By field should be {string}', async function (field) {
  expect(await this.pages.users.getSelectedSearchField()).toBe(field);
});

Then('the search box placeholder should be {string}', async function (placeholder) {
  expect(await this.pages.users.searchPlaceholder()).toBe(placeholder);
});

Given('I note a reference user from the list', SLOW, async function () {
  const ref = await pickReference(this);
  const tab = await this.pages.users.selectedTab().catch(() => null);
  await report(this, '📌 REFERENCE USER (discovered at runtime)', [
    `Sub-tab         : ${tab || '—'}`,
    `User ID         : ${ref.id}`,
    `Username        : ${ref.username || '—'}`,
    `First / Last    : ${ref.firstName || '—'} / ${ref.lastName || '—'}`,
    `Email           : ${ref.email || '—'}`,
    `Phone Number    : ${ref.phoneNumber || '—'}`,
    `Onboarding Date : ${ref.created_at || '—'}`,
    'Every search below takes its query from THIS row.'
  ]);
});

Given('I note the unfiltered user count', SLOW, async function () {
  const users = await usersPage(this);
  // The counter reads 0 for a moment while the list request is still in flight,
  // so poll for a non-zero baseline rather than trusting the first sample.
  let total = await users.getTotalCount();
  for (let i = 0; i < 4 && !total; i++) {
    await users.waitForListSettle();
    total = await users.getTotalCount();
  }
  s(this).unfilteredCount = total;
  // Attached BEFORE the assertion on purpose: a zero baseline has to explain
  // itself in the report (leftover search term? filter still applied?) instead
  // of failing with nothing attached.
  await report(this, '🔢 UNFILTERED BASELINE', [
    `Sub-tab         : ${await users.selectedTab()}`,
    `Search By field : ${await users.getSelectedSearchField()}`,
    `Search box      : ${JSON.stringify(await users.searchBox.inputValue().catch(() => null))}`,
    `"Clear All"     : ${(await users.hasClearAll())
      ? 'VISIBLE — a filter is still applied'
      : 'not shown — no filter applied'}`,
    `Rows rendered   : ${await users.rowCount().catch(() => 0)}`,
    `Total users     : ${total} (no search, no filters)`,
    ...(total ? [] : [`Empty state     : "${await users.emptyStateText().catch(() => '')}"`])
  ]);
  expect(total, 'the unfiltered baseline must hold at least one user').toBeGreaterThan(0);
});

When("I search the {string} field for that user's value", SLOW, async function (field) {
  const ref = await pickReference(this);
  const value = refValue(ref, field);
  expect(value, `reference user has no ${field}`).toBeTruthy();
  const term = searchTermFor(field, value);
  s(this).lastTerm = term;
  s(this).lastField = field;
  await this.pages.users.searchInField(field, term);
  await reportSearch(this, `🔎 SEARCH — ${field} (exact value from row ${ref.id})`, [
    `Row's ${field} : "${value}"`,
    `Query derived   : "${term}"`
  ]);
});

When("I search the {string} field for that user's value in UPPERCASE", SLOW, async function (field) {
  const ref = await pickReference(this);
  const term = searchTermFor(field, refValue(ref, field)).toUpperCase();
  s(this).lastTerm = term;
  s(this).lastField = field;
  await this.pages.users.searchInField(field, term);
  await reportSearch(this, `🔎 SEARCH — ${field} (UPPERCASE)`, [
    `Row's ${field} : "${refValue(ref, field)}"`,
    `Query derived   : "${term}"  → matching must be case-INSENSITIVE`
  ]);
});

When("I search the {string} field for a partial fragment of that user's value", SLOW, async function (field) {
  const ref = await pickReference(this);
  // Sliced inside a single TOKEN on purpose: the exact-value searches now send
  // the complete cell value ("Support Staff"), and a mid-string slice of that
  // would straddle the space. This step is the deliberately partial one.
  const full =
    UsersPage.searchToken(refValue(ref, field)) || searchTermFor(field, refValue(ref, field));
  const fragment = full.slice(1, Math.max(4, Math.floor(full.length * 0.6)));
  s(this).lastTerm = fragment;
  s(this).lastField = field;
  await this.pages.users.searchInField(field, fragment);
  await reportSearch(this, `🔎 SEARCH — ${field} (partial fragment)`, [
    `Row's ${field} : "${refValue(ref, field)}"`,
    `Query derived   : "${fragment}"  (mid-string slice → matching must be a SUBSTRING match)`
  ]);
});

When("I search the {string} field for that user's value padded with spaces", SLOW, async function (field) {
  const ref = await pickReference(this);
  const term = searchTermFor(field, refValue(ref, field));
  s(this).lastTerm = term;
  s(this).lastField = field;
  await this.pages.users.searchInField(field, `   ${term}   `);
  await reportSearch(this, `🔎 SEARCH — ${field} (padded with spaces)`, [
    `Query sent      : "   ${term}   "  → surrounding whitespace must be trimmed`
  ]);
});

/**
 * Cross-field scoping: search under one field for a value that belongs to a
 * DIFFERENT column of the same row. A field-scoped search must not match it.
 */
When(
  "I search the {string} field using the reference user's {string} value",
  SLOW,
  async function (field, sourceField) {
    const ref = await pickReference(this);
    const value = refValue(ref, sourceField);
    expect(value, `reference user has no ${sourceField}`).toBeTruthy();
    s(this).lastTerm = value;
    s(this).lastField = field;
    await this.pages.users.searchInField(field, value);
    await reportSearch(this, `🔎 SEARCH — ${field} queried with a ${sourceField} value`, [
      `Row ${ref.id}'s ${sourceField}: "${value}"`,
      `Expectation     : a ${sourceField} value must NOT match under ${field} → empty state`
    ]);
  }
);

When('I search the {string} field for {string}', SLOW, async function (field, term) {
  s(this).lastTerm = term;
  s(this).lastField = field;
  await (await usersPage(this)).searchInField(field, term);
  await reportSearch(this, `🔎 SEARCH — ${field}`, [`Query sent      : ${JSON.stringify(term)}`]);
});

When('I search the {string} field for a {int} character term', SLOW, async function (field, length) {
  const term = 'z'.repeat(length);
  s(this).lastTerm = term;
  s(this).lastField = field;
  await (await usersPage(this)).searchInField(field, term);
  await reportSearch(this, `🔎 SEARCH — ${field} (${length} character term)`, [
    `Query length    : ${length} characters`,
    'Expectation     : handled gracefully — empty state, no application error'
  ]);
});

When('I clear the search', SLOW, async function () {
  await this.pages.users.clearSearch();
  await reportSearch(this, '🧹 SEARCH CLEARED — full list restored');
});

Then('every listed user\'s {string} value should contain the searched term', async function (field) {
  const rows = await this.pages.users.collectAllRows();
  const key = UsersPage.FIELD_KEY[field];
  const term = s(this).lastTerm;
  const offenders = rows.filter((r) => !rowMatchesSearch(field, r[key], term));
  await report(this, `✅ SCOPE CHECK — every row's ${field} must contain "${term}"`, [
    `Rows checked    : ${rows.length} (the FULL result set, every page)`,
    offenders.length
      ? `✗ ${offenders.length} row(s) do not match`
      : `✓ all ${rows.length} row(s) carry the term in their own ${field}`,
    '',
    ...formatUsers(rows),
    ...(offenders.length
      ? ['', 'Offending rows:', ...offenders.map((r) => `  ✗ ${r.id} → ${field} = "${r[key]}"`)]
      : [])
  ]);
  expect(rows.length, 'the search returned nothing').toBeGreaterThan(0);
  expect(
    offenders.map((r) => `${r.id}:${r[key]}`),
    `these rows do not carry "${term}" in their own ${field}`
  ).toEqual([]);
});

Then('the reference user should be listed', async function () {
  const ref = await pickReference(this);
  const rows = await this.pages.users.collectAllRows();
  const ids = rows.map((r) => r.id);
  await report(this, `🎯 REFERENCE USER ${ref.id} in the results?`, [
    ids.includes(ref.id)
      ? `✓ user ${ref.id} is present among ${rows.length} returned row(s)`
      : `✗ user ${ref.id} is MISSING from ${rows.length} returned row(s)`,
    '',
    ...formatUsers(rows)
  ]);
  expect(ids, `user ${ref.id} was not in the result`).toContain(ref.id);
});

Then('the total user count should equal the number of matching users', async function () {
  const users = this.pages.users;
  const total = await users.getTotalCount();
  const rows = await users.collectAllRows();
  await report(this, '🔢 COUNT vs ROWS', [
    `Counter says    : ${total} Users`,
    `Rows harvested  : ${rows.length} (across every page)`,
    rows.length === total ? '✓ the counter matches the searched result set' : '✗ mismatch',
    '',
    ...formatUsers(rows)
  ]);
  expect(rows.length).toBe(total);
});

Then('the total user count should be lower than the unfiltered count', async function () {
  const total = await this.pages.users.getTotalCount();
  expect(total).toBeLessThan(s(this).unfilteredCount);
});

Then('the total user count should be lower than or equal to the unfiltered count', async function () {
  const total = await this.pages.users.getTotalCount();
  expect(total).toBeLessThanOrEqual(s(this).unfilteredCount);
});

Then('the total user count should equal the unfiltered count', async function () {
  expect(await this.pages.users.getTotalCount()).toBe(s(this).unfilteredCount);
});

Then('the total user count should be {int}', async function (count) {
  expect(await this.pages.users.getTotalCount()).toBe(count);
});

Then('the search box should still hold the searched term', async function () {
  const value = await this.pages.users.searchBox.inputValue();
  expect(value.trim()).toBe(String(s(this).lastTerm).trim());
});

// -------------------------------------------------------------------------
// The whole-field sweep — ONE scenario proves EVERY Search By field on EVERY
// status sub-tab, so the suite never repeats the same scenario once per tab or
// once per field (the clinic suite's "searches each field for a value taken
// from the grid" equivalent).
//
// Each sub-tab contributes its OWN reference row — a Pending user's values do
// not appear in the Active grid — and each of the seven fields is searched for
// a value taken from that row. Two properties are recorded per
// (sub-tab, field) pair:
//   returnedSource — the row the value came from is in the results
//   scoped         — every returned row carries the term in its OWN column
// The per-field records are attached as they are collected, so a failure names
// the sub-tab, the field, the query and the rows that broke it.
// -------------------------------------------------------------------------

// Seven server-side searches per sub-tab, each followed by a full multi-page
// harvest, across three sub-tabs — a ceiling, not a wait.
const SWEEP = { timeout: 1800000 };

/**
 * Searches every Search By field for `ref`'s COMPLETE own value and returns one
 * record per field. One query per field, taken verbatim from the row — no
 * fallback query is tried, so a field that cannot find its own row fails
 * instead of being quietly rescued by a second guess.
 *
 * No clearSearch() between fields: the next term overwrites the box, and
 * blanking it first only bought a full server round-trip nobody asserted on.
 */
async function sweepEveryField(world, ref, tab) {
  const users = world.pages.users;
  const runs = [];

  for (const field of UsersPage.SEARCH_FIELDS) {
    const key = UsersPage.FIELD_KEY[field];
    const raw = refValue(ref, field);
    if (!raw) {
      runs.push({
        tab,
        field,
        refId: ref.id,
        skipped: 'the reference row has no value in this column'
      });
      continue;
    }
    const term = searchTermFor(field, raw);
    await users.searchInField(field, term);
    const rows = await users.collectAllRows();
    const run = {
      tab,
      field,
      refId: ref.id,
      raw,
      term,
      rows,
      total: await users.getTotalCount().catch(() => null),
      returnedSource: rows.some((r) => r.id === ref.id),
      offenders: rows.filter((r) => !rowMatchesSearch(field, r[key], term))
    };
    runs.push(run);
    await report(
      world,
      `🔎 ${tab.toUpperCase()} · SEARCH BY ${field.toUpperCase()} — query "${run.term}"`,
      [
        `Row's ${field} : "${raw}"`,
        `Query sent      : "${run.term}"${run.term === raw ? ' (the complete cell value)' : ''}`,
        `Records found   : ${run.total == null ? run.rows.length : run.total}`,
        run.returnedSource
          ? `✓ reference user ${ref.id} is in the results`
          : `✗ reference user ${ref.id} is MISSING — its own ${field} does not find it`,
        run.offenders.length
          ? `✗ ${run.offenders.length} row(s) do not carry the term in their own ${field}`
          : `✓ every row carries the term in its own ${field}`,
        '',
        ...formatUsers(run.rows)
      ]
    );
  }
  return runs;
}

When(
  "I search every Search By field for a reference user's own value on every sub-tab:",
  SWEEP,
  async function (table) {
    const tabs = table.raw().map((r) => r[0].trim()).filter(Boolean);
    const users = await usersPage(this);
    const runs = [];
    const skippedTabs = [];

    for (const tab of tabs) {
      await users.openTab(tab);
      await users.clearSearch();
      // Drop the cached row: every sub-tab is searched with a reference user
      // taken from that sub-tab's own grid.
      s(this).ref = null;
      const onTab = await users.readRows();
      if (!onTab.length) {
        skippedTabs.push(tab);
        await report(this, `⏭ ${tab.toUpperCase()} SUB-TAB — NO REFERENCE ROW`, [
          'This sub-tab holds no users in the current environment, so no value could be',
          'taken from it. Its seven field searches are listed as skipped in the summary.'
        ]);
        continue;
      }
      const ref = await pickReference(this);
      await report(this, `📌 ${tab.toUpperCase()} SUB-TAB — reference user (discovered at runtime)`, [
        `User ID         : ${ref.id}`,
        `Username        : ${ref.username || '—'}`,
        `First / Last    : ${ref.firstName || '—'} / ${ref.lastName || '—'}`,
        `Email           : ${ref.email || '—'}`,
        `Phone Number    : ${ref.phoneNumber || '—'}`,
        `Onboarding Date : ${ref.created_at || '—'}`,
        `Every ${tab} search below takes its query from THIS row.`
      ]);
      runs.push(...(await sweepEveryField(this, ref, tab)));
    }

    s(this).fieldRuns = runs;
    s(this).sweptTabs = tabs.filter((t) => !skippedTabs.includes(t));
    s(this).skippedTabs = skippedTabs;
    s(this).ref = null;

    // Hand the list back in a known state — the default sub-tab, no search —
    // because the steps that follow assert against the baseline noted on Active.
    await users.openTab('Active');
    await users.clearSearch();
  }
);

Then('every field should return the user its value came from', async function () {
  const all = s(this).fieldRuns || [];
  const runs = all.filter((r) => !r.skipped);
  expect(runs.length, 'no field was searched — the sweep step recorded nothing').toBeGreaterThan(0);
  const misses = runs.filter((r) => !r.returnedSource);
  await report(this, '📋 SUMMARY — each sub-tab\'s reference row found by its own value', [
    ...all.map((r) =>
      r.skipped
        ? `  – ${String(r.tab || '—').padEnd(9)} ${r.field.padEnd(16)} skipped: ${r.skipped}`
        : `  ${r.returnedSource ? '✓' : '✗'} ${String(r.tab || '—').padEnd(9)} ` +
          `${r.field.padEnd(16)} user ${r.refId} · "${r.term}" → ` +
          `${r.total == null ? r.rows.length : r.total} record(s)`
    ),
    ...((s(this).skippedTabs || []).length
      ? ['', `⏭ sub-tabs with no users to search from: ${s(this).skippedTabs.join(', ')}`]
      : ['', `✓ every sub-tab contributed a reference row: ${(s(this).sweptTabs || []).join(', ')}`])
  ]);
  expect(
    misses.map((r) => `${r.tab} · ${r.field} (user ${r.refId})`),
    'these searches did not return the row their own value was taken from'
  ).toEqual([]);
});

// Phrased with "Search By" on purpose: clinics.steps.js already owns the
// shorter "every field's results should stay scoped to that field", and
// Cucumber's step registry is global across step_definitions/**.
Then("every field's results should stay scoped to that Search By field", async function () {
  const runs = (s(this).fieldRuns || []).filter((r) => !r.skipped);
  expect(runs.length, 'no field was searched — the sweep step recorded nothing').toBeGreaterThan(0);
  const leaks = runs.filter((r) => r.offenders.length);
  await report(this, '📋 SUMMARY — results scoped to the searched field, per sub-tab', [
    ...runs.map(
      (r) =>
        `  ${r.offenders.length ? '✗' : '✓'} ${String(r.tab || '—').padEnd(9)} ` +
        `${r.field.padEnd(16)} ${r.rows.length} row(s), ${r.offenders.length} off-field match(es)`
    ),
    ...leaks.flatMap((r) =>
      r.offenders.slice(0, 5).map(
        (o) => `    ✗ ${r.tab} · ${r.field}: row ${o.id} = "${o[UsersPage.FIELD_KEY[r.field]]}"`
      )
    )
  ]);
  expect(
    leaks.map((r) => `${r.tab} · ${r.field}`),
    'these fields returned rows that do not match on that field'
  ).toEqual([]);
});

// -------------------------------------------------------------------------
// Onboarding Date — asserted on EXACT matching.
//
// The date field is swept with the six others, but it is the ONE searchable
// field whose displayed and searchable values can disagree, so it gets its own
// assertion instead of hiding inside the generic per-field summary:
//
//   - the row must be findable by the date its OWN row displays
//   - the result set must not be empty
//   - every returned row must display EXACTLY the searched date
//
// The suite used to accept a ±1 day window here. It no longer does. The grid
// renders created_at in the browser's LOCAL zone while the backend matches the
// UTC date, so a user created late in the UTC day both fails to be found by the
// date on its own row AND leaks into the neighbouring day's results (verified
// live: user 10910, created_at 2026-07-25T23:29:38Z, displays "07-26-2026",
// found only under "07-25-2026"). Tolerating that hid a real defect — a date
// search must return the days it was asked for and nothing else.
// -------------------------------------------------------------------------

Then(
  'every Onboarding Date search should have returned only rows onboarded on the searched date',
  async function () {
    const runs = (s(this).fieldRuns || []).filter((r) => r.field === 'Onboarding Date' && !r.skipped);
    expect(
      runs.length,
      'no Onboarding Date search was recorded — the sweep step must run first'
    ).toBeGreaterThan(0);

    const lines = [];
    for (const r of runs) {
      const bad = r.offenders.length || !r.rows.length || !r.returnedSource;
      lines.push(
        `  ${bad ? '✗' : '✓'} ${String(r.tab).padEnd(9)} row ${r.refId} displays "${r.raw}"`,
        `      ${r.returnedSource ? '✓' : '✗'} query "${r.term}" → ${r.rows.length} record(s)`,
        r.returnedSource
          ? '      ✓ found under the very date its own row displays'
          : '      ✗ NOT found under the date its own row displays — the grid renders the LOCAL ' +
            'date while the search matches the UTC date',
        r.rows.length
          ? r.offenders.length
            ? `      ✗ ${r.offenders.length} row(s) display a DIFFERENT date than the one ` +
              `searched: ${r.offenders.slice(0, 5).map((o) => `${o.id}=${o.created_at}`).join(', ')}`
            : `      ✓ all ${r.rows.length} returned row(s) display exactly "${r.term}"`
          : '      ✗ the date search returned NO rows',
        ...formatUsers(r.rows, 5)
      );
    }
    await report(this, '📅 SUMMARY — Onboarding Date, exact match, per sub-tab', lines);

    expect(
      runs.filter((r) => !r.rows.length).map((r) => `${r.tab} · query "${r.term}"`),
      'the Onboarding Date search returned nothing on these sub-tabs'
    ).toEqual([]);
    expect(
      runs.filter((r) => !r.returnedSource).map((r) => `${r.tab} · row ${r.refId} displays "${r.raw}"`),
      'these rows are not findable by the onboarding date printed in their own row'
    ).toEqual([]);
    expect(
      runs
        .filter((r) => r.offenders.length)
        .map((r) => `${r.tab} · query "${r.term}" returned ${r.offenders.map((o) => o.created_at).join(', ')}`),
      'these Onboarding Date searches returned rows that display a different date'
    ).toEqual([]);
  }
);

// =========================================================================
// Filters
// =========================================================================

Then('the {string} filter tab should offer a search box and a Select All option', async function (tab) {
  const users = this.pages.users;
  await users.openFilters();
  await users.openFilterTab(tab);
  const popover = users.filterPopover();
  await expect(popover.locator('input[type="text"]').first()).toBeVisible();
  await expect(popover.locator('label').filter({ hasText: /^Select All$/i }).first()).toBeVisible();
  await users.closeFilters();
});

Then('the {string} filter tab should list more than one role', async function (tab) {
  const options = await this.pages.users.filterOptions(tab);
  await this.pages.users.closeFilters();
  expect(options.length).toBeGreaterThan(1);
});

When('I apply the {string} filter with the role of a reference user', SLOW, async function (tab) {
  const ref = await pickReference(this);
  // The Roles cell can hold a comma-joined list; filter on the first role only.
  const role = String(ref.roles || '').split(/,\s*/)[0].trim();
  expect(role, 'reference user has no role').toBeTruthy();
  s(this).filteredRole = role;
  await this.pages.users.applyFilter(tab, role);
});

Then('every listed user should carry the filtered role', async function () {
  const rows = await this.pages.users.collectAllRows();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(String(row.roles || ''), `row ${row.id}`).toContain(s(this).filteredRole);
  }
});

Then('a {string} control should be available', async function (label) {
  await expect(
    this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
  ).toBeVisible();
});

Then('a {string} control should not be available', async function (label) {
  await expect(
    this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
  ).toBeHidden();
});

// =========================================================================
// Sort By
// =========================================================================

When('I open the Sort By menu', async function () {
  s(this).sortOptions = await (await usersPage(this)).sortOptions();
});

Then('the Sort By menu should offer:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const actual = (s(this).sortOptions || (await this.pages.users.sortOptions())).map((o) => o.label);
  for (const label of expected) expect(actual, `missing sort option "${label}"`).toContain(label);
  expect(actual.length).toBe(expected.length);
});

Then('exactly one Sort By option should be selected', async function () {
  const options = s(this).sortOptions || (await this.pages.users.sortOptions());
  expect(options.filter((o) => o.selected).length).toBe(1);
});

When('I sort the users by {string}', SLOW, async function (label) {
  await (await usersPage(this)).sortBy(label);
});

Then('the selected Sort By option should be {string}', async function (label) {
  expect(await this.pages.users.getSelectedSort()).toBe(label);
});

Then('the full list of user IDs should be in ascending order', SLOW, async function () {
  const ids = (await this.pages.users.collectSortedIds()).map(Number);
  expect(ids.length).toBeGreaterThan(1);
  expect(isAscending(ids), `not ascending: ${ids.join(',')}`).toBe(true);
});

Then('the full list of user IDs should be in descending order', SLOW, async function () {
  const ids = (await this.pages.users.collectSortedIds()).map(Number);
  expect(ids.length).toBeGreaterThan(1);
  expect(isDescending(ids), `not descending: ${ids.join(',')}`).toBe(true);
});

Then('the full list of onboarding dates should be in ascending order', SLOW, async function () {
  const keys = (await this.pages.users.collectAllRows()).map((r) => dateKey(r.created_at));
  expect(keys.length).toBeGreaterThan(1);
  expect(isAscending(keys), `not chronological: ${keys.join(',')}`).toBe(true);
});

Then('the full list of onboarding dates should be in descending order', SLOW, async function () {
  const keys = (await this.pages.users.collectAllRows()).map((r) => dateKey(r.created_at));
  expect(keys.length).toBeGreaterThan(1);
  expect(isDescending(keys), `not reverse-chronological: ${keys.join(',')}`).toBe(true);
});

When('I note the full list of user IDs', SLOW, async function () {
  s(this).noteIds = await this.pages.users.collectSortedIds();
});

Then('the full list of user IDs should be the reverse of the noted order', SLOW, async function () {
  const ids = await this.pages.users.collectSortedIds();
  expect(ids).toEqual([...s(this).noteIds].reverse());
});

// =========================================================================
// Export CSV
// =========================================================================

When('I export the users list as CSV', SLOW, async function () {
  s(this).csv = await (await usersPage(this)).exportCsvAndRead();
});

Then('the downloaded file should be named {string}', async function (name) {
  expect(s(this).csv.filename).toBe(name);
});

Then('the CSV columns should be:', async function (table) {
  expect(s(this).csv.columns).toEqual(table.raw().map((r) => r[0].trim()));
});

Then('the CSV columns should still be present', async function () {
  expect(s(this).csv.columns).toEqual(UsersPage.EXPORT_COLUMNS);
});

Then('the CSV should contain one row per user in the total count', async function () {
  expect(s(this).csv.records.length).toBe(await this.pages.users.getTotalCount());
});

Then('the CSV should contain exactly {int} data row', async function (count) {
  expect(s(this).csv.records.length).toBe(count);
});

Then('the CSV should contain exactly {int} data rows', async function (count) {
  expect(s(this).csv.records.length).toBe(count);
});

/**
 * Cell-by-cell parity between the CSV and the grid.
 *
 * Compared on WHITESPACE-NORMALISED values (runs of spaces collapsed to one).
 * Not leniency for its own sake: several QA users carry a double space in their
 * stored name ("Nofil  Khalid", "Security  Officer"), the CSV faithfully exports
 * it, and the DOM cannot render it — CSS collapses whitespace, so innerText
 * necessarily reads back "Nofil Khalid". A strict compare therefore failed on
 * the one thing the grid is physically unable to show, while any real difference
 * in the exported text still fails.
 */
const CSV_PARITY_COLUMNS = [
  'User ID', 'Username', 'First Name', 'Last Name', 'Roles', 'Email Address', 'Onboarding Date'
];

/** Columns whose cell holds a LIST, so the two renderings only have to agree as a set. */
const CSV_MULTI_VALUE_COLUMNS = new Set(['Roles', 'Associated Clinics']);

/**
 * Mismatch lines between one CSV record and its grid row, or [] when they agree.
 *
 * Multi-value columns are compared as SETS. Verified live 2026-07-26 on the
 * Pending sub-tab: a user holding two roles exports as "Billing Officer, Billing
 * Admin" while the grid cell stacks them newline-separated in the OTHER order
 * ("Billing Admin" then "Billing Officer"). Neither the separator nor the order
 * inside a list cell is behaviour worth pinning — WHICH roles the row carries is,
 * and a set compare still fails the moment the two disagree on that.
 */
function csvRowMismatches(record, row) {
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const tokens = (v) =>
    String(v == null ? '' : v)
      .split(/\s*,\s*|\n/)
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort();
  const out = [];
  for (const column of CSV_PARITY_COLUMNS) {
    const field = UsersPage.EXPORT_FIELD_KEY[column];
    const same = CSV_MULTI_VALUE_COLUMNS.has(column)
      ? JSON.stringify(tokens(record[column])) === JSON.stringify(tokens(row[field]))
      : norm(record[column]) === norm(row[field]);
    if (!same) {
      out.push(
        `user ${record['User ID']} [${column}]: CSV "${norm(record[column])}" ` +
          `≠ grid "${norm(row[field])}"`
      );
    }
  }
  return out;
}

Then('every CSV record should match the grid row with the same User ID', SLOW, async function () {
  const rows = await this.pages.users.collectAllRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  let checked = 0;
  const mismatches = [];
  for (const record of s(this).csv.records) {
    const row = byId.get(record['User ID']);
    if (!row) continue; // paged out of the harvest; the count check covers totals
    mismatches.push(...csvRowMismatches(record, row));
    checked++;
  }
  await report(this, 'Value parity — CSV vs grid', [
    `Grid rows compared : ${checked}`,
    `Columns compared   : ${CSV_PARITY_COLUMNS.join(', ')}`,
    `List columns       : ${[...CSV_MULTI_VALUE_COLUMNS].join(', ')} (compared as sets)`,
    mismatches.length ? `✗ ${mismatches.length} mismatch(es):` : '✓ every compared value matches the grid',
    ...mismatches.slice(0, 15).map((m) => `  • ${m}`)
  ]);
  expect(checked, 'no CSV record could be matched to a grid row').toBeGreaterThan(0);
  expect(mismatches, mismatches.join('; ')).toEqual([]);
});

Then('the CSV should contain the reference user', async function () {
  const ref = await pickReference(this);
  expect(s(this).csv.records.map((r) => r['User ID'])).toContain(ref.id);
});

Then('every CSV record should carry the filtered role', async function () {
  const records = s(this).csv.records;
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record.Roles, `user ${record['User ID']}`).toContain(s(this).filteredRole);
  }
});

Then('the CSV User ID column should be in ascending order', async function () {
  const ids = s(this).csv.records.map((r) => Number(r['User ID']));
  expect(ids.length).toBeGreaterThan(1);
  expect(isAscending(ids), `not ascending: ${ids.join(',')}`).toBe(true);
});

Then('the {string} control should still be enabled', async function (label) {
  if (/export/i.test(label)) {
    expect(await this.pages.users.isExportEnabled()).toBe(true);
    return;
  }
  await expect(
    this.page.getByRole('button', { name: new RegExp(label, 'i') }).first()
  ).toBeEnabled();
});

When('I note the exported CSV content', async function () {
  s(this).csvSnapshot = s(this).csv.raw;
});

Then('the exported CSV content should be unchanged', async function () {
  expect(s(this).csv.raw).toBe(s(this).csvSnapshot);
});

// =========================================================================
// Row actions — View Details
// =========================================================================

When('I open the row action menu for the reference user', SLOW, async function () {
  const ref = await pickReference(this);
  await this.pages.users.openRowMenu(ref.id);
});

Then('the row action menu should offer:', async function (table) {
  const actual = await this.pages.users.rowMenuItems();
  for (const item of table.raw().map((r) => r[0].trim())) {
    expect(actual, `missing row action "${item}"`).toContain(item);
  }
  await this.page.keyboard.press('Escape');
});

When('I open View Details for the reference user', SLOW, async function () {
  const ref = await pickReference(this);
  await this.pages.users.openUserDetails(ref.id);
});

When('I open View Details for the first listed user', SLOW, async function () {
  const users = await usersPage(this);
  const rows = await users.readRows();
  expect(rows.length).toBeGreaterThan(0);
  s(this).ref = rows[0];
  await users.openUserDetails(rows[0].id);
});

Then('I should be on the details page for the reference user', async function () {
  const ref = await pickReference(this);
  expect(await this.pages.users.isUserDetailsPage(ref.id), await this.pages.users.getCurrentUrl()).toBe(true);
});

Then('I should be on the details page for that user', async function () {
  expect(await this.pages.users.isUserDetailsPage(s(this).ref.id)).toBe(true);
});

Then("the details page should show that user's email", async function () {
  expect(await this.pages.users.detailsText()).toContain(s(this).ref.email);
});

Then("the details page should show that user's role", async function () {
  const role = String(s(this).ref.roles || '').split(/,\s*/)[0].trim();
  expect(await this.pages.users.detailsText()).toContain(role);
});

Then('the details page should show a status of {string}', async function (status) {
  expect(await this.pages.users.detailsText()).toMatch(new RegExp(status, 'i'));
});

Then('the details page should show the tabs:', async function (table) {
  const actual = await this.pages.users.detailsTabNames();
  for (const tab of table.raw().map((r) => r[0].trim())) {
    expect(actual, `missing details tab "${tab}"`).toContain(tab);
  }
});

Then('the details page should offer an {string} control', async function (label) {
  await expect(
    this.page.locator('main').getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
  ).toBeVisible();
});

When('I open the {string} details tab', async function (tab) {
  await this.pages.users.openDetailsTab(tab);
});

Then('the {string} details tab should be selected', async function (tab) {
  const selected = await this.page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.getAttribute('aria-selected') === 'true');
    return t ? t.textContent.trim() : null;
  });
  expect(selected).toBe(tab);
});

When('I go back to the Users list', SLOW, async function () {
  await this.pages.users.backToUsersList();
});

// =========================================================================
// Row actions — Mark as Inactive (throwaway users only)
// =========================================================================

When('I open the Mark as Inactive dialog for the reference user', SLOW, async function () {
  const ref = await pickReference(this);
  await this.pages.users.openRowMenu(ref.id);
  await this.page.getByRole('menuitem', { name: /Mark as Inactive/i }).first().click();
  await this.page.waitForTimeout(1500);
});

Then('a {string} confirmation should be displayed', async function (title) {
  await expect(
    this.page.getByRole('dialog').filter({ hasText: new RegExp(title, 'i') }).first()
  ).toBeVisible();
});

When('I cancel the confirmation dialog', async function () {
  const dialog = this.page.getByRole('dialog').first();
  const cancel = dialog.getByRole('button', { name: /^(Cancel|No|Close)$/i }).first();
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
  else await this.page.keyboard.press('Escape');
  await this.page.waitForTimeout(1200);
});

Then('the reference user should still be listed under the {string} sub-tab', SLOW, async function (tab) {
  const users = await usersPage(this);
  const ref = await pickReference(this);
  await users.openTab(tab);
  await users.searchUserId(ref.id);
  expect(await users.findRow('id', ref.id), `user ${ref.id} disappeared from ${tab}`).not.toBeNull();
});

/**
 * Creates a brand-new, disposable user so the inactivate scenarios never touch
 * a pre-existing account. Support Staff is a 2-step (non clinic-scoped) role,
 * which keeps provisioning to the minimum.
 */
Given('I create a throwaway {string} user', SLOW, async function (role) {
  const st = s(this);
  const users = await usersPage(this);
  st.throwaway = {
    email: flow.uniqueEmail(USERS_BASE()),
    firstName: 'Throwaway',
    lastName: `QA${Date.now().toString().slice(-5)}`
  };
  await users.createUser({
    roles: role,
    firstName: st.throwaway.firstName,
    lastName: st.throwaway.lastName,
    email: st.throwaway.email,
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)'
  });
  st.lastToast = await users.captureToast();
  st.throwaway.id = await flow.lookupUserId(st.throwaway.email).catch(() => null);
  if (!st.throwaway.id) {
    // Fall back to finding it in the grid: a fresh user lands under Pending.
    for (const tab of ['Pending', 'Active']) {
      await users.openTab(tab);
      await users.searchInField('Email', st.throwaway.email);
      const row = await users.findRow('email', st.throwaway.email);
      if (row) { st.throwaway.id = row.id; st.throwaway.tab = tab; break; }
    }
  }
  expect(st.throwaway.id, `could not resolve the throwaway user ${st.throwaway.email}`).toBeTruthy();
});

/** Locates the throwaway user's current status tab. */
async function findThrowawayTab(world) {
  const users = world.pages.users;
  const st = s(world);
  for (const tab of ['Pending', 'Active', 'Suspended']) {
    await users.openTab(tab);
    await users.searchUserId(st.throwaway.id);
    if (await users.findRow('id', st.throwaway.id)) return tab;
  }
  return null;
}

When('I mark the throwaway user as inactive', SLOW, async function () {
  const st = s(this);
  const users = await usersPage(this);
  const tab = st.throwaway.tab || (await findThrowawayTab(this));
  expect(tab, 'the throwaway user is not listed under any active status tab').toBeTruthy();
  st.throwaway.tab = tab;
  await users.markUserInactive(st.throwaway.id);
  st.lastToast = await users.captureToast();
});

Then('the throwaway user should not be listed under the {string} sub-tab', SLOW, async function (tab) {
  const users = await usersPage(this);
  await users.openTab(tab);
  await users.searchUserId(s(this).throwaway.id);
  expect(await users.findRow('id', s(this).throwaway.id)).toBeNull();
});

Then('the throwaway user should be listed under the {string} sub-tab', SLOW, async function (tab) {
  const users = await usersPage(this);
  await users.openTab(tab);
  await users.searchUserId(s(this).throwaway.id);
  expect(await users.findRow('id', s(this).throwaway.id), `not under ${tab}`).not.toBeNull();
});

Then('the CSV should contain the throwaway user', async function () {
  expect(s(this).csv.records.map((r) => r['User ID'])).toContain(String(s(this).throwaway.id));
});

Then('the throwaway user should carry the new role in the list', SLOW, async function () {
  const users = await usersPage(this);
  const st = s(this);
  for (const tab of ['Pending', 'Active']) {
    await users.openTab(tab);
    await users.searchInField('Email', st.throwaway.email);
    const row = await users.findRow('email', st.throwaway.email);
    if (row) {
      expect(row.roles).toContain(st.newRole);
      return;
    }
  }
  throw new Error(`the throwaway user ${st.throwaway.email} was not listed`);
});

// =========================================================================
// Create A Role drawer
// =========================================================================

Given('the Create A Role drawer is open', SLOW, async function () {
  const users = await usersPage(this);
  if (!(await users.isDialogOpen())) await users.openAddUser();
  await users.clickCreateNewRole();
  await users.createRoleDrawer().waitFor({ state: 'visible', timeout: 15000 });
});

Then('the drawer should show a {string} field', async function (label) {
  const placeholder = /role name/i.test(label) ? 'Add role name' : 'Describe the Role';
  await expect(this.pages.users.drawerField(placeholder)).toBeVisible();
});

Then('the drawer should show a clinic assignment option', async function () {
  expect(await this.pages.users.createRoleDrawerText()).toMatch(
    /Make clinic assignment part of this role/i
  );
});

Then('the drawer should list the permission groups:', async function (table) {
  const expected = table.raw().map((r) => r[0].trim());
  const actual = await this.pages.users.createRolePermissionGroups();
  for (const group of expected) {
    expect(actual, `missing permission group "${group}"`).toContain(group);
  }
});

Then('the drawer should offer {string} and {string} controls', async function (a, b) {
  for (const label of [a, b]) {
    await expect(
      this.pages.users.createRoleDrawer().getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    ).toBeVisible();
  }
});

When('I attempt to create the role without filling anything', async function () {
  const users = this.pages.users;
  if (await users.isCreateRoleSubmitEnabled()) await users.submitNewRole();
  s(this).submitWasEnabled = await users.isCreateRoleSubmitEnabled();
});

When('I fill in only the role name', async function () {
  s(this).newRole = `QA Role ${Date.now().toString().slice(-6)}`;
  await this.pages.users.fillNewRole({ name: s(this).newRole });
});

When('I fill in a unique role name and description', async function () {
  s(this).newRole = `QA Role ${Date.now().toString().slice(-6)}`;
  await this.pages.users.fillNewRole({
    name: s(this).newRole,
    description: 'Created by the automated Users list suite.'
  });
});

When('I grant all permissions for {string}', async function (group) {
  await this.pages.users.grantAllPermissions(group);
});

When('I attempt to submit the new role', async function () {
  const users = this.pages.users;
  s(this).submitWasEnabled = await users.isCreateRoleSubmitEnabled();
  if (s(this).submitWasEnabled) await users.submitNewRole();
});

When('I submit the new role', SLOW, async function () {
  await this.pages.users.submitNewRole();
  s(this).lastToast = await this.pages.users.captureToast();
});

// NOTE: 'I cancel the Create A Role drawer' and 'I select the new role from the
// Role dropdown' live in inline-role.steps.js — that file drives the drawer
// through the RolesPage POM, which is what User.feature's @inline-role
// scenarios expect. Defining them here too made every such scenario ambiguous.

/**
 * "Not created" in the repo's disjunctive sense: either the drawer refused to
 * submit (Create Role disabled), or it is still open with a validation error.
 */
Then('the role should not be created', async function () {
  const users = this.pages.users;
  if (s(this).submitWasEnabled === false) return;
  const stillOpen = await users.isVisible(users.createRoleDrawer());
  const errors = await this.page.evaluate(() =>
    [...document.querySelectorAll('.MuiDrawer-paper .MuiFormHelperText-root')]
      .map((e) => e.textContent.trim())
      .filter(Boolean)
  );
  expect(stillOpen || errors.length > 0, 'the role appears to have been created').toBe(true);
});

Then('the new role should be selectable in the Role dropdown', SLOW, async function () {
  const users = this.pages.users;
  await users.dismissPopover();
  const roles = await users.roleOptions();
  await users.dismissPopover();
  expect(roles, `"${s(this).newRole}" is not offered`).toContain(s(this).newRole);
});

Then('the new role should not exist in the Role dropdown', SLOW, async function () {
  const users = this.pages.users;
  const roles = await users.roleOptions();
  await users.dismissPopover();
  expect(roles).not.toContain(s(this).newRole);
});

When('I close the Add New User modal', async function () {
  const users = this.pages.users;
  await users.dismissPopover();
  if (await users.isDialogOpen()) await users.closeDialog();
  await users.waitForListSettle();
});

Then('the new role should be offered in the {string} filter tab', SLOW, async function (tab) {
  const options = await this.pages.users.filterOptions(tab);
  await this.pages.users.closeFilters();
  expect(options, `"${s(this).newRole}" is not a filter option`).toContain(s(this).newRole);
});

When('I add a throwaway user with the new role', SLOW, async function () {
  const st = s(this);
  const users = this.pages.users;
  await users.dismissPopover();
  await users.selectRoles(st.newRole);
  await users.clickNext();
  st.throwaway = {
    email: flow.uniqueEmail(USERS_BASE()),
    firstName: 'Roleuser',
    lastName: `QA${Date.now().toString().slice(-5)}`
  };
  await users.fillBasicDetails({
    firstName: st.throwaway.firstName,
    lastName: st.throwaway.lastName,
    email: st.throwaway.email,
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)'
  });
  // A brand-new role with clinic assignment off is a 2-step flow; if the wizard
  // grew a Permissions step, walk it with the first available clinic.
  const counter = await users.stepCounter();
  if (counter && counter.total === 3) {
    await users.clickNext();
    const clinics = await users.clinicOptions();
    if (clinics.length) await users.selectClinics(clinics[0]);
    if (await users.hasAllowProgramCreation()) await users.selectAllowProgramCreation('No');
  }
  await users.submit();
  st.lastToast = await users.captureToast();
});

// =========================================================================
// Cross-page navigation — each top-level tab owns its own grid
//
// Verified live (2026-07-25): every list screen renders an MUI DataGrid, and
// their headers are pairwise distinct — Users has the nine data columns,
// Clinics has ID/Name/Street Address/…, Patients has Username/Patient ID/…,
// Roles has Role Name/Description. The legacy /accounts URL no longer routes
// anywhere of its own: it silently lands on /monitoring.
// =========================================================================

/** Escape a feature-file literal before it becomes a RegExp. */
function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Non-breaking spaces and runs of whitespace collapse; case is dropped. */
function normalizeLabel(value) {
  return String(value == null ? '' : value)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

When('I navigate directly to the legacy {string} route', SLOW, async function (path) {
  const users = this.pages.users;
  await users.navigate(users.urlFor(path));
  await this.page.waitForLoadState('domcontentloaded');
  await this.page.waitForTimeout(2500);
});

Then('the page columns should not be the Users table columns', SLOW, async function () {
  const actual = await this.pages.users.columnHeaders();
  expect(actual.length, 'this page renders no column headers at all').toBeGreaterThan(0);
  const usersColumns = UsersPage.EXPORT_COLUMNS;
  const identical =
    actual.length === usersColumns.length && actual.every((c, i) => c === usersColumns[i]);
  expect(identical, `this page is still showing the Users columns: ${actual.join(', ')}`).toBe(false);
});

Then('the page should list its own records under its own columns', SLOW, async function () {
  const users = this.pages.users;
  // Patients in particular resolves its first page well after the sidebar
  // click settles, so wait for the grid to actually produce rows or an
  // empty-state overlay before judging it.
  const rows = await users.waitForGridContent();
  const headers = await users.columnHeaders();
  expect(headers.length, 'the page should expose its own column headers').toBeGreaterThan(0);
  if (rows === 0) {
    expect(await users.emptyStateText(),
      'a page with no records must still render its grid empty state').toBeTruthy();
  }
});

// =========================================================================
// Users tab — consolidation, row completeness, exact column set
// =========================================================================

/**
 * NXT-1999 folds every portal user type into the single Users tab. The role is
 * looked for across ALL four status sub-tabs (an environment can legitimately
 * hold, say, only a Pending Monitoring Admin) and the filter is applied once —
 * it persists as the sub-tabs are walked.
 */
Then('the Users list should contain at least one user with the role {string}', SLOW, async function (role) {
  const users = await usersPage(this);
  const offered = await users.filterOptions('Roles');
  await users.closeFilters();
  if (!offered.some((o) => normalizeLabel(o) === normalizeLabel(role))) {
    return pending(`the "${role}" role does not exist in this environment`);
  }

  await users.applyFilter('Roles', role);
  for (const tab of ['Active', 'Pending', 'Suspended', 'Inactive']) {
    if ((await users.selectedTab()) !== tab) await users.openTab(tab);
    const rows = await users.readRows();
    const hit = rows.find((r) => new RegExp(escapeRe(role), 'i').test(r.roles || ''));
    if (hit) return;
  }
  throw new Error(`no user with the role "${role}" is listed under any status sub-tab`);
});

Then('every listed user should carry at least one role', async function () {
  const rows = await this.pages.users.readRows();
  expect(rows.length, 'the Active tab should list at least one user').toBeGreaterThan(0);
  for (const row of rows) {
    expect(String(row.roles || '').trim(), `row ${row.id} carries no role`).toBeTruthy();
  }
});

/** "-" and "All Clinics" both count — the rule is that the cell is never blank. */
Then('every row should show a value in the {string} column', async function (column) {
  const field = UsersPage.EXPORT_FIELD_KEY[column];
  expect(field, `"${column}" is not a known Users column`).toBeTruthy();
  const rows = await this.pages.users.readRows();
  expect(rows.length, 'the grid should list at least one user').toBeGreaterThan(0);
  for (const row of rows) {
    expect(String(row[field] || '').trim(), `row ${row.id} has an empty "${column}"`).toBeTruthy();
  }
});

/**
 * columnHeaders() drops the captionless columns (the `srNo` index and the
 * `action` menu), so what remains is exactly the nine DATA columns and the
 * comparison can be a strict ordered equality.
 */
Then('the Users table data columns should be exactly, in order:', async function (table) {
  const expected = table.rawTable.slice(1).map(([c]) => c.trim());
  expect(await this.pages.users.columnHeaders()).toEqual(expected);
});

Then('any user tied to more than one clinic should represent each of them in the cell', SLOW, async function () {
  const cells = await this.pages.users.clinicCells();
  expect(cells.length, 'the Regular Supervisor filter returned no users').toBeGreaterThan(0);
  const multi = cells.filter((c) => c.clinics.includes(','));
  if (!multi.length) {
    return pending('no supervisor in this environment is tied to more than one clinic');
  }
  for (const cell of multi) {
    const names = cell.clinics.split(',').map((n) => n.trim()).filter(Boolean);
    expect(names.length, `row ${cell.id} reads "${cell.clinics}"`).toBeGreaterThan(1);
    for (const name of names) {
      expect(name, `row ${cell.id} has a blank clinic entry in "${cell.clinics}"`).toBeTruthy();
    }
  }
});

// =========================================================================
// NXT-2000 — step counter and indicator styling
//
// Verified live: the indicator styles COMPLETED and CURRENT identically
// (rgb(28,28,28) / weight 600) and only greys UPCOMING steps
// (rgb(194,195,196) / weight 400). "Current" is therefore taken from the
// authoritative "Step N/M" header, and the style check asserts only that
// current and upcoming actually render differently.
// =========================================================================

Then('the step counter should read {string}', async function (expected) {
  const counter = await this.pages.users.stepCounter();
  expect(counter, 'the wizard header has no "Step N/M" counter').toBeTruthy();
  expect(`Step ${counter.current}/${counter.total}`).toBe(expected);
});

Then('the {string} step should be highlighted as the current step', async function (name) {
  const states = await this.pages.users.stepVisualStates();
  const step = states.find((x) => x.name === name);
  expect(step, `"${name}" is not in the step indicator`).toBeTruthy();
  expect(step.current, `"${name}" is not the step the wizard header points at`).toBe(true);
  const upcoming = states.find((x) => x.upcoming);
  if (upcoming) {
    expect(`${step.color}|${step.fontWeight}`,
      `the current step renders exactly like the upcoming "${upcoming.name}" step`)
      .not.toBe(`${upcoming.color}|${upcoming.fontWeight}`);
  }
});

Then('the {string} step should be styled as an upcoming step', async function (name) {
  const states = await this.pages.users.stepVisualStates();
  const step = states.find((x) => x.name === name);
  expect(step, `"${name}" is not in the step indicator`).toBeTruthy();
  expect(step.upcoming, `"${name}" should still be ahead of the current step`).toBe(true);
  expect(step.completed, `"${name}" should not be marked completed yet`).toBe(false);
  const current = states.find((x) => x.current);
  if (current) {
    expect(`${step.color}|${step.fontWeight}`,
      `the upcoming step renders exactly like the current "${current.name}" step`)
      .not.toBe(`${current.color}|${current.fontWeight}`);
  }
});

// =========================================================================
// NXT-2000 — the wizard offers every role the list can filter by
// =========================================================================

When('I note the roles offered by the Roles filter', SLOW, async function () {
  const users = await usersPage(this);
  s(this).notedRoles = await users.filterOptions('Roles');
  await users.closeFilters();
  expect(s(this).notedRoles.length, 'the Roles filter offered nothing').toBeGreaterThan(0);
});

Then('every noted role should be offered in the Role dropdown', SLOW, async function () {
  const offered = await this.pages.users.roleOptions();
  await this.pages.users.dismissPopover();
  const missing = (s(this).notedRoles || []).filter(
    (role) => !offered.some((o) => normalizeLabel(o) === normalizeLabel(role))
  );
  expect(missing, `roles the list can filter by but the wizard cannot assign: ${missing.join(', ')}`)
    .toHaveLength(0);
});

// =========================================================================
// NXT-2000 — Step 2 field-level input
// =========================================================================

/**
 * Typed VERBATIM through the phone mask (see UsersPage.typePhoneRaw): the
 * negative examples are about what the widget does with "123" and
 * "abcdefghij", so they must not be normalised into E.164 first.
 */
When('I enter {string} in the Phone Number field', SLOW, async function (value) {
  await this.pages.users.typePhoneRaw(value);
});

When('I enter an existing email address in UPPERCASE', SLOW, async function () {
  const existing =
    state(this).duplicateEmail || process.env.BASE_EMAIL || 'adminuser+2@iqra.anonaddy.com';
  state(this).duplicateEmail = existing;
  await this.pages.users.field('Enter Email Address').fill(existing.toUpperCase());
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(800);
});

// =========================================================================
// NXT-2000 — Step 2/3 pickers
// =========================================================================

When('I open the {string} picker', SLOW, async function (placeholder) {
  s(this).pickerOptions = await this.pages.users.autocompleteOptions(placeholder);
});

When('I open the {string} picker filtered by {string}', SLOW, async function (placeholder, filter) {
  s(this).pickerOptions = await this.pages.users.autocompleteOptions(placeholder, filter);
});

Then('the picker should offer at least {int} options', async function (count) {
  const options = s(this).pickerOptions || [];
  expect(options.length, `the picker offered: ${options.join(' | ')}`).toBeGreaterThanOrEqual(count);
});

Then('the picker should offer {string}', async function (label) {
  const options = s(this).pickerOptions || [];
  expect(options.some((o) => normalizeLabel(o) === normalizeLabel(label)),
    `"${label}" is not offered — the picker shows: ${options.join(' | ')}`).toBe(true);
});

Then('the clinic control should be single-select', SLOW, async function () {
  expect(await this.pages.users.isClinicMultiSelect(),
    'a Nurse should get the single-select clinic autocomplete, not the multi-select popover')
    .toBe(false);
});

Then('the clinic control should offer at least one real clinic', SLOW, async function () {
  const options = await this.pages.users.clinicOptions();
  expect(options.length, 'Step 3 offered no clinics at all').toBeGreaterThan(0);
  expect(options.some((o) => o && o.trim() && o.trim() !== '-'),
    `no real clinic name in: ${options.join(', ')}`).toBe(true);
});

// =========================================================================
// NXT-2000 — closing the wizard without saving
// =========================================================================

When('I click outside the modal on the backdrop', SLOW, async function () {
  await this.pages.users.clickBackdrop();
});

/**
 * Deliberately permissive about the modal: NXT-2000 does not mandate whether a
 * backdrop click dismisses the wizard. What it DOES mandate is that the click
 * never commits the half-filled form.
 */
Then('the modal should either close or stay open, but no user should be created', SLOW, async function () {
  const st = state(this);
  expect(await hasAppError(this), 'a backdrop click raised an application error').toBe(false);
  if (!st.email) return;
  const id = await flow.lookupUserId(st.email).catch(() => null);
  expect(id, `${st.email} was created by a mere backdrop click`).toBeFalsy();
});

// =========================================================================
// NXT-2000 — a failed submission must not lose the admin's typing
// =========================================================================

Given('the create-user request will fail', SLOW, async function () {
  await this.pages.users.failCreateUserRequests();
  state(this).createWillFail = true;
});

Then('the modal should remain open with the entered data intact', SLOW, async function () {
  const users = this.pages.users;
  const st = state(this);
  expect(await users.isDialogOpen(),
    'a rejected submission must leave the wizard open so the admin can retry').toBeTruthy();
  expect(await users.fieldValue('Enter First Name')).toBe(st.firstName);
  expect(await users.fieldValue('Enter Last Name')).toBe(st.lastName);
  expect((await users.fieldValue('Enter Email Address')).toLowerCase()).toBe(st.email.toLowerCase());
});

Then('the new user should carry both the {string} and {string} roles', SLOW, async function (first, second) {
  const row = state(this).row || (await findNewUser(this, 'Pending'));
  expect(row, `${state(this).email} is not listed`).toBeTruthy();
  for (const role of [first, second]) {
    expect(String(row.roles || ''), `"${role}" missing from "${row.roles}"`)
      .toMatch(new RegExp(escapeRe(role), 'i'));
  }
});

// =========================================================================
// Create A Role drawer — the role it creates is usable straight away
// =========================================================================

When('I make clinic assignment part of the role', async function () {
  await this.pages.users.fillNewRole({ clinicAssignment: true });
});

// =========================================================================
// Filters and sorting — generic column assertions
// =========================================================================

Then('the {string} filter tab should list more than one clinic', SLOW, async function (tab) {
  const options = await this.pages.users.filterOptions(tab);
  await this.pages.users.closeFilters();
  expect(options.length, `the "${tab}" tab listed: ${options.join(', ')}`).toBeGreaterThan(1);
});

Then('the table should display only users matching {string} {string}', SLOW, async function (filter, value) {
  const byClinic = /clinic/i.test(filter);
  const field = byClinic ? 'associatedClinicsDisplay' : 'roles';
  const rows = await this.pages.users.collectAllRows();
  expect(rows.length, `no users matched the "${filter}" filter "${value}"`).toBeGreaterThan(0);
  // A clinic-scoped row may legitimately read "All Clinics" instead of naming
  // the filtered clinic (NXTSTIM Nurses cover every clinic).
  const allowed = byClinic
    ? new RegExp(`${escapeRe(value)}|All Clinics`, 'i')
    : new RegExp(escapeRe(value), 'i');
  for (const row of rows) {
    expect(String(row[field] || ''), `row ${row.id} shows "${row[field]}"`).toMatch(allowed);
  }
});

// =========================================================================
// NXT-2000 — Add New User modal: STRICT validation feedback
//
// The steps above assert validation DISJUNCTIVELY (an inline message OR a
// blocked action button), which is the repo convention and right for "did the
// form push back at all?". The steps below are the strict counterpart: they
// require the app to actually SAY something, and to say the app's own words.
//
// The expected wording was captured from the live QA build on 2026-07-26 by
// scripts/probe-adduser-validation.js / -fields.js / -step3.js:
//
//   "First name is required"        "Last name is required"
//   "Email is required"             "Gender is required"
//   "Language is required"          "Enter a valid email"
//   "<First|Last> name may only contain letters, spaces, hyphens and apostrophes"
//
// Phone Number is deliberately absent from that list: the live build neither
// validates nor requires it (see the @known-issue block in User.feature).
// =========================================================================

/** Which inline message belongs to which field label. */
const VALIDATION_KEYWORD = {
  'first name': /first\s*name/i,
  'last name': /last\s*name/i,
  'email address': /email/i,
  email: /email/i,
  'phone number': /phone/i,
  gender: /gender/i,
  language: /language/i
};

/** Whitespace-insensitive, case-insensitive "the app said this" comparison. */
function saysMessage(candidates, expected) {
  const norm = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(expected);
  return candidates.some((c) => norm(c) === wanted || norm(c).includes(wanted));
}

Then('a validation message {string} should be displayed in the wizard', SLOW, async function (expected) {
  const messages = await this.pages.users.waitForValidationMessages();
  expect(
    saysMessage(messages, expected),
    `expected the wizard to say "${expected}" — it showed: ` +
    `${messages.length ? messages.join(' | ') : '(no inline message at all)'}`
  ).toBe(true);
});

Then('a validation message should be displayed for the {string} field', SLOW, async function (field) {
  const keyword = VALIDATION_KEYWORD[normalizeLabel(field)];
  expect(keyword, `no validation keyword is mapped for "${field}"`).toBeTruthy();
  const messages = await this.pages.users.waitForValidationMessages();
  expect(
    messages.some((m) => keyword.test(m)),
    `expected an inline validation message about "${field}" — the wizard showed: ` +
    `${messages.length ? messages.join(' | ') : '(no inline message at all)'}`
  ).toBe(true);
});

// =========================================================================
// NXT-2000 — Add New User modal: an already used email address
//
// There is NO inline duplicate check. The address is only rejected once the
// wizard POSTs to /api/users, which answers 400 with
// {"message":"User with this email already exists or deleted"}; the frontend
// surfaces that message as a notistack toast and leaves the wizard open with
// every field intact. Rejection is case-insensitive.
// =========================================================================

/**
 * The account whose email the duplicate scenarios re-use, provisioned through
 * the wizard itself and cached for the lifetime of the Cucumber process — the
 * backend has no user-delete, so creating one per scenario would litter the
 * environment for no extra coverage.
 */
let duplicateSourceUser = null;

Given('a user already exists, created through the Add New User modal', SLOW, async function () {
  const users = this.pages.users;
  await ensureUsersPage(this);

  if (!duplicateSourceUser) {
    const email = flow.uniqueEmail(USERS_BASE());
    await users.createUser({
      roles: 'Support Staff',
      firstName: 'Duplicate',
      lastName: 'Source',
      email,
      phone: '5551234567',
      gender: 'Male',
      language: 'English (United States)'
    });
    const toast = await users.captureToast(9000);
    expect(
      /success/i.test(toast || ''),
      `could not provision the user whose email the duplicate is tested against (toast: "${toast}")`
    ).toBe(true);
    duplicateSourceUser = { email };
  }

  state(this).duplicateEmail = duplicateSourceUser.email;
  if (await users.isDialogOpen()) await users.closeDialog();
});

When('I enter the already used email address', SLOW, async function () {
  const email = state(this).duplicateEmail;
  expect(email, 'no existing user was provisioned for this scenario').toBeTruthy();
  await this.pages.users.field('Enter Email Address').fill(email);
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(1000);
});

When('I enter the already used email address in UPPERCASE', SLOW, async function () {
  const email = state(this).duplicateEmail;
  expect(email, 'no existing user was provisioned for this scenario').toBeTruthy();
  await this.pages.users.field('Enter Email Address').fill(email.toUpperCase());
  await this.page.keyboard.press('Tab');
  await this.page.waitForTimeout(1000);
});

/**
 * Asserts the app actually TOLD the admin what went wrong. Looks at the toast
 * captured by the "Add User" click and at any inline message, and fails with
 * both lists in the message so a wording change is obvious from the report.
 */
Then('an error message {string} should be displayed', SLOW, async function (expected) {
  const users = this.pages.users;
  const s = state(this);
  const toast = s.toast ? s.toast : await users.captureToast(9000);
  const inline = (await users.isDialogOpen()) ? await users.validationMessages() : [];
  const shown = [toast, ...inline].filter(Boolean);
  expect(
    saysMessage(shown, expected),
    `expected the error "${expected}" — the app showed: ` +
    `${shown.length ? shown.join(' | ') : '(nothing at all)'}`
  ).toBe(true);
});

Then('the wizard should remain open with the entered data intact', SLOW, async function () {
  const users = this.pages.users;
  const s = state(this);
  expect(
    await users.isDialogOpen(),
    'a rejected submission must leave the wizard open so the admin can fix the address'
  ).toBeTruthy();
  expect((await users.stepCounter()).current, 'the wizard should not have advanced').toBe(2);
  expect(await users.fieldValue('Enter First Name')).toBe(s.firstName);
  expect(await users.fieldValue('Enter Last Name')).toBe(s.lastName);
  expect((await users.fieldValue('Enter Email Address')).toLowerCase())
    .toBe(String(s.duplicateEmail).toLowerCase());
});

/**
 * The proof that the rejected submission created nothing: the email resolves to
 * exactly ONE account. Every status sub-tab is checked — a second account would
 * have landed in Pending, but scoping the search to one tab would miss it if the
 * app filed it elsewhere.
 */
Then('only one user should exist with the already used email address', SLOW, async function () {
  const users = this.pages.users;
  const email = String(state(this).duplicateEmail);
  await ensureUsersPage(this);

  const ids = new Set();
  for (const tab of ['Active', 'Pending', 'Suspended', 'Inactive']) {
    await users.openTab(tab);
    await users.searchInField('Email', email);
    for (const row of await users.collectAllRows()) {
      if (String(row.email || '').toLowerCase() === email.toLowerCase()) ids.add(row.id);
    }
  }
  expect(
    ids.size,
    `${email} resolves to ${ids.size} account(s) (ids: ${[...ids].join(', ') || 'none'}) — ` +
    'the duplicate submission should not have created a second one'
  ).toBe(1);
});

// =========================================================================
// NXT-2000 — Step 3, without hard-coding a clinic
//
// The QA environment's clinic list is churned by the Clinics suite, so naming
// one in the Gherkin ("Bytecorp Clinic") is a standing flake risk. These
// scenarios only care that assigning A clinic unblocks submission.
// =========================================================================

When('I select the first available clinic', SLOW, async function () {
  const clinic = await this.pages.users.selectFirstAvailableClinic();
  state(this).clinics = [clinic];
});

/**
 * Ordering is asserted over the WHOLE list, not the visible page. Numeric for
 * User ID, chronological for Onboarding Date, lexical for anything else.
 */
Then('the full list of {string} values should be in {string} order', SLOW, async function (column, direction) {
  const key = UsersPage.EXPORT_FIELD_KEY[column];
  expect(key, `"${column}" is not a known Users column`).toBeTruthy();
  const rows = await this.pages.users.collectAllRows();
  expect(rows.length, 'there is nothing to check the ordering of').toBeGreaterThan(1);

  let values;
  if (column === 'User ID') values = rows.map((r) => Number(r.id));
  else if (column === 'Onboarding Date') values = rows.map((r) => dateKey(r.created_at));
  else values = rows.map((r) => String(r[key] || '').toLowerCase());

  const ordered = /^asc/i.test(direction) ? isAscending(values) : isDescending(values);
  expect(ordered, `"${column}" is not in ${direction} order: ${values.join(', ')}`).toBe(true);
});

// =========================================================================
// FILTERS / SORT BY / EXPORT CSV â€” data-driven
// (features/UserManagement/user-filtersortexport.feature)
//
// Same contract as the Clinics suite's filter/sort/export block, so the two read
// and behave alike: NOTHING is hard-coded in the Gherkin. Every role, clinic and
// search term is discovered from the live grid at runtime, every ordering /
// count / parity assertion runs against the FULL list (collectAllRows /
// collectSortedIds), and each step attaches the records it acted on to the HTML
// report.
//
// The one behavioural difference from Clinics, verified live 2026-07-26 and
// asserted below, is how the two dimensions combine:
//   Clinics  City + State           -> UNION (matches City OR State)
//   Users    Roles + Assoc. Clinic  -> AND   (matches Role AND Clinic)
// Within a single dimension Users still ORs its values together, which is what
// the "two Roles" scenario proves.
//
// These steps deliberately REUSE the toolbar steps defined earlier in this file
// (I open the Sort By menu / I sort the users by â€¦ / I export the users list as
// CSV / the CSV columns should be: / the table should display the empty state /
// every CSV record should match the grid row with the same User ID / â€¦) rather
// than restating them.
// =========================================================================

/** Renders a role/clinic filter outcome for the report. */
function formatFilterRows(rows, dimension, limit = 15) {
  if (!rows || !rows.length) return ['  (no users displayed â€” empty state)'];
  const key = UsersPage.FILTER_FIELD_KEY[dimension] || 'roles';
  const lines = rows
    .slice(0, limit)
    .map(
      (r) =>
        `  â€¢ ${String(r.id || '?').padEnd(7)} ${truncate(r.username, 26).padEnd(27)} ` +
        `${dimension || 'value'} = ${truncate(r[key], 40)}`
    );
  if (rows.length > limit) lines.push(`  â€¦ and ${rows.length - limit} more row(s)`);
  return lines;
}

/**
 * Applies a selection, then records everything the assertions need: the values
 * used, the backend total, and the rows/ids that came back.
 */
async function applyAndRecord(world, selection, title, extra = []) {
  const users = world.pages.users;
  await users.applyFilterValues(selection);
  const st = s(world);
  st.filterSelection = selection;
  st.filterTotal = await users.getTotalCount();
  st.filterRows = await users.collectAllRows();
  st.filterIds = st.filterRows.map((r) => r.id);
  const dimension = Object.keys(selection).find((k) => (selection[k] || []).length);
  await report(world, title, [
    `Sub-tab        : ${await users.selectedTab().catch(() => 'â€”')}`,
    ...UsersPage.FILTER_TABS.filter((t) => (selection[t] || []).length).map(
      (t) => `${t.padEnd(15)}: ${[].concat(selection[t]).map((v) => `"${v}"`).join(' + ')}`
    ),
    `Filters badge  : ${await users.appliedFilterBadge()}`,
    `Records found  : ${st.filterTotal} user(s)`,
    ...extra,
    '',
    ...formatFilterRows(st.filterRows, dimension)
  ]);
  return st;
}

// ---- Toolbar layout ------------------------------------------------------

Then('the user search, Filters, Sort By and Export CSV controls should be visible', async function () {
  expect(await this.pages.users.areToolbarControlsVisible()).toBe(true);
});

Then('the total user count should be visible', async function () {
  expect(await this.pages.users.getTotalCount()).not.toBeNull();
});

Then('the users grid should be displayed', SLOW, async function () {
  await this.pages.users.waitForGridContent();
  expect(await this.pages.users.rowCount()).toBeGreaterThan(0);
});

Then('the Filters panel should offer Roles and Associated Clinic options', async function () {
  const tabs = await this.pages.users.filterTabNames();
  await report(this, 'Filters panel â€” dimensions offered', [
    `Tabs offered : ${tabs.join(', ')}`,
    `Expected     : ${UsersPage.FILTER_TABS.join(', ')}`
  ]);
  for (const name of UsersPage.FILTER_TABS) {
    expect(tabs, `missing filter tab "${name}"`).toContain(name);
  }
  await this.pages.users.closeFilters();
});

// ---- Sort By -------------------------------------------------------------

Then('{string} should be the default selected Sort By option', async function (label) {
  const options = s(this).sortOptions || (await this.pages.users.sortOptions());
  const selected = options.find((o) => o.selected);
  await report(this, 'Default selected sort', [
    `Selected         : ${selected ? selected.label : '(none)'}`,
    `Expected default : ${label}`,
    '',
    ...options.map((o) => `  â€¢ ${o.label}${o.selected ? '   (selected)' : ''}`)
  ]);
  expect(selected && selected.label).toBe(label);
});

// ---- Filters: a single value in one dimension ----------------------------

When('I filter by a Role that has users', SLOW, async function () {
  const hit = await this.pages.users.findPopulatedFilterValue('Roles');
  expect(hit, 'expected at least one role held by a user on this sub-tab').toBeTruthy();
  s(this).filteredRole = hit.value;
  s(this).expectedIds = hit.expectedIds;
  await applyAndRecord(this, { Roles: [hit.value] }, 'ðŸ”Ž FILTER APPLIED â€” Roles', [
    `Value selected : "${hit.value}"  (discovered at runtime)`,
    `Expected users : ${hit.expectedIds.length}, read off the unfiltered grid`
  ]);
});

When('I filter by an Associated Clinic that has users', SLOW, async function () {
  const hit = await this.pages.users.findPopulatedFilterValue('Associated Clinic');
  expect(hit, 'expected at least one clinic held by a user on this sub-tab').toBeTruthy();
  s(this).filteredClinic = hit.value;
  s(this).expectedIds = hit.expectedIds;
  await applyAndRecord(
    this,
    { 'Associated Clinic': [hit.value] },
    'ðŸ”Ž FILTER APPLIED â€” Associated Clinic',
    [
      `Value selected : "${hit.value}"  (discovered at runtime)`,
      `Expected users : ${hit.expectedIds.length}, read off the unfiltered grid`
    ]
  );
});

Then('every listed user should be associated with the filtered clinic', async function () {
  const clinic = s(this).filteredClinic;
  const rows = s(this).filterRows || (await this.pages.users.collectAllRows());
  const offenders = rows.filter(
    (r) => !UsersPage.rowsHolding([r], 'Associated Clinic', clinic).length
  );
  await report(this, `âœ… SCOPE CHECK â€” every row must be tied to "${clinic}"`, [
    `Rows checked : ${rows.length} (the FULL result set, every page)`,
    offenders.length
      ? `âœ— ${offenders.length} row(s) do not name the clinic`
      : `âœ“ all ${rows.length} row(s) name "${clinic}"`,
    '',
    ...formatFilterRows(rows, 'Associated Clinic'),
    ...(offenders.length
      ? ['', 'Offending rows:', ...offenders.map((r) => `  âœ— ${r.id} â†’ "${r.associatedClinicsDisplay}"`)]
      : [])
  ]);
  expect(rows.length, 'the filter returned nothing').toBeGreaterThan(0);
  expect(
    offenders.map((r) => `${r.id}:${r.associatedClinicsDisplay}`),
    `these rows are not associated with "${clinic}"`
  ).toEqual([]);
});

Then('the filtered result should hold exactly the users the grid showed for that value', async function () {
  const st = s(this);
  const expected = [...(st.expectedIds || [])].sort();
  const actual = [...(st.filterIds || [])].sort();
  await report(this, 'Filtered set vs the unfiltered grid', [
    `Expected ids : ${expected.join(', ') || 'â€”'}`,
    `Returned ids : ${actual.join(', ') || 'â€”'}`,
    JSON.stringify(expected) === JSON.stringify(actual)
      ? 'âœ“ the filter returned exactly the users that hold the value'
      : 'âœ— the filtered set differs from the users that hold the value'
  ]);
  expect(expected.length, 'the discovery step found no holders to expect').toBeGreaterThan(0);
  expect(actual).toEqual(expected);
});

Then('at least one user row should be shown', async function () {
  expect(await this.pages.users.rowCount()).toBeGreaterThan(0);
});

Then('the total user count should equal the number of listed users', SLOW, async function () {
  const users = this.pages.users;
  const total = await users.getTotalCount();
  const rows = s(this).filterRows || (await users.collectAllRows());
  expect(rows.length).toBe(total);
});

// ---- Filters: two values in ONE dimension (OR / union) -------------------

When('I filter by two Roles that no single user shares', SLOW, async function () {
  const users = this.pages.users;
  const pair = await users.findDisjointFilterPair('Roles');
  expect(pair, 'need two roles with no user in common for the union check').toBeTruthy();
  const st = s(this);
  st.unionPair = pair;
  st.countFirst = await users.applyFilterValuesAndCount({ Roles: [pair.first] });
  st.countSecond = await users.applyFilterValuesAndCount({ Roles: [pair.second] });
  await applyAndRecord(
    this,
    { Roles: [pair.first, pair.second] },
    'ðŸ”€ ONE DIMENSION, TWO VALUES â€” OR / UNION CHECK',
    [
      `"${pair.first}" alone  : ${st.countFirst} user(s)`,
      `"${pair.second}" alone : ${st.countSecond} user(s)`,
      `Union math     : ${st.countFirst} + ${st.countSecond} = ${st.countFirst + st.countSecond}`,
      'Rule: values inside ONE filter dimension OR together'
    ]
  );
});

Then('the result should be the union of the two Role results', async function () {
  const st = s(this);
  expect(st.countFirst, 'the first value returned nothing').toBeGreaterThan(0);
  expect(st.countSecond, 'the second value returned nothing').toBeGreaterThan(0);
  expect(st.filterTotal).toBe(st.countFirst + st.countSecond);
  const expected = [...st.unionPair.firstIds, ...st.unionPair.secondIds].sort();
  expect([...st.filterIds].sort()).toEqual(expected);
});

Then('every listed user should carry one of the two filtered Roles', async function () {
  const { first, second } = s(this).unionPair;
  const rows = s(this).filterRows;
  const offenders = rows.filter(
    (r) =>
      !UsersPage.rowsHolding([r], 'Roles', first).length &&
      !UsersPage.rowsHolding([r], 'Roles', second).length
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(
    offenders.map((r) => `${r.id}:${r.roles}`),
    `these rows carry neither "${first}" nor "${second}"`
  ).toEqual([]);
});

// ---- Filters: across BOTH dimensions (AND / intersection) ----------------

When('I filter by a Role and an Associated Clinic that share users', SLOW, async function () {
  const users = this.pages.users;
  const hit = await users.findIntersectingRoleAndClinic();
  expect(hit, 'need a role and a clinic held together by at least one user').toBeTruthy();
  const st = s(this);
  st.crossPair = hit;
  st.filteredRole = hit.role;
  st.filteredClinic = hit.clinic;
  st.countRoleOnly = await users.applyFilterValuesAndCount({ Roles: [hit.role] });
  st.countClinicOnly = await users.applyFilterValuesAndCount({ 'Associated Clinic': [hit.clinic] });
  await applyAndRecord(
    this,
    { Roles: [hit.role], 'Associated Clinic': [hit.clinic] },
    'ðŸ”€ BOTH DIMENSIONS â€” AND / INTERSECTION CHECK',
    [
      `Role alone     : "${hit.role}" â†’ ${st.countRoleOnly} user(s)`,
      `Clinic alone   : "${hit.clinic}" â†’ ${st.countClinicOnly} user(s)`,
      `Shared users   : ${hit.sharedIds.join(', ')} (${hit.sharedIds.length})`,
      `A union would return ${st.countRoleOnly + st.countClinicOnly} user(s)`,
      'Rule: the two filter DIMENSIONS AND together â€” unlike the Clinics screen,',
      '      where City + State returns their union'
    ]
  );
});

Then('the result should be the intersection of the Role and Clinic results', async function () {
  const st = s(this);
  const expected = [...st.crossPair.sharedIds].sort();
  const actual = [...st.filterIds].sort();
  await report(this, 'Intersection check', [
    `Role-only count   : ${st.countRoleOnly}`,
    `Clinic-only count : ${st.countClinicOnly}`,
    `Combined count    : ${st.filterTotal}`,
    `Expected ids      : ${expected.join(', ') || 'â€”'}`,
    `Returned ids      : ${actual.join(', ') || 'â€”'}`,
    st.filterTotal < st.countRoleOnly + st.countClinicOnly
      ? 'âœ“ narrower than the union â€” the dimensions AND together'
      : 'âœ— as wide as the union â€” the dimensions did NOT AND'
  ]);
  expect(st.countRoleOnly).toBeGreaterThan(0);
  expect(st.countClinicOnly).toBeGreaterThan(0);
  expect(actual).toEqual(expected);
  expect(st.filterTotal).toBeLessThanOrEqual(Math.min(st.countRoleOnly, st.countClinicOnly));
  expect(st.filterTotal).toBeLessThan(st.countRoleOnly + st.countClinicOnly);
});

Then('every listed user should carry both the filtered Role and Clinic', async function () {
  const { role, clinic } = s(this).crossPair;
  const rows = s(this).filterRows;
  const offenders = rows.filter(
    (r) =>
      !UsersPage.rowsHolding([r], 'Roles', role).length ||
      !UsersPage.rowsHolding([r], 'Associated Clinic', clinic).length
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(
    offenders.map((r) => `${r.id}: ${r.roles} / ${r.associatedClinicsDisplay}`),
    `these rows do not carry BOTH "${role}" and "${clinic}"`
  ).toEqual([]);
});

When('I filter by a Role and an Associated Clinic that share no users', SLOW, async function () {
  const users = this.pages.users;
  await users.clearAllFilters();
  const rows = await users.collectAllRowsSettled();
  const roles = await users.filterOptions('Roles');
  const clinics = await users.filterOptions('Associated Clinic');
  await users.closeFilters();
  // A role that HAS users on this sub-tab, plus a clinic NONE of those users are
  // tied to â€” so an AND can only come back empty, while a union would not.
  let picked = null;
  for (const role of roles) {
    const holders = UsersPage.rowsHolding(rows, 'Roles', role);
    if (!holders.length) continue;
    const theirs = new Set(
      holders.flatMap((r) =>
        String(r.associatedClinicsDisplay || '').split(/\s*,\s*|\n/).map((v) => v.trim())
      )
    );
    const clinic = clinics.find((c) => !theirs.has(c));
    if (clinic) {
      picked = { role, clinic, roleCount: holders.length };
      break;
    }
  }
  expect(picked, 'need a role and a clinic with no user in common').toBeTruthy();
  s(this).crossEmpty = picked;
  await applyAndRecord(
    this,
    { Roles: [picked.role], 'Associated Clinic': [picked.clinic] },
    'ðŸš« BOTH DIMENSIONS â€” NO USER MATCHES BOTH',
    [
      `Role   : "${picked.role}" â†’ ${picked.roleCount} user(s) on this sub-tab`,
      `Clinic : "${picked.clinic}" â†’ none of those users are tied to it`,
      'Expected: 0 users (an AND), not the role\'s users (a union)'
    ]
  );
});

// ---- Filters: a value with no users on this sub-tab ----------------------

When('I filter by a Role that has no users on this sub-tab', SLOW, async function () {
  const value = await this.pages.users.findEmptyFilterValue('Roles');
  expect(value, 'expected a globally-offered role with no users on this sub-tab').toBeTruthy();
  s(this).emptyRole = value;
  await applyAndRecord(this, { Roles: [value] }, 'ðŸš« FILTER APPLIED â€” a role with no users here', [
    `Role     : "${value}"`,
    'Note     : the option lists are GLOBAL, so a role offered on every sub-tab',
    '           can still be held by nobody on this one',
    'Expected : 0 users and the "Nothing here yet." empty state'
  ]);
});

Then('the users grid should show {string}', SLOW, async function (message) {
  const users = this.pages.users;
  const count = await users.rowCount();
  const overlay = await users.emptyStateText();
  await report(this, `Empty state â€” expected "${message}"`, [
    `Rows rendered : ${count}`,
    `Total counter : ${await users.getTotalCount().catch(() => null)}`,
    `Overlay text  : "${overlay}"`
  ]);
  expect(count).toBe(0);
  expect(overlay).toMatch(new RegExp(escapeRe(message), 'i'));
});

// ---- Filters: the in-panel option search --------------------------------

When('I open the {string} filter options', SLOW, async function (dimension) {
  s(this).filterDimension = dimension;
  s(this).filterOptionsBefore = await this.pages.users.filterOptions(dimension);
});

When('I search the {string} filter options for a partial term', SLOW, async function (dimension) {
  const users = this.pages.users;
  const options = s(this).filterOptionsBefore || (await users.filterOptions(dimension));
  expect(options.length, 'the filter should list options to search').toBeGreaterThan(0);
  // A real substring of a real option â€” never an invented term.
  const source = options[0];
  const term = source.replace(/\s+/g, '').slice(0, 3) || source;
  s(this).filterOptionTerm = term;
  await users.searchFilterOptions(term);
  const listed = await users.listedFilterOptions();
  await report(this, `âŒ¨ï¸ IN-FILTER SEARCH â€” ${dimension} (partial match)`, [
    `Dimension      : ${dimension}`,
    `Search text    : "${term}"  (a substring of the option "${source}")`,
    `Options before : ${options.length}`,
    `Options shown  : ${listed.length}`,
    '',
    ...listed.slice(0, 15).map((o) => `  â€¢ ${o}`),
    ...(listed.length > 15 ? [`  â€¦ and ${listed.length - 15} more`] : [])
  ]);
});

When('I search the {string} filter options for {string}', SLOW, async function (dimension, term) {
  const users = this.pages.users;
  await users.filterOptions(dimension);
  s(this).filterOptionTerm = term;
  await users.searchFilterOptions(term);
  const listed = await users.listedFilterOptions();
  await report(this, `âŒ¨ï¸ IN-FILTER SEARCH â€” ${dimension} (no match expected)`, [
    `Dimension     : ${dimension}`,
    `Search text   : "${term}"`,
    `Options shown : ${listed.length}`,
    `Message shown : ${(await users.isNoSearchResultsVisible()) ? '"No search results found"' : '(none)'}`
  ]);
});

Then('only options containing the searched term should be listed', async function () {
  const term = s(this).filterOptionTerm;
  const listed = await this.pages.users.listedFilterOptions();
  expect(listed.length, 'a partial search should still list matching options').toBeGreaterThan(0);
  for (const option of listed) {
    expect(option.toLowerCase(), `"${option}" does not contain "${term}"`).toContain(term.toLowerCase());
  }
  await this.pages.users.closeFilters();
});

Then('the filter options should show {string}', async function (message) {
  const users = this.pages.users;
  const shown = await users.isNoSearchResultsVisible();
  const listed = await users.listedFilterOptions();
  await report(this, `Filter option search â€” expected "${message}"`, [
    `Message shown  : ${shown ? 'yes' : 'no'}`,
    `Options listed : ${listed.length} (expected 0)`
  ]);
  expect(shown, `expected the panel to show "${message}"`).toBe(true);
  expect(listed).toEqual([]);
  await users.closeFilters();
});

// ---- Filters: the applied-count badge and Clear All ----------------------

Then('the Filters control should show a badge of {int}', async function (count) {
  expect(await this.pages.users.appliedFilterBadge()).toBe(count);
});

When('I clear all applied filters', SLOW, async function () {
  const cleared = await this.pages.users.clearAllFilters();
  expect(cleared, '"Clear All" was not offered â€” no filter appeared to be applied').toBe(true);
});

Then('no filter should remain applied', async function () {
  const users = this.pages.users;
  expect(await users.hasClearAll(), '"Clear All" is still shown â€” a filter is still applied').toBe(false);
  expect(await users.appliedFilterBadge()).toBeNull();
});

Then('all users should be listed again', SLOW, async function () {
  const users = this.pages.users;
  expect(await users.getTotalCount()).toBe(s(this).unfilteredCount);
  expect(await users.rowCount()).toBeGreaterThan(0);
});

// ---- Export CSV ---------------------------------------------------------

Then('the Export CSV control should be visible and enabled', async function () {
  await expect(this.pages.users.exportCsvButton).toBeVisible();
  expect(await this.pages.users.isExportEnabled()).toBe(true);
});

Then('the CSV columns should match the grid columns', async function () {
  const gridColumns = await this.pages.users.dataColumnHeaders();
  await report(this, 'Columns comparison â€” CSV vs grid', [
    `Grid columns : ${gridColumns.join(', ')}`,
    `CSV columns  : ${s(this).csv.columns.join(', ')}`
  ]);
  expect(s(this).csv.columns).toEqual(gridColumns);
});

// Every parsed data row must carry exactly as many fields as the header.
Then('the exported CSV should be well-formed', async function () {
  const csv = s(this).csv;
  expect(csv, 'no CSV was captured â€” the export step did not run').toBeTruthy();
  const width = csv.columns.length;
  const bad = csv.rows
    .map((r, i) => ({ row: i + 1, fields: r.length }))
    .filter((x) => x.fields !== width);
  await report(this, 'CSV well-formedness', [
    `Header width : ${width} column(s)`,
    `Data rows    : ${csv.rows.length}`,
    bad.length
      ? `âœ— ${bad.length} malformed row(s): ${JSON.stringify(bad)}`
      : 'âœ“ every row carries exactly as many fields as the header'
  ]);
  expect(bad).toEqual([]);
});

Then('the CSV record count should equal the displayed user count', SLOW, async function () {
  const users = this.pages.users;
  const total = await users.getTotalCount();
  const rows = await users.collectAllRows();
  const csv = s(this).csv;
  await report(this, 'ðŸ”¢ EXPORT COUNT â€” CSV vs grid vs counter', [
    `Counter says   : ${total} Users`,
    `Grid rows read : ${rows.length} (across every page)`,
    `CSV data rows  : ${csv.records.length}`
  ]);
  expect(csv.records.length).toBe(total);
  expect(csv.records.length).toBe(rows.length);
});

Then('the exported CSV should contain the column headers but no data records', async function () {
  const csv = s(this).csv;
  await report(this, 'Empty-grid export â€” header only', [
    `File name   : ${csv.filename}`,
    `CSV columns : ${csv.columns.join(', ')}`,
    `Data rows   : ${csv.records.length} (expected 0)`
  ]);
  expect(csv.columns).toEqual(UsersPage.EXPORT_COLUMNS);
  expect(csv.records.length).toBe(0);
});

Then('every CSV record should be associated with the filtered clinic', async function () {
  const clinic = s(this).filteredClinic;
  const records = s(this).csv.records;
  expect(records.length, 'expected filtered records in the CSV').toBeGreaterThan(0);
  for (const record of records) {
    expect(
      String(record['Associated Clinics'] || '').split(/\s*,\s*/).map((v) => v.trim()),
      `record ${record['User ID']} shows "${record['Associated Clinics']}"`
    ).toContain(clinic);
  }
});

Then('the CSV should hold exactly the users the grid is showing', SLOW, async function () {
  const rows = await this.pages.users.collectAllRows();
  const csvIds = s(this).csv.records.map((r) => r['User ID']).sort();
  const gridIds = rows.map((r) => r.id).sort();
  await report(this, 'Exported set vs the displayed grid', [
    `Grid ids : ${gridIds.join(', ') || 'â€”'}`,
    `CSV ids  : ${csvIds.join(', ') || 'â€”'}`,
    JSON.stringify(csvIds) === JSON.stringify(gridIds)
      ? 'âœ“ the export mirrors the grid exactly'
      : 'âœ— the export and the grid disagree'
  ]);
  expect(csvIds).toEqual(gridIds);
});

Then('the CSV rows should be in the same order as the grid', SLOW, async function () {
  const gridIds = (await this.pages.users.collectSortedIds()).map(String);
  const csvIds = s(this).csv.records.map((r) => String(r['User ID']));
  await report(this, 'Export order vs grid order', [
    `Grid order : ${gridIds.slice(0, 8).join(', ')}${gridIds.length > 8 ? ' â€¦' : ''}`,
    `CSV order  : ${csvIds.slice(0, 8).join(', ')}${csvIds.length > 8 ? ' â€¦' : ''}`
  ]);
  expect(csvIds.length).toBeGreaterThan(1);
  expect(csvIds).toEqual(gridIds);
});

// ---- Narrowing the grid before an export --------------------------------

When('I search for a value that narrows the grid', SLOW, async function () {
  const users = this.pages.users;
  const ref = await pickReference(this);
  const email = refValue(ref, 'Email');
  const term = email.includes('@') ? email.split('@')[1] : email;
  s(this).lastTerm = term;
  await users.searchInField('Email', term);
  await reportSearch(this, 'ðŸ”Ž SEARCH â€” narrowing the grid before export', [
    `Query source    : the domain of reference user ${ref.id}'s email, read at runtime`
  ]);
  expect(await users.getTotalCount(), 'the narrowing search returned nothing').toBeGreaterThan(0);
});

When('I apply a Role filter and a search together', SLOW, async function () {
  const users = this.pages.users;
  const hit = await users.findPopulatedFilterValue('Roles');
  expect(hit, 'expected a role held by a user on this sub-tab').toBeTruthy();
  s(this).filteredRole = hit.value;
  await users.applyFilterValues({ Roles: [hit.value] });
  // The search term is taken from a row the FILTER actually returned, so the two
  // narrowings can never contradict each other.
  const filtered = await users.collectAllRows();
  expect(filtered.length, `the "${hit.value}" filter returned nothing`).toBeGreaterThan(0);
  const term = filtered[0].id;
  s(this).lastTerm = term;
  await users.searchInField('User ID', term);
  await report(this, 'ðŸ”€ COMBINED FILTER + SEARCH before export', [
    `Filter (Roles)   : "${hit.value}" â†’ ${filtered.length} user(s)`,
    `Search (User ID) : "${term}"  (a row the filter returned)`,
    `Records found    : ${await users.getTotalCount()} user(s)`,
    '',
    ...formatUsers(await users.collectAllRows())
  ]);
});

When('I narrow the grid to a single user', SLOW, async function () {
  const users = this.pages.users;
  const ref = await pickReference(this);
  s(this).lastTerm = ref.id;
  await users.searchInField('User ID', ref.id);
  await reportSearch(this, 'ðŸ”Ž SEARCH â€” narrowed to one user', [
    `Reference user  : ${ref.id} (read off the grid at runtime)`
  ]);
  expect(await users.getTotalCount()).toBe(1);
});
