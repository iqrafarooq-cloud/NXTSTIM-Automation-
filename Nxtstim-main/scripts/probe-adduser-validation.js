/**
 * probe-adduser-validation.js — dev-only. Captures the EXACT validation
 * feedback the Add New User wizard produces for the two cases NXT-2000 calls
 * out but the suite currently only asserts disjunctively:
 *
 *   1. an already-used email address
 *   2. a malformed phone number ("123", "abcdefghij")
 *
 * For each case it prints: inline MuiFormHelperText messages, whether the
 * action button is enabled, and any toast raised on submit. Run with:
 *   node scripts/probe-adduser-validation.js
 */
const { chromium } = require('playwright');
const { loadDotenv } = require('../features/support/env');

loadDotenv();

const { LoginPage } = require('../features/pages/LoginPage');
const { MfaPage } = require('../features/pages/MfaPage');
const { DashboardPage } = require('../features/pages/DashboardPage');
const { UsersPage } = require('../features/pages/UsersPage');
const flow = require('../features/support/inactiveUserFlow');

const log = (label, value) => console.log(`\n### ${label}\n${JSON.stringify(value, null, 2)}`);

/** Everything the wizard is currently saying about validity. */
async function snapshot(page, users, label) {
  const messages = await users.validationMessages();
  const actionEnabled = await users.isActionEnabled();
  const actionLabel = await users.actionButtonLabel().catch(() => '');
  // Anything red / error-flagged, even outside MuiFormHelperText.
  const errorish = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] *')]
      .filter((el) => !el.children.length)
      .map((el) => ({ text: (el.textContent || '').trim(), cls: el.className?.toString?.() || '' }))
      .filter((x) => x.text && /error|Mui-error|invalid/i.test(x.cls))
      .map((x) => x.text)
  );
  const ariaInvalid = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] input')]
      .filter((i) => i.getAttribute('aria-invalid') === 'true')
      .map((i) => i.getAttribute('placeholder'))
  );
  log(label, { messages, errorish, ariaInvalid, actionLabel, actionEnabled });
  return { messages, actionEnabled };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const world = {
    browser,
    context,
    page,
    pages: {
      login: new LoginPage(page),
      mfa: new MfaPage(page),
      dashboard: new DashboardPage(page),
      users: new UsersPage(page)
    }
  };
  const users = world.pages.users;

  try {
    console.log('logging in as admin (MFA via IMAP may take ~30s)…');
    await flow.loginAsAdmin(world);
    await users.open();

    // A guaranteed-existing email: whatever the grid's first row holds.
    const rows = await users.readRows();
    const existingEmail = (rows.find((r) => r.email) || {}).email;
    console.log(`existing email taken from the grid: ${existingEmail}`);

    // ---- Case A: phone number formats -----------------------------------
    await users.openAddUser();
    await users.selectRoles('Support Staff');
    await users.clickNext();
    await users.fillBasicDetails({
      firstName: 'Probe',
      lastName: 'Phone',
      email: flow.uniqueEmail(process.env.USERS_EMAIL || 'users@iqra.anonaddy.com'),
      phone: '5551234567',
      gender: 'Male',
      language: 'English (United States)'
    });
    await snapshot(page, users, 'A0 — valid phone 5551234567 (baseline)');
    console.log('phone field value:', await users.fieldValue('Enter Phone Number'));

    for (const bad of ['123', 'abcdefghij', '1', '12345']) {
      await users.typePhoneRaw(bad);
      console.log(`\n--- typed phone "${bad}" -> field reads "${await users.fieldValue('Enter Phone Number')}"`);
      await snapshot(page, users, `A — phone "${bad}"`);
    }

    // Clear it entirely (required-field feedback, for comparison).
    await users.typePhoneRaw('');
    await snapshot(page, users, 'A — phone empty');

    // ---- Case B: email formats ------------------------------------------
    await users.typePhoneRaw('15551234567');
    await users.field('Enter Email Address').fill('invalid-email-format');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);
    await snapshot(page, users, 'B — email "invalid-email-format"');

    // ---- Case C: duplicate email ----------------------------------------
    await users.field('Enter Email Address').fill(existingEmail);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1500);
    const onBlur = await snapshot(page, users, `C1 — duplicate email "${existingEmail}" on blur`);

    if (onBlur.actionEnabled) {
      // Watch the network so we learn the endpoint AND the server's message.
      const responses = [];
      page.on('response', async (res) => {
        if (!/\/api\//i.test(res.url()) || res.request().method() !== 'POST') return;
        responses.push({
          url: res.url(),
          status: res.status(),
          body: await res.text().catch(() => '<unreadable>')
        });
      });
      await users.actionButton().click();
      const toast = await users.captureToast(8000);
      await page.waitForTimeout(1500);
      log('C2 — duplicate email on submit', {
        toast,
        dialogStillOpen: await users.isDialogOpen(),
        responses
      });
      await snapshot(page, users, 'C3 — after duplicate submit');
    }

    // ---- Case D: duplicate email in UPPERCASE ---------------------------
    if (await users.isDialogOpen()) {
      await users.field('Enter Email Address').fill(existingEmail.toUpperCase());
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1200);
      const up = await snapshot(page, users, 'D1 — duplicate email UPPERCASE on blur');
      if (up.actionEnabled) {
        await users.actionButton().click();
        log('D2 — UPPERCASE duplicate on submit', {
          toast: await users.captureToast(8000),
          dialogStillOpen: await users.isDialogOpen()
        });
      }
    }
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
    await page.screenshot({ path: 'reports/probe-adduser-validation.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
