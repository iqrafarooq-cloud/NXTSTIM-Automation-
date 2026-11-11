/**
 * inactiveUserFlow.js — shared lifecycle helper for the Inactive Users suite.
 *
 * The end-to-end story (admin creates a user → user activates via the emailed
 * OTP → admin marks the user Inactive → the inactive user is blocked at login)
 * is expensive to run, so this module both drives the flow AND caches the
 * provisioned user in memory for the lifetime of the Cucumber process. The
 * flagship @e2e scenario provisions the run's inactive user as it goes; the
 * focused @negative / @edge scenarios reuse that cached user (and only
 * self-provision if run in isolation).
 *
 * Design notes discovered live (2026-07-16):
 *   - User Management is at /users; Add New User is a 2-step wizard.
 *   - Admin acts as adminuser@iqra.anonaddy.com (no MFA) — creds from .env.
 *   - Each run uses a UNIQUE anonaddy plus-tag alias (inactive+<run>@…) so the
 *     invitation OTP email is unambiguous and never collides with a prior run;
 *     all plus-tags still forward to the same Gmail inbox the suite reads.
 *   - The OTP MUST be read right after creation, before the user's first login
 *     triggers later emails (an "Enable MFA" reminder) that would otherwise
 *     become the newest message for that recipient.
 *   - Setting the first password uses the documented set-first-password API
 *     with the OTP scraped from the real invitation email (genuine OTP usage);
 *     status changes are UI-only for admin roles, so inactivation is driven
 *     through the "Mark as Inactive" row action.
 */

const emailHelper = require('./emailHelper');
const testApi = require('./testApi');

// In-memory cache of the run's inactive user: { email, password, userId }.
let runUser = null;

// ---- Identity / config ---------------------------------------------------

function inactiveBase() {
  return process.env.INACTIVE_EMAIL || 'inactive@iqra.anonaddy.com';
}

/**
 * A unique, deliverable alias per run: <root>+<base36 time><rand>@domain.
 * Strips any existing +tag from the base so re-tagging is idempotent. Pass a
 * base (e.g. USERS_EMAIL) to tag a different recipient; defaults to INACTIVE_EMAIL.
 */
function uniqueEmail(base) {
  const [local, domain] = (base || inactiveBase()).split('@');
  const root = local.split('+')[0];
  const suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  return `${root}+${suffix}@${domain}`;
}

