/**
 * accountHealer.js — reusable self-healing for authentication scenarios that
 * require a valid ACTIVE test account (Change Password, Forgot Password, …).
 *
 * Problem it solves
 * -----------------
 * The QA suite accounts drift out of the Active state between runs — they get
 * Suspended (e.g. by the forgot-password lockout scenario) or left Pending
 * after a reactivation. When that happens every scenario that logs in with the
 * account fails for a reason that has nothing to do with the code under test.
 *
 * This module restores the account to Active BEFORE the scenario runs, using
 * the real product flow (verified live 2026-07-18 — see the
 * `account-reactivation-live-flow` project memory):
 *
 *   1. Detect status via an API login probe (returns the account STATE even
 *      with a stale password): active | suspended | pending | inactive.
 *   2. Active            → nothing to do, continue.
 *   3. Suspended         → log in as the BASE admin, Suspended tab → row 3-dot
 *                          → "Reactivate Account" (sends the reactivation email,
 *                          moves the user to Pending), then run the Pending
 *                          → Active step below.
 *   4. Pending           → ensure a fresh reset-link email exists (Pending tab
 *                          → row 3-dot → "Resend Email"), open the emailed reset
 *                          link in a LOGGED-OUT session, set a fresh unique
 *                          password on the Create-New-Password screen.
 *   5. Verify the account is Active again and persist the new password to the
 *      account's own .env var (never BASE_PASSWORD — the admin's own password
 *      must stay stable so the healer can keep logging in).
 *
 * It is a hook helper, invoked once per tagged scenario from hooks.js — the
 * recovery is NOT duplicated across step files. It only does work when the
 * account is not already Active, and throws only if it cannot restore Active
 * after a couple of attempts.
 *
 * The BASE admin actor is reused from inactiveUserFlow.loginAsAdmin (it already
 * clears cookies and clears the admin's own email-MFA challenge). The emailed
 * link is read with emailHelper (Gmail IMAP) and the password screen is driven
 * by the existing CreatePasswordPage POM.
 */

const testApi = require('./testApi');
const emailHelper = require('./emailHelper');
const pwStore = require('./passwordStore');
const inactiveUserFlow = require('./inactiveUserFlow');

// Which .env keys back each healable account. `idKey` is an OPTIONAL numeric
// User ID hint that makes locating the row on a large tab deterministic (the
// /users search box is User-ID-only); without it we match the row by email
// text on the current page, which is reliable on the small Suspended tab.
const ACCOUNTS = Object.freeze({
  'change-password': { emailKey: 'CHGPWD_UI_EMAIL', passwordKey: 'CHGPWD_UI_PASSWORD', idKey: 'CHGPWD_UI_USER_ID' },
  'forgot-password': { emailKey: 'TEST_USER_EMAIL', passwordKey: 'TEST_USER_PASSWORD', idKey: 'TEST_USER_ID' },
  // MFA scenarios log in with the same TEST_USER_* account as Forgot Password,
  // so the healer recovers it identically. An MFA challenge on the login probe
  // still reports as Active (see detectStatus), so an MFA-enabled account is
  // never mistaken for a broken one.
  'mfa': { emailKey: 'TEST_USER_EMAIL', passwordKey: 'TEST_USER_PASSWORD', idKey: 'TEST_USER_ID' }
});

const MAX_RECOVERY_ATTEMPTS = 2;
const EMAIL_WAIT_MS = 120_000;
const CLOCK_SKEW_MS = 5_000;
// Reactivation / reset-password email subjects (both carry a reset link).
const RESET_EMAIL_SUBJECT = /Account Reactivation|Action Required:\s*Reset Your NXTSTIM Password/i;

function log(message) {
  // Clearly namespaced so it's obvious in the run output what the hook is doing.
  console.log(`[account-healer] ${message}`);
}

function resolveAccount(accountKey) {
  const cfg = ACCOUNTS[accountKey];
  if (!cfg) {
    throw new Error(
      `accountHealer: unknown account "${accountKey}". Known: ${Object.keys(ACCOUNTS).join(', ')}.`
    );
  }
  const email = process.env[cfg.emailKey];
  if (!email) {
    throw new Error(`accountHealer: ${cfg.emailKey} is not set in .env for account "${accountKey}".`);
  }
  const userId = process.env[cfg.idKey] || null;
  return { ...cfg, accountKey, email, userId };
}

/**
 * Probe the account state via the login API. The backend reports suspended /
 * pending / inactive BEFORE (independently of) validating the password, so a
 * stale password still yields the true state.
 *
 * Returns: 'active' | 'suspended' | 'pending' | 'inactive' | 'unknown'.
 */
async function detectStatus(email, password) {
  try {
    const r = await testApi.login(email, password);
    await testApi.logout().catch(() => {});
    // A non-throwing login means the credentials/state were accepted — an MFA
    // challenge (requiresMfa/challengeToken) still means the account is Active.
    return 'active';
  } catch (err) {
    const msg = JSON.stringify(err.body || err.message || '').toLowerCase();
    if (/suspend/.test(msg)) return 'suspended';
    if (/pending/.test(msg)) return 'pending';
    if (/inactive/.test(msg)) return 'inactive';
    // Wrong password on an otherwise-active account, or an unrecognised error —
    // not something reactivation can fix.
    return 'unknown';
  }
}

/**
 * Read the freshest reset-link email for the account, open it in a logged-out
 * session, and set a new unique password. Returns the new password.
 */
