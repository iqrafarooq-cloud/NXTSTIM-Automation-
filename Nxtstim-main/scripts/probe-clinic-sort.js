/**
 * Dev-only probe: discover the ACTUAL behaviour of the Clinics list "Sort By"
 * control so the sort automation can be written data-driven (IDs read from the
 * live grid, nothing hardcoded) and assert the real full-list ordering.
 *
 *   node scripts/probe-clinic-sort.js
 *
 * It never creates/mutates clinics — it only opens the Sort By menu, sorts and
 * reads the grid, then leaves the sort on the app default (ID: Desc).
 *
 * Behaviour discovered (verified 2026-07-16):
 *   - Sort By is a menu with exactly TWO radio options: "ID: Asc" / "ID: Desc"
 *     (ID is the only sortable column). "ID: Desc" is the default (checked).
 *   - Selecting an option AUTO-CLOSES the menu (no lingering modal backdrop,
 *     unlike the Search By dropdown) and re-sorts the WHOLE list server-side.
 *   - The two orders are exact reverses of each other.
 *   - The grid is a VIRTUALISED MUI DataGrid (~9 rows mount at a time), so the
 *     full ID list is harvested by scrolling the virtual scroller. Rows-per-page
 *     offers 10/20/50/100; picking 100 collapses the 70 Active clinics onto one
 *     page. The selected sort persists per admin account and across tabs.
 */
require('../features/support/env').loadDotenv();
const { chromium } = require('playwright');

const BASE = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net';
const EMAIL = process.env.TEST_USER_EMAIL || process.env.BASE_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.BASE_PASSWORD;
const HEADED = process.env.HEADED !== 'false';

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const close = page.locator('div[role="dialog"] button:has-text("Close")').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  if (await page.locator('input[placeholder="Enter Email"]').isVisible().catch(() => false)) {
    await page.locator('input[placeholder="Enter Email"]').fill(EMAIL);
    await page.locator('input[placeholder="Enter Password"]').fill(PASSWORD);
    await page.locator('button:has-text("Log In")').click();
    await page.waitForURL((u) => !/\/login/i.test(u.toString()), { timeout: 20000 });
  }
}

// Layered "clinics list is ready" locator (mirrors the ClinicsPage POM): the
// preview build's Add Clinic button is sometimes an aria-label-only icon during
// hydration, so match several candidates plus the grid itself.
const READY =
  'button.add-clinic-button, button[aria-label="Add Clinic"], ' +
  'main button:has-text("Add Clinic"), [role="grid"]';

async function gotoClinics(page) {
  // The preview env is occasionally slow to hydrate; reload once before failing.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.locator(READY).first().waitFor({ state: 'visible', timeout: 45000 });
      await page.waitForTimeout(1500);
      return;
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
}

async function total(page) {
  const t = (await page.locator('main').innerText().catch(() => '')) || '';
  const m = t.match(/(\d+)\s+Clinics?/i);
  return m ? m[1] : null;
}

/** Reads the Sort By options while the menu is open. */
async function sortOptions(page) {
  return await page.evaluate(() =>
    [...document.querySelectorAll('input[type="radio"]')]
      .map((inp) => {
        const label = inp.closest('.MuiFormControlLabel-root');
        return { label: (label ? label.textContent : '').trim(), checked: inp.checked };
      })
      .filter((o) => /^ID:\s*(Asc|Desc)$/i.test(o.label))
  );
}

async function openSort(page) {
  await page.locator('button:has-text("Sort By")').click();
  await page.locator('.MuiPopover-root :text-is("ID: Asc"), [role="option"]:has-text("ID: Asc")').first()
    .waitFor({ state: 'visible', timeout: 6000 });
}

async function sortBy(page, label) {
  await openSort(page);
  await page.locator(`.MuiPopover-root :text-is("${label}"), [role="option"]:has-text("${label}")`).first().click();
  await page.waitForTimeout(1500);
}

async function showAllRows(page) {
  const combo = page.locator('[role="combobox"]').first();
  if (!(await combo.isVisible().catch(() => false))) return;
  if (((await combo.textContent()) || '').trim() === '100') return;
  await combo.click();
  await page.locator('li[role="option"]:text-is("100"), [role="option"]:text-is("100")').last().click();
  await page.waitForTimeout(1500);
}

/** Scrolls the virtualised grid and harvests every clinic ID in grid order. */
async function harvestIds(page) {
  return await page.evaluate(async () => {
    const seen = new Map();
    const collect = () =>
      document.querySelectorAll('[role="rowgroup"] [role="row"]').forEach((r) => {
        const cells = r.querySelectorAll('[role="gridcell"]');
        const id = cells[1] ? cells[1].textContent.trim() : null;
        if (id && !seen.has(id)) seen.set(id, seen.size);
      });
    const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
    const scroller = document.querySelector('.MuiDataGrid-virtualScroller');
    if (!scroller) { collect(); return [...seen.keys()]; }
    scroller.scrollTop = 0; await sleep(120); collect();
    for (let y = 0; y <= scroller.scrollHeight; y += 350) { scroller.scrollTop = y; await sleep(70); collect(); }
    scroller.scrollTop = scroller.scrollHeight; await sleep(120); collect();
    return [...seen.keys()];
  });
}

function monotonic(ids, dir) {
  const n = ids.map(Number);
  for (let i = 1; i < n.length; i++) {
    if (dir === 'asc' && n[i] < n[i - 1]) return false;
    if (dir === 'desc' && n[i] > n[i - 1]) return false;
  }
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const page = await browser.newPage();
  try {
    await login(page);
    await gotoClinics(page);
    console.log('Active total:', await total(page));

    await openSort(page);
    console.log('\n-- Sort By options (default state) --');
    console.log(' ', await sortOptions(page));
    await page.keyboard.press('Escape');

    await showAllRows(page);

    await sortBy(page, 'ID: Asc');
    const asc = await harvestIds(page);
    console.log(`\nID: Asc  -> ${asc.length} ids, ${asc[0]} … ${asc[asc.length - 1]}, ascending=${monotonic(asc, 'asc')}`);

    await sortBy(page, 'ID: Desc');
    const desc = await harvestIds(page);
    console.log(`ID: Desc -> ${desc.length} ids, ${desc[0]} … ${desc[desc.length - 1]}, descending=${monotonic(desc, 'desc')}`);

    const reverseMatch = JSON.stringify([...asc].reverse()) === JSON.stringify(desc);
    console.log(`Desc is exact reverse of Asc: ${reverseMatch}`);

    console.log('\n-- Inactive tab parity --');
    await page.getByRole('tab', { name: 'Inactive' }).click();
    await page.waitForTimeout(1200);
    await showAllRows(page);
    await sortBy(page, 'ID: Asc');
    const iAsc = await harvestIds(page);
    console.log(`Inactive ID: Asc -> ${iAsc.length} ids, ascending=${monotonic(iAsc, 'asc')} (${iAsc.join(', ')})`);

    // Leave the sort on the app default.
    await sortBy(page, 'ID: Desc');
    console.log('\nDone. Sort left on default (ID: Desc).');
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
