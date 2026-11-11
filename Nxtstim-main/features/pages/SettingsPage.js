const { BasePage } = require('./BasePage');

/**
 * SettingsPage — Page Object for the Settings page reached via the profile
 * dropdown → "Settings". Surfaces two primary options per the spec:
 *   1. Change your password   → CTA "Change Password"
 *   2. Two factor authentication → CTA "Enable Two Factor Authentication"
 */
class SettingsPage extends BasePage {
  constructor(page) {
    super(page);

    this.urlPattern = /settings|account/i;

    this.selectors = {
      settingsMenuItem:
        '[data-testid="settings-menu-item"], ' +
        '[role="menuitem"]:has-text("Settings"), ' +
        '.MuiPopover-root.MuiMenu-root li:has-text("Settings")',
      // "Change your password" appears as a heading/label next to a "Change Password" CTA.
      // The CTA is the most reliable anchor — its presence implies the option is on the page.
      changePasswordOption:
        '[data-testid="change-password-option"], ' +
        'h1:has-text("Change your password"), ' +
        'h2:has-text("Change your password"), ' +
        'h3:has-text("Change your password"), ' +
        'h4:has-text("Change your password"), ' +
        'h5:has-text("Change your password"), ' +
        'h6:has-text("Change your password"), ' +
        'strong:has-text("Change your password"), ' +
        'b:has-text("Change your password"), ' +
        'p:has-text("Change your password"), ' +
        'button:has-text("Change Password")',
      changePasswordCta:
        '[data-testid="change-password-cta"], ' +
        'button:has-text("Change Password"), ' +
        'a:has-text("Change Password")',
      // Copy varies by build: the live QA build (verified 2026-07-13) labels this
      // section "Set-up Multifactor Authentication" (a <p>), so match Multifactor
      // / MFA as well as the "Two factor" phrasings.
      twoFactorOption:
        '[data-testid="2fa-option"], ' +
        ':text-matches("multi-?factor authentication|two factor authentication?s?", "i"), ' +
        'h1:has-text("Two factor"), ' +
        'h2:has-text("Two factor"), ' +
        'h3:has-text("Two factor"), ' +
        'h4:has-text("Two factor"), ' +
        'h5:has-text("Two factor"), ' +
        'h6:has-text("Two factor"), ' +
        'strong:has-text("Two factor"), ' +
        'b:has-text("Two factor"), ' +
        'p:has-text("Two factor"), ' +
        'p:has-text("Multifactor"), ' +
        'button:has-text("Two Factor Authentication")',
      // Live build (verified 2026-07-13) labels this button "Enable MFA" — keep
      // the longer "Two Factor" variants for other builds / test-id rollout.
      twoFactorCta:
        '[data-testid="2fa-cta"], ' +
        'button:has-text("Enable MFA"), ' +
        'button:has-text("Enable Two Factor Authentication"), ' +
        'button:has-text("Two Factor")'
    };

    this.settingsMenuItem     = page.locator(this.selectors.settingsMenuItem).first();
    this.changePasswordOption = page.locator(this.selectors.changePasswordOption).first();
    this.changePasswordCta    = page.locator(this.selectors.changePasswordCta).first();
    this.twoFactorOption      = page.locator(this.selectors.twoFactorOption).first();
    this.twoFactorCta         = page.locator(this.selectors.twoFactorCta).first();
  }

  async isOnPage() {
    return this.urlPattern.test(await this.getCurrentUrl());
  }

  async clickSettingsMenuItem() {
    // The post-login Monitoring dashboard keeps re-rendering for a few seconds,
    // which can swap the just-opened MUI menu node mid-click ("element is not
    // stable" / "detached from the DOM"). Wait for the item, try a normal click
    // with a short timeout, then fall back to a force click that skips the
    // stability wait (the node is present, just animating/re-rendering).
    await this.settingsMenuItem.waitFor({ state: 'visible', timeout: 10000 });
    try {
      await this.settingsMenuItem.click({ timeout: 8000 });
    } catch {
      await this.settingsMenuItem.click({ force: true, timeout: 5000 });
    }
  }

  async isChangePasswordOptionVisible() {
    return await this.isVisible(this.changePasswordOption);
  }

  async isTwoFactorOptionVisible() {
    return await this.isVisible(this.twoFactorOption);
  }

  async clickChangePassword() {
    await this.click(this.changePasswordCta);
  }

  async clickEnableTwoFactor() {
    await this.click(this.twoFactorCta);
  }
}

module.exports = { SettingsPage };
