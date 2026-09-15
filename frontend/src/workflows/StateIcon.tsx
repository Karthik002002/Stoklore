import { CircleCheckIcon, CircleDashedIcon, CircleXIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { STATE_META } from './status'
import type { RunState } from './status'

export default function StateIcon({ state, className }: { state: RunState; className?: string }) {
  const cls = cn('size-3.5 shrink-0', STATE_META[state].tone, className)
  if (state === 'running') return <Spinner className={cls} />
  if (state === 'succeeded') return <CircleCheckIcon className={cls} />
  if (state === 'failed') return <CircleXIcon className={cls} />
  return <CircleDashedIcon className={cls} />
}
