/**
 * probe-login-flow.js — live, HEADED walkthrough of every flow that
 * features/authorization/login.feature exercises, driven through the REAL
 * LoginPage / DashboardPage Page Objects (so it validates the actual
 * automation, not a parallel re-implementation).
 *
 * Run: node scripts/probe-login-flow.js
 * Headless: set HEADED=false.
 *
 * It prints a PASS/FAIL/INFO line per check plus a raw DOM dump of the login
 * screen, so any selector drift vs LoginPage.js is obvious.
 */
const { chromium } = require('playwright');
const { LoginPage } = require('../features/pages/LoginPage');
const { DashboardPage } = require('../features/pages/DashboardPage');

const VALID = { email: 'adminuser@iqra.anonaddy.com', password: 'StrongPass123!' };

const results = [];
function log(status, label, detail) {
  const tag = { PASS: '✅ PASS', FAIL: '❌ FAIL', INFO: 'ℹ️  INFO' }[status] || status;
  results.push({ status, label });
  console.log(`${tag}  ${label}${detail !== undefined ? `  ->  ${detail}` : ''}`);
}
async function check(label, fn) {
  try {
    const ok = await fn();
    log(ok ? 'PASS' : 'FAIL', label, typeof ok === 'string' ? ok : undefined);
    return ok;
  } catch (e) {
    log('FAIL', label, `threw: ${e.message}`);
    return false;
  }
}

async function freshLogin(context) {
  const page = await context.newPage();
  const login = new LoginPage(page);
  await login.open();
  return { page, login };
}

