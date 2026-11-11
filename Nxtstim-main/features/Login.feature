Feature: User Authentication - Login
  Background:
    Given the user is on the login page

  # Login Screen Layout
  @positive
  Scenario: Login screen displays all required UI elements
    Then the NXTSTIM logo should be visible
    And the email input field should be visible

    And the password input field should be visible
    And the password field should have a show/hide toggle
    And the login button should be visible
    And the "Forgot your password?" link should be visible
    And the "Terms of Service" link should be visible

  @positive
  Scenario: Email and password fields show placeholder text
    Then the email field should have a non-empty placeholder
    And the password field should have a non-empty placeholder

  # Login Button State
  @negative
  Scenario: Login button is disabled when fields are incomplete
    Then the login button should be disabled
    When the user enters the base account email
    Then the login button should be disabled

  @positive
  Scenario: Login button becomes enabled when both fields are filled
    When the user enters the base account email
    And the user enters the base account password
    Then the login button should be enabled

  # Empty Field Validation
  @negative
  Scenario: Validation messages appear when login is attempted with empty fields
    When the user clicks the login button
    Then a validation message should be displayed for the email field
    And a validation message should be displayed for the password field

  # Invalid Email Validation
  @negative
  Scenario Outline: Invalid email format shows inline error
    When the user enters email "<email>"
    And the user enters password "StrongPass123!"
    And the user clicks the login button
    Then a validation message should be displayed for the email field
    And the form should not be submitted

    Examples:
      | email               |
      | plainaddress        |
      | user@               |
      | user.com            |
      | @domain.com         |
      | missing@domain      |
      | spaces in@email.com |
      | user@.com           |
      | user@domain..com    |

  # Password Visibility Toggle
  @positive
  Scenario: Password input is masked by default
    When the user enters password "StrongPass123!"
    Then the password field should be masked

  @positive
  Scenario: Password visibility toggle works correctly
    When the user enters password "StrongPass123!"
    And the user taps the password show/hide toggle
    Then the password field should be visible as plain text
    When the user taps the password show/hide toggle
    Then the password field should be masked

  # Successful Login
  @positive @e2e
  Scenario: Successful login redirects user to dashboard
    When the user enters the base account email
    And the user enters the base account password
    And the user clicks the login button
    Then the user should be redirected away from the login page
    And the user should see the dashboard or home page

  # Invalid Credentials
  @negative
  Scenario Outline: Invalid credentials show generic error message
    When the user enters email "<email>"
    And the user enters password "<password>"
    And the user clicks the login button
    Then the user should remain on the login page
    And an error message should be displayed

    Examples:
      | email                      | password         |
      | wrong.user@bytecorp.io     | StrongPass123!   |
      | executiveadmin@iqra.anonaddy.com | WrongPassword!   |

  

  
  # Terms of Service
  @positive
  Scenario: Terms of Service link is reachable
    Then the "Terms of Service" link should point to a Terms of Service URL

  # Security / Edge Cases
  @edge @negative
  Scenario: Very long email and password inputs are rejected
    When the user enters an email of length 300
    And the user enters a password of length 300
    And the user clicks the login button
    Then an error message should be displayed

  @edge @negative
  Scenario Outline: XSS and special characters are handled safely
    When the user enters email "<email>"
    And the user enters password "<password>"
    And the user clicks the login button
    Then the user should remain on the login page
    And an error message should be displayed

    Examples:
      | email                     | password           |
      | <script>alert(1)</script> | <script>x</script> |
      | 用户@bytecorp.io           | пароль123          |

  @edge @negative
  Scenario: Password is case sensitive
    When the user enters the base account email
    And the user enters password "STRONGPASS123!"
    And the user clicks the login button
    Then an error message should be displayed

  # Logout Flow
  @positive @e2e
  Scenario: User can log out successfully
    When the user enters the base account email
    And the user enters the base account password
    And the user clicks the login button
    And the user opens the profile menu
    And the user clicks the logout option
    Then the user should be redirected to the login page
    And the user should not be authenticated