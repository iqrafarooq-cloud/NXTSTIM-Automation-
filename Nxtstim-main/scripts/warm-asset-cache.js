/**
 * Pre-populates .cache/assets with the app's static build output.
 *
 * The preview host serves /assets/index-*.js at ~78 KB/s (2.34 MB compressed),
 * so a cold first scenario spends ~30s — sometimes more than the login step's
 * budget — just downloading the bundle that renders the login form. Running this
 * once takes that download out of the test path entirely; every later run reads
 * the bundle from disk.
 *
 *   node scripts/warm-asset-cache.js
 *
 * Safe to re-run: it refetches and overwrites. Only content-hashed filenames are
 * persisted, so a redeploy changes the URL and is fetched fresh automatically.
 */

const assetCache = require('../features/support/assetCache');
const { loadDotenv } = require('../features/support/env');

loadDotenv();

function loginUrl() {
  return (
    process.env.BASE_URL ||
    'https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login'
  );
}

function origin() {
  return loginUrl().replace(/\/login.*$/i, '');
}

async function fetchAsset(url) {
  const started = Date.now();
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  // fetch() decodes the body, so the wire's encoding/length headers must go —
  // the browser would otherwise try to inflate already-inflated bytes.
  const headers = assetCache.decodedHeaders(Object.fromEntries(res.headers.entries()));
  const body = Buffer.from(await res.arrayBuffer());
  return { entry: { status: res.status, headers, body }, ms: Date.now() - started };
}

(async () => {
  const html = await (await fetch(loginUrl())).text();
  // Vite emits <script src="/assets/index-<hash>.js"> and a matching stylesheet.
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const urls = [...new Set(refs)].map((p) => `${origin()}${p}`);

  if (!urls.length) {
    console.log('No /assets/* references found in the login HTML — nothing to warm.');
    return;
  }

  console.log(`Warming ${urls.length} asset(s) into ${assetCache.DIR}\n`);
  for (const url of urls) {
    try {
      const { entry, ms } = await fetchAsset(url);
      if (entry.status !== 200) {
        console.log(`  ✗ HTTP ${entry.status}  ${url}`);
        continue;
      }
      assetCache.put(url, entry);
      const kb = Math.round(entry.body.length / 1024);
      const persisted = assetCache.HASHED.test(url) ? 'on disk' : 'memory only (not hashed)';
      console.log(`  ✓ ${String(kb).padStart(5)} KB in ${String(ms).padStart(6)} ms  ${persisted}  ${url}`);
    } catch (err) {
      console.log(`  ✗ ${url} :: ${err.message}`);
    }
  }
  console.log('\nDone. Runs will now serve these from disk instead of re-downloading them.');
})();
