package com.stoklore.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Every 15 minutes (Android's shortest repeat): during NSE hours, price the holdings, check the alerts and
 *  post the open / hourly / close summaries. The page owns portfolio.json (holdings, alerts, notify); this
 *  job owns portfolio_state.json (alert states, what was sent, last values, value history). */
public class PortfolioJob extends JobService {
    static final int JOB_ID = 4711;
    static final Object LOCK = new Object(); // page and job share these files in one process
    static final String PORTFOLIO = "portfolio.json", STATE = "portfolio_state.json";
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final String ET_SECTORS = "https://etmarketsapis.indiatimes.com/ET_Stats/sectorperformance?pagesize=100&pageno=1&marketcap=&exchange=NSE";

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try { run(this, false); } catch (Throwable e) { android.util.Log.w("Stoklore", "job pass failed", e); } // next pass tries again
            try { jobFinished(params, false); } catch (Throwable ignored) { /* already stopped */ }
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    /** Runs the job only while there are holdings and something to tell (notifications on, or an alert). */
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        JSONObject pf = read(c, PORTFOLIO);
        boolean has = len(pf, "holdings") > 0 || len(pf, "watch") > 0;
        boolean want = (has && (!"off".equals(pf.optString("notify", "hourly")) || len(pf, "alerts") > 0 || pf.optBoolean("filings", true)))
            || pf.optBoolean("updates", true); // the daily update check runs for everyone who leaves it on
        if (!want) { js.cancel(JOB_ID); return; }
        if (js.getPendingJob(JOB_ID) != null) return;
        JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(c, PortfolioJob.class))
            .setPeriodic(15 * 60 * 1000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
        try {
            js.schedule(b.setPersisted(true).build());
        } catch (RuntimeException notAllowed) { // some phones refuse a job that survives a reboot: run until the next one
            js.schedule(b.setPersisted(false).build());
        }
    }

    private static int len(JSONObject o, String k) { JSONArray a = o.optJSONArray(k); return a == null ? 0 : a.length(); }

    /** One pass. `now` = the "Send one now" button: price and post a summary whatever the time, touching
     *  no alert. Returns a short result for the page. Filings are checked every 2 hours, 07:00-23:00, any
     *  day (results land in the evening); prices, alerts and summaries only in NSE hours on trading days. */
    static String run(Context c, boolean now) throws Exception {
        ZonedDateTime t = ZonedDateTime.now(IST);
        String today = t.toLocalDate().toString();
        int min = t.getHour() * 60 + t.getMinute(), dow = t.getDayOfWeek().getValue();
        JSONObject pf = read(c, PORTFOLIO);
        JSONArray hs = pf.optJSONArray("holdings");
        if (!now && pf.optBoolean("updates", true) && min >= 8 * 60 && min <= 22 * 60) {
            try { updates(c); } catch (Exception ignored) { /* tomorrow */ }
        }
        if (!now && pf.optBoolean("filings", true) && min >= 7 * 60 && min <= 23 * 60) {
            try { filings(c, pf); } catch (Exception ignored) { /* next pass */ }
        }
        if (hs == null || hs.length() == 0) return "no holdings";
        if (!now && (dow >= 6 || min < 9 * 60 + 20 || min > 16 * 60 + 30)) return "market closed";

        // prices: ET's sector feed (one request, ~1,600 NSE stocks), Moneycontrol daily bars for the rest,
        // funds at NAV (mfapi, once a day per scheme - a NAV moves once a day)
        Map<String, double[]> et = new HashMap<>();
        String feedDay = etPrices(et);
        if (!now && !today.equals(feedDay)) return "no trading today"; // weekday holiday: the feed didn't move
        JSONObject mf = obj(read(c, STATE), "mf");
        List<Portfolio.Pos> ps = new ArrayList<>();
        Map<String, List<Portfolio.Pos>> byPf = new HashMap<>(); // a portfolio alert can be on one portfolio
        for (int i = 0; i < hs.length(); i++) {
            JSONObject h = hs.getJSONObject(i);
            Portfolio.Pos p = new Portfolio.Pos(h.getString("sym"), h.getDouble("qty"), h.isNull("avg") ? Double.NaN : h.optDouble("avg", Double.NaN));
            if ("mf".equals(h.optString("kind"))) mfNav(p, h.optString("code"), mf, today);
            else price(p, h.optString("et", ""), et, today);
            ps.add(p);
            String pfId = h.optString("pf", "main");
            if (!byPf.containsKey(pfId)) byPf.put(pfId, new ArrayList<>());
            byPf.get(pfId).add(p);
        }
        // watchlist stocks a price alert points at (priced for the alert only, never in the totals)
        List<Portfolio.Pos> wl = new ArrayList<>();
        JSONArray as = pf.optJSONArray("alerts"), ws = pf.optJSONArray("watch");
        for (int i = 0; ws != null && i < ws.length(); i++) {
            JSONObject w = ws.getJSONObject(i);
            boolean alerted = false;
            for (int j = 0; as != null && j < as.length(); j++) alerted |= w.getString("sym").equals(as.getJSONObject(j).optString("sym"));
            if (!alerted || Portfolio.find(ps, w.getString("sym")) != null) continue;
            Portfolio.Pos p = new Portfolio.Pos(w.getString("sym"), 0, Double.NaN);
            price(p, w.optString("et", ""), et, today);
            wl.add(p);
        }
        Portfolio.Totals tot = Portfolio.totals(ps);
        if (tot.priced == 0) return "no prices (offline?)";

        synchronized (LOCK) {
            JSONObject st = read(c, STATE);
            JSONObject sent = obj(st, "sent"), lastVals = obj(st, "lastVals"), astates = obj(st, "alerts");
            Map<String, Double> last = new HashMap<>();
            for (Iterator<String> k = lastVals.keys(); k.hasNext(); ) { String s = k.next(); last.put(s, lastVals.getDouble(s)); }
            double lastValue = st.optDouble("lastValue", Double.NaN);
            long nowMs = System.currentTimeMillis();

            if (now) {
                String[] s = Portfolio.summary("now", tot, lastValue, ps);
                post(c, "summary", 1, s[0], s[1]);
            } else {
                // alerts: during the session and a few minutes after the close
                if (min <= 15 * 60 + 40) {
                    JSONObject keep = new JSONObject();
                    for (int i = 0; as != null && i < as.length(); i++) {
                        JSONObject a = as.getJSONObject(i);
                        String id = a.getString("id");
                        Portfolio.Alert al = new Portfolio.Alert(id, a.getString("kind"), a.isNull("sym") ? null : a.optString("sym", null),
                            a.getDouble("value"), a.optBoolean("repeat"), a.isNull("start") ? Double.NaN : a.optDouble("start", Double.NaN));
                        Portfolio.State s = state(astates.optJSONObject(id));
                        String pfId = a.isNull("pf") ? "" : a.optString("pf", "");
                        List<Portfolio.Pos> scope = pfId.isEmpty() ? ps : byPf.containsKey(pfId) ? byPf.get(pfId) : new ArrayList<>();
                        String title = Portfolio.check(al, s, scope, wl, today, nowMs);
                        if (title != null && !pfId.isEmpty()) title = name(pf, pfId) + ": " + title;
                        if (title != null) {
                            post(c, "alerts", 100 + (id.hashCode() & 0xffff), title, Portfolio.moved(ps, last));
                            JSONArray lg = st.optJSONArray("log") == null ? new JSONArray() : st.getJSONArray("log");
                            lg.put(new JSONObject().put("t", nowMs).put("id", id).put("msg", title));
                            while (lg.length() > 50) lg.remove(0);
                            st.put("log", lg);
                        }
                        keep.put(id, json(s)); // states of deleted alerts drop out here
                    }
                    st.put("alerts", keep);
                }
                String due = Portfolio.due(pf.optString("notify", "hourly"), min, today,
                    sent.optString("open"), sent.optString("close"), sent.optString("hour"));
                if (due != null) {
                    String kind = due.startsWith("hour") ? "hour" : due;
                    String[] s = Portfolio.summary(kind, tot, lastValue, ps);
                    post(c, "summary", 1, s[0], s[1]);
                    if (due.startsWith("hour:")) sent.put("hour", today + "T" + due.substring(5)); else sent.put(due, today);
                    st.put("sent", sent);
                }
            }
            JSONObject vals = new JSONObject();
            for (Portfolio.Pos p : ps) if (p.priced()) vals.put(p.sym, p.value());
            st.put("lastVals", vals).put("lastValue", tot.value).put("lastAt", nowMs).put("mf", mf)
                .put("lastDay", tot.day).put("lastDayPct", nan0(tot.dayPct())).put("lastPnl", tot.pnl).put("lastPnlPct", nan0(tot.pnlPct()))
                .put("lastMissing", tot.missing);
            JSONArray snaps = st.optJSONArray("snaps") == null ? new JSONArray() : st.getJSONArray("snaps");
            snaps.put(new JSONArray().put(nowMs).put(Math.round(tot.value)));
            while (snaps.length() > 800) snaps.remove(0); // ~2 months of 15-minute points in market hours
            st.put("snaps", snaps);
            write(c, STATE, st.toString());
        }
        HoldingsWidget.update(c);
        return "ok";
    }

    private static double nan0(double v) { return Double.isNaN(v) ? 0 : v; }

    /** A portfolio's name from portfolio.json, for an alert's title. */
    private static String name(JSONObject pf, String id) {
        JSONArray ps = pf.optJSONArray("portfolios");
        for (int i = 0; ps != null && i < ps.length(); i++) {
            JSONObject p = ps.optJSONObject(i);
            if (p != null && id.equals(p.optString("id"))) return p.optString("name", id);
        }
        return id;
    }

    private static void price(Portfolio.Pos p, String etId, Map<String, double[]> et, String today) {
        double[] q = et.get(etId);
        if (q != null) { p.price = q[0]; p.prev = q[1]; } else mcDaily(p, today);
    }

    /** A fund's last two NAVs from mfapi, fetched once per scheme per day and kept in the state's "mf". */
    private static void mfNav(Portfolio.Pos p, String code, JSONObject cache, String today) {
        try {
            JSONObject e = cache.optJSONObject(code);
            if (e == null || !today.equals(e.optString("day"))) {
                Http.Res r = Http.get("https://api.mfapi.in/mf/" + java.net.URLEncoder.encode(code, "UTF-8"));
                if (r.status != 200) { if (e == null) return; } else {
                    JSONArray d = new JSONObject(r.body).optJSONArray("data");
                    if (d == null || d.length() == 0) return;
                    e = new JSONObject().put("day", today).put("nav", d.getJSONObject(0).getDouble("nav"))
                        .put("prev", d.length() > 1 ? d.getJSONObject(1).getDouble("nav") : d.getJSONObject(0).getDouble("nav"));
                    cache.put(code, e);
                }
            }
            p.price = e.getDouble("nav");
            p.prev = e.optDouble("prev", Double.NaN);
        } catch (Exception ignored) { /* stays unpriced */ }
    }

    private static final String RELEASES = "https://api.github.com/repos/Karthik002002/Stoklore/releases?per_page=20";
    private static final String RELEASE_PAGE = "https://github.com/Karthik002002/Stoklore/releases/";

    /** Once a day: the newest published mobile-vX.Y release of this repo; a notification when it's a newer main
     *  version than the one installed (each version announced once). A tap opens the app's update card. */
    static void updates(Context c) throws Exception {
        long nowMs = System.currentTimeMillis();
        JSONObject st0 = read(c, STATE);
        if (nowMs - st0.optLong("updateAt", 0) < 20 * 3600 * 1000L) return;
        Http.Res r = Http.get(RELEASES);
        if (r.status != 200) return;
        JSONArray list = new JSONArray(r.body);
        String best = null, page = null;
        for (int i = 0; i < list.length(); i++) {
            JSONObject rel = list.getJSONObject(i);
            String tag = rel.optString("tag_name"), url = rel.optString("html_url");
            if (rel.optBoolean("draft") || rel.optBoolean("prerelease") || !tag.matches("mobile-v\\d+\\.\\d+(\\.\\d+)?") || !url.startsWith(RELEASE_PAGE)) continue;
            String v = tag.substring(8);
            if (best == null || Portfolio.newerVersion(v, best)) { best = v; page = url; }
        }
        String installed = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        synchronized (LOCK) {
            JSONObject st = read(c, STATE);
            st.put("updateAt", nowMs);
            boolean tell = best != null && Portfolio.newerVersion(best, installed) && !best.equals(st.optString("updateNotified"));
            if (tell) st.put("updateNotified", best);
            write(c, STATE, st.toString());
            if (tell) {
                Intent open = new Intent(c, MainActivity.class).putExtra("route", "update").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                post(c, "updates", 3, "Stoklore " + best + " is available", "You have " + installed + ". Tap to update.", open);
            }
        }
    }

    /** New filings worth knowing (results, board meetings, dividends, splits, ...) for the stocks you hold
     *  or watch, from Screener's per-company "recent announcements" snippet; every 2 hours at most. The first
     *  pass only remembers what's already there, so turning this on doesn't flood you with old filings. */
    static void filings(Context c, JSONObject pf) throws Exception {
        long nowMs = System.currentTimeMillis();
        JSONObject st0 = read(c, STATE);
        if (nowMs - st0.optLong("filingsAt", 0) < 2 * 3600 * 1000L) return;
        Map<String, String> targets = new java.util.LinkedHashMap<>(); // screener id -> symbol
        for (String list : new String[]{"holdings", "watch"}) {
            JSONArray a = pf.optJSONArray(list);
            for (int i = 0; a != null && i < a.length(); i++) {
                JSONObject h = a.getJSONObject(i);
                if (!h.isNull("scr") && !h.optString("scr").isEmpty() && !"mf".equals(h.optString("kind"))) targets.put(h.optString("scr"), h.getString("sym"));
            }
        }
        List<String> lines = new ArrayList<>();
        List<String> fresh = new ArrayList<>();
        for (Map.Entry<String, String> e : targets.entrySet()) {
            Http.Res r = Http.get("https://www.screener.in/announcements/recent/" + e.getKey() + "/");
            if (r.status != 200) continue;
            for (Portfolio.Filing f : Portfolio.parseFilings(r.body)) {
                fresh.add(f.url);
                String kind = Portfolio.filingKind(f.title);
                if (kind != null) lines.add(e.getValue() + " · " + kind + " — " + f.title + "\t" + f.url);
            }
        }
        synchronized (LOCK) {
            JSONObject st = read(c, STATE);
            JSONArray seen = st.optJSONArray("filingsSeen");
            boolean seed = seen == null;
            java.util.Set<String> known = new java.util.HashSet<>();
            for (int i = 0; seen != null && i < seen.length(); i++) known.add(seen.optString(i));
            List<String> news = new ArrayList<>();
            for (String l : lines) { String url = l.substring(l.lastIndexOf('\t') + 1); if (!known.contains(url)) news.add(l.substring(0, l.lastIndexOf('\t'))); }
            JSONArray keep = new JSONArray();
            for (String u : fresh) if (keep.length() < 400) keep.put(u);
            for (String u : known) if (keep.length() < 400 && !fresh.contains(u)) keep.put(u);
            st.put("filingsSeen", keep).put("filingsAt", nowMs);
            if (!seed && !news.isEmpty()) {
                JSONArray lg = st.optJSONArray("filingsLog") == null ? new JSONArray() : st.getJSONArray("filingsLog");
                for (String n : news) lg.put(new JSONObject().put("t", nowMs).put("msg", n));
                while (lg.length() > 40) lg.remove(0);
                st.put("filingsLog", lg);
            }
            write(c, STATE, st.toString());
            if (!seed && !news.isEmpty()) {
                String title = news.size() == 1 ? news.get(0).split(" — ")[0] : news.size() + " new filings for your stocks";
                StringBuilder body = new StringBuilder();
                for (int i = 0; i < news.size() && i < 6; i++) body.append(i > 0 ? "\n" : "").append(news.get(i));
                post(c, "filings", 2, title, body.toString());
            }
        }
    }

    /** ET sector feed -> companyId -> {price, previous close}; returns the IST date of its newest update. */
    private static String etPrices(Map<String, double[]> out) throws Exception {
        Http.Res r = Http.get(ET_SECTORS);
        if (r.status != 200) return "";
        JSONArray rows = new JSONObject(r.body).optJSONArray("searchresult");
        long newest = 0;
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONArray cons = rows.getJSONObject(i).optJSONArray("sectorConstituents");
            for (int j = 0; cons != null && j < cons.length(); j++) {
                JSONObject m = cons.getJSONObject(j);
                double price = m.optDouble("current", Double.NaN), pct = m.optDouble("percentChange", Double.NaN);
                if (Double.isNaN(price)) continue;
                out.put(m.optString("companyId"), new double[]{price, Double.isNaN(pct) ? Double.NaN : price / (1 + pct / 100)});
                newest = Math.max(newest, m.optLong("updatedDate"));
            }
        }
        return newest == 0 ? "" : Instant.ofEpochMilli(newest).atZone(IST).toLocalDate().toString();
    }

    /** Moneycontrol daily bars for a symbol ET's feed doesn't carry (ETFs, some SME stocks). */
    private static void mcDaily(Portfolio.Pos p, String today) {
        try {
            long to = System.currentTimeMillis() / 1000;
            Http.Res r = Http.get("https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol="
                + java.net.URLEncoder.encode(p.sym, "UTF-8") + "&resolution=1D&from=" + (to - 15 * 86400) + "&to=" + to + "&countback=5&currencyCode=INR");
            if (r.status != 200) return;
            JSONObject j = new JSONObject(r.body);
            JSONArray ts = j.optJSONArray("t"), cs = j.optJSONArray("c");
            if (!"ok".equals(j.optString("s")) || ts == null || cs == null || cs.length() == 0) return;
            int n = cs.length();
            p.price = cs.getDouble(n - 1);
            String lastDay = Instant.ofEpochSecond(ts.getLong(n - 1)).atZone(IST).toLocalDate().toString();
            // a bar from today: yesterday's close is the bar before; no bar today: no move today
            p.prev = today.equals(lastDay) ? (n > 1 ? cs.getDouble(n - 2) : Double.NaN) : p.price;
        } catch (Exception ignored) { /* stays unpriced */ }
    }

    static void post(Context c, String channel, int id, String title, String text) {
        post(c, channel, id, title, text, new Intent(c, MainActivity.class).putExtra("route", "holdings").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }

    static void post(Context c, String channel, int id, String title, String text, Intent open) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(channel) == null) {
            boolean alerts = "alerts".equals(channel), filings = "filings".equals(channel), updates = "updates".equals(channel);
            NotificationChannel ch = new NotificationChannel(channel, alerts ? "Holding alerts" : filings ? "Filings & results" : updates ? "App updates" : "Holdings updates",
                alerts ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(alerts ? "Your price and portfolio alerts" : filings ? "Results, board meetings, dividends and other filings for stocks you hold or watch"
                : updates ? "A new version of Stoklore is out" : "Open, hourly and close summaries of your holdings");
            nm.createNotificationChannel(ch);
        }
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build();
        nm.notify(id, n);
    }

    // ---- files (app-private): atomic writes, empty object when missing or unreadable ----
    static JSONObject read(Context c, String name) {
        synchronized (LOCK) {
            File f = new File(c.getFilesDir(), name);
            if (!f.exists()) return new JSONObject();
            try (InputStream in = new FileInputStream(f)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return new JSONObject(out.toString("UTF-8"));
            } catch (Exception e) {
                return new JSONObject();
            }
        }
    }

    static void write(Context c, String name, String text) throws Exception {
        synchronized (LOCK) {
            File tmp = new File(c.getFilesDir(), name + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(text.getBytes("UTF-8")); out.getFD().sync(); }
            File dest = new File(c.getFilesDir(), name);
            if (!tmp.renameTo(dest)) { // some file systems won't rename over an existing file: replace it
                if (!dest.delete() || !tmp.renameTo(dest)) throw new Exception("could not save " + name);
            }
        }
    }

    private static JSONObject obj(JSONObject o, String k) { JSONObject v = o.optJSONObject(k); return v == null ? new JSONObject() : v; }

    private static Portfolio.State state(JSONObject j) {
        Portfolio.State s = new Portfolio.State();
        if (j == null) return s;
        s.armed = j.optBoolean("armed", true);
        s.done = j.optBoolean("done", false);
        s.high = j.optDouble("high", Double.NaN);
        s.day = j.optString("day", "");
        s.last = j.optLong("last", 0);
        JSONArray sy = j.optJSONArray("syms");
        for (int i = 0; sy != null && i < sy.length(); i++) s.syms.add(sy.optString(i));
        return s;
    }

    private static JSONObject json(Portfolio.State s) throws Exception {
        JSONObject j = new JSONObject().put("armed", s.armed).put("done", s.done).put("day", s.day).put("last", s.last).put("syms", new JSONArray(s.syms));
        if (!Double.isNaN(s.high)) j.put("high", s.high);
        return j;
    }
}
