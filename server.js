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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Running on port ${port}`));
