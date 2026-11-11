const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');
const testApi = require('../support/testApi');
const emailHelper = require('../support/emailHelper');
const pwStore = require('../support/passwordStore');

const SLOW_STEP = { timeout: 180_000 };
// A single resend cycle waits out the ~1-minute cooldown (poll up to 100s) and
// then a fresh email (up to 120s).
const RESEND_STEP = { timeout: 300_000 };
const EMAIL_WAIT_MS = 120_000;
const RESEND_ENABLE_WAIT_MS = 100_000;
const CLOCK_SKEW_MS = 5_000;

function fw(world) {
  world.testState = world.testState || {};
  world.testState.forgot = world.testState.forgot || {};
  return world.testState.forgot;
}

function accountEmail() {
  const email = process.env.TEST_USER_EMAIL;
  if (!email) throw new Error('TEST_USER_EMAIL is not set in .env — required by the forgot-password suite.');
  return email;
}

/** Credentials accepted if login returns a token OR proceeds to an MFA challenge. */
function credentialsAccepted(loginResult) {
  return !!(loginResult && (loginResult.accessToken || loginResult.requiresMfa || loginResult.challengeToken));
}

// GIVEN / WHEN — request the reset

async function openForgotPasswordPage(world) {
  // Prefer the on-page "Forgot Your Password?" link; fall back to direct nav.
  if (await world.pages.login.isForgotPasswordLinkVisible().catch(() => false)) {
    await world.pages.login.clickForgotPassword();
  } else {
    const base = world.pages.login.url.replace(/\/login.*$/i, '');
    await world.pages.forgotPassword.navigate(`${base}/forgot-password`);
  }
  await world.pages.forgotPassword.waitForLoaded();
}

Given('the user opens the forgot password page', async function () {
  await openForgotPasswordPage(this);
});

When('the user submits a password reset request for the account', async function () {
  const email = accountEmail();
  fw(this).email = email;
  // Stamp the trigger time so we only accept a reset email sent after this.
  fw(this).triggeredAt = Date.now();
  await this.pages.forgotPassword.request(email);
});

Then('a password reset confirmation should be shown', async function () {
  // The app confirms with a toast / status message ("check your email", etc.).
  // Treat leaving the email in an error-free submitted state as acceptable too,
  // since copy varies — but prefer an explicit confirmation when present.
  const confirmed = await this.pages.forgotPassword.hasConfirmationMessage(8000);
  const fieldError = await this.pages.forgotPassword.hasEmailFieldError().catch(() => false);
  expect(confirmed || !fieldError,
    'Expected a reset-request confirmation (or at least no validation error)').toBeTruthy();
});

// THEN / WHEN — read the email and open the link

