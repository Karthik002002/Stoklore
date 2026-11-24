import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from './badge'
import { Button } from './button'
import { Toggle, ToggleGroup } from './button-group'
import { Checkbox, Radio, RadioGroup, Switch } from './choice'
import { Field, FieldDescription, FieldLabel, Label } from './field'
import { Input } from './input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from './input-group'
import { readTicket } from './marketMath'
import type { Side } from './marketMath'
import { Panel, PanelHeader, PanelTitle } from './panel'

const INR = (v: number, d = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const num = (s: string) => {
  const n = Number(s.replace(/,/g, ''))
  return s.trim() === '' || Number.isNaN(n) ? null : n
}

/** Buy | Sell as one big two-way switch, colored by side. */
function SideToggle({
  value,
  onValueChange,
  className,
}: {
  value: Side
  onValueChange: (s: Side) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Side"
      className={cn('grid grid-cols-2 overflow-hidden rounded-md border border-border', className)}
    >
      {(['buy', 'sell'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onValueChange(s)}
          className={cn(
            'h-7 text-2xs font-semibold tracking-[0.08em] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
            value !== s && 'text-muted-foreground hover:bg-muted',
            value === s && s === 'buy' && 'bg-up text-up-foreground',
            value === s && s === 'sell' && 'bg-down text-down-foreground',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

/** A price field that shows its distance from entry beside the label (OrderTicketParts' PriceField). */
function PriceInput({
  label,
  value,
  onChange,
  entry,
  invalid,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  entry: number | null
  invalid?: boolean
}) {
  const v = num(value)
  const dist = v != null && entry ? ((v - entry) / entry) * 100 : null
  return (
    <Field invalid={invalid}>
      <FieldLabel className="flex justify-between">
        {label}
        {dist != null && (
          <span
            className={cn(
              'tabular tracking-normal normal-case',
              dist > 0 ? 'text-up' : dist < 0 ? 'text-down' : '',
            )}
          >{`${dist > 0 ? '+' : ''}${dist.toFixed(2)}%`}</span>
        )}
      </FieldLabel>
      <Input
        numeric
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
      />
    </Field>
  )
}

export type TicketOrder = {
  side: Side
  product: 'CNC' | 'MIS' | 'NRML'
  type: 'LMT' | 'MKT' | 'SL'
  qty: number
  price: number | null
  stop: number | null
  target: number | null
  bracket: boolean
  journal: boolean
}

type OrderTicketProps = {
  symbol: string
  ltp: number
  /** Deployable cash; drives "% of wallet". */
  balance?: number
  account?: ReactNode
  defaultSide?: Side
  /** Rupees to risk per trade - sizes the quantity from the stop. */
  defaultRisk?: number
  warnings?: string[]
  onSubmit?: (order: TicketOrder) => void
  className?: string
}

/**
 * The order ticket: side, product, order type, price / stop / target, risk-based sizing, R:R,
 * value and % of wallet, then the action. Quantity follows the risk amount until you type one.
 * Sizing math is marketMath.readTicket (self-checked). New - pages each build their own today.
 */
function OrderTicket({
  symbol,
  ltp,
  balance,
  account,
  defaultSide = 'buy',
  defaultRisk = 2500,
  warnings = [],
  onSubmit,
  className,
}: OrderTicketProps) {
  const [side, setSide] = useState<Side>(defaultSide)
  const [product, setProduct] = useState<TicketOrder['product']>('CNC')
  const [type, setType] = useState<TicketOrder['type']>('LMT')
  const [price, setPrice] = useState(String(ltp))
  const [stop, setStop] = useState(String(Math.round(ltp * (defaultSide === 'buy' ? 0.97 : 1.03) * 20) / 20))
  const [target, setTarget] = useState(
    String(Math.round(ltp * (defaultSide === 'buy' ? 1.075 : 0.925) * 20) / 20),
  )
  const [risk, setRisk] = useState(String(defaultRisk))
  const [qtyTyped, setQtyTyped] = useState<string | null>(null)
  const [bracket, setBracket] = useState(true)
  const [journal, setJournal] = useState(true)

  const entry = type === 'MKT' ? ltp : num(price)
  const r = readTicket(side, entry, num(stop), num(target), num(risk))
  const qty = qtyTyped != null ? (num(qtyTyped) ?? 0) : (r.qtyForRisk ?? 0)
  const value = entry ? qty * entry : null
  const pctWallet = value != null && balance ? (value / balance) * 100 : null
  const actualRisk = r.riskPerShare ? r.riskPerShare * qty : null
  const stopBad = r.errors.some((e) => e.startsWith('Stop'))
  const targetBad = r.errors.some((e) => e.startsWith('Target'))
  const allWarnings = [
    ...r.errors.filter((e) => !e.startsWith('Stop') && !e.startsWith('Target')),
    ...(pctWallet != null && pctWallet > 25 ? [`Position is ${pctWallet.toFixed(0)}% of wallet`] : []),
    ...warnings,
  ]
  const canSubmit = qty > 0 && entry != null && !stopBad && !targetBad

  return (
    <Panel className={cn('w-full max-w-80', className)}>
      <PanelHeader>
        <PanelTitle>Order</PanelTitle>
        <span className="font-semibold">{symbol}</span>
        <span className="flex-1" />
        {account && <Badge variant="outline">{account}</Badge>}
      </PanelHeader>
      <div className="flex flex-col gap-2.5 p-2">
        <SideToggle
          value={side}
          onValueChange={(next) => {
            // keep the bracket valid: mirror stop and target around the entry
            const mirror = (v: string) => {
              const n = num(v)
              return n != null && entry ? String(Math.round((2 * entry - n) * 20) / 20) : v
            }
            if (next !== side) {
              setStop(mirror(stop))
              setTarget(mirror(target))
            }
            setSide(next)
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <RadioGroup
            value={product}
            onValueChange={(v) => setProduct(v as TicketOrder['product'])}
            aria-label="Product"
            className="gap-2.5"
          >
            {(['CNC', 'MIS', 'NRML'] as const).map((p) => (
              <Label key={p}>
                <Radio value={p} />
                {p}
              </Label>
            ))}
          </RadioGroup>
          <ToggleGroup
            size="sm"
            value={[type]}
            onValueChange={(v) => v[0] && setType(v[0] as TicketOrder['type'])}
            aria-label="Order type"
          >
            <Toggle value="LMT">LMT</Toggle>
            <Toggle value="MKT">MKT</Toggle>
            <Toggle value="SL">SL</Toggle>
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel className="flex justify-between">
              Qty
              {qtyTyped != null && (
                <button
                  type="button"
                  className="tracking-normal text-accent normal-case hover:underline"
                  onClick={() => setQtyTyped(null)}
                >
                  from risk
                </button>
              )}
            </FieldLabel>
            <Input numeric value={qtyTyped ?? String(qty)} onChange={(e) => setQtyTyped(e.target.value)} />
          </Field>
          {type === 'MKT' ? (
            <Field>
              <FieldLabel>Price</FieldLabel>
              <Input numeric disabled value={`MKT ≈ ${INR(ltp)}`} />
            </Field>
          ) : (
            <PriceInput
              label={type === 'SL' ? 'Trigger' : 'Price'}
              value={price}
              onChange={setPrice}
              entry={null}
            />
          )}
          <PriceInput label="Stop loss" value={stop} onChange={setStop} entry={entry} invalid={stopBad} />
          <PriceInput label="Target" value={target} onChange={setTarget} entry={entry} invalid={targetBad} />
          <Field className="col-span-2">
            <FieldLabel>Risk per trade</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>₹</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput numeric value={risk} onChange={(e) => setRisk(e.target.value)} />
              {balance != null && num(risk) != null && (
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{((num(risk)! / balance) * 100).toFixed(2)}% of wallet</InputGroupText>
                </InputGroupAddon>
              )}
            </InputGroup>
            {(stopBad || targetBad) && (
              <FieldDescription className="text-down">
                {r.errors.filter((e) => e.startsWith('Stop') || e.startsWith('Target')).join(' · ')}
              </FieldDescription>
            )}
          </Field>
        </div>
        <div className="flex items-center justify-between">
          <Label>
            <Switch checked={bracket} onCheckedChange={setBracket} />
            Bracket
          </Label>
          <Label>
            <Checkbox checked={journal} onCheckedChange={(v) => setJournal(!!v)} />
            Journal it
          </Label>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-border pt-2 text-2xs">
          <span className="text-muted-foreground">Value</span>
          <span className="tabular text-right">
            {value != null ? `₹${INR(value)}` : '—'}
            {pctWallet != null && <span className="text-muted-foreground"> · {pctWallet.toFixed(1)}%</span>}
          </span>
          <span className="text-muted-foreground">Risk</span>
          <span className="tabular text-right text-down">
            {actualRisk != null ? `₹${INR(actualRisk)}` : '—'}
          </span>
          <span className="text-muted-foreground">R : R</span>
          <span className={cn('tabular text-right', r.rr != null && r.rr >= 2 ? 'text-up' : '')}>
            {r.rr != null ? `1 : ${r.rr.toFixed(1)}` : '—'}
          </span>
        </div>
        {allWarnings.length > 0 && (
          <ul className="flex flex-col gap-0.5 rounded-sm border border-warning/40 bg-warning-subtle px-2 py-1.5 text-2xs text-warning">
            {allWarnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5">
                <IconAlertTriangle className="size-3 shrink-0" />
                <span className="text-foreground">{w}</span>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant={side}
          size="lg"
          disabled={!canSubmit}
          className="tabular w-full tracking-wide"
          onClick={() =>
            onSubmit?.({
              side,
              product,
              type,
              qty,
              price: entry,
              stop: num(stop),
              target: num(target),
              bracket,
              journal,
            })
          }
        >
          {side.toUpperCase()} {qty} @ {type === 'MKT' ? 'MKT' : entry != null ? INR(entry) : '—'}
        </Button>
      </div>
    </Panel>
  )
}

type Level = { price: number; qty: number; orders?: number }

/** Five-level depth: bids left (green), asks right (red), each qty bar scaled to the biggest level,
 *  spread and side totals in the header/footer. */
function MarketDepth({ bids, asks, className }: { bids: Level[]; asks: Level[]; className?: string }) {
  const max = Math.max(...bids.map((b) => b.qty), ...asks.map((a) => a.qty), 1)
  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null
  const total = (l: Level[]) => l.reduce((a, x) => a + x.qty, 0)
  const tb = total(bids)
  const ta = total(asks)
  const rows = Math.max(bids.length, asks.length)
  return (
    <Panel className={className}>
      <PanelHeader>
        <PanelTitle>Depth</PanelTitle>
        <span className="flex-1" />
        {spread != null && (
          <span className="tabular text-2xs text-muted-foreground">spread {INR(spread)}</span>
        )}
      </PanelHeader>
      <div className="grid grid-cols-2 text-2xs">
        <div className="grid grid-cols-[1fr_1fr_auto] border-r border-border">
          <span className="col-span-3 grid grid-cols-subgrid border-b border-border bg-panel-head px-2 py-0.5 text-[10px] text-muted-foreground uppercase">
            <span>Orders</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Bid</span>
          </span>
          {Array.from({ length: rows }, (_, i) => bids[i]).map((b, i) =>
            b ? (
              <span
                key={b.price}
                className="relative col-span-3 grid h-5.5 grid-cols-subgrid items-center px-2"
              >
                <span
                  className="absolute inset-y-0.5 right-0 bg-up-subtle"
                  style={{ width: `${(b.qty / max) * 100}%` }}
                />
                <span className="tabular relative text-muted-foreground">{b.orders ?? ''}</span>
                <span className="tabular relative text-right">{b.qty.toLocaleString('en-IN')}</span>
                <span className="tabular relative pl-3 text-right text-up">{INR(b.price)}</span>
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty padding rows
              <span key={`b${i}`} className="col-span-3 h-5.5" />
            ),
          )}
        </div>
        <div className="grid grid-cols-[auto_1fr_1fr]">
          <span className="col-span-3 grid grid-cols-subgrid border-b border-border bg-panel-head px-2 py-0.5 text-[10px] text-muted-foreground uppercase">
            <span>Ask</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Orders</span>
          </span>
          {Array.from({ length: rows }, (_, i) => asks[i]).map((a, i) =>
            a ? (
              <span
                key={a.price}
                className="relative col-span-3 grid h-5.5 grid-cols-subgrid items-center px-2"
              >
                <span
                  className="absolute inset-y-0.5 left-0 bg-down-subtle"
                  style={{ width: `${(a.qty / max) * 100}%` }}
                />
                <span className="tabular relative pr-3 text-down">{INR(a.price)}</span>
                <span className="tabular relative text-right">{a.qty.toLocaleString('en-IN')}</span>
                <span className="tabular relative text-right text-muted-foreground">{a.orders ?? ''}</span>
              </span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty padding rows
              <span key={`a${i}`} className="col-span-3 h-5.5" />
            ),
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-panel-head px-2 py-1 text-2xs">
        <span className="tabular text-up">{tb.toLocaleString('en-IN')}</span>
        <div className="flex h-1 flex-1 overflow-hidden rounded-xs">
          <span className="bg-up" style={{ width: `${(tb / (tb + ta || 1)) * 100}%` }} />
          <span className="flex-1 bg-down" />
        </div>
        <span className="tabular text-down">{ta.toLocaleString('en-IN')}</span>
      </div>
    </Panel>
  )
}

export { OrderTicket, SideToggle, MarketDepth }
