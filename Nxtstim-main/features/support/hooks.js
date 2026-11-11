const { Before, After, BeforeAll, AfterAll, setDefaultTimeout, Status } = require('@cucumber/cucumber');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Load .env (zero-dep) before any other support modules read process.env.
const { loadDotenv } = require('./env');
loadDotenv();

// Page-Object imports moved into world.js so multi-tab support can rebind
// `this.pages` to a different Playwright Page without duplicating the list.

setDefaultTimeout(60 * 1000);

let browser;

// Static assets are served from a memory + disk cache instead of being
// re-downloaded once per scenario — see assetCache.js for the measurements that
// made this necessary.
const assetCache = require('./assetCache');

BeforeAll(async function () {
  const headed = process.env.HEADED !== 'false';
  browser = await chromium.launch({
    headless: !headed,
    slowMo: headed ? 50 : 0
  });
});

Before(async function () {
  this.browser = browser;
  this.context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    // The recovery-codes "Copy" scenario reads navigator.clipboard.readText(),
    // which requires explicit clipboard permission in headless/automated Chromium.
    permissions: ['clipboard-read', 'clipboard-write']
  });
  await assetCache.install(this.context);
  // Open the default tab through the world so `this.page` and `this.pages`
  // stay in sync with the multi-tab registry (admin/supervisor/etc.).
  const defaultPage = await this.context.newPage();
  this.registerTab('default', defaultPage);

  // Per-scenario scratch state used by the e2e step defs to remember
  // cookies, captured OTPs/links, and currently-acting test users.
  this.testState = {
    capturedOtps: {},
    capturedLinks: {},
    capturedCookies: null,
    currentUserEmail: null
  };
  // Track temp users created by @e2e-backend / @e2e-admin scenarios so
  // After-hooks can delete them and keep the backend tidy.
  this.createdUsers = new Set();
});

// Self-healing: before any scenario tagged @requires-active-account, make sure
// the suite's configured test account is Active — recovering it via the admin
// reactivation flow if it is Suspended/Pending (see accountHealer.js). The
// account is chosen from the feature the scenario lives in, so the same tag
// works for Change Password and Forgot Password without per-step duplication.
// Generous timeout: recovery does real email round-trips (reactivate → email →
// set password). It no-ops quickly when the account is already Active.
const accountHealer = require('./accountHealer');

function accountKeyForScenario(scenario) {
  const uri = (scenario && scenario.pickle && scenario.pickle.uri) || '';
  if (/ChangePassword/i.test(uri)) return 'change-password';
  if (/ForgotPassword/i.test(uri)) return 'forgot-password';
  if (/MFA/i.test(uri)) return 'mfa';
  return null;
}

Before({ tags: '@requires-active-account', timeout: 240 * 1000 }, async function (scenario) {
  const accountKey = accountKeyForScenario(scenario);
  if (!accountKey) {
    console.log(
      `[account-healer] no account mapping for "${scenario.pickle?.uri}" — ` +
      'skipping self-heal (add a mapping in hooks.js accountKeyForScenario).'
    );
    return;
  }
  await accountHealer.ensureActive(this, accountKey);
});

After(async function (scenario) {
  if (scenario.result?.status === Status.FAILED) {
    const dir = path.resolve(process.cwd(), 'reports', 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeName = scenario.pickle.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
    // Snapshot every open tab on failure — for multi-tab lifecycle scenarios
    // the failure may be visible only on the non-active tab.
    for (const [name, page] of Object.entries(this.tabs || {})) {
      try {
        const file = path.join(dir, `${safeName}_${name}_${Date.now()}.png`);
        const buffer = await page.screenshot({ path: file, fullPage: true });
        this.attach(buffer, 'image/png');
      } catch { /* tab may already be closed */ }
    }
  }

  // Best-effort teardown of any users the scenario created via testApi.
  // Failure here must not mask the real scenario result, so swallow errors.
  if (this.createdUsers && this.createdUsers.size > 0) {
    const testApi = require('./testApi');
    if (testApi.isConfigured()) {
      for (const email of this.createdUsers) {
        try { await testApi.deleteUser(email); } catch { /* ignore */ }
      }
    }
    this.createdUsers.clear();
  }

  // Close every registered tab, then the context.
  for (const name of Object.keys(this.tabs || {})) {
    await this.closeTab(name);
  }
  if (this.context) await this.context.close();
});

AfterAll(async function () {
  if (browser) await browser.close();
  // NOTE: The readable HTML report is intentionally NOT generated here.
  // Cucumber's json:/message: formatters flush their files on `testRunFinished`,
  // which fires AFTER AfterAll — so reading cucumber-report.json here yields a
  // half-written file ("Unexpected end of JSON input"). scripts/run-tests.js
  // spawns Cucumber and regenerates the report once the process fully exits,
  // guaranteeing every formatter has flushed. Run via `npm test` (or any
  // npm test:* script); or `npm run test:report` after a bare cucumber-js run.
});
