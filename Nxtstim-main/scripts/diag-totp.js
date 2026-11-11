// Dev-only, read-only diagnostic: prints clock skew vs network time and the
// current TOTP derived from the stored secret (same algorithm as mfa.steps.js).
// Makes NO account changes. Delete after use.
const crypto = require('crypto');
const https = require('https');
const { loadSecret } = require('../features/support/mfaSecretStore');

function decodeBase32(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}

function totp(secret, time) {
  const step = 30, digits = 6;
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / step)), 0);
  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

const secret = loadSecret();
console.log('Stored secret      :', secret, `(len ${secret ? secret.length : 0})`);

https.get('https://www.google.com', (res) => {
  res.destroy();
  const net = new Date(res.headers.date);
  const local = new Date();
  const skew = (local - net) / 1000;
  console.log('Local clock (UTC)  :', local.toISOString());
  console.log('Network clock (UTC):', net.toISOString());
  console.log('Clock skew (s)     :', skew.toFixed(1), '(local - network)');
  console.log('TOTP verdict       :', Math.abs(skew) >= 25 ? 'SKEW TOO LARGE — breaks TOTP' : 'clock within tolerance');
  const t = Math.floor(net.getTime() / 1000);
  console.log('--- codes by network time (server uses one of these) ---');
  console.log('prev (-30s):', totp(secret, t - 30));
  console.log('now        :', totp(secret, t));
  console.log('next (+30s):', totp(secret, t + 30));
}).on('error', (e) => {
  const local = new Date();
  console.log('Network time unavailable:', e.message);
  console.log('Local clock (UTC)  :', local.toISOString());
  const t = Math.floor(local.getTime() / 1000);
  console.log('current TOTP (local):', totp(secret, t));
});
