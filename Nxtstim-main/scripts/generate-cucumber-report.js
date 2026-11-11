const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Readable HTML report generator.
//
// Reads reports/cucumber-report.json (always emitted by the `json:` formatter
// configured in cucumber.js) and renders a self-contained, human-readable
// dashboard to reports/cucumber-report.html — summary cards, per-scenario
// cards with tags, per-step status + timing, inline error blocks for failures,
// and embedded failure screenshots.
//
// The default @cucumber/html-formatter output is a single React bundle with the
// entire run serialized into one CUCUMBER_MESSAGES array — technically valid but
// hard to skim. This replaces it with plain, styled HTML a QA engineer can read
// at a glance after every run. `generateReport()` keeps the same signature so
// features/support/hooks.js's AfterAll hook regenerates it automatically.
// ---------------------------------------------------------------------------

const STATUS_ORDER = ['failed', 'ambiguous', 'undefined', 'pending', 'skipped', 'passed', 'unknown'];

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Cucumber JSON durations are nanoseconds.
function fmtDuration(ns) {
  if (!ns || ns < 0) return '—';
  const ms = ns / 1e6;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// A visible step is a real Gherkin step (Given/When/Then/And/But), not a hidden
// Before/After hook. Scenario status is derived from visible steps only.
function isHiddenHook(step) {
  return step.hidden === true || step.keyword === 'Before' || step.keyword === 'After';
}

function scenarioStatus(scenario) {
  const steps = (scenario.steps || []).filter((s) => !isHiddenHook(s));
  const statuses = steps.map((s) => (s.result && s.result.status) || 'unknown');
  // Also fail the scenario if a hook (e.g. Before/After) errored.
  const hookFailed = (scenario.steps || []).some(
    (s) => isHiddenHook(s) && s.result && s.result.status === 'failed'
  );
  if (hookFailed || statuses.includes('failed')) return 'failed';
  if (statuses.includes('ambiguous')) return 'ambiguous';
  if (statuses.includes('undefined')) return 'undefined';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.length && statuses.every((s) => s === 'skipped')) return 'skipped';
  if (statuses.length && statuses.every((s) => s === 'passed')) return 'passed';
  if (statuses.includes('skipped')) return 'failed'; // partial run past a failure
  return 'unknown';
}

function scenarioDuration(scenario) {
  return (scenario.steps || []).reduce(
    (sum, s) => sum + ((s.result && s.result.duration) || 0),
    0
  );
}

function collectScreenshots(scenario) {
  const shots = [];
  for (const step of scenario.steps || []) {
    for (const emb of step.embeddings || []) {
      if (emb.mime_type && emb.mime_type.startsWith('image/') && emb.data) {
        shots.push(emb);
      }
    }
  }
  return shots;
}

// Non-image attachments (this.attach(text, 'text/plain')) are base64-encoded in
// the JSON. Decode and render them inline under their step so the report shows
// exactly what a step did — filter used, value selected, counts, clinics, etc.
function renderTextAttachments(step) {
  return (step.embeddings || [])
    .filter((emb) => emb.data && emb.mime_type && !emb.mime_type.startsWith('image/'))
    .map((emb) => {
      let text;
      try {
        text = Buffer.from(emb.data, 'base64').toString('utf8');
      } catch {
        text = emb.data;
      }
      return `<pre class="attach">${esc(text)}</pre>`;
    })
    .join('');
}

const STATUS_ICON = {
  passed: '&#10004;',
  failed: '&#10008;',
  skipped: '&#8213;',
  pending: '&#8987;',
  undefined: '?',
  ambiguous: '!',
  unknown: '&#183;'
};

