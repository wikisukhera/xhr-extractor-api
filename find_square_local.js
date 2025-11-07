/**
 * find_square_local.js (updated)
 *
 * Robust, instrumented helper to find/search an address on map.coveragemap.com
 * Flexible signature:
 *   - async findSquare(page, address)   // if you already have a puppeteer Page
 *   - async findSquare(address)         // function will launch/close its own browser/page
 *
 * Changes in this version:
 * - Removed page.waitForTimeout usages and added delay(ms) helper to avoid "page.waitForTimeout is not a function"
 * - Made navigation less brittle: try domcontentloaded first, handle navigation timeout without hard failure
 * - Extra logging around navigation/timeouts and debug artifact capture
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// simple delay helper (always works)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    if (createdBrowser && browser) await browser.close().catch(()=>{});
    throw new Error('address argument is required');
  }
  if (!page) {
    if (createdBrowser && browser) await browser.close().catch(()=>{});
    throw new Error('page not available');
  }

  // Set generous defaults (if available)
  try { page.setDefaultNavigationTimeout && page.setDefaultNavigationTimeout(60000); } catch(e) {}
  try { page.setDefaultTimeout && page.setDefaultTimeout(60000); } catch(e) {}

  // Try to set UA and some stealth-like properties
  try {
    await (page.setUserAgent ? page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    ) : Promise.resolve());
  } catch (e) {}

  try {
    await (page.evaluateOnNewDocument ? page.evaluateOnNewDocument(() => {
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
    }) : Promise.resolve());
  } catch (e) {}

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

  page.on && page.on('request', onRequest);
  page.on && page.on('response', onResponse);

  // Navigate to the map with a robust strategy
  console.log('Navigating to map.coveragemap.com ...');
  let navigationTimedOut = false;
  try {
    // Prefer faster 'domcontentloaded' to avoid waiting forever for networkidle in CI
    await page.goto('https://map.coveragemap.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (navErr) {
    // If navigation times out, log and mark, but continue to attempt to interact/capture
    navigationTimedOut = true;
    console.warn('Navigation error or timeout (domcontentloaded). Will continue with best-effort. Error:', navErr && navErr.message ? navErr.message : navErr);
    // Try to capture what we have so far (but continue)
    try {
      const debugPrefix = `/tmp/nav_timeout_${Date.now()}`;
      const html = await (page.content ? page.content() : Promise.resolve('<no content>'));
      const htmlPath = `${debugPrefix}.html`;
      const shotPath = `${debugPrefix}.png`;
      try { fs.writeFileSync(htmlPath, html); } catch(e){}
      try { await (page.screenshot ? page.screenshot({ path: shotPath, fullPage: true }) : Promise.resolve()); } catch(e){}
      console.warn('Saved partial navigation debug artifacts (paths):', htmlPath, shotPath);
    } catch (e) {
      console.error('Failed to save partial navigation artifacts:', e && e.message ? e.message : e);
    }
  }

  // short delay to let inline JS run
  await delay(1200);

  // Try dismissing overlays (non-blocking)
  const dismissors = [
    'svg.lucide-x', 'button[aria-label="close"]', 'button[aria-label="Close"]',
    'button[title="Close"]', '.cookie-consent button', '.cmp-close', '.close', '.dismiss'
  ];
  for (const sel of dismissors) {
    try {
      await (page.evaluate ? page.evaluate(s => {
        const el = document.querySelector(s);
        if (el) { try { el.click(); } catch(e){} }
      }, sel) : Promise.resolve());
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

  // Log frame URLs for debugging (if available)
  try {
    const frames = page.frames ? page.frames() : [];
    console.log('Frames count:', frames.length);
    frames.forEach((f, i) => { try { console.log(`  frame[${i}]: ${f.url()}`); } catch (e) {} });
  } catch (e) {}

  // Find input
  let inputHandle = null;
  let foundBy = null;

  // Helper: try selectors in a given frame-like object
  async function trySelectorsOnContext(context) {
    for (const sel of selectors) {
      try {
        if (sel.startsWith('//')) {
          const arr = (context.$x ? await context.$x(sel) : []);
          if (arr && arr.length) return { handle: arr[0], foundBy: `xpath:${sel}` };
        } else {
          const el = (context.$ ? await context.$(sel) : null);
          if (el) return { handle: el, foundBy: `css:${sel}` };
        }
      } catch (e) {
        // ignore selector errors
      }
    }
    return null;
  }

  // Try main page context
  try {
    const r = await trySelectorsOnContext(page);
    if (r) { inputHandle = r.handle; foundBy = r.foundBy; console.log('Found input via main context:', foundBy); }
  } catch (e) {}

  // If not found, search frames
  if (!inputHandle) {
    try {
      const frames = page.frames ? page.frames() : [];
      for (const f of frames) {
        try {
          const r = await trySelectorsOnContext(f);
          if (r) { inputHandle = r.handle; foundBy = `frame(${(f.url && f.url() || '').slice(0,120)})::${r.foundBy}`; console.log('Found input inside frame:', foundBy); break; }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Fallback: any visible input element
  if (!inputHandle) {
    try {
      const visibleHandle = page.evaluateHandle ? await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const i of inputs) {
          const rect = i.getBoundingClientRect();
          const style = window.getComputedStyle(i);
          if (rect.width > 20 && rect.height > 10 && style && style.visibility !== 'hidden' && style.display !== 'none') return i;
        }
        return null;
      }) : null;
      const isNull = visibleHandle ? await (page.evaluate ? page.evaluate(h => h === null, visibleHandle).catch(()=>false) : false) : true;
      if (visibleHandle && !isNull) { inputHandle = visibleHandle; foundBy = 'fallback:visible-input'; console.log('Found input via fallback visible-input'); }
    } catch (e) {}
  }

  // If no input found -> save debug artifacts & throw
  if (!inputHandle) {
    try {
      const debugPrefix = `/tmp/xhr_extractor_${Date.now()}`;
      const html = page.content ? await page.content() : '<no content>';
      const htmlPath = `${debugPrefix}.html`;
      const shotPath = `${debugPrefix}.png`;
      try { fs.writeFileSync(htmlPath, html); } catch(e){}
      try { await (page.screenshot ? page.screenshot({ path: shotPath, fullPage: true }) : Promise.resolve()); } catch(e){}
      console.error('Search input not found on page. Saved debug artifacts:', htmlPath, shotPath);
      console.error('Page URL:', page.url ? page.url() : '<unknown>');
      console.error('HTML snippet (first 2000 chars):', (html && html.slice ? html.slice(0,2000).replace(/\n/g,' ') : String(html)).slice(0,2000));
    } catch (err) {
      console.error('Failed to write debug artifacts:', err && err.message ? err.message : err);
    } finally {
      page.removeListener && page.removeListener('request', onRequest);
      page.removeListener && page.removeListener('response', onResponse);
      if (createdBrowser && browser) await browser.close().catch(()=>{});
    }
    throw new Error('Search input not found on page');
  }

  // Interact with the found input handle
  try { inputHandle.focus && await inputHandle.focus(); } catch (e) {}

  try { await (page.evaluate ? page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle).catch(()=>{}) : Promise.resolve()); } catch(e){}

  console.log('Typing address into input (foundBy:', foundBy, ')');

  const useElementType = !!(inputHandle.type);
  if (useElementType) {
    try {
      await inputHandle.click && inputHandle.click({ clickCount: 3 }).catch(()=>{});
      await inputHandle.type && inputHandle.type(address, { delay: 80 });
    } catch (e) {
      try { await page.keyboard && page.keyboard.type(address, { delay: 80 }); } catch (e2) {}
    }
  } else {
    try { await page.keyboard && page.keyboard.type(address, { delay: 80 }); } catch (e) {}
  }

  await delay(900);

  let suggestionsVisible = false;
  try {
    suggestionsVisible = await (page.evaluate ? page.evaluate(() => !!document.querySelector('[role="listbox"], .suggestions, .autocomplete, .pac-container')) : false);
  } catch (e) {}

  if (suggestionsVisible) {
    try {
      await (page.click ? page.click('[role="listbox"] [role="option"], .suggestions li, .autocomplete li, .pac-container .pac-item').catch(()=>{}) : Promise.resolve());
      await delay(600);
    } catch (e) {
      try { await page.keyboard && page.keyboard.press('Enter'); } catch (e2) {}
    }
  } else {
    try { await page.keyboard && page.keyboard.press('Enter'); } catch (e) {}
  }

  // Wait for XHRs triggered by selection
  await delay(1200);

  // If still no matched XHRs, try clicking map center and offsets to coax requests
  if (matched.size === 0) {
    try {
      console.log('No matched XHRs yet. Attempting to click map to trigger requests...');
      const mapElem = (page.$ ? await page.$('div.leaflet-container') : null) || (page.$ ? await page.$('div.mapboxgl-canvas') : null) || (page.$ ? await page.$('canvas') : null) || (page.$ ? await page.$('#root') : null);
      if (mapElem) {
        const box = await (mapElem.boundingBox ? mapElem.boundingBox() : null);
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0]];
          for (const [dx,dy] of offsets) {
            try { page.mouse && await page.mouse.click(cx + dx, cy + dy); await delay(700); } catch(e){}
            if (matched.size) break;
          }
        }
      } else {
        console.log('No map element found to click.');
      }
    } catch (e) {
      console.log('Map-click fallback error', e && e.message ? e.message : e);
    }
  }

  await delay(700);

  // cleanup listeners
  try { page.removeListener && page.removeListener('request', onRequest); page.removeListener && page.removeListener('response', onResponse); } catch (e) {}

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
      await page.setUserAgent && page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
      await page.evaluateOnNewDocument && page.evaluateOnNewDocument(() => {
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
