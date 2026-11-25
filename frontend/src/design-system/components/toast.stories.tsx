import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { Toaster, toast } from './toast'

const meta: Meta = { title: 'Components/Toast', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Same `toast()` the app already calls (sonner); only the Toaster is new. */
export const AllTypes: Story = {
  name: 'Toast',
  render: () => (
    <div className="flex flex-wrap gap-1.5">
      <Toaster closeButton />
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.success('Order placed', {
            description: 'BUY 52 TATAMOTORS @ 986.25 · #250124000183',
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        Success
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.error('Broker session expired', { description: 'Log in to Zerodha again to sync holdings.' })
        }
      >
        Error
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.warning('Near your risk cap', { description: 'Open risk ₹13,900 of ₹15,000.' })}
      >
        Warning
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => toast.info('Results on 28 Nov', { description: 'HDFCBANK board meeting.' })}
      >
        Info
      </Button>
      <Button variant="outline" size="sm" onClick={() => toast('Watchlist saved')}>
        Plain
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          toast.promise(wait(1800), {
            loading: 'Running backtest…',
            success: 'Backtest done · Sharpe 1.42',
            error: 'Backtest failed',
          })
        }
      >
        Promise
      </Button>
    </div>
  ),
}
