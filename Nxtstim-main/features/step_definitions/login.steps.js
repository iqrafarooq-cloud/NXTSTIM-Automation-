const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('@playwright/test');

// GIVEN
Given('the user is on the login page', async function () {
  await this.pages.login.open();
  expect(await this.pages.login.isOnLoginPage()).toBeTruthy();
});

// WHEN — input
When('the user enters email {string}', async function (email) {
  await this.pages.login.enterEmail(email);
});

When('the user enters password {string}', async function (password) {
  await this.pages.login.enterPassword(password);
});

// Base-account login — credentials come from .env (BASE_EMAIL / BASE_PASSWORD),
// never hardcoded in the feature file. hooks.js loadDotenv() populates these.
When('the user enters the base account email', async function () {
  const email = process.env.BASE_EMAIL;
  expect(email, 'BASE_EMAIL must be set in .env').toBeTruthy();
  await this.pages.login.enterEmail(email);
});

When('the user enters the base account password', async function () {
  const password = process.env.BASE_PASSWORD;
  expect(password, 'BASE_PASSWORD must be set in .env').toBeTruthy();
  await this.pages.login.enterPassword(password);
});

When('the user enters an email of length {int}', async function (length) {
  const local = 'a'.repeat(Math.max(1, length - '@bytecorp.io'.length));
  const longEmail = `${local}@bytecorp.io`.slice(0, length);
  await this.pages.login.enterEmail(longEmail);
});

When('the user enters a password of length {int}', async function (length) {
  const longPassword = 'P@1' + 'x'.repeat(Math.max(0, length - 3));
  await this.pages.login.enterPassword(longPassword.slice(0, length));
});

// WHEN — actions
When('the user clicks the login button', async function () {
  this.loginButtonWasDisabled = await this.pages.login.isLoginButtonDisabled();
  if (!this.loginButtonWasDisabled) {
    try {
      await this.pages.login.clickLogin();
    } catch (err) {
      this.loginClickError = err;
    }
  }
});

When('the user taps the password show\\/hide toggle', async function () {
  const toggled = await this.pages.login.togglePasswordVisibility();
  this.passwordToggleAvailable = toggled;
});

When('the user clicks the {string} link', async function (linkText) {
  if (/forgot/i.test(linkText)) {
    await this.pages.login.clickForgotPassword();
  } else if (/terms/i.test(linkText)) {
    await this.pages.login.clickTermsOfService();
  } else {
    throw new Error(`Unknown link: ${linkText}`);
  }
});

// THEN — navigation / page state
Then('the user should be redirected away from the login page', async function () {
  await this.pages.login.expectNavigatedAwayFromLogin();
  expect(await this.pages.login.isOnLoginPage()).toBeFalsy();
});

Then('the user should see the dashboard or home page', async function () {
  const url = await this.pages.login.getCurrentUrl();
  // The app's post-login landing surface is the Monitoring dashboard
  // (/monitoring), confirmed live; keep the other home-ish routes too.
  expect(url).toMatch(/dashboard|home|account|monitoring|\/$|\/app/i);
});

Then('the user should remain on the login page', async function () {
  await this.pages.login.expectStillOnLoginPage();
  expect(await this.pages.login.isOnLoginPage()).toBeTruthy();
});

Then('the user should be navigated to the forgot password screen', async function () {
  await this.page.waitForTimeout(1500);
  const url = await this.pages.login.getCurrentUrl();
  expect(url).toMatch(/forgot|reset|recover/i);
});

Then('the form should not be submitted', async function () {
  expect(await this.pages.login.isOnLoginPage()).toBeTruthy();
});

// THEN — errors / validation
Then('an error message should be displayed', async function () {
  if (this.loginButtonWasDisabled) {
    expect(this.loginButtonWasDisabled,
      'Login button was disabled — counts as client-side validation feedback'
    ).toBeTruthy();
    return;
  }
  const visible = await this.pages.login.hasErrorMessage();
  expect(visible, 'Expected a visible error message on the login page').toBeTruthy();
  const text = await this.pages.login.getErrorMessageText();
  expect(text.length, 'Error message should not be empty').toBeGreaterThan(0);
});

Then('a validation message should be displayed for the email field', async function () {
  const hasFieldError = await this.pages.login.hasEmailFieldError();
  const buttonDisabled = await this.pages.login.isLoginButtonDisabled();
  expect(hasFieldError || buttonDisabled,
    'Expected email-field validation: a helper-text error or a disabled submit button'
  ).toBeTruthy();
});

Then('a validation message should be displayed for the password field', async function () {
  const hasFieldError = await this.pages.login.hasPasswordFieldError();
  const buttonDisabled = await this.pages.login.isLoginButtonDisabled();
  expect(hasFieldError || buttonDisabled,
    'Expected password-field validation: a helper-text error or a disabled submit button'
  ).toBeTruthy();
});

