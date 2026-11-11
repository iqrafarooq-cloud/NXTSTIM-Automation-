const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * ForgotPasswordPage — Page Object for the "Forgot Password" screen reached
 * from the login page's "Forgot your password?" link.
 *
 * Selectors are layered (data-testid → role/name → input[type] → MUI/text)
 * so the POM tolerates small DOM changes.
 */
class ForgotPasswordPage extends BasePage {
  constructor(page) {
    super(page);

    this.urlPattern = /forgot|reset|recover/i;
    // After a successful request the app routes to /check-email ("Check Your
    // Email" confirmation screen) which hosts the Resend Email control.
    this.confirmationUrlPattern = /check-email|check-your-email/i;

    this.selectors = {
      emailInput:
        'input[data-testid="forgot-email"], ' +
        'input[data-testid="email"], ' +
        'input[name="email"], ' +
        'input[type="email"], ' +
        'input[placeholder*="mail" i]',
      submitButton:
        '[data-testid="forgot-submit"], ' +
        'button[type="submit"], ' +
        'button:has-text("Send"), ' +
        'button:has-text("Submit"), ' +
        'button:has-text("Reset"), ' +
        'button:has-text("Continue")',
      backToLoginLink:
        '[data-testid="back-to-login"], ' +
        'a:has-text("Back"), ' +
        'a:has-text("Login"), ' +
        'a[href*="login" i]',
      confirmationMessage:
        '[data-testid="forgot-confirmation"], ' +
        '[role="status"], [role="alert"], ' +
        '.notistack-MuiContent, ' +
        '.MuiAlert-message, ' +
        ':text-matches("reset link|check your email|if your email is registered", "i")',
      emailFieldError:
        '[data-testid="email-error"], ' +
        '#email-error, ' +
        '#email-helper-text.Mui-error, ' +
        'p.MuiFormHelperText-root.Mui-error',
      heading:
        '[data-testid="forgot-heading"], ' +
        'h1, h2, h3, ' +
        ':text-matches("forgot password|reset password", "i")',
      // "Check Your Email" confirmation screen (post-submit) --------------------
      confirmationHeading:
        '[data-testid="check-email-heading"], ' +
        'h1, h2, h3, ' +
        ':text-matches("check your email", "i")',
      // The Resend control is a MUI Typography <p>, not a <button>. While the
      // 1-minute cooldown runs it reads "Resend Email in MM:SS" (grey, inert);
      // once elapsed it reads exactly "Resend Email" (blue, cursor:pointer).
      resendControl:
        '[data-testid="resend-email"], ' +
        'button:has-text("Resend Email"), ' +
        'a:has-text("Resend Email"), ' +
        'p:has-text("Resend Email")',
      // Broad match for the "you've hit the max number of resend attempts"
      // notice the app shows after the allowed resends are exhausted.
      maxAttemptsMessage:
        '[data-testid="resend-max-attempts"], ' +
        '[role="alert"], .notistack-MuiContent, .MuiAlert-message, ' +
        ':text-matches("max(imum)? attempt(s)? reached|maximum number of attempts|too many attempts|reached the (maximum|limit)|no longer request|try again later", "i")',
      // After the maximum reset sends the app locks the account: a notice that
      // the account is suspended and to contact support (nxtstim@support.com).
      suspendedMessage:
        '[data-testid="account-suspended"], ' +
        '[role="alert"], .notistack-MuiContent, .MuiAlert-message, ' +
        ':text-matches("suspended|contact .*support|nxtstim@support", "i")',
      // The 30-minute lockout renders as "Max attempt reached, try again in MM:SS".
      maxAttemptCountdown:
        '[data-testid="max-attempt-timer"], ' +
        ':text-matches("max(imum)? attempt(s)? reached|try again in", "i")'
    };

    this.emailInput = page.locator(this.selectors.emailInput).first();
    this.submitButton = page.locator(this.selectors.submitButton).first();
    this.backToLoginLink = page.locator(this.selectors.backToLoginLink).first();
    this.confirmationMessage = page.locator(this.selectors.confirmationMessage).first();
    this.emailFieldError = page.locator(this.selectors.emailFieldError).first();
    this.heading = page.locator(this.selectors.heading).first();
    this.confirmationHeading = page.locator(this.selectors.confirmationHeading).first();
    this.resendControl = page.locator(this.selectors.resendControl).first();
    this.maxAttemptsMessage = page.locator(this.selectors.maxAttemptsMessage).first();
    this.suspendedMessage = page.locator(this.selectors.suspendedMessage).first();
    this.maxAttemptCountdown = page.locator(this.selectors.maxAttemptCountdown).first();
  }

  async waitForLoaded() {
    await this.emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.submitButton.waitFor({ state: 'visible', timeout: 15000 });
  }

  async isOnPage() {
    return this.urlPattern.test(await this.getCurrentUrl());
  }

  async enterEmail(email) {
    await this.type(this.emailInput, email);
  }

  async submit() {
    await this.click(this.submitButton);
  }

