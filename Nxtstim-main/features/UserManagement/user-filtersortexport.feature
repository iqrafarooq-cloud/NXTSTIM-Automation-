@UserManagement @UserList @Regression
Feature: Users list — Filters, Sort By and Export CSV
  Background:
    Given I am logged in as an "Admin" user
    And I am on the "Users" tab
    And the users list state is reset

  @positive @list @sort @export
  Scenario: Verify that the Users list exposes the search, Filters, Sort By and Export CSV controls with their default state
    Then the user search, Filters, Sort By and Export CSV controls should be visible
    And the users grid should be displayed
    And the total user count should be visible
    And the Export CSV control should be visible and enabled
    When I open the Filters panel
    Then the Filters panel should offer Roles and Associated Clinic options
    When I open the Sort By menu
    Then the Sort By menu should offer:
      | ID: Asc                            |
      | ID: Desc                           |
      | Onboarding Date: Oldest to Newest  |
      | Onboarding Date: Newest to Oldest  |
    And exactly one Sort By option should be selected
    And "Onboarding Date: Newest to Oldest" should be the default selected Sort By option

  @positive @sort
  Scenario: Verify that sorting by ID and by Onboarding Date orders the whole list in both directions
    When I sort the users by "ID: Asc"
    Then the selected Sort By option should be "ID: Asc"
    And the full list of user IDs should be in ascending order
    When I note the full list of user IDs
    And I sort the users by "ID: Desc"
    Then the selected Sort By option should be "ID: Desc"
    And the full list of user IDs should be in descending order
    And the full list of user IDs should be the reverse of the noted order
    When I sort the users by "Onboarding Date: Oldest to Newest"
    Then the selected Sort By option should be "Onboarding Date: Oldest to Newest"
    And the full list of onboarding dates should be in ascending order
    When I sort the users by "Onboarding Date: Newest to Oldest"
    Then the selected Sort By option should be "Onboarding Date: Newest to Oldest"
    And the full list of onboarding dates should be in descending order

  # The Active sub-tab is what every other scenario in this file runs against;
  # this outline proves the same sort / filter / export contract holds on each of
  # the other three. All of them hold users — counted live 2026-07-26 at
  # Active 42, Pending 286, Suspended 8, Inactive 26 — so every assertion here is
  # the strict one, exactly as it runs on Active.
  @positive @sort @filter @export @subtab
  Scenario Outline: Verify that sorting, filtering and exporting behave the same way on the "<tab>" sub-tab
    When I click on the "<tab>" sub-tab
    Then the "<tab>" sub-tab should be highlighted as active
    And the Export CSV control should be visible and enabled
    When I export the users list as CSV
    Then the downloaded file should be named "NXTSTIM.csv"
    And the CSV record count should equal the displayed user count
    And the CSV should hold exactly the users the grid is showing
    And every CSV record should match the grid row with the same User ID
    When I sort the users by "ID: Asc"
    Then the selected Sort By option should be "ID: Asc"
    And the full list of user IDs should be in ascending order
    When I note the full list of user IDs
    And I sort the users by "ID: Desc"
    Then the selected Sort By option should be "ID: Desc"
    And the full list of user IDs should be in descending order
    And the full list of user IDs should be the reverse of the noted order
    When I filter by a Role that has users
    Then every listed user should carry the filtered role
    And the filtered result should hold exactly the users the grid showed for that value
    And at least one user row should be shown
    And no application error should be shown

    Examples:
      | tab       |
      | Suspended |
      | Pending   |
      | Inactive  |

  @positive @filter
  Scenario: Verify that the Roles and Associated Clinic filters each narrow the grid to matching users
    When I filter by a Role that has users
    Then every listed user should carry the filtered role
    And the filtered result should hold exactly the users the grid showed for that value
    And at least one user row should be shown
    And the total user count should equal the number of listed users
    When I filter by an Associated Clinic that has users
    Then every listed user should be associated with the filtered clinic
    And the filtered result should hold exactly the users the grid showed for that value
    And at least one user row should be shown
    And the total user count should equal the number of listed users

  @positive @filter @combined
  Scenario: Verify that values inside one dimension union, the two dimensions intersect, and Clear All restores the full list
    Given I note the unfiltered user count
    When I filter by two Roles that no single user shares
    Then the result should be the union of the two Role results
    And every listed user should carry one of the two filtered Roles
    And at least one user row should be shown
    When I filter by a Role and an Associated Clinic that share users
    Then the result should be the intersection of the Role and Clinic results
    And every listed user should carry both the filtered Role and Clinic
    And at least one user row should be shown
    And the Filters control should show a badge of 2
    And a "Clear All" control should be available
    When I clear all applied filters
    Then no filter should remain applied
    And all users should be listed again
    And no application error should be shown

  @positive @negative @filter @search
  Scenario: Verify that the Roles and Associated Clinic option searches match partially and report when nothing matches
    When I open the "Roles" filter options
    And I search the "Roles" filter options for a partial term
    Then only options containing the searched term should be listed
    When I search the "Roles" filter options for "zzqx-no-such-role-42"
    Then the filter options should show "No search results found"
    When I open the "Associated Clinic" filter options
    And I search the "Associated Clinic" filter options for a partial term
    Then only options containing the searched term should be listed
    When I search the "Associated Clinic" filter options for "zzqx-no-such-clinic-42"
    Then the filter options should show "No search results found"
    And no application error should be shown

  # Negative
  @negative @filter @combined @suspended
  Scenario: Verify that filter combinations no user satisfies show the empty state, not their union
    When I filter by a Role and an Associated Clinic that share no users
    Then the users grid should show "Nothing here yet"
    And the total user count should be 0
    And no application error should be shown
    When I click on the "Suspended" sub-tab
    And I filter by a Role that has no users on this sub-tab
    Then the users grid should show "Nothing here yet"
    And the total user count should be 0
    And no application error should be shown

  @positive @export
  Scenario: Verify that exporting without a search or filter downloads every displayed user
    When I export the users list as CSV
    Then the downloaded file should be named "NXTSTIM.csv"
    And the CSV columns should be:
      | User ID            |
      | Username           |
      | First Name         |
      | Last Name          |
      | Roles              |
      | Email Address      |
      | Phone Number       |
      | Onboarding Date    |
      | Associated Clinics |
    And the CSV columns should match the grid columns
    And the exported CSV should be well-formed
    And the CSV record count should equal the displayed user count
    And the CSV should hold exactly the users the grid is showing
    And every CSV record should match the grid row with the same User ID

  @positive @export @search @filter @combined
  Scenario: Verify that the export mirrors whatever narrows the grid — a search, either filter, and both together
    When I search for a value that narrows the grid
    And I export the users list as CSV
    Then the CSV record count should equal the displayed user count
    And the CSV should hold exactly the users the grid is showing
    And every CSV record should match the grid row with the same User ID
    When I clear the search
    And I filter by a Role that has users
    And I export the users list as CSV
    Then the CSV record count should equal the displayed user count
    And every CSV record should carry the filtered role
    And the CSV should hold exactly the users the grid is showing
    When I filter by an Associated Clinic that has users
    And I export the users list as CSV
    Then the CSV record count should equal the displayed user count
    And every CSV record should be associated with the filtered clinic
    And the CSV should hold exactly the users the grid is showing
    When I apply a Role filter and a search together
    And I export the users list as CSV
    Then the CSV record count should equal the displayed user count
    And every CSV record should carry the filtered role
    And the CSV should hold exactly the users the grid is showing

  @positive @export @sort @edge
  Scenario: Verify that the export follows the grid order and downloads exactly one row for a single displayed user
    When I sort the users by "ID: Asc"
    And I export the users list as CSV
    Then the CSV User ID column should be in ascending order
    And the CSV rows should be in the same order as the grid
    And the CSV record count should equal the displayed user count
    When I narrow the grid to a single user
    And I export the users list as CSV
    Then the CSV should contain exactly 1 data row
    And the CSV should hold exactly the users the grid is showing

  # Negative
  @negative @export @edge
  Scenario: Verify that exporting when no user matches downloads a header-only CSV
    When I search the "User ID" field for "99999999"
    Then the table should display the empty state
    And the "Export CSV" control should still be enabled
    When I export the users list as CSV
    Then the downloaded file should be named "NXTSTIM.csv"
    And the exported CSV should contain the column headers but no data records
    And no application error should be shown
