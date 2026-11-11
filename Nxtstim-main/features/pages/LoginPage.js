const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * LoginPage — Page Object for the application login screen.
 * URL: https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login
 *
 * Selectors are layered (data-testid → role/name → input[type] / placeholder)
 * so the POM tolerates small DOM changes without rewriting tests.
 */
class LoginPage extends BasePage {
  constructor(page) {
    super(page);

    // Honor BASE_URL from .env when set; fall back to the preview environment.
    this.url =
      process.env.BASE_URL ||
      'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login';

    this.selectors = {
      emailInput:
        'input[data-testid="email"], ' +
        'input[name="email"], ' +
        'input[type="email"], ' +
        'input[placeholder*="mail" i]',
      passwordInput:
        'input[data-testid="password"], ' +
        'input[name="password"], ' +
        'input[type="password"], ' +
        'input[type="text"][name*="password" i], ' +
        'input[placeholder*="password" i]',
      loginButton:
        '[data-testid="login-button"], ' +
        'button[type="submit"], ' +
        'button:has-text("Login"), ' +
        'button:has-text("Sign in"), ' +
        'button:has-text("Log in")',
      errorMessage:
        '[data-testid="error-message"], ' +
        '[role="alert"], ' +
        '.notistack-SnackbarContainer, .notistack-MuiContent, .notistack-CollapseWrapper, ' +
        '.MuiAlert-message, .MuiAlert-root, ' +
        '.Toastify__toast-body, [class*="toast" i], ' +
        '.error, .error-message, .alert-danger, .text-danger',
      emailFieldError:
        '[data-testid="email-error"], ' +
        '#email-error, ' +
        '#email-helper-text.Mui-error, ' +
        'p.MuiFormHelperText-root.Mui-error',
      passwordFieldError:
        '[data-testid="password-error"], ' +
        '#password-error, ' +
        '#password-helper-text.Mui-error, ' +
        'p.MuiFormHelperText-root.Mui-error',
      logo:
        '[data-testid="logo"], ' +
        'img[alt*="NXT" i], img[alt*="logo" i], ' +
        'a[href="/"] img, header img, ' +
        '[class*="logo" i] img, [class*="logo" i] svg, ' +
        'svg[viewBox="0 0 160 18"], ' +
        'svg[viewBox*="0 0 160"], ' +
        'svg[viewBox*="0 0 111"], ' +
        'div[class*="MuiBox-root"] > svg:not(button svg)',
      passwordToggle:
        '[data-testid="password-toggle"], ' +
        'button[aria-label*="password" i], ' +
        'button[aria-label*="show" i], button[aria-label*="hide" i], ' +
        'button:has(svg[data-testid*="Visibility" i]), ' +
        'button:has([data-testid*="Visibility" i]), ' +
        'button.MuiIconButton-root, ' +
        'button[type="button"]:has(svg)',
      forgotPasswordLink:
        '[data-testid="forgot-password"], ' +
        'a:has-text("Forgot"), ' +
        'a[href*="forgot" i], a[href*="reset" i], ' +
        'button:has-text("Forgot")',
      termsLink:
        '[data-testid="terms-link"], ' +
        'a:has-text("Terms"), ' +
        'a[href*="terms" i], a[href*="tos" i]',
      loadingSpinner:
        '[data-testid="loading"], ' +
        '[role="progressbar"], ' +
        '.MuiCircularProgress-root, .spinner, [class*="spinner" i], [class*="loading" i]'
    };

    this.emailInput = page.locator(this.selectors.emailInput).first();
    this.passwordInput = page.locator(this.selectors.passwordInput).first();
    this.loginButton = page.locator(this.selectors.loginButton).first();
    this.errorMessage = page.locator(this.selectors.errorMessage).first();
    this.emailFieldError = page.locator(this.selectors.emailFieldError).first();
    this.passwordFieldError = page.locator(this.selectors.passwordFieldError).first();
    this.logo = page.locator(this.selectors.logo).first();
    this.passwordToggle = page.locator(this.selectors.passwordToggle).first();
    this.forgotPasswordLink = page.locator(this.selectors.forgotPasswordLink).first();
    this.termsLink = page.locator(this.selectors.termsLink).first();
    this.loadingSpinner = page.locator(this.selectors.loadingSpinner).first();
  }

  async open() {
    await this.navigate(this.url);
    await this.dismissSessionEndedModalIfPresent();
    try {
      await this.waitForLoaded();
    } catch (_) {
      // The SPA occasionally serves a blank/slow first paint (seen under a long
      // suite run). Reload once before giving up.
      await this.navigate(this.url);
      await this.dismissSessionEndedModalIfPresent();
      await this.waitForLoaded();
    }
  }

