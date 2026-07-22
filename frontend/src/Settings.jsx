import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsIcon, ExternalLinkIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  checkWatchRule,
  createWatchRule,
  deleteWatchRule,
  getActiveModel,
  getLiteLLMConfig,
  getModels,
  getWatchRules,
  setActiveModel,
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

export default function Settings() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" />}>
        <SettingsIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="flex w-[70%] h-[80%] !max-w-[70%] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Models and connections used across scans, reports, and chat.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="model" orientation="vertical" className="min-h-0 h-full flex-1 flex-row gap-4">
          <TabsList className="w-44 shrink-0 self-start !h-full">
            <TabsIndicator />
            <TabsTab value="model">Model</TabsTab>
            <TabsTab value="litellm">LiteLLM</TabsTab>
            <TabsTab value="rules">Watch rules</TabsTab>
          </TabsList>
          <div className="min-w-0 flex-1 overflow-y-auto pr-1">
            <TabsPanel value="model">
              <ModelTab />
            </TabsPanel>
            <TabsPanel value="litellm">
              <LiteLLMTab />
            </TabsPanel>
            <TabsPanel value="rules">
              <WatchRulesTab />
            </TabsPanel>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
