#!/bin/bash

# Exit on any error
set -e

# Absolute cache dir for Render (avoids relative path unzip bug)
export PUPPETEER_CACHE_DIR=/opt/render/project/src/.puppeteer_cache
mkdir -p "$PUPPETEER_CACHE_DIR"

# Skip auto-download entirely
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install deps with npm (faster, no yarn linking issues)
npm ci --only=production

# Manual Chrome install (uses absolute cache, no unzip fail)
npx puppeteer browsers install chrome --platform=linux

# Log the exact executable path for your code (check this in build logs)
CHROME_PATH="$PUPPETEER_CACHE_DIR/chrome/linux-*/chrome-linux64/chrome"
echo "Chrome installed at: $CHROME_PATH (update executablePath in code)"
ls -la "$PUPPETEER_CACHE_DIR"  # Debug: Shows installed files
