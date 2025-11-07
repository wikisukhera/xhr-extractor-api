// --- robust /extract-xhr handler ---
const express = require('express');
const bodyParser = require('body-parser');
const { findSquare } = require('./find_square_local');

const app = express();
// keep bodyParser.json but set a limit
app.use(bodyParser.json({ limit: '200kb' }));
app.use(bodyParser.text({ type: 'text/*', limit: '200kb' }));

app.post('/extract-xhr', async (req, res) => {
  // Log raw body to help debug malformed JSON clients
  try {
    console.log('Raw request body (first 2000 chars):', String(req.body).slice(0, 2000));
  } catch (e) {}

  // Determine input shape in a tolerant way
  let address = null;
  let lat = null, lng = null;

  // If JSON parsed successfully and has expected fields
  if (req.body && typeof req.body === 'object') {
    if (req.body.address) {
      address = String(req.body.address).trim();
    } else if (typeof req.body.lat !== 'undefined' && typeof req.body.lng !== 'undefined') {
      lat = Number(req.body.lat);
      lng = Number(req.body.lng);
    }
  } else if (typeof req.body === 'string') {
    // body was a JSON string or raw text, try to detect patterns
    const s = req.body.trim();

    // If the body is a quoted JSON string, try to parse again safely
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      try {
        const unquoted = JSON.parse(s);
        if (typeof unquoted === 'string') {
          // treat it as an address or lat/lng text
          if (/Lat\s*[:=]/i.test(unquoted) && /Lng\s*[:=]/i.test(unquoted)) {
            const m = unquoted.match(/([+-]?\d+(\.\d+)?)/g);
            if (m && m.length >= 2) { lat = Number(m[0]); lng = Number(m[1]); }
          } else {
            address = unquoted;
          }
        }
      } catch (e) {
        // fall-through: try next heuristics
      }
    }

    // If still a plain string like: Lat: 37.77479 Lng: -122.43674
    if (!address && (lat === null || lng === null)) {
      const latMatch = s.match(/Lat\s*[:=]?\s*([+-]?\d+(\.\d+)?)/i);
      const lngMatch = s.match(/Lng\s*[:=]?\s*([+-]?\d+(\.\d+)?)/i);
      if (latMatch && lngMatch) {
        lat = Number(latMatch[1]);
        lng = Number(lngMatch[1]);
      } else {
        // fallback: treat the entire string as an address
        address = s;
      }
    }
  }

  if (!address && (lat === null || lng === null)) {
    return res.status(400).json({ status: 'error', error: 'Please provide an address or lat & lng (valid JSON).' });
  }

  // Build the search input for findSquare
  let searchInput = address;
  if (!searchInput) searchInput = `Lat: ${lat} Lng: ${lng}`;

  console.log('Processing request for address:', searchInput);

  try {
    // If your server maintains a browser/page reuse pattern, pass (page, searchInput) accordingly.
    // Here we call findSquare(searchInput) which is compatible with the patched find_square_local.js
    const xhrUrls = await findSquare(searchInput);

    // Ensure xhrUrls is an array
    const arr = Array.isArray(xhrUrls) ? xhrUrls : (xhrUrls ? Object.values(xhrUrls) : []);

    res.json({
      status: 'success',
      address: searchInput,
      xhrUrls: arr,
      count: arr.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('extract-xhr error:', err && err.stack ? err.stack : err);
    res.status(500).json({ status: 'error', error: String(err && err.message ? err.message : err) });
  }
});