function buildHtml(features, meta) {
  // ---- aggregate stats -----------------------------------------------------
  const scenarios = [];
  for (const feature of features) {
    for (const el of feature.elements || []) {
      if (el.type && el.type !== 'scenario' && el.type !== 'scenario_outline') continue;
      scenarios.push({ feature, scenario: el, status: scenarioStatus(el) });
    }
  }
  const counts = { passed: 0, failed: 0, skipped: 0, pending: 0, undefined: 0, ambiguous: 0, unknown: 0 };
  for (const s of scenarios) counts[s.status] = (counts[s.status] || 0) + 1;
  const total = scenarios.length;
  const totalDuration = scenarios.reduce((sum, s) => sum + scenarioDuration(s.scenario), 0);
  const passRate = total ? Math.round((counts.passed / total) * 100) : 0;

  // ---- feature sections ----------------------------------------------------
  const featureBlocks = features
    .map((feature) => {
      const fScenarios = (feature.elements || []).filter(
        (el) => !el.type || el.type === 'scenario' || el.type === 'scenario_outline'
      );
      if (!fScenarios.length) return '';

      const scenarioCards = fScenarios
        .map((sc) => {
          const status = scenarioStatus(sc);
          const tags = (sc.tags || []).map((t) => t.name).filter((t) => t !== `@${feature.name}`);
          const steps = (sc.steps || []).filter((s) => !isHiddenHook(s));

          const stepRows = steps
            .map((step) => {
              const st = (step.result && step.result.status) || 'unknown';
              const err = step.result && step.result.error_message;
              const errBlock = err
                ? `<pre class="error">${esc(err)}</pre>`
                : '';
              const attachBlock = renderTextAttachments(step);
              return `
                <li class="step step--${st}">
                  <span class="step-icon">${STATUS_ICON[st] || ''}</span>
                  <span class="step-kw">${esc(step.keyword || '')}</span>
                  <span class="step-name">${esc(step.name || '')}</span>
                  <span class="step-time">${fmtDuration(step.result && step.result.duration)}</span>
                  ${errBlock}
                  ${attachBlock}
                </li>`;
            })
            .join('');

          const shots = collectScreenshots(sc);
          const shotBlock = shots.length
            ? `<div class="shots">${shots
                .map(
                  (emb, i) =>
                    `<figure><figcaption>Screenshot ${i + 1}</figcaption>` +
                    `<a href="data:${emb.mime_type};base64,${emb.data}" target="_blank" rel="noopener">` +
                    `<img loading="lazy" src="data:${emb.mime_type};base64,${emb.data}" alt="failure screenshot ${i + 1}"></a></figure>`
                )
                .join('')}</div>`
            : '';

          const tagHtml = tags.length
            ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
            : '';

          const open = status === 'failed' ? ' open' : '';
          return `
            <details class="scenario scenario--${status}" data-status="${status}"${open}>
              <summary>
                <span class="badge badge--${status}">${status}</span>
                <span class="scenario-name">${esc(sc.name)}</span>
                <span class="scenario-time">${fmtDuration(scenarioDuration(sc))}</span>
              </summary>
              ${tagHtml}
              <ol class="steps">${stepRows}</ol>
              ${shotBlock}
            </details>`;
        })
        .join('');

      return `
        <section class="feature">
          <h2 class="feature-title">${esc(feature.name)}</h2>
          ${feature.description ? `<p class="feature-desc">${esc(feature.description.trim())}</p>` : ''}
          ${scenarioCards}
        </section>`;
    })
    .join('');

  const card = (label, value, cls) =>
    `<div class="card card--${cls}"><div class="card-value">${value}</div><div class="card-label">${label}</div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NXTSTIM — Test Execution Report</title>
<style>
  :root {
    --bg:#0f172a; --panel:#1e293b; --panel2:#243044; --text:#e2e8f0; --muted:#94a3b8;
    --border:#334155; --pass:#22c55e; --fail:#ef4444; --skip:#94a3b8; --pending:#f59e0b;
    --accent:#38bdf8;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f1f5f9; --panel:#ffffff; --panel2:#f8fafc; --text:#0f172a; --muted:#64748b; --border:#e2e8f0; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         background:var(--bg); color:var(--text); line-height:1.5; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }
  header.top { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:8px;
               border-bottom:2px solid var(--border); padding-bottom:16px; margin-bottom:24px; }
  header.top h1 { font-size:1.5rem; margin:0; }
  header.top .meta { color:var(--muted); font-size:.85rem; text-align:right; }
  .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap:12px; margin-bottom:24px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; text-align:center; }
  .card-value { font-size:1.9rem; font-weight:700; line-height:1; }
  .card-label { color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; margin-top:6px; }
  .card--total .card-value{color:var(--accent);} .card--passed .card-value{color:var(--pass);}
  .card--failed .card-value{color:var(--fail);} .card--skipped .card-value{color:var(--skip);}
  .card--rate .card-value{color:var(--pending);}
  .bar { height:10px; border-radius:6px; overflow:hidden; display:flex; background:var(--border); margin-bottom:24px; }
  .bar > span { display:block; height:100%; }
  .bar .p{background:var(--pass);} .bar .f{background:var(--fail);} .bar .s{background:var(--skip);} .bar .o{background:var(--pending);}
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
  .filters button { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:20px;
                    padding:6px 14px; font-size:.82rem; cursor:pointer; }
  .filters button.active { background:var(--accent); color:#04263a; border-color:var(--accent); font-weight:600; }
  /* Feature cards: single column on mobile, two side-by-side on desktop. */
  .features-grid { display:grid; grid-template-columns: 1fr; gap:24px; align-items:start; }
  @media (min-width: 900px) {
    .features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .feature { margin-bottom:0; min-width:0; }
  .feature-title { font-size:1.15rem; margin:0 0 2px; }
  .feature-desc { color:var(--muted); font-size:.85rem; white-space:pre-line; margin:0 0 14px; }
  .scenario { background:var(--panel); border:1px solid var(--border); border-left-width:4px; border-radius:10px;
              margin-bottom:10px; overflow:hidden; }
  .scenario--passed { border-left-color:var(--pass); }
  .scenario--failed { border-left-color:var(--fail); }
  .scenario--skipped { border-left-color:var(--skip); }
  .scenario--pending, .scenario--undefined, .scenario--ambiguous { border-left-color:var(--pending); }
  .scenario summary { display:flex; align-items:center; gap:12px; padding:12px 16px; cursor:pointer; list-style:none; }
  .scenario summary::-webkit-details-marker { display:none; }
  .scenario-name { font-weight:600; flex:1; }
  .scenario-time { color:var(--muted); font-size:.8rem; font-variant-numeric:tabular-nums; }
  .badge { font-size:.68rem; text-transform:uppercase; letter-spacing:.05em; font-weight:700; padding:3px 9px;
           border-radius:20px; color:#fff; }
  .badge--passed{background:var(--pass);} .badge--failed{background:var(--fail);} .badge--skipped{background:var(--skip);}
  .badge--pending,.badge--undefined,.badge--ambiguous{background:var(--pending);} .badge--unknown{background:var(--muted);}
  .tags { padding: 0 16px 6px 16px; display:flex; gap:6px; flex-wrap:wrap; }
  .tag { font-size:.72rem; color:var(--accent); background:var(--panel2); border:1px solid var(--border);
         border-radius:5px; padding:1px 7px; }
  ol.steps { list-style:none; margin:0; padding:4px 16px 14px; }
  .step { display:grid; grid-template-columns: 18px auto 1fr auto; gap:8px; align-items:baseline;
          padding:4px 0; font-size:.9rem; border-top:1px dashed var(--border); }
  .step:first-child { border-top:none; }
  .step-icon { font-size:.85rem; }
  .step--passed .step-icon{color:var(--pass);} .step--failed .step-icon{color:var(--fail);}
  .step--skipped .step-icon{color:var(--skip);} .step--skipped .step-name{color:var(--muted);}
  .step-kw { color:var(--accent); font-weight:600; }
  .step-time { color:var(--muted); font-size:.78rem; font-variant-numeric:tabular-nums; }
  pre.error { grid-column: 2 / -1; background:#2b0f12; color:#fecaca; border:1px solid #7f1d1d; border-radius:8px;
              padding:10px 12px; margin:6px 0 2px; overflow-x:auto; font-size:.8rem; white-space:pre-wrap; word-break:break-word; }
  @media (prefers-color-scheme: light){ pre.error{background:#fef2f2;color:#991b1b;} }
  pre.attach { grid-column: 2 / -1; background:var(--panel2); color:var(--text); border:1px solid var(--border);
               border-left:3px solid var(--accent); border-radius:8px; padding:9px 12px; margin:6px 0 2px;
               overflow-x:auto; font-size:.8rem; line-height:1.5; white-space:pre; word-break:normal;
               font-family:"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
  .shots { display:flex; gap:12px; flex-wrap:wrap; padding: 0 16px 16px; }
  .shots figure { margin:0; max-width:260px; }
  .shots figcaption { font-size:.72rem; color:var(--muted); margin-bottom:4px; }
  .shots img { max-width:260px; border:1px solid var(--border); border-radius:8px; display:block; }
  footer { color:var(--muted); font-size:.78rem; text-align:center; margin-top:32px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>NXTSTIM — Test Execution Report</h1>
    <div class="meta">
      Generated: ${esc(meta.generatedAt)}<br>
      Total run time: ${fmtDuration(totalDuration)}
    </div>
  </header>

  <div class="cards">
    ${card('Scenarios', total, 'total')}
    ${card('Passed', counts.passed, 'passed')}
    ${card('Failed', counts.failed, 'failed')}
    ${card('Skipped', counts.skipped + counts.pending + counts.undefined + counts.ambiguous + counts.unknown, 'skipped')}
    ${card('Pass rate', passRate + '%', 'rate')}
  </div>

  <div class="bar" title="passed / failed / other">
    <span class="p" style="width:${total ? (counts.passed / total) * 100 : 0}%"></span>
    <span class="f" style="width:${total ? (counts.failed / total) * 100 : 0}%"></span>
    <span class="o" style="width:${total ? ((counts.pending + counts.undefined + counts.ambiguous) / total) * 100 : 0}%"></span>
    <span class="s" style="width:${total ? (counts.skipped / total) * 100 : 0}%"></span>
  </div>

  <div class="filters">
    <button data-filter="all" class="active">All (${total})</button>
    <button data-filter="passed">Passed (${counts.passed})</button>
    <button data-filter="failed">Failed (${counts.failed})</button>
    <button data-filter="skipped">Skipped (${counts.skipped})</button>
  </div>

  <div class="features-grid">
    ${featureBlocks || '<p class="feature-desc">No scenarios found in the report JSON.</p>'}
  </div>

  <footer>Playwright + Cucumber BDD · report rendered from reports/cucumber-report.json</footer>
</div>
<script>
  const buttons = document.querySelectorAll('.filters button');
  const scenarios = document.querySelectorAll('.scenario');
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    buttons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter;
    scenarios.forEach((sc) => {
      const st = sc.dataset.status;
      const show = f === 'all'
        || (f === 'skipped' ? ['skipped','pending','undefined','ambiguous','unknown'].includes(st) : st === f);
      sc.style.display = show ? '' : 'none';
    });
    document.querySelectorAll('.feature').forEach((sec) => {
      const anyVisible = sec.querySelector('.scenario:not([style*="display: none"])');
      sec.style.display = anyVisible ? '' : 'none';
    });
  }));
</script>
</body>
</html>`;
}

async function generateReport() {
  const reportsDir = path.resolve(__dirname, '..', 'reports');
  const jsonPath = path.join(reportsDir, 'cucumber-report.json');
  const htmlPath = path.join(reportsDir, 'cucumber-report.html');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON report not found: ${jsonPath} (run cucumber with the json: formatter first)`);
  }

  await fs.promises.mkdir(reportsDir, { recursive: true });

  let features;
  try {
    features = JSON.parse(await fs.promises.readFile(jsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${jsonPath}: ${error.message}`);
  }
  if (!Array.isArray(features)) features = [];

  // Build a stable, human-readable timestamp without pulling in a date lib.
  const generatedAt = new Date().toString();

  const html = buildHtml(features, { generatedAt });
  await fs.promises.writeFile(htmlPath, html, 'utf8');
  return htmlPath;
}

if (require.main === module) {
  generateReport()
    .then((p) => console.log(`Readable HTML report written to ${p}`))
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}

module.exports = { generateReport, buildHtml, scenarioStatus };
