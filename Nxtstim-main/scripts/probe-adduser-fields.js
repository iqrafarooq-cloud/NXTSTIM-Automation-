/**
 * probe-adduser-fields.js — dev-only. Grounds the remaining Add-New-User
 * assertions so none of them are guesses:
 *
 *   1. which malformed email addresses actually raise "Enter a valid email"
 *   2. whether clearing each required field really blocks the action button
 *   3. whether a whitespace-only First Name is rejected
 *   4. Step 3 gating for Nurse (clinic) and Regular Supervisor (clinic + APC)
 *   5. whether the typed data survives the duplicate-email 400
 *
 *   node scripts/probe-adduser-fields.js
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

  const valid = () => ({
    firstName: 'Probe',
    lastName: 'Fields',
    email: flow.uniqueEmail(process.env.USERS_EMAIL || 'users@iqra.anonaddy.com'),
    phone: '5551234567',
    gender: 'Male',
    language: 'English (United States)'
  });

  const state = async () => ({
    messages: await users.validationMessages(),
    actionEnabled: await users.isActionEnabled()
  });

  async function toStep2(role) {
    if (await users.isDialogOpen()) await users.closeDialog();
    await users.openAddUser();
    await users.selectRoles(role);
    await users.clickNext();
    await users.field('Enter First Name').waitFor({ state: 'visible', timeout: 15000 });
  }

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();

    // ---- 1. email formats ------------------------------------------------
    await toStep2('Support Staff');
    await users.fillBasicDetails(valid());
    const emailResults = {};
    for (const candidate of [
      'invalid-email-format', 'no-at-sign.com', 'a@b', 'a@b.c',
      'test @mail.com', 'test@mail', 'test@@mail.com', 'test@mail..com'
    ]) {
      await users.field('Enter Email Address').fill(candidate);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(900);
      emailResults[candidate] = await state();
    }
    log('1 — email formats', emailResults);

    // ---- 2. per-field mandatory gating (cleared with fill('')) ----------
    const clearResults = {};
    const clearers = {
      'First Name': 'Enter First Name',
      'Last Name': 'Enter Last Name',
      'Email Address': 'Enter Email Address',
      'Phone Number': 'Enter Phone Number',
      Gender: 'Select Gender',
      Language: 'Select Language'
    };
    for (const [label, placeholder] of Object.entries(clearers)) {
      await toStep2('Support Staff');
      await users.fillBasicDetails(valid());
      await users.field(placeholder).fill('');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(900);
      clearResults[label] = { ...(await state()), fieldValue: await users.fieldValue(placeholder) };
    }
    log('2 — cleared one required field at a time', clearResults);

    // ---- 3. whitespace-only First Name ---------------------------------
    await toStep2('Support Staff');
    await users.fillBasicDetails(valid());
    await users.field('Enter First Name').fill('   ');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(900);
    log('3 — First Name "   "', await state());

    // ---- 4. Step 3 gating ----------------------------------------------
    for (const role of ['Nurse', 'Regular Supervisor']) {
      await toStep2(role);
      await users.fillBasicDetails(valid());
      await users.clickNext();
      const counter = await users.stepCounter();
      const onArrival = await state();
      const clinics = await users.clinicOptions();
      await users.selectClinics(clinics.find((c) => c && c !== '-') || clinics[0]);
      const afterClinic = await state();
      let afterApc = null;
      if (await users.hasAllowProgramCreation()) {
        await users.selectAllowProgramCreation('No');
        afterApc = await state();
      }
      log(`4 — Step 3 gating for ${role}`, {
        counter,
        onArrival,
        clinicsOffered: clinics.slice(0, 6),
        afterClinic,
        hasAllowProgramCreation: afterApc !== null,
        afterApc
      });
    }

    // ---- 5. does typed data survive the duplicate 400? ------------------
    await users.open();
    const rows = await users.readRows();
    const existing = (rows.find((r) => r.email) || {}).email;
    await toStep2('Support Staff');
    const details = { ...valid(), email: existing };
    await users.fillBasicDetails(details);
    await users.actionButton().click();
    const toast = await users.captureToast(8000);
    await page.waitForTimeout(1500);
    log('5 — after the duplicate-email 400', {
      duplicateUsed: existing,
      toast,
      dialogStillOpen: await users.isDialogOpen(),
      firstName: await users.fieldValue('Enter First Name').catch(() => null),
      lastName: await users.fieldValue('Enter Last Name').catch(() => null),
      email: await users.fieldValue('Enter Email Address').catch(() => null),
      phone: await users.fieldValue('Enter Phone Number').catch(() => null),
      messages: (await users.isDialogOpen()) ? await users.validationMessages() : [],
      stepCounter: await users.stepCounter()
    });
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
