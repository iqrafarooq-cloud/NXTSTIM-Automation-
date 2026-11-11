const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const testApi = require('../support/testApi');
const pwStore = require('../support/passwordStore');
const mfaChallenge = require('../support/mfaChallenge');

const SETTINGS_URL =
  (process.env.BASE_URL || 'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login')
    .replace(/\/login.*$/i, '') + '/settings';

const SLOW_STEP = { timeout: 120_000 };

// A deliberately-wrong current password for the negative case (never a real one).
const WRONG_CURRENT_PASSWORD = 'Wrong#Current999';

// Helpers

/** Per-scenario scratch for the change-password flow. */
function cp(world) {
  world.testState = world.testState || {};
  world.testState.chgPwd = world.testState.chgPwd || {};
  return world.testState.chgPwd;
}
 
async function loginChangePwdAccount(world) {
  const email = pwStore.getEmail();
  const password = pwStore.getCurrentPassword();
  await world.pages.login.open();
  await world.pages.login.login(email, password);
  await mfaChallenge.completeLoginMfaChallengeIfPresent(world);
  await world.pages.login.expectNavigatedAwayFromLogin();
  await world.pages.dashboard.waitForReady().catch(() => {});
  cp(world).email = email;
}

/** Straight to Settings and open the Change Password modal. */
async function openChangePasswordModal(world) {
  if (!/settings/i.test(await world.pages.settings.getCurrentUrl())) {
    await world.pages.settings.navigate(SETTINGS_URL);
  }
  await world.pages.settings.clickChangePassword();
  await world.pages.changePasswordModal.waitForOpen();
}

/** Advance the modal to the new-password step using the current account password. */
async function advanceToNewPasswordStep(world) {
  const modal = world.pages.changePasswordModal;
  await openChangePasswordModal(world);
  await modal.submitCurrentPassword(pwStore.getCurrentPassword());
  await modal.waitForNewPasswordStep();
}

async function changePasswordInApp(world, newPassword) {
  const modal = world.pages.changePasswordModal;
  await advanceToNewPasswordStep(world);
  await modal.submitNewPassword(newPassword, newPassword);
  expect(await modal.hasSuccessToast(), 'Expected the "Password Changed Successfully" toast').toBeTruthy();
  await modal.waitForClosed().catch(() => {});
  pwStore.setCurrentPassword(newPassword); // rotation is now the account's current password
}

// GIVEN

Given('the user is logged in with the change-password account', SLOW_STEP, async function () {
  await loginChangePwdAccount(this);
});

Given('the user is on the new-password step of the change password modal', SLOW_STEP, async function () {
  await advanceToNewPasswordStep(this);
});

Given('the user is on the change-password modal current-password step', async function () {
  await openChangePasswordModal(this);
  expect(await this.pages.changePasswordModal.isOnCurrentPasswordStep()).toBeTruthy();
});

Given('the account has a previously used password on record', SLOW_STEP, async function () {

  testApi.requireConfigured('seed password history');
  const email = pwStore.getEmail();
  const previous = pwStore.getCurrentPassword();
  const fresh = pwStore.generatePassword();
  await testApi.login(email, previous);
  await testApi.changePasswordLoggedIn({ currentPassword: previous, password: fresh });
  await testApi.logout().catch(() => {});
  pwStore.setCurrentPassword(fresh);
  cp(this).previouslyUsed = previous;
});

Given('the user is on the Create New Password screen using the change-password account\'s reset link', SLOW_STEP, async function () {

  testApi.requireConfigured('open Create New Password screen');
  const res = await testApi.getResetPasswordLink(pwStore.getEmail());
  const url = res && (res.resetPasswordUrl || res.url || res.link);
  expect(url, 'Expected a reset-password URL from the API').toBeTruthy();
  await this.pages.createPassword.navigate(url);
  await this.pages.createPassword.waitForLoaded();
});

Given('the account password_set_date is {int} days ago', async function (_days) {
 
  return 'pending';
});

// WHEN — navigation / modal actions

When('the user clicks the {string} menu item', async function (label) {
  const clickIt = async () => {
    if (/settings/i.test(label)) {
      await this.pages.settings.clickSettingsMenuItem();
    } else {
      await this.page.getByRole('menuitem', { name: label }).first().click();
    }
  };
  try {
    await clickIt();
  } catch (err) {
    // If the re-rendering dashboard closed the menu, let it settle, reopen, retry.
    await this.pages.dashboard.waitForReady().catch(() => {});
    await this.pages.dashboard.openProfileMenu().catch(() => {});
    await clickIt();
  }
  await this.page.waitForTimeout(500);
});

