// server.js
const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json());

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }

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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
