// find_square_local.js
// Connects to remote browser if BROWSERLESS_WS or BROWSERLESS_API_KEY is set.
// Falls back to launching local Puppeteer only if available.

const PUPPETEER_CORE = require('puppeteer-core');

async function connectBrowser() {
  // Prefer explicit websocket endpoint
  if (process.env.BROWSERLESS_WS) {
    return await PUPPETEER_CORE.connect({ browserWSEndpoint: process.env.BROWSERLESS_WS });
  }

  // Support token-style endpoints (browserless.io style)
  if (process.env.BROWSERLESS_API_KEY) {
    const endpoint = `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`;
    return await PUPPETEER_CORE.connect({ browserWSEndpoint: endpoint });
  }

  // No remote configured — try launching local (may fail if Chromium is missing)
  // Attempt to require full puppeteer only when fallback needed
  try {
    const PUPPETEER = require('puppeteer');
    return await PUPPETEER.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
  } catch (e) {
    throw new Error('No remote browser configured (BROWSERLESS_WS/BROWSERLESS_API_KEY) and local Chromium not available.');
  }
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
      } catch (e) { /* ignore */ }
    });

    await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    try {
      await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
      await page.click('svg.lucide-x');
      await page.waitForTimeout(600);
    } catch (e) {}

    const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
    if (!input) throw new Error('Input not found');

    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await input.type(address, { delay: 80 });
    await page.waitForTimeout(1500);

    const listbox = await page.$('[role="listbox"]');
    if (listbox) {
      const option = await listbox.$('[role="option"]');
      if (option) await option.click();
      else await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(1000);

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

    // cleanup: if connected via WS use disconnect, otherwise close
    try {
      if (browser && browser.disconnect) browser.disconnect();
      else if (browser) await browser.close();
    } catch (e) {}

    return result;
  } catch (err) {
    try { if (browser && browser.close) await browser.close(); } catch (e) {}
    throw err;
  }
}

module.exports = { findSquare };
