# XHR Extractor API

Extract XHR URLs from map interactions using Puppeteer on Render.com

## Deployment to Render.com

### Step 1: Push to GitHub
Make sure all files are committed and pushed to your GitHub repository.

### Step 2: Connect to Render
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Render will auto-detect the `render.yaml` configuration

### Step 3: Configure (Optional)
The `render.yaml` file handles all configuration. No manual environment variables needed unless you want to use Browserless as a fallback.

### Step 4: Deploy
Click **Create Web Service** and wait for deployment to complete.

## API Usage

### Health Check
```bash
curl https://your-app.onrender.com/
```

### Extract XHR URLs
```bash
curl -X POST https://your-app.onrender.com/extract-xhr \
  -H "Content-Type: application/json" \
  -d '{"address": "316 E Okanogan Ave, Chelan Washington 98816"}'
```

**PowerShell:**
```powershell
Invoke-RestMethod -Uri https://your-app.onrender.com/extract-xhr `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"address": "316 E Okanogan Ave, Chelan Washington 98816"}'
```

## Response Format

**Success:**
```json
{
  "status": "success",
  "address": "316 E Okanogan Ave, Chelan Washington 98816",
  "xhrUrls": [
    "https://map.coveragemap.com/api/square?id=12345"
  ],
  "count": 1,
  "timestamp": "2025-11-07T10:30:00.000Z"
}
```

**Error:**
```json
{
  "status": "error",
  "error": "Address required",
  "timestamp": "2025-11-07T10:30:00.000Z"
}
```

## Important Notes

1. **First request may be slow** - Render spins down free tier apps after inactivity
2. **Recommended plan: Starter ($7/month)** - Free tier works but has limitations
3. **Timeout: 60 seconds** - Complex addresses may take longer
4. **No external dependencies** - Runs entirely on Render's infrastructure

## Files Structure

```
.
├── find_square_local.js    # Core Puppeteer logic
├── server.js               # Express API server
├── package.json            # Dependencies
├── render.yaml             # Render configuration
├── .gitignore             # Git ignore rules
└── README.md              # This file
```

## Troubleshooting

### Build fails
- Check Render logs for specific errors
- Ensure `puppeteer` is in dependencies (not devDependencies)

### Runtime errors
- Check application logs in Render dashboard
- Verify Chromium downloaded during build (look for "Downloading Chrome" in logs)

### 500 errors
- First request after cold start may timeout
- Try again after 30 seconds
- Consider upgrading to Starter plan for better reliability

## Local Development

```bash
npm install
npm start
```

Then test with:
```bash
curl -X POST http://localhost:3000/extract-xhr \
  -H "Content-Type: application/json" \
  -d '{"address": "316 E Okanogan Ave, Chelan Washington 98816"}'
```
