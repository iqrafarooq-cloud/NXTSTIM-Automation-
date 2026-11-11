const fs = require('fs');
const { BasePage } = require('./BasePage');

/**
 * UsersPage — POM for the restructured User Management screen (NXT-1999/2000).
 *
 * Every selector below was captured against the live QA build on 2026-07-25 by
 * driving the app through the Playwright MCP browser. The notable findings that
 * shape this file:
 *
 *   - Navigation is flat: Monitoring / Reports / Invoices / Clinics / Patients /
 *     Users / Roles are all plain `<a href>` sidebar links. There is no
 *     "Accounts" grouping.
 *   - The grid is an MUI DataGrid whose cells carry `data-field`, so rows are
 *     read by field name (id, roles, associatedClinicsDisplay, …) rather than by
 *     brittle column position. Empty state renders "Nothing here yet.".
 *   - The Add-New-User wizard is adaptive: clinic-scoped roles (Nurse, Regular /
 *     Elevated Supervisor) get a 3rd "Permissions" step; every other role is a
 *     2-step flow. The header text "Step N/M" is the authoritative step counter,
 *     and a completed step drops its ordinal digit from the left-hand indicator
 *     (replaced by a check icon) — that is how completion is detected.
 *   - Step 3 is NOT uniform: Nurse exposes a single-select `Clinic*`
 *     autocomplete only, while Supervisor exposes a multi-select `Clinics*`
 *     popover PLUS an `Allow Program Creation*` combobox (options Yes / No).
 *     `selectClinics()` detects which control is mounted.
 *   - The role picker and the Supervisor clinic picker both render into a
 *     `.c-multi-select-dropdown-popover` portal whose invisible backdrop eats
 *     pointer events. It must be dismissed with a REAL key press
 *     (`page.keyboard.press('Escape')`) before touching the dialog again — a
 *     synthetic JS keydown does not close it.
 *
 * Selector strategy follows the repo convention: data-testid first (forward
 * compatible — the app exposes none here yet), then ARIA role, then the MUI
 * structural classes that were verified live.
 */
class UsersPage extends BasePage {
  constructor(page) {
    super(page);

    this.grid = page.locator('.MuiDataGrid-root').first();
    this.rows = page.locator('.MuiDataGrid-row');
    this.overlay = page.locator('.MuiDataGrid-overlay, .MuiDataGrid-overlayWrapper').first();
    // The placeholder tracks the selected "Search By" field ("Search for User
    // ID" → "Search for Email" → …), so match the stable prefix only.
    this.searchBox = page.locator('input[placeholder^="Search for"]').first();
    this.filtersButton = page.getByRole('button', { name: /^Filters$/i }).first();
    this.addNewUserButton = page.getByRole('button', { name: /Add New User/i }).first();
    this.sortByButton = page.getByRole('button', { name: /^Sort By$/i }).first();
    this.exportCsvButton = page.getByRole('button', { name: /^Export CSV$/i }).first();
    this.clearAllButton = page.getByRole('button', { name: /^Clear All$/i }).first();
  }

  // ---- URLs ---------------------------------------------------------------

  origin() {
    const login =
      process.env.BASE_URL ||
      'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login';
    return login.replace(/\/login.*$/i, '');
  }

  urlFor(path) {
    return `${this.origin()}/${String(path).replace(/^\//, '')}`;
  }

  // ---- Sidebar navigation (NXT-1999) --------------------------------------

