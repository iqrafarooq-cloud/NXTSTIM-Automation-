const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('https://gentle-glacier-00956ce0f-preview.eastus2.6.azurestaticapps.net/login', {
    waitUntil: 'domcontentloaded'
  });

  await page.locator('input[name="email"]').first().fill('uy8ojhef@anonaddy.com');
  await page.locator('input[name="password"]').first().fill('WrongPassword!');
  await page.waitForTimeout(300);
  await page.locator('button[type="submit"]').first().click().catch(() => {});

  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    const phrase = 'Login failed';
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.textContent || '').trim();
      if (t.startsWith(phrase) && t.length < 200) {
        // ancestors
        const chain = [];
        let cur = node;
        while (cur && cur !== document.body && chain.length < 6) {
          chain.push({ tag: cur.tagName, id: cur.id, classes: cur.className?.toString?.() || '', role: cur.getAttribute('role') });
          cur = cur.parentElement;
        }
        found.push({ text: t, chain });
        if (found.length >= 3) break;
      }
    }
    return found;
  });
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
