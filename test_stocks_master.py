from stocks_master import parse_csv

if __name__ == "__main__":
    csv_bytes = (
        b"SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\n"
        b"20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5\n"
        b",Blank symbol row - should be skipped,EQ,01-JAN-2020,10,1,INE000000000,10\n"
    )
    rows = parse_csv(csv_bytes)
    assert len(rows) == 1, f"expected blank-symbol row to be skipped, got {rows}"
    row = rows[0]
    assert row["symbol"] == "20MICRONS", row
    assert row["name"] == "20 Microns Limited", row
    assert row["series"] == "EQ", row
    assert row["listing_date"].isoformat() == "2008-10-06", row
    assert row["isin"] == "INE144J01027", row
    print("ok:", row)
