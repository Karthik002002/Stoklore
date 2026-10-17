# Earnings (`/earnings`)

Upcoming results board meetings from NSE's event calendar (`GET /api/results-calendar`, results
meetings only, cached 6 hours), grouped by day: Today, Tomorrow, then each date. Research group in the
sidebar and the command palette.

Top to bottom, so it reads at a glance:

- **Exposure banner** - red with each open position (paper or live) that reports in the window and
  when; green when none does. This is the line that needs action.
- **Two-week strip** - one bar per weekday: height = meetings that day, coloured part = ones you
  watch or hold, red dot = an open position reports. Click a day to show only it; click again to clear.
- **Day tiles** - each stock as a tile: left edge green (RS 80+), grey (50-79) or red (<50), RS pill,
  sector, 1-month move, and a bar for distance from the 52-week high (green within 10%, amber within
  25%, red beyond). A red ring = you hold it. Hover for the meeting detail; click opens `/chart`.
- **Only mine** (default) keeps watchlist symbols and open paper/live positions; **All** shows the
  whole market.

Limits: NSE publishes about two weeks ahead, so this is near-term only, and past meetings aren't kept.
No backend changes.
