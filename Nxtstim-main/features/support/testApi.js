/**
 * testApi.js — API client for the NXTSTIM QA backend.
 *
 * Source of truth: https://qa-nxtstim-api.azurewebsites.net/api/docs
 * (raw spec at /api/docs-json)
 *
 * Auth model (per swagger components.securitySchemes):
 *   - All endpoints require   x-api-key: <TEST_API_KEY>
 *   - User-context endpoints  also need Authorization: Bearer <accessToken>
 *
 * This module owns the JWT session for the current process: login() stores
 * the access/refresh tokens, subsequent calls send the bearer automatically,
 * logout() clears them.
 *
 * Mailbox access (OTPs / link extraction) lives in features/support/gmailClient.js
 * and emailHelper.js — the QA backend does not expose mailbox or time-travel
 * endpoints, so scenarios that need those go through IMAP instead.
 */

const { envReady } = require('./env');

// ---- Session state -------------------------------------------------------

const session = { accessToken: null, refreshToken: null };

function setAuth({ accessToken, refreshToken } = {}) {
  if (accessToken !== undefined) session.accessToken = accessToken;
  if (refreshToken !== undefined) session.refreshToken = refreshToken;
}

function clearAuth() {
  session.accessToken = null;
  session.refreshToken = null;
}

function getAuth() {
  return { ...session };
}

function isAuthed() {
  return !!session.accessToken;
}

// ---- Config --------------------------------------------------------------

function isConfigured() {
  return envReady('TEST_API_BASE_URL', 'TEST_API_KEY');
}

function requireConfigured(stepLabel) {
  if (!isConfigured()) {
    throw new Error(
      `${stepLabel}: TEST_API_BASE_URL / TEST_API_KEY are not set. ` +
      `Configure them in .env to run @e2e-backend or @e2e-admin scenarios.`
    );
  }
}

// ---- Request builder -----------------------------------------------------

function authHeaders({ withBearer = true } = {}) {
  const headerName = process.env.TEST_API_AUTH_HEADER || 'x-api-key';
  const headerValue = process.env.TEST_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (headerValue) headers[headerName] = headerValue;
  // The QA server validates the session via HttpOnly cookies set by /login,
  // NOT the Authorization: Bearer header that swagger documents. Same token
  // value — different transport. Send both so we're covered if either path
  // is later honoured by another endpoint.
  if (withBearer && (session.accessToken || session.refreshToken)) {
    const parts = [];
    if (session.accessToken)  parts.push('accessToken='  + session.accessToken);
    if (session.refreshToken) parts.push('refreshToken=' + session.refreshToken);
    headers['Cookie'] = parts.join('; ');
    if (session.accessToken) headers['Authorization'] = 'Bearer ' + session.accessToken;
  }
  return headers;
}

function substitutePath(template, substitutions = {}) {
  let path = template;
  for (const [k, v] of Object.entries(substitutions)) {
    path = path.replace(':' + k, encodeURIComponent(String(v)));
  }
  return path;
}

