package com.stoklore.app;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Desktop check of Portfolio.java (the background job's maths and alert rules). Run with mobile/test/check-java.sh. */
public class PortfolioCheck {
    static int n;
    static void ok(boolean c, String what) { n++; if (!c) throw new AssertionError(what); }
    static void eq(Object a, Object b, String what) { n++; if (a == null ? b != null : !a.equals(b)) throw new AssertionError(what + ": got <" + a + "> want <" + b + ">"); }

    static Portfolio.Pos pos(String s, double qty, double avg, double price, double prev) {
        Portfolio.Pos p = new Portfolio.Pos(s, qty, avg); p.price = price; p.prev = prev; return p;
    }

    public static void main(String[] args) {
        // money formatting: Indian grouping, real minus
        eq(Portfolio.inr(120340), "₹1,20,340", "inr lakh");
        eq(Portfolio.inr(12345678.4), "₹1,23,45,678", "inr crore");
        eq(Portfolio.inr(999), "₹999", "inr small");
        eq(Portfolio.signed(-2100), "−₹2,100", "signed minus");
        eq(Portfolio.signed(600), "+₹600", "signed plus");
        eq(Portfolio.inr2(3295.4), "₹3,295.40", "inr2");
        eq(Portfolio.pct(-1.234), "−1.2%", "pct");
        eq(Portfolio.inr(-0.2), "₹0", "no minus zero");

        // totals match lib.js valuePortfolio: unpriced out, P&L only where a buy price exists
        List<Portfolio.Pos> ps = Arrays.asList(pos("A", 10, 100, 120, 110), pos("B", 5, Double.NaN, 40, 50), new Portfolio.Pos("C", 1, 50));
        Portfolio.Totals t = Portfolio.totals(ps);
        eq(t.value, 1400.0, "value"); eq(t.pnl, 200.0, "pnl"); eq(t.day, 50.0, "day"); eq(t.priced, 2, "priced"); eq(t.missing, 1, "missing");
        eq(Math.round(t.pnlPct() * 1e6) / 1e6, 20.0, "pnl pct");

        // "below": fires once, stays quiet while under, re-arms only 0.5% back above, fires again
        Portfolio.Alert below = new Portfolio.Alert("a", "below", null, 108000, true, Double.NaN);
        Portfolio.State st = new Portfolio.State();
        List<Portfolio.Pos> one = Arrays.asList(pos("X", 1, 100000, 120000, 120000));
        ok(Portfolio.check(below, st, one, "d1", 1) == null, "above the line: quiet");
        one.get(0).price = 107900;
        eq(Portfolio.check(below, st, one, "d1", 2), "Holdings ₹1,07,900 — below your ₹1,08,000", "fires on the cross");
        ok(Portfolio.check(below, st, one, "d1", 3) == null, "no repeat while below");
        one.get(0).price = 108200; // back above, but inside the margin
        ok(Portfolio.check(below, st, one, "d1", 4) == null && !st.armed, "inside margin: not re-armed");
        one.get(0).price = 108600;
        ok(Portfolio.check(below, st, one, "d1", 5) == null && st.armed, "past margin: re-armed");
        one.get(0).price = 107000;
        ok(Portfolio.check(below, st, one, "d1", 6) != null, "fires again after re-arm");

        // one-time alert is done after firing
        Portfolio.Alert once = new Portfolio.Alert("b", "above", null, 150000, false, Double.NaN);
        Portfolio.State so = new Portfolio.State();
        one.get(0).price = 151000;
        ok(Portfolio.check(once, so, one, "d1", 1) != null && so.done, "once fires and is done");
        one.get(0).price = 100000; Portfolio.check(once, so, one, "d1", 2); one.get(0).price = 160000;
        ok(Portfolio.check(once, so, one, "d1", 3) == null, "done stays done");

        // trailing: high follows the value up; fires when it gives back the amount from the high
        Portfolio.Alert trail = new Portfolio.Alert("c", "trail", null, 10000, true, 120000);
        Portfolio.State sl = new Portfolio.State();
        one.get(0).price = 125000; ok(Portfolio.check(trail, sl, one, "d1", 1) == null && sl.high == 125000, "high rises");
        one.get(0).price = 116000; ok(Portfolio.check(trail, sl, one, "d1", 2) == null, "gave back 9k: quiet");
        one.get(0).price = 114900;
        eq(Portfolio.check(trail, sl, one, "d1", 3), "Holdings ₹1,14,900 — gave back ₹10,100 from the high of ₹1,25,000", "trail fires");

        // day loss re-arms on a new day
        Portfolio.Alert dl = new Portfolio.Alert("d", "dayloss", null, 5000, true, Double.NaN);
        Portfolio.State sd = new Portfolio.State();
        List<Portfolio.Pos> dayp = Arrays.asList(pos("X", 100, 900, 940, 1000));
        ok(Portfolio.check(dl, sd, dayp, "d1", 1) != null, "day loss fires");
        ok(Portfolio.check(dl, sd, dayp, "d1", 2) == null, "not again the same day");
        ok(Portfolio.check(dl, sd, dayp, "d2", 3) != null, "again on a new day");

        // stock price + any-holding-drop (each stock reported once a day)
        Portfolio.Alert pb = new Portfolio.Alert("e", "pbelow", "TCS", 3300, true, Double.NaN);
        List<Portfolio.Pos> two = Arrays.asList(pos("TCS", 1, 3000, 3295.4, 3400), pos("INFY", 2, 1500, 1400, 1500));
        eq(Portfolio.check(pb, new Portfolio.State(), two, "d1", 1), "TCS ₹3,295.40 — below your ₹3,300.00", "price alert");
        Portfolio.Alert drop = new Portfolio.Alert("f", "stockdrop", null, 5, true, Double.NaN);
        Portfolio.State sdr = new Portfolio.State();
        eq(Portfolio.check(drop, sdr, two, "d1", 1), "INFY −6.7% today — past your −5% line", "stockdrop");
        ok(Portfolio.check(drop, sdr, two, "d1", 2) == null, "same stock not twice a day");

        // what moved since the last check, falls first; best / worst
        Map<String, Double> last = new HashMap<>();
        last.put("TCS", 3400.0); last.put("INFY", 2900.0);
        eq(Portfolio.moved(two, last), "Since last check: TCS −₹105 · INFY −₹100", "moved: biggest fall first");
        Map<String, Double> last2 = new HashMap<>(); last2.put("TCS", 3000.0); last2.put("INFY", 3000.0);
        eq(Portfolio.moved(two, last2), "Since last check: INFY −₹200 · TCS +₹295", "moved falls first");
        eq(Portfolio.bestWorst(two), "Best TCS −₹105 (−3.1%) · Worst INFY −₹200 (−6.7%)", "best worst");

        // summary schedule (minutes past midnight IST)
        eq(Portfolio.due("hourly", 9 * 60 + 10, "d1", "", "", ""), null, "before 09:20");
        eq(Portfolio.due("hourly", 9 * 60 + 25, "d1", "", "", ""), "open", "open");
        eq(Portfolio.due("hourly", 10 * 60 + 5, "d1", "d1", "", ""), null, "10:05 nothing");
        eq(Portfolio.due("hourly", 10 * 60 + 20, "d1", "d1", "", ""), "hour:10", "10:20 hourly");
        eq(Portfolio.due("hourly", 10 * 60 + 35, "d1", "d1", "", "d1T10"), null, "hour sent");
        eq(Portfolio.due("2h", 11 * 60 + 20, "d1", "d1", "", ""), null, "2h skips odd hour");
        eq(Portfolio.due("2h", 12 * 60 + 20, "d1", "d1", "", ""), "hour:12", "2h even hour");
        eq(Portfolio.due("openclose", 12 * 60 + 20, "d1", "d1", "", ""), null, "openclose no hourly");
        eq(Portfolio.due("hourly", 15 * 60 + 40, "d1", "d1", "", ""), "close", "close");
        eq(Portfolio.due("hourly", 15 * 60 + 50, "d1", "d1", "d1", ""), null, "close sent");
        eq(Portfolio.due("off", 15 * 60 + 40, "d1", "", "", ""), null, "off");

        String[] s = Portfolio.summary("close", Portfolio.totals(two), Double.NaN, two);
        eq(s[0], "Market closed · holdings ₹6,095", "summary title");
        ok(s[1].startsWith("Today −₹305 (−4.8%) · P&L +₹95 (+1.6%)"), "summary body: " + s[1]);

        // a price alert on a watchlist stock fires with no holdings at all; totals ignore the watchlist
        List<Portfolio.Pos> none = new java.util.ArrayList<>(), watch = Arrays.asList(pos("INFY", 0, Double.NaN, 1390, 1400));
        eq(Portfolio.check(new Portfolio.Alert("w", "pbelow", "INFY", 1400, true, Double.NaN), new Portfolio.State(), none, watch, "d1", 1),
            "INFY ₹1,390.00 — below your ₹1,400.00", "watchlist price alert");
        ok(Portfolio.check(new Portfolio.Alert("w2", "below", null, 5, true, Double.NaN), new Portfolio.State(), none, watch, "d1", 1) == null, "no holdings: no portfolio alert");

        // filings: which ones are worth a notification, and the snippet's parts
        eq(Portfolio.filingKind("Board Meeting Intimation for Financial Results for Q3"), "Results", "results");
        eq(Portfolio.filingKind("Corporate Action-Board approves Dividend"), "Dividend", "dividend");
        eq(Portfolio.filingKind("Announcement under Regulation 30 (LODR)-Newspaper Publication of results"), null, "newspaper noise");
        eq(Portfolio.filingKind("Change in Director"), null, "not interesting");
        List<Portfolio.Filing> fl = Portfolio.parseFilings("<ul><li class=\"x\"><a href=\"https://www.bseindia.com/a.pdf?x=1&amp;y=2\" target=\"_blank\"> Board Meeting Intimation <div class=\"ink\"><time datetime=\"2026-11-19T17:39:33+05:30\">19 Nov</time> - for results</div></a></li>"
            + "<li><a href=\"http://insecure/x.pdf\">Dropped</a></li><li><span>no link</span></li></ul>");
        eq(fl.size(), 1, "filings parsed"); eq(fl.get(0).url, "https://www.bseindia.com/a.pdf?x=1&y=2", "filing url");
        eq(fl.get(0).date, "2026-11-19T17:39:33+05:30", "filing date"); ok(fl.get(0).title.startsWith("Board Meeting Intimation 19 Nov"), "filing title: " + fl.get(0).title);

        // app updates: main versions only
        ok(Portfolio.newerVersion("3.4", "3.3-dev.2"), "3.4 is newer than 3.3-dev.2");
        ok(!Portfolio.newerVersion("3.3", "3.3-dev.2"), "a dev build isn't told to update to its own main version");
        ok(Portfolio.newerVersion("3.10", "3.9") && !Portfolio.newerVersion("3.3", "3.4") && !Portfolio.newerVersion("x", "3.3"), "numeric compare");
        ok(Portfolio.newerVersion("3.3.1", "3.3-dev.4") && !Portfolio.newerVersion("3.3.1", "3.3.1") && Portfolio.newerVersion("3.4", "3.3.9")
            && !Portfolio.newerVersion("3.3.2", "3.3.10"), "patch releases");

        System.out.println("PortfolioCheck: " + n + " checks passed");
    }
}
