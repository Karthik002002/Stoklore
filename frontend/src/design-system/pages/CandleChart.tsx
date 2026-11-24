import { useId } from 'react'
import type { Bar } from './data'

const ema = (vals: number[], k: number) => {
  let e = vals[0]
  return vals.map((v) => (e = v * (2 / (k + 1)) + e * (1 - 2 / (k + 1))))
}

/** Story-only stand-in for the app's lightweight-charts chart: SVG candles, volume, EMA 21/50 and
 *  a last-price line, all from tokens so the theme applies. */
export function CandleChart({ data, className = '' }: { data: Bar[]; className?: string }) {
  const id = useId()
  const W = 800
  const H = 320
  const VOL = 56
  const hi = Math.max(...data.map((b) => b.h))
  const lo = Math.min(...data.map((b) => b.l))
  const y = (p: number) => 8 + ((hi - p) / (hi - lo)) * (H - VOL - 16)
  const bw = W / data.length
  const closes = data.map((b) => b.c)
  const line = (vals: number[]) => vals.map((v, i) => `${i * bw + bw / 2},${y(v)}`).join(' ')
  const last = closes.at(-1)!
  const up = last >= data[0].o
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Price chart"
    >
      <defs>
        <clipPath id={id}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <g stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke">
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={f * (H - VOL)}
            y2={f * (H - VOL)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g clipPath={`url(#${id})`}>
        {data.map((b, i) => {
          const x = i * bw + bw / 2
          const color = b.c >= b.o ? 'var(--up)' : 'var(--down)'
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
            <g key={i}>
              <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={color} vectorEffect="non-scaling-stroke" />
              <rect
                x={x - bw * 0.32}
                width={bw * 0.64}
                y={y(Math.max(b.o, b.c))}
                height={Math.max(1, Math.abs(y(b.o) - y(b.c)))}
                fill={color}
              />
              <rect
                x={x - bw * 0.32}
                width={bw * 0.64}
                y={H - b.v * VOL * 0.85}
                height={b.v * VOL * 0.85}
                fill={color}
                opacity=".25"
              />
            </g>
          )
        })}
        <polyline
          points={line(ema(closes, 21))}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(ema(closes, 50))}
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          x2={W}
          y1={y(last)}
          y2={y(last)}
          stroke={up ? 'var(--up)' : 'var(--down)'}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          opacity=".8"
        />
      </g>
    </svg>
  )
}
