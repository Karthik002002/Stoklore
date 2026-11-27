# Stoklore Android — changelog

`release.sh` uses the section for the version being released as the GitHub release notes.
Not every build is released: builds go to the phone; a release is a deliberate `./release.sh`.

## 3.3
- **Sector heatmap:** the 450 largest stocks as a treemap (area = market cap, colour = the day's move), grouped under sector headers. The sector sort works on it, with a size switch (market cap / equal).
- **Sectors full screen:** tap a sector on any chart to see all its stocks as a zoomable heatmap: pinch, double-tap or − / + / fit; drag to move. Tap a stock for its card.
- **More sector charts:** tiles, grid, bars, bubbles (move vs breadth) and breadth.
- **Imports:**
  - Excel workbooks (every sheet);
  - brokers' holdings exports in CSV, Excel or HTML-table form;
  - depository statements;
  - password-protected consolidated account statements, read on the phone;
  - JSON pasted into the paste box.
- **Holdings:**
  - multiple portfolios with an All view;
  - mutual funds valued at NAV, and ETFs;
  - a watchlist with price alerts;
  - filings alerts (results, board meetings, dividends …);
  - app lock (fingerprint / screen lock);
  - a home-screen widget.
- **Opening files:** files can be opened with or shared to the app.
- **Reopens the last screen.** The About page links to the project's repository.
- **Fixed:**
  - background notifications and alerts never ran: a permission was missing;
  - broken sector moves for REITs / InvITs;
  - saving holdings on some phones;
  - a crash at launch (crashes are now recorded and shown on the next launch).

## 1.7 and earlier
- Feed, Markets, Sectors, Search, stock and index screens, themes and the Sector Performance view; see `README.md`.
