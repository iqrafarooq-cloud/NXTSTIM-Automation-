const { BasePage } = require('./BasePage');

/**
 * LinkExpiredPage — Page Object for the "Link Expired" page shown when a
 * password-reset link is past its 24-hour expiry (or has already been used).
 *
 * Expected elements (per NXT-720):
 *   - Title:   "Link Expired"
 *   - Subtext: "To reset your password, return to the forgot password page..."
 *   - CTA:     "Go to Forgot Password Page"
 *   - Branding: NXTSTIM logo
 */
class LinkExpiredPage extends BasePage {
  constructor(page) {
    super(page);

    this.urlPattern = /link[-_]?expired|expired[-_]?link|invalid[-_]?link/i;

    this.selectors = {
      title:
        '[data-testid="link-expired-title"], ' +
        'h1:has-text("Link Expired"), h2:has-text("Link Expired"), ' +
        ':text-matches("link\\s*expired|link.*has expired|reset link.*expired", "i")',
      subtext:
        '[data-testid="link-expired-subtext"], ' +
        ':text-matches("forgot password page to request a new link", "i")',
      ctaButton:
        '[data-testid="goto-forgot-password"], ' +
        'button:has-text("Go to Forgot Password"), ' +
        'a:has-text("Go to Forgot Password"), ' +
        'button:has-text("Forgot Password Page"), ' +
        'a:has-text("Forgot Password Page")',
      logo:
        '[data-testid="logo"], ' +
        'img[alt*="NXT" i], img[alt*="logo" i], ' +
        '[class*="logo" i] img, [class*="logo" i] svg, ' +
        'svg[viewBox*="0 0 160"], svg[viewBox*="0 0 111"]'
    };

    this.title     = page.locator(this.selectors.title).first();
    this.subtext   = page.locator(this.selectors.subtext).first();
    this.ctaButton = page.locator(this.selectors.ctaButton).first();
    this.logo      = page.locator(this.selectors.logo).first();
  }

  async isOnPage() {
    if (this.urlPattern.test(await this.getCurrentUrl())) return true;
    return await this.isVisible(this.title);
  }

  async isTitleVisible() {
    return await this.isVisible(this.title);
  }

  async isSubtextVisible() {
    return await this.isVisible(this.subtext);
  }

  async isCtaVisible() {
    return await this.isVisible(this.ctaButton);
  }

  async isLogoVisible() {
    if ((await this.logo.count()) === 0) return false;
    try {
      const box = await this.logo.boundingBox();
      if (box && box.width > 0 && box.height > 0) return true;
    } catch {
      // fall through
    }
    return await this.isVisible(this.logo);
  }

  async clickCta() {
    await this.click(this.ctaButton);
  }
}

module.exports = { LinkExpiredPage };
