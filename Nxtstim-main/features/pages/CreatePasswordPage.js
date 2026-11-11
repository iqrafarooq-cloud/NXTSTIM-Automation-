const { BasePage } = require('./BasePage');

/**
 * CreatePasswordPage — Page Object for the "Create a New Password" screen.
 * This screen is reached after:
 *   - a new user logs in with OTP (onboarding)
 *   - a user clicks a password-reset link
 *   - an admin reactivates an account
 *
 * The screen typically shows:
 *   - New password input + Confirm password input
 *   - Real-time complexity checklist (8 chars, uppercase, lowercase, number, special)
 *   - Strength progress bar (red → orange → green)
 *   - "Reset Password" / "Change Password" submit button (disabled until rules met)
 */
class CreatePasswordPage extends BasePage {
  constructor(page) {
    super(page);

    this.urlPattern = /create.*password|reset.*password|new.*password|set.*password/i;

    // Layered selectors — same strategy as LoginPage
    this.selectors = {
      newPasswordInput:
        'input[data-testid="new-password"], ' +
        'input[name="newPassword"], input[name="new_password"], input[name="password"], ' +
        'input[type="password"]:not([name*="confirm" i]):not([data-testid*="confirm" i])',
      confirmPasswordInput:
        'input[data-testid="confirm-password"], ' +
        'input[name="confirmPassword"], input[name="confirm_password"], ' +
        'input[name*="confirm" i], ' +
        'input[type="password"][placeholder*="confirm" i], ' +
        'input[type="password"]:nth-of-type(2)',
      submitButton:
        '[data-testid="reset-password"], [data-testid="submit-password"], ' +
        'button[type="submit"], ' +
        'button:has-text("Reset Password"), ' +
        'button:has-text("Change Password"), ' +
        'button:has-text("Set Password"), ' +
        'button:has-text("Submit"), ' +
        'button:has-text("Continue")',
      passwordToggle:
        '[data-testid="password-toggle"], ' +
        'button[aria-label*="password" i], ' +
        'button.MuiIconButton-root:has(svg)',
      strengthBar:
        '[data-testid="password-strength"], ' +
        '[role="progressbar"], ' +
        '.MuiLinearProgress-root, ' +
        '[class*="strength" i], [class*="progress" i]',
      checklist:
        '[data-testid="password-checklist"], ' +
        'ul:has(li:has-text("character")), ' +
        'ul:has(li:has-text("uppercase")), ' +
        '[class*="checklist" i], [class*="requirement" i]',
      // Individual checklist items — matched by their text
      ruleMinLength:    'li:has-text("8 character"), :text-matches("8\\s*char", "i")',
      ruleUppercase:    'li:has-text("uppercase"), :text-matches("uppercase", "i")',
      ruleLowercase:    'li:has-text("lowercase"), :text-matches("lowercase", "i")',
      ruleNumber:       'li:has-text("number"), :text-matches("\\bnumber\\b", "i")',
      ruleSpecial:      'li:has-text("special"), :text-matches("special\\s*character", "i")',
      mismatchError:
        '[data-testid="password-mismatch"], ' +
        '#confirm-password-helper-text.Mui-error, ' +
        'p.MuiFormHelperText-root.Mui-error:has-text("match"), ' +
        ':text-matches("password.*not.*match|does not match", "i")',
      historyError:
        ':text-matches("previous\\s*5\\s*passwords?|cannot be same as", "i")',
      successMessage:
        '[data-testid="password-success"], ' +
        '[role="status"], ' +
        '.notistack-MuiContent, .MuiAlert-message, ' +
        ':text-matches("password.*has been.*reset|password.*changed.*successfully", "i")',
      heading:
        'h1, h2, h3, ' +
        ':text-matches("create.*new.*password|reset.*password|set.*password", "i")'
    };

    this.newPasswordInput     = page.locator(this.selectors.newPasswordInput).first();
    this.confirmPasswordInput = page.locator(this.selectors.confirmPasswordInput).first();
    this.submitButton         = page.locator(this.selectors.submitButton).first();
    this.passwordToggle       = page.locator(this.selectors.passwordToggle).first();
    this.strengthBar          = page.locator(this.selectors.strengthBar).first();
    this.checklist            = page.locator(this.selectors.checklist).first();
    this.mismatchError        = page.locator(this.selectors.mismatchError).first();
    this.historyError         = page.locator(this.selectors.historyError).first();
    this.successMessage       = page.locator(this.selectors.successMessage).first();
    this.heading              = page.locator(this.selectors.heading).first();
  }

  async waitForLoaded() {
    await this.newPasswordInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  async isOnPage() {
    return this.urlPattern.test(await this.getCurrentUrl());
  }

  async enterNewPassword(password) {
    await this.type(this.newPasswordInput, password);
  }

  async enterConfirmPassword(password) {
    await this.type(this.confirmPasswordInput, password);
  }

  /**
   * Try to paste a value into the confirm-password field via clipboard.
   * Returns the input's value after the attempt — if paste is blocked
   * (per the Gherkin spec), the value should remain empty.
   */
  async pasteIntoConfirmPassword(value) {
    await this.confirmPasswordInput.click();
    await this.page.evaluate(async (text) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API may be unavailable — paste attempt will simply do nothing.
      }
    }, value);
    // Simulate Ctrl+V paste — if the field has onPaste preventDefault, no value lands.
    await this.confirmPasswordInput.press('Control+V');
    return await this.confirmPasswordInput.inputValue();
  }

  async submit() {
    await this.click(this.submitButton);
  }

  async isSubmitDisabled() {
    try {
      return await this.submitButton.isDisabled({ timeout: 3000 });
    } catch {
      return true;
    }
  }

  async resetPassword(newPassword, confirmPassword) {
    await this.enterNewPassword(newPassword);
    await this.enterConfirmPassword(confirmPassword ?? newPassword);
    await this.submit();
  }

  // --- Rule status helpers --------------------------------------------------

  /**
   * Returns 'met' | 'unmet' | 'unknown' for a single complexity rule, inferred
   * from class hints (e.g. .Mui-success, has-text("✓") vs .Mui-error, ❌).
   */
  async getRuleStatus(ruleSelector) {
    const locator = this.page.locator(ruleSelector).first();
    if ((await locator.count()) === 0) return 'unknown';
    const cls = (await locator.getAttribute('class')) || '';
    const html = (await locator.innerHTML()).toLowerCase();
    if (/met|success|pass|valid|complete|green/i.test(cls)) return 'met';
    if (/unmet|error|fail|invalid|incomplete|red/i.test(cls)) return 'unmet';
    if (/✓|✔|check/i.test(html)) return 'met';
    if (/✕|✗|❌|cross|times/i.test(html)) return 'unmet';
    return 'unknown';
  }

  async isRuleMet(ruleName) {
    const sel = this.selectors[`rule${ruleName}`];
    if (!sel) return 'unknown';
    return await this.getRuleStatus(sel);
  }

  async hasMismatchError(timeout = 3000) {
    try {
      await this.mismatchError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasHistoryError(timeout = 3000) {
    try {
      await this.historyError.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasSuccessMessage(timeout = 5000) {
    try {
      await this.successMessage.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async getSuccessText() {
    if (await this.isVisible(this.successMessage)) {
      return await this.getText(this.successMessage);
    }
    return '';
  }

  /**
   * Read the strength bar's coarse state. Returns 'red' | 'orange' | 'green'
   * | 'unknown' based on aria-valuenow, class names, or inline style.
   */
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

module.exports = { CreatePasswordPage };
