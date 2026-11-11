/**
 * Dev-only probe: discover the Clinics "Filters" panel structure and the
 * ACTUAL combined City+State filtering logic, so the filter automation can be
 * written data-driven (no hardcoded City/State) and assert real behavior.
 *
 *   node scripts/probe-clinic-filters.js
 *
 * It never creates/mutates clinics. It applies filters, reads the grid, then
 * clears filters so it leaves the account's list state clean.
 *
 * Panel shape (discovered):
 *   - vertical tabs: "City" (tab-0, default) / "State" (tab-1)
 *   - each tab shows a dropdown labelled "All Cities" / "All States" that must
 *     be CLICKED to reveal the checkbox list (incl. a "Select All")
 *   - a "Search Cities" / "Search States" partial-search box
 *   - an "Apply" button
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

const panel = (page) => page.locator('.MuiPopover-root, .MuiPopper-root, [role="dialog"]').last();

async function openFilters(page) {
  await page.locator('button:has-text("Filters")').first().click();
  await panel(page).waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);
}

async function closePanel(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

/** Select City/State tab then expand its dropdown to reveal checkboxes. */
async function openDropdown(page, which /* 'City' | 'State' */) {
  const tab = panel(page).locator(`[role="tab"]:has-text("${which}")`).first();
  await tab.click();
  await page.waitForTimeout(300);
  // Expand the "All Cities"/"All States" dropdown if the list isn't shown yet.
  const already = await panel(page).locator('input[type="checkbox"]').count();
  if (already === 0) {
    const dd = panel(page).locator(`:text-is("All ${which === 'City' ? 'Cities' : 'States'}")`).first();
    await dd.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function optionNames(page) {
  return await panel(page).evaluate((root) => {
    const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    return [...root.querySelectorAll('input[type="checkbox"]')]
      .map((c) => txt(c.closest('label') || c.parentElement))
      .filter((n) => n && n !== 'Select All');
  });
}

async function searchOptions(page, term) {
  const box = panel(page).locator('input[type="text"]').first();
  await box.fill(term);
  await page.waitForTimeout(700);
}

async function noResultsText(page) {
  return await panel(page).evaluate((root) => {
    const t = (root.textContent || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/No\s+search\s+results\s+found|No\s+results?[^.]*|not\s+found/i);
    return m ? m[0] : `(none) full="${t.slice(0, 200)}"`;
  });
}

async function checkOption(page, name) {
  const cb = page.getByRole('checkbox', { name, exact: true }).first();
  await cb.waitFor({ state: 'visible', timeout: 5000 });
  await cb.click();
  await page.waitForTimeout(200);
}

async function apply(page) {
  await panel(page).locator('button:has-text("Apply")').first().click();
  await page.waitForTimeout(1500);
}

async function clearAll(page) {
  const clear = page.locator('button:has-text("Clear All")').first();
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
    await page.waitForTimeout(1200);
  }
}

async function gridHeaders(page) {
  return await page.locator('[role="columnheader"]').allTextContents();
}

async function readGrid(page) {
  return await page.locator('[role="rowgroup"] [role="row"]').evaluateAll((rows) =>
    rows.map((r) => [...r.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent.trim()))
  );
}

async function emptyStateText(page) {
  return await page.locator('main').evaluate((m) => {
    const t = (m.textContent || '').replace(/\s+/g, ' ');
    const m2 = t.match(/Nothing here yet[^.]*/i);
    return m2 ? m2[0] : '(no "Nothing here yet")';
  });
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 40 : 0 });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await login(page);
  await gotoClinics(page);
  await clearAll(page);

  console.log('\n===== GRID COLUMN HEADERS =====');
  console.log(JSON.stringify(await gridHeaders(page)));
  console.log('sample rows:', JSON.stringify((await readGrid(page)).slice(0, 3), null, 2));

  // ---- City options + partial search + no-results text ----
  console.log('\n===== CITY tab =====');
  await openFilters(page);
  await openDropdown(page, 'City');
  const cities = await optionNames(page);
  console.log('city options:', JSON.stringify(cities));
  await searchOptions(page, cities[0] ? cities[0].slice(0, 2) : 'a');
  console.log('after partial search:', JSON.stringify(await optionNames(page)));
  await searchOptions(page, 'zzzqqqxxx');
  console.log('no-results text:', await noResultsText(page));
  await closePanel(page);

  // ---- State options ----
  console.log('\n===== STATE tab =====');
  await openFilters(page);
  await openDropdown(page, 'State');
  const states = await optionNames(page);
  console.log('state options:', JSON.stringify(states));
  await searchOptions(page, 'zzzqqqxxx');
  console.log('no-results text:', await noResultsText(page));
  await closePanel(page);

  // ---- Behavior: City only ----
  const cityPick = cities.find((c) => /new york/i.test(c)) || cities[0];
  console.log(`\n===== APPLY City="${cityPick}" ONLY =====`);
  await openFilters(page);
  await openDropdown(page, 'City');
  await checkOption(page, cityPick);
  await apply(page);
  let g = await readGrid(page);
  console.log(`rows=${g.length}`);
  console.log('rows:', JSON.stringify(g, null, 2));
  await clearAll(page);

  // ---- Behavior: State only ----
  const statePick = states[0];
  console.log(`\n===== APPLY State="${statePick}" ONLY =====`);
  await openFilters(page);
  await openDropdown(page, 'State');
  await checkOption(page, statePick);
  await apply(page);
  g = await readGrid(page);
  console.log(`rows=${g.length}`);
  console.log('rows:', JSON.stringify(g, null, 2));
  await clearAll(page);

  // ---- Behavior: City + State together (to infer OR vs AND vs dominance) ----
  // Pick a state that is NOT the state of the chosen city, if determinable.
  const stateForCombo = states.find((s) => s !== statePick) || states[0];
  console.log(`\n===== APPLY City="${cityPick}" + State="${stateForCombo}" TOGETHER =====`);
  await openFilters(page);
  await openDropdown(page, 'City');
  await checkOption(page, cityPick);
  await openDropdown(page, 'State');
  await checkOption(page, stateForCombo);
  await apply(page);
  g = await readGrid(page);
  console.log(`rows=${g.length}`);
  console.log('rows:', JSON.stringify(g, null, 2));
  await clearAll(page);

  // ---- Inactive tab structure + options ----
  console.log('\n===== INACTIVE TAB =====');
  await page.locator('[role="tab"]:has-text("Inactive")').first().click();
  await page.waitForTimeout(1200);
  await clearAll(page);
  console.log('inactive sample rows:', JSON.stringify((await readGrid(page)).slice(0, 3), null, 2));
  await openFilters(page);
  await openDropdown(page, 'City');
  const inactiveCities = await optionNames(page);
  console.log('inactive city options:', JSON.stringify(inactiveCities));
  await closePanel(page);

  // ---- Empty state ("Nothing here yet"): filter Inactive by a city that likely has no inactive clinic ----
  if (inactiveCities.length) {
    const pick = inactiveCities[inactiveCities.length - 1];
    console.log(`\n===== INACTIVE filter City="${pick}" (probe empty state) =====`);
    await openFilters(page);
    await openDropdown(page, 'City');
    await checkOption(page, pick);
    await apply(page);
    console.log(`rows=${(await readGrid(page)).length}`);
    console.log('empty-state text:', await emptyStateText(page));
    await clearAll(page);
  }

  await browser.close();
}

main().catch((e) => {
  console.error('PROBE FAILED:', e.message);
  process.exit(1);
});
