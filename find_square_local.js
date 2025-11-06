// find_square_local.js
// Robust: uses remote browser if BROWSERLESS_WS or BROWSERLESS_API_KEY is set,
// otherwise launches local Chromium via full `puppeteer`.

const puppeteer = require('puppeteer');

async function connectBrowser() {
  // Prefer remote WebSocket if provided (use puppeteer-core for connect)
  if (process.env.BROWSERLESS_WS || process.env.BROWSERLESS_API_KEY) {
    const pcore = require('puppeteer-core');
    if (process.env.BROWSERLESS_WS) {
      return await pcore.connect({ browserWSEndpoint: process.env.BROWSERLESS_WS });
    }
    // example Browserless cloud token endpoint
    const endpoint = `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`;
    return await pcore.connect({ browserWSEndpoint: endpoint });
  }

  // Fallback: launch local Chromium provided by full `puppeteer` install
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
}

async function findSquare(address) {
  if (!address) throw new Error('address required');

  let browser;
  try {
    browser = await connectBrowser();
    const page = await browser.newPage();

    const matched = new Set();
    const pattern = /square\?id=\d+/i;

    page.on('request', req => {
      try {
        const url = req.url();
        if (pattern.test(url)) matched.add(url);
      } catch (e) { /* ignore request parsing errors */ }
    });

    await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    // close any modal 'x' if present
    try {
      await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
      await page.click('svg.lucide-x');
      await page.waitForTimeout(600);
    } catch (e) { /* not present => ignore */ }

    const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
    if (!input) throw new Error('Input element not found on page');

    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await input.type(address, { delay: 80 });

    await page.waitForTimeout(1500);

    const listbox = await page.$('[role="listbox"]');
    if (listbox) {
      const option = await listbox.$('[role="option"]');
      if (option) {
        await option.click();
      } else {
        await page.keyboard.press('Enter');
      }
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(1000);

    // If no matched xhrs yet, try clicking the map center to force tile/load
    if (matched.size === 0) {
      const map = await page.$('canvas, .leaflet-container');
      if (map) {
        const box = await map.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(800);
        }
      }
    }

    await page.waitForTimeout(600);

    const result = Array.from(matched);
    try { await page.close(); } catch (e) {}
    // If connected via puppeteer-core, prefer disconnect(), otherwise close()
    try {
      if (browser && browser.disconnect) browser.disconnect();
      else if (browser) await browser.close();
    } catch (e) {}

    return result;
  } catch (err) {
    // make sure browser is closed on errors
    try { if (browser && browser.close) await browser.close(); } catch (e) {}
    throw err;
  }
}

module.exports = { findSquare };
