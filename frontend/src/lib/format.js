export const fmt = (v, digits = 2) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(v)

export const inr = (v) => (v == null ? '—' : `₹${fmt(v)}`)

export const compact = (v) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(v)

// 'en-GB' (not the browser's default locale) guarantees "23 Jul 2026" day-month-year ordering
// regardless of the viewer's own locale settings.
const DATE_OPTS = { day: '2-digit', month: 'short', year: 'numeric' }

export const formatDate = (dateStr) =>
  dateStr ? new Date(dateStr).toLocaleDateString('en-GB', DATE_OPTS) : '—'

export const formatDateTime = (dateStr) =>
  dateStr
    ? new Date(dateStr).toLocaleString('en-GB', {
        ...DATE_OPTS,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// "2 days ago", "3 weeks ago", etc. from an ISO date string.
export const timeAgo = (dateStr) => {
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000)
  if (days < 7) return RTF.format(-days, 'day')
  if (days < 30) return RTF.format(-Math.round(days / 7), 'week')
  if (days < 365) return RTF.format(-Math.round(days / 30), 'month')
  return RTF.format(-Math.round(days / 365), 'year')
}
