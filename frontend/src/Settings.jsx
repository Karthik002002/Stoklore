import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IconSettings } from '@tabler/icons-react'
import {
  BookmarkIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { BrokerLogo } from '@/BrokerLogo'
import TradeAccountsTab from '@/TradeAccountsTab'
import SourceSelect from '@/components/SourceSelect'
import StockMasterCombobox from '@/components/StockMasterCombobox'
import TagInput from '@/components/TagInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  addStock,
  checkWatchRule,
  collectMaxHistoryBulk,
  createWatchRule,
  deleteWatchRule,
  deleteStockMaster,
  getActiveModel,
  getActivitySettings,
  getBrokerConfig,
  getBulkCollectStatus,
  getCogencisConfig,
  getLiteLLMConfig,
  getModels,
  getPriceSources,
  getStocks,
  getWatchRules,
  getWatchlist,
  getWatchlistNames,
  getKiteLoginUrl,
  getManualBacktestSettings,
  importStocksMaster,
  searchStocksMaster,
  setActiveModel,
  setManualBacktestSettings,
  setActivitySettings,
  setCogencisToken,
  setDhanConfig,
  setKiteConfig,
  setLiteLLMConfig,
} from '@/services/api'

function ModelTab() {
  const queryClient = useQueryClient()
  const { data: models } = useQuery({ queryKey: ['models'], queryFn: getModels })
  const { data: active } = useQuery({ queryKey: ['activeModel'], queryFn: getActiveModel })

  const save = useMutation({
    mutationFn: setActiveModel,
    onSuccess: ({ model }) => {
      queryClient.setQueryData(['activeModel'], { model })
      toast.success(`Default model set to ${model}`)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Default model</p>
        <Select value={active?.model ?? ''} onValueChange={(model) => model && save.mutate(model)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {(models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Used for scans, reports, and new chats. Any local Llama, OmniRoute, or LiteLLM model supports the
          tool-calling chatbot (scraping, scans, price lookups); other providers fall back to plain
          retrieval-augmented answers.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Providers and API keys for OmniRoute are managed in the{' '}
        <a
          href="http://localhost:20128"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          OmniRoute dashboard <ExternalLinkIcon className="size-3" />
        </a>
        . Models listed here come from its live catalog, plus LiteLLM's if configured in the LiteLLM tab; only
        local Llama is available when neither is running.
      </p>
    </div>
  )
}

function LiteLLMTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['litellmConfig'], queryFn: getLiteLLMConfig })
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [touched, setTouched] = useState(false)

  const displayBaseUrl = touched ? baseUrl : baseUrl || config?.base_url || ''

  const save = useMutation({
    mutationFn: () => setLiteLLMConfig(displayBaseUrl, apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['litellmConfig'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      toast.success('LiteLLM connection saved')
      setApiKey('')
      setTouched(false)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Proxy URL</p>
        <Input
          value={displayBaseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value)
            setTouched(true)
          }}
          placeholder="http://localhost:4000"
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">API key</p>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config?.has_api_key ? '•••• saved - leave blank to keep it' : 'sk-...'}
        />
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={!displayBaseUrl || save.isPending}>
        Save connection
      </Button>
      <p className="text-xs text-muted-foreground">
        Point this at a running{' '}
        <a
          href="https://docs.litellm.ai/docs/simple_proxy"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          LiteLLM proxy <ExternalLinkIcon className="size-3" />
        </a>{' '}
        (e.g. <code>litellm --config config.yaml</code>). Its models then show up in the Model tab as{' '}
        <code>litellm/&lt;model&gt;</code>, with full tool-calling chatbot support.
      </p>
    </div>
  )
}

function CogencisTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['cogencisConfig'], queryFn: getCogencisConfig })
  const [token, setToken] = useState('')

  const save = useMutation({
    mutationFn: () => setCogencisToken(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cogencisConfig'] })
      toast.success('Cogencis token saved')
      setToken('')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Session bearer token</p>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={config?.has_token ? '•••• saved - leave blank to keep it' : 'eyJhbGciOi...'}
        />
      </div>
      <Button size="sm" onClick={() => save.mutate()} disabled={!token || save.isPending}>
        Save token
      </Button>
      <p className="text-xs text-muted-foreground">
        Adds Cogencis news coverage (matched by ISIN) alongside the default Yahoo Finance news on each stock's
        page. This token comes from your own signed-in session at{' '}
        <a
          href="https://iinvest.cogencis.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          iinvest.cogencis.com <ExternalLinkIcon className="size-3" />
        </a>{' '}
        - open dev tools, Network tab, find any <code>data.cogencis.com</code> request, and copy its{' '}
        <code>authorization: Bearer …</code> header value (without the "Bearer " prefix). It expires after
        about 24 hours, so you'll need to paste in a fresh one here when stock news stops picking up new
        Cogencis articles.
      </p>
    </div>
  )
}

function DhanTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['brokerConfig'], queryFn: getBrokerConfig })
  const [clientId, setClientId] = useState('')
  const [accessToken, setAccessToken] = useState('')

  const save = useMutation({
    mutationFn: () => setDhanConfig(clientId, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokerConfig'] })
      queryClient.invalidateQueries({ queryKey: ['holdings'] })
      toast.success('Dhan credentials saved')
      setClientId('')
      setAccessToken('')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Dhan client ID</p>
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={config?.dhan?.has_credentials ? '•••• saved - leave blank to keep it' : '1000000000'}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Access token</p>
        <Input
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={
            config?.dhan?.has_credentials ? '•••• saved - leave blank to keep it' : 'eyJhbGciOi...'
          }
        />
      </div>
      <Button
        size="sm"
        onClick={() => save.mutate()}
        disabled={!clientId.trim() || !accessToken.trim() || save.isPending}
      >
        Save credentials
      </Button>
      <p className="text-xs text-muted-foreground">
        From your Dhan account's{' '}
        <a
          href="https://web.dhan.co/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          API access section <ExternalLinkIcon className="size-3" />
        </a>{' '}
        (Profile → DhanHQ Trading APIs) — generates an access token that expires after some time, so you'll
        need to paste in a fresh one here once it does. Powers the Holdings page; pick the active broker
        there.
      </p>
    </div>
  )
}

function KiteTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['brokerConfig'], queryFn: getBrokerConfig })
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')

  const save = useMutation({
    mutationFn: () => setKiteConfig(apiKey, apiSecret),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokerConfig'] })
      toast.success('Kite credentials saved')
      setApiKey('')
      setApiSecret('')
    },
    onError: (e) => toast.error(e.message),
  })

  const connect = useMutation({
    mutationFn: getKiteLoginUrl,
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Kite Connect API key</p>
        <Input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            config?.kite?.has_credentials ? '•••• saved - leave blank to keep it' : 'abcd1234efgh5678'
          }
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">API secret</p>
        <Input
          type="password"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          placeholder={
            config?.kite?.has_credentials ? '•••• saved - leave blank to keep it' : 'eyJhbGciOi...'
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={!apiKey.trim() || !apiSecret.trim() || save.isPending}
        >
          Save credentials
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => connect.mutate()}
          disabled={!config?.kite?.has_credentials || connect.isPending}
        >
          {config?.kite?.logged_in_today ? 'Reconnect to Kite' : 'Connect to Kite'}
        </Button>
        {config?.kite?.logged_in_today && (
          <Badge variant="secondary" className="text-up">
            Logged in today
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        From your app at{' '}
        <a
          href="https://developers.kite.trade/apps"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline hover:text-foreground"
        >
          developers.kite.trade/apps <ExternalLinkIcon className="size-3" />
        </a>{' '}
        - set its Redirect URL to <code>http://localhost:8010/api/kite/callback</code> (the backend's own
        port, not the frontend's). Unlike Dhan, Kite has no long-lived token: "Connect to Kite" logs you in
        through Zerodha and the session lasts until the next trading day's reset, so you'll need to reconnect
        each morning before Holdings can sync.
      </p>
    </div>
  )
}

function BrokerTab() {
  const { broker } = useSearch({ strict: false })
  const navigate = useNavigate()
  const setBroker = (next) => navigate({ search: (prev) => ({ ...prev, broker: next }), replace: true })

  return (
    <Tabs value={broker} onValueChange={setBroker}>
      <TabsList>
        <TabsIndicator />
        <TabsTab value="dhan" className="gap-1.5">
          <BrokerLogo broker="dhan" /> Dhan
        </TabsTab>
        <TabsTab value="kite" className="gap-1.5">
          <BrokerLogo broker="kite" /> Kite
        </TabsTab>
      </TabsList>
      <TabsPanel value="dhan" className="pt-4">
        <DhanTab />
      </TabsPanel>
      <TabsPanel value="kite" className="pt-4">
        <KiteTab />
      </TabsPanel>
    </Tabs>
  )
}

function WatchRulesTab() {
  const queryClient = useQueryClient()
  const { data: rules } = useQuery({ queryKey: ['watchRules'], queryFn: getWatchRules })

  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [results, setResults] = useState({})

  const create = useMutation({
    mutationFn: createWatchRule,
    onSuccess: ({ criteria }) => {
      queryClient.invalidateQueries({ queryKey: ['watchRules'] })
      const parts = []
      if (criteria.max_pe != null) parts.push(`P/E under ${criteria.max_pe}`)
      if (criteria.ema_short && criteria.ema_long)
        parts.push(`EMA${criteria.ema_short} above EMA${criteria.ema_long}`)
      if (criteria.no_negative_events_days != null)
        parts.push(`no negative events in ${criteria.no_negative_events_days}d`)
      toast.success('Watch rule saved', { description: parts.join(' · ') })
      setName('')
      setText('')
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: deleteWatchRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchRules'] }),
  })

  const check = async (rule) => {
    try {
      const result = await checkWatchRule(rule.id)
      setResults((prev) => ({ ...prev, [rule.id]: result }))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim() || !text.trim() || create.isPending) return
    create.mutate({ name: name.trim(), text: text.trim() })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name, e.g. buy dip" />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="P/E under 25 AND no negative-sentiment event in last 14 days AND EMA20 above EMA50"
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Write your own criteria in plain English - the model parses it into P/E, EMA crossover, and/or
          recent-negative-event checks. All of them must hold for the rule to pass. A rule isn't tied to any
          one stock - checking it here runs it against your whole watchlist, and in chat{' '}
          <code>/rule name</code> checks every watchlisted stock while <code>/rule name SYMBOL</code> checks
          just one.
        </p>
        <Button type="submit" size="sm" disabled={!name.trim() || !text.trim() || create.isPending}>
          {create.isPending ? 'Parsing…' : 'Add rule'}
        </Button>
      </form>

      <div className="space-y-2">
        {(rules ?? []).map((rule) => {
          const result = results[rule.id]
          return (
            <div key={rule.id} className="rounded-lg border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{rule.name}</span>
                  {rule.rule_text && (
                    <span className="block truncate text-xs text-muted-foreground" title={rule.rule_text}>
                      {rule.rule_text}
                    </span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => check(rule)}>
                    Check
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete rule ${rule.name}`}
                    onClick={() => remove.mutate(rule.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
              {result && (
                <div className="mt-2 space-y-2">
                  {result.length === 0 && (
                    <p className="text-xs text-muted-foreground">No watchlisted stocks to check against.</p>
                  )}
                  {result.map((r) => (
                    <div key={r.symbol}>
                      <Badge variant={r.passed ? 'success' : 'destructive'}>
                        {r.symbol} — {r.passed ? 'Met' : 'Not met'}
                      </Badge>
                      {r.checks.map((c, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {c.passed ? '✅' : '❌'} {c.label} — {c.detail}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {rules?.length === 0 && <p className="text-xs text-muted-foreground">No watch rules yet.</p>}
      </div>
    </div>
  )
}

// Minimum gap enforced between symbols server-side (api.py's BULK_COLLECT_INTERVAL_SECONDS) -
// mirrored here only for the copy below, not to actually throttle anything client-side.
const BULK_COLLECT_INTERVAL_SECONDS = 5

function DataCollectionTab() {
  const queryClient = useQueryClient()
  const { data: sourcesData } = useQuery({ queryKey: ['priceSources'], queryFn: getPriceSources })
  const sources = sourcesData?.sources ?? []
  const [source, setSource] = useState('')
  useEffect(() => {
    if (!source && sourcesData?.default) setSource(sourcesData.default)
  }, [source, sourcesData])

  const [symbols, setSymbols] = useState([])
  const toggleSymbol = (symbol) =>
    setSymbols((s) => (s.includes(symbol) ? s.filter((x) => x !== symbol) : [...s, symbol]))
  const removeSymbol = (symbol) => setSymbols((s) => s.filter((x) => x !== symbol))

  const { data: status } = useQuery({
    queryKey: ['bulkCollectStatus'],
    queryFn: getBulkCollectStatus,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })
  const running = !!status?.running

  const start = useMutation({
    mutationFn: () => collectMaxHistoryBulk(symbols, source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bulkCollectStatus'] }),
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Multi-stock max-history collector</p>
        <p className="text-xs text-muted-foreground">
          Collects full price history for several symbols one at a time, at least{' '}
          {BULK_COLLECT_INTERVAL_SECONDS}s apart, using the source below - see the source selector next to any
          "Collect max data" button elsewhere in the app for the same per-symbol version of this.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Source</label>
        <SourceSelect sources={sources} value={source} onChange={setSource} className="w-full" />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Symbols</label>
        <StockMasterCombobox selected={symbols} onSelect={toggleSymbol} />
        {symbols.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input p-2">
            {symbols.map((symbol) => (
              <span
                key={symbol}
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {symbol}
                <button type="button" aria-label={`Remove ${symbol}`} onClick={() => removeSymbol(symbol)}>
                  <XIcon className="size-3 text-muted-foreground hover:text-foreground" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Button
        size="sm"
        onClick={() => start.mutate()}
        disabled={symbols.length === 0 || running || start.isPending}
      >
        {running ? <Spinner className="size-4" /> : <DatabaseIcon className="size-4" />}
        Start collecting {symbols.length > 0 ? `(${symbols.length})` : ''}
      </Button>

      {status && (status.running || status.results?.length > 0) && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">
            {status.done}/{status.total} done
            {status.current_symbol ? ` - collecting ${status.current_symbol}…` : ''}
          </p>
          <div className="space-y-1">
            {status.results?.map((r) => (
              <div key={r.symbol} className="flex items-center gap-2 text-xs">
                {r.ok ? (
                  <CheckCircle2Icon className="size-3.5 shrink-0 text-up" />
                ) : (
                  <XCircleIcon className="size-3.5 shrink-0 text-down" />
                )}
                <span className="font-medium">{r.symbol}</span>
                {r.error && <span className="truncate text-muted-foreground">{r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['activitySettings'], queryFn: getActivitySettings })
  const [qualifiers, setQualifiers] = useState(null)
  const [goalMinutes, setGoalMinutes] = useState('')

  useEffect(() => {
    if (config) {
      setQualifiers(config.qualifiers)
      setGoalMinutes(String(config.daily_goal_minutes))
    }
  }, [config])

  const save = useMutation({
    mutationFn: () => setActivitySettings({ qualifiers, daily_goal_minutes: Number(goalMinutes) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activitySettings'] })
      queryClient.invalidateQueries({ queryKey: ['activitySummary'] })
      toast.success('Activity settings saved')
    },
    onError: (e) => toast.error(e.message),
  })

  if (!qualifiers) return <p className="text-sm text-muted-foreground">Loading…</p>

  const toggle = (key) => setQualifiers((q) => ({ ...q, [key]: !q[key] }))
  const atLeastOneEnabled = Object.values(qualifiers).some(Boolean)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">What counts as "showing up" for a day</p>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={qualifiers.trade} onChange={() => toggle('trade')} />
            Logging a manual trade
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={qualifiers.analyze} onChange={() => toggle('analyze')} />
            Running an Auto backtest
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={qualifiers.review} onChange={() => toggle('review')} />
            Reviewing the watchlist or events
          </label>
        </div>
        {!atLeastOneEnabled && <p className="text-xs text-destructive">At least one must stay enabled.</p>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Daily usage-time goal</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="1"
            value={goalMinutes}
            onChange={(e) => setGoalMinutes(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">minutes/day</span>
        </div>
      </div>

      <Button
        size="sm"
        onClick={() => save.mutate()}
        disabled={!atLeastOneEnabled || !goalMinutes || save.isPending}
      >
        Save
      </Button>
      <p className="text-xs text-muted-foreground">
        Drives the streak/guilt banner shown across the app and the Profile modal's stats (the Profile icon
        above Settings).
      </p>
    </div>
  )
}

function ManualBacktestTab() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })
  const [setups, setSetups] = useState(null)
  const [tolerance, setTolerance] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')

  useEffect(() => {
    if (config) {
      setSetups(config.setups)
      setTolerance(String(config.risk_deviation_tolerance_pct))
      setOpeningBalance(String(config.opening_balance))
    }
  }, [config])

  const save = useMutation({
    mutationFn: () =>
      setManualBacktestSettings({
        setups,
        risk_deviation_tolerance_pct: Number(tolerance),
        opening_balance: Number(openingBalance),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manualBacktestSettings'] })
      toast.success('Backtesting settings saved')
    },
    onError: (e) => toast.error(e.message),
  })

  if (!setups) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Setups</p>
        <TagInput value={setups} onChange={setSetups} placeholder="Add a setup, e.g. Breakout…" />
        <p className="text-xs text-muted-foreground">
          Suggested values for the Setup field when logging a manual trade - what you actually type there
          isn't restricted to this list, it's just autocomplete so the same setup name stays spelled the same
          way across trades (needed for the per-setup breakdown on the Overview tab to group correctly).
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Risk deviation tolerance</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="0"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          How far actual risk (from stop-loss × quantity) can drift from a trade's planned "ideal risk" before
          it's flagged over/under-risked.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Opening balance</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">₹</span>
          <Input
            type="number"
            min="0"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            className="w-32"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Starting point for the account-balance equity curve on the Manual backtesting Overview tab.
        </p>
      </div>

      <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        Save
      </Button>
    </div>
  )
}

const EMPTY_SET = new Set()

// A stock can belong to several watchlists at once (composite symbol+list_name key on the
// backend), so this is a checkbox menu, not a single-select. Checking a list it isn't tracked
// under yet scrapes it first (same live-fetch path as the dashboard's "Add stock") since only
// tracked symbols can appear in a watchlist tab.
function WatchlistCell({ symbol, lists, memberOf, tracked, onAdd, onRemove, onCreateList }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon-sm" variant="ghost" aria-label={`Add ${symbol} to watchlist`} />}
      >
        <BookmarkIcon
          className={`size-3.5 ${memberOf.size ? 'text-primary' : 'text-muted-foreground'}`}
          fill={memberOf.size ? 'currentColor' : 'none'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {lists.map((name) => (
          <DropdownMenuCheckboxItem
            key={name}
            checked={memberOf.has(name)}
            onCheckedChange={(checked) => (checked ? onAdd(symbol, name, tracked) : onRemove(symbol, name))}
          >
            {name}
          </DropdownMenuCheckboxItem>
        ))}
        {lists.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => onCreateList(symbol, tracked)}>
          <PlusIcon className="size-4" /> New watchlist…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StocksMasterTab() {
  const queryClient = useQueryClient()
  const fileInput = useRef(null)
  const [query, setQuery] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['stocksMaster', query],
    queryFn: () => searchStocksMaster(query),
  })
  const stocks = data?.stocks ?? []

  // Shared cache keys with the dashboard (StocksList.jsx) - tracked-stock and watchlist state
  // stay in sync everywhere without a second fetch.
  const { data: trackedStocks = [] } = useQuery({ queryKey: ['stocks'], queryFn: getStocks })
  const trackedSymbols = useMemo(() => new Set(trackedStocks.map((s) => s.symbol)), [trackedStocks])
  const { data: watchlist = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const { data: listNames = [] } = useQuery({ queryKey: ['watchlists'], queryFn: getWatchlistNames })
  const membersOf = useMemo(() => {
    const m = new Map()
    watchlist.forEach((w) => {
      if (!m.has(w.symbol)) m.set(w.symbol, new Set())
      m.get(w.symbol).add(w.list_name)
    })
    return m
  }, [watchlist])
  const refreshWatchlist = () =>
    ['stocks', 'watchlist', 'watchlists'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))

  const addToWatchlist = async (symbol, listName, tracked) => {
    if (!tracked) {
      try {
        await addStock(symbol)
      } catch (err) {
        toast.error(err.message)
        return
      }
    }
    await fetch(`/api/watchlist/${symbol}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_name: listName }),
    })
    toast.success(`${symbol} added to ${listName}`)
    refreshWatchlist()
  }

  const removeFromWatchlist = async (symbol, listName) => {
    await fetch(`/api/watchlist/${symbol}?list_name=${encodeURIComponent(listName)}`, { method: 'DELETE' })
    toast.success(`${symbol} removed from ${listName}`)
    refreshWatchlist()
  }

  const createListAndAdd = (symbol, tracked) => {
    const name = window.prompt('New watchlist name (e.g. Banking, IT, Long term)')
    if (name?.trim()) addToWatchlist(symbol, name.trim(), tracked)
  }

  const importCsv = useMutation({
    mutationFn: importStocksMaster,
    onSuccess: ({ imported }) => {
      queryClient.invalidateQueries({ queryKey: ['stocksMaster'] })
      toast.success(`Imported ${imported} stocks`)
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: deleteStockMaster,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stocksMaster'] }),
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">NSE listed-equity master</p>
          <p className="text-xs text-muted-foreground">
            {data ? `${data.total.toLocaleString()} stocks` : 'Loading…'} - imported from NSE's EQUITY_L.csv
            export. Search shows up to 30 matches at a time.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) importCsv.mutate(file)
            e.target.value = ''
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={importCsv.isPending}
        >
          {importCsv.isPending ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
          Import CSV
        </Button>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by symbol or company name…"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Series</TableHead>
            <TableHead>Listed</TableHead>
            <TableHead>ISIN</TableHead>
            <TableHead className="w-8" />
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((s) => (
            <TableRow key={s.symbol}>
              <TableCell className="font-medium">{s.symbol}</TableCell>
              <TableCell className="max-w-56 truncate" title={s.name}>
                {s.name}
              </TableCell>
              <TableCell>{s.series}</TableCell>
              <TableCell>{s.listing_date}</TableCell>
              <TableCell className="text-muted-foreground">{s.isin}</TableCell>
              <TableCell>
                <WatchlistCell
                  symbol={s.symbol}
                  lists={listNames}
                  memberOf={membersOf.get(s.symbol) ?? EMPTY_SET}
                  tracked={trackedSymbols.has(s.symbol)}
                  onAdd={addToWatchlist}
                  onRemove={removeFromWatchlist}
                  onCreateList={createListAndAdd}
                />
              </TableCell>
              <TableCell>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${s.symbol}`}
                  onClick={() => remove.mutate(s.symbol)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!isLoading && stocks.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {data?.total ? 'No matches.' : 'Nothing imported yet - use "Import CSV" above.'}
        </p>
      )}
    </div>
  )
}

export default function Settings() {
  const { settings } = useSearch({ strict: false })
  const navigate = useNavigate()

  const setOpen = (open) =>
    navigate({
      search: (prev) => ({ ...prev, settings: open ? (settings ?? 'model') : undefined }),
      replace: true,
    })
  const setTab = (tab) => navigate({ search: (prev) => ({ ...prev, settings: tab }), replace: true })

  return (
    <Dialog open={!!settings} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" />}>
        <IconSettings className="size-4" />
      </DialogTrigger>
      <DialogContent className="flex w-[70%] h-[80%] !max-w-[70%] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Models and connections used across scans, reports, and chat.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={settings ?? 'model'}
          onValueChange={setTab}
          orientation="vertical"
          className="min-h-0 h-full flex-1 flex-row gap-4"
        >
          <TabsList className="w-44 shrink-0 self-start !h-full">
            <TabsIndicator />
            <TabsTab value="model">Model</TabsTab>
            <TabsTab value="litellm">LiteLLM</TabsTab>
            <TabsTab value="cogencis">Cogencis</TabsTab>
            <TabsTab value="broker">Broker</TabsTab>
            <TabsTab value="rules">Watch rules</TabsTab>
            <TabsTab value="data">Collect data</TabsTab>
            <TabsTab value="stocks">Manage stocks</TabsTab>
            <TabsTab value="activity">Activity</TabsTab>
            <TabsTab value="backtesting">Backtesting</TabsTab>
            <TabsTab value="accounts">Trade accounts</TabsTab>
          </TabsList>
          <div className="min-w-0 flex-1 overflow-y-auto pr-1">
            <TabsPanel value="model">
              <ModelTab />
            </TabsPanel>
            <TabsPanel value="litellm">
              <LiteLLMTab />
            </TabsPanel>
            <TabsPanel value="cogencis">
              <CogencisTab />
            </TabsPanel>
            <TabsPanel value="broker">
              <BrokerTab />
            </TabsPanel>
            <TabsPanel value="rules">
              <WatchRulesTab />
            </TabsPanel>
            <TabsPanel value="data">
              <DataCollectionTab />
            </TabsPanel>
            <TabsPanel value="stocks">
              <StocksMasterTab />
            </TabsPanel>
            <TabsPanel value="activity">
              <ActivityTab />
            </TabsPanel>
            <TabsPanel value="backtesting">
              <ManualBacktestTab />
            </TabsPanel>
            <TabsPanel value="accounts">
              <TradeAccountsTab />
            </TabsPanel>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
