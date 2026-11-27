package com.stoklore.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.app.KeyguardManager;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.view.View;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    private static final int REQ_FILE = 1, REQ_EXPORT = 2, REQ_NOTIFY = 3, REQ_UNLOCK = 4, REQ_PICK = 5;
    private static final int MAX_FILE = 25 * 1024 * 1024;
    private String pickId;           // the page's pending Native.pickFile call
    private Uri sharedUri;           // a file opened with / shared to Stoklore, handed over once the page is up
    private boolean pageReady;
    private static final long RELOCK_AFTER_MS = 30_000; // back within 30s of leaving: no prompt
    private static final String NOTIFY_PERM = "android.permission.POST_NOTIFICATIONS"; // API 33+
    private static final List<String> READABLE = Arrays.asList(PortfolioJob.PORTFOLIO, PortfolioJob.STATE);

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String exportText;
    // app lock (Settings): the page stays hidden until fingerprint / face / screen lock says yes
    private boolean locked, authenticating;
    private long stoppedAt;
    private Runnable unlockOk, unlockFail;

    /** Any crash is written to files/crash.txt; the next launch shows it (window.onCrash) and runs in safe mode -
     *  no background job - so the same fault can't crash the app in a loop. */
    private static final String CRASH = "crash.txt";
    private boolean safeMode;

    private void recordCrashes() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                java.io.StringWriter w = new java.io.StringWriter();
                e.printStackTrace(new java.io.PrintWriter(w));
                String info = "Stoklore " + version() + " · Android " + Build.VERSION.RELEASE + " (" + Build.VERSION.SDK_INT + ") · " + Build.MANUFACTURER + " " + Build.MODEL
                    + " · thread " + t.getName() + "\n" + w;
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(new java.io.File(getFilesDir(), CRASH))) { out.write(info.getBytes("UTF-8")); }
            } catch (Throwable ignored) { /* nothing more to do */ }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    /** The last crash's report (and clears it), or "". */
    @JavascriptInterface
    public String lastCrash() {
        java.io.File f = new java.io.File(getFilesDir(), CRASH);
        if (!f.exists()) return "";
        try (InputStream in = new java.io.FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return "crash report unreadable: " + e;
        } finally {
            f.delete();
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        recordCrashes();
        safeMode = new java.io.File(getFilesDir(), CRASH).exists();
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
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (sharedUri != null) { Uri u = sharedUri; sharedUri = null; readInto("window.onSharedFile", null, u); }
            }
        });
        sharedUri = incomingFile(getIntent());
        setContentView(web);
        if (lockOn()) { locked = true; web.setVisibility(View.INVISIBLE); hideFromRecents(true); }
        web.loadUrl("file:///android_asset/index.html" + routeOf(getIntent()));
        if (!safeMode) { // keeps the background job in step after an update; never allowed to stop the app opening
            try { PortfolioJob.schedule(this); } catch (Throwable e) { android.util.Log.w("Stoklore", "job not scheduled", e); }
        }
    }

    // ---- app lock ----
    private SharedPreferences prefs() { return getSharedPreferences("app", MODE_PRIVATE); }
    private boolean lockOn() { return prefs().getBoolean("lock", false) && keyguard().isDeviceSecure(); }
    private KeyguardManager keyguard() { return getSystemService(KeyguardManager.class); }

    private void hideFromRecents(boolean hide) {
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!hide); // no holdings in the app switcher's preview
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (authenticating || !lockOn()) return;
        if (locked || (stoppedAt > 0 && SystemClock.elapsedRealtime() - stoppedAt > RELOCK_AFTER_MS)) {
            locked = true;
            web.setVisibility(View.INVISIBLE);
            authenticate(() -> { locked = false; stoppedAt = 0; web.setVisibility(View.VISIBLE); }, () -> moveTaskToBack(true));
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (!authenticating) stoppedAt = SystemClock.elapsedRealtime();
    }

    /** Fingerprint / face with the screen lock as the fallback (Android 10+), the screen lock alone before. */
    private void authenticate(Runnable ok, Runnable fail) {
        if (!keyguard().isDeviceSecure()) { ok.run(); return; } // no screen lock set: nothing to check against
        authenticating = true;
        Runnable done = () -> authenticating = false;
        if (Build.VERSION.SDK_INT >= 29) {
            BiometricPrompt.Builder b = new BiometricPrompt.Builder(this).setTitle("Unlock Stoklore").setSubtitle("Your holdings are on this phone");
            if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            else b.setDeviceCredentialAllowed(true);
            b.build().authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { done.run(); ok.run(); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { done.run(); fail.run(); }
            });
        } else {
            unlockOk = () -> { done.run(); ok.run(); };
            unlockFail = () -> { done.run(); fail.run(); };
            startActivityForResult(keyguard().createConfirmDeviceCredentialIntent("Unlock Stoklore", "Your holdings are on this phone"), REQ_UNLOCK);
        }
    }

    /** "on", "off", or "unavailable" when the phone has no screen lock to unlock with. */
    @JavascriptInterface
    public String lockState() {
        return !keyguard().isDeviceSecure() ? "unavailable" : prefs().getBoolean("lock", false) ? "on" : "off";
    }

    /** Turns the app lock on or off - either way only after unlocking; answers window.onLockState(). */
    @JavascriptInterface
    public void setLock(final boolean on) {
        runOnUiThread(() -> authenticate(() -> {
            prefs().edit().putBoolean("lock", on).apply();
            hideFromRecents(on);
            web.evaluateJavascript("window.onLockState && window.onLockState()", null);
        }, () -> web.evaluateJavascript("window.onLockState && window.onLockState()", null)));
    }

    /** A notification tap opens the app on Holdings. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri shared = incomingFile(intent);
        if (shared != null) { if (pageReady) readInto("window.onSharedFile", null, shared); else sharedUri = shared; }
        String r = routeOf(intent);
        if (!r.isEmpty()) web.evaluateJavascript("location.hash=" + JSONObject.quote(r), null);
    }

    /** A file opened with Stoklore (VIEW) or shared to it (SEND): CSV, PDF statements, backups. */
    private static Uri incomingFile(Intent i) {
        if (i == null) return null;
        if (Intent.ACTION_VIEW.equals(i.getAction()) && i.getData() != null && "content".equals(i.getData().getScheme())) return i.getData();
        if (Intent.ACTION_SEND.equals(i.getAction())) { Object u = i.getParcelableExtra(Intent.EXTRA_STREAM); if (u instanceof Uri) return (Uri) u; }
        return null;
    }

    /** Reads a picked / shared file natively (the WebView's own file input isn't reliable on every phone) and
     *  hands it to the page as base64: fn(id, name, base64, error) or, for a shared file, fn(name, base64, error). */
    private void readInto(final String fn, final String id, final Uri uri) {
        new Thread(() -> {
            String name = "file", b64 = null, err = null;
            try {
                try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
                } catch (Exception ignored) { /* keep "file" */ }
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        if (out.size() > MAX_FILE) throw new Exception("That file is larger than 25 MB");
                    }
                    b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                }
            } catch (Exception e) {
                err = "Couldn't read the file: " + e.getMessage();
            }
            final String js = fn + " && " + fn + "(" + (id != null ? JSONObject.quote(id) + "," : "") + JSONObject.quote(name) + ","
                + (b64 == null ? "null" : JSONObject.quote(b64)) + "," + (err == null ? "null" : JSONObject.quote(err)) + ")";
            runOnUiThread(() -> web.evaluateJavascript(js, null));
        }).start();
    }

    /** The page's file picker: Android's own picker, the file read natively; answers window.onPicked. */
    @JavascriptInterface
    public void pickFile(final String id) {
        runOnUiThread(() -> {
            pickId = id;
            Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "Choose a file"), REQ_PICK);
            } catch (ActivityNotFoundException e) {
                web.evaluateJavascript("window.onPicked && window.onPicked(" + JSONObject.quote(id) + ",null,null,\"No file picker on this phone\")", null);
            }
        });
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

    /** Saves portfolio.json (the only file the page may write), then starts / stops the job and refreshes the
     *  widget. Returns "" when saved, else the reason. The job and the widget can't undo a save: their errors
     *  only go to the log (some phones refuse background jobs; the holdings are still saved). */
    @JavascriptInterface
    public String savePortfolio(String json) {
        try {
            new JSONObject(json); // refuse anything that isn't JSON
            PortfolioJob.write(this, PortfolioJob.PORTFOLIO, json);
        } catch (Exception e) {
            android.util.Log.e("Stoklore", "save failed", e);
            return e.getClass().getSimpleName() + ": " + e.getMessage();
        }
        try { PortfolioJob.schedule(this); } catch (Throwable e) { android.util.Log.w("Stoklore", "job not scheduled", e); }
        try { HoldingsWidget.update(this); } catch (Throwable e) { android.util.Log.w("Stoklore", "widget not updated", e); }
        return "";
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
        if (req == REQ_UNLOCK) {
            Runnable r = res == RESULT_OK ? unlockOk : unlockFail;
            unlockOk = unlockFail = null;
            if (r != null) r.run();
            return;
        }
        Uri uri = res == RESULT_OK && data != null ? data.getData() : null;
        if (uri == null && res == RESULT_OK && data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0) uri = data.getClipData().getItemAt(0).getUri();
        if (req == REQ_PICK) {
            String id = pickId;
            pickId = null;
            if (id == null) return;
            if (uri == null) web.evaluateJavascript("window.onPicked && window.onPicked(" + JSONObject.quote(id) + ",null,null,null)", null); // cancelled
            else readInto("window.onPicked", id, uri);
            return;
        }
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
