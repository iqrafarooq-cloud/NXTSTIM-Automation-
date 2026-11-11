/**
 * passwordStore.js — single source of truth for the change-password suite's
 * account credentials.
 *
 * The change-password flow inherently MUTATES the account password, and the QA
 * backend both (a) blocks reusing any of the last 5 passwords and (b) cannot
 * delete users, so a fixed hardcoded password would break on the second run.
 * To stay re-runnable, the suite uses ONE dedicated account (CHGPWD_UI_EMAIL)
 * and rotates its password to a fresh, never-before-used value whenever a
 * scenario changes it — persisting the new value back to `.env` (and live
 * `process.env`) so the next step, scenario, and run all pick it up.
 *
 * No emails or passwords are hardcoded anywhere in the feature/steps: the email
 * and the current password come from `.env`, and every new password is generated.
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(process.cwd(), '.env');
const EMAIL_KEY = 'CHGPWD_UI_EMAIL';
const PWD_KEY = 'CHGPWD_UI_PASSWORD';

function getEmail() {
  const email = process.env[EMAIL_KEY];
  if (!email) {
    throw new Error(`${EMAIL_KEY} is not set in .env — required by the change-password suite.`);
  }
  return email;
}

function getCurrentPassword() {
  const pwd = process.env[PWD_KEY];
  if (!pwd) {
    throw new Error(`${PWD_KEY} is not set in .env — required by the change-password suite.`);
  }
  return pwd;
}

/**
 * A password that always satisfies the app's complexity rules (>=1 upper, >=1
 * lower, >=1 digit, >=1 special, 8–64 chars) and is unique per call, so it can
 * never collide with the account's last-5 history. Uniqueness comes from the
 * millisecond clock plus a random suffix; the fixed "Nx…!@A9" scaffold
 * guarantees every character class is present regardless of the random parts.
 */
function generatePassword() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `Nx${ts}${rand}!@A9`;
}

/**
 * Set an arbitrary .env var: update live process.env immediately (so the rest of
 * this run sees it) and rewrite the `.env` line (so future runs do too). A
 * failure to write the file is non-fatal — the in-memory value still updates.
 */
function updateEnvVar(key, value) {
  process.env[key] = value;
  try {
    let text = fs.readFileSync(ENV_PATH, 'utf8');
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
    fs.writeFileSync(ENV_PATH, text);
  } catch {
    /* .env not writable in this environment — in-memory value is still updated */
  }
}

/** Record a new CURRENT password for the change-password account. */
function setCurrentPassword(newPassword) {
  updateEnvVar(PWD_KEY, newPassword);
}

module.exports = { getEmail, getCurrentPassword, generatePassword, setCurrentPassword, updateEnvVar };
