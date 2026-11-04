package com.codespace.terminal;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String TAG = "CodespaceTerminal";
    private static final int REQ_STORAGE = 11;

    private WebView webView;
    private String pendingUrl, pendingName, pendingToken;

    /** JS tarafındaki window.AndroidBridge */
    public class Bridge {
        @JavascriptInterface
        public void downloadFile(final String url, final String name, final String token) {
            runOnUiThread(() -> startDownload(url, name, token));
        }

        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("terminal", text));
            });
        }

        /** Panodaki metni window.__onNativePaste(text) ile JS'e yollar. */
        @JavascriptInterface
        public void requestPaste() {
            runOnUiThread(() -> {
                String text = "";
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null
                            && cm.getPrimaryClip().getItemCount() > 0) {
                        CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                        if (cs != null) text = cs.toString();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "pano okunamadı", e);
                }
                webView.evaluateJavascript(
                        "window.__onNativePaste&&window.__onNativePaste(" + JSONObject.quote(text) + ")", null);
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void vibrate(final int ms) {
            // Ek izin gerektirmemesi için dokunsal geri bildirim kullanılır
            runOnUiThread(() -> webView.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS));
        }

        @JavascriptInterface
        public String appVersion() {
            return "2.0";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0D1117"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(false);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setTextZoom(100); // sistem yazı boyutu düzeni bozmasın
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true; // uygulama içi WebView harici sayfaya gitmesin
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // WebView süreci çöktüyse (düşük RAM) sayfayı yeniden kur
                runOnUiThread(() -> recreate());
                return true;
            }
        });

        // WebChromeClient: JS dialogları ve konsol günlüğü için gerekli
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void startDownload(String url, String name, String token) {
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            pendingUrl = url;
            pendingName = name;
            pendingToken = token;
            requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        try {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.addRequestHeader("Authorization", "Bearer " + token);
            r.setTitle(safe);
            r.setDescription("Codespaces dosyası indiriliyor");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "Terminal/" + safe);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(r);
            Toast.makeText(this, safe + " indiriliyor (İndirilenler/Terminal)", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "İndirme hatası: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_STORAGE) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && pendingUrl != null) {
                startDownload(pendingUrl, pendingName, pendingToken);
            } else {
                Toast.makeText(this, "Dosya indirmek için depolama izni gerekli", Toast.LENGTH_LONG).show();
            }
            pendingUrl = pendingName = pendingToken = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Arka plandan dönünce bağlantıyı kontrol et / yeniden kur
        webView.evaluateJavascript("window.__onResume&&window.__onResume()", null);
    }

    @Override
    public void onBackPressed() {
        // Önce arayüz (açık panel / sekme) geri tuşunu kullanır; yoksa uygulamayı arka plana at
        // (finish() etmiyoruz: terminal oturumu ve bağlantı açık kalsın)
        webView.evaluateJavascript("(window.handleBack?window.handleBack():false)", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        super.onDestroy();
    }
}
