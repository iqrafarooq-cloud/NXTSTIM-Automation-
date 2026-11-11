const fs = require('fs');
const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * ClinicsPage — Page Object for the Clinics list screen (/clinics).
 *
 * Surfaces the Active/Inactive tabs, the search-by-ID box, the Filters /
 * Sort By / Export CSV controls, the clinic grid, the per-row 3-dot action
 * menu (View Details / Mark as Inactive) and the irreversible "Inactivate
 * Clinic?" confirmation dialog.
 *
 * Selector strategy follows the project convention:
 *   data-testid -> role/aria/name -> semantic HTML -> MUI structural class.
 * The live build exposes a couple of stable class hooks (`.add-clinic-button`,
 * `.add-clinic-modal-confirm-button`) which are layered in first.
 */
class ClinicsPage extends BasePage {
  constructor(page) {
    super(page);

    this.url = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/clinics';

    this.selectors = {
      heading:
        '[data-testid="clinics-heading"], ' +
        'main p:has-text("Clinics")',
      addClinicButton:
        '[data-testid="add-clinic-button"], ' +
        'button.add-clinic-button, ' +
        'button[aria-label="Add Clinic"], ' +
        'main button:has-text("Add Clinic")',
      // The search box has a leading field-selector button ("ID" by default)
      // that switches which column the search matches (ID / Clinic Name / ...).
      // Leading "Search By" selector button; its label is the CURRENT field, so
      // list every possible label (the app switches ID → Clinic Name → …).
      searchFieldButton:
        '[data-testid="clinic-search-field"], ' +
        'main button:text-is("ID"), ' +
        'main button:text-is("Clinic Name"), ' +
        'main button:text-is("Street Address"), ' +
        'main button:text-is("City"), ' +
        'main button:text-is("State"), ' +
        'main button:text-is("Zip Code")',
      clearFiltersButton: 'button:has-text("Clear All")',
      tab: (name) =>
        `[data-testid="tab-${name.toLowerCase()}"], ` +
        `[role="tab"]:has-text("${name}")`,
      searchInput:
        '[data-testid="clinic-search"], ' +
        'input[placeholder="Search for ID"], ' +
        'input[placeholder*="Search" i]',
      filtersButton:
        '[data-testid="clinic-filters"], ' +
        'button:has-text("Filters")',
      sortByButton:
        '[data-testid="clinic-sort"], ' +
        'button:has-text("Sort By")',
      exportCsvButton:
        '[data-testid="clinic-export"], ' +
        'button:has-text("Export CSV")',
      totalCount:
        '[data-testid="clinic-total"], ' +
        'main :text-matches("\\\\d+\\\\s+Clinics?", "i")',

      // Grid
      gridRow:
        '[data-testid="clinic-row"], ' +
        '[role="rowgroup"] [role="row"]',
      // The row's 3-dot menu is the only plain MUI icon-button in the row
      // (the "View Metrics" control is a text button).
      rowKebab:
        '[data-testid="clinic-row-actions"], ' +
        'button.MuiIconButton-root',
      viewMetricsButton: 'button:has-text("View Metrics")',

      // Row action menu (mounts at <body> in a MUI popover).
      menuItem: (label) =>
        `[role="menuitem"]:has-text("${label}"), ` +
        `li[role="menuitem"]:has-text("${label}"), ` +
        `.MuiPopover-root li:has-text("${label}"), ` +
        `.MuiMenu-list li:has-text("${label}")`,

      // Sort By / Filters popover options.
      popoverOption: (label) =>
        `.MuiPopover-root :text-is("${label}"), ` +
        `.MuiMenu-list li:has-text("${label}"), ` +
        `[role="option"]:has-text("${label}")`,
      applyButton: '.MuiPopover-root button:has-text("Apply")',

      // Inactivate confirmation dialog.
      inactivateDialog:
        '[role="dialog"]:has-text("Inactivate Clinic")',
      inactivateConfirmButton:
        '[role="dialog"] button:has-text("Inactivate Clinic")',
      inactivateCancelButton:
        '[role="dialog"] button:has-text("Cancel")',

      // Toast / snackbar
      toast:
        '.notistack-MuiContent, .MuiAlert-message, [role="status"], [role="alert"]'
    };

    this.heading = page.locator(this.selectors.heading).first();
    this.addClinicButton = page.locator(this.selectors.addClinicButton).first();
    this.searchInput = page.locator(this.selectors.searchInput).first();
    this.filtersButton = page.locator(this.selectors.filtersButton).first();
    this.sortByButton = page.locator(this.selectors.sortByButton).first();
    this.exportCsvButton = page.locator(this.selectors.exportCsvButton).first();
    this.rows = page.locator(this.selectors.gridRow);
  }

  // ---- Navigation ----
  async open() {
    await this.navigate(this.url);
    await this.waitForLoaded();
  }

  async waitForLoaded() {
    await this.addClinicButton.waitFor({ state: 'visible', timeout: 20000 });
  }

  async isOnClinicsPage() {
    return /\/clinics(\?|$)/i.test(await this.getCurrentUrl());
  }

