#!/usr/bin/env bash
# Güncelleme zip'i açıldıktan sonra çalışır: eski/gereksiz dosyaları temizler, sunucuyu yeniden başlatır.
cd "$(dirname "$0")/.." || exit 1
rm -f android/app/src/main/assets/*.js.[0-9] android/app/src/main/assets/*.css.[0-9]
if [ -n "$(git ls-files server/node_modules 2>/dev/null | head -1)" ]; then
  git rm -r -q --cached server/node_modules
fi
bash server/start.sh
