/**
 * find_square_local.js
 *
 * Robust, instrumented helper to find/search an address on map.coveragemap.com
 * Flexible signature:
 *   - async findSquare(page, address)   // if you already have a puppeteer Page
 *   - async findSquare(address)         // function will launch/close its own browser/page
 *
 * Also runnable as a standalone script:
 *   node find_square_local.js "316 E Okanogan Ave, Chelan Washington 98816"
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Flexible findSquare
 * Accepts either (page, address) or (address)
 * Returns array of matched XHR URL strings
 */
async function findSquare(arg1, arg2) {
  // Determine call style
  let page = null;
  let browser = null;
  let address = null;
  let createdBrowser = false;

  if (!arg1 && !arg2) {
    throw new Error('address argument is required');
  }

  // If first arg is a string, caller used findSquare(address)
  if (typeof arg1 === 'string' && (typeof arg2 === 'undefined' || arg2 === null)) {
    address = arg1;
    // create browser + page
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: { width: 1280, height: 800 },
    });
    createdBrowser = true;
    page = await browser.newPage();
  } else {
    // assume (page, address)
    page = arg1;
    address = arg2;
  }

  if (!address) {
    // cleanup if we started the browser
    if (createdBrowser && browser) await browser.close().catch(()=>{});
    throw new Error('address argument is required');
  }
  if (!page) {
    if (createdBrowser && browser) await browser.close().catch(()=>{});
    throw new Error('page not available');
  }

  // Set generous defaults & defenses
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  try {
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      );
    } catch (e) {}

    try {
      await page.evaluateOnNewDocument(() => {
        try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch(e){}
        try { window.chrome = window.chrome || { runtime: {} }; } catch(e){}
        try {
          const originalQuery = navigator.permissions && navigator.permissions.query;
          if (originalQuery) {
            navigator.permissions.query = parameters =>
              parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : originalQuery(parameters);
          }
        } catch(e){}
      });
    } catch(e){}
  } catch (e) {
    // not fatal
    console.log('Warning: failed to set stealth-like properties', e && e.message ? e.message : e);
  }

  // Network capture
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

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

  // Visit page
  console.log('Navigating to map.coveragemap.com ...');
  await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForTimeout(1000);

  // Dismiss overlays
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

  // Candidate selectors (XPath + CSS)
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

  // Frame logging
  try {
    const frames = page.frames();
    console.log('Frames count:', frames.length);
    frames.forEach((f, i) => { try { console.log(`  frame[${i}]: ${f.url()}`); } catch (e) {} });
  } catch (e) {}

  // Find input
  let inputHandle = null;
  let foundBy = null;

  for (const sel of selectors) {
    try {
      if (sel.startsWith('//')) {
        const arr = await page.$x(sel);
        if (arr && arr.length) { inputHandle = arr[0]; foundBy = `xpath:${sel}`; console.log('Found input via xpath:', sel); break; }
      } else {
        const el = await page.$(sel);
        if (el) { inputHandle = el; foundBy = `css:${sel}`; console.log('Found input via css:', sel); break; }
      }
    } catch (e) {
      console.log('Selector error', sel, e && e.message ? e.message : e);
    }
  }

  // Search inside frames if needed
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
              foundBy = `frame(${f.url().slice(0,120)})::${sel}`;
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

  // Fallback visible input
  if (!inputHandle) {
    try {
      const visibleHandle = await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const i of inputs) {
          const rect = i.getBoundingClientRect();
          const style = window.getComputedStyle(i);
          if (rect.width > 20 && rect.height > 10 && style && style.visibility !== 'hidden' && style.display !== 'none') return i;
        }
        return null;
      });
      const isNull = await page.evaluate(h => h === null, visibleHandle).catch(()=>false);
      if (!isNull) {
        inputHandle = visibleHandle;
        foundBy = 'fallback:visible-input';
        console.log('Found input via fallback visible-input');
      }
    } catch (e) {
      console.log('Visible input fallback failed', e && e.message ? e.message : e);
    }
  }

  // If no input found -> save debug artifacts & throw
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
    } finally {
      try { page.removeListener('request', onRequest); page.removeListener('response', onResponse); } catch(e){}
      if (createdBrowser && browser) await browser.close().catch(()=>{});
    }
    throw new Error('Search input not found on page');
  }

  // Interact with input
  try { await inputHandle.focus(); } catch (e) {}

  try { await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle).catch(()=>{}); } catch(e){}

  console.log('Typing address into input (foundBy:', foundBy, ')');

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

  let suggestionsVisible = false;
  try {
    suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"], .suggestions, .autocomplete, .pac-container'));
  } catch (e) {}

  if (suggestionsVisible) {
    try {
      await page.click('[role="listbox"] [role="option"], .suggestions li, .autocomplete li, .pac-container .pac-item', { timeout: 2000 }).catch(()=>{});
      await page.waitForTimeout(600);
    } catch (e) {
      try { await page.keyboard.press('Enter'); } catch (e2) {}
    }
  } else {
    try { await page.keyboard.press('Enter'); } catch (e) {}
  }

  // Wait for XHRs
  await page.waitForTimeout(1200);

  // Map-click fallback to trigger XHRs
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
            try { await page.mouse.click(cx + dx, cy + dy); await page.waitForTimeout(700); } catch(e){}
            if (matched.size) break;
          }
        }
      }
    } catch (e) {
      console.log('Map-click fallback error', e && e.message ? e.message : e);
    }
  }

  await page.waitForTimeout(700);

  // cleanup listeners
  try { page.removeListener('request', onRequest); page.removeListener('response', onResponse); } catch (e) {}

  const result = Array.from(matched);
  console.log('findSquare result count:', result.length);

  // Close browser if we created it
  if (createdBrowser && browser) {
    try { await browser.close(); } catch(e) {}
  }

  return result;
}

// Export
module.exports = { findSquare };

// If run directly: launch and run in standalone mode
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ') || '316 E Okanogan Ave, Chelan Washington 98816';
    console.log('Standalone test mode. Address:', address);

    let browser = null;
    try {
      browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: { width: 1280, height: 800 },
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument(() => {
        try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch(e){}
        try { window.chrome = window.chrome || { runtime: {} }; } catch(e){}
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
