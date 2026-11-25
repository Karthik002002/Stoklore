import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarketDepth, OrderTicket, SideToggle } from './order-ticket'
import { toast, Toaster } from './toast'
import { useState } from 'react'

const meta: Meta = { title: 'Trading/Order ticket · Depth', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

/** Change side, order type, stop or target: qty re-sizes from the risk, R:R and warnings follow.
 *  A wrong-side stop turns the field red and disables the button. */
export const Ticket: Story = {
  name: 'Order ticket',
  render: () => (
    <div className="flex flex-wrap items-start gap-3">
      <Toaster />
      <OrderTicket
        symbol="TATAMOTORS"
        ltp={986.25}
        balance={512000}
        account="Zerodha · Swing"
        onSubmit={(o) =>
          toast.success(`${o.side.toUpperCase()} ${o.qty} TATAMOTORS`, {
            description: `${o.type} @ ${o.price} · SL ${o.stop} · TGT ${o.target}`,
          })
        }
      />
      <OrderTicket
        symbol="INFY"
        ltp={1876.3}
        balance={512000}
        account="Dhan · Intraday"
        defaultSide="sell"
        defaultRisk={1300}
      />
      <OrderTicket
        symbol="SUZLON"
        ltp={64.8}
        balance={90000}
        account="Paper"
        defaultRisk={4000}
        warnings={['NSE ASM Stage I: 100% margin, trade-for-trade', 'Opening 15 minutes: spreads are wide']}
      />
    </div>
  ),
}

function Side() {
  const [s, setS] = useState<'buy' | 'sell'>('buy')
  return <SideToggle value={s} onValueChange={setS} className="w-56" />
}

export const SideSwitch: Story = { name: 'Side toggle', render: () => <Side /> }

export const Depth: Story = {
  name: 'Market depth',
  render: () => (
    <MarketDepth
      className="w-80"
      bids={[
        { price: 986.2, qty: 1240, orders: 8 },
        { price: 986.15, qty: 2410, orders: 14 },
        { price: 986.1, qty: 880, orders: 5 },
        { price: 986.05, qty: 3120, orders: 21 },
        { price: 986.0, qty: 5600, orders: 37 },
      ]}
      asks={[
        { price: 986.25, qty: 640, orders: 4 },
        { price: 986.3, qty: 1980, orders: 11 },
        { price: 986.35, qty: 2240, orders: 9 },
        { price: 986.4, qty: 760, orders: 6 },
        { price: 986.45, qty: 4100, orders: 25 },
      ]}
    />
  ),
}
