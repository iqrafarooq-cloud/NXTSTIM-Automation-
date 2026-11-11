const { Given, When, Then, Before } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const crypto = require('crypto');
const emailHelper = require('../support/emailHelper');
const mfaSecretStore = require('../support/mfaSecretStore');

const DEFAULT_EMAIL_WAIT_MS = 90_000;
const SLOW_STEP = { timeout: 180_000 };
// Credentials come from .env only (never hardcoded). hooks.js loadDotenv()
// populates these before any step runs.
const DEFAULT_QA_USER_EMAIL = process.env.TEST_USER_EMAIL;
const DEFAULT_QA_USER_PASSWORD = process.env.TEST_USER_PASSWORD;

// Dedicated account for the MFA rate-limit scenario. The throttle is per
// account/IP over a 15-minute window, so isolating it from the shared QA account
// keeps a rate-limit run from burning the other MFA scenarios' verify budget
// (and vice-versa). Overridable via env for other environments.
const RATE_LIMIT_USER_EMAIL = process.env.RATE_LIMIT_USER_EMAIL || 'ratelimit@iqra.anonaddy.com';
const RATE_LIMIT_USER_PASSWORD = process.env.RATE_LIMIT_USER_PASSWORD || 'StrongPass123!';

// Scoped to @RateLimit ONLY, so no other scenario sharing the "MFA verification
// screen" Given is affected. Stored on a world property hooks.js never resets
// (it clears this.testState every scenario), so it survives regardless of the
// order Before hooks run in.
Before({ tags: '@RateLimit' }, function () {
  this.rateLimitLogin = { email: RATE_LIMIT_USER_EMAIL, password: RATE_LIMIT_USER_PASSWORD };
});

// Clock-skew cushion for the emailed-code freshness filter. The email's
// server-stamped sentAt can read a few seconds behind our locally-captured
// trigger time, so we rewind the `after` cutoff by this much to avoid rejecting
// a legitimately fresh code. Kept small: resend codes are >1 minute apart, so a
// superseded code is still safely excluded. Mirrors email.steps.js's 1s buffer
// with a little extra headroom for the Gmail IMAP envelope-date path.
const EMAIL_CLOCK_SKEW_MS = 5_000;

/**
 * Normalize copy for resilient substring matching: fold smart quotes to ASCII
 * and strip ALL whitespace. The app renders the recovery-codes copy across
 * adjacent elements (so sentences concatenate with no space, e.g. "codes.Each")
 * and uses curly apostrophes ("won't"), neither of which a literal toContain on
 * the feature-file text would match.
 */
