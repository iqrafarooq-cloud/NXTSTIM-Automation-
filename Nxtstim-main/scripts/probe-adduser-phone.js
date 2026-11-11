/**
 * probe-adduser-phone.js — dev-only follow-up to probe-adduser-validation.js.
 *
 * The wizard shows NO inline error for a malformed phone number and leaves
 * "Add User" enabled. This establishes what actually happens on SUBMIT with a
 * 2-digit phone ("123" -> the mask renders "+1 (23)"): does the backend reject
 * it with a message, or is the user created with a junk number?
 *
 *   node scripts/probe-adduser-phone.js
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const world = {
    browser, context, page,
    pages: {
      login: new LoginPage(page),
      mfa: new MfaPage(page),
      dashboard: new DashboardPage(page),
      users: new UsersPage(page)
    }
  };
  const users = world.pages.users;

  const posts = [];
  page.on('response', async (res) => {
    if (!/\/api\//i.test(res.url()) || res.request().method() !== 'POST') return;
    posts.push({
      url: res.url(),
      status: res.status(),
      request: res.request().postData(),
      body: await res.text().catch(() => '<unreadable>')
    });
  });

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();

    // ---- Is the phone field genuinely required? -------------------------
    // Clear it with REAL keystrokes (fill('') alone does not reach RHF).
    await users.openAddUser();
    await users.selectRoles('Support Staff');
    await users.clickNext();
    const email = flow.uniqueEmail(process.env.USERS_EMAIL || 'users@iqra.anonaddy.com');
    await users.fillBasicDetails({
      firstName: 'Probe', lastName: 'BadPhone', email,
      phone: '5551234567', gender: 'Male', language: 'English (United States)'
    });

    const phone = users.field('Enter Phone Number');
    await phone.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1200);
    log('phone cleared with real keystrokes', {
      fieldValue: await users.fieldValue('Enter Phone Number'),
      messages: await users.validationMessages(),
      actionEnabled: await users.isActionEnabled()
    });

    // ---- Submit with the 2-digit phone ---------------------------------
    await users.typePhoneRaw('123');
    log('before submit', {
      email,
      fieldValue: await users.fieldValue('Enter Phone Number'),
      messages: await users.validationMessages(),
      actionEnabled: await users.isActionEnabled()
    });

    posts.length = 0;
    await users.actionButton().click();
    const toast = await users.captureToast(8000);
    await page.waitForTimeout(2500);
    log('after submit with phone "+1 (23)"', {
      toast,
      dialogStillOpen: await users.isDialogOpen(),
      messages: await users.isDialogOpen() ? await users.validationMessages() : [],
      posts
    });

    // Did it actually land in the list?
    if (!(await users.isDialogOpen())) {
      await users.openTab('Pending');
      await users.searchInField('Email', email);
      const row = await users.findRow('email', email);
      log('grid lookup for the submitted email', { found: !!row, row });
    }
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
