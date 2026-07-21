import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingsIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
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
import { getActiveModel, getLiteLLMConfig, getModels, setActiveModel, setLiteLLMConfig } from '@/services/api'

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

export default function Settings() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" />}>
        <SettingsIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Models and connections used across scans, reports, and chat.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="model">
          <TabsList>
            <TabsIndicator />
            <TabsTab value="model">Model</TabsTab>
            <TabsTab value="litellm">LiteLLM</TabsTab>
          </TabsList>
          <TabsPanel value="model">
            <ModelTab />
          </TabsPanel>
          <TabsPanel value="litellm">
            <LiteLLMTab />
          </TabsPanel>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
