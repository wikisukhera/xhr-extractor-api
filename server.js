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

// Copy Chrome on cold start
const BUILD_CHROME = '/vercel/.cache/puppeteer/chrome/linux-142.0.7444.59/chrome-linux64/chrome';
const RUNTIME_CHROME = '/tmp/chrome';
const RUNTIME_DIR = '/tmp';

if (!fs.existsSync(RUNTIME_CHROME)) {
  console.log('Copying Chrome to /tmp...');
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.copyFileSync(BUILD_CHROME, RUNTIME_CHROME);
  fs.chmodSync(RUNTIME_CHROME, 0o755);
  console.log('Chrome ready at /tmp/chrome');
}

// API
app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  try {
    const xhrUrls = await findSquare(address);
    res.json({
      address,
      status: 'success',
      xhrUrls,
      total: xhrUrls.length
    });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
