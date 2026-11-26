package com.stoklore.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;

/** One WebView showing assets/index.html. The page asks Java for HTTP (a native request carries each site's
 *  Origin/Referer and sidesteps CORS), to open links in the Dhan / TradingView apps, to keep the holdings
 *  file the background job (PortfolioJob) reads, and for files, notifications and system settings. */
public class MainActivity extends Activity {
    private static final int REQ_FILE = 1, REQ_EXPORT = 2, REQ_NOTIFY = 3;
    private static final String NOTIFY_PERM = "android.permission.POST_NOTIFICATIONS"; // API 33+
    private static final List<String> READABLE = Arrays.asList(PortfolioJob.PORTFOLIO, PortfolioJob.STATE);

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String exportText;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xff0a0c0f);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(this, "Native");
        // <input type=file> (holdings CSV, backup JSON) opens Android's file picker
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Choose a file"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html" + routeOf(getIntent()));
        PortfolioJob.schedule(this); // keeps the background job in step after an update
    }

    /** A notification tap opens the app on Holdings. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String r = routeOf(intent);
        if (!r.isEmpty()) web.evaluateJavascript("location.hash=" + JSONObject.quote(r), null);
    }

    private static String routeOf(Intent i) {
        return i != null && "holdings".equals(i.getStringExtra("route")) ? "#/holdings" : "";
    }

    /** GETs `url` on a background thread, then calls window.onNative(id, status, body). */
    @JavascriptInterface
    public void get(final String id, final String url) {
        new Thread(() -> {
            Http.Res r = Http.get(url);
            final String js = "window.onNative(" + JSONObject.quote(id) + "," + r.status + "," + JSONObject.quote(r.body) + ")";
            runOnUiThread(() -> web.evaluateJavascript(js, null));
        }).start();
    }

    /** Opens `url` in the app `pkg` when it's installed and handles the link, else (or with no pkg) in the browser. */
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

    /** Settings' text size: scales every CSS font size, 85-130%. */
    @JavascriptInterface
    public void setTextZoom(final int percent) {
        runOnUiThread(() -> web.getSettings().setTextZoom(Math.max(85, Math.min(130, percent))));
    }

    /** versionName from the manifest, for Settings' About. */
    @JavascriptInterface
    public String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return ""; }
    }

    // ---- holdings: the page's portfolio.json, which the background job reads ----

    /** portfolio.json or portfolio_state.json as text ("{}" when there is none). */
    @JavascriptInterface
    public String readFile(String name) {
        return READABLE.contains(name) ? PortfolioJob.read(this, name).toString() : "{}";
    }

    /** Saves portfolio.json (the only file the page may write) and starts / stops the job to match. */
    @JavascriptInterface
    public boolean savePortfolio(String json) {
        try {
            new JSONObject(json); // refuse anything that isn't JSON
            PortfolioJob.write(this, PortfolioJob.PORTFOLIO, json);
            PortfolioJob.schedule(this);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** "Send one now": prices the holdings and posts a summary notification; answers window.onCheckNow(result). */
    @JavascriptInterface
    public void checkNow() {
        new Thread(() -> {
            String r;
            try { r = PortfolioJob.run(this, true); } catch (Exception e) { r = String.valueOf(e.getMessage()); }
            final String js = "window.onCheckNow && window.onCheckNow(" + JSONObject.quote(r) + ")";
            runOnUiThread(() -> web.evaluateJavascript(js, null));
        }).start();
    }

    /** "on" when notifications can be shown, else "off". */
    @JavascriptInterface
    public String notifyState() {
        boolean perm = Build.VERSION.SDK_INT < 33 || checkSelfPermission(NOTIFY_PERM) == PackageManager.PERMISSION_GRANTED;
        return perm && getSystemService(android.app.NotificationManager.class).areNotificationsEnabled() ? "on" : "off";
    }

    /** Asks for the notification permission (Android 13+), or opens the app's notification settings when it
     *  was refused before. The page hears back through window.onNotifyState(). */
    @JavascriptInterface
    public void requestNotify() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(NOTIFY_PERM) != PackageManager.PERMISSION_GRANTED
                && !getSharedPreferences("ask", MODE_PRIVATE).getBoolean("notifyAsked", false)) {
                getSharedPreferences("ask", MODE_PRIVATE).edit().putBoolean("notifyAsked", true).apply();
                requestPermissions(new String[]{NOTIFY_PERM}, REQ_NOTIFY);
                return;
            }
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        });
    }

    /** The phone's battery-optimisation list, where Stoklore can be set to "unrestricted" so the job runs on time. */
    @JavascriptInterface
    public void openBattery() {
        runOnUiThread(() -> {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (ActivityNotFoundException e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        });
    }

    /** Saves `text` to a file the user picks (backup export); answers window.onExported(ok). */
    @JavascriptInterface
    public void exportFile(final String fileName, final String text) {
        runOnUiThread(() -> {
            exportText = text;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, fileName);
            try { startActivityForResult(i, REQ_EXPORT); } catch (ActivityNotFoundException e) { exported(false); }
        });
    }

    private void exported(boolean ok) {
        exportText = null;
        web.evaluateJavascript("window.onExported && window.onExported(" + ok + ")", null);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        Uri uri = res == RESULT_OK && data != null ? data.getData() : null;
        if (req == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            fileCallback = null;
        } else if (req == REQ_EXPORT) {
            if (uri == null || exportText == null) { exported(false); return; }
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(exportText.getBytes("UTF-8"));
                exported(true);
            } catch (Exception e) {
                exported(false);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_NOTIFY) web.evaluateJavascript("window.onNotifyState && window.onNotifyState()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // back from the system's notification / battery settings: let the page re-read the state
        if (web != null) web.evaluateJavascript("window.onNotifyState && window.onNotifyState()", null);
    }

    @Override
    public void onBackPressed() {
        // back closes a card, then goes back a screen; the page answers "true" when it handled it
        web.evaluateJavascript("window.onBack && window.onBack()", v -> {
            if (!"true".equals(v)) super.onBackPressed();
        });
    }
}
