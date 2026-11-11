const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

/**
 * AddClinicModal — Page Object for the 3-step "Add Clinic" wizard opened from
 * the Clinics list.
 *
 *   Step 1/3  Clinic Profile   — name, contact full name, contact email, phone
 *   Step 2/3  Billing Details  — billing email (+ "Same as Clinic Profile"),
 *                                address block, tax status, tax id, subscription
 *   Step 3/3  Shipping Details — shipping email (+ "Same as Billing Details"),
 *                                address block
 *
 * The wizard mounts only the active step's fields, so placeholder-scoped
 * locators are unambiguous. Field placeholders are unique per step; the
 * shared address placeholders never collide because inactive steps unmount.
 *
 * The primary/submit button on the final step carries the stable class hook
 * `.add-clinic-modal-confirm-button`; the header trigger uses `.add-clinic-button`.
 */
class AddClinicModal extends BasePage {
  constructor(page) {
    super(page);

    this.selectors = {
      // Step-1 (Clinic Profile)
      clinicName: 'input[name="name"], input[placeholder="Enter Name"]',
      contactFullName:
        'input[name="contactFullName"], input[placeholder="Enter Full Name"]',
      contactEmail:
        'input[name="contactEmail"], input[placeholder="Enter Email"]',
      phone: 'input[placeholder="Enter Number"], input[type="tel"]',

      // Step-2 (Billing) — billing email + address + tax + subscription
      billingEmail: 'input[placeholder="Enter Billing Email"]',
      sameAsClinicProfile: 'Same as Clinic Profile',
      taxIdInput: 'input[placeholder="Enter Tax ID"]',

      // Step-3 (Shipping)
      shippingEmail: 'input[placeholder="Enter Shipping Email"]',
      sameAsBillingDetails: 'Same as Billing Details',

      // Shared address placeholders (active step only)
      streetAddress: 'input[placeholder="Enter Street Address"]',
      city: 'input[placeholder="Enter City"]',
      state: 'input[placeholder="Enter State"]',
      zipCode: 'input[placeholder="Enter Zip Code"]',

      // Footer buttons.
      // The primary/confirm button is a SINGLE persistent element whose label
      // changes "Next" (steps 1-2) -> "Add Clinic" (step 3). On step 3 there
      // are TWO elements reading "Add Clinic" (the list-header trigger and this
      // confirm button), so it must be targeted by its stable class, never by
      // text. `nextButton` and `submitButton` are therefore the same node.
      confirmButton: 'button.add-clinic-modal-confirm-button',
      nextButton: 'button.add-clinic-modal-confirm-button, button:has-text("Next")',
      submitButton: 'button.add-clinic-modal-confirm-button'
    };

    this.nextButton = page.locator(this.selectors.confirmButton).first();
    this.submitButton = page.locator(this.selectors.confirmButton).first();
  }

  // Left-side step navigator labels, in order. The wizard has NO "Back"
  // button — the only way to return to an earlier step is to click its entry
  // in the side stepper (`.add-clinic-step-container`, whose title carries
  // `cursor: pointer`). Verified live against the preview build.
  static STEP_LABELS = ['Clinic Profile', 'Billing Details', 'Shipping Details'];

