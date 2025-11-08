// find_square_local.js
// Proven working version - combines best of local and online approaches
const puppeteer = require('puppeteer');
const fs = require('fs');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findSquare(address) {
  if (!address) {
    throw new Error('address parameter is required');
  }

  console.log('Launching browser for address:', address);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
      '--no-zygote'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();

  // Set user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  // Basic stealth
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  // Track XHR requests
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    try {
      const url = req.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[MATCHED REQUEST]', url);
      }
    } catch (e) {}
  });

  page.on('response', async resp => {
    try {
      const url = resp.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[MATCHED RESPONSE]', url);
      }
    } catch (e) {}
  });

  // Navigate
  console.log('Navigating to map...');
  await page.goto('https://map.coveragemap.com/', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  await delay(1500);

  // Dismiss popup
  try {
    await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
    await page.click('svg.lucide-x');
    await delay(600);
  } catch (e) {}

  // Find input
  const selectors = [
    '//*[@id="root"]//input[contains(@placeholder,"address") or contains(@placeholder,"Address")]',
    'input[placeholder*="address"]',
    'input[placeholder*="Address"]',
    'input[type="search"]',
    '#root input',
    'input'
  ];

  let inputHandle = null;
  for (const sel of selectors) {
    try {
      if (sel.startsWith('//')) {
        const [el] = await page.$x(sel);
        if (el) {
          inputHandle = el;
          console.log('Found input via XPath');
          break;
        }
      } else {
        const el = await page.$(sel);
        if (el) {
          inputHandle = el;
          console.log('Found input via CSS:', sel);
          break;
        }
      }
    } catch (e) {}
  }

  if (!inputHandle) {
    await browser.close();
    throw new Error('Search input not found on page');
  }

  // Focus and clear
  await inputHandle.focus();
  await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle);

  console.log('Typing address...');
  
  // Type character by character (this is proven to work)
  for (const ch of address) {
    await inputHandle.type(ch, { delay: 80 });
  }

  await delay(1200);

  // Check for suggestions
  let suggestionsVisible = await page.evaluate(() =>
    !!document.querySelector('[role="listbox"]')
  );
  console.log('Suggestions visible:', suggestionsVisible);

  // THIS IS THE KEY PART - backspace trick that makes it work
  if (!suggestionsVisible) {
    console.log('Trying backspace trick...');
    for (const n of [1, 2]) {
      // Backspace n characters
      for (let i = 0; i < n; i++) {
        await inputHandle.press('Backspace');
        await delay(80);
      }
      // Move cursor left
      for (let i = 0; i < n; i++) {
        await inputHandle.press('ArrowLeft');
        await delay(80);
      }
      // Trigger input event
      await page.evaluate(el =>
        el.dispatchEvent(new Event('input', { bubbles: true })),
        inputHandle
      );
      await delay(900);

      suggestionsVisible = await page.evaluate(() =>
        !!document.querySelector('[role="listbox"]')
      );
      console.log(`Suggestions after trick (${n} chars):`, suggestionsVisible);
      if (suggestionsVisible) break;
    }
  }

  // Click suggestion or press Enter
  if (suggestionsVisible) {
    try {
      await page.click('[role="listbox"] [role="option"]');
      console.log('Clicked first suggestion');
      await delay(600);
    } catch (e) {
      await inputHandle.press('Enter');
      await delay(1000);
    }
  } else {
    await inputHandle.press('Enter');
    await delay(1000);
  }

  // Wait for XHR
  await delay(800);

  // If no matches, click the map
  if (matched.size === 0) {
    console.log('No matches yet, clicking map...');
    
    const mapElem = await page.$('div.leaflet-container') ||
                     await page.$('div.mapboxgl-canvas') ||
                     await page.$('canvas') ||
                     await page.$('#root');

    if (mapElem) {
      const box = await mapElem.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Click at various offsets
        const offsets = [
          [0, 0], [10, 0], [-10, 0], [0, 10], [0, -10],
          [20, 0], [-20, 0], [10, 10], [-10, -10]
        ];

        for (const [dx, dy] of offsets) {
          try {
            await page.mouse.click(cx + dx, cy + dy);
            console.log(`Clicked at offset (${dx}, ${dy})`);
            await delay(800);
            if (matched.size) break;
          } catch (e) {}
        }
      }
    }
  }

  // Final wait
  await delay(600);

  const result = Array.from(matched);
  console.log('Found', result.length, 'matching URLs');

  await browser.close();
  return result;
}

module.exports = { findSquare };

// Standalone mode
if (require.main === module) {
  (async () => {
    const address = process.argv.slice(2).join(' ');
    if (!address) {
      console.error('Usage: node find_square_local.js "<address>"');
      process.exit(1);
    }

    try {
      const results = await findSquare(address);
      console.log(JSON.stringify({ xhrUrls: results }, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}
