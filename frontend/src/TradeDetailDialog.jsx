import { useState } from 'react'
import { PencilIcon } from 'lucide-react'
import ImageLightbox from '@/components/ImageLightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDateTime, inr } from '@/lib/format'
import {
  actualRiskAmount,
  expectedR,
  lossExceededStop,
  RESULT_META,
  riskDeviationPct,
  sessionFor,
  tradePnl,
  tradeReturnPct,
  tradeRR,
} from '@/lib/manualTrades'
import { stopOverrunPct, targetCapturePct } from '@/lib/tradeStats'
import { contextGap, contextReadings, excursionReading, hasContext } from '@/lib/tradeContext'

const TONE_CLASS = { good: 'text-up', bad: 'text-down', warn: 'text-amber-600', neutral: '' }

function Stat({ label, value, tone, sub }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${TONE_CLASS[tone] ?? ''}`}>{value ?? '—'}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

// How far the trade ran either way, drawn against the stop distance so both bars are in the same
// unit (R) the rest of the journal thinks in.
function ExcursionBars({ ex }) {
  const scale = Math.max(ex.maeR ?? 0, ex.mfeR ?? 0, Math.abs(ex.capturedR ?? 0), 1)
  const width = (v) => `${Math.min((Math.abs(v) / scale) * 100, 100)}%`
  const rows = [
    { label: 'Heat taken (MAE)', v: ex.maeR, pct: ex.maePct, cls: 'bg-down' },
    { label: 'Best it reached (MFE)', v: ex.mfeR, pct: ex.mfePct, cls: 'bg-up' },
    { label: 'You kept', v: ex.capturedR, pct: null, cls: 'bg-primary' },
  ]
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-xs text-muted-foreground">{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
            {r.v != null && <div className={`h-full ${r.cls}`} style={{ width: width(r.v) }} />}
          </div>
          <span className="w-28 shrink-0 text-right text-xs tabular-nums">
            {r.v == null ? '—' : `${r.v}R`}
            {r.pct != null && <span className="text-muted-foreground"> · {r.pct}%</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function TradeDetailDialog({ open, onOpenChange, trade, onEdit }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  if (!trade) return null

  const pnl = tradePnl(trade)
  const returnPct = tradeReturnPct(trade)
  const meta = trade.result ? RESULT_META[trade.result] : null
  const readings = contextReadings(trade)
  const gap = contextGap(trade)
  const ex = excursionReading(trade)

  const capture = targetCapturePct(trade)
  const overrun = stopOverrunPct(trade)
  const deviation = riskDeviationPct(trade)
  const r = expectedR(trade)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85%] w-[70%] !max-w-[70%] flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span>{trade.symbol}</span>
              <Badge variant="secondary" className="capitalize">
                {trade.direction}
              </Badge>
              {trade.is_open ? (
                <Badge variant="outline">Open</Badge>
              ) : (
                meta && <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
              )}
              {trade.setup && <Badge variant="outline">{trade.setup}</Badge>}
              <span className="ml-auto flex items-center gap-3">
                <span className={`text-lg tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {inr(pnl)}
                </span>
                <Button size="sm" variant="outline" onClick={() => onEdit(trade)}>
                  <PencilIcon className="size-3.5" /> Edit
                </Button>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <Section title="The trade">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Entry" value={inr(trade.entry_price)} sub={`${trade.quantity} qty`} />
                <Stat
                  label="Exit"
                  value={trade.exit_price != null ? inr(trade.exit_price) : 'Still open'}
                  sub={returnPct != null ? `${returnPct}%` : undefined}
                />
                <Stat label="Stop" value={trade.stop_loss != null ? inr(trade.stop_loss) : null} />
                <Stat label="Target" value={trade.target != null ? inr(trade.target) : null} />
                <Stat label="Opened" value={formatDateTime(trade.traded_at)} sub={sessionFor(trade)} />
                <Stat
                  label="Closed"
                  value={trade.exited_at ? formatDateTime(trade.exited_at) : null}
                  sub={trade.exited_at ? undefined : 'Not recorded'}
                />
                <Stat label="Planned R:R" value={tradeRR(trade) != null ? `${tradeRR(trade)}` : null} />
                <Stat
                  label="Result in R"
                  value={r != null ? `${r}R` : null}
                  tone={r == null ? undefined : r >= 0 ? 'good' : 'bad'}
                />
              </div>
            </Section>

            <Section
              title="Execution"
              hint="How closely the trade followed its own plan — independent of whether it made money."
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Risk taken"
                  value={actualRiskAmount(trade) != null ? inr(actualRiskAmount(trade)) : null}
                  sub={trade.ideal_risk_amount ? `planned ${inr(trade.ideal_risk_amount)}` : 'no plan set'}
                />
                <Stat
                  label="Risk deviation"
                  value={deviation != null ? `${deviation > 0 ? '+' : ''}${deviation}%` : null}
                  tone={deviation == null ? undefined : Math.abs(deviation) > 10 ? 'warn' : 'good'}
                  sub={deviation == null ? undefined : deviation > 0 ? 'over-risked' : 'under-risked'}
                />
                <Stat
                  label="Target capture"
                  value={capture != null ? `${capture}%` : null}
                  tone={capture == null ? undefined : capture >= 90 ? 'good' : 'warn'}
                  sub={capture != null && capture < 90 ? 'closed before target' : undefined}
                />
                <Stat
                  label="Stop overrun"
                  value={overrun != null ? `${overrun}%` : null}
                  tone={overrun == null ? undefined : overrun > 100 ? 'bad' : 'good'}
                  sub={lossExceededStop(trade) ? 'stop was not honoured' : undefined}
                />
              </div>
            </Section>

            <Section
              title="How far it ran"
              hint="Maximum Adverse / Favourable Excursion — the heat taken before it worked, against the best it ever offered."
            >
              {ex ? (
                <>
                  <ExcursionBars ex={ex} />
                  <div className="space-y-1 pt-1">
                    {ex.leftOnTableR != null && (
                      <p className="text-xs text-muted-foreground">
                        It reached <span className="text-up">{ex.mfeR}R</span> before you closed at{' '}
                        {ex.capturedR}R —{' '}
                        <span className="font-medium text-foreground">
                          {ex.leftOnTableR}R left on the table
                        </span>{' '}
                        over {ex.bars} bars.
                      </p>
                    )}
                    {ex.stopTooWide && (
                      <p className="text-xs text-muted-foreground">
                        Only took {ex.maeR}R of heat before working — a tighter stop would have survived this
                        one. Worth checking across all your winners before acting on a single trade.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {trade.exited_at
                    ? 'No price bars covering the holding period.'
                    : 'Add a close date to this trade to see how far it ran either way.'}
                </p>
              )}
            </Section>

            <Section
              title="Market at entry"
              hint="Captured once when the trade was logged, from the 100 bars before entry. Never recalculated."
            >
              {hasContext(trade) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {readings.map((x) => (
                    <div key={x.label} className="rounded-lg border bg-card p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs tracking-wide text-muted-foreground uppercase">{x.label}</p>
                        <p className={`text-sm font-semibold ${TONE_CLASS[x.tone] ?? ''}`}>{x.value}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{x.note}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{gap}</p>
              )}
            </Section>

            {(trade.notes || trade.tags?.length > 0 || trade.emotion || trade.image_url) && (
              <Section title="Your notes">
                <div className="space-y-2">
                  {(trade.emotion || trade.tags?.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {trade.emotion && <Badge variant="secondary">{trade.emotion}</Badge>}
                      {(trade.tags ?? []).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {trade.notes && <p className="text-sm whitespace-pre-wrap">{trade.notes}</p>}
                  {trade.image_url && (
                    <img
                      src={trade.image_url}
                      alt="Trade"
                      className="max-h-64 cursor-pointer rounded-lg border"
                      onClick={() => setLightboxOpen(true)}
                    />
                  )}
                </div>
              </Section>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ImageLightbox src={trade.image_url} open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  )
}
