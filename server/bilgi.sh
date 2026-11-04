#!/usr/bin/env bash
# Uygulamaya girilecek adres ve erişim anahtarını gösterir.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8080}"
TOKEN="$(cat .token 2>/dev/null)"
if [ -n "$CODESPACE_NAME" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  URL="https://${CODESPACE_NAME}-${PORT}.${DOMAIN}"
  if command -v gh >/dev/null 2>&1; then
    gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 \
      && echo "(Port ${PORT} Public yapıldı)" \
      || echo "(Port ${PORT} Public değilse: PORTS sekmesi > ${PORT} > sağ tık > Port Visibility > Public)"
  fi
else
  URL="http://localhost:${PORT}"
fi
if pgrep -f "node server.js" >/dev/null 2>&1; then DURUM="ÇALIŞIYOR"; else DURUM="DURMUŞ (log: server.log)"; fi
echo
echo "  Sunucu        : $DURUM"
echo "  Adres         : $URL"
echo "  Erişim anahtarı: $TOKEN"
echo
