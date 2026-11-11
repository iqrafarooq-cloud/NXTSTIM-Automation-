/**
 * rbacMatrix.js — the RBAC spec as data, plus how each row is proven in the UI.
 *
 * Source of truth: the two spreadsheets in Files/ (NXT-1362).
 *   - "RBAC sheet - For Automation.xlsx" → every section below except Notes.
 *   - "Notes- RBAC.xlsx"                 → the Notes section.
 * Transcribed verbatim: the sheets use ✅/❌ in some cells and Excel booleans
 * (1/0) in others for the SAME meaning, so both are normalised to 'yes'/'no'
 * here. Qualifiers ("Same Clinic Only", "View Only", "Own Only", "No Timer", …)
 * are preserved as their own values because several of them change what the UI
 * must show, not just whether it shows.
 *
 * Two things live in this file:
 *
 *   1. MATRIX  — the spec. One entry per sheet row: section, permission and the
 *                value for each of the 12 role columns.
 *   2. CHECKS  — the bridge to reality. For each "Section::Permission" it names
 *                the live affordance that proves the permission (a button, a
 *                tab, a row-menu item, a report card, …), or records WHY the row
 *                cannot be verified today. PermissionsPage.observe() consumes
 *                these descriptors; rbac.steps.js compares observation to spec.
 *
 * Why CHECKS is needed at all: the sheet predates the NXT-1999 restructure. Its
 * four "… Management" sections are now one /users screen, and the app has no
 * Notes surface at all (verified live 2026-07-26 as BOTH Support Staff and
 * Executive Admin — searching the patient record for any "note" affordance
 * returns nothing). Rows like that are marked `unmappable` with a reason and
 * reported as PENDING rather than silently passing.
 *
 * Verification semantics (see verdictFor):
 *   'no' / 'unspecified'  → the affordance must be ABSENT
 *   'view-only'           → the read affordance present, the write one ABSENT
 *   anything else         → the affordance must be PRESENT (scope qualifiers
 *                           such as 'clinic-only' are reported as notes, since
 *                           proving scope needs multi-clinic fixtures)
 */

// ---- Roles ----------------------------------------------------------------
//
// Short keys mirror the sheet's column order. `label` is what the app's Role
// dropdown actually offers (captured live 2026-07-26) — note the app spells the
// officer role WITHOUT a slash ("Security Privacy Officer") while the sheet uses
// "Security/Privacy Officer", and the sheet pluralises several others.

const ROLES = Object.freeze({
  EA:  { label: 'Executive Admin',          sheet: 'Executive Admin' },
  BA:  { label: 'Billing Admin',            sheet: 'Billing Admin' },
  MA:  { label: 'Monitoring Admin',         sheet: 'Monitoring Admin' },
  RA:  { label: 'Reporting Admin',          sheet: 'Reporting Admin' },
  ES:  { label: 'Elevated Supervisor',      sheet: 'Elevated Supervisors (first supervisor added per clinic)' },
  RS:  { label: 'Regular Supervisor',       sheet: 'Regular Supervisors' },
  NU:  { label: 'Nurse',                    sheet: 'Nurses' },
  NN:  { label: 'NXTSTIM Nurse',            sheet: 'NXTSTIM Nurse' },
  SS:  { label: 'Support Staff',            sheet: 'Support Admin / Support Staff' },
  SPO: { label: 'Security Privacy Officer', sheet: 'Security/Privacy Officer' },
  MS:  { label: 'Monitoring Supervisor',    sheet: 'Monitoring Supervisor' },
  BO:  { label: 'Billing Officer',          sheet: 'Billing Officer' }
});

/** Resolve a role key from any spelling used in a feature file or the sheets. */
function roleKey(name) {
  const want = String(name).toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, role] of Object.entries(ROLES)) {
    const candidates = [key, role.label, role.sheet, role.label.replace(/s$/, ''), `${role.label}s`];
    if (candidates.some((c) => String(c).toLowerCase().replace(/[^a-z]/g, '') === want)) return key;
  }
  // "Support Admin" (RBAC-permission.feature) and "Support Staff" are one role.
  if (/^supportadmin/.test(want)) return 'SS';
  if (/^securityprivacyofficer$/.test(want)) return 'SPO';
  throw new Error(
    `rbacMatrix: unknown role "${name}". Known roles: ` +
    Object.values(ROLES).map((r) => r.label).join(', ')
  );
}

