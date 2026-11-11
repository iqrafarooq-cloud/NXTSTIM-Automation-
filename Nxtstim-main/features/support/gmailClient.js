/**
 * gmailClient.js — Gmail IMAP adapter for emailHelper.
 *
 * Returns emails in the same shape as testApi.getLatestEmail:
 *   { subject, body, sentAt, from, to }
 * so emailHelper.waitForLatestEmail can poll against Gmail without changing
 * its filter/extraction logic.
 *
 * Auth: GMAIL_USER + GMAIL_APP_PASSWORD (16-char Google App Password, NOT
 * the account password — see https://myaccount.google.com/apppasswords).
 *
 * Addressing modes supported:
 *   1) Gmail plus-aliasing — "name+tag@gmail.com" lands in name@gmail.com's
 *      INBOX. Search by `to:"name+tag@gmail.com"` matches.
 *   2) Anonaddy aliases forwarded to Gmail — "qa-foo@iqra.anonaddy.com"
 *      arrives with the alias preserved on the To: header AND echoed into
 *      headers like Delivered-To / X-Anonaddy-Original-To. The primary
 *      `to:` search covers the first; we OR a body search to catch the
 *      second when a provider strips/rewrites To: en route.
 */

const { ImapFlow } = require('imapflow');

const HOST = 'imap.gmail.com';
const PORT = 993;

function getCreds() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'gmailClient: GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env. ' +
        'Generate an App Password at https://myaccount.google.com/apppasswords ' +
        '(2-Step Verification must be enabled first).'
    );
  }
  return { user, pass };
}

function isConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function newClient() {
  const { user, pass } = getCreds();
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user, pass },
    logger: false
  });
}

function plainTextFromMessage(msg) {
  if (msg.bodyParts) {
    for (const buf of msg.bodyParts.values()) {
      if (buf) return buf.toString('utf8');
    }
  }
  if (msg.source) return msg.source.toString('utf8');
  return '';
}

/**
 * Fetches the most recent message addressed to `email` and returns it in the
 * canonical shape emailHelper expects. Returns null if no matching message
 * exists yet (caller polls).
 *
 * Uses Gmail's `to:` search so plus-aliases (name+tag@gmail.com) resolve to
 * the same physical inbox but remain individually addressable.
 */
async function searchUids(client, email) {
  // Primary: To: header preserved (Gmail plus-aliases + most Anonaddy
  // forwarders).
  let uids = await client.search({ to: email }, { uid: true });
  if (uids && uids.length) return uids;
  // Fallback: scan body text for the alias. Catches the case where a
  // forwarder rewrites To: to the destination Gmail address and only
  // surfaces the original alias in a Delivered-To-style preamble that
  // ends up in the body of the resulting message.
  try {
    uids = await client.search({ body: email }, { uid: true });
    if (uids && uids.length) return uids;
  } catch {
    // Some IMAP servers reject BODY searches on certain folders; ignore.
  }
  return [];
}

async function getLatestEmail(email) {
  const client = newClient();
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await searchUids(client, email);
      if (!uids || uids.length === 0) return null;

      const latestUid = uids[uids.length - 1];
      const msg = await client.fetchOne(
        latestUid,
        { envelope: true, source: true, bodyStructure: true },
        { uid: true }
      );
      if (!msg) return null;

      const env = msg.envelope || {};
      const subject = env.subject || '';
      const sentAt = env.date ? new Date(env.date).toISOString() : null;
      const from =
        env.from && env.from[0]
          ? env.from[0].address || ''
          : '';
      const to =
        env.to && env.to[0]
          ? env.to[0].address || ''
          : '';
      const body = plainTextFromMessage(msg);

      return { subject, body, sentAt, from, to };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { /* ignore */ });
  }
}

module.exports = {
  getLatestEmail,
  isConfigured
};
