# Backtesting — Manual (Trade Journal)

[← Back to index](README.md)

## Using it

- `/backtesting` (currently the only mode on this page — see
  [Backtesting — Auto](backtesting-auto.md) for why) — **Add Trade** to log
  a trade by hand (symbol,
  direction, entry/exit, stop-loss/target, emotion, tags, notes, an
  optional screenshot).
- **Bulk Trades** to import several trades at once from screenshots — each
  image is analyzed and its fields pre-filled for you to confirm.
- The **Overview** tab shows P&L stats, daily win/loss and cumulative P&L
  charts, and a calendar heatmap (opens on the month of your most recent
  trade, not necessarily this month).
- **Bar Replay** button opens the bar-by-bar replay tool ([docs](bar-replay.md))
  — trades you log there land in this same journal, tagged `replay`.

## How it works

**P&L, R:R, and return% are never stored** — the `manual_trades` table
holds only the raw inputs (direction, quantity, entry/exit, stop-loss,
target). Every derived number is recomputed at read time from those raw
fields, so editing a trade's exit price later can never leave a stale P&L
sitting around from before the edit.

**Screenshots** upload to a local `uploads/` folder (mounted and served
directly at `/uploads/...`) named `{trade_id}-{random}`. The trades API
response includes a ready-to-use `image_url` (built server-side from the
request's own host) for every trade that has one, rather than the frontend
having to guess the upload path itself.

**Bulk import is one LLM vision call per screenshot**, not OCR or a
template matcher: the image is base64-encoded and sent with a prompt asking
for whichever of `symbol`, `direction`, `entry_price`, `exit_price`,
`stop_loss`, `target`, `traded_at`, `notes` it can actually read off the
image — explicitly instructed never to guess or invent a number. Each
returned field is only kept if it passes a basic type/non-empty check, so
a partially-malformed reply degrades to some fields left blank for you to
fill in, rather than the whole import failing.

**Overview's stats**: `totalPnl` sums every closed trade's P&L (long:
`(exit-entry)*qty`, short: sign-flipped). `winRate` is wins ÷ closed trades.
`profitFactor` is gross profit ÷ gross loss (`null` if you have no losing
trades yet — dividing by zero would be misleading, not infinite-good).
`avgPnl` is total P&L ÷ number of closed trades.

**The calendar heatmap defaults to today's month, then jumps once** to the
month containing your most recent trade the moment trade data actually
loads — this is what stops it from opening on an empty "current month"
when, say, all your logged trades are from a Bar Replay session set years
in the past. A "Today" button is still there to get back to the real
current month.
