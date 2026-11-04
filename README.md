# Codespace Terminal

GitHub Codespaces terminalini Android telefondan kullanmak için açık kaynak uygulama.
Gerçek bash terminali, Gemini destekli terminal ajanı ve dosya gezgini içerir.

## Nasıl çalışır?

1. **Codespace açılınca sunucu kendiliğinden başlar** (`server/`).
2. Terminalde `bash server/bilgi.sh` yaz → **adres** ve **erişim anahtarı** görünür.
   (Port 8080 `Public` olmalı: PORTS sekmesi → 8080 → sağ tık → Port Visibility → Public)
3. Uygulamada ⚙ Ayarlar'a adresi ve anahtarı yapıştır → **Kaydet ve bağlan**.
4. AI için Ayarlar'a Gemini API anahtarını gir.

## APK derleme

GitHub → **Actions** → **APK Derle** → **Run workflow**.
Bitince **Releases** sayfasından `CodespaceTerminal.apk` dosyasını indirip kur.
(APK sabit bir anahtarla imzalanır; yeni sürüm eskisinin üstüne güncellenir.)

## Güncelleme zip'i

Zip'i repoya yükle, Codespace'te şunu çalıştır:

```bash
git pull -q && unzip -oq terminal-update.zip && rm -f terminal-update.zip && bash server/kur.sh && git add -A && git commit -qm "Terminal v2" && git push
```

## Özellikler

- Oturum kalıcı: uygulamayı arka plana atsan da shell ölmez, geri dönünce kaldığın yerden devam eder
- Özel tuş çubuğu (ESC, TAB, CTRL, ALT, oklar, ^C ...), iki parmakla yazı boyutu, yapıştırma ve metin seçme modu
- AI ajanı: Gemini 3.5 Flash-Lite (varsayılan), 3.6 Flash, 3.8 Flash; tehlikeli komutlarda onay ister
- Dosyalar: yalnızca isimler listelenir; içerik isteğe bağlı olarak uygulamada açılır (txt) ya da telefona indirilir
- Erişim anahtarı ile korunan sunucu (anahtarsız hiçbir API çalışmaz)

## Sorun giderme

- **Bağlanamıyor:** Ayarlar → *Bağlantıyı test et*. Codespace açık mı, port 8080 Public mi kontrol et.
- **Sunucu durduysa:** `bash server/start.sh` (log: `server.log`)
- **Anahtarı yenilemek için:** `rm server/.token && bash server/start.sh`
- **Gboard'da çift harf/öneri sorunu:** Gboard → Metin düzeltme → "Öneri şeridini göster" ve otomatik düzeltmeyi kapat.
