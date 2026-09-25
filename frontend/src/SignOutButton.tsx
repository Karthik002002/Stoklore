import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { logout } from '@/services/api'

/** Ends the session on the server, not just in this tab - the cookie is useless afterwards. */
export default function SignOutButton() {
  const queryClient = useQueryClient()
  // Plain sign out keeps this browser trusted, so coming back needs only the PIN. Shift-click
  // forgets the device too - for a machine you're handing to someone else.
  const signOut = useMutation({
    mutationFn: (forgetDevice: boolean) => logout(forgetDevice),
    onSuccess: () => {
      // Cached trades, holdings and reports are this account's data: drop them on the way out
      // rather than leaving them in memory for whoever opens the laptop next.
      queryClient.clear()
      queryClient.invalidateQueries({ queryKey: ['authStatus'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Sign out failed'),
  })

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sign out"
      disabled={signOut.isPending}
      title="Sign out (hold Shift to also forget this device)"
      onClick={(e) => signOut.mutate(e.shiftKey)}
    >
      <LogOutIcon className="size-4" />
    </Button>
  )
}
