// server.js
const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    message: 'API Ready - Using Browserless.io',
    usage: 'POST /extract-xhr with { "address": "your address" }'
  });
});

app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  try {
    console.log('Processing request for address:', address);
    const urls = await findSquare(address);
    
    if (urls.length === 0) {
      console.log('No XHR URLs found for address:', address);
      return res.json({ 
        status: 'success', 
        xhrUrls: [], 
        message: 'No matching XHR requests found'
      });
    }

    console.log('Found XHR URLs:', urls);
    res.json({ status: 'success', xhrUrls: urls });
  } catch (err) {
    console.error('Error processing request:', err);
    res.status(500).json({ 
      error: 'Failed to extract XHR URLs', 
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
