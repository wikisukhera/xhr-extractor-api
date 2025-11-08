// find_square.js
// Works locally AND on Render (with Browserless fallback)
// usage: node find_square.js "<address_or_coords>"
// Example: node find_square.js "316 E Okanogan Ave, Chelan Washington 98816"

const puppeteer = require('puppeteer');
const puppeteerCore = require('puppeteer-core');
const fs = require('fs');

async function findSquare(address) {
  let browser;
  let usingBrowserless = false;

  // Try Browserless first if API key is available
  if (process.env.BROWSERLESS_API_KEY) {
    try {
      console.log('Attempting to connect to Browserless...');
      const endpoint = `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`;
      browser = await puppeteerCore.connect({ 
        browserWSEndpoint: endpoint 
      });
      usingBrowserless = true;
      console.log('Connected to Browserless successfully');
    } catch (e) {
      console.log('Browserless connection failed:', e.message);
      console.log('Falling back to local Chrome...');
    }
  }

  // Fall back to local Chrome if Browserless not available or failed
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Try software rendering for WebGL
        '--disable-gpu',
        '--use-gl=swiftshader',
        '--enable-webgl',
        '--enable-unsafe-swiftshader'
      ],
      defaultViewport: { width: 1280, height: 800 },
    });
    console.log('Using local Chrome');
  }

  const page = await browser.newPage();

  // capture matching XHRs
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    const url = req.url();
    if (pattern.test(url)) {
      matched.add(url);
      console.log(`Matched request: ${url}`);
    }
  });
  
  page.on('response', async resp => {
    try {
      const url = resp.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log(`Matched response: ${url}`);
      }
    } catch(e) {}
  });

  await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 60000 });

  // dismiss popup if present
  try {
    await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
    await page.click('svg.lucide-x');
    await new Promise(r => setTimeout(r, 600));
  } catch(e){ /* no popup */ }

  // find input - try common selectors
  const selectors = [
    '//*[@id="root"]//input[contains(@placeholder,"address") or contains(@placeholder,"Address") or contains(@placeholder,"location") or contains(@placeholder,"search")]',
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
    } catch(e){}
  }
  
  if (!inputHandle) {
    if (usingBrowserless) {
      await browser.disconnect();
    } else {
      await browser.close();
    }
    throw new Error('Search input not found');
  }

  // Focus and robustly type
  await inputHandle.focus();
  await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle);

  console.log('Typing address...');
  for (const ch of address) {
    await inputHandle.type(ch, { delay: 80 });
  }

  await new Promise(r => setTimeout(r, 1200));

  // check if suggestion list exists
  let suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
  console.log(`Suggestions visible: ${suggestionsVisible}`);
  
  if (!suggestionsVisible) {
    // backspace+left trick
    for (const n of [1,2]) {
      for (let i=0;i<n;i++) {
        try {
          await inputHandle.press('Backspace');
          await new Promise(r => setTimeout(r, 80));
        } catch(e) {}
      }
      for (let i=0;i<n;i++) {
        try {
          await inputHandle.press('ArrowLeft');
          await new Promise(r => setTimeout(r, 80));
        } catch(e) {}
      }
      await page.evaluate(el => el.dispatchEvent(new Event('input', { bubbles: true })), inputHandle);
      await new Promise(r => setTimeout(r, 900));
      suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
      console.log(`Suggestions after trick (${n} chars): ${suggestionsVisible}`);
      if (suggestionsVisible) break;
    }
  }

  // Click suggestion or press Enter
  if (suggestionsVisible) {
    try {
      console.log('Clicking first suggestion...');
      await page.click('[role="listbox"] [role="option"]');
      await new Promise(r => setTimeout(r, 600));
    } catch(e){}
  } else {
    console.log('No suggestions, pressing Enter...');
    await inputHandle.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
  }

  await new Promise(r => setTimeout(r, 800));
  console.log('Current matched count:', matched.size);

  // Click map if no matches
  if (matched.size === 0) {
    console.log('No matches yet, clicking map...');
    let mapElem = await page.$('div.leaflet-container') || 
                  await page.$('div.mapboxgl-canvas') || 
                  await page.$('canvas') || 
                  await page.$('#root');
    if (mapElem) {
      const box = await mapElem.boundingBox();
      const cx = box.x + box.width/2;
      const cy = box.y + box.height/2;
      const offsets = [[0,0],[10,0],[-10,0],[0,10],[0,-10],[20,0],[-20,0],[10,10],[-10,-10]];
      for (const [dx,dy] of offsets) {
        try {
          await page.mouse.click(cx+dx, cy+dy);
          console.log(`Clicked at (${dx},${dy})`);
          await new Promise(r => setTimeout(r, 800));
        } catch(e) {}
        if (matched.size) break;
      }
    }
  }

  await new Promise(r => setTimeout(r, 600));

  const result = Array.from(matched);
  
  // Proper cleanup based on connection type
  if (usingBrowserless) {
    await browser.disconnect();
  } else {
    await browser.close();
  }
  
  return result;
}

module.exports = { findSquare };

// Run if invoked directly
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ');
    if (!address) {
      console.error('Usage: node find_square.js "<address>"');
      process.exit(2);
    }
    try {
      const res = await findSquare(address);
      console.log(JSON.stringify({ xhrUrls: res }, null, 2));
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(3);
    }
  })();
}
