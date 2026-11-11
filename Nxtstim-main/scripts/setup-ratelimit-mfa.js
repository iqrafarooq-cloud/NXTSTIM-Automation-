/**
 * setup-ratelimit-mfa.js — one-time setup for the @RateLimit scenario.
 *
 * Ensures the dedicated rate-limit account (RATE_LIMIT_USER_EMAIL) has MFA
 * enabled so the `/mfa-verify` challenge appears for the rate-limit test. If a
 * method is already enabled it reports and exits; otherwise it enables
 * Authenticator-App MFA via the real UI handshake (capturing + persisting the
 * TOTP secret and recovery codes to artifacts/mfa, exactly like the suite does).
 *
 * Dev-only utility — NOT part of the cucumber run. Usage:
 *   node scripts/setup-ratelimit-mfa.js
 */
const crypto = require('crypto');
const { chromium } = require('playwright');
const { loadDotenv } = require('../features/support/env');
const { LoginPage } = require('../features/pages/LoginPage');
const { DashboardPage } = require('../features/pages/DashboardPage');
const { SettingsPage } = require('../features/pages/SettingsPage');
const { MfaPage } = require('../features/pages/MfaPage');
const mfaSecretStore = require('../features/support/mfaSecretStore');

loadDotenv();

const EMAIL = process.env.RATE_LIMIT_USER_EMAIL || 'ratelimit@iqra.anonaddy.com';
const PASSWORD = process.env.RATE_LIMIT_USER_PASSWORD || 'StrongPass123!';

// --- Self-contained TOTP (mirrors features/step_definitions/mfa.steps.js) -----
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

function generateTotp(secret, digits = 6, step = 30, time = Math.floor(Date.now() / 1000)) {
  const key = decodeBase32(secret);
  if (key.length === 0) throw new Error(`Unable to decode TOTP secret '${secret}'.`);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / step)), 0);
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

function extractTotpSecret(rawText) {
  if (!rawText) return null;
  const uriMatch = rawText.match(/otpauth:\/\/totp\/[^?]+\?([^#\s]+)/i);
  if (uriMatch) {
    const query = new URLSearchParams(uriMatch[1]);
    if (query.get('secret')) return query.get('secret');
  }
  const secretLabel =
    rawText.match(/secret\s*[:=]\s*([A-Z2-7\s]+)$/i) || rawText.match(/secret\s*[:=]\s*([A-Z2-7\s]+)/i);
  if (secretLabel) return normalizeSecret(secretLabel[1]);
  const bare = rawText.match(/([A-Z2-7]{16,})/i);
  if (bare) return normalizeSecret(bare[1]);
  return null;
}

(async () => {
  const headed = process.env.HEADED !== 'false';
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 50 : 0 });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  const login = new LoginPage(page);
  const dashboard = new DashboardPage(page);
  const settings = new SettingsPage(page);
  const mfa = new MfaPage(page);

  const log = (...a) => console.log('[setup-ratelimit-mfa]', ...a);

  try {
    log(`Account: ${EMAIL}`);
    await login.open();
    await login.login(EMAIL, PASSWORD);
    await page.waitForTimeout(2500);

    // If login routed straight to the MFA challenge, a method is already active.
    if (mfa.isOnVerifyUrl() || (await mfa.isOnMfaVerificationScreen().catch(() => false))) {
      log('MFA is ALREADY enabled (login hit the /mfa-verify challenge). Nothing to do.');
      log('Ready for the @RateLimit scenario.');
      return;
    }

    // Otherwise we should be on the dashboard with no MFA — go enable it.
    await dashboard.waitForReady().catch(() => {});
    await mfa.dismissTrustDevicePromptIfPresent(2000).catch(() => {});
    await dashboard.openProfileMenu();
    await settings.clickSettingsMenuItem();
    await page.waitForTimeout(1000);

    if (
      (await mfa.isMethodEnabled('Authenticator App')) ||
      (await mfa.isMethodEnabled('Email Verification'))
    ) {
      log('MFA already enabled in Settings. Nothing to do — ready for @RateLimit.');
      return;
    }

    log('No MFA method enabled — enabling Authenticator App…');
    await mfa.selectMfaMethod('Authenticator App');
    await mfa.clickEnableMfa();
    await mfa.waitForQrModal();

    const secret = extractTotpSecret(await mfa.getManualEntryString());
    if (!secret) throw new Error('Could not read the TOTP secret off the QR setup modal.');
    mfaSecretStore.saveSecret(secret);
    log(`Captured TOTP secret (saved to ${mfaSecretStore.SECRET_FILE}).`);

    await mfa.clickNext();
    await mfa.waitForVerificationScreen();
    await mfa.enterVerificationCode(generateTotp(secret));
    await mfa.clickComplete();

    const ok = await mfa.waitForVerificationSuccess();
    if (!ok) throw new Error('Authenticator activation did not confirm (no success/recovery modal).');

    const codes = await mfa.getRecoveryCodes();
    if (codes.length) {
      mfaSecretStore.saveRecoveryCodes(codes);
      log(`Captured ${codes.length} recovery codes (saved to ${mfaSecretStore.RECOVERY_FILE}).`);
    }
    await mfa.clickRecoveryCodesContinue().catch(() => {});

    const enabled = await mfa.isMethodEnabled('Authenticator App');
    log(enabled ? 'Authenticator App MFA is now ENABLED.' : 'WARNING: could not confirm Enabled chip.');
    log('Ready for the @RateLimit scenario.');
  } catch (err) {
    console.error('[setup-ratelimit-mfa] FAILED:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    await page.waitForTimeout(1000);
    await context.close();
    await browser.close();
  }
})();
