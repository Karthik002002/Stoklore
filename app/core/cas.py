"""CAS PDF -> net-worth items. A Consolidated Account Statement is the closest thing to a bank
sync an individual in India can get: CDSL/NSDL email one every month covering every demat account
(stocks, bonds, demat MF units, NPS), and CAMS/KFintech cover every mutual fund folio. Parsing is
casparser's; this module only turns its output into (external_key, name, kind, asset_class, value)
rows the finance tables store.

Keys decide what one item is, so a re-imported statement updates the same item:
  isin:<ISIN>               - a mutual fund held in folio (SoA) form. CAMS, KFintech AND the
                              NSDL/CDSL statements all list these, so they share a key and two
                              statements never double count the same units. Folios of one scheme sum.
  demat:<id>:equity         - one demat account's stocks, summed (per-stock items would be noise
                              for goal tracking; the journal and holdings pages are for stocks).
  demat:<id>:bonds          - that account's bonds, summed.
  demat:<id>:mf:<ISIN>      - MF units held IN demat - different units from the folio ones.
  nps:<scheme>              - one NPS scheme.
"""

from datetime import datetime

DEBT_WORDS = ("DEBT", "LIQUID", "GILT", "MONEY MARKET", "OVERNIGHT", "BOND")


def _float(v):
    return float(v or 0)


def _mf_class(scheme_type, name):
    text = f"{scheme_type or ''} {name or ''}".upper()
    return "debt" if any(w in text for w in DEBT_WORDS) else "equity"


def _clean(name):
    """CDSL prefixes security names with the issuer: 'NIPPON LIFE INDIA AM LTD#NIPPON INDIA MF-...'
    - the part after the last '#' is the name people know, and newlines are PDF line wraps."""
    return " ".join((name or "").split("#")[-1].split()) or "Unnamed holding"


