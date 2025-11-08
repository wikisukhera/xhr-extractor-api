// find_square_local.js
// Works in both local and Render environments
// Usage: node find_square_local.js "<address>"

const puppeteer = require('puppeteer');
const fs = require('fs');

function delay(ms) { 
  return new Promise(resolve => setTimeout(resolve, ms)); 
}

async function findSquare(address) {
  if (!address) {
    throw new Error('address parameter is required');
  }

  // Launch browser with minimal restrictions (allow WebGL!)
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      // DO NOT disable WebGL - the site needs it!
      '--single-process',
      '--no-zygote'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();

  // Set realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  // Basic stealth
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });

  // Track matched XHR requests
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    try {
      const url = req.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[MATCH] Request:', url);
      }
    } catch (e) {}
  });

  page.on('response', async resp => {
    try {
      const url = resp.url();
      if (pattern.test(url)) {
        matched.add(url);
        console.log('[MATCH] Response:', url);
      }
    } catch (e) {}
  });

  // Log errors for debugging
  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE CONSOLE ERROR:', msg.text());
    }
  });

  console.log('Navigating to map.coveragemap.com...');
  await page.goto('https://map.coveragemap.com/', { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });

  // Wait for page to be ready
  await delay(1500);

  // Dismiss popup if present
  try {
    await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
    await page.click('svg.lucide-x');
    await delay(600);
  } catch (e) {
    // No popup
  }

  // Find input using multiple selectors
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
          console.log('Found input via XPath:', sel);
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
    // Save debug info
    try {
      await page.screenshot({ path: '/tmp/no_input_error.png', fullPage: true });
      const html = await page.content();
      fs.writeFileSync('/tmp/no_input_error.html', html);
      console.log('Saved debug files: /tmp/no_input_error.png, /tmp/no_input_error.html');
    } catch (e) {}
    
    await browser.close();
    throw new Error('Search input not found on page');
  }

  // Focus and clear input
  await inputHandle.focus();
  await page.evaluate(el => { el.value = ''; el.focus(); }, inputHandle);

  console.log('Typing address:', address);
  
  // Type address character by character
  for (const ch of address) {
    await inputHandle.type(ch, { delay: 80 });
  }

  // Wait for suggestions
  await delay(1200);

  // Check if suggestions appeared
  let suggestionsVisible = await page.evaluate(() => 
    !!document.querySelector('[role="listbox"]')
  );

  console.log('Suggestions visible:', suggestionsVisible);

  // Try backspace trick if no suggestions
  if (!suggestionsVisible) {
    for (const n of [1, 2]) {
      // Backspace
      for (let i = 0; i < n; i++) {
        await inputHandle.press('Backspace');
        await delay(80);
      }
      // Arrow left
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
      await delay(600);
    } catch (e) {
      await inputHandle.press('Enter');
      await delay(1000);
    }
  } else {
    await inputHandle.press('Enter');
    await delay(1000);
  }

  // Wait for network activity
  await delay(800);

  // If no matches, try clicking the map
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
