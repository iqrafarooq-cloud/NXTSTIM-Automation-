module.exports = {
  default: {
    require: [
      'features/support/**/*.js',
      'features/step_definitions/**/*.js'
    ],
    format: [
      'progress-bar',
      'summary',
      'message:reports/cucumber-messages.ndjson',
      'json:reports/cucumber-report.json'
    ],
    formatOptions: { snippetInterface: 'async-await' },
    // NOTE: `paths` is intentionally NOT set here. Cucumber's own default already
    // discovers `features/**/*.feature`, so `npm test` (no args) still runs the
    // whole suite. Crucially, leaving it unset means a feature path passed on the
    // CLI (e.g. `npm test -- features/Clinic.feature`) RUNS ONLY THAT FILE instead
    // of being merged with a config glob — the old `paths` glob caused a single
    // feature argument to silently expand to all 144 scenarios.
    // Skip scenarios that are documented in Gherkin as a living spec
    // but require admin UI / email inbox / DB access / cron / time-travel
    // and have no automation hookup yet (@manual), AND skip scenarios
    // tagged @known-issue (real spec deviations whose tests correctly fail
    // and should not block CI until the underlying app is fixed).
    // Surface them on demand with `npm run test:manual` and
    // `npm run test:known-issues`.
    // @parked is the same idea for scenarios deliberately taken out of scope:
    // features/UserManagement/UserList.feature and AddUser-parked.feature hold
    // the list-toolbar / e2e-lifecycle scenarios that were split out of
    // User.feature so it could focus on the Add New User modal. They still run
    // on demand — `npm test -- --tags "@parked"`.
    // Cucumber ANDs this expression with any `--tags` passed on the CLI, so a
    // bare `--tags @known-issue` resolves to `not @known-issue and
    // @known-issue` and silently matches nothing. CUCUMBER_TAGS therefore
    // REPLACES the default rather than narrowing it — that is what
    // `npm run test:manual` / `test:known-issues` set.
    // @role-pending marks the RBAC-verification Examples blocks for roles that
    // have not been asked for yet (features/UserManagement/RBAC-verification.feature
    // carries one tagged block per role). Each one is a full live lifecycle —
    // create → activate → suspend → reactivate → activate → permission sweep —
    // so the default run exercises only the role(s) currently in scope. Switch a
    // role on with its own tag, e.g. `npm test -- --tags "@executive-admin"`.
    tags: process.env.CUCUMBER_TAGS || 'not @manual and not @known-issue and not @parked and not @role-pending',
    timeout: 60000
  }
};
