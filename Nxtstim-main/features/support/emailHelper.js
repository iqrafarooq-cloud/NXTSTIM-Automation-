/**
 * emailHelper.js — body-level email inspection on top of testApi.getLatestEmail.
 *
 * testApi already exposes canonical link endpoints (getResetLink, etc.) that
 * return what the backend issued. This helper is the *other* side of the
 * assertion — it pulls the rendered email and parses what the user actually
 * receives, so feature steps like "the email body should contain a valid
 * reset link" or "the email should contain the NXTSTIM logo and copyright
 * footer" can verify the email itself rather than the issuing record.
 *
 * Zero new deps — regex on the body string, works for HTML and plain text.
 * Polling is built on testApi.getLatestEmail; we don't talk to IMAP/Anonaddy
 * directly. The test backend is the source of truth.
 */

const testApi = require('./testApi');
const gmailClient = require('./gmailClient');
const emailTypes = require('./emailTypes');

// Source selector: when GMAIL_USER + GMAIL_APP_PASSWORD are set, read mail
// straight from Gmail via IMAP; otherwise fall back to the test backend.
// This keeps the rest of the helper unchanged — both adapters return the
// same { subject, body, sentAt, ... } shape.
function pickMailSource() {
  return gmailClient.isConfigured() ? gmailClient : testApi;
}

// ---- Polling -------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMillis(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Polls testApi.getLatestEmail(email) until an email satisfying the filters
 * arrives, or the timeout elapses.
 *
 * Options:
 *   - timeoutMs      How long to wait overall (default 30s).
 *   - pollIntervalMs Gap between polls (default 1s).
 *   - after          Only accept emails with sentAt strictly after this value
 *                    (Date | ISO string | epoch ms). Use this when you've
 *                    just triggered a resend and need the *new* email.
 *   - subjectMatch   RegExp or string the subject must match.
 *   - bodyMatch      RegExp or string the body must contain.
 *
 * Throws Error('emailHelper.waitForLatestEmail: timed out ...') on timeout.
 */
async function waitForLatestEmail(email, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_MS,
    after,
    subjectMatch,
    bodyMatch
  } = options;

  const afterMs = toMillis(after);
  const deadline = Date.now() + timeoutMs;
  const subjectRe = subjectMatch
    ? (subjectMatch instanceof RegExp ? subjectMatch : new RegExp(subjectMatch, 'i'))
    : null;
  const bodyRe = bodyMatch
    ? (bodyMatch instanceof RegExp ? bodyMatch : new RegExp(bodyMatch, 'i'))
    : null;

  let lastSeen = null;
  while (Date.now() < deadline) {
    const mail = await pickMailSource().getLatestEmail(email).catch(() => null);
    lastSeen = mail;
    if (mail) {
      const sentMs = toMillis(mail.sentAt);
      const newer = afterMs == null || (sentMs != null && sentMs > afterMs);
      const subjectOk = !subjectRe || subjectRe.test(mail.subject || '');
      const bodyOk = !bodyRe || bodyRe.test(mail.body || '');
      if (newer && subjectOk && bodyOk) return mail;
    }
    await sleep(pollIntervalMs);
  }

  const reasons = [];
  if (afterMs != null) reasons.push(`after=${new Date(afterMs).toISOString()}`);
  if (subjectRe) reasons.push(`subject~${subjectRe}`);
  if (bodyRe) reasons.push(`body~${bodyRe}`);
  const filterDesc = reasons.length ? ` (${reasons.join(', ')})` : '';
  const seen = lastSeen
    ? ` last seen: subject="${lastSeen.subject}" sentAt=${lastSeen.sentAt}`
    : ' no email observed';
  throw new Error(
    `emailHelper.waitForLatestEmail: timed out after ${timeoutMs}ms for ${email}${filterDesc}.${seen}`
  );
}

// ---- Link extraction -----------------------------------------------------

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;

function dedupe(arr) {
  return Array.from(new Set(arr));
}

/**
 * Returns every URL found in the body — both href="..." values and bare
 * https?:// URLs in text. Order is preserved (hrefs first, then bare URLs);
 * duplicates are removed.
 */
