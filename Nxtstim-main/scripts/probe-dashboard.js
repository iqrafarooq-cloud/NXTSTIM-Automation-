// Captures storage keys before/after logout so we know which keys are
// actually auth-related and which are routing/UI helpers.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  await page.goto(
    'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login',
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForLoadState('networkidle');

  await page.locator('input[type="email"], input[name="email"]').first().fill('uy8ojhef@anonaddy.com');
  await page.locator('input[type="password"], input[name="password"]').first().fill('StrongPass123!');
  await page.locator('button[type="submit"], button:has-text("Login")').first().click();
  await page.waitForURL((u) => !/\/login/i.test(u.toString()), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage)
  }));
  console.log('STORAGE_BEFORE_LOGOUT:', JSON.stringify(before, null, 2));

  await page.locator('header button.MuiIconButton-root:not([aria-label])').first().click();
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]:has-text("Logout")').first().click();
  await page.waitForURL(/\/login/i, { timeout: 10000 });
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage)
  }));
  console.log('STORAGE_AFTER_LOGOUT:', JSON.stringify(after, null, 2));

  await browser.close();
})().catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(1); });
