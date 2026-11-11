// Capture exactly what the "valid" account does on a correct-password login.
const { chromium } = require('playwright');
const { LoginPage } = require('../features/pages/LoginPage');

(async () => {
  const headed = process.env.HEADED !== 'false';
  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 200 : 0 });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const login = new LoginPage(page);

  const urls = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) urls.push(f.url()); });

  await login.open();
  await login.enterEmail('adminuser@iqra.anonaddy.com');
  await login.enterPassword('StrongPass123!');
  await login.clickLogin();

  // Poll for up to 25s, sampling the URL + any visible error/OTP prompt.
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    const err = (await login.getErrorMessageText().catch(() => '')) || '';
    if (!/\/login\b/i.test(url) || err) {
      console.log(`[t+${i + 1}s] URL=${url} err=${JSON.stringify(err)}`);
      break;
    }
    if (i % 3 === 0) console.log(`[t+${i + 1}s] still /login, err=${JSON.stringify(err)}`);
  }

  console.log('\n--- NAV HISTORY ---', JSON.stringify(urls, null, 2));

  const state = await page.evaluate(() => ({
    url: location.href,
    bodyTextSnippet: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    inputs: [...document.querySelectorAll('input')].map((i) => ({ type: i.type, name: i.name, placeholder: i.placeholder })),
    buttons: [...document.querySelectorAll('button')].map((b) => ({ text: (b.textContent || '').trim().slice(0, 30), disabled: b.disabled })),
    spinner: !!document.querySelector('[role="progressbar"], .MuiCircularProgress-root'),
    alerts: [...document.querySelectorAll('[role="alert"], .MuiAlert-message, [class*="notistack" i]')].map((a) => (a.textContent || '').trim()).filter(Boolean)
  }));
  console.log('\n--- FINAL PAGE STATE ---', JSON.stringify(state, null, 2));

  await browser.close();
})().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