function roleLabel(name) {
  return ROLES[roleKey(name)].label;
}

// ---- Value vocabulary -----------------------------------------------------

const YES = 'yes';
const NO = 'no';
const VIEW_ONLY = 'view-only';
const UNSPEC = 'unspecified';   // blank cell in the sheet
const OWN = 'own-only';
const CLINIC = 'clinic-only';
const SUPERVISED = 'supervised-only';
const ALL_PATIENTS = 'all-patients';
const PROFILES = 'profiles-only';
const NXT_PROFILES = 'nxtstim-profiles-only';
const NON_RPM = 'non-rpm-only';
const NO_TIMER = 'no-timer';
const WITH_TIMER = 'with-timer';
const NO_TIME_LOG = 'cannot-log-time';
const NXT_SUPERVISORS = 'nxtstim-supervisors-only';

/** True when the role is meant to have the affordance in some form. */
function isAllowed(value) {
  return value !== NO && value !== UNSPEC;
}

/** Scope qualifiers we record but cannot prove without multi-clinic fixtures. */
const SCOPE_VALUES = Object.freeze([CLINIC, SUPERVISED, ALL_PATIENTS, OWN, PROFILES, NXT_PROFILES, NON_RPM, NXT_SUPERVISORS]);

// Shorthand row builder: `row(section, permission, {EA: YES, …})`. Any role key
// left out defaults to UNSPEC so a blank sheet cell stays blank rather than
// silently becoming a "no".
function row(section, permission, values) {
  const full = {};
  for (const key of Object.keys(ROLES)) full[key] = values[key] === undefined ? UNSPEC : values[key];
  return { section, permission, values: full };
}

// ---- MATRIX ---------------------------------------------------------------

