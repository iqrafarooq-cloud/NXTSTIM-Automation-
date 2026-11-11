// TEMP scoped config: run ONLY features/ChangePassword.feature.
// Mirrors the project's default cucumber.js but restricts `paths` so the
// full-suite glob isn't merged in. Safe to delete.
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
    paths: ['features/ChangePassword.feature'],
    tags: 'not @manual and not @known-issue',
    timeout: 60000
  }
};
