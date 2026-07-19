export const fmt = (v, digits = 2) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(v)

export const inr = (v) => (v == null ? '—' : `₹${fmt(v)}`)

export const compact = (v) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(v)
