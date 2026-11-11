@RBAC
Feature: Add New User — per-role account lifecycle and RBAC permission verification
  Background:
    Given I am logged in as an "Admin" user
    And I am on the "Users" tab

  # POSITIVE
  @adduser
  Scenario: Verify that an admin can successfully add a new user and find them under Pending
    Given the "Add New User" modal is open
    When I select any available role from the Role dropdown
    And I click the "Next" button
    Then I should be on the next step based on the selected role
    When I complete all required fields for the current step
    And I continue through each step until the final step
    Then the "Add User" button should be enabled
    When I click the "Add User" button
    Then the modal should close
    And the user should be created successfully
    And a success message should confirm the user was added
    And the new user should appear in the "Pending" sub-tab
    And the new user should have the selected role
    And the new user's email and role should be accurately displayed
    And the "Associated Clinic" column should display the selected clinic or clinics, if applicable

  @lifecycle @permissions
  Scenario Outline: <Role> — add the user, activate, suspend, reactivate, then verify permissions against the RBAC sheet
    # ---- add the user → Pending ----
    When I add a new "<Role>" user through the Add New User wizard
    Then the user should be created successfully
    And a success message should confirm the user was added
    And the new user should appear in the "Pending" sub-tab
    And the new user should have the role "<Role>"

    # ---- set the password from the emailed OTP → Active ----
    And a set-password email should be sent to the new user
    When the user completes the password setup
    Then the new user should appear in the "Active" sub-tab

    # ---- more than three reset requests → Suspended ----
    When the new user requests a password reset 4 times
    Then the account should report the "suspended" state to the backend
    When I am logged in as an "Admin" user
    And I am on the "Users" tab
    Then the new user should appear in the "Suspended" sub-tab

    # ---- admin reactivation email → Pending ----
    When I reactivate the new user from the Suspended sub-tab
    Then a reactivation email should be sent to the new user
    And the new user should appear in the "Pending" sub-tab

    # ---- set the password from the reactivation link → Active again ----
    When the new user sets a password from the reactivation email
    And I am logged in as an "Admin" user
    And I am on the "Users" tab
    Then the new user should appear in the "Active" sub-tab

    # ---- act as the user and verify every section of the sheet ----
    When I log in as the newly created user
    Then the sidebar should offer the sections permitted for "<Role>"
    And the "<Role>" permissions for "Admin Management" should match the RBAC matrix
    And the "<Role>" permissions for "Supervisor Management" should match the RBAC matrix
    And the "<Role>" permissions for "Nurse Management" should match the RBAC matrix
    And the "<Role>" permissions for "Support Staff Management" should match the RBAC matrix
    And the "<Role>" permissions for "Clinic Management" should match the RBAC matrix
    And the "<Role>" permissions for "Patient Management" should match the RBAC matrix
    And the "<Role>" permissions for "Reports" should match the RBAC matrix
    And the "<Role>" permissions for "Billing" should match the RBAC matrix
    And the "<Role>" permissions for "Notes" should match the RBAC matrix
    And the Notes sweep should have left every note intact
    # Each section above attaches its own pass/mismatch/not-verifiable breakdown
    # and banks any mismatches; this step is what turns the scenario red, so one
    # run reports EVERY deviation instead of stopping at the first screen.
    And the RBAC verification should report no permission mismatches

    @support-staff
    Examples: Support Staff
      | Role          |
      | Support Staff |

    @executive-admin @role-pending
    Examples: Executive Admin
      | Role            |
      | Executive Admin |

    @billing-admin @role-pending
    Examples: Billing Admin
      | Role          |
      | Billing Admin |

    @monitoring-admin @role-pending
    Examples: Monitoring Admin
      | Role             |
      | Monitoring Admin |

    @reporting-admin @role-pending
    Examples: Reporting Admin
      | Role            |
      | Reporting Admin |

    @elevated-supervisor @role-pending
    Examples: Elevated Supervisor
      | Role                |
      | Elevated Supervisor |

    @nurse @role-pending
    Examples: Nurse
      | Role  |
      | Nurse |

    @nxtstim-nurse @role-pending
    Examples: NXTSTIM Nurse
      | Role          |
      | NXTSTIM Nurse |

    @security-privacy-officer @role-pending
    Examples: Security Privacy Officer
      | Role                     |
      | Security Privacy Officer |

    @monitoring-supervisor @role-pending
    Examples: Monitoring Supervisor
      | Role                  |
      | Monitoring Supervisor |

    @billing-officer @role-pending
    Examples: Billing Officer
      | Role            |
      | Billing Officer |