def parse_period_end(text):
    """CAS dates come as 31-Oct-2026 (CAMS/NSDL) or 31/10/2026 / 31-10-2026 (CDSL variants)."""
    for fmt in ("%d-%b-%Y", "%d/%b/%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text.strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def holdings(data):
    """data: casparser's output as a plain dict (read() below).
    Returns (as_of date | None, [row]) with one row per item key, values summed."""
    rows = {}

    def add(key, name, kind, asset_class, value, position=None):
        row = rows.setdefault(key, {"key": key, "name": name, "kind": kind, "asset_class": asset_class,
                                    "value": 0.0, "positions": []})
        row["value"] += _float(value)
        if position and position["isin"] and _float(position["units"]):
            row["positions"].append({**position, "units": _float(position["units"]), "price": _float(position["price"])})

    def add_folio_mf(isin, name, scheme_type, value, fallback_key, units, nav):
        key = f"isin:{isin}" if isin else fallback_key
        add(key, _clean(name), "mf", _mf_class(scheme_type, name), value,
            {"isin": isin, "name": _clean(name), "units": units, "price": nav, "symbol": None})

    for folio in data.get("folios") or []:  # CAMS / KFintech
        for s in folio.get("schemes") or []:
            v = s.get("valuation") or {}
            add_folio_mf(s.get("isin"), s.get("scheme"), s.get("type"), v.get("value"),
                         f"folio:{folio.get('folio')}:{s.get('scheme')}", s.get("close"), v.get("nav"))

    for acct in data.get("accounts") or []:  # NSDL / CDSL
        if "folio" in (acct.get("type") or "").lower():  # "Mutual Fund Folios" - SoA, same as CAMS
            for mf in acct.get("mutual_funds") or []:
                add_folio_mf(mf.get("isin"), mf.get("name"), mf.get("type"), mf.get("value"),
                             f"folio:{mf.get('folio')}:{mf.get('name')}", mf.get("balance"), mf.get("nav"))
            continue
        acct_id = f"{acct.get('dp_id') or ''}{acct.get('client_id') or ''}" or acct.get("name")
        label = f"{acct.get('name')} ({acct.get('type')})"
        for eq in acct.get("equities") or []:
            # casparser backfills the trading symbol from its ISIN db; only NSE ones price through
            # our quote path as-is (fin_live.nse_symbol fills the rest at import).
            add(f"demat:{acct_id}:equity", f"{label} stocks", "stock", "equity", eq.get("value"),
                {"isin": eq.get("isin"), "name": _clean(eq.get("name")), "units": eq.get("num_shares"),
                 "price": eq.get("price"), "symbol": eq.get("symbol") if eq.get("exchange") == "NSE" else None})
        for b in acct.get("bonds") or []:
            add(f"demat:{acct_id}:bonds", f"{label} bonds", "other", "debt", b.get("value"))
        for mf in acct.get("mutual_funds") or []:
            add(f"demat:{acct_id}:mf:{mf.get('isin')}", f"{_clean(mf.get('name'))} (demat)", "mf",
                _mf_class(mf.get("type"), mf.get("name")), mf.get("value"),
                {"isin": mf.get("isin"), "name": _clean(mf.get("name")), "units": mf.get("balance"),
                 "price": mf.get("nav"), "symbol": None})

    for s in (data.get("nps") or {}).get("schemes") or []:
        add(f"nps:{s.get('scheme')}", f"NPS {s.get('scheme')}", "nps",
            "equity" if (s.get("asset_class") or "").upper() == "E" else "debt", s.get("value"))

    period = data.get("statement_period") or {}
    return parse_period_end(period.get("to") or ""), [
        {**r, "value": round(r["value"], 2)} for r in rows.values()
    ]


def coverage_warnings(data, rows):
    """casparser can drop an account without raising (see _patch_cdsl_summary_row), which would
    read as "imported, nothing to record". Two checks so a miss is always said out loud: nothing
    found at all, and demat holdings not adding up to the account totals the statement prints."""
    if not rows:
        return ["No holdings were found in this statement. If it shows a portfolio value, the parser missed it."]
    printed = sum(_float(a.get("balance")) for a in data.get("accounts") or [] if "folio" not in (a.get("type") or "").lower())
    parsed = sum(r["value"] for r in rows if r["key"].startswith("demat:"))
    if printed and abs(printed - parsed) > max(1.0, printed * 0.005):
        return [f"Demat holdings add up to {parsed:,.2f} but the statement's account totals say {printed:,.2f}."]
    return []


def _patch_cdsl_summary_row():
    """casparser 1.4.1 bug: on the CDSL summary page, a long broker name can extract AFTER its
    'DP Id: .. Client Id: ..' line, giving the row 5 cells - [type, DP/client, broker, count,
    value] - instead of 4 - [type, broker + DP/client, count, value]. The 4-cell check then drops
    the account silently, and every holding in it with it (seen on a real statement: 3 accounts,
    the only funded one lost). This folds that variant back into the shape casparser expects.
    ponytail: monkeypatch of a private function, pinned to casparser==1.4.1 - drop it when an
    upstream release fixes the row (re-test with a statement whose broker name wraps)."""
    from casparser.parsers import cdsl

    if getattr(cdsl, "_stoklore_patched", False):
        return
    original = cdsl._is_summary_demat_row

    def is_summary_demat_row(block):
        c = block.cells
        if (
            len(c) == 5
            and cdsl.DEMAT_TYPE_RE.match(c[0].text.strip())
            and cdsl.SUMMARY_DPC_RE.search(c[1].text)
            and not cdsl.SUMMARY_DPC_RE.search(c[2].text)
        ):
            c[1].text = f"{c[2].text}\n{c[1].text}"
            del c[2]
        return original(block)

    cdsl._is_summary_demat_row = is_summary_demat_row
    cdsl._stoklore_patched = True


def read(fileobj, password):
    """Parse a CAS PDF into a plain dict. casparser is imported here so the app still starts on a
    machine without it - only this upload needs it."""
    import casparser

    _patch_cdsl_summary_row()
    return casparser.read_cas_pdf(fileobj, password).model_dump(mode="json", by_alias=True)


if __name__ == "__main__":  # self-check: .venv/bin/python -m app.core.cas
    cams = {
        "statement_period": {"from": "01-Jan-2020", "to": "31-Oct-2026"},
        "folios": [
            {"folio": "1", "schemes": [
                {"scheme": "Axis Bluechip", "isin": "INF0", "type": "EQUITY", "close": "10", "valuation": {"nav": "100.05", "value": "1000.5"}},
                {"scheme": "HDFC Liquid", "isin": "INF1", "type": "DEBT", "valuation": {"value": "200"}},
            ]},
            {"folio": "2", "schemes": [
                {"scheme": "Axis Bluechip", "isin": "INF0", "type": "EQUITY", "close": "5", "valuation": {"nav": "100", "value": "500"}},
                {"scheme": "Old fund", "isin": None, "type": None, "valuation": {"value": "0"}},
            ]},
        ],
    }
    as_of, rows = holdings(cams)
    by = {r["key"]: r for r in rows}
    assert str(as_of) == "2026-10-31"
    assert by["isin:INF0"]["value"] == 1500.5  # two folios, one item
    assert [p["units"] for p in by["isin:INF0"]["positions"]] == [10.0, 5.0]
    assert by["folio:2:Old fund"]["positions"] == []  # no ISIN - nothing to reprice
    assert by["isin:INF1"]["asset_class"] == "debt"
    assert "folio:2:Old fund" in by

    nsdl = {
        "statement_period": {"from": "01/10/2026", "to": "31/10/2026"},
        "accounts": [
            {"name": "ZERODHA", "type": "CDSL Demat Account", "dp_id": "12", "client_id": "34",
             "equities": [{"isin": "INE1", "num_shares": "2", "price": "50", "value": "100", "symbol": "RELIANCE", "exchange": "NSE"},
                          {"isin": "INE2", "num_shares": "1", "price": "50", "value": "50", "symbol": "500325", "exchange": "BSE"}],
             "mutual_funds": [
                 {"name": "Nifty ETF FoF", "isin": "INF9", "type": "EQUITY", "value": "10"}],
             "bonds": [{"value": "70"}]},
            {"name": "MF", "type": "Mutual Fund Folios", "equities": [], "bonds": [],
             "mutual_funds": [{"name": "Axis Bluechip", "isin": "INF0", "type": "EQUITY", "value": "1500.5"}]},
        ],
        "nps": {"schemes": [{"scheme": "SBI E", "asset_class": "E", "value": "300"},
                            {"scheme": "SBI G", "asset_class": "G", "value": "100"}]},
    }
    as_of, rows = holdings(nsdl)
    by = {r["key"]: r for r in rows}
    assert str(as_of) == "2026-10-31"
    assert by["demat:1234:equity"]["value"] == 150 and by["demat:1234:equity"]["kind"] == "stock"
    assert by["demat:1234:bonds"]["asset_class"] == "debt" and by["demat:1234:bonds"]["positions"] == []
    assert [p["symbol"] for p in by["demat:1234:equity"]["positions"]] == ["RELIANCE", None]  # BSE code dropped
    assert by["demat:1234:mf:INF9"]["value"] == 10
    assert by["isin:INF0"]["value"] == 1500.5  # same key as the CAMS statement - no double count
    assert by["nps:SBI E"]["asset_class"] == "equity" and by["nps:SBI G"]["asset_class"] == "debt"
    assert parse_period_end("garbage") is None
    assert coverage_warnings(nsdl, rows) == [] or "add up" in coverage_warnings(nsdl, rows)[0]
    assert "No holdings" in coverage_warnings({"accounts": []}, [])[0]
    short = {"accounts": [{"type": "CDSL Demat Account", "balance": "1000"}]}
    assert "add up" in coverage_warnings(short, [{"key": "demat:x:equity", "value": 10}])[0]
    assert coverage_warnings(short, [{"key": "demat:x:equity", "value": 1000}]) == []
    assert _clean("NIPPON LIFE INDIA AM LTD#NIPPON INDIA MF-NIPPON\nINDIA ETF") == "NIPPON INDIA MF-NIPPON INDIA ETF"

    # the 5-cell summary row casparser 1.4.1 drops
    from dataclasses import dataclass

    @dataclass
    class C:
        text: str

    @dataclass
    class B:
        cells: list

    _patch_cdsl_summary_row()
    from casparser.parsers import cdsl
    row = B([C("CDSL Demat Account"), C("DP Id: 12081600 Client Id :12345678"), C("RAISE SECURITIES PRIVATE LIMITED"), C("4"), C("49,061.24")])
    assert cdsl._is_summary_demat_row(row) and len(row.cells) == 4
    assert cdsl._account_from_summary_row(row, [])[0].name == "RAISE SECURITIES PRIVATE LIMITED"
    ok = B([C("CDSL Demat Account"), C("ZERODHA\nDP Id: 1 Client Id :2"), C("0"), C("0.00")])
    assert cdsl._is_summary_demat_row(ok) and len(ok.cells) == 4
    print("cas selfcheck: all passed")
