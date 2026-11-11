/**
 * Probe: observe what the "Enable MFA" click does on the Email Verification path.
 * Dev-only diagnostic — not part of the cucumber run.
 *
 *   node scripts/probe-email-mfa.js
 */
const { chromium } = require('playwright');
const { loadDotenv } = require('../features/support/env');
loadDotenv();

const { LoginPage } = require('../features/pages/LoginPage');
const { DashboardPage } = require('../features/pages/DashboardPage');
const { SettingsPage } = require('../features/pages/SettingsPage');
const { MfaPage } = require('../features/pages/MfaPage');

const EMAIL = process.env.TEST_USER_EMAIL || 'adminuser@iqra.anonaddy.com';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'StrongPass123!';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // ---- Instrument network: log every request the SPA fires. -----------------
  page.on('request', (req) => {
    if (req.method() !== 'GET') {
      console.log(`  [net→] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', async (res) => {
    if (res.request().method() !== 'GET') {
      console.log(`  [net←] ${res.status()} ${res.request().method()} ${res.url()}`);
      if (res.status() >= 400) {
        const body = await res.text().catch(() => '<no body>');
        console.log(`        body: ${body.slice(0, 600)}`);
        const reqBody = res.request().postData();
        if (reqBody) console.log(`        request payload: ${reqBody.slice(0, 400)}`);
      }
    }
  });

  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const settings = new SettingsPage(page);
  const mfa = new MfaPage(page);

  try {
    console.log('1) Logging in as', EMAIL);
    await login.open();
    await login.login(EMAIL, PASSWORD);
    await page.waitForTimeout(2500);
    console.log('   url after login:', page.url());

    // If the account is still on an MFA challenge, bail loudly — the probe
    // targets the no-MFA "enable" flow.
    if (/mfa-verify/i.test(page.url())) {
      console.log('   ⚠ landed on /mfa-verify — account has MFA enabled; disable it first.');
    }

    console.log('2) Opening Settings');
    await dashboard.waitForReady().catch(() => {});
    await dashboard.openProfileMenu();
    await settings.clickSettingsMenuItem();
    await page.waitForTimeout(1500);
    console.log('   on settings page:', await settings.isOnPage().catch(() => 'unknown'));

    console.log('3) Method state BEFORE select:',
      'auth=', await mfa.isMethodEnabled('Authenticator App'),
      'email=', await mfa.isMethodEnabled('Email Verification'));

    console.log('4) Selecting "Email Verification" radio');
    await mfa.selectMfaMethod('Email Verification');
    const emailRadio = mfa.getMethodRadio('Email Verification');
    console.log('   radio checked:', await emailRadio.isChecked().catch((e) => 'err:' + e.message));

    // Inspect the Enable button the POM would click.
    const enableBtn = page.locator(mfa.selectors.enableMfaButton).first();
    const btnCount = await page.locator(mfa.selectors.enableMfaButton).count();
    console.log('5) Enable button — matches:', btnCount,
      '| text:', JSON.stringify((await enableBtn.textContent().catch(() => '')).trim()),
      '| visible:', await enableBtn.isVisible().catch(() => false),
      '| enabled:', await enableBtn.isEnabled().catch(() => false));

    console.log('6) Clicking Enable MFA — watching for network + DOM change');
    await enableBtn.click();
    await page.waitForTimeout(6000);

    console.log('7) url after click:', page.url());
    const dialogCount = await page.locator('div[role="dialog"]').count();
    console.log('   dialogs on screen:', dialogCount);
    if (dialogCount) {
      const dlgText = (await page.locator('div[role="dialog"]').first().innerText().catch(() => '')).slice(0, 400);
      console.log('   dialog text:', JSON.stringify(dlgText));
    }
    console.log('   code inputs visible:', await mfa.isCodeInputScreenVisible().catch(() => false));
    console.log('   Enable button still visible after click:', await enableBtn.isVisible().catch(() => false));

    // Dump every button now visible so we can see if the label changed.
    const btns = await page.locator('button:visible').allTextContents();
    console.log('   visible buttons:', JSON.stringify(btns.map((b) => b.trim()).filter(Boolean)));

    console.log('\nProbe complete. Leaving browser open 20s for inspection.');
    await page.waitForTimeout(20000);
  } catch (err) {
    console.error('Probe error:', err);
  } finally {
    await context.close();
    await browser.close();
  }
})();