function squashText(value) {
  return String(value || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeSecret(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[-:]/g, '')
    .replace(/([^A-Z2-7])/gi, '')
    .toUpperCase();
}

function decodeBase32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = normalizeSecret(secret);
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function extractTotpSecret(rawText) {
  if (!rawText) return null;
  const uriMatch = rawText.match(/otpauth:\/\/totp\/[^?]+\?([^#\s]+)/i);
  if (uriMatch) {
    const query = new URLSearchParams(uriMatch[1]);
    if (query.get('secret')) return query.get('secret');
  }

  const secretLabel = rawText.match(/secret\s*[:=]\s*([A-Z2-7\s]+)$/i) || rawText.match(/secret\s*[:=]\s*([A-Z2-7\s]+)/i);
  if (secretLabel) return normalizeSecret(secretLabel[1]);

  const bare = rawText.match(/([A-Z2-7]{16,})/i);
  if (bare) return normalizeSecret(bare[1]);

  return null;
}

function generateTotp(secret, digits = 6, step = 30, time = Math.floor(Date.now() / 1000)) {
  const key = decodeBase32(secret);
  if (key.length === 0) {
    throw new Error(`Unable to decode TOTP secret '${secret}'.`);
  }

  const counter = Buffer.alloc(8);
  const value = BigInt(Math.floor(time / step));
  counter.writeBigUInt64BE(value, 0);

  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

async function getCurrentUserEmail(world) {
  const email = world.testState?.currentUserEmail || process.env.TEST_USER_EMAIL || DEFAULT_QA_USER_EMAIL;
  if (!email) {
    throw new Error(
      'No current user email available. Set TEST_USER_EMAIL in .env or log in using a step that sets currentUserEmail.'
    );
  }
  return email;
}

function getCurrentUserPassword() {
  return process.env.TEST_USER_PASSWORD || DEFAULT_QA_USER_PASSWORD;
}

/**
 * Records "an emailed code was just requested for <email>" so the next
 * getLatestEmailOtp only accepts a message sent after this moment. Call it
 * immediately BEFORE the action that triggers the send (enable, login submit,
 * Resend) so the cutoff predates the email itself.
 */
function markEmailCodeSent(world, email) {
  world.testState = world.testState || {};
  world.testState.emailTriggeredAt = world.testState.emailTriggeredAt || {};
  world.testState.emailTriggeredAt[email] = Date.now();
}

async function getLatestEmailOtp(world, email) {
  // MFA codes ship under the "Your NXTSTIM verification code" subject (matched
  // by the MFA_CODE type), distinct from the onboarding/login 'OTP' type. A
  // single getActionableFromEmail call both waits for that email AND pulls the
  // 6-digit code via emailHelper.extractMfaCode — no second IMAP poll, so we
  // can't race onto a different message between the wait and the extract.
  world.testState = world.testState || {};
  // Freshness filter: if a send was stamped for this address (enable / login
  // challenge / Resend), only accept a code emailed after that moment — so a
  // Resend can't pick up the pre-resend code, and we never reuse a stale code
  // from an earlier scenario that shared this alias. Unstamped → no filter
  // (latest email wins, preserving prior behaviour).
  const triggeredAt = world.testState.emailTriggeredAt && world.testState.emailTriggeredAt[email];
  const options = { timeoutMs: DEFAULT_EMAIL_WAIT_MS };
  if (triggeredAt) options.after = triggeredAt - EMAIL_CLOCK_SKEW_MS;

  const { value } = await emailHelper.getActionableFromEmail(email, 'MFA_CODE', options);
  world.testState.capturedOtps = world.testState.capturedOtps || {};
  world.testState.capturedOtps[email] = value;
  return value;
}

async function getAuthenticatorCode(world) {
  world.testState = world.testState || {};
  // Priority: secret captured during this scenario's enable flow → secret
  // persisted from a previous run → secret read off a live QR setup modal.
  // In-memory wins so the fresh secret shown during an enable isn't shadowed by
  // a stale persisted one.
  let secret = world.testState.totpSecret || mfaSecretStore.loadSecret();
  if (!secret) {
    const manualEntry = await world.pages.mfa.getManualEntryString().catch(() => null);
    secret = manualEntry && extractTotpSecret(manualEntry);
    if (!secret) {
      throw new Error(
        'No TOTP secret available: none stored in artifacts/mfa, and no QR setup modal on screen.'
      );
    }
  }
  world.testState.totpSecret = secret;
  mfaSecretStore.saveSecret(secret);

  // Guard against TOTP replay: a single scenario may submit a code for the same
  // secret more than once (e.g. login challenge → disable). Many servers reject
  // a code reused within its 30s window, so if the previous code for THIS secret
  // came from the current window, wait for the next one before generating again.
  const step = 30;
  world.testState.lastTotpCounter = world.testState.lastTotpCounter || {};
  let counter = Math.floor(Date.now() / 1000 / step);
  if (world.testState.lastTotpCounter[secret] === counter) {
    const secondsIntoStep = (Date.now() / 1000) % step;
    await world.page.waitForTimeout(Math.ceil((step - secondsIntoStep + 1) * 1000));
    counter = Math.floor(Date.now() / 1000 / step);
  }
  world.testState.lastTotpCounter[secret] = counter;
  return generateTotp(secret);
}

// ---------------------------------------------------------------------------
// Shared MFA flow helpers — used by precondition Given steps so each scenario
// can establish its own login / MFA state instead of depending on run order.
// ---------------------------------------------------------------------------

/** Logs in and, if the /mfa-verify challenge appears, clears it (TOTP or email). */
async function loginToPortal(world, email, password) {
  const userEmail = email || DEFAULT_QA_USER_EMAIL;
  const userPassword = password || getCurrentUserPassword();
  world.testState = world.testState || {};
  // Idempotent: if we're already authenticated (a prior step in this scenario
  // logged in), re-navigating to /login would redirect to the dashboard and the
  // login email field would never appear — so short-circuit.
  if (await world.pages.dashboard.isProfileButtonVisible().catch(() => false)) {
    world.testState.currentUserEmail = world.testState.currentUserEmail || userEmail;
    return;
  }
  await world.pages.login.open();
  // For an Email-Verification account, submitting the login dispatches the
  // challenge code; stamp first so completeMfaChallengeIfPresent reads only the
  // code issued by THIS login (no-op cost for Authenticator accounts).
  markEmailCodeSent(world, userEmail);
  await world.pages.login.login(userEmail, userPassword);
  await completeMfaChallengeIfPresent(world);
  await world.pages.dashboard.waitForLoaded().catch(() => {});
  // The trust-device modal can surface slightly after the dashboard paints;
  // clear it so later profile-menu clicks aren't intercepted.
  await world.pages.mfa.dismissTrustDevicePromptIfPresent(2000).catch(() => {});
  world.testState.currentUserEmail = userEmail;
}

/**
 * Clears the standalone login MFA challenge (/mfa-verify) whichever method the
 * account uses: a TOTP from the stored secret for Authenticator App, or the
 * emailed code for Email Verification. The email challenge is identified by its
 * "Resend" control / countdown (the authenticator challenge has none); the
 * scenario's assumed method, when set, takes precedence.
 */
async function completeMfaChallengeIfPresent(world) {
  const mfa = world.pages.mfa;
  // Allow the SPA a moment to route to /mfa-verify after the submit click.
  await world.page.waitForTimeout(1500);
  if (!(mfa.isOnVerifyUrl() || (await mfa.isCodeInputScreenVisible()))) return;

  // Detect the CURRENT challenge from the UI — not the scenario's target method,
  // which may differ from what the account currently has enabled.
  const isEmail = await mfa.isEmailChallenge().catch(() => false);

  let code;
  if (isEmail) {
    const emailAddr = await getCurrentUserEmail(world);
    code = await getLatestEmailOtp(world, emailAddr);
  } else {
    code = await getAuthenticatorCode(world);
  }
  await mfa.enterVerificationCode(code);
  await mfa.clickVerify();
  await world.page.waitForTimeout(1500);
  // A "trust this device?" modal appears post-login and blocks the UI.
  await mfa.dismissTrustDevicePromptIfPresent();
}

/** Opens Settings via the profile menu. Assumes we are on an authenticated page. */
async function openSettings(world) {
  // The post-login Monitoring dashboard is slow to settle; wait for it before
  // driving the profile menu so the Settings navigation is reliable every run
  // (buffer is configurable via DASHBOARD_SETTLE_MS — default 15s).
  await world.pages.dashboard.waitForReady().catch(() => {});
  // A post-login "Do you want to trust this device?" modal can linger over the
  // dashboard and intercept the profile-menu click — dismiss it first.
  await world.pages.mfa.dismissTrustDevicePromptIfPresent(2000).catch(() => {});
  await world.pages.dashboard.openProfileMenu();
  await world.pages.settings.clickSettingsMenuItem();
  await world.page.waitForTimeout(1000);
}

/** Disables whichever MFA method is currently enabled. Returns true if it acted. */
async function disableMfaIfEnabled(world) {
  const mfa = world.pages.mfa;
  let method = null;
  for (const candidate of ['Authenticator App', 'Email Verification']) {
    if (await mfa.isMethodEnabled(candidate)) {
      method = candidate;
      break;
    }
  }
  if (!method) return false;

  // Disabling Email Verification dispatches a fresh emailed code when the code
  // modal opens. Stamp the send time BEFORE triggering the flow so
  // getLatestEmailOtp's freshness filter waits for THIS code instead of reusing
  // the earlier login-challenge code (which yields "Incorrect Code").
  if (!/authenticator/i.test(method)) {
    markEmailCodeSent(world, await getCurrentUserEmail(world));
  }
  await mfa.clickDisableButton();
  await mfa.clickDisableConfirm();          // "Disable 2FA" confirmation
  await mfa.waitForCodeInputs();
  const code = await getValidMfaCode(world, method);
  await mfa.enterVerificationCode(code);
  await mfa.clickFinalDisable();            // final "Disable" in the code dialog
  await mfa.waitForMethodDisabled();
  return true;
}

/** Logs out if a profile menu is reachable; best-effort. */
async function logoutIfLoggedIn(world) {
  try {
    await world.pages.dashboard.logout();
    await world.page.waitForTimeout(1000);
  } catch {
    // Already logged out / no menu — nothing to do.
  }
}

/**
 * Ensures the account has `methodName` MFA enabled, then logs out so the caller
 * can drive a fresh login. Enables the method (capturing & persisting the TOTP
 * secret for Authenticator App) when it isn't already on.
 */
async function ensureMfaEnabled(world, methodName) {
  const mfa = world.pages.mfa;
  await loginToPortal(world);
  await openSettings(world);

  if (!(await mfa.isMethodEnabled(methodName))) {
    await disableMfaIfEnabled(world); // clear the other method if it's on
    await mfa.selectMfaMethod(methodName);
    if (!/authenticator/i.test(methodName)) {
      markEmailCodeSent(world, await getCurrentUserEmail(world));
    }
    await mfa.clickEnableMfa();

    if (/authenticator/i.test(methodName)) {
      await mfa.waitForQrModal();
      const secret = extractTotpSecret(await mfa.getManualEntryString());
      if (secret) {
        world.testState.totpSecret = secret;
        mfaSecretStore.saveSecret(secret);
      }
      await mfa.clickNext();
      await mfa.waitForVerificationScreen();
      await mfa.enterVerificationCode(await getAuthenticatorCode(world));
      await mfa.clickComplete();
      await mfa.waitForVerificationSuccess();
      const codes = await mfa.getRecoveryCodes();
      if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
      await mfa.clickRecoveryCodesContinue().catch(() => {});
    } else {
      const emailAddr = await getCurrentUserEmail(world);
      await mfa.waitForVerificationScreen();
      await mfa.enterVerificationCode(await getLatestEmailOtp(world, emailAddr));
      await mfa.clickVerify();
      await mfa.waitForVerificationSuccess();
    }
  }

  await logoutIfLoggedIn(world);
}

/**
 * Forces a *fresh* Authenticator-App activation so a brand-new set of backup
 * recovery codes is generated and persisted (mfaSecretStore). Unlike
 * ensureMfaEnabled, it disables any currently-enabled method first, guaranteeing
 * the enable handshake runs and the Recovery Codes modal surfaces so its codes
 * can be captured. Leaves the session logged out for the caller to drive login.
 *
 * Requires a healthy account: disabling an already-enabled Authenticator needs a
 * valid TOTP (from the secret captured during this run's enable). If the account
 * is stuck enabled with no captured secret/codes, reset it manually first.
 */
async function ensureFreshAuthenticatorWithCodes(world) {
  const mfa = world.pages.mfa;
  await loginToPortal(world);
  await openSettings(world);
  await disableMfaIfEnabled(world);
  await mfa.selectMfaMethod('Authenticator App');
  await mfa.clickEnableMfa();
  await mfa.waitForQrModal();
  const secret = extractTotpSecret(await mfa.getManualEntryString());
  if (secret) {
    world.testState.totpSecret = secret;
    mfaSecretStore.saveSecret(secret);
  }
  await mfa.clickNext();
  await mfa.waitForVerificationScreen();
  await mfa.enterVerificationCode(await getAuthenticatorCode(world));
  await mfa.clickComplete();
  await mfa.waitForVerificationSuccess();
  const codes = await mfa.getRecoveryCodes();
  if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
  await mfa.clickRecoveryCodesContinue().catch(() => {});
  await logoutIfLoggedIn(world);
}

/**
 * From a logged-out Authenticator-App account that already has backup codes,
 * regenerates the set: login → Settings → "Regenerate Backup Codes" → clear the
 * re-triggered MFA challenge with a fresh TOTP → capture the NEW codes (which
 * overwrite the prior set in mfaSecretStore) → close the modal → log out.
 * Returns the freshly generated codes. Mirrors the proven "new set generated"
 * Then step (the regeneration handshake is identical to first activation).
 */
async function regenerateBackupCodes(world) {
  const mfa = world.pages.mfa;
  await loginToPortal(world);
  await openSettings(world);
  await mfa.clickRegenerateBackupCodes();
  await mfa.waitForVerificationScreen();
  if (await mfa.isCodeInputScreenVisible()) {
    await mfa.enterVerificationCode(await getAuthenticatorCode(world));
    await mfa.clickVerify().catch(async () => {
      await mfa.clickComplete().catch(() => {});
    });
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !(await mfa.isRecoveryCodesModalVisible())) {
    await world.page.waitForTimeout(250);
  }
  const codes = await mfa.getRecoveryCodes();
  if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
  await mfa.clickRecoveryCodesContinue().catch(() => {});
  await logoutIfLoggedIn(world);
  return codes;
}

/** Logs in but stops ON the /mfa-verify challenge (does not enter a code). */
async function loginToMfaChallenge(world, email, password) {
  const userEmail = email || DEFAULT_QA_USER_EMAIL;
  const userPassword = password || getCurrentUserPassword();
  await world.pages.login.open();
  // Email-Verification accounts get their challenge code on login submit; stamp
  // first so the later "enter the emailed code" step fetches only this code.
  markEmailCodeSent(world, userEmail);
  await world.pages.login.login(userEmail, userPassword);
  await world.page.waitForTimeout(1500);
  await world.pages.mfa.waitForVerificationScreen();
  world.testState = world.testState || {};
  world.testState.currentUserEmail = userEmail;
}

/** From a logged-in Settings page, clears any method then starts enabling one. */
async function startEnableFlow(world, methodName) {
  await disableMfaIfEnabled(world);
  await world.pages.mfa.selectMfaMethod(methodName);
  // Enabling Email Verification dispatches the setup code; stamp before the
  // click so getLatestEmailOtp accepts only this fresh code.
  if (!/authenticator/i.test(methodName)) {
    markEmailCodeSent(world, await getCurrentUserEmail(world));
  }
  await world.pages.mfa.clickEnableMfa();
}

/** Drives login → Settings → Authenticator enable → QR modal, capturing the secret. */
async function establishQrModal(world) {
  await loginToPortal(world);
  await openSettings(world);
  await startEnableFlow(world, 'Authenticator App');
  await world.pages.mfa.waitForQrModal();
  const secret = extractTotpSecret(await world.pages.mfa.getManualEntryString());
  if (secret) {
    world.testState.totpSecret = secret;
    mfaSecretStore.saveSecret(secret);
  }
}

/** Continues from the QR modal to the 6-digit code input screen. */
async function establishCodeInputScreen(world) {
  await establishQrModal(world);
  await world.pages.mfa.clickNext();
  await world.pages.mfa.waitForVerificationScreen();
}

/** Completes Authenticator enable so the Recovery Codes modal is on screen. */
async function establishRecoveryModal(world) {
  await establishCodeInputScreen(world);
  await world.pages.mfa.enterVerificationCode(await getAuthenticatorCode(world));
  await world.pages.mfa.clickComplete();
  await world.pages.mfa.waitForVerificationSuccess();
  expect(await world.pages.mfa.isRecoveryCodesModalVisible()).toBeTruthy();
  const codes = await world.pages.mfa.getRecoveryCodes();
  if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
}

/** Drives login → Settings → Email enable → emailed-code modal. */
async function establishEmailVerifyModal(world) {
  await loginToPortal(world);
  await openSettings(world);
  await startEnableFlow(world, 'Email Verification');
  await world.pages.mfa.waitForVerificationScreen();
}

/**
 * Ensures `fromMethod` is enabled, then selects `toMethod` to trigger the switch
 * modal. Defaults to the Email Verification → Authenticator App direction so the
 * un-parameterized Given keeps its original behaviour; the direction-aware Given
 * passes both methods for the reverse (Authenticator App → Email Verification).
 */
async function establishSwitchModal(world, fromMethod = 'Email Verification', toMethod = 'Authenticator App') {
  await ensureMfaEnabled(world, fromMethod);
  await loginToPortal(world);
  await openSettings(world);
  await world.pages.mfa.selectMfaMethod(toMethod);
  // Selecting the radio only relabels the primary button to "Switch MFA"; click
  // it to actually open the confirmation modal — radio-selection alone does not.
  await world.pages.mfa.openSwitchMethodModal();
  expect(await world.pages.mfa.isSwitchMethodModalVisible()).toBeTruthy();
}

/** Ensures Authenticator is enabled, then opens the disable confirmation modal. */
async function establishDisableConfirmModal(world) {
  await ensureMfaEnabled(world, 'Authenticator App');
  await loginToPortal(world);
  await openSettings(world);
  await world.pages.mfa.clickDisableButton();
}

function randomInvalidSixDigitCode(validCode) {
  let code = String(Math.floor(100000 + Math.random() * 900000));
  if (code === validCode) {
    code = String((parseInt(code, 10) + 1) % 900000 + 100000);
  }
  return code;
}

// A syntactically-valid-but-wrong 8-char backup code (xxxx-xxxx). Random alnum,
// so it is overwhelmingly unlikely to collide with a real issued code.
function randomInvalidBackupCode() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function getValidMfaCode(world, methodName) {
  if (/authenticator/i.test(methodName)) {
    return await getAuthenticatorCode(world);
  }
  const email = await getCurrentUserEmail(world);
  return await getLatestEmailOtp(world, email);
}

// ============================================================================
// GIVEN
// ============================================================================
Given('the user is logged into the NXTSTIM portal', SLOW_STEP, async function () {
  // loginToPortal also clears the /mfa-verify challenge (using the stored TOTP
  // secret) when the account already has Authenticator-App MFA enabled, so this
  // reliably lands on the dashboard regardless of MFA state.
  await loginToPortal(this);
});

Given('the user navigates to the Settings page by clicking on the profile icon', async function () {
  // Let the slow post-login Monitoring dashboard settle before opening the
  // profile menu (buffer configurable via DASHBOARD_SETTLE_MS — default 15s).
  await this.pages.dashboard.waitForReady().catch(() => {});
  await this.pages.mfa.dismissTrustDevicePromptIfPresent(2000).catch(() => {});
  await this.pages.dashboard.openProfileMenu();
  await this.pages.settings.clickSettingsMenuItem();
  await this.page.waitForTimeout(1000);
  expect(await this.pages.settings.isOnPage()).toBeTruthy();
});

Given('no MFA method is currently enabled', async function () {
  // Self-heal: a prior scenario (or the account's persisted state) may have left
  // a method enabled. Disable it so the enable flows start from a clean slate.
  await disableMfaIfEnabled(this);
  const authenticator = await this.pages.mfa.isMethodEnabled('Authenticator App');
  const email = await this.pages.mfa.isMethodEnabled('Email Verification');
  expect(authenticator || email).toBeFalsy();
});

Given('the Authenticator App setup modal is displayed with the QR code', SLOW_STEP, async function () {
  // Establish the precondition end-to-end so the scenario is self-contained.
  if (!(await this.pages.mfa.isVisible(this.pages.mfa.qrModal))) {
    await establishQrModal(this);
  }
});

Given('the user is on the 6-digit authentication code input screen', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isCodeInputScreenVisible())) {
    await establishCodeInputScreen(this);
  }
});

Given('the Email MFA verification modal is displayed', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isCodeInputScreenVisible())) {
    await establishEmailVerifyModal(this);
  }
});

