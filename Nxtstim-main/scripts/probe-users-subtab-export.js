/**
 * probe-users-subtab-export.js — dev-only. Answers one question the
 * @subtab outline cannot answer on its own:
 *
 *   on a status sub-tab that lists NO users (Pending), does Export CSV
 *   download a header-only file, or the whole unfiltered list?
 *
 * Two runs of the outline disagreed — one read the Pending grid at 286 rows
 * (the pre-switch list, still painted), one read it at 0 while the CSV came
 * back with 286 records. So this probe parks on each sub-tab, samples the
 * counter until it stops moving (well past waitForListSettle), and only then
 * exports.
 *
 *   node scripts/probe-users-subtab-export.js
 */
const { chromium } = require('playwright');
const { loadDotenv } = require('../features/support/env');

loadDotenv();

const { LoginPage } = require('../features/pages/LoginPage');
const { MfaPage } = require('../features/pages/MfaPage');
const { DashboardPage } = require('../features/pages/DashboardPage');
const { UsersPage } = require('../features/pages/UsersPage');
const flow = require('../features/support/inactiveUserFlow');

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

  /** Samples the counter every 700ms until it repeats 4x or 25s pass. */
  async function counterHoldsStill() {
    const seen = [];
    let stable = 0;
    const deadline = Date.now() + 25000;
    let prev = null;
    while (Date.now() < deadline && stable < 4) {
      const total = await users.getTotalCount().catch(() => null);
      seen.push(total);
      stable = total === prev ? stable + 1 : 0;
      prev = total;
      await page.waitForTimeout(700);
    }
    return { total: prev, samples: seen };
  }

  try {
    console.log('logging in as admin…');
    await flow.loginAsAdmin(world);
    await users.open();
    await users.resetListState();

    for (const tab of UsersPage.STATUS_TABS) {
      await users.openTab(tab);
      const settled = await counterHoldsStill();
      const rows = await users.collectAllRows();
      const empty = rows.length ? '' : await users.emptyStateText();
      const csv = await users.exportCsvAndRead();
      // Re-read AFTER the export: if the export itself kicked off a refetch, the
      // two readings differ and the "stale scope" explanation survives.
      const after = await users.getTotalCount().catch(() => null);
      console.log(`\n### ${tab}`);
      console.log(`  counter (settled)   : ${settled.total}`);
      console.log(`  counter samples     : ${settled.samples.join(' -> ')}`);
      console.log(`  grid rows           : ${rows.length}`);
      console.log(`  empty state         : "${empty}"`);
      console.log(`  CSV data rows       : ${csv.records.length}`);
      console.log(`  CSV columns         : ${csv.columns.join(', ')}`);
      console.log(`  counter after export: ${after}`);
      console.log(
        `  VERDICT             : ${
          csv.records.length === (settled.total || 0)
            ? 'export matches the sub-tab'
            : 'EXPORT DISAGREES WITH THE SUB-TAB'
        }`
      );
    }
  } catch (err) {
    console.error('probe failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
