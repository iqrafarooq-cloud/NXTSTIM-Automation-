Feature: Clinic Management
  As an Executive Admin of the NXTSTIM portal
  I want to view, create, edit and manage clinics and their sub-records
  So that clinic data, billing and related records stay accurate

  Background:
    Given the admin is logged in and on the Clinics page
  # Clinics list 
  @clinics @positive @list
  Scenario: Clinics list displays all core UI elements
    Then the "Clinics" heading should be visible
    And the "Add Clinic" button should be visible
    And the "Active" and "Inactive" tabs should be visible
    And the clinic search, Filters, Sort By and Export CSV controls should be visible
    And the clinic grid should be displayed
    And the total clinics count should be visible

  @clinics @positive @list
  Scenario: Admin can switch between Active and Inactive tabs
    When the admin selects the "Inactive" tab
    Then the "Inactive" tab should be selected
    When the admin selects the "Active" tab
    Then the "Active" tab should be selected

  @clinics @positive @list @filter
  Scenario: Filters panel exposes City and State filters
    When the admin opens the Filters panel
    Then the Filters panel should offer City and State options

 #Search
  @clinics @positive @search @active
  Scenario: Searching each Search By field returns the matching clinic (Active)
    When the admin searches each field for a value taken from the grid
    Then every field should return the clinic it was taken from
    And every field's results should stay scoped to that field

  @clinics @positive @search @active
  Scenario: Search tolerates case, partial terms and surrounding spaces (Active)
    When the admin searches "ID" for an exact form of a grid value
    Then the source clinic should be in the results
    When the admin searches "Clinic Name" for a lowercase form of a grid value
    Then the source clinic should be in the results
    When the admin searches "City" for a partial form of a grid value
    Then the source clinic should be in the results
    When the admin searches "Street Address" for a padded form of a grid value
    Then the source clinic should be in the results

  @clinics @negative @search @active
  Scenario: Search does not return records from a different field (Active)
    When the admin searches "Clinic Name" using a value from the "City" column
    Then the clinics grid should show the empty state
    When the admin searches "Zip Code" using a value from the "State" column
    Then the clinics grid should show the empty state

  @clinics @negative @search @active
  Scenario: Switching the Search By field re-scopes the current text (Active)
    When the admin searches "City" for an exact form of a grid value
    Then the source clinic should be in the results
    When the admin switches the Search By field to "Clinic Name"
    Then the clinics grid should show the empty state

  @clinics @negative @search @active
  Scenario: Unmatched, special-character and invalid searches show the empty state (Active)
    When the admin searches "Clinic Name" for "zzqx-no-such-clinic-42"
    Then the clinics grid should show the empty state
    When the admin searches "Clinic Name" for "@#$%^&*()"
    Then the clinics grid should show the empty state
    When the admin searches "ID" for "99999999"
    Then the clinics grid should show the empty state

  @clinics @positive @search @active
  Scenario: Blank searches and clearing restore the full clinics list (Active)
    When the admin searches "Clinic Name" for an exact form of a grid value
    Then the source clinic should be in the results
    When the admin clears the clinic search
    Then all clinics should be listed again
    When the admin searches "Clinic Name" for "   "
    Then all clinics should be listed again

  @clinics @positive @search @inactive
  Scenario: Search works the same on the Inactive tab
    When the admin selects the "Inactive" tab
    And the admin searches each field for a value taken from the grid
    Then every field should return the clinic it was taken from
    And every field's results should stay scoped to that field

#Sort By
  @clinics @positive @sort @active
  Scenario: Sort By offers only ID ascending and descending (Active)
    When the admin opens the Sort By menu
    Then the Sort By menu should offer only "ID: Asc" and "ID: Desc"
    And "ID: Desc" should be the default selected sort

  @clinics @positive @sort @active
  Scenario: Sorting by ID orders the whole list ascending and descending (Active)
    When the admin sorts clinics by "ID: Asc"
    Then the clinics should be ordered by ID ascending
    When the admin sorts clinics by "ID: Desc"
    Then the clinics should be ordered by ID descending
    And the descending order should be the exact reverse of the ascending order

  @clinics @positive @sort @inactive
  Scenario: Sorting works the same on the Inactive tab
    When the admin selects the "Inactive" tab
    And the admin sorts clinics by "ID: Asc"
    Then the clinics should be ordered by ID ascending
    When the admin sorts clinics by "ID: Desc"
    Then the clinics should be ordered by ID descending
    And the descending order should be the exact reverse of the ascending order

  
