/**
 * find_square_local.js (robust, headless-friendly)
 *
 * - Keeps previous safe stealth tweaks (no navigator.permissions override).
 * - Adds geocoding-response capture (api.mapbox.com/geocoding).
 * - Adds more aggressive click + DOM-event strategies to coax site into firing XHR.
 * - Allows forcing headful mode by setting RENDER_HEADFUL=true in env.
 *
 * Usage:
 *  - As module: const { findSquare } = require('./find_square_local');
 *  - Standalone: node find_square_local.js "120 Broadway, Floor 8, New York, NY 10271"
 */
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function saveArtifacts(prefix, page, requests = []) {
  try {
    const html = page.content ? await page.content() : '<no content>';
    const htmlPath = `${prefix}.html`;
    const pngPath = `${prefix}.png`;
    const reqPath = `${prefix}.requests.json`;
    try { fs.writeFileSync(htmlPath, html); } catch (e) {}
    try { await (page.screenshot ? page.screenshot({ path: pngPath, fullPage: true }) : Promise.resolve()); } catch (e) {}
    try { fs.writeFileSync(reqPath, JSON.stringify(requests.slice(-2000), null, 2)); } catch (e) {}
    console.warn('Saved final debug artifacts:', htmlPath, pngPath, reqPath);
  } catch (e) {
    console.error('Failed to save artifacts:', e && e.message ? e.message : e);
  }
}

/**
 * findSquare(pageOrAddress, maybeAddress)
 * Accepts either (page, address) or (address)
 * Returns array of matched XHR URL strings (square?id=...)
 */
