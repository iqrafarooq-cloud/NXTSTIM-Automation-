#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Test runner: runs Cucumber, then generates the readable HTML report.
//
// Why a wrapper instead of an AfterAll hook: Cucumber's file formatters
// (json:/message:) flush their output on `testRunFinished`, which fires AFTER
// AfterAll hooks. So generating the report from AfterAll reads a half-written
// (often empty) cucumber-report.json — "Unexpected end of JSON input". Spawning
// Cucumber as a child and waiting for its `exit` event guarantees every
// formatter has fully flushed and closed its file before we read it.
//
// The report is generated on BOTH pass and fail (we don't gate it behind a
// zero exit code), and Cucumber's exit code is propagated so CI still fails on
// a failing suite. Any extra CLI args (--name, --tags, a feature path, ...) are
// passed straight through to Cucumber.
// ---------------------------------------------------------------------------
const { spawn } = require('child_process');
const path = require('path');
const { generateReport } = require('./generate-cucumber-report');

// Open the freshly generated HTML report in the OS default browser so the user
// actually SEES a current report after every run — not just a file silently
// written to disk. Uses the platform's native "open a file" command. Skipped
// when OPEN_REPORT=false or when running in CI (no display / would hang).
function openReport(reportPath) {
  if (process.env.OPEN_REPORT === 'false' || process.env.CI) return;
  let cmd;
  let args;
  if (process.platform === 'win32') {
    // `start` is a cmd builtin; the first quoted arg is the window title (must
    // be present so a quoted path isn't consumed as the title).
    cmd = 'cmd';
    args = ['/c', 'start', '', reportPath];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [reportPath];
  } else {
    cmd = 'xdg-open';
    args = [reportPath];
  }
  try {
    const opener = spawn(cmd, args, { stdio: 'ignore', detached: true });
    opener.on('error', () => {}); // don't crash the run if no browser/opener
    opener.unref();
  } catch {
    // Non-fatal: the report is on disk regardless.
  }
}

const cucumberBin = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '@cucumber',
  'cucumber',
  'bin',
  'cucumber.js'
);

const passthroughArgs = process.argv.slice(2);
const child = spawn(process.execPath, [cucumberBin, ...passthroughArgs], {
  stdio: 'inherit'
});

// Keep the wrapper alive when the terminal sends an interrupt (Ctrl+C =>
// SIGINT, also SIGTERM/SIGHUP). Without these no-op handlers, Node's default
// behavior kills the parent IMMEDIATELY on signal — before the `child.on('exit')`
// handler below can `await generateReport()`. That produced the classic
// "fresh cucumber-report.json but stale cucumber-report.html" symptom: Cucumber
// flushes its JSON on testRunFinished, but the HTML step never ran. The signal
// still propagates to the child (same process group), so Cucumber stops as
// expected; we just defer our own exit until the report is written (see below).
const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
for (const sig of forwardedSignals) {
  process.on(sig, () => {
    // Intentionally empty: let the child exit, then our exit handler runs the
    // report generation and re-signals us via child.on('exit').
  });
}

child.on('exit', async (code, signal) => {
  try {
    const reportPath = await generateReport();
    console.log(`\n📊 Readable HTML report: ${reportPath}`);
    openReport(reportPath);
  } catch (error) {
    console.error('\nReport generation failed:', error.message || error);
  }
  if (signal) {
    // Report is written; now honor the original signal. Remove our no-op
    // handlers first so re-signaling actually terminates us (otherwise the
    // handler swallows it and the process hangs). If the default action still
    // doesn't fire (platform quirks), fall back to a non-zero exit.
    for (const sig of forwardedSignals) process.removeAllListeners(sig);
    process.kill(process.pid, signal);
    process.exit(1);
    return;
  }
  process.exit(code == null ? 1 : code);
});

child.on('error', (error) => {
  console.error('Failed to start Cucumber:', error.message || error);
  process.exit(1);
});