function toQueryString(query) {
  if (!query || Object.keys(query).length === 0) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
    else params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

async function request(method, path, { body, query, substitutions, withBearer } = {}) {
  const base = process.env.TEST_API_BASE_URL;
  if (!base) {
    throw new Error(
      `TEST_API_BASE_URL is not set. Copy .env.example to .env and fill it in.`
    );
  }
  const url =
    base.replace(/\/$/, '') +
    substitutePath(path, substitutions) +
    toQueryString(query);

  const opts = { method, headers: authHeaders({ withBearer }) };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const err = new Error(
      `testApi ${method} ${path} failed: ${res.status} ${res.statusText} — ${String(text).slice(0, 300)}`
    );
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

// ====================== AUTH ENDPOINTS ====================================

/** POST /api/auth/login — stores accessToken + refreshToken in module session. */
async function login(email, password) {
  const r = await request('POST', '/api/auth/login', {
    body: { email, password },
    withBearer: false
  });
  setAuth({ accessToken: r?.accessToken, refreshToken: r?.refreshToken });
  return r;
}

/** POST /api/auth/logout — clears the module session unconditionally. */
async function logout() {
  try {
    return await request('POST', '/api/auth/logout', {});
  } finally {
    clearAuth();
  }
}

/** POST /api/auth/refresh-token — uses the in-memory refreshToken. */
async function refreshToken() {
  if (!session.refreshToken) {
    throw new Error('testApi.refreshToken: no refresh token in session — login() first');
  }
  const r = await request('POST', '/api/auth/refresh-token', {
    body: { refreshToken: session.refreshToken },
    withBearer: false
  });
  if (r?.accessToken) {
    setAuth({ accessToken: r.accessToken, refreshToken: r.refreshToken });
  }
  return r;
}

/** GET /api/users/me — current logged-in user (requires bearer). */
async function getMe() {
  return request('GET', '/api/users/me');
}

/** POST /api/auth/forgot-password — sends the reset email. */
async function forgotPassword(email) {
  return request('POST', '/api/auth/forgot-password', {
    body: { email },
    withBearer: false
  });
}

/**
 * POST /api/auth/get-reset-password-link — generates a reset URL WITHOUT
 * sending an email. Test-friendly fast path; use when a scenario needs
 * "the user's reset link" but you don't want to scrape an email inbox.
 * Returns { resetPasswordUrl, token, expiresAt, email }.
 */
async function getResetPasswordLink(email) {
  return request('POST', '/api/auth/get-reset-password-link', {
    body: { email },
    withBearer: false
  });
}

/** POST /api/auth/reset-password — submit a new password with the reset token. */
async function resetPassword({ token, password, confirmPassword }) {
  return request('POST', '/api/auth/reset-password', {
    body: { token, password, confirmPassword: confirmPassword ?? password },
    withBearer: false
  });
}

/** GET /api/auth/validate-reset-token?key=<token> — checks token is still valid. */
async function validateResetToken(key) {
  return request('GET', '/api/auth/validate-reset-token', {
    query: { key },
    withBearer: false
  });
}

/**
 * POST /api/auth/change-password-logged-in — requires bearer.
 * Body schema (verified 2026-07-13): { currentPassword, password, confirmPassword }.
 * Accepts `newPassword` as an alias for convenience.
 */
async function changePasswordLoggedIn({ currentPassword, newPassword, password, confirmPassword }) {
  const next = password ?? newPassword;
  return request('POST', '/api/auth/change-password-logged-in', {
    body: {
      currentPassword,
      password: next,
      confirmPassword: confirmPassword ?? next
    }
  });
}

/** POST /api/auth/verify-current-password — requires bearer. */
async function verifyCurrentPassword({ password }) {
  return request('POST', '/api/auth/verify-current-password', {
    body: { password }
  });
}

/** POST /api/auth/resend-otp — resend the OTP email. */
async function resendOtp({ email }) {
  return request('POST', '/api/auth/resend-otp', {
    body: { email },
    withBearer: false
  });
}

/** GET /api/auth/check-otp-expiry?email=... — returns expiry info, not the OTP itself. */
async function checkOtpExpiry(email) {
  return request('GET', '/api/auth/check-otp-expiry', {
    query: { email },
    withBearer: false
  });
}

/** POST /api/auth/set-first-password — onboarding completion. Needs the OTP from email. */
async function setFirstLoginPassword({ email, otp, password }) {
  return request('POST', '/api/auth/set-first-password', {
    body: { email, otp, password },
    withBearer: false
  });
}

/** POST /api/auth/account-reactivation — admin-triggered reactivation email. */
async function accountReactivation({ email }) {
  return request('POST', '/api/auth/account-reactivation', {
    body: { email },
    withBearer: false
  });
}

/** POST /api/auth/resend-email — generic resend (subtype-driven). */
async function resendEmail({ email, type }) {
  return request('POST', '/api/auth/resend-email', {
    body: { email, type },
    withBearer: false
  });
}

/** POST /api/auth/clear-cookies. */
async function clearCookies() {
  return request('POST', '/api/auth/clear-cookies', { withBearer: false });
}

// ====================== USER / ADMIN ENDPOINTS ===========================

/** GET /api/users/admins — paginated. Pass { page, pageSize, searchTerm, isActive, ... }. */
async function getAdmins(query = {}) {
  return request('GET', '/api/users/admins', { query });
}

/** GET /api/users/{id}/details?roleGroup=admin|supervisor|nurse|support_staff */
async function getUserDetails(id, roleGroup) {
  return request('GET', '/api/users/:id/details', {
    substitutions: { id },
    query: { roleGroup }
  });
}

/** PATCH /api/users/{id}/active — note: rejected by API for admin roles. */
async function setUserActive(id, isActive) {
  return request('PATCH', '/api/users/:id/active', {
    substitutions: { id },
    body: { isActive }
  });
}

/** DELETE /api/users/users?ids=<id>&ids=<id> */
async function deleteUsers(ids) {
  const arr = Array.isArray(ids) ? ids : [ids];
  return request('DELETE', '/api/users/users', { query: { ids: arr } });
}

/** PATCH /api/users/admins/{id} — edit admin profile fields. */
async function editAdmin(id, body) {
  return request('PATCH', '/api/users/admins/:id', {
    substitutions: { id },
    body
  });
}

// ----- Admin provisioning -------------------------------------------------

const ADMIN_ROLES = Object.freeze([
  'executive_admin',
  'billing_admin',
  'monitoring_admin',
  'reporting_admin',
  'admin',
  'super_admin'
]);

/**
 * POST /api/auth/register — provisions a new admin account.
 * roles defaults to ['executive_admin']; pass any subset of ADMIN_ROLES.
 */
async function registerAdmin({ email, firstName, lastName, password, roles }) {
  return request('POST', '/api/auth/register', {
    body: {
      email,
      firstName,
      lastName,
      password,
      roles: roles && roles.length ? roles : ['executive_admin']
    },
    withBearer: false
  });
}

/**
 * Best-effort idempotent admin provisioning. Tries /api/auth/register; if
 * the email is already taken (400/409), returns { created: false } so callers
 * can proceed straight to login. Throws on any other error.
 */
async function ensureAdmin({ email, password, firstName = 'TestQA', lastName = 'Admin', roles } = {}) {
  try {
    const response = await registerAdmin({ email, firstName, lastName, password, roles });
    return { created: true, response };
  } catch (err) {
    if (err.status === 409 || err.status === 400) {
      return { created: false, response: err.body, error: err };
    }
    throw err;
  }
}

// ----- Other-persona registration (stubs for the next scope expansion) ---

async function registerNurse(body)        { return request('POST', '/api/users/nurses',        { body }); }
async function registerSupervisor(body)   { return request('POST', '/api/users/supervisors',   { body }); }
async function registerSupportStaff(body) { return request('POST', '/api/users/support-staff', { body }); }

// ----- Login history ------------------------------------------------------

/** GET /api/login-history/{id} — by user id (not email). */
async function getLoginHistory(id) {
  return request('GET', '/api/login-history/:id', { substitutions: { id } });
}

// ====================== Teardown helper ==================================

/**
 * Look up an admin by email via getAdmins and DELETE by id. Used by the
 * After-hook teardown ("await testApi.deleteUser(email)") to keep the QA
 * backend tidy. Silently no-ops if the user can't be found.
 */
async function deleteUser(email) {
  let list;
  try {
    const r = await getAdmins({ searchTerm: email, pageSize: 50 });
    list = r?.data || r?.items || r?.admins || r?.users || r?.results || (Array.isArray(r) ? r : []);
  } catch {
    return { skipped: true, reason: 'lookup-failed' };
  }
  const match = list.find(
    (u) => (u.email || u.username || '').toLowerCase() === String(email).toLowerCase()
  );
  if (!match) return { skipped: true, reason: 'not-found' };
  return deleteUsers([match.id]);
}

// ====================== Exports ===========================================

module.exports = {
  // session
  setAuth,
  clearAuth,
  getAuth,
  isAuthed,
  // config
  isConfigured,
  requireConfigured,
  // auth flow
  login,
  logout,
  refreshToken,
  getMe,
  forgotPassword,
  getResetPasswordLink,
  resetPassword,
  validateResetToken,
  changePasswordLoggedIn,
  verifyCurrentPassword,
  resendOtp,
  checkOtpExpiry,
  setFirstLoginPassword,
  accountReactivation,
  resendEmail,
  clearCookies,
  // user management
  getAdmins,
  getUserDetails,
  setUserActive,
  deleteUsers,
  editAdmin,
  registerAdmin,
  registerNurse,
  registerSupervisor,
  registerSupportStaff,
  // login history
  getLoginHistory,
  // provisioning
  ensureAdmin,
  ADMIN_ROLES,
  // teardown
  deleteUser
};
