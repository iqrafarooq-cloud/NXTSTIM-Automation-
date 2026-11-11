/**
 * artifacts.js — drop per-flow artifacts (reset links, reactivation links,
 * captured OTPs, new credentials) into `artifacts/<flow>/<file>` so the user
 * can inspect the latest token without digging through email or logs.
 *
 * Convention (see memory/nxt-artifact-convention.md):
 *   - One folder per flow (reactivate-account, forgot-password, etc.)
 *   - Files are OVERWRITTEN every run — no history. The latest run wins.
 *   - `artifacts/` is gitignored.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd(), 'artifacts');

function flowDir(flow) {
  const dir = path.join(ROOT, flow);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeText(flow, filename, text) {
  const dir = flowDir(flow);
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, String(text ?? ''), 'utf8');
  return filepath;
}

function writeJson(flow, filename, obj) {
  return writeText(flow, filename, JSON.stringify(obj, null, 2));
}

/**
 * Convenience: record a captured link with a timestamp wrapper so the user
 * sees both the value and when it was captured. Returns the file path.
 */
function recordLink(flow, filename, { email, url, label }) {
  return writeText(
    flow,
    filename,
    [
      `# ${label || filename} — captured ${new Date().toISOString()}`,
      `# email: ${email}`,
      url
    ].join('\n')
  );
}

module.exports = {
  flowDir,
  writeText,
  writeJson,
  recordLink
};
