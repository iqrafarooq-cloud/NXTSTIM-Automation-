/**
 * Dev-only probe: drive the REAL AddClinicModal POM through a full create in
 * HEADLESS mode, logging step transitions to locate where the suite hangs.
 *   node scripts/probe-clinic-create.js
 */
require('../features/support/env').loadDotenv();
const { chromium } = require('playwright');
const { AddClinicModal } = require('../features/pages/AddClinicModal');

const BASE = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net';
const EMAIL = process.env.TEST_USER_EMAIL || process.env.BASE_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.BASE_PASSWORD;

async function state(page) {
  return page.evaluate(() => {
    const step = (document.body.innerText.match(/Step\s*(\d)\/3/) || [])[1] || null;
    const btn = document.querySelector('button.add-clinic-modal-confirm-button');
    const phone = document.querySelector('input[placeholder="Enter Number"]');
    return {
      step,
      confirmText: btn ? btn.textContent.trim() : null,
      confirmDisabled: btn ? btn.disabled : null,
      phone: phone ? phone.value : null
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const close = page.locator('div[role="dialog"] button:has-text("Close")').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('input[placeholder="Enter Email"]').fill(EMAIL);
  await page.locator('input[placeholder="Enter Password"]').fill(PASSWORD);
  await page.locator('button:has-text("Log In")').click();
  await page.waitForURL((u) => !/\/login/i.test(u.toString()), { timeout: 20000 });

  await page.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const modal = new AddClinicModal(page);
  const data = AddClinicModal.buildValidClinic();
  console.log('data.profile:', JSON.stringify(data.profile));

  await page.getByRole('button', { name: 'Add Clinic' }).first().click();
  await modal.waitForOpen();
  console.log('opened:', JSON.stringify(await state(page)));

  await modal.fillClinicProfile(data.profile);
  console.log('after fillProfile:', JSON.stringify(await state(page)));
  console.log('field values/validity:', JSON.stringify(await page.evaluate(() => {
    const fields = ['Enter Name', 'Enter Full Name', 'Enter Email', 'Enter Number'];
    const out = {};
    for (const p of fields) {
      const el = document.querySelector(`input[placeholder="${p}"]`);
      out[p] = el ? { value: el.value, ariaInvalid: el.getAttribute('aria-invalid') } : null;
    }
    out.errors = [...document.querySelectorAll('.Mui-error')].map(e => e.textContent.trim()).filter(Boolean);
    return out;
  })));

  // Try blurring every text field, then re-check (touched-validation hypothesis).
  await page.evaluate(() => {
    ['Enter Name', 'Enter Full Name', 'Enter Email'].forEach((p) => {
      const el = document.querySelector(`input[placeholder="${p}"]`);
      if (el) { el.focus(); el.blur(); }
    });
  });
  await page.waitForTimeout(500);
  console.log('after JS-blur all:', JSON.stringify(await state(page)));

  await modal.clickNext();
  console.log('after clickNext#1:', JSON.stringify(await state(page)));

  await modal.fillBillingDetails(data.billing);
  console.log('after fillBilling:', JSON.stringify(await state(page)));

  await modal.clickNext();
  console.log('after clickNext#2:', JSON.stringify(await state(page)));

  await modal.fillShippingDetails(data.shipping);
  console.log('after fillShipping:', JSON.stringify(await state(page)));

  console.log('submitEnabled:', await modal.isSubmitEnabled());
  // Do NOT submit — avoid creating a clinic during diagnosis.
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
