// server.js - robust entrypoint for Render
const express = require('express');
const bodyParser = require('body-parser');
const { findSquare } = require('./find_square_local');

// Global error handlers so crashes produce logs we can read
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION -', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});

async function createServer() {
  const app = express();

  // Parse JSON and plain text bodies (keeps tolerant)
  app.use(bodyParser.json({ limit: '200kb' }));
  app.use(bodyParser.text({ type: 'text/*', limit: '200kb' }));

  app.get('/', (req, res) => res.send('XHR Extractor API is running'));

  // Robust /extract-xhr handler (tolerant input parsing)
  app.post('/extract-xhr', async (req, res) => {
    try {
      // Log raw body for debugging (trim to avoid huge logs)
      try { console.log('Raw body (first 2000 chars):', String(req.body).slice(0, 2000)); } catch (e) {}

      let address = null;
      let lat = null, lng = null;

      if (req.body && typeof req.body === 'object') {
        if (req.body.address) {
          address = String(req.body.address).trim();
        } else if (typeof req.body.lat !== 'undefined' && typeof req.body.lng !== 'undefined') {
          lat = Number(req.body.lat);
          lng = Number(req.body.lng);
        }
      } else if (typeof req.body === 'string') {
        const s = req.body.trim();
        // Try parse if body is a JSON string
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
          try {
            const unq = JSON.parse(s);
            if (typeof unq === 'string') {
              if (/Lat\s*[:=]/i.test(unq) && /Lng\s*[:=]/i.test(unq)) {
                const m = unq.match(/([+-]?\d+(\.\d+)?)/g);
                if (m && m.length >= 2) { lat = Number(m[0]); lng = Number(m[1]); }
              } else {
                address = unq;
              }
            }
          } catch (e) {
            // ignore parse error, continue with heuristics
          }
        }

        if (!address && (lat === null || lng === null)) {
          const latMatch = s.match(/Lat\s*[:=]?\s*([+-]?\d+(\.\d+)?)/i);
          const lngMatch = s.match(/Lng\s*[:=]?\s*([+-]?\d+(\.\d+)?)/i);
          if (latMatch && lngMatch) {
            lat = Number(latMatch[1]);
            lng = Number(lngMatch[1]);
          } else {
            // fallback treat as address
            address = s;
          }
        }
      }

      if (!address && (lat === null || lng === null)) {
        return res.status(400).json({ status: 'error', error: 'Please provide an address or lat & lng (valid JSON).' });
      }

      const searchInput = address || `Lat: ${lat} Lng: ${lng}`;
      console.log('Processing request for address:', searchInput);

      // Call findSquare. The helper supports either (page,address) or (address)
      const xhrUrls = await findSquare(searchInput);

      const arr = Array.isArray(xhrUrls) ? xhrUrls : (xhrUrls ? Object.values(xhrUrls) : []);
      return res.json({
        status: 'success',
        address: searchInput,
        xhrUrls: arr,
        count: arr.length,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('extract-xhr error:', err && err.stack ? err.stack : err);
      // Attempt to return a helpful error to client
      return res.status(500).json({ status: 'error', error: String(err && err.message ? err.message : err) });
    }
  });

  // Start server
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, () => {
    console.log(`XHR Extractor API running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
  });

  return app;
}

// Start up and catch any synchronous startup errors
try {
  createServer().catch(err => {
    console.error('Failed to start server:', err && err.stack ? err.stack : err);
    // don't throw further; Render will mark deploy failed but we logged the reason
  });
} catch (e) {
  console.error('Critical startup error:', e && e.stack ? e.stack : e);
}
