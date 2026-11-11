@RBAC @PermissionVerification @Positive
Feature: RBAC Permission Verification - Positive Flow
  As a QA Engineer
  I want to verify that each role has the correct permissions enabled
  So that the RBAC system enforces proper access control across the platform

  # ============================================================================
  # SECTION 1: EXECUTIVE ADMIN PERMISSIONS
  # ============================================================================

  @ExecutiveAdmin @AdminManagement
  Scenario: Executive Admin has full access to Admin Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Admin Management" section
    Then the user should be able to view all Admins with full details
    And the user should be able to view Admin Communications
    And the user should be able to view Admin Login History

  @ExecutiveAdmin @SupervisorManagement
  Scenario: Executive Admin has full access to Supervisor Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view all Supervisors with full details
    And the user should be able to add new Supervisors
    And the user should be able to edit Supervisor details
    And the user should be able to make Supervisors inactive
    And the user should be able to modify Supervisor Permissions
    And the user should be able to view Supervisor Communications
    And the user should be able to view Supervisor Login History

  @ExecutiveAdmin @ClinicManagement
  Scenario: Executive Admin has full access to Clinic Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to add new Clinics
    And the user should be able to edit Clinic details
    And the user should be able to make Clinics inactive
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Nurses
    And the user should be able to view Clinic Metrics
    And the user should be able to manage Device Permissions
    And the user should be able to manage Patient Tags
    And the user should be able to upload files to the Clinic File Vault
    And the user should be able to delete files from the Clinic File Vault
    And the user should be able to view files in the Clinic File Vault
    And the user should be able to download files from the Clinic File Vault
    And the user should be able to manage Clinic File Vaults

  @ExecutiveAdmin @NurseManagement
  Scenario: Executive Admin has full access to Nurse Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view all Nurses with full details
    And the user should be able to add new Nurses
    And the user should be able to edit Nurse information
    And the user should be able to make Nurses inactive
    And the user should be able to view Nurse Communications
    And the user should be able to view Nurse Login History

  @ExecutiveAdmin @SupportStaffManagement
  Scenario: Executive Admin has full access to Support Staff Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Support Staff Management" section
    Then the user should be able to view all Support Staff with full details
    And the user should be able to add new Support Staff
    And the user should be able to edit Support Staff information
    And the user should be able to make Support Staff inactive
    And the user should be able to view Support Staff Communications
    And the user should be able to view Support Staff Login History

  @ExecutiveAdmin @PatientManagement
  Scenario: Executive Admin has full access to Patient Management
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view all Patient data
    And the user should be able to view Patient Tags
    And the user should be able to enroll and unroll Patient Tags
    And the user should be able to edit Patient information for Non-RPM patients only
    And the user should be able to add new Patients
    And the user should be able to add and deactivate Programs
    And the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view and add Forms
    And the user should be able to view and add Communications without Timer
    And the user should be able to view File Vault
    And the user should be able to delete files from the File Vault
    And the user should be able to upload files to File Vault
    And the user should be able to download files from File Vault
    And the user should be able to view Care Codes

  @ExecutiveAdmin @Reports
  Scenario: Executive Admin has full access to Reports
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to download Patient Monitoring Report
    And the user should be able to view Patient Data Report
    And the user should be able to download Patient Data Report
    And the user should be able to view Clinic Monthly Goal Report
    And the user should be able to download Clinic Monthly Goal Report
    And the user should be able to view Code Summary Report Card
    And the user should be able to download Code Summary Report

  @ExecutiveAdmin @Billing
  Scenario: Executive Admin has full access to Billing
    Given a user is logged in with "Executive Admin" role
    When the user navigates to "Billing" section
    Then the user should be able to view Invoices and Stats
    And the user should be able to adjust Clinic Credit Balances
    And the user should be able to edit, void, and download Invoices
    And the user should be able to mark Invoices as Paid
    And the user should be able to create and send Invoices

  @ExecutiveAdmin @Notes
  Scenario: Executive Admin has full Notes permissions
    Given a user is logged in with "Executive Admin" role
    When the user navigates to the Notes section of a patient
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit Notes
    And the user should be able to delete Notes

  # ============================================================================
  # SECTION 2: BILLING ADMIN PERMISSIONS
  # ============================================================================

  @BillingAdmin @AdminManagement
  Scenario: Billing Admin can view and edit Admins
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Admin Management" section
    Then the user should be able to view and edit Admins

  @BillingAdmin @SupervisorManagement
  Scenario: Billing Admin can view Supervisors
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors

  @BillingAdmin @ClinicManagement
  Scenario: Billing Admin has view and edit access to Clinic Management
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to edit Clinic details
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Nurses
    And the user should be able to view Clinic Metrics
    And the user should be able to manage Patient Tags
    And the user should be able to view files in the Clinic File Vault

  @BillingAdmin @NurseManagement
  Scenario: Billing Admin can view Nurses
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view all Nurses with full details

  @BillingAdmin @SupportStaffManagement
  Scenario: Billing Admin has full access to Support Staff Management
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Support Staff Management" section
    Then the user should be able to view all Support Staff with full details
    And the user should be able to add new Support Staff
    And the user should be able to edit Support Staff information
    And the user should be able to make Support Staff inactive
    And the user should be able to view Support Staff Communications
    And the user should be able to view Support Staff Login History

  @BillingAdmin @PatientManagement
  Scenario: Billing Admin has view access to Patient Management
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view File Vault
    And the user should be able to view Care Codes

  @BillingAdmin @Reports
  Scenario: Billing Admin can view and download Reports
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to download Patient Monitoring Report
    And the user should be able to view Code Progress Report
    And the user should be able to download Code Progress Report
    And the user should be able to view Patient Data Report
    And the user should be able to download Patient Data Report
    And the user should be able to view Clinic Monthly Goal Report
    And the user should be able to download Clinic Monthly Goal Report

  @BillingAdmin @Billing
  Scenario: Billing Admin has full access to Billing
    Given a user is logged in with "Billing Admin" role
    When the user navigates to "Billing" section
    Then the user should be able to view Invoices and Stats
    And the user should be able to adjust Clinic Credit Balances
    And the user should be able to edit, void, and download Invoices
    And the user should be able to mark Invoices as Paid
    And the user should be able to create and send Invoices

  @BillingAdmin @Notes
  Scenario: Billing Admin can only view Notes
    Given a user is logged in with "Billing Admin" role
    When the user navigates to the Notes section of a patient
    Then the user should be able to view Notes
    And the "Add Note" button should not be visible
    And the "Edit" option should not be available on any note
    And the "Delete" option should not be available on any note

  # ============================================================================
  # SECTION 3: MONITORING ADMIN PERMISSIONS
  # ============================================================================

  @MonitoringAdmin @SupervisorManagement
  Scenario: Monitoring Admin has full access to Supervisor Management
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view all Supervisors
    And the user should be able to add new Supervisors
    And the user should be able to edit Supervisor details
    And the user should be able to make Supervisors inactive
    And the user should be able to modify Supervisor Permissions
    And the user should be able to view Supervisor Communications
    And the user should be able to view Supervisor Login History

  @MonitoringAdmin @ClinicManagement
  Scenario: Monitoring Admin has full access to Clinic Management
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to add new Clinics
    And the user should be able to edit Clinic details
    And the user should be able to make Clinics inactive
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Nurses
    And the user should be able to view Clinic Metrics
    And the user should be able to manage Device Permissions
    And the user should be able to manage Patient Tags
    And the user should be able to upload files to the Clinic File Vault
    And the user should be able to delete files from the Clinic File Vault
    And the user should be able to view files in the Clinic File Vault
    And the user should be able to download files from the Clinic File Vault
    And the user should be able to manage Clinic File Vaults

  @MonitoringAdmin @NurseManagement
  Scenario: Monitoring Admin has full access to Nurse Management
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view all Nurses with full details
    And the user should be able to add new Nurses
    And the user should be able to edit Nurse information
    And the user should be able to make Nurses inactive
    And the user should be able to view Nurse Communications
    And the user should be able to view Nurse Login History

  @MonitoringAdmin @SupportStaffManagement
  Scenario: Monitoring Admin can view Support Staff
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Support Staff Management" section
    Then the user should be able to view all Support Staff with full details

  @MonitoringAdmin @PatientManagement
  Scenario: Monitoring Admin has full access to Patient Management
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view all Patient data
    And the user should be able to view Patient Tags
    And the user should be able to enroll and unroll Patient Tags
    And the user should be able to edit Patient information
    And the user should be able to add new Patients
    And the user should be able to add and deactivate Programs
    And the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view and add Forms
    And the user should be able to view and add Communications
    And the user should be able to view File Vault
    And the user should be able to delete files from the File Vault
    And the user should be able to upload files to File Vault
    And the user should be able to download files from File Vault
    And the user should be able to view Care Codes

  @MonitoringAdmin @Reports
  Scenario: Monitoring Admin can view and download all Reports
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to download Patient Monitoring Report
    And the user should be able to view Code Progress Report
    And the user should be able to download Code Progress Report
    And the user should be able to view Patient Data Report
    And the user should be able to download Patient Data Report
    And the user should be able to view Clinic Monthly Goal Report
    And the user should be able to download Clinic Monthly Goal Report
    And the user should be able to view Code Summary Report Card
    And the user should be able to download Code Summary Report

  @MonitoringAdmin @Billing
  Scenario: Monitoring Admin can view Billing
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to "Billing" section
    Then the user should be able to view Invoices and Stats

  @MonitoringAdmin @Notes
  Scenario: Monitoring Admin has full Notes permissions
    Given a user is logged in with "Monitoring Admin" role
    When the user navigates to the Notes section of a patient
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit Notes
    And the user should be able to delete Notes

  # ============================================================================
  # SECTION 4: REPORTING ADMIN PERMISSIONS
  # ============================================================================

  @ReportingAdmin @SupervisorManagement
  Scenario: Reporting Admin can view Supervisors
    Given a user is logged in with "Reporting Admin" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors

  @ReportingAdmin @ClinicManagement
  Scenario: Reporting Admin can view Clinics and Supervisors
    Given a user is logged in with "Reporting Admin" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Metrics

  @ReportingAdmin @PatientManagement
  Scenario: Reporting Admin has view access to Patient Management
    Given a user is logged in with "Reporting Admin" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view all Patient data
    And the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view Care Codes

  @ReportingAdmin @Reports
  Scenario: Reporting Admin can view Reports
    Given a user is logged in with "Reporting Admin" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to view Patient Data Report
    And the user should be able to view Care Codes

  @ReportingAdmin @Notes
  Scenario: Reporting Admin has no Notes permissions
    Given a user is logged in with "Reporting Admin" role
    When the user navigates to the Notes section of a patient
    Then the Notes section should not be visible or accessible

  # ============================================================================
  # SECTION 5: ELEVATED SUPERVISOR PERMISSIONS (First Supervisor per Clinic)
  # ============================================================================

  @ElevatedSupervisor @SupervisorManagement
  Scenario: Elevated Supervisor has same-clinic Supervisor Management access
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors of "Clinic A" only
    And the user should be able to add new Supervisors to "Clinic A" only
    And the user should be able to edit Supervisor details for "Clinic A" only
    And the user should be able to make Supervisors inactive in "Clinic A" only
    And the user should be able to modify Supervisor Permissions in "Clinic A" only
    And the user should be able to view Supervisor Communications in "Clinic A" only
    And the user should be able to view Supervisor Login History in "Clinic A" only

  @ElevatedSupervisor @ClinicManagement
  Scenario: Elevated Supervisor has associated clinic access for Clinic Management
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Clinic Management" section
    Then the user should be able to view "Clinic A" only
    And the user should be able to view Clinic Supervisors of "Clinic A" only
    And the user should be able to view Clinic Nurses of "Clinic A" only
    And the user should be able to view Clinic Metrics for "Clinic A" only
    And the user should be able to manage Device Permissions for "Clinic A" only
    And the user should be able to manage Patient Tags for "Clinic A" only
    And the user should be able to upload files to the Clinic File Vault for "Clinic A"
    And the user should be able to delete files from the Clinic File Vault for "Clinic A"
    And the user should be able to view files in the Clinic File Vault for "Clinic A"
    And the user should be able to download files from the Clinic File Vault for "Clinic A"
    And the user should be able to manage Clinic File Vaults for "Clinic A" only

  @ElevatedSupervisor @NurseManagement
  Scenario: Elevated Supervisor has same-clinic Nurse Management access
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Nurse Management" section
    Then the user should be able to view Nurses of "Clinic A" only
    And the user should be able to add new Nurses to "Clinic A" only
    And the user should be able to edit Nurse information for "Clinic A" only
    And the user should be able to make Nurses inactive in "Clinic A" only

  @ElevatedSupervisor @PatientManagement
  Scenario: Elevated Supervisor has clinic-only Patient Management access
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Patient Management" section
    Then the user should be able to view Patient data for "Clinic A" only
    And the user should be able to view Patient Tags for "Clinic A" only
    And the user should be able to enroll and unroll Patient Tags for "Clinic A" only
    And the user should be able to add new Patients to "Clinic A" only
    And the user should be able to add and deactivate Programs for "Clinic A" only
    And the user should be able to view Patient Overview for "Clinic A" only
    And the user should be able to view Patient Profile for "Clinic A" only
    And the user should be able to view Patient Care Plan for "Clinic A" only
    And the user should be able to view Session History for "Clinic A" only
    And the user should be able to view Past Services for "Clinic A" only
    And the user should be able to view and add Forms for "Clinic A" only
    And the user should be able to view and add Communications without Timer for "Clinic A" only
    And the user should be able to view File Vault for "Clinic A" only
    And the user should be able to delete files from the File Vault for "Clinic A" only
    And the user should be able to upload files to File Vault for "Clinic A" only
    And the user should be able to download files from File Vault for "Clinic A" only
    And the user should be able to view Care Codes

  @ElevatedSupervisor @Reports
  Scenario: Elevated Supervisor can view and download Reports for own clinic
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report for "Clinic A" only
    And the user should be able to download Patient Monitoring Report for "Clinic A" only
    And the user should be able to view Patient Data Report for "Clinic A" only
    And the user should be able to download Patient Data Report for "Clinic A" only
    And the user should be able to view Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to download Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to view Code Summary Report Card for "Clinic A" only
    And the user should be able to download Code Summary Report for "Clinic A" only

  @ElevatedSupervisor @Notes
  Scenario: Elevated Supervisor has clinic-only Notes permissions
    Given a user is logged in with "Elevated Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to the Notes section of a patient in "Clinic A"
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit Notes
    And the user should be able to delete Notes

  # ============================================================================
  # SECTION 6: REGULAR SUPERVISOR PERMISSIONS
  # ============================================================================

  @RegularSupervisor @ClinicManagement
  Scenario: Regular Supervisor has associated clinic access for Clinic Management
    Given a user is logged in with "Regular Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Clinic Management" section
    Then the user should be able to view "Clinic A" only
    And the user should be able to view Clinic Supervisors of "Clinic A" only
    And the user should be able to view Clinic Nurses
    And the user should be able to view Clinic Metrics for "Clinic A" only
    And the user should be able to manage Device Permissions for "Clinic A" only
    And the user should be able to manage Patient Tags for "Clinic A" only
    And the user should be able to upload files to the Clinic File Vault for "Clinic A"
    And the user should be able to delete files from the Clinic File Vault for "Clinic A"
    And the user should be able to view files in the Clinic File Vault for "Clinic A"
    And the user should be able to manage Clinic File Vaults for "Clinic A" only

  @RegularSupervisor @PatientManagement
  Scenario: Regular Supervisor has supervised-patients-only access
    Given a user is logged in with "Regular Supervisor" role
    And the user supervises patients in "Clinic A"
    When the user navigates to "Patient Management" section
    Then the user should be able to view supervised Patient data only
    And the user should be able to view Patient Tags for supervised patients only
    And the user should be able to enroll and unroll Patient Tags for supervised patients only
    And the user should be able to view Patient Overview for supervised patients only
    And the user should be able to view Patient Profile for supervised patients only
    And the user should be able to view Patient Care Plan for supervised patients only
    And the user should be able to view Session History for supervised patients only
    And the user should be able to view Past Services for supervised patients only
    And the user should be able to view and add Forms for supervised patients only
    And the user should be able to view and add Communications without Timer for supervised patients only
    And the user should be able to view File Vault for supervised patients only
    And the user should be able to delete files from the File Vault for supervised patients only
    And the user should be able to upload files to File Vault for supervised patients only
    And the user should be able to view Care Codes

  @RegularSupervisor @Reports
  Scenario: Regular Supervisor can view and download Reports for own clinic
    Given a user is logged in with "Regular Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report for "Clinic A" only
    And the user should be able to download Patient Monitoring Report for "Clinic A" only
    And the user should be able to view Patient Data Report for "Clinic A" only
    And the user should be able to download Patient Data Report for "Clinic A" only
    And the user should be able to view Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to download Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to view Code Summary Report Card for "Clinic A" only
    And the user should be able to download Code Summary Report for "Clinic A" only

  @RegularSupervisor @Notes
  Scenario: Regular Supervisor has clinic-only Notes permissions
    Given a user is logged in with "Regular Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to the Notes section of a patient in "Clinic A"
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit Notes
    And the user should be able to delete Notes

  # ============================================================================
  # SECTION 7: NURSE PERMISSIONS
  # ============================================================================

  @Nurse @ClinicManagement
  Scenario: Nurse has view access to associated Clinic
    Given a user is logged in with "Nurse" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Clinic Management" section
    Then the user should be able to view "Clinic A" only
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Nurse profiles only
    And the user should be able to upload files to the Clinic File Vault
    And the user should be able to delete own files only from the Clinic File Vault
    And the user should be able to view files in the Clinic File Vault

  @Nurse @NurseManagement
  Scenario: Nurse can view own profile and same-clinic nurse profiles
    Given a user is logged in with "Nurse" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Nurse Management" section
    Then the user should be able to view Nurse profiles only
    And the user should be able to view own Communications only
    And the user should be able to view own Login History only

  @Nurse @PatientManagement
  Scenario: Nurse has same-clinic patient access
    Given a user is logged in with "Nurse" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Patient Management" section
    Then the user should be able to view Patient data for same clinic only
    And the user should be able to view Patient Tags for same clinic only
    And the user should be able to view Patient Overview for same clinic only
    And the user should be able to view Patient Profile for same clinic only
    And the user should be able to view Patient Care Plan for same clinic only
    And the user should be able to view Session History for same clinic only
    And the user should be able to view Past Services for same clinic only
    And the user should be able to view and add Forms for same clinic only
    And the user should be able to view and add Communications with Timer for same clinic only
    And the user should be able to view File Vault for same clinic only
    And the user should be able to delete own files only from the Patient File Vault
    And the user should be able to upload files to File Vault for same clinic only
    And the user should be able to view Care Codes

  @Nurse @Reports
  Scenario: Nurse can view and download Reports for own clinic
    Given a user is logged in with "Nurse" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report for "Clinic A" only
    And the user should be able to download Patient Monitoring Report for "Clinic A" only
    And the user should be able to view Patient Data Report for "Clinic A" only
    And the user should be able to download Patient Data Report for "Clinic A" only
    And the user should be able to view Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to download Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to view Code Summary Report Card for "Clinic A" only
    And the user should be able to download Code Summary Report for "Clinic A" only

  @Nurse @Notes
  Scenario: Nurse has clinic-only Notes with edit/delete restricted to own notes
    Given a user is logged in with "Nurse" role
    And the user is assigned to "Clinic A"
    When the user navigates to the Notes section of a patient in "Clinic A"
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit their own Notes only
    And the user should be able to delete their own Notes only
    And the "Edit" option should not be available on notes created by other users
    And the "Delete" option should not be available on notes created by other users

  # ============================================================================
  # SECTION 8: NXTSTIM NURSE PERMISSIONS
  # ============================================================================

  @NXTSTIMNurse @ClinicManagement
  Scenario: NXTSTIM Nurse can view all Clinics
    Given a user is logged in with "NXTSTIM Nurse" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to view all Supervisors
    And the user should be able to view only NXTSTIM Nurse profiles
    And the user should be able to upload files to the Clinic File Vault
    And the user should be able to delete own files only from the Clinic File Vault
    And the user should be able to view files in the Clinic File Vault

  @NXTSTIMNurse @NurseManagement
  Scenario: NXTSTIM Nurse can view NXTSTIM nurse profiles only
    Given a user is logged in with "NXTSTIM Nurse" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view NXTSTIM Nurse profiles only
    And the user should be able to view own Communications only
    And the user should be able to view own Login History only

  @NXTSTIMNurse @PatientManagement
  Scenario: NXTSTIM Nurse has access to all patients irrespective of clinic
    Given a user is logged in with "NXTSTIM Nurse" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view all Patient data irrespective of clinic
    And the user should be able to view Patient Tags for all patients
    And the user should be able to view Patient Overview for all patients
    And the user should be able to view Patient Profile for all patients
    And the user should be able to view Patient Care Plan for all patients
    And the user should be able to view Session History for all patients
    And the user should be able to view Past Services for all patients
    And the user should be able to view and add Forms for all patients
    And the user should be able to view and add Communications with Timer for all patients
    And the user should be able to view File Vault for all patients
    And the user should be able to delete own files only from the Patient File Vault
    And the user should be able to upload files to File Vault for all patients
    And the user should be able to view Care Codes for all patients

  @NXTSTIMNurse @Reports
  Scenario: NXTSTIM Nurse can view and download Reports for all patients
    Given a user is logged in with "NXTSTIM Nurse" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report for all patients
    And the user should be able to download Patient Monitoring Report for all patients
    And the user should be able to view Patient Data Report for all patients
    And the user should be able to download Patient Data Report for all patients

  @NXTSTIMNurse @Notes
  Scenario: NXTSTIM Nurse has Notes with edit/delete restricted to own notes
    Given a user is logged in with "NXTSTIM Nurse" role
    When the user navigates to the Notes section of any patient
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit their own Notes only
    And the user should be able to delete their own Notes only

  # ============================================================================
  # SECTION 9: SUPPORT ADMIN / SUPPORT STAFF PERMISSIONS
  # ============================================================================

  @SupportStaff @AdminManagement
  Scenario: Support Staff has view-only access to Admin Management
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Admin Management" section
    Then the user should be able to view Admins in view-only mode
    And the user should be able to view Admin Communications
    And the user should be able to view Admin Login History

  @SupportStaff @SupervisorManagement
  Scenario: Support Staff has view-only Supervisor access
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors in view-only mode
    And the user should be able to view Supervisor Communications
    And the user should be able to view Supervisor Login History

  @SupportStaff @ClinicManagement
  Scenario: Support Staff has view-only Clinic access
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics in view-only mode
    And the user should be able to view Clinic Supervisors in view-only mode
    And the user should be able to view Clinic Nurses in view-only mode
    And the user should be able to view Clinic Metrics in view-only mode
    And the user should be able to manage Patient Tags in view-only mode
    And the user should be able to view files in the Clinic File Vault

  @SupportStaff @NurseManagement
  Scenario: Support Staff has view-only Nurse access
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view all Nurses in view-only mode
    And the user should be able to view Nurse Communications
    And the user should be able to view Nurse Login History

  @SupportStaff @SupportStaffManagement
  Scenario: Support Staff has full access to Support Staff Management
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Support Staff Management" section
    Then the user should be able to view all Support Staff
    And the user should be able to add new Support Staff
    And the user should be able to edit Support Staff information
    And the user should be able to make Support Staff inactive
    And the user should be able to view Support Staff Communications
    And the user should be able to view Support Staff Login History

  @SupportStaff @PatientManagement
  Scenario: Support Staff has view and communication access to Patient Management
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view all Patient data
    And the user should be able to view Patient Tags
    And the user should be able to edit Patient information for support purposes
    And the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view Forms in view-only mode
    And the user should be able to add Communications and cannot log time
    And the user should be able to view File Vault
    And the user should be able to view Care Codes

  @SupportStaff @Reports
  Scenario: Support Staff can view Reports and download select reports
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to download Patient Monitoring Report
    And the user should be able to view Code Progress Report
    And the user should be able to download Code Progress Report
    And the user should be able to view Patient Data Report
    And the user should be able to download Patient Data Report
    And the user should be able to view Clinic Monthly Goal Report
    And the user should be able to download Clinic Monthly Goal Report

  @SupportStaff @Billing
  Scenario: Support Staff has view-only access to Billing
    Given a user is logged in with "Support Admin" role
    When the user navigates to "Billing" section
    Then the user should be able to view Invoices and Stats in view-only mode

  @SupportStaff @Notes
  Scenario: Support Staff can view, add, edit all Notes but delete own only
    Given a user is logged in with "Support Admin" role
    When the user navigates to the Notes section of a patient
    Then the user should be able to view Notes
    And the user should be able to add Notes
    And the user should be able to edit Notes
    And the user should be able to delete their own Notes only
    And the "Delete" option should not be available on notes created by other users

  # ============================================================================
  # SECTION 10: SECURITY/PRIVACY OFFICER PERMISSIONS
  # ============================================================================

  @SecurityOfficer @AdminManagement
  Scenario: Security Officer can view Admin details and Login History
    Given a user is logged in with "Security/Privacy Officer" role
    When the user navigates to "Admin Management" section
    Then the user should be able to view Admins
    And the user should be able to view Admin Login History

  @SecurityOfficer @SupervisorManagement
  Scenario: Security Officer can view Supervisors and Login History
    Given a user is logged in with "Security/Privacy Officer" role
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors
    And the user should be able to view Supervisor Login History

  @SecurityOfficer @NurseManagement
  Scenario: Security Officer can view Nurses and Login History
    Given a user is logged in with "Security/Privacy Officer" role
    When the user navigates to "Nurse Management" section
    Then the user should be able to view all Nurses
    And the user should be able to view Nurse Login History

  @SecurityOfficer @SupportStaffManagement
  Scenario: Security Officer can view Support Staff and Login History
    Given a user is logged in with "Security/Privacy Officer" role
    When the user navigates to "Support Staff Management" section
    Then the user should be able to view all Support Staff
    And the user should be able to view Support Staff Login History

  @SecurityOfficer @Notes
  Scenario: Security Officer has no Notes permissions
    Given a user is logged in with "Security/Privacy Officer" role
    When the user navigates to the Notes section of a patient
    Then the Notes section should not be visible or accessible

  # ============================================================================
  # SECTION 11: MONITORING SUPERVISOR PERMISSIONS
  # ============================================================================

  @MonitoringSupervisor @SupervisorManagement
  Scenario: Monitoring Supervisor has same-clinic Supervisor Management access
    Given a user is logged in with "Monitoring Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Supervisor Management" section
    Then the user should be able to view Supervisors of "Clinic A" only
    And the user should be able to add new Supervisors to "Clinic A" only
    And the user should be able to edit Supervisor details for "Clinic A" only
    And the user should be able to make Supervisors inactive in "Clinic A" only
    And the user should be able to modify Supervisor Permissions in "Clinic A" only
    And the user should be able to view Supervisor Communications in "Clinic A" only
    And the user should be able to view Supervisor Login History in "Clinic A" only

  @MonitoringSupervisor @ClinicManagement
  Scenario: Monitoring Supervisor has associated clinic access
    Given a user is logged in with "Monitoring Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Clinic Management" section
    Then the user should be able to view "Clinic A" only
    And the user should be able to view Clinic Supervisors of "Clinic A" only
    And the user should be able to view Clinic Nurses of "Clinic A" only
    And the user should be able to view Clinic Metrics for "Clinic A" only
    And the user should be able to manage Device Permissions for "Clinic A" only
    And the user should be able to manage Patient Tags for "Clinic A" only
    And the user should be able to upload files to the Clinic File Vault for "Clinic A"
    And the user should be able to delete files from the Clinic File Vault for "Clinic A"
    And the user should be able to view files in the Clinic File Vault for "Clinic A"
    And the user should be able to download files from the Clinic File Vault for "Clinic A"
    And the user should be able to manage Clinic File Vaults for "Clinic A" only

  @MonitoringSupervisor @NurseManagement
  Scenario: Monitoring Supervisor has same-clinic Nurse Management access
    Given a user is logged in with "Monitoring Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Nurse Management" section
    Then the user should be able to view Nurses of "Clinic A" only
    And the user should be able to add new Nurses to "Clinic A" only
    And the user should be able to edit Nurse information for "Clinic A" only
    And the user should be able to make Nurses inactive in "Clinic A" only

  @MonitoringSupervisor @PatientManagement
  Scenario: Monitoring Supervisor has clinic-only Patient Management access
    Given a user is logged in with "Monitoring Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Patient Management" section
    Then the user should be able to view Patient data for "Clinic A" only
    And the user should be able to view Patient Tags for "Clinic A" only
    And the user should be able to enroll and unroll Patient Tags for "Clinic A" only
    And the user should be able to add new Patients to "Clinic A" only
    And the user should be able to add and deactivate Programs for "Clinic A" only
    And the user should be able to view Patient Overview for "Clinic A" only
    And the user should be able to view Patient Profile for "Clinic A" only
    And the user should be able to view Patient Care Plan for "Clinic A" only
    And the user should be able to view Session History for "Clinic A" only
    And the user should be able to view Past Services for "Clinic A" only
    And the user should be able to view and add Forms for "Clinic A" only
    And the user should be able to view and add Communications without Timer for "Clinic A" only
    And the user should be able to view File Vault for "Clinic A" only
    And the user should be able to delete files from the File Vault for "Clinic A" only
    And the user should be able to upload files to File Vault for "Clinic A" only
    And the user should be able to download files from File Vault for "Clinic A" only
    And the user should be able to view Care Codes

  @MonitoringSupervisor @Reports
  Scenario: Monitoring Supervisor can view and download Reports for own clinic
    Given a user is logged in with "Monitoring Supervisor" role
    And the user is assigned to "Clinic A"
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report for "Clinic A" only
    And the user should be able to download Patient Monitoring Report for "Clinic A" only
    And the user should be able to view Patient Data Report for "Clinic A" only
    And the user should be able to download Patient Data Report for "Clinic A" only
    And the user should be able to view Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to download Clinic Monthly Goal Report for "Clinic A" only
    And the user should be able to view Code Summary Report Card for "Clinic A" only
    And the user should be able to download Code Summary Report for "Clinic A" only

  # ============================================================================
  # SECTION 12: BILLING OFFICER PERMISSIONS
  # ============================================================================

  @BillingOfficer @ClinicManagement
  Scenario: Billing Officer has view access to Clinic Management
    Given a user is logged in with "Billing Officer" role
    When the user navigates to "Clinic Management" section
    Then the user should be able to view all Clinics
    And the user should be able to view Clinic Supervisors
    And the user should be able to view Clinic Nurses
    And the user should be able to view Clinic Metrics
    And the user should be able to manage Patient Tags in view-only mode
    And the user should be able to view files in the Clinic File Vault

  @BillingOfficer @PatientManagement
  Scenario: Billing Officer has view access to Patient Management
    Given a user is logged in with "Billing Officer" role
    When the user navigates to "Patient Management" section
    Then the user should be able to view Patient Overview
    And the user should be able to view Patient Profile
    And the user should be able to view Patient Care Plan
    And the user should be able to view Session History
    And the user should be able to view Past Services
    And the user should be able to view File Vault
    And the user should be able to view Care Codes

  @BillingOfficer @Reports
  Scenario: Billing Officer can view and download Reports
    Given a user is logged in with "Billing Officer" role
    When the user navigates to "Reports" section
    Then the user should be able to view Patient Monitoring Report
    And the user should be able to download Patient Monitoring Report
    And the user should be able to view Code Progress Report
    And the user should be able to download Code Progress Report
    And the user should be able to view Clinic Monthly Goal Report
    And the user should be able to download Clinic Monthly Goal Report

  @BillingOfficer @Billing
  Scenario: Billing Officer has full access to Billing
    Given a user is logged in with "Billing Officer" role
    When the user navigates to "Billing" section
    Then the user should be able to view Invoices and Stats
    And the user should be able to adjust Clinic Credit Balances
    And the user should be able to edit, void, and download Invoices
    And the user should be able to mark Invoices as Paid
    And the user should be able to create and send Invoices

  # ============================================================================
  # SECTION 13: SCENARIO OUTLINES - PERMISSION MATRIX VERIFICATION
  # ============================================================================

  @PermissionMatrix @AdminManagement
  Scenario Outline: Verify Admin Management permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to "Admin Management" section
    Then the "View/Edit Admins" permission should be "<ViewEditAdmins>"
    And the "View Admin Communications" permission should be "<ViewComms>"
    And the "View Admin Login History" permission should be "<ViewLogin>"

    Examples:
      | Role                     | ViewEditAdmins | ViewComms | ViewLogin |
      | Executive Admin          | Full           | Enabled   | Enabled   |
      | Billing Admin            | Enabled        | Disabled  | Disabled  |
      | Monitoring Admin         | Disabled       | Disabled  | Disabled  |
      | Reporting Admin          | Disabled       | Disabled  | Disabled  |
      | Support Admin            | View Only      | Enabled   | Enabled   |
      | Security/Privacy Officer | Enabled        | Disabled  | Enabled   |

  @PermissionMatrix @SupervisorManagement
  Scenario Outline: Verify Supervisor Management view permission per role
    Given a user is logged in with "<Role>" role
    When the user navigates to "Supervisor Management" section
    Then the "View Supervisors" permission should be "<ViewSupervisors>"
    And the "Add New Supervisors" permission should be "<AddSupervisors>"
    And the "Edit Supervisor Details" permission should be "<EditSupervisors>"
    And the "Make Supervisors Inactive" permission should be "<InactiveSupervisors>"

    Examples:
      | Role                     | ViewSupervisors    | AddSupervisors     | EditSupervisors    | InactiveSupervisors |
      | Executive Admin          | Full               | Enabled            | Enabled            | Enabled             |
      | Billing Admin            | Enabled            | Disabled           | Disabled           | Disabled            |
      | Monitoring Admin         | Enabled            | Enabled            | Enabled            | Enabled             |
      | Reporting Admin          | Enabled            | Disabled           | Disabled           | Disabled            |
      | Elevated Supervisor      | Same Clinic Only   | Same Clinic Only   | Same Clinic Only   | Same Clinic Only    |
      | Regular Supervisor       | Same Clinic Only   | Disabled           | Disabled           | Disabled            |
      | Support Admin            | View Only          | Disabled           | Disabled           | Disabled            |
      | Security/Privacy Officer | Enabled            | Disabled           | Disabled           | Disabled            |
      | Monitoring Supervisor    | Same Clinic Only   | Same Clinic Only   | Same Clinic Only   | Same Clinic Only    |

  @PermissionMatrix @NurseManagement
  Scenario Outline: Verify Nurse Management permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to "Nurse Management" section
    Then the "View Nurses" permission should be "<ViewNurses>"
    And the "Add New Nurses" permission should be "<AddNurses>"
    And the "Edit Nurse Information" permission should be "<EditNurses>"
    And the "Make Nurses Inactive" permission should be "<InactiveNurses>"

    Examples:
      | Role                     | ViewNurses                   | AddNurses          | EditNurses         | InactiveNurses     |
      | Executive Admin          | Full                         | Enabled            | Enabled            | Enabled            |
      | Billing Admin            | Enabled                      | Disabled           | Disabled           | Disabled           |
      | Monitoring Admin         | Enabled                      | Enabled            | Enabled            | Enabled            |
      | Elevated Supervisor      | Same Clinic Only             | Same Clinic Only   | Same Clinic Only   | Same Clinic Only   |
      | Nurse                    | Profiles Only                | Disabled           | Disabled           | Disabled           |
      | NXTSTIM Nurse            | NXTSTIM Nurses Profile Only  | Disabled           | Disabled           | Disabled           |
      | Support Admin            | View Only                    | Disabled           | Disabled           | Disabled           |
      | Security/Privacy Officer | Enabled                      | Disabled           | Disabled           | Disabled           |
      | Monitoring Supervisor    | Same Clinic Only             | Same Clinic Only   | Same Clinic Only   | Same Clinic Only   |

  @PermissionMatrix @PatientCommunications
  Scenario Outline: Verify Patient Communications Timer behavior per role
    Given a user is logged in with "<Role>" role
    When the user navigates to a patient's Communications section
    Then the Communications access should be "<Access>"
    And the Timer functionality should be "<Timer>"

    Examples:
      | Role                | Access              | Timer    |
      | Executive Admin     | Enabled             | No Timer |
      | Monitoring Admin    | Enabled             | No Timer |
      | Elevated Supervisor | Clinic Only         | No Timer |
      | Regular Supervisor  | Supervised Only     | No Timer |
      | Nurse               | Same Clinic Only    | With Timer |
      | NXTSTIM Nurse       | All Patients        | With Timer |
      | Support Admin       | Enabled             | Cannot Log Time |
      | Monitoring Supervisor | Clinic Only       | No Timer |

  @PermissionMatrix @Notes
  Scenario Outline: Verify Notes permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to the Notes section of a patient
    Then the "View Notes" permission should be "<View>"
    And the "Add Notes" permission should be "<Add>"
    And the "Edit Notes" permission should be "<Edit>"
    And the "Delete Notes" permission should be "<Delete>"

    Examples:
      | Role                     | View    | Add     | Edit              | Delete            |
      | Executive Admin          | Enabled | Enabled | Enabled           | Enabled           |
      | Billing Admin            | Enabled | Disabled| Disabled          | Disabled          |
      | Monitoring Admin         | Enabled | Enabled | Enabled           | Enabled           |
      | Reporting Admin          | Disabled| Disabled| Disabled          | Disabled          |
      | Elevated Supervisor      | Enabled | Enabled | Enabled           | Enabled           |
      | Regular Supervisor       | Enabled | Enabled | Enabled           | Enabled           |
      | Nurse                    | Enabled | Enabled | Own Notes Only    | Own Notes Only    |
      | NXTSTIM Nurse            | Enabled | Enabled | Own Notes Only    | Own Notes Only    |
      | Support Admin            | Enabled | Enabled | Enabled           | Own Notes Only    |
      | Security/Privacy Officer | Disabled| Disabled| Disabled          | Disabled          |

  @PermissionMatrix @Billing
  Scenario Outline: Verify Billing permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to "Billing" section
    Then the "View Invoices and Stats" permission should be "<ViewInvoices>"
    And the "Adjust Clinic Credit Balances" permission should be "<AdjustCredits>"
    And the "Edit/Void/Download Invoices" permission should be "<EditInvoices>"
    And the "Mark Invoices as Paid" permission should be "<MarkPaid>"
    And the "Create/Send Invoices" permission should be "<CreateInvoices>"

    Examples:
      | Role                     | ViewInvoices | AdjustCredits | EditInvoices | MarkPaid | CreateInvoices |
      | Executive Admin          | Enabled      | Enabled       | Enabled      | Enabled  | Enabled        |
      | Billing Admin            | Enabled      | Enabled       | Enabled      | Enabled  | Enabled        |
      | Monitoring Admin         | Enabled      | Disabled      | Disabled     | Disabled | Disabled       |
      | Support Admin            | View Only    | Disabled      | Disabled     | Disabled | Disabled       |
      | Billing Officer          | Enabled      | Enabled       | Enabled      | Enabled  | Enabled        |

  @PermissionMatrix @Reports
  Scenario Outline: Verify Report access permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to "Reports" section
    Then the "View Patient Monitoring Report" permission should be "<ViewPMR>"
    And the "Download Patient Monitoring Report" permission should be "<DownloadPMR>"
    And the "View Patient Data Report" permission should be "<ViewPDR>"
    And the "View Clinic Monthly Goal Report" permission should be "<ViewCMGR>"
    And the "View Code Summary Report Card" permission should be "<ViewCSR>"

    Examples:
      | Role                     | ViewPMR            | DownloadPMR        | ViewPDR            | ViewCMGR           | ViewCSR            |
      | Executive Admin          | Enabled            | Enabled            | Enabled            | Enabled            | Enabled            |
      | Billing Admin            | Enabled            | Enabled            | Enabled            | Enabled            | Disabled           |
      | Monitoring Admin         | Enabled            | Enabled            | Enabled            | Enabled            | Enabled            |
      | Reporting Admin          | Enabled            | Disabled           | Enabled            | Disabled           | Disabled           |
      | Elevated Supervisor      | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    |
      | Regular Supervisor       | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    |
      | Nurse                    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    |
      | NXTSTIM Nurse            | All Patients       | All Patients       | All Patients       | Disabled           | Disabled           |
      | Support Admin            | Enabled            | Enabled            | Enabled            | Enabled            | Disabled           |
      | Monitoring Supervisor    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    | Own Clinic Only    |
      | Billing Officer          | Enabled            | Enabled            | Disabled           | Enabled            | Disabled           |

  @PermissionMatrix @ClinicFileVault
  Scenario Outline: Verify Clinic File Vault permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to a Clinic's File Vault
    Then the "Upload Files" permission should be "<Upload>"
    And the "Delete Files" permission should be "<Delete>"
    And the "View Files" permission should be "<View>"
    And the "Download Files" permission should be "<Download>"

    Examples:
      | Role                     | Upload             | Delete             | View               | Download           |
      | Executive Admin          | Enabled            | Enabled            | Enabled            | Enabled            |
      | Monitoring Admin         | Enabled            | Enabled            | Enabled            | Enabled            |
      | Elevated Supervisor      | Enabled            | Enabled            | Enabled            | Enabled            |
      | Regular Supervisor       | Enabled            | Enabled            | Enabled            | Disabled           |
      | Nurse                    | Enabled            | Own Only           | Enabled            | Disabled           |
      | NXTSTIM Nurse            | Enabled            | Own Only           | Enabled            | Disabled           |
      | Billing Admin            | Disabled           | Disabled           | Enabled            | Disabled           |
      | Support Admin            | Disabled           | Disabled           | Enabled            | Disabled           |
      | Monitoring Supervisor    | Enabled            | Enabled            | Enabled            | Enabled            |
      | Billing Officer          | Disabled           | Disabled           | Enabled            | Disabled           |

  @PermissionMatrix @PatientFileVault
  Scenario Outline: Verify Patient File Vault permissions per role
    Given a user is logged in with "<Role>" role
    When the user navigates to a Patient's File Vault
    Then the "View File Vault" permission should be "<View>"
    And the "Upload Files" permission should be "<Upload>"
    And the "Delete Files" permission should be "<Delete>"
    And the "Download Files" permission should be "<Download>"

    Examples:
      | Role                     | View               | Upload             | Delete             | Download           |
      | Executive Admin          | Enabled            | Enabled            | Enabled            | Enabled            |
      | Monitoring Admin         | Enabled            | Enabled            | Enabled            | Enabled            |
      | Elevated Supervisor      | Clinic Only        | Clinic Only        | Clinic Only        | Clinic Only        |
      | Regular Supervisor       | Supervised Only    | Supervised Only    | Supervised Only    | Disabled           |
      | Nurse                    | Same Clinic Only   | Same Clinic Only   | Own Only           | Disabled           |
      | NXTSTIM Nurse            | All Patients       | All Patients       | Own Only           | Disabled           |
      | Support Admin            | Enabled            | Disabled           | Disabled           | Disabled           |
      | Monitoring Supervisor    | Clinic Only        | Clinic Only        | Clinic Only        | Clinic Only        |
      | Billing Admin            | Enabled            | Disabled           | Disabled           | Disabled           |
      | Billing Officer          | Enabled            | Disabled           | Disabled           | Disabled           |