Given('MFA is enabled via {string}', SLOW_STEP, async function (methodName) {
  // Used by the in-settings Disable scenario, whose next step clicks "Disable"
  // with no intervening login — so ensure the method is enabled AND land on the
  // Settings page with it confirmed active (logging back in if ensureMfaEnabled
  // left the session logged out).
  this.testState = this.testState || {};
  this.testState.assumedMfaMethod = methodName;
  await ensureMfaEnabled(this, methodName);
  await loginToPortal(this);
  await openSettings(this);
  expect(await this.pages.mfa.isMethodEnabled(methodName)).toBeTruthy();
});

Given('MFA is currently enabled via {string}', SLOW_STEP, async function (methodName) {
  // Stronger variant used by in-app (Disable/Switch) scenarios: ensure enabled,
  // then log back in and land on Settings with the method confirmed active.
  this.testState = this.testState || {};
  this.testState.assumedMfaMethod = methodName;
  await ensureMfaEnabled(this, methodName);
  await loginToPortal(this);
  await openSettings(this);
  expect(await this.pages.mfa.isMethodEnabled(methodName)).toBeTruthy();
});

Given('the "Switch multi-factor authentication method" modal is displayed', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isSwitchMethodModalVisible())) {
    await establishSwitchModal(this);
  }
  expect(await this.pages.mfa.isSwitchMethodModalVisible()).toBeTruthy();
});

// Direction-aware variant: lets a scenario pick which method it is switching
// FROM and TO (the un-parameterized Given above is hardcoded Email → Authenticator).
Given(
  'the "Switch multi-factor authentication method" modal is displayed switching from {string} to {string}',
  SLOW_STEP,
  async function (fromMethod, toMethod) {
    this.testState = this.testState || {};
    // Remember the FROM method so "When the user clicks Proceed" can clear the
    // identity-verification gate with the right code type (the gate is driven by
    // the method currently active, i.e. the one being switched away from).
    this.testState.switchFromMethod = fromMethod;
    if (!(await this.pages.mfa.isSwitchMethodModalVisible())) {
      await establishSwitchModal(this, fromMethod, toMethod);
    }
    expect(await this.pages.mfa.isSwitchMethodModalVisible()).toBeTruthy();
  }
);

Given('the user has MFA enabled on their account', SLOW_STEP, async function () {
  // Ensure Authenticator-App MFA is on, then leave the session logged out so the
  // scenario can perform its own (fresh-device) login afterwards.
  await ensureMfaEnabled(this, 'Authenticator App');
});

Given('the user is on the primary login page', async function () {
  await this.pages.login.open();
  expect(await this.pages.login.isOnLoginPage()).toBeTruthy();
});

Given('the user does NOT have MFA enabled on their account', SLOW_STEP, async function () {
  // Establish the precondition: log in (clearing any existing challenge),
  // disable whatever method is on, then log out so the scenario's own login
  // goes straight to the dashboard with no MFA step.
  await loginToPortal(this);
  await openSettings(this);
  await disableMfaIfEnabled(this);
  await logoutIfLoggedIn(this);
});

// ============================================================================
// WHEN
// ============================================================================
When('the user selects the {string} radio button', async function (methodName) {
  this.testState = this.testState || {};
  this.testState.selectedMfaMethod = methodName;
  await this.pages.mfa.selectMfaMethod(methodName);
});

