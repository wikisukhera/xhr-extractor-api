const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ message: 'API Ready' }));

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  try {
    const urls = await findSquare(address);
    res.json({ status: 'success', xhrUrls: urls });
  } catch (err) {
    console.error('extract-xhr error:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running on port ${port}`));

// Better crash logs
process.on('uncaughtException', err => {
  console.error('uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (r) => {
  console.error('unhandledRejection', r);
});
