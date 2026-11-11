const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * DashboardPage — Page Object for the post-login application surface.
 * Currently focused on the profile menu / logout flow.
 *
 * Selectors are layered (data-testid → role/aria → MUI structural fallback)
 * so the POM tolerates small DOM changes.
 */
class DashboardPage extends BasePage {
  constructor(page) {
    super(page);

    this.selectors = {
      // The profile trigger in this app is a cursor-pointer container in the
      // <header> holding an <img alt="profile">, the user's name ("admin auth")
      // and a chevron button — it is NOT a <button> and has no aria-label, so
      // the avatar image is the most stable anchor. Clicking it bubbles to the
      // React onClick on the wrapping div and opens the menu. Older builds may
      // still expose an MUI IconButton/avatar, so those candidates are kept.
      profileButton:
        '[data-testid="profile-button"], ' +
        '[data-testid="account-menu"], ' +
        'header img[alt*="profile" i], ' +
        'button[aria-label*="profile" i], ' +
        'button[aria-label*="account" i], ' +
        'header button:has(.MuiAvatar-root), ' +
        'button:has(.MuiAvatar-root), ' +
        'header button.MuiIconButton-root:not([aria-label]):not([aria-label="open drawer"])',
      profileMenu:
        'div.MuiPopover-root.MuiMenu-root.MuiModal-root, ' +
        '.MuiPopover-root.MuiMenu-root, ' +
        '[role="menu"]',
      logoutOption:
        '[data-testid="logout"], ' +
        '[data-testid="logout-button"], ' +
        '[role="menuitem"]:has-text("Logout"), ' +
        '[role="menuitem"]:has-text("Log out"), ' +
        '[role="menuitem"]:has-text("Sign out"), ' +
        '.MuiPopover-root.MuiMenu-root li:has-text("Logout"), ' +
        '.MuiPopover-root.MuiMenu-root li:has-text("Log out"), ' +
        '.MuiPopover-root.MuiMenu-root li:has-text("Sign out")'
    };

    this.profileButton = page.locator(this.selectors.profileButton).first();
    this.profileMenu = page.locator(this.selectors.profileMenu).first();
    this.logoutOption = page.locator(this.selectors.logoutOption).first();
  }

  async waitForLoaded() {
    await this.page.waitForLoadState('domcontentloaded');
    await this.profileButton.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * Wait until the post-login landing surface (the Monitoring dashboard) has
   * settled enough to reliably drive the profile menu. That page is heavy and
   * keeps loading for several seconds after the header paints, so clicking the
   * profile trigger / navigating to Settings too early is slow and flaky.
   *
   * We hold a single fixed 10s dwell on the Monitoring page, then proceed.
   * We deliberately do NOT add a separate (up to 30s) profile-button gate on
   * top of this buffer — that made the total dwell unpredictable and far longer
   * than the buffer. openProfileMenu() already waits up to 10s for the button
   * before clicking, so the menu navigation stays reliable.
   *
   * Tune the dwell with DASHBOARD_SETTLE_MS (default 10000ms; set higher on a
   * slow environment). Set it to 0 to skip the dwell entirely.
   */
  async waitForReady() {
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    const settleMs = Number(process.env.DASHBOARD_SETTLE_MS || 10000);
    if (settleMs > 0) await this.page.waitForTimeout(settleMs);
  }

  async isProfileButtonVisible() {
    return await this.isVisible(this.profileButton);
  }

  async openProfileMenu() {
    await this.profileButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.click(this.profileButton);
    await this.profileMenu.waitFor({ state: 'visible', timeout: 5000 });
  }

  async isProfileMenuOpen() {
    return await this.isVisible(this.profileMenu);
  }

  async isLogoutOptionVisible() {
    return await this.isVisible(this.logoutOption);
  }

  async clickLogout() {
    await this.logoutOption.waitFor({ state: 'visible', timeout: 5000 });
    await this.click(this.logoutOption);
  }

  async logout() {
    await this.openProfileMenu();
    await this.clickLogout();
  }

  async expectRedirectedToLogin() {
    await this.page.waitForURL(/.*\/login.*/i, { timeout: 15000 });
  }

  async isOnLoginPage() {
    return (await this.getCurrentUrl()).toLowerCase().includes('/login');
  }
}

module.exports = { DashboardPage };
