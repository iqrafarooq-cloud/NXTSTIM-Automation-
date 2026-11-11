const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

class MfaPage extends BasePage {
  constructor(page) {
    super(page);

    this.selectors = {
      methodCard: (methodName) =>
        `div:has-text("${methodName}"), ` +
        `[data-testid*="${methodName.toLowerCase().replace(/\s+/g, '-')}"]`,
      methodRadio: (methodName) =>
        `input[type="radio"][aria-label^="${methodName}"], ` +
        `label:has-text("${methodName}") input[type="radio"], ` +
        `div:has-text("${methodName}") input[type="radio"]`,
      enableMfaButton:
        'button:has-text("Enable 2FA"), button:has-text("Enable MFA"), button:has-text("Enable Multi-Factor Authentication"), button:has-text("Enable"), [type="submit"]:has-text("Enable")',
      disableButton:
        'button:has-text("Disable"), a:has-text("Disable"), button:has-text("Disable MFA")',
      enabledChip:
        'span:has-text("Enabled"), div:has-text("Enabled"), .MuiChip-label:has-text("Enabled")',
      qrModal:
        'div[role="dialog"]:has-text("Set up two-factor"), div[role="dialog"]:has-text("QR code"), div[role="dialog"]:has-text("QR Code"), div:has-text("QR code")',
      qrCode:
        'img[alt*="QR" i], svg[aria-label*="QR" i], .qr-code, [data-testid="qr-code"], [data-testid*="qr"]',
      manualEntryText:
        '[data-testid*="manual-entry"], ' +
        '[data-testid*="secret"], ' +
        'div:has-text("manual entry"), ' +
        'div:has-text("Secret"), ' +
        'p:has-text("Secret"), ' +
        'span:has-text("Secret")',
      nextButton:
        'button:has-text("Next"), button:has-text("Continue"), button:has-text("Proceed")',
      completeButton:
        'button:has-text("Complete"), button:has-text("Finish"), button:has-text("Confirm"), button:has-text("Verify")',
      // The login-time challenge (/mfa-verify) labels its submit button
      // "Log in"; the settings code modal uses "Complete"/"Verify"; the
      // regenerate-backup-codes modal labels it "Regenerate". Cover all.
      verifyButton:
        'div[role="dialog"] button:has-text("Verify"), div[role="dialog"] button:has-text("Complete"), div[role="dialog"] button:has-text("Confirm"), div[role="dialog"] button:has-text("Trust Device"), div[role="dialog"] button:has-text("Regenerate"), ' +
        'button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Complete"), button:has-text("Trust Device"), button:has-text("Log in")',
      // Confirmation step that precedes the disable code entry. The live app
      // labels this "Disable MFA" (older builds used "Disable 2FA").
      disableConfirmButton:
        'div[role="dialog"] button:has-text("Disable MFA"), button:has-text("Disable MFA"), button:has-text("Disable 2FA"), button:has-text("Disable Two")',
      // Code-entry modals (disable + regenerate) offer a link to switch between
      // the 6-digit authenticator code and an 8-char backup recovery code.
      useBackupCodeLink:
        ':text-is("Use a backup code instead"), [role="dialog"] :has-text("Use a backup code instead")',
      useAuthenticatorCodeLink:
        ':text-is("Use authenticator code instead"), [role="dialog"] :has-text("Use authenticator code instead")',
      // Backup-code entry renders 8 single-char boxes (aria-label "Backup code
      // character N") split as xxxx-xxxx.
      backupCodeInputs:
        'input[aria-label*="backup code" i]',
      // Authenticator-code entry renders 6 boxes (aria-label "Digit N"). Kept
      // distinct from backupCodeInputs so the toggle direction is detectable:
      // "Digit N" never contains "backup code" and vice-versa.
      authenticatorCodeInputs:
        'input[aria-label*="digit" i]',
      cancelButton:
        'button:has-text("Cancel"), button:has-text("Dismiss"), button:has-text("Close")',
      // When a method is already enabled, selecting a DIFFERENT method relabels
      // the primary action button from "Enable MFA" to "Switch MFA"; clicking it
      // is what opens the switch confirmation modal (radio-selection alone does
      // not). Scoped to "Switch" so it never matches the "Enable MFA" button.
      switchMfaButton:
        'button:has-text("Switch MFA"), button:has-text("Switch Multi-Factor"), button:has-text("Switch MFA Method")',
      // The live app titles this dialog "Switch Multifactor Authentication
      // method" (one word, no hyphen). :has-text is case-insensitive but NOT
      // hyphen-insensitive, so "multi-factor" never matches "Multifactor" — match
      // the real wording first and keep the hyphenated spelling as a fallback for
      // any build that uses it.
      switchMethodModal:
        'div[role="dialog"]:has-text("Switch Multifactor Authentication"), ' +
        'div[role="dialog"]:has-text("Switch multi-factor authentication"), ' +
        'div:has-text("Switch Multifactor Authentication"), ' +
        'div:has-text("Switch multi-factor authentication")',
      confirmationModal:
        'div[role="dialog"]:has-text("confirmation"), div:has-text("verification code"), div:has-text("Disable")',
      codeInput:
        'input[data-testid*="mfa" i][data-testid*="code" i], input[data-testid*="digit" i], input[aria-label*="digit" i], input[aria-label*="code" i], input[name*="code" i], input[placeholder*="digit" i], input[placeholder*="code" i], input[type="tel"]',
      codeInputs:
        'input[data-testid*="digit" i], input[aria-label*="digit" i], input[aria-label*="code" i], input[placeholder*="digit" i], input[placeholder*="code" i], input[type="tel"]',
      errorMessage:
        '[role="alert"], .MuiFormHelperText-root.Mui-error, .error, .error-message, span:has-text("Invalid"), div:has-text("Invalid")',
      // Rate-limit / throttle feedback for the MFA verify endpoint. Once the
      // per-window submission cap is exceeded the app surfaces wording like
      // "Too many requests. Try again in 15 minutes". Matched on the
      // throttle-specific phrasing so it is separable from the ordinary "Invalid
      // Code" helper text (which hasFailureMessage covers) — "too many requests"/
      // "limit exceeded" never appear in the invalid-code error.
      rateLimitMessage:
        ':text-matches("too many requests|too many attempts|limit exceeded|try again in \\d+\\s*(second|minute)", "i")',
      // Success-specific signals only. Deliberately NOT bare `.MuiAlert-message`
      // / `.Toastify__toast-body`: those containers are shared by ERROR alerts,
      // so a failed verification renders in the same node and would false-pass a
      // success check. We match MUI success-severity roots, Toastify's success
      // variant, and explicit "successfully" wording (errors say "Incorrect"/
      // "Invalid", never "successfully"). hasSuccessToast() additionally vetoes
      // on any visible failure message as a second guard.
      successToast:
        'div:has-text("Multi-Factor Authentication Enabled Successfully"), ' +
        '.MuiAlert-colorSuccess, .MuiAlert-standardSuccess, .MuiAlert-filledSuccess, ' +
        '.Toastify__toast--success, ' +
        'div:has-text("successfully"), span:has-text("successfully")',
      // Headings differ by surface: the settings code modal says "Enter
      // authenticator code"; the standalone login challenge (/mfa-verify) says
      // "Two-Factor authentication". Match both, plus legacy MFA wording.
      mfaHeading:
        'div[role="dialog"]:has-text("Enter authenticator code"), ' +
        'div[role="dialog"]:has-text("Enter backup code"), ' +
        'div[role="dialog"]:has-text("Enter the verification code"), ' +
        'p:has-text("Enter authenticator code"), ' +
        'p:has-text("Enter the verification code"), ' +
        'p:has-text("Two-Factor authentication"), ' +
        'p:has-text("Two Factor"), ' +
        'h1:has-text("Multi-Factor Authentication"), ' +
        'h2:has-text("Multi-Factor Authentication"), ' +
        'div:has-text("Multi-Factor Authentication")',
      // Match ONLY the actual warning banner wording — NOT a bare "trusted",
      // which also matches the always-present "Trusted Devices" management
      // section and the "Device marked as trusted" success toast, producing a
      // false positive after a device is successfully trusted.
      untrustedBanner:
        'div:has-text("untrusted device"), div:has-text("haven\'t marked this device")',
      // "Mark As Trusted" renders as a cursor-pointer <div>, not a button/anchor;
      // :text-is targets the smallest element with exactly that text.
      markAsTrustedButton:
        'button:has-text("Mark As Trusted"), a:has-text("Mark As Trusted"), [data-testid*="trusted"]:has-text("Mark As Trusted"), :text-is("Mark As Trusted")',
      // Resend may render as a <button>, <a>, or (like other controls in this
      // app — Mark As Trusted / Regenerate) a cursor-pointer <div>. The live
      // build renders the label as "Resend code in 01:00" (counting down) and
      // "Resend code" (enabled), so an exact :text-is("Resend") misses it.
      // :text-matches("Resend", "i") targets the smallest element whose text
      // contains "Resend" — covering both the countdown and enabled states —
      // and isResendButtonEnabled() distinguishes them by the digits in the label.
      resendButton:
        'button:has-text("Resend"), a:has-text("Resend"), [data-testid*="resend" i], :text-matches("Resend", "i")',
      resendTimer:
        'span:has-text("seconds"), [data-testid*="resend-timer" i], span:has-text("Resend"), div:has-text("Resend")',
      recoveryCodesModal:
        'div[role="dialog"]:has-text("Recovery Codes"), div:has-text("Recovery Codes")',
      recoveryCodeGrid:
        'div:has-text("Recovery Codes") + div, .recovery-codes, [data-testid*="recovery-codes"]',
      // Recovery codes render one-per-<p> in "xxxx-xxxx" form; older builds may
      // use <code>/<li>. getRecoveryCodes() filters matches by the code shape.
      recoveryCodeItem:
        'p, code, li, span, div',
      copyButton:
        'button:has-text("Copy"), button:has-text("Copy codes"), [data-testid*="copy"]',
      downloadButton:
        'button:has-text("Download"), button:has-text("Download codes"), [data-testid*="download"]',
      continueButton:
        'button:has-text("Continue"), button:has-text("Done"), button:has-text("Close")',
      // "Regenerate Backup Codes" also renders as a cursor-pointer <div>.
      regenerateBackupCodesLink:
        'button:has-text("Regenerate Backup Codes"), a:has-text("Regenerate Backup Codes"), [data-testid*="regenerate"], :text-is("Regenerate Backup Codes")',
      alertText:
        'div:has-text("Copy or save this now"), div:has-text("these won\'t be shown again"), div:has-text("warning"), .MuiAlert-message'
    };

    this.qrModal = page.locator(this.selectors.qrModal).first();
    this.qrCode = page.locator(this.selectors.qrCode).first();
    this.manualEntryText = page.locator(this.selectors.manualEntryText).first();
    this.nextButton = page.locator(this.selectors.nextButton).first();
    this.completeButton = page.locator(this.selectors.completeButton).first();
    this.verifyButton = page.locator(this.selectors.verifyButton).first();
    this.disableConfirmButton = page.locator(this.selectors.disableConfirmButton).first();
    this.cancelButton = page.locator(this.selectors.cancelButton).first();
    this.switchMethodModal = page.locator(this.selectors.switchMethodModal).first();
    this.confirmationModal = page.locator(this.selectors.confirmationModal).first();
    this.codeInput = page.locator(this.selectors.codeInput).first();
    this.codeInputs = page.locator(this.selectors.codeInputs);
    this.backupCodeInputs = page.locator(this.selectors.backupCodeInputs);
    this.authenticatorCodeInputs = page.locator(this.selectors.authenticatorCodeInputs);
    this.errorMessage = page.locator(this.selectors.errorMessage).first();
    this.successToast = page.locator(this.selectors.successToast).first();
    this.mfaHeading = page.locator(this.selectors.mfaHeading).first();
    this.markAsTrustedButton = page.locator(this.selectors.markAsTrustedButton).first();
    this.resendButton = page.locator(this.selectors.resendButton).first();
    this.resendTimer = page.locator(this.selectors.resendTimer).first();
    this.recoveryCodesModal = page.locator(this.selectors.recoveryCodesModal).first();
    this.recoveryCodeGrid = page.locator(this.selectors.recoveryCodeGrid).first();
    this.copyButton = page.locator(this.selectors.copyButton).first();
    this.downloadButton = page.locator(this.selectors.downloadButton).first();
    this.continueButton = page.locator(this.selectors.continueButton).first();
    this.regenerateBackupCodesLink = page.locator(this.selectors.regenerateBackupCodesLink).first();
    this.alertText = page.locator(this.selectors.alertText).first();
  }

