const axios = require('axios');

async function findSquare(address) {
  const 2TMV2diwGKn97trf65f0a7dc42431aa312807cb34e470dd7b = process.env.BROWSERLESS_API_KEY;
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY environment variable not set');
  }

  const browserlessUrl = `https://chrome.browserless.io/content?token=${BROWSERLESS_API_KEY}`;
  
  const response = await axios.post(browserlessUrl, {
    code: `
      const page = window.page;
      const matched = new Set();
      const pattern = /square\\?id=\\d+/i;

      page.on('request', req => {
        if (pattern.test(req.url())) matched.add(req.url());
      });

      await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 30000 });

      try {
        await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
        await page.click('svg.lucide-x');
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {}

      const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
      if (!input) throw new Error('Search input not found');

      await input.click({ clickCount: 3 });
      await input.press('Backspace');
      await input.type('${address.replace(/'/g, "\\'")}', { delay: 80 });

      await new Promise(r => setTimeout(r, 1500));

      const listbox = await page.$('[role="listbox"]');
      if (listbox) {
        await page.click('[role="listbox"] [role="option"]');
      } else {
        await input.press('Enter');
      }

      await new Promise(r => setTimeout(r, 1000));

      if (matched.size === 0) {
        const map = await page.$('canvas, .leaflet-container');
        if (map) {
          const box = await map.boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await new Promise(r => setTimeout(r, 800));
        }
      }

      await new Promise(r => setTimeout(r, 600));
      return Array.from(matched);
    `,
    options: {
      timeout: 60000,
      viewport: { width: 1280, height: 800 }
    }
  }, { timeout: 65000 });

  return response.data.value;
}

module.exports = { findSquare };
