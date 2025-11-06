// find_square_local.js
const puppeteer = require('puppeteer-core');

const CHROME_PATH = '/vercel/.cache/puppeteer/chrome/linux-142.0.7444.59/chrome-linux64/chrome';

async function findSquare(address) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage'
    ],
    executablePath: CHROME_PATH
  });

  const page = await browser.newPage();
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    const url = req.url();
    if (pattern.test(url)) matched.add(url);
  });

  await page.goto('https://map.coveragemap.com/', { waitUntil: 'networkidle2', timeout: 30000 });

  try {
    await page.waitForSelector('svg.lucide-x', { timeout: 3000 });
    await page.click('svg.lucide-x');
    await new Promise(r => setTimeout(r, 600));
  } catch (e) {}

  const input = await page.$('input[placeholder*="address" i]') || await page.$('input');
  if (!input) throw new Error('Input not found');

  await input.click({ clickCount: 3 });
  await input.press('Backspace');
  await input.type(address, { delay: 80 });

  await new Promise(r => setTimeout(r, 1500));

  const suggestion = await page.$('[role="listbox"]');
  if (suggestion) {
    await page.click('[role="listbox"] [role="option"]');
  } else {
    await input.press('Enter');
  }

  await new Promise(r => setTimeout(r, 1000));

  if (matched.size === 0) {
    const map = await page.$('canvas, .leaflet-container');
    if (map) {
      const box = await map.boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy);
      await new Promise(r => setTimeout(r, 800));
    }
  }

  await new Promise(r => setTimeout(r, 600));
  const result = Array.from(matched);
  await browser.close();
  return result;
}

module.exports = { findSquare };