#Filters
  @clinics @positive @filter @active
  Scenario: Single City and State filters each narrow the grid (Active)
    When the admin filters by a City that has clinics
    Then every visible clinic row should match the selected City
    And at least one clinic row should be shown
    When the admin filters by a State that has clinics
    Then every visible clinic row should match the selected State
    And at least one clinic row should be shown

  @clinics @positive @filter @combined @active
  Scenario: Combined City and State filter returns the union of both (Active)
    When the admin filters by a City, then by a State, then by both together
    Then the combined result should equal the union of the City and State results
    And every visible clinic row should match the selected City or State
    And at least one clinic row should be shown

  @clinics @positive @filter @inactive
  Scenario: City, State and combined filters behave the same on the Inactive tab
    When the admin selects the "Inactive" tab
    And the admin filters by a City that has clinics
    Then every visible clinic row should match the selected City
    And at least one clinic row should be shown
    When the admin filters by a City, then by a State, then by both together
    Then the combined result should equal the union of the City and State results
    And every visible clinic row should match the selected City or State

  @clinics @positive @filter @combined @inactive
  Scenario: Combined filter shows the matching side when the other has no data (Inactive)
    When the admin selects the "Inactive" tab
    And the admin filters by a State that has clinics and a City that has none
    Then every visible clinic row should match the selected State
    And at least one clinic row should be shown

  @clinics @negative @filter @combined @inactive
  Scenario: Filtering by City/State with no matching clinics shows the empty state (Inactive)
    When the admin selects the "Inactive" tab
    And the admin filters by a City and a State that have no clinics
    Then the clinics grid should show "Nothing here yet"

  @clinics @positive @filter @search
  Scenario: The City and State filter search boxes match options partially
    When the admin opens the "City" filter
    And the admin searches the City filter for a partial term
    Then only City options containing the searched term should be listed
    When the admin opens the "State" filter
    And the admin searches the State filter for a partial term
    Then only State options containing the searched term should be listed

  @clinics @negative @filter @search
  Scenario: The City and State filter search boxes show a message when nothing matches
    When the admin opens the "City" filter
    And the admin searches the City filter for "zzqx-no-such-city-42"
    Then the City filter should show "No search results found"
    When the admin opens the "State" filter
    And the admin searches the State filter for "zzqx-no-such-state-42"
    Then the State filter should show "No search results found"


