/**
 * probe-adduser-step3.js — dev-only. Confirms Step 3 gating for the
 * multi-select (Supervisor) variant, which probe-adduser-fields.js could not
 * reach: is "Add User" disabled on arrival, still disabled after a clinic is
 * picked, and only enabled once "Allow Program Creation" is answered?
 *
 * Also prints the raw option list so we can see how "Select All" is mixed in
 * with the real clinic names.
 *
 *   node scripts/probe-adduser-step3.js
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
  const state = async () => ({
    messages: await users.validationMessages(),
    actionEnabled: await users.isActionEnabled()
  });

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();

    await users.openAddUser();
    await users.selectRoles('Regular Supervisor');
    await users.clickNext();
    await users.fillBasicDetails({
      firstName: 'Probe', lastName: 'Stepthree',
      email: flow.uniqueEmail(process.env.USERS_EMAIL || 'users@iqra.anonaddy.com'),
      phone: '5551234567', gender: 'Male', language: 'English (United States)'
    });
    // Bonus: the exact message each name field raises for a disallowed character.
    const nameRules = {};
    for (const [placeholder, value] of [
      ['Enter First Name', 'Probe1'],
      ['Enter First Name', 'Probe@'],
      ['Enter Last Name', 'Stepthree3'],
      ['Enter First Name', "O'Brien-Anne"]
    ]) {
      await users.field(placeholder).fill(value);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(900);
      nameRules[`${placeholder} = "${value}"`] = await state();
    }
    log('name character rules', nameRules);
    await users.field('Enter First Name').fill('Probe');
    await users.field('Enter Last Name').fill('Stepthree');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(900);

    log('Step 2 state before advancing', {
      firstName: await users.fieldValue('Enter First Name'),
      lastName: await users.fieldValue('Enter Last Name'),
      email: await users.fieldValue('Enter Email Address'),
      phone: await users.fieldValue('Enter Phone Number'),
      gender: await users.fieldValue('Select Gender'),
      language: await users.fieldValue('Select Language'),
      ...(await state())
    });
    await users.clickNext();

    log('on arrival at Step 3', {
      counter: await users.stepCounter(),
      ...(await state()),
      isMultiSelect: await users.isClinicMultiSelect(),
      hasAllowProgramCreation: await users.hasAllowProgramCreation()
    });

    const raw = await users.clinicOptions();
    log('clinic options (raw, first 10)', raw.slice(0, 10));

    const real = raw.filter((c) => c && !/^select all$/i.test(c.trim()) && c.trim() !== '-');
    console.log(`picking clinic: "${real[0]}"`);
    await users.selectClinics(real[0]);
    log('after selecting ONE clinic', await state());

    const apcOptions = await users.allowProgramCreationOptions();
    log('Allow Program Creation options', apcOptions);

    await users.selectAllowProgramCreation('No');
    log('after answering Allow Program Creation = No', await state());

    // Can more than one clinic be ticked?
    await users.selectClinics(real[1]);
    log('after selecting a SECOND clinic', {
      ...(await state()),
      dialogMentions: (await users.dialogText()).split('\n').filter((l) => /clinic/i.test(l)).slice(0, 8)
    });
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
