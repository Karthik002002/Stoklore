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

// Seconds -> "1h 23m" / "23m 05s" / "42s" - drops leading zero units rather than always showing
// hh:mm:ss, since most days will be minutes not hours.
export const formatDuration = (totalSeconds) => {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

// "45m" / "5h" / "2d" - compact form for dense feed rows, unlike timeAgo's "2 days ago".
export const timeAgoShort = (dateStr) => {
  const mins = Math.floor((Date.now() - new Date(dateStr)) / 60000)
  if (mins < 60) return `${Math.max(mins, 0)}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// "2 days ago", "3 weeks ago", etc. from an ISO date string.
export const timeAgo = (dateStr) => {
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000)
  if (days < 7) return RTF.format(-days, 'day')
  if (days < 30) return RTF.format(-Math.round(days / 7), 'week')
  if (days < 365) return RTF.format(-Math.round(days / 30), 'month')
  return RTF.format(-Math.round(days / 365), 'year')
}
