export const fmt = (v, digits = 2) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(v)

export const inr = (v) => (v == null ? '—' : `₹${fmt(v)}`)

export const compact = (v) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(v)

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// "2 days ago", "3 weeks ago", etc. from an ISO date string.
export const timeAgo = (dateStr) => {
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000)
  if (days < 7) return RTF.format(-days, 'day')
  if (days < 30) return RTF.format(-Math.round(days / 7), 'week')
  if (days < 365) return RTF.format(-Math.round(days / 30), 'month')
  return RTF.format(-Math.round(days / 365), 'year')
}
