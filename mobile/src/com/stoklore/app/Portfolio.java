package com.stoklore.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** Holdings maths, alert rules and notification text for the background job. No Android and no JSON
 *  here, so mobile/test/PortfolioCheck.java runs it on a desktop JDK. Totals match lib.js valuePortfolio. */
final class Portfolio {
    private Portfolio() {}

    /** An alert re-arms only after the number moves back past its line by this much (0.5%). */
    static final double MARGIN = 0.005;

    static final class Pos {
        final String sym;
        final double qty, avg; // avg is NaN when the buy price is unknown
        double price = Double.NaN, prev = Double.NaN;
        Pos(String sym, double qty, double avg) { this.sym = sym; this.qty = qty; this.avg = avg; }
        boolean priced() { return !Double.isNaN(price); }
        double value() { return qty * price; }
        boolean hasDay() { return priced() && !Double.isNaN(prev); }
        double day() { return hasDay() ? qty * (price - prev) : 0; }
        double dayPct() { return hasDay() && prev != 0 ? (price / prev - 1) * 100 : Double.NaN; }
    }

    static final class Totals {
        double value, day, prevValue, pnl, base;
        int priced, missing;
        double dayPct() { return prevValue != 0 ? day / prevValue * 100 : Double.NaN; }
        double pnlPct() { return base != 0 ? pnl / base * 100 : Double.NaN; }
    }

    static Totals totals(List<Pos> ps) {
        Totals t = new Totals();
        for (Pos p : ps) {
            if (!p.priced()) { t.missing++; continue; }
            t.priced++;
            t.value += p.value();
            if (p.hasDay()) { t.day += p.day(); t.prevValue += p.value() - p.day(); }
            if (!Double.isNaN(p.avg)) { t.pnl += p.value() - p.qty * p.avg; t.base += p.qty * p.avg; }
        }
        return t;
    }

    static final class Alert {
        final String id, kind, sym;
        final double value, start;
        final boolean repeat;
        Alert(String id, String kind, String sym, double value, boolean repeat, double start) {
            this.id = id; this.kind = kind; this.sym = sym; this.value = value; this.repeat = repeat; this.start = start;
        }
    }

    /** What the job remembers per alert between runs. */
    static final class State {
        boolean armed = true, done = false;
        double high = Double.NaN;
        String day = "";
        final Set<String> syms = new TreeSet<>(); // stockdrop: holdings already reported today
        long last;
    }

    /** Checks one alert against the latest prices. Returns the notification title when it fires now, else
     *  null. Fires once per crossing: after firing it stays quiet until the number is back past the line by
     *  MARGIN (or, for the day-based kinds, until the next trading day); a one-time alert is then done. */
    static String check(Alert a, State st, List<Pos> ps, String today, long now) {
        return check(a, st, ps, Collections.<Pos>emptyList(), today, now);
    }

    /** `watch`: watchlist stocks (priced, never in the totals) - a stock price alert may be on one. */
    static String check(Alert a, State st, List<Pos> ps, List<Pos> watch, String today, long now) {
        Totals t = totals(ps);
        boolean daily = "dayloss".equals(a.kind) || "stockdrop".equals(a.kind);
        boolean price = "pbelow".equals(a.kind) || "pabove".equals(a.kind);
        if (!today.equals(st.day)) { st.day = today; if (daily && !st.done) { st.armed = true; st.syms.clear(); } }
        if (st.done || (t.priced == 0 && !price)) return null;
        double v = t.value;
        boolean hit, clear;
        String msg;
        switch (a.kind) {
            case "below":
                hit = v <= a.value; clear = v > a.value * (1 + MARGIN);
                msg = "Holdings " + inr(v) + " — below your " + inr(a.value);
                break;
            case "above":
                hit = v >= a.value; clear = v < a.value * (1 - MARGIN);
                msg = "Holdings " + inr(v) + " — above your " + inr(a.value);
                break;
            case "trail": {
                if (Double.isNaN(st.high)) st.high = Double.isNaN(a.start) ? v : Math.max(a.start, v);
                st.high = Math.max(st.high, v);
                double line = st.high - a.value;
                hit = v <= line; clear = v > line + st.high * MARGIN;
                msg = "Holdings " + inr(v) + " — gave back " + inr(st.high - v) + " from the high of " + inr(st.high);
                break;
            }
            case "dayloss":
                hit = t.day <= -a.value; clear = t.day > -a.value + v * MARGIN;
                msg = "Down " + inr(-t.day) + " today (" + pct(t.dayPct()) + ") — past your " + inr(a.value) + " limit";
                break;
            case "pbelow":
            case "pabove": {
                Pos p = find(ps, a.sym);
                if (p == null) p = find(watch, a.sym);
                if (p == null || !p.priced()) return null;
                boolean below = "pbelow".equals(a.kind);
                hit = below ? p.price <= a.value : p.price >= a.value;
                clear = below ? p.price > a.value * (1 + MARGIN) : p.price < a.value * (1 - MARGIN);
                msg = p.sym + " " + inr2(p.price) + " — " + (below ? "below" : "above") + " your " + inr2(a.value);
                break;
            }
            case "stockdrop": {
                List<String> names = new ArrayList<>();
                for (Pos p : ps) {
                    double d = p.dayPct();
                    if (!Double.isNaN(d) && d <= -a.value && !st.syms.contains(p.sym)) { names.add(p.sym + " " + pct(d)); st.syms.add(p.sym); }
                }
                if (names.isEmpty()) return null;
                st.last = now;
                if (!a.repeat) st.done = true;
                return String.join(", ", names) + " today — past your −" + trim(a.value) + "% line";
            }
            default:
                return null;
        }
        if (!st.armed) { if (clear) st.armed = true; return null; }
        if (!hit) return null;
        st.armed = false;
        st.last = now;
        if (!a.repeat) st.done = true;
        return msg;
    }

