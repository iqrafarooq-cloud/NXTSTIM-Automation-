const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  await page.goto('https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login', {
    waitUntil: 'domcontentloaded'
  });

  // Mimic LoginPage.waitForLoaded
  await page.locator('input[name="email"], input[type="email"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('input[name="password"], input[type="password"]').first().waitFor({ state: 'visible', timeout: 15000 });

  const data = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')];
    return svgs.map((s, i) => {
      const rect = s.getBoundingClientRect();
      const cs = window.getComputedStyle(s);
      return {
        idx: i,
        viewBox: s.getAttribute('viewBox'),
        width: s.getAttribute('width'),
        height: s.getAttribute('height'),
        rectW: Math.round(rect.width),
        rectH: Math.round(rect.height),
        rectTop: Math.round(rect.top),
        display: cs.display,
        visibility: cs.visibility,
        parentTag: s.parentElement?.tagName,
        parentClasses: (s.parentElement?.className?.toString?.() || '').slice(0, 100),
        grandClasses: (s.parentElement?.parentElement?.className?.toString?.() || '').slice(0, 100)
      };
    });
  });
  console.log('SVG_COUNT:', data.length);
  console.log(JSON.stringify(data, null, 2));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
