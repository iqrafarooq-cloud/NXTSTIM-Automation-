@MFA
Feature: Multi-Factor Authentication (MFA)
  As a NXTSTIM portal user
  I want to enable, verify, and manage multi-factor authentication
  So that my account is protected with an additional layer of security

  @settings @authenticator-app
  Scenario: User enables MFA via Authenticator App
    Given the user is logged into the NXTSTIM portal
    And the user navigates to the Settings page by clicking on the profile icon
    And no MFA method is currently enabled
    When the user selects the "Authenticator App" radio button
    And the user clicks "Enable MFA"
    Then a modal is displayed showing a QR code
    And a manual entry string for app linking is displayed below the QR code

  @settings @authenticator-app
  Scenario: User completes Authenticator App setup
    Given the Authenticator App setup modal is displayed with the QR code
    When the user clicks "Next"
    Then the modal transitions to a 6-digit authentication code input screen

  @settings @authenticator-app
  Scenario: User verifies Authenticator App code successfully
    Given the user is on the 6-digit authentication code input screen
    When the user enters a valid 6-digit code from their authenticator app
    And the user clicks "Complete"
    Then the code is verified successfully
    And a success toast appears at the bottom of the screen saying "Multi-Factor Authentication Enabled Successfully!"
    And the modal closes
    And an "Enabled" chip is displayed next to "Authenticator App"
    And a "Disable" option is available for the Authenticator App method

  @settings @authenticator-app @negative
  Scenario: User enters invalid code during Authenticator App setup
    Given the user is on the 6-digit authentication code input screen
    When the user enters an invalid 6-digit code
    And the user clicks "Complete"
    Then the code verification fails
    And the user remains on the code input screen with an error message

  @settings @email-verification
  Scenario: User enables MFA via Email Verification
    Given the user is logged into the NXTSTIM portal
    And the user navigates to the Settings page by clicking on the profile icon
    And no MFA method is currently enabled
    When the user selects the "Email Verification" radio button
    And the user clicks "Enable MFA"
    Then the system sends a verification code to the user's registered email
    And a modal is displayed asking for the emailed code

  @settings @email-verification
  Scenario: User verifies Email MFA code successfully
    Given the Email MFA verification modal is displayed
    When the user enters the correct code received via email
    And the user clicks "Verify"
    Then the code is confirmed successfully
    And a success modal is displayed
    And an "Enabled" chip is displayed next to "Email Verification"
    And a "Disable" option is available for the Email Verification method

  @settings @email-verification @negative
  Scenario: User enters an invalid code during Email MFA setup
    Given the Email MFA verification modal is displayed
    When the user enters an invalid 6-digit code
    And the user clicks "Verify"
    Then the code verification fails
    And the user remains on the code input screen with an error message

  @settings @disable
  Scenario: User disables an enabled MFA method
    Given MFA is enabled via "Authenticator App"
    When the user clicks "Disable" next to the enabled method
    Then a confirmation modal is displayed
    And the modal asks for a verification code from the currently enabled MFA method

  @settings @disable
  Scenario: User confirms MFA disable with valid code
    Given the disable confirmation modal is displayed
    When the user enters a valid verification code
    And the user confirms the action
    Then MFA is disabled successfully
    And the "Enabled" chip is removed from the method
    And the "Disable" option is no longer available

  @settings @disable @backup-code
  Scenario: User toggles between authenticator code and backup code entry on the disable modal
    Given the disable confirmation modal is displayed
    When the user proceeds to the authenticator code step
    Then an authenticator code entry field is displayed
    And a "Use a backup code instead" option is available
    When the user chooses to "Use a backup code instead"
    Then a backup recovery code entry field is displayed
    And a "Use authenticator code instead" option is available
    When the user chooses to "Use authenticator code instead"
    Then an authenticator code entry field is displayed
    And a "Use a backup code instead" option is available
    When the user chooses to "Use a backup code instead"
    Then a backup recovery code entry field is displayed

  @settings @disable @backup-code
  Scenario: User disables MFA using a backup recovery code instead of the authenticator code
    Given MFA via Authenticator App has been freshly activated with backup codes saved
    When the user clicks "Disable" next to the enabled method
    And the user confirms turning off Multifactor Authentication
    And the user chooses to "Use a backup code instead"
    And the user enters a valid backup recovery code
    And the user confirms the action
    Then MFA is disabled successfully
    And the "Enabled" chip is removed from the method
    And the "Disable" option is no longer available

  @settings @disable @negative
  Scenario: MFA is not disabled when an invalid authenticator code is entered
    Given the disable confirmation modal is displayed
    When the user proceeds to the authenticator code step
    And the user enters an invalid 6-digit code
    And the user attempts to confirm the disable
    Then the code verification fails
    And the MFA method remains enabled

  @settings @disable @backup-code @negative
  Scenario: MFA is not disabled when an invalid backup recovery code is entered
    Given the disable confirmation modal is displayed
    When the user proceeds to the authenticator code step
    And the user chooses to "Use a backup code instead"
    And the user enters an invalid backup recovery code
    And the user attempts to confirm the disable
    Then the code verification fails
    And the MFA method remains enabled

  @settings @switch @1
  Scenario: User switches MFA method from Email Verification to Authenticator App
    Given MFA is currently enabled via "Email Verification"
    When the user selects the "Authenticator App" radio button
    Then a "Switch multi-factor authentication method" modal is displayed

  @settings @switch @2
  Scenario: User switches MFA method from Authenticator App to Email Verification
    Given MFA is currently enabled via "Authenticator App"
    When the user selects the "Email Verification" radio button
    Then a "Switch multi-factor authentication method" modal is displayed

  @settings @switch @confirm1
  Scenario: User confirms switching MFA method from Email Verification to Authenticator App
    Given the "Switch multi-factor authentication method" modal is displayed
    When the user clicks "Proceed"
    Then the old MFA method (Email Verification) is automatically deactivated
    And the setup flow for the new method (Authenticator App) begins immediately

  @settings @switch @confirm2
  Scenario: User confirms switching MFA method from Authenticator App to Email Verification
    Given the "Switch multi-factor authentication method" modal is displayed switching from "Authenticator App" to "Email Verification"
    When the user clicks "Proceed"
    Then the old MFA method (Authenticator App) is automatically deactivated
    And the setup flow for the new method (Email Verification) begins immediately

  @settings @switch @cancel
  Scenario: User cancels switching MFA method
    Given the "Switch multi-factor authentication method" modal is displayed
    When the user dismisses or cancels the modal
    Then the previously enabled MFA method remains active
    And no changes are made

  @trusted-device @banner
  Scenario: Untrusted device warning banner is displayed
    Given the user is logged into the NXTSTIM portal
    And MFA is enabled on the user's account
    And the user logs in from an untrusted device
    When the login is successful after MFA verification
    Then a warning banner is displayed indicating the device is untrusted
    And the banner contains a "Mark As Trusted" action

  @trusted-device @banner
  Scenario: User manually trusts a device via the banner
    Given the untrusted device warning banner is displayed
    When the user clicks "Mark As Trusted"
    Then the system prompts for a standard MFA code verification
    And the user enters a valid MFA code
    Then the device is added to the Trusted Devices list
    And the warning banner is dismissed


  @trusted-device @banner @negative
  Scenario: Manual trust via banner fails without valid MFA code
    Given the untrusted device warning banner is displayed
    When the user clicks "Mark As Trusted"
    And the user enters an invalid MFA code
    Then the device is NOT added to the Trusted Devices list
    And an error message is displayed

  @trusted-device @recurring-modal @manual
  Scenario: Recurring trust modal appears every 7 days for untrusted devices
    Given the user is logged into the NXTSTIM portal on an untrusted device
    And MFA is enabled on the user's account
    And 7 days have elapsed since the last trust prompt
    When the user logs into the application
    Then a recurring modal is displayed asking "Do you want to trust this device?"
