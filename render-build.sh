#!/bin/bash

# Exit on error
set -o errexit

# Install deps
npm install

# Absolute cache dir (fixes extract-zip absolute path error)
export PUPPETEER_CACHE_DIR=/opt/render/project/src/.puppeteer_cache
mkdir -p "$PUPPETEER_CACHE_DIR"

# Install Chrome manually (uses absolute dir, no auto-hook fail)
npx puppeteer browsers install chrome --platform=linux

# Cache for faster rebuilds (Render persists this)
echo "Chrome path: $PUPPETEER_CACHE_DIR/chrome/linux-*/chrome"
ls -la "$PUPPETEER_CACHE_DIR/chrome" || true
