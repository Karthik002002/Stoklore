package com.stoklore.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;

/** One WebView showing assets/index.html. The page asks Java for HTTP (a native request carries
 *  ET's Origin/Referer headers and sidesteps CORS, which a page fetch can't) and to open links in
 *  the Dhan / TradingView apps. */
public class MainActivity extends Activity {
    // the only hosts the page may fetch from
    private static final List<String> HOSTS = Arrays.asList(
        "etmarketsapis.indiatimes.com", "etsearch.indiatimes.com", "dhan.co", "priceapi.moneycontrol.com",
        "economictimes.indiatimes.com"); // the last one only for the Feed's headline RSS

    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xff0a0c0f);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(this, "Native");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    /** GETs `url` on a background thread, then calls window.onNative(id, status, body).
     *  status is the HTTP code, or 0 when the request failed (body is then the error). */
    @JavascriptInterface
    public void get(final String id, final String url) {
        new Thread(() -> {
            int status = 0;
            String body = "";
            try {
                URL u = new URL(url);
                if (!"https".equals(u.getProtocol()) || !HOSTS.contains(u.getHost())) throw new Exception("host not allowed: " + u.getHost());
                HttpURLConnection c = (HttpURLConnection) u.openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
                // each feed is the one its own site's pages call, so send that site as the referrer
                String site = u.getHost().endsWith("moneycontrol.com") ? "https://www.moneycontrol.com" : "https://economictimes.indiatimes.com";
                c.setRequestProperty("Origin", site);
                c.setRequestProperty("Referer", site + "/");
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                status = c.getResponseCode();
                if (status == 200) {
                    try (InputStream in = c.getInputStream()) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                        body = out.toString("UTF-8");
                    }
                }
                c.disconnect();
            } catch (Exception e) {
                status = 0;
                body = String.valueOf(e.getMessage());
            }
            final String js = "window.onNative(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(body) + ")";
            runOnUiThread(() -> web.evaluateJavascript(js, null));
        }).start();
    }

    /** Opens `url` in the app `pkg` when it's installed and handles the link, else (or with no pkg) in
     *  the browser. */
    @JavascriptInterface
    public void open(final String pkg, final String url) {
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                if (pkg == null || pkg.isEmpty()) throw new ActivityNotFoundException("browser only");
                startActivity(new Intent(i).setPackage(pkg));
            } catch (ActivityNotFoundException notInstalled) {
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                    // no browser at all: nothing to open it with
                }
            }
        });
    }

    /** Dhan has no per-stock app link (its own site's "open app" goes to dhan://Login), so: copy
     *  the symbol for Dhan's search and open the app; without the app, the stock's web page. */
    @JavascriptInterface
    public void openDhan(final String symbol, final String webUrl) {
        runOnUiThread(() -> {
            if (symbol != null && !symbol.isEmpty()) {
                ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("symbol", symbol));
            }
            Intent app = getPackageManager().getLaunchIntentForPackage("com.dhan.live");
            if (app == null) app = new Intent(Intent.ACTION_VIEW, Uri.parse("dhan://Login"));
            try {
                startActivity(app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                if (symbol != null && !symbol.isEmpty())
                    Toast.makeText(this, symbol + " copied - paste it in Dhan's search", Toast.LENGTH_LONG).show();
            } catch (ActivityNotFoundException noApp) {
                open("", webUrl);
            }
        });
    }

    /** Status / navigation bar colours follow the page's theme (#rrggbb), light icons on a light bar. */
    @JavascriptInterface
    public void setBars(final String bar, final boolean light) {
        runOnUiThread(() -> {
            try {
                int c = android.graphics.Color.parseColor(bar);
                getWindow().setStatusBarColor(c);
                getWindow().setNavigationBarColor(c);
                int f = getWindow().getDecorView().getSystemUiVisibility();
                int both = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                getWindow().getDecorView().setSystemUiVisibility(light ? f | both : f & ~both);
                web.setBackgroundColor(c);
            } catch (IllegalArgumentException ignored) {
                // not a colour: keep the bars as they are
            }
        });
    }

    @Override
    public void onBackPressed() {
        // back closes a card, then goes back a screen; the page answers "true" when it handled it
        web.evaluateJavascript("window.onBack && window.onBack()", v -> {
            if (!"true".equals(v)) super.onBackPressed();
        });
    }
}