#continue 
  @trusted-device @recurring-modal @manual
  Scenario: User trusts device via the recurring modal
    Given the 7-day recurring trust modal is displayed
    When the user selects "Yes, Trust This Device"
    Then the device is added to the Trusted Devices list without requiring a new MFA code

  @trusted-device @recurring-modal @manual
  Scenario: User declines to trust device via the recurring modal
    Given the 7-day recurring trust modal is displayed
    When the user dismisses or declines the modal
    Then the device remains untrusted
    And the modal will appear again after another 7 days

  @trusted-device @device-list @manual
  Scenario: User views the Trusted Devices list
    Given the user navigates to the Trusted Devices section
    When the list is loaded
    Then each device entry displays the device name (e.g., "MacBook Pro")
    And each device entry displays the last active date
    And each device entry displays the location (e.g., "New York, USA")
    And each device entry has a delete (trash can) icon

  @trusted-device @device-list @revoke @manual
  Scenario: User revokes a trusted device
    Given the Trusted Devices list is displayed
    When the user clicks the delete (trash can) icon next to a device
    Then the device's trusted status is revoked
    And the device is removed from the Trusted Devices list

  @trusted-device @expiry @manual
  Scenario: Trusted device status expires after 1 month
    Given a device was marked as trusted
    And 1 month has elapsed since the device was trusted
    Then the device is automatically removed from the Trusted Devices list
    And the device is treated as untrusted on the next login

  @trusted-device @negative
  Scenario: Trust is only granted within an MFA-verified browser session
    Given the user has NOT passed an MFA challenge in the current browser session
    Then the "Mark As Trusted" action is not available
    And trusted status cannot be granted for the device

  @login
  Scenario: User is redirected to MFA screen after successful primary login
    Given the user has MFA enabled on their account
    And the user is on the primary login page
    When the user enters a valid email and password
    And submits the login form
    Then the system redirects to the "Multi-Factor Authentication" screen
    And a 6-box input field is displayed for the 6-digit verification code

  @login @authenticator-app
  Scenario: User verifies via Authenticator App at login successfully
    Given the user's MFA method is "Authenticator App"
    And the user is on the MFA verification screen
    When the user enters a valid 6-digit TOTP code from their authenticator app
    And submits the code
    Then the code is validated against the time-based one-time password (TOTP) logic
    And the user is granted access to the Dashboard

  @login @authenticator-app @negative
  Scenario: User enters invalid Authenticator App code at login
    Given the user's MFA method is "Authenticator App"
    And the user is on the MFA verification screen
    When the user enters an invalid 6-digit code
    And submits the code
    Then an "Invalid Code" warning is displayed
    And the user remains on the MFA verification screen

  @login @authenticator-app @backup-code
  Scenario: Authenticator login challenge offers a backup recovery code option
    Given the user's MFA method is "Authenticator App"
    And the user is on the MFA verification screen
    Then a "Use a backup code instead" option is available
    When the user chooses to "Use a backup code instead"
    Then a backup recovery code entry field is displayed
    And a "Use authenticator code instead" option is available

  @login @authenticator-app @backup-code
  Scenario: User logs in using a backup recovery code instead of the authenticator code
    Given MFA via Authenticator App is freshly activated and the user is logged out
    And the user is on the MFA verification screen
    When the user chooses to "Use a backup code instead"
    And the user enters a valid backup recovery code
    And submits the code
    Then the user is granted access to the Dashboard

  @login @authenticator-app @backup-code @negative
  Scenario: User enters an invalid backup recovery code at login
    Given the user's MFA method is "Authenticator App"
    And the user is on the MFA verification screen
    When the user chooses to "Use a backup code instead"
    And the user enters an invalid backup recovery code
    And submits the code
    Then an "Invalid Code" warning is displayed
    And the user remains on the MFA verification screen

  @login @email-verification
  Scenario: User verifies via Email MFA at login successfully
    Given the user's MFA method is "Email Verification"
    And the user is on the MFA verification screen
    Then the system sends a unique verification code to the user's registered email
    And the UI displays a masked version of the email (e.g., "m****r@bytecorp.io")
    When the user enters the correct 6-digit code from the email
    And submits the code
    Then the user is granted access to the Dashboard

  @login @email-verification @negative
  Scenario: User enters invalid Email MFA code at login
    Given the user's MFA method is "Email Verification"
    And the user is on the MFA verification screen
    When the user enters an incorrect 6-digit code
    And submits the code
    Then an "Invalid Code" warning is displayed
    And the user remains on the MFA verification screen

  @login @email-verification @resend
  Scenario: Resend timer is displayed for Email MFA
    Given the user's MFA method is "Email Verification"
    And the user is on the MFA verification screen
    Then a "Resend" option is displayed
    And the "Resend" option is initially disabled with a 1-minute countdown timer

  @login @email-verification @resend
  Scenario: User requests to resend Email MFA code after timer expires
    Given the user's MFA method is "Email Verification"
    And the user is on the MFA verification screen
    And the 1-minute resend timer has expired
    When the user clicks "Resend"
    Then a new verification code is sent to the user's registered email
    And the resend timer resets to 1 minute

  @login
  Scenario: User without MFA enabled is not prompted for MFA
    Given the user does NOT have MFA enabled on their account
    When the user enters valid email and password on the primary login page
    Then the user is granted access to the Dashboard directly
    And no MFA verification screen is shown

  @recovery-codes @modal
  Scenario: Recovery Codes modal launches after successful Authenticator App activation
    Given the user is logged into the NXTSTIM portal
    And the user has completed the 6-digit verification handshake to activate the Authenticator App
    When the user clicks "Complete" on the activation screen
    Then a "Recovery Codes" modal overlay is immediately displayed

  @recovery-codes @modal
  Scenario: Recovery Codes modal displays warning banner
    Given the "Recovery Codes" modal is displayed
    Then a warning banner is shown stating "Copy or save this now, these won't be shown again."

  @recovery-codes @modal
  Scenario: Recovery Codes modal displays descriptive header
    Given the "Recovery Codes" modal is displayed
    Then a descriptive header reads "If you lose access to your auth app, you can login using your recovery codes. Each code can only be used once."

  @recovery-codes @code-generation
  Scenario: Ten unique backup codes are generated
    Given the "Recovery Codes" modal is displayed
    Then a code grid is shown containing exactly 10 unique alphanumeric backup codes

  @recovery-codes @download
  Scenario: User downloads recovery codes as a text file
    Given the "Recovery Codes" modal is displayed with the code grid
    When the user clicks the "Download" button
    Then a clean .txt file is downloaded
    And the file contains the raw recovery tokens in plain text

  @recovery-codes @copy
  Scenario: User copies recovery codes to clipboard
    Given the "Recovery Codes" modal is displayed with the code grid
    When the user clicks the "Copy" button
    Then the plain-text block of all recovery codes is copied to the clipboard

  @recovery-codes @close
  Scenario: User closes the Recovery Codes modal
    Given the "Recovery Codes" modal is displayed
    When the user clicks the "Continue" button
    Then the modal is closed

  @recovery-codes @regenerate
  Scenario: Regenerate Backup Codes link is available after initial generation
    Given MFA via Authenticator App has been successfully activated
    And the initial recovery codes have been generated
    When the user navigates to the Authenticator App configuration settings
    Then a "Regenerate Backup Codes" link is displayed

  @recovery-codes @regenerate @backup-code
  Scenario: Regenerate Backup Codes verification offers a backup code alternative
    Given the "Regenerate Backup Codes" link is displayed under the Authenticator App settings
    When the user clicks "Regenerate Backup Codes"
    Then the MFA verification process is re-triggered
    And a "Use a backup code instead" option is available
    

  @recovery-codes @regenerate
  Scenario: User regenerates backup codes
    Given the "Regenerate Backup Codes" link is displayed under the Authenticator App settings
    When the user clicks "Regenerate Backup Codes"
    Then the MFA verification process is re-triggered
    And upon successful verification, a new set of 10 unique recovery codes is generated
    And all previously issued recovery codes are invalidated

  @recovery-codes @regenerate @negative
  Scenario: Old recovery codes are invalid after regeneration
    Given the user has regenerated their backup codes
    When the user attempts to use an old recovery code to log in
    Then the login attempt is rejected
    And an error message is displayed

  @RateLimit
  # Rate Limit: 5 requests per 1 hour
  @FirstTimeAuthenticator
  Scenario: First-time Authenticator verification should be rate limited after 5 requests within 1 hour
    Given the user is on the first-time Authenticator App verification screen
    When the user submits the first-time Authenticator verification request 5 times within 1 hour
    Then the system should process the requests according to the configured rate limit

    When the user submits a 6th first-time Authenticator verification request within the same 1-hour window
    Then the system should block the request
    And the error message should be "Too many requests. Try again in 1 hour"

  @FirstTimeAuthenticator @positive
  Scenario: First-time Authenticator verification requests within the allowed limit are not rate limited
    Given the user is on the first-time Authenticator App verification screen
    When the user submits the first-time Authenticator verification request 5 times within 1 hour
    Then the system should process the requests according to the configured rate limit
    And the request should not be blocked by the rate limiter

  @FirstTimeAuthenticator @negative
  Scenario: A valid first-time Authenticator verification code is rejected once the rate limit is exceeded
    Given the user is on the first-time Authenticator App verification screen
    When the user submits the first-time Authenticator verification request 5 times within 1 hour
    And the user submits a 6th first-time Authenticator verification request within the same 1-hour window
    And the user submits a valid first-time Authenticator verification code within the same 1-hour window
    Then the system should block the request
    And the error message should be "Too many requests. Try again in 3600 seconds"

  # Rate Limit: 10 requests per 1 hour
  @VerificationCode
  Scenario: MFA verification code requests should be rate limited after 10 requests within 1 hour
    Given the user is on the MFA verification screen
    When the user submits the MFA verification code 10 times within 1 hour
    Then the system should process the requests according to the configured rate limit

    When the user submits an 11th MFA verification request within the same 1-hour window
    Then the system should block the request
    And the error message should be "Too many requests. Try again in 3600 seconds"

  @VerificationCode @positive
  Scenario: MFA verification code requests within the allowed limit are not rate limited
    Given the user is on the MFA verification screen
    When the user submits the MFA verification code 10 times within 1 hour
    Then the system should process the requests according to the configured rate limit
    And the request should not be blocked by the rate limiter

  @VerificationCode @negative
  Scenario: A valid MFA verification code is rejected once the verification rate limit is exceeded
    Given the user is on the MFA verification screen
    When the user submits the MFA verification code 10 times within 1 hour
    And the user submits an 11th MFA verification request within the same 1-hour window
    And the user submits a valid MFA verification code within the same 1-hour window
    Then the system should block the request
    And the error message should be "Too many requests. Try again in 3600 seconds"

@trusted-device @bypass @positive
  Scenario: Trusted device should bypass MFA after switching users on the same device
  Given User A has MFA enabled
  And User A has marked the current device as Trusted
  And the trusted device period has not expired
  When User A logs out
  And User B logs into the same device
  And User B logs out
  And User A logs in again using the same trusted device
  Then User A should be logged in successfully
  And the system should not prompt for an MFA verification code

@Trusted-device @bypass @negative
  Scenario: MFA should be required when the trusted device period has expired
  Given User A has MFA enabled
  And User A had previously marked the current device as Trusted
  When User A logs in on the same device
  Then the system should prompt for an MFA verification code
  And User A should complete MFA verification before accessing the application

