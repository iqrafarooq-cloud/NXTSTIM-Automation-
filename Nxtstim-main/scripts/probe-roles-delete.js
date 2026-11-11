/**
 * probe-roles-delete.js — dev-only. Maps the Roles tab well enough to tidy up
 * after the inline-role scenarios: search a role by name, open its side panel,
 * and delete it (roles with 0 assigned users are deletable per NXT-2001).
 *
 * Also clears out any "QA Inline …" roles previous probes left behind.
 *
 *   node scripts/probe-roles-delete.js
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
  const browser = await chromium.launch({ headless: process.env.HEADED === 'false' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const world = {
    browser, context, page,
    pages: { login: new LoginPage(page), mfa: new MfaPage(page), dashboard: new DashboardPage(page), users: new UsersPage(page) }
  };

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await page.goto(world.pages.users.urlFor('roles'), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.locator('input[placeholder="Search for Role Name"]').fill('QA Inline');
    await page.waitForTimeout(2500);

    log('matching rows', await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.MuiDataGrid-row')];
      return {
        count: rows.length,
        rows: rows.slice(0, 6).map((r) => ({
          text: (r.innerText || '').replace(/\n+/g, ' | ').slice(0, 120),
          cells: [...r.querySelectorAll('[data-field]')].map((c) => c.getAttribute('data-field')),
          actionButtons: [...r.querySelectorAll('button, [role="button"], svg')].length
        }))
      };
    }));

    // Open the first match's side panel via its row action.
    const opened = await page.evaluate(() => {
      const row = document.querySelector('.MuiDataGrid-row');
      if (!row) return 'no row';
      const btn = row.querySelector('button, [role="button"]');
      if (!btn) { row.click(); return 'clicked row (no button found)'; }
      btn.click();
      return `clicked row button (aria=${btn.getAttribute('aria-label')})`;
    });
    await page.waitForTimeout(2500);
    console.log(`\n### open attempt\n${opened}`);

    log('side panel', await page.evaluate(() => {
      const p = document.querySelector('.MuiDrawer-modal .MuiDrawer-paper');
      if (!p) return { found: false };
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        found: true,
        textLines: (p.innerText || '').split('\n').filter(Boolean).slice(0, 14),
        buttons: [...p.querySelectorAll('button, [role="button"]')].filter(vis)
          .map((b) => ({ text: (b.textContent || '').trim().slice(0, 40), cls: b.className.toString().slice(0, 50) }))
          .filter((b) => b.text)
      };
    }));

    // Delete → confirm.
    const del = page.locator('.MuiDrawer-modal .MuiDrawer-paper').getByRole('button', { name: /Delete Role/i }).first();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(1800);
      log('confirmation dialog', await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"], .MuiDialog-paper')]
          .find((x) => x.getBoundingClientRect().width > 0);
        if (!d) return { found: false };
        return {
          found: true,
          text: (d.innerText || '').split('\n').filter(Boolean).slice(0, 8),
          buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean)
        };
      }));
    } else {
      console.log('\nno "Delete Role" button in the panel');
    }
  } catch (e) {
    console.error('\nPROBE FAILED:', e.message);
  } finally {
    await browser.close();
  }
})();
