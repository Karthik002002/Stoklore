package com.stoklore.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import org.json.JSONObject;

/** Home-screen widget: holdings value, today's change and P&L from the last background pass
 *  (portfolio_state.json). Refreshed by PortfolioJob after every pass; a tap opens Holdings. */
public class HoldingsWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { update(c); }

    static void update(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, HoldingsWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        JSONObject pf = PortfolioJob.read(c, PortfolioJob.PORTFOLIO), st = PortfolioJob.read(c, PortfolioJob.STATE);
        boolean has = pf.optJSONArray("holdings") != null && pf.optJSONArray("holdings").length() > 0;
        if (!has || !st.has("lastValue")) {
            v.setTextViewText(R.id.w_value, has ? "—" : "Add holdings");
            v.setTextViewText(R.id.w_day, has ? "Prices arrive with the next update" : "Open Stoklore → Holdings");
            v.setTextViewText(R.id.w_meta, "");
            v.setTextColor(R.id.w_day, 0xff7d848d);
        } else {
            double day = st.optDouble("lastDay", 0), pnl = st.optDouble("lastPnl", 0);
            v.setTextViewText(R.id.w_value, Portfolio.inr(st.optDouble("lastValue", 0)));
            v.setTextViewText(R.id.w_day, Portfolio.signed(day) + " (" + Portfolio.pct(st.optDouble("lastDayPct", 0)) + ") today");
            v.setTextColor(R.id.w_day, day >= 0 ? 0xff2ebd85 : 0xffef5350);
            String when = DateTimeFormatter.ofPattern("d MMM, HH:mm").format(Instant.ofEpochMilli(st.optLong("lastAt")).atZone(PortfolioJob.IST));
            v.setTextViewText(R.id.w_meta, "P&L " + Portfolio.signed(pnl) + " (" + Portfolio.pct(st.optDouble("lastPnlPct", 0)) + ") · " + when);
        }
        Intent open = new Intent(c, MainActivity.class).putExtra("route", "holdings").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(c, 7, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        m.updateAppWidget(ids, v);
    }
}