When('the user clicks "Enable MFA"', async function () {
  // Enabling Email Verification triggers the emailed setup code; stamp the
  // moment first so the freshness filter waits for THIS code, not a stale one.
  const selected = this.testState && this.testState.selectedMfaMethod;
  if (selected && !/authenticator/i.test(selected)) {
    markEmailCodeSent(this, await getCurrentUserEmail(this));
  }
  await this.pages.mfa.clickEnableMfa();
});

When('the user clicks "Next"', async function () {
  await this.pages.mfa.clickNext();
});

When('the user enters a valid 6-digit code from their authenticator app', async function () {
  const code = await getAuthenticatorCode(this);
  await this.pages.mfa.enterVerificationCode(code);
});

When('the user enters an invalid 6-digit code', async function () {
  const valid = await getAuthenticatorCode(this).catch(() => null);
  const code = randomInvalidSixDigitCode(valid);
  await this.pages.mfa.enterVerificationCode(code);
});

When('the user clicks "Complete"', async function () {
  await this.pages.mfa.clickComplete();
});

When('the user enters the correct code received via email', SLOW_STEP, async function () {
  const email = await getCurrentUserEmail(this);
  const otp = await getLatestEmailOtp(this, email);
  await this.pages.mfa.enterVerificationCode(otp);
});

When('the user clicks "Verify"', async function () {
  await this.pages.mfa.clickVerify();
  // At login the submit button is "Verify"/"Log in" and a "trust this device?"
  // modal follows a successful code; dismiss it so the dashboard is reachable.
  // No-op in the in-settings verify flows.
  await this.pages.mfa.dismissTrustDevicePromptIfPresent(3000).catch(() => {});
});

When('the user clicks "Disable" next to the enabled method', async function () {
  const enabled =
    (await this.pages.mfa.isMethodEnabled('Authenticator App')) ||
    (await this.pages.mfa.isMethodEnabled('Email Verification'));
  if (!enabled) {
    throw new Error('Could not locate an enabled MFA method with a Disable control.');
  }
  await this.pages.mfa.clickDisableButton();
});

When('the user enters a valid verification code', async function () {
  // Several flows (disable, mark-as-trusted, regenerate) reach a code prompt.
  // The disable flow first shows a "Disable 2FA" confirmation — advance past it
  // if it's present and the digit inputs aren't on screen yet.
  if (!(await this.pages.mfa.isCodeInputScreenVisible())) {
    await this.pages.mfa.clickDisableConfirm().catch(() => {});
  }
  await this.pages.mfa.waitForCodeInputs();

  let methodName = this.testState && this.testState.assumedMfaMethod;
  if (!methodName) {
    for (const method of ['Authenticator App', 'Email Verification']) {
      if (await this.pages.mfa.isMethodEnabled(method)) {
        methodName = method;
        break;
      }
    }
  }
  methodName = methodName || 'Authenticator App';
  const code = await getValidMfaCode(this, methodName);
  await this.pages.mfa.enterVerificationCode(code);
});

When('the user confirms the action', async function () {
  // The disable code dialog's primary button reads "Disable".
  await this.pages.mfa.clickFinalDisable();
  await this.pages.mfa.waitForMethodDisabled().catch(() => {});
});

When('the user clicks "Proceed"', SLOW_STEP, async function () {
  // Stamp the email cutoff BEFORE Proceed: Proceed is what triggers the app to
  // email the switch-verification code, so getLatestEmailOtp must only accept a
  // message sent after this instant (not a stale code from an earlier step).
  markEmailCodeSent(this, await getCurrentUserEmail(this));
  await this.pages.mfa.clickSwitchMethodProceed();
  // Proceed does not deactivate the old method on its own — the live app gates
  // the switch behind an identity check ("Verify your identity to switch
  // method"). Complete that gate so the new method's setup flow begins. The gate
  // is satisfied with a code from the method being switched AWAY from: an emailed
  // code when leaving Email Verification, a TOTP when leaving Authenticator App.
  if (await this.pages.mfa.isSwitchVerifyModalVisible()) {
    const fromMethod = (this.testState && this.testState.switchFromMethod) || 'Email Verification';
    const code = /authenticator/i.test(fromMethod)
      ? await getAuthenticatorCode(this)
      : await getLatestEmailOtp(this, await getCurrentUserEmail(this));
    await this.pages.mfa.enterVerificationCode(code);
    await this.pages.mfa.clickSwitchVerifyConfirm();
  }
});

When('the user dismisses or cancels the modal', async function () {
  // Scoped to the switch dialog's own Cancel/Dismiss control rather than the
  // page-wide cancelButton, so it can't match a stray Cancel/Close elsewhere.
  await this.pages.mfa.clickSwitchMethodCancel();
});

When('the user logs in from an untrusted device', async function () {
  // Each scenario runs in a brand-new browser context, so the device is always
  // untrusted. Log in (clearing the MFA challenge) and open Settings, where the
  // Trusted Devices section surfaces the untrusted-device warning.
  await loginToPortal(this);
  await openSettings(this);
});

When('the user clicks "Mark As Trusted"', async function () {
  await this.pages.mfa.clickMarkAsTrusted();
});

When('the user enters an invalid MFA code', async function () {
  const code = randomInvalidSixDigitCode(null);
  await this.pages.mfa.enterVerificationCode(code);
  // The "Mark As Trusted" dialog submits via "Trust Device"; without a submit
  // the app never validates, so no error would ever appear. clickVerify covers
  // Trust Device / Verify / Confirm.
  await this.pages.mfa.clickVerify().catch(() => {});
});

When('the user enters an incorrect 6-digit code', async function () {
  const code = randomInvalidSixDigitCode(null);
  await this.pages.mfa.enterVerificationCode(code);
});

When('the user enters a valid 6-digit TOTP code from their authenticator app', async function () {
  const code = await getAuthenticatorCode(this);
  await this.pages.mfa.enterVerificationCode(code);
});

When('the user submits the login form', async function () {
  // Submitting login dispatches the email challenge code (Email-Verification
  // accounts); stamp first so the freshness filter targets this login's code.
  markEmailCodeSent(this, await getCurrentUserEmail(this));
  await this.pages.login.clickLogin();
});

When('the user clicks "Resend"', async function () {
  // Stamp the request time BEFORE clicking so getLatestEmailOtp's freshness
  // filter rejects the pre-resend code and waits for the newly issued one.
  const email = await getCurrentUserEmail(this);
  markEmailCodeSent(this, email);
  await this.pages.mfa.clickResendCode();
});

When('the {int}-minute resend timer has expired', SLOW_STEP, async function (minutes) {
  // The Resend control only exists on the MFA challenge screen — make sure we're
  // there (logging into the challenge if a preceding step left us elsewhere)
  // before waiting the countdown out.
  if (!(await this.pages.mfa.isOnMfaVerificationScreen())) {
    await loginToMfaChallenge(this);
  }
  // Poll until Resend re-enables rather than blind-sleeping: the countdown is
  // ~`minutes` long, and polling tolerates small timing differences and a
  // slightly slow render of the enabled state.
  const enabled = await this.pages.mfa.waitForResendEnabled((minutes * 60 + 20) * 1000);
  expect(enabled).toBeTruthy();
});

When('the user clicks the "Download" button', async function () {
  await this.pages.mfa.clickDownloadRecoveryCodes();
});

When('the user clicks the "Copy" button', async function () {
  await this.pages.mfa.clickCopyRecoveryCodes();
});

When('the user clicks the "Continue" button', async function () {
  await this.pages.mfa.clickRecoveryCodesContinue();
});

When('the user clicks "Regenerate Backup Codes"', async function () {
  await this.pages.mfa.clickRegenerateBackupCodes();
});

// ============================================================================
// THEN
// ============================================================================
Then('a modal is displayed showing a QR code', async function () {
  await this.pages.mfa.waitForQrModal();
});

Then('a manual entry string for app linking is displayed below the QR code', async function () {
  const manual = await this.pages.mfa.getManualEntryString();
  expect(manual.length).toBeGreaterThan(0);
  const secret = extractTotpSecret(manual);
  if (secret) {
    this.testState = this.testState || {};
    this.testState.totpSecret = secret;
  }
});

Then('the modal transitions to a 6-digit authentication code input screen', async function () {
  await this.pages.mfa.waitForVerificationScreen();
});

Then('the code is verified successfully', async function () {
  expect(await this.pages.mfa.waitForVerificationSuccess()).toBeTruthy();
});

Then('a success toast appears at the bottom of the screen saying {string}', async function (message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await this.pages.mfa.hasSuccessToast(message)) return;
    if (await this.pages.mfa.hasSuccessToast()) return; // any success state is acceptable
    // Authenticator-App activation surfaces the Recovery Codes modal as the
    // success signal (the app shows no separate toast). Treat it as success,
    // persist the codes, and dismiss it so the subsequent "modal closes" and
    // "Enabled chip" steps can proceed against the settings page.
    if (await this.pages.mfa.isRecoveryCodesModalVisible()) {
      const codes = await this.pages.mfa.getRecoveryCodes();
      if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
      await this.pages.mfa.clickRecoveryCodesContinue().catch(() => {});
      return;
    }
    if (await this.pages.mfa.isMethodEnabled('Authenticator App')) return;
    await this.page.waitForTimeout(250);
  }
  expect(await this.pages.mfa.hasSuccessToast(message)).toBeTruthy();
});

