
@forgot-password
Feature: Forgot Password via emailed reset link
  As a portal user who forgot my password, I want to request a reset link by email
  So that I can set a new password and regain access.


 
  Background:
    Given the user is on the login page

  @e2e-backend @positive @e2e @requires-active-account
  Scenario: Reset the password using the link from the reset email
    Given the user opens the forgot password page
    When the user submits a password reset request for the account
    Then a password reset confirmation should be shown
    And a "NXTSTIM Password Reset Request" email should be received
    When the user opens the reset link from that email
    Then the Create New Password screen should be displayed
    When the user sets a new unique password on the reset screen
    Then the password reset should be successful
    And the new password should be accepted for the account

  @positive @e2e @requires-active-account
  Scenario: Reset the password end-to-end and log in with the new password via the UI
    Given the user opens the forgot password page
    When the user submits a password reset request for the account
    Then a password reset confirmation should be shown
    And a "NXTSTIM Password Reset Request" email should be received
    When the user opens the reset link from that email
    Then the Create New Password screen should be displayed
    When the user sets a new unique password on the reset screen
    Then the password reset should be successful
    When the user logs in with the newly reset password
    Then the user should be granted access or prompted for MFA

  @negative
  Scenario: Malformed or empty emails are rejected on the forgot password screen
    Given the user opens the forgot password page
    Then each of the following emails is rejected on the forgot password screen
      | email               |
      |                     |
      | plainaddress        |
      | user@               |
      | @bytecorp.io        |
      | user @bytecorp.io   |

  @negative
  Scenario: The Send Reset Link button remains disabled until a valid email is entered
    Given the user opens the forgot password page
    Then the Send Reset Link button should be disabled
    When the user enters a valid email address
    Then the Send Reset Link button should be enabled

  @negative
  Scenario: An invalid or expired reset link is rejected
    When the user opens a reset link with an invalid token
    Then the reset link should be rejected as invalid or expired

  @negative @requires-active-account
  Scenario: A previously used password reset link cannot be reused
    Given the user opens the forgot password page
    When the user submits a password reset request for the account
    Then a password reset confirmation should be shown
    And a "NXTSTIM Password Reset Request" email should be received
    When the user opens the reset link from that email
    Then the Create New Password screen should be displayed
    When the user sets a new unique password on the reset screen
    Then the password reset should be successful
    When the user opens the same reset link again
    Then the reset link should be rejected as invalid or expired

  @negative @e2e @requires-active-account
  Scenario: Resend locks the account with a suspended notice after the maximum reset attempts
    Given the user opens the forgot password page
    When the user submits a password reset request for the account
    Then a password reset confirmation should be shown
    And a "NXTSTIM Password Reset Request" email should be received
    When the user clicks Resend Email after the 1-minute cooldown
    Then a new "NXTSTIM Password Reset Request" email should be received
    When the user clicks Resend Email after the 1-minute cooldown
    Then a new "NXTSTIM Password Reset Request" email should be received
    When the user attempts to resend the reset email once more
    Then the account should be locked with a suspended-account notice
    And a 30-minute "Max attempt reached" lockout countdown should be displayed

