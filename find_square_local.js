/**
 * find_square_local.js
 *
 * Robust instrumented helper for map.coveragemap.com
 *
 * - Flexible signature:
 *    await findSquare(page, address)
 *    await findSquare(address)  // launches/closes its own browser
 *
 * - Logs page console and JS errors
 * - Logs every request/response (HAR-like) and saves to /tmp
 * - Saves HTML + PNG debug artifacts
 * - Returns array of matched XHR URLs (deduplicated)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// delay helper (works regardless of Puppeteer version)
const delay = ms => new Promise(res => setTimeout(res, ms));

// default request match regex (can be broadened later)
const DEFAULT_PATTERN = /square\?id=\d+/i;

async function findSquare(arg1, arg2, opts = {}) {
  // opts:
  //   pattern - RegExp to match XHR URLs (defaults to DEFAULT_PATTERN)
  //   debugPathPrefix - custom prefix for /tmp debug files
  const pattern = opts.pattern || DEFAULT_PATTERN;
  const debugPrefixBase = opts.debugPathPrefix || `/tmp/xhr_extractor_${Date.now()}`;

  let page = null;
  let browser = null;
  let address = null;
  let createdBrowser = false;

  // flexible args: (address) OR (page, address)
  if (!arg1 && !arg2) throw new Error('address argument is required');
  if (typeof arg1 === 'string' && (typeof arg2 === 'undefined' || arg2 === null)) {
    address = arg1;
    // launch browser
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

  // Try to set timeouts safely if available
  try { page.setDefaultNavigationTimeout && page.setDefaultNavigationTimeout(60000); } catch(e) {}
  try { page.setDefaultTimeout && page.setDefaultTimeout(60000); } catch(e) {}

  // Try stealth-like settings (best-effort)
  try {
    await (page.setUserAgent ? page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36') : Promise.resolve());
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
  } catch (e) {
    console.warn('Warning setting UA/stealth props:', e && e.message ? e.message : e);
  }

  // HAR-like collection
  const requests = []; // {type, method, url, status, ts}
  const seenRequests = new Set();

  // Network listeners
  if (page.on) {
    page.on('request', req => {
      try {
        const entry = { type: 'request', method: req.method(), url: req.url(), ts: Date.now() };
        requests.push(entry);
        console.log('[REQ] ', req.method(), req.url());
      } catch (e) {}
    });

    page.on('requestfinished', async req => {
      try {
        const resp = await req.response();
        const entry = { type: 'requestfinished', url: req.url(), status: resp ? resp.status() : null, ts: Date.now() };
        requests.push(entry);
        console.log('[REQFIN] ', req.method(), req.url(), 'status:', resp ? resp.status() : 'no-response');
      } catch (e) {
        console.log('[REQFIN] error', e && e.message ? e.message : e);
      }
    });

    page.on('response', async resp => {
      try {
        const entry = { type: 'response', url: resp.url(), status: resp.status(), ts: Date.now() };
        requests.push(entry);
        console.log('[RESP] ', resp.status(), resp.url());
      } catch (e) {}
    });

    // Page console & errors
    page.on('console', async msg => {
      try {
        // serialize args carefully
        const args = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => a.toString())));
        console.log('PAGE CONSOLE', msg.type(), ...args);
      } catch (e) {
        try { console.log('PAGE CONSOLE', msg.type(), msg.text()); } catch(_) {}
      }
    });

    page.on('pageerror', err => {
      console.error('PAGE ERROR:', err && err.stack ? err.stack : err);
    });
  }

  // Also track any matched pattern opportunistically
  const matchedUrls = new Set();

  // Extra listener to catch matching URLs early
  if (page.on) {
    page.on('request', req => {
      try {
        const url = req.url();
        if (pattern.test(url)) {
          matchedUrls.add(url);
          console.log('[pattern-match] request', url);
        }
      } catch (e) {}
    });
    page.on('response', resp => {
      try {
        const url = resp.url();
        if (pattern.test(url)) {
          matchedUrls.add(url);
          console.log('[pattern-match] response', url);
        }
      } catch (e) {}
    });
  }

  // Navigate
  console.log('Navigating to map.coveragemap.com ...');
  try {
    await page.goto('https://map.coveragemap.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {
      console.warn('Navigation (domcontentloaded) warning — continuing:', e && e.message ? e.message : e);
    });
  } catch (e) {
    console.warn('Navigation caught error — continuing:', e && e.message ? e.message : e);
  }

  // Give inline scripts a moment
  await delay(1500);

  // Log frames and workers
  try {
    const frames = page.frames ? page.frames() : [];
    console.log('Frames count:', frames.length);
    frames.forEach((f,i) => { try { console.log(` frame[${i}] url: ${f.url()}`); } catch(e){} });
  } catch (e) {}

  try {
    const workerInfo = await (page.evaluate ? page.evaluate(() => {
      return { hasServiceWorker: !!navigator.serviceWorker, hw: navigator.hardwareConcurrency || null };
    }) : Promise.resolve({})).catch(()=>({}));
    console.log('Worker info:', workerInfo);
  } catch (e) {}

  // Dismiss overlays (best-effort)
  const dismissors = ['svg.lucide-x','button[aria-label="close"]','button[aria-label="Close"]','.cookie-consent button','.cmp-close','.close','.dismiss'];
  for (const sel of dismissors) {
    try {
      await (page.evaluate ? page.evaluate(s => { const el = document.querySelector(s); if (el) try { el.click(); } catch(e){} }, sel) : Promise.resolve());
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

  // Helper: try selectors on context (page or frame)
  async function trySelectorsOnContext(context) {
    for (const sel of selectors) {
      try {
        if (sel.startsWith('//')) {
          if (context.$x) {
            const arr = await context.$x(sel);
            if (arr && arr.length) return { handle: arr[0], foundBy: `xpath:${sel}` };
          }
        } else {
          if (context.$) {
            const el = await context.$(sel);
            if (el) return { handle: el, foundBy: `css:${sel}` };
          }
        }
      } catch (e) {}
    }
    return null;
  }

  // Find input in main context
  let inputHandle = null;
  let foundBy = null;
  try {
    const r = await trySelectorsOnContext(page);
    if (r) { inputHandle = r.handle; foundBy = r.foundBy; console.log('Found input via main context:', foundBy); }
  } catch (e) {}

  // Search frames
  if (!inputHandle) {
    try {
      const frames = page.frames ? page.frames() : [];
      for (const f of frames) {
        const r = await trySelectorsOnContext(f).catch(()=>null);
        if (r) { inputHandle = r.handle; foundBy = `frame(${(f.url && f.url().slice(0,120))})::${r.foundBy}`; console.log('Found input inside frame:', foundBy); break; }
      }
    } catch (e) {}
  }

  // Fallback: any visible input
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
    } catch (e) { console.log('visible fallback err', e && e.message ? e.message : e); }
  }

  if (!inputHandle) {
    // Save debug artifacts and throw
    try {
      const html = page.content ? await page.content() : '<no content>';
      const htmlPath = `${debugPrefixBase}.noinput.html`;
      const shotPath = `${debugPrefixBase}.noinput.png`;
      const reqPath = `${debugPrefixBase}.noinput.requests.json`;
      try { fs.writeFileSync(htmlPath, html); } catch(e){}
      try { await (page.screenshot ? page.screenshot({ path: shotPath, fullPage: true }) : Promise.resolve()); } catch(e){}
      try { fs.writeFileSync(reqPath, JSON.stringify(requests.slice(-1000), null, 2)); } catch(e){}
      console.error('Search input not found. Saved artifacts:', htmlPath, shotPath, reqPath);
    } catch (err) {
      console.error('Failed saving no-input artifacts:', err && err.message ? err.message : err);
    } finally {
      if (createdBrowser && browser) await browser.close().catch(()=>{});
    }
    throw new Error('Search input not found on page');
  }

  // Interact with input
  try { inputHandle.focus && await inputHandle.focus().catch(()=>{}); } catch(e){}
  try { await (page.evaluate ? page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle).catch(()=>{}) : Promise.resolve()); } catch(e){}

  console.log('Typing address into input (foundBy:', foundBy, ')');
  try {
    if (typeof inputHandle.type === 'function') {
      await inputHandle.click && inputHandle.click({ clickCount: 3 }).catch(()=>{});
      await inputHandle.type(address, { delay: 80 });
    } else {
      await page.keyboard && page.keyboard.type(address, { delay: 80 });
    }
  } catch (e) { console.log('typing err', e && e.message ? e.message : e); }

  await delay(1200);

  // Try suggestion click
  try {
    await (page.evaluate ? page.evaluate(() => {
      const el = document.querySelector('[role="listbox"] [role="option"], .suggestions li, .autocomplete li, .pac-container .pac-item');
      if (el) try { el.click(); } catch(e) {}
    }) : Promise.resolve());
  } catch (e) {}

  await delay(1400);

  // Coax XHRs by clicking map multiple times with long waits between clicks
  try {
    const mapElem = await (page.$ ? (await page.$('div.leaflet-container') || await page.$('canvas') || await page.$('#root')) : null);
    if (mapElem) {
      const box = await (mapElem.boundingBox ? mapElem.boundingBox() : null);
      console.log('Map element bbox:', box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null);
      if (box) {
        const cx = box.x + box.width/2;
        const cy = box.y + box.height/2;
        const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0]];
        for (const [dx,dy] of offsets) {
          try {
            await page.mouse && page.mouse.click(cx+dx, cy+dy);
            console.log('Clicked at offset', dx, dy);
          } catch (e) {
            console.log('click err', e && e.message ? e.message : e);
          }
          // long wait to catch slow requests
          await delay(2000);
        }
      }
    } else {
      console.log('No map element found to click');
    }
  } catch (e) {
    console.log('Map-click stage error', e && e.message ? e.message : e);
  }

  // Final wait for any delayed requests
  await delay(4000);

  // Save final artifacts (requests + html + png)
  try {
    const html = page.content ? await page.content() : '<no content>';
    const htmlPath = `${debugPrefixBase}.final.html`;
    const shotPath = `${debugPrefixBase}.final.png`;
    const reqPath = `${debugPrefixBase}.final.requests.json`;
    try { fs.writeFileSync(htmlPath, html); } catch(e){}
    try { await (page.screenshot ? page.screenshot({ path: shotPath, fullPage: true }) : Promise.resolve()); } catch(e){}
    try { fs.writeFileSync(reqPath, JSON.stringify(requests.slice(-2000), null, 2)); } catch(e){}
    console.log('Saved final debug artifacts:', htmlPath, shotPath, reqPath);
  } catch (e) {
    console.error('Failed to save final artifacts:', e && e.message ? e.message : e);
  }

  // Build matched list from requests and matchedUrls
  try {
    for (const r of requests) {
      try {
        if (r && r.url && pattern.test(r.url)) matchedUrls.add(r.url);
      } catch (e) {}
    }
  } catch (e) {}

  const result = Array.from(matchedUrls);
  console.log('findSquare result count:', result.length);

  if (createdBrowser && browser) {
    try { await browser.close(); } catch(e) {}
  }

  return result;
}

module.exports = { findSquare };
