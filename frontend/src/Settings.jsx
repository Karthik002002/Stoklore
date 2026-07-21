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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getActiveModel, getModels, setActiveModel } from '@/services/api'

export default function Settings() {
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
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Settings" />}>
        <SettingsIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Default model for scans, reports, and new chats.</DialogDescription>
        </DialogHeader>

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
        </div>

        <p className="text-xs text-muted-foreground">
          Providers and API keys are managed in the{' '}
          <a
            href="http://localhost:20128"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline hover:text-foreground"
          >
            OmniRoute dashboard <ExternalLinkIcon className="size-3" />
          </a>
          . Models listed here come from its live catalog; only local Llama is available when OmniRoute isn't
          running.
        </p>
      </DialogContent>
    </Dialog>
  )
}
