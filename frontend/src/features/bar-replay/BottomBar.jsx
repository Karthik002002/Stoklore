import { Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  ArrowLeftIcon,
  DatabaseIcon,
  LayersIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import SourceSelect from '@/components/SourceSelect'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'
import { REPLAY_SPEEDS, REPLAY_TIMEFRAMES } from '@/lib/replay'
import DateJumpMenu from './DateJumpMenu'
import IndicatorControls from './IndicatorControls'
import PositionsList from './PositionsList'
import { riskReward } from './orderEngine'

// Every control for a replay session lives in this one bar pinned under the chart - the chart
// itself is never covered. It replaced a set of floating cards (Setup/Indicators/Trade/Playback)
// that sat on top of the candles and had to be collapsed out of the way to read price.
//
// Purely presentational: no store access, no data fetching, no derived session logic. BarReplay
// owns all of that and hands the finished values down in three groups (`setup`, `playback`,
// `trade`) matching the bar's three visual clusters - so the bar can be re-laid-out without
// touching replay behaviour, and the behaviour can change without touching layout.
//
// Anything needing more than a row's worth of space (the setup form, indicator list, open
// positions) is a popover opening upward off its trigger, rather than a panel parked on the chart.

// "no account" needs a real value in a Select - empty string renders as the placeholder instead of
// a selectable option, so this stands in for null on the way in and out (matches BarReplay's own
// NO_ACCOUNT, and ManualBacktesting.jsx's).
const NO_ACCOUNT = 'none'

// Label + optional keyboard shortcut on hover. Same shape as App.jsx's TooltipIcon (a span
// trigger wrapping whatever it's given), opening upward since the bar is at the bottom of the
// screen. `data-slot="kbd"` is what TooltipContent styles its key caps from.
//
// The shortcuts themselves are registered in BarReplay - this only advertises them, so a key
// added there must be added here too or it stays invisible.
function Hint({ label, keys, children }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {keys && (
          <kbd data-slot="kbd" className="bg-background/20 px-1.5 py-0.5 font-mono text-[10px]">
            {keys}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function SetupPopover({ setup }) {
  const {
    symbol,
    onSymbolChange,
    accounts,
    accountId,
    onAccountChange,
    timeframe,
    onTimeframeChange,
    intraday,
    intradayLoading,
    intradayEmpty,
    intradayFallback,
    sources,
    source,
    onSourceChange,
    onCollect,
    collecting,
    collectError,
    hasMaxData,
    canStart,
    bars,
    startDate,
    onStartDateChange,
    onStart,
  } = setup

  return (
    <Popover>
      <Hint label="Setup — symbol, account, timeframe, data" keys="/  T">
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" />}>
          <SlidersHorizontalIcon className="size-4" />
          {symbol ?? 'Pick a symbol'}
          <Badge variant="outline" className="ml-1 font-mono text-[10px]">
            {REPLAY_TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe}
          </Badge>
        </PopoverTrigger>
      </Hint>
      <PopoverContent side="top" align="start" className="space-y-2">
        <SymbolCombobox value={symbol ?? ''} onChange={onSymbolChange} className="w-full" />
        <Select
          value={accountId == null ? NO_ACCOUNT : String(accountId)}
          onValueChange={(v) => onAccountChange(v === NO_ACCOUNT ? null : Number(v))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
                {a.strategy ? ` · ${a.strategy}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={timeframe} onValueChange={onTimeframeChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v) => REPLAY_TIMEFRAMES.find((t) => t.value === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REPLAY_TIMEFRAMES.map((t) => (
              <SelectItem key={t.value} value={t.value} disabled={!t.available}>
                {t.label}
                {!t.available ? ' (soon)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The source picker and "Collect max data" only drive the daily price_history_max path -
            an intraday timeframe fetches its own bars and has nothing to collect. */}
        {!intraday && (
          <>
            <SourceSelect sources={sources} value={source} onChange={onSourceChange} className="w-full" />
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!symbol || collecting || hasMaxData}
              onClick={onCollect}
            >
              {collecting ? <Spinner className="size-4" /> : <DatabaseIcon className="size-4" />}
              Collect max data
            </Button>
            {symbol && !hasMaxData && (
              <p className="text-xs text-muted-foreground">
                {collecting ? 'Collecting full history…' : 'Needed before replay can start.'}
              </p>
            )}
            {collectError && <p className="text-xs text-destructive">{collectError}</p>}
          </>
        )}
        {intraday && intradayLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Fetching {timeframe} bars — the first load of a symbol takes a few
            seconds.
          </p>
        )}
        {intradayEmpty && (
          <p className="text-xs text-destructive">No intraday bars available for {symbol}.</p>
        )}
        {intradayFallback && (
          <p className="text-xs text-muted-foreground">
            Not in the minute dataset — showing Yahoo’s shallower intraday history.
          </p>
        )}

        {canStart && (
          <div className="space-y-2 border-t pt-2">
            <label className="text-xs text-muted-foreground">Start date</label>
            <DateJumpMenu
              bars={bars}
              value={startDate}
              onSelect={onStartDateChange}
              placeholder="Start date"
              triggerClassName="w-full justify-start"
            />
            <Button size="sm" className="w-full" onClick={onStart}>
              <PlayIcon className="size-4" /> Start replay
            </Button>
            <p className="text-xs text-muted-foreground">
              Leave blank to start roughly midway through history.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function IndicatorsPopover({ indicators, onChange }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" />}>
        <ActivityIcon className="size-4" />
        Indicators
        {indicators.length > 0 && (
          <Badge variant="outline" className="ml-0.5 text-[10px]">
            {indicators.length}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80">
        <IndicatorControls indicators={indicators} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}

function PlaybackControls({ playback }) {
  const {
    playing,
    atEnd,
    currentIndex,
    total,
    onStepBack,
    onPlayToggle,
    onStepForward,
    speedMs,
    onSpeedChange,
    bars,
    dateDraft,
    onJumpDate,
    onRestart,
  } = playback

  return (
    <div className="flex items-center gap-1">
      <Hint label="Step back">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Step back"
          disabled={currentIndex === 0}
          onClick={onStepBack}
        >
          <SkipBackIcon className="size-4" />
        </Button>
      </Hint>
      <Hint label={playing ? 'Pause' : 'Play'} keys="Shift+↓">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={atEnd}
          onClick={onPlayToggle}
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </Button>
      </Hint>
      <Hint label="Step forward" keys="Shift+→">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Step forward"
          disabled={atEnd}
          onClick={onStepForward}
        >
          <SkipForwardIcon className="size-4" />
        </Button>
      </Hint>
      <Select value={String(speedMs)} onValueChange={(v) => onSpeedChange(Number(v))}>
        <SelectTrigger size="sm" className="w-[4.5rem]">
          <SelectValue>{(v) => REPLAY_SPEEDS.find((s) => String(s.value) === v)?.label ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {REPLAY_SPEEDS.map((s) => (
            <SelectItem key={s.value} value={String(s.value)}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DateJumpMenu
        bars={bars}
        value={dateDraft}
        onSelect={onJumpDate}
        placeholder="Jump to date"
        triggerClassName="w-32 text-xs"
      />
      <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {currentIndex + 1}/{total}
      </span>
      <Button size="sm" variant="ghost" onClick={onRestart}>
        <RotateCcwIcon className="size-4" /> Restart
      </Button>
    </div>
  )
}

// Portfolio rollup shown IN the bar (not just inside the popover), so unrealized P&L and open
// risk are visible without a click. Same numbers as PortfolioSummary inside PositionsList - kept
// as separate render sites (not one component swapped in both places) so the bar's compact chip
// and the panel's fuller row can style independently.
function PortfolioChip({ orders, lastBar }) {
  const openOrders = orders.filter((o) => o.status === 'open')
  if (openOrders.length === 0 || !lastBar) return null
  const unrealized = openOrders.reduce(
    (s, o) =>
      s +
      tradePnl({
        direction: o.direction,
        entry_price: o.entryPrice,
        exit_price: lastBar.close,
        quantity: o.quantity,
      }),
    0,
  )
  const totalRisk = openOrders.reduce(
    (s, o) =>
      s +
      (riskReward({ direction: o.direction, entryPrice: o.entryPrice, stopLosses: o.stopLosses }).risk ?? 0),
    0,
  )
  return (
    <span className="px-1.5 text-xs tabular-nums whitespace-nowrap">
      <span className={unrealized >= 0 ? 'text-up' : 'text-down'}>{inr(unrealized)}</span>
      {totalRisk > 0 && <span className="ml-2 text-muted-foreground">R {inr(totalRisk)}</span>}
    </span>
  )
}

function TradeControls({ trade }) {
  const {
    orders,
    lastBar,
    onOpenTicket,
    onRequestClose,
    onRequestPartialClose,
    onMoveToBreakeven,
    onCancelPending,
    onRemoveLevel,
  } = trade
  const openCount = orders.length

  return (
    <div className="flex items-center gap-1.5">
      <span className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {lastBar ? inr(lastBar.close) : '—'}
      </span>
      <PortfolioChip orders={orders} lastBar={lastBar} />
      <Hint label="Buy — opens the order ticket" keys="B">
        <Button
          size="sm"
          className="bg-up text-white hover:bg-up/90"
          disabled={!lastBar}
          onClick={() => onOpenTicket('long')}
        >
          Buy <span className="ml-1 text-xs opacity-70">B</span>
        </Button>
      </Hint>
      <Hint label="Sell — opens the order ticket" keys="S">
        <Button
          size="sm"
          className="bg-down text-white hover:bg-down/90"
          disabled={!lastBar}
          onClick={() => onOpenTicket('short')}
        >
          Sell <span className="ml-1 text-xs opacity-70">S</span>
        </Button>
      </Hint>
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" />}>
          <LayersIcon className="size-4" />
          Positions
          {openCount > 0 && (
            <Badge variant="outline" className="ml-0.5 text-[10px]">
              {openCount}
            </Badge>
          )}
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="max-h-[60vh] overflow-y-auto">
          <PositionsList
            orders={orders}
            lastBar={lastBar}
            onRequestClose={onRequestClose}
            onRequestPartialClose={onRequestPartialClose}
            onMoveToBreakeven={onMoveToBreakeven}
            onCancelPending={onCancelPending}
            onRemoveLevel={onRemoveLevel}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function BottomBar({ setup, playback, trade, onOpenSettings }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t bg-card px-2">
      <Link
        to="/backtesting"
        search={{ tab: 'manual' }}
        aria-label="Back to backtesting"
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
      </Link>
      <Separator orientation="vertical" className="h-full" />

      <SetupPopover setup={setup} />
      {setup.barsReady && setup.symbol && (
        <IndicatorsPopover indicators={setup.indicators} onChange={setup.onIndicatorsChange} />
      )}

      {/* Playback and trading only exist once a replay is actually running - before that the bar
          is just the setup entry point, same as the old floating panels' own gating. */}
      {playback.started && (
        <>
          <Separator orientation="vertical" className="h-full" />
          <PlaybackControls playback={playback} />
        </>
      )}

      <div className="flex-1" />

      {trade.visible && (
        <>
          <TradeControls trade={trade} />
          <Separator orientation="vertical" className="h-full" />
        </>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Chart settings" onClick={onOpenSettings}>
        <SettingsIcon className="size-4" />
      </Button>
    </div>
  )
}
