const { BasePage } = require('./BasePage');

/**
 * RolesPage — POM for the Roles screen (NXT-2001) and, more importantly, for
 * the "Create A Role" drawer, which is reachable from TWO places:
 *
 *   - the Roles tab's own "Create a new role" button, and
 *   - the footer entry at the bottom of the Add New User wizard's Role dropdown
 *     (`UsersPage.clickCreateNewRole()`).
 *
 * It is the same component either way, so one POM serves both. Selectors were
 * captured against the live QA build on 2026-07-27 with
 * scripts/probe-inline-role.js and scripts/probe-roles-delete.js. What that
 * turned up, and what will bite you:
 *
 *   - A bare `.MuiDrawer-paper` ALSO matches the app's left sidebar, which is a
 *     permanent MUI Drawer. Everything here is scoped to `.MuiDrawer-modal`,
 *     the modal drawer. Getting this wrong silently reads the nav menu and
 *     reports "no fields in the drawer".
 *   - The same modal drawer renders both the create form and the read-only
 *     "view role" panel, so they are told apart by their content ("Create A
 *     Role" heading vs a "Delete Role" / "Edit Role" pair).
 *   - Clinic scope is NOT a radio group. "Single" / "Multiple" are
 *     `div.radio-pill` boxes whose selection is expressed by an added
 *     `.selected` class — there is no input to check. "Single" is preselected
 *     the moment the clinic toggle goes on.
 *   - "Create Role" is gated on Role Name + Describe The Role only; permissions
 *     and clinic scope are optional.
 *   - While this drawer is open, MUI marks everything behind it `aria-hidden`,
 *     including the Add New User wizard. `getByRole('dialog')` therefore stops
 *     matching the wizard, and any locator-based read of it hangs until it
 *     times out. Use UsersPage.wizardSnapshot(), which reads the raw DOM.
 *
 * Selector strategy follows the repo convention: a data-testid candidate first
 * (the app exposes none here yet, so the suite auto-upgrades when it does),
 * then ARIA role / accessible name, then the verified MUI structural classes.
 */
class RolesPage extends BasePage {
  constructor(page) {
    super(page);

    this.searchBox = page
      .locator('[data-testid="roles-search"], input[placeholder="Search for Role Name"], input[placeholder^="Search for Role"]')
      .first();
    this.createRoleButton = page
      .locator('[data-testid="create-role"]')
      .or(page.getByRole('button', { name: /^Create a new role$/i }))
      .first();
    this.rows = page.locator('.MuiDataGrid-row');
  }

  // ---- URLs ---------------------------------------------------------------

  origin() {
    const login =
      process.env.BASE_URL ||
      'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login';
    return login.replace(/\/login.*$/i, '');
  }

  urlFor(path) {
    return `${this.origin()}/${String(path).replace(/^\//, '')}`;
  }

  async open() {
    await this.navigate(this.urlFor('roles'));
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.searchBox.waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(600);
  }

  // ---- The Create A Role drawer -------------------------------------------

  /**
   * The modal drawer. `.MuiDrawer-modal` is load-bearing — see the class note.
   */
  drawer() {
    return this.page
      .locator('[data-testid="create-role-drawer"], .MuiDrawer-modal .MuiDrawer-paper')
      .first();
  }

  async isDrawerOpen() {
    return await this.isVisible(this.drawer());
  }

  async drawerText() {
    if (!(await this.isDrawerOpen())) return '';
    return ((await this.drawer().innerText()) || '').trim();
  }

  /** True only for the CREATE form, not the read-only view panel. */
  async isCreateDrawerOpen() {
    if (!(await this.isDrawerOpen())) return false;
    return /Create A Role/i.test(await this.drawerText());
  }

