const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * SupervisorsPage — Page Object for Accounts > Supervisors and the
 * Add Supervisor modal.
 *
 * Selector strategy follows the project convention:
 *   data-testid -> role/aria/name -> semantic HTML/MUI structural fallback
 */
class SupervisorsPage extends BasePage {
  constructor(page) {
    super(page);

    this.url = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/supervisors';

    this.selectors = {
      // Page-level
      pageHeading:
        '[data-testid="supervisors-heading"], ' +
        'main p:has-text("Supervisors")',
      addSupervisorButton:
        '[data-testid="add-supervisor-button"], ' +
        'main button:has-text("Add Supervisor")',
      tab: (name) =>
        `[data-testid="tab-${name.toLowerCase()}"], ` +
        `[role="tab"]:has-text("${name}")`,
      gridRow:
        '[data-testid="supervisor-row"], ' +
        'div[role="rowgroup"] [role="row"]',

      // Modal
      dialog:
        '[data-testid="add-supervisor-dialog"], ' +
        'div[role="dialog"]',
      dialogTitle:
        '[data-testid="add-supervisor-title"], ' +
        'div[role="dialog"] p:has-text("Add Supervisor")',
      closeXButton:
        '[data-testid="add-supervisor-close"], ' +
        'div[role="dialog"] > div:first-child button',

      // Form fields (inside dialog)
      clinicCombobox:
        '[data-testid="supervisor-clinic"], ' +
        'div[role="dialog"] [role="combobox"][placeholder="Select Clinic"]',
      programCreationCombobox:
        '[data-testid="supervisor-allow-program"], ' +
        'div[role="dialog"] [role="combobox"][placeholder="Select Option"]',
      firstNameInput:
        '[data-testid="supervisor-first-name"], ' +
        'div[role="dialog"] input[name="firstName"]',
      lastNameInput:
        '[data-testid="supervisor-last-name"], ' +
        'div[role="dialog"] input[name="lastName"]',
      emailInput:
        '[data-testid="supervisor-email"], ' +
        'div[role="dialog"] input[name="email"]',
      phoneInput:
        '[data-testid="supervisor-phone"], ' +
        'div[role="dialog"] input[type="tel"]',
      genderCombobox:
        '[data-testid="supervisor-gender"], ' +
        'div[role="dialog"] [role="combobox"][placeholder="Select Gender"]',
      languageCombobox:
        '[data-testid="supervisor-language"], ' +
        'div[role="dialog"] [role="combobox"][placeholder="Select Language"]',

      // Footer buttons
      cancelButton:
        '[data-testid="supervisor-cancel"], ' +
        'div[role="dialog"] button:has-text("Cancel")',
      submitButton:
        '[data-testid="supervisor-submit"], ' +
        'div[role="dialog"] button.MuiButton-mainPrimary:has-text("Add Supervisor")',

      // Listbox (Autocomplete dropdown — appended to body, NOT inside dialog).
      // Use has-text + role for forgiving substring matching that survives
      // virtualization and minor whitespace differences.
      listboxOption: (text) =>
        `li[role="option"]:has-text("${text}")`,

      // Validation
      fieldError:
        'div[role="dialog"] p.MuiFormHelperText-root.Mui-error',

      // 3-dot kebab menu on a row + its menu items. The kebab is rendered
      // inside the row; the popover menu mounts at <body> so we scope items
      // by role rather than DOM ancestry.
      rowKebabButton:
        '[data-testid="row-actions"], ' +
        'button[aria-label*="actions" i], ' +
        'button[aria-label*="more" i], ' +
        'button:has(svg[data-testid="MoreVertIcon"]), ' +
        'button:has(svg[data-testid*="MoreVert" i]), ' +
        'button.MuiIconButton-root:has(svg)',
      menuItem: (label) =>
        `[role="menuitem"]:has-text("${label}"), ` +
        `li[role="menuitem"]:has-text("${label}"), ` +
        `.MuiPopover-root [role="menuitem"]:has-text("${label}")`,

      // Toast / success notice after admin actions like Reactivate.
      toast:
        '.notistack-MuiContent, .MuiAlert-message, [role="status"], [role="alert"]'
    };

    // Locators
    this.pageHeading = page.locator(this.selectors.pageHeading).first();
    this.addSupervisorButton = page.locator(this.selectors.addSupervisorButton).first();
    this.dialog = page.locator(this.selectors.dialog);
    this.dialogTitle = page.locator(this.selectors.dialogTitle).first();
    this.closeXButton = page.locator(this.selectors.closeXButton).first();

    this.clinicCombobox = page.locator(this.selectors.clinicCombobox).first();
    this.programCreationCombobox = page.locator(this.selectors.programCreationCombobox).first();
    this.firstNameInput = page.locator(this.selectors.firstNameInput).first();
    this.lastNameInput = page.locator(this.selectors.lastNameInput).first();
    this.emailInput = page.locator(this.selectors.emailInput).first();
    this.phoneInput = page.locator(this.selectors.phoneInput).first();
    this.genderCombobox = page.locator(this.selectors.genderCombobox).first();
    this.languageCombobox = page.locator(this.selectors.languageCombobox).first();

    this.cancelButton = page.locator(this.selectors.cancelButton).first();
    this.submitButton = page.locator(this.selectors.submitButton).first();
    this.fieldErrors = page.locator(this.selectors.fieldError);
  }

  // ---- Navigation ----
  async open() {
    await this.navigate(this.url);
    await this.waitForLoaded();
  }

  async waitForLoaded() {
    await this.addSupervisorButton.waitFor({ state: 'visible', timeout: 15000 });
  }

  async openAddSupervisorModal() {
    await this.click(this.addSupervisorButton);
    await this.dialog.first().waitFor({ state: 'visible', timeout: 10000 });
  }

