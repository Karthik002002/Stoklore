// Squarified treemap layout (Bruls, Huizing & van Wijk, 2000): tiles with areas proportional to their
// size, packed into a rectangle while keeping each tile as close to square as the sizes allow - so a
// stock heatmap reads as tiles, not slivers. Pure, and run against the panel's measured size, so the
// layout is never stretched to fit a shape it wasn't computed for.
//
// Items should arrive largest first; that is what keeps the rows square.

export type Tile<T> = { x: number; y: number; w: number; h: number; item: T }

export function squarify<T>(items: T[], size: (item: T) => number, width: number, height: number): Tile<T>[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, size(item)), 0)
  if (!total || width <= 0 || height <= 0) return []
  const scale = (width * height) / total
  const nodes = items
    .map((item) => ({ item, area: Math.max(0, size(item)) * scale }))
    .filter((n) => n.area > 0)

  const tiles: Tile<T>[] = []
  let x = 0
  let y = 0
  let w = width
  let h = height

  // The worst aspect ratio a row would have laid along a side of this length - lower is squarer.
  const worst = (row: typeof nodes, side: number) => {
    let sum = 0
    let max = 0
    let min = Number.POSITIVE_INFINITY
    for (const n of row) {
      sum += n.area
      max = Math.max(max, n.area)
      min = Math.min(min, n.area)
    }
    const s2 = side * side
    return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min))
  }

  const place = (row: typeof nodes) => {
    const sum = row.reduce((s, n) => s + n.area, 0)
    if (w >= h) {
      // A column down the left edge of what's left.
      const colW = sum / h
      let cy = y
      for (const n of row) {
        const tileH = n.area / colW
        tiles.push({ x, y: cy, w: colW, h: tileH, item: n.item })
        cy += tileH
      }
      x += colW
      w -= colW
    } else {
      // A row along the top edge of what's left.
      const rowH = sum / w
      let cx = x
      for (const n of row) {
        const tileW = n.area / rowH
        tiles.push({ x: cx, y, w: tileW, h: rowH, item: n.item })
        cx += tileW
      }
      y += rowH
      h -= rowH
    }
  }

  let row: typeof nodes = []
  for (const node of nodes) {
    const side = Math.min(w, h)
    if (!row.length || worst([...row, node], side) <= worst(row, side)) {
      row.push(node)
    } else {
      place(row)
      row = [node]
    }
  }
  if (row.length) place(row)
  return tiles
}
