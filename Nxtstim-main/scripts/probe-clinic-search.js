/**
 * Dev-only probe: discover the ACTUAL behaviour of the Clinics list search so
 * the search automation can be written data-driven (values read from the grid,
 * nothing hardcoded) and assert real behaviour.
 *
 *   node scripts/probe-clinic-search.js
 *
 * It never creates/mutates clinics — it only searches, reads the grid and then
 * clears the search so it leaves the account's list state clean.
 *
 * Behaviour discovered (verified 2026-07-15):
 *   - "Search By" is a radiogroup: ID | Clinic Name | Street Address | City |
 *     State | Zip Code. The chosen field persists across the Active/Inactive
 *     tabs and server-side per admin account.
 *   - Matching is PARTIAL (substring) + CASE-INSENSITIVE; leading/trailing
 *     spaces are trimmed. Search is debounced then refetched server-side.
 *   - Strictly FIELD-SCOPED: a value valid for one field returns 0 rows +
 *     "Nothing here yet." under a different field; switching the field re-scopes
 *     any text already typed.
 *   - EMPTY or whitespace-only input lists every clinic; special characters /
 *     no-match show the empty state.
 */
require('../features/support/env').loadDotenv();
const { chromium } = require('playwright');

const BASE = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net';
const EMAIL = process.env.TEST_USER_EMAIL || process.env.BASE_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.BASE_PASSWORD;
const HEADED = process.env.HEADED !== 'false';

const FIELDS = ['ID', 'Clinic Name', 'Street Address', 'City', 'State', 'Zip Code'];

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

async function gotoClinics(page) {
  await page.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Add Clinic' }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(1500);
}

const input = (page) => page.locator('input[placeholder^="Search for"]').first();

async function total(page) {
  const t = (await page.locator('main').innerText().catch(() => '')) || '';
  const m = t.match(/(\d+)\s+Clinics?/i);
  return m ? m[1] : null;
}

async function settle(page) {
  await page.waitForTimeout(1300);
  const sample = async () => {
    const tot = await total(page);
    const count = await page.locator('[role="rowgroup"] [role="row"]').count();
    return `${tot}|${count}`;
  };
  let prev = await sample();
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(700);
    const cur = await sample();
    if (cur === prev) return;
    prev = cur;
  }
}

async function selectField(page, field) {
  const btn = page
    .locator(FIELDS.map((f) => `main button:text-is("${f}")`).join(', '))
    .first();
  await btn.click();
  await page.locator(`[role="radiogroup"] :text-is("${field}"), [role="radio"][name="${field}"]`).first().click();
  await settle(page);
}

async function search(page, value) {
  await input(page).fill(String(value));
  await settle(page);
}

async function nothingHereYet(page) {
  return /Nothing here yet/i.test((await page.locator('main').innerText().catch(() => '')) || '');
}

(async () => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const page = await browser.newPage();
  try {
    await login(page);
    await gotoClinics(page);
    await search(page, ''); // clear any persisted search
    console.log('Full active list total:', await total(page));

    console.log('\n-- per-field partial search (value read from top row) --');
    for (const field of FIELDS) {
      await search(page, '');
      await selectField(page, field);
      // read the top row's value for this field
      const idx = { ID: 1, 'Clinic Name': 2, 'Street Address': 3, City: 4, State: 5, 'Zip Code': 6 }[field];
      const raw = (
        (await page
          .locator('[role="rowgroup"] [role="row"]')
          .first()
          .locator('[role="gridcell"]')
          .nth(idx)
          .innerText()
          .catch(() => '')) || ''
      ).trim();
      const token = raw.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] || raw;
      await search(page, token);
      console.log(`  ${field.padEnd(15)} value="${raw}" token="${token}" -> ${await total(page)} clinic(s)`);
    }

    console.log('\n-- match tolerance (City) --');
    await search(page, '');
    await selectField(page, 'City');
    for (const q of ['San Diego', 'san diego', 'diego', '  San Diego  ']) {
      await search(page, q);
      console.log(`  "${q}" -> ${await total(page)}`);
    }

    console.log('\n-- field scoping: a City value under Clinic Name --');
    await search(page, '');
    await selectField(page, 'Clinic Name');
    await search(page, 'San Diego');
    console.log(`  Clinic Name "San Diego" -> ${await total(page)} (nothingHereYet=${await nothingHereYet(page)})`);

    console.log('\n-- blank / whitespace / special chars --');
    for (const q of ['   ', '!@#$%^&*', 'zzqx-no-such-42']) {
      await search(page, q);
      console.log(`  "${q}" -> ${await total(page)} (nothingHereYet=${await nothingHereYet(page)})`);
    }

    await search(page, ''); // leave clean
    console.log('\nDone. List left clean, total:', await total(page));
  } catch (e) {
    console.error('PROBE ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
