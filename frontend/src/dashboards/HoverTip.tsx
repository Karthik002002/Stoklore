import { useState } from 'react'
import { createPortal } from 'react-dom'

// One floating tooltip per panel, following the cursor over bars, slices, cells and tiles. A plain
// `title` attribute waits a second, cuts off, and can't be styled; a Tooltip component per mark would
// mount one for every tile on a 100-tile treemap. This is one node, moved.

type Tip = { x: number; y: number; lines: string[] }

export function useHoverTip() {
  const [tip, setTip] = useState<Tip | null>(null)

  /** Point at the cursor with one or more lines - falsy lines are dropped, so callers can pass
   *  conditional detail without assembling the array themselves. */
  const show = (e: { clientX: number; clientY: number }, ...lines: (string | false | null | undefined)[]) =>
    setTip({ x: e.clientX, y: e.clientY, lines: lines.filter((l): l is string => !!l) })
  const hide = () => setTip(null)

  const node =
    tip && tip.lines.length
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-64 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
            style={{
              // Clamped to the window so a mark at the right edge doesn't push the tooltip off-screen.
              left: Math.min(Math.max(tip.x, 80), window.innerWidth - 80),
              top: Math.max(tip.y - 10, 28),
            }}
          >
            {tip.lines.map((line, i) => (
              <p key={line} className={i ? 'text-muted-foreground' : 'font-medium'}>
                {line}
              </p>
            ))}
          </div>,
          document.body,
        )
      : null

  return { show, hide, node }
}
