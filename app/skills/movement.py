"""Flags tickers with a big price % move."""
PCT_THRESHOLD = 5.0


def filter(tickers):
    return [t for t in tickers if abs(t["changePercent"]) >= PCT_THRESHOLD]