  /**
   * Clears any list state that PERSISTS SERVER-SIDE for the admin account:
   * an applied City/State filter and the search box. Without this, a search
   * ("99999999") or filter ("San Diego") applied by one scenario leaks into
   * later scenarios (fresh browser context, same login) and leaves the grid
   * showing nothing. Call after landing on the Clinics list.
   */
  async resetListState() {
    await this.waitForLoaded();
    await this.clearAllFilters();
    try {
      const val = await this.searchInput.inputValue();
      if (val) {
        await this.searchInput.fill('');
        await this.page.waitForTimeout(1000); // debounce + refetch
      }
    } catch { /* search box not ready; ignore */ }
    // NOTE: We deliberately do NOT reset the Sort By selection here. Opening the
    // Sort By menu on every scenario (via the shared Background) is an unnecessary
    // UI action for the ~90% of scenarios that don't care about order. The @sort
    // scenarios set their own order explicitly and each ends back on the app
    // default (ID: Desc), so no sort state leaks into order-agnostic scenarios.
    // Scenarios that DO need a known baseline call resetSort() themselves.
    await this.waitForRows();
  }

  // ---- Header / controls ----
  async clickAddClinic() {
    await this.click(this.addClinicButton);
  }

  async isHeadingVisible() {
    return await this.isVisible(this.heading);
  }

  async areControlsVisible() {
    return (
      (await this.isVisible(this.filtersButton)) &&
      (await this.isVisible(this.sortByButton)) &&
      (await this.isVisible(this.exportCsvButton)) &&
      (await this.isVisible(this.searchInput))
    );
  }

  // ---- Tabs ----
  async switchToTab(name) {
    const tab = this.page.locator(this.selectors.tab(name)).first();
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await tab.click();
    await this.page.waitForTimeout(800);
  }

  async isTabSelected(name) {
    const tab = this.page.locator(this.selectors.tab(name)).first();
    return (await tab.getAttribute('aria-selected')) === 'true';
  }

  // ---- Total count ----
  async getTotalCount() {
    const main = this.page.locator('main');
    const text = (await main.innerText()) || '';
    const m = text.match(/(\d+)\s+Clinics?/i);
    return m ? Number(m[1]) : null;
  }

  // -------------------------------------------------------------------------
  // Search — real-time, SERVER-SIDE, scoped to ONE "Search By" field
  //
  // Behaviour verified live (scripts/probe-clinic-search.js):
  //   - fields: ID | Clinic Name | Street Address | City | State | Zip Code
  //   - matching is PARTIAL (substring), CASE-INSENSITIVE, and leading/trailing
  //     spaces are trimmed
  //   - strictly FIELD-SCOPED: a value valid for one field returns the empty
  //     state ("Nothing here yet.") when a different field is selected; changing
  //     the field re-scopes any text already typed
  //   - EMPTY or whitespace-only input clears the filter and lists every clinic
  //   - the chosen field and the search text persist across the Active/Inactive
  //     tabs and server-side per admin account (hence resetListState())
  // The search debounces then refetches, so every search waits for the grid to
  // SETTLE (count/first-row stop changing) instead of a fixed sleep.
  // -------------------------------------------------------------------------

  /** Field labels offered by the "Search By" dropdown, in display order. */
  static get SEARCH_FIELDS() {
    return ['ID', 'Clinic Name', 'Street Address', 'City', 'State', 'Zip Code'];
  }

  /** Maps a Search By field label to the key returned by getVisibleClinics(). */
  static get FIELD_KEY() {
    return {
      ID: 'id',
      'Clinic Name': 'name',
      'Street Address': 'street',
      City: 'city',
      State: 'state',
      'Zip Code': 'zip'
    };
  }

  /**
   * Waits for a debounced search to apply: after an initial debounce window it
   * polls the (count | row-count | first-row id) signature until it stops
   * changing across two samples, so assertions never race the refetch.
   */
  async waitForSearchSettle(timeout = 12000) {
    await this.page.waitForTimeout(1300); // let the debounce fire + fetch start
    const sample = async () => {
      const total = await this.getTotalCount().catch(() => null);
      const count = await this.getRowCount().catch(() => 0);
      let firstId = '';
      if (count) {
        firstId = (
          (await this.rows
            .first()
            .locator('[role="gridcell"]')
            .nth(1)
            .innerText()
            .catch(() => '')) || ''
        ).trim();
      }
      return `${total}|${count}|${firstId}`;
    };
    const start = Date.now();
    let prev = await sample();
    while (Date.now() - start < timeout) {
      await this.page.waitForTimeout(700);
      const cur = await sample();
      if (cur === prev) return;
      prev = cur;
    }
  }

