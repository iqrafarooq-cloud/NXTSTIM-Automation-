const { BasePage } = require('./BasePage');

/**
 * AdminUsersPage — POM for the admin user-management screens.
 *
 * Surfaces per-persona tabs (Active / Pending / Suspended) and the per-row
 * 3-dot action menu that exposes Reactivate / Resend Email. The exact admin
 * URL is not hardcoded — `open(persona)` navigates to a configurable route
 * relative to the app's origin, with a fallback search via the side nav.
 *
 * Selector strategy mirrors the rest of the codebase: data-testid first,
 * then ARIA role, then MUI text fallback.
 */
class AdminUsersPage extends BasePage {
  constructor(page) {
    super(page);

    // Admin section root path. Override via process.env.ADMIN_BASE_PATH if
    // the deployed app uses a different layout (e.g. "/users", "/manage").
    this.basePath = process.env.ADMIN_BASE_PATH || '/admin';

    this.selectors = {
      sideNavUsers:
        '[data-testid="nav-users"], ' +
        'a:has-text("Users"), a:has-text("User Management"), ' +
        'nav a[href*="users" i], nav a[href*="admin" i]',
      personaSelector:
        '[data-testid="persona-selector"], ' +
        'select[name*="persona" i], ' +
        '[role="combobox"][aria-label*="persona" i]',
      activeTab:
        '[data-testid="tab-active"], ' +
        '[role="tab"]:has-text("Active"), ' +
        'button:has-text("Active")',
      pendingTab:
        '[data-testid="tab-pending"], ' +
        '[role="tab"]:has-text("Pending"), ' +
        'button:has-text("Pending")',
      suspendedTab:
        '[data-testid="tab-suspended"], ' +
        '[role="tab"]:has-text("Suspended"), ' +
        'button:has-text("Suspended")',
      userRow: (email) =>
        `[data-testid="user-row-${cssEscape(email)}"], ` +
        `tr:has-text("${email}"), ` +
        `[role="row"]:has-text("${email}"), ` +
        `li:has-text("${email}")`,
      // The live QA build (verified 2026-05-21) renders the row's 3-dot as a
      // plain <button> with just an <img> inside the last [role="gridcell"]
      // — no aria-label, no testid. The earlier MoreVert / aria selectors
      // never matched anything on /admin. Last-cell button is the reliable
      // anchor; the testid/aria patterns remain as forward-compat for the
      // day the app team adds them.
      threeDotMenuButton:
        '[data-testid="row-actions"], ' +
        'button[aria-label*="actions" i], ' +
        'button[aria-label*="more" i], ' +
        'button:has(svg[data-testid*="MoreVert" i]), ' +
        '[role="gridcell"]:last-child button, ' +
        'td:last-child button',
      menuItemReactivate:
        '[data-testid="action-reactivate"], ' +
        '[role="menuitem"]:has-text("Reactivate")',
      menuItemResendEmail:
        '[data-testid="action-resend-email"], ' +
        '[role="menuitem"]:has-text("Resend Email"), ' +
        '[role="menuitem"]:has-text("Resend")',
      menuItemAny: '[role="menuitem"]',
      successModal:
        '[data-testid="email-sent-modal"], ' +
        '[role="dialog"]:has-text("Email Sent Successfully"), ' +
        ':text-matches("email\\s*sent\\s*successfully", "i")',
      successToast:
        '[data-testid="success-toast"], ' +
        '.notistack-MuiContent, .MuiAlert-message, ' +
        ':text-matches("email\\s*sent\\s*successfully", "i")',
      duplicateError:
        '[data-testid="duplicate-error"], ' +
        ':text-matches("already (sent|reactivated|requested)", "i"), ' +
        '.MuiAlert-message:has-text("already")',
      duplicateEmailError:
        '[data-testid="duplicate-email-error"], ' +
        ':text-matches("(email|user)\\s*already\\s*exists|duplicate", "i")',
      forbidden:
        '[data-testid="forbidden"], ' +
        ':text-matches("forbidden|not authorized|access denied|403", "i")',
      // Create-user form
      createUserButton:
        '[data-testid="create-user"], ' +
        'button:has-text("Create User"), button:has-text("Add User"), button:has-text("New User")',
      fullNameInput:
        '[data-testid="fullName"], input[name="fullName"], input[name="full_name"], input[placeholder*="full name" i]',
      emailInput:
        '[data-testid="email"], input[name="email"], input[type="email"]',
      roleSelect:
        '[data-testid="role"], select[name="role"], [role="combobox"][aria-label*="role" i]',
      submitCreateUser:
        '[data-testid="submit-create-user"], ' +
        '[role="dialog"] button[type="submit"], ' +
        '[role="dialog"] button:has-text("Create"), ' +
        '[role="dialog"] button:has-text("Save")'
    };

    this.sideNavUsers       = page.locator(this.selectors.sideNavUsers).first();
    this.personaSelector    = page.locator(this.selectors.personaSelector).first();
    this.activeTab          = page.locator(this.selectors.activeTab).first();
    this.pendingTab         = page.locator(this.selectors.pendingTab).first();
    this.suspendedTab       = page.locator(this.selectors.suspendedTab).first();
    this.successModal       = page.locator(this.selectors.successModal).first();
    this.successToast       = page.locator(this.selectors.successToast).first();
    this.duplicateError     = page.locator(this.selectors.duplicateError).first();
    this.duplicateEmailError = page.locator(this.selectors.duplicateEmailError).first();
    this.forbidden          = page.locator(this.selectors.forbidden).first();
    this.createUserButton   = page.locator(this.selectors.createUserButton).first();
    this.fullNameInput      = page.locator(this.selectors.fullNameInput).first();
    this.emailInput         = page.locator(this.selectors.emailInput).first();
    this.roleSelect         = page.locator(this.selectors.roleSelect).first();
    this.submitCreateUser   = page.locator(this.selectors.submitCreateUser).first();
  }

