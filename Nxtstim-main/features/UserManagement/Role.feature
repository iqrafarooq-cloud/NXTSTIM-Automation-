 @RolesManagement @UserFlow
Feature: Roles Tab

  Background:
    Given I am logged in as an admin user
    And I navigate to the "Users & Roles" section
    And I click on the "Roles" tab

  # SECTION 1: ROLES LIST VIEW

  @Positive @RolesList
  Scenario: Verify that the Roles tab lists every seeded role with a Total Roles badge and a row action
    Then I should see the "Roles" tab is active
    And I should see a "Total Roles" count badge displaying the total number of roles
    And I should see a list of all available roles in the system
    And the roles list should include the following seeded roles:
      | Role Name             |
      | Executive Admin       |
      | Regular Supervisors   |
      | Billing Admin         |
      | Nurses                |
      | Monitoring Admin      |
      | NXTSTIM Nurse         |
      | Reporting Admin       |
      | Support Staff         |
      | Monitoring Supervisor |
      | Elevated Supervisors  |
      | Security Officer      |
      | Billing Officer       |
    And each role in the list should have a view/edit icon action button
    And the icon should be clickable

  @Positive @EdgeCase @RolesList @Search
  Scenario: Verify that search filters roles by name in real time, partially and case-insensitively
    Then I should see a search bar in the Roles tab
    When I type "Nurse" in the search bar
    Then the roles list should dynamically filter as I type
    And the roles list should filter to show only roles containing "Nurse" in their name
    And I should see "Nurses" in the filtered results
    And I should see "NXTSTIM Nurse" in the filtered results
    When I type "Admin" in the search bar
    Then I should see "Executive Admin" in the results
    And I should see "Billing Admin" in the results
    And I should see "Monitoring Admin" in the results
    And I should see "Reporting Admin" in the results
    When I type "billing admin" in the search bar
    Then I should see "Billing Admin" in the filtered results
    When I type "N" in the search bar
    Then the roles list should filter to show roles containing "N" in their name
    And I should see "Nurses" and "NXTSTIM Nurse" and "Monitoring Admin" etc.

  @Negative @EdgeCase @RolesList @Search
  Scenario: Verify that non-matching, whitespace and hostile search input are handled safely
    When I type "NonExistentRoleName123" in the search bar
    Then the roles list should display an empty state
    And I should see a message indicating no roles match the search criteria
    When I type "   " in the search bar
    Then the roles list should either show all roles or display appropriate behavior
    And no error should be thrown
    When I type "<script>alert('xss')</script>" in the search bar
    Then the application should handle the input safely
    And no script execution or error should occur
    And the roles list should show no matching results

  @EdgeCase @RolesList @EmptyState
  Scenario: Verify that the Roles list displays an empty state when no roles exist
    Given all roles have been removed from the system
    When I navigate to the "Roles" tab
    Then I should see an empty state message
    And the "Total Roles" badge should show "0"
    And the "Create a Role" button should still be available

  # SECTION 2: VIEW ROLE

  @Positive @ViewRole @SidePanel @ActionButtons @Permissions
  Scenario: Verify that the side panel shows a role's details and pre-configured permissions read-only
    When I click the view/edit icon for the role "Executive Admin"
    Then a side panel should open on the right side
    And the side panel should display the role name "Executive Admin"
    And the side panel should display the role description
    And the side panel should display the permission set for the role
    And I should see a "Delete Role" button
    And I should see an "Edit Role" button
    Given I have opened the side panel for the role "Monitoring Supervisor"
    Then the permission set should match the pre-configured permissions for "Monitoring Supervisor"
    And all currently assigned permissions should be shown as enabled
    And all non-assigned permissions should be shown as disabled
    When I expand a permission category
    Then the permission toggles should be displayed in read-only mode
    And I should not be able to toggle any permission

  @Positive @EdgeCase @ViewRole @Permissions @MultipleCategories
  Scenario: Verify that permission categories expand and collapse, singly and simultaneously
    Given I have opened the side panel for the role "Nurses"
    Then I should see permission categories listed
    When I click on a permission category
    Then it should expand to reveal its granular permissions
    When I click on the same permission category again
    Then it should collapse and hide its granular permissions
    When I expand "Billing" permission category
    And I expand "Monitoring" permission category
    And I expand "Reporting" permission category
    Then all three categories should be expanded simultaneously
    And their granular permissions should be visible

  @EdgeCase @ViewRole @LongContent
  Scenario: Verify that a role with a very long description displays properly
    Given a role exists with a 500+ character description
    When I open the side panel for that role
    Then the description should be fully visible or scrollable
    And the layout should not break

  # SECTION 3: EDIT ROLE

  @Positive @EditRole @Save
  Scenario: Verify that edit mode makes toggles interactive and saves enabled and disabled permissions
    Given I have opened the side panel for the role "Support Staff"
    When I click the "Edit Role" button
    Then all permission toggles should become interactive
    And I should be able to enable or disable any granular permission
    When I expand the "Monitoring" permission category
    And I enable the "View Patient Data" granular permission
    And I click the "Save" button
    Then the changes should be saved successfully
    And I should see a success confirmation message
    And the side panel should return to view mode
    And the "View Patient Data" permission should now show as enabled
    Given I am in edit mode for the role "Billing Admin"
    When I expand a permission category
    And I disable a previously enabled granular permission
    And I click the "Save" button
    Then the changes should be saved successfully
    And the permission should now show as disabled in view mode
    Given I am in edit mode for the role "Regular Supervisors"
    When I enable 3 permissions across different categories
    And I disable 2 previously enabled permissions
    And I click the "Save" button
    Then all 5 permission changes should be saved successfully

  @Positive @EditRole @Cancel
  Scenario: Verify that cancelling edit mode discards the changes
    Given I am in edit mode for the role "Nurses"
    When I enable a permission that was previously disabled
    And I click the "Cancel" button
    Then the side panel should return to view mode
    And the permission change should NOT be persisted
    And the permission should remain in its original disabled state

  @EdgeCase @EditRole @UnsavedChanges
  Scenario: Verify that closing with unsaved edits prompts, and both Discard and Continue Editing work
    Given I am in edit mode for the role "Monitoring Admin"
    And I have enabled 2 new permissions
    When I click outside the side panel or click the close button
    Then I should see a confirmation dialog "You have unsaved changes. Discard?"
    And I should have options to "Discard" or "Continue Editing"
    When I click "Continue Editing"
    Then the confirmation dialog should close
    And the side panel should remain open in edit mode
    And my unsaved changes should still be present
    When I click outside the side panel or click the close button
    And I click "Discard"
    Then the side panel should close
    And my permission changes should NOT be saved
    And the role should retain its original permissions


  @Negative @EditRole @Validation
  Scenario: Verify that an edit cannot be saved with Role Name or Description cleared
    Given I am in edit mode for the role "Support Staff"
    When I clear the "Role Name" field
    And I click the "Save" button
    Then I should see a validation error "Role Name is required"
    And the changes should NOT be saved
    Given I am in edit mode for the role "Support Staff"
    When I clear the "Describe the Role" field
    And I click the "Save" button
    Then I should see a validation error "Role description is required"
    And the changes should NOT be saved

  @Negative @EditRole @NetworkError
  Scenario: Verify that a network error while saving role edits displays an error message
    Given I am in edit mode for the role "Billing Admin"
    And I have made permission changes
    When I click the "Save" button
    And the network request fails
    Then I should see an error toast message "Failed to save changes. Please try again."
    And the changes should NOT be persisted
    And I should remain in edit mode

  @EdgeCase @EditRole @ClinicToggle
  Scenario: Verify that the clinic assignment setting can be changed on an existing role
    Given a role "Clinic Nurse" exists with "Single Clinic" assignment enabled
    When I open the side panel for "Clinic Nurse"
    And I click "Edit Role"
    And I change the clinic assignment from "Single Clinic" to "Multi Clinic"
    And I click "Save"
    Then the clinic assignment should be updated to "Multi Clinic"

  # SECTION 4: DELETE ROLE

  @Positive @EdgeCase @DeleteRole @Confirmation @TotalRolesSync
  Scenario: Verify that deleting a role with no users confirms first, cancels safely and decrements the badge
    Given I have opened the side panel for a role with 0 assigned users
    When I click the "Delete Role" button
    Then I should see a confirmation dialog "Are you sure you want to delete this role?"
    And I should have options to "Confirm" or "Cancel"
    When I click "Cancel"
    Then the confirmation dialog should close
    And the role should remain in the Roles list
    And the side panel should remain open
    When I click the "Delete Role" button
    And I confirm the deletion
    Then the role should be deleted successfully
    And the role should be removed from the Roles list
    And the "Total Roles" badge should decrement by 1
    And the badge should update without page refresh


  @Negative @DeleteRole @Blocked
  Scenario Outline: Verify that deletion is blocked and names the assigned user count
    Given I have opened the side panel for a role with <count> assigned users
    When I click the "Delete Role" button
    Then the deletion should be blocked
    And the role should NOT be deleted
    And I should see the message "This role cannot be deleted while <count> user(s) are assigned to it. Reassign those users first."

    Examples:
      | count |
      |     1 |
      |     5 |
      |     8 |

  @Negative @DeleteRole @SeededRoles
  Scenario: Verify that system-seeded roles cannot be deleted
    Given "Executive Admin" is a system-seeded role marked as protected
    When I open the side panel for "Executive Admin"
    Then the "Delete Role" button should be disabled or hidden
    And a tooltip should indicate "System roles cannot be deleted"

  @Negative @DeleteRole @NetworkError
  Scenario: Verify that a network error during deletion displays an error message
    Given I have opened the side panel for a role with 0 assigned users
    When I click the "Delete Role" button
    And I confirm the deletion
    And the network request fails
    Then I should see an error toast message "Failed to delete role. Please try again."
    And the role should remain in the Roles list

  # SECTION 5: CREATE ROLE
  @Positive @EdgeCase @CreateRole @Permissions @ClinicToggle @DefaultState
  Scenario: Verify that the Create A Role panel opens with its required fields and everything toggled OFF
    When I click the "Create a Role" button
    Then a side panel should open with the title "Create A Role"
    And I should see a "Role Name" text input field marked as required
    And I should see a "Describe the Role" text input field marked as required
    And I should see a toggle labeled "Make clinic assignment part of this role"
    And I should see a "Set permissions for this role" section
    And the "Make clinic assignment part of this role" toggle should be in the OFF state
    And no clinic assignment options should be visible
    And all permission category toggles should be in the OFF state
    And no granular permissions should be pre-enabled
    And the admin must explicitly enable any desired permission

  @Positive @EdgeCase @CreateRole @ClinicToggle
  Scenario: Verify that the clinic toggle expands Single and Multi options and clears them when switched off
    Given I have opened the "Create A Role" side panel
    When I enable the "Make clinic assignment part of this role" toggle
    Then I should see options for "Single Clinic" and "Multi Clinic" assignment
    When I select "Single Clinic"
    Then the "Single Clinic" option should be selected
    And users assigned this role will require a single clinic during setup
    When I select "Multi Clinic"
    Then the "Multi Clinic" option should be selected
    And users assigned this role will allow multiple clinic assignments during setup
    When I then disable the "Make clinic assignment part of this role" toggle
    Then the clinic assignment options should collapse and be hidden
    And the "Multi Clinic" selection should be cleared
    When I click the "Save" button with valid name and description
    Then the role should be created WITHOUT clinic assignment requirement

  @Positive @EdgeCase @CreateRole @Permissions @AllCategories
  Scenario: Verify that Grant all permissions, individual toggles and re-enabling all behave correctly
    Given I have opened the "Create A Role" side panel
    When I expand the "Monitoring" permission category
    And I enable only "View Dashboard" granular permission
    Then only "View Dashboard" should be enabled
    And other granular permissions in "Monitoring" should remain disabled
    When I expand the "Billing" permission category
    And I enable the "Grant all permissions" toggle for "Billing"
    Then all granular permissions within "Billing" should be enabled
    When I manually disable one specific granular permission in "Billing"
    Then the "Grant all permissions" toggle should automatically turn OFF
    And the remaining granular permissions should stay enabled
    When I re-enable the "Grant all permissions" toggle
    Then ALL granular permissions including the previously disabled one should be enabled
    When I enter "Super Admin Test" in the "Role Name" field
    And I enter "Full access role for testing" in the "Describe the Role" field
    And I enable "Grant all permissions" for every permission category
    And I click the "Save" button
    Then the role should be created with all permissions enabled

  @Positive @CreateRole @Save @Availability @SearchVerify
  Scenario: Verify that a new role saves, appears in the list, is searchable and is instantly assignable
    Given I have opened the "Create A Role" side panel
    When I enter "Quality Assurance Lead" in the "Role Name" field
    And I enter "Responsible for QA oversight and test management" in the "Describe the Role" field
    And I enable the "Grant all permissions" toggle for "Reporting"
    And I click the "Save" button
    Then the role "Quality Assurance Lead" should be created successfully
    And I should see a success confirmation message
    And the side panel should close
    And the role "Quality Assurance Lead" should appear in the Roles list
    And the "Total Roles" badge should increment by 1
    When I type "Quality" in the search bar
    Then I should see "Quality Assurance Lead" in the filtered results
    When I navigate to the "Add New User" flow
    And I open the Role dropdown
    Then I should see "Quality Assurance Lead" listed in the available roles
    And I should be able to select it without refreshing the page

  @Positive @CreateRole @Save @ClinicAssignment
  Scenario Outline: Verify that a role saves with its clinic assignment requirement
    Given I have opened the "Create A Role" side panel
    When I enter "<roleName>" in the "Role Name" field
    And I enter "<description>" in the "Describe the Role" field
    And I enable the "Make clinic assignment part of this role" toggle
    And I select "<option>"
    And I set appropriate permissions
    And I click the "Save" button
    Then the role "<roleName>" should be created with <requirement> assignment requirement

    Examples:
      | roleName            | description                            | option        | requirement   |
      | Clinic Nurse        | Nurse assigned to a single clinic      | Single Clinic | single clinic |
      | Regional Supervisor | Supervisor overseeing multiple clinics | Multi Clinic  | multi clinic  |

  # merges the special-characters and leading/trailing-whitespace edge cases.
  @EdgeCase @CreateRole @SpecialCharacters
  Scenario: Verify that special characters are preserved and surrounding whitespace is trimmed in a role name
    Given I have opened the "Create A Role" side panel
    When I enter "Nurse (Part-Time) / Temp" in the "Role Name" field
    And I enter "Temporary part-time nurse role" in the "Describe the Role" field
    And I click the "Save" button
    Then the role should be created successfully with the special characters preserved
    And the role should appear correctly in the Roles list
    Given I have opened the "Create A Role" side panel
    When I enter "  Custom Role  " in the "Role Name" field
    And I enter "Test description" in the "Describe the Role" field
    And I click the "Save" button
    Then the role name should be trimmed to "Custom Role"
    And it should be saved successfully

  # merges the three required-field validation scenarios.
  @Negative @CreateRole @Validation
  Scenario: Verify that a role cannot be saved with Role Name, Description or both missing
    Given I have opened the "Create A Role" side panel
    When I leave the "Role Name" field empty
    And I enter "Some description" in the "Describe the Role" field
    And I click the "Save" button
    Then I should see a validation error on the "Role Name" field
    And the role should NOT be created
    When I enter "New Role" in the "Role Name" field
    And I leave the "Describe the Role" field empty
    And I click the "Save" button
    Then I should see a validation error on the "Describe the Role" field
    And the role should NOT be created
    When I leave both "Role Name" and "Describe the Role" fields empty
    And I click the "Save" button
    Then I should see validation errors on both required fields
    And the role should NOT be created

  @Negative @CreateRole @Validation @DuplicateName
  Scenario: Verify that a role cannot be created with a duplicate name
    Given a role named "Nurses" already exists in the system
    And I have opened the "Create A Role" side panel
    When I enter "Nurses" in the "Role Name" field
    And I enter "Duplicate test role" in the "Describe the Role" field
    And I click the "Save" button
    Then I should see a validation error "A role with this name already exists"
    And the role should NOT be created

  # merges the Role Name and Description max-length scenarios.
  @Negative @CreateRole @Validation
  Scenario: Verify that Role Name and Description enforce their maximum character limits
    Given I have opened the "Create A Role" side panel
    When I enter a string of 256 characters in the "Role Name" field
    Then I should see a validation error or the field should prevent further input
    And the character count should not exceed the allowed maximum
    When I enter a string exceeding the maximum allowed characters in "Describe the Role"
    Then I should see a validation error or the field should prevent further input

  # NOTE: the original scenario asserted BOTH a blocking warning AND that the
  # role is created with zero permissions. Those contradict — see my notes.
  @Negative @CreateRole @Permissions
  Scenario: Verify that creating a role with no permissions enabled follows the business rule
    Given I have opened the "Create A Role" side panel
    When I enter "Empty Permission Role" in the "Role Name" field
    And I enter "Role without any permissions" in the "Describe the Role" field
    And I do NOT enable any permission
    And I click the "Save" button
    Then I should see a warning "At least one permission must be enabled"
    And the role should be created with zero permissions (based on business rules)

  @Negative @CreateRole @NetworkError
  Scenario: Verify that a network error while creating a role displays an error message
    Given I have filled in all required fields in the "Create A Role" panel
    When I click the "Save" button
    And the network request fails
    Then I should see an error toast message "Failed to create role. Please try again."
    And the role should NOT appear in the Roles list
    And the side panel should remain open with the entered data intact

  @EdgeCase @CreateRole @RapidSubmission
  Scenario: Verify that rapid Save clicks do not create duplicate roles
    Given I have filled in all required fields in the "Create A Role" panel
    When I rapidly click the "Save" button multiple times
    Then only one role should be created
    And I should NOT see duplicate entries in the Roles list

  # ============================================================
  # SECTION 6: RBAC — kept separate because each needs different credentials
  # ============================================================

  @Negative @RolesList @RBAC
  Scenario: Verify that a non-admin user cannot access the Roles tab
    Given I am logged in as a non-admin user without roles management permission
    When I navigate to the "Users & Roles" section
    Then I should NOT see the "Roles" tab
    And the "Roles" tab should be disabled/restricted

  @Negative @ViewRole @RBAC
  Scenario: Verify that a view-only user cannot see the Delete Role and Edit Role buttons
    Given I am logged in as a user with view-only permission on roles
    When I click the view/edit icon for any role
    Then the side panel should open with role details
    But I should NOT see the "Delete Role" button
    And I should NOT see the "Edit Role" button

  # ============================================================
  # SECTION 7: CONCURRENCY
  # ============================================================

  @EdgeCase @RolesList @ConcurrentAccess
  Scenario: Verify that two admins editing the same role simultaneously preserves data integrity
    Given Admin A is in edit mode for the role "Support Staff"
    And Admin B is also in edit mode for the role "Support Staff"
    When Admin A saves permission changes
    And Admin B attempts to save different permission changes
    Then Admin B should see a conflict error or the latest save should overwrite
    And data integrity should be maintained

  # ============================================================
  # SECTION 8: END-TO-END SCENARIOS
  # ============================================================

  # merges "Create a new role and assign it to a new user" with "Admin creates
  # role, configures all settings, creates user with that role" — both created a
  # Multi Clinic role, saved it, and used it in Add New User. Assertions from
  # both are kept: granted permissions AND the 3-step flow, search, Users-tab
  # filter and the associated clinics column.
  @E2E @CreateRole @AssignRole @RoleCreationToUserAssignment @FullFlow
  Scenario: Verify end to end that a configured Multi Clinic role can be created and assigned to a new user
    # Step 1: Create the role with full configuration
    When I create a role with the following details:
      | Field                   | Value                                     |
      | Role Name               | Regional Clinical Supervisor              |
      | Description             | Oversees clinical operations across sites |
      | Clinic Assignment       | Multi Clinic                              |
      | Monitoring - View       | Enabled                                   |
      | Monitoring - Edit       | Enabled                                   |
      | Reporting - Full Access | Enabled                                   |
      | Billing - View Only     | Enabled                                   |
    And I save the role
    Then the role "Regional Clinical Supervisor" should appear in the Roles list
    # Step 2: Verify it is findable in the list
    When I search for "Regional Clinical"
    Then I should see "Regional Clinical Supervisor" in results
    # Step 3: Use the role in Add New User
    When I navigate to "Add New User"
    And I select "Regional Clinical Supervisor" from the Role dropdown
    Then the flow should be 3 steps (including clinic/permissions)
    And the flow should proceed with Multi Clinic assignment in the permissions step
    When I complete all steps selecting 3 clinics
    Then the user should be created successfully with multi-clinic assignment
    And the new user should be created with the "Regional Clinical Supervisor" role
    And the user should have access to the permissions granted to the role
    # Step 4: Verify the created user from the Users tab
    When I navigate to the "Users" tab
    And I filter by role "Regional Clinical Supervisor"
    Then the newly created user should appear in the results
    And their associated clinics should show the 3 selected clinics

  @E2E @CreateRole @ClinicFlow
  Scenario: Verify end to end that a Single Clinic role forces clinic selection during user creation
    Given I create a role "Front Desk" with "Single Clinic" assignment enabled
    When I navigate to "Add New User"
    And I select "Front Desk" from the Role dropdown
    Then the flow should include a clinic assignment step
    And the user should be required to select exactly one clinic
    When I complete the user creation without selecting a clinic
    Then I should see a validation error requiring clinic selection

  # merges three lifecycle E2Es that all ended in the same place: "Edit role and
  # verify impact on user access", "Attempt delete, reassign, then delete", and
  # "View -> Edit -> Verify -> Delete". Needs a role that HAS assigned users, so
  # the delete is blocked first and only succeeds after reassignment.
  @E2E @ViewEditDeleteFlow @EditRole @DeleteRole @ReassignFirst @VerifyPermissions
  Scenario: Verify end to end the full lifecycle - view, edit, verify user impact, blocked delete, reassign, delete
    # Step 1: View
    Given the role "Temp Analyst" has 3 users assigned
    And "Temp Analyst" has "Export Data" permission enabled
    When I open the side panel for "Temp Analyst"
    Then I should see the role name, description, and permissions
    # Step 2: Edit
    When I click "Edit Role"
    And I disable the "Export Data" permission
    And I enable "Audit Trail Access" permission
    And I save the changes
    Then the permission change should be saved successfully
    # Step 3: Verify the change persisted and reached the assigned users
    When I reopen the side panel for "Temp Analyst"
    Then "Audit Trail Access" should be shown as enabled
    And "Export Data" should be shown as disabled
    When I verify the permissions for a user assigned to "Temp Analyst"
    Then that user should no longer have "Export Data" access
    # Step 4: Deletion is blocked while users are assigned
    When I click "Delete Role"
    Then I see the blocked message "This role cannot be deleted while 3 user(s) are assigned to it. Reassign those users first."
    # Step 5: Reassign the users, then delete
    When I navigate to the "Users" tab
    And I reassign all 3 users from "Temp Analyst" to "Support Staff"
    When I navigate back to the "Roles" tab
    And I open the side panel for "Temp Analyst"
    And I click "Delete Role"
    And I confirm the deletion
    Then the role "Temp Analyst" should be deleted successfully
    And it should no longer appear in the Roles list
    And the "Total Roles" badge should decrement

  @E2E @BulkPermissionUpdate
  Scenario: Verify end to end that permissions can be updated across multiple roles in sequence
    When I edit "Nurses" role and add "Billing View" permission
    And I save the changes
    And I edit "NXTSTIM Nurse" role and add "Billing View" permission
    And I save the changes
    Then both "Nurses" and "NXTSTIM Nurse" should have "Billing View" enabled
    And users with those roles should gain "Billing View" access