import sys
from pathlib import Path

# Run as a script, so the repo root has to go on sys.path before importing app.* - the package
# is not installed, it just sits at the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.stocks_master import board_for, parse_csv

HEADER = (
    b"SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\n"
)

if __name__ == "__main__":
    csv_bytes = (
        HEADER
        + b"20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5\n"
        + b",Blank symbol row - should be skipped,EQ,01-JAN-2020,10,1,INE000000000,10\n"
    )
    rows = parse_csv(csv_bytes)
    assert len(rows) == 1, f"expected blank-symbol row to be skipped, got {rows}"
    row = rows[0]
    assert row["symbol"] == "20MICRONS", row
    assert row["name"] == "20 Microns Limited", row
    assert row["series"] == "EQ", row
    assert row["listing_date"].isoformat() == "2008-10-06", row
    assert row["isin"] == "INE144J01027", row
    assert row["board"] == "MAIN", row
    assert row["market_lot"] == 1, row
    assert row["face_value"] == 5.0, row

    # The EMERGE (SME) export has the same columns; only the series code says which board a row is
    # on, and its market lot is the number that makes an SME order legal or not.
    sme_rows = parse_csv(
        HEADER
        + b"ABCSME,Abc Emerge Limited,SM,12-JUL-2023,10,2000,INE111X01011,10\n"
        + b"DEFSME,Def Emerge Limited,ST,01-FEB-2024,10,1600,INE222X01011,10\n"
    )
    assert [r["board"] for r in sme_rows] == ["SME", "SME"], sme_rows
    assert [r["market_lot"] for r in sme_rows] == [2000, 1600], sme_rows

    # A forced board overrides the series (for an export whose SERIES column is blank), and a blank
    # series alone must never silently become SME.
    forced = parse_csv(HEADER + b"NOSERIES,No Series Ltd,,01-JAN-2020,10,1,INE333X01011,10\n", "SME")
    assert forced[0]["board"] == "SME", forced
    assert parse_csv(HEADER + b"NOSERIES,No Series Ltd,,01-JAN-2020,10,1,INE333X01011,10\n")[0]["board"] == "MAIN"

    # Garbage in the numeric columns is dropped, not fatal - the row is still worth having.
    messy = parse_csv(HEADER + b"MESSY,Messy Ltd,EQ,01-JAN-2020,10,-,INE444X01011,\n")
    assert messy[0]["market_lot"] is None and messy[0]["face_value"] is None, messy

    # NSE's exports don't agree on column names: the SME list that shipped in production used
    # "Company Name"/"ISIN Code"/"Lot Size" and imported 558 rows with every field but symbol and
    # series blank. Headers are matched case- and punctuation-insensitively, with aliases.
    aliased = parse_csv(
        b"Symbol,Company Name,Series,ISIN Code,Date of Listing,Lot Size,Face Value\n"
        b"xyzsme,Xyz Emerge Ltd,sm,INE555X01011,2023-07-12,\"1,200\",10\n"
    )[0]
    assert aliased["symbol"] == "XYZSME", aliased
    assert aliased["name"] == "Xyz Emerge Ltd", aliased
    assert aliased["series"] == "SM" and aliased["board"] == "SME", aliased
    assert aliased["isin"] == "INE555X01011", aliased
    assert aliased["listing_date"].isoformat() == "2023-07-12", aliased
    assert aliased["market_lot"] == 1200, aliased

    assert board_for("SM") == "SME" and board_for("EQ") == "MAIN" and board_for(None) == "MAIN"
    print("ok:", row)
