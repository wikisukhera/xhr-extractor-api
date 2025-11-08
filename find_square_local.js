// find_square.js
// EXACT copy of working local script with ONLY headless compatibility changes
// usage: node find_square.js "<address_or_coords>"
// Example: node find_square.js "316 E Okanogan Ave, Chelan Washington 98816"

const puppeteer = require('puppeteer');
const fs = require('fs');

async function findSquare(address) {
  const browser = await puppeteer.launch({
    headless: 'new', // Modern headless mode
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Enable software rendering for WebGL (critical for Render)
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--enable-unsafe-swiftshader'
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  // capture matching XHRs
  const matched = new Set();
  const pattern = /square\?id=\d+/i; // Matches 'square?id=...' with extra params

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
  if (!inputHandle) throw new Error('Search input not found');

  // Focus and robustly type: type full address, then do the backspace+left trick if needed
  await inputHandle.focus();
  await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle);

  // natural typing
  console.log('Typing address...');
  for (const ch of address) {
    await inputHandle.type(ch, { delay: 80 }); // natural delay
  }

  // give suggestions some time
  await new Promise(r => setTimeout(r, 1200));

  // check if suggestion list exists; we look for role=listbox
  let suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
  console.log(`Suggestions visible: ${suggestionsVisible}`);
  if (!suggestionsVisible) {
    // backspace+left trick: try removing 1 and 2 chars
    for (const n of [1,2]) {
      for (let i=0;i<n;i++) {
        try {
          await inputHandle.press('Backspace');
          await new Promise(r => setTimeout(r, 80));
        } catch(e) {
          console.log('Backspace failed, skipping...');
        }
      }
      for (let i=0;i<n;i++) {
        try {
          await inputHandle.press('ArrowLeft');
          await new Promise(r => setTimeout(r, 80));
        } catch(e) {
          console.log('ArrowLeft failed, skipping...');
        }
      }
      // dispatch input event
      await page.evaluate(el => el.dispatchEvent(new Event('input', { bubbles: true })), inputHandle);
      await new Promise(r => setTimeout(r, 900));
      suggestionsVisible = await page.evaluate(() => !!document.querySelector('[role="listbox"]'));
      console.log(`Suggestions after trick (${n} chars): ${suggestionsVisible}`);
      if (suggestionsVisible) break;
    }
  }

  // If suggestions visible, try to click the first option
  if (suggestionsVisible) {
    try {
      console.log('Clicking first suggestion...');
      await page.click('[role="listbox"] [role="option"]');
      await new Promise(r => setTimeout(r, 600));
      console.log('Clicked suggestion, waiting for XHR...');
    } catch(e){
      console.log('Failed to click suggestion:', e.message);
    }
  } else {
    // press Enter anyway (some flows use Enter)
    console.log('No suggestions, pressing Enter...');
    await inputHandle.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
  }

  // Wait briefly for network events triggered by selection/enter
  await new Promise(r => setTimeout(r, 800));
  console.log('Current matched count:', matched.size);

  // check matched set
  if (matched.size === 0) {
    // Click near the map center at multiple offsets to trigger pin XHRs
    console.log('No matches yet, clicking map...');
    let mapElem = await page.$('div.leaflet-container') || await page.$('div.mapboxgl-canvas') || await page.$('canvas') || await page.$('#root');
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
        } catch(e) {
          console.log('Click failed, skipping...');
        }
        if (matched.size) break;
      }
    }
  }

  // final wait for any last XHRs
  await new Promise(r => setTimeout(r, 600));

  const result = Array.from(matched);
  await browser.close();
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