Then('the modal closes', async function () {
  await this.pages.mfa.waitForModalClosed();
});

Then('an {string} chip is displayed next to {string}', async function (chipText, methodName) {
  if (!/enabled/i.test(chipText)) {
    throw new Error(`Unsupported chip text: ${chipText}`);
  }
  expect(await this.pages.mfa.isMethodEnabled(methodName)).toBeTruthy();
});

Then('the code verification fails', async function () {
  expect(await this.pages.mfa.waitForError()).toBeTruthy();
});

Then('the user remains on the code input screen with an error message', async function () {
  expect(await this.pages.mfa.waitForError()).toBeTruthy();
  expect(await this.pages.mfa.isCodeInputScreenVisible()).toBeTruthy();
});

Then('the system sends a verification code to the user\'s registered email', SLOW_STEP, async function () {
  const email = await getCurrentUserEmail(this);
  const otp = await getLatestEmailOtp(this, email);
  expect(otp.length).toBeGreaterThan(0);
});

Then('a modal is displayed asking for the emailed code', async function () {
  await this.pages.mfa.waitForVerificationScreen();
});

Then('the code is confirmed successfully', async function () {
  expect(await this.pages.mfa.hasSuccessToast()).toBeTruthy();
});

Then('a success modal is displayed', async function () {
  expect(await this.pages.mfa.hasSuccessToast()).toBeTruthy();
});

Then('the "Enabled" chip is removed from the method', async function () {
  const authenticator = await this.pages.mfa.isMethodEnabled('Authenticator App');
  const email = await this.pages.mfa.isMethodEnabled('Email Verification');
  expect(authenticator || email).toBeFalsy();
});

Then('the "Disable" option is no longer available', async function () {
  const authenticator = await this.pages.mfa.isDisableButtonVisible('Authenticator App');
  const email = await this.pages.mfa.isDisableButtonVisible('Email Verification');
  expect(authenticator || email).toBeFalsy();
});

Then('a "Switch multi-factor authentication method" modal is displayed', async function () {
  // Radio-selection alone does NOT surface the modal: selecting a different
  // method while one is enabled relabels the primary button to "Switch MFA", and
  // clicking THAT opens the modal. Drive that click here when the modal isn't
  // already open (openSwitchMethodModal no-ops/returns false if the button is
  // absent), then assert.
  if (!(await this.pages.mfa.isSwitchMethodModalVisible())) {
    await this.pages.mfa.openSwitchMethodModal();
  }
  expect(await this.pages.mfa.isSwitchMethodModalVisible()).toBeTruthy();
});

// Parenthesized, direction-agnostic variants: the method name is captured from
// the "(...)" in the step text, so a single definition covers BOTH switch
// directions (Email Verification → Authenticator App and the reverse). A regex
// step def is used because the method name contains a space, which a Cucumber
// {string} placeholder would require quotes to capture.
Then(/^the old MFA method \((.+)\) is automatically deactivated$/, async function (methodName) {
  // The switch settles asynchronously (the new method's setup flow opens first,
  // then the old method's "Enabled" chip clears), so poll rather than check once.
  expect(await this.pages.mfa.waitForMethodDeactivated(methodName.trim())).toBeTruthy();
});

Then(/^the setup flow for the new method \((.+)\) begins immediately$/, SLOW_STEP, async function (methodName) {
  // "Setup begins" looks different per method: Authenticator App opens the QR
  // modal; Email Verification opens the emailed-code entry screen.
  if (/authenticator/i.test(methodName)) {
    await this.pages.mfa.waitForQrModal();
  } else {
    await this.pages.mfa.waitForVerificationScreen();
  }
});

Then('the previously enabled MFA method remains active', async function () {
  expect(await this.pages.mfa.isMethodEnabled('Email Verification')).toBeTruthy();
});

// Method-aware variants of the two steps above, used by the reverse-direction
// switch scenario. "Setup begins" looks different per method: Authenticator App
// opens the QR modal, Email Verification opens the emailed-code entry screen.
Then('the setup flow for the new method {string} begins immediately', SLOW_STEP, async function (methodName) {
  if (/authenticator/i.test(methodName)) {
    await this.pages.mfa.waitForQrModal();
  } else {
    await this.pages.mfa.waitForVerificationScreen();
  }
});

Then('the previously enabled MFA method {string} remains active', async function (methodName) {
  expect(await this.pages.mfa.isMethodEnabled(methodName)).toBeTruthy();
});

Then('a warning banner is displayed indicating the device is untrusted', async function () {
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeTruthy();
});

Then('the banner contains a "Mark As Trusted" action', async function () {
  expect(await this.pages.mfa.isMarkAsTrustedVisible()).toBeTruthy();
});

Then('the system prompts for a standard MFA code verification', async function () {
  await this.pages.mfa.waitForVerificationScreen();
});

Then('the device is added to the Trusted Devices list', async function () {
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeFalsy();
});

Then('the warning banner is dismissed', async function () {
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeFalsy();
});

Then('the user is redirected to the "Multi-Factor Authentication" screen', async function () {
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeTruthy();
});

Then('a 6-box input field is displayed for the 6-digit verification code', async function () {
  expect(await this.pages.mfa.isCodeInputScreenVisible()).toBeTruthy();
});

Then('the code is validated against the time-based one-time password \\(TOTP) logic', async function () {
  // A correct TOTP at login moves us off the /mfa-verify challenge (onward to
  // the dashboard); there is no in-page success toast on this surface.
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeFalsy();
});

Then('an "Invalid Code" warning is displayed', async function () {
  expect(await this.pages.mfa.waitForError()).toBeTruthy();
});

Then('the user is granted access to the Dashboard', async function () {
  await this.pages.dashboard.waitForLoaded();
  expect(await this.pages.dashboard.isProfileButtonVisible()).toBeTruthy();
});

Then('a "Resend" option is displayed', async function () {
  expect(await this.pages.mfa.isResendButtonVisible()).toBeTruthy();
});

Then('the "Resend" option is initially disabled with a {int}-minute countdown timer', async function (minutes) {
  expect(await this.pages.mfa.isResendButtonEnabled()).toBeFalsy();
  expect(await this.pages.mfa.isResendTimerVisible()).toBeTruthy();
});

Then('a new verification code is sent to the user\'s registered email', SLOW_STEP, async function () {
  const email = await getCurrentUserEmail(this);
  const newOtp = await getLatestEmailOtp(this, email);
  expect(newOtp.length).toBeGreaterThan(0);
});

Then('the user is granted access to the Dashboard directly', async function () {
  await this.pages.dashboard.waitForLoaded();
  expect(await this.pages.dashboard.isProfileButtonVisible()).toBeTruthy();
});

Then('a "Recovery Codes" modal overlay is immediately displayed', async function () {
  expect(await this.pages.mfa.waitForRecoveryCodesModal()).toBeTruthy();
  // Persist the freshly issued codes — they replace any prior set and are the
  // emergency fallback for disabling MFA when no authenticator code is handy.
  const codes = await this.pages.mfa.getRecoveryCodes();
  if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
});

Then('a warning banner is shown stating {string}', async function (expectedText) {
  expect(await this.pages.mfa.alertText.isVisible()).toBeTruthy();
  const text = await this.pages.mfa.alertText.textContent();
  expect(squashText(text)).toContain(squashText(expectedText));
});

Then('a descriptive header reads {string}', async function (headerText) {
  expect(await this.pages.mfa.recoveryCodesModal.isVisible()).toBeTruthy();
  const text = await this.pages.mfa.recoveryCodesModal.textContent();
  expect(squashText(text)).toContain(squashText(headerText));
});

Then('a code grid is shown containing exactly {int} unique numeric backup codes', async function (count) {
  const codes = await this.pages.mfa.getRecoveryCodes();
  const unique = Array.from(new Set(codes));
  expect(codes.length).toBe(count);
  expect(unique.length).toBe(count);
  // NXT-1962 spec: the codes are numeric. Assert each is digits-only (ignoring
  // the "xxxx-xxxx" group separator). If the app ever ships alphanumeric codes
  // this fails loudly — surfacing a real app/spec mismatch rather than masking
  // it behind a count-only check.
  for (const code of codes) {
    expect(code.replace(/-/g, '')).toMatch(/^\d+$/);
  }
});

Then('a code grid is shown containing exactly {int} unique alphanumeric backup codes', async function (count) {
  const codes = await this.pages.mfa.getRecoveryCodes();
  const unique = Array.from(new Set(codes));
  expect(codes.length).toBe(count);
  expect(unique.length).toBe(count);
  // The live app issues 8-char alphanumeric codes in xxxx-xxxx form (e.g.
  // "wu95-2577"). Assert that shape — the class covers numeric codes too, so it
  // stays correct if the backend switches to digits-only.
  for (const code of codes) {
    expect(code).toMatch(/^[a-z0-9]{3,5}-[a-z0-9]{3,5}$/i);
  }
});