  getMethodRow(methodName) {
    // Scope to the single radiogroup row for this method (so an "Enabled" chip
    // is attributed to the right method). Falls back to a text match on older
    // builds without a radiogroup.
    const row = this.page
      .locator('[role="radiogroup"] > *, [class*="MuiFormControlLabel"], label')
      .filter({ hasText: methodName })
      .first();
    return row;
  }

  getMethodRadio(methodName) {
    // Scope to the single FormControlLabel row for this method, then take the
    // radio inside it. A bare `div:has-text(name) input[type=radio]` matches an
    // ancestor that wraps the WHOLE group, so `.first()` returns the first radio
    // (always "Authenticator App") regardless of which method was named — which
    // silently selects the wrong method. Scoping via getMethodRow() fixes that.
    return this.getMethodRow(methodName).locator('input[type="radio"]').first();
  }

  async selectMfaMethod(methodName) {
    const row = this.getMethodRow(methodName);
    await row.waitFor({ state: 'visible', timeout: 10000 });
    const radio = row.locator('input[type="radio"]').first();
    try {
      await radio.check({ force: true });
      if (await radio.isChecked()) return;
    } catch (_) {
      // Fall through and click the option row by its visible text (MUI often
      // hides the real <input>, so clicking the label toggles the radio).
    }
    await row.click();
  }