async function findSquare(arg1, arg2) {
  let page = null;
  let browser = null;
  let address = null;
  let createdBrowser = false;

  if (!arg1 && !arg2) throw new Error('address argument is required');

  if (typeof arg1 === 'string' && (typeof arg2 === 'undefined' || arg2 === null)) {
    address = arg1;
    // choose headless vs headful based on env toggle for parity testing
    const forceHeadful = !!(process.env.RENDER_HEADFUL && process.env.RENDER_HEADFUL !== 'false' && process.env.RENDER_HEADFUL !== '0');
    const HEADLESS = (process.env.HEADLESS || 'true').toLowerCase() !== 'false';

// Launch options safe for headless Linux containers (Render)
// CRITICAL FIX: Do NOT disable WebGL - the site needs it to render!
const launchOptions = {
  headless: HEADLESS ? 'new' : false,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-zygote',
    '--single-process'
  ],
  defaultViewport: DEFAULT_VIEWPORT
};

const browser = await puppeteer.launch(launchOptions);
    createdBrowser = true;
    page = await browser.newPage();
  } else {
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

  // generous timeouts
  try { page.setDefaultNavigationTimeout && page.setDefaultNavigationTimeout(90000); } catch (e) {}
  try { page.setDefaultTimeout && page.setDefaultTimeout(90000); } catch (e) {}

  // safe UA/stealth
  try {
    await (page.setUserAgent ? page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    ) : Promise.resolve());
  } catch(e){}

  try {
    await (page.evaluateOnNewDocument ? page.evaluateOnNewDocument(() => {
      try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch(e){}
      try { window.chrome = window.chrome || { runtime: {} }; } catch(e){}
      // intentionally DO NOT override navigator.permissions.query (causes Illegal invocation)
    }) : Promise.resolve());
  } catch(e){}

  // instrumentation
  const requests = [];
  const pushReq = r => { try { requests.push(r); if (requests.length > 5000) requests.shift(); } catch(e){} };

  // matched XHRs
  const matched = new Set();
  const squarePattern = /square\?id=\d+/i;
  // capture geocoding responses (helpful to confirm map returned coordinates)
  const geocodingMatches = [];

  page.on && page.on('request', req => {
    try {
      pushReq({ type: 'request', method: req.method(), url: req.url(), ts: Date.now() });
      // log concise
      console.log('[REQ] ', req.method(), req.url());
    } catch(e){}
  });
  page.on && page.on('response', async resp => {
    try {
      const u = resp.url();
      pushReq({ type: 'response', status: resp.status(), url: u, ts: Date.now() });
      console.log('[RESP] ', resp.status(), u);
      if (squarePattern.test(u)) {
        matched.add(u);
        console.log('[network] matched response', u);
      }
      // capture mapbox geocoding json (first feature center)
      if (/api\.mapbox\.com\/geocoding\/v5\/mapbox\.places\/.*\.json/i.test(u)) {
        try {
          const body = await resp.json().catch(()=>null);
          if (body && Array.isArray(body.features) && body.features.length) {
            const f = body.features[0];
            if (f && f.center && f.center.length === 2) {
              geocodingMatches.push({ url: u, center: f.center, place_name: f.place_name });
              console.log('[geocode] captured center', f.center, f.place_name);
            }
          }
        } catch(e){}
      }
    } catch(e){}
  });
  page.on && page.on('requestfinished', req => {
    try {
      console.log('[REQFIN] ', req.method(), req.url());
    } catch(e){}
  });
  page.on && page.on('console', async msg => {
    try {
      const args = await Promise.all(msg.args().map(a => a.jsonValue().catch(()=>a.toString())));
      console.log('PAGE CONSOLE', msg.type(), ...args);
    } catch(e){
      console.log('PAGE CONSOLE', msg.type(), msg.text && msg.text());
    }
  });
  page.on && page.on('pageerror', err => {
    console.error('PAGE ERROR:', err && err.stack ? err.stack : err);
  });

  // Navigate
  console.log('Navigating to map.coveragemap.com ...');
  try {
    await page.goto('https://map.coveragemap.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (navErr) {
    console.warn('Navigation warning (domcontentloaded):', navErr && navErr.message ? navErr.message : navErr);
    // continue best-effort
  }

  // short pause
  await delay(1200);

  // dismiss overlays (best-effort)
  const dismissors = [ 'svg.lucide-x', 'button[aria-label="close"]', '.cookie-consent button', '.close', '.dismiss' ];
  for (const sel of dismissors) {
    try {
      await (page.evaluate ? page.evaluate(s => { const el = document.querySelector(s); if (el) { try { el.click(); } catch(e){} } }, sel) : Promise.resolve());
    } catch(e){}
  }

  // selectors to find input
  const selectors = [
    '//*[@id="root"]//input[contains(@placeholder,"address") or contains(@placeholder,"Address") or contains(@placeholder,"location") or contains(@placeholder,"search")]',
    'input[placeholder*="address"]',
    'input[placeholder*="Address"]',
    'input[placeholder*="search"]',
    'input[type="search"]',
    '#root input',
    'input'
  ];

  // log frames
  try {
    const frames = page.frames ? page.frames() : [];
    console.log('Frames count:', frames.length);
    frames.forEach((f,i)=>{ try{ console.log(`  frame[${i}]: ${f.url()}`); }catch(e){} });
  } catch(e){}

  // find input handle
  let inputHandle = null;
  let foundBy = null;

  async function trySelectorsOnContext(context) {
    for (const sel of selectors) {
      try {
        if (sel.startsWith('//')) {
          const arr = context.$x ? await context.$x(sel) : [];
          if (arr && arr.length) return { handle: arr[0], foundBy: `xpath:${sel}` };
        } else {
          const el = context.$ ? await context.$(sel) : null;
          if (el) return { handle: el, foundBy: `css:${sel}` };
        }
      } catch(e){}
    }
    return null;
  }

  try {
    const r = await trySelectorsOnContext(page);
    if (r) { inputHandle = r.handle; foundBy = r.foundBy; console.log('Found input via main context:', foundBy); }
  } catch(e){}

  if (!inputHandle) {
    try {
      const frames = page.frames ? page.frames() : [];
      for (const f of frames) {
        try {
          const r = await trySelectorsOnContext(f);
          if (r) { inputHandle = r.handle; foundBy = `frame(${(f.url && f.url() || '').slice(0,120)})::${r.foundBy}`; console.log('Found input inside frame:', foundBy); break; }
        } catch(e){}
      }
    } catch(e){}
  }

  // fallback: any visible input
  if (!inputHandle) {
    try {
      const visible = page.evaluateHandle ? await page.evaluateHandle(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const i of inputs) {
          const r = i.getBoundingClientRect();
          const style = window.getComputedStyle(i);
          if (r.width > 20 && r.height > 10 && style && style.visibility !== 'hidden' && style.display !== 'none') return i;
        }
        return null;
      }) : null;
      const isNull = visible ? await (page.evaluate ? page.evaluate(h => h === null, visible).catch(()=>false) : false) : true;
      if (visible && !isNull) { inputHandle = visible; foundBy = 'fallback:visible-input'; console.log('Found input via fallback visible-input'); }
    } catch(e){}
  }

  if (!inputHandle) {
    const debugPrefix = `/tmp/xhr_extractor_${Date.now()}`;
    try { await saveArtifacts(debugPrefix, page, requests); } catch(e){}
    if (createdBrowser && browser) await browser.close().catch(()=>{});
    throw new Error('Search input not found on page');
  }

  // focus + clear
  try { inputHandle.focus && await inputHandle.focus(); } catch(e){}
  try { await (page.evaluate ? page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle).catch(()=>{}) : Promise.resolve()); } catch(e){}

  console.log('Typing address into input (foundBy:', foundBy, ')');

  // type (use element type if available)
  try {
    // prefer element typing if supported
    if (typeof inputHandle.type === 'function') {
      await inputHandle.click && inputHandle.click({ clickCount: 3 }).catch(()=>{});
      await inputHandle.type(address, { delay: 60 });
    } else {
      await page.keyboard && page.keyboard.type(address, { delay: 60 });
    }
  } catch(e){
    try { await page.keyboard && page.keyboard.type(address, { delay: 60 }); } catch(e){}
  }

  // small wait for suggestions
  await delay(1200);

  // check suggestion selectors
  let suggestionsVisible = false;
  try {
    suggestionsVisible = await (page.evaluate ? page.evaluate(() => !!document.querySelector('[role="listbox"], .suggestions, .autocomplete, .pac-container')) : false);
  } catch(e){}

  if (suggestionsVisible) {
    try {
      // attempt click first suggestion
      await (page.click ? page.click('[role="listbox"] [role="option"], .suggestions li, .autocomplete li, .pac-container .pac-item').catch(()=>{}) : Promise.resolve());
      await delay(600);
    } catch(e){
      try { await page.keyboard && page.keyboard.press('Enter'); } catch(e){}
    }
  } else {
    // fire synthetic keyboard events (some sites react to keydown/keyup more reliably in headless)
    try {
      await page.evaluate(() => {
        const el = document.querySelector('#root input') || document.querySelector('input');
        if (!el) return;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
      });
    } catch(e){}
    try { await page.keyboard && page.keyboard.press('Enter'); } catch(e) {}
  }

  // wait for geocoding responses and other XHRs
  await delay(1500);

  // If we captured a geocoding center, log it and try to click near marker:
  if (geocodingMatches.length) {
    console.log('Geocoding results captured:', geocodingMatches[0]);
    // attempt to synthesize a click on map center (map often centers on selection)
    try {
      // evaluate in page to convert latlng->pixel if mapbox map present
      const clicked = await page.evaluate((center) => {
        try {
          // attempt common globals
          const lat = center[1];
          const lng = center[0];
          if (window.map && typeof window.map.project === 'function') {
            // mapbox-gl: project returns Point in pixel coordinates
            const p = window.map.project([lng, lat]);
            const canvas = document.querySelector('.mapboxgl-canvas') || document.querySelector('canvas');
            if (canvas) {
              const rect = canvas.getBoundingClientRect();
              const x = rect.left + p.x;
              const y = rect.top + p.y;
              // dispatch pointer event at that location
              const ev = new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y });
              canvas.dispatchEvent(ev);
              const ev2 = new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y });
              canvas.dispatchEvent(ev2);
              return { dispatched: true, x, y };
            }
          }
          return { dispatched: false };
        } catch(e) {
          return { dispatched: false, err: String(e) };
        }
      }, geocodingMatches[0].center).catch(()=>({dispatched:false}));
      console.log('Attempted map click at geocode center:', clicked);
    } catch(e){}
  }

  // Wait again for any square requests after synthetic click
  await delay(1000);

  // If still none, perform map clicking fallback (center + offsets + random)
  if (matched.size === 0) {
    try {
      console.log('No matched XHRs yet. Attempting map-click fallback...');
      const mapElem = (page.$ ? await page.$('div.leaflet-container') : null) || (page.$ ? await page.$('div.mapboxgl-canvas') : null) || (page.$ ? await page.$('canvas') : null) || (page.$ ? await page.$('#root') : null);
      if (mapElem) {
        const box = await (mapElem.boundingBox ? mapElem.boundingBox() : null);
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          // expanded offsets + random jitter
          const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0],[50,0],[-50,0],[0,50],[0,-50]];
          for (const [dx,dy] of offsets) {
            try {
              // page.mouse click
              if (page.mouse) { await page.mouse.click(cx + dx, cy + dy); }
              // also fire DOM pointer events at pixel coordinates (safer for some frameworks)
              await page.evaluate((x,y) => {
                try {
                  const el = document.elementFromPoint(x - window.scrollX, y - window.scrollY) || document.querySelector('canvas') || document.querySelector('#root');
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  const clientX = x - rect.left;
                  const clientY = y - rect.top;
                  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: clientX + rect.left, clientY: clientY + rect.top }));
                  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: clientX + rect.left, clientY: clientY + rect.top }));
                } catch(e){}
              }, cx + dx, cy + dy).catch(()=>{});
              await delay(800);
            } catch(e){}
            if (matched.size) break;
          }
        } else {
          console.log('Map element found but no boundingBox');
        }
      } else {
        console.log('No map element found to click.');
      }
    } catch (e) {
      console.log('Map-click fallback error', e && e.message ? e.message : e);
    }
  }

  // Final short wait
  await delay(700);

  // cleanup listeners if needed (we attached anonymously handlers)
  // results
  const result = Array.from(matched);
  console.log('findSquare result count:', result.length);

  // Save artifacts always for later debugging (helps with Render parity investigations)
  try {
    const debugPrefix = `/tmp/xhr_extractor_${Date.now()}`;
    await saveArtifacts(debugPrefix, page, requests);
  } catch(e){}

  if (createdBrowser && browser) {
    try { await browser.close(); } catch(e) {}
  }

  return result;
}

module.exports = { findSquare };

// standalone runner
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ') || '316 E Okanogan Ave, Chelan Washington 98816';
    console.log('Standalone test mode. Address:', address);

    let browser = null;
    try {
      const forceHeadful = !!(process.env.RENDER_HEADFUL && process.env.RENDER_HEADFUL !== 'false' && process.env.RENDER_HEADFUL !== '0');
      browser = await puppeteer.launch({
        headless: forceHeadful ? false : false, // keep false in standalone for parity with earlier local runs
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
