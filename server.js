const express = require('express');
const { findSquare } = require('./find_square_local');

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'XHR Extractor API Ready',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Main extraction endpoint
app.post('/extract-xhr', async (req, res) => {
  const { address } = req.body;
  
  if (!address) {
    return res.status(400).json({ 
      error: 'Address required',
      example: { address: '316 E Okanogan Ave, Chelan Washington 98816' }
    });
  }

  console.log('Processing request for address:', address);

  try {
    const urls = await findSquare(address);
    
    res.json({ 
      status: 'success', 
      address: address,
      xhrUrls: urls,
      count: urls.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('extract-xhr error:', err.stack || err);
    
    res.status(500).json({ 
      status: 'error',
      error: err.message || 'Unknown error occurred',
      timestamp: new Date().toISOString()
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`XHR Extractor API running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Better crash logs
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});
