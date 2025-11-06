const puppeteer = require('puppeteer');

async function findSquare(address) {
  const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/chromium-browser',  // Render has this built-in
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-zygote',
    '--single-process'
  ]
});
  
  const page = await browser.newPage();
  const matched = new Set();
  const pattern = /square\?id=\d+/i;

  page.on('request', req => {
    if (pattern.test(req.url())) matched.add(req.url());
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

  const listbox = await page.$('[role="listbox"]');
  if (listbox) {
    await page.click('[role="listbox"] [role="option"]');
  } else {
    await input.press('Enter');
  }

  await new Promise(r => setTimeout(r, 1000));

  if (matched.size === 0) {
    const map = await page.$('canvas, .leaflet-container');
    if (map) {
      const box = await map.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise(r => setTimeout(r, 800));
    }
  }

  await new Promise(r => setTimeout(r, 600));
  const result = Array.from(matched);
  await browser.close();
  return result;
}

module.exports = { findSquare };
