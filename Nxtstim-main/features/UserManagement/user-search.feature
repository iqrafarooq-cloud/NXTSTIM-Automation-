@UserManagement @UserList @search @Regression
Feature: Users list — Search By
  Background:
    Given I am logged in as an "Admin" user
    And I am on the "Users" tab

  @positive
  Scenario: Verify that Search By offers every searchable field and re-labels the search box
    Then the selected Search By field should be "User ID"
    And the search box placeholder should be "Search for User ID"
    When I open the Search By dropdown
    Then the Search By dropdown should offer:
      | User ID         |
      | Username        |
      | First Name      |
      | Last Name       |
      | Email           |
      | Phone Number    |
      | Onboarding Date |
    When I select "Username" as the Search By field
    Then the selected Search By field should be "Username"
    And the search box placeholder should be "Search for Username"
    When I select "First Name" as the Search By field
    Then the selected Search By field should be "First Name"
    And the search box placeholder should be "Search for First Name"
    When I select "Last Name" as the Search By field
    Then the selected Search By field should be "Last Name"
    And the search box placeholder should be "Search for Last Name"
    When I select "Email" as the Search By field
    Then the selected Search By field should be "Email"
    And the search box placeholder should be "Search for Email"
    When I select "Phone Number" as the Search By field
    Then the selected Search By field should be "Phone Number"
    And the search box placeholder should be "Search for Phone Number"
    When I select "Onboarding Date" as the Search By field
    Then the selected Search By field should be "Onboarding Date"
    And the search box placeholder should be "Search for Onboarding Date"

  @positive
  Scenario: Verify that every Search By field finds the user its value was taken from, on every sub-tab
    Given I note the unfiltered user count
    When I search every Search By field for a reference user's own value on every sub-tab:
      | Active   |
      | Pending  |
      | Inactive |
    Then every field should return the user its value came from
    And every field's results should stay scoped to that Search By field
    And every Onboarding Date search should have returned rows onboarded within a day of the searched date
    When I search the "Onboarding Date" field for "2026"
    Then every listed user's "Onboarding Date" value should contain the searched term
    And the total user count should equal the number of matching users
    And the total user count should be lower than or equal to the unfiltered count
    And no application error should be shown

  @positive
  Scenario: Verify that search tolerates UPPERCASE, partial fragments and padded whitespace
    Given I note a reference user from the list
    When I search the "Email" field for that user's value in UPPERCASE
    Then the reference user should be listed
    And every listed user's "Email" value should contain the searched term
    When I search the "Username" field for a partial fragment of that user's value
    Then the reference user should be listed
    And every listed user's "Username" value should contain the searched term
    When I search the "User ID" field for that user's value padded with spaces
    Then the reference user should be listed
    And every listed user's "User ID" value should contain the searched term
    And the total user count should be 1

  @positive
  Scenario: Verify that the total count reflects the search and clearing restores the full list
    Given I note the unfiltered user count
    When I search the "Email" field for "bytecorp.io"
    Then the total user count should equal the number of matching users
    And the total user count should be lower than the unfiltered count
    When I clear the search
    Then the total user count should equal the unfiltered count
    And the total user count should equal the number of matching users
    When I search the "Email" field for "   "
    Then the total user count should equal the unfiltered count
    And the total user count should equal the number of matching users

  # Negative
  @negative
  Scenario: Verify that searches which cannot match show the empty state on every field
    When I search the "User ID" field for "99999999"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Username" field for "zzzz-no-such-user-zzzz"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "First Name" field for "Qwertyuiopasdfgh"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Last Name" field for "Zxcvbnmasdfghjkl"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Email" field for "nobody@nowhere.invalid"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Phone Number" field for "0000000000000"
    Then the table should display the empty state
    And the total user count should be 0
    # Valid MM-DD-YYYY shape, but no user was onboarded in 1900.
    When I search the "Onboarding Date" field for "01-01-1900"
    Then the table should display the empty state
    And the total user count should be 0
    And no application error should be shown

  @negative
  Scenario: Verify that a value belonging to one column does not match under another field
    Given I note a reference user from the list
    When I search the "Phone Number" field using the reference user's "Email" value
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Username" field using the reference user's "Email" value
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "First Name" field using the reference user's "Phone Number" value
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Onboarding Date" field using the reference user's "User ID" value
    Then the table should display the empty state
    And the total user count should be 0
    And no application error should be shown

  @negative
  Scenario: Verify that switching the Search By field re-scopes the text that is already typed
    Given I note a reference user from the list
    When I search the "Email" field for that user's value
    Then the reference user should be listed
    When I select "Username" as the Search By field
    Then the table should display the empty state
    And the total user count should be 0
    And the search box should still hold the searched term

  @negative
  Scenario: Verify that Phone Number is matched on the formatted number, not on bare digits
    When I search the "Phone Number" field for "1111111111"
    Then the table should display the empty state
    And the total user count should be 0
    When I search the "Phone Number" field for "111) 111"
    Then every listed user's "Phone Number" value should contain the searched term
    And the total user count should equal the number of matching users
    And no application error should be shown

  @negative
  Scenario: Verify that special characters and an over-long term are handled without an error
    When I search the "Username" field for "@#$%^&*()"
    Then the table should display the empty state
    And the total user count should be 0
    And no application error should be shown
    When I search the "Email" field for "<script>alert(1)</script>"
    Then the table should display the empty state
    And the total user count should be 0
    And no application error should be shown
    When I search the "First Name" field for a 300 character term
    Then the table should display the empty state
    And the total user count should be 0
    And no application error should be shown
    When I clear the search
    Then the total user count should equal the number of matching users