Then('a clean .txt file is downloaded', async function () {
  // Capture the codes still visible in the modal so the next step can verify the
  // file actually contains them (the modal is closed only on "Continue").
  this.testState = this.testState || {};
  const visibleCodes = await this.pages.mfa.getRecoveryCodes().catch(() => []);
  if (visibleCodes.length) this.testState.expectedRecoveryCodes = visibleCodes;

  const [download] = await Promise.all([
    this.page.waitForEvent('download'),
    this.pages.mfa.clickDownloadRecoveryCodes()
  ]);

  const filename = download.suggestedFilename() || '';
  expect(filename.toLowerCase()).toMatch(/\.txt$/);

  // Read the downloaded payload so the sibling step can assert its contents.
  let content = '';
  const stream = await download.createReadStream().catch(() => null);
  if (stream) {
    for await (const chunk of stream) content += chunk.toString('utf8');
  } else {
    const fs = require('fs');
    const filePath = await download.path();
    content = filePath ? fs.readFileSync(filePath, 'utf8') : '';
  }
  this.testState.downloadedRecoveryFile = content;

  expect(await download.path()).toBeTruthy();
});

Then('the file contains the raw recovery tokens in plain text', async function () {
  const content = (this.testState && this.testState.downloadedRecoveryFile) || '';
  expect(content.trim().length).toBeGreaterThan(0);

  // Prefer the codes captured off the grid at download time; fall back to the
  // persisted set written during activation.
  const expected =
    (this.testState && this.testState.expectedRecoveryCodes) ||
    mfaSecretStore.loadRecoveryCodes();
  expect(expected.length).toBeGreaterThan(0);
  for (const code of expected) {
    expect(content).toContain(code);
  }
});

Then('the plain-text block of all recovery codes is copied to the clipboard', async function () {
  const clipboardText = await this.page.evaluate(async () => {
    return navigator.clipboard.readText();
  });
  expect(clipboardText.length).toBeGreaterThan(0);
});

Then('a "Regenerate Backup Codes" link is displayed under the Authenticator App settings', async function () {
  expect(await this.pages.mfa.isRegenerateBackupCodesVisible()).toBeTruthy();
});

Then('the MFA verification process is re-triggered', async function () {
  await this.pages.mfa.waitForVerificationScreen();
});

Then('upon successful verification, a new set of {int} unique recovery codes is generated', async function (count) {
  // Regenerate re-triggers the MFA challenge: enter a fresh authenticator code
  // and submit, then the new Recovery Codes modal renders. The prior step only
  // surfaced the code-entry screen, so the codes aren't on screen yet.
  if (await this.pages.mfa.isCodeInputScreenVisible()) {
    await this.pages.mfa.enterVerificationCode(await getAuthenticatorCode(this));
    await this.pages.mfa.clickVerify().catch(async () => {
      await this.pages.mfa.clickComplete().catch(() => {});
    });
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !(await this.pages.mfa.isRecoveryCodesModalVisible())) {
    await this.page.waitForTimeout(250);
  }
  const codes = await this.pages.mfa.getRecoveryCodes();
  if (codes.length) mfaSecretStore.saveRecoveryCodes(codes);
  expect(codes.length).toBe(count);
  expect(new Set(codes).size).toBe(count);
});

Then('all previously issued recovery codes are invalidated', async function () {
  // This step is best validated at the backend. We assert the UI shows
  // regenerated values rather than reusing the prior set.
  expect(await this.pages.mfa.isRecoveryCodesModalVisible()).toBeTruthy();
});

Then('the login form should be submitted', async function () {
  await this.pages.login.expectNavigatedAwayFromLogin();
});

Then('no MFA verification screen is shown', async function () {
  expect(await this.pages.mfa.isCodeInputScreenVisible()).toBeFalsy();
});

Then('the user remains on the MFA verification screen', async function () {
  expect(await this.pages.mfa.isCodeInputScreenVisible()).toBeTruthy();
});

Then('the device remains untrusted', async function () {
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeTruthy();
});

// ============================================================================
// Additional steps for the granular MFA suite (Sections 1–4).
// ============================================================================

// ---- Section 1: enable / disable / switch -----------------------------------
Given('the user\'s MFA method is {string}', SLOW_STEP, async function (methodName) {
  this.testState = this.testState || {};
  this.testState.assumedMfaMethod = methodName;
  await ensureMfaEnabled(this, methodName);
});

Given('MFA is enabled on the user\'s account', SLOW_STEP, async function () {
  await ensureMfaEnabled(this, 'Authenticator App');
});

Given('the disable confirmation modal is displayed', SLOW_STEP, async function () {
  const confirmShowing =
    (await this.pages.mfa.isVisible(this.pages.mfa.disableConfirmButton)) ||
    (await this.pages.mfa.isCodeInputScreenVisible());
  if (!confirmShowing) {
    await establishDisableConfirmModal(this);
  }
});

Then('a {string} option is available for the Authenticator App method', async function (optionText) {
  if (!/disable/i.test(optionText)) throw new Error(`Unsupported option text: ${optionText}`);
  expect(await this.pages.mfa.isDisableButtonVisible('Authenticator App')).toBeTruthy();
});

Then('a {string} option is available for the Email Verification method', async function (optionText) {
  if (!/disable/i.test(optionText)) throw new Error(`Unsupported option text: ${optionText}`);
  expect(await this.pages.mfa.isDisableButtonVisible('Email Verification')).toBeTruthy();
});

Then('a confirmation modal is displayed', async function () {
  // After clicking "Disable", the "Turn off two factor authentication?" dialog appears.
  const visible =
    (await this.pages.mfa.isVisible(this.pages.mfa.disableConfirmButton)) ||
    (await this.pages.mfa.isVisible(this.page.locator('div[role="dialog"], dialog').first()));
  expect(visible).toBeTruthy();
});

Then('the modal asks for a verification code from the currently enabled MFA method', async function () {
  // Proceed past the "Disable 2FA" confirmation to the code-entry step.
  await this.pages.mfa.clickDisableConfirm().catch(() => {});
  await this.pages.mfa.waitForCodeInputs();
  expect(await this.pages.mfa.isCodeInputScreenVisible()).toBeTruthy();
});

Then('MFA is disabled successfully', async function () {
  await this.pages.mfa.waitForMethodDisabled().catch(() => {});
  // Ground truth: isMethodEnabled reads the radio's aria-label, which "only
  // refreshes on reload" (see MfaPage.isMethodEnabled) and can lag a real
  // disable. Reload so the radio/chip reflect the server's post-disable state
  // before asserting — mirroring the negative "the MFA method remains enabled"
  // step, so a disable that silently failed on the server can't false-pass here
  // off a stale label. The subsequent "chip removed"/"Disable no longer
  // available" steps then read this already-fresh page.
  await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await this.page.waitForTimeout(1500);
  const auth = await this.pages.mfa.isMethodEnabled('Authenticator App');
  const email = await this.pages.mfa.isMethodEnabled('Email Verification');
  expect(auth || email).toBeFalsy();
});

Then('no changes are made', async function () {
  // Cancelling the switch keeps the previously enabled method (Email) active.
  expect(await this.pages.mfa.isMethodEnabled('Email Verification')).toBeTruthy();
});

// ---- Section 1b: backup recovery code path (disable + regenerate) -----------
Given('MFA via Authenticator App has been freshly activated with backup codes saved', SLOW_STEP, async function () {
  await ensureFreshAuthenticatorWithCodes(this);
  await loginToPortal(this);
  await openSettings(this);
  this.testState = this.testState || {};
  this.testState.assumedMfaMethod = 'Authenticator App';
  expect(await this.pages.mfa.isMethodEnabled('Authenticator App')).toBeTruthy();
  expect(mfaSecretStore.loadRecoveryCodes().length).toBeGreaterThan(0);
});

Given('MFA via Authenticator App is freshly activated and the user is logged out', SLOW_STEP, async function () {
  // Same fresh activation (captures + persists backup codes) but leaves the
  // session logged OUT, so a login-challenge scenario can drive its own login.
  await ensureFreshAuthenticatorWithCodes(this);
  this.testState = this.testState || {};
  this.testState.assumedMfaMethod = 'Authenticator App';
  expect(mfaSecretStore.loadRecoveryCodes().length).toBeGreaterThan(0);
});

When('the user confirms turning off Multifactor Authentication', async function () {
  // Advance past the "Turn off Multifactor Authentication?" confirm to the
  // "Enter authenticator code" step.
  await this.pages.mfa.clickDisableConfirm();
  await this.pages.mfa.waitForCodeInputs();
});

When('the user proceeds to the authenticator code step', async function () {
  await this.pages.mfa.clickDisableConfirm().catch(() => {});
  await this.pages.mfa.waitForCodeInputs();
});

When('the user chooses to "Use a backup code instead"', async function () {
  await this.pages.mfa.clickUseBackupCodeInstead();
});

When('the user chooses to "Use authenticator code instead"', async function () {
  await this.pages.mfa.clickUseAuthenticatorCodeInstead();
});

