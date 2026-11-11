const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * ClinicDetailPage — Page Object for a single clinic (/clinics/:id).
 *
 * Header shows the clinic id / name / status / contact. Below it a tab strip
 * exposes six sub-sections, each navigable directly via the `selectedTabValue`
 * query param:
 *   Clinic Profile | Supervisor | Nurses | Patient Tags | File Vault | Billing
 *
 * Functional coverage per tab:
 *   - Clinic Profile : read-only info + "Edit Clinic" modal
 *   - Supervisor     : read-only listing (search / sort / export / empty state)
 *   - Nurses         : read-only listing
 *   - Patient Tags   : create ("Add Patient Tag") + delete (row action)
 *   - File Vault     : upload ("Media Upload") + listing
 *   - Billing        : info display, inner tabs, "Edit Billing Information"
 */
class ClinicDetailPage extends BasePage {
  constructor(page) {
    super(page);

    this.baseUrl = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/clinics';

    this.selectors = {
      breadcrumbId: 'main :text-matches("Clinic ID\\\\s*\\\\d+", "i")',
      title: 'main p:has-text("Clinic")',
      statusBadge:
        'main :text-is("Active"), main :text-is("Inactive")',
      tab: (name) =>
        `[role="tab"]:has-text("${name}")`,
      // NB: use text-is("Edit"), NOT has-text — "Credit Log" (a billing inner
      // tab) contains the substring "edit" and would be matched by has-text.
      editButton:
        '[data-testid="clinic-edit"], button.edit-button, main button:text-is("Edit")',

      // ---- Edit Clinic modal ----
      editClinicModal: '[role="dialog"]:has-text("Edit Clinic"), .MuiModal-root:has-text("Edit Clinic")',
      editName: 'input[name="name"]',
      editAddress: 'input[name="address"]',
      editCity: 'input[name="city"]',
      editState: 'input[name="state"]',
      editZip: 'input[name="zipCode"]',
      editContactName: 'input[name="contactFullName"]',
      editContactEmail: 'input[name="contactEmail"]',
      editSaveButton:
        'button:has-text("Save Changes"), ' +
        '.MuiModal-root button:has-text("Save"), ' +
        '[role="dialog"] button:has-text("Save")',
      modalCancelButton:
        '[role="dialog"] button:has-text("Cancel"), .MuiModal-root button:has-text("Cancel")',

      // ---- Patient Tags ----
      addPatientTagButton: 'button:has-text("Add New Patient Tag")',
      tagDialog: '[role="dialog"]:has-text("Add Patient Tag")',
      tagName: 'input[placeholder="Enter Tag Name"]',
      tagDescription: 'input[placeholder="Enter Description"], textarea[placeholder="Enter Description"]',
      saveTagButton: '[role="dialog"] button:has-text("Save Tag")',
      deleteTagDialog: '[role="dialog"]:has-text("delete this tag")',
      deleteConfirmButton: '[role="dialog"] button:has-text("Delete")',
      keepItButton: '[role="dialog"] button:has-text("Keep It")',

      // ---- File Vault ----
      uploadFileButton: 'button:has-text("Upload File")',
      mediaUploadDialog: '[role="dialog"]:has-text("Media Upload")',
      fileInput: 'input[type="file"]',
      uploadConfirmButton: '[role="dialog"] button:has-text("Upload File")',

      // ---- Billing ----
      billingEditModal: '[role="dialog"]:has-text("Edit Billing Information"), .MuiModal-root:has-text("Edit Billing Information")',
      billingSaveButton: '[role="dialog"] button:has-text("Save Changes"), .MuiModal-root button:has-text("Save Changes")',

      // Generic grid + empty state
      gridRow: 'div[role="rowgroup"] [role="row"]',
      emptyState: ':text-matches("Nothing here yet", "i")',
      sortByButton: 'button:has-text("Sort By")',
      exportCsvButton: 'button:has-text("Export CSV")',

      toast: '.notistack-MuiContent, .MuiAlert-message, [role="status"], [role="alert"]'
    };
  }

  // ---- Navigation ----
  async openTabByUrl(clinicId, tabValue) {
    const url = `${this.baseUrl}/${clinicId}?selectedTabValue=${encodeURIComponent(tabValue)}`;
    await this.navigate(url);
    await this.page.waitForTimeout(1500);
  }

  async open(clinicId) {
    await this.navigate(`${this.baseUrl}/${clinicId}`);
    await this.page.waitForTimeout(1500);
  }

  async isOnDetailPage() {
    return /\/clinics\/\d+/i.test(await this.getCurrentUrl());
  }

  async clickTab(name) {
    const tab = this.page.locator(this.selectors.tab(name)).first();
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await tab.click();
    await this.page.waitForTimeout(1000);
  }

  async areAllTabsVisible() {
    const names = ['Clinic Profile', 'Supervisor', 'Nurses', 'Patient Tags', 'File Vault', 'Billing'];
    // The tab strip renders shortly after the detail route resolves; wait for
    // the first tab before probing the rest so this isn't a load-timing race.
    await this.page
      .locator(this.selectors.tab('Clinic Profile'))
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
      .catch(() => {});
    for (const n of names) {
      if (!(await this.isVisible(this.page.locator(this.selectors.tab(n)).first()))) return false;
    }
    return true;
  }