/** A password that always satisfies the app's complexity policy. */
function generatePassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Ia${rand}9!Az`; // upper + lower + digit + special, length 12
}

function adminEmail() {
  return process.env.BASE_EMAIL || process.env.TEST_USER_EMAIL || 'adminuser@iqra.anonaddy.com';
}

function adminPassword() {
  return process.env.BASE_PASSWORD || process.env.TEST_USER_PASSWORD;
}

// ---- Session helpers -----------------------------------------------------

/** Drop any existing auth (HttpOnly cookies + storage) and land on /login. */
async function freshLogin(world, email, password) {
  await world.context.clearCookies().catch(() => {});
  await world.pages.login.open();
  await world.page
    .evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
    })
    .catch(() => {});
  await world.pages.login.open();
  await world.pages.login.login(email, password);
}

/**
 * The admin account now enforces MFA (email verification): after the
 * credentials are accepted the app routes to the /mfa-verify challenge instead
 * of the dashboard, so the session is only half-established until the emailed
 * 6-digit code is entered. This clears that challenge; it is a no-op when the
 * session skips MFA (trusted device / MFA disabled), routing straight through.
 *
 * Only the EMAIL challenge is automatable here — the authenticator (TOTP)
 * variant has no locally-known secret, so we surface a clear error for it.
 */
async function completeMfaChallenge(world, email, sentAfter) {
  const mfa = world.pages.mfa;

  // Poll briefly for the challenge to render (it appears immediately once the
  // credentials are accepted). If the account routes straight to the app this
  // loop exits without finding it and the whole helper no-ops.
  const deadline = Date.now() + 12000;
  let onChallenge = false;
  while (Date.now() < deadline) {
    if (await mfa.isOnMfaVerificationScreen()) { onChallenge = true; break; }
    if (!(await world.pages.login.isOnLoginPage())) break; // routed to the app
    await world.page.waitForTimeout(300);
  }
  if (!onChallenge) return false;

  // The redirect to /mfa-verify flips isOnVerifyUrl() true a beat BEFORE the
  // code boxes and the "code sent to …@… / Resend" copy paint. Classifying the
  // challenge before that renders makes isEmailChallenge() read false-negative,
  // so wait for the inputs (and give the descriptive copy a moment to settle).
  await mfa.waitForVerificationScreen();
  await world.page.waitForTimeout(500);

  if (!(await mfa.isEmailChallenge())) {
    // Authenticator (TOTP) challenge: reuse the standalone TOTP self-healer,
    // which derives a code from the secret in artifacts/mfa/totp-secret.txt.
    // Requires that secret to belong to the admin account (capture it via the
    // MFA enable flow run as the admin, or store the admin's base32 secret).
    const mfaChallenge = require('./mfaChallenge');
    const acted = await mfaChallenge.completeLoginMfaChallengeIfPresent(world);
    if (acted) return true;
    throw new Error(
      'Admin MFA challenge is not the email variant and no usable TOTP secret ' +
      'was available. Switch the admin account to Email Verification MFA, or ' +
      'store the admin\'s Authenticator secret in artifacts/mfa/totp-secret.txt.'
    );
  }

  const res = await emailHelper.getActionableFromEmail(email, 'mfa', {
    after: sentAfter,
    timeoutMs: 120000,
    pollIntervalMs: 3000
  });
  await mfa.enterVerificationCode(res.value); // auto-submits on the final digit
  await mfa.clickVerifyIfEnabled();
  await mfa.waitForSubmitSettled();
  // A "trust this device?" prompt can intercept the redirect — decline it so
  // the ephemeral context keeps MFA required (and doesn't block navigation).
  await mfa.dismissTrustDevicePromptIfPresent().catch(() => {});
  return true;
}

async function loginAsAdmin(world) {
  const sentAfter = Date.now() - 5000; // stamp before submit so we read the NEW MFA code
  await freshLogin(world, adminEmail(), adminPassword());
  await completeMfaChallenge(world, adminEmail(), sentAfter);
  await world.pages.login.expectNavigatedAwayFromLogin();
  await world.pages.dashboard.waitForReady().catch(() => {});
}

/**
 * True when an admin session is already established (e.g. the Background step
 * logged in). Probing this lets provisioning skip a second — MFA-gated — login
 * when a session is already live, so the focused scenarios don't pay the email
 * round-trip twice. Verified by loading /users and seeing the tab-strip render;
 * an unauthenticated session bounces to /login and the wait times out (false).
 */
async function isAdminSessionActive(world) {
  try {
    await world.pages.adminUsers.openUsersPage();
    return true;
  } catch {
    return false;
  }
}

async function ensureAdminLoggedIn(world) {
  if (await isAdminSessionActive(world)) return;
  await loginAsAdmin(world);
}

// ---- Flow steps ----------------------------------------------------------

async function createPendingUser(world, { email, role = 'Monitoring Admin', firstName = 'Inactive', lastName = 'QAUser' }) {
  await world.pages.adminUsers.openUsersPage();
  await world.pages.adminUsers.createUserViaWizard({ firstName, lastName, email, role });
}

/** Read the emailed OTP and complete onboarding via set-first-password. */
async function activateWithOtp(world, email, password, createdAfter) {
  const res = await emailHelper.getActionableFromEmail(email, 'otp', {
    after: createdAfter,
    timeoutMs: 120000,
    pollIntervalMs: 3000
  });
  await testApi.setFirstLoginPassword({ email, otp: res.value, password });
  return res; // { value: otp, email: {subject, body, ...}, ... }
}

/** Resolve the backend user id for an email via the admin listing endpoint. */
async function lookupUserId(email) {
  const r = await testApi.getAdmins({ searchTerm: email, pageSize: 50 });
  const list =
    r?.data || r?.items || r?.admins || r?.users || r?.results || (Array.isArray(r) ? r : []);
  const match = list.find((u) => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
  return match ? match.id : null;
}

/**
 * Resolve a user's id, preferring the admin API but falling back to the UI: the
 * listing endpoint needs an admin bearer token this suite doesn't hold (it
 * 401s), so read the id off the freshly-activated user's Active-tab grid row.
 */
async function resolveUserId(world, email) {
  const viaApi = await lookupUserId(email).catch(() => null);
  if (viaApi) return viaApi;
  await world.pages.adminUsers.openUsersPage();
  await world.pages.adminUsers.openStatusTab('Active');
  return await world.pages.adminUsers.resolveUserIdByText(String(email).split('@')[0]);
}

async function markInactive(world, userId) {
  await world.pages.adminUsers.openUsersPage();
  await world.pages.adminUsers.openStatusTab('Active');
  await world.pages.adminUsers.markUserInactive(userId);
}

/** Backend truth: does this account report the inactive-state block on login? */
async function isAccountInactive(email, password) {
  try {
    await testApi.login(email, password);
    await testApi.logout().catch(() => {});
    return false; // login succeeded ⇒ active
  } catch (e) {
    return /inactive/i.test(JSON.stringify(e.body || e.message || ''));
  }
}

// ---- Orchestration -------------------------------------------------------

/**
 * Create + activate a user and leave them ACTIVE (no inactivation, not cached).
 * Opts (all optional): { role, base, firstName, lastName } — `base` tags a
 * different recipient (e.g. USERS_EMAIL) so the User/Role suites don't collide
 * with the Inactive suite's alias. Returns { email, password, userId, role }.
 */
async function provisionActiveUser(world, opts = {}) {
  const { role = 'Monitoring Admin', base, firstName, lastName } = opts;
  const email = uniqueEmail(base);
  const password = generatePassword();
  const createdAfter = Date.now() - 5000;

  await ensureAdminLoggedIn(world);
  await createPendingUser(world, { email, role, firstName, lastName });
  await activateWithOtp(world, email, password, createdAfter);
  const userId = await resolveUserId(world, email);
  return { email, password, userId, role };
}

/** Run the full create → activate → inactivate flow; cache and return the user. */
async function provision(world) {
  const email = uniqueEmail();
  const password = generatePassword();
  const createdAfter = Date.now() - 5000;

  await ensureAdminLoggedIn(world);
  await createPendingUser(world, { email });
  await activateWithOtp(world, email, password, createdAfter);
  const userId = await resolveUserId(world, email);
  await markInactive(world, userId);

  runUser = { email, password, userId };
  return runUser;
}

/** Return the run's cached inactive user, provisioning one if absent. */
async function ensureInactiveUser(world) {
  if (runUser && runUser.email) return runUser;
  return provision(world);
}

function getRunUser() {
  return runUser;
}

function setRunUser(u) {
  runUser = u;
}

module.exports = {
  // identity
  uniqueEmail,
  generatePassword,
  adminEmail,
  adminPassword,
  // sessions
  freshLogin,
  loginAsAdmin,
  isAdminSessionActive,
  ensureAdminLoggedIn,
  // steps
  createPendingUser,
  activateWithOtp,
  lookupUserId,
  resolveUserId,
  markInactive,
  isAccountInactive,
  // orchestration
  provisionActiveUser,
  provision,
  ensureInactiveUser,
  getRunUser,
  setRunUser
};
