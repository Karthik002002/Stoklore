package com.stoklore.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;

/** The app's only way out to the network, used by the page (MainActivity.get) and the background job. */
final class Http {
    private Http() {}

    // the only hosts anything may fetch from
    static final List<String> HOSTS = Arrays.asList(
        "etmarketsapis.indiatimes.com", "etsearch.indiatimes.com", "dhan.co", "priceapi.moneycontrol.com",
        "economictimes.indiatimes.com", // the Feed's headline RSS
        "www.screener.in", // the stock screen's fundamentals and filings; holdings' filing alerts
        "portal.amfiindia.com", "api.mfapi.in"); // mutual fund NAVs (ISIN -> scheme, today's and yesterday's NAV)

    static final class Res {
        final int status; // HTTP status, or 0 when the request failed (body is then the error)
        final String body;
        Res(int status, String body) { this.status = status; this.body = body; }
    }

    static Res get(String url) {
        try {
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) || !HOSTS.contains(u.getHost())) throw new Exception("host not allowed: " + u.getHost());
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
            // each feed is the one its own site's pages call, so send that site as the referrer
            String host = u.getHost();
            String site = host.endsWith("moneycontrol.com") ? "https://www.moneycontrol.com"
                : host.endsWith("screener.in") ? "https://www.screener.in"
                : host.endsWith("indiatimes.com") ? "https://economictimes.indiatimes.com" : null; // AMFI, mfapi: plain public files
            if (site != null) {
                c.setRequestProperty("Origin", site);
                c.setRequestProperty("Referer", site + "/");
            }
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
            int status = c.getResponseCode();
            String body = "";
            if (status == 200) {
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    body = out.toString("UTF-8");
                }
            }
            c.disconnect();
            return new Res(status, body);
        } catch (Exception e) {
            return new Res(0, String.valueOf(e.getMessage()));
        }
    }
}