  async clickEnableMfa() {
    await this.click(this.page.locator(this.selectors.enableMfaButton).first());
  }

  async waitForQrModal() {
    await this.qrModal.waitFor({ state: 'visible', timeout: 15000 });
    await this.qrCode.waitFor({ state: 'visible', timeout: 15000 });
  }

  async getManualEntryString() {
    await this.qrModal.waitFor({ state: 'visible', timeout: 15000 });
    // The secret sits in its own element (typically <p>) inside the dialog.
    // Find the element whose trimmed text is *only* base32 chars (16-64 long)
    // so we don't accidentally pick up adjacent button text like "Copy code".
    //
    // Case-SENSITIVE on purpose: TOTP secrets are uppercase base32 (A-Z, 2-7),
    // e.g. "CFEFSIDFK4ZTMYLK". A case-insensitive test would also match
    // pure-letter UI copy — the heading "Set up Multifactor Authentication"
    // strips to "SetupMultifactorAuthentication" (30 chars), which precedes the
    // real secret in the DOM and would be returned instead, yielding a bogus
    // code and an "Incorrect Code" failure.
    const candidates = this.qrModal.locator('p, code, span, div');
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
      const text = ((await candidates.nth(i).textContent()) || '').replace(/\s+/g, '');
      if (/^[A-Z2-7]{16,64}$/.test(text)) {
        return text;
      }
    }
    // Fallback: return the full dialog text and let the regex try its luck.
    const dialogText = (await this.qrModal.textContent() || '').trim();
    if (dialogText) return dialogText;
    await this.manualEntryText.waitFor({ state: 'visible', timeout: 15000 });
    return (await this.manualEntryText.textContent() || '').trim();
  }

  async clickNext() {
    await this.click(this.nextButton);
  }

  isOnVerifyUrl() {
    return /\/mfa-verify/i.test(this.page.url());
  }

  /**
   * After an MFA login from a new device the app shows a "Do you want to trust
   * this device?" modal that intercepts clicks. Dismiss it with "No, Don't" so
   * the device stays untrusted (keeping MFA required and the Settings
   * untrusted-device banner visible). No-op when the prompt isn't present.
   */
  async dismissTrustDevicePromptIfPresent(timeout = 4000) {
    const button = this.page
      .locator(
        'div[role="dialog"]:has-text("trust this device") button:has-text("No"), ' +
          'button:has-text("No, Don")'
      )
      .first();
    try {
      await button.waitFor({ state: 'visible', timeout });
      await button.click();
      await this.page.waitForTimeout(500);
      return true;
    } catch {
      return false;
    }
  }

  async waitForVerificationScreen() {
    // Either the standalone /mfa-verify challenge page (login) or the in-settings
    // code modal. The 6-box digit input is common to both and is the real signal.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (this.isOnVerifyUrl()) break;
      if (await this.isVisible(this.mfaHeading)) break;
      await this.page.waitForTimeout(200);
    }
    await this.codeInput.waitFor({ state: 'visible', timeout: 15000 });
  }

  async enterVerificationCode(code) {
    const normalized = String(code).trim();
    if (!normalized) throw new Error('No verification code provided');
    const count = await this.codeInputs.count();
    if (count >= normalized.length && count >= 2) {
      for (let index = 0; index < normalized.length && index < count; index += 1) {
        const field = this.codeInputs.nth(index);
        await field.fill(normalized[index]);
      }
      return;
    }
    await this.click(this.codeInput);
    await this.codeInput.fill('');
    await this.codeInput.type(normalized);
  }

  async clickComplete() {
    await this.click(this.completeButton);
  }

  async clickVerify() {
    await this.click(this.verifyButton);
  }

  async clickCancel() {
    await this.click(this.cancelButton);
  }

  async isMethodEnabled(methodName) {
    // The radio's aria-label encodes per-method status: it contains "Enabled"
    // when active and "Recommended" otherwise. This is the only signal scoped to
    // a single method — the surrounding section text ("Enabled"/"Disable") is
    // shared, so a text-on-row check reports every method as enabled.
    const radio = this.getMethodRadio(methodName);
    try {
      await radio.waitFor({ state: 'attached', timeout: 5000 });
      const label = (await radio.getAttribute('aria-label')) || '';
      if (/enabled/i.test(label)) return true;
    } catch {
      // fall through to the chip check
    }
    // The radio's aria-label only refreshes on reload, so immediately after an
    // in-place enable/disable it can lag. The visible "Enabled" chip in the
    // method's own row is the authoritative live signal.
    const row = this.getMethodRow(methodName);
    return await this.isVisible(row.locator(this.selectors.enabledChip).first());
  }

  async isDisableButtonVisible(methodName) {
    // Only one method is enabled at a time and there is a single shared "Disable"
    // control, so it is available for `methodName` exactly when that method is on.
    if (!(await this.isMethodEnabled(methodName))) return false;
    return await this.isVisible(this.page.locator(this.selectors.disableButton).first());
  }

  async clickDisableButton() {
    await this.click(this.page.locator(this.selectors.disableButton).first());
  }

  async clickDisableConfirm() {
    // The "Turn off two factor authentication?" dialog → "Disable 2FA".
    if (await this.isVisible(this.disableConfirmButton)) {
      await this.click(this.disableConfirmButton);
      return true;
    }
    return false;
  }

  async waitForCodeInputs(timeout = 15000) {
    await this.codeInput.waitFor({ state: 'visible', timeout });
  }

  async clickFinalDisable() {
    // After the verification code is entered, the active dialog's primary button
    // reads "Disable" (distinct from the row-level "Disable" already clicked).
    const btn = this.page
      .locator('div[role="dialog"] button:has-text("Disable"), dialog button:has-text("Disable")')
      .first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
  }

  // ---- Backup recovery code path (disable + regenerate modals) ---------------
  //
  // Both the Disable and Regenerate code-entry modals show a "Use a backup code
  // instead" link that swaps the 6-digit authenticator input for 8 single-char
  // boxes (an xxxx-xxxx backup recovery code), and a reverse "Use authenticator
  // code instead" link.

  async isUseBackupCodeOptionVisible() {
    return await this.isVisible(this.page.locator(this.selectors.useBackupCodeLink).first());
  }

  async isUseAuthenticatorCodeOptionVisible() {
    return await this.isVisible(this.page.locator(this.selectors.useAuthenticatorCodeLink).first());
  }

  async clickUseBackupCodeInstead() {
    // Use the exact-text leaf element, not the union selector: a comma-union
    // resolved with .first() picks the earliest DOM match, which is the dialog
    // container (matched by the ancestor :has-text branch), so clicking it hits
    // dead-center (the input boxes) and never toggles. getByText(exact) targets
    // the smallest element with exactly this text — the actual link.
    const link = this.page.getByText('Use a backup code instead', { exact: true }).first();
    await link.waitFor({ state: 'visible', timeout: 10000 });
    await link.click();
    await this.backupCodeInputs.first().waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickUseAuthenticatorCodeInstead() {
    const link = this.page.getByText('Use authenticator code instead', { exact: true }).first();
    await link.waitFor({ state: 'visible', timeout: 10000 });
    await link.click();
    // The 6-digit authenticator boxes come back into view.
    await this.authenticatorCodeInputs.first().waitFor({ state: 'visible', timeout: 10000 });
  }

  async isBackupCodeEntryVisible() {
    if (
      await this.isVisible(
        this.page.locator('div[role="dialog"]:has-text("Enter backup code")').first()
      )
    ) {
      return true;
    }
    return await this.isVisible(this.backupCodeInputs.first());
  }

  async isAuthenticatorCodeEntryVisible() {
    if (
      await this.isVisible(
        this.page.locator('div[role="dialog"]:has-text("Enter authenticator code")').first()
      )
    ) {
      return true;
    }
    return await this.isVisible(this.authenticatorCodeInputs.first());
  }

  /**
   * Enters an 8-char backup recovery code into the per-character boxes. The
   * stored code is in "xxxx-xxxx" form, so the separator is stripped before the
   * 8 alphanumeric characters are distributed across the inputs.
   */
  async enterBackupCode(code) {
    const normalized = String(code).replace(/[^A-Za-z0-9]/g, '');
    if (!normalized) throw new Error('No backup recovery code provided');
    await this.backupCodeInputs.first().waitFor({ state: 'visible', timeout: 10000 });
    const count = await this.backupCodeInputs.count();
    if (count >= 2) {
      for (let i = 0; i < normalized.length && i < count; i += 1) {
        await this.backupCodeInputs.nth(i).fill(normalized[i]);
      }
      return;
    }
    // Single-field fallback for builds that use one input.
    await this.backupCodeInputs.first().fill(normalized);
  }

  async clickRegenerateConfirm() {
    // The Regenerate modal's submit button reads "Regenerate" (scoped to the
    // dialog so it can't match the settings-page "Regenerate Backup Codes" link).
    const btn = this.page
      .locator('div[role="dialog"] button:has-text("Regenerate"), dialog button:has-text("Regenerate")')
      .first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
  }

  async waitForMethodDisabled(timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const auth = await this.isMethodEnabled('Authenticator App');
      const email = await this.isMethodEnabled('Email Verification');
      if (!auth && !email) return true;
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  // Poll until a SPECIFIC method is no longer enabled. After a switch, the old
  // method's "Enabled" chip clears asynchronously once the new method's setup
  // flow takes over, so an instant isMethodEnabled() check races that handoff.
  async waitForMethodDeactivated(methodName, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!(await this.isMethodEnabled(methodName))) return true;
      await this.page.waitForTimeout(300);
    }
    return false;
  }

  async isCodeInputScreenVisible() {
    return await this.isVisible(this.codeInput);
  }

  async isOnMfaVerificationScreen() {
    if (this.isOnVerifyUrl()) return true;
    return await this.isVisible(this.mfaHeading) && await this.isCodeInputScreenVisible();
  }

  /**
   * True when the current MFA challenge is the EMAIL variant (vs Authenticator).
   * The email challenge shows a "Resend" control / countdown and a masked email;
   * the authenticator challenge has neither. Used to decide whether to clear a
   * login challenge with an emailed code or a TOTP.
   */
  async isEmailChallenge() {
    if (await this.isResendButtonVisible()) return true;
    if (await this.isResendTimerVisible()) return true;
    const body = await this.page.locator('body').innerText().catch(() => '');
    return /\*{2,}[^@\s]*@/.test(body) || /resend|sent (a )?code.*email|check your email/i.test(body);
  }

  async isErrorVisible() {
    return await this.isVisible(this.errorMessage);
  }

  /**
   * Code submission is async — the dialog button shows "Verifying..." while the
   * server validates, so an immediate isErrorVisible() check races the response
   * and reads false. Poll until an error surfaces (or the timeout lapses).
   */
  async waitForError(timeout = 12000) {
    // Let any in-flight submit settle FIRST. While the server validates, the
    // dialog button reads "Verifying..."/"Disabling..."; checking before it
    // resolves races the response and — worse — the old broad isErrorVisible()
    // matched the persistent untrusted-device [role="alert"] banner, returning a
    // false "error" before the real verdict rendered. Wait for that spinner
    // state to clear, then require FAILURE-SPECIFIC wording: hasFailureMessage
    // matches the red "Incorrect Code"/"Invalid Code" helper (.Mui-error) but NOT
    // the banner, which contains no failure text.
    await this.page
      .locator('div[role="dialog"] button:has-text("Verifying"), div[role="dialog"] button:has-text("Disabling")')
      .first()
      .waitFor({ state: 'hidden', timeout: Math.min(timeout, 8000) })
      .catch(() => {});
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.hasFailureMessage()) return true;
      await this.page.waitForTimeout(250);
    }
    return await this.hasFailureMessage();
  }

  // ---- Rate limiting (MFA verify endpoint) -----------------------------------

  /**
   * Waits for any in-flight verify submit to settle. While the server validates,
   * the primary button reads "Verifying..."/"Logging in..."; checking the
   * outcome before it resolves races the response. No-op if no spinner appears.
   */
  async waitForSubmitSettled(timeout = 12000) {
    // In-flight signals differ by surface: settings/dialog buttons swap their
    // label to "Verifying…"; the standalone login OTP challenge KEEPS the
    // "Log in" label but disables the button and shows a spinner
    // (MuiCircularProgress) inside it. Wait for whichever is present to clear;
    // no-op if none appear.
    await this.page
      .locator(
        'button:has-text("Verifying"), div[role="dialog"] button:has-text("Verifying"), ' +
          'button:has-text("Logging in"), button:has-text("Please wait"), ' +
          'button[type="submit"]:has(.MuiCircularProgress-root)'
      )
      .first()
      .waitFor({ state: 'hidden', timeout })
      .catch(() => {});
  }

  /**
   * Clicks the verify/submit button ONLY when it is present and enabled. The
   * login OTP challenge auto-submits the moment the 6th digit is filled, leaving
   * the button disabled and spinning — blindly clicking it (the old behaviour)
   * blocks until the action times out and tore the context down. Returns true if
   * a click was actually issued.
   */
  async clickVerifyIfEnabled() {
    const btn = this.verifyButton;
    try {
      if ((await btn.isVisible({ timeout: 800 })) && (await btn.isEnabled())) {
        await btn.click({ timeout: 4000 });
        return true;
      }
    } catch {
      /* missing / disabled / detached — auto-submit carries the request */
    }
    return false;
  }

  async isRateLimitErrorVisible() {
    return await this.isVisible(this.page.locator(this.selectors.rateLimitMessage).first());
  }

  /**
   * Polls until the throttle/rate-limit message surfaces (it can render a beat
   * after the submit resolves). Returns false on timeout.
   */
  async waitForRateLimitError(timeout = 12000) {
    await this.waitForSubmitSettled(Math.min(timeout, 8000));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.isRateLimitErrorVisible()) return true;
      await this.page.waitForTimeout(250);
    }
    return await this.isRateLimitErrorVisible();
  }

  /** Returns the visible throttle message text (empty string if none). */
  async getRateLimitMessage() {
    const loc = this.page.locator(this.selectors.rateLimitMessage).first();
    if (await this.isVisible(loc)) {
      return ((await loc.textContent()) || '').trim();
    }
    // Fallback: scrape the body for the throttle sentence.
    const body = await this.page.locator('body').innerText().catch(() => '');
    const match = body.match(/too many (?:requests|attempts)[^]*?(?:second|minute)s?\b\.?/i);
    return match ? match[0].trim() : '';
  }

  /**
   * Submits a code on the verification screen and classifies the server's
   * response. 'rate-limited' = throttle message shown; 'rejected' = ordinary
   * invalid-code failure; 'accepted' = the challenge cleared (left the screen);
   * 'unknown' = none of the above settled in time.
   */
  async submitCodeAndClassify(code) {
    await this.enterVerificationCode(code);
    // Filling the final box auto-submits on the login challenge; for surfaces
    // that don't auto-submit, click the button when it's enabled. Either way we
    // never block on a disabled in-flight button.
    await this.page.waitForTimeout(300);
    await this.clickVerifyIfEnabled();
    await this.waitForSubmitSettled();
    // Poll for the outcome — the response (and any throttle banner) can land a
    // beat after the spinner clears.
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await this.isRateLimitErrorVisible()) return 'rate-limited';
      if (await this.hasFailureMessage()) return 'rejected';
      if (!(await this.isOnMfaVerificationScreen())) return 'accepted';
      await this.page.waitForTimeout(300);
    }
    return 'unknown';
  }

  async hasSuccessToast(message) {
    // A visible failure message vetoes success: the alert/toast containers are
    // shared across severities, so never report success while an error is shown.
    if (await this.hasFailureMessage()) return false;
    if (!await this.isVisible(this.successToast)) return false;
    if (!message) return true;
    return (await this.successToast.textContent() || '').includes(message);
  }

  async waitForVerificationSuccess(timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // Recovery-codes modal (Authenticator activation) or a success toast
      // (Email activation) are the real success signals.
      if (await this.isRecoveryCodesModalVisible()) return true;
      if (await this.hasSuccessToast()) return true;
      // Per-method "Enabled" chip, scoped to the method's own row via
      // isMethodEnabled — NOT a page-wide :has-text("Enabled"), which any stray
      // copy elsewhere on the page would satisfy and false-pass.
      if (await this.isMethodEnabled('Authenticator App')) return true;
      if (await this.isMethodEnabled('Email Verification')) return true;
      // Only an *explicit* failure message aborts. A bare [role=alert] is too
      // broad — success states use it too — so require failure-specific wording.
      if (await this.hasFailureMessage()) return false;
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  async hasFailureMessage() {
    const failure = this.page
      .locator(
        '.MuiFormHelperText-root.Mui-error, ' +
          ':text-matches("invalid|incorrect|failed|wrong|expired|does not match|didn\'t match", "i")'
      )
      .first();
    return await this.isVisible(failure);
  }

  async waitForModalClosed() {
    await expect(this.qrModal).not.toBeVisible({ timeout: 15000 }).catch(() => {});
    await expect(this.recoveryCodesModal).not.toBeVisible({ timeout: 15000 }).catch(() => {});
    await expect(this.confirmationModal).not.toBeVisible({ timeout: 15000 }).catch(() => {});
  }

  async isSwitchMethodModalVisible() {
    return await this.isVisible(this.switchMethodModal);
  }

  /**
   * Opens the "Switch multi-factor authentication method" confirmation modal.
   * The live app does NOT surface it on radio-selection alone — selecting a
   * different method while one is enabled relabels the primary button to
   * "Switch MFA", and clicking THAT opens the modal. No-op (returns false) when
   * the button isn't present, e.g. during a fresh enable where it reads
   * "Enable MFA" and is driven by its own step.
   */
  async openSwitchMethodModal(timeout = 8000) {
    const btn = this.page.locator(this.selectors.switchMfaButton).first();
    if (!(await this.isVisible(btn))) return false;
    await btn.click();
    await this.switchMethodModal.waitFor({ state: 'visible', timeout }).catch(() => {});
    return await this.isSwitchMethodModalVisible();
  }

  async clickSwitchMethodProceed() {
    // Scope the button search to the modal LOCATOR (not via string concat).
    // switchMethodModal is a comma-separated selector list, so appending
    // " button:has-text(...)" only binds the descendant combinator to the LAST
    // clause — the earlier clauses still match the modal <div> itself, and
    // .first() then returns that div instead of the button. Clicking the div is
    // a no-op: the modal stays open and the switch never fires. Nesting via
    // .locator() applies the button filter inside the already-resolved modal.
    const button = this.switchMethodModal
      .locator('button:has-text("Proceed"), button:has-text("Continue"), button:has-text("Confirm")')
      .first();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
  }

  async clickSwitchMethodCancel() {
    const button = this.page.locator(`${this.selectors.switchMethodModal} button:has-text("Cancel"), ${this.selectors.switchMethodModal} button:has-text("Dismiss")`).first();
    if (await this.isVisible(button)) {
      await button.click();
    }
  }

  // Second step of the switch flow. Clicking "Proceed" does NOT deactivate the
  // old method on its own — the live app gates the switch behind an email-OTP
  // identity check, opening a "Verify your identity to switch method" dialog
  // that emails a 6-digit code. The switch only completes (old method off, new
  // method's setup begun) once that code is entered and "Switch" is clicked.
  get switchVerifyModal() {
    return this.page
      .locator(
        'div[role="dialog"]:has-text("Verify your identity to switch method"), ' +
        'div:has-text("Verify your identity to switch method")'
      )
      .first();
  }

  async isSwitchVerifyModalVisible() {
    return await this.isVisible(this.switchVerifyModal);
  }

  async clickSwitchVerifyConfirm() {
    // Scope the button to the modal LOCATOR (see clickSwitchMethodProceed for
    // why string-concatenating onto a comma-separated selector list misfires).
    // This dialog's primary action reads "Switch".
    const button = this.switchVerifyModal
      .locator('button:has-text("Switch"), button:has-text("Verify"), button:has-text("Confirm")')
      .first();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
    // The click flips the button to "Switching…" while the backend deactivates
    // the old method and provisions the new one. Wait for this dialog to close
    // before returning — otherwise the next assertion races the in-flight switch
    // and still sees the old method enabled. The modal text is switch-specific,
    // so it won't match the new method's setup dialog that opens afterwards.
    await this.switchVerifyModal.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }

  async isUntrustedDeviceBannerVisible() {
    return await this.isVisible(this.page.locator(this.selectors.untrustedBanner).first());
  }

  async isMarkAsTrustedVisible() {
    return await this.isVisible(this.markAsTrustedButton);
  }

  async clickMarkAsTrusted() {
    await this.click(this.markAsTrustedButton);
  }

  async isResendButtonVisible() {
    return await this.isVisible(this.resendButton);
  }

  async isResendButtonEnabled() {
    const btn = this.resendButton;
    if (!(await this.isVisible(btn))) return false;
    try {
      // A real <button> exposes the disabled property directly.
      const tag = await btn.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
      if (tag === 'button') return await btn.isEnabled();
      // A div/anchor control signals "disabled during countdown" via
      // aria-disabled / a disabled attr / pointer-events:none, and its label
      // carries the countdown ("Resend in 0:59") until it re-enables to a bare
      // "Resend". Treat it as enabled only when none of those hold.
      return await btn.evaluate((el) => {
        const cs = getComputedStyle(el);
        const blocked =
          el.getAttribute('aria-disabled') === 'true' ||
          el.hasAttribute('disabled') ||
          cs.pointerEvents === 'none';
        const counting = /\d/.test((el.textContent || '').replace(/resend/i, ''));
        return !blocked && !counting;
      }).catch(() => false);
    } catch {
      return false;
    }
  }

  async isResendTimerVisible() {
    return await this.isVisible(this.resendTimer);
  }

  /**
   * Polls until the Resend control is both visible AND enabled (the 1-minute
   * countdown keeps it disabled until it elapses). Returns false on timeout.
   */
  async waitForResendEnabled(timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (
        (await this.isResendButtonVisible()) &&
        (await this.isResendButtonEnabled())
      ) {
        return true;
      }
      await this.page.waitForTimeout(1000);
    }
    return false;
  }

  async clickResendCode() {
    await this.click(this.resendButton);
  }

  async isRecoveryCodesModalVisible() {
    return await this.isVisible(this.recoveryCodesModal);
  }

  // After clicking "Complete", the authenticator code is verified server-side
  // (the button shows "Verifying...") before the Recovery Codes modal renders.
  // Poll until it appears so the assertion doesn't fire mid-handshake.
  async waitForRecoveryCodesModal(timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.isRecoveryCodesModalVisible()) return true;
      if (await this.hasFailureMessage()) return false;
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  async getRecoveryCodes() {
    if (!await this.isRecoveryCodesModalVisible()) return [];
    const entries = await this.recoveryCodesModal.locator(this.selectors.recoveryCodeItem).allTextContents();
    // Codes look like "wu95-2577" (two short alphanumeric groups). Filter to that
    // shape so we ignore wrapper/heading text, and de-dupe nested matches.
    const codePattern = /^[a-z0-9]{3,8}-[a-z0-9]{3,8}$/i;
    const codes = entries
      .map((text) => String(text || '').trim())
      .filter((text) => codePattern.test(text));
    return Array.from(new Set(codes));
  }

  async clickDownloadRecoveryCodes() {
    await this.click(this.downloadButton);
  }

  async clickCopyRecoveryCodes() {
    await this.click(this.copyButton);
  }

  async clickRecoveryCodesContinue() {
    await this.click(this.continueButton);
  }

  async isRegenerateBackupCodesVisible() {
    return await this.isVisible(this.regenerateBackupCodesLink);
  }

  async clickRegenerateBackupCodes() {
    await this.click(this.regenerateBackupCodesLink);
  }

  async confirmationModalHasText(text) {
    const dialog = this.page.locator(this.selectors.confirmationModal).first();
    if (!await this.isVisible(dialog)) return false;
    return (await dialog.textContent() || '').includes(text);
  }
}

module.exports = { MfaPage };