  // ---- Presence / step helpers ----
  async waitForOpen() {
    await this.page
      .locator(this.selectors.clinicName)
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async isOpen() {
    return (
      (await this.isVisible(this.page.locator(this.selectors.clinicName).first())) ||
      (await this.isVisible(this.page.locator(this.selectors.billingEmail).first())) ||
      (await this.isVisible(this.page.locator(this.selectors.shippingEmail).first()))
    );
  }

  async getCurrentStep() {
    const text = (await this.page.locator('body').innerText()) || '';
    const m = text.match(/Step\s*(\d)\/3/);
    return m ? Number(m[1]) : null;
  }

  async isNextEnabled() {
    try {
      return await this.nextButton.isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  async isSubmitEnabled() {
    try {
      return await this.submitButton.isEnabled({ timeout: 3000 });
    } catch {
      return false;
    }
  }

  /**
   * Commits the last-edited field. The form (notably the masked phone input)
   * only re-validates and enables the primary button on blur, so an explicit
   * blur is required before asserting/clicking Next.
   */
  async blurActiveField() {
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async clickNext() {
    await this.blurActiveField();
    await this.nextButton.click();
    await this.page.waitForTimeout(600);
  }

  /**
   * Clicks a step in the left-side step navigator by its label. This is the
   * ONLY back-navigation the wizard offers — there is no "Back" button.
   */
  async goToStep(label) {
    const step = this.page
      .locator(
        `.add-clinic-step-container:has(.add-clinic-step-title-container-title:text-is("${label}"))`
      )
      .first();
    await step.click();
    await this.page.waitForTimeout(600);
  }

  /** Returns to the immediately previous step via the side stepper. */
  async clickBack() {
    const current = await this.getCurrentStep();
    const target = AddClinicModal.STEP_LABELS[(current || 2) - 2];
    await this.goToStep(target);
  }

  /** The wizard has no Cancel/X control; Escape dismisses it (no confirm). */
  async close() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(500);
  }

  /**
   * The footer shows "Some data is missing or incorrect..." while the active
   * step is invalid. Used by negative scenarios that assert the step blocks.
   */
  async isValidationSummaryVisible() {
    const msg = this.page
      .locator(':text-matches("Some data is missing or incorrect", "i")')
      .first();
    return await this.isVisible(msg);
  }

  /** Current value shown in the Billing Email field (post "Same as..." copy). */
  async getBillingEmailValue() {
    return await this.page.locator(this.selectors.billingEmail).first().inputValue();
  }

  async submit() {
    await this.blurActiveField();
    try {
      await this.submitButton.click({ timeout: 4000 });
    } catch {
      await this.submitButton.evaluate((el) => el.click());
    }
  }

  // ---- Step 1: Clinic Profile ----
  async fillClinicProfile({ name, contactFullName, contactEmail, phone } = {}) {
    if (name !== undefined) await this.type(this.page.locator(this.selectors.clinicName).first(), name);
    if (contactFullName !== undefined)
      await this.type(this.page.locator(this.selectors.contactFullName).first(), contactFullName);
    if (contactEmail !== undefined)
      await this.type(this.page.locator(this.selectors.contactEmail).first(), contactEmail);
    if (phone !== undefined) await this.enterPhone(phone);
  }

  /**
   * The phone control is an intl-tel masked input pre-seeded with the US
   * country code ("+1"). Two things matter, both confirmed by live probing:
   *
   *   1. fill() does NOT fire the events react-hook-form needs, so the field
   *      never validates and the primary button stays disabled. Real keystrokes
   *      (pressSequentially) are required.
   *   2. The seeded "+1" must be cleared FIRST. Typing national digits on top
   *      of "+1" makes the widget re-parse the leading digits as a country code
   *      (e.g. "3105648721" -> "+31 05 648721", Netherlands). Clearing to a bare
   *      "+" and typing the full E.164 ("1" + national) formats correctly to
   *      "+1 (XXX) XXX-XXXX".
   */
  async enterPhone(national) {
    const digits = String(national).replace(/\D/g, '');
    const e164 = digits.startsWith('1') ? digits : '1' + digits;
    const input = this.page.locator(this.selectors.phone).first();
    await input.click();
    // Select-all + Backspace collapses the seeded value to a bare "+".
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await input.pressSequentially(e164, { delay: 30 });
    // Commit so the form re-validates before Next is asserted/clicked.
    await this.page.keyboard.press('Tab').catch(() => {});
    await this.page.waitForTimeout(200);
  }

  // ---- Step 2: Billing Details ----
  async fillBillingDetails({
    billingEmail,
    sameAsClinicProfile,
    street,
    city,
    state,
    zipCode,
    taxStatus,
    taxId,
    subscriptionPlan
  } = {}) {
    if (sameAsClinicProfile) {
      await this.toggleCheckbox(this.selectors.sameAsClinicProfile);
    } else if (billingEmail !== undefined) {
      await this.type(this.page.locator(this.selectors.billingEmail).first(), billingEmail);
    }
    if (street !== undefined) await this.type(this.page.locator(this.selectors.streetAddress).first(), street);
    if (city !== undefined) await this.type(this.page.locator(this.selectors.city).first(), city);
    if (state !== undefined) await this.type(this.page.locator(this.selectors.state).first(), state);
    if (zipCode !== undefined) await this.type(this.page.locator(this.selectors.zipCode).first(), zipCode);
    if (taxStatus !== undefined) await this.selectTaxStatus(taxStatus);
    if (taxId !== undefined) await this.type(this.page.locator(this.selectors.taxIdInput).first(), taxId);
    if (subscriptionPlan !== undefined) await this.selectSubscriptionPlan(subscriptionPlan);
  }

  async selectTaxStatus(value) {
    // The trigger shows "Select Tax Status" until a value is chosen. Options
    // ("Taxable" / "Exempted") mount in a dedicated dropdown popover.
    const trigger = this.page
      .locator(':text-is("Select Tax Status"), :text-is("Taxable"), :text-is("Exempted")')
      .first();
    await trigger.click();
    const option = this.page
      .locator(
        `.c-multi-select-dropdown-popover :text-is("${value}"), ` +
          `.MuiPopover-root :text-is("${value}"), ` +
          `[role="option"]:has-text("${value}"), li:has-text("${value}")`
      )
      .first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(300);
  }

  async selectSubscriptionPlan(plan) {
    const radio = this.page.getByRole('radio', { name: plan }).first();
    if (await this.isVisible(radio)) {
      await radio.click();
    } else {
      await this.page.locator(`label:has-text("${plan}"), :text-is("${plan}")`).first().click();
    }
  }

  // ---- Step 3: Shipping Details ----
  async fillShippingDetails({ shippingEmail, sameAsBillingDetails, street, city, state, zipCode } = {}) {
    if (sameAsBillingDetails) {
      await this.toggleCheckbox(this.selectors.sameAsBillingDetails);
      return;
    }
    if (shippingEmail !== undefined)
      await this.type(this.page.locator(this.selectors.shippingEmail).first(), shippingEmail);
    if (street !== undefined) await this.type(this.page.locator(this.selectors.streetAddress).first(), street);
    if (city !== undefined) await this.type(this.page.locator(this.selectors.city).first(), city);
    if (state !== undefined) await this.type(this.page.locator(this.selectors.state).first(), state);
    if (zipCode !== undefined) await this.type(this.page.locator(this.selectors.zipCode).first(), zipCode);
  }

  async toggleCheckbox(labelText) {
    const box = this.page.getByRole('checkbox', { name: labelText }).first();
    if (await this.isVisible(box)) {
      await box.click();
      return;
    }
    // Fallback: click the label text that sits next to the checkbox.
    await this.page.locator(`:text-is("${labelText}")`).first().click();
  }

  // ---- End-to-end convenience ----
  /**
   * Drives all three steps with a full clinic payload and submits.
   * `data` mirrors the buildValidClinic() shape below.
   */
  async createClinic(data) {
    await this.waitForOpen();
    await this.fillClinicProfile(data.profile);
    await this.clickNext();
    await this.fillBillingDetails(data.billing);
    await this.clickNext();
    await this.fillShippingDetails(data.shipping);
    await this.submit();
  }

  /**
   * A unique, LETTERS-ONLY token. The Clinic Name field rejects digits
   * ("Only letters, hyphens, apostrophes, or spaces allowed"), so timestamp
   * digits are mapped to letters a-j to keep generated names both unique and
   * valid.
   */
  static uniqueAlpha() {
    return Date.now()
      .toString()
      .split('')
      .map((d) => 'abcdefghij'[Number(d)])
      .join('');
  }

  static buildValidClinic(overrides = {}) {
    const ts = Date.now().toString().slice(-6);
    const name = overrides.name || `QA Clinic ${AddClinicModal.uniqueAlpha()}`;
    return {
      name,
      profile: {
        name,
        contactFullName: 'QA Automation',
        contactEmail: `qa.clinic+${ts}@bytecorp.io`,
        phone: '3105648721'
      },
      billing: {
        billingEmail: `billing+${ts}@bytecorp.io`,
        street: '123 QA Street',
        city: 'San Diego',
        state: 'CA',
        zipCode: '92130',
        taxStatus: 'Taxable',
        subscriptionPlan: 'Free'
      },
      shipping: {
        sameAsBillingDetails: true
      },
      ...overrides
    };
  }
}

module.exports = { AddClinicModal };
