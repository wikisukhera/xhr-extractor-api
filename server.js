const express = require('express');
const { findSquare } = require('./find_square_local');
const app = express();

app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'XHR Extractor API running' }));

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });

  console.log('Processing:', address);
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
    console.error('Error:', err.message);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
