const { BasePage } = require('./BasePage');

/**
 * ChangePasswordModal — Page Object for the in-app "Change Password" modal
 * triggered from the Settings page. Three-step flow:
 *   1. "Enter your current password" → Next
 *   2. "Create a new password"        → Change Password
 *   3. Toast: "Password Changed Successfully."
 *
 * Reuses parts of the CreatePasswordPage rule shape — but as a modal layered
 * over Settings, with a "current password" step ahead of the new-password step.
 */
class ChangePasswordModal extends BasePage {
  constructor(page) {
    super(page);

    this.selectors = {
      modal:
        '[data-testid="change-password-modal"], ' +
        '[role="dialog"], ' +
        '.MuiDialog-root, .MuiModal-root',
      currentPasswordInput:
        'input[data-testid="current-password"], ' +
        'input[name="currentPassword"], input[name="current_password"], ' +
        'input[type="password"][placeholder*="current" i]',
      nextButton:
        '[data-testid="change-password-next"], ' +
        '[role="dialog"] button:has-text("Next"), ' +
        '.MuiDialog-root button:has-text("Next"), ' +
        '.MuiDialog-root button:has-text("Continue")',
      newPasswordInput:
        'input[data-testid="new-password"], ' +
        'input[name="newPassword"], input[name="new_password"], ' +
        '[role="dialog"] input[type="password"]:not([name*="confirm" i]):not([name*="current" i]), ' +
        '.MuiDialog-root input[type="password"]:not([name*="confirm" i]):not([name*="current" i])',
      confirmPasswordInput:
        'input[data-testid="confirm-password"], ' +
        'input[name="confirmPassword"], input[name="confirm_password"], ' +
        '[role="dialog"] input[type="password"][name*="confirm" i], ' +
        '[role="dialog"] input[type="password"][placeholder*="confirm" i]',
      changeButton:
        '[data-testid="change-password-submit"], ' +
        '[role="dialog"] button:has-text("Change Password"), ' +
        '.MuiDialog-root button:has-text("Change Password"), ' +
        '[role="dialog"] button[type="submit"]',
      // Live copy (verified 2026-07-13) is the inline helper text "Incorrect
      // Password" (MuiFormHelperText-root.Mui-error), NOT "Your Current Password
      // is Incorrect". Match that wording, keep the older phrasings, and fall
      // back to any Mui-error helper inside the dialog (only the current-password
      // step surfaces one when Next is clicked with a bad password).
      currentPasswordError:
        '[data-testid="current-password-error"], ' +
        ':text-matches("incorrect password|current password is incorrect|password is incorrect", "i"), ' +
        '[role="dialog"] p.MuiFormHelperText-root.Mui-error',
      // Live copy (verified 2026-07-13) is a notistack TOAST reading "Your
      // Password Can not Be Same As Your Previous 5 Passwords. Please Choose A New
      // Password." (auto-dismisses). Match that wording broadly.
      historyError:
        '.notistack-MuiContent:has-text("Previous"), ' +
        ':text-matches("previous\\s*(5|five)\\s*passwords?|can\\s*not be (the\\s*)?same|cannot be (the\\s*)?same|previously used", "i")',
      successToast:
        '[data-testid="password-change-toast"], ' +
        '.notistack-MuiContent, ' +
        '.MuiAlert-message, ' +
        ':text-matches("password\\s*changed\\s*successfully", "i")',
      strengthBar:
        '[role="dialog"] [role="progressbar"], ' +
        '[role="dialog"] .MuiLinearProgress-root, ' +
        '[role="dialog"] [class*="strength" i]',
      // Step headings — used to tell which of the 3 modal steps is on screen.
      currentPasswordHeading:
        '[role="dialog"] :text-matches("enter your current password", "i")',
      newPasswordHeading:
        '[role="dialog"] :text-matches("create a new password", "i")'
    };

    // Live DOM (verified 2026-07-13): the complexity checklist renders one row
    // per rule as a <div> holding a DIRECT-child <svg> icon + the rule text. A
    // met rule shows a green data-testid="CheckCircleIcon"; an unmet rule shows a
    // red data-testid="CancelIcon". `div:has(> svg)` targets exactly those rows
    // (ancestors contain the text too, but their <svg> is nested, not a direct
    // child), so it never matches the wrapping form/container.
    this.ruleKeywords = {
      length:    'characters minimum',
      uppercase: 'uppercase',
      lowercase: 'lowercase',
      number:    'number',
      special:   'special'
    };

    this.modal                = page.locator(this.selectors.modal).first();
    this.currentPasswordInput = page.locator(this.selectors.currentPasswordInput).first();
    this.nextButton           = page.locator(this.selectors.nextButton).first();
    this.newPasswordInput     = page.locator(this.selectors.newPasswordInput).first();
    this.confirmPasswordInput = page.locator(this.selectors.confirmPasswordInput).first();
    this.changeButton         = page.locator(this.selectors.changeButton).first();
    this.currentPasswordError = page.locator(this.selectors.currentPasswordError).first();
    this.historyError         = page.locator(this.selectors.historyError).first();
    this.successToast         = page.locator(this.selectors.successToast).first();
    this.strengthBar          = page.locator(this.selectors.strengthBar).first();
  }

