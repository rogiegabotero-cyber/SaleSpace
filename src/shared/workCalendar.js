// The team's work day is an Eastern-time calendar day, no matter where the person
// looking at the dashboard (or the server running the scheduled sync) happens to be.
// Using the browser's own clock, or UTC, put calls on the wrong date: a call taken
// late in the Eastern evening is already "tomorrow" in UTC, and a viewer in a
// different timezone saw a different "today" than the one calls were recorded under.
export const WORK_TIME_ZONE = 'America/New_York'

const clockFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: WORK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function workClock(date = new Date()) {
  const parts = Object.fromEntries(clockFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// YYYY-MM-DD of the Eastern-time work day the given moment falls in.
export function workDateKey(date = new Date()) {
  return workClock(date).dateKey
}

// The year/month the calendar should show for `monthOffset` months from the current
// Eastern-time month (month is 0-based, like Date).
export function workMonth(monthOffset = 0, todayKey = workDateKey()) {
  const [year, month] = todayKey.split('-').map(Number)
  const shifted = new Date(year, month - 1 + monthOffset, 1)
  return { year: shifted.getFullYear(), month: shifted.getMonth() }
}
