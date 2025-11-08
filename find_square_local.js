// find_square_local.js — Render.com PROVEN VERSION
const puppeteer = require('puppeteer');

async function findSquare(address) {
  if (!address) throw new Error('Address is required');

  console.log('Launching browser...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--use-gl=swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        '--memory-pressure-off',
        '--max_old_space_size=256'
      ],
      defaultViewport: { width: 1280, height: 800 },
      timeout: 60000
    });
  } catch (err) {
    console.error('Browser launch failed:', err.message);
    throw new Error(`Browser failed: ${err.message}`);
  }

  const page = await browser.newPage();

  // XHR tracking
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    const url = req.url();
    if (pattern.test(url)) {
      matched.add(url);
      console.log(`[XHR] ${url}`);
    }
  });

  page.on('response', resp => {
    const url = resp.url();
    if (pattern.test(url)) {
      matched.add(url);
      console.log(`[XHR RES] ${url}`);
    }
  });

  try {
    console.log('Navigating...');
    await page.goto('https://map.coveragemap.com/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Optional: Verify WebGL
    const webgl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    });
    console.log(`WebGL enabled: ${webgl}`);

    // Dismiss popup
    try {
      await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
      await page.click('svg.lucide-x');
      await delay(500);
    } catch (_) {}

    // Find input
    const input = await page.waitForSelector('input[placeholder*="address"], input[type="search"], #root input, input', { timeout: 10000 });
    if (!input) throw new Error('Input not found');

    await input.click({ clickCount: 3 });
    await input.press('Backspace');
    await input.type(address, { delay: 80 });

    await delay(1200);

    const hasSuggestions = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
    console.log(`Suggestions: ${hasSuggestions}`);

    if (!hasSuggestions) {
      await input.press('Enter');
      await delay(1000);
    } else {
      try {
        await page.click('[role="listbox"] [role="option"]');
        await delay(600);
      } catch (_) {
        await input.press('Enter');
      }
    }

    await delay(800);

    // Click map if no XHR yet
    if (matched.size === 0) {
      console.log('Clicking map...');
      const map = await page.$('div.leaflet-container, canvas');
      if (map) {
        const box = await map.boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.click(cx, cy);
        await delay(1200);
      }
    }

    await delay(1000);
    const result = Array.from(matched);
    console.log(`Found ${result.length} XHR(s)`);
    return result;

  } catch (err) {
    console.error('Page error:', err.message);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { findSquare };

// CLI
if (require.main === module) {
  const address = process.argv.slice(2).join(' ');
  if (!address) {
    console.error('Usage: node find_square_local.js "address"');
    process.exit(1);
  }
  findSquare(address)
    .then(res => console.log(JSON.stringify({ xhrUrls: res }, null, 2)))
    .catch(err => {
      console.error('Failed:', err.message);
      process.exit(1);
    });
}
