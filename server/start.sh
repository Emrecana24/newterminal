#!/usr/bin/env bash
# Sunucuyu (yeniden) başlatır. Bağımlılıklar eksik/bozuksa kurar.
cd "$(dirname "$0")" || exit 1

pkill -f "node server.js" 2>/dev/null
sleep 0.3

if ! node -e "require('node-pty');require('ws')" 2>/dev/null; then
  echo "Bağımlılıklar kuruluyor (ilk seferde ~1 dk sürebilir)..."
  rm -rf node_modules
  npm install --omit=dev --no-audit --no-fund || { echo "npm install başarısız"; exit 1; }
fi

nohup node server.js > ../server.log 2>&1 &
sleep 1
bash ./bilgi.sh