  async isModalOpen() {
    return await this.isVisible(this.dialog.first());
  }

  async waitForModalClosed(timeout = 10000) {
    await this.dialog.first().waitFor({ state: 'hidden', timeout });
  }

  // ---- Field setters ----
  async selectAutocompleteOption(combobox, optionText) {
    await this.click(combobox);
    // Use exact role-based match: avoids :has-text substring collisions
    // ("Male" inside "Female") and :text-is parentheses parsing issues.
    const option = this.page.getByRole('option', { name: optionText, exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 8000 });
    await option.click();
  }

  async selectClinic(name) {
    await this.selectAutocompleteOption(this.clinicCombobox, name);
  }

  async selectProgramCreation(value) {
    await this.selectAutocompleteOption(this.programCreationCombobox, value);
  }

  async selectGender(value) {
    await this.selectAutocompleteOption(this.genderCombobox, value);
  }

  async selectLanguage(value) {
    await this.selectAutocompleteOption(this.languageCombobox, value);
  }

  async enterFirstName(value) {
    await this.type(this.firstNameInput, value);
  }

  async enterLastName(value) {
    await this.type(this.lastNameInput, value);
  }

  async enterEmail(value) {
    await this.type(this.emailInput, value);
  }

  async enterPhone(value) {
    await this.phoneInput.click();
    await this.phoneInput.fill('');
    await this.phoneInput.type(value);
  }

  async fillForm(data) {
    if (data.clinic) await this.selectClinic(data.clinic);
    if (data.allowProgramCreation) await this.selectProgramCreation(data.allowProgramCreation);
    if (data.firstName) await this.enterFirstName(data.firstName);
    if (data.lastName) await this.enterLastName(data.lastName);
    if (data.email) await this.enterEmail(data.email);
    if (data.phone) await this.enterPhone(data.phone);
    if (data.gender) await this.selectGender(data.gender);
    if (data.language) await this.selectLanguage(data.language);
  }

  // ---- Submit / cancel ----
  // The modal-footer wrapper sometimes intercepts MUI ripple clicks, so we
  // fall back to a programmatic click if the normal click is blocked.
  async submit() {
    try {
      await this.submitButton.click({ timeout: 3000 });
    } catch {
      await this.submitButton.evaluate((el) => el.click());
    }
  }

  async clickCancel() {
    await this.click(this.cancelButton);
  }

  async clickCloseX() {
    await this.click(this.closeXButton);
  }

  // ---- Validation ----
  async getValidationErrors() {
    const texts = await this.fieldErrors.allTextContents();
    // MUI helper-text wraps "​" (zero-width space) when no error — filter those.
    return texts
      .map((t) => t.trim())
      .filter((t) => t && t !== '​');
  }

  // ---- Tabs / grid ----
  async switchToTab(name) {
    const tab = this.page.locator(this.selectors.tab(name)).first();
    await tab.click();
    await this.page.waitForTimeout(800);
  }

  async findSupervisorRowByEmail(email) {
    const rows = this.page.locator(this.selectors.gridRow);
    return rows.filter({ hasText: email }).first();
  }

  async isSupervisorPresent(email, timeout = 5000) {
    const row = await this.findSupervisorRowByEmail(email);
    try {
      await row.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Field values ----
  async getFormValues() {
    return {
      firstName: await this.firstNameInput.inputValue(),
      lastName: await this.lastNameInput.inputValue(),
      email: await this.emailInput.inputValue(),
      clinic: await this.clinicCombobox.inputValue(),
      gender: await this.genderCombobox.inputValue(),
      language: await this.languageCombobox.inputValue()
    };
  }

  // ---- Row actions: kebab menu + reactivate ----
  /**
   * Opens the 3-dot action menu on the row that matches `email`. The kebab
   * popover mounts at <body>, so callers should then resolve menu items via
   * `clickMenuItem(label)` rather than scoping inside the row.
   */
  async openRowKebab(email) {
    const row = await this.findSupervisorRowByEmail(email);
    await row.waitFor({ state: 'visible', timeout: 8000 });
    const kebab = row.locator(this.selectors.rowKebabButton).last();
    await kebab.waitFor({ state: 'visible', timeout: 5000 });
    await kebab.click();
    // Give MUI's Popper a tick to mount.
    await this.page.waitForTimeout(300);
  }

  async clickMenuItem(label) {
    const item = this.page.locator(this.selectors.menuItem(label)).first();
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
  }

  /**
   * Opens the kebab on the user's current-tab row and clicks the
   * "Reactivate" menu item. Caller is expected to be on the Suspended tab.
   */
  async reactivateUser(email) {
    await this.openRowKebab(email);
    await this.clickMenuItem('Reactivate');
  }

  async waitForToast(matcher, timeout = 8000) {
    const re = matcher instanceof RegExp ? matcher : new RegExp(matcher, 'i');
    const toast = this.page
      .locator(this.selectors.toast)
      .filter({ hasText: re })
      .first();
    await toast.waitFor({ state: 'visible', timeout });
    return await toast.textContent();
  }

  // ---- Helpers ----
  static buildValidSupervisor(overrides = {}) {
    const ts = Date.now().toString().slice(-7);
    return {
      clinic: 'healthcare',
      allowProgramCreation: 'Yes',
      firstName: 'Iqra',
      lastName: 'QATester',
      // Anonaddy plus-tag aliases — anything addressed to auth+<tag>@iqra.anonaddy.com
      // forwards to GMAIL_USER (iqra.farooq@bytecorp.io) so the IMAP poller can read it.
      email: `auth+sup-${ts}@iqra.anonaddy.com`,
      phone: '3105648721',
      gender: 'Male',
      language: 'English (United States)',
      ...overrides
    };
  }
}

module.exports = { SupervisorsPage };
