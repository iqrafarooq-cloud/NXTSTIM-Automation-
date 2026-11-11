
@authorization @requires-active-account
Feature: Change Password from Settings
  As a logged-in portal user, I want to change my password
  So that I can maintain account security.
  Background:
    Given the user is on the login page

  # ===== POSITIVE CASES =====

  @ui @positive @e2e
  Scenario: Navigate to change password settings from profile dropdown
    Given the user is logged in with the change-password account
    When the user opens the profile menu
    And the user clicks the "Settings" menu item
    Then the Settings page should show a "Change your password" option
    And the Settings page should show a "Two factor authentication" option

  @e2e-backend @positive @e2e
  Scenario: Successfully change password from Settings
    Given the user is logged in with the change-password account
    When the user opens the profile menu
    And the user clicks the "Settings" menu item
    And the user clicks the Change Password CTA
    And the user enters the current account password in the change password modal
    And the user clicks Next in the change password modal
    And the user enters a new unique password in the change password modal
    And the user confirms the new password in the change password modal
    And the user clicks Change Password in the modal
    Then the change password modal should close
    And the user should see a "Password Changed Successfully" toast
    And the change-password account should accept the new password

  @e2e-backend @positive
  Scenario: Real-time password validation feedback in change password modal
    Given the user is logged in with the change-password account
    And the user is on the new-password step of the change password modal
    When the user types "P" into the new password field
    Then the password complexity checklist should reflect "uppercase" met
    And the password strength bar should be at "red" level
    When the user types "P@ssw0rd!23" into the new password field
    Then the password complexity checklist should reflect all rules met
    And the password strength bar should be at "green" level

  # ===== NEGATIVE CASES =====

  @e2e-backend @negative
  Scenario: Incorrect current password
    Given the user is logged in with the change-password account
    And the user is on the change-password modal current-password step
    When the user enters an incorrect current password in the change password modal
    And the user clicks Next in the change password modal
    Then the user should see a "Your Current Password is Incorrect" error
    And the change password modal should not advance to the new-password step

  @e2e-backend @negative
  Scenario: New password matches one of last 5 passwords
    Given the user is logged in with the change-password account
    And the account has a previously used password on record
    And the user is on the new-password step of the change password modal
    When the user enters the previously used password in the change password modal
    And the user confirms the previously used password in the change password modal
    And the user clicks Change Password in the modal
    Then a password-history error should be displayed
    And the change-password account password should not have been updated

  @ui @negative
  Scenario: MFA button should not redirect to change password
    Given the user is logged in with the change-password account
    When the user opens the profile menu
    And the user clicks the "Settings" menu item
    And the user clicks Enable Two Factor Authentication
    Then the user should NOT see the change password modal
    And the user should see the 2FA setup flow

  # ===== EDGE CASES =====
  @e2e-backend @edge
  Scenario: Successful password change resets the 90-day expiry cycle
    Given the user is logged in with the change-password account
    And the account password_set_date is 80 days ago
    When the user successfully changes their password to a new unique password
    Then the account password_set_date should be today

  @ui @edge
  Scenario: Reset password screen accepts exactly 8 characters meeting all rules
    Given the user is on the Create New Password screen using the change-password account's reset link
    When the user enters a new password "Ab1!defg"
    And the user enters confirm password "Ab1!defg"
    Then the password strength indicator should reflect a strong password
    And the Reset Password button should be enabled
