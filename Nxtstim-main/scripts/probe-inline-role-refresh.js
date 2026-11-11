/**
 * probe-inline-role-refresh.js — dev-only follow-up to probe-inline-role.js.
 *
 * probe-inline-role.js left three questions open:
 *   1. Is a role created from inside the wizard really absent from the Role
 *      dropdown, or did that read just hit the popover that was already open
 *      (and therefore stale) when the drawer was dismissed?
 *   2. What are the "Single" / "Multiple" clinic-assignment controls made of?
 *      They are neither <button>/[role=button] nor input[type=radio].
 *   3. Can the Roles tab delete a role with 0 users, so the scenario can tidy
 *      up after itself?
 *
 *   node scripts/probe-inline-role-refresh.js
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
const safe = async (fn, fb = 'ERR') => { try { return await fn(); } catch (e) { return `${fb}: ${e.message.split('\n')[0]}`; } };

const DRAWER = '.MuiDrawer-modal .MuiDrawer-paper';

/** Close the role popover for real, then reopen it and read the options fresh. */
async function freshRoleOptions(page, users) {
  // closeAnyPopover(), never a bare Escape: with no popover mounted the key
  // press reaches the wizard and closes the whole thing.
  await users.closeAnyPopover();
  await page.waitForTimeout(400);
  await users.openRoleDropdown();
  await page.waitForTimeout(600);
  return await page.evaluate(() => {
    const p = document.querySelector('.c-multi-select-dropdown-popover');
    return p ? [...p.querySelectorAll('p.option-label')].map((o) => o.textContent.trim()) : [];
  });
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const world = {
    browser, context, page,
    pages: { login: new LoginPage(page), mfa: new MfaPage(page), dashboard: new DashboardPage(page), users: new UsersPage(page) }
  };
  const users = world.pages.users;
  const ROLE = `QA Inline ${String(Date.now()).slice(-6)}`;

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();
    await users.openAddUser();

    const before = await freshRoleOptions(page, users);
    log('1. role options BEFORE', { total: before.length });

    await users.clickCreateNewRole();
    await page.locator(DRAWER).first().locator('[placeholder="Add role name"]').fill(ROLE);
    await page.locator(DRAWER).first().locator('[placeholder="Describe the Role"]').fill('Probe inline role');
    await page.locator(DRAWER).first().locator('.MuiSwitch-root input').first().click({ force: true });
    await page.waitForTimeout(1000);

    // Q2 — what ARE the Single / Multiple controls?
    log('2. Single / Multiple markup', await page.evaluate((sel) => {
      const drawer = document.querySelector(sel);
      return [...drawer.querySelectorAll('*')]
        .filter((el) => /^(Single|Multiple)$/.test((el.textContent || '').trim()) && el.children.length === 0)
        .map((el) => {
          const row = el.closest('label, .MuiFormControlLabel-root, div');
          return {
            text: el.textContent.trim(),
            tag: el.tagName,
            cls: el.className.toString().slice(0, 70),
            parentTag: el.parentElement?.tagName,
            parentCls: el.parentElement?.className.toString().slice(0, 70),
            rowHasInput: !!(row && row.querySelector('input')),
            rowInputType: row?.querySelector('input')?.type || null,
            rowRole: row?.getAttribute('role') || null
          };
        });
    }, DRAWER));

    // Click "Single" via its row, then confirm it took.
    const picked = await page.evaluate((sel) => {
      const drawer = document.querySelector(sel);
      const leaf = [...drawer.querySelectorAll('*')]
        .find((el) => (el.textContent || '').trim() === 'Single' && el.children.length === 0);
      if (!leaf) return 'no Single leaf';
      const row = leaf.closest('label, .MuiFormControlLabel-root') || leaf.parentElement;
      const input = row?.querySelector('input');
      (input || leaf).click();
      return `clicked ${input ? 'input in row' : 'leaf'}`;
    }, DRAWER);
    await page.waitForTimeout(800);
    log('3. after picking Single', {
      picked,
      checked: await page.evaluate((sel) => {
        const drawer = document.querySelector(sel);
        return [...drawer.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
          .slice(0, 4).map((i) => ({ type: i.type, checked: i.checked, aria: i.getAttribute('aria-label') }));
      }, DRAWER)
    });

    await page.locator(DRAWER).first().getByRole('button', { name: /^Create Role$/ }).click();
    await page.waitForTimeout(3500);
    log('4. toast', await safe(async () => (await page.locator('.notistack-Snackbar, [role="alert"]').first().innerText()).trim(), 'none'));

    // Q1 — reopen the popover properly and look again.
    const after = await freshRoleOptions(page, users);
    log('5. role options AFTER (popover closed + reopened)', {
      total: after.length,
      delta: after.length - before.length,
      containsNew: after.includes(ROLE),
      added: after.filter((o) => !before.includes(o))
    });

    // And after a hard reload of the whole page?
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await users.openAddUser();
    const reloaded = await freshRoleOptions(page, users);
    log('6. role options AFTER A PAGE RELOAD', {
      total: reloaded.length,
      containsNew: reloaded.includes(ROLE),
      added: reloaded.filter((o) => !before.includes(o))
    });

    // If it is there, does picking it give the 3-step (clinic) flow?
    if (reloaded.includes(ROLE)) {
      await users.selectRoles(ROLE);
      await page.waitForTimeout(800);
      log('7. wizard after selecting the new Single-clinic role', {
        counter: await safe(() => users.stepCounter()),
        steps: await safe(() => users.indicatorStepNames())
      });
    }

    // Q3 — can the Roles tab delete it again?
    await users.closeAnyPopover();
    await page.waitForTimeout(300);
    await page.goto(users.urlFor('roles'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log('8. Roles screen', await page.evaluate(() => ({
      path: location.pathname,
      head: (document.body.innerText || '').split('\n').filter(Boolean).slice(0, 14),
      searchPlaceholders: [...document.querySelectorAll('input[placeholder]')].map((i) => i.placeholder),
      buttons: [...document.querySelectorAll('button')]
        .map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 20)
    })));
    console.log(`\n>>> role left behind: "${ROLE}"`);
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
