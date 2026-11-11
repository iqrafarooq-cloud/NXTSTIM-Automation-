/**
 * probe-gmail.js — smoke test for the Gmail IMAP adapter.
 *
 * Run with:
 *   node scripts/probe-gmail.js
 *   node scripts/probe-gmail.js someone+tag@gmail.com
 *
 * What it does:
 *   1. Loads .env (GMAIL_USER, GMAIL_APP_PASSWORD).
 *   2. Connects to imap.gmail.com via gmailClient.
 *   3. Fetches the most recent email addressed to <target> (defaults to
 *      GMAIL_USER itself) and prints subject + first 200 chars of body.
 *
 * Use this BEFORE running the Cucumber suite to confirm credentials work.
 * If you see "AUTHENTICATIONFAILED Invalid credentials", your App Password
 * is wrong — regenerate at https://myaccount.google.com/apppasswords.
 */

const path = require('path');
const { loadDotenv } = require(path.resolve(__dirname, '..', 'features', 'support', 'env'));
loadDotenv();

const gmailClient = require(path.resolve(__dirname, '..', 'features', 'support', 'gmailClient'));

async function main() {
  if (!gmailClient.isConfigured()) {
    console.error('[probe-gmail] GMAIL_USER / GMAIL_APP_PASSWORD missing from .env');
    process.exit(1);
  }

  const target = process.argv[2] || process.env.GMAIL_USER;
  console.log(`[probe-gmail] looking up latest email to: ${target}`);

  const start = Date.now();
  try {
    const mail = await gmailClient.getLatestEmail(target);
    const ms = Date.now() - start;
    if (!mail) {
      console.log(`[probe-gmail] connected OK (${ms}ms) — no email found for ${target}`);
      console.log('[probe-gmail] send yourself a test mail and re-run.');
      return;
    }
    console.log(`[probe-gmail] OK (${ms}ms)`);
    console.log(`  from:    ${mail.from}`);
    console.log(`  to:      ${mail.to}`);
    console.log(`  sentAt:  ${mail.sentAt}`);
    console.log(`  subject: ${mail.subject}`);
    const preview = (mail.body || '').replace(/\s+/g, ' ').slice(0, 200);
    console.log(`  body:    ${preview}${(mail.body || '').length > 200 ? '...' : ''}`);
  } catch (err) {
    console.error(`[probe-gmail] FAILED after ${Date.now() - start}ms`);
    console.error(`  ${err.message}`);
    if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(err.message)) {
      console.error('  Hint: regenerate App Password at https://myaccount.google.com/apppasswords');
      console.error('  (2-Step Verification must be ON for the account to expose App Passwords.)');
    }
    process.exit(1);
  }
}

main();
