// server.js
const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API Ready' });
});

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  try {
    const urls = await findSquare(address);
    res.json({ status: 'success', xhrUrls: urls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