  /** Every top-level sidebar destination, as { name, href } pairs. */
  async sidebarItems() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')]
        .map((a) => ({ name: a.textContent.trim(), href: a.getAttribute('href') }))
        .filter((x) => x.name)
    );
  }

  sidebarLink(name) {
    return this.page
      .locator(`[data-testid="nav-${String(name).toLowerCase()}"], a[href="/${String(name).toLowerCase()}"]`)
      .first();
  }

  /** True iff `name` is present as an independent top-level sidebar link. */
  async hasTopLevelNavItem(name) {
    const items = await this.sidebarItems();
    return items.some((i) => new RegExp(`^${name}$`, 'i').test(i.name));
  }

  /**
   * True iff any sidebar element behaves like an expandable "Accounts" group.
   * Checks both a nav link and a collapsible/accordion control, so the removal
   * assertion cannot pass merely because the link was turned into a button.
   */
  async hasAccountsGrouping() {
    return await this.page.evaluate(() => {
      const nodes = [...document.querySelectorAll('a, button, [role="button"], .MuiAccordionSummary-root')];
      return nodes.some((n) => /^\s*accounts\s*$/i.test(n.textContent || ''));
    });
  }

  async openSidebarItem(name) {
    await this.sidebarLink(name).click();
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1200);
  }

  async currentPath() {
    return new URL(await this.getCurrentUrl()).pathname;
  }

  // ---- The Users grid -----------------------------------------------------

  async open() {
    await this.navigate(this.urlFor('users'));
    await this.page.waitForLoadState('domcontentloaded');
    await this.tab('Active').waitFor({ state: 'visible', timeout: 20000 });
    await this.page.waitForTimeout(800);
  }

  /** Visible column header captions, in display order. */
  async columnHeaders() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('.MuiDataGrid-columnHeader')]
        .map((h) => h.textContent.trim())
        .filter(Boolean)
    );
  }

  /**
   * Every rendered row as a { field: value } object keyed by the DataGrid's
   * `data-field` (id, username, firstName, lastName, roles, email,
   * phoneNumber, created_at, associatedClinicsDisplay).
   */
  async readRows() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('.MuiDataGrid-row')].map((row) => {
        const out = {};
        row.querySelectorAll('[data-field]').forEach((c) => {
          out[c.getAttribute('data-field')] = c.innerText.trim();
        });
        return out;
      })
    );
  }

  async rowCount() {
    return await this.rows.count();
  }

  /**
   * The grid's no-data overlay text ('' when rows are present).
   *
   * Read by polling textContent rather than waiting on visibility: MUI mounts
   * an `.MuiDataGrid-overlayWrapper` that measures 0×0, so Playwright considers
   * the first matching node hidden even while the caption renders inside it.
   */
  async emptyStateText() {
    if ((await this.rowCount()) > 0) return '';
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const text = await this.page.evaluate(() => {
        const node = [...document.querySelectorAll('.MuiDataGrid-overlay, .MuiDataGrid-overlayWrapper')]
          .map((n) => n.textContent.trim())
          .find(Boolean);
        return node || '';
      });
      if (text) return text;
      await this.page.waitForTimeout(400);
    }
    return '';
  }

  /**
   * Block until the grid has actually resolved — rows mounted, or the no-data
   * overlay rendered. Returns the row count.
   *
   * Needed when arriving on a list screen the suite does not own (Patients is
   * the slow one): the sidebar click resolves long before its first page of
   * records lands, and an assertion fired in that gap sees neither rows nor an
   * empty state.
   */
  async waitForGridContent(timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const count = await this.rowCount().catch(() => 0);
      if (count > 0) return count;
      const empty = await this.page.evaluate(() =>
        [...document.querySelectorAll('.MuiDataGrid-overlay, .MuiDataGrid-overlayWrapper')]
          .map((n) => n.textContent.trim())
          .find(Boolean) || ''
      );
      if (empty) return 0;
      await this.page.waitForTimeout(500);
    }
    return await this.rowCount().catch(() => 0);
  }

  /** First row whose `field` cell matches `value` (substring, case-insensitive). */
  async findRow(field, value) {
    const rows = await this.readRows();
    const needle = String(value).toLowerCase();
    return rows.find((r) => String(r[field] || '').toLowerCase().includes(needle)) || null;
  }

  /** Locator for the grid row carrying the given user id. */
  rowById(userId) {
    return this.page
      .locator(`.MuiDataGrid-row:has([data-field="id"]:text-is("${userId}"))`)
      .first();
  }

  // ---- Status sub-tabs ----------------------------------------------------

  /**
   * The status sub-tabs the live build renders, in display order. "Suspended"
   * was added between Pending and Inactive (verified 2026-07-26) — the tab
   * readers below are all dynamic, this list is for scenarios that need to name
   * a tab that actually holds users. Every one of them does: counted live
   * 2026-07-26 (scripts/probe-users-subtab-export.js) at Active 42,
   * Pending 286, Suspended 8, Inactive 26 — and Export CSV matched the tab's
   * own count on all four.
   */
  static get STATUS_TABS() {
    return ['Active', 'Pending', 'Suspended', 'Inactive'];
  }

  tab(name) {
    return this.page.getByRole('tab', { name: new RegExp(`^${name}$`, 'i') }).first();
  }

  async tabNames() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    );
  }

  async openTab(name) {
    const tab = this.tab(name);
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    const since = this.listMark(); // the tab re-queries the backend
    await tab.click();
    await this.waitForListSettle(12000, since);
  }

  async selectedTab() {
    return await this.page.evaluate(() => {
      const t = [...document.querySelectorAll('[role="tab"]')].find(
        (x) => x.getAttribute('aria-selected') === 'true'
      );
      return t ? t.textContent.trim() : null;
    });
  }

  async isTabVisible(name) {
    return await this.isVisible(this.tab(name));
  }

  // ---- Total count --------------------------------------------------------

  /** The "N Users" counter above the grid (null when not rendered). */
  async getTotalCount() {
    const text = (await this.page.locator('main').innerText()) || '';
    const m = text.match(/(\d+)\s+Users?/i);
    return m ? Number(m[1]) : null;
  }

  // -------------------------------------------------------------------------
  // Search — real-time, SERVER-SIDE, scoped to ONE "Search By" field
  //
  // Behaviour verified live against the QA build (Playwright MCP, 2026-07-25):
  //   - fields: User ID | Username | First Name | Last Name | Email |
  //     Phone Number | Onboarding Date
  //   - the input's PLACEHOLDER tracks the selection ("Search for Email"), and
  //     so does the selector button's own label — which is why the button is
  //     matched by "any field label" rather than a fixed caption
  //   - matching is PARTIAL (substring) and CASE-INSENSITIVE
  //     ("BYTECORP.IO" under Email → 15 of 41 users)
  //   - EMPTY or WHITESPACE-ONLY input clears the filter and lists everyone
  //   - the field + text persist SERVER-SIDE per admin account: a leftover
  //     "99999999" left the grid at "0 Users" on a fresh context, hence
  //     resetListState()
  //   - selecting a field does NOT auto-close the menu; the lingering MUI
  //     backdrop eats the next click, so it is dismissed explicitly
  // -------------------------------------------------------------------------

  /** Search By field labels, in display order. */
  static get SEARCH_FIELDS() {
    return ['User ID', 'Username', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Onboarding Date'];
  }

  /** Maps a Search By label to the DataGrid `data-field` readRows() returns. */
  static get FIELD_KEY() {
    return {
      'User ID': 'id',
      Username: 'username',
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Email: 'email',
      'Phone Number': 'phoneNumber',
      'Onboarding Date': 'created_at'
    };
  }

  searchFieldButton() {
    const labels = UsersPage.SEARCH_FIELDS.map((f) => `main button:text-is("${f}")`).join(', ');
    return this.page.locator(`[data-testid="user-search-field"], ${labels}`).first();
  }

  /**
   * Per-page tally of list responses, attached once and read by
   * waitForListSettle to tell "the grid has answered MY query" apart from "the
   * grid is still showing the previous one".
   *
   * Waiting on a single response is not enough: switching the Search By field
   * and typing a term both refetch, so the first response back can belong to the
   * query that is already obsolete. Counting them — and requiring a quiet period
   * with no further response — is what makes a superseded refetch harmless.
   */
  listWatch() {
    if (!this.page.__listWatch) {
      const w = { count: 0, last: 0 };
      this.page.on('response', (r) => {
        if (/\/users\/list/i.test(r.url())) {
          w.count += 1;
          w.last = Date.now();
        }
      });
      this.page.__listWatch = w;
    }
    return this.page.__listWatch;
  }

  /** The response tally to hand waitForListSettle, read BEFORE the action. */
  listMark() {
    return this.listWatch().count;
  }

  /**
   * Waits for the grid to be showing the CURRENT query's data.
   *
   * With `since` (a listMark() taken before the action) it waits for at least one
   * new list response AND `quiet` ms with no further one, so every refetch the
   * action kicked off — including ones it superseded — has landed. Then the
   * (total | row-count | first-row id) signature must repeat once to prove MUI
   * painted it. Without `since` there is nothing to count against, so the
   * debounce is covered by a sleep and the caller stays slower by design.
   */
  async waitForListSettle(timeout = 12000, since = null) {
    if (since === null) await this.page.waitForTimeout(900);
    else {
      const w = this.listWatch();
      const quiet = 450;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (w.count > since && Date.now() - w.last >= quiet) break;
        await this.page.waitForTimeout(100);
      }
    }
    const sample = async () => {
      const total = await this.getTotalCount().catch(() => null);
      const count = await this.rowCount().catch(() => 0);
      let first = '';
      if (count) {
        first = (
          (await this.rows.first().locator('[data-field="id"]').innerText().catch(() => '')) || ''
        ).trim();
      }
      return `${total}|${count}|${first}`;
    };
    const start = Date.now();
    let prev = await sample();
    while (Date.now() - start < timeout) {
      await this.page.waitForTimeout(300);
      const cur = await sample();
      if (cur === prev && (await this.gridHasPainted())) return;
      prev = cur;
    }
  }

  /**
   * True once the grid is SHOWING something — rows, or the empty-state overlay.
   *
   * A DataGrid with neither is still loading: MUI paints the empty grid before
   * the list response lands and only then mounts the overlay. Verified live
   * 2026-07-26 on the Pending sub-tab (286 users): the settle signature
   * "0|0|" repeated twice while the fetch was still in flight, waitForListSettle
   * called it settled, and the step that followed measured an empty grid on a
   * populated sub-tab — while the export it had just triggered came back with all
   * 286 records. Hence this extra gate on the stability check.
   */
  async gridHasPainted() {
    if ((await this.rowCount().catch(() => 0)) > 0) return true;
    const overlay = await this.page
      .evaluate(
        () =>
          [...document.querySelectorAll('.MuiDataGrid-overlay, .MuiDataGrid-overlayWrapper')]
            .map((n) => n.textContent.trim())
            .find(Boolean) || ''
      )
      .catch(() => '');
    return Boolean(overlay);
  }

  /** Dismisses a lingering MUI menu/popover backdrop (see the search notes). */
  async dismissAnyMenu() {
    const backdrop = this.page.locator('.MuiBackdrop-root').first();
    if (await backdrop.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await backdrop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      await this.page.waitForTimeout(150);
    }
  }

  /** Opens the Search By dropdown and returns its option labels. */
  async searchFieldOptions() {
    await this.dismissAnyMenu();
    await this.searchFieldButton().click();
    await this.page.locator('.MuiPopover-root, .MuiMenu-root').first().waitFor({ state: 'visible', timeout: 8000 });
    const opts = await this.page.evaluate(() => {
      const p = document.querySelector('.MuiPopover-root, .MuiMenu-root');
      return [...p.querySelectorAll('label, li, [role="option"]')]
        .map((o) => o.textContent.trim())
        .filter(Boolean);
    });
    await this.dismissAnyMenu();
    return opts;
  }

  /**
   * Selects a Search By field (keeps whatever text is already typed).
   *
   * `settle: false` skips waiting for the refetch this triggers — used by
   * searchInField(), which is about to overwrite the term anyway, so waiting
   * here would buy a result nobody reads at the cost of a round-trip.
   */
  async selectSearchField(field, { settle = true } = {}) {
    if ((await this.getSelectedSearchField()) === field) return;
    await this.dismissAnyMenu();
    await this.searchFieldButton().click();
    const menus = this.page.locator('.MuiPopover-root, .MuiMenu-root');
    await menus.first().waitFor({ state: 'visible', timeout: 8000 });
    // Match on the option's TEXT, not on `label:text-is(...)`: each option is a
    // <label><input type="radio"><span>Email</span></label>, and :text-is()
    // resolves to the smallest element carrying the text (the span), so the
    // label-scoped form never matches. Exact text keeps "Email" off "Email
    // Address". Scoped to `menus` (all open popovers) so a stale portal left
    // behind by the Add New User wizard cannot shadow the real menu.
    const option = menus.getByText(field, { exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 6000 }).catch(async () => {
      const seen = await this.page.evaluate(() =>
        [...document.querySelectorAll('.MuiPopover-root, .MuiMenu-root')]
          .map((p) => (p.innerText || '').replace(/\s+/g, ' ').trim())
      );
      throw new Error(
        `Search By option "${field}" not found. Open popovers: ${JSON.stringify(seen)}`
      );
    });
    const since = settle ? this.listMark() : null;
    await option.click();
    await this.dismissAnyMenu();
    if (settle) await this.waitForListSettle(12000, since);
  }

  /** The currently selected Search By field label. */
  async getSelectedSearchField() {
    return ((await this.searchFieldButton().innerText().catch(() => '')) || '').trim();
  }

  /** The search input's placeholder, e.g. "Search for Email". */
  async searchPlaceholder() {
    return (await this.searchBox.getAttribute('placeholder')) || '';
  }

  /** Replaces the search text and waits for the grid to settle. */
  async setSearchText(value) {
    await this.searchBox.waitFor({ state: 'visible', timeout: 10000 });
    // Re-typing the identical term fires no request, so there is nothing to arm
    // a response waiter on — settle against the DOM instead of timing out.
    if ((await this.searchBox.inputValue().catch(() => null)) === String(value)) {
      await this.waitForListSettle();
      return;
    }
    const since = this.listMark();
    await this.searchBox.fill(String(value));
    await this.waitForListSettle(12000, since);
  }

  /**
   * Selects a field, then searches under it — ONE awaited round-trip, not two.
   * The field switch refetches under the stale term, but that result is about
   * to be replaced, so only the typed term's response is waited for.
   */
  async searchInField(field, value) {
    await this.selectSearchField(field, { settle: false });
    await this.setSearchText(value);
  }

  /** Back-compat: the rest of the suite searches by id. */
  async searchUserId(id) {
    await this.searchInField('User ID', id);
  }

  async clearSearch() {
    await this.setSearchText('');
  }

  /** Longest whitespace-free token of a value — a distinctive partial term. */
  static searchToken(value) {
    const tokens = String(value == null ? '' : value).split(/\s+/).filter(Boolean);
    return tokens.length ? tokens.sort((a, b) => b.length - a.length)[0] : '';
  }

  /**
   * Clears every list control that PERSISTS server-side for the admin account
   * (search text, the selected Search By FIELD, and applied Role/Clinic
   * filters). Called from the Background so one scenario's search cannot leave
   * the next one staring at "0 Users".
   *
   * Resetting the FIELD is not belt-and-braces: verified live 2026-07-26 that
   * the selection survives a full page load (left on "First Name", navigated
   * away to /monitoring and back — still "First Name"). Without this, every
   * scenario that reads the field or the placeholder would depend on which
   * scenario ran before it.
   */
  async resetListState() {
    await this.dismissAnyMenu();
    if (await this.isVisible(this.clearAllButton)) {
      await this.clearAllButton.click();
      await this.waitForListSettle();
    }
    // Wait for the box to MOUNT before reading it. A fresh login renders the
    // grid before the toolbar, so an unguarded read threw "not mounted", the
    // catch swallowed it, and a term that persists SERVER-SIDE survived the
    // reset — leaving the next scenario's baseline at "0 Users".
    await this.searchBox.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    try {
      if (await this.searchBox.inputValue()) await this.setSearchText('');
    } catch { /* search box never mounted — nothing to clear */ }
    // Text first, field second: flipping the field while a stale term is still
    // in the box costs an extra server round-trip for a result nobody reads.
    await this.selectSearchField(UsersPage.DEFAULT_SEARCH_FIELD).catch(() => {});
    // Sort last. Unlike the Clinics list — where resetListState deliberately
    // leaves the order alone — the Users sort has to be reset here: verified
    // live 2026-07-26 that the selection survives a FULL PAGE LOAD (left on
    // "ID: Asc", navigated away and back — still "ID: Asc"), so without this the
    // scenario that asserts the app default would depend on which scenario ran
    // before it, and every ordering assertion would inherit a stale order.
    await this.resetSort().catch(() => {});
  }

  static get DEFAULT_SEARCH_FIELD() {
    return 'User ID';
  }

  /**
   * Everything an assertion or a report attachment needs about the search that
   * is currently applied, in one round-trip: the selected field, the text in
   * the box, the backend's total, and the rows on the current page.
   *
   * `rows` comes from harvestVisibleRows() (the virtual-scroller walk) rather
   * than readRows(), which only ever sees the ~9 mounted rows and would
   * under-report a full page.
   */
  async searchSnapshot() {
    const field = await this.getSelectedSearchField();
    let term = '';
    try {
      term = await this.searchBox.inputValue();
    } catch { /* not mounted */ }
    const total = await this.getTotalCount().catch(() => null);
    const count = await this.rowCount().catch(() => 0);
    const rows = count ? await this.harvestVisibleRows() : [];
    return {
      field,
      term,
      total,
      rows,
      empty: rows.length === 0,
      emptyState: rows.length === 0 ? await this.emptyStateText() : ''
    };
  }

  // -------------------------------------------------------------------------
  // Onboarding Date — the one searchable field whose displayed value and
  // searchable value can DISAGREE.
  //
  // Verified live 2026-07-26 (Asia/Karachi, UTC+5) against
  // GET /api/users/list?searchAttribute=onboardingDate:
  //
  //   - the control is a plain text input (no date picker) and matching is a
  //     SUBSTRING match on an MM-DD-YYYY rendering, so "2026" returns every
  //     user onboarded that year and "07-2026" matches "04-07-2026"
  //   - the grid renders created_at in the BROWSER'S LOCAL zone while the
  //     search matches the UTC date. User 10910 (created_at
  //     "2026-07-25T23:29:38Z") displays "07-26-2026" but is only found by
  //     "07-25-2026" — searching the date the grid shows returns nothing, and
  //     searching "07-25-2026" returns a row the grid labels "07-26-2026".
  //
  // Both halves of that are DEFECTS and the suite asserts against them: a date
  // search must return the day it was asked for and nothing else. The ±1 day
  // window the steps used to allow (and the parseGridDate/shiftGridDate/
  // gridDateDelta helpers that powered it) is gone — it made the skew look like
  // expected behaviour.
  // -------------------------------------------------------------------------

  async hasClearAll() {
    return await this.isVisible(this.clearAllButton);
  }

  // -------------------------------------------------------------------------
  // Sort By — 4 options, server-side
  //
  // Verified live: the menu holds exactly four radio options; selecting one
  // AUTO-CLOSES the menu (unlike Search By, which leaves a backdrop) and
  // triggers a server-side re-sort. The app default on this account is
  // "Onboarding Date: Newest to Oldest".
  // -------------------------------------------------------------------------

  static get SORT_OPTIONS() {
    return ['ID: Asc', 'ID: Desc', 'Onboarding Date: Oldest to Newest', 'Onboarding Date: Newest to Oldest'];
  }

  static get DEFAULT_SORT() {
    return 'Onboarding Date: Newest to Oldest';
  }

  /**
   * The Sort By menu, scoped to the popover holding RADIO options — the filter
   * panel uses checkboxes and the Search By menu is the only other radio menu,
   * and it is never open at the same time. Without the predicate an unmounting
   * filter popover can shadow this one (see filterPopover()).
   */
  sortMenu() {
    return this.page
      .locator('.MuiPopover-root:has(input[type="radio"]), .MuiMenu-root:has(input[type="radio"])')
      .last();
  }

  async openSortMenu() {
    await this.dismissAnyMenu();
    await this.sortByButton.click();
    await this.sortMenu().waitFor({ state: 'visible', timeout: 8000 });
    await this.page.waitForTimeout(400);
  }

  /**
   * Sort options as [{ label, selected }] while the menu is open. The popover is
   * picked by CONTENT (the last one holding radios) for the same reason
   * sortMenu() is — an unmounting menu would otherwise answer instead.
   */
  async sortOptions() {
    await this.openSortMenu();
    const opts = await this.page.evaluate(() => {
      const p = [...document.querySelectorAll('.MuiPopover-root, .MuiMenu-root')]
        .filter((n) => n.querySelector('input[type="radio"]'))
        .pop();
      if (!p) return [];
      return [...p.querySelectorAll('label')]
        .filter((l) => l.querySelector('input[type="radio"]'))
        .map((l) => ({
          label: l.textContent.trim(),
          selected: l.querySelector('input').checked
        }));
    });
    await this.dismissAnyMenu();
    return opts;
  }

  async getSelectedSort() {
    const opts = await this.sortOptions();
    const hit = opts.find((o) => o.selected);
    return hit ? hit.label : null;
  }

  /**
   * Selects a Sort By option; the menu auto-closes and the list refetches
   * server-side.
   *
   * The option is matched on the menu's TEXT rather than with
   * `label:text-is(...)`: each row is a `<label><input type="radio"><p>ID:
   * Asc</p></label>`, and the exact-text form is brittle against the label's own
   * whitespace — the same reason selectSearchField() documents for the Search By
   * menu. `exact: true` keeps "ID: Asc" off "ID: Asc"-prefixed siblings.
   */
  async sortBy(label) {
    await this.openSortMenu();
    const option = this.sortMenu().getByText(label, { exact: true }).first();
    await option.waitFor({ state: 'visible', timeout: 6000 });
    const since = this.listMark();
    await option.click();
    await this.dismissAnyMenu();
    await this.waitForListSettle(15000, since);
  }

  async resetSort() {
    if ((await this.getSelectedSort()) !== UsersPage.DEFAULT_SORT) {
      await this.sortBy(UsersPage.DEFAULT_SORT);
    }
  }

  // ---- Pagination / full-list harvesting ----------------------------------

  /**
   * Bumps "Rows per page" to its maximum so the list sits on one page.
   *
   * The control is an MUI Autocomplete, i.e. an `<input role="combobox">` whose
   * current page size lives in its VALUE — `textContent` is always '' on an
   * input, so the already-at-max short-circuit has to read inputValue() or it
   * never fires and every caller pays for a needless popover round-trip. The
   * live build offers 10 / 20 / 50 / 100.
   */
  async showAllRows() {
    const combo = this.page.locator('[role="combobox"]').first();
    if (!(await combo.isVisible().catch(() => false))) return;
    const options = ['100', '50', '20'];
    const current = ((await combo.inputValue().catch(() => '')) || '').trim();
    if (options.includes(current)) return;
    await combo.click();
    for (const size of options) {
      const opt = this.page.locator(`li[role="option"]${textIs(size)}`).last();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click();
        await this.waitForListSettle();
        return;
      }
    }
    await this.dismissAnyMenu();
  }

  /**
   * Rewinds the grid to page 1 so a harvest starts at the top of the list.
   *
   * The harvests below walk pagination FORWARD and leave the grid sitting on the
   * last page. On a single-page list that is invisible, which is why it went
   * unnoticed: Active holds 42 users, one page of 100. The Pending sub-tab holds
   * 286 (3 pages), and there the SECOND harvest in a scenario started on page 3
   * and returned only its 86 rows — the export-parity step then reported the CSV
   * and the grid disagreeing when both were in fact complete.
   *
   * Paging is client-side (no new list request), so this settles the same way the
   * forward walk does rather than waiting on a response that never comes.
   */
  async goToFirstPage() {
    const prev = this.page.locator('[aria-label="Go to previous page"]').first();
    for (let i = 0; i < 50; i++) {
      if (!(await prev.isEnabled().catch(() => false))) return;
      await prev.click();
      await this.waitForListSettle();
    }
  }

  /**
   * Every rendered row id IN GRID ORDER. The DataGrid virtualises vertically
   * (~9 of 10 rows mount), so the virtual scroller is walked top-to-bottom and
   * ids are deduped preserving first-seen (visual) order.
   */
  async harvestVisibleIds() {
    return await this.page.evaluate(async () => {
      const seen = new Set();
      const collect = () =>
        document.querySelectorAll('.MuiDataGrid-row [data-field="id"]').forEach((c) => {
          const id = c.textContent.trim();
          if (id) seen.add(id);
        });
      const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
      const sc = document.querySelector('.MuiDataGrid-virtualScroller');
      if (!sc) { collect(); return [...seen]; }
      sc.scrollTop = 0;
      await sleep(120);
      collect();
      for (let y = 0; y <= sc.scrollHeight; y += 300) {
        sc.scrollTop = y;
        await sleep(70);
        collect();
      }
      sc.scrollTop = sc.scrollHeight;
      await sleep(120);
      collect();
      sc.scrollTop = 0;
      return [...seen];
    });
  }

  /**
   * Full ordered id list across every page of the current (sorted) list.
   *
   * The emptiness check goes through waitForGridContent(), not a bare
   * rowCount(): a sort/filter/tab change refetches server-side, and a rowCount()
   * sampled in that gap is legitimately 0 — which used to make this return []
   * for a list that was merely still loading. waitForGridContent() waits for
   * either rows or the no-data overlay, so [] now means "really empty".
   */
  async collectSortedIds() {
    if ((await this.waitForGridContent()) === 0) return [];
    await this.showAllRows();
    await this.goToFirstPage();
    const all = [];
    for (let p = 0; p < 50; p++) {
      all.push(...(await this.harvestVisibleIds()));
      const next = this.page.locator('[aria-label="Go to next page"]').first();
      if (!(await next.isEnabled().catch(() => false))) break;
      await next.click();
      await this.waitForListSettle();
    }
    return [...new Set(all)];
  }

  /**
   * Every row record on the CURRENT page, in grid order. Same virtual-scroller
   * walk as harvestVisibleIds() — readRows() on its own only ever sees the ~9
   * mounted rows, which silently under-reports a page holding more than that.
   */
  async harvestVisibleRows() {
    return await this.page.evaluate(async () => {
      const byId = new Map();
      const collect = () =>
        document.querySelectorAll('.MuiDataGrid-row').forEach((row) => {
          const out = {};
          row.querySelectorAll('[data-field]').forEach((c) => {
            out[c.getAttribute('data-field')] = c.innerText.trim();
          });
          if (out.id && !byId.has(out.id)) byId.set(out.id, out);
        });
      const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
      const sc = document.querySelector('.MuiDataGrid-virtualScroller');
      if (!sc) { collect(); return [...byId.values()]; }
      sc.scrollTop = 0;
      await sleep(120);
      collect();
      for (let y = 0; y <= sc.scrollHeight; y += 300) {
        sc.scrollTop = y;
        await sleep(70);
        collect();
      }
      sc.scrollTop = sc.scrollHeight;
      await sleep(120);
      collect();
      sc.scrollTop = 0;
      return [...byId.values()];
    });
  }

  /**
   * collectAllRows() for callers that MUST have rows — the filter-value
   * discovery below, which cannot tell "this sub-tab is empty" from "the fetch
   * has not landed yet" and used to fail with a bare null on the slow one.
   *
   * An empty harvest is only accepted once the no-data overlay is actually up;
   * otherwise the list is still in flight, so it settles and harvests again.
   */
  async collectAllRowsSettled(attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      const rows = await this.collectAllRows();
      if (rows.length) return rows;
      if (await this.emptyStateText()) return rows; // genuinely empty, not loading
      await this.waitForListSettle();
    }
    return [];
  }

  /** Every row on every page, as readRows() records (see collectSortedIds). */
  async collectAllRows() {
    if ((await this.waitForGridContent(30000)) === 0) return [];
    await this.showAllRows();
    await this.goToFirstPage();
    const all = [];
    const seen = new Set();
    for (let p = 0; p < 50; p++) {
      for (const r of await this.harvestVisibleRows()) {
        if (r.id && !seen.has(r.id)) { seen.add(r.id); all.push(r); }
      }
      const next = this.page.locator('[aria-label="Go to next page"]').first();
      if (!(await next.isEnabled().catch(() => false))) break;
      await next.click();
      await this.waitForListSettle();
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Export CSV
  //
  // Verified live: the button builds the CSV in the BROWSER (Blob) and streams
  // a download whose name is the static "NXTSTIM.csv". The header is exactly
  // the grid's nine data columns, and the export MIRRORS the current
  // search/filter state while covering the WHOLE list (41 rows exported while
  // only 10 were on screen). Phone Number and Associated Clinics values carry a
  // leading apostrophe (an Excel text-guard) — normalised before comparison.
  // -------------------------------------------------------------------------

  static get EXPORT_COLUMNS() {
    return [
      'User ID', 'Username', 'First Name', 'Last Name', 'Roles',
      'Email Address', 'Phone Number', 'Onboarding Date', 'Associated Clinics'
    ];
  }

  /** Maps a CSV column to the DataGrid `data-field` holding the same value. */
  static get EXPORT_FIELD_KEY() {
    return {
      'User ID': 'id',
      Username: 'username',
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Roles: 'roles',
      'Email Address': 'email',
      'Phone Number': 'phoneNumber',
      'Onboarding Date': 'created_at',
      'Associated Clinics': 'associatedClinicsDisplay'
    };
  }

  /** Strips the export's leading Excel text-guard apostrophe. */
  static unguard(value) {
    return String(value == null ? '' : value).replace(/^'/, '').trim();
  }

  /** Minimal RFC-4180 parser: quoted fields, embedded commas/CRLF, "" escapes. */
  static parseCsv(text) {
    const table = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r') { /* handled on the following \n */ }
      else if (ch === '\n') { row.push(field); table.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field.length || row.length) { row.push(field); table.push(row); }
    const columns = (table.shift() || []).map((c) => c.trim());
    const rows = table.filter((r) => r.some((c) => c !== ''));
    const records = rows.map((r) => {
      const o = {};
      columns.forEach((c, i) => { o[c] = r[i] !== undefined ? UsersPage.unguard(r[i]) : ''; });
      return o;
    });
    return { columns, rows, records };
  }

  async isExportEnabled() {
    return await this.exportCsvButton.isEnabled().catch(() => false);
  }

  /**
   * The grid's own DATA column captions, in left-to-right order — the blank
   * `srNo` (row number) and `action` (kebab) headers dropped. Verified live to
   * be exactly the nine columns the CSV emits, which is what lets the export
   * assert "the same columns as the grid" instead of a hardcoded list.
   *
   * Read from `data-field` rather than by scrolling the header track: unlike the
   * Clinics DataGrid this one mounts every header regardless of viewport width.
   */
  async dataColumnHeaders() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('.MuiDataGrid-columnHeader')]
        .filter((h) => !['srNo', 'action'].includes(h.getAttribute('data-field')))
        .map((h) => h.textContent.trim())
        .filter(Boolean)
    );
  }

  /** True when the whole list toolbar (search + the three controls) is on screen. */
  async areToolbarControlsVisible() {
    return (
      (await this.isVisible(this.searchBox)) &&
      (await this.isVisible(this.searchFieldButton())) &&
      (await this.isVisible(this.filtersButton)) &&
      (await this.isVisible(this.sortByButton)) &&
      (await this.isVisible(this.exportCsvButton))
    );
  }

  /** Clicks Export CSV, reads the download and parses it. */
  async exportCsvAndRead() {
    await this.dismissAnyMenu();
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 25000 }),
      this.exportCsvButton.click()
    ]);
    const filename = download.suggestedFilename();
    const filePath = await download.path();
    const raw = fs.readFileSync(filePath, 'utf8');
    return { filename, filePath, raw, ...UsersPage.parseCsv(raw) };
  }

  // ---- User details page (/users/details/:id) ------------------------------

  async detailsUserId() {
    const m = (await this.getCurrentUrl()).match(/\/users\/details\/(\d+)/i);
    return m ? m[1] : null;
  }

  async isUserDetailsPage(userId) {
    const id = await this.detailsUserId();
    if (!id) return false;
    return userId ? String(userId) === id : true;
  }

  async detailsTabNames() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    );
  }

  async detailsText() {
    return ((await this.page.locator('main').innerText()) || '').trim();
  }

  async openDetailsTab(name) {
    await this.page.getByRole('tab', { name: new RegExp(`^${name}$`, 'i') }).first().click();
    await this.page.waitForTimeout(1500);
  }

  async backToUsersList() {
    await this.page.locator('main').getByText(/^Users$/).first().click();
    await this.tab('Active').waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(600);
  }

  // ---- Create A Role drawer (from the Add-User role picker) ----------------
  //
  // Verified live: Role Name* ("Add role name"), Describe The Role*
  // ("Describe the Role"), a "Make clinic assignment part of this role"
  // checkbox, then 13 permission groups each with a "Grant all permissions"
  // toggle, and Cancel / Create Role in the footer.

  static get PERMISSION_GROUPS() {
    return [
      'Admin Management', 'Supervisor Management', 'Support Staff Management',
      'Nurse Management', 'Clinic Management', 'Patient Management', 'Reports',
      'Special Notes', 'Billing', 'Multi Factor Authentication',
      'User Management', 'Role Management', 'Full Access'
    ];
  }

  drawerField(placeholder) {
    return this.createRoleDrawer().locator(`input[placeholder="${placeholder}"]`).first();
  }

  createRoleSubmit() {
    return this.createRoleDrawer().getByRole('button', { name: /^Create Role$/i }).first();
  }

  createRoleCancel() {
    return this.createRoleDrawer().getByRole('button', { name: /^Cancel$/i }).first();
  }

  async createRoleDrawerText() {
    return ((await this.createRoleDrawer().innerText()) || '').trim();
  }

  async createRolePermissionGroups() {
    const text = await this.createRoleDrawerText();
    return UsersPage.PERMISSION_GROUPS.filter((g) => text.includes(g));
  }

  async isCreateRoleSubmitEnabled() {
    return await this.createRoleSubmit().isEnabled().catch(() => false);
  }

  async fillNewRole({ name, description, clinicAssignment } = {}) {
    if (name !== undefined) await this.drawerField('Add role name').fill(name);
    if (description !== undefined) await this.drawerField('Describe the Role').fill(description);
    if (clinicAssignment) {
      await this.createRoleDrawer()
        .locator('label')
        .filter({ hasText: /Make clinic assignment part of this role/i })
        .first()
        .locator('input[type="checkbox"]')
        .click({ force: true });
    }
    await this.page.waitForTimeout(400);
  }

  /** Ticks a permission group's "Grant all permissions" toggle. */
  async grantAllPermissions(group) {
    const row = this.createRoleDrawer()
      .locator('div')
      .filter({ hasText: new RegExp(`^${escapeRe(group)}`) })
      .first();
    const toggle = row
      .locator('label')
      .filter({ hasText: /Grant all permissions/i })
      .first()
      .locator('input[type="checkbox"]');
    await toggle.waitFor({ state: 'attached', timeout: 8000 });
    await toggle.click({ force: true });
    await this.page.waitForTimeout(400);
  }

  async submitNewRole() {
    await this.createRoleSubmit().click();
    await this.page.waitForTimeout(3000);
  }

  async cancelNewRole() {
    await this.createRoleCancel().click();
    await this.page.waitForTimeout(1200);
  }

  /** Whole drawer flow: fill, grant one group, submit; returns the toast text. */
  async createRole({ name, description, clinicAssignment, permissionGroup } = {}) {
    await this.clickCreateNewRole();
    await this.createRoleDrawer().waitFor({ state: 'visible', timeout: 12000 });
    await this.fillNewRole({ name, description, clinicAssignment });
    if (permissionGroup) await this.grantAllPermissions(permissionGroup);
    await this.submitNewRole();
    return await this.captureToast();
  }

  // -------------------------------------------------------------------------
  // Filters — Roles + Associated Clinic (data-driven; no hardcoded values)
  //
  // Panel shape, verified live against the QA build (Playwright MCP, 2026-07-26):
  //   - one MUI menu popover holding two horizontal tabs, "Roles" (selected by
  //     default) and "Associated Clinic"
  //   - each tab renders an "All Roles" / "All Clinics" caption, an in-panel
  //     search box ("Search Roles" / "Search Clinics"), a "Select All" checkbox
  //     and the option list, plus a shared "Apply" button
  //   - switching tab UNMOUNTS the other tab's option list (unlike the Clinics
  //     panel, which keeps both in the DOM behind display:none), so the visible
  //     checkboxes are always the active dimension's
  //   - the in-panel search is PARTIAL and CASE-INSENSITIVE ("lake" → Lakeside /
  //     Lakeshore); an unmatched term shows "No search results found" while the
  //     "Select All" row stays put
  //
  // Combining, verified live — and DIFFERENT from the Clinics screen, where
  // City + State is a union:
  //   - WITHIN one dimension the values OR together: Roles = Nurse (5) +
  //     Support Staff (3) → 8 users
  //   - ACROSS the two dimensions they AND together: Roles = Elevated
  //     Supervisor (8) ∩ Clinic = Android (3) → 3 users, and Support Staff ∩
  //     Android → 0 users ("Nothing here yet.")
  //   - the clinic match is STRICT: a user whose Associated Clinics cell reads
  //     "All Clinics" is NOT returned by a named-clinic filter (QAClinic → 4
  //     rows, all of which name QAClinic)
  //   - applying a clinic filter also NARROWS the Associated Clinics cell to
  //     the matched clinic(s) only (a user tied to "app clinic, Android,
  //     aghakhanclinic" renders as just "Android" under an Android filter)
  //
  // Option lists are GLOBAL — identical on every status sub-tab — so a value can
  // exist as an option and still match zero rows on the current tab, which is
  // what findEmptyFilterValue() exploits. A search term and an applied filter
  // BOTH narrow the same grid (AND), and the applied filters persist SERVER-SIDE
  // per admin account, hence resetListState().
  // -------------------------------------------------------------------------

  /** Filter tab captions, in display order. */
  static get FILTER_TABS() {
    return ['Roles', 'Associated Clinic'];
  }

  /** Maps a filter tab to the DataGrid `data-field` holding the same value. */
  static get FILTER_FIELD_KEY() {
    return { Roles: 'roles', 'Associated Clinic': 'associatedClinicsDisplay' };
  }

  /**
   * The filter panel, scoped to the popover paper that actually holds the
   * Roles / Associated Clinic TABS.
   *
   * The tab predicate is load-bearing, not defensive. Sort By and Search By
   * render into `.MuiPopover-paper.MuiMenu-paper` too, so a bare
   * `.first()` could resolve to one of those — including one still unmounting
   * behind its Grow transition, whose children are display:none. That is exactly
   * how "open the Roles filter" intermittently came back with ZERO options: it
   * had read the dying Sort By paper. `.last()` then prefers the most recently
   * mounted panel over a leftover. Same reasoning ClinicsPage.filterPanel()
   * documents for the Clinics screen.
   */
  filterPopover() {
    return this.page.locator('.MuiPopover-paper.MuiMenu-paper:has([role="tab"])').last();
  }

  async openFilters() {
    if (await this.isVisible(this.filterPopover())) return;
    await this.dismissAnyMenu();
    await this.filtersButton.click();
    await this.filterPopover().waitFor({ state: 'visible', timeout: 8000 });
    await this.page.waitForTimeout(300);
  }

  /** Tab captions the open panel offers. */
  async filterTabNames() {
    await this.openFilters();
    return await this.filterPopover().evaluate((p) =>
      [...p.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    );
  }

  /**
   * Switch the filter popover between its "Roles" and "Associated Clinic" tabs.
   * Skips the click when the tab is already selected — Roles is selected on
   * open, and re-clicking a freshly mounted tab can catch it mid-transition.
   */
  async openFilterTab(name) {
    await this.openFilters();
    const tab = this.filterPopover().getByRole('tab', { name: new RegExp(name, 'i') }).first();
    await tab.waitFor({ state: 'visible', timeout: 6000 });
    if ((await tab.getAttribute('aria-selected')) !== 'true') {
      await tab.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Option names currently LISTED for the active dimension (visible checkboxes,
   * "Select All" excluded). Visibility filtering matters after an in-panel
   * search: the non-matching labels are dropped from the DOM, but the Select All
   * row survives and would otherwise read as an option.
   */
  async listedFilterOptions() {
    return await this.filterPopover().evaluate((p) =>
      [...p.querySelectorAll('input[type="checkbox"]')]
        .filter((c) => c.offsetParent !== null)
        .map((c) => ((c.closest('label') || c.parentElement).textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && !/^select all$/i.test(t))
    );
  }

  /** Opens a dimension and returns every option it offers. */
  async filterOptions(tabName) {
    await this.openFilterTab(tabName);
    return await this.listedFilterOptions();
  }

  /** Types a term into the active dimension's in-panel search box. */
  async searchFilterOptions(term) {
    const box = this.filterPopover().locator('input[placeholder^="Search"]').first();
    await box.waitFor({ state: 'visible', timeout: 6000 });
    await box.fill(String(term));
    await this.page.waitForTimeout(700);
  }

  async isNoSearchResultsVisible() {
    return await this.isVisible(
      this.filterPopover().locator(':text-matches("No search results found", "i")').first()
    );
  }

  /**
   * Tick one option by its EXACT label. The index is resolved in the page and
   * clicked by position rather than matched with a Playwright text locator: the
   * clinic list holds case-variant duplicates ("QAClinic" and "QAclinic") and
   * Playwright's `hasText` regex form is case-insensitive, so a name-based
   * locator can tick the wrong box. No-op when the box is already ticked.
   */
  async checkFilterOption(name) {
    const boxes = this.filterPopover().locator('input[type="checkbox"]:visible');
    const index = await this.filterPopover().evaluate(
      (p, wanted) =>
        [...p.querySelectorAll('input[type="checkbox"]')]
          .filter((c) => c.offsetParent !== null)
          .map((c) => ((c.closest('label') || c.parentElement).textContent || '').replace(/\s+/g, ' ').trim())
          .indexOf(wanted),
      name
    );
    if (index < 0) {
      throw new Error(
        `filter option "${name}" is not listed — the panel offers: ${(await this.listedFilterOptions()).join(' | ')}`
      );
    }
    const box = boxes.nth(index);
    if (!(await box.isChecked().catch(() => false))) {
      await box.click({ force: true });
      await this.page.waitForTimeout(250);
    }
  }

  /** Option names currently ticked under the active dimension. */
  async selectedFilterValues() {
    return await this.filterPopover().evaluate((p) =>
      [...p.querySelectorAll('input[type="checkbox"]')]
        .filter((c) => c.offsetParent !== null && c.checked)
        .map((c) => ((c.closest('label') || c.parentElement).textContent || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && !/^select all$/i.test(t))
    );
  }

  /** Clicks Apply and waits for the refetched grid to settle. */
  async submitFilters() {
    const since = this.listMark();
    await this.filterPopover().getByRole('button', { name: /^Apply$/i }).click();
    await this.filterPopover().waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
    await this.waitForListSettle(15000, since);
  }

  /**
   * Tick the named options under a filter tab and hit Apply. Additive — it does
   * NOT clear what is already applied, which is what makes it double as the
   * "untick to clear" path (clearFilter) the live build has no dedicated control
   * for. Use applyFilterValues() when the scenario needs a known baseline.
   */
  async applyFilter(tabName, values) {
    await this.openFilterTab(tabName);
    for (const value of [].concat(values)) {
      await this.searchFilterOptions(value).catch(() => {});
      await this.checkFilterOption(value);
    }
    await this.submitFilters();
  }

  /**
   * Clear everything, then tick values across BOTH dimensions and Apply ONCE —
   * the only way to exercise the cross-dimension AND, since a second Apply from
   * a re-opened panel would just add to the first selection.
   *
   * `selection` is { Roles: [...], 'Associated Clinic': [...] }; omitted or
   * empty dimensions are skipped.
   */
  async applyFilterValues(selection) {
    await this.clearAllFilters();
    await this.openFilters();
    for (const tab of UsersPage.FILTER_TABS) {
      const values = [].concat(selection[tab] || []).filter(Boolean);
      if (!values.length) continue;
      await this.openFilterTab(tab);
      for (const value of values) {
        await this.searchFilterOptions(value).catch(() => {});
        await this.checkFilterOption(value);
      }
    }
    await this.submitFilters();
  }

  /** Applies a selection and returns the resulting (filter-aware) total. */
  async applyFilterValuesAndCount(selection) {
    await this.applyFilterValues(selection);
    return await this.getTotalCount();
  }

  /**
   * Untick previously-applied options and re-Apply. The live build has no
   * "Clear Filters"/"Reset" control inside the panel — deselecting is the only
   * per-value reset path (the toolbar's "Clear All" drops them all at once).
   */
  async clearFilter(tabName, values) {
    await this.openFilterTab(tabName);
    for (const value of [].concat(values)) {
      await this.searchFilterOptions(value).catch(() => {});
      const boxes = this.filterPopover().locator('input[type="checkbox"]:visible');
      const index = await this.filterPopover().evaluate(
        (p, wanted) =>
          [...p.querySelectorAll('input[type="checkbox"]')]
            .filter((c) => c.offsetParent !== null)
            .map((c) => ((c.closest('label') || c.parentElement).textContent || '').replace(/\s+/g, ' ').trim())
            .indexOf(wanted),
        value
      );
      if (index >= 0) {
        const box = boxes.nth(index);
        if (await box.isChecked().catch(() => false)) {
          await box.click({ force: true });
          await this.page.waitForTimeout(250);
        }
      }
    }
    await this.submitFilters();
  }

  async closeFilters() {
    if (await this.isVisible(this.filterPopover())) {
      await this.page.keyboard.press('Escape');
      await this.filterPopover().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      await this.page.waitForTimeout(200);
    }
  }

  /**
   * The badge the toolbar renders next to "Filters" once values are applied —
   * the NUMBER OF SELECTED VALUES across both dimensions (2 for one role plus
   * one clinic). null when no filter is applied and the badge is absent.
   */
  async appliedFilterBadge() {
    return await this.page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Filters'
      );
      if (!button) return null;
      // The badge sits alongside the button, not inside it.
      const scope = button.parentElement || button;
      const m = (scope.innerText || '').match(/Filters\s*\n?\s*(\d+)/);
      return m ? Number(m[1]) : null;
    });
  }

  /** Drops every applied filter via the toolbar's "Clear All" (a no-op if absent). */
  async clearAllFilters() {
    await this.closeFilters();
    if (!(await this.isVisible(this.clearAllButton))) return false;
    const since = this.listMark();
    await this.clearAllButton.click();
    await this.waitForListSettle(15000, since);
    return true;
  }

  // ---- Data-driven filter-value discovery ---------------------------------

  /**
   * Distinct values a dimension actually holds across the WHOLE current list.
   *
   * Both cells are comma-joined lists ("Elevated Supervisor" can be one of
   * several roles; "app clinic, Android, aghakhanclinic" one of several
   * clinics), so they are split into tokens. The "-" placeholder and the
   * catch-all "All Clinics" pseudo-value are dropped: neither is a filterable
   * option, and a named-clinic filter deliberately excludes All Clinics rows.
   */
  async gridFilterValues(dimension) {
    const key = UsersPage.FILTER_FIELD_KEY[dimension];
    const rows = await this.collectAllRowsSettled();
    const values = [];
    for (const row of rows) {
      String(row[key] || '')
        .split(/\s*,\s*|\n/)
        .map((v) => v.trim())
        .filter((v) => v && v !== '-' && !/^all clinics$/i.test(v))
        .forEach((v) => {
          if (!values.includes(v)) values.push(v);
        });
    }
    return values;
  }

  /** Ids of the rows whose `dimension` cell names `value` (exact token match). */
  static rowsHolding(rows, dimension, value) {
    const key = UsersPage.FILTER_FIELD_KEY[dimension];
    return rows.filter((r) =>
      String(r[key] || '')
        .split(/\s*,\s*|\n/)
        .map((v) => v.trim())
        .includes(value)
    );
  }

  /**
   * A value that is BOTH offered as an option and present in the current tab's
   * grid, so filtering on it is guaranteed to return rows. Returns
   * { value, expectedIds } — the ids the filter must come back with.
   */
  async findPopulatedFilterValue(dimension) {
    await this.clearAllFilters();
    const rows = await this.collectAllRowsSettled();
    if (!rows.length) {
      // Named explicitly: a bare null here reads as "no such value exists" when
      // the real cause is an empty sub-tab or list state that survived the reset.
      throw new Error(
        `cannot pick a ${dimension} value — the "${await this.selectedTab()}" sub-tab lists no users ` +
          `(total counter: ${await this.getTotalCount()}, empty state: "${await this.emptyStateText()}")`
      );
    }
    const options = new Set(await this.filterOptions(dimension));
    await this.closeFilters();
    for (const value of await this.gridFilterValues(dimension)) {
      if (!options.has(value)) continue; // e.g. a clinic renamed since the option list loaded
      const holders = UsersPage.rowsHolding(rows, dimension, value);
      if (holders.length) return { value, expectedIds: holders.map((r) => r.id) };
    }
    return null;
  }

  /**
   * Two values of the SAME dimension that no single user holds together, so the
   * OR they combine into has zero overlap and
   * count(A ∪ B) === count(A) + count(B) exactly.
   */
  async findDisjointFilterPair(dimension) {
    await this.clearAllFilters();
    const rows = await this.collectAllRowsSettled();
    const values = (await this.gridFilterValues(dimension)).filter((v) =>
      UsersPage.rowsHolding(rows, dimension, v).length
    );
    const options = new Set(await this.filterOptions(dimension));
    await this.closeFilters();
    const usable = values.filter((v) => options.has(v));
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const a = UsersPage.rowsHolding(rows, dimension, usable[i]).map((r) => r.id);
        const b = UsersPage.rowsHolding(rows, dimension, usable[j]).map((r) => r.id);
        if (!a.some((id) => b.includes(id))) {
          return { first: usable[i], second: usable[j], firstIds: a, secondIds: b };
        }
      }
    }
    return null;
  }

  /**
   * A Role + Associated Clinic pair that at least one user on the current tab
   * holds BOTH of — the input to the cross-dimension AND check. Returns the two
   * values, the ids each matches on its own, and the ids they share.
   */
  async findIntersectingRoleAndClinic() {
    await this.clearAllFilters();
    const rows = await this.collectAllRowsSettled();
    const roleOptions = new Set(await this.filterOptions('Roles'));
    const clinicOptions = new Set(await this.filterOptions('Associated Clinic'));
    await this.closeFilters();
    for (const clinic of await this.gridFilterValues('Associated Clinic')) {
      if (!clinicOptions.has(clinic)) continue;
      const clinicRows = UsersPage.rowsHolding(rows, 'Associated Clinic', clinic);
      for (const row of clinicRows) {
        for (const role of String(row.roles || '').split(/\s*,\s*|\n/).map((r) => r.trim())) {
          if (!role || !roleOptions.has(role)) continue;
          const roleRows = UsersPage.rowsHolding(rows, 'Roles', role);
          const shared = clinicRows.filter((r) => roleRows.includes(r)).map((r) => r.id);
          if (shared.length) {
            return {
              role,
              clinic,
              roleIds: roleRows.map((r) => r.id),
              clinicIds: clinicRows.map((r) => r.id),
              sharedIds: shared
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * A globally-offered option that matches NO user on the current sub-tab.
   * Sound because the option lists are the same on every tab while the rows are
   * not — so a tab whose whole list has been harvested cannot hide a match.
   */
  async findEmptyFilterValue(dimension) {
    await this.clearAllFilters();
    const present = new Set(await this.gridFilterValues(dimension));
    const options = await this.filterOptions(dimension);
    await this.closeFilters();
    return options.find((o) => !present.has(o)) || null;
  }

  // ---- Add New User wizard (NXT-2000) -------------------------------------

  dialog() {
    return this.page.getByRole('dialog').first();
  }

  /**
   * Open the Add New User wizard from wherever the previous block left the app.
   *
   * Self-healing on purpose. A merged scenario re-enters this helper while the
   * wizard — or one of its portal popovers — is STILL open, and the page-level
   * "Add New User" button then sits behind the dialog backdrop, so a plain
   * click would simply time out. Any leftover portal is dismissed and any open
   * dialog closed before the button is touched.
   */
  async openAddUser() {
    await this.closeAnyPopover();
    if (await this.isDialogOpen()) {
      await this.closeDialog().catch(async () => {
        await this.page.keyboard.press('Escape');
        await this.dialog().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      });
    }
    await this.dismissAnyMenu();
    await this.addNewUserButton.click();
    await this.dialog().waitFor({ state: 'visible', timeout: 10000 });
    // Step 1 has painted once its role field is on screen — no blanket sleep.
    await this.dialog()
      .getByText(/Select A Role/i)
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => this.page.waitForTimeout(800));
  }

  /**
   * Close the role/clinic multi-select portal IF one is mounted.
   *
   * Unlike dismissPopover() this checks first: a stray Escape with no popover
   * open is delivered to the wizard instead and closes the whole thing.
   */
  async closeAnyPopover() {
    const popover = this.rolePopover();
    if (!(await popover.isVisible().catch(() => false))) return;
    await this.page.keyboard.press('Escape');
    await popover.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }

  async isDialogOpen() {
    return await this.isVisible(this.dialog());
  }

  /**
   * The wizard's state read straight off the DOM, for use while something else
   * is layered on top of it.
   *
   * Needed because MUI marks background content `aria-hidden` whenever a modal
   * opens over it — the "Create A Role" drawer and the role popover portal both
   * do this. An aria-hidden element is not in the accessibility tree, so
   * `getByRole('dialog')` stops matching the wizard and isDialogOpen() /
   * dialogText() / stepCounter() report it as gone (or hang for their full
   * timeout) even though it is still mounted and painted underneath.
   *
   * Returns { mounted, painted, obscured, counter: {current,total}|null, steps }.
   */
  async wizardSnapshot() {
    return await this.page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], .MuiDialog-paper');
      if (!d) return { mounted: false, painted: false, obscured: false, counter: null, steps: [] };
      const rect = d.getBoundingClientRect();
      const text = d.innerText || '';
      const m = text.match(/Step\s+(\d+)\s*\/\s*(\d+)/i);
      return {
        mounted: true,
        painted: rect.width > 0 && rect.height > 0,
        // true while a drawer/popover portal is layered over the wizard
        obscured: !!d.closest('[aria-hidden="true"]'),
        counter: m ? { current: Number(m[1]), total: Number(m[2]) } : null,
        steps: ['Role Selection', 'Basic Details', 'Permissions'].filter((n) => text.includes(n))
      };
    });
  }

  async closeDialog() {
    await this.dialog().locator('.close-btn').first().click();
    await this.dialog().waitFor({ state: 'hidden', timeout: 10000 });
  }

  async dialogText() {
    return ((await this.dialog().innerText()) || '').trim();
  }

  /** The wizard header's authoritative counter, e.g. { current: 2, total: 3 }. */
  async stepCounter() {
    const m = (await this.dialogText()).match(/Step\s+(\d+)\s*\/\s*(\d+)/i);
    return m ? { current: Number(m[1]), total: Number(m[2]) } : null;
  }

  /**
   * Left-hand step indicator as [{ name, index, completed }]. A step that has
   * been completed no longer renders its ordinal digit (the app swaps it for a
   * green check icon), which is what `completed` keys off.
   */
  async stepStates() {
    return await this.page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return [];
      const text = dialog.innerText;
      const names = ['Role Selection', 'Basic Details', 'Permissions'];
      return names
        .filter((n) => text.includes(n))
        .map((n, i) => ({
          name: n,
          index: i + 1,
          // "<digit>\n<Step Name>" only survives while the step is pending/current.
          completed: !new RegExp(`(^|\\n)\\s*\\d+\\s*\\n\\s*${n}`).test(text)
        }));
    });
  }

  async indicatorStepNames() {
    return (await this.stepStates()).map((s) => s.name);
  }

  /**
   * Per-step VISUAL state of the left-hand indicator, for the NXT-2000 rule
   * "completed = check/green, current = highlighted, upcoming = greyed out".
   *
   * Returns [{ name, index, completed, current, upcoming, color, opacity,
   * fontWeight, hasIcon }]. `completed`/`current` come from the authoritative
   * sources (missing ordinal digit + the "Step N/M" header); the style fields
   * let a scenario assert that current and upcoming are actually rendered
   * differently without hard-coding this build's exact palette.
   */
  async stepVisualStates() {
    const counter = await this.stepCounter();
    const states = await this.stepStates();
    const styles = await this.page.evaluate((names) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return {};
      const out = {};
      for (const name of names) {
        // Smallest element whose own trimmed text IS the step name — i.e. the
        // label itself rather than an ancestor that merely contains it.
        const label = [...dialog.querySelectorAll('*')]
          .filter((el) => (el.textContent || '').trim() === name)
          .sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)[0];
        if (!label) continue;
        const cs = getComputedStyle(label);
        const row = label.closest('li, div') || label;
        out[name] = {
          color: cs.color,
          opacity: cs.opacity,
          fontWeight: cs.fontWeight,
          hasIcon: !!row.querySelector('svg, img, .MuiSvgIcon-root')
        };
      }
      return out;
    }, states.map((s) => s.name));

    return states.map((s) => ({
      ...s,
      current: !!counter && s.index === counter.current,
      upcoming: !!counter && s.index > counter.current,
      color: null,
      opacity: null,
      fontWeight: null,
      hasIcon: false,
      ...(styles[s.name] || {})
    }));
  }

  /** Click the modal backdrop (outside the dialog) without touching the X. */
  async clickBackdrop() {
    const backdrop = this.page.locator('.MuiDialog-root .MuiBackdrop-root, .MuiModal-backdrop').first();
    if (await this.isVisible(backdrop)) {
      await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    } else {
      await this.page.mouse.click(5, 5);
    }
    await this.page.waitForTimeout(1200);
  }

  nextButton() {
    return this.dialog().getByRole('button', { name: /^Next$/ }).first();
  }

  addUserButton() {
    return this.dialog().getByRole('button', { name: /^Add User$/ }).first();
  }

  /** The wizard's forward action, whichever label the current step exposes. */
  actionButton() {
    return this.dialog()
      .getByRole('button', { name: /^(Next|Add User)$/ })
      .first();
  }

  async actionButtonLabel() {
    return ((await this.actionButton().textContent()) || '').trim();
  }

  async isActionEnabled() {
    return await this.actionButton().isEnabled().catch(() => false);
  }

  /**
   * Advance the wizard. Waits for the "Step N/M" header to actually change
   * rather than sleeping a fixed beat — this is on the hot path (up to ten
   * calls per scenario), and the header is the authoritative signal that the
   * next step has mounted.
   */
  async clickNext() {
    const before = await this.stepCounter();
    await this.nextButton().click();
    if (before) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const now = await this.stepCounter().catch(() => null);
        if (now && now.current !== before.current) {
          await this.page.waitForTimeout(200); // let the new step's fields paint
          return;
        }
        await this.page.waitForTimeout(120);
      }
    }
    await this.page.waitForTimeout(800);
  }

  async submit() {
    await this.addUserButton().click();
    await this.page.waitForTimeout(2500);
  }

  // ---- Step 1: role selection ---------------------------------------------

  rolePopover() {
    return this.page.locator('.c-multi-select-dropdown-popover').first();
  }

  /**
   * The multi-select control mounted on the current wizard step — the Step 1
   * role picker, or the Supervisor clinic picker on Step 3.
   *
   * Matched on the component's own wrapper class rather than on its placeholder
   * text. Once a value is chosen the placeholder ("Select A Role" / "Select
   * Clinic") is REPLACED by a `.selected-option-chip`, so a text-based trigger
   * opens the picker exactly once and then times out on every re-open — which
   * is what broke every "deselect X and select Y" step.
   *
   * `:visible` is load-bearing, not defensive. The wizard does not unmount the
   * Step 1 role picker when it advances: on Step 3 the dialog holds TWO
   * `.c-multi-select-dropdown` nodes — the 0x0 role picker still carrying the
   * chosen role, and the real 322x46 "Select Clinic" control (verified live
   * 2026-07-26). A bare `.first()` therefore resolved to the invisible leftover
   * and every Step 3 clinic click burned the full 30s timeout. Filtering to the
   * visible one keeps Step 1 working (only one node is visible there) and fixes
   * Step 3. The `count()` guards in the openers still hold: count drops to 0
   * when nothing is visible, which falls through to the placeholder-text branch.
   */
  multiSelectField() {
    return this.dialog().locator('.c-multi-select-dropdown:visible').first();
  }

  async openRoleDropdown() {
    if (await this.isVisible(this.rolePopover())) return;
    const trigger = this.multiSelectField();
    if (await trigger.count()) await trigger.click();
    else await this.dialog().getByText(/Select A Role/i).first().click();
    await this.rolePopover().waitFor({ state: 'visible', timeout: 8000 });
  }

  async roleOptions() {
    await this.openRoleDropdown();
    return await this.page.evaluate(() => {
      const p = document.querySelector('.c-multi-select-dropdown-popover');
      return [...p.querySelectorAll('p.option-label')].map((o) => o.textContent.trim());
    });
  }

  /** True when the popover offers the "+ Create a new role" footer entry. */
  async hasCreateNewRoleOption() {
    await this.openRoleDropdown();
    return await this.isVisible(this.rolePopover().locator('.footer-action'));
  }

  /**
   * Dismiss the role/clinic popover. MUST be a real key press: the portal's
   * invisible backdrop stays mounted (and swallows every subsequent click on
   * the dialog) if closed via a synthetic JS event.
   */
  async dismissPopover() {
    await this.page.keyboard.press('Escape');
    // Wait for the portal to unmount instead of a blanket sleep. Both shapes
    // are covered: the role/clinic multi-select portal, and the plain MUI
    // Autocomplete listbox the Gender/Language/Clinic pickers render.
    await Promise.all([
      this.rolePopover().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {}),
      this.page
        .locator('li[role="option"]')
        .first()
        .waitFor({ state: 'hidden', timeout: 3000 })
        .catch(() => {})
    ]);
    await this.page.waitForTimeout(150);
  }

  /** Tick one or more roles (the picker is multi-select) and close the portal. */
  async selectRoles(roleNames) {
    await this.openRoleDropdown();
    for (const role of [].concat(roleNames)) {
      const search = this.rolePopover().getByPlaceholder(/Search Roles/i).first();
      if (await this.isVisible(search)) {
        await search.fill(role);
        // Short settle only: the exact-text waitFor below is what actually
        // gates the click, filtered list or not.
        await this.page.waitForTimeout(250);
      }
      const option = this.rolePopover()
        .locator(`p.option-label${textIs(role)}`)
        .first();
      await option.waitFor({ state: 'visible', timeout: 8000 });
      await option.click();
      await this.page.waitForTimeout(350);
    }
    await this.dismissPopover();
  }

  /** Currently-ticked roles, read back off the Step 1 field. */
  async selectedRoles() {
    return await this.page.evaluate(() => {
      const p = document.querySelector('.c-multi-select-dropdown-popover');
      if (!p) return [];
      return [...p.querySelectorAll('p.option-label')]
        .filter((o) => {
          const row = o.closest('li, label, div');
          const cb = row && row.querySelector('input[type="checkbox"]');
          return cb && cb.checked;
        })
        .map((o) => o.textContent.trim());
    });
  }

  createRoleDrawer() {
    return this.page.locator('.MuiDrawer-modal .MuiDrawer-paper').first();
  }

  /** Footer "+ Create a new role" — opens the Create A Role drawer in place. */
  async clickCreateNewRole() {
    await this.openRoleDropdown();
    await this.rolePopover().locator('.footer-action').first().click();
    await this.page.waitForTimeout(2000);
  }

  async isCreateRoleDrawerOpen() {
    const drawer = this.createRoleDrawer();
    if (!(await this.isVisible(drawer))) return false;
    return /Create A Role/i.test((await drawer.innerText()) || '');
  }

  // ---- Step 2: basic details ----------------------------------------------

  field(placeholder) {
    return this.dialog().locator(`input[placeholder="${placeholder}"]`).first();
  }

  /**
   * The country-code selector inside Phone Number. The control is
   * react-tel-input's `.flag-dropdown > .selected-flag`, a DIV carrying
   * role="button" — NOT a real <button> and NOT an <img>, so it has to be
   * matched structurally.
   */
  phoneCountryButton() {
    return this.dialog()
      .locator('[data-testid="phone-country-select"], .react-tel-input .flag-dropdown .selected-flag, .flag-dropdown [role="button"]')
      .first();
  }

  async hasPhoneCountrySelector() {
    return await this.isVisible(this.phoneCountryButton());
  }

  /**
   * Pick an option from an MUI Autocomplete.
   *
   * Options are matched on NORMALISED text, not Playwright's `:text-is()`.
   * The Language picker renders a flag image followed by two NON-BREAKING
   * spaces ("   English (United States)"); `:text-is()` normalises
   * ASCII whitespace only, so it never matches those labels. The index of the
   * matching option is resolved in the page and clicked by position instead.
   */
  async pickAutocomplete(placeholder, optionLabel) {
    const input = this.field(placeholder);
    await input.click();
    // Filter on the leading word only. Typing a full label such as
    // "English (United States)" narrows the list to nothing — the widget
    // matches against the language name, not the parenthesised region.
    await input.fill(String(optionLabel).split('(')[0].trim());
    await this.page.waitForTimeout(1200);
    await this.clickOptionByText(optionLabel);
  }

  /**
   * Click the open Autocomplete's option whose normalised text equals (or,
   * failing that, contains) `label`.
   */
  async clickOptionByText(label) {
    const list = this.page.locator('li[role="option"]');
    await list.first().waitFor({ state: 'visible', timeout: 8000 });
    const index = await this.page.evaluate((wanted) => {
      const norm = (t) => String(t).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      const options = [...document.querySelectorAll('li[role="option"]')].map((o) => norm(o.textContent));
      const exact = options.indexOf(norm(wanted));
      return exact >= 0 ? exact : options.findIndex((o) => o.includes(norm(wanted)));
    }, label);
    if (index < 0) {
      const offered = await this.page.evaluate(() =>
        [...document.querySelectorAll('li[role="option"]')].map((o) => o.textContent.trim())
      );
      throw new Error(`option "${label}" is not offered — the picker shows: ${offered.join(' | ')}`);
    }
    await list.nth(index).click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Option labels an MUI Autocomplete offers, normalised (see
   * clickOptionByText for why). `filter` is typed first for the widgets that
   * only render their list once the input narrows it (Language), and omitted
   * for the ones that list eagerly (Gender).
   */
  async autocompleteOptions(placeholder, filter) {
    const input = this.field(placeholder);
    await input.click();
    if (filter !== undefined) await input.fill(String(filter));
    await this.page.waitForTimeout(1200);
    const options = await this.page.evaluate(() =>
      [...document.querySelectorAll('li[role="option"]')]
        .map((o) => o.textContent.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    );
    await this.dismissPopover();
    return options;
  }

  /**
   * Enter a US phone number. The control is a react-tel-input mask pre-seeded
   * with "+1", and it needs the same two-part handling AddClinicModal already
   * documents for the identical widget on the Add Clinic wizard:
   *
   *   1. fill() alone does not fire the events react-hook-form listens for, so
   *      the field never validates and the action button stays disabled — real
   *      keystrokes (pressSequentially) are required.
   *   2. The seeded "+1" must be cleared FIRST. Typing national digits on top
   *      of it makes the widget re-parse the leading digits as a country code
   *      ("5551234567" -> "+55 (51) 234567", Brazil). Clearing with fill('')
   *      and typing the full E.164 ("1" + national) formats correctly to
   *      "+1 (555) 123-4567".
   *
   * fill('') is used to clear rather than Ctrl+A/Backspace: on this widget the
   * select-all only lands intermittently, and a missed clear silently APPENDS
   * to the previous number.
   */
  async enterPhone(national) {
    const digits = String(national).replace(/\D/g, '');
    await this.typePhoneRaw(digits.startsWith('1') ? digits : `1${digits}`);
  }

  /**
   * Type into the phone mask VERBATIM — no country-code normalisation — so the
   * negative specs can feed it "123" or "abcdefghij" exactly as written.
   */
  async typePhoneRaw(value) {
    const input = this.field('Enter Phone Number');
    await input.click();
    await input.fill('');
    if (String(value).length) await input.pressSequentially(String(value), { delay: 30 });
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(600);
  }

  /** Fill Step 2. Any omitted key is left untouched (used by the negative specs). */
  async fillBasicDetails({ firstName, lastName, email, phone, gender, language } = {}) {
    if (firstName !== undefined) await this.field('Enter First Name').fill(firstName);
    if (lastName !== undefined) await this.field('Enter Last Name').fill(lastName);
    if (email !== undefined) await this.field('Enter Email Address').fill(email);
    if (phone !== undefined) await this.enterPhone(phone);
    if (gender !== undefined) await this.pickAutocomplete('Select Gender', gender);
    if (language !== undefined) await this.pickAutocomplete('Select Language', language);
    await this.page.waitForTimeout(500);
  }

  async fieldValue(placeholder) {
    return await this.field(placeholder).inputValue();
  }

  /** Inline MUI helper-text errors currently shown in the wizard. */
  async validationMessages() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] .MuiFormHelperText-root')]
        .map((e) => e.textContent.trim())
        .filter(Boolean)
    );
  }

  /**
   * Inline errors, waited for rather than sampled once.
   *
   * react-hook-form validates on blur/change and paints the helper text a beat
   * later, so a single read right after a keystroke can legitimately come back
   * empty. Polls until a message appears, then returns the full list (or [] if
   * the form genuinely has nothing to say within `timeout`).
   *
   * Use this — not validationMessages() — whenever the assertion is that a
   * message IS shown; the plain reader is for asserting the absence of one.
   */
  async waitForValidationMessages(timeout = 5000) {
    const deadline = Date.now() + timeout;
    let messages = await this.validationMessages();
    while (!messages.length && Date.now() < deadline) {
      await this.page.waitForTimeout(300);
      messages = await this.validationMessages();
    }
    return messages;
  }

  /**
   * "Validation occurred" in the repo's disjunctive sense: either an inline
   * error surfaced, or the wizard refuses to advance (action button disabled).
   * Both are acceptable MUI form feedback.
   */
  async hasValidationFor(fieldName) {
    const messages = await this.validationMessages();
    if (messages.some((m) => new RegExp(escapeRe(fieldName), 'i').test(m))) return true;
    return !(await this.isActionEnabled());
  }

  // ---- Step 3: permissions ------------------------------------------------

  clinicPopover() {
    return this.page.locator('.c-multi-select-dropdown-popover').first();
  }

  /**
   * Open the Supervisor multi-select clinic popover. Same placeholder-is-
   * replaced-by-a-chip problem as the role picker (see multiSelectField), which
   * matters because selectFirstAvailableClinic() opens it twice — once to read
   * the options, once to tick one.
   */
  async openClinicPopover() {
    if (await this.isVisible(this.clinicPopover())) return;
    const trigger = this.multiSelectField();
    if (await trigger.count()) await trigger.click();
    else await this.dialog().getByText(/^Select Clinic$/i).first().click();
    await this.clinicPopover().waitFor({ state: 'visible', timeout: 8000 });
  }

  /**
   * Assign clinics. Two different controls exist depending on the role:
   *   - Nurse       → single-select autocomplete (`input[placeholder="Select Clinic"]`)
   *   - Supervisor  → multi-select checkbox popover ("Clinics*")
   * The mounted one is detected rather than assumed.
   */
  async selectClinics(clinicNames) {
    const names = [].concat(clinicNames);
    const autocomplete = this.dialog().locator('input[placeholder="Select Clinic"]').first();

    if (await this.isVisible(autocomplete)) {
      await this.pickAutocomplete('Select Clinic', names[0]);
      return;
    }

    await this.openClinicPopover();
    for (const name of names) {
      const search = this.clinicPopover().getByPlaceholder(/Search Clinics/i).first();
      if (await this.isVisible(search)) {
        await search.fill(name);
        await this.page.waitForTimeout(700);
      }
      const option = this.clinicPopover()
        .locator(`p.option-label${textIs(name)}`)
        .first();
      await option.waitFor({ state: 'visible', timeout: 8000 });
      await option.click();
      await this.page.waitForTimeout(500);
    }
    await this.dismissPopover();
  }

  /** Available clinic names on Step 3 (whichever control is mounted). */
  async clinicOptions() {
    const autocomplete = this.dialog().locator('input[placeholder="Select Clinic"]').first();
    if (await this.isVisible(autocomplete)) {
      await autocomplete.click();
      await this.page.waitForTimeout(1200);
      const opts = await this.page.evaluate(() =>
        [...document.querySelectorAll('li[role="option"]')].map((o) => o.textContent.trim())
      );
      await this.dismissPopover();
      return opts;
    }
    await this.openClinicPopover();
    const opts = await this.page.evaluate(() => {
      const p = document.querySelector('.c-multi-select-dropdown-popover');
      return [...p.querySelectorAll('p.option-label')].map((o) => o.textContent.trim());
    });
    await this.dismissPopover();
    return opts;
  }

  /**
   * The REAL clinic names Step 3 offers. The Supervisor multi-select popover
   * renders its "Select All" toggle as an ordinary `p.option-label`, so it
   * comes back from clinicOptions() looking like a clinic — it is dropped here
   * (as is the "-" placeholder) to leave only assignable clinics.
   */
  async clinicNames() {
    return (await this.clinicOptions()).filter(
      (name) => name && !/^select all$/i.test(name.trim()) && name.trim() !== '-'
    );
  }

  /**
   * Assign whichever clinic the environment happens to offer first, and return
   * its name. Preferred over hard-coding a clinic in the Gherkin: the QA
   * environment's clinic list is churned by the Clinics suite, so a literal
   * like "Bytecorp Clinic" is a standing flake risk.
   */
  async selectFirstAvailableClinic() {
    const names = await this.clinicNames();
    if (!names.length) throw new Error('Step 3 offered no clinics to select');
    await this.selectClinics(names[0]);
    return names[0];
  }

  /** True when Step 3 offers multi-select clinics (Supervisor-style). */
  async isClinicMultiSelect() {
    const autocomplete = this.dialog().locator('input[placeholder="Select Clinic"]').first();
    return !(await this.isVisible(autocomplete));
  }

  allowProgramCreationInput() {
    return this.dialog().locator('input[placeholder="Select Option"]').first();
  }

  async hasAllowProgramCreation() {
    const text = await this.dialogText();
    return /Allow Program Creation/i.test(text) && (await this.isVisible(this.allowProgramCreationInput()));
  }

  async allowProgramCreationOptions() {
    await this.allowProgramCreationInput().click();
    await this.page.waitForTimeout(1000);
    const opts = await this.page.evaluate(() =>
      [...document.querySelectorAll('li[role="option"]')].map((o) => o.textContent.trim())
    );
    await this.dismissPopover();
    return opts;
  }

  /**
   * Whatever "Allow Program Creation" currently holds. The live build ships it
   * PRE-FILLED with "No" (verified 2026-07-26), which is why Step 3 unlocks on
   * the clinic assignment alone — the field is never empty, so it never gates.
   */
  async allowProgramCreationValue() {
    return (await this.allowProgramCreationInput().inputValue().catch(() => '')).trim();
  }

  /** Options are Yes / No on the live build. */
  async selectAllowProgramCreation(value) {
    await this.pickAutocomplete('Select Option', value);
  }

  // ---- Row actions --------------------------------------------------------

  async openRowMenu(userId) {
    await this.searchUserId(userId);
    const row = this.rowById(userId);
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.locator('[data-field="action"] button').first().click();
    await this.page.getByRole('menuitem').first().waitFor({ state: 'visible', timeout: 8000 });
  }

  async rowMenuItems() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim())
    );
  }

  async openUserDetails(userId) {
    await this.openRowMenu(userId);
    await this.page.getByRole('menuitem', { name: /View Details/i }).first().click();
    await this.page.waitForTimeout(1500);
  }

  async isUserDetailsOpen(userId) {
    if (/\/users\/[^/]+/i.test(await this.getCurrentUrl())) return true;
    const panel = this.page
      .locator('[role="dialog"], [data-testid="user-details"], .MuiDrawer-paper')
      .filter({ hasText: userId ? new RegExp(String(userId)) : /./ })
      .first();
    return await this.isVisible(panel);
  }

  async markUserInactive(userId) {
    await this.openRowMenu(userId);
    await this.page.getByRole('menuitem', { name: /Mark as Inactive/i }).first().click();
    const dlg = this.page.getByRole('dialog').filter({ hasText: /Mark User as Inactive/i }).first();
    await dlg.waitFor({ state: 'visible', timeout: 10000 });
    await dlg.getByRole('button', { name: /Mark as Inactive/i }).click();
    await this.page.waitForTimeout(2000);
  }

  /** Toast text raised by the last action ('' when it auto-dismissed first). */
  async captureToast(timeout = 6000) {
    const toast = this.page
      .locator('.notistack-MuiContent, .MuiAlert-message, [role="alert"], [role="status"]')
      .first();
    try {
      await toast.waitFor({ state: 'visible', timeout });
      return ((await toast.textContent()) || '').trim();
    } catch {
      return '';
    }
  }

  // ---- Fault injection ----------------------------------------------------

  /**
   * Make the NEXT create-user call fail at the network boundary, so the
   * "a failed submission keeps the modal open" spec can be run without needing
   * the backend to misbehave.
   *
   * The wizard posts to a DIFFERENT endpoint per role — /api/auth/register for
   * admin-ish roles, /api/users/nurses | supervisors | support-staff for the
   * clinic-scoped ones — so the route matches on "a POST that creates a user"
   * rather than on one fixed path. Everything else (including the login and
   * OTP POSTs) is passed straight through.
   *
   * The route is bound to the scenario's page and dies with its context.
   */
  async failCreateUserRequests(status = 500) {
    await this.page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = request.url();
      const isCreate =
        request.method() === 'POST' &&
        /\/api\/(auth\/register|users\/(nurses|supervisors|support-staff|admins))\b/i.test(url);
      if (!isCreate) return route.continue();
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Injected failure (automated test)' })
      });
    });
  }

  // ---- Composite helpers --------------------------------------------------

  /**
   * The Associated Clinics cell per row, read from the wrapper's `aria-label`
   * rather than its text: the cell clamps long values to one line, so the
   * aria-label is the only place the FULL comma-joined clinic list survives.
   */
  async clinicCells() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('.MuiDataGrid-row')].map((row) => {
        const cell = row.querySelector('[data-field="associatedClinicsDisplay"]');
        const labelled = cell && cell.querySelector('[aria-label]');
        return {
          id: (row.querySelector('[data-field="id"]') || {}).innerText?.trim() || '',
          clinics: (labelled ? labelled.getAttribute('aria-label') : (cell || {}).innerText || '').trim()
        };
      })
    );
  }

  /** Resolve a user's numeric id from the grid by matching any cell text. */
  async resolveUserId(text) {
    const rows = await this.readRows();
    const needle = String(text).toLowerCase();
    const hit = rows.find((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(needle))
    );
    return hit ? hit.id : null;
  }

  /**
   * Walk the wizard end-to-end. `clinics` / `allowProgramCreation` are only
   * consumed when the chosen role actually renders Step 3.
   */
  async createUser({ roles, firstName, lastName, email, phone, gender, language, clinics, allowProgramCreation }) {
    await this.openAddUser();
    await this.selectRoles(roles);
    await this.clickNext();
    await this.fillBasicDetails({ firstName, lastName, email, phone, gender, language });

    const counter = await this.stepCounter();
    if (counter && counter.total === 3) {
      await this.clickNext();
      if (clinics) await this.selectClinics(clinics);
      if (allowProgramCreation && (await this.hasAllowProgramCreation())) {
        await this.selectAllowProgramCreation(allowProgramCreation);
      }
    }
    await this.submit();
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Playwright `:text-is("…")` suffix — exact match on the element's trimmed text. */
function textIs(s) {
  return `:text-is("${String(s).replace(/"/g, '\\"')}")`;
}

module.exports = { UsersPage };