function extractLinks(body) {
  if (!body) return [];
  const links = [];
  let m;
  while ((m = HREF_RE.exec(body)) !== null) {
    links.push(m[1]);
  }
  const bare = body.match(BARE_URL_RE) || [];
  return dedupe([...links, ...bare]).filter((u) => /^https?:\/\//i.test(u));
}

function findLinkByKeywords(body, keywords) {
  const links = extractLinks(body);
  return (
    links.find((url) =>
      keywords.some((kw) => url.toLowerCase().includes(kw.toLowerCase()))
    ) || null
  );
}

function extractResetLink(body) {
  // QP-decode first so soft line breaks ("=\n") don't split a long URL and hide
  // it from the extractor.
  const decoded = qpDecode(body || '');
  const direct = findLinkByKeywords(decoded, ['reset-password', 'reset_password', 'reset']);
  if (direct) return direct;
  // NXTSTIM sends through SendGrid, which rewrites the CTA into a click-tracking
  // redirect (url*.nxtstim.com/ls/click?...) that resolves to
  // /reset-password?key=<token>. There's no "reset" keyword in that URL, so fall
  // back to the tracking CTA — navigating it in a browser (or following the HTTP
  // redirect) lands on the real reset page.
  const links = extractLinks(decoded);
  return links.find((u) => /\/ls\/click\b/i.test(u) && /nxtstim/i.test(u)) || null;
}

function extractReactivationLink(body) {
  // QP-decode first so soft line breaks don't split a long URL.
  const decoded = qpDecode(body || '');
  const direct = findLinkByKeywords(decoded, ['reactivate', 'reactivation', 'activation']);
  if (direct) return direct;
  // Live QA reality (verified 2026-07-18): the "Account Reactivation" email's
  // actionable CTA has NO "reactivate" keyword in its URL — it's a SendGrid
  // click-tracking link (url*.nxtstim.com/ls/click?...) that redirects to
  // /reset-password?key=<token>. Same fallback as extractResetLink so the
  // type-driven helper (getActionableFromEmail(..,'account reactivation')) works.
  const links = extractLinks(decoded);
  return links.find((u) => /\/ls\/click\b/i.test(u) && /nxtstim/i.test(u)) || null;
}

// ---- OTP extraction ------------------------------------------------------

/**
 * Pulls an OTP out of an email body.
 *
 * Tuned for the NXTSTIM template:
 *
 *   One-Time Password (OTP): -(%7g*bP1vU2
 *
 * — i.e. a labelled, 8–12 character token that may include letters, digits,
 * and punctuation. Falls back to short-label forms ("OTP:", "Code is …") and
 * finally to legacy numeric OTPs so older flows don't regress.
 *
 * Returns the OTP string or null.
 */
function extractOtp(body) {
  if (!body) return null;

  // Step 1: full quoted-printable decode. The mail body is QP-encoded, so:
  //   - "=\r?\n" is a soft-line-break (delete it)
  //   - "=XY" (hex pair) is the literal character with that hex code
  // Without this, an OTP containing '=' arrives in our extractor as the
  // literal three characters "=3D" and the backend rightly rejects it as a
  // different token.
  const qpDecoded = String(body)
    .replace(/=\r?\n/g, '')
    .replace(/\r/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  function decodeHtmlEntities(s) {
    return String(s)
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/gi, '&');
  }

  // Trim trailing sentence punctuation that isn't part of the token.
  function trimTrailingPunct(s) {
    return String(s).replace(/[.,;:!?]+$/, '');
  }

  // Capture the OTP token from the *pre-entity-decode* text. NXTSTIM ships
  // HTML emails where the OTP is wrapped in `<strong>…</strong>` and any
  // OTP character that is HTML-special (`<` `>` `"` `'` `&`) arrives as an
  // entity (`&lt;` `&gt;` `&quot;` `&#39;` `&amp;`). If we decode entities
  // *first*, a literal `>` appears mid-token and our regex stops on it,
  // silently giving a truncated wrong OTP that the backend then rejects.
  // So: capture up to whitespace or the next `<` (closing tag boundary) on
  // the *raw* QP-decoded text, then decode entities on the captured token.
  // The capture window is widened (8..80) to account for entity-expanded
  // length; we re-check the decoded length against the real 8..16 bound.
  // The text/plain MIME part renders the <strong>-wrapped OTP as markdown
  // emphasis (*OTP*), and that part is matched before the HTML part. Those
  // surrounding asterisks are formatting, NOT part of the token — the backend
  // rejects "*^N]g=>3kpmJ*" but accepts "^N]g=>3kpmJ". Strip a *balanced* pair
  // of leading/trailing asterisks; a real OTP is never wrapped in both, and a
  // mid-token '*' (e.g. "-(%7g*bP1vU2") is untouched.
  function stripMarkdownBold(s) {
    const m = String(s).match(/^\*(.+?)\*$/);
    return m ? m[1] : s;
  }

  function captureLabelled(re) {
    const m = qpDecoded.match(re);
    if (!m) return null;
    const decoded = stripMarkdownBold(trimTrailingPunct(decodeHtmlEntities(m[1]).trim()));
    return decoded.length >= 8 && decoded.length <= 16 ? decoded : null;
  }

  // 1) NXTSTIM-style: "One-Time Password (OTP): <token>".
  //    Allow optional HTML tags between the label and the value.
  //    Capture stops at whitespace or `<` (start of next tag).
  const labelled = captureLabelled(
    /one[-\s]?time\s+password(?:\s*\([^)]*\))?\s*[:\-]?\s*(?:<[^>]+>\s*)*([^\s<]{8,80})/i
  );
  if (labelled) return labelled;

  // 2) Short label: "OTP: …", "code is …", "temporary password = …".
  const shortLabel = captureLabelled(
    /\b(?:OTP|verification\s+code|temporary\s+password|code)\s*(?:is|=|:)\s*(?:<[^>]+>\s*)*([^\s<]{8,80})/i
  );
  if (shortLabel) return shortLabel;

  // Fallbacks below run on the entity-decoded text (legacy numeric OTPs
  // don't contain HTML-special characters, so decoding first is safe).
  const text = decodeHtmlEntities(qpDecoded);

  // 3) Legacy numeric OTP near OTP-ish wording — kept so anything that still
  //    sends a 4–8 digit code (e.g. 2FA) keeps working.
  const numericCtx = text.match(
    /(?:OTP|one[-\s]?time(?:\s+password)?|verification\s+code|code)[^0-9]{0,40}(\d{4,8})/i
  );
  if (numericCtx) return numericCtx[1];

  // 4) Standalone 4–8 digit token, anywhere.
  const standalone = text.match(/(?<![\d.])(\d{4,8})(?!\d)/);
  return standalone ? standalone[1] : null;
}

