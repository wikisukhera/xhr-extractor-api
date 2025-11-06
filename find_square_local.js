// find_square_local.js
const chromium = require('chrome-aws-lambda');

async function findSquare(address) {
  let browser = null;
  
  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    const matched = new Set();
    const pattern = /square\?id=\d+/i;

    page.on('request', req => {
      if (pattern.test(req.url())) matched.add(req.url());
    });

    await page.goto('https://map.coveragemap.com/', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });

    // Dismiss popup if present
    try {
      await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
      await page.click('svg.lucide-x');
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {}

    // Find input field
    const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
    if (!input) throw new Error('Search input not found');

    await input.click({ clickCount: 3 });
    await input.press('Backspace');
    await input.type(address, { delay: 80 });

    await new Promise(r => setTimeout(r, 1500));

    // Click suggestion or press Enter
    const listbox = await page.$('[role="listbox"]');
    if (listbox) {
      await page.click('[role="listbox"] [role="option"]');
    } else {
      await input.press('Enter');
    }

    await new Promise(r => setTimeout(r, 1000));

    // If no matches, click map center
    if (matched.size === 0) {
      const map = await page.$('canvas, .leaflet-container');
      if (map) {
        const box = await map.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 800));
      }
    }

    await new Promise(r => setTimeout(r, 600));
    const result = Array.from(matched);
    
    return result;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { findSquare };