  /**
   * After a logout the login page can surface a "Session Ended — Your session
   * has expired" modal whose backdrop intercepts clicks on the login button.
   * Dismiss it via "Close" when present; no-op otherwise.
   */
  async dismissSessionEndedModalIfPresent(timeout = 3000) {
    const closeButton = this.page
      .locator(
        'div[role="dialog"]:has-text("Session Ended") button:has-text("Close"), ' +
          'div[role="dialog"]:has-text("session has expired") button:has-text("Close")'
      )
      .first();
    try {
      await closeButton.waitFor({ state: 'visible', timeout });
      await closeButton.click();
      await this.page.waitForTimeout(300);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The form cannot paint until the SPA bundle arrives, and on a cold cache that
   * is a ~26s download from the preview environment (2.34 MB at ~90 KB/s). The
   * first field therefore gets a budget that covers the download; once React has
   * mounted, the other two are already in the same paint.
   */
  async waitForLoaded() {
    await this.emailInput.waitFor({ state: 'visible', timeout: 60000 });
    await this.passwordInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.loginButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  async enterEmail(email) {
    await this.type(this.emailInput, email);
  }

  async enterPassword(password) {
    await this.type(this.passwordInput, password);
  }

  async clickLogin() {
    await this.click(this.loginButton);
  }

  async isLoginButtonDisabled() {
    try {
      return await this.loginButton.isDisabled({ timeout: 3000 });
    } catch {
      return true;
    }
  }

  async isLoginButtonEnabled() {
    try {
      return await this.loginButton.isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async clickLoginIfEnabled() {
    if (await this.isLoginButtonEnabled()) {
      await this.clickLogin();
      return true;
    }
    return false;
  }

  async login(email, password) {
    if (email !== undefined && email !== null) await this.enterEmail(email);
    if (password !== undefined && password !== null) await this.enterPassword(password);
    await this.clickLogin();
  }

  async isOnLoginPage() {
    return (await this.getCurrentUrl()).toLowerCase().includes('/login');
  }

  async getErrorMessageText() {
    if (await this.isVisible(this.errorMessage)) {
      return await this.getText(this.errorMessage);
    }
    return '';
  }

  async hasErrorMessage(timeout = 5000) {
    try {
      await this.errorMessage.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async hasEmailFieldError() {
    if (await this.isVisible(this.emailFieldError)) return true;
    return await this.emailInput.evaluate((el) =>
      el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true'
    );
  }

  async hasPasswordFieldError() {
    if (await this.isVisible(this.passwordFieldError)) return true;
    return await this.passwordInput.evaluate((el) =>
      el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true'
    );
  }

  async expectStillOnLoginPage() {
    await expect(this.page).toHaveURL(/.*\/login.*/i, { timeout: 10000 });
  }

  async expectNavigatedAwayFromLogin() {
    await this.page.waitForURL((url) => !/\/login/i.test(url.toString()), { timeout: 15000 });
  }

  // --- Layout (AC-1) ---
  async isLogoVisible() {
    if (await this.logo.count() === 0) return false;
    try {
      const box = await this.logo.boundingBox();
      if (box && box.width > 0 && box.height > 0) return true;
    } catch {
      // fall through
    }
    return await this.isVisible(this.logo);
  }

  async getEmailPlaceholder() {
    return (await this.emailInput.getAttribute('placeholder')) || '';
  }

  async getPasswordPlaceholder() {
    return (await this.passwordInput.getAttribute('placeholder')) || '';
  }

  async isForgotPasswordLinkVisible() {
    return await this.isVisible(this.forgotPasswordLink);
  }

  async isTermsLinkVisible() {
    return await this.isVisible(this.termsLink);
  }

  // --- Field values (AC-8 retention) ---
  async getEmailValue() {
    return await this.emailInput.inputValue();
  }

  async getPasswordValue() {
    return await this.passwordInput.inputValue();
  }

  // --- Password masking (AC-5) ---
  async getPasswordInputType() {
    return await this.passwordInput.getAttribute('type');
  }

  async isPasswordMasked() {
    const type = await this.getPasswordInputType();
    return type === 'password';
  }

  async togglePasswordVisibility() {
    if (await this.isVisible(this.passwordToggle)) {
      await this.passwordToggle.click();
      return true;
    }
    return false;
  }

  // --- Loading state (AC-6) ---
  async isLoadingShown() {
    return await this.isVisible(this.loadingSpinner);
  }

  async waitForLoadingToAppear(timeout = 5000) {
    try {
      await this.loadingSpinner.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // --- Links (AC-12, AC-13) ---
  async clickForgotPassword() {
    await this.forgotPasswordLink.click();
  }

  async clickTermsOfService() {
    return await this.termsLink.click();
  }

  async getTermsLinkHref() {
    return await this.termsLink.getAttribute('href');
  }
}

module.exports = { LoginPage };