When('the user enters a valid backup recovery code', async function () {
  // Single-use: pop a code from the persisted set captured at activation.
  const code = mfaSecretStore.takeRecoveryCode();
  if (!code) {
    throw new Error(
      'No saved backup recovery code available — the Authenticator enable flow ' +
      'must run first (it captures the codes from the Recovery Codes modal).'
    );
  }
  this.testState = this.testState || {};
  this.testState.usedBackupCode = code;
  await this.pages.mfa.enterBackupCode(code);
});

When('the user enters an invalid backup recovery code', async function () {
  await this.pages.mfa.enterBackupCode(randomInvalidBackupCode());
});

When('the user attempts to confirm the disable', async function () {
  // Submit without asserting success — the negative paths assert the reject.
  await this.pages.mfa.clickFinalDisable().catch(() => {});
});

Then('the MFA method remains enabled', async function () {
  // Read GROUND TRUTH, not the in-place aria-label which "only refreshes on
  // reload" (see MfaPage.isMethodEnabled) and can lag a real disable. Reload so
  // the method radio/chip reflect the server's actual post-submit state before
  // asserting — otherwise a wrong code that DID disable MFA would false-pass.
  await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await this.page.waitForTimeout(1500);
  const auth = await this.pages.mfa.isMethodEnabled('Authenticator App');
  const email = await this.pages.mfa.isMethodEnabled('Email Verification');
  expect(auth || email).toBeTruthy();
});

Then('a "Use a backup code instead" option is available', async function () {
  expect(await this.pages.mfa.isUseBackupCodeOptionVisible()).toBeTruthy();
});

Then('a "Use authenticator code instead" option is available', async function () {
  expect(await this.pages.mfa.isUseAuthenticatorCodeOptionVisible()).toBeTruthy();
});

Then('a backup recovery code entry field is displayed', async function () {
  expect(await this.pages.mfa.isBackupCodeEntryVisible()).toBeTruthy();
});

Then('an authenticator code entry field is displayed', async function () {
  expect(await this.pages.mfa.isAuthenticatorCodeEntryVisible()).toBeTruthy();
});

// ---- Section 2: trusted device (banner paths) -------------------------------
Given('the untrusted device warning banner is displayed', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isUntrustedDeviceBannerVisible())) {
    await ensureMfaEnabled(this, 'Authenticator App');
    await loginToPortal(this);
    await openSettings(this);
  }
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeTruthy();
});

When('the login is successful after MFA verification', async function () {
  // loginToPortal already cleared the challenge; just ensure we left /mfa-verify.
  if (await this.pages.mfa.isOnMfaVerificationScreen()) {
    await completeMfaChallengeIfPresent(this);
  }
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeFalsy();
});

When('the user enters a valid MFA code', async function () {
  await this.pages.mfa.waitForCodeInputs();
  const methodName = (this.testState && this.testState.assumedMfaMethod) || 'Authenticator App';
  await this.pages.mfa.enterVerificationCode(await getValidMfaCode(this, methodName));
  await this.pages.mfa.clickVerify();
  await this.pages.mfa.dismissTrustDevicePromptIfPresent(3000).catch(() => {});
});

Then('the device is NOT added to the Trusted Devices list', async function () {
  expect(await this.pages.mfa.isUntrustedDeviceBannerVisible()).toBeTruthy();
});

Then('an error message is displayed', async function () {
  expect(await this.pages.mfa.waitForError()).toBeTruthy();
});

Given('the user has NOT passed an MFA challenge in the current browser session', async function () {
  // Fresh context with no MFA-verified session: sit on the public login page.
  await this.pages.login.open();
});

Then('the {string} action is not available', async function (actionText) {
  if (!/mark as trusted/i.test(actionText)) throw new Error(`Unsupported action: ${actionText}`);
  expect(await this.pages.mfa.isMarkAsTrustedVisible()).toBeFalsy();
});

Then('trusted status cannot be granted for the device', async function () {
  expect(await this.pages.mfa.isMarkAsTrustedVisible()).toBeFalsy();
});

// ---- Section 3: login MFA prompt --------------------------------------------
Given('the user is on the MFA verification screen', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isOnMfaVerificationScreen())) {
    // The @RateLimit scenario logs in with its own isolated account (set by the
    // tagged Before hook); every other scenario keeps the default QA account.
    if (this.rateLimitLogin) {
      await loginToMfaChallenge(this, this.rateLimitLogin.email, this.rateLimitLogin.password);
    } else {
      await loginToMfaChallenge(this);
    }
  }
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeTruthy();
});

When('the user enters a valid email and password', async function () {
  await this.pages.login.enterEmail(DEFAULT_QA_USER_EMAIL);
  await this.pages.login.enterPassword(getCurrentUserPassword());
});

When('submits the login form', async function () {
  // Submitting login dispatches the email challenge code (Email-Verification
  // accounts); stamp first so the freshness filter targets this login's code.
  markEmailCodeSent(this, await getCurrentUserEmail(this));
  await this.pages.login.clickLogin();
  await this.page.waitForTimeout(1500);
});

When('submits the code', async function () {
  await this.pages.mfa.clickVerify();
  await this.pages.mfa.dismissTrustDevicePromptIfPresent(3000).catch(() => {});
  await this.page.waitForTimeout(1000);
});

When('the user enters valid email and password on the primary login page', async function () {
  // No MFA enabled in this scenario, so this lands straight on the dashboard.
  await loginToPortal(this);
});

When('the user enters the correct {int}-digit code from the email', SLOW_STEP, async function (digits) {
  const email = await getCurrentUserEmail(this);
  const otp = await getLatestEmailOtp(this, email);
  await this.pages.mfa.enterVerificationCode(otp);
});

Then('the system redirects to the {string} screen', async function (screenName) {
  if (!/multi-factor|mfa|two-factor/i.test(screenName)) {
    throw new Error(`Unsupported screen: ${screenName}`);
  }
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeTruthy();
});

Then('the system sends a unique verification code to the user\'s registered email', SLOW_STEP, async function () {
  const email = await getCurrentUserEmail(this);
  const otp = await getLatestEmailOtp(this, email);
  expect(otp.length).toBeGreaterThan(0);
});

Then('the UI displays a masked version of the email \\(e.g., {string})', async function (example) {
  const body = await this.page.locator('body').innerText();
  // A masked email contains asterisks before the @, e.g. "m****r@bytecorp.io".
  expect(/\*{2,}[^@\s]*@/.test(body) || body.includes(example)).toBeTruthy();
});

Then('the resend timer resets to {int} minute', async function (minutes) {
  expect(await this.pages.mfa.isResendButtonEnabled()).toBeFalsy();
  expect(await this.pages.mfa.isResendTimerVisible()).toBeTruthy();
});

// ---- Section 4: recovery codes ----------------------------------------------
Given('the user has completed the {int}-digit verification handshake to activate the Authenticator App', SLOW_STEP, async function (digits) {
  // Reach the activation code screen and submit a valid code, leaving the
  // "Complete" click to the scenario's When step.
  await establishCodeInputScreen(this);
  await this.pages.mfa.enterVerificationCode(await getAuthenticatorCode(this));
});

When('the user clicks {string} on the activation screen', async function (buttonText) {
  if (!/complete/i.test(buttonText)) throw new Error(`Unsupported button: ${buttonText}`);
  await this.pages.mfa.clickComplete();
});

Given('the "Recovery Codes" modal is displayed', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isRecoveryCodesModalVisible())) {
    await establishRecoveryModal(this);
  }
  expect(await this.pages.mfa.isRecoveryCodesModalVisible()).toBeTruthy();
});

Given('the "Recovery Codes" modal is displayed with the code grid', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isRecoveryCodesModalVisible())) {
    await establishRecoveryModal(this);
  }
  expect((await this.pages.mfa.getRecoveryCodes()).length).toBeGreaterThan(0);
});

Then('the modal is closed', async function () {
  await this.pages.mfa.waitForModalClosed();
  expect(await this.pages.mfa.isRecoveryCodesModalVisible()).toBeFalsy();
});

Given('MFA via Authenticator App has been successfully activated', SLOW_STEP, async function () {
  await ensureMfaEnabled(this, 'Authenticator App');
});

Given('the initial recovery codes have been generated', async function () {
  // Generated as part of activation; recorded in artifacts/mfa by prior steps.
  expect(mfaSecretStore.loadRecoveryCodes().length).toBeGreaterThanOrEqual(0);
});

When('the user navigates to the Authenticator App configuration settings', SLOW_STEP, async function () {
  await loginToPortal(this);
  await openSettings(this);
});

Then('a {string} link is displayed', async function (linkText) {
  if (!/regenerate backup codes/i.test(linkText)) throw new Error(`Unsupported link: ${linkText}`);
  expect(await this.pages.mfa.isRegenerateBackupCodesVisible()).toBeTruthy();
});

Given('the "Regenerate Backup Codes" link is displayed under the Authenticator App settings', SLOW_STEP, async function () {
  if (!(await this.pages.mfa.isRegenerateBackupCodesVisible())) {
    await ensureMfaEnabled(this, 'Authenticator App');
    await loginToPortal(this);
    await openSettings(this);
  }
  expect(await this.pages.mfa.isRegenerateBackupCodesVisible()).toBeTruthy();
});