  // ---- Header ----
  async getHeaderText() {
    return (await this.page.locator('main').innerText()) || '';
  }

  async headerContains(text) {
    return (await this.getHeaderText()).includes(text);
  }

  async getStatus() {
    const t = await this.getHeaderText();
    if (/\bInactive\b/.test(t)) return 'Inactive';
    if (/\bActive\b/.test(t)) return 'Active';
    return null;
  }

  // ---- Clinic Profile: Edit ----
  async openEdit() {
    await this.page.locator(this.selectors.editButton).first().click();
    await this.page
      .locator(this.selectors.editClinicModal)
      .first()
      .waitFor({ state: 'visible', timeout: 8000 });
  }

  async isEditModalOpen() {
    return await this.isVisible(this.page.locator(this.selectors.editClinicModal).first());
  }

  async editClinicName(value) {
    await this.type(this.page.locator(this.selectors.editName).first(), value);
    // Commit the change so the form registers it before Save.
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async editContactEmail(value) {
    await this.type(this.page.locator(this.selectors.editContactEmail).first(), value);
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async clearClinicName() {
    const name = this.page.locator(this.selectors.editName).first();
    await name.click();
    await name.press('ControlOrMeta+a');
    await name.press('Delete');
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /**
   * Text of the first inline validation error inside the Edit Clinic modal
   * (empty). Unlike some forms here, Edit Clinic does NOT disable Save on an
   * empty required field — it surfaces an inline ".Mui-error" instead, so
   * negative assertions read this rather than the button state.
   */
  async getEditErrorText() {
    // The first .Mui-error node is often a zero-width-space placeholder; collect
    // all of them and return the concatenated meaningful (letter-bearing) text.
    return await this._collectErrors('[role="dialog"], .MuiModal-root');
  }

  /** Joins all letter-bearing .Mui-error texts within the given container(s). */
  async _collectErrors(scopeSelector) {
    const texts = await this.page
      .locator(`${scopeSelector} .Mui-error`)
      .evaluateAll((els) =>
        els.map((e) => (e.textContent || '').trim()).filter((t) => /[a-z]/i.test(t))
      )
      .catch(() => []);
    return texts.join(' ');
  }

  async isEditSaveEnabled() {
    try {
      return await this.page.locator(this.selectors.editSaveButton).first().isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async saveEdit() {
    await this.page.locator(this.selectors.editSaveButton).first().click();
    await this.page.waitForTimeout(1500);
  }

  async cancelModal() {
    await this.page.locator(this.selectors.modalCancelButton).first().click();
    await this.page.waitForTimeout(500);
  }

  // ---- Patient Tags ----
  async openAddTag() {
    await this.page.locator(this.selectors.addPatientTagButton).first().click();
    await this.page.locator(this.selectors.tagDialog).first().waitFor({ state: 'visible', timeout: 8000 });
  }

  async fillTag({ name, description } = {}) {
    if (name !== undefined) await this.type(this.page.locator(this.selectors.tagName).first(), name);
    if (description !== undefined)
      await this.type(this.page.locator(this.selectors.tagDescription).first(), description);
  }

  async isSaveTagEnabled() {
    try {
      return await this.page.locator(this.selectors.saveTagButton).first().isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async saveTag() {
    await this.page.locator(this.selectors.saveTagButton).first().click();
    await this.page.waitForTimeout(1500);
  }

  async getTagCount() {
    const t = await this.getHeaderText();
    const m = t.match(/(\d+)\s+Patient Tag/i);
    return m ? Number(m[1]) : null;
  }

  async isTagPresent(name, timeout = 6000) {
    const row = this.page.locator(this.selectors.gridRow).filter({ hasText: name }).first();
    try {
      await row.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /** Deletes the tag row and returns the confirmation dialog's warning text. */
  async deleteTag(name) {
    const row = this.page.locator(this.selectors.gridRow).filter({ hasText: name }).first();
    await row.waitFor({ state: 'visible', timeout: 8000 });
    await row.locator('button').last().click();
    const dialog = this.page.locator(this.selectors.deleteTagDialog).first();
    await dialog.waitFor({ state: 'visible', timeout: 8000 });
    const warning = await this.getText(dialog);
    await this.page.locator(this.selectors.deleteConfirmButton).first().click();
    await this.page.waitForTimeout(1500);
    return warning;
  }

  async getDeleteDialogText() {
    return await this.getText(this.page.locator(this.selectors.deleteTagDialog).first());
  }

  // ---- File Vault ----
  async openUpload() {
    await this.page.locator(this.selectors.uploadFileButton).first().click();
    await this.page.locator(this.selectors.mediaUploadDialog).first().waitFor({ state: 'visible', timeout: 8000 });
  }

  async getUploadDialogText() {
    return await this.getText(this.page.locator(this.selectors.mediaUploadDialog).first());
  }

  async chooseFile(filePath) {
    await this.page.locator(this.selectors.fileInput).first().setInputFiles(filePath);
    await this.page.waitForTimeout(800);
  }

  async confirmUpload() {
    await this.page.locator(this.selectors.uploadConfirmButton).first().click();
    await this.page.waitForTimeout(2000);
  }

  async getFileCount() {
    const t = await this.getHeaderText();
    const m = t.match(/(\d+)\s+Files?/i);
    return m ? Number(m[1]) : null;
  }

  async isFilePresent(fileName, timeout = 8000) {
    const row = this.page.locator(this.selectors.gridRow).filter({ hasText: fileName }).first();
    try {
      await row.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Billing ----
  async openBillingEdit() {
    // Target the stable .edit-button class (exact-text fallback). Do NOT use
    // has-text("Edit") — the "Credit Log" billing inner tab contains "edit" and
    // sits earlier in the DOM, so it would be clicked instead of the Edit button.
    const editBtn = this.page
      .locator('button.edit-button:visible, main button:text-is("Edit"):visible')
      .first();
    await editBtn.waitFor({ state: 'visible', timeout: 10000 });
    await editBtn.click();
    await this.page
      .locator(
        ':text-is("Edit Billing Information"), .MuiModal-root:has-text("Edit Billing Information")'
      )
      .first()
      .waitFor({ state: 'visible', timeout: 12000 });
    await this.page.waitForTimeout(500);
  }

  async isBillingEditModalOpen() {
    return await this.isVisible(this.page.locator(this.selectors.billingEditModal).first());
  }

  /**
   * Replaces the Tax ID with real keystrokes and blurs. The billing form only
   * flips "Save Changes" to enabled after a VALID change is committed on blur
   * (fill() alone does not fire the events it needs), so keystrokes + Tab are
   * required — mirrors the Add-Clinic phone quirk.
   */
  async setBillingTaxId(value) {
    const field = this.page.locator('.MuiModal-root input[name="billingDetails.taxId"]').first();
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.press('Delete');
    await field.pressSequentially(String(value), { delay: 25 });
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(400);
  }

  /** Clears the Tax ID (leaves it invalid) to exercise negative validation. */
  async clearBillingTaxId() {
    const field = this.page.locator('.MuiModal-root input[name="billingDetails.taxId"]').first();
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.press('Delete');
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async getBillingErrorText() {
    return await this._collectErrors('.MuiModal-root, [role="dialog"]');
  }

  async isBillingSaveEnabled() {
    try {
      return await this.page.locator(this.selectors.billingSaveButton).first().isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async saveBillingEdit() {
    await this.page.locator(this.selectors.billingSaveButton).first().click();
    await this.page.waitForTimeout(1500);
  }

  async cancelBillingEdit() {
    await this.page.locator('.MuiModal-root button:has-text("Cancel")').first().click();
    await this.page.waitForTimeout(500);
  }

  async billingInfoContains(text) {
    return (await this.getHeaderText()).includes(text);
  }

  async areBillingInnerTabsVisible() {
    const names = ['Billing Information', 'Payments', 'Invoices', 'Credit Log'];
    for (const n of names) {
      if (!(await this.isVisible(this.page.locator(this.selectors.tab(n)).first()))) return false;
    }
    return true;
  }

  /** Whether a single named Billing inner tab is present (they are role="tab"). */
  async isBillingInnerTabVisible(name) {
    return await this.isVisible(this.page.locator(this.selectors.tab(name)).first());
  }

  // ---- Generic listing helpers (Supervisor / Nurses) ----
  async isEmptyStateVisible() {
    return await this.isVisible(this.page.locator(this.selectors.emptyState).first());
  }

  async hasListingControls() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.sortByButton).first())) &&
      (await this.isVisible(this.page.locator(this.selectors.exportCsvButton).first()))
    );
  }

  // ---- Tab-specific controls ----
  // Patient Tags and File Vault are listing tabs too, but they do NOT expose an
  // "Export CSV" button (verified live). Their distinguishing control is the
  // primary action button ("Add New Patient Tag" / "Upload File"), alongside a
  // Sort By control — so they get their own assertions rather than reusing
  // hasListingControls().
  async hasPatientTagsControls() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.sortByButton).first())) &&
      (await this.isVisible(this.page.locator(this.selectors.addPatientTagButton).first()))
    );
  }

  async hasFileVaultControls() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.sortByButton).first())) &&
      (await this.isVisible(this.page.locator(this.selectors.uploadFileButton).first()))
    );
  }

  /** Clinic Profile is a read-only info tab (Clinic Info / Contact Info / Location). */
  async hasClinicProfileInfo() {
    const t = await this.getHeaderText();
    return /Clinic Info/i.test(t) && /Contact Info/i.test(t) && /Location/i.test(t);
  }

  async isEditActionVisible() {
    return await this.isVisible(this.page.locator(this.selectors.editButton).first());
  }

  async waitForToast(matcher, timeout = 8000) {
    const re = matcher instanceof RegExp ? matcher : new RegExp(matcher, 'i');
    const toast = this.page.locator(this.selectors.toast).filter({ hasText: re }).first();
    await toast.waitFor({ state: 'visible', timeout });
    return await toast.textContent();
  }
}

module.exports = { ClinicDetailPage };