const MATRIX = Object.freeze([
  // ===== Admin Management =====
  row('Admin Management', 'View/Edit Admins',
    { EA: 'full', BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: VIEW_ONLY, SPO: YES, MS: NO, BO: NO }),
  row('Admin Management', 'Add/Delete Admins',
    { EA: NO, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: NO }),
  row('Admin Management', 'View Admin Communications',
    { EA: YES, BA: NO, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Admin Management', 'View Admin Login History',
    { EA: YES, BA: NO, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: YES, MS: NO, BO: NO }),

  // ===== Supervisor Management =====
  row('Supervisor Management', 'View Supervisors',
    { EA: 'full', BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: NO, NN: NO, SS: VIEW_ONLY, SPO: YES, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'Add New Supervisors',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'Edit Supervisor Details',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'Make Supervisors Inactive',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'Modify Supervisor Permissions',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'View Supervisor Communications',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: CLINIC, BO: NO }),
  row('Supervisor Management', 'View Supervisor Login History',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: YES, SPO: YES, MS: CLINIC, BO: NO }),

  // ===== Clinic Management =====
  row('Clinic Management', 'View Clinics',
    { EA: 'full', BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: YES, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: YES }),
  row('Clinic Management', 'Add New Clinics',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: NO }),
  row('Clinic Management', 'Edit Clinic Details',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: NO }),
  row('Clinic Management', 'Make Clinics Inactive',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: NO }),
  row('Clinic Management', 'View clinic Supervisors',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: YES, NN: YES, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: YES }),
  row('Clinic Management', 'View clinic Nurses',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: YES, NU: PROFILES, NN: NXT_PROFILES, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: YES }),
  row('Clinic Management', 'View Clinic Metrics',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: NO, NN: NO, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: YES }),
  row('Clinic Management', 'Manage Device Permissions',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Clinic Management', 'Manage Patient Tags',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: NO, NN: NO, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: YES }),
  row('Clinic Management', 'Upload Files to the Clinic File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: YES, RS: YES, NU: YES, NN: YES, SS: NO, SPO: NO, MS: YES, BO: NO }),
  row('Clinic Management', 'Delete files from the Clinic File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: YES, RS: YES, NU: OWN, NN: OWN, SS: NO, SPO: NO, MS: YES, BO: NO }),
  row('Clinic Management', 'View files in the Clinic File Vault',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: YES, RS: YES, NU: YES, NN: YES, SS: YES, SPO: NO, MS: YES, BO: YES }),
  row('Clinic Management', 'Download Files in the Clinic File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: YES, RS: NO, SS: NO, SPO: NO, MS: YES, BO: NO }),
  row('Clinic Management', 'Manage (Upload/View/Download) Clinic File Vaults',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),

  // ===== Nurse Management =====
  row('Nurse Management', 'View Nurses',
    { EA: 'full', BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: PROFILES, NN: NXT_PROFILES, SS: VIEW_ONLY, SPO: YES, MS: CLINIC, BO: NO }),
  row('Nurse Management', 'Add New Nurses',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Nurse Management', 'Edit Nurse Information',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Nurse Management', 'Make Nurses Inactive',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Nurse Management', 'View Nurse Communications',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: NO, RS: NO, NU: OWN, NN: OWN, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Nurse Management', 'View Nurse Login History',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: NO, RS: NO, NU: OWN, NN: OWN, SS: YES, SPO: YES, MS: NO, BO: NO }),

  // ===== Support Staff Management =====
  row('Support Staff Management', 'View Support Staff',
    { EA: 'full', BA: YES, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: YES, MS: NO, BO: NO }),
  row('Support Staff Management', 'Add New Support Staff',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Support Staff Management', 'Edit Support Staff Information',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Support Staff Management', 'Make Support Staff Inactive',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Support Staff Management', 'View Support Staff Communications',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Support Staff Management', 'View Support Staff Login History',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: YES, MS: NO, BO: NO }),

  // ===== Patient Management =====
  row('Patient Management', 'View All Patient Data',
    { EA: YES, BA: NO, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'View Patient Tags',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'Enroll/Unroll Patient Tags',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'Edit Patient Information',
    { EA: NON_RPM, BA: NO, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: YES, SPO: NO, MS: NO, BO: NO }),
  row('Patient Management', 'Add New Patients',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'Add/Deactivate Programs',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'View Patient Overview',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'View Patient Profile',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'View Patient Care Plan',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'View Session History',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'View Past Services',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'View/Add Forms',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: VIEW_ONLY, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'View/Add Communications',
    { EA: NO_TIMER, BA: NO, MA: YES, RA: NO, ES: NO_TIMER, RS: NO_TIMER, NU: WITH_TIMER, NN: WITH_TIMER, SS: NO_TIME_LOG, SPO: NO, MS: NO_TIMER, BO: NO }),
  row('Patient Management', 'View File Vault',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Patient Management', 'Delete files from the File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: OWN, NN: OWN, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'Upload files to File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: SUPERVISED, NU: CLINIC, NN: ALL_PATIENTS, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'Download Files from File Vault',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Patient Management', 'View Care Codes',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: YES, RS: YES, NU: YES, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: YES, BO: YES }),

  // ===== Reports =====
  row('Reports', 'View Patient Monitoring Report',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Reports', 'Download Patient Monitoring Report',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Reports', 'View Code Progress Report',
    { BA: YES, MA: YES, RA: NO, ES: NXT_SUPERVISORS, RS: YES, SS: YES, SPO: NO, MS: YES, BO: YES }),
  row('Reports', 'Download Code Progress Report',
    { BA: YES, MA: YES, RA: NO, ES: NXT_SUPERVISORS, RS: YES, SS: YES, SPO: NO, MS: YES, BO: YES }),
  row('Reports', 'View Patient Data Report',
    { EA: YES, BA: YES, MA: YES, RA: YES, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: NO }),
  row('Reports', 'Download Patient Data Report',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: ALL_PATIENTS, SS: YES, SPO: NO, MS: CLINIC, BO: NO }),
  row('Reports', 'View Clinic Monthly Goal Report',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: NO, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Reports', 'Download Clinic Monthly Goal Report',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: NO, SS: YES, SPO: NO, MS: CLINIC, BO: YES }),
  row('Reports', 'View Code Summary Report Card',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),
  row('Reports', 'Download Code Summary Report',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: NO, SS: NO, SPO: NO, MS: CLINIC, BO: NO }),

  // ===== Billing =====
  row('Billing', 'View Invoices and Stats',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: VIEW_ONLY, SPO: NO, MS: NO, BO: YES }),
  row('Billing', 'Adjust Clinic Credit Balances',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: YES }),
  row('Billing', 'Edit/Void/Download Invoices',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: YES }),
  row('Billing', 'Mark Invoices as Paid',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: YES }),
  row('Billing', 'Create/Send Invoices',
    { EA: YES, BA: YES, MA: NO, RA: NO, ES: NO, RS: NO, NU: NO, NN: NO, SS: NO, SPO: NO, MS: NO, BO: YES }),

  // ===== Notes (Notes- RBAC.xlsx; Monitoring Supervisor and Billing Officer
  // are absent from that sheet, hence unspecified) =====
  row('Notes', 'View Notes',
    { EA: YES, BA: YES, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: YES, SS: YES, SPO: NO }),
  row('Notes', 'Add Notes',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: CLINIC, NN: YES, SS: YES, SPO: NO }),
  row('Notes', 'Edit Notes',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: OWN, NN: OWN, SS: YES, SPO: NO }),
  row('Notes', 'Delete Notes',
    { EA: YES, BA: NO, MA: YES, RA: NO, ES: CLINIC, RS: CLINIC, NU: OWN, NN: OWN, SS: OWN, SPO: NO })
]);

