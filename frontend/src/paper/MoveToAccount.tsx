import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeftIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getPaperAccounts, movePaperPosition, movePaperTrade } from '@/services/api'

/** Move an open paper position, or a closed paper trade, to another paper account. Only paper
 *  accounts are offered (the backend refuses anything else): practice stays practice. */
export default function MoveToAccount({
  kind,
  id,
  symbol,
  currentAccountId,
}: {
  kind: 'position' | 'trade'
  id: number
  symbol: string
  currentAccountId: number | null
}) {
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['paperAccounts'], queryFn: getPaperAccounts })
  const others = accounts.filter((a) => a.id !== currentAccountId)
  const current = accounts.find((a) => a.id === currentAccountId)

  const move = useMutation({
    mutationFn: (accountId: number) =>
      kind === 'position' ? movePaperPosition(id, accountId) : movePaperTrade(id, accountId),
    onSuccess: (data) => {
      // Balances, stats and both accounts' lists all move with it.
      for (const key of ['paperPositions', 'manualTrades', 'tradeAccounts', 'balanceAdjustments'])
        queryClient.invalidateQueries({ queryKey: [key] })
      toast.success(`${symbol} moved to ${data.account}`)
    },
    onError: (e) => toast.error(e.message),
  })

  if (others.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="gap-1"
            disabled={move.isPending}
            title="Move to another paper account"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <ArrowRightLeftIcon className="size-3.5" />
        Move
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        {/* a label must sit inside a group in Base UI's menu */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">
            Move {symbol}
            {current ? ` from ${current.name}` : ''} to
          </DropdownMenuLabel>
          {others.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => move.mutate(a.id)}>
              {a.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