    /** "INFY −₹2,100 · HDFCBANK −₹1,300 · TCS +₹600": the biggest moves since the last check (falls first),
     *  or since yesterday's close when there was no last check. */
    static String moved(List<Pos> ps, Map<String, Double> last) {
        List<double[]> ch = new ArrayList<>();
        List<String> sy = new ArrayList<>();
        for (Pos p : ps) {
            if (!p.priced()) continue;
            Double before = last == null ? null : last.get(p.sym);
            double d = before != null ? p.value() - before : p.day();
            if (Math.abs(d) >= 1) { ch.add(new double[]{d, sy.size()}); sy.add(p.sym); }
        }
        Collections.sort(ch, (x, y) -> Double.compare(x[0], y[0]));
        List<String> out = new ArrayList<>();
        for (int i = 0; i < ch.size() && out.size() < 3; i++) out.add(sy.get((int) ch.get(i)[1]) + " " + signed(ch.get(i)[0]));
        if (out.isEmpty()) return "";
        return (last == null || last.isEmpty() ? "Today: " : "Since last check: ") + String.join(" · ", out);
    }

    /** "Best TCS +₹900 (+2.1%) · Worst INFY −₹420 (−1.2%)" by today's ₹ move. */
    static String bestWorst(List<Pos> ps) {
        Pos best = null, worst = null;
        for (Pos p : ps) {
            if (!p.hasDay()) continue;
            if (best == null || p.day() > best.day()) best = p;
            if (worst == null || p.day() < worst.day()) worst = p;
        }
        if (best == null) return "";
        String b = "Best " + best.sym + " " + signed(best.day()) + " (" + pct(best.dayPct()) + ")";
        return worst == best ? b : b + " · Worst " + worst.sym + " " + signed(worst.day()) + " (" + pct(worst.dayPct()) + ")";
    }

    /** Title and text of a summary notification. kind: open | hour | close | now. */
    static String[] summary(String kind, Totals t, double lastValue, List<Pos> ps) {
        String today = "Today " + signed(t.day) + " (" + pct(t.dayPct()) + ")";
        String pnl = t.base != 0 ? "P&L " + signed(t.pnl) + " (" + pct(t.pnlPct()) + ")" : "";
        String title;
        switch (kind) {
            case "open": title = "Holdings at the open · " + inr(t.value); break;
            case "close": title = "Market closed · holdings " + inr(t.value); break;
            case "hour":
                title = "Holdings " + inr(t.value) + (Double.isNaN(lastValue) ? "" : " · " + signed(t.value - lastValue) + " since last update");
                break;
            default: title = "Holdings now · " + inr(t.value);
        }
        StringBuilder body = new StringBuilder(today);
        if (!pnl.isEmpty()) body.append(" · ").append(pnl);
        String bw = bestWorst(ps);
        if (!bw.isEmpty()) body.append('\n').append(bw);
        if (t.missing > 0) body.append('\n').append(t.missing).append(t.missing == 1 ? " holding" : " holdings").append(" without a price right now");
        return new String[]{title, body.toString()};
    }

