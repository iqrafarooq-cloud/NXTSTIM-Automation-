/**
 * mfaChallenge.js — self-healing for the login-time MFA challenge.
 *
 * Some suites (e.g. change-password) are written for a "plain" account but end
 * up pointed at an account that has Authenticator-App MFA enabled. Rather than
 * failing the whole run when the `/mfa-verify` challenge appears, this helper
 * transparently clears it: it derives a valid TOTP from the secret captured by
 * the MFA suite (artifacts/mfa/totp-secret.txt via mfaSecretStore), submits it,
 * dismisses the "trust this device?" prompt, and lets the caller continue.
 *
 * It is a no-op when no challenge is present, so callers can invoke it
 * unconditionally right after a login submit.
 *
 * Scope: Authenticator App (TOTP) only. If the account presents an EMAIL
 * challenge, it throws an actionable error rather than silently hanging — email
 * self-healing would need the inbox stack (emailHelper) and is intentionally
 * left out of this lightweight helper.
 *
 * The TOTP primitives are duplicated (not imported) from mfa.steps.js on
 * purpose: they are ~40 lines of pure `crypto`, and duplicating them keeps this
 * helper standalone so requiring it never drags in the entire MFA step file.
 */

const crypto = require('crypto');
const mfaSecretStore = require('./mfaSecretStore');

const TOTP_STEP_SECONDS = 30;

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

function generateTotp(secret, digits = 6, step = TOTP_STEP_SECONDS, time = Math.floor(Date.now() / 1000)) {
  const key = decodeBase32(secret);
  if (key.length === 0) {
    throw new Error(`Unable to decode TOTP secret '${secret}'.`);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / step)), 0);
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

/** True if the app is currently sitting on the login MFA challenge. */
async function isOnMfaChallenge(world) {
  const mfa = world.pages.mfa;
  if (!mfa) return false;
  if (mfa.isOnVerifyUrl && mfa.isOnVerifyUrl()) return true;
  return await mfa.isCodeInputScreenVisible().catch(() => false);
}

/**
 * If a login MFA challenge is present, clear it with the stored Authenticator
 * TOTP secret. Returns true if it acted, false if there was no challenge.
 * Retries once across a fresh TOTP window to survive a same-window replay
 * rejection or a code that expired mid-submit.
 */
async function completeLoginMfaChallengeIfPresent(world) {
  const mfa = world.pages.mfa;
  // Give the SPA a moment to route to /mfa-verify after the login submit.
  await world.page.waitForTimeout(1500);
  if (!(await isOnMfaChallenge(world))) return false;

  if (await mfa.isEmailChallenge().catch(() => false)) {
    throw new Error(
      'Login presented an EMAIL MFA challenge, but mfaChallenge self-healing only ' +
      'handles Authenticator App (TOTP). Switch the account to Authenticator App, ' +
      'or extend mfaChallenge.js to read the emailed code.'
    );
  }

  const secret = mfaSecretStore.loadSecret();
  if (!secret) {
    throw new Error(
      'A login MFA challenge appeared but no TOTP secret is stored in ' +
      'artifacts/mfa/totp-secret.txt. Run the MFA enable flow (npm run test:mfa) ' +
      'against this account first so the secret is captured, then re-run.'
    );
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    await mfa.enterVerificationCode(generateTotp(secret));
    await mfa.clickVerify();
    await world.page.waitForTimeout(2000);
    if (!(await isOnMfaChallenge(world))) {
      await mfa.dismissTrustDevicePromptIfPresent().catch(() => {});
      return true;
    }
    // Still challenged: the code may have been reused within its window or
    // expired at the boundary. Wait into the NEXT window and try once more.
    const secondsIntoStep = (Date.now() / 1000) % TOTP_STEP_SECONDS;
    await world.page.waitForTimeout(Math.ceil((TOTP_STEP_SECONDS - secondsIntoStep + 1) * 1000));
  }

  throw new Error(
    'MFA self-healing failed: the Authenticator code was rejected twice. The stored ' +
    'secret in artifacts/mfa/totp-secret.txt is likely stale for this account — ' +
    're-run the MFA enable flow to refresh it.'
  );
}

module.exports = { completeLoginMfaChallengeIfPresent, isOnMfaChallenge, generateTotp };
