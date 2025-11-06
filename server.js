// server.js
const express = require('express');
const { findSquare } = require('./find_square_local');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'XHR Extractor API is running!' });
});

// Copy Chrome from build cache to /tmp on cold start
const CHROME_BUILD_PATH = '/vercel/.cache/puppeteer/chrome/linux-142.0.7444.59/chrome-linux64/chrome';
const CHROME_RUNTIME_PATH = '/tmp/chrome-linux/chrome';
const CHROME_DIR = '/tmp/chrome-linux';

if (!fs.existsSync(CHROME_RUNTIME_PATH)) {
  console.log('Copying Chrome to /tmp...');
  fs.mkdirSync(CHROME_DIR, { recursive: true });
  fs.copyFileSync(CHROME_BUILD_PATH, CHROME_RUNTIME_PATH);
  fs.chmodSync(CHROME_RUNTIME_PATH, '755');
  console.log('Chrome copied to /tmp');
}

// API endpoint
app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address is required' });

  try {
    const xhrUrls = await findSquare(address);
    res.json({
      address,
      status: 'success',
      xhrUrls,
      total: xhrUrls.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Puppeteer error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