// ---- MFA (6-digit) code extraction ---------------------------------------

// Quoted-printable decode: drop soft line breaks, drop CRs, and turn "=XY"
// hex pairs into their literal character. Same transform extractOtp does
// inline; pulled out here so the MFA extractor can reuse it.
function qpDecode(body) {
  return String(body)
    .replace(/=\r?\n/g, '')
    .replace(/\r/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');
}

/**
 * Reduces an email body to human-visible text: QP-decode, drop <style>/<script>/
 * <head> blocks WHOLESALE (their CSS/markup is full of numbers that would
 * otherwise masquerade as codes), strip remaining tags, then decode entities
 * and collapse whitespace.
 */
function htmlToVisibleText(body) {
  let s = qpDecode(body);
  s = s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Pulls the 6-digit MFA / 2FA challenge code out of an email body.
 *
 * Why a dedicated extractor (not the general extractOtp):
 *   An MFA code is EXACTLY 6 numeric digits — the weakest case for extractOtp.
 *   Its labelled patterns demand an 8–16 char token (so a 6-digit code is
 *   rejected as too short) and it then falls through to a generic "first 4–8
 *   digit run anywhere in the raw HTML" fallback, which happily returns a
 *   tracking-link id, a `width="600"` attribute, or a footer year instead of
 *   the real code. That wrong code is what the backend rejects.
 *
 * Strategy:
 *   1. Collapse to human-visible text only (markup/CSS numbers can't leak in).
 *   2. Prefer a 6-digit run sitting just after a code/verification keyword.
 *   3. Else, if the visible text has exactly one 6-digit run, take it.
 *   4. Else, the first standalone 6-digit run in the visible text.
 * A digit-separator pass also collapses "123 456"-style spaced codes.
 */
function extractMfaCode(body) {
  if (!body) return null;
  const visible = htmlToVisibleText(body);

  // Collapse a single space/thin-space sitting *between two digits* so a
  // spaced "123 456" code reads as one 6-digit run. Loop a few times to walk
  // across all separators in a run.
  let compact = visible;
  for (let i = 0; i < 6; i += 1) {
    compact = compact.replace(/(\d)\s(\d)/g, '$1$2');
  }

  const STANDALONE_SIX = /(?<!\d)\d{6}(?!\d)/g;

  for (const text of [compact, visible]) {
    const keyed =
      text.match(
        /(?:verification|security|one[-\s]?time|login|mfa|2fa|two[-\s]?factor|authentication|access)\s*(?:code|password|otp|pin)?[^\d]{0,40}(\d{6})(?!\d)/i
      ) || text.match(/\b(?:code|otp|pin)\b[^\d]{0,40}(\d{6})(?!\d)/i);
    if (keyed) return keyed[1];

    const all = text.match(STANDALONE_SIX) || [];
    if (Array.from(new Set(all)).length === 1) return all[0];
  }

  const first = visible.match(/(?<!\d)(\d{6})(?!\d)/);
  return first ? first[1] : null;
}

// ---- Branding ------------------------------------------------------------

/**
 * Checks for stable text markers documented in features/authorization/
 * email-templates.feature: NXTSTIM logo, copyright footer, support address.
 * Returns { hasLogo, hasFooter, hasSupportEmail, ok }.
 */
function hasNxtstimBranding(body) {
  const s = String(body || '');
  const hasLogo =
    /alt\s*=\s*["'][^"']*nxtstim[^"']*["']/i.test(s) ||
    /<img[^>]+nxtstim[^>]*>/i.test(s) ||
    /NXTSTIM\s+logo/i.test(s);
  const hasFooter =
    /©|&copy;|copyright/i.test(s) && /nxtstim/i.test(s);
  const hasSupportEmail = /support@nxtstim\.com/i.test(s);
  return {
    hasLogo,
    hasFooter,
    hasSupportEmail,
    ok: hasLogo && hasFooter && hasSupportEmail
  };
}

// ---- Type-driven helpers (registry in emailTypes.js) --------------------

/**
 * Waits for the latest email matching the registered type's subject. Thin
 * wrapper around waitForLatestEmail that injects the type's subject regex
 * so callers don't have to know what the verbatim subject is.
 */
async function waitForEmailOfType(email, typeName, options = {}) {
  const type = emailTypes.resolveType(typeName);
  return waitForLatestEmail(email, { ...options, subjectMatch: type.subject });
}

/**
 * Returns the actionable payload (OTP code or link URL) carried by the
 * type's email. Throws if the type is purely informational (extract: null)
 * or if the expected payload is missing from the body.
 *
 * Shape: { type, value, kind, email } where kind is one of:
 *   'otp' | 'resetLink' | 'reactivationLink'
 */
async function getActionableFromEmail(email, typeName, options = {}) {
  const type = emailTypes.resolveType(typeName);
  if (!type.extract) {
    throw new Error(
      `emailHelper.getActionableFromEmail: type "${type.id}" has no actionable ` +
      `payload (subject: "${type.subjectLiteral}"). Use waitForEmailOfType instead.`
    );
  }
  const mail = await waitForEmailOfType(email, type.id, options);
  let value = null;
  switch (type.extract) {
    case 'otp':              value = extractOtp(mail.body); break;
    case 'mfaCode':          value = extractMfaCode(mail.body); break;
    case 'resetLink':        value = extractResetLink(mail.body); break;
    case 'reactivationLink': value = extractReactivationLink(mail.body); break;
    default:
      throw new Error(
        `emailHelper.getActionableFromEmail: unknown extractor "${type.extract}" for ${type.id}`
      );
  }
  if (!value) {
    throw new Error(
      `emailHelper.getActionableFromEmail: no ${type.extract} found in latest ` +
      `"${type.subjectLiteral}" email to ${email} (subject="${mail.subject}")`
    );
  }
  return { type: type.id, value, kind: type.extract, email: mail };
}

module.exports = {
  waitForLatestEmail,
  waitForEmailOfType,
  getActionableFromEmail,
  extractLinks,
  extractResetLink,
  extractReactivationLink,
  extractOtp,
  extractMfaCode,
  hasNxtstimBranding,
  emailTypes
};
