@UserManagement @adduser @Regression
Feature: Add New User modal

  Background:
    Given I am logged in as an "Admin" user
    And I am on the "Users" tab

  # POSITIVE
  @adduser @positive @happy-path
  Scenario: Verify that an admin can successfully add a new Nurse user and find them under Pending
    Given the "Add New User" modal is open
    When I select "Nurse" from the Role dropdown
    And I click the "Next" button
    Then I should be on Step 2 "Basic Details"
    When I fill in valid basic details
    And I click the "Next" button
    Then I should be on Step 3 "Permissions"
    When I select the first available clinic
    Then the "Add User" button should be enabled
    When I click the "Add User" button
    Then the modal should close
    And the user should be created successfully
    And a success message should confirm the user was added
    # A newly created user always lands in Pending until they set their password
    And the new user should appear in the "Pending" sub-tab
    And the new user should have the role "Nurse"
    And the new user's email and role should be accurately displayed
    And the "Associated Clinic" column for the new user should display the selected clinics


  @adduser @positive
  Scenario: Verify that the step count adapts to the selected role
    Given the "Add New User" modal is open
    When I select "Nurse" from the Role dropdown
    Then the step counter should read "Step 1/3"
    And the step indicator should display 3 steps total
    And the "Permissions" step should be visible
    When I deselect "Nurse" and select "Regular Supervisor" from the Role dropdown
    Then the step counter should read "Step 1/3"
    And the step indicator should display 3 steps total
    And the "Permissions" step should be visible
    When I deselect "Regular Supervisor" and select "Elevated Supervisor" from the Role dropdown
    Then the step counter should read "Step 1/3"
    And the step indicator should display 3 steps total
    And the "Permissions" step should be visible
    When I deselect "Elevated Supervisor" and select "Executive Admin" from the Role dropdown
    Then the step counter should read "Step 1/2"
    And the step indicator should display 2 steps total
    And the "Permissions" step should not be visible
    When I deselect "Executive Admin" and select "Support Staff" from the Role dropdown
    Then the step counter should read "Step 1/2"
    And the step indicator should display 2 steps total
    And the "Permissions" step should not be visible
    When I deselect "Support Staff" and select "NXTSTIM Nurse" from the Role dropdown
    Then the step counter should read "Step 1/2"
    And the step indicator should display 2 steps total
    And the "Permissions" step should not be visible
    When I deselect "NXTSTIM Nurse" and select "Monitoring Admin" from the Role dropdown
    Then the step counter should read "Step 1/2"
    And the step indicator should display 2 steps total
    And the "Permissions" step should not be visible

  @adduser @positive
  Scenario: Verify that the Add New User wizard walks Step 1 to Step 3 per role and discards on close
    # --- Step 1: modal, indicator, role dropdown ---
    When I note the roles offered by the Roles filter
    And I click the "Add New User" button
    Then a multi-step modal should open
    And a step indicator should be displayed
    And the step indicator should show each step with its name and description
    And Step 1 "Role Selection" should be the active step
    When I click on the "Role" dropdown
    Then every noted role should be offered in the Role dropdown
    And I should see a "Create a new role" option at the bottom of the list

    # --- Step 2 for a 3-step role: indicator states, fields, pickers ---
    When I select "Nurse" from the Role dropdown
    And I click the "Next" button
    Then I should be on Step 2 "Basic Details"
    And Step "Role Selection" should be marked completed
    And the "Basic Details" step should be highlighted as the current step
    And the "Permissions" step should be styled as an upcoming step
    And I should see the following required fields:
      | Field         |
      | First Name    |
      | Last Name     |
      | Email Address |
      | Phone Number  |
      | Gender        |
      | Language      |
    And the "Phone Number" field should include a country code selector
    When I open the "Select Gender" picker
    Then the picker should offer at least 2 options
    When I open the "Select Language" picker filtered by "Eng"
    Then the picker should offer "English (United States)"

    # --- 3-step role advances on Next ---
    When I fill in valid basic details
    Then the "Next" button should be enabled
    When I click the "Next" button
    Then I should be on Step 3 "Permissions"
    And Step "Role Selection" should be marked completed
    And Step "Basic Details" should be marked completed
    And Step "Permissions" should not be marked completed

    # --- Step 3 for a Nurse: one clinic, no program creation ---
    And I should see the "Clinic" field
    And the clinic control should be single-select
    And the "Allow Program Creation" field should not be present

    # --- Closing from Step 3 discards everything and reopens fresh ---
    When I click the "X" close icon on the modal
    Then the modal should close
    And the user should not have been created
    When I click the "Add New User" button
    Then a fresh modal should open on Step 1
    And no pre-filled data should be present from the previous attempt

    # --- Step 3 for a Supervisor: many clinics plus program creation ---
    When I select "Regular Supervisor" from the Role dropdown
    And I click the "Next" button
    And I fill in valid basic details
    And I click the "Next" button
    Then I should be on Step 3 "Permissions"
    And I should see the "Clinics" field
    And I should see the "Allow Program Creation" field
    And the "Clinics" field should allow selecting more than one clinic
    And the clinic control should offer at least one real clinic
    When I click on the "Allow Program Creation" dropdown
    Then I should see the options "Yes" and "No"
    When I click the "X" close icon on the modal
    Then the modal should close

    # --- 2-step role submits from Step 2, and Step 2 also closes cleanly ---
    When I click the "Add New User" button
    And I select "Support Staff" from the Role dropdown
    And I click the "Next" button
    Then I should be on Step 2 "Basic Details"
    When I fill in valid basic details
    Then the action button should display "Add User"
    When I click the "X" close icon on the modal
    Then the modal should close
    And the user should not have been created

  # CREATE A ROLE FROM INSIDE THE WIZARD
  # The Role dropdown ends in a "Create a new role" entry, so an admin can
  # define a role without leaving the Add User flow. Role.feature covers the
  # Create A Role drawer as reached from the Roles tab; what is specific to
  # THIS entry point is the hand-back — does the wizard survive the drawer,
  # does the new role reach the dropdown, and does its clinic scope drive the
  # wizard's step count.

  @adduser @positive @CreateRole @inline-role
  Scenario: Verify that Create a new role opens the drawer over the wizard and cancels without creating anything
    Given the "Add New User" modal is open
    When I click on the "Role" dropdown
    Then I should see a "Create a new role" option at the bottom of the list
    When I select the "Create a new role" option
    Then the "Create A Role" form should open
    And the Create A Role drawer should require a role name and a description
    And the "Create Role" button in the drawer should be disabled
    And the clinic assignment toggle should be off
    And no permission should be enabled by default
    And the Add New User wizard should still be open behind the drawer

    # --- Name + description alone are enough to arm the button ---
    When I fill in the new role name and description
    Then the "Create Role" button in the drawer should be enabled
    When I enable the clinic assignment toggle
    Then the drawer should offer the clinic scopes "Single" and "Multiple"
    And "Single" should be preselected as the clinic scope

    # --- Cancelling hands the wizard back untouched and saves nothing ---
    When I cancel the Create A Role drawer
    Then the Create A Role drawer should be closed
    And the Add New User wizard should still be on Step 1
    And the new role should not exist on the Roles tab

  @adduser @positive @CreateRole @inline-role
  Scenario: Verify that a role created from inside the wizard is usable and its clinic scope drives the step count
    Given the "Add New User" modal is open
    When I click on the "Role" dropdown
    And I select the "Create a new role" option
    Then the "Create A Role" form should open
    When I fill in the new role name and description
    And I enable the clinic assignment toggle
    And I choose the "Single" clinic scope
    And I submit the Create A Role drawer
    Then a success message "Role created successfully." should confirm the role was created
    And the Create A Role drawer should be closed
    And the Add New User wizard should still be on Step 1
    And the new role should appear on the Roles tab

    # --- A Single-clinic role must give the 3-step flow with one clinic ---
    # The reload is deliberate, not incidental: the dropdown does not pick the
    # new role up on its own. See the @known-issue scenario below.
    When I reload the Users screen and reopen the Add New User wizard
    And I select the new role from the Role dropdown
    Then the step counter should read "Step 1/3"
    And the "Permissions" step should be visible
    When I click the "Next" button
    And I fill in valid basic details
    And I click the "Next" button
    Then I should be on Step 3 "Permissions"
    And the clinic control should be single-select

  # NEGATIVE

  @adduser @negative
  Scenario: Verify that the Add New User wizard blocks every invalid input from Step 1 to Step 3
    Given the "Add New User" modal is open
    Then the "Next" button should be disabled
    When I select "Nurse" from the Role dropdown
    Then the "Next" button should become enabled
    When I click the "Next" button
    Then I should be on Step 2 "Basic Details"
    When I attempt to proceed
    Then I should remain on Step 2

    Given I am on Step 2 "Basic Details" for the "Support Staff" role
    When I fill in all required fields except "First Name"
    And I attempt to proceed
    Then a validation message should be displayed for the "First Name" field
    And I should remain on Step 2
    When I fill in all required fields except "Last Name"
    And I attempt to proceed
    Then a validation message should be displayed for the "Last Name" field
    And I should remain on Step 2
    When I fill in all required fields except "Email Address"
    And I attempt to proceed
    Then a validation message should be displayed for the "Email Address" field
    And I should remain on Step 2
    When I fill in all required fields except "Gender"
    And I attempt to proceed
    Then a validation message should be displayed for the "Gender" field
    And I should remain on Step 2
    When I fill in all required fields except "Language"
    And I attempt to proceed
    Then a validation message should be displayed for the "Language" field
    And I should remain on Step 2

    # --- A malformed email is caught inline, before any request goes out ---
    When I fill in valid basic details
    And I enter "invalid-email-format" in the Email Address field
    And I attempt to proceed
    Then a validation message "Enter a valid email" should be displayed in the wizard
    And I should remain on Step 2

    # --- An already used email is rejected on submit, in any letter case ---
  
    When I enter an email address that already exists
    And I click the "Add User" button
    Then an error message "User with this email already exists or deleted" should be displayed
    And the wizard should remain open with the entered data intact
    When I enter an existing email address in UPPERCASE
    And I click the "Add User" button
    Then an error message "User with this email already exists or deleted" should be displayed
    And the wizard should remain open with the entered data intact

    # --- Step 3 gates submission on the clinic assignment ---
    Given I am on Step 3 "Permissions" for the "Nurse" role
    Then the "Add User" button should be disabled
    When I click the "X" close icon on the modal
    Then the modal should close
    Given I am on Step 3 "Permissions" for the "Regular Supervisor" role
    Then the "Add User" button should be disabled
    And the "Allow Program Creation" dropdown should default to "No"
    When I select the first available clinic
    Then the "Add User" button should be enabled
    When I click the "X" close icon on the modal
    Then the modal should close
    And the user should not have been created

  # KNOWN ISSUES

  # DEFECT (observed 2026-07-27, scripts/probe-inline-role-refresh.js): a role
  # created from the wizard's own "Create a new role" entry is saved (the toast
  # confirms it, and it is listed on the Roles tab) but the Role dropdown that
  # opened the drawer never learns about it — 23 options before, 23 after,
  # 24 only once the page is reloaded. Closing and reopening the popover does
  # not help, so this is a stale client-side role list, not a render glitch.
  # The admin is dropped back into a wizard that cannot use the role they were
  # just sent to create, which defeats the point of the shortcut.
  @adduser @CreateRole @inline-role @known-issue
  Scenario: Verify that a role created from inside the wizard is selectable without a page refresh
    Given the "Add New User" modal is open
    When I click on the "Role" dropdown
    And I select the "Create a new role" option
    Then the "Create A Role" form should open
    When I fill in the new role name and description
    And I enable the clinic assignment toggle
    And I choose the "Single" clinic scope
    And I submit the Create A Role drawer
    Then a success message "Role created successfully." should confirm the role was created
    And the Add New User wizard should still be on Step 1
    And the new role should be offered in the Role dropdown

  @adduser @negative @known-issue
  Scenario: Verify that the Add New User wizard rejects an invalid phone number
    # Case 1 — no phone number at all
    Given I am on Step 2 "Basic Details" for the "Nurse" role
    When I fill in valid basic details
    And I enter "" in the Phone Number field
    And I attempt to proceed
    Then I should remain on Step 2
    And a validation message should be displayed for the "Phone Number" field

    # Case 2 — too short to be a real number
    Given I am on Step 2 "Basic Details" for the "Nurse" role
    When I fill in valid basic details
    And I enter "123" in the Phone Number field
    And I attempt to proceed
    Then I should remain on Step 2
    And a validation message should be displayed for the "Phone Number" field
