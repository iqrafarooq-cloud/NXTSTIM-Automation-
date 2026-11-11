/**
 * Dev-only probe: discover the Clinics "Export CSV" behaviour so the export
 * automation can assert REAL behaviour (data-driven, no hardcoded values).
 *
 *   node scripts/probe-clinic-export.js
 *
 * It never creates/mutates clinics. It exports the list unfiltered, then under a
 * 1-row search, then under a no-match search, then under a City filter — reading
 * each downloaded CSV — and finally clears its search/filter so it leaves the
 * account's list state clean.
 *
 * Behaviour discovered (matches ClinicsPage.EXPORT_* + the feature comments):
 *   - the CSV is built CLIENT-SIDE (Blob) and downloads as the STATIC name
 *     "NXTSTIM.csv"
 *   - header = ID, Name, Street Address, City, State, Zip Code,
 *     Monitoring Metrics, Contact Info, Current Status
 *   - the export mirrors the CURRENT grid (unfiltered = all; search/filter =
 *     just those rows)
 *   - "Monitoring Metrics" is always empty; "Contact Info" is a newline blob
 *     whose first line is the CLINIC name (not the grid's contact person)
 *   - 0 matching clinics → button stays enabled → HEADER-ONLY CSV, no toast
 */
require('../features/support/env').loadDotenv();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net';
const EMAIL = process.env.TEST_USER_EMAIL || process.env.BASE_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.BASE_PASSWORD;
const HEADED = process.env.HEADED !== 'false';

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const close = page.locator('div[role="dialog"] button:has-text("Close")').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('input[placeholder="Enter Email"]').fill(EMAIL);
  await page.locator('input[placeholder="Enter Password"]').fill(PASSWORD);
  await page.locator('button:has-text("Log In")').click();
  await page.waitForURL((u) => !/\/login/i.test(u.toString()), { timeout: 20000 });
}

async function gotoClinics(page) {
  await page.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Add Clinic' }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
}

function totalCount(page) {
  return page
    .locator('main')
    .innerText()
    .then((t) => {
      const m = (t || '').match(/(\d+)\s+Clinics?/i);
      return m ? Number(m[1]) : null;
    });
}

async function exportAndRead(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('main button:has-text("Export CSV")').click()
  ]);
  const filename = download.suggestedFilename();
  const dest = path.join(os.tmpdir(), `probe-export-${Date.now()}.csv`);
  await download.saveAs(dest);
  const raw = fs.readFileSync(dest, 'utf8');
  const lines = raw.split(/\r\n/).filter((l) => l.length);
  const displayed = await totalCount(page);
  console.log(`\n== ${label} ==`);
  console.log(`  filename        : ${filename}`);
  console.log(`  displayed count : ${displayed}`);
  console.log(`  header          : ${lines[0]}`);
  console.log(`  data rows       : ${lines.length - 1}`);
  console.log(`  first data row  : ${lines[1] || '(none)'}`);
  fs.unlinkSync(dest);
  return { filename, header: lines[0], dataRows: lines.length - 1, displayed };
}

async function clearSearch(page) {
  await page.locator('input[placeholder*="Search" i]').first().fill('');
  await page.waitForTimeout(2000);
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await login(page);
    await gotoClinics(page);

    // Clear any persisted search/filter first.
    const clearAll = page.locator('button:has-text("Clear All")').first();
    if (await clearAll.isVisible().catch(() => false)) {
      await clearAll.click();
      await page.waitForTimeout(1000);
    }
    await clearSearch(page);

    // 1) Unfiltered → all rows.
    await exportAndRead(page, 'UNFILTERED (all clinics)');

    // 2) Search reducing to a single clinic (first row's ID).
    const firstId = (
      await page.locator('[role="rowgroup"] [role="row"]').first().locator('[role="gridcell"]').nth(1).innerText()
    ).trim();
    await page.locator('input[placeholder*="Search" i]').first().fill(firstId);
    await page.waitForTimeout(2500);
    await exportAndRead(page, `SEARCH "ID"="${firstId}" (single record)`);

    // 3) No-match search → header-only.
    await page.locator('input[placeholder*="Search" i]').first().fill('99999999');
    await page.waitForTimeout(2500);
    const btn = page.locator('main button:has-text("Export CSV")').first();
    console.log(`\n  export enabled with 0 rows? ${await btn.isEnabled()}`);
    await exportAndRead(page, 'SEARCH no-match (empty grid)');

    await clearSearch(page);
    console.log('\nDone. List state cleared.');
  } catch (err) {
    console.error('Probe failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
