// Called by tests/journal_math.selfcheck.py: the journal's own TypeScript formulas, run on the trades
// passed in, printed as JSON for Python to compare against app/services/journal_math.py.
import { autoResult, expectedR, actualRiskAmount, sessionFor, tradePnl, tradeRR, tradeRRDisplay, tradeReturnPct } from '../frontend/src/lib/manualTrades.ts'
import { tradeCosts, tradeNetPnl, tradeNetReturnPct } from '../frontend/src/lib/tradeCosts.ts'

const cases = JSON.parse(process.argv[2])
const out = cases.map(({ trade, account }) => {
  const display = tradeRRDisplay(trade)
  return {
    pnl: tradePnl(trade),
    return_pct: tradeReturnPct(trade),
    planned_rr: tradeRR(trade),
    realised_rr: display && !display.planned ? display.rr : null,
    r_multiple: expectedR(trade),
    risk_amount: actualRiskAmount(trade),
    auto_result: autoResult(trade),
    costs: tradeCosts(trade, account)?.total ?? null,
    net_pnl: tradeNetPnl(trade, account),
    net_return_pct: tradeNetReturnPct(trade, account),
    session: trade.traded_at ? sessionFor(trade) : null,
  }
})
console.log(JSON.stringify(out))
