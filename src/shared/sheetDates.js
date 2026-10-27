import { workDateKey } from './workCalendar.js'

// Turns whatever someone typed into a sheet's DATE cell into a YYYY-MM-DD key, or null
// if it doesn't read as a date. The sheet has no fixed format — the same column holds
// 10/16/2026, 15/10/26, 5/10/2026, "September 10, 2026", 2026-10-16 and so on — so this
// accepts all of those. Only the all-numeric day/month forms are truly ambiguous
// (is 05/10/2026 May 10 or October 5?); those are settled by which reading is a real
// date that has already happened, and if both are, the one closer to today, since this
// is a live log of calls being made now rather than a record of the distant past.

const MONTH_NAMES = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const DAY_MS = 24 * 60 * 60 * 1000

function key(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day
}

function toDays(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

function fullYear(text) {
  const year = Number(text)
  return text.length <= 2 ? 2000 + year : year
}

export function parseSheetDate(rawText, todayKey = workDateKey()) {
  let text = (rawText || '').trim()
  if (!text) return null
  // A time stamped on the end ("10/16/2026 14:30", "2026-10-16T14:30:00") doesn't change the day.
  text = text.replace(/[ T]+\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?\s*(Z|[+-]\d{2}:?\d{2})?$/, '').trim()

  const today = toDays(todayKey)
  // A day ahead is allowed, so a date written just after midnight in a timezone ahead of
  // Eastern isn't thrown away; anything further out hasn't happened and isn't a call made.
  const notFuture = (dateKey) => toDays(dateKey) <= today + 1
  const closest = (candidates) => {
    const real = candidates.filter((candidate) => candidate && notFuture(candidate))
    if (!real.length) return null
    return real.reduce((best, candidate) => (Math.abs(toDays(candidate) - today) < Math.abs(toDays(best) - today) ? candidate : best))
  }
  const single = (dateKey) => (dateKey && notFuture(dateKey) ? dateKey : null)

  let match

  // 2026-10-16, 2026/10/16, 2026.10.16 — year first, so the order is unambiguous.
  if ((match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    return single(isRealDate(year, month, day) ? key(year, month, day) : null)
  }

  // 10/16/2026, 16/10/26, 5-10-2026 — day and month in either order.
  if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const [first, second] = [Number(match[1]), Number(match[2])]
    const year = fullYear(match[3])
    const monthFirst = isRealDate(year, first, second) ? key(year, first, second) : null
    const dayFirst = isRealDate(year, second, first) ? key(year, second, first) : null
    return closest([monthFirst, dayFirst])
  }

  // 10/16, 16/10 — no year, so this year, or last year if that would be in the future.
  if ((match = text.match(/^(\d{1,2})[-/.](\d{1,2})$/))) {
    const [first, second] = [Number(match[1]), Number(match[2])]
    const thisYear = Number(todayKey.slice(0, 4))
    const candidates = []
    for (const year of [thisYear, thisYear - 1]) {
      if (isRealDate(year, first, second)) candidates.push(key(year, first, second))
      if (isRealDate(year, second, first)) candidates.push(key(year, second, first))
    }
    return closest(candidates)
  }

  // September 10, 2026 · Sep 10 2026 · 10 Sep 2026 · 10-Oct-26 · Oct 19 — the month is
  // spelled out, so there's nothing to guess; it's taken as written.
  const named = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{2}|\d{4}))?$/)
    || text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?(?:,?[\s-]+(\d{2}|\d{4}))?$/)
  if (named) {
    const monthWordFirst = Number.isNaN(Number(named[1]))
    const month = MONTH_NAMES[(monthWordFirst ? named[1] : named[2]).toLowerCase()]
    const day = Number(monthWordFirst ? named[2] : named[1])
    if (!month) return null
    if (named[3]) {
      const year = fullYear(named[3])
      return single(isRealDate(year, month, day) ? key(year, month, day) : null)
    }
    const thisYear = Number(todayKey.slice(0, 4))
    return closest([thisYear, thisYear - 1].map((year) => (isRealDate(year, month, day) ? key(year, month, day) : null)))
  }

  // A date stored as a plain number (Excel/Sheets day count) instead of formatted text.
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text)
    if (serial < 30000 || serial > 80000) return null
    const date = new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS)
    return single(key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()))
  }

  return null
}
