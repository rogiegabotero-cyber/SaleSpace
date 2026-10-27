import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchClosedAppointments, subscribeToCallsSheets, subscribeToCallsSheetSelection } from '../services/callsSheet'

// Closed appointments live in a Google Sheet tab that is only ever read (polled), so there
// is no push to listen for. Every signed-in client therefore polls the tab itself and
// compares it with what that user has already been shown; anything new is an appointment
// someone just closed. Each team member is told on their own next poll, within a couple of
// minutes of the row appearing — whichever panel they have open.
const POLL_MS = 2 * 60 * 1000
const RETURN_POLL_MS = 30 * 1000
// A user returning after a long absence is told about the latest few, not a backlog.
const MAX_QUEUE = 5
// Rows closed longer ago than this are marked seen without a celebration.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const MAX_STORED_KEYS = 500

function appointmentKey(item) {
  return [item.practice, item.dateClosed, item.handler].map((part) => (part || '').trim().toLowerCase()).join('|')
}

function isRecent(item) {
  const closedAt = Date.parse(item.dateClosed)
  return Number.isNaN(closedAt) || Date.now() - closedAt <= MAX_AGE_MS
}

// Per user and per sheet, so one person's dismissals never hide a celebration from another
// who shares the browser. null means "never run here before".
function readSeen(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeSeen(storageKey, keys) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...new Set(keys)].slice(-MAX_STORED_KEYS)))
  } catch {
    // Storage can be unavailable (private window); the worst case is a repeat celebration.
  }
}

export function useClosedAppointmentAlerts(userId) {
  const [sheets, setSheets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [queue, setQueue] = useState([])

  useEffect(() => subscribeToCallsSheets(setSheets, () => {}), [])
  useEffect(() => subscribeToCallsSheetSelection(setSelectedId, () => {}), [])

  // The same sheet the dashboard shows (the team-wide selection, else the first one).
  const sheet = useMemo(() => sheets.find((item) => item.id === selectedId) || sheets[0] || null, [sheets, selectedId])
  const sheetId = sheet?.id
  const sheetUrl = sheet?.url
  const tabsKey = (sheet?.closedAppointmentTabs || []).join('\n')

  useEffect(() => {
    if (!userId || !sheetUrl || !tabsKey) return undefined
    const tabs = tabsKey.split('\n')
    const storageKey = `closedAppointmentsSeen:${userId}:${sheetId}`
    let cancelled = false
    let busy = false
    let lastAt = 0
    // `?previewCelebration` in the address replays the newest appointment once per page load,
    // to see the celebration without waiting for a real one.
    let previewPending = new URLSearchParams(window.location.search).has('previewCelebration')

    async function check() {
      if (busy) return
      busy = true
      lastAt = Date.now()
      try {
        const rows = await fetchClosedAppointments(sheetUrl, tabs)
        if (cancelled) return
        const keys = rows.map(appointmentKey)
        const seen = readSeen(storageKey)
        if (!seen) {
          // First time here: what is already in the sheet isn't news.
          writeSeen(storageKey, keys)
        } else {
          const fresh = rows.filter((row) => !seen.has(appointmentKey(row)))
          if (fresh.length) {
            writeSeen(storageKey, [...seen, ...fresh.map(appointmentKey)])
            // Rows come newest first; the celebration plays oldest first, in order.
            const toShow = fresh.filter(isRecent).slice(0, MAX_QUEUE).reverse()
            if (toShow.length) setQueue((current) => [...current, ...toShow])
          }
        }
        if (previewPending && rows.length) {
          previewPending = false
          setQueue((current) => [...current, rows[0]])
        }
      } catch (err) {
        // Best-effort: a failed read just means the next poll tries again.
        console.warn('[closedAppointments] check failed:', err.message)
      } finally {
        busy = false
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastAt >= RETURN_POLL_MS) check()
    }

    check()
    const interval = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, sheetId, sheetUrl, tabsKey])

  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), [])

  return { current: queue[0] || null, remaining: Math.max(0, queue.length - 1), dismiss }
}

export { appointmentKey }
