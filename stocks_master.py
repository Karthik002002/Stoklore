"""Parses NSE's listed-equity master CSV (nseindia.com EQUITY_L.csv) into the row shape
db.upsert_stocks_master expects. Only SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, and ISIN
NUMBER are kept - the export also has PAID UP VALUE/MARKET LOT/FACE VALUE columns nothing here uses.
"""
import csv
import io
from datetime import datetime


def parse_csv(raw: bytes):
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        symbol = row.get("SYMBOL")
        if not symbol:
            continue
        listing_date = None
        if row.get("DATE OF LISTING"):
            listing_date = datetime.strptime(row["DATE OF LISTING"], "%d-%b-%Y").date()
        rows.append({
            "symbol": symbol.upper(),
            "name": row.get("NAME OF COMPANY", ""),
            "series": row.get("SERIES") or None,
            "listing_date": listing_date,
            "isin": row.get("ISIN NUMBER") or None,
        })
    return rows
