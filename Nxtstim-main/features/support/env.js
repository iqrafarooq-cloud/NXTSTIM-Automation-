/**
 * env.js — tiny zero-dep .env loader.
 *
 * Loads `.env` from the repo root into process.env if the file exists.
 * Does NOT overwrite values already set in the shell (so cross-env still wins).
 * Quotes around values are stripped; lines starting with `#` are skipped.
 *
 * Why not the `dotenv` package? To avoid adding a runtime dependency for
 * ~25 lines of parsing. Drop-in replaceable with `require('dotenv').config()`
 * if you ever install it.
 */

const fs = require('fs');
const path = require('path');

function loadDotenv(envPath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(envPath)) return { loaded: false, count: 0 };

  const text = fs.readFileSync(envPath, 'utf8');
  let count = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip surrounding single or double quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Shell env wins over .env.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      count += 1;
    }
  }

  return { loaded: true, count };
}

/**
 * Returns true iff every named env var has a non-empty value. Used by step
 * defs to short-circuit to "pending" when a backend dependency isn't wired.
 */
function envReady(...names) {
  return names.every((n) => {
    const v = process.env[n];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
}

module.exports = { loadDotenv, envReady };
