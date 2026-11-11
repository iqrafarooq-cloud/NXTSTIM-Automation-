/**
 * emailTypes.js — single source of truth for NXTSTIM auth emails.
 *
 * Each entry maps a logical type to:
 *   - subject:        RegExp the Subject header must match (anchored loose so a
 *                     stray prefix like "[QA] " still matches, but the verbatim
 *                     production subject is the primary case).
 *   - subjectLiteral: The exact production subject string — kept alongside the
 *                     regex so feature steps can assert verbatim when needed.
 *   - extract:        What actionable item this email carries:
 *                       'otp'                — set-first-password OTP
 *                       'resetLink'          — reset-password URL
 *                       'reactivationLink'   — account-reactivation URL
 *                       null                 — informational only (no action)
 *   - trigger:        Short label naming the API call / event that produces it.
 *                     Used only for error messages; not invoked from here.
 *
 * Keep this file as data — no logic. emailHelper.js dispatches against it.
 */

const TYPES = Object.freeze({
  OTP: {
    // Two production subjects observed in QA: the older "Get Started…" copy
    // and the newer "Welcome to NXTSTIM – Your Login OTP" template that the
    // Resend Email kebab triggers. Both carry the onboarding OTP.
    subject:        /(Get Started with Your NXTSTIM Account|Welcome to NXTSTIM.*Login\s*OTP)/i,
    subjectLiteral: 'Welcome to NXTSTIM – Your Login OTP (Expires in 2 Days)',
    extract:        'otp',
    trigger:        'admin createUser / testApi.resendOtp'
  },
  MFA_CODE: {
    // Multi-Factor Authentication code emails. Subjects observed across surfaces:
    //   - enabling Email MFA in Settings / email-MFA login challenge
    //                                      → "Your NXTSTIM verification code"
    //   - older setup copy                 → "Your NXTSTIM MFA setup code"
    // The subject regex matches the verification/MFA/2FA wording WITHOUT
    // requiring the literal "MFA" (the live email omits it), but still requires
    // the word "code" so it never collides with the onboarding OTP or the
    // password-reset emails. The body carries a 6-digit numeric code, pulled by
    // emailHelper.extractMfaCode (purpose-built for the 6-digit case — the
    // generic extractOtp's numeric fallback can latch onto the wrong number).
    subject:        /NXTSTIM\b.*\b(?:MFA|2FA|two[-\s]?factor|multi[-\s]?factor|verification|security|authentication)\b.*\bcode\b/i,
    subjectLiteral: 'Your NXTSTIM verification code',
    extract:        'mfaCode',
    trigger:        'enable Email MFA in Settings / email-MFA login challenge'
  },
  PASSWORD_RESET: {
    subject:        /NXTSTIM Password Reset Request/i,
    subjectLiteral: 'NXTSTIM Password Reset Request',
    extract:        'resetLink',
    trigger:        'testApi.forgotPassword'
  },
  ACCOUNT_REACTIVATION: {
    subject:        /^Account Reactivation$/i,
    subjectLiteral: 'Account Reactivation',
    extract:        'reactivationLink',
    trigger:        'testApi.accountReactivation'
  },
  REACTIVATION_RESET: {
    // Sent to a Pending user when the admin reactivates them — uses the
    // password-reset link copy because the user still has to set a password.
    subject:        /Action Required:\s*Reset Your NXTSTIM Password/i,
    subjectLiteral: 'Action Required: Reset Your NXTSTIM Password',
    extract:        'resetLink',
    trigger:        'testApi.accountReactivation on Pending user'
  },
  PASSWORD_CHANGED: {
    subject:        /Your NXTSTIM Password Has Been Successfully Changed/i,
    subjectLiteral: 'Your NXTSTIM Password Has Been Successfully Changed',
    extract:        null,
    trigger:        'testApi.resetPassword / testApi.changePasswordLoggedIn'
  },
  PASSWORD_EXPIRING: {
    subject:        /Your NXTSTIM Account Password Will Expire Soon/i,
    subjectLiteral: 'Your NXTSTIM Account Password Will Expire Soon',
    extract:        null,
    trigger:        'password-expiry warning cron'
  },
  PASSWORD_EXPIRED: {
    subject:        /Your NXTSTIM Account Password is expired/i,
    subjectLiteral: 'Your NXTSTIM Account Password is expired',
    extract:        'resetLink',
    trigger:        'password-expiry cron once past threshold'
  }
});

// Friendly aliases so feature files can use natural language without
// memorising the SCREAMING_SNAKE_CASE ids.
const ALIASES = Object.freeze({
  'otp':                                  'OTP',
  'new user':                             'OTP',
  'new user (otp)':                       'OTP',
  'onboarding':                           'OTP',
  'get started':                          'OTP',

  'mfa':                                  'MFA_CODE',
  'mfa code':                             'MFA_CODE',
  'mfa otp':                              'MFA_CODE',
  'mfa setup code':                       'MFA_CODE',
  '2fa code':                             'MFA_CODE',
  'verification code':                    'MFA_CODE',
  'email mfa code':                       'MFA_CODE',

  'password reset':                       'PASSWORD_RESET',
  'reset password':                       'PASSWORD_RESET',
  'forgot password':                      'PASSWORD_RESET',

  'account reactivation':                 'ACCOUNT_REACTIVATION',
  'reactivation':                         'ACCOUNT_REACTIVATION',
  'account reactivated':                  'ACCOUNT_REACTIVATION',

  'action required':                      'REACTIVATION_RESET',
  'reactivation reset':                   'REACTIVATION_RESET',
  'pending reactivation':                 'REACTIVATION_RESET',

  'password changed':                     'PASSWORD_CHANGED',
  'password updated':                     'PASSWORD_CHANGED',
  'password successfully changed':        'PASSWORD_CHANGED',

  'password expiring':                    'PASSWORD_EXPIRING',
  'password will expire':                 'PASSWORD_EXPIRING',
  'password will expire soon':            'PASSWORD_EXPIRING',

  'password expired':                     'PASSWORD_EXPIRED',
  'expired password':                     'PASSWORD_EXPIRED'
});

function resolveType(idOrAlias) {
  if (!idOrAlias) {
    throw new Error('emailTypes.resolveType: name is required');
  }
  const key = String(idOrAlias).trim();
  if (TYPES[key]) return { id: key, ...TYPES[key] };
  const aliased = ALIASES[key.toLowerCase()];
  if (aliased && TYPES[aliased]) return { id: aliased, ...TYPES[aliased] };
  const known = Object.keys(TYPES).concat(Object.keys(ALIASES)).join(', ');
  throw new Error(
    `emailTypes.resolveType: unknown email type "${idOrAlias}". ` +
    `Known ids/aliases: ${known}.`
  );
}

function listTypes() {
  return Object.keys(TYPES);
}

module.exports = {
  TYPES,
  ALIASES,
  resolveType,
  listTypes
};
