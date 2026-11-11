const { BasePage } = require('./BasePage');
const { UsersPage } = require('./UsersPage');

/**
 * PermissionsPage — reads what the CURRENTLY logged-in role can actually see and
 * do, so rbac.steps.js can compare it against the RBAC sheet (rbacMatrix.js).
 *
 * It is a pure observer: every method answers "is this affordance present?" and
 * never mutates data. That matters — the suite walks these surfaces as a real
 * role on the shared QA environment, and an RBAC sweep must not create, edit or
 * inactivate anything as a side effect of checking whether it could.
 *
 * Selectors follow the repo convention (data-testid → ARIA role → semantic HTML
 * → MUI structural classes → text), and were captured against the live QA build
 * on 2026-07-26 by driving it through the Playwright MCP browser as BOTH a
 * Support Staff user and an Executive Admin. What that established:
 *
 *   - Navigation is flat and role-filtered: Support Staff sees Monitoring /
 *     Reports / Invoices / Clinics / Patients / Users, an admin additionally
 *     sees Roles. A missing sidebar link is the coarsest permission signal.
 *   - The four "… Management" sections of the sheet are all /users today, so a
 *     per-section observation means "read this off a grid row (or user-detail
 *     page) belonging to a user of that role" — hence `roleFilter`.
 *   - Row-level permissions live in the row's 3-dot menu. MUI leaves CLOSED
 *     menus in the DOM, so menu items are read from the one popover that is
 *     actually visible; reading `[role="menuitem"]` globally returns stale
 *     entries from previous clicks and silently over-reports permissions.
 *   - A user's own row never offers "Mark as Inactive" (self-protection), so
 *     row probes skip the acting user's own row.
 *   - User details are NOT deep-linkable (/users/<id> bounces to /monitoring);
 *     they must be opened via the row menu, which lands on /users/details/<id>.
 *
 * Surfaces are cached per instance (one instance per scenario), because a single
 * RBAC sweep asks ~40 questions of the same handful of screens.
 */
class PermissionsPage extends BasePage {
  constructor(page) {
    super(page);
    this._cache = new Map();
    /** Email of the acting user, so their own row can be skipped. */
    this.actingEmail = null;
    /** Display name of the acting user, so their own NOTES can be told apart. */
    this.actingName = null;
    /**
     * The /users screen shares this page. Reused (rather than reimplemented) for
     * the Roles filter, which is the only way to reach a role whose users are
     * beyond page 1 — the search box searches User ID / Email / name, never role.
     */
    this.usersPage = new UsersPage(page);
  }

  // ---- URLs / navigation --------------------------------------------------

  origin() {
    const login =
      process.env.BASE_URL ||
      'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login';
    return login.replace(/\/login.*$/i, '');
  }

  urlFor(path) {
    return `${this.origin()}/${String(path).replace(/^\//, '')}`;
  }

  async currentPath() {
    return new URL(await this.getCurrentUrl()).pathname;
  }

  /**
   * Land on `path` and wait for the shell to paint. Returns false when the app
   * refuses the route (a redirect elsewhere) — itself a permission signal.
   */
  async goto(path, { settleMs = 1500 } = {}) {
    await this.navigate(this.urlFor(path));
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(settleMs);
    await this.page
      .locator('.MuiDataGrid-root, main')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    // This preview host serves data slowly and unevenly — measured the same
    // minute, one grid painted in 1.5s and the next took over 8s. Reading a
    // still-loading grid reports zero rows, which an RBAC sweep would misread as
    // "this role cannot see any records". Wait for real content instead.
    await this.waitForGrid();
    const landed = await this.currentPath();
    return new RegExp(`/${String(path).replace(/^\//, '')}/?$`, 'i').test(landed);
  }

  /**
   * Wait until a DataGrid on the page has settled: either it has rows, or it is
   * showing its empty state ("Nothing here yet."). Returns what it settled into
   * so callers can tell "no permission" from "no data".
   */
  async waitForGrid(timeout = 30000) {
    const deadline = Date.now() + timeout;
    let last = { grid: false, rows: 0, empty: false };
    while (Date.now() < deadline) {
      last = await this.page
        .evaluate(() => {
          const grid = document.querySelector('.MuiDataGrid-root');
          if (!grid) return { grid: false, rows: 0, empty: false };
          const rows = grid.querySelectorAll('.MuiDataGrid-row').length;
          const overlay = grid.querySelector('.MuiDataGrid-overlay, .MuiDataGrid-overlayWrapper');
          const overlayText = overlay ? (overlay.innerText || '').trim() : '';
          return {
            grid: true,
            rows,
            empty: /nothing here yet|no rows|no results|no data/i.test(overlayText)
          };
        })
        .catch(() => last);
      if (!last.grid) return last;            // this route renders no grid at all
      if (last.rows > 0 || last.empty) return last;
      await this.page.waitForTimeout(600);
    }
    return last;
  }

  // ---- Low-level readers --------------------------------------------------

  /**
   * A freshly activated account lands on a modal nagging it to set up MFA
   * ("Remind Me Later" / "Set Up MFA Now"), which sits over the whole app and
   * eats clicks. Declining it keeps the RBAC sweep on the intended surfaces —
   * and keeps the ephemeral context MFA-free.
   */
  async dismissMfaPrompt() {
    const later = this.page.getByRole('button', { name: /Remind Me Later/i }).first();
    if (await this.isVisible(later)) {
      await later.click().catch(() => {});
      await this.page.waitForTimeout(800);
      return true;
    }
    return false;
  }

  /**
   * Wait for the authenticated app shell to mount. `expectNavigatedAwayFromLogin`
   * resolves as soon as the URL changes, which is a beat BEFORE the sidebar
   * renders its links — reading the nav at that moment returns an empty list and
   * would look like "this role has no sections at all". Polls until at least one
   * sidebar destination is painted.
   */
  async waitForShell(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const sections = await this.page
        .evaluate(() => document.querySelectorAll('nav a[href^="/"], aside a[href^="/"], a[href^="/"]').length)
        .catch(() => 0);
      if (sections > 0) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }

  /** Sidebar destinations available to this role. */
  async navSections() {
    await this.waitForShell().catch(() => {});
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')]
        .map((a) => a.textContent.trim())
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)
    );
  }

  /**
   * Every VISIBLE button inside <main>, with its state.
   *
   * Visibility is not optional here. MUI keeps the panels of previously-visited
   * tabs mounted, so an unfiltered read returns controls belonging to other tabs
   * — which would let a File Vault "Upload" from one panel satisfy a probe aimed
   * at another, i.e. report a permission the role does not actually have on the
   * screen under test.
   */
  async buttons() {
    return await this.page.evaluate(() => {
      const root = document.querySelector('main') || document.body;
      return [...root.querySelectorAll('button, [role="button"], a[role="button"]')]
        .filter((b) => {
          if (b.offsetParent === null) return false;
          const hiddenAncestor = b.closest('[aria-hidden="true"], [hidden]');
          return !hiddenAncestor;
        })
        .map((b) => ({
          label: (b.textContent || '').trim() || b.getAttribute('aria-label') || '',
          disabled: !!b.disabled || b.getAttribute('aria-disabled') === 'true'
        }))
        .filter((b) => b.label);
    });
  }

  async tabNames() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()).filter(Boolean)
    );
  }

  async mainText() {
    return await this.page.evaluate(() => (document.querySelector('main') || document.body).innerText);
  }

  async gridRowCount() {
    return await this.page.evaluate(() => document.querySelectorAll('.MuiDataGrid-row').length);
  }

  /**
   * Menu items of the ONE visible popover. MUI keeps closed menus mounted, so
   * anything whose popover is aria-hidden or which is not laid out is ignored.
   */
  async visibleMenuItems() {
    return await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .filter((m) => {
          if (m.offsetParent === null) return false;
          const host = m.closest('.MuiPopover-root, .MuiMenu-root, [role="presentation"]');
          return !host || host.getAttribute('aria-hidden') !== 'true';
        })
        .map((m) => m.textContent.trim())
        .filter(Boolean)
    );
  }

  /** Close any open menu/popover without activating one of its items. */
  async dismissMenu() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async clickTab(name) {
    const tab = this.page.getByRole('tab', { name: new RegExp(`^${escapeRe(name)}`, 'i') }).first();
    if (!(await this.isVisible(tab))) return false;
    await tab.click();
    await this.page.waitForTimeout(2500);
    return true;
  }

  // ---- /users ------------------------------------------------------------

  /**
   * Rows on the Active sub-tab of /users, as { id, roles, email }. Cached.
   */
  async userRows() {
    return this._once('users:rows', async () => {
      await this.goto('users');
      // /users carries per-account list state (a search term or filter persists
      // SERVER-SIDE), so a narrowed grid here would hide whole roles and read as
      // "this role cannot see nurses". Clear it before harvesting rows.
      await this._clearUsersListState();
      return await this.page.evaluate(() =>
        [...document.querySelectorAll('.MuiDataGrid-row')].map((r) => {
          const cell = (f) => {
            const c = r.querySelector(`[data-field="${f}"]`);
            return c ? (c.innerText || '').trim() : '';
          };
          return { id: cell('id'), roles: cell('roles'), email: cell('email') };
        })
      );
    });
  }

  /**
   * A row belonging to a user of `roleFilter`, excluding the acting user's own
   * row. `roleFilter` is matched loosely so "nurse" finds "NXTSTIM Nurse" and
   * custom nurse roles, and "admin" finds any *Admin role.
   */
  async findUserRowByRole(roleFilter) {
    return this._once(`users:rowFor:${roleFilter}`, async () => {
      const want = roleRegex(roleFilter);
      const mine = (this.actingEmail || '').toLowerCase();
      const pick = (rows) => rows.find((r) => want.test(r.roles) && r.email.toLowerCase() !== mine && r.id) || null;

      const hit = pick(await this.userRows());
      if (hit) return hit;

      // Not on page 1 — narrow the grid with the Roles filter. Without this, a
      // role whose users all sit on a later page reads as "this actor cannot see
      // any users of that role", which is a permission claim the grid never made.
      return await this._findUserRowViaRolesFilter(want, mine);
    });
  }

  /** Apply the Roles filter for every role matching `want`, then read a row. */
  async _findUserRowViaRolesFilter(want, mine) {
    const users = this.usersPage;
    try {
      await this.goto('users');
      await users.openFilters();
      const options = await users.filterOptions('Roles').catch(() => []);
      const matching = options.filter((o) => want.test(o));
      if (!matching.length) {
        await users.closeFilters().catch(() => {});
        return null;
      }
      await users.applyFilter('Roles', matching.slice(0, 6));
      await this.waitForGrid();
      const rows = await this.page.evaluate(() =>
        [...document.querySelectorAll('.MuiDataGrid-row')].map((r) => {
          const cell = (f) => {
            const c = r.querySelector(`[data-field="${f}"]`);
            return c ? (c.innerText || '').trim() : '';
          };
          return { id: cell('id'), roles: cell('roles'), email: cell('email') };
        })
      );
      return rows.find((r) => r.email.toLowerCase() !== mine && r.id) || null;
    } catch {
      return null;
    } finally {
      // Leave the grid unfiltered for the probes that follow.
      await this.usersPage.clearAllFilters().catch(() => {});
      this._cache.delete('users:rows');
      this._cache.delete('users:surface');
    }
  }

  /**
   * Re-navigate to a detail page when an intervening probe has moved the browser
   * elsewhere. Surfaces are cached, so by the time a later probe reads a tab the
   * page may be sitting on /reports or /invoices — clicking a "tab" there would
   * observe nothing and report a permission as missing.
   */
  async _ensureOnPath(path) {
    if (!path) return false;
    if ((await this.currentPath()) === path) return true;
    await this.navigate(`${this.origin()}${path}`);
    await this.page.waitForTimeout(3000);
    await this.waitForGrid(15000);
    return (await this.currentPath()) === path;
  }

  /**
   * Bring one specific user's row on screen regardless of paging, by searching
   * the grid on their email. Needed because a role's users can live on page 5:
   * the row that the Roles filter found is not on page 1 afterwards, and probing
   * a row that simply is not rendered would read as "action not permitted".
   */
  async _showUserRow(row) {
    await this.goto('users');
    await this.usersPage.searchInField('Email', row.email).catch(() => {});
    await this.waitForGrid(20000);
    return await this.page.evaluate(
      (id) => [...document.querySelectorAll('.MuiDataGrid-row')].some(
        (r) => ((r.querySelector('[data-field="id"]') || {}).innerText || '').trim() === id
      ),
      row.id
    );
  }

  /** Row-menu items for the first row of `roleFilter` ('' when no such row). */
  async userRowMenu(roleFilter) {
    return this._once(`users:rowmenu:${roleFilter}`, async () => {
      const row = await this.findUserRowByRole(roleFilter);
      if (!row) return { row: null, items: [] };
      const onScreen = await this._showUserRow(row);
      if (!onScreen) return { row, items: [] };
      const clicked = await this.page.evaluate((id) => {
        const target = [...document.querySelectorAll('.MuiDataGrid-row')].find(
          (r) => ((r.querySelector('[data-field="id"]') || {}).innerText || '').trim() === id
        );
        const btn = target && target.querySelector('[data-field="action"] button');
        if (!btn) return false;
        btn.click();
        return true;
      }, row.id);
      if (!clicked) return { row, items: [] };
      await this.page.waitForTimeout(1200);
      const items = await this.visibleMenuItems();
      await this.dismissMenu();
      return { row, items };
    });
  }

  /**
   * Open the details page of a user of `roleFilter` (via the row menu — details
   * are not deep-linkable) and report its tabs plus whether it offers Edit.
   */
  async userDetails(roleFilter) {
    return this._once(`users:details:${roleFilter}`, async () => {
      const row = await this.findUserRowByRole(roleFilter);
      if (!row) return { row: null, tabs: [], buttons: [], opened: false };
      const onScreen = await this._showUserRow(row);
      if (!onScreen) return { row, tabs: [], buttons: [], opened: false };
      const opened = await this.page.evaluate(async (id) => {
        const target = [...document.querySelectorAll('.MuiDataGrid-row')].find(
          (r) => ((r.querySelector('[data-field="id"]') || {}).innerText || '').trim() === id
        );
        const btn = target && target.querySelector('[data-field="action"] button');
        if (!btn) return false;
        btn.click();
        await new Promise((r) => setTimeout(r, 900));
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .filter((m) => m.offsetParent !== null)
          .find((m) => /View Details/i.test(m.textContent || ''));
        if (!item) return false;
        item.click();
        return true;
      }, row.id);
      if (!opened) return { row, tabs: [], buttons: [], opened: false };
      await this.page.waitForURL(/\/users\/details\//i, { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      return { row, tabs: await this.tabNames(), buttons: await this.buttons(), opened: true };
    });
  }

  /** Roles the Add-New-User wizard lets this role create ([] when it cannot). */
  async creatableRoles() {
    return this._once('users:creatableRoles', async () => {
      await this.goto('users');
      const addBtn = this.page.getByRole('button', { name: /Add New User/i }).first();
      if (!(await this.isVisible(addBtn))) return null; // cannot create users at all
      await addBtn.click();
      await this.page.waitForTimeout(2000);
      const dialog = this.page.getByRole('dialog').first();
      if (!(await this.isVisible(dialog))) return null;
      // The role field is a custom multi-select, not a native <select>: click the
      // "Select A Role" control, then read the portal popover's options.
      await dialog.locator(':text("Select A Role")').last().click().catch(() => {});
      await this.page.waitForTimeout(1500);
      const options = await this.page.evaluate(() => {
        const pop = document.querySelector('.c-multi-select-dropdown-popover, .MuiPopover-paper, [role="listbox"]');
        if (!pop) return [];
        const items = [...pop.querySelectorAll('li, [role="option"], label, .c-checkbox-label')]
          .map((o) => (o.textContent || '').trim())
          .filter(Boolean);
        // Some builds render the options as plain rows of text inside the popover.
        if (items.length) return [...new Set(items)];
        return pop.innerText.split('\n').map((s) => s.trim()).filter((s) => s && s !== '​');
      });
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(400);
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(600);
      return options;
    });
  }

  // ---- /clinics ----------------------------------------------------------

  async clinicsSurface() {
    return this._once('clinics:list', async () => {
      const landed = await this.goto('clinics');
      return {
        landed,
        rows: await this.gridRowCount(),
        empty: (await this.waitForGrid(0)).empty,
        buttons: await this.buttons(),
        text: await this.mainText()
      };
    });
  }

  async clinicRowMenu() {
    return this._once('clinics:rowmenu', async () => {
      await this.goto('clinics');
      const clicked = await this.page.evaluate(() => {
        const row = document.querySelector('.MuiDataGrid-row');
        if (!row) return false;
        const buttons = [...row.querySelectorAll('button')];
        const kebab = buttons[buttons.length - 1];
        if (!kebab) return false;
        kebab.click();
        return true;
      });
      if (!clicked) return [];
      await this.page.waitForTimeout(1200);
      const items = await this.visibleMenuItems();
      await this.dismissMenu();
      return items;
    });
  }

  /** Open the first clinic's detail page; returns its tabs and buttons. */
  async clinicDetail() {
    return this._once('clinics:detail', async () => {
      await this.goto('clinics');
      const opened = await this.page.evaluate(async () => {
        const row = document.querySelector('.MuiDataGrid-row');
        if (!row) return false;
        const buttons = [...row.querySelectorAll('button')];
        const kebab = buttons[buttons.length - 1];
        if (!kebab) return false;
        kebab.click();
        await new Promise((r) => setTimeout(r, 900));
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .filter((m) => m.offsetParent !== null)
          .find((m) => /View Details/i.test(m.textContent || ''));
        if (!item) return false;
        item.click();
        return true;
      });
      if (!opened) return { opened: false, url: await this.currentPath(), tabs: [], buttons: [] };
      await this.page.waitForURL(/\/clinics\/\d+/i, { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(3000);
      return {
        opened: true,
        url: await this.currentPath(),
        tabs: await this.tabNames(),
        buttons: await this.buttons()
      };
    });
  }

  /** Controls rendered inside one clinic-detail tab. */
  async clinicTabSurface(tabName) {
    return this._once(`clinics:tab:${tabName}`, async () => {
      const detail = await this.clinicDetail();
      if (!detail.opened) return { available: false, buttons: [], text: '' };
      await this._ensureOnPath(detail.url);
      const clicked = await this.clickTab(tabName);
      if (!clicked) return { available: false, buttons: [], text: '' };
      return { available: true, buttons: await this.buttons(), text: await this.mainText() };
    });
  }

  // ---- /patients ---------------------------------------------------------

  async patientsSurface() {
    return this._once('patients:list', async () => {
      const landed = await this.goto('patients');
      return { landed, rows: await this.gridRowCount(),
        empty: (await this.waitForGrid(0)).empty, buttons: await this.buttons() };
    });
  }

  /** Open the first patient's record; returns its tabs and header buttons. */
  async patientDetail() {
    return this._once('patients:detail', async () => {
      await this.goto('patients');
      const opened = await this.page.evaluate(async () => {
        const row = document.querySelector('.MuiDataGrid-row');
        if (!row) return false;
        const buttons = [...row.querySelectorAll('button')];
        const kebab = buttons[buttons.length - 1];
        if (!kebab) return false;
        kebab.click();
        await new Promise((r) => setTimeout(r, 900));
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .filter((m) => m.offsetParent !== null)
          .find((m) => /View Details/i.test(m.textContent || ''));
        if (!item) return false;
        item.click();
        return true;
      });
      if (!opened) return { opened: false, url: await this.currentPath(), tabs: [], buttons: [] };
      await this.page.waitForURL(/\/(monitoring|patients)\/details\/\d+/i, { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(3500);
      return {
        opened: true,
        url: await this.currentPath(),
        tabs: await this.tabNames(),
        buttons: await this.buttons()
      };
    });
  }

  async patientTabSurface(tabName) {
    return this._once(`patients:tab:${tabName}`, async () => {
      const detail = await this.patientDetail();
      if (!detail.opened) return { available: false, buttons: [], text: '' };
      await this._ensureOnPath(detail.url);
      const clicked = await this.clickTab(tabName);
      if (!clicked) return { available: false, buttons: [], text: '' };
      return { available: true, buttons: await this.buttons(), text: await this.mainText() };
    });
  }

  // ---- /reports ----------------------------------------------------------

  /**
   * Report cards on /reports.
   *
   * Read from `.report-card` — the app's own class for one card. An earlier
   * version walked up from each "View Report" button to the nearest ancestor
   * holding a report-ish heading, which lands on a WRAPPER around several cards:
   * clicking through it opened whichever card came first, so a probe aimed at
   * "Codes Progress" silently measured "Patient Monitoring" instead.
   */
  async reportCards() {
    return this._once('reports:cards', async () => {
      const landed = await this.goto('reports');
      const cards = await this.page.evaluate(() =>
        [...document.querySelectorAll('.report-card')].map((card) => {
          const heading = card.querySelector('h1,h2,h3,h4,h5,h6,p');
          return {
            name: heading ? heading.textContent.trim() : (card.innerText || '').split('\n')[0].trim(),
            hasView: [...card.querySelectorAll('button')].some((b) => /View Report/i.test(b.textContent || ''))
          };
        })
      );
      return { landed, cards, text: await this.mainText() };
    });
  }

  /**
   * Open one report and report the controls it offers.
   *
   * Some reports only reveal their download control once there are results:
   * /reports/patient-data-report opens on "Nothing here yet. Search to generate
   * results" and grows a per-row "Download Report" only after a search. So when
   * the opened report shows that empty state and has a search box, this seeds a
   * broad search term first (a read-only action) — otherwise a role that CAN
   * download would be reported as unable to.
   */
  async reportSurface(cardPattern) {
    return this._once(`reports:open:${cardPattern}`, async () => {
      const { cards } = await this.reportCards();
      const card = cards.find((c) => cardPattern.test(c.name));
      if (!card) return { available: false, buttons: [], text: '' };

      await this.goto('reports');
      const opened = await this.page.evaluate((name) => {
        const target = [...document.querySelectorAll('.report-card')].find((c) => {
          const heading = c.querySelector('h1,h2,h3,h4,h5,h6,p');
          return heading && heading.textContent.trim() === name;
        });
        if (!target) return false;
        const btn = [...target.querySelectorAll('button')].find((b) => /View Report/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      }, card.name);
      if (!opened) return { available: false, buttons: [], text: '' };

      // Wait for the report screen to actually mount. Read too early and <main>
      // holds nothing but the breadcrumb, which would report a role that CAN
      // generate the report as unable to.
      await this._waitForReportScreen();
      let text = await this.mainText();
      if (/search to generate results/i.test(text)) {
        await this._seedReportSearch();
        text = await this.mainText();
      }
      return { available: true, buttons: await this.buttons(), text, url: await this.currentPath() };
    });
  }

  /**
   * Wait until an opened report screen has rendered its own controls: the URL
   * leaves /reports for /reports/<slug> and <main> grows something beyond the
   * "Reports" breadcrumb (a month/clinic picker, a search box, or a grid).
   */
  async _waitForReportScreen(timeout = 25000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await this.page
        .evaluate(() => {
          const main = document.querySelector('main') || document.body;
          const labels = [...main.querySelectorAll('button')]
            .filter((b) => b.offsetParent !== null)
            .map((b) => (b.textContent || '').trim());
          return {
            path: location.pathname,
            own: labels.filter((l) => l && !/^Reports$/i.test(l)).length,
            hasGrid: !!main.querySelector('.MuiDataGrid-root'),
            text: (main.innerText || '').slice(0, 200)
          };
        })
        .catch(() => null);
      if (state && /\/reports\/.+/.test(state.path) && (state.own > 0 || state.hasGrid)) return true;
      await this.page.waitForTimeout(700);
    }
    return false;
  }

  /** Type a broad term into a report's search box so results (and their download controls) render. */
  async _seedReportSearch() {
    const search = this.page.locator('input[placeholder^="Search for"]').first();
    if (!(await this.isVisible(search))) return false;
    for (const seed of ['a', 'e', 'Jane']) {
      await search.fill(seed);
      await this.page.waitForTimeout(4000);
      const state = await this.waitForGrid(15000);
      if (state.rows > 0) return true;
    }
    return false;
  }

  // ---- Notes (patient record) --------------------------------------------

  /**
   * The Notes drawer, opened from the icon-only button in the patient header
   * (`aria-label="Show All Notes"`, next to "Report"). Notes are NOT a tab —
   * which is why an earlier text-only sweep of the patient record concluded the
   * feature did not exist in this build.
   *
   * Returns { available, addAvailable, notes: [{ title, author, mine }] }.
   */
  async notesDrawer() {
    return this._once('patients:notes', async () => {
      const detail = await this.patientDetail();
      if (!detail.opened) return { available: false, addAvailable: false, notes: [] };
      // The patient record IS deep-linkable, so go back to it if a later probe
      // has since navigated away (surfaces are cached, the browser is not).
      await this._ensureOnPath(detail.url);

      const opened = await this.page.evaluate(async () => {
        const btns = [...document.querySelectorAll('button[aria-label="Show All Notes"]')]
          .filter((b) => b.offsetParent !== null);
        if (!btns.length) return false;
        btns[0].click();
        await new Promise((r) => setTimeout(r, 2500));
        return true;
      });
      if (!opened) return { available: false, addAvailable: false, notes: [] };

      await this.page.waitForTimeout(1500);
      const info = await this.page.evaluate(() => {
        const heading = [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6')]
          .find((n) => (n.textContent || '').trim() === 'Notes' && n.offsetParent !== null);
        if (!heading) return null;
        const drawer = heading.closest('div').parentElement;
        const addAvailable = [...drawer.querySelectorAll('button')]
          .some((b) => /add note/i.test(b.textContent || ''));

        // Anchor each note on its own `.actions` container (the app's class for
        // the per-note control row) and walk up to the ancestor that also holds
        // the "<time> • <date>" byline — that ancestor is the whole card. Picking
        // cards by text alone lands on the inner author block, whose first
        // paragraph is the AUTHOR, not the note title.
        const cards = [];
        for (const actions of drawer.querySelectorAll('.actions')) {
          let node = actions;
          for (let i = 0; i < 6 && node.parentElement; i += 1) {
            node = node.parentElement;
            if (/•/.test(node.innerText || '')) { cards.push(node); break; }
          }
        }
        const notes = cards.map((c, index) => {
          const ps = [...c.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean);
          const bylineIdx = ps.findIndex((t) => /•/.test(t));
          return {
            index,
            title: ps[0] || '',
            author: bylineIdx > 0 ? ps[bylineIdx - 1] : '',
            byline: bylineIdx >= 0 ? ps[bylineIdx] : ''
          };
        });
        return { addAvailable, notes, drawerText: drawer.innerText.slice(0, 400) };
      });
      if (!info) return { available: false, addAvailable: false, notes: [] };

      const mine = (this.actingName || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const notes = info.notes.map((n) => ({
        ...n,
        mine: !!mine && n.author.toLowerCase().includes(mine)
      }));
      return { available: true, addAvailable: info.addAvailable, notes, drawerText: info.drawerText };
    });
  }

  /**
   * Which per-note actions a note offers, classified by ACTIVATING each one and
   * reading what it produces, then dismissing it:
   *   - a "delete this Note?" confirmation → 'delete' (dismissed with "Keep It")
   *   - an inline title/body editor        → 'edit'   (dismissed with "Cancel")
   *   - anything else                      → 'other'
   *
   * Icon-only buttons with no aria-label, title or test id leave no way to tell
   * Edit from Delete by inspection, and getting that backwards would invert the
   * verdict on "Delete: own notes only". Activating and dismissing is read-only:
   * the destructive path needs a second, explicit confirmation which is never
   * pressed — the caller asserts afterwards that the note is still listed.
   *
   * `which`: 'others' (default) picks a note the acting user did not write;
   * 'mine' picks one they did.
   */
  async noteActions(which = 'others') {
    return this._once(`patients:noteActions:${which}`, async () => {
      const drawer = await this.notesDrawer();
      if (!drawer.available || !drawer.notes.length) {
        return { found: false, actions: [], note: null, intact: true };
      }
      const note = which === 'mine'
        ? drawer.notes.find((n) => n.mine)
        : drawer.notes.find((n) => !n.mine);
      if (!note) return { found: false, actions: [], note: null, intact: true };

      const before = drawer.notes.length;
      const actions = [];
      // Cards are addressed by their `.actions` index — the same order the
      // drawer listing used — so hovering and clicking always target the note
      // whose author was actually inspected.
      const count = await this.page.evaluate(async (cardIndex) => {
        const actionRows = [...document.querySelectorAll('.actions')];
        const row = actionRows[cardIndex];
        if (!row) return 0;
        let card = row;
        for (let i = 0; i < 6 && card.parentElement; i += 1) {
          card = card.parentElement;
          if (/•/.test(card.innerText || '')) break;
        }
        card.scrollIntoView({ block: 'center' });
        ['pointerover', 'mouseover', 'mouseenter'].forEach((t) => card.dispatchEvent(new MouseEvent(t, { bubbles: true })));
        await new Promise((r) => setTimeout(r, 900));
        return row.querySelectorAll('button').length;
      }, note.index);

      for (let i = 0; i < count; i += 1) {
        // Re-open the drawer before each probe. Dismissing a delete confirmation
        // (or cancelling an inline edit) tears the drawer's card list down, so a
        // second click against the old DOM finds nothing and would report the
        // remaining actions as absent.
        if (i > 0) {
          this._cache.delete('patients:notes');
          const fresh = await this.notesDrawer();
          if (!fresh.available) break;
        }
        const kind = await this.page.evaluate(async ({ cardIndex, index }) => {
          const actionRows = [...document.querySelectorAll('.actions')];
          const row = actionRows[cardIndex];
          if (!row) return 'gone';
          let card = row;
          for (let i2 = 0; i2 < 6 && card.parentElement; i2 += 1) {
            card = card.parentElement;
            if (/•/.test(card.innerText || '')) break;
          }
          ['pointerover', 'mouseover', 'mouseenter'].forEach((t) => card.dispatchEvent(new MouseEvent(t, { bubbles: true })));
          await new Promise((r) => setTimeout(r, 700));
          const btns = [...row.querySelectorAll('button')];
          if (!btns[index]) return 'gone';
          btns[index].click();
          await new Promise((r) => setTimeout(r, 2000));
          const bodyText = document.body.innerText;
          if (/delete this note/i.test(bodyText)) return 'delete';
          const editing = [...document.querySelectorAll('input,textarea')]
            .some((el) => el.offsetParent !== null && /short, clear title|Write down the details/i.test(el.placeholder || ''));
          if (editing) return 'edit';
          return 'other';
        }, { cardIndex: note.index, index: i });

        actions.push(kind);
        // Always back out — never confirm a delete, never save an edit.
        await this.page.evaluate(async () => {
          const click = (re) => {
            const b = [...document.querySelectorAll('button')]
              .filter((x) => x.offsetParent !== null)
              .find((x) => re.test((x.textContent || '').trim()));
            if (b) { b.click(); return true; }
            return false;
          };
          click(/^Keep It$/i) || click(/^Cancel$/i);
          await new Promise((r) => setTimeout(r, 1200));
        });
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
      }

      // Prove the probe changed nothing.
      this._cache.delete('patients:notes');
      const after = await this.notesDrawer();
      return {
        found: true,
        note,
        actions,
        intact: after.available && after.notes.length === before
      };
    });
  }

  // ---- /invoices ---------------------------------------------------------

  async invoicesSurface() {
    return this._once('invoices:list', async () => {
      const landed = await this.goto('invoices');
      return {
        landed,
        rows: await this.gridRowCount(),
        empty: (await this.waitForGrid(0)).empty,
        buttons: await this.buttons(),
        text: await this.mainText()
      };
    });
  }

  async invoiceRowMenu() {
    return this._once('invoices:rowmenu', async () => {
      await this.goto('invoices');
      const clicked = await this.page.evaluate(() => {
        const row = document.querySelector('.MuiDataGrid-row');
        if (!row) return false;
        const buttons = [...row.querySelectorAll('button')];
        const kebab = buttons[buttons.length - 1];
        if (!kebab) return false;
        kebab.click();
        return true;
      });
      if (!clicked) return [];
      await this.page.waitForTimeout(1200);
      const items = await this.visibleMenuItems();
      await this.dismissMenu();
      return items;
    });
  }

  // ---- The probe dispatcher ----------------------------------------------

  /**
   * Answer one probe descriptor from rbacMatrix's CHECKS table.
   * Returns { present, detail } — never throws; an unreachable surface is
   * reported as `present: false` with the reason in `detail`, because "the app
   * would not even show me the screen" is a legitimate observation.
   */
  async observe(probe) {
    try {
      return await this._observe(probe);
    } catch (err) {
      return { present: false, detail: `probe "${probe.kind}" errored: ${err.message}` };
    }
  }

  async _observe(probe) {
    const has = (buttons, label) => buttons.filter((b) => label.test(b.label));
    // Name the exact row an observation came from — a permission verdict has to
    // be checkable by hand, and "which user was that?" is the first question.
    const who = (row) => (row ? `user ${row.id} ("${row.roles}", ${row.email})` : 'that user\'s');

    switch (probe.kind) {
      case 'nav': {
        const sections = await this.navSections();
        const hit = sections.some((s) => new RegExp(`^${escapeRe(probe.item)}$`, 'i').test(s));
        return { present: hit, detail: hit ? `sidebar offers "${probe.item}"` : `sidebar has no "${probe.item}" (offers: ${sections.join(', ')})` };
      }

      case 'grid': {
        const surface = await this._surfaceFor(probe.path);
        // Read access is proven by the app SERVING the screen — a grid that
        // renders its own empty state still proves the role may look. An empty
        // grid is a data condition; a redirect is the permission denial.
        const ok = surface.landed && (surface.rows > 0 || surface.empty);
        return {
          present: ok,
          detail: !surface.landed
            ? `/${probe.path} redirected away (landed on ${await this.currentPath()})`
            : surface.rows > 0
              ? `/${probe.path} rendered ${surface.rows} row(s)`
              : surface.empty
                ? `/${probe.path} rendered its empty state (readable, no data in range)`
                : `/${probe.path} never rendered a grid`
        };
      }

      case 'button': {
        const surface = await this._surfaceFor(probe.path);
        const hits = has(surface.buttons, probe.label);
        const enabled = hits.filter((h) => !h.disabled);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `/${probe.path} offers "${hits.map((h) => h.label).join('", "')}"${enabled.length ? '' : ' (disabled)'}`
            : `/${probe.path} offers no control matching ${probe.label}`
        };
      }

      case 'roleOption': {
        const roles = await this.creatableRoles();
        if (roles === null) {
          return { present: false, detail: 'the Add New User wizard is not available to this role' };
        }
        const offered = probe.roles.filter((r) => roles.some((o) => o.toLowerCase().includes(r.toLowerCase())));
        return {
          present: offered.length > 0,
          detail: offered.length
            ? `the wizard offers ${offered.join(', ')}`
            : `the wizard offers only [${roles.join(', ')}] — none of ${probe.roles.join(', ')}`
        };
      }

      case 'userRowVisible': {
        const row = await this.findUserRowByRole(probe.roleFilter);
        return {
          present: !!row,
          detail: row
            ? `/users lists ${probe.roleFilter} users (e.g. id ${row.id}, role "${row.roles}")`
            : `/users lists no ${probe.roleFilter} users`
        };
      }

      case 'userRowMenu': {
        const { row, items } = await this.userRowMenu(probe.roleFilter);
        if (!row) return { present: false, detail: `no ${probe.roleFilter} row available to test` };
        const hit = items.some((i) => probe.item.test(i));
        return {
          present: hit,
          detail: `row ${row.id} ("${row.roles}") menu = [${items.join(', ') || 'empty'}]`
        };
      }

      case 'userDetailTab': {
        const detail = await this.userDetails(probe.roleFilter);
        if (!detail.opened) return { present: false, detail: `could not open a ${probe.roleFilter} user's details` };
        const hit = detail.tabs.some((t) => probe.tab.test(t));
        return { present: hit, detail: `${who(detail.row)} details tabs = [${detail.tabs.join(', ')}]` };
      }

      case 'userDetailButton': {
        const detail = await this.userDetails(probe.roleFilter);
        if (!detail.opened) return { present: false, detail: `could not open a ${probe.roleFilter} user's details` };
        const hits = has(detail.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `${who(detail.row)} details offers "${hits.map((h) => h.label).join('", "')}"`
            : `${who(detail.row)} details offers no control matching ${probe.label}`
        };
      }

      case 'clinicRowMenu': {
        const items = await this.clinicRowMenu();
        const hit = items.some((i) => probe.item.test(i));
        return { present: hit, detail: `clinic row menu = [${items.join(', ') || 'empty'}]` };
      }

      case 'clinicDetailButton': {
        const detail = await this.clinicDetail();
        if (!detail.opened) return { present: false, detail: 'could not open a clinic detail page' };
        const hits = has(detail.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `clinic detail offers "${hits.map((h) => h.label).join('", "')}"`
            : 'clinic detail offers no Edit control'
        };
      }

      case 'clinicTab': {
        const detail = await this.clinicDetail();
        if (!detail.opened) return { present: false, detail: 'could not open a clinic detail page' };
        const hit = detail.tabs.some((t) => probe.tab.test(t));
        return { present: hit, detail: `clinic detail tabs = [${detail.tabs.join(', ')}]` };
      }

      case 'clinicTabButton': {
        const surface = await this.clinicTabSurface(probe.tab);
        if (!surface.available) return { present: false, detail: `the clinic "${probe.tab}" tab is not available` };
        const hits = has(surface.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `clinic ${probe.tab} offers "${hits.map((h) => h.label).join('", "')}"`
            : `clinic ${probe.tab} offers no control matching ${probe.label} (controls: ${surface.buttons.map((b) => b.label).join(', ')})`
        };
      }

      case 'clinicMetricsEditable': {
        // Metrics are read-only for every role in the sheet; the only mutating
        // affordance would be an edit control on the metrics view itself.
        const surface = await this.clinicsSurface();
        const hits = has(surface.buttons, /Edit Metrics|Update Metrics/i);
        return { present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled), detail: hits.length ? 'metrics are editable' : 'metrics are read-only' };
      }

      case 'clinicBillingButton': {
        const surface = await this.clinicTabSurface('Billing');
        if (!surface.available) return { present: false, detail: 'the clinic Billing tab is not available' };
        const hits = has(surface.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `clinic Billing offers "${hits.map((h) => h.label).join('", "')}"`
            : `clinic Billing offers no credit-adjustment control (controls: ${surface.buttons.map((b) => b.label).join(', ')})`
        };
      }

      case 'patientTab': {
        const detail = await this.patientDetail();
        if (!detail.opened) return { present: false, detail: 'could not open a patient record' };
        const hit = detail.tabs.some((t) => probe.tab.test(t));
        return { present: hit, detail: `patient record tabs = [${detail.tabs.join(', ')}]` };
      }

      case 'patientTabButton': {
        const surface = await this.patientTabSurface(probe.tab);
        if (!surface.available) return { present: false, detail: `the patient "${probe.tab}" tab is not available` };
        const hits = has(surface.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `patient ${probe.tab} offers "${hits.map((h) => h.label).join('", "')}"`
            : `patient ${probe.tab} offers no control matching ${probe.label} (controls: ${surface.buttons.map((b) => b.label).join(', ')})`
        };
      }

      case 'patientDetailButton': {
        const detail = await this.patientDetail();
        if (!detail.opened) return { present: false, detail: 'could not open a patient record' };
        const hits = has(detail.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `patient record offers "${hits.map((h) => h.label).join('", "')}"`
            : `patient record offers no control matching ${probe.label}`
        };
      }

      case 'patientTabText': {
        const surface = await this.patientTabSurface(probe.tab);
        if (!surface.available) return { present: false, detail: `the patient "${probe.tab}" tab is not available` };
        const hit = probe.pattern.test(surface.text);
        return {
          present: hit,
          detail: hit
            ? `patient ${probe.tab} renders content matching ${probe.pattern}`
            : `patient ${probe.tab} renders nothing matching ${probe.pattern}`
        };
      }

      case 'reportCard': {
        const { landed, cards } = await this.reportCards();
        if (!landed) return { present: false, detail: `/reports redirected away (landed on ${await this.currentPath()})` };
        const hit = cards.some((c) => probe.name.test(c.name));
        return { present: hit, detail: `/reports offers [${cards.map((c) => c.name).join(', ')}]` };
      }

      case 'reportAction': {
        const surface = await this.reportSurface(probe.card);
        if (!surface.available) return { present: false, detail: `the ${probe.card} report is not available to this role` };
        const hits = has(surface.buttons, probe.label);
        return {
          present: hits.length > 0,
          enabled: hits.some((h) => !h.disabled),
          detail: hits.length
            ? `the report offers "${hits.map((h) => h.label).join('", "')}"`
            : `the report offers no generate/download control (controls: ${surface.buttons.map((b) => b.label).join(', ')})`
        };
      }

      case 'invoiceRowMenu': {
        const items = await this.invoiceRowMenu();
        const hit = items.some((i) => probe.item.test(i));
        return { present: hit, detail: `invoice row menu = [${items.join(', ') || 'empty'}]` };
      }

      case 'notesVisible': {
        const drawer = await this.notesDrawer();
        return {
          present: drawer.available,
          detail: drawer.available
            ? `the patient Notes drawer opened and lists ${drawer.notes.length} note(s)`
            : 'no Notes affordance on the patient record for this role'
        };
      }

      case 'notesAdd': {
        const drawer = await this.notesDrawer();
        if (!drawer.available) return { present: false, detail: 'the Notes drawer is not available to this role' };
        return {
          present: drawer.addAvailable,
          detail: drawer.addAvailable
            ? 'the Notes drawer offers "Add Note"'
            : 'the Notes drawer offers no "Add Note" control'
        };
      }

      case 'noteAction': {
        const which = probe.on === 'mine' ? 'mine' : 'others';
        const result = await this.noteActions(which);
        if (!result.found) {
          return {
            present: false,
            detail: which === 'mine'
              ? 'no note authored by the acting user was available to test'
              : "no note authored by another user was available to test"
          };
        }
        const hit = result.actions.includes(probe.action);
        const author = result.note.author || 'unknown author';
        return {
          present: hit,
          detail:
            `note "${result.note.title}" (by ${author}) offers [${result.actions.join(', ') || 'no actions'}]` +
            (result.intact ? '' : ' — WARNING: the note list changed while probing')
        };
      }

      default:
        throw new Error(`unknown probe kind "${probe.kind}"`);
    }
  }

  // ---- internals ---------------------------------------------------------

  /**
   * Clear any leftover search term / filter on /users. The list state is stored
   * per account, so a term left behind by another scenario (or by a human) would
   * silently shrink the grid this sweep reasons about.
   */
  async _clearUsersListState() {
    const search = this.page.locator('input[placeholder^="Search for"]').first();
    if (await this.isVisible(search)) {
      const value = (await search.inputValue().catch(() => '')) || '';
      if (value.trim()) {
        await search.fill('');
        await this.page.waitForTimeout(2500);
      }
    }
    const clearAll = this.page.getByRole('button', { name: /^Clear All$/i }).first();
    if (await this.isVisible(clearAll)) {
      await clearAll.click().catch(() => {});
      await this.page.waitForTimeout(2500);
    }
    await this.waitForGrid();
  }

  async _surfaceFor(path) {
    if (/^clinics$/i.test(path)) return this.clinicsSurface();
    if (/^patients$/i.test(path)) return this.patientsSurface();
    if (/^invoices$/i.test(path)) return this.invoicesSurface();
    if (/^users$/i.test(path)) {
      return this._once('users:surface', async () => {
        const landed = await this.goto('users');
        return { landed, rows: await this.gridRowCount(),
        empty: (await this.waitForGrid(0)).empty, buttons: await this.buttons(), text: await this.mainText() };
      });
    }
    return this._once(`surface:${path}`, async () => {
      const landed = await this.goto(path);
      return { landed, rows: await this.gridRowCount(),
        empty: (await this.waitForGrid(0)).empty, buttons: await this.buttons(), text: await this.mainText() };
    });
  }

  /** Memoise a surface read for the lifetime of the scenario. */
  async _once(key, fn) {
    if (this._cache.has(key)) return this._cache.get(key);
    const value = await fn();
    this._cache.set(key, value);
    return value;
  }

  /** Drop cached observations (e.g. after switching actor). */
  reset(actingEmail = null, actingName = null) {
    this._cache.clear();
    this.actingEmail = actingEmail;
    this.actingName = actingName;
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Loose role matcher for grid rows. "nurse" must also match "NXTSTIM Nurse" and
 * custom nurse roles; "admin" must match any *Admin but NOT "Support Staff";
 * "supervisor" matches Elevated / Regular / Monitoring Supervisor.
 */
function roleRegex(filter) {
  const f = String(filter).toLowerCase();
  if (f === 'admin') return /\badmin\b/i;
  if (f === 'supervisor') return /supervisor/i;
  if (f === 'nurse') return /nurse/i;
  if (f === 'support staff' || f === 'support') return /support\s*staff/i;
  return new RegExp(escapeRe(filter), 'i');
}

module.exports = { PermissionsPage };
