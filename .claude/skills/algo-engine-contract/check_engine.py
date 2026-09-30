"""Conformance check for an algo engine Stoklore drives (see SKILL.md next to this file).

    .venv/bin/python .claude/skills/algo-engine-contract/check_engine.py <engine folder> [strategy]

Writes synthetic 5m bars for two symbols (three sessions, a wave the default strategies trade),
calls build/backtest the way app/routers/engine.py and app/core/autotune.py do, and asserts every
shape and invariant Stoklore relies on. Exit 0 = Stoklore can drive it; otherwise the first broken
rule is printed. Touches nothing but a temp folder.
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

SUMMARY = ["net", "gross", "costs", "trades", "win_rate", "avg_win", "avg_loss", "max_dd", "sharpe",
           "profit_factor", "expectancy", "avg_hold_min", "trades_per_day", "ret_dd", "days", "from", "to"]
DAY0 = 1767571200  # 2026-01-05, a Monday, 00:00 on the IST-read-as-UTC clock
failures = []


def check(ok, rule):
    print(("  ok    " if ok else "  FAIL  ") + rule)
    if not ok:
        failures.append(rule)
    return ok


def run(binary, root, *args):
    res = subprocess.run([str(binary), *map(str, args)], cwd=root, capture_output=True, text=True, timeout=600)
    return res.returncode, res.stdout, res.stderr


def bars_csv(folder, symbol, phase):
    rows = []
    for d in range(3):
        for i in range(75):  # 09:15 .. 15:25, 5m
            t = DAY0 + d * 86400 + 9 * 3600 + 15 * 60 + i * 300
            c = 1000 + 40 * math.sin((d * 75 + i) / 6 + phase) + d * 5
            rows.append(f"{t},{c - 1:.2f},{c + 3:.2f},{c - 3:.2f},{c:.2f},{1000 + i}")
    path = Path(folder) / f"{symbol}_5m.csv"
    path.write_text("time,open,high,low,close,volume\n" + "\n".join(rows) + "\n")
    return path


def skip(rule, why):
    print(f"  skip  {rule} ({why})")


def report_ok(rep, label):
    """The run-report rules of SKILL.md 4.2."""
    s = rep.get("summary", {})
    check(all(isinstance(s.get(k), (int, float)) for k in SUMMARY), f"{label}: summary has every numeric field")
    check(abs(s.get("gross", 0) - (s.get("net", 0) + s.get("costs", 0))) < 1e-6, f"{label}: gross = net + costs")
    trades = rep.get("trades", [])
    check(s.get("trades") == len(trades), f"{label}: summary.trades = len(trades)")
    check(all(len(t) == 7 and isinstance(t[0], str) and t[3] != 0 for t in trades),
          f"{label}: trades are [symbol, t_in, t_out, signed qty, px_in, px_out, gross pnl]")
    check(all(t[1] <= t[2] for t in trades), f"{label}: every trade exits at/after it entered")
    eq = rep.get("equity", [])
    check(bool(eq) and all(a[0] < b[0] for a, b in zip(eq, eq[1:])), f"{label}: equity times strictly increasing")
    check(bool(eq) and s.get("from") == eq[0][0] and s.get("to") == eq[-1][0], f"{label}: summary from/to = equity ends")
    daily = rep.get("daily", [])
    check(s.get("days") == len(daily) and all(d[0] % 86400 == 0 for d in daily), f"{label}: daily = one [day start, pnl] per day")
    check(abs(sum(d[1] for d in daily) - s.get("net", 0)) < 1e-4, f"{label}: daily P&L sums to net")
    by = rep.get("by_symbol", {})
    check(abs(sum(v["pnl"] for v in by.values()) - sum(t[6] for t in trades)) < 1e-4
          and sum(v["trades"] for v in by.values()) == len(trades), f"{label}: by_symbol adds up to the trades")
    check(isinstance(rep.get("params"), dict) and rep["params"].get("cost_bps") == 3,
          f"{label}: params are the merged set, echoing the cost_bps passed")
    return s, trades, eq


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1]).expanduser()
    binary = root / "build" / "backtest"
    if not check(binary.exists(), f"{binary} exists"):
        sys.exit(1)

    print("--list")
    code, out, err = run(binary, root, "--list")
    listing = json.loads(out) if code == 0 else []
    check(code == 0 and isinstance(listing, list) and listing, "prints a non-empty JSON list")
    check(all(isinstance(x.get("name"), str) and isinstance(x.get("params"), dict)
              and all(isinstance(v, (int, float)) for v in x["params"].values()) for x in listing),
          "each strategy is {name, params: {numbers}}")
    names = [x["name"] for x in listing]
    strategy = sys.argv[2] if len(sys.argv) > 2 else names[0]
    if not check(strategy in names, f"strategy {strategy} is listed"):
        sys.exit(1)
    defaults = next(x["params"] for x in listing if x["name"] == strategy)
    check("qty" in defaults, "the strategy has a qty param (sizing scales it)")

    with tempfile.TemporaryDirectory() as tmp:
        files = [bars_csv(tmp, "AAA", 0), bars_csv(tmp, "BBB", 1.5)]

        print(f"single run: {strategy} --json")
        code, out, err = run(binary, root, strategy, *files, "qty=10", "cost_bps=3", "--json")
        if not check(code == 0, f"exits 0 ({err.strip()[:120]})"):
            sys.exit(1)
        rep = json.loads(out)
        s, trades, eq = report_ok(rep, "run")
        check(rep.get("strategy") == strategy and rep["params"].get("qty") == 10, "reports its strategy and merged params")
        if not trades:
            skip("trade-level checks", f"{strategy} took no trades on the synthetic bars - its entry filters reject a plain wave")
        check(all((t[1] // 86400) == (t[2] // 86400) and t[2] % 86400 <= 15 * 3600 + 15 * 60 for t in trades),
              "intraday: every trade closes the same session, by the 15:15 square-off")
        check(run(binary, root, strategy, *files, "qty=10", "cost_bps=3", "--json")[1] == out, "deterministic: same args, same stdout")

        print("costs")
        free = json.loads(run(binary, root, strategy, *files, "qty=10", "cost_bps=0", "--json")[1])
        check(free["summary"]["costs"] == 0 and abs(free["summary"]["gross"] - s["gross"]) < 1e-6,
              "cost_bps=0 charges nothing and leaves gross unchanged")

        print("--overnight")
        code, out, err = run(binary, root, strategy, *files, "qty=10", "cost_bps=3", "--json", "--overnight")
        check(code == 0, "accepted")
        if code == 0:
            report_ok(json.loads(out), "overnight")

        print("--trade-from")
        ts = DAY0 + 86400 + 9 * 3600 + 15 * 60  # the second session's open
        code, out, err = run(binary, root, strategy, *files, "qty=10", "--json", f"--trade-from={ts}")
        if check(code == 0, "accepted"):
            w = json.loads(out)
            check(w["equity"][0][0] >= ts, "equity starts at the trade-from time (walk-forward refuses otherwise)")
            check(all(t[1] >= ts for t in w["trades"]), "nothing fills on the warm-up bars")

        print("sizing")
        fixed = run(binary, root, strategy, *files, "qty=10", "cost_bps=3", "--json")[1]
        zero = run(binary, root, strategy, *files, "qty=10", "cost_bps=3", "sizing=0", "--json")[1]
        strip = lambda o: {**json.loads(o), "params": {k: v for k, v in json.loads(o)["params"].items() if k != "sizing"}}  # noqa: E731
        check(strip(zero) == json.loads(fixed), "sizing=0 trades exactly like no sizing")
        code, out, err = run(binary, root, strategy, *files, "qty=10", "sizing=2", "capital=100000", "--json")
        if check(code == 0, "sizing=2 capital=100000 accepted"):
            allin = json.loads(out)
            check(allin["params"].get("capital") == 100000 and allin["params"].get("sizing") == 2,
                  "reports sizing/capital in params")
            if allin["trades"]:
                check(any(abs(t[3]) != 10 for t in allin["trades"]), "all-in sizes from the account, not from qty")
            else:
                skip("all-in sizing", "no trades to size")
        code, out, err = run(binary, root, strategy, *files, "sizing=1", "--json")
        check(code != 0 and err.strip() and not out.strip(), "sizing without capital: non-zero exit, stderr message, no JSON")
        code, out, err = run(binary, root, strategy, *files, "qty=10", "sizing=1", "capital=100000", "carry=50000", "--json")
        check(code == 0 and json.loads(out)["params"].get("carry") == 50000, "carry accepted and reported")

        print("sweeps")
        p = next((k for k in defaults if k != "qty"), "qty")
        v = defaults[p]
        vals = f"{v:g},{v + 1:g}"
        code, out, err = run(binary, root, strategy, *files, f"{p}={vals}", "qty=10", "--sweep=grid")
        if check(code == 0, f"grid over {p}={vals} ({err.strip()[:120]})"):
            sw = json.loads(out)
            check(sw.get("mode") == "grid" and sw.get("axes", {}).get(p) == [v, v + 1], "reports mode and axes as parsed values")
            check(len(sw.get("runs", [])) == 2, "one run per combination")
            check(all(set(r) >= {"params", "axis", "summary", "spark"} and isinstance(r["spark"], list) for r in sw["runs"]),
                  "each run is {params, axis, summary, spark}")
            check(all(all(k in r["summary"] for k in SUMMARY) for r in sw["runs"]), "sweep summaries have every field")
            check(sw.get("base", {}).get("qty") == 10, "fixed params land in base")
        code, out, err = run(binary, root, strategy, *files, f"{p}={v:g}:{v + 2:g}:1", "qty=10", "--sweep=oat")
        if check(code == 0, "oat with a from:to:step range"):
            sw = json.loads(out)
            check(sw["runs"][0]["axis"] == "" and len(sw["runs"]) == 3, "oat: the base run first, then each other value once")
        code, out, err = run(binary, root, strategy, *files, "qty=10", "--sweep=grid")
        check(code != 0 and err.strip() and not out.strip(), "nothing to sweep: non-zero exit and a stderr message")
        code, out, err = run(binary, root, strategy, *files, f"{p}={vals}", "sizing=1", "--sweep=grid")
        check(code != 0 and err.strip(), "bad sizing in a sweep fails cleanly (validated before threads)")
        code, out, err = run(binary, root, strategy, *files, f"{p}={vals}", "qty=10", "--sweep=grid", f"--trade-from={ts}")
        check(code == 0 and all(r["summary"]["from"] >= ts for r in json.loads(out)["runs"]) if code == 0 else False,
              "sweep honours --trade-from (walk-forward's unseen-bars grid)")

        print("errors")
        code, out, err = run(binary, root, "no_such_strategy", *files, "--json")
        check(code != 0 and not out.strip().startswith("{"), "unknown strategy: non-zero exit, no report")

    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed - Stoklore can drive this engine")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
