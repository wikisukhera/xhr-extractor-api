// server.js
const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'XHR Extractor API' });
});

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'address is required' });
  }

  console.log(`Processing: ${address}`);
  try {
    const xhrUrls = await findSquare(address);
    res.json({
      status: 'success',
      address,
      xhrUrls,
      count: xhrUrls.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Extraction failed:', err.message);
    res.status(500).json({
      status: 'error',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
