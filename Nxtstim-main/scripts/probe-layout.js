const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login', {
    waitUntil: 'domcontentloaded'
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const initial = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map((i) => ({
      type: i.type, name: i.name, placeholder: i.placeholder,
      ariaLabel: i.getAttribute('aria-label')
    }));
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      type: b.type, text: (b.textContent || '').trim(),
      ariaLabel: b.getAttribute('aria-label'),
      classes: (b.className?.toString?.() || '').slice(0, 100)
    }));
    const links = [...document.querySelectorAll('a')].map((a) => ({
      href: a.href, text: (a.textContent || '').trim(),
      classes: (a.className?.toString?.() || '').slice(0, 100)
    }));
    const svgs = [...document.querySelectorAll('svg')].map((s) => {
      const parent = s.parentElement;
      const grand = parent?.parentElement;
      return {
        viewBox: s.getAttribute('viewBox'),
        ariaLabel: s.getAttribute('aria-label'),
        classes: (s.getAttribute('class') || '').slice(0, 100),
        parentTag: parent?.tagName,
        parentClasses: (parent?.className?.toString?.() || '').slice(0, 80),
        grandClasses: (grand?.className?.toString?.() || '').slice(0, 80)
      };
    });
    return { inputs, buttons, links, svgs };
  });

  console.log('INITIAL:', JSON.stringify(initial, null, 2));

  // Now fill email and re-probe
  const emailLoc = page.locator('input[name="email"], input[type="email"]').first();
  await emailLoc.fill('user@bytecorp.io');
  await page.waitForTimeout(500);

  const afterEmail = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input')].map((i) => ({
      type: i.type, name: i.name
    })),
    buttons: [...document.querySelectorAll('button')].map((b) => ({
      type: b.type, text: (b.textContent || '').trim().slice(0, 40),
      classes: (b.className?.toString?.() || '').slice(0, 100)
    })),
    links: [...document.querySelectorAll('a')].map((a) => ({
      href: a.href, text: (a.textContent || '').trim().slice(0, 40)
    }))
  }));
  console.log('AFTER_EMAIL_FILL:', JSON.stringify(afterEmail, null, 2));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