#EXPORT CSV
  @clinics @positive @export @active
  Scenario: Export CSV button is visible and enabled when the grid has records
    Then the clinic grid should be displayed
    And the Export CSV button should be visible and enabled

  @clinics @positive @export @e2e @active
  Scenario: Exporting without any search or filters downloads every displayed record
    When the admin exports the clinics list as CSV
    Then a valid CSV file named "NXTSTIM.csv" should be downloaded
    And the CSV should contain the same columns as the grid
    And the CSV should not contain a Monitoring Metrics column
    And the CSV should be well-formed
    And the CSV record count should equal the displayed clinics count
    And every exported value should match the clinic shown in the grid

  @clinics @positive @export @search @active
  Scenario: Exporting after a search downloads only the searched records
    When the admin searches for a value that narrows the grid
    And the admin exports the clinics list as CSV
    Then the CSV record count should equal the displayed clinics count
    And the exported records should match the clinics shown in the grid

  @clinics @positive @export @filter @active
  Scenario: Exporting after applying a filter downloads only the filtered records
    When the admin filters by a City that has clinics
    And the admin exports the clinics list as CSV
    Then the CSV record count should equal the displayed clinics count
    And every exported record should match the selected City
    And the exported records should match the clinics shown in the grid

  @clinics @positive @export @combined @active
  Scenario: Exporting after both a search and a filter downloads only the combined records
    When the admin applies a City filter and a search together
    And the admin exports the clinics list as CSV
    Then the CSV record count should equal the displayed clinics count
    And the exported records should match the clinics shown in the grid

  @clinics @positive @export @edge @active
  Scenario: Exporting when only one record is displayed downloads a single row
    When the admin searches "ID" for an exact form of a grid value
    Then the source clinic should be in the results
    When the admin exports the clinics list as CSV
    Then the CSV should contain exactly 1 record
    And the exported records should match the clinics shown in the grid

  @clinics @negative @export @edge @active
  Scenario: Exporting when no clinics match downloads a header-only CSV
    When the admin searches "ID" for "99999999"
    Then the clinics grid should show the empty state
    When the admin exports the clinics list as CSV
    Then a valid CSV file named "NXTSTIM.csv" should be downloaded
    And the CSV should contain the column headers but no data records

  @clinics @positive @export @active
  Scenario: The exported file follows the naming convention and is valid CSV
    When the admin exports the clinics list as CSV
    Then the downloaded file name should be "NXTSTIM.csv"
    And the CSV should contain the same columns as the grid
    And the CSV should not contain a Monitoring Metrics column
    And the CSV should be well-formed

  @clinics @positive @export @inactive
  Scenario: Export reflects the grid the same way on the Inactive tab
    When the admin selects the "Inactive" tab
    And the admin exports the clinics list as CSV
    Then the CSV record count should equal the displayed clinics count
    And the exported records should match the clinics shown in the grid

  
  # Add Clinic  
  @clinics @negative @add-clinic
  Scenario: Add Clinic wizard opens on Step 1 with the Next button disabled
    When the admin opens the Add Clinic wizard
    Then the Add Clinic wizard should be on step 1
    And the Next button should be disabled

  @clinics @negative @add-clinic
  Scenario Outline: Add Clinic Step 1 stays invalid for a malformed contact email
    When the admin opens the Add Clinic wizard
    And the admin fills the clinic profile with name "QA Neg Clinic" contact "QA Tester" email "<email>" phone "3105648721"
    Then the Next button should be disabled

    Examples:
      | email            |
      | plainaddress     |
      | user@            |
      | @domain.com      |
      | user@domain      |
      | user@.com        |

  @clinics @negative @add-clinic
  Scenario: Next is disabled until every required Step 1 field is filled
    When the admin opens the Add Clinic wizard
    And the admin fills the clinic profile with name "Only Name" contact "" email "" phone ""
    Then the Next button should be disabled

  @clinics @positive @add-clinic
  Scenario: Completing Step 1 enables the Next button
    When the admin opens the Add Clinic wizard
    And the admin fills the clinic profile with name "QA Valid Clinic" contact "QA Tester" email "qa.valid@bytecorp.io" phone "3105648721"
    Then the Next button should be enabled

  @clinics @negative @add-clinic
  Scenario: Billing step stays invalid until its required fields are filled
    When the admin opens the Add Clinic wizard
    And the admin proceeds to the billing step
    Then the Add Clinic wizard should be on step 2
    And the Next button should be disabled

  @clinics @positive @add-clinic
  Scenario: "Same as Clinic Profile" copies the contact email into the billing email
    When the admin opens the Add Clinic wizard
    And the admin proceeds to the billing step
    And the admin enables "Same as Clinic Profile"
    Then the billing email should match the contact email

  @clinics @negative @add-clinic
  Scenario: Back from the billing step returns to Step 1 with data retained
    When the admin opens the Add Clinic wizard
    And the admin proceeds to the billing step
    And the admin goes back to the previous step
    Then the Add Clinic wizard should be on step 1
    And the clinic name field should retain "QA Clinic"
  @clinics @positive @add-clinic
  Scenario: "Same as Billing Details" completes the shipping step and enables Add Clinic
    When the admin opens the Add Clinic wizard
    And the admin proceeds to the shipping step
    And the admin enables "Same as Billing Details"
    Then the Add Clinic wizard should be on step 3
    And the Add Clinic button should be enabled

  @clinics @negative @add-clinic
  Scenario: Closing the wizard with Escape discards it without creating a clinic
    When the admin opens the Add Clinic wizard
    And the admin closes the Add Clinic wizard
    Then the Add Clinic wizard should be closed
    And the admin should still be on the Clinics page


  @clinics @positive @e2e @add-clinic
  Scenario: Admin creates a new clinic through the full 3-step wizard
    When the admin creates a new clinic through the wizard
    Then a success indication should confirm the clinic was created
    And the new clinic should appear in the Active clinics list
    And the total clinics count should increase by 1

  # Clinic detail page (positive)
  @clinics @positive @detail
  Scenario: Opening a clinic shows all detail sub-tabs
    When the admin opens the details of the first clinic
    Then the clinic detail page should be displayed
    And all clinic detail sub-tabs should be visible

  @clinics @positive @detail @profile
  Scenario: Clinic Profile tab shows the clinic information and an Edit action
    When the admin opens the details of the first clinic
    And the admin opens the "Clinic Profile" detail tab
    Then the clinic profile should show the clinic information
    And an Edit action should be available

  @clinics @positive @detail @supervisor @nurses
  Scenario: Supervisor and Nurses tabs render listing controls
    When the admin opens the details of the first clinic
    And the admin opens the "Supervisor" detail tab
    Then the listing should show sort and export controls
    When the admin opens the "Nurses" detail tab
    Then the listing should show sort and export controls

  @clinics @positive @detail @patient-tags
  Scenario: Patient Tags tab renders its listing and Add control
    When the admin opens the details of the first clinic
    And the admin opens the "Patient Tags" detail tab
    Then the Patient Tags listing should show its controls

  @clinics @positive @detail @file-vault
  Scenario: File Vault tab renders its listing and Upload control
    When the admin opens the details of the first clinic
    And the admin opens the "File Vault" detail tab
    Then the File Vault listing should show its controls

  @clinics @positive @detail @supervisor @nurses @patient-tags @file-vault
  Scenario: A brand-new clinic shows empty Supervisor, Nurses, Patient Tags and File Vault listings
    Given the admin has a reusable test clinic open
    When the admin opens the "Supervisor" detail tab
    Then the "Supervisor" listing should show an empty state
    When the admin opens the "Nurses" detail tab
    Then the "Nurses" listing should show an empty state
    When the admin opens the "Patient Tags" detail tab
    Then the "Patient Tags" listing should show an empty state
    When the admin opens the "File Vault" detail tab
    Then the "File Vault" listing should show an empty state

  @clinics @positive @detail @billing
  Scenario: Billing tab shows its inner tabs, financial, tax and subscription details
    When the admin opens the details of the first clinic
    And the admin opens the "Billing" detail tab
    Then the billing inner tabs should be visible
    And the billing inner tab "Billing Information" should be visible
    And the billing inner tab "Payments" should be visible
    And the billing inner tab "Invoices" should be visible
    And the billing inner tab "Credit Log" should be visible
    And the billing details should show "Subscription Plan"
    And the billing details should show "Tax Status"

  # Inactivate clinic (negative + destructive e2e)
  @clinics @negative @inactivate
  Scenario: Inactivate confirmation warns the action is irreversible and can be cancelled
    Given the admin has a reusable test clinic in the list
    When the admin opens the Inactivate dialog for the new clinic
    Then the inactivate dialog should warn the action is not reversible
    When the admin cancels the inactivate dialog
    Then the new clinic should still be Active

  @clinics @destructive @e2e @inactivate
  Scenario: Admin inactivates a throwaway clinic and it moves to the Inactive tab
    Given the admin has created a new clinic
    When the admin opens the Inactivate dialog for the new clinic
    And the admin confirms the inactivation
    And the admin selects the "Inactive" tab
    Then the new clinic should appear in the list
    And the new clinic should only offer the View Details action
