// find_square_local.js  (online-ready version)
const puppeteer = require('puppeteer');
const fs = require('fs');

async function findSquare(address) {
  if (!address) throw new Error('address required');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote',
      '--use-gl=swiftshader',      // <<< software WebGL
      '--ignore-gpu-blocklist',    // <<< allow WebGL
      '--enable-webgl',
      '--disable-gpu-compositing'
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  // ----- XHR capture -------------------------------------------------
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    const url = req.url();
    if (pattern.test(url)) {
      matched.add(url);
      console.log(`[MATCHED REQUEST] ${url}`);
    }
  });
  page.on('response', resp => {
    const url = resp.url();
    if (pattern.test(url)) {
      matched.add(url);
      console.log(`[MATCHED RESPONSE] ${url}`);
    }
  });
  // ------------------------------------------------------------------

  await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 60000 });

  // dismiss popup
  try {
    await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
    await page.click('svg.lucide-x');
    await delay(600);
  } catch (_) {}

  // ----- find input -------------------------------------------------
  const selectors = [
    '//*[@id="root"]//input[contains(@placeholder,"address") or contains(@placeholder,"Address")]',
    'input[placeholder*="address"]',
    'input[type="search"]',
    '#root input',
    'input'
  ];
  let inputHandle = null;
  for (const sel of selectors) {
    try {
      if (sel.startsWith('//')) {
        const [el] = await page.$x(sel);
        if (el) { inputHandle = el; break; }
      } else {
        const el = await page.$(sel);
        if (el) { inputHandle = el; break; }
      }
    } catch (_) {}
  }
  if (!inputHandle) throw new Error('Search input not found');

  await inputHandle.focus();
  await page.evaluate(el => el.value = '', inputHandle);
  // ------------------------------------------------------------------

  console.log('Typing address...');
  for (const ch of address) await inputHandle.type(ch, { delay: 80 });
  await delay(1200);

  let suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
  console.log(`Suggestions visible: ${suggestionsVisible}`);

  if (!suggestionsVisible) {
    for (const n of [1, 2]) {
      for (let i = 0; i < n; i++) await inputHandle.press('Backspace');
      for (let i = 0; i < n; i++) await inputHandle.press('ArrowLeft');
      await page.evaluate(el => el.dispatchEvent(new Event('input', { bubbles: true })), inputHandle);
      await delay(900);
      suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
      console.log(`Suggestions after trick (${n} chars): ${suggestionsVisible}`);
      if (suggestionsVisible) break;
    }
  }

  if (suggestionsVisible) {
    try { await page.click('[role="listbox"] [role="option"]'); } catch (_) {}
    await delay(600);
  } else {
    await inputHandle.press('Enter');
    await delay(1000);
  }

  await delay(800);

  // ----- map clicks -------------------------------------------------
  if (matched.size === 0) {
    console.log('No matches yet, clicking map...');
    const mapElem = await page.$('div.leaflet-container') ||
                    await page.$('div.mapboxgl-canvas') ||
                    await page.$('canvas') ||
                    await page.$('#root');
    if (mapElem) {
      const box = await mapElem.boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0],[10,10],[-10,-10]];
      for (const [dx, dy] of offsets) {
        await page.mouse.click(cx + dx, cy + dy);
        console.log(`Clicked at offset (${dx},${dy})`);
        await delay(800);
        if (matched.size) break;
      }
    }
  }
  // ------------------------------------------------------------------

  await delay(600);
  const result = Array.from(matched);
  await browser.close();
  return result;
}

// ---------- helpers ----------
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- CLI ----------
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ');
    if (!address) {
      console.error('Usage: node find_square_local.js "your address"');
      process.exit(1);
    }
    try {
      const urls = await findSquare(address);
      console.log(JSON.stringify({ xhrUrls: urls }, null, 2));
    } catch (e) {
      console.error('Error:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { findSquare };
