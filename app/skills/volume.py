"""Flags tickers trading well above their average volume."""
MULTIPLIER = 2.0


def filter(tickers):
    return [t for t in tickers if t["volume"] >= MULTIPLIER * t["avgVolume"]]