  async request(email) {
    await this.enterEmail(email);
    await this.submit();
  }

  async isSubmitDisabled() {
    try {
      return await this.submitButton.isDisabled({ timeout: 3000 });
    } catch {
      return true;
    }
  }

  async isSubmitEnabled() {
    try {
      return await this.submitButton.isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async hasConfirmationMessage(timeout = 5000) {
    try {
      await this.confirmationMessage.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async getConfirmationText() {
    if (await this.isVisible(this.confirmationMessage)) {
      return await this.getText(this.confirmationMessage);
    }
    return '';
  }

  async hasEmailFieldError() {
    if (await this.isVisible(this.emailFieldError)) return true;
    return await this.emailInput.evaluate((el) =>
      el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true'
    );
  }

  async clickBackToLogin() {
    await this.click(this.backToLoginLink);
  }

  // ------------------------------------------------------------------------
  // "Check Your Email" confirmation screen + Resend Email control
  // ------------------------------------------------------------------------

  /** True once the request has routed to the /check-email confirmation screen. */
  async isOnConfirmationScreen() {
    if (this.confirmationUrlPattern.test(await this.getCurrentUrl())) return true;
    return await this.isVisible(this.confirmationHeading);
  }

  async waitForConfirmationScreen(timeout = 15000) {
    try {
      await this.page.waitForURL(this.confirmationUrlPattern, { timeout });
      return true;
    } catch {
      return await this.isVisible(this.confirmationHeading);
    }
  }

  /** Raw text of the resend control, e.g. "Resend Email in 00:43" or "Resend Email". */
  async getResendText() {
    try {
      const raw = await this.resendControl.innerText({ timeout: 5000 });
      return raw.trim().replace(/\s+/g, ' ');
    } catch {
      return '';
    }
  }

  /** Cooldown is active while a MM:SS countdown is shown next to "Resend Email". */
  async isResendCoolingDown() {
    return /\d{1,2}:\d{2}/.test(await this.getResendText());
  }

  /**
   * Enabled = the control reads exactly "Resend Email" (no countdown) AND is
   * interactive (pointer cursor). The disabled state is grey text with a timer.
   */
  async isResendEnabled() {
    const txt = await this.getResendText();
    if (!/resend email/i.test(txt)) return false;
    if (/\d{1,2}:\d{2}/.test(txt)) return false; // countdown still running
    try {
      return await this.resendControl.evaluate((el) => getComputedStyle(el).cursor === 'pointer');
    } catch {
      return true; // no countdown and control present ⇒ treat as enabled
    }
  }

  /** Poll until the cooldown clears and the control becomes clickable. */
  async waitForResendEnabled(timeoutMs = 100000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isResendEnabled()) return true;
      await this.page.waitForTimeout(2000);
    }
    return false;
  }

  /** Seconds remaining on the cooldown countdown, or 0 if none is shown. */
  async getResendCountdownSeconds() {
    const m = (await this.getResendText()).match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
  }

  async clickResend() {
    await this.click(this.resendControl);
  }

  /** True once the "reached the maximum number of attempts" notice is shown. */
  async hasMaxAttemptsMessage(timeout = 5000) {
    try {
      await this.maxAttemptsMessage.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      // Fallback: scan the whole page body for the same wording.
      const body = await this.page.locator('body').innerText().catch(() => '');
      return /max(imum)? attempt(s)? reached|maximum number of attempts|too many attempts|reached the (maximum|limit)|no longer request|try again later/i.test(body);
    }
  }

  /**
   * True once the account-suspended notice is shown after the reset limit is hit,
   * e.g. "Your account is in suspended state. Please contact nxtstim@support.com".
   */
  async hasSuspendedAccountMessage(timeout = 8000) {
    try {
      await this.suspendedMessage.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      const body = await this.page.locator('body').innerText().catch(() => '');
      return /suspended|nxtstim@support|contact\s+.*support/i.test(body);
    }
  }

  /**
   * True once the 30-minute lockout is shown as "Max attempt reached, try again
   * in MM:SS". Requires both the lockout wording AND a MM:SS countdown so it is
   * not confused with the ordinary 1-minute resend cooldown.
   */
  async hasMaxAttemptCountdown(timeout = 8000) {
    try {
      await this.maxAttemptCountdown.waitFor({ state: 'visible', timeout });
    } catch {
      // fall through to the whole-body scan below
    }
    const body = await this.page.locator('body').innerText().catch(() => '');
    const hasLockWording = /max(imum)? attempt(s)? reached|try again in/i.test(body);
    const hasCountdown = /\d{1,2}:\d{2}/.test(body);
    return hasLockWording && hasCountdown;
  }

  /** Seconds remaining on the lockout countdown, or 0 if none is shown. */
  async getMaxAttemptCountdownSeconds() {
    const body = await this.page.locator('body').innerText().catch(() => '');
    const m = body.match(/(\d{1,2}):(\d{2})/);
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
  }
}

module.exports = { ForgotPasswordPage };
