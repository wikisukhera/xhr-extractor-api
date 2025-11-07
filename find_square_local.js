// find_square_local.js
// Optimized for Render.com - Uses local Chromium

const PUPPETEER_CORE = require('puppeteer-core');

async function connectBrowser() {
  // Try local Chromium first (primary method for Render)
  try {
    const PUPPETEER = require('puppeteer');
    console.log('Attempting to launch local Chromium...');
    
    const browser = await PUPPETEER.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--single-process',
        '--no-zygote'
      ]
    });
    
    console.log('Successfully launched local Chromium');
    return browser;
  } catch (e) {
    console.error('Failed to launch local Chromium:', e.message);
    
    // Fallback to Browserless only if explicitly configured
    if (process.env.BROWSERLESS_WS) {
      console.log('Falling back to BROWSERLESS_WS...');
      return await PUPPETEER_CORE.connect({ 
        browserWSEndpoint: process.env.BROWSERLESS_WS 
      });
    }
    
    if (process.env.BROWSERLESS_API_KEY) {
      console.log('Falling back to Browserless API...');
      const endpoint = `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`;
      return await PUPPETEER_CORE.connect({ 
        browserWSEndpoint: endpoint 
      });
    }
    
    throw new Error('Failed to launch browser. Error: ' + e.message);
  }
}

async function findSquare(address) {
  if (!address) {
    throw new Error('address parameter is required');
  }
  
  let browser;
  
  try {
    browser = await connectBrowser();
    const page = await browser.newPage();

    const matched = new Set();
    const pattern = /square\?id=\d+/i;
    
    page.on('request', req => {
      try {
        const url = req.url();
        if (pattern.test(url)) {
          matched.add(url);
        }
      } catch (e) {
        // Ignore request errors
      }
    });

    console.log('Navigating to map...');
    await page.goto('https://map.coveragemap.com/', { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });

    // Try to close any popup/modal
    try {
      await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
      await page.click('svg.lucide-x');
      await page.waitForTimeout(600);
    } catch (e) {
      // No popup to close
    }

    // Find and interact with search input
    const input = await page.$('input[placeholder*="address" i]') || 
                   await page.$('input');
    
    if (!input) {
      throw new Error('Search input not found on page');
    }

    console.log('Entering address:', address);
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await input.type(address, { delay: 80 });
    await page.waitForTimeout(1500);

    // Handle autocomplete suggestions
    const listbox = await page.$('[role="listbox"]');
    if (listbox) {
      const option = await listbox.$('[role="option"]');
      if (option) {
        await option.click();
      } else {
        await page.keyboard.press('Enter');
      }
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(1000);

    // If no XHR captured, try clicking on map
    if (matched.size === 0) {
      console.log('No XHR captured, trying map click...');
      const map = await page.$('canvas, .leaflet-container');
      if (map) {
        const box = await map.boundingBox();
        if (box) {
          await page.mouse.click(
            box.x + box.width / 2, 
            box.y + box.height / 2
          );
          await page.waitForTimeout(800);
        }
      }
    }

    await page.waitForTimeout(600);
    const result = Array.from(matched);
    
    console.log('Found', result.length, 'XHR URLs');

    // Cleanup
    try {
      if (browser && browser.disconnect) {
        browser.disconnect();
      } else if (browser) {
        await browser.close();
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    return result;
    
  } catch (err) {
    console.error('Error in findSquare:', err.message);
    
    // Ensure browser cleanup on error
    try {
      if (browser && browser.close) {
        await browser.close();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    
    throw err;
  }
}

module.exports = { findSquare };
