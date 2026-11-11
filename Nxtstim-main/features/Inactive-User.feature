
Feature: Inactive User Authentication
  As an authorized administrator
  I want to deactivate users
  So that inactive users cannot log into the application until they are reactivated.
  Background:
    Given the admin is logged in to the user management portal
  @smoke @critical @e2e
  Scenario: Admin deactivates a newly activated user and the inactive user cannot log in
    When the admin creates a new user with a unique email
    Then the new user should appear in the "Pending" tab
    And an invitation email with an OTP should be delivered to the new user
    When the new user sets a password using the OTP from the invitation email
    Then the new user should appear in the "Active" tab
    When the admin marks the new user as inactive and confirms
    Then the new user should no longer appear in the "Active" tab
    And the new user should appear in the "Inactive" tab
    When the inactive user attempts to log in with the valid password
    Then the login should be blocked
    And an inactive-account error message should be shown

  @status
  Scenario: Admin successfully changes a user's status from Active to Inactive
    Given an active user exists
    When the admin changes the user's status to Inactive
    Then the user's status should be updated to Inactive
    And a success notification should be displayed

  @status
  Scenario: Inactive status persists after page refresh
    Given a user has been marked as Inactive
    When the admin refreshes the page
    Then the user should remain Inactive

  @login
  Scenario: Inactive user cannot log in with valid credentials
    Given an inactive user exists
    When the user enters valid credentials
    Then the login should be blocked
    And the following message should be displayed
      """
      Your account is in inactive state. Please contact support@nxtstim.com.
      """
