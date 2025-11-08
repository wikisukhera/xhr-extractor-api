#!/bin/bash
set -e

# Skip auto-download
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Absolute cache (fixes unzip absolute path error)
export PUPPETEER_CACHE_DIR=/opt/render/project/src/node_modules/.cache/puppeteer
mkdir -p "$PUPPETEER_CACHE_DIR"

# NPM install (no yarn linking bug)
npm ci --production

# Manual Chrome (downloads to absolute dir)
npx puppeteer browsers install chrome@stable

echo "Chrome path: $PUPPETEER_CACHE_DIR/chrome/linux-*/chrome"build.sh
