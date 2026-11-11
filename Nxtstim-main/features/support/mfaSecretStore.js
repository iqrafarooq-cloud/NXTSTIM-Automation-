const fs = require('fs');
const path = require('path');

/**
 * mfaSecretStore — persists the Authenticator-App TOTP secret and the
 * one-time recovery codes between runs.
 *
 * Why this exists
 * ---------------
 * Once the test account has Authenticator-App MFA enabled, every fresh login
 * hits the `/mfa-verify` challenge. To get past it the suite must generate a
 * valid TOTP, which requires the base32 secret shown (only once) on the QR
 * setup modal. We capture that secret the moment it appears and write it here
 * so subsequent runs — and the login challenge itself — can re-derive codes
 * without re-running the enable flow.
 *
 * Follows the repo's per-flow artifact convention: files live under
 * `artifacts/mfa/` and are overwritten in place.
 */
const SECRET_DIR = path.resolve(process.cwd(), 'artifacts', 'mfa');
const SECRET_FILE = path.join(SECRET_DIR, 'totp-secret.txt');
const RECOVERY_FILE = path.join(SECRET_DIR, 'recovery-codes.txt');

function ensureDir() {
  fs.mkdirSync(SECRET_DIR, { recursive: true });
}

function saveSecret(secret) {
  const value = String(secret || '').trim();
  if (!value) return;
  ensureDir();
  fs.writeFileSync(SECRET_FILE, value, 'utf8');
}

function loadSecret() {
  try {
    const value = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function saveRecoveryCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return;
  ensureDir();
  fs.writeFileSync(RECOVERY_FILE, codes.join('\n') + '\n', 'utf8');
}

function loadRecoveryCodes() {
  try {
    return fs
      .readFileSync(RECOVERY_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Pops the first stored recovery code and rewrites the file with the rest.
 * Recovery codes are single-use, so callers must not reuse a returned code.
 * Returns null when none remain.
 */
function takeRecoveryCode() {
  const codes = loadRecoveryCodes();
  if (codes.length === 0) return null;
  const [code, ...rest] = codes;
  ensureDir();
  fs.writeFileSync(RECOVERY_FILE, rest.length ? rest.join('\n') + '\n' : '', 'utf8');
  return code;
}

module.exports = {
  SECRET_FILE,
  RECOVERY_FILE,
  saveSecret,
  loadSecret,
  saveRecoveryCodes,
  loadRecoveryCodes,
  takeRecoveryCode
};
