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
            try { run(this, false); } catch (Exception ignored) { /* next run tries again */ }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    /** Runs the job only while there are holdings and something to tell (notifications on, or an alert). */
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        JSONObject pf = read(c, PORTFOLIO);
        boolean want = pf.optJSONArray("holdings") != null && pf.optJSONArray("holdings").length() > 0
            && (!"off".equals(pf.optString("notify", "hourly")) || (pf.optJSONArray("alerts") != null && pf.optJSONArray("alerts").length() > 0));
        if (!want) { js.cancel(JOB_ID); return; }
        if (js.getPendingJob(JOB_ID) != null) return;
        js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, PortfolioJob.class))
            .setPeriodic(15 * 60 * 1000L)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build());
    }

    /** One pass. `now` = the "Send one now" button: price and post a summary whatever the time, touching
     *  no alert. Returns a short result for the page. */
    static String run(Context c, boolean now) throws Exception {
        ZonedDateTime t = ZonedDateTime.now(IST);
        String today = t.toLocalDate().toString();
        int min = t.getHour() * 60 + t.getMinute(), dow = t.getDayOfWeek().getValue();
        JSONObject pf = read(c, PORTFOLIO);
        JSONArray hs = pf.optJSONArray("holdings");
        if (hs == null || hs.length() == 0) return "no holdings";
        if (!now && (dow >= 6 || min < 9 * 60 + 20 || min > 16 * 60 + 30)) return "market closed";

        // prices: ET's sector feed (one request, ~1,600 NSE stocks), Moneycontrol daily bars for the rest
        Map<String, double[]> et = new HashMap<>();
        String feedDay = etPrices(et);
        if (!now && !today.equals(feedDay)) return "no trading today"; // weekday holiday: the feed didn't move
        List<Portfolio.Pos> ps = new ArrayList<>();
        for (int i = 0; i < hs.length(); i++) {
            JSONObject h = hs.getJSONObject(i);
            Portfolio.Pos p = new Portfolio.Pos(h.getString("sym"), h.getDouble("qty"), h.isNull("avg") ? Double.NaN : h.optDouble("avg", Double.NaN));
            double[] q = et.get(h.optString("et", ""));
            if (q != null) { p.price = q[0]; p.prev = q[1]; } else mcDaily(p, today);
            ps.add(p);
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
                    JSONArray as = pf.optJSONArray("alerts");
                    JSONObject keep = new JSONObject();
                    for (int i = 0; as != null && i < as.length(); i++) {
                        JSONObject a = as.getJSONObject(i);
                        String id = a.getString("id");
                        Portfolio.Alert al = new Portfolio.Alert(id, a.getString("kind"), a.isNull("sym") ? null : a.optString("sym", null),
                            a.getDouble("value"), a.optBoolean("repeat"), a.isNull("start") ? Double.NaN : a.optDouble("start", Double.NaN));
                        Portfolio.State s = state(astates.optJSONObject(id));
                        String title = Portfolio.check(al, s, ps, today, nowMs);
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
            st.put("lastVals", vals).put("lastValue", tot.value).put("lastAt", nowMs);
            JSONArray snaps = st.optJSONArray("snaps") == null ? new JSONArray() : st.getJSONArray("snaps");
            snaps.put(new JSONArray().put(nowMs).put(Math.round(tot.value)));
            while (snaps.length() > 800) snaps.remove(0); // ~2 months of 15-minute points in market hours
            st.put("snaps", snaps);
            write(c, STATE, st.toString());
        }
        return "ok";
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
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(channel) == null) {
            boolean alerts = "alerts".equals(channel);
            NotificationChannel ch = new NotificationChannel(channel, alerts ? "Holding alerts" : "Holdings updates",
                alerts ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(alerts ? "Your price and portfolio alerts" : "Open, hourly and close summaries of your holdings");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).putExtra("route", "holdings").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
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
            if (!tmp.renameTo(new File(c.getFilesDir(), name))) throw new Exception("could not save " + name);
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