  /**
   * Dismisses an open MUI menu/popover if its (often invisible) modal backdrop
   * is still mounted. Selecting a Search By radio does NOT auto-close the menu,
   * and the lingering backdrop intercepts the next click — so close it first.
   */
  async dismissAnyMenu() {
    const backdrop = this.page.locator('.MuiBackdrop-root').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await backdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      await this.page.waitForTimeout(150);
    }
  }

  /** Opens the "Search By" dropdown and selects a field (keeps any typed text). */
  async selectSearchField(field) {
    await this.dismissAnyMenu();
    await this.page.locator(this.selectors.searchFieldButton).first().click();
    const option = this.page
      .locator(
        `[role="radiogroup"] :text-is("${field}"), ` +
          `[role="radio"][name="${field}"], ` +
          `.MuiMenu-root :text-is("${field}"), ` +
          `.MuiPopover-root :text-is("${field}"), ` +
          `[role="option"]:has-text("${field}")`
      )
      .first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    // Selecting doesn't close the menu — dismiss it so later clicks aren't
    // blocked by the invisible modal backdrop.
    await this.dismissAnyMenu();
    await this.waitForSearchSettle();
  }

  /** The currently selected "Search By" field label. */
  async getSelectedSearchField() {
    const btn = this.page.locator(this.selectors.searchFieldButton).first();
    return ((await btn.innerText()) || '').trim();
  }

  /** Types (replacing) the search text and waits for the grid to settle. */
  async setSearchText(value) {
    await this.searchInput.fill(String(value));
    await this.waitForSearchSettle();
  }

  /** Selects a Search By field, then searches for a value under it. */
  async searchInField(field, value) {
    await this.selectSearchField(field);
    await this.setSearchText(value);
  }

  async searchById(id) {
    await this.searchInField('ID', id);
  }

  async clearSearch() {
    await this.searchInput.fill('');
    await this.waitForSearchSettle();
  }

  // Back-compat alias used elsewhere in the suite (reusable-clinic Given).
  async searchBy(field, value) {
    await this.searchInField(field, value);
  }

  /**
   * Longest whitespace-free token of a field value — a robust, distinctive
   * partial search term (avoids internal double-space mismatches in stored
   * data, e.g. street addresses). Falls back to the trimmed value.
   */
  static searchToken(value) {
    const tokens = String(value == null ? '' : value)
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return '';
    return tokens.sort((a, b) => b.length - a.length)[0];
  }

  /**
   * Picks a reference clinic from the current (unfiltered) grid whose value for
   * `field` is non-empty, so it can be searched back. Returns the whole record.
   */
  async pickReferenceClinic(field) {
    await this.waitForRows().catch(() => {});
    const key = ClinicsPage.FIELD_KEY[field];
    const rows = await this.getVisibleClinics();
    return rows.find((r) => r[key] && String(r[key]).trim()) || rows[0] || null;
  }

  /** Text of a given 0-based grid column across all visible rows. */
  async getColumnValues(colIndex) {
    return await this.rows.evaluateAll((rows, idx) =>
      rows.map((r) => {
        const cells = r.querySelectorAll('[role="gridcell"]');
        return cells[idx] ? cells[idx].textContent.trim() : null;
      }),
      colIndex
    );
  }

  async getRowCount() {
    return await this.rows.count();
  }

  /** Waits until at least one data row is rendered (grid loads async). */
  async waitForRows(timeout = 15000) {
    try {
      await this.rows.first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Row lookup ----
  rowByText(text) {
    return this.rows.filter({ hasText: String(text) }).first();
  }

  async isClinicPresent(text, timeout = 8000) {
    try {
      await this.rowByText(text).waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  async isClinicAbsent(text, timeout = 8000) {
    try {
      await this.rowByText(text).waitFor({ state: 'hidden', timeout });
      return true;
    } catch {
      return (await this.rows.filter({ hasText: String(text) }).count()) === 0;
    }
  }

  async getRowStatus(text) {
    const row = this.rowByText(text);
    const t = (await row.innerText()) || '';
    if (/inactive/i.test(t)) return 'Inactive';
    if (/active/i.test(t)) return 'Active';
    return null;
  }

  // ---- Row action menu ----
  async openRowMenu(text) {
    const row = this.rowByText(text);
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const kebab = row.locator(this.selectors.rowKebab).last();
    await kebab.waitFor({ state: 'visible', timeout: 5000 });
    await kebab.click();
    await this.page.waitForTimeout(300); // let the popover mount
  }

  async clickMenuItem(label) {
    const item = this.page.locator(this.selectors.menuItem(label)).first();
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
  }

  async getRowMenuItems(text) {
    await this.openRowMenu(text);
    const items = this.page.locator(
      '.MuiPopover-root li, .MuiMenu-list li, [role="menuitem"]'
    );
    const labels = (await items.allTextContents()).map((s) => s.trim()).filter(Boolean);
    await this.page.keyboard.press('Escape').catch(() => {});
    return labels;
  }

  async openDetailsFor(text) {
    await this.openRowMenu(text);
    await this.clickMenuItem('View Details');
    await this.page.waitForURL(/\/clinics\/\d+/i, { timeout: 15000 });
  }

  /** Opens the first grid row's details and returns its clinic id. */
  async openFirstClinicDetails() {
    const id = await this.getFirstRowId();
    await this.openDetailsFor(id);
    return id;
  }

  async clickViewMetrics(text) {
    const row = this.rowByText(text);
    await row.locator(this.selectors.viewMetricsButton).first().click();
  }

  // ---- Inactivate flow ----
  async openInactivateDialog(text) {
    await this.openRowMenu(text);
    await this.clickMenuItem('Mark as Inactive');
    await this.page
      .locator(this.selectors.inactivateDialog)
      .first()
      .waitFor({ state: 'visible', timeout: 8000 });
  }

  async getInactivateDialogText() {
    return await this.getText(this.page.locator(this.selectors.inactivateDialog).first());
  }

  async confirmInactivate() {
    await this.page.locator(this.selectors.inactivateConfirmButton).first().click();
    await this.page
      .locator(this.selectors.inactivateDialog)
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await this.page.waitForTimeout(1500);
  }

  async cancelInactivate() {
    await this.page.locator(this.selectors.inactivateCancelButton).first().click();
    await this.page
      .locator(this.selectors.inactivateDialog)
      .first()
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }

  async isInactivateDialogOpen() {
    return await this.isVisible(this.page.locator(this.selectors.inactivateDialog).first());
  }

  // -------------------------------------------------------------------------
  // Sort By — ID only, ascending / descending (data-driven, full-list check)
  //
  // Behaviour verified live (scripts/probe-clinic-sort.js):
  //   - the Sort By control is a small menu with exactly TWO radio options,
  //     "ID: Asc" and "ID: Desc"; "ID: Desc" is the app default (checked)
  //   - selecting an option AUTO-CLOSES the menu (unlike the Search By dropdown,
  //     which leaves a modal backdrop) and triggers a SERVER-SIDE re-sort of the
  //     WHOLE list, so ordering must be asserted across every clinic, not just
  //     the first visible page
  //   - the grid is a VIRTUALISED MUI DataGrid: only ~9 rows mount at a time, so
  //     the full ID list is harvested by scrolling the virtual scroller; setting
  //     rows-per-page to its max (100) collapses the 70 Active clinics onto a
  //     single page so no page-walking is needed for the current data set
  //   - the selected sort persists per admin account, so resetListState() forces
  //     it back to the default (ID: Desc) to keep scenarios independent
  // -------------------------------------------------------------------------

  /** Opens the Sort By menu and waits for its radio options to render. */
  async openSortMenu() {
    await this.click(this.sortByButton);
    await this.page
      .locator(this.selectors.popoverOption('ID: Asc'))
      .first()
      .waitFor({ state: 'visible', timeout: 6000 });
  }

  /** Closes the Sort By menu (Escape) and waits for the options to detach. */
  async closeSortMenu() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page
      .locator(this.selectors.popoverOption('ID: Asc'))
      .first()
      .waitFor({ state: 'hidden', timeout: 4000 })
      .catch(() => {});
    await this.page.waitForTimeout(150);
  }

  /**
   * Reads the Sort By options while the menu is open. Returns
   * [{ label: 'ID: Asc', checked: false }, { label: 'ID: Desc', checked: true }].
   * Each option is a MUI FormControlLabel wrapping an <input type="radio"> and a
   * <p> label; input.checked reflects the current selection.
   */
  async getSortOptions() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('input[type="radio"]')]
        .map((inp) => {
          const label = inp.closest('.MuiFormControlLabel-root');
          return { label: (label ? label.textContent : '').trim(), checked: inp.checked };
        })
        .filter((o) => /^ID:\s*(Asc|Desc)$/i.test(o.label))
    );
  }

  /** The currently selected Sort By label (opens/closes the menu to read it). */
  async getSelectedSort() {
    await this.openSortMenu();
    const opts = await this.getSortOptions();
    await this.closeSortMenu();
    const checked = opts.find((o) => o.checked);
    return checked ? checked.label : null;
  }

  /**
   * Selects a Sort By option and waits for the server-side re-sort to settle.
   * The menu auto-closes on selection, so (unlike Search By) no backdrop
   * dismissal is needed.
   */
  async sortBy(label) {
    await this.openSortMenu();
    const opt = this.page.locator(this.selectors.popoverOption(label)).first();
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    await this.waitForGridSettle();
  }

  /**
   * Forces the sort back to the app default (ID: Desc). Called from
   * resetListState() because the selection persists per account and would
   * otherwise leak between scenarios (mirrors clearAllFilters / search clear).
   */
  async resetSort() {
    try {
      await this.openSortMenu();
      const opts = await this.getSortOptions();
      const checked = opts.find((o) => o.checked);
      if (!checked || !/Desc/i.test(checked.label)) {
        const opt = this.page.locator(this.selectors.popoverOption('ID: Desc')).first();
        await opt.click();
        await this.waitForGridSettle();
      } else {
        await this.closeSortMenu();
      }
    } catch {
      /* Sort By not present (e.g. empty grid); leave the order as-is. */
    }
  }

  /**
   * Waits for a server-side list refetch (sort / page change) to settle: after a
   * short debounce it polls the (total | row-count | first-row id) signature
   * until it stops changing, so assertions never race the refetch.
   */
  async waitForGridSettle(timeout = 12000) {
    await this.page.waitForTimeout(600);
    const sample = async () => {
      const total = await this.getTotalCount().catch(() => null);
      const count = await this.getRowCount().catch(() => 0);
      let firstId = '';
      if (count) {
        firstId = (
          (await this.rows
            .first()
            .locator('[role="gridcell"]')
            .nth(1)
            .innerText()
            .catch(() => '')) || ''
        ).trim();
      }
      return `${total}|${count}|${firstId}`;
    };
    const start = Date.now();
    let prev = await sample();
    while (Date.now() - start < timeout) {
      await this.page.waitForTimeout(600);
      const cur = await sample();
      if (cur === prev) return;
      prev = cur;
    }
  }

  /**
   * Bumps the "Rows per page" selector to its maximum (100) so the whole list
   * sits on ONE page. Idempotent — a no-op when already at 100 or when the
   * selector is absent (e.g. an empty grid).
   */
  async showAllRows() {
    const combo = this.page.locator('[role="combobox"]').first();
    if (!(await combo.isVisible().catch(() => false))) return;
    const current = ((await combo.textContent()) || '').trim();
    if (current === '100') return;
    await combo.click();
    const opt = this.page
      .locator('li[role="option"]:text-is("100"), [role="option"]:text-is("100")')
      .last();
    await opt.waitFor({ state: 'visible', timeout: 4000 });
    await opt.click();
    await this.waitForGridSettle();
  }

  /**
   * Harvests every clinic ID currently on the page IN GRID ORDER. The grid is
   * virtualised (only ~9 rows mount at once), so it scrolls the virtual scroller
   * top-to-bottom, deduping by ID and preserving first-seen (visual) order.
   */
  async harvestVisibleIds() {
    return await this.page.evaluate(async () => {
      const seen = new Map();
      const collect = () => {
        document.querySelectorAll('[role="rowgroup"] [role="row"]').forEach((r) => {
          const cells = r.querySelectorAll('[role="gridcell"]');
          const id = cells[1] ? cells[1].textContent.trim() : null;
          if (id && !seen.has(id)) seen.set(id, seen.size);
        });
      };
      const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
      const scroller = document.querySelector('.MuiDataGrid-virtualScroller');
      if (!scroller) {
        collect();
        return [...seen.keys()];
      }
      scroller.scrollTop = 0;
      await sleep(120);
      collect();
      for (let y = 0; y <= scroller.scrollHeight; y += 350) {
        scroller.scrollTop = y;
        await sleep(70);
        collect();
      }
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(120);
      collect();
      return [...seen.keys()];
    });
  }

  /**
   * Collects the FULL ordered list of clinic IDs across the whole (sorted) list:
   * bumps rows-per-page to its max, harvests the virtualised rows, then walks any
   * remaining pages. Returns IDs in grid order (a page guard caps the walk).
   */
  async collectSortedIds() {
    await this.showAllRows();
    await this.waitForRows();
    const all = [];
    for (let p = 0; p < 50; p++) {
      const ids = await this.harvestVisibleIds();
      all.push(...ids);
      const next = this.page.locator('[aria-label="Go to next page"]').first();
      const canNext = await next.isEnabled().catch(() => false);
      if (!canNext) break;
      await next.click();
      await this.waitForGridSettle();
    }
    return all;
  }

  async openFilters() {
    await this.click(this.filtersButton);
    await this.page
      .locator('.MuiPopover-root, [role="dialog"], .MuiPopper-root')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
  }

  // -------------------------------------------------------------------------
  // Filters — City + State (data-driven; no hardcoded values)
  //
  // Panel shape (verified against the live app via scripts/probe-clinic-filters.js):
  //   - vertical tabs "City" (default) / "State"
  //   - each tab shows a collapsed "All Cities" / "All States" control that must
  //     be CLICKED to reveal its checkbox list (which includes a "Select All")
  //   - an in-panel "Search Cities" / "Search States" box (partial, substring,
  //     case-insensitive); an unmatched term shows "No search results found"
  //   - an "Apply" button
  //   - the option lists are GLOBAL (same on Active and Inactive tabs), so a
  //     value can exist as an option yet match zero rows on the current tab
  //     (the grid then shows "Nothing here yet")
  //
  // Combined behaviour is a UNION / OR: City+State shows every clinic matching
  // the selected City OR the selected State (verified: 1 + 5 = 6 rows, and the
  // filter-aware total count sums the same way).
  // -------------------------------------------------------------------------
  // Scope to the popover that actually holds the City/State tabs, so a stale
  // popover mid-close (Escape animation) is never mistaken for the live panel.
  filterPanel() {
    return this.page
      .locator(
        '.MuiPopover-root:has([role="tab"]), ' +
        '.MuiPopper-root:has([role="tab"]), ' +
        '[role="dialog"]:has([role="tab"])'
      )
      .last();
  }

  /**
   * Selects the City or State tab inside the open Filters panel. Skips the click
   * when the tab is already selected (the City tab is selected by default) —
   * clicking a just-opened/closing panel can catch it mid-transition.
   */
  async selectFilterTab(dimension) {
    const panel = this.filterPanel();
    await panel.waitFor({ state: 'visible', timeout: 6000 });
    const tab = panel.locator(`[role="tab"]:has-text("${dimension}")`).first();
    await tab.waitFor({ state: 'visible', timeout: 5000 });
    if ((await tab.getAttribute('aria-selected')) === 'true') return;
    await tab.click();
    await this.page.waitForTimeout(400);
  }

  /**
   * Expands the option checkbox list for the active dimension. The list is
   * collapsed behind an "All Cities"/"All States" control; click it if the
   * "Select All" checkbox isn't already showing. Role locators ignore hidden
   * (display:none) elements, so this only ever sees the active tab's list.
   */
  async expandFilterOptions(dimension) {
    const selectAll = this.page.getByRole('checkbox', { name: 'Select All', exact: true }).first();
    if (!(await this.isVisible(selectAll))) {
      const label = dimension === 'City' ? 'All Cities' : 'All States';
      await this.filterPanel().locator(`:text-is("${label}")`).first().click().catch(() => {});
    }
    await selectAll.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    await this.page.waitForTimeout(200);
  }

  /** Opens Filters (if closed), selects the dimension tab and expands its list. */
  async openFilterDimension(dimension) {
    if (!(await this.isVisible(this.filterPanel()))) {
      await this.openFilters();
    }
    await this.selectFilterTab(dimension);
    await this.expandFilterOptions(dimension);
  }

  /** Names of the option checkboxes currently listed (visible; excl "Select All"). */
  async getListedFilterOptions() {
    return await this.filterPanel().evaluate((root) => {
      const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
      return [...root.querySelectorAll('input[type="checkbox"]')]
        .filter((c) => c.offsetParent !== null) // visible only (skips inactive tab's list)
        .map((c) => txt(c.closest('label') || c.parentElement))
        .filter((n) => n && n !== 'Select All');
    });
  }

  /** Opens a dimension and returns all of its option names. */
  async getFilterOptions(dimension) {
    await this.openFilterDimension(dimension);
    return await this.getListedFilterOptions();
  }

  /** Types a term into the active dimension's in-panel search box. */
  async searchFilterOptions(term) {
    const box = this.filterPanel().locator('input[placeholder^="Search"]').first();
    await box.fill(String(term));
    await this.page.waitForTimeout(700);
  }

  async isNoSearchResultsVisible() {
    const el = this.filterPanel()
      .locator(':text-matches("No search results found", "i")')
      .first();
    return await this.isVisible(el);
  }

  /** Ticks one option checkbox (by exact accessible name) in the active list. */
  async checkFilterOption(name) {
    const cb = this.page.getByRole('checkbox', { name, exact: true }).first();
    await cb.waitFor({ state: 'visible', timeout: 6000 });
    if (!(await cb.isChecked().catch(() => false))) {
      await cb.click();
      await this.page.waitForTimeout(200);
    }
  }

  async applyFilters() {
    await this.filterPanel().locator('button:has-text("Apply")').first().click();
    await this.page.waitForTimeout(1500);
  }

  /** Clear → open dimension → tick one value → Apply. */
  async applyFilter(dimension, value) {
    await this.clearAllFilters();
    await this.openFilterDimension(dimension);
    await this.checkFilterOption(value);
    await this.applyFilters();
  }

  /** Clear → tick one City and one State → Apply once (union). */
  async applyCityAndState(city, state) {
    await this.clearAllFilters();
    await this.openFilterDimension('City');
    await this.checkFilterOption(city);
    await this.openFilterDimension('State');
    await this.checkFilterOption(state);
    await this.applyFilters();
  }

  /** Applies a single filter and returns the (filter-aware) total count. */
  async applyFilterAndCount(dimension, value) {
    await this.applyFilter(dimension, value);
    return await this.getTotalCount();
  }

  async applyCityAndStateAndCount(city, state) {
    await this.applyCityAndState(city, state);
    return await this.getTotalCount();
  }

  // ---- Grid readers used by filter assertions ----
  /** {city, state} for every visible data row (City=col4, State=col5). */
  async getVisibleCityStateRows() {
    await this.waitForRows().catch(() => {});
    return await this.rows.evaluateAll((rows) =>
      rows.map((r) => {
        const c = [...r.querySelectorAll('[role="gridcell"]')];
        return {
          city: (c[4] ? c[4].textContent : '').trim(),
          state: (c[5] ? c[5].textContent : '').trim()
        };
      })
    );
  }

  /** Distinct non-empty values present in a dimension's grid column. */
  async getVisibleFilterValues(dimension) {
    const rows = await this.getVisibleCityStateRows();
    const key = dimension === 'City' ? 'city' : 'state';
    return [...new Set(rows.map((r) => r[key]).filter(Boolean))];
  }

  /** {id, name, city, state} for every visible data row — for report attachments. */
  async getVisibleClinics() {
    await this.waitForRows().catch(() => {});
    return await this.rows.evaluateAll((rows) =>
      rows.map((r) => {
        const c = [...r.querySelectorAll('[role="gridcell"]')];
        const cell = (i) => (c[i] ? c[i].textContent : '').trim();
        return {
          id: cell(1),
          name: cell(2),
          street: cell(3),
          city: cell(4),
          state: cell(5),
          zip: cell(6)
        };
      })
    );
  }

  /** A value guaranteed to have clinics on the current tab (read from the grid). */
  async findPopulatedFilterValue(dimension) {
    await this.clearAllFilters();
    const vals = await this.getVisibleFilterValues(dimension);
    return vals[0] || null;
  }

  /**
   * A discriminating City/State pair from the current grid: a City (with its own
   * State) plus a State that DIFFERS from that City's State. Selecting both then
   * has zero overlap, so count(City∪State) == count(City) + count(State).
   */
  async findUnionPair() {
    await this.clearAllFilters();
    const rows = await this.getVisibleCityStateRows();
    const base = rows.find((r) => r.city && r.state);
    if (!base) return null;
    const other = rows.find((r) => r.state && r.state !== base.state);
    if (!other) return null;
    return { city: base.city, cityState: base.state, state: other.state };
  }

  /**
   * A filter value that matches NO clinics on the current tab. Reliable when the
   * tab fits a single page (e.g. Inactive, 7 rows) — the visible grid is then the
   * complete present-set, so any global option not present yields zero rows.
   */
  async findEmptyFilterValue(dimension) {
    const present = new Set(await this.getVisibleFilterValues(dimension));
    const options = await this.getFilterOptions(dimension);
    await this.closePopover();
    return options.find((o) => !present.has(o)) || null;
  }

  async mainContainsText(text) {
    const t = (await this.page.locator('main').innerText().catch(() => '')) || '';
    const safe = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(safe, 'i').test(t);
  }

  async isNothingHereYetVisible() {
    return await this.mainContainsText('Nothing here yet');
  }

  /**
   * Waits for the empty grid state (0 rows + "Nothing here yet."). Needed because
   * two consecutive 0-result searches leave the settle signature unchanged, so
   * the empty-state node can repaint a beat after waitForSearchSettle() returns.
   */
  async waitForEmptyState(timeout = 6000) {
    const ok = async () =>
      (await this.getRowCount()) === 0 && (await this.isNothingHereYetVisible());
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await ok()) return true;
      await this.page.waitForTimeout(300);
    }
    return await ok();
  }

  /** True if a City/State filter is currently applied (the Clear All chip shows). */
  async isFilterApplied() {
    return await this.isVisible(this.page.locator(this.selectors.clearFiltersButton).first());
  }

  async clearAllFilters() {
    const clear = this.page.locator(this.selectors.clearFiltersButton).first();
    if (await this.isVisible(clear)) {
      await clear.click();
      await this.page.waitForTimeout(1000);
    }
  }

  // -------------------------------------------------------------------------
  // Export CSV (client-side; reflects the CURRENT grid state)
  //
  // Behaviour verified live (scripts/probe-clinic-export.js):
  //   - the button builds the CSV IN THE BROWSER (Blob) and downloads a file
  //     with the STATIC name "NXTSTIM.csv" (no date/clinic in the name)
  //   - the CSV header the app CURRENTLY emits is:
  //       ID, Name, Street Address, City, State, Zip Code, Monitoring Metrics,
  //       Contact Info, Current Status
  //     NOTE: "Monitoring Metrics" must NOT be exported (business rule) — it is
  //     always blank and provides no value. The columns-match assertion expects
  //     the grid's columns WITHOUT it, so the suite fails until the app drops it.
  //   - the export always mirrors the CURRENT grid: no search/filter → every
  //     row; a search returning N rows → N data rows; a filter → the filtered
  //     rows only (verified 7→7, search→1, City filter→2)
  //   - three columns do NOT map cleanly to the visible cells and are excluded
  //     from strict value comparison (see EXPORT_MATCH_COLUMNS):
  //       * "Monitoring Metrics" should not be exported at all (see the header
  //         note above); until fixed it is present but always EMPTY (the grid
  //         shows a "View Metrics" button)
  //       * "Contact Info" is a newline-joined "Clinic Name / Email / Phone"
  //         blob whose first line is the CLINIC name, whereas the grid cell
  //         shows the CONTACT person
  //       * "Current Status" is the right-most data column and is horizontally
  //         VIRTUALISED by the MUI DataGrid — in a narrow viewport its cells are
  //         not in the DOM, so it can't be read reliably (the rest of the suite
  //         only ever reads cells 1..6 for the same reason)
  //   - with 0 matching clinics the button stays ENABLED and downloads a
  //     HEADER-ONLY CSV (columns present, no data rows) — no error/toast
  // -------------------------------------------------------------------------

  /** The CSV header columns, in order (matches the grid's data columns). */
  static get EXPORT_COLUMNS() {
    return [
      'ID',
      'Name',
      'Street Address',
      'City',
      'State',
      'Zip Code',
      'Monitoring Metrics',
      'Contact Info',
      'Current Status'
    ];
  }

  /**
   * Columns whose CSV value maps 1:1 to the reliably-rendered grid cell, so they
   * can be asserted equal. Excludes "Monitoring Metrics" (always blank in the
   * CSV), "Contact Info" (restructured blob; first line differs from the grid
   * cell) and "Current Status" (horizontally virtualised — not in the DOM in a
   * narrow viewport). Matches the cell range the rest of the suite trusts (1..6).
   */
  static get EXPORT_MATCH_COLUMNS() {
    return ['ID', 'Name', 'Street Address', 'City', 'State', 'Zip Code'];
  }

  /**
   * Minimal RFC-4180 CSV parser (no dependency): handles comma separators,
   * quoted fields containing commas / CRLF / newlines, and "" escaped quotes.
   * Returns { columns, rows, records } where `rows` are raw data arrays and
   * `records` are objects keyed by the header columns.
   */
  static parseCsv(text) {
    const table = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // swallow — the line break is handled on the following \n
      } else if (ch === '\n') {
        row.push(field);
        table.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      table.push(row);
    }
    const columns = table.shift() || [];
    // Drop any fully-empty trailing line (a trailing CRLF yields none, but guard).
    const rows = table.filter((r) => r.some((c) => c !== ''));
    const records = rows.map((r) => {
      const o = {};
      columns.forEach((c, idx) => {
        o[c] = r[idx] !== undefined ? r[idx] : '';
      });
      return o;
    });
    return { columns, rows, records };
  }

  async isExportEnabled() {
    return await this.exportCsvButton.isEnabled().catch(() => false);
  }

  /**
   * Clicks Export CSV, waits for the download, reads the saved file and parses
   * it. Returns { filename, columns, rows, records, raw }. `records` are objects
   * keyed by the CSV header; `rows` are the raw data-row arrays (for a
   * well-formedness check). The app streams a "NXTSTIM.csv" download.
   */
  async exportCsvAndRead() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 20000 }),
      this.click(this.exportCsvButton)
    ]);
    const filename = download.suggestedFilename();
    const filePath = await download.path();
    const raw = fs.readFileSync(filePath, 'utf8');
    const { columns, rows, records } = ClinicsPage.parseCsv(raw);
    return { filename, filePath, raw, columns, rows, records };
  }

  /** Back-compat: returns just the download's suggested filename. */
  async exportCsv() {
    return (await this.exportCsvAndRead()).filename;
  }

  /**
   * Non-empty grid column-header labels, in left-to-right order. The DataGrid
   * virtualises columns horizontally, so this scrolls the header track fully
   * right (and back) and dedupes by field, harvesting every column regardless of
   * viewport width — otherwise the right-most columns (e.g. Current Status) are
   * missing from the DOM in a narrow viewport.
   */
  async getGridColumnHeaders() {
    return await this.page.evaluate(async () => {
      const seen = new Map();
      const collect = () => {
        document.querySelectorAll('[role="columnheader"]').forEach((h) => {
          const key = h.getAttribute('data-field') || h.getAttribute('aria-colindex') || h.textContent;
          if (!seen.has(key)) seen.set(key, h.textContent.trim());
        });
      };
      const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
      const sc = document.querySelector('.MuiDataGrid-virtualScroller');
      if (!sc) {
        collect();
        return [...seen.values()].filter(Boolean);
      }
      sc.scrollLeft = 0;
      await sleep(100);
      collect();
      for (let x = 0; x <= sc.scrollWidth; x += 300) {
        sc.scrollLeft = x;
        await sleep(60);
        collect();
      }
      sc.scrollLeft = sc.scrollWidth;
      await sleep(100);
      collect();
      sc.scrollLeft = 0; // leave the grid scrolled back to the left
      return [...seen.values()].filter(Boolean);
    });
  }

  /**
   * Harvests EVERY visible grid row as a record keyed to match the CSV's
   * reliably-rendered columns (ID / Name / Street Address / City / State / Zip
   * Code — cells 1..6, the range that is never horizontally virtualised). The
   * grid is virtualised vertically, so it scrolls the virtual scroller and
   * dedupes by ID — mirroring harvestVisibleIds().
   */
  async harvestVisibleRecords() {
    return await this.page.evaluate(async () => {
      const seen = new Map();
      const collect = () => {
        document.querySelectorAll('[role="rowgroup"] [role="row"]').forEach((r) => {
          const c = [...r.querySelectorAll('[role="gridcell"]')];
          const cell = (i) => (c[i] ? c[i].textContent.trim() : '');
          const id = cell(1);
          if (id && !seen.has(id)) {
            seen.set(id, {
              ID: id,
              Name: cell(2),
              'Street Address': cell(3),
              City: cell(4),
              State: cell(5),
              'Zip Code': cell(6)
            });
          }
        });
      };
      const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
      const scroller = document.querySelector('.MuiDataGrid-virtualScroller');
      if (!scroller) {
        collect();
        return [...seen.values()];
      }
      scroller.scrollTop = 0;
      await sleep(120);
      collect();
      for (let y = 0; y <= scroller.scrollHeight; y += 350) {
        scroller.scrollTop = y;
        await sleep(70);
        collect();
      }
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(120);
      collect();
      return [...seen.values()];
    });
  }

  /**
   * Full ordered list of grid records across the whole (possibly paged) list:
   * bumps rows-per-page to its max, harvests the virtualised rows, then walks
   * any remaining pages, deduping by ID. Empty grid → [].
   */
  async getAllGridRecords() {
    if ((await this.getRowCount()) === 0) return [];
    await this.showAllRows();
    await this.waitForRows();
    const all = new Map();
    for (let p = 0; p < 50; p++) {
      const recs = await this.harvestVisibleRecords();
      for (const r of recs) if (!all.has(r.ID)) all.set(r.ID, r);
      const next = this.page.locator('[aria-label="Go to next page"]').first();
      const canNext = await next.isEnabled().catch(() => false);
      if (!canNext) break;
      await next.click();
      await this.waitForGridSettle();
    }
    return [...all.values()];
  }

  async isSortMenuOpen() {
    return await this.isVisible(this.page.locator(this.selectors.popoverOption('ID: Asc')).first());
  }

  async getFirstRowId() {
    await this.waitForRows();
    const first = this.rows.first();
    const cells = first.locator('[role="gridcell"]');
    // gridcell[0] is the row index, [1] is the clinic ID.
    return ((await cells.nth(1).innerText()) || '').trim();
  }

  async closePopover() {
    await this.page.keyboard.press('Escape').catch(() => {});
    // Wait for the panel to actually detach — otherwise a follow-up open sees the
    // closing popover as "still visible" and interacts with a dying DOM node.
    await this.filterPanel().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(200);
  }

  async waitForToast(matcher, timeout = 8000) {
    const re = matcher instanceof RegExp ? matcher : new RegExp(matcher, 'i');
    const toast = this.page.locator(this.selectors.toast).filter({ hasText: re }).first();
    await toast.waitFor({ state: 'visible', timeout });
    return await toast.textContent();
  }
}

module.exports = { ClinicsPage };