  async isOpen() {
    return await this.isVisible(this.modal);
  }

  async waitForOpen(timeout = 10000) {
    await this.modal.waitFor({ state: 'visible', timeout });
  }

  async waitForClosed(timeout = 10000) {
    await this.modal.waitFor({ state: 'hidden', timeout });
  }

  /** True while the current-password (step 1) heading is on screen. */
  async isOnCurrentPasswordStep() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.currentPasswordHeading).first())) ||
      (await this.isVisible(this.currentPasswordInput))
    );
  }

  /** True once the new-password (step 2) fields are on screen. */
  async isOnNewPasswordStep() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.newPasswordHeading).first())) ||
      (await this.isVisible(this.newPasswordInput))
    );
  }

  async waitForNewPasswordStep(timeout = 10000) {
    await this.newPasswordInput.waitFor({ state: 'visible', timeout });
  }

  // --- Complexity checklist -------------------------------------------------

  /** Locator for the single checklist row that mentions `keyword`. */
  ruleRow(keyword) {
    return this.page
      .locator(`[role="dialog"] div:has(> svg):has-text("${keyword}")`)
      .last();
  }

  /**
   * Returns 'met' | 'unmet' | 'unknown' for one rule. `ruleName` may be a friendly
   * key (uppercase/lowercase/number/special/length) or any substring of the rule
   * text. Decided by the row's icon: CheckCircleIcon = met, CancelIcon = unmet.
   */
  async isRuleMet(ruleName) {
    const keyword = this.ruleKeywords[String(ruleName).toLowerCase()] || ruleName;
    const row = this.ruleRow(keyword);
    if ((await row.count()) === 0) return 'unknown';
    if ((await row.locator('svg[data-testid="CheckCircleIcon"]').count()) > 0) return 'met';
    if ((await row.locator('svg[data-testid="CancelIcon"]').count()) > 0) return 'unmet';
    return 'unknown';
  }

  /** True only when every one of the five complexity rules reports 'met'. */
  async allRulesMet() {
    for (const key of Object.keys(this.ruleKeywords)) {
      if ((await this.isRuleMet(key)) !== 'met') return false;
    }
    return true;
  }

  async enterCurrentPassword(password) {
    await this.type(this.currentPasswordInput, password);
  }

  async clickNext() {
    await this.click(this.nextButton);
  }

  async submitCurrentPassword(password) {
    await this.enterCurrentPassword(password);
    await this.clickNext();
  }

  async enterNewPassword(password) {
    await this.type(this.newPasswordInput, password);
  }

  async enterConfirmPassword(password) {
    await this.type(this.confirmPasswordInput, password);
  }

  async clickChange() {
    await this.click(this.changeButton);
  }

  async submitNewPassword(newPassword, confirmPassword) {
    await this.enterNewPassword(newPassword);
    await this.enterConfirmPassword(confirmPassword ?? newPassword);
    await this.clickChange();
  }

  async isChangeButtonDisabled() {
    try {
      return await this.changeButton.isDisabled({ timeout: 3000 });
    } catch {
      return true;
    }
  }

  async hasCurrentPasswordError(timeout = 3000) {
    try {
      await this.currentPasswordError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasHistoryError(timeout = 6000) {
    try {
      await this.historyError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Watch for the notistack toast the modal raises on submit and return its text
   * (''. if none appears within `timeout`). The toast auto-dismisses, so call this
   * immediately AFTER clicking the submit button — later steps can't rely on it
   * still being on screen.
   */
  async captureToastText(timeout = 6000) {
    const toast = this.page
      .locator('.notistack-MuiContent, .MuiAlert-message, [role="alert"]')
      .first();
    try {
      await toast.waitFor({ state: 'visible', timeout });
      return (await toast.textContent()) || '';
    } catch {
      return '';
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

  async getStrengthLevel() {
    if ((await this.strengthBar.count()) === 0) return 'unknown';
    const aria = await this.strengthBar.getAttribute('aria-valuenow');
    if (aria != null) {
      const n = Number(aria);
      if (!Number.isNaN(n)) {
        if (n <= 33) return 'red';
        if (n <= 66) return 'orange';
        return 'green';
      }
    }
    const cls = (await this.strengthBar.getAttribute('class')) || '';
    if (/error|red|weak/i.test(cls)) return 'red';
    if (/warning|orange|medium/i.test(cls)) return 'orange';
    if (/success|green|strong/i.test(cls)) return 'green';
    return 'unknown';
  }
}

module.exports = { ChangePasswordModal };
