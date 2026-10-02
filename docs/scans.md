# Chart Scans

[← Back to index](README.md)

A swing trader's daily pass over a list of stocks, without touching the symbol box: the chart
modal flips through the list **one chart at a time**, like a slideshow, and you mark each stock
**A / B / C** as it goes by. Then you review the marks by priority, trade the A's, and save the
picks to a watchlist for tomorrow.

## Starting a scan

- **A watchlist**: on **Scans** (left rail, or `⌘K → Scans`), pick a watchlist and press *Scan N
  stocks*. It runs in the watchlist's own order.
- **Any stock table**: the ▶ *Scan* button in the chart column's header scans exactly the rows the
  table shows. That covers the home page's watchlist table (the open tab), NSE gainers and losers,
  Unusual Attention, Recent Events, and any dashboard or board table with a symbol column.

A scan keeps its own copy of the list, so it stays a record after the watchlist changes.

## Scanning

It's the chart modal: the Bar Replay chart with your saved indicators and settings, your paper
positions and alerts on it, and the paper order ticket (hidden at first, the panel icon brings it
back). The header adds the scan controls:

| Key | |
|---|---|
| `→` / `l` | next chart |
| `←` / `h` | previous |
| `Space` | play / pause the timer: a new chart every *N* seconds (2–20 s, remembered) |
| `1` `2` `3` | mark **A** act now, **B** watch closely, **C** maybe later. Marking pauses the timer, so a decision is never rushed |
| `0` | clear the mark |
| `N` | write a note on the stock; `Enter` saves it, `Esc` leaves the box |

The thin bar under the chart is the timer. The next stock's chart loads while you read this one,
so a flip is instant. The timeframe (any of `1m`–`4H` intraday, or 1D … MAX) stays the same across the whole scan, and so
does the **framing**: however you zoom and pan one chart (how many candles fit, and how much empty
space sits between the last candle and the price axis), the next stock opens the same way. The
framing is saved in the browser (`chartFrame` in the Bar Replay store), so it also carries over to
the next visit and to every position chart.

Each mark is saved as you make it, along with the last price on the chart at that moment. Closing
the modal keeps your place, and **Resume** starts where you left off. At the end you get *Scan
finished* with the A/B/C counts and a link to the review.

You can trade mid-scan: open the ticket and place a paper order, or right-click the chart to arm
an alert. The keys pause while you're typing in any field.

## Reviewing (`/scans/<id>`)

- The marked stocks in three columns, **A**, **B** and **C**, each with its note and the price it
  was marked at. The chart icon opens that stock in the chart modal to trade or set an alert;
  clicking the name reopens the scan at that stock.
- **Save to a watchlist**: tick A, B and/or C and name the list (default `Scan 1 Oct AB`). The
  stocks are added to it, and it's created if it doesn't exist.
- **Rescan A+B**: a new scan of only the A and B picks, for a second, slower pass.
- **Scans** lists every scan with its source, progress and A/B/C counts. That history shows how
  earlier A-picks played out.

## How it's built

- `scans` and `scan_marks` (Postgres): a scan's list, position and finished time; one mark per
  stock per scan (priority, note, price). Deleting a scan deletes its marks.
- `app/routers/scans.py`: `POST/GET /api/scans`, `GET/PATCH/DELETE /api/scans/{id}`,
  `PUT /api/scans/{id}/marks/{symbol}` (no priority and no note = cleared), and
  `POST /api/scans/{id}/watchlist`.
- Frontend: scan mode in `components/ChartModal.tsx` (`startScan`, `resumeScan`, `ScanButton`) and
  the pages in `Scans.tsx`.