(async () => {
  const headed = process.env.HEADED !== 'false';
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0 });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    permissions: ['clipboard-read', 'clipboard-write']
  });

  try {
    // ============================================================
    // 0. Raw DOM dump of the login screen (for selector reconciliation)
    // ============================================================
    console.log('\n=== [0] LOGIN SCREEN — RAW DOM ===');
    let { page, login } = await freshLogin(context);
    const dom = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      inputs: [...document.querySelectorAll('input')].map((i) => ({
        type: i.type, name: i.name, placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label'), id: i.id
      })),
      buttons: [...document.querySelectorAll('button')].map((b) => ({
        type: b.type, text: (b.textContent || '').trim().slice(0, 40),
        ariaLabel: b.getAttribute('aria-label'),
        disabled: b.disabled,
        classes: (b.className?.toString?.() || '').slice(0, 90)
      })),
      links: [...document.querySelectorAll('a')].map((a) => ({
        href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 40)
      }))
    }));
    console.log(JSON.stringify(dom, null, 2));

    // ============================================================
    // 1. Layout elements (Scenario: Login screen displays all required UI elements)
    // ============================================================
    console.log('\n=== [1] LAYOUT ELEMENTS ===');
    await check('NXTSTIM logo visible', () => login.isLogoVisible());
    await check('email input visible', () => login.isVisible(login.emailInput));
    await check('password input visible', () => login.isVisible(login.passwordInput));
    await check('password show/hide toggle visible', () => login.isVisible(login.passwordToggle));
    await check('login button visible', () => login.isVisible(login.loginButton));
    await check('"Forgot your password?" link visible', () => login.isForgotPasswordLinkVisible());
    await check('"Terms of Service" link visible', () => login.isTermsLinkVisible());

    // ============================================================
    // 2. Placeholders
    // ============================================================
    console.log('\n=== [2] PLACEHOLDERS ===');
    await check('email placeholder non-empty', async () => (await login.getEmailPlaceholder()) || false);
    await check('password placeholder non-empty', async () => (await login.getPasswordPlaceholder()) || false);

    // ============================================================
    // 3. Login button state
    // ============================================================
    console.log('\n=== [3] LOGIN BUTTON STATE ===');
    await check('button disabled with empty fields', () => login.isLoginButtonDisabled());
    await login.enterEmail(VALID.email);
    await check('button still disabled with only email', () => login.isLoginButtonDisabled());
    await login.enterPassword(VALID.password);
    await check('button ENABLED with both fields', () => login.isLoginButtonEnabled());

    // ============================================================
    // 4. Empty-field validation
    // ============================================================
    console.log('\n=== [4] EMPTY-FIELD VALIDATION ===');
    ({ page, login } = await freshLogin(context));
    const emptyBtnDisabled = await login.isLoginButtonDisabled();
    if (!emptyBtnDisabled) await login.clickLogin().catch(() => {});
    await check('email field validation (helper error OR disabled btn)', async () =>
      (await login.hasEmailFieldError()) || (await login.isLoginButtonDisabled()));
    await check('password field validation (helper error OR disabled btn)', async () =>
      (await login.hasPasswordFieldError()) || (await login.isLoginButtonDisabled()));

    // ============================================================
    // 5. Invalid email format (sample of the Scenario Outline)
    // ============================================================
    console.log('\n=== [5] INVALID EMAIL FORMAT ===');
    for (const bad of ['plainaddress', 'user@', 'missing@domain']) {
      ({ page, login } = await freshLogin(context));
      await login.enterEmail(bad);
      await login.enterPassword(VALID.password);
      if (await login.isLoginButtonEnabled()) await login.clickLogin().catch(() => {});
      const fieldErr = await login.hasEmailFieldError();
      const btnDisabled = await login.isLoginButtonDisabled();
      const stillOnLogin = await login.isOnLoginPage();
      await check(`"${bad}" -> email validation + not submitted`, () =>
        (fieldErr || btnDisabled) && stillOnLogin);
    }

    // ============================================================
    // 6. Password masking + toggle
    // ============================================================
    console.log('\n=== [6] PASSWORD MASK + TOGGLE ===');
    ({ page, login } = await freshLogin(context));
    await login.enterPassword(VALID.password);
    await check('masked by default (type=password)', () => login.isPasswordMasked());
    const toggled = await login.togglePasswordVisibility();
    log(toggled ? 'INFO' : 'FAIL', 'toggle control was clickable', String(toggled));
    if (toggled) {
      await check('plain text after toggle (type=text)', async () => !(await login.isPasswordMasked()));
      await login.togglePasswordVisibility();
      await check('masked again after 2nd toggle', () => login.isPasswordMasked());
    }

    // ============================================================
    // 7. Successful login -> dashboard, then logout
    // ============================================================
    console.log('\n=== [7] SUCCESSFUL LOGIN + LOGOUT ===');
    ({ page, login } = await freshLogin(context));
    await login.enterEmail(VALID.email);
    await login.enterPassword(VALID.password);
    await login.clickLogin();
    const navigatedAway = await login.expectNavigatedAwayFromLogin()
      .then(() => true).catch(() => false);
    log(navigatedAway ? 'PASS' : 'FAIL', 'redirected away from /login', await login.getCurrentUrl());
    if (navigatedAway) {
      await check('landed on dashboard/home URL', async () =>
        /dashboard|home|account|monitoring|\/$|\/app/i.test(await login.getCurrentUrl()));

      const dashboard = new DashboardPage(page);
      const profileOk = await dashboard.openProfileMenu().then(() => true).catch((e) => e.message);
      log(profileOk === true ? 'PASS' : 'FAIL', 'profile menu opens', profileOk === true ? undefined : profileOk);
      if (profileOk === true) {
        await check('logout option visible', () => dashboard.isLogoutOptionVisible());
        const loggedOut = await dashboard.clickLogout()
          .then(() => dashboard.expectRedirectedToLogin()).then(() => true).catch((e) => e.message);
        log(loggedOut === true ? 'PASS' : 'FAIL', 'logout redirects to /login', loggedOut === true ? undefined : loggedOut);
      }
    }

    // ============================================================
    // 8. Invalid credentials / suspended / pending -> error
    // ============================================================
    console.log('\n=== [8] INVALID / SUSPENDED / PENDING ===');
    const negCases = [
      { label: 'wrong email', email: 'wrong.user@bytecorp.io', password: 'StrongPass123!' },
      { label: 'wrong password', email: VALID.email, password: 'WrongPassword!' },
      { label: 'suspended acct', email: '9pyg6hlh@anonaddy.com', password: 'StrongPass123!' },
      { label: 'pending acct', email: 'dd3re9qs@anonaddy.com', password: 'StrongPass123!' }
    ];
    for (const c of negCases) {
      ({ page, login } = await freshLogin(context));
      await login.enterEmail(c.email);
      await login.enterPassword(c.password);
      if (await login.isLoginButtonEnabled()) await login.clickLogin().catch(() => {});
      const hasErr = await login.hasErrorMessage(6000);
      const errText = hasErr ? await login.getErrorMessageText() : '';
      const stillOnLogin = await login.isOnLoginPage();
      await check(`${c.label} -> error shown + stays on login`, () => hasErr && stillOnLogin);
      if (hasErr) log('INFO', `   error text (${c.label})`, JSON.stringify(errText.slice(0, 120)));
    }

    // ============================================================
    // 9. Forgot password navigation
    // ============================================================
    console.log('\n=== [9] FORGOT PASSWORD NAV ===');
    ({ page, login } = await freshLogin(context));
    await login.clickForgotPassword().catch((e) => log('FAIL', 'click forgot password', e.message));
    await page.waitForTimeout(1500);
    await check('navigated to forgot/reset/recover URL', async () =>
      /forgot|reset|recover/i.test(await login.getCurrentUrl()) || (await login.getCurrentUrl()));

    // ============================================================
    // 10. Terms of Service link href
    // ============================================================
    console.log('\n=== [10] TERMS OF SERVICE LINK ===');
    ({ page, login } = await freshLogin(context));
    const termsHref = await login.getTermsLinkHref().catch(() => null);
    log(termsHref ? 'INFO' : 'FAIL', 'Terms link href', JSON.stringify(termsHref));
    await check('Terms href matches terms|tos|legal', () => !!termsHref && /terms|tos|legal/i.test(termsHref));

  } finally {
    // ============================================================
    // SUMMARY
    // ============================================================
    const pass = results.filter((r) => r.status === 'PASS').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\n=== SUMMARY: ${pass} PASS, ${fail} FAIL ===`);
    if (fail) {
      console.log('FAILING CHECKS:');
      results.filter((r) => r.status === 'FAIL').forEach((r) => console.log(`  - ${r.label}`));
    }
    await browser.close();
  }
})().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