    /** Which summary is due at `min` minutes past midnight IST, or null. Open from 09:20, then on the hour
     *  +15 min (10:15 … 15:15; every other hour for "2h"), close from 15:35; each at most once a day. */
    static String due(String freq, int min, String today, String sentOpen, String sentClose, String sentHour) {
        if ("off".equals(freq)) return null;
        if (min >= 15 * 60 + 35) return today.equals(sentClose) ? null : "close";
        if (min < 9 * 60 + 20) return null;
        if (!today.equals(sentOpen)) return "open";
        if ("openclose".equals(freq)) return null;
        int h = min / 60;
        if (min % 60 < 15 || h < 10 || h > 15) return null;
        if ("2h".equals(freq) && h % 2 != 0) return null;
        return (today + "T" + h).equals(sentHour) ? null : "hour:" + h;
    }

    // ---- filings a holder cares about (lib.js filingKind keeps the same list) ----
    private static final String[][] FILING_KINDS = {
        {"financial results|\\bresults?\\b", "Results"}, {"board meeting", "Board meeting"}, {"dividend", "Dividend"}, {"record date", "Record date"},
        {"bonus", "Bonus"}, {"split|sub-?division", "Split"}, {"buy ?back", "Buyback"}, {"rights issue", "Rights issue"},
        {"annual general meeting|\\bagm\\b", "AGM"}, {"merger|amalgamation|acquisition|demerger", "Merger / acquisition"}, {"credit rating", "Credit rating"},
    };
    private static final java.util.regex.Pattern NOISE = java.util.regex.Pattern.compile(
        "newspaper|trading window|74\\s*\\(5\\)|loss of share|duplicate share|compliances?-certificate|investor (meet|presentation)|analyst", java.util.regex.Pattern.CASE_INSENSITIVE);

    static String filingKind(String text) {
        if (text == null || NOISE.matcher(text).find()) return null;
        for (String[] k : FILING_KINDS) if (java.util.regex.Pattern.compile(k[0], java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text).find()) return k[1];
        return null;
    }

    static final class Filing {
        final String title, url, date; // date: ISO datetime from the page, or ""
        Filing(String title, String url, String date) { this.title = title; this.url = url; this.date = date; }
    }

    /** Screener's /announcements/recent/<id>/ snippet -> filings (https links only). */
    static List<Filing> parseFilings(String html) {
        List<Filing> out = new ArrayList<>();
        java.util.regex.Matcher li = java.util.regex.Pattern.compile("<li[^>]*>(.*?)</li>", java.util.regex.Pattern.DOTALL).matcher(html == null ? "" : html);
        while (li.find()) {
            String item = li.group(1);
            java.util.regex.Matcher a = java.util.regex.Pattern.compile("<a[^>]*href=\"(https://[^\"]+)\"[^>]*>(.*?)</a>", java.util.regex.Pattern.DOTALL).matcher(item);
            if (!a.find()) continue;
            java.util.regex.Matcher time = java.util.regex.Pattern.compile("datetime=\"([^\"]+)\"").matcher(item);
            String text = a.group(2).replaceAll("<[^>]+>", " ").replace("&amp;", "&").replace("&nbsp;", " ").replaceAll("\\s+", " ").trim();
            if (!text.isEmpty()) out.add(new Filing(text, a.group(1).replace("&amp;", "&"), time.find() ? time.group(1) : ""));
        }
        return out;
    }

    static Pos find(List<Pos> ps, String sym) {
        for (Pos p : ps) if (p.sym.equals(sym)) return p;
        return null;
    }

    // ---- formatting: Indian grouping, ₹, a real minus sign ----
    static String inr(double v) { return money(v, 0); }
    static String inr2(double v) { return money(v, 2); }
    static String signed(double v) { return (v >= 0 ? "+" : "") + inr(v); }
    static String pct(double v) {
        if (Double.isNaN(v)) return "—";
        return (v >= 0 ? "+" : "−") + String.format(Locale.US, "%.1f", Math.abs(v)) + "%";
    }
    static String trim(double v) { return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v); }

    private static String money(double v, int decimals) {
        double a = Math.abs(v);
        String s = String.format(Locale.US, "%." + decimals + "f", a);
        String whole = decimals > 0 ? s.substring(0, s.indexOf('.')) : s, frac = decimals > 0 ? s.substring(s.indexOf('.')) : "";
        if (whole.length() > 3) {
            String head = whole.substring(0, whole.length() - 3), tail = whole.substring(whole.length() - 3);
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < head.length(); i++) {
                if (i > 0 && (head.length() - i) % 2 == 0) b.append(',');
                b.append(head.charAt(i));
            }
            whole = b + "," + tail;
        }
        boolean neg = v < 0 && !s.matches("[0.]+");
        return (neg ? "−" : "") + "₹" + whole + frac;
    }
}