  async waitForCreateDrawer(timeout = 15000) {
    await this.drawer().waitFor({ state: 'visible', timeout });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isCreateDrawerOpen()) return;
      await this.page.waitForTimeout(200);
    }
    throw new Error('the "Create A Role" drawer did not appear');
  }

  roleNameField() {
    return this.drawer()
      .locator('[data-testid="role-name"], input[placeholder="Add role name"], input[placeholder*="role name" i]')
      .first();
  }

  descriptionField() {
    return this.drawer()
      .locator('[data-testid="role-description"], input[placeholder="Describe the Role"], textarea[placeholder*="Describe" i]')
      .first();
  }

  createButton() {
    return this.drawer().getByRole('button', { name: /^Create Role$/i }).first();
  }

  cancelButton() {
    return this.drawer().getByRole('button', { name: /^Cancel$/i }).first();
  }

  async isCreateEnabled() {
    return await this.createButton().isEnabled().catch(() => false);
  }

  /** Required-field captions the form advertises, e.g. ["Role Name*", …]. */
  async requiredFieldLabels() {
    return (await this.drawerText())
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('*'));
  }

  // ---- Clinic assignment ---------------------------------------------------

  /**
   * The "Make clinic assignment part of this role" switch. MUI renders its
   * Switch as an input[type=checkbox], and it is the FIRST switch in the
   * drawer — every later one is a category's "Grant all permissions".
   */
  clinicToggle() {
    return this.drawer().locator('.MuiSwitch-root input').first();
  }

  async isClinicToggleOn() {
    return await this.clinicToggle().isChecked().catch(() => false);
  }

  /** Idempotent: only clicks when the switch is not already in `on`. */
  async setClinicToggle(on) {
    if ((await this.isClinicToggleOn()) === on) return;
    // force: the MUI input is a zero-opacity overlay on the thumb.
    await this.clinicToggle().click({ force: true });
    await this.page.waitForTimeout(700);
  }

  /** The Single / Multiple pills, as displayed. Empty while the toggle is off. */
  async clinicScopeOptions() {
    if (!(await this.isDrawerOpen())) return [];
    return await this.drawer()
      .locator('.radio-pill')
      .allTextContents()
      .then((t) => t.map((x) => x.trim()).filter(Boolean))
      .catch(() => []);
  }

  /** Which pill currently carries `.selected`, or null. */
  async selectedClinicScope() {
    const pill = this.drawer().locator('.radio-pill.selected').first();
    if (!(await this.isVisible(pill))) return null;
    return ((await pill.textContent()) || '').trim();
  }

  async chooseClinicScope(scope) {
    await this.drawer()
      .locator('.radio-pill')
      .filter({ hasText: new RegExp(`^\\s*${scope}\\s*$`, 'i') })
      .first()
      .click();
    await this.page.waitForTimeout(500);
  }

  // ---- Permissions ---------------------------------------------------------

  /** Category names in the "Set permissions for this role" accordion list. */
  async permissionCategories() {
    const raw = await this.drawer().locator('.MuiAccordionSummary-root').allTextContents();
    return raw
      .map((t) => t.replace(/Grant all permissions/i, '').trim())
      .filter(Boolean);
  }

  categorySummary(name) {
    return this.drawer()
      .locator('.MuiAccordionSummary-root')
      .filter({ hasText: new RegExp(name, 'i') })
      .first();
  }

  /** Turn on a category's "Grant all permissions" switch. */
  async grantAllFor(category) {
    const toggle = this.categorySummary(category).locator('.MuiSwitch-root input').first();
    await toggle.click({ force: true });
    await this.page.waitForTimeout(400);
  }

  /** Every permission switch that is currently on, drawer-wide. */
  async enabledPermissionCount() {
    return await this.drawer()
      .locator('.MuiSwitch-root input:checked')
      .count()
      .catch(() => 0);
  }

  // ---- Filling and submitting ---------------------------------------------

  /**
   * Fill the create form. `clinicScope` ("Single" | "Multiple") also switches
   * the clinic toggle on; omit it to leave the role clinic-agnostic.
   */
  async fillNewRole({ name, description, clinicScope = null, grantAll = [] }) {
    await this.type(this.roleNameField(), name);
    await this.type(this.descriptionField(), description);
    // Blur so the form's validation state settles before the button is read.
    await this.page.keyboard.press('Tab');
    await this.page.waitForTimeout(400);
    if (clinicScope) {
      await this.setClinicToggle(true);
      await this.chooseClinicScope(clinicScope);
    }
    for (const category of [].concat(grantAll)) await this.grantAllFor(category);
  }

  /** Submit and wait for the drawer to go away. */
  async submitNewRole() {
    await this.createButton().click();
    await this.drawer().waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
  }

  async cancelDrawer() {
    await this.cancelButton().click();
    await this.drawer().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(800);
  }

  /** Latest notistack toast text, or '' when none is up. */
  async toastText() {
    const toast = this.page.locator('.notistack-Snackbar, [role="alert"]').first();
    if (!(await this.isVisible(toast))) return '';
    return ((await toast.innerText()) || '').trim();
  }

  // ---- The Roles list ------------------------------------------------------

  async searchRoles(text) {
    await this.type(this.searchBox, text);
    // Server-side filter; the grid repaints unevenly on this preview host.
    await this.page.waitForTimeout(2200);
  }

  /** Role names currently rendered in the grid. */
  async listedRoles() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('.MuiDataGrid-row [data-field="name"]')]
        .map((c) => (c.textContent || '').trim())
        .filter(Boolean)
    );
  }

  /** Search for `name` and report whether the grid holds an exact match. */
  async hasRole(name) {
    await this.searchRoles(name);
    return (await this.listedRoles()).some((r) => r.toLowerCase() === name.toLowerCase());
  }

  async totalRolesBadge() {
    const text = await this.page.locator('body').innerText();
    const m = text.match(/Total Roles\s*\n?\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  }

  /**
   * Open a role's side panel. The row action is icon-only; it is identified by
   * its accessible name ("View permissions") with a positional fallback.
   */
  async openRolePanel(name) {
    await this.searchRoles(name);
    const row = this.rows
      .filter({ has: this.page.locator(`[data-field="name"]:text-is("${name}")`) })
      .first();
    const target = (await row.count()) ? row : this.rows.first();
    const action = target
      .locator('[aria-label="View permissions"], [data-field="action"] button, button')
      .first();
    await action.click();
    await this.drawer().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(800);
  }

  /**
   * Delete a role that has no users assigned: open its panel, "Delete Role",
   * then confirm in the "Are you sure…" dialog (buttons: Keep It / Delete).
   * Returns true once the role is gone from the list.
   */
  async deleteRole(name) {
    await this.openRolePanel(name);
    await this.drawer().getByRole('button', { name: /^Delete Role$/i }).first().click();
    await this.page.waitForTimeout(1200);
    const confirm = this.page
      .getByRole('dialog')
      .filter({ hasText: /delete this role/i })
      .first();
    const box = (await confirm.count()) ? confirm : this.page.getByRole('dialog').first();
    await box.getByRole('button', { name: /^Delete$/i }).first().click();
    await this.page.waitForTimeout(2500);
    return !(await this.hasRole(name));
  }
}

module.exports = { RolesPage };
