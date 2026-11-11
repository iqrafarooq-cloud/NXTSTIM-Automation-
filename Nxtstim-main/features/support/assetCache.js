/**
 * assetCache — serves the app's static build output from a local cache so the
 * suite stops re-downloading it.
 *
 * Why this exists. Every scenario gets a fresh Playwright context for isolation,
 * and a fresh context has an empty HTTP cache, so without this the SPA bundle is
 * fetched once per scenario. Measured against the preview environment on
 * 2026-07-26: /assets/index-*.js is 2.34 MB compressed (5.28 MB raw) and the host
 * delivers it at ~78 KB/s — ~30s per scenario, and the login form cannot paint
 * until it lands, which is what made the login step time out.
 *
 * Two layers:
 *   - memory, shared by every scenario in a run
 *   - disk (.cache/assets), shared by every run on the machine
 *
 * Only CONTENT-HASHED build output is written to disk. Vite emits the hash in the
 * filename, so a redeploy produces a different URL and a stale body can never be
 * served; everything else is cached for the lifetime of the run only. Delete
 * .cache/assets to force a re-download.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(process.cwd(), '.cache', 'assets');

/** Requests worth caching at all (served from memory for the run). */
const CACHEABLE = /\.(?:js|mjs|css|woff2?|ttf|png|jpe?g|svg|gif|ico)(?:\?|$)/i;

/** Immutable, content-hashed build output — safe to keep on disk across runs. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|svg|woff2?|ttf|png|jpe?g|ico)(?:\?|$)/i;

const memory = new Map();

function keyFor(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function diskPaths(url) {
  const key = keyFor(url);
  return { meta: path.join(DIR, `${key}.json`), body: path.join(DIR, `${key}.bin`) };
}

/** Cached entry for `url`, promoting a disk hit into memory. Null when absent. */
function get(url) {
  if (memory.has(url)) return memory.get(url);
  const { meta, body } = diskPaths(url);
  try {
    if (!fs.existsSync(meta) || !fs.existsSync(body)) return null;
    const { status, headers } = JSON.parse(fs.readFileSync(meta, 'utf8'));
    const entry = { status, headers, body: fs.readFileSync(body) };
    memory.set(url, entry);
    return entry;
  } catch {
    return null; // a half-written or corrupt entry is simply a miss
  }
}

/**
 * Stores an entry. `headers` must describe DECODED bytes — callers strip
 * content-encoding/content-length, otherwise the browser would try to inflate
 * already-inflated text.
 */
function put(url, entry) {
  memory.set(url, entry);
  if (!HASHED.test(url)) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const { meta, body } = diskPaths(url);
    // Body first: a meta file only ever exists once its body is complete, so an
    // interrupted write reads back as a miss rather than as a truncated asset.
    fs.writeFileSync(body, entry.body);
    fs.writeFileSync(meta, JSON.stringify({ url, status: entry.status, headers: entry.headers }));
  } catch { /* caching is an optimisation — never fail a scenario over it */ }
}

/** Headers for a decoded body: the wire's encoding/length no longer apply. */
function decodedHeaders(headers) {
  const out = { ...headers };
  delete out['content-encoding'];
  delete out['content-length'];
  return out;
}

/** Routes a context's static-asset requests through the cache. */
async function install(context) {
  await context.route(
    (url) => CACHEABLE.test(url.pathname + url.search),
    async (route) => {
      const url = route.request().url();
      const hit = get(url);
      if (hit) return route.fulfill(hit);
      try {
        const response = await route.fetch();
        const entry = {
          status: response.status(),
          headers: decodedHeaders(response.headers()),
          body: await response.body()
        };
        if (entry.status === 200) put(url, entry);
        return route.fulfill(entry);
      } catch {
        return route.continue(); // never let the cache break a scenario
      }
    }
  );
}

module.exports = { install, get, put, decodedHeaders, CACHEABLE, HASHED, DIR };