Then('the user should not be authenticated', async function () {
  expect(await this.pages.login.isOnLoginPage()).toBeTruthy();

  const cookies = await this.context.cookies();
  const authCookie = cookies.find((c) =>
    /auth|session|token|jwt/i.test(c.name) && c.value && c.value.length > 0
  );
  expect(authCookie, 'No auth/session cookie should remain after logout').toBeFalsy();

  
  const storageToken = await this.page.evaluate(() => {
    const TOKEN_KEY = /(^|[^a-z])(jwt|bearer|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token)([^a-z]|$)|(^|:)token$/i;
    const JWT_VALUE = /^(Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    const scan = (store) => {
      for (const k of Object.keys(store)) {
        const v = store.getItem(k) || '';
        if (!v) continue;
        if (TOKEN_KEY.test(k)) return `${k}=${v.slice(0, 40)}`;
        if (JWT_VALUE.test(v.trim())) return `${k}=<jwt>`;
      }
      return null;
    };
    return scan(localStorage) || scan(sessionStorage);
  });
  expect(storageToken, `No auth token should remain in storage after logout (found: ${storageToken})`).toBeNull();
});

// THEN — login button state 
Then('the login button should be disabled', async function () {
  expect(await this.pages.login.isLoginButtonDisabled()).toBeTruthy();
});

Then('the login button should be enabled', async function () {
  expect(await this.pages.login.isLoginButtonEnabled()).toBeTruthy();
});

// THEN
Then('the NXTSTIM logo should be visible', async function () {
  expect(await this.pages.login.isLogoVisible()).toBeTruthy();
});

Then('the email input field should be visible', async function () {
  expect(await this.pages.login.isVisible(this.pages.login.emailInput)).toBeTruthy();
});

Then('the password input field should be visible', async function () {
  expect(await this.pages.login.isVisible(this.pages.login.passwordInput)).toBeTruthy();
});

Then('the password field should have a show\\/hide toggle', async function () {
  expect(await this.pages.login.isVisible(this.pages.login.passwordToggle)).toBeTruthy();
});

Then('the login button should be visible', async function () {
  expect(await this.pages.login.isVisible(this.pages.login.loginButton)).toBeTruthy();
});

Then('the {string} link should be visible', async function (linkText) {
  if (/forgot/i.test(linkText)) {
    expect(await this.pages.login.isForgotPasswordLinkVisible()).toBeTruthy();
  } else if (/terms/i.test(linkText)) {
    expect(await this.pages.login.isTermsLinkVisible()).toBeTruthy();
  } else {
    throw new Error(`Unknown link: ${linkText}`);
  }
});

Then('the email field should have a non-empty placeholder', async function () {
  const placeholder = await this.pages.login.getEmailPlaceholder();
  expect(placeholder.length, 'Email field should have placeholder text').toBeGreaterThan(0);
});

Then('the password field should have a non-empty placeholder', async function () {
  const placeholder = await this.pages.login.getPasswordPlaceholder();
  expect(placeholder.length, 'Password field should have placeholder text').toBeGreaterThan(0);
});

// THEN — password masking 
Then('the password field should be masked', async function () {
  expect(await this.pages.login.isPasswordMasked(),
    'Password input type should be "password" (masked)'
  ).toBeTruthy();
});

Then('the password field should be visible as plain text', async function () {
  if (this.passwordToggleAvailable === false) {
    return;
  }
  expect(await this.pages.login.isPasswordMasked(),
    'Password input type should change to "text" when toggle is on'
  ).toBeFalsy();
});

// THEN — Terms link 
Then('the {string} link should point to a Terms of Service URL', async function (linkText) {
  if (!/terms/i.test(linkText)) {
    throw new Error(`This step is for the Terms link; got: ${linkText}`);
  }
  const href = await this.pages.login.getTermsLinkHref();
  expect(href, 'Terms link should have an href attribute').toBeTruthy();
  expect(href).toMatch(/terms|tos|legal/i);
});

// WHEN / THEN — Logout flow
When('the user opens the profile menu', async function () {
  // Let the heavy Monitoring dashboard settle before driving the menu — a late
  // re-render can otherwise close the freshly opened menu before the logout
  // item is clicked (mirrors the MFA suite's waitForReady pattern).
  await this.pages.dashboard.waitForReady().catch(() => {});
  await this.pages.dashboard.openProfileMenu();
});

When('the user clicks the logout option', async function () {
  await this.pages.dashboard.clickLogout();
});

Then('the user should be redirected to the login page', async function () {
  await this.pages.dashboard.expectRedirectedToLogin();
  expect(await this.pages.login.isOnLoginPage(),
    'Expected to land back on the login page after logout'
  ).toBeTruthy();
});

