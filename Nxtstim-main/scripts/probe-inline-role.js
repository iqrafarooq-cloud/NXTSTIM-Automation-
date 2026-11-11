/**
 * probe-inline-role.js — dev-only. Maps the "+ Create a new role" drawer that
 * opens from INSIDE the Add New User wizard's Role dropdown, so RolesPage can
 * be built off real selectors instead of guesses.
 *
 * Answers:
 *   - what the footer entry is actually labelled
 *   - the drawer's fields / toggles / buttons / permission categories
 *   - whether the wizard survives underneath the drawer (and on which step)
 *   - what Cancel does, and what Create Role does (does the wizard come back?
 *     is the new role in the dropdown? is it auto-selected?)
 *
 *   node scripts/probe-inline-role.js
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
const safe = async (fn, fallback = null) => { try { return await fn(); } catch (e) { return `${fallback ?? 'ERR'}: ${e.message.split('\n')[0]}`; } };

// NOTE: a bare `.MuiDrawer-paper` also matches the app's SIDEBAR (it is a
// permanent MUI Drawer). The Create A Role panel is the *modal* drawer.
const DRAWER = '.MuiDrawer-modal .MuiDrawer-paper';

async function dumpDrawer(page, { deep = false } = {}) {
  return await page.evaluate(({ sel, deep }) => {
    const drawer = document.querySelector(sel);
    if (!drawer) return { found: false };
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const labelFor = (el) => {
      let node = el;
      for (let i = 0; i < 5 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const t = (node.innerText || '').trim();
        if (t && t.length < 120) return t.split('\n')[0];
      }
      return '';
    };
    const out = {
      found: true,
      textLines: (drawer.innerText || '').split('\n').slice(0, 30),
      inputs: [...drawer.querySelectorAll('input, textarea')].filter(vis).map((i) => ({
        tag: i.tagName.toLowerCase(), type: i.type, placeholder: i.placeholder,
        name: i.name, testid: i.getAttribute('data-testid'), label: labelFor(i)
      })),
      switches: [...drawer.querySelectorAll('.MuiSwitch-root input, input[role="switch"], .MuiSwitch-input')]
        .map((s) => ({ checked: s.checked, label: labelFor(s) })),
      buttons: [...drawer.querySelectorAll('button, [role="button"]')].filter(vis)
        .map((b) => ({ text: (b.textContent || '').trim().slice(0, 50), disabled: b.disabled === true, cls: b.className.toString().slice(0, 60) })),
      radios: [...drawer.querySelectorAll('input[type="radio"]')].map((r) => ({ value: r.value, checked: r.checked, label: labelFor(r) }))
    };
    if (deep) {
      out.accordions = [...drawer.querySelectorAll('.MuiAccordionSummary-root')]
        .map((a) => ({ text: (a.innerText || '').trim().split('\n')[0], expanded: a.getAttribute('aria-expanded') }));
    }
    return out;
  }, { sel: DRAWER, deep });
}

/** Type into the drawer input whose placeholder matches. */
async function fillDrawer(page, placeholderRe, value) {
  // resolve by placeholder in the DOM to avoid guessing the exact string
  const ph = await page.evaluate(({ sel, re }) => {
    const drawer = document.querySelector(sel);
    const rx = new RegExp(re, 'i');
    const el = [...drawer.querySelectorAll('input, textarea')].find((i) => rx.test(i.placeholder || ''));
    return el ? el.placeholder : null;
  }, { sel: DRAWER, re: placeholderRe.source });
  if (!ph) return `no input matching /${placeholderRe.source}/`;
  await page.locator(DRAWER).first().locator(`[placeholder="${ph}"]`).first().fill(value);
  await page.waitForTimeout(400);
  return ph;
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000); // keep probe stalls short
  const world = {
    browser, context, page,
    pages: { login: new LoginPage(page), mfa: new MfaPage(page), dashboard: new DashboardPage(page), users: new UsersPage(page) }
  };
  const users = world.pages.users;
  const stamp = String(Date.now()).slice(-6);
  const ROLE = `QA Inline ${stamp}`;

  // Read the wizard off the raw DOM: while the drawer is on top MUI marks the
  // background aria-hidden, so getByRole('dialog') stops matching and every
  // locator-based read burns a 30s timeout.
  const wizardState = async () => ({
    ...(await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], .MuiDialog-paper');
      if (!d) return { dialogInDom: false };
      const r = d.getBoundingClientRect();
      const text = d.innerText || '';
      const m = text.match(/Step\s+(\d+)\s*\/\s*(\d+)/i);
      return {
        dialogInDom: true,
        painted: r.width > 0 && r.height > 0,
        ariaHidden: d.closest('[aria-hidden="true"]') ? true : false,
        counter: m ? `${m[1]}/${m[2]}` : null,
        head: text.split('\n').slice(0, 6)
      };
    })),
    steps: await safe(() => users.indicatorStepNames())
  });

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();

    await users.openAddUser();
    log('A. wizard on open', await wizardState());

    await users.openRoleDropdown();
    log('B. role popover footer entry', await page.evaluate(() => {
      const p = document.querySelector('.c-multi-select-dropdown-popover');
      if (!p) return null;
      const f = p.querySelector('.footer-action');
      return f ? { text: (f.innerText || '').trim(), tag: f.tagName, cls: f.className } : { popoverTail: (p.innerText || '').split('\n').slice(-4) };
    }));

    // ---- Path 1: open then CANCEL -----------------------------------------
    await users.clickCreateNewRole();
    log('C. drawer on open', await dumpDrawer(page, { deep: true }));
    log('D. wizard WHILE drawer open', await wizardState());

    await page.locator(DRAWER).first().getByRole('button', { name: /^Cancel$/ }).first().click();
    await page.waitForTimeout(2000);
    log('E. after CANCEL', {
      drawerOpen: await safe(() => users.isCreateRoleDrawerOpen(), false),
      ...(await wizardState()),
      popoverOpen: await safe(() => users.rolePopover().isVisible(), false),
      bodyHead: (await page.locator('body').innerText()).split('\n').slice(0, 6)
    });

    // ---- Path 2: reopen and SAVE ------------------------------------------
    if (!(await wizardState()).painted) {
      console.log('\n(wizard was gone after Cancel — reopening it)');
      await users.openAddUser();
    }
    await users.clickCreateNewRole();
    log('F. name placeholder', await fillDrawer(page, /role name/i, ROLE));
    log('G. description placeholder', await fillDrawer(page, /describ|description/i, 'Probe-created inline role'));
    log('H. after filling name+description', {
      buttons: (await dumpDrawer(page)).buttons,
      switches: (await dumpDrawer(page)).switches
    });

    // Turn on clinic assignment to see the Single/Multi options appear.
    const sw = page.locator(DRAWER).first().locator('.MuiSwitch-root input').first();
    if (await sw.count()) {
      await sw.click({ force: true });
      await page.waitForTimeout(1200);
      log('I. after enabling the clinic-assignment toggle', await dumpDrawer(page));
    }

    const createBtn = page.locator(DRAWER).first().getByRole('button', { name: /^Create Role$/ }).first();
    log('J. Create Role enabled?', await safe(() => createBtn.isEnabled(), false));
    await createBtn.click();
    await page.waitForTimeout(3500);

    log('K. after CREATE ROLE', {
      drawerOpen: await safe(() => users.isCreateRoleDrawerOpen(), false),
      ...(await wizardState()),
      toast: await safe(async () => (await page.locator('.notistack-Snackbar, [role="alert"]').first().innerText()).trim(), 'no toast'),
      popoverOpen: await safe(() => users.rolePopover().isVisible(), false)
    });

    // Is the brand-new role now offered / already selected in the wizard?
    log('L. role dropdown after creation', {
      options: await safe(async () => {
        const all = await users.roleOptions();
        return { total: all.length, containsNew: all.includes(ROLE), tail: all.slice(-6) };
      }),
      selected: await safe(() => users.selectedRoles()),
      dialogHead: await safe(async () => (await users.dialogText()).split('\n').slice(0, 10))
    });
    console.log(`\n>>> created role name: "${ROLE}" (delete it from the Roles tab)`);
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