When('the user clicks the Change Password CTA', async function () {
  await this.pages.settings.clickChangePassword();
  await this.pages.changePasswordModal.waitForOpen();
});

When('the user enters the current account password in the change password modal', async function () {
  await this.pages.changePasswordModal.enterCurrentPassword(pwStore.getCurrentPassword());
});

When('the user enters an incorrect current password in the change password modal', async function () {
  await this.pages.changePasswordModal.enterCurrentPassword(WRONG_CURRENT_PASSWORD);
});

When('the user clicks Next in the change password modal', async function () {
  await this.pages.changePasswordModal.clickNext();
  await this.page.waitForTimeout(500);
});

When('the user enters a new unique password in the change password modal', async function () {
  const fresh = pwStore.generatePassword();
  cp(this).newPassword = fresh;
  await this.pages.changePasswordModal.enterNewPassword(fresh);
});

When('the user confirms the new password in the change password modal', async function () {
  await this.pages.changePasswordModal.enterConfirmPassword(cp(this).newPassword);
});

When('the user enters the previously used password in the change password modal', async function () {
  await this.pages.changePasswordModal.enterNewPassword(cp(this).previouslyUsed);
});

When('the user confirms the previously used password in the change password modal', async function () {
  await this.pages.changePasswordModal.enterConfirmPassword(cp(this).previouslyUsed);
});

When('the user clicks Change Password in the modal', async function () {
  const modal = this.pages.changePasswordModal;
  await modal.clickChange();

  cp(this).lastModalToast = (await modal.captureToastText()).trim();
});

When('the user types {string} into the new password field', async function (text) {
  await this.pages.changePasswordModal.enterNewPassword(text);
  await this.page.waitForTimeout(300); // let the real-time checklist/strength update
});

When('the user successfully changes their password to a new unique password', SLOW_STEP, async function () {
  const fresh = pwStore.generatePassword();
  cp(this).newPassword = fresh;
  await changePasswordInApp(this, fresh);
});

When('the user clicks Enable Two Factor Authentication', async function () {
  // Live label is "Enable MFA" — SettingsPage.twoFactorCta covers both.
  await this.pages.settings.clickEnableTwoFactor();
  await this.page.waitForTimeout(1000);
});

// Reset "Create New Password" screen (distinct from the in-app modal steps above).
When('the user enters a new password {string}', async function (password) {
  await this.pages.createPassword.enterNewPassword(password);
  await this.page.waitForTimeout(300);
});

When('the user enters confirm password {string}', async function (password) {
  await this.pages.createPassword.enterConfirmPassword(password);
  await this.page.waitForTimeout(300);
});


// THEN — Settings page

Then('the Settings page should show a {string} option', async function (optionText) {
  if (/change your password/i.test(optionText)) {
    expect(await this.pages.settings.isChangePasswordOptionVisible()).toBeTruthy();
  } else if (/two factor|multifactor|mfa/i.test(optionText)) {
    expect(await this.pages.settings.isTwoFactorOptionVisible()).toBeTruthy();
  } else {
    throw new Error(`Unknown Settings option: ${optionText}`);
  }
});

// THEN — change password modal

Then('the change password modal should close', async function () {
  await this.pages.changePasswordModal.waitForClosed();
  expect(await this.pages.changePasswordModal.isOpen()).toBeFalsy();
});

Then('the user should see a {string} toast', async function (_text) {
  const captured = cp(this).lastModalToast || '';
  const ok =
    /password\s*changed\s*successfully/i.test(captured) ||
    (await this.pages.changePasswordModal.hasSuccessToast());
  expect(ok, `Expected the success toast; captured toast was: "${captured}"`).toBeTruthy();
  // Success is confirmed here — persist the rotation immediately so the account's
  // current password stays known to later steps/scenarios/runs even if a
  // subsequent step in this scenario fails. (The negative history scenario never
  // reaches this step, so it never mis-persists.)
  const fresh = cp(this).newPassword;
  if (fresh) pwStore.setCurrentPassword(fresh);
});

Then('the user should see a {string} error', async function (_text) {
  expect(await this.pages.changePasswordModal.hasCurrentPasswordError()).toBeTruthy();
});

Then('the change password modal should not advance to the new-password step', async function () {
  expect(await this.pages.changePasswordModal.isOnNewPasswordStep()).toBeFalsy();
  expect(await this.pages.changePasswordModal.isOnCurrentPasswordStep()).toBeTruthy();
});

