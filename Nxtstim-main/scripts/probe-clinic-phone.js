/**
 * Dev-only probe: diagnose the Add-Clinic Step-1 phone field in HEADLESS mode.
 * Tries several strategies to fill the intl-tel phone and reports, for each,
 * the resulting input value and whether the primary "Next" button enables.
 *
 *   node scripts/probe-clinic-phone.js
 */
require('../features/support/env').loadDotenv();
const { chromium } = require('playwright');

const BASE = 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net';
const EMAIL = process.env.TEST_USER_EMAIL || process.env.BASE_EMAIL;
const PASSWORD = process.env.TEST_USER_PASSWORD || process.env.BASE_PASSWORD;

async function openWizard(page) {
  await page.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Add Clinic' }).first().click();
  await page.locator('input[placeholder="Enter Name"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input[placeholder="Enter Name"]').first().fill('QA Phone Probe');
  await page.locator('input[placeholder="Enter Full Name"]').first().fill('QA Tester');
  await page.locator('input[placeholder="Enter Email"]').first().fill('qa.probe@bytecorp.io');
}

async function readState(page) {
  return page.evaluate(() => {
    const phone = document.querySelector('input[placeholder="Enter Number"]');
    const next = [...document.querySelectorAll('button.add-clinic-modal-confirm-button')][0];
    return { phone: phone ? phone.value : null, nextDisabled: next ? next.disabled : null };
  });
}

async function resetWizard(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
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

  const phoneSel = 'input[placeholder="Enter Number"]';

  // Strategy A: current POM approach — click, Ctrl+A, Backspace, pressSequentially(30ms), Tab
  await openWizard(page);
  {
    const input = page.locator(phoneSel).first();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await input.pressSequentially('13105648721', { delay: 30 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    console.log('A (clear+pressSeq30+Tab):', JSON.stringify(await readState(page)));
  }
  await resetWizard(page);

  // Strategy B: pressSequentially with larger delay (120ms) to survive re-renders
  await openWizard(page);
  {
    const input = page.locator(phoneSel).first();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await input.pressSequentially('13105648721', { delay: 120 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    console.log('B (clear+pressSeq120+Tab):', JSON.stringify(await readState(page)));
  }
  await resetWizard(page);

  // Strategy C: type national digits WITHOUT clearing (field pre-seeded +1)
  await openWizard(page);
  {
    const input = page.locator(phoneSel).first();
    await input.click();
    await input.pressSequentially('3105648721', { delay: 120 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    console.log('C (noclear+pressSeq120 national):', JSON.stringify(await readState(page)));
  }
  await resetWizard(page);

  // Strategy D: fill() the national digits directly (no clear)
  await openWizard(page);
  {
    const input = page.locator(phoneSel).first();
    await input.fill('3105648721');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    console.log('D (fill national):', JSON.stringify(await readState(page)));
  }
  await resetWizard(page);

  // Strategy E: clear then type national (no country code), 120ms
  await openWizard(page);
  {
    const input = page.locator(phoneSel).first();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    await input.pressSequentially('3105648721', { delay: 120 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    console.log('E (clear+pressSeq120 national):', JSON.stringify(await readState(page)));
  }
  await resetWizard(page);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