async function setNewPasswordFromEmail(world, email, triggeredAt) {
  log(`waiting for the reset-link email to ${email} …`);
  const mail = await emailHelper.waitForLatestEmail(email, {
    after: triggeredAt - CLOCK_SKEW_MS,
    subjectMatch: RESET_EMAIL_SUBJECT,
    timeoutMs: EMAIL_WAIT_MS,
    pollIntervalMs: 3000
  });
  const link = emailHelper.extractResetLink(mail.body);
  if (!link) {
    throw new Error(
      `accountHealer: no reset link found in the "${mail.subject}" email to ${email}.`
    );
  }
  log(`reset email received ("${mail.subject}") — opening the reset link (logged out)`);

  // The Create-New-Password screen only renders when logged OUT; with an active
  // admin session the app bounces the reset link to /monitoring. Clear the
  // session first (HttpOnly cookies + web storage).
  await world.context.clearCookies().catch(() => {});
  await world.pages.login.open();
  await world.page
    .evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
    })
    .catch(() => {});

  await world.pages.createPassword.navigate(link);
  await world.pages.createPassword.waitForLoaded();

  const fresh = pwStore.generatePassword();
  await world.pages.createPassword.resetPassword(fresh, fresh);

  // Success surfaces as a confirmation and/or a redirect back to /login.
  const ok = await world.pages.createPassword.hasSuccessMessage(8000).catch(() => false);
  if (!ok) {
    await world.page.waitForURL(/\/login/i, { timeout: 8000 }).catch(() => {});
  }
  log('new password submitted on the Create-New-Password screen');
  return fresh;
}

/**
 * Run one recovery attempt appropriate to `status`, returning the new password
 * that was set (or null if no password change was required).
 */
async function recoverOnce(world, account, status) {
  const admin = world.pages.adminUsers;
  const rowRef = { userId: account.userId, email: account.email };

  if (status === 'suspended') {
    log(`step 1/5 — logging in as the base admin to reactivate ${account.email}`);
    await inactiveUserFlow.loginAsAdmin(world);
    log('step 2/5 — opening /users → Suspended tab');
    await admin.openUsersPage();
    const triggeredAt = Date.now();
    log('step 3/5 — locating the suspended user and clicking ⋮ → "Reactivate Account"');
    const toast = await admin.reactivateSuspendedUser(rowRef);
    log(`step 4/5 — reactivation triggered${toast ? ` (toast: "${toast}")` : ''}; account is now Pending`);
    log('step 5/5 — completing activation from the emailed reset link');
    return setNewPasswordFromEmail(world, account.email, triggeredAt);
  }

  if (status === 'pending') {
    log(`account ${account.email} is Pending — logging in as the base admin to resend the reset email`);
    await inactiveUserFlow.loginAsAdmin(world);
    await admin.openUsersPage();
    const triggeredAt = Date.now();
    log('locating the pending user and clicking ⋮ → "Resend Email"');
    const toast = await admin.resendPendingEmail(rowRef);
    log(`reset email resent${toast ? ` (toast: "${toast}")` : ''}`);
    return setNewPasswordFromEmail(world, account.email, triggeredAt);
  }

  // 'inactive' / 'unknown' are outside the reactivation flow's scope.
  throw new Error(
    `accountHealer: account ${account.email} is "${status}" — the self-healing hook ` +
    `only recovers Suspended and Pending accounts. Inactive accounts must be ` +
    `re-activated by an admin, and "unknown" usually means the stored password is ` +
    `wrong for an otherwise-active account.`
  );
}

/**
 * Ensure the configured account for `accountKey` is Active, recovering it via
 * the admin reactivation flow if it is Suspended/Pending. Idempotent and safe
 * to call unconditionally from a Before hook — it no-ops when already Active.
 *
 * Returns { status, healed, email }.
 */
async function ensureActive(world, accountKey) {
  if (!testApi.isConfigured()) {
    log('TEST_API_* not configured — cannot detect/heal account state; skipping.');
    return { status: 'unknown', healed: false };
  }

  const account = resolveAccount(accountKey);
  let password = process.env[account.passwordKey];

  let status = await detectStatus(account.email, password);
  if (status === 'active') {
    log(`account ${account.email} is already Active — no recovery needed.`);
    return { status: 'active', healed: false, email: account.email };
  }

  log(`account ${account.email} is ${status.toUpperCase()} — starting self-healing recovery.`);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      log(`recovery attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS} for ${account.email} (${status})`);
      const newPassword = await recoverOnce(world, account, status);

      if (newPassword) {
        // Persist to the account's OWN password var (and live process.env) so the
        // scenario — and future runs — log in with the rotated password. Never
        // touch BASE_PASSWORD: that is the admin actor's password.
        pwStore.updateEnvVar(account.passwordKey, newPassword);
        password = newPassword;
        log(`persisted the new password to ${account.passwordKey}`);
      }

      status = await detectStatus(account.email, password);
      if (status === 'active') {
        log(`✅ recovery succeeded — ${account.email} is Active again.`);
        return { status: 'active', healed: true, email: account.email };
      }
      log(`account is still ${status} after attempt ${attempt}; retrying …`);
    } catch (err) {
      lastError = err;
      log(`recovery attempt ${attempt} failed: ${err.message}`);
      // Re-probe so the next attempt branches on the real current state.
      status = await detectStatus(account.email, password);
      if (status === 'active') {
        log(`✅ account ${account.email} is Active despite the error — continuing.`);
        return { status: 'active', healed: true, email: account.email };
      }
    }
  }

  throw new Error(
    `accountHealer: failed to restore ${account.email} to Active after ` +
    `${MAX_RECOVERY_ATTEMPTS} attempts (last observed status: ${status}).` +
    (lastError ? ` Last error: ${lastError.message}` : '')
  );
}

module.exports = {
  ensureActive,
  detectStatus,
  ACCOUNTS
};