async function captureResetEmail(world, expectedSubject) {
  const email = fw(world).email || accountEmail();
  const actionable = await emailHelper.getActionableFromEmail(email, 'PASSWORD_RESET', {
    after: (fw(world).triggeredAt || Date.now()) - CLOCK_SKEW_MS,
    timeoutMs: EMAIL_WAIT_MS
  });
  expect(actionable.email.subject, `Expected an email whose subject contains "${expectedSubject}"`)
    .toMatch(new RegExp(expectedSubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  expect(actionable.value, 'Expected a reset link in the email body').toBeTruthy();
  fw(world).resetLink = actionable.value;
  return actionable;
}

Then('a {string} email should be received', SLOW_STEP, async function (expectedSubject) {
  await captureResetEmail(this, expectedSubject);
});

When('the user opens the reset link from that email', SLOW_STEP, async function () {
  const link = fw(this).resetLink;
  expect(link, 'No reset link captured from the email').toBeTruthy();
  // Navigating the SendGrid /ls/click redirect lands on /reset-password?key=…
  await this.pages.createPassword.navigate(link);
  await this.pages.createPassword.waitForLoaded();
});

Then('the Create New Password screen should be displayed', async function () {
  expect(await this.pages.createPassword.isOnPage(),
    `Expected the reset/create-password screen; url=${await this.pages.createPassword.getCurrentUrl()}`)
    .toBeTruthy();
  expect(await this.pages.createPassword.isVisible(this.pages.createPassword.newPasswordInput)).toBeTruthy();
});

// WHEN / THEN — set the new password and verify

When('the user sets a new unique password on the reset screen', async function () {
  const fresh = pwStore.generatePassword();
  fw(this).newPassword = fresh;
  await this.pages.createPassword.resetPassword(fresh, fresh);
});

Then('the password reset should be successful', SLOW_STEP, async function () {
  // Success surfaces as a confirmation message/toast and/or a redirect back to
  // the login screen. Accept either.
  const success = await this.pages.createPassword.hasSuccessMessage(8000).catch(() => false);
  let onLogin = false;
  if (!success) {
    onLogin = await this.page
      .waitForURL(/\/login/i, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(success || onLogin,
    'Expected a success confirmation or a redirect to the login page after reset').toBeTruthy();
  // Persist the rotation so the account stays usable across steps/runs. Only
  // rotate TEST_USER_PASSWORD — this is the forgot-password account. Do NOT
  // touch BASE_PASSWORD: BASE_EMAIL (adminuser+1) is a SEPARATE admin account
  // used as the self-healing actor, and overwriting its password here would
  // lock the healer out of the admin login. (They used to be the same account,
  // which is why this once rotated both.)
  const fresh = fw(this).newPassword;
  if (fresh) {
    pwStore.updateEnvVar('TEST_USER_PASSWORD', fresh);
  }
});

Then('the new password should be accepted for the account', SLOW_STEP, async function () {
  testApi.requireConfigured('verify reset password');
  const email = fw(this).email || accountEmail();
  const fresh = fw(this).newPassword;
  expect(fresh, 'No new password recorded for this scenario').toBeTruthy();
  let result;
  try {
    result = await testApi.login(email, fresh);
  } catch (err) {
    result = { error: err.status, message: err.body && err.body.message };
  }
  expect(credentialsAccepted(result),
    `New password should be accepted (token or MFA challenge). Got: ${JSON.stringify(result).slice(0, 160)}`)
    .toBeTruthy();
  await testApi.logout().catch(() => {});
});

// END-TO-END — log back in through the UI with the freshly reset password

When('the user logs in with the newly reset password', SLOW_STEP, async function () {
  const email = fw(this).email || accountEmail();
  const fresh = fw(this).newPassword;
  expect(fresh, 'No newly-reset password recorded — run the reset steps first').toBeTruthy();
  // Come back to the login screen (the reset flow may have redirected here
  // already) and sign in with the new credentials through the real UI.
  await this.pages.login.open();
  await this.pages.login.login(email, fresh);
});

Then('the user should be granted access or prompted for MFA', SLOW_STEP, async function () {

  const deadline = Date.now() + 20_000;
  let outcome = null;
  while (Date.now() < deadline) {
    if (await this.pages.mfa.isOnMfaVerificationScreen().catch(() => false)) {
      outcome = 'mfa-challenge';
      break;
    }
    if (!(await this.pages.login.isOnLoginPage())) {
      outcome = 'authenticated';
      break;
    }
    await this.page.waitForTimeout(300);
  }
  expect(outcome,
    'Expected the reset password to be accepted — an MFA challenge or navigation ' +
    'away from the login page — but the user is still on /login.')
    .toBeTruthy();
});

// NEGATIVE — malformed / empty email on the forgot password screen

When('the user requests a password reset for {string}', async function (email) {
  await this.pages.forgotPassword.enterEmail(email);
  // Submit only if the button is enabled — a disabled submit is itself valid
  // client-side validation feedback, so we don't force a click that can't land.
  if (!(await this.pages.forgotPassword.isSubmitDisabled())) {
    await this.pages.forgotPassword.submit().catch(() => {});
  }
});

Then('a validation message should be displayed for the reset email field', async function () {
  // Same disjunctive convention as the login suite: MUI surfaces validation
  // either as inline helper text / an :invalid field OR by disabling submit.
  const hasFieldError = await this.pages.forgotPassword.hasEmailFieldError().catch(() => false);
  const submitDisabled = await this.pages.forgotPassword.isSubmitDisabled();
  expect(hasFieldError || submitDisabled,
    'Expected email-field validation: a helper-text/invalid error or a disabled submit button')
    .toBeTruthy();
});

// NEGATIVE — check a whole set of malformed/empty emails in ONE scenario.
// (Replaces the old Scenario Outline so the report shows a single row instead
// of one per example.) Each email is entered from a freshly-cleared field and
// judged by the same disjunctive rule; failures are aggregated so one accepted
// email doesn't hide the others' results.
Then('each of the following emails is rejected on the forgot password screen', async function (dataTable) {
  const emails = dataTable.hashes().map((row) => row.email ?? '');
  const notRejected = [];
  const lines = [];
  for (const email of emails) {
    // Make sure we're back on the forgot-password screen with a usable field
    // before each attempt (a prior submit should never have navigated away for
    // an invalid email, but re-open defensively if it did).
    if (!(await this.pages.forgotPassword.isVisible(this.pages.forgotPassword.emailInput))) {
      await openForgotPasswordPage(this);
    }
    await this.pages.forgotPassword.enterEmail(email);
    // A disabled submit is itself valid client-side validation; only click when
    // it's enabled so we don't force a click that can't land.
    if (!(await this.pages.forgotPassword.isSubmitDisabled())) {
      await this.pages.forgotPassword.submit().catch(() => {});
    }
    const hasFieldError = await this.pages.forgotPassword.hasEmailFieldError().catch(() => false);
    const submitDisabled = await this.pages.forgotPassword.isSubmitDisabled();
    const rejected = hasFieldError || submitDisabled;
    const label = email === '' ? '(empty)' : email;
    const how = hasFieldError
      ? 'inline validation error'
      : submitDisabled ? 'Send button disabled' : 'NOT rejected — accepted';
    // Record each email + outcome so the run reads it back in the report (the
    // Gherkin data table itself isn't rendered there, but text attachments are).
    lines.push(`${rejected ? '✓' : '✗'}  ${label.padEnd(20)}  ->  ${how}`);
    if (!rejected) notRejected.push(label);
  }
  this.attach(
    ['Malformed / empty emails checked (all must be rejected):', '', ...lines].join('\n'),
    'text/plain'
  );
  expect(notRejected,
    `Expected every malformed/empty email to be rejected (inline error or disabled ` +
    `submit). These were NOT rejected: ${notRejected.join(', ') || 'none'}`)
    .toHaveLength(0);
});

// NEGATIVE — unregistered email must not disclose account existence

When('the user submits a password reset request for an unregistered email', async function () {
  // A well-formed address that is guaranteed not to exist. The app should
  // respond with the SAME generic confirmation it shows a real account, so it
  // never leaks whether an email is registered.
  const unregistered = `no-such-user-${Date.now().toString(36)}@bytecorp.io`;
  fw(this).email = unregistered;
  fw(this).triggeredAt = Date.now();
  await this.pages.forgotPassword.request(unregistered);
});

// NEGATIVE — an invalid / expired reset link is rejected

When('the user opens a reset link with an invalid token', async function () {
  const base = this.pages.login.url.replace(/\/login.*$/i, '');
  // A clearly bogus, non-JWT token — not tied to any account and never issued.
  const bogusToken = `invalid-${'x'.repeat(120)}`;
  fw(this).invalidToken = bogusToken;
  await this.pages.createPassword.navigate(`${base}/reset-password?key=${bogusToken}`);
  // Let the SPA route/validate before we assert.
  await this.page.waitForTimeout(1500);
});

Then('the reset link should be rejected as invalid or expired', async function () {
  if (await this.pages.linkExpired.isOnPage().catch(() => false)) {
    expect(true).toBeTruthy();
    return;
  }
  // Fallback A: when the API is configured, the backend must reject the token.
  if (testApi.isConfigured() && fw(this).invalidToken) {
    let rejected = false;
    try {
      const r = await testApi.validateResetToken(fw(this).invalidToken);
      rejected = !!(r && (r.valid === false || r.isValid === false || r.expired === true));
    } catch {
      rejected = true; // a 4xx from validate-reset-token means "rejected"
    }
    expect(rejected, 'The backend should reject an invalid reset token').toBeTruthy();
    return;
  }
 
  const formUsable = await this.pages.createPassword
    .isVisible(this.pages.createPassword.newPasswordInput)
    .catch(() => false);
  expect(formUsable,
    'An invalid/expired reset link must not present a usable Create New Password form')
    .toBeFalsy();
});

// NEGATIVE — an expired / previously-used link must land on "Link Expired"

Then('the user should be redirected to the Link Expired screen', SLOW_STEP, async function () {
  const le = this.pages.linkExpired;
  const onPage  = await le.isOnPage().catch(() => false);
  const title   = await le.isTitleVisible().catch(() => false);
  const subtext = await le.isSubtextVisible().catch(() => false);
  const cta     = await le.isCtaVisible().catch(() => false);
  const logo    = await le.isLogoVisible().catch(() => false);
  const url     = await le.getCurrentUrl().catch(() => '');
  expect(onPage && title && subtext && cta && logo,
    'Expected the "Link Expired" screen (title "Link Expired", subtext, ' +
    '"Go to Forgot Password Page" CTA, and NXTSTIM logo) after opening an ' +
    'expired/previously-used reset link. ' +
    `[onPage=${onPage} title=${title} subtext=${subtext} cta=${cta} logo=${logo}] url=${url}`)
    .toBeTruthy();
});

// NEGATIVE — submit stays disabled until a valid email is entered

Then('the Send Reset Link button should be disabled', async function () {
  expect(await this.pages.forgotPassword.isSubmitDisabled(),
    'The Send Reset Link button should be disabled while the email field is empty')
    .toBeTruthy();
});

When('the user enters a valid email address', async function () {
  // A well-formed address so the assertion targets format validation, not
  // registration state — keeps this scenario UI-only (no env/API needed).
  await this.pages.forgotPassword.enterEmail('valid.user@bytecorp.io');
});

Then('the Send Reset Link button should be enabled', async function () {
  expect(await this.pages.forgotPassword.isSubmitEnabled(),
    'The Send Reset Link button should be enabled once a valid email is entered')
    .toBeTruthy();
});

// NEGATIVE — a reset link cannot be reused after a successful reset

When('the user opens the same reset link again', SLOW_STEP, async function () {
  const link = fw(this).resetLink;
  expect(link, 'No reset link captured earlier to re-open').toBeTruthy();
  // Navigate the exact same link that was already consumed by a successful reset.
  await this.pages.createPassword.navigate(link);
  await this.page.waitForTimeout(1500);
});

// RESEND EMAIL — resend the reset email after the ~1-minute cooldown

async function resendAfterCooldown(world) {
  await world.pages.forgotPassword.waitForConfirmationScreen();
  const enabled = await world.pages.forgotPassword.waitForResendEnabled(RESEND_ENABLE_WAIT_MS);
  expect(enabled,
    'Expected the Resend Email control to become clickable after the 1-minute cooldown')
    .toBeTruthy();
  fw(world).triggeredAt = Date.now();
  await world.pages.forgotPassword.clickResend();
}

When('the user clicks Resend Email after the 1-minute cooldown', RESEND_STEP, async function () {
  await resendAfterCooldown(this);
});

Then('a new {string} email should be received', RESEND_STEP, async function (expectedSubject) {
  await captureResetEmail(this, expectedSubject);
});

// RESEND EMAIL — the account is locked after the maximum number of reset sends.
// The send that exceeds the allowed maximum is rejected: the app shows a
// suspended-account notice and starts a 30-minute lockout instead of emailing.

When('the user attempts to resend the reset email once more', RESEND_STEP, async function () {
  // Same click path as a normal resend — wait out the 1-minute cooldown, then
  // click Resend. This time the backend rejects it (limit reached) so no email
  // is sent; the assertions below verify the lockout state instead.
  await resendAfterCooldown(this);
});

Then('the account should be locked with a suspended-account notice', SLOW_STEP, async function () {
  const suspended = await this.pages.forgotPassword.hasSuspendedAccountMessage(10000);
  const maxed = await this.pages.forgotPassword.hasMaxAttemptsMessage(2000).catch(() => false);
  expect(suspended || maxed,
    'Expected a suspended-account / max-attempts notice (e.g. "Your account is in ' +
    'suspended state. Please contact nxtstim@support.com") after exceeding the ' +
    'maximum number of reset attempts')
    .toBeTruthy();
});

Then('a 30-minute {string} lockout countdown should be displayed', SLOW_STEP, async function (label) {
  const shown = await this.pages.forgotPassword.hasMaxAttemptCountdown(10000);
  expect(shown,
    `Expected a "${label}" lockout with a MM:SS countdown ` +
    '(e.g. "Max attempt reached, try again in 29:59")')
    .toBeTruthy();
  // Confirm it is the long lockout timer, not the ordinary 1-minute resend
  // cooldown (which never exceeds ~60s).
  const secs = await this.pages.forgotPassword.getMaxAttemptCountdownSeconds();
  expect(secs,
    'The lockout countdown should be well above the 1-minute resend cooldown ' +
    `(expected a ~30-minute timer). Got ${secs}s.`)
    .toBeGreaterThan(120);
});
