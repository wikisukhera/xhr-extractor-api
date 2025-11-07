/**
 * find_square_local.js
 *
 * Robust, instrumented helper to find/search an address on map.coveragemap.com
 * Exports: async function findSquare(page, address) -> returns array of matched XHR URLs
 *
 * Also runnable as a standalone script for local testing:
 *   node find_square_local.js "316 E Okanogan Ave, Chelan Washington 98816"
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

async function findSquare(page, address) {
  if (!page) throw new Error('page argument is required');
  if (!address) throw new Error('address argument is required');

  // increase timeouts for slow environments
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  // Spoof UA and some automation indicators (helps against light bot checks)
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
  } catch (e) {}

  try {
    await page.evaluateOnNewDocument(() => {
      // navigator.webdriver
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      } catch (e) {}
      // mock chrome
      try { window.chrome = window.chrome || { runtime: {} }; } catch (e) {}
      // permissions query patch
      try {
        const originalQuery = navigator.permissions && navigator.permissions.query;
        if (originalQuery) {
          navigator.permissions.query = parameters =>
            parameters.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission })
              : originalQuery(parameters);
        }
      } catch (e) {}
    });
  } catch (e) {}

  // Collect matched XHR URLs
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  // Attach network listeners
  const onRequest = req => {
    try {
      const url = req.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[network] matched request', url);
      }
    } catch (e) {}
  };
  const onResponse = async resp => {
    try {
      const url = resp.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[network] matched response', url);
      }
    } catch (e) {}
  };

  page.on('request', onRequest);
  page.on('response', onResponse);

  // Navigate to the map and wait for network idle
  console.log('Navigating to map.coveragemap.com ...');
  await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForTimeout(1000);

  // Try to dismiss likely overlays / cookie banners (non-blocking)
  const dismissors = [
    'svg.lucide-x', 'button[aria-label="close"]', 'button[aria-label="Close"]',
    'button[title="Close"]', '.cookie-consent button', '.cmp-close', '.close', '.dismiss'
  ];
  for (const sel of dismissors) {
    try {
      await page.evaluate(s => {
        const el = document.querySelector(s);
        if (el) el.click();
      }, sel);
    } catch (e) {}
  }

  // Candidate selectors (mix of XPath and CSS)
  const selectors = [
    '//*[@id="root"]//input[contains(@placeholder,"address") or contains(@placeholder,"Address") or contains(@placeholder,"location") or contains(@placeholder,"search")]',
    'input[placeholder*="address"]',
    'input[placeholder*="Address"]',
    'input[placeholder*="location"]',
    'input[placeholder*="search"]',
    'input[type="search"]',
    '#root input',
    'input'
  ];

  // Log frame URLs for debugging
  try {
    const frames = page.frames();
    console.log('Frames count:', frames.length);
    frames.forEach((f, i) => {
      try { console.log(`  frame[${i}]: ${f.url()}`); } catch (e) {}
    });
  } catch (e) {}

  // Try find input in main frame first
  let inputHandle = null;
  let foundBy = null;

  for (const sel of selectors) {
    try {
      if (sel.startsWith('//')) {
        const arr = await page.$x(sel);
        if (arr && arr.length) {
          inputHandle = arr[0];
          foundBy = `xpath:${sel}`;
          console.log('Found input via xpath:', sel);
          break;
        }
      } else {
        const el = await page.$(sel);
        if (el) {
          inputHandle = el;
          foundBy = `css:${sel}`;
          console.log('Found input via css:', sel);
          break;
        }
      }
    } catch (e) {
      console.log('Selector error', sel, e && e.message ? e.message : e);
    }
  }

  // If not found, search inside frames
  if (!inputHandle) {
    try {
      const allFrames = page.frames();
      for (const f of allFrames) {
        for (const sel of selectors) {
          try {
            let h = null;
            if (sel.startsWith('//')) {
              const arr = await f.$x(sel);
              if (arr && arr.length) h = arr[0];
            } else {
              h = await f.$(sel);
            }
            if (h) {
              inputHandle = h;
              foundBy = `frame(${f.url().slice(0, 120)})::${sel}`;
              console.log('Found input inside frame:', foundBy);
              break;
            }
          } catch (e) {}
        }
        if (inputHandle) break;
      }
    } catch (e) {
      console.log('Frame search error', e && e.message ? e.message : e);
    }
  }

  // Fallback: any visible input element
  if (!inputHandle) {
    try {
      const visibleHandle = await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const i of inputs) {
          const rect = i.getBoundingClientRect();
          const style = window.getComputedStyle(i);
          if (rect.width > 20 && rect.height > 10 && style && style.visibility !== 'hidden' && style.display !== 'none') {
            return i;
          }
        }
        return null;
      });
      // Check if it's null
      const isNull = await page.evaluate(h => h === null, visibleHandle).catch(() => false);
      if (!isNull) {
        inputHandle = visibleHandle;
        foundBy = 'fallback:visible-input';
        console.log('Found input via fallback visible-input');
      }
    } catch (e) {
      console.log('Visible input fallback failed', e && e.message ? e.message : e);
    }
  }

  // If still not found -> save debug artifacts and throw
  if (!inputHandle) {
    try {
      const debugPrefix = `/tmp/xhr_extractor_${Date.now()}`;
      const html = await page.content();
      const htmlPath = `${debugPrefix}.html`;
      const shotPath = `${debugPrefix}.png`;
      fs.writeFileSync(htmlPath, html);
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      console.error('Search input not found on page. Saved debug artifacts:', htmlPath, shotPath);
      console.error('Page URL:', page.url());
      console.error('HTML snippet (first 2000 chars):', html.slice(0, 2000).replace(/\n/g, ' '));
    } catch (err) {
      console.error('Failed to write debug artifacts:', err && err.message ? err.message : err);
    }
    // remove listeners before throwing
    try { page.removeListener('request', onRequest); page.removeListener('response', onResponse); } catch (e) {}
    throw new Error('Search input not found on page');
  }

  // Interact with the found input handle
  try {
    await inputHandle.focus();
  } catch (e) {
    // ignore; fallback below
  }

  // Clear and type slowly (simulate human)
  try {
    await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle).catch(() => {});
  } catch (e) {}

  console.log('Typing address into input (foundBy:', foundBy, ')');
  // If inputHandle supports .type (ElementHandle), use it; else fallback to keyboard
  const useElementType = typeof inputHandle.type === 'function';

  if (useElementType) {
    try {
      await inputHandle.click({ clickCount: 3 }).catch(()=>{});
      await inputHandle.type(address, { delay: 80 });
    } catch (e) {
      try { await page.keyboard.type(address, { delay: 80 }); } catch (e2) {}
    }
  } else {
    try { await page.keyboard.type(address, { delay: 80 }); } catch (e) {}
  }

  await page.waitForTimeout(900);

  // Try to see if suggestions appear (common pattern)
  let suggestionsVisible = false;
  try {
    suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"], .suggestions, .autocomplete, .pac-container'));
  } catch (e) {}

  if (suggestionsVisible) {
    try {
      // click first suggestion if present
      await page.click('[role="listbox"] [role="option"], .suggestions li, .autocomplete li, .pac-container .pac-item', { timeout: 2000 }).catch(()=>{});
      await page.waitForTimeout(600);
    } catch (e) {
      // fallback to enter
      try { await page.keyboard.press('Enter'); } catch (e2) {}
    }
  } else {
    try { await page.keyboard.press('Enter'); } catch (e) {}
  }

  // Wait a bit for XHRs triggered by selection
  await page.waitForTimeout(1200);

  // If still no matched XHRs, try clicking map center and small offsets to coax requests
  if (matched.size === 0) {
    try {
      console.log('No matched XHRs yet. Attempting to click map to trigger requests...');
      const mapElem = await page.$('div.leaflet-container') || await page.$('div.mapboxgl-canvas') || await page.$('canvas') || await page.$('#root');
      if (mapElem) {
        const box = await mapElem.boundingBox();
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0]];
          for (const [dx,dy] of offsets) {
            try {
              await page.mouse.click(cx + dx, cy + dy);
              await page.waitForTimeout(700);
            } catch (e) {}
            if (matched.size) break;
          }
        }
      }
    } catch (e) {
      console.log('Map-click fallback error', e && e.message ? e.message : e);
    }
  }

  // Wait a bit more for network events to be captured
  await page.waitForTimeout(700);

  // Cleanup listeners
  try { page.removeListener('request', onRequest); page.removeListener('response', onResponse); } catch (e) {}

  const result = Array.from(matched);
  console.log('findSquare result count:', result.length);
  return result;
}

// Export the function for server.js
module.exports = { findSquare };


// ------------------------
// If run directly, launch browser, create page, run findSquare
// ------------------------
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ') || '316 E Okanogan Ave, Chelan Washington 98816';
    console.log('Standalone test mode. Address:', address);

    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: false, // visible for local debugging; change to 'new' / true for CI
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: { width: 1280, height: 800 },
      });

      const page = await browser.newPage();

      // Prepare page similarly to what findSquare expects
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => {
        try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch (e) {}
        try { window.chrome = window.chrome || { runtime: {} }; } catch (e) {}
      });

      const results = await findSquare(page, address);
      console.log('Standalone results:', results);
    } catch (err) {
      console.error('Standalone error:', err && err.stack ? err.stack : err);
    } finally {
      if (browser) await browser.close().catch(()=>{});
      process.exit(0);
    }
  })();
}

module.exports = { findSquare };
