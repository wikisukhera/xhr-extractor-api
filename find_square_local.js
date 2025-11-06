// find_square_local.js
const axios = require('axios');
const { 2TMV2diwGKn97trf65f0a7dc42431aa312807cb34e470dd7b } = process.env;

if (!BROWSERLESS_API_KEY) {
  throw new Error('BROWSERLESS_API_KEY environment variable is required');
}

const BROWSERLESS_URL = `https://chrome.browserless.io/content?token=${BROWSERLESS_API_KEY}`;

async function findSquare(address) {
  try {
    const response = await axios.post(BROWSERLESS_URL, {
      code: `
        // This code runs inside Browserless.io's browser environment
        const page = window.page;
        const matched = new Set();
        const pattern = /square\\?id=\\d+/i;

        page.on('request', req => {
          if (pattern.test(req.url())) {
            matched.add(req.url());
            console.log('Matched request:', req.url());
          }
        });

        await page.goto('https://map.coveragemap.com/', { 
          waitUntil: 'networkidle2', 
          timeout: 60000 
        });

        // Dismiss popup if present
        try {
          await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
          await page.click('svg.lucide-x');
          await new Promise(r => setTimeout(r, 600));
        } catch (e) {
          console.log('No popup found');
        }

        // Find search input
        const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
        if (!input) throw new Error('Search input not found');

        await input.click({ clickCount: 3 });
        await input.press('Backspace');
        await input.type('${address.replace(/'/g, "\\'")}', { delay: 80 });

        await new Promise(r => setTimeout(r, 1500));

        // Handle suggestions or press Enter
        const listbox = await page.$('[role="listbox"]');
        if (listbox) {
          await page.click('[role="listbox"] [role="option"]');
        } else {
          await input.press('Enter');
        }

        await new Promise(r => setTimeout(r, 1000));

        // If no matches, click on map
        if (matched.size === 0) {
          const map = await page.$('canvas, .leaflet-container');
          if (map) {
            const box = await map.boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await new Promise(r => setTimeout(r, 800));
          }
        }

        await new Promise(r => setTimeout(r, 600));
        
        // Return the matched URLs
        return Array.from(matched);
      `,
      context: {},
      options: {
        timeout: 60000,
        viewport: {
          width: 1280,
          height: 800
        },
        headless: true
      }
    }, {
      timeout: 65000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Process the response
    if (response.data && response.data.value) {
      return response.data.value;
    } else {
      console.error('Unexpected Browserless response:', response.data);
      return [];
    }

  } catch (error) {
    console.error('Browserless API error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message);
  }
}

module.exports = { findSquare };
