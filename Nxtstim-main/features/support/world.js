const { setWorldConstructor, World } = require('@cucumber/cucumber');

const { LoginPage }          = require('../pages/LoginPage');
const { DashboardPage }      = require('../pages/DashboardPage');
const { SupervisorsPage }    = require('../pages/SupervisorsPage');
const { ForgotPasswordPage } = require('../pages/ForgotPasswordPage');
const { CreatePasswordPage } = require('../pages/CreatePasswordPage');
const { LinkExpiredPage }    = require('../pages/LinkExpiredPage');
const { SettingsPage }       = require('../pages/SettingsPage');
const { ChangePasswordModal } = require('../pages/ChangePasswordModal');
const { AdminUsersPage }     = require('../pages/AdminUsersPage');
const { MfaPage }            = require('../pages/MfaPage');
const { ClinicsPage }        = require('../pages/ClinicsPage');
const { AddClinicModal }     = require('../pages/AddClinicModal');
const { ClinicDetailPage }   = require('../pages/ClinicDetailPage');
const { UsersPage }          = require('../pages/UsersPage');
const { RolesPage }          = require('../pages/RolesPage');
const { PermissionsPage }    = require('../pages/PermissionsPage');

/**
 * CustomWorld — per-scenario context shared across step definitions.
 * Holds the Playwright browser/context/page plus instantiated Page Objects.
 *
 * Multi-tab support
 * -----------------
 * For lifecycle scenarios where the admin and the end-user need to be visible
 * simultaneously (e.g. admin watches a supervisor onboard via the email link
 * in a second tab), tabs are registered by name in `this.tabs` and the active
 * one is rebound to `this.page` + `this.pages` by `switchTo(name)`. Existing
 * step definitions keep working on whichever tab is active — no widespread
 * refactor needed.
 */
class CustomWorld extends World {
  constructor(options) {
    super(options);
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pages = {};
    this.tabs = {};         // name -> Playwright Page
    this.activeTab = null;  // name currently bound to this.page
  }

  /**
   * Build a fresh `pages` map bound to the given Playwright Page. Used both
   * for the initial page (created in hooks Before) and on every switchTo()
   * so all POMs target the active tab.
   */
  buildPagesFor(page) {
    return {
      login:               new LoginPage(page),
      dashboard:           new DashboardPage(page),
      supervisors:         new SupervisorsPage(page),
      forgotPassword:      new ForgotPasswordPage(page),
      createPassword:      new CreatePasswordPage(page),
      linkExpired:         new LinkExpiredPage(page),
      settings:            new SettingsPage(page),
      changePasswordModal: new ChangePasswordModal(page),
      adminUsers:          new AdminUsersPage(page),
      mfa:                 new MfaPage(page),
      clinics:             new ClinicsPage(page),
      addClinic:           new AddClinicModal(page),
      clinicDetail:        new ClinicDetailPage(page),
      users:               new UsersPage(page),
      roles:               new RolesPage(page),
      permissions:         new PermissionsPage(page)
    };
  }

  /**
   * Registers an existing Playwright Page under `name`. If this is the first
   * tab, it also becomes the active tab.
   */
  registerTab(name, page) {
    this.tabs[name] = page;
    if (!this.activeTab) {
      this.activeTab = name;
      this.page = page;
      this.pages = this.buildPagesFor(page);
    }
  }

  /**
   * Opens a brand-new Playwright Page on the same browser context and
   * registers it under `name`. Returns the new Page. Does NOT switch focus —
   * call `switchTo(name)` for that.
   */
  async openTab(name) {
    if (this.tabs[name]) {
      throw new Error(`Tab "${name}" already exists. Use switchTo("${name}") instead.`);
    }
    const page = await this.context.newPage();
    this.registerTab(name, page);
    // registerTab made it active only if it was the first tab; otherwise we
    // still need to explicitly switch the caller to it.
    return page;
  }

  /**
   * Rebinds `this.page` + `this.pages` to the named tab so every existing
   * step definition transparently targets it. Also brings the tab to front
   * so the demo viewer can see the transition.
   */
  async switchTo(name) {
    const page = this.tabs[name];
    if (!page) {
      throw new Error(
        `Unknown tab "${name}". Registered tabs: ${Object.keys(this.tabs).join(', ') || '(none)'}`
      );
    }
    this.activeTab = name;
    this.page = page;
    this.pages = this.buildPagesFor(page);
    try { await page.bringToFront(); } catch { /* not all contexts support it */ }
  }

  /**
   * Closes a tab and removes it from the registry. If the closed tab was
   * active, the active binding is cleared — callers must switchTo() another
   * tab before driving the browser again.
   */
  async closeTab(name) {
    const page = this.tabs[name];
    if (!page) return;
    try { await page.close(); } catch { /* already closed */ }
    delete this.tabs[name];
    if (this.activeTab === name) {
      this.activeTab = null;
      this.page = null;
      this.pages = {};
    }
  }
}

setWorldConstructor(CustomWorld);