// ---- CHECKS: how each row is proven against the live app ------------------
//
// `read`  — the affordance that proves the permission is granted.
// `write` — the mutating affordance that must be ABSENT when the sheet says
//           "View Only" (and present otherwise).
// `unmappable` — no UI surface exists for this row today; the reason is shown
//           in the report and the row is counted as pending, never as a pass.
//
// The `roleFilter` on /users probes is how the four collapsed "… Management"
// sections are still told apart: the affordance is read from a grid row (or a
// user-detail page) belonging to a user of THAT role.

const key = (section, permission) => `${section}::${permission}`;

const CHECKS = Object.freeze({
  // ---- Admin Management → /users rows whose role is an admin role ----
  [key('Admin Management', 'View/Edit Admins')]: {
    read:  { kind: 'userRowVisible', roleFilter: 'admin' },
    write: { kind: 'userDetailButton', roleFilter: 'admin', label: /^Edit$/i }
  },
  [key('Admin Management', 'Add/Delete Admins')]: {
    read: { kind: 'roleOption', roles: ['Executive Admin', 'Billing Admin', 'Monitoring Admin', 'Reporting Admin'] }
  },
  [key('Admin Management', 'View Admin Communications')]: {
    read: { kind: 'userDetailTab', roleFilter: 'admin', tab: /^Communication/i }
  },
  [key('Admin Management', 'View Admin Login History')]: {
    read: { kind: 'userDetailTab', roleFilter: 'admin', tab: /^Login History/i }
  },

  // ---- Supervisor Management ----
  [key('Supervisor Management', 'View Supervisors')]: {
    read:  { kind: 'userRowVisible', roleFilter: 'supervisor' },
    write: { kind: 'userDetailButton', roleFilter: 'supervisor', label: /^Edit$/i }
  },
  [key('Supervisor Management', 'Add New Supervisors')]: {
    read: { kind: 'roleOption', roles: ['Elevated Supervisor', 'Regular Supervisor', 'Monitoring Supervisor'] }
  },
  [key('Supervisor Management', 'Edit Supervisor Details')]: {
    read: { kind: 'userDetailButton', roleFilter: 'supervisor', label: /^Edit$/i }
  },
  [key('Supervisor Management', 'Make Supervisors Inactive')]: {
    read: { kind: 'userRowMenu', roleFilter: 'supervisor', item: /Mark as Inactive/i }
  },
  [key('Supervisor Management', 'Modify Supervisor Permissions')]: {
    unmappable: 'Supervisor permissions are edited from the Roles screen, which is a role-definition surface rather than a per-supervisor one; there is no per-supervisor permission editor in this build.'
  },
  [key('Supervisor Management', 'View Supervisor Communications')]: {
    read: { kind: 'userDetailTab', roleFilter: 'supervisor', tab: /^Communication/i }
  },
  [key('Supervisor Management', 'View Supervisor Login History')]: {
    read: { kind: 'userDetailTab', roleFilter: 'supervisor', tab: /^Login History/i }
  },

  // ---- Clinic Management → /clinics ----
  [key('Clinic Management', 'View Clinics')]: {
    read:  { kind: 'grid', path: 'clinics' },
    write: { kind: 'button', path: 'clinics', label: /^Add Clinic$/i }
  },
  [key('Clinic Management', 'Add New Clinics')]: {
    read: { kind: 'button', path: 'clinics', label: /^Add Clinic$/i }
  },
  [key('Clinic Management', 'Edit Clinic Details')]: {
    read: { kind: 'clinicDetailButton', label: /^Edit$/i }
  },
  [key('Clinic Management', 'Make Clinics Inactive')]: {
    read: { kind: 'clinicRowMenu', item: /Mark as Inactive|Make Inactive|Inactivate/i }
  },
  [key('Clinic Management', 'View clinic Supervisors')]: {
    read:  { kind: 'clinicTab', tab: /^Supervisor/i },
    write: { kind: 'clinicTabButton', tab: 'Supervisor', label: /^Add|Assign/i }
  },
  [key('Clinic Management', 'View clinic Nurses')]: {
    read:  { kind: 'clinicTab', tab: /^Nurses/i },
    write: { kind: 'clinicTabButton', tab: 'Nurses', label: /^Add|Assign/i }
  },
  [key('Clinic Management', 'View Clinic Metrics')]: {
    read:  { kind: 'button', path: 'clinics', label: /^View Metrics$/i },
    write: { kind: 'clinicMetricsEditable' }
  },
  [key('Clinic Management', 'Manage Device Permissions')]: {
    read: { kind: 'clinicTab', tab: /Device Permission/i }
  },
  [key('Clinic Management', 'Manage Patient Tags')]: {
    read:  { kind: 'clinicTab', tab: /^Patient Tags/i },
    write: { kind: 'clinicTabButton', tab: 'Patient Tags', label: /^Add|^Create|^Manage/i }
  },
  [key('Clinic Management', 'Upload Files to the Clinic File Vault')]: {
    read: { kind: 'clinicTabButton', tab: 'File Vault', label: /Upload/i }
  },
  [key('Clinic Management', 'Delete files from the Clinic File Vault')]: {
    read: { kind: 'clinicTabButton', tab: 'File Vault', label: /Delete|Remove/i }
  },
  [key('Clinic Management', 'View files in the Clinic File Vault')]: {
    read: { kind: 'clinicTab', tab: /^File Vault/i }
  },
  [key('Clinic Management', 'Download Files in the Clinic File Vault')]: {
    read: { kind: 'clinicTabButton', tab: 'File Vault', label: /Download|Export/i }
  },
  [key('Clinic Management', 'Manage (Upload/View/Download) Clinic File Vaults')]: {
    read: { kind: 'clinicTabButton', tab: 'File Vault', label: /Upload|Manage/i }
  },

  // ---- Nurse Management ----
  [key('Nurse Management', 'View Nurses')]: {
    read:  { kind: 'userRowVisible', roleFilter: 'nurse' },
    write: { kind: 'userDetailButton', roleFilter: 'nurse', label: /^Edit$/i }
  },
  [key('Nurse Management', 'Add New Nurses')]: {
    read: { kind: 'roleOption', roles: ['Nurse', 'NXTSTIM Nurse'] }
  },
  [key('Nurse Management', 'Edit Nurse Information')]: {
    read: { kind: 'userDetailButton', roleFilter: 'nurse', label: /^Edit$/i }
  },
  [key('Nurse Management', 'Make Nurses Inactive')]: {
    read: { kind: 'userRowMenu', roleFilter: 'nurse', item: /Mark as Inactive/i }
  },
  [key('Nurse Management', 'View Nurse Communications')]: {
    read: { kind: 'userDetailTab', roleFilter: 'nurse', tab: /^Communication/i }
  },
  [key('Nurse Management', 'View Nurse Login History')]: {
    read: { kind: 'userDetailTab', roleFilter: 'nurse', tab: /^Login History/i }
  },

  // ---- Support Staff Management ----
  [key('Support Staff Management', 'View Support Staff')]: {
    read: { kind: 'userRowVisible', roleFilter: 'support staff' }
  },
  [key('Support Staff Management', 'Add New Support Staff')]: {
    read: { kind: 'roleOption', roles: ['Support Staff'] }
  },
  [key('Support Staff Management', 'Edit Support Staff Information')]: {
    read: { kind: 'userDetailButton', roleFilter: 'support staff', label: /^Edit$/i }
  },
  [key('Support Staff Management', 'Make Support Staff Inactive')]: {
    read: { kind: 'userRowMenu', roleFilter: 'support staff', item: /Mark as Inactive/i }
  },
  [key('Support Staff Management', 'View Support Staff Communications')]: {
    read: { kind: 'userDetailTab', roleFilter: 'support staff', tab: /^Communication/i }
  },
  [key('Support Staff Management', 'View Support Staff Login History')]: {
    read: { kind: 'userDetailTab', roleFilter: 'support staff', tab: /^Login History/i }
  },

  // ---- Patient Management → /patients and the patient record ----
  [key('Patient Management', 'View All Patient Data')]: {
    read: { kind: 'grid', path: 'patients' }
  },
  [key('Patient Management', 'View Patient Tags')]: {
    read: { kind: 'patientTab', tab: /^Patient Tags/i }
  },
  [key('Patient Management', 'Enroll/Unroll Patient Tags')]: {
    read: { kind: 'patientTabButton', tab: 'Patient Tags', label: /Enroll|Unroll|^Add/i }
  },
  [key('Patient Management', 'Edit Patient Information')]: {
    read: { kind: 'patientTabButton', tab: 'Patient Profile', label: /^Edit$/i }
  },
  [key('Patient Management', 'Add New Patients')]: {
    read: { kind: 'button', path: 'patients', label: /^Add Patient$/i }
  },
  [key('Patient Management', 'Add/Deactivate Programs')]: {
    read: { kind: 'patientDetailButton', label: /Add Program|Deactivate Program/i }
  },
  [key('Patient Management', 'View Patient Overview')]: {
    read: { kind: 'patientTab', tab: /^Overview/i }
  },
  [key('Patient Management', 'View Patient Profile')]: {
    read: { kind: 'patientTab', tab: /^Patient Profile/i }
  },
  [key('Patient Management', 'View Patient Care Plan')]: {
    read: { kind: 'patientTab', tab: /^Care Plan/i }
  },
  [key('Patient Management', 'View Session History')]: {
    read: { kind: 'patientTab', tab: /^Sessions? History/i }
  },
  [key('Patient Management', 'View Past Services')]: {
    read: { kind: 'patientTab', tab: /^Past Programs|^Past Services/i }
  },
  [key('Patient Management', 'View/Add Forms')]: {
    read:  { kind: 'patientTab', tab: /^Forms/i },
    write: { kind: 'patientTabButton', tab: 'Forms', label: /^Add|^Create|^New/i }
  },
  [key('Patient Management', 'View/Add Communications')]: {
    read:  { kind: 'patientTabButton', tab: 'Communications', label: /Add Communication/i },
    // "Cannot log time" / "No Timer" both mean the session timer must be absent;
    // only the two nurse roles get "With Timer".
    write: { kind: 'patientTabButton', tab: 'Communications', label: /Timer|Log Time/i }
  },
  [key('Patient Management', 'View File Vault')]: {
    read: { kind: 'patientTab', tab: /^File Vault/i }
  },
  [key('Patient Management', 'Delete files from the File Vault')]: {
    read: { kind: 'patientTabButton', tab: 'File Vault', label: /Delete|Remove/i }
  },
  [key('Patient Management', 'Upload files to File Vault')]: {
    read: { kind: 'patientTabButton', tab: 'File Vault', label: /Upload/i }
  },
  [key('Patient Management', 'Download Files from File Vault')]: {
    read: { kind: 'patientTabButton', tab: 'File Vault', label: /Download|Export/i }
  },
  [key('Patient Management', 'View Care Codes')]: {
    read: { kind: 'patientTabText', tab: 'Care Plans', pattern: /\b99\d{3}\b/ }
  },

  // ---- Reports → /reports cards ----
  [key('Reports', 'View Patient Monitoring Report')]: {
    read: { kind: 'reportCard', name: /Patient Monitoring Report/i }
  },
  [key('Reports', 'Download Patient Monitoring Report')]: {
    read: { kind: 'reportAction', card: /Patient Monitoring Report/i, label: /Generate Report|Download|Export/i }
  },
  [key('Reports', 'View Code Progress Report')]: {
    read: { kind: 'reportCard', name: /Codes? Progress Report/i }
  },
  [key('Reports', 'Download Code Progress Report')]: {
    read: { kind: 'reportAction', card: /Codes? Progress Report/i, label: /Generate Report|Download|Export/i }
  },
  [key('Reports', 'View Patient Data Report')]: {
    read: { kind: 'reportCard', name: /Patient Data Report/i }
  },
  [key('Reports', 'Download Patient Data Report')]: {
    read: { kind: 'reportAction', card: /Patient Data Report/i, label: /Generate Report|Download|Export/i }
  },
  [key('Reports', 'View Clinic Monthly Goal Report')]: {
    read: { kind: 'reportCard', name: /Clinic Monthly Goal Report/i }
  },
  [key('Reports', 'Download Clinic Monthly Goal Report')]: {
    read: { kind: 'reportAction', card: /Clinic Monthly Goal Report/i, label: /Generate Report|Download|Export/i }
  },
  [key('Reports', 'View Code Summary Report Card')]: {
    read: { kind: 'reportCard', name: /Code Summary Report/i }
  },
  [key('Reports', 'Download Code Summary Report')]: {
    read: { kind: 'reportAction', card: /Code Summary Report/i, label: /Generate Report|Download|Export/i }
  },

  // ---- Billing → /invoices ----
  [key('Billing', 'View Invoices and Stats')]: {
    read:  { kind: 'grid', path: 'invoices' },
    write: { kind: 'button', path: 'invoices', label: /New Invoice|Create Invoice|Generate Invoice/i }
  },
  [key('Billing', 'Adjust Clinic Credit Balances')]: {
    // Must NOT match the clinic Billing tab's read-only "Credit Log" sub-tab —
    // being able to READ the credit history is not being able to adjust it.
    read: { kind: 'clinicBillingButton', label: /Adjust|Add Credit|Credit Adjustment|Update Balance/i }
  },
  [key('Billing', 'Edit/Void/Download Invoices')]: {
    read: { kind: 'invoiceRowMenu', item: /Edit|Void|Download/i }
  },
  [key('Billing', 'Mark Invoices as Paid')]: {
    read: { kind: 'invoiceRowMenu', item: /Mark as Paid|Record Payment/i }
  },
  [key('Billing', 'Create/Send Invoices')]: {
    read: { kind: 'button', path: 'invoices', label: /New Invoice|Create Invoice|Send Invoice/i }
  },

  // ---- Notes → the patient record's Notes drawer ----
  //
  // Notes are not a tab: the drawer opens from an icon-only button in the patient
  // header (aria-label="Show All Notes", sitting next to "Report"/"Add Program").
  // Edit and Delete are icon-only buttons that appear on a note card on hover,
  // so PermissionsPage identifies them by activating and dismissing each one —
  // see noteActions().
  //
  // `on: 'others'` means the probe deliberately targets a note the acting user
  // did NOT write, which is what makes "Own Notes Only" testable: for that
  // expectation the affordance must be ABSENT here (see verdictFor).
  [key('Notes', 'View Notes')]: {
    read: { kind: 'notesVisible' }
  },
  [key('Notes', 'Add Notes')]: {
    read: { kind: 'notesAdd' }
  },
  [key('Notes', 'Edit Notes')]: {
    read: { kind: 'noteAction', action: 'edit', on: 'others', scope: 'others-records' }
  },
  [key('Notes', 'Delete Notes')]: {
    read: { kind: 'noteAction', action: 'delete', on: 'others', scope: 'others-records' }
  }
});