  rowForEmail(email) {
    return this.page.locator(this.selectors.userRow(email)).first();
  }

  async open() {
    const url = new URL(this.basePath, await this.getCurrentUrl()).toString();
    await this.navigate(url);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async navigateToUsers() {
    if (await this.isVisible(this.sideNavUsers)) {
      await this.click(this.sideNavUsers);
    } else {
      await this.open();
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  async selectPersona(persona) {
    if (!persona) return;
    if (await this.isVisible(this.personaSelector)) {
      try {
        await this.personaSelector.selectOption({ label: persona });
        return;
      } catch {
        await this.click(this.personaSelector);
        const item = this.page
          .locator(`[role="option"]:has-text("${persona}"), li:has-text("${persona}")`)
          .first();
        if (await this.isVisible(item)) await this.click(item);
      }
    }
  }

  async openTab(tab) {
    const target = {
      Active:    this.activeTab,
      Pending:   this.pendingTab,
      Suspended: this.suspendedTab
    }[tab];
    if (!target) throw new Error(`Unknown admin tab: ${tab}`);
    await target.waitFor({ state: 'visible', timeout: 10000 });
    await this.click(target);
    await this.page.waitForTimeout(500);
  }

  async isTabVisible(tab) {
    const target = {
      Active:    this.activeTab,
      Pending:   this.pendingTab,
      Suspended: this.suspendedTab
    }[tab];
    return target ? await this.isVisible(target) : false;
  }

  async isRowVisible(email) {
    return await this.isVisible(this.rowForEmail(email));
  }

  async openRowActions(email) {
    const row = this.rowForEmail(email);
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const btn = row.locator(this.selectors.threeDotMenuButton).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    // Wait for at least one menu item to appear so subsequent clicks are reliable.
    await this.page
      .locator(this.selectors.menuItemAny)
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
  }

  async clickRowAction(email, action) {
    await this.openRowActions(email);
    const item = {
      Reactivate:  this.page.locator(this.selectors.menuItemReactivate).first(),
      ResendEmail: this.page.locator(this.selectors.menuItemResendEmail).first()
    }[action];
    if (!item) throw new Error(`Unknown row action: ${action}`);
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await this.click(item);
  }

  async isRowActionAvailable(email, action) {
    try {
      await this.openRowActions(email);
    } catch {
      return false;
    }
    const item = {
      Reactivate:  this.page.locator(this.selectors.menuItemReactivate).first(),
      ResendEmail: this.page.locator(this.selectors.menuItemResendEmail).first()
    }[action];
    if (!item) return false;
    const visible = await this.isVisible(item);
    // Close the menu so it doesn't block subsequent assertions.
    await this.page.keyboard.press('Escape').catch(() => {});
    return visible;
  }

  async hasSuccessModal(timeout = 5000) {
    try {
      await this.successModal.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasSuccessToast(timeout = 5000) {
    try {
      await this.successToast.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasDuplicateError(timeout = 3000) {
    try {
      await this.duplicateError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasDuplicateEmailError(timeout = 3000) {
    try {
      await this.duplicateEmailError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async isForbidden() {
    if (await this.isVisible(this.forbidden)) return true;
    return /403|forbidden|unauthorized/i.test(await this.getCurrentUrl());
  }

  async openCreateUserDialog() {
    await this.click(this.createUserButton);
    await this.fullNameInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  async fillCreateUserForm({ fullName, email, role }) {
    if (fullName !== undefined) await this.type(this.fullNameInput, fullName);
    if (email !== undefined) await this.type(this.emailInput, email);
    if (role !== undefined) {
      if (await this.isVisible(this.roleSelect)) {
        try {
          await this.roleSelect.selectOption({ label: role });
        } catch {
          await this.click(this.roleSelect);
          const opt = this.page
            .locator(`[role="option"]:has-text("${role}"), li:has-text("${role}")`)
            .first();
          if (await this.isVisible(opt)) await this.click(opt);
        }
      }
    }
  }

  async submitCreateUserForm() {
    await this.click(this.submitCreateUser);
  }

  async createUser({ fullName, email, role }) {
    await this.openCreateUserDialog();
    await this.fillCreateUserForm({ fullName, email, role });
    await this.submitCreateUserForm();
  }

  // =========================================================================
  // Live /users layout (verified 2026-07-16)
  //
  // The deployed User Management screen lives at /users (NOT /admin) and is
  // laid out as: a status tab-strip (Active | Pending | Suspended | Inactive),
  // a "Search for User ID" box, and an "Add New User" button that opens a
  // 2-step wizard (Role Selection → Basic Details). Row actions hang off a
  // 3-dot button in each row's last cell ("View Details" / "Mark as Inactive").
  //
  // These methods target that live layout specifically; the older /admin
  // helpers above are kept for backward-compatibility.
  // =========================================================================

  usersUrl() {
    const login =
      process.env.BASE_URL ||
      'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login';
    return login.replace(/\/login.*$/i, '') + '/users';
  }

  /** Navigate straight to /users and wait for the tab-strip to render. */
  async openUsersPage() {
    await this.navigate(this.usersUrl());
    await this.page.waitForLoadState('domcontentloaded');
    await this.page
      .getByRole('tab', { name: /^Active$/i })
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  }

  statusTab(name) {
    return this.page.getByRole('tab', { name: new RegExp(`^${name}$`, 'i') }).first();
  }

  /** Switch to a status tab (Active | Pending | Suspended | Inactive). */
  async openStatusTab(name) {
    const tab = this.statusTab(name);
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await this.page.waitForTimeout(800); // let the grid re-query
  }

  async isStatusTabVisible(name) {
    return await this.isVisible(this.statusTab(name));
  }

  /** Type into the "Search for User ID" box (debounced server-side query). */
  async searchByUserId(id) {
    const box = this.page.getByPlaceholder(/Search for User ID/i).first();
    await box.waitFor({ state: 'visible', timeout: 10000 });
    await box.fill('');
    await box.fill(String(id));
    await this.page.waitForTimeout(1200);
  }

  /** A grid row containing the given text (user id, email, name, …). */
  rowContaining(text) {
    return this.page
      .locator(`[role="row"]:has-text("${text}"), tr:has-text("${text}")`)
      .first();
  }

  async isRowPresent(text) {
    return await this.isVisible(this.rowContaining(text));
  }

  /**
   * True iff a user (matched by id/email/text) is listed under the given tab.
   * Switches to the tab and searches by the identifier first so the row is on
   * the visible page even when the tab holds hundreds of users.
   */
  async isUserInTab(tabName, identifier) {
    await this.openStatusTab(tabName);
    await this.searchByUserId(identifier);
    return await this.isRowPresent(identifier);
  }

  // ---- Add New User wizard -------------------------------------------------

  addNewUserButton() {
    return this.page.getByRole('button', { name: /Add New User/i }).first();
  }

  async openAddUserModal() {
    await this.addNewUserButton().click();
    await this.page
      .getByRole('dialog')
      .getByText(/Role Selection/i)
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  nextButton() {
    return this.page.getByRole('button', { name: /^Next$/ }).first();
  }

  async isNextEnabled() {
    return await this.nextButton().isEnabled().catch(() => false);
  }

  /**
   * Role step: open the multi-select, tick the role by name, then CLOSE the
   * popover before advancing. The role popover renders in an MUI portal whose
   * invisible backdrop intercepts pointer events — clicking "Next" while it is
   * open silently fails (verified 2026-07-16), so we press Escape first.
   */
  async selectRole(roleName) {
    const dialog = this.page.getByRole('dialog');
    await dialog.getByText(/Select A Role/i).first().click();
    const search = this.page.getByPlaceholder(/Search Roles/i).first();
    await search.waitFor({ state: 'visible', timeout: 8000 });
    await search.fill(roleName);
    await this.page.waitForTimeout(400);
    await this.page.getByText(roleName, { exact: true }).last().click();
    await this.page.keyboard.press('Escape'); // dismiss the portal backdrop
    await this.page.waitForTimeout(300);
  }

  async selectRoleAndContinue(roleName) {
    await this.selectRole(roleName);
    await this.nextButton().click();
    await this.page
      .getByRole('textbox', { name: /First Name/i })
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Choose an option from an MUI "combobox" that renders its list in a portal. */
  async pickComboOption(fieldNameRe, optionLabel, { exact = false } = {}) {
    const combo = this.page.getByRole('combobox', { name: fieldNameRe }).first();
    await combo.click();
    // Language-style comboboxes are type-to-filter; Gender-style are not.
    await combo.fill(optionLabel).catch(() => {});
    // Escape regex metacharacters so labels like "English (United States)" are
    // matched literally — otherwise the parens are read as a capture group and
    // the matcher looks for "English United States" (no parens), which never
    // matches the real option text and times out.
    const escaped = optionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const option = exact
      ? this.page.getByRole('option', { name: optionLabel, exact: true }).first()
      : this.page.getByRole('option', { name: new RegExp(escaped, 'i') }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
  }

  async fillBasicDetails({
    firstName,
    lastName,
    email,
    phone = '+15551234567',
    gender = 'Male',
    language = 'English (United States)'
  } = {}) {
    if (firstName !== undefined) await this.page.getByRole('textbox', { name: /First Name/i }).fill(firstName);
    if (lastName !== undefined) await this.page.getByRole('textbox', { name: /Last Name/i }).fill(lastName);
    if (email !== undefined) await this.page.getByRole('textbox', { name: /Email/i }).fill(email);
    if (phone !== undefined) await this.page.getByRole('textbox', { name: /Phone/i }).fill(phone);
    if (gender) await this.pickComboOption(/Gender/i, gender, { exact: true });
    if (language) await this.pickComboOption(/Language/i, language);
  }

  addUserButton() {
    return this.page.getByRole('button', { name: /^Add User$/ }).first();
  }

  async isAddUserEnabled() {
    return await this.addUserButton().isEnabled().catch(() => false);
  }

  async submitAddUser() {
    await this.addUserButton().click();
  }

  /** Full happy-path create through the 2-step wizard. */
  async createUserViaWizard({
    firstName = 'Inactive',
    lastName = 'QAUser',
    email,
    role = 'Monitoring Admin',
    phone,
    gender,
    language
  }) {
    await this.openAddUserModal();
    await this.selectRoleAndContinue(role);
    await this.fillBasicDetails({ firstName, lastName, email, phone, gender, language });
    await this.submitAddUser();
    await this.page.waitForTimeout(1500);
  }

  // ---- Row actions: Mark as Inactive --------------------------------------

  async openRowActionsById(userId) {
    await this.searchByUserId(userId);
    const row = this.rowContaining(userId);
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const btn = row
      .locator('[role="gridcell"]:last-child button, td:last-child button')
      .first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await this.page.getByRole('menuitem').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  markAsInactiveMenuItem() {
    return this.page.getByRole('menuitem', { name: /Mark as Inactive/i }).first();
  }

  viewDetailsMenuItem() {
    return this.page.getByRole('menuitem', { name: /View Details/i }).first();
  }

  /** Row 3-dot → "View Details". Opens the user detail panel/page. */
  async openUserDetails(userId) {
    await this.openRowActionsById(userId);
    await this.viewDetailsMenuItem().click();
    await this.page.waitForTimeout(800);
  }

  /** True if the detail view rendered (panel/dialog or a /users/<id> route). */
  async isUserDetailsOpen(userId) {
    if (/\/users\/[^/]+/i.test(await this.getCurrentUrl())) return true;
    const panel = this.page
      .locator('[role="dialog"], [data-testid="user-details"], aside, [class*="drawer" i]')
      .filter({ hasText: userId ? new RegExp(String(userId)) : /./ })
      .first();
    return await this.isVisible(panel);
  }

  /** True if the row 3-dot menu exposes the given action (for RBAC visibility). */
  async isRowMenuActionAvailable(userId, actionRe) {
    try {
      await this.openRowActionsById(userId);
    } catch {
      return false;
    }
    const item = this.page.getByRole('menuitem', { name: actionRe }).first();
    const visible = await this.isVisible(item);
    await this.page.keyboard.press('Escape').catch(() => {});
    return visible;
  }

  confirmDialog() {
    return this.page.getByRole('dialog').filter({ hasText: /Mark User as Inactive/i }).first();
  }

  /** Active tab → row 3-dot → "Mark as Inactive" → confirm the dialog. */
  async markUserInactive(userId) {
    await this.openRowActionsById(userId);
    await this.markAsInactiveMenuItem().click();
    const dlg = this.confirmDialog();
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    await dlg.getByRole('button', { name: /Mark as Inactive/i }).click();
    await this.page.waitForTimeout(1200);
  }

  /**
   * Reads the numeric User ID from the grid row matching `text` (email local
   * part, username, …). Used when the admin listing API is unavailable (401):
   * the id is displayed in its own column, so we scan the row's cells and
   * return the first pure 4–6 digit value (the leading serial index is a single
   * digit and phone/email cells contain non-digits, so neither is mistaken for
   * the id). Returns null if the row or id can't be found.
   */
  async resolveUserIdByText(text) {
    const row = this.rowContaining(text);
    try {
      await row.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      return null;
    }
    const cells = row.locator('[role="gridcell"], td');
    const count = await cells.count();
    for (let i = 0; i < count; i += 1) {
      const value = ((await cells.nth(i).textContent()) || '').trim();
      if (/^\d{4,6}$/.test(value)) return value;
    }
    return null;
  }

  /**
   * Like markUserInactive, but captures the transient success toast raised by
   * the status change and returns its text ('' if none surfaced in time). The
   * toast auto-dismisses, so it's read immediately after confirming — before
   * the settle wait — rather than afterwards.
   */
  async markUserInactiveCaptureToast(userId) {
    await this.openRowActionsById(userId);
    await this.markAsInactiveMenuItem().click();
    const dlg = this.confirmDialog();
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    await dlg.getByRole('button', { name: /Mark as Inactive/i }).click();
    let text = '';
    const toast = this.page
      .locator('.notistack-MuiContent, .MuiAlert-message, [role="status"], [role="alert"], [data-testid="success-toast"]')
      .first();
    try {
      await toast.waitFor({ state: 'visible', timeout: 6000 });
      text = ((await toast.textContent()) || '').trim();
    } catch { /* toast may auto-dismiss before we read it */ }
    await this.page.waitForTimeout(800);
    return text;
  }

  // ---- Row actions: account recovery (self-healing hook) ------------------
  //
  // Live layout verified 2026-07-18: on the Suspended tab a row's 3-dot menu
  // exposes a single item "Reactivate Account"; on the Pending tab it exposes
  // "Resend Email". Both send an email carrying a reset link and (for Suspended)
  // move the user to Pending. The row is located by numeric User ID when known
  // (the search box is User-ID-only), otherwise by matching the email text on
  // the currently-visible page (the Suspended tab is small — one page).

  /** Locate a row by User ID (preferred) or by any text (e.g. email). */
  rowFor({ userId, text }) {
    return userId ? this.rowContaining(userId) : this.rowContaining(text);
  }

  /** Open a row's 3-dot menu, matching the row by User ID or text. */
  async openRowActionsFor({ userId, text }) {
    if (userId) await this.searchByUserId(userId);
    const row = this.rowFor({ userId, text });
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const btn = row
      .locator('[role="gridcell"]:last-child button, td:last-child button')
      .first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await this.page.getByRole('menuitem').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Suspended tab → row 3-dot → "Reactivate Account". Returns the success-toast
   * text ("Email Sent Successfully") if captured. Moves the user to Pending and
   * sends the "Account Reactivation" email.
   */
  async reactivateSuspendedUser({ userId, email }) {
    await this.openStatusTab('Suspended');
    await this.openRowActionsFor({ userId, text: email });
    await this.page.getByRole('menuitem', { name: /Reactivate Account/i }).first().click();
    return await this.captureRecoveryToast();
  }

  /**
   * Pending tab → row 3-dot → "Resend Email". Returns the success-toast text if
   * captured. Sends the "Action Required: Reset Your NXTSTIM Password" email.
   */
  async resendPendingEmail({ userId, email }) {
    await this.openStatusTab('Pending');
    await this.openRowActionsFor({ userId, text: email });
    await this.page.getByRole('menuitem', { name: /Resend Email/i }).first().click();
    return await this.captureRecoveryToast();
  }

  /** Read the transient success toast raised by a recovery action ('' if missed). */
  async captureRecoveryToast() {
    const toast = this.page
      .locator('.notistack-MuiContent, .MuiAlert-message, [role="alert"], [role="status"], [data-testid="success-toast"]')
      .first();
    try {
      await toast.waitFor({ state: 'visible', timeout: 6000 });
      return ((await toast.textContent()) || '').trim();
    } catch {
      return '';
    }
  }

  /** Open the Mark-as-Inactive confirmation but back out via Cancel. */
  async cancelMarkUserInactive(userId) {
    await this.openRowActionsById(userId);
    await this.markAsInactiveMenuItem().click();
    const dlg = this.confirmDialog();
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    await dlg.getByRole('button', { name: /Cancel/i }).click();
    await this.page.waitForTimeout(500);
  }
}

function cssEscape(s) {
  return String(s).replace(/[^a-z0-9_-]/gi, '_');
}

module.exports = { AdminUsersPage };