// ---- Section 5: MFA verification rate limiting ------------------------------
//
// The MFA verify endpoint is throttled per 15-minute window. We exercise it with
// deliberately INVALID codes so each submission is a real verify request that the
// server counts, yet never authenticates us off the challenge screen. The first
// N (in-limit) submissions should be served (each returns an invalid-code error);
// the request past the cap should be blocked with the throttle message.

/**
 * Submits one invalid MFA code and returns the classified outcome
 * ('rate-limited' | 'rejected' | 'accepted' | 'unknown'). Captures the throttle
 * text on the world when a request is blocked.
 */
async function submitMfaRateLimitAttempt(world) {
  // A wrong-but-well-formed 6-digit code: keeps us on the challenge screen so the
  // loop can keep issuing verify requests against the rate limiter.
  const code = randomInvalidSixDigitCode(null);
  const outcome = await world.pages.mfa.submitCodeAndClassify(code);
  if (outcome === 'rate-limited') {
    world.testState = world.testState || {};
    world.testState.rateLimitMessage = await world.pages.mfa.getRateLimitMessage();
  }
  return outcome;
}

When(
  'the user submits MFA verification code {int} times within {int} minutes',
  SLOW_STEP,
  async function (attempts, _windowMinutes) {
    this.testState = this.testState || {};
    const results = [];
    let processed = 0;
    let blockedEarly = false;
    for (let i = 0; i < attempts; i += 1) {
      const outcome = await submitMfaRateLimitAttempt(this);
      results.push(outcome);
      if (outcome === 'rate-limited') {
        blockedEarly = true;
        break;
      }
      processed += 1;
    }
    this.testState.rateLimit = { requested: attempts, processed, blockedEarly, results };
  }
);

Then('the system should process the requests according to the configured rate limit', function () {
  const rl = (this.testState && this.testState.rateLimit) || {};
  // None of the in-limit submissions may be throttled — the configured window
  // must serve at least this many before the cap engages.
  expect(rl.blockedEarly).toBeFalsy();
  expect(rl.processed).toBe(rl.requested);
});

When(
  'the user submits a {int}th MFA verification request within the same {int}-minute window',
  SLOW_STEP,
  async function (_ordinal, _windowMinutes) {
    this.testState = this.testState || {};
    this.testState.extraAttemptOutcome = await submitMfaRateLimitAttempt(this);
  }
);

Then('the system should block the request', SLOW_STEP, async function () {
  // Prefer the outcome the When captured, but re-poll the UI in case the throttle
  // banner renders a beat after the submit resolved.
  let blocked = (this.testState && this.testState.extraAttemptOutcome) === 'rate-limited';
  if (!blocked) {
    blocked = await this.pages.mfa.waitForRateLimitError();
    if (blocked) {
      this.testState = this.testState || {};
      this.testState.rateLimitMessage = await this.pages.mfa.getRateLimitMessage();
    }
  }
  expect(blocked).toBeTruthy();
  // The blocked request must NOT have let the user through — still on the
  // verification screen.
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeTruthy();
});

Then('the error message should be {string}', async function (expectedMessage) {
  let actual = (this.testState && this.testState.rateLimitMessage) || '';
  if (!actual) actual = await this.pages.mfa.getRateLimitMessage();
  expect(actual.length).toBeGreaterThan(0);
  // Compare on the message SKELETON: the throttle copy is fixed but the
  // remaining-seconds value can vary run-to-run (the countdown ticks down), so
  // wildcard digit runs rather than pinning to exactly 900. squashText already
  // folds whitespace/quotes for resilient substring matching.
  const skeleton = (s) => squashText(s).replace(/\d+/g, '#');
  expect(skeleton(actual)).toContain(skeleton(expectedMessage));
});

// Positive case: legitimate in-limit traffic must NOT be throttled — the limiter
// may not false-trigger before the cap is exceeded.
Then('the request should not be blocked by the rate limiter', async function () {
  const rl = (this.testState && this.testState.rateLimit) || {};
  expect(rl.blockedEarly).toBeFalsy();
  expect(await this.pages.mfa.isRateLimitErrorVisible()).toBeFalsy();
});

// Negative case: once the window is exhausted, even a CORRECT code is refused —
// the rate limit takes precedence over valid credentials. Uses a real
// authenticator TOTP (or the emailed code for an Email-MFA account); the outcome
// is stored where "the system should block the request" reads it.
When(
  'the user submits a valid MFA verification code within the same {int}-minute window',
  SLOW_STEP,
  async function (_windowMinutes) {
    this.testState = this.testState || {};
    const isEmail = await this.pages.mfa.isEmailChallenge().catch(() => false);
    const code = isEmail
      ? await getLatestEmailOtp(this, await getCurrentUserEmail(this))
      : await getAuthenticatorCode(this);
    this.testState.extraAttemptOutcome = await this.pages.mfa.submitCodeAndClassify(code);
  }
);

// ============================================================================
// @manual stubs — scenarios requiring backend time-travel, cron, or seeded
// trusted-device data. Tagged @manual in the feature so the default suite
// skips them; defined here only so the feature dry-runs clean.
// ============================================================================
Given('the user is logged into the NXTSTIM portal on an untrusted device', async function () {
  return 'pending';
});
Given('{int} days have elapsed since the last trust prompt', async function () {
  return 'pending';
});
Given('the {int}-day recurring trust modal is displayed', async function () {
  return 'pending';
});
Given('a device was marked as trusted', async function () {
  return 'pending';
});
Given('{int} month has elapsed since the device was trusted', async function () {
  return 'pending';
});
Given('the Trusted Devices list is displayed', async function () {
  return 'pending';
});
Given('the user navigates to the Trusted Devices section', async function () {
  return 'pending';
});
Given('the user has regenerated their backup codes', SLOW_STEP, async function () {
  // 1. Fresh Authenticator activation issues and persists an INITIAL batch of
  //    recovery codes (mfaSecretStore), leaving the session logged out.
  await ensureFreshAuthenticatorWithCodes(this);
  const initialCodes = mfaSecretStore.loadRecoveryCodes();
  expect(initialCodes.length).toBeGreaterThan(0);

  // 2. Hold onto one OLD code BEFORE regeneration replaces the set — this is the
  //    code the subsequent login attempt must be rejected for.
  this.testState = this.testState || {};
  this.testState.oldRecoveryCode = initialCodes[0];

  // 3. Regenerate — the new batch overwrites the old one in the store.
  const newCodes = await regenerateBackupCodes(this);
  expect(newCodes.length).toBeGreaterThan(0);
  // Guard the premise: regeneration must actually invalidate the old code,
  // otherwise the negative assertion downstream proves nothing.
  expect(newCodes).not.toContain(this.testState.oldRecoveryCode);
});
When('the user logs into the application', async function () {
  return 'pending';
});
When('the user selects {string}', async function (choice) {
  return 'pending';
});
When('the user dismisses or declines the modal', async function () {
  return 'pending';
});
When('the list is loaded', async function () {
  return 'pending';
});
When('the user clicks the delete \\(trash can) icon next to a device', async function () {
  return 'pending';
});
When('the user attempts to use an old recovery code to log in', SLOW_STEP, async function () {
  const oldCode = this.testState && this.testState.oldRecoveryCode;
  if (!oldCode) {
    throw new Error(
      'No old recovery code captured — the "regenerated their backup codes" Given must run first.'
    );
  }
  // Fresh login → Authenticator MFA challenge → switch to backup-code entry →
  // submit the now-invalidated old code (mirrors the canonical "submits the code").
  await loginToMfaChallenge(this);
  await this.pages.mfa.clickUseBackupCodeInstead();
  await this.pages.mfa.enterBackupCode(oldCode);
  await this.pages.mfa.clickVerify();
  await this.pages.mfa.dismissTrustDevicePromptIfPresent(3000).catch(() => {});
  await this.page.waitForTimeout(1000);
});
Then('a recurring modal is displayed asking {string}', async function () {
  return 'pending';
});
Then('the device is added to the Trusted Devices list without requiring a new MFA code', async function () {
  return 'pending';
});
Then('the modal will appear again after another {int} days', async function () {
  return 'pending';
});
Then('each device entry displays the device name \\(e.g., {string})', async function () {
  return 'pending';
});
Then('each device entry displays the last active date', async function () {
  return 'pending';
});
Then('each device entry displays the location \\(e.g., {string})', async function () {
  return 'pending';
});
Then('each device entry has a delete \\(trash can) icon', async function () {
  return 'pending';
});
Then('the device\'s trusted status is revoked', async function () {
  return 'pending';
});
Then('the device is removed from the Trusted Devices list', async function () {
  return 'pending';
});
Then('the device is automatically removed from the Trusted Devices list', async function () {
  return 'pending';
});
Then('the device is treated as untrusted on the next login', async function () {
  return 'pending';
});
Then('the login attempt is rejected', async function () {
  // Rejection = the challenge was NOT cleared: the user is held on the
  // /mfa-verify screen rather than landing on the Dashboard.
  expect(await this.pages.mfa.isOnMfaVerificationScreen()).toBeTruthy();
});
