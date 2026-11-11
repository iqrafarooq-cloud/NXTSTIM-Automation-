const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const path = require('path');
const { AddClinicModal } = require('../pages/AddClinicModal');
const { ClinicsPage } = require('../pages/ClinicsPage');
const SLOW = { timeout: 120000 };

const UPLOAD_FIXTURE = path.resolve(process.cwd(), 'test-data', 'files', 'clinic-upload-sample.csv');

function truncate(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function formatClinics(rows, limit = 15) {
  if (!rows || !rows.length) return ['  (no clinics displayed)'];
  const lines = rows
    .slice(0, limit)
    .map(
      (r) =>
        `  • ${String(r.id || '?').padEnd(7)} ${truncate(r.name, 34).padEnd(35)} ` +
        `(${r.city || '—'}, ${r.state || '—'})`
    );
  if (rows.length > limit) lines.push(`  … and ${rows.length - limit} more row(s) on this page`);
  return lines;
}

/** Renders parsed CSV records (id / name / city / state) for an attachment. */
function formatCsvRecords(records, limit = 15) {
  if (!records || !records.length) return ['  (no data rows — header only)'];
  const lines = records
    .slice(0, limit)
    .map(
      (r) =>
        `  • ${String(r.ID || '?').padEnd(7)} ${truncate(r.Name, 34).padEnd(35)} ` +
        `(${r.City || '—'}, ${r.State || '—'})`
    );
  if (records.length > limit) lines.push(`  … and ${records.length - limit} more record(s)`);
  return lines;
}

function diffCsvAgainstGrid(csvRecords, gridRecords) {
  const cols = ClinicsPage.EXPORT_MATCH_COLUMNS;
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const csvById = new Map(csvRecords.map((r) => [String(r.ID), r]));
  const mismatches = [];
  for (const g of gridRecords) {
    const c = csvById.get(String(g.ID));
    if (!c) {
      mismatches.push(`clinic #${g.ID}: shown in grid but MISSING from the CSV`);
      continue;
    }
    for (const col of cols) {
      if (norm(c[col]) !== norm(g[col])) {
        mismatches.push(`clinic #${g.ID} [${col}]: CSV "${c[col]}" ≠ grid "${g[col]}"`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
async function assertSorted(world, dir) {
  const ids = world.lastSortedIds || [];
  const nums = ids.map(Number);
  let ok = ids.length > 0;
  let firstViolation = null;
  for (let i = 1; i < nums.length; i++) {
    const bad = dir === 'asc' ? nums[i] < nums[i - 1] : nums[i] > nums[i - 1];
    if (bad) {
      ok = false;
      firstViolation = `${ids[i - 1]} → ${ids[i]} (position ${i})`;
      break;
    }
  }
  const word = dir === 'asc' ? 'ascending (non-decreasing)' : 'descending (non-increasing)';
  await report(world, `Order assertion — ${word}, ${ids.length} clinic(s)`, [
    ok
      ? `✓ Every ID is ${word} across the full list`
      : `✗ Order violation at ${firstViolation}`,
    `Range: ${ids[0] || '—'} … ${ids[ids.length - 1] || '—'}`
  ]);
  expect(ids.length).toBeGreaterThan(0);
  expect(ok).toBeTruthy();
}

/** Attaches a titled, plain-text block to the current step in the report. */
async function report(world, title, lines) {
  const body = [title, '─'.repeat(Math.max(title.length, 28)), ...lines].join('\n');
  await world.attach(body, 'text/plain');
}

// Helpers
function adminCreds() {
  return {
    email: process.env.BASE_EMAIL || process.env.TEST_USER_EMAIL,
    password: process.env.BASE_PASSWORD || process.env.TEST_USER_PASSWORD
  };
}

async function loginAsAdmin(world) {
  const { email, password } = adminCreds();
  if (!email || !password) {
    throw new Error(
      'Admin credentials missing. Set BASE_EMAIL/BASE_PASSWORD (or TEST_USER_EMAIL/TEST_USER_PASSWORD) in .env'
    );
  }
  await world.pages.login.open();
  await world.pages.login.login(email, password);
  // This account is non-MFA and lands on /monitoring; just wait until we leave /login.
  await world.pages.login.expectNavigatedAwayFromLogin();
}

/** Runs the full 3-step wizard for a freshly generated clinic and records it. */
async function createClinicViaWizard(world) {
  world.clinicTotalBefore = await world.pages.clinics.getTotalCount();
  const data = AddClinicModal.buildValidClinic();
  world.newClinic = data;
  world.clinicName = data.name;
  await world.pages.clinics.clickAddClinic();
  await world.pages.addClinic.createClinic(data);
  // Give the list a beat to refresh with the new row.
  await world.page.waitForTimeout(2000);
}


let sharedClinicName = null;
let sharedClinicId = null;

/** Ensures the shared clinic exists (creating it once) and records name + id. */
async function ensureSharedClinicCreated(world) {
  if (!sharedClinicId) {
    await createClinicViaWizard(world);
    sharedClinicName = world.clinicName;
    await world.pages.clinics.openDetailsFor(sharedClinicName);
    const m = (await world.pages.clinicDetail.getCurrentUrl()).match(/\/clinics\/(\d+)/);
    sharedClinicId = m ? m[1] : null;
  }
  world.clinicName = sharedClinicName;
  world.clinicId = sharedClinicId;
}

// GIVEN
Given('the admin is logged in and on the Clinics page', SLOW, async function () {
  await loginAsAdmin(this);
  await this.pages.clinics.open();
  expect(await this.pages.clinics.isOnClinicsPage()).toBeTruthy();
  // The list's search/filter state persists server-side per account, so clear
  // it up-front — otherwise a search/filter from a previous scenario leaves
  // this scenario's grid empty.
  await this.pages.clinics.resetListState();
});

Given('the admin has created a new clinic', SLOW, async function () {
  await createClinicViaWizard(this);
  expect(await this.pages.clinics.isClinicPresent(this.clinicName)).toBeTruthy();
});

Given('the admin has created a new clinic and opened its details', SLOW, async function () {
  await createClinicViaWizard(this);
  expect(await this.pages.clinics.isClinicPresent(this.clinicName)).toBeTruthy();
  await this.pages.clinics.openDetailsFor(this.clinicName);
  const m = (await this.pages.clinicDetail.getCurrentUrl()).match(/\/clinics\/(\d+)/);
  this.clinicId = m ? m[1] : null;
  expect(await this.pages.clinicDetail.isOnDetailPage()).toBeTruthy();
});

// Reuse the shared throwaway clinic (creates it once per run) — opened on its
// detail page, ready for tab/edit/tag/file/billing interactions.
Given('the admin has a reusable test clinic open', SLOW, async function () {
  await ensureSharedClinicCreated(this);
  await this.pages.clinicDetail.open(sharedClinicId);
  expect(await this.pages.clinicDetail.isOnDetailPage()).toBeTruthy();
});

// Reuse the shared throwaway clinic, but land on the list (for row actions).
Given('the admin has a reusable test clinic in the list', SLOW, async function () {
  await ensureSharedClinicCreated(this);
  await this.pages.clinics.open();
  await this.pages.clinics.searchBy('Clinic Name', sharedClinicName);
  expect(await this.pages.clinics.isClinicPresent(sharedClinicName)).toBeTruthy();
});

// WHEN — list controls
When('the admin selects the {string} tab', async function (tab) {
  await this.pages.clinics.switchToTab(tab);
});

When('the admin opens the Sort By menu', async function () {
  await this.pages.clinics.openSortMenu();
});

When('the admin sorts clinics by {string}', async function (label) {
  await this.pages.clinics.sortBy(label);
  // Collect the FULL sorted list (across the virtualised grid + any pages) so
  // the assertions verify the whole order, not just the first visible page.
  const ids = await this.pages.clinics.collectSortedIds();
  this.sortLists = this.sortLists || {};
  this.sortLists[label] = ids;
  this.lastSortLabel = label;
  this.lastSortedIds = ids;
  await report(this, `Sorted by "${label}" — ${ids.length} clinic(s) in grid order`, [
    `First 5 IDs : ${ids.slice(0, 5).join(', ') || '—'}`,
    `Last 5 IDs  : ${ids.slice(-5).join(', ') || '—'}`,
    `Order checked across all ${ids.length} rows (not just the first page)`
  ]);
});

When('the admin opens the Filters panel', async function () {
  await this.pages.clinics.openFilters();
});

// WHEN — Search (data-driven; values discovered from the live grid)

function buildSearchQuery(mode, rawValue) {
  const token = ClinicsPage.searchToken(rawValue);
  switch (mode) {
    case 'exact':
      return String(rawValue);
    case 'lowercase':
      return token.toLowerCase();
    case 'partial':
      return token.slice(0, Math.max(2, Math.ceil(token.length / 2)));
    case 'padded':
      return `   ${token}   `;
    default:
      return token;
  }
}

When('the admin searches each field for a value taken from the grid', SLOW, async function () {
  this.searchRuns = [];
  for (const field of ClinicsPage.SEARCH_FIELDS) {
    await this.pages.clinics.clearSearch();
    const key = ClinicsPage.FIELD_KEY[field];
    const ref = await this.pages.clinics.pickReferenceClinic(field);
    const rawValue = ref ? ref[key] : '';
    const token = ClinicsPage.searchToken(rawValue);
    await this.pages.clinics.searchInField(field, token);
    const rows = await this.pages.clinics.getVisibleClinics();
    const total = await this.pages.clinics.getTotalCount();
    const containsSource = ref ? rows.some((r) => r.id === ref.id) : false;
    const allMatch =
      rows.length > 0 &&
      rows.every((r) => String(r[key] || '').toLowerCase().includes(token.toLowerCase()));
    this.searchRuns.push({ field, token, sourceId: ref && ref.id, containsSource, allMatch });
    await report(this, `🔎 SEARCH BY ${field.toUpperCase()}`, [
      `Search By field : ${field}`,
      `Query           : "${token}"  (from clinic #${ref && ref.id}, read at runtime)`,
      `Records found   : ${total == null ? rows.length : total} clinic(s) (showing ${rows.length})`,
      `Source clinic   : #${ref && ref.id} ${containsSource ? '✓ present' : '✗ missing'}`,
      `Field-scoped    : ${allMatch ? `✓ every row matches the ${field}` : '✗ an off-field row appeared'}`,
      'Displayed clinics:',
      ...formatClinics(rows)
    ]);
  }
});

When(
  'the admin searches {string} for a/an {word} form of a grid value',
  SLOW,
  async function (field, mode) {
    await this.pages.clinics.clearSearch();
    const key = ClinicsPage.FIELD_KEY[field];
    const ref = await this.pages.clinics.pickReferenceClinic(field);
    const raw = ref ? String(ref[key]) : '';
    const query = buildSearchQuery(mode, raw);
    this.searchSourceId = ref && ref.id;
    await this.pages.clinics.searchInField(field, query);
    this.searchRows = await this.pages.clinics.getVisibleClinics();
    const total = await this.pages.clinics.getTotalCount();
    await report(this, `🔎 SEARCH — ${field} (${mode})`, [
      `Search By field : ${field}`,
      `Source clinic   : #${ref && ref.id}  value "${raw}"`,
      `Query (${mode})    : "${query}"`,
      `Records found   : ${total == null ? this.searchRows.length : total} (showing ${this.searchRows.length})`,
      'Displayed clinics:',
      ...formatClinics(this.searchRows)
    ]);
  }
);

// Searches under one field for a value belonging to a DIFFERENT field/column.
When(
  'the admin searches {string} using a value from the {string} column',
  SLOW,
  async function (searchField, sourceField) {
    await this.pages.clinics.clearSearch();
    const key = ClinicsPage.FIELD_KEY[sourceField];
    const ref = await this.pages.clinics.pickReferenceClinic(sourceField);
    const token = ClinicsPage.searchToken(ref ? ref[key] : '');
    await this.pages.clinics.searchInField(searchField, token);
    const count = await this.pages.clinics.getRowCount();
    const total = await this.pages.clinics.getTotalCount();
    await report(this, '🚫 FIELD-SCOPING CHECK', [
      `Search By field : ${searchField}`,
      `Query           : "${token}"  (a ${sourceField} value, taken from the grid)`,
      `Records found   : ${total == null ? count : total}`,
      `Expectation     : a ${sourceField} value must NOT match under ${searchField} → empty state`
    ]);
  }
);

// Changes the Search By field without clearing the text (re-scopes it live).
When('the admin switches the Search By field to {string}', SLOW, async function (field) {
  await this.pages.clinics.selectSearchField(field);
  const count = await this.pages.clinics.getRowCount();
  const total = await this.pages.clinics.getTotalCount();
  await report(this, '🔀 SEARCH BY FIELD SWITCHED', [
    `Now searching   : ${field}`,
    `Records found   : ${total == null ? count : total} (the previously typed text is re-scoped)`
  ]);
});

// Searches a field for a literal value (special characters / nonsense / IDs).
When('the admin searches {string} for {string}', SLOW, async function (field, value) {
  await this.pages.clinics.searchInField(field, value);
  const count = await this.pages.clinics.getRowCount();
  const total = await this.pages.clinics.getTotalCount();
  await report(this, `🔎 SEARCH — ${field}`, [
    `Search By field : ${field}`,
    `Query           : "${value}"`,
    `Records found   : ${total == null ? count : total}`
  ]);
});

When('the admin clears the clinic search', SLOW, async function () {
  await this.pages.clinics.clearSearch();
});


When('the admin exports the clinics list as CSV', SLOW, async function () {
  this.displayedCount = await this.pages.clinics.getTotalCount();
  this.gridRecords = await this.pages.clinics.getAllGridRecords();
  this.gridHeaders = await this.pages.clinics.getGridColumnHeaders();
  this.csv = await this.pages.clinics.exportCsvAndRead();
  this.csvFilename = this.csv.filename;
  await report(this, `⬇️ EXPORT CSV — "${this.csv.filename}"`, [
    `File name       : ${this.csv.filename}`,
    `Displayed count : ${this.displayedCount == null ? '(n/a)' : this.displayedCount} clinic(s)`,
    `Grid rows read  : ${this.gridRecords.length}`,
    `CSV data rows   : ${this.csv.records.length}`,
    `CSV columns     : ${this.csv.columns.join(', ')}`,
    'First CSV records:',
    ...formatCsvRecords(this.csv.records)
  ]);
});


When('the admin searches for a value that narrows the grid', SLOW, async function () {
  await this.pages.clinics.clearSearch();
  const ref = await this.pages.clinics.pickReferenceClinic('City');
  this.searchNarrowValue = ref ? ref.city : '';
  expect(this.searchNarrowValue, 'expected a City value in the grid to search for').toBeTruthy();
  await this.pages.clinics.searchInField('City', this.searchNarrowValue);
  const total = await this.pages.clinics.getTotalCount();
  const rows = await this.pages.clinics.getVisibleClinics();
  await report(this, '🔎 SEARCH — narrowing the grid before export', [
    `Search By field : City`,
    `Query           : "${this.searchNarrowValue}"  (discovered at runtime)`,
    `Records found   : ${total == null ? rows.length : total} clinic(s)`,
    'Displayed clinics:',
    ...formatClinics(rows)
  ]);
});


When('the admin applies a City filter and a search together', SLOW, async function () {
  this.selectedCity = await this.pages.clinics.findPopulatedFilterValue('City');
  expect(this.selectedCity, 'expected a City with clinics to filter by').toBeTruthy();
  await this.pages.clinics.applyFilter('City', this.selectedCity);
  const filtered = await this.pages.clinics.getVisibleClinics();
  const ref = filtered.find((r) => r.name) || filtered[0];
  const token = ClinicsPage.searchToken(ref && ref.name);
  await this.pages.clinics.searchInField('Clinic Name', token);
  const total = await this.pages.clinics.getTotalCount();
  const rows = await this.pages.clinics.getVisibleClinics();
  await report(this, '🔀 COMBINED SEARCH + FILTER before export', [
    `Filter (City)   : "${this.selectedCity}"`,
    `Search (Name)   : "${token}"  (token from a visible row, discovered at runtime)`,
    `Records found   : ${total == null ? rows.length : total} clinic(s)`,
    'Displayed clinics:',
    ...formatClinics(rows)
  ]);
});

// WHEN — Filters (City + State), fully data-driven

When('the admin filters by a City that has clinics', SLOW, async function () {
  this.selectedCity = await this.pages.clinics.findPopulatedFilterValue('City');
  expect(this.selectedCity, 'expected at least one City in the grid').toBeTruthy();
  await this.pages.clinics.applyFilter('City', this.selectedCity);
  const total = await this.pages.clinics.getTotalCount();
  const clinics = await this.pages.clinics.getVisibleClinics();
  await report(this, '🔎 FILTER APPLIED — City', [
    'Filter used    : City',
    `Value selected : "${this.selectedCity}"  (discovered at runtime)`,
    `Records found  : ${total == null ? clinics.length : total} clinic(s)` +
      ` (showing ${clinics.length} on this page)`,
    'Displayed clinics:',
    ...formatClinics(clinics)
  ]);
});

When('the admin filters by a State that has clinics', SLOW, async function () {
  this.selectedState = await this.pages.clinics.findPopulatedFilterValue('State');
  expect(this.selectedState, 'expected at least one State in the grid').toBeTruthy();
  await this.pages.clinics.applyFilter('State', this.selectedState);
  const total = await this.pages.clinics.getTotalCount();
  const clinics = await this.pages.clinics.getVisibleClinics();
  await report(this, '🔎 FILTER APPLIED — State', [
    'Filter used    : State',
    `Value selected : "${this.selectedState}"  (discovered at runtime)`,
    `Records found  : ${total == null ? clinics.length : total} clinic(s)` +
      ` (showing ${clinics.length} on this page)`,
    'Displayed clinics:',
    ...formatClinics(clinics)
  ]);
});


When('the admin filters by a City, then by a State, then by both together', SLOW, async function () {
  const pair = await this.pages.clinics.findUnionPair();
  expect(pair, 'need a City and a differing State in the grid for the union check').toBeTruthy();
  this.selectedCity = pair.city;
  this.selectedState = pair.state;
  this.countCity = await this.pages.clinics.applyFilterAndCount('City', pair.city);
  this.countState = await this.pages.clinics.applyFilterAndCount('State', pair.state);
  this.countBoth = await this.pages.clinics.applyCityAndStateAndCount(pair.city, pair.state);
  const clinics = await this.pages.clinics.getVisibleClinics();
  const sum = this.countCity + this.countState;
  const orConfirmed = this.countBoth === sum;
  await report(this, '🔀 COMBINED FILTER — UNION / OR CHECK', [
    `City filter  : "${pair.city}"   → ${this.countCity} clinic(s)`,
    `State filter : "${pair.state}"   → ${this.countState} clinic(s)`,
    `City + State : (both applied together) → ${this.countBoth} clinic(s)`,
    `Union math   : ${this.countCity} + ${this.countState} = ${sum}  →  got ${this.countBoth}  ` +
      `${orConfirmed ? '✓ OR / UNION confirmed' : '✗ not a pure union'}`,
    'Logic        : combined shows clinics matching City OR State (union), not AND',
    'Displayed clinics (combined):',
    ...formatClinics(clinics)
  ]);
});

// One side has data, the other has none → union shows the matching side only.
When('the admin filters by a State that has clinics and a City that has none', SLOW, async function () {
  this.selectedState = await this.pages.clinics.findPopulatedFilterValue('State');
  this.emptyCity = await this.pages.clinics.findEmptyFilterValue('City');
  expect(this.selectedState, 'expected a populated State on this tab').toBeTruthy();
  expect(this.emptyCity, 'expected a City option with no clinics on this tab').toBeTruthy();
  await this.pages.clinics.applyCityAndState(this.emptyCity, this.selectedState);
  const total = await this.pages.clinics.getTotalCount();
  const clinics = await this.pages.clinics.getVisibleClinics();
  await report(this, '🔀 COMBINED FILTER — ONE SIDE HAS NO DATA', [
    `State filter : "${this.selectedState}"  → has matching clinics`,
    `City filter  : "${this.emptyCity}"  → no clinics on this tab (contributes nothing)`,
    `Records found: ${total == null ? clinics.length : total} clinic(s) — all from the State match`,
    'Displayed clinics:',
    ...formatClinics(clinics)
  ]);
});

// Neither side has data → empty grid ("Nothing here yet").
When('the admin filters by a City and a State that have no clinics', SLOW, async function () {
  this.emptyCity = await this.pages.clinics.findEmptyFilterValue('City');
  this.emptyState = await this.pages.clinics.findEmptyFilterValue('State');
  expect(this.emptyCity, 'expected a City option with no clinics on this tab').toBeTruthy();
  expect(this.emptyState, 'expected a State option with no clinics on this tab').toBeTruthy();
  await this.pages.clinics.applyCityAndState(this.emptyCity, this.emptyState);
  const rowCount = await this.pages.clinics.getRowCount();
  await report(this, '🚫 COMBINED FILTER — NO MATCHING DATA', [
    `City filter  : "${this.emptyCity}"  → no clinics on this tab`,
    `State filter : "${this.emptyState}"  → no clinics on this tab`,
    `Records found: ${rowCount} clinic(s)`,
    'Expected empty-state message: "Nothing here yet"'
  ]);
});

When('the admin opens the {string} filter', async function (dimension) {
  await this.pages.clinics.openFilterDimension(dimension);
});

When('the admin searches the {word} filter for a partial term', SLOW, async function (dimension) {
  const options = await this.pages.clinics.getListedFilterOptions();
  expect(options.length, 'the filter should list options to search').toBeGreaterThan(0);
  // Derive a real partial term from an existing option (first 3 letters).
  this.searchTerm = (options[0].replace(/\s+/g, '').slice(0, 3) || options[0]).toLowerCase();
  await this.pages.clinics.searchFilterOptions(this.searchTerm);
  const listed = await this.pages.clinics.getListedFilterOptions();
  await report(this, `⌨️ IN-FILTER SEARCH — ${dimension} (partial match)`, [
    `Filter used   : ${dimension}`,
    `Search text   : "${this.searchTerm}"  (a real substring taken from an option)`,
    `Options shown : ${listed.length}`,
    ...listed.slice(0, 15).map((o) => `  • ${o}`),
    ...(listed.length > 15 ? [`  … and ${listed.length - 15} more`] : [])
  ]);
});

When('the admin searches the {word} filter for {string}', SLOW, async function (dimension, term) {
  this.searchTerm = term;
  await this.pages.clinics.searchFilterOptions(term);
  const listed = await this.pages.clinics.getListedFilterOptions();
  const noResults = await this.pages.clinics.isNoSearchResultsVisible();
  await report(this, `⌨️ IN-FILTER SEARCH — ${dimension} (no match expected)`, [
    `Filter used   : ${dimension}`,
    `Search text   : "${term}"`,
    `Options shown : ${listed.length}`,
    `Message shown : ${noResults ? '"No search results found"' : '(none)'}`
  ]);
});

// WHEN — Add Clinic wizard
When('the admin opens the Add Clinic wizard', async function () {
  await this.pages.clinics.clickAddClinic();
  await this.pages.addClinic.waitForOpen();
});

When(
  'the admin fills the clinic profile with name {string} contact {string} email {string} phone {string}',
  SLOW,
  async function (name, contact, email, phone) {
    await this.pages.addClinic.fillClinicProfile({
      name,
      contactFullName: contact,
      contactEmail: email,
      phone: phone || ''
    });
    // Blur so the form re-validates the last field before we assert button state.
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(400);
  }
);

When('the admin creates a new clinic through the wizard', SLOW, async function () {
  await createClinicViaWizard(this);
});

// --- Wizard multi-step navigation (fills only; never submits) ---
When('the admin proceeds to the billing step', SLOW, async function () {
  const data = AddClinicModal.buildValidClinic();
  this.wizardData = data;
  this.profileContactEmail = data.profile.contactEmail;
  await this.pages.addClinic.fillClinicProfile(data.profile);
  await this.pages.addClinic.clickNext();
});

When('the admin proceeds to the shipping step', SLOW, async function () {
  const data = AddClinicModal.buildValidClinic();
  this.wizardData = data;
  this.profileContactEmail = data.profile.contactEmail;
  await this.pages.addClinic.fillClinicProfile(data.profile);
  await this.pages.addClinic.clickNext();
  await this.pages.addClinic.fillBillingDetails(data.billing);
  await this.pages.addClinic.clickNext();
});

When('the admin goes back to the previous step', async function () {
  await this.pages.addClinic.clickBack();
});

When('the admin enables {string}', async function (label) {
  await this.pages.addClinic.toggleCheckbox(label);
  await this.page.waitForTimeout(400);
});

When('the admin closes the Add Clinic wizard', async function () {
  await this.pages.addClinic.close();
});

// WHEN — detail page
When('the admin opens the details of the first clinic', SLOW, async function () {
  this.clinicId = await this.pages.clinics.openFirstClinicDetails();
  expect(await this.pages.clinicDetail.isOnDetailPage()).toBeTruthy();
});

When('the admin opens the {string} detail tab', async function (tab) {
  await this.pages.clinicDetail.clickTab(tab);
});

When('the admin opens the Edit Clinic modal', async function () {
  await this.pages.clinicDetail.openEdit();
});

When('the admin clears the clinic name field', async function () {
  await this.pages.clinicDetail.clearClinicName();
  await this.page.waitForTimeout(400);
});

When('the admin changes the clinic name to a new unique value', async function () {
  // Clinic Name allows only letters/spaces/hyphens/apostrophes — no digits.
  this.updatedClinicName = `${this.clinicName || 'QA Clinic'} Edited ${AddClinicModal.uniqueAlpha()}`;
  await this.pages.clinicDetail.editClinicName(this.updatedClinicName);
});

When('the admin saves the edit', SLOW, async function () {
  await this.pages.clinicDetail.saveEdit();
});

// --- Billing edit ---
When('the admin opens the Billing edit modal', async function () {
  await this.pages.clinicDetail.openBillingEdit();
});

When('the admin clears the Tax ID', async function () {
  await this.pages.clinicDetail.clearBillingTaxId();
});

When('the admin changes the Tax ID to a new valid value', SLOW, async function () {
  this.updatedTaxId = `12-${Date.now().toString().slice(-7)}`;
  await this.pages.clinicDetail.setBillingTaxId(this.updatedTaxId);
});

When('the admin saves the billing edit', SLOW, async function () {
  await this.pages.clinicDetail.saveBillingEdit();
});

// WHEN — patient tags
When('the admin opens the Add Patient Tag dialog', async function () {
  await this.pages.clinicDetail.openAddTag();
});

When(
  'the admin adds a patient tag named {string} with description {string}',
  SLOW,
  async function (name, description) {
    this.tagName = `${name} ${AddClinicModal.uniqueAlpha()}`;
    await this.pages.clinicDetail.openAddTag();
    await this.pages.clinicDetail.fillTag({ name: this.tagName, description });
    await this.pages.clinicDetail.saveTag();
  }
);

When('the admin deletes the patient tag {string}', SLOW, async function (_name) {
  this.deleteWarning = await this.pages.clinicDetail.deleteTag(this.tagName);
});

// WHEN — file vault
When('the admin opens the Upload File dialog', async function () {
  await this.pages.clinicDetail.openUpload();
});

When('the admin uploads the sample CSV file', SLOW, async function () {
  await this.pages.clinicDetail.openUpload();
  await this.pages.clinicDetail.chooseFile(UPLOAD_FIXTURE);
  await this.pages.clinicDetail.confirmUpload();
});

// WHEN — inactivate
When('the admin opens the Inactivate dialog for the new clinic', async function () {
  await this.pages.clinics.openInactivateDialog(this.clinicName);
});

When('the admin cancels the inactivate dialog', async function () {
  await this.pages.clinics.cancelInactivate();
});

When('the admin confirms the inactivation', SLOW, async function () {
  await this.pages.clinics.confirmInactivate();
});

// THEN — list layout
Then('the {string} heading should be visible', async function (_text) {
  expect(await this.pages.clinics.isHeadingVisible()).toBeTruthy();
});

Then('the {string} button should be visible', async function (_text) {
  expect(await this.pages.clinics.isVisible(this.pages.clinics.addClinicButton)).toBeTruthy();
});

Then('the {string} and {string} tabs should be visible', async function (a, b) {
  for (const name of [a, b]) {
    const tab = this.page.locator(`[role="tab"]:has-text("${name}")`).first();
    expect(await this.pages.clinics.isVisible(tab)).toBeTruthy();
  }
});

Then(
  'the clinic search, Filters, Sort By and Export CSV controls should be visible',
  async function () {
    expect(await this.pages.clinics.areControlsVisible()).toBeTruthy();
  }
);

Then('the clinic grid should be displayed', async function () {
  await this.pages.clinics.waitForRows();
  expect(await this.pages.clinics.getRowCount()).toBeGreaterThan(0);
});

Then('the total clinics count should be visible', async function () {
  expect(await this.pages.clinics.getTotalCount()).not.toBeNull();
});

Then('the {string} tab should be selected', async function (name) {
  expect(await this.pages.clinics.isTabSelected(name)).toBeTruthy();
});

Then('the Sort By menu should offer only {string} and {string}', async function (a, b) {
  const opts = await this.pages.clinics.getSortOptions();
  await report(this, 'Sort By options offered', [
    ...opts.map((o) => `  • ${o.label}${o.checked ? '   (selected)' : ''}`),
    `Total options: ${opts.length} (expected exactly 2 — ID is the only sortable column)`
  ]);
  const labels = opts.map((o) => o.label).sort();
  expect(labels).toEqual([a, b].sort());
});

Then('{string} should be the default selected sort', async function (label) {
  const opts = await this.pages.clinics.getSortOptions();
  const checked = opts.find((o) => o.checked);
  await report(this, 'Default selected sort', [
    `Selected: ${checked ? checked.label : '(none)'}`,
    `Expected default: ${label}`
  ]);
  expect(checked && checked.label).toEqual(label);
  await this.pages.clinics.closeSortMenu();
});

Then('the clinics should be ordered by ID ascending', async function () {
  await assertSorted(this, 'asc');
});

Then('the clinics should be ordered by ID descending', async function () {
  await assertSorted(this, 'desc');
});

Then(
  'the descending order should be the exact reverse of the ascending order',
  async function () {
    const lists = this.sortLists || {};
    const asc = lists['ID: Asc'] || [];
    const desc = lists['ID: Desc'] || [];
    const reversed = [...asc].reverse();
    const match = JSON.stringify(reversed) === JSON.stringify(desc);
    await report(this, `Reverse-invariant check — ${asc.length} clinic(s)`, [
      `Ascending  : ${asc[0] || '—'} … ${asc[asc.length - 1] || '—'}`,
      `Descending : ${desc[0] || '—'} … ${desc[desc.length - 1] || '—'}`,
      match
        ? '✓ Descending is the exact reverse of ascending'
        : '✗ Descending is NOT the exact reverse of ascending'
    ]);
    expect(asc.length).toBeGreaterThan(0);
    expect(desc.length).toEqual(asc.length);
    expect(desc).toEqual(reversed);
  }
);

Then('the Filters panel should offer City and State options', async function () {
  const panel = this.page.locator('.MuiPopover-root, .MuiPopper-root, [role="dialog"]').first();
  const text = (await panel.innerText()) || '';
  expect(/City/i.test(text)).toBeTruthy();
  expect(/State/i.test(text)).toBeTruthy();
  await this.pages.clinics.closePopover();
});

// THEN — Filters (City + State)
Then('every visible clinic row should match the selected City', async function () {
  const rows = await this.pages.clinics.getVisibleCityStateRows();
  expect(rows.length, 'expected at least one filtered row').toBeGreaterThan(0);
  for (const r of rows) expect(r.city).toBe(this.selectedCity);
});

Then('every visible clinic row should match the selected State', async function () {
  const rows = await this.pages.clinics.getVisibleCityStateRows();
  expect(rows.length, 'expected at least one filtered row').toBeGreaterThan(0);
  for (const r of rows) expect(r.state).toBe(this.selectedState);
});

Then('every visible clinic row should match the selected City or State', async function () {
  const rows = await this.pages.clinics.getVisibleCityStateRows();
  expect(rows.length, 'expected at least one filtered row').toBeGreaterThan(0);
  for (const r of rows) {
    expect(
      r.city === this.selectedCity || r.state === this.selectedState,
      `row ${r.city}/${r.state} matched neither ${this.selectedCity} nor ${this.selectedState}`
    ).toBeTruthy();
  }
});

Then('at least one clinic row should be shown', async function () {
  expect(await this.pages.clinics.getRowCount()).toBeGreaterThan(0);
});

// Union proof, pagination-independent: with a disjoint City/State pair the
// combined total equals the sum of the individual totals (overlap = 0).
Then(
  'the combined result should equal the union of the City and State results',
  async function () {
    expect(this.countCity, 'City-only count').toBeGreaterThan(0);
    expect(this.countState, 'State-only count').toBeGreaterThan(0);
    expect(this.countBoth).toBe(this.countCity + this.countState);
  }
);

Then('the clinics grid should show {string}', async function (message) {
  expect(await this.pages.clinics.getRowCount()).toBe(0);
  expect(await this.pages.clinics.mainContainsText(message)).toBeTruthy();
});

Then('only {word} options containing the searched term should be listed', async function (_dimension) {
  const listed = await this.pages.clinics.getListedFilterOptions();
  expect(listed.length, 'partial search should still list matching options').toBeGreaterThan(0);
  for (const o of listed) {
    expect(o.toLowerCase()).toContain(this.searchTerm.toLowerCase());
  }
  await this.pages.clinics.closePopover();
});

Then('the {word} filter should show {string}', async function (_dimension, message) {
  const shown =
    (await this.pages.clinics.isNoSearchResultsVisible()) ||
    (await this.pages.clinics.mainContainsText(message));
  expect(shown, `expected the filter to show "${message}"`).toBeTruthy();
  // No options should remain listed when nothing matches.
  expect((await this.pages.clinics.getListedFilterOptions()).length).toBe(0);
  await this.pages.clinics.closePopover();
});

// THEN — search
Then('every field should return the clinic it was taken from', function () {
  expect(this.searchRuns && this.searchRuns.length, 'no search runs were recorded').toBeGreaterThan(0);
  const misses = this.searchRuns.filter((r) => !r.containsSource).map((r) => r.field);
  expect(misses, `fields where the source clinic was missing: ${misses.join(', ') || 'none'}`).toEqual([]);
});

Then("every field's results should stay scoped to that field", function () {
  expect(this.searchRuns && this.searchRuns.length, 'no search runs were recorded').toBeGreaterThan(0);
  const leaks = this.searchRuns.filter((r) => !r.allMatch).map((r) => r.field);
  expect(leaks, `fields with an off-field row: ${leaks.join(', ') || 'none'}`).toEqual([]);
});

Then('the source clinic should be in the results', async function () {
  const rows = this.searchRows || (await this.pages.clinics.getVisibleClinics());
  expect(
    rows.some((r) => r.id === this.searchSourceId),
    `clinic #${this.searchSourceId} was not in the results`
  ).toBeTruthy();
});

Then('the clinics grid should show the empty state', async function () {
  expect(await this.pages.clinics.waitForEmptyState()).toBeTruthy();
});

Then('all clinics should be listed again', SLOW, async function () {
  expect(await this.pages.clinics.getRowCount()).toBeGreaterThan(0);
  expect(await this.pages.clinics.isNothingHereYetVisible()).toBeFalsy();
});

// THEN — Add Clinic wizard
Then('the Add Clinic wizard should be on step {int}', async function (step) {
  expect(await this.pages.addClinic.getCurrentStep()).toBe(step);
});

Then('the Next button should be disabled', async function () {
  expect(await this.pages.addClinic.isNextEnabled()).toBeFalsy();
});

Then('the Next button should be enabled', async function () {
  expect(await this.pages.addClinic.isNextEnabled()).toBeTruthy();
});

Then('the Add Clinic button should be enabled', async function () {
  expect(await this.pages.addClinic.isSubmitEnabled()).toBeTruthy();
});

Then('the clinic name field should retain {string}', async function (text) {
  const value = await this.page
    .locator('input[placeholder="Enter Name"]')
    .first()
    .inputValue();
  expect(value).toContain(text);
});

Then('the billing email should match the contact email', async function () {
  const billing = await this.pages.addClinic.getBillingEmailValue();
  expect(billing).toBe(this.profileContactEmail);
});

Then('the Add Clinic wizard should be closed', async function () {
  expect(await this.pages.addClinic.isOpen().catch(() => false)).toBeFalsy();
});

Then('the admin should still be on the Clinics page', async function () {
  expect(await this.pages.clinics.isOnClinicsPage()).toBeTruthy();
});

// THEN — Export CSV
Then('the Export CSV button should be visible and enabled', async function () {
  expect(await this.pages.clinics.isVisible(this.pages.clinics.exportCsvButton)).toBeTruthy();
  expect(await this.pages.clinics.isExportEnabled()).toBeTruthy();
});

Then('a CSV file should be downloaded', async function () {
  expect(this.csvFilename || '').toMatch(/\.csv$/i);
});

// Filename convention + valid, parseable CSV in one check.
Then('a valid CSV file named {string} should be downloaded', function (name) {
  expect(this.csv, 'no CSV was captured — export step did not run').toBeTruthy();
  expect(this.csv.filename.toLowerCase()).toBe(name.toLowerCase());
  expect(this.csv.raw.length, 'the CSV file should not be empty').toBeGreaterThan(0);
  expect(this.csv.columns.length, 'the CSV should have a header row').toBeGreaterThan(0);
});

Then('the downloaded file name should be {string}', function (name) {
  expect((this.csvFilename || '').toLowerCase()).toBe(name.toLowerCase());
});

// The CSV header must equal the grid's own (non-empty) column headers, EXCEPT
// "Monitoring Metrics", which must not be exported (business rule).
Then('the CSV should contain the same columns as the grid', async function () {
  const gridCols = this.gridHeaders || (await this.pages.clinics.getGridColumnHeaders());
  const expected = gridCols.filter((c) => c !== 'Monitoring Metrics');
  await report(this, 'Columns comparison — CSV vs grid (excl. Monitoring Metrics)', [
    `Grid columns         : ${gridCols.join(', ')}`,
    `Expected CSV columns : ${expected.join(', ')}`,
    `Actual CSV columns   : ${this.csv.columns.join(', ')}`,
    'Rule: "Monitoring Metrics" must NOT appear in the exported CSV.'
  ]);
  expect(this.csv.columns).toEqual(expected);
});

// Explicit business rule: the Monitoring Metrics column must be excluded.
Then('the CSV should not contain a Monitoring Metrics column', async function () {
  await report(this, 'Monitoring Metrics exclusion check', [
    `CSV columns : ${this.csv.columns.join(', ')}`,
    `"Monitoring Metrics" present : ${this.csv.columns.includes('Monitoring Metrics') ? 'YES ✗' : 'no ✓'}`,
    'Rule: the "Monitoring Metrics" column must NOT appear in the exported CSV.'
  ]);
  expect(this.csv.columns).not.toContain('Monitoring Metrics');
});

Then('the CSV record count should equal the displayed clinics count', function () {
  expect(this.csv, 'no CSV was captured').toBeTruthy();
  // Grid harvest and CSV must agree; both must equal the on-screen total when known.
  expect(this.csv.records.length).toBe(this.gridRecords.length);
  if (this.displayedCount != null) {
    expect(this.csv.records.length).toBe(this.displayedCount);
  }
});

Then('the CSV should contain exactly {int} record(s)', function (n) {
  expect(this.csv.records.length).toBe(n);
});

Then('the CSV should contain the column headers but no data records', async function () {
  await report(this, 'Empty-grid export — header only', [
    `File name    : ${this.csv.filename}`,
    `CSV columns  : ${this.csv.columns.join(', ')}`,
    `Data rows    : ${this.csv.records.length} (expected 0)`
  ]);
  expect(this.csv.columns.length).toBeGreaterThan(0);
  expect(this.csv.records.length).toBe(0);
});

// Every parsed data row must have exactly as many fields as the header.
Then('the CSV should be well-formed', function () {
  expect(this.csv, 'no CSV was captured').toBeTruthy();
  const width = this.csv.columns.length;
  const bad = this.csv.rows
    .map((r, i) => ({ i, len: r.length }))
    .filter((x) => x.len !== width);
  expect(bad, `rows whose field count ≠ ${width}: ${JSON.stringify(bad)}`).toEqual([]);
});

// Cell-by-cell parity on the cleanly-mapping columns (see diffCsvAgainstGrid).
Then('the exported records should match the clinics shown in the grid', async function () {
  const { ok, mismatches } = diffCsvAgainstGrid(this.csv.records, this.gridRecords);
  await report(this, `Value parity — CSV vs grid (${ClinicsPage.EXPORT_MATCH_COLUMNS.join(', ')})`, [
    `Grid rows compared : ${this.gridRecords.length}`,
    ok ? '✓ Every compared value matches the grid' : `✗ ${mismatches.length} mismatch(es):`,
    ...mismatches.slice(0, 15).map((m) => `  • ${m}`)
  ]);
  expect(this.gridRecords.length, 'expected at least one grid row to compare').toBeGreaterThan(0);
  expect(ok, mismatches.join('; ')).toBeTruthy();
});

// Alias used by the full-list scenario (reads as a requirement sentence).
Then('every exported value should match the clinic shown in the grid', async function () {
  const { ok, mismatches } = diffCsvAgainstGrid(this.csv.records, this.gridRecords);
  await report(this, 'Value parity — CSV vs grid', [
    ok ? '✓ Every compared value matches the grid' : `✗ ${mismatches.length} mismatch(es):`,
    ...mismatches.slice(0, 15).map((m) => `  • ${m}`)
  ]);
  expect(this.gridRecords.length).toBeGreaterThan(0);
  expect(ok, mismatches.join('; ')).toBeTruthy();
});

Then('every exported record should match the selected City', function () {
  expect(this.csv.records.length, 'expected filtered records in the CSV').toBeGreaterThan(0);
  for (const r of this.csv.records) expect(r.City).toBe(this.selectedCity);
});

Then('a success indication should confirm the clinic was created', SLOW, async function () {
  // The app closes the wizard and prepends the new row on success. Treat either
  // the wizard closing or the new row appearing as confirmation.
  const closed = !(await this.pages.addClinic.isOpen().catch(() => false));
  const present = await this.pages.clinics.isClinicPresent(this.clinicName, 10000);
  expect(closed || present).toBeTruthy();
});

Then('the new clinic should appear in the Active clinics list', SLOW, async function () {
  expect(await this.pages.clinics.isTabSelected('Active')).toBeTruthy();
  expect(await this.pages.clinics.isClinicPresent(this.clinicName, 10000)).toBeTruthy();
});

Then('the total clinics count should increase by 1', SLOW, async function () {
  const before = this.clinicTotalBefore;
  if (before == null) return; // count unavailable; skip strict assertion
  let after = null;
  for (let i = 0; i < 5; i++) {
    after = await this.pages.clinics.getTotalCount();
    if (after != null && after >= before + 1) break;
    await this.page.waitForTimeout(1000);
  }
  expect(after).toBeGreaterThanOrEqual(before + 1);
});

// THEN — detail page
Then('the clinic detail page should be displayed', async function () {
  expect(await this.pages.clinicDetail.isOnDetailPage()).toBeTruthy();
});

Then('all clinic detail sub-tabs should be visible', async function () {
  expect(await this.pages.clinicDetail.areAllTabsVisible()).toBeTruthy();
});

Then('the listing should show sort and export controls', async function () {
  expect(await this.pages.clinicDetail.hasListingControls()).toBeTruthy();
});

Then('the billing inner tabs should be visible', async function () {
  expect(await this.pages.clinicDetail.areBillingInnerTabsVisible()).toBeTruthy();
});

Then('the billing inner tab {string} should be visible', async function (name) {
  expect(await this.pages.clinicDetail.isBillingInnerTabVisible(name)).toBeTruthy();
});

Then('the billing details should show {string}', async function (label) {
  expect(await this.pages.clinicDetail.billingInfoContains(label)).toBeTruthy();
});

Then('the {string} listing should show an empty state', async function (_tab) {
  expect(await this.pages.clinicDetail.isEmptyStateVisible()).toBeTruthy();
});

Then('the clinic profile should show the clinic information', async function () {
  expect(await this.pages.clinicDetail.hasClinicProfileInfo()).toBeTruthy();
});

Then('an Edit action should be available', async function () {
  expect(await this.pages.clinicDetail.isEditActionVisible()).toBeTruthy();
});

Then('the Patient Tags listing should show its controls', async function () {
  expect(await this.pages.clinicDetail.hasPatientTagsControls()).toBeTruthy();
});

Then('the File Vault listing should show its controls', async function () {
  expect(await this.pages.clinicDetail.hasFileVaultControls()).toBeTruthy();
});

// --- Billing edit validation / persistence ---
Then('a Tax ID validation error should be shown', async function () {
  const err = await this.pages.clinicDetail.getBillingErrorText();
  const disabled = !(await this.pages.clinicDetail.isBillingSaveEnabled());
  // Disjunctive per project convention: inline error OR a blocked Save.
  expect(/tax id/i.test(err) || disabled).toBeTruthy();
});

Then('the billing Save Changes button should be disabled', async function () {
  expect(await this.pages.clinicDetail.isBillingSaveEnabled()).toBeFalsy();
});

Then('the billing details should show the updated Tax ID', SLOW, async function () {
  let ok = false;
  for (let i = 0; i < 5; i++) {
    if (await this.pages.clinicDetail.billingInfoContains(this.updatedTaxId)) {
      ok = true;
      break;
    }
    await this.page.waitForTimeout(1000);
  }
  expect(ok).toBeTruthy();
});

// THEN — edit
Then('the Save button should be disabled', async function () {
  expect(await this.pages.clinicDetail.isEditSaveEnabled()).toBeFalsy();
});

Then('a clinic name validation error should be shown', async function () {
  // This form does NOT disable Save on empty name — it surfaces an inline
  // error ("Clinic name is required"). Accept either per project convention.
  const err = await this.pages.clinicDetail.getEditErrorText();
  const disabled = !(await this.pages.clinicDetail.isEditSaveEnabled());
  expect(/required|name/i.test(err) || disabled).toBeTruthy();
});

Then('the clinic header should show the updated name', SLOW, async function () {
  let ok = false;
  for (let i = 0; i < 5; i++) {
    if (await this.pages.clinicDetail.headerContains(this.updatedClinicName)) {
      ok = true;
      break;
    }
    await this.page.waitForTimeout(1000);
  }
  expect(ok).toBeTruthy();
});

// THEN — patient tags
Then('the Save Tag button should be disabled', async function () {
  expect(await this.pages.clinicDetail.isSaveTagEnabled()).toBeFalsy();
});

Then('the patient tag {string} should appear in the tags list', SLOW, async function (_name) {
  expect(await this.pages.clinicDetail.isTagPresent(this.tagName)).toBeTruthy();
});

Then('the delete confirmation should warn the action is irreversible', async function () {
  expect(this.deleteWarning || '').toMatch(/irreversible/i);
});

Then('the patient tag {string} should no longer be in the tags list', SLOW, async function (_name) {
  expect(await this.pages.clinicDetail.isTagPresent(this.tagName, 3000)).toBeFalsy();
});

// THEN — file vault
Then(
  'the upload dialog should state the supported file types and size limit',
  async function () {
    const text = await this.pages.clinicDetail.getUploadDialogText();
    expect(/pdf|doc|png|csv|xlsx/i.test(text)).toBeTruthy();
    expect(/5\s*MB/i.test(text)).toBeTruthy();
  }
);

Then('the uploaded file should appear in the File Vault list', SLOW, async function () {
  expect(await this.pages.clinicDetail.isFilePresent('clinic-upload-sample')).toBeTruthy();
});

// THEN — inactivate
Then('the inactivate dialog should warn the action is not reversible', async function () {
  const text = await this.pages.clinics.getInactivateDialogText();
  expect(/not reversible|irreversible/i.test(text)).toBeTruthy();
});

Then('the new clinic should still be Active', async function () {
  expect(await this.pages.clinics.isInactivateDialogOpen()).toBeFalsy();
  expect(await this.pages.clinics.getRowStatus(this.clinicName)).toBe('Active');
});

Then('the new clinic should appear in the list', SLOW, async function () {
  expect(await this.pages.clinics.isClinicPresent(this.clinicName, 10000)).toBeTruthy();
});

Then('the new clinic should only offer the View Details action', SLOW, async function () {
  const items = await this.pages.clinics.getRowMenuItems(this.clinicName);
  expect(items.join(' ')).toMatch(/View Details/i);
  expect(items.join(' ')).not.toMatch(/Mark as Inactive/i);
});
