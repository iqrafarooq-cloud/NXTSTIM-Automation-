/**
 * BasePage — common page actions reused by every Page Object.
 * Keeps individual page classes focused on their own selectors.
 */
class BasePage {
  constructor(page) {
    this.page = page;
  }

  /**
   * Navigation is capped at 10s and does NOT block on the SPA's render-blocking
   * bundle. `domcontentloaded` waits for /assets/index-*.js, which has been seen
   * taking ~60s off this preview environment and timing the whole run out at the
   * login step. `commit` returns as soon as the response lands, and the caller's
   * own "wait for this element" (LoginPage.waitForLoaded, tab strips, grids)
   * decides when the page is actually usable — which is the real readiness
   * signal anyway.
   */
  async navigate(url, attempts = 3) {
    let last;
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.page.goto(url, { waitUntil: 'commit', timeout: 10000 });
        return;
      } catch (err) {
        // The preview host stalls intermittently — measured the same minute, one
        // navigation committed in 1.5s and the next did not respond at all. A
        // short timeout plus a retry beats one long timeout: a healthy host still
        // costs ~1.5s, and a stalled connection is abandoned and re-dialled
        // instead of being waited out.
        last = err;
        if (i < attempts) await this.page.waitForTimeout(1000);
      }
    }
    throw last;
  }

  async getCurrentUrl() {
    return this.page.url();
  }

  async getTitle() {
    return this.page.title();
  }

  async waitForSelector(locator, options = { state: 'visible', timeout: 10000 }) {
    await locator.waitFor(options);
  }

  async type(locator, value) {
    await locator.fill('');
    await locator.fill(String(value));
  }

  async click(locator) {
    await locator.click();
  }

  async isVisible(locator) {
    try {
      return await locator.isVisible();
    } catch {
      return false;
    }
  }

  async getText(locator) {
    return (await locator.textContent())?.trim() ?? '';
  }
}

module.exports = { BasePage };