// ---- Query helpers --------------------------------------------------------

const SECTIONS = Object.freeze([...new Set(MATRIX.map((r) => r.section))]);

/** Every sheet row for a section, with this role's expected value + its check. */
function rowsFor(section, role) {
  const rk = roleKey(role);
  return MATRIX
    .filter((r) => r.section.toLowerCase() === String(section).toLowerCase())
    .map((r) => ({
      section: r.section,
      permission: r.permission,
      expected: r.values[rk],
      check: CHECKS[key(r.section, r.permission)] || null
    }));
}

/** The expected value of one permission for one role. */
function expectedFor(section, permission, role) {
  const hit = MATRIX.find(
    (r) => r.section.toLowerCase() === String(section).toLowerCase() &&
           r.permission.toLowerCase() === String(permission).toLowerCase()
  );
  if (!hit) throw new Error(`rbacMatrix: no row for "${section}::${permission}".`);
  return hit.values[roleKey(role)];
}

/**
 * Turn an expectation + an observation into a verdict.
 *
 *   observation = { read: {present, detail}, write: {present, detail}|null }
 *
 * Returns { ok, status: 'pass'|'fail'|'pending', message }.
 */
function verdictFor(expected, observation, check) {
  if (check && check.unmappable) {
    return { ok: true, status: 'pending', message: `no UI surface — ${check.unmappable}` };
  }
  if (!check || !check.read) {
    return { ok: true, status: 'pending', message: 'no probe defined for this permission yet' };
  }

  const read = observation.read || { present: false, detail: 'not observed' };
  const write = observation.write || null;

  // A probe aimed at ANOTHER user's record inverts the "Own Only" expectation:
  // being able to edit/delete your own note is the grant, being able to touch
  // someone else's is the violation. This is how "Their Own Notes Only" in the
  // Notes sheet is actually tested rather than waved through.
  if (check.read.scope === 'others-records') {
    const ownOnly = expected === OWN;
    const denied = !isAllowed(expected);
    if (ownOnly || denied) {
      if (read.present) {
        return {
          ok: false,
          status: 'fail',
          message: ownOnly
            ? `sheet says "${expected}" (own records only) but the action is offered on another user's record: ${read.detail}`
            : `sheet says "${expected}" but the action is offered: ${read.detail}`
        };
      }
      return {
        ok: true,
        status: 'pass',
        message: ownOnly
          ? `correctly limited to own records — not offered on another user's record (${read.detail})`
          : `correctly unavailable — ${read.detail}`
      };
    }
    if (!read.present) {
      return { ok: false, status: 'fail', message: `sheet says "${expected}" but the action is missing: ${read.detail}` };
    }
    return { ok: true, status: 'pass', message: `available on another user's record as granted — ${read.detail}` };
  }

  if (expected === VIEW_ONLY) {
    if (!read.present) {
      return { ok: false, status: 'fail', message: `expected READ access (View Only) but ${read.detail}` };
    }
    // A write control that is rendered but DISABLED is not write access — the
    // role can look at it and cannot use it, which is what View Only means.
    if (write && write.present && write.enabled === false) {
      return {
        ok: true,
        status: 'pass',
        message: `view-only confirmed — ${read.detail}; the write control is present but disabled (${write.detail})`
      };
    }
    if (write && write.present) {
      return { ok: false, status: 'fail', message: `expected View Only, but the write affordance is available: ${write.detail}` };
    }
    if (!write) {
      return { ok: true, status: 'pending', message: `read access confirmed (${read.detail}); no write probe defined to prove it is view-only` };
    }
    return { ok: true, status: 'pass', message: `view-only confirmed — ${read.detail}; write affordance absent` };
  }

  if (!isAllowed(expected)) {
    if (read.present) {
      return { ok: false, status: 'fail', message: `sheet says "${expected}" but the affordance IS available: ${read.detail}` };
    }
    return { ok: true, status: 'pass', message: `correctly unavailable — ${read.detail}` };
  }

  // Granted, in some scope.
  if (!read.present) {
    return { ok: false, status: 'fail', message: `sheet says "${expected}" but the affordance is missing: ${read.detail}` };
  }
  // A qualifier that also says "and no more than this" — e.g. "No Timer" grants
  // Communications but forbids the timer; "Own Only" grants delete but only for
  // one's own records.
  if (write) {
    const forbidsWrite = [NO_TIMER, NO_TIME_LOG].includes(expected);
    if (forbidsWrite && write.present) {
      return { ok: false, status: 'fail', message: `sheet says "${expected}" but the restricted control is available: ${write.detail}` };
    }
  }
  const scoped = SCOPE_VALUES.includes(expected);
  return {
    ok: true,
    status: 'pass',
    message: scoped
      ? `available — ${read.detail} (scope "${expected}" recorded; proving scope needs multi-clinic fixtures)`
      : `available — ${read.detail}`
  };
}

module.exports = {
  ROLES,
  MATRIX,
  CHECKS,
  SECTIONS,
  VALUES: { YES, NO, VIEW_ONLY, UNSPEC, OWN, CLINIC, SUPERVISED, ALL_PATIENTS, NO_TIMER, WITH_TIMER, NO_TIME_LOG },
  roleKey,
  roleLabel,
  isAllowed,
  rowsFor,
  expectedFor,
  verdictFor
};
