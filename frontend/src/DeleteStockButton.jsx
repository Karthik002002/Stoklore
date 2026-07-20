import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export default function DeleteStockButton({ symbol, onDeleted, className, stopPropagation }) {
  const [open, setOpen] = useState(false)

  const confirmDelete = async (e) => {
    if (stopPropagation) e.stopPropagation()
    await fetch(`/api/stocks/${symbol}`, { method: 'DELETE' })
    toast.success(`${symbol} and its reports deleted`)
    onDeleted()
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${symbol}`}
            className={className}
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          />
        }
      >
        <Trash2Icon className="size-4" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {symbol}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {symbol} and every scraped report and analysis stored for it. This
            can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