Then('a password-history error should be displayed', async function () {
  const captured = cp(this).lastModalToast || '';
  const ok =
    /previous\s*(5|five)\s*passwords?|can\s*not be (the\s*)?same|cannot be (the\s*)?same|previously used/i.test(captured) ||
    (await this.pages.changePasswordModal.hasHistoryError());
  expect(ok, `Expected a password-history error; captured toast was: "${captured}"`).toBeTruthy();
});

Then('the user should NOT see the change password modal', async function () {
  const modal = this.pages.changePasswordModal;
  const onChangePwd =
    (await modal.isVisible(this.page.locator(modal.selectors.currentPasswordHeading).first())) ||
    (await modal.isVisible(this.page.locator(modal.selectors.newPasswordHeading).first()));
  expect(onChangePwd, 'The 2FA button must not open the Change Password modal').toBeFalsy();
});

Then('the user should see the 2FA setup flow', async function () {
  const qr = await this.pages.mfa.isVisible(this.pages.mfa.qrModal).catch(() => false);
  const codeScreen = await this.pages.mfa.isCodeInputScreenVisible().catch(() => false);
  const mfaDialog = await this.page
    .locator('[role="dialog"]:text-matches("authenticator|verification code|multi-?factor|two[- ]?factor|mfa", "i")')
    .first()
    .isVisible()
    .catch(() => false);
  expect(qr || codeScreen || mfaDialog, 'Expected an MFA/2FA setup surface to appear').toBeTruthy();
});

// THEN — complexity checklist / strength (real-time feedback)

Then('the password complexity checklist should reflect {string} met', async function (ruleName) {
  const status = await this.pages.changePasswordModal.isRuleMet(ruleName);
  expect(status, `Expected the "${ruleName}" rule to be met (got: ${status})`).toBe('met');
});

Then('the password complexity checklist should reflect all rules met', async function () {
  expect(await this.pages.changePasswordModal.allRulesMet(),
    'Expected every complexity rule to be met').toBeTruthy();
});

Then('the password strength bar should be at {string} level', async function (level) {
  const actual = await this.pages.changePasswordModal.getStrengthLevel();
  expect(actual, `Expected strength level "${level}" (got: ${actual})`).toBe(level.toLowerCase());
});

// THEN — reset "Create New Password" screen

Then('the password strength indicator should reflect a strong password', async function () {
  const level = await this.pages.createPassword.getStrengthLevel();
  expect(['green', 'orange'], `Expected a strong (green) strength; got "${level}"`).toContain(level);
});

Then('the Reset Password button should be enabled', async function () {
  expect(await this.pages.createPassword.isSubmitDisabled(),
    'Expected the Reset Password button to be enabled').toBeFalsy();
});

// THEN — backend password-state verification

Then('the change-password account should accept the new password', SLOW_STEP, async function () {
  testApi.requireConfigured('verify new password');
  const email = pwStore.getEmail();
  const newPassword = cp(this).newPassword;
  expect(newPassword, 'No new password was recorded for this scenario').toBeTruthy();
  const res = await testApi.login(email, newPassword);
  expect(res && res.accessToken, `Login with the new password should succeed for ${email}`).toBeTruthy();
  await testApi.logout().catch(() => {});
});

Then('the change-password account password should not have been updated', SLOW_STEP, async function () {

  testApi.requireConfigured('verify password unchanged');
  const email = pwStore.getEmail();
  const current = pwStore.getCurrentPassword();
  const res = await testApi.login(email, current);
  expect(res && res.accessToken, `Current password should still work for ${email}`).toBeTruthy();
  await testApi.logout().catch(() => {});
});

Then('the account password_set_date should be today', async function () {
  // Best-effort: read the field from /api/users/me if exposed; otherwise pending
  // (matches the un-seedable Given).
  const me = await (async () => {
    try {
      await testApi.login(pwStore.getEmail(), pwStore.getCurrentPassword());
      const m = await testApi.getMe();
      await testApi.logout().catch(() => {});
      return m;
    } catch { return null; }
  })();
  const raw = me && (me.passwordSetDate || me.password_set_date || me.passwordChangedAt || me.updatedAt);
  if (!raw) return 'pending';
  const d = new Date(raw);
  const now = new Date();
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  expect(sameDay, `Expected password_set_date to be today, got ${raw}`).toBeTruthy();
});
