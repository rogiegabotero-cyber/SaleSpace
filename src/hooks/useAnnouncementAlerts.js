import { useCallback, useEffect, useState } from 'react'
import { subscribeToAnnouncements } from '../services/announcements'

// Tells everyone in the workspace, the moment it is posted, that there's a new announcement.
// Firestore pushes changes to every open page, so unlike the closed-appointment alert there's
// no polling: a post reaches all signed-in users — the poster included — as it happens. The
// ids a user has already been shown are remembered in this browser, so each announcement
// alerts once (editing one doesn't alert again), and someone who was away is told about what
// they missed when they next open the portal.
const MAX_QUEUE = 3
const MAX_STORED = 200

function readSeen(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeSeen(storageKey, ids) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...new Set(ids)].slice(-MAX_STORED)))
  } catch {
    // Storage can be unavailable (private window); the worst case is a repeat alert.
  }
}

export function useAnnouncementAlerts(userId, enabled = true) {
  const [queue, setQueue] = useState([])

  useEffect(() => {
    if (!userId || !enabled) return undefined
    const storageKey = `announcementsSeen:${userId}`
    // The first snapshot is often just the browser's cache (possibly empty); treating that as
    // "everything on the server is new" would replay every old announcement, so nothing is
    // judged until the server has answered once.
    let serverAnswered = false

    return subscribeToAnnouncements((items, metadata) => {
      if (!serverAnswered) {
        if (metadata?.fromCache) return
        serverAnswered = true
      }
      const seen = readSeen(storageKey)
      if (!seen) {
        // First time on this browser: what is already posted isn't news.
        writeSeen(storageKey, items.map((item) => item.id))
        return
      }
      const fresh = items.filter((item) => !seen.has(item.id))
      if (!fresh.length) return
      writeSeen(storageKey, [...seen, ...fresh.map((item) => item.id)])
      const now = Date.now()
      // Items come newest first; the alerts play oldest first. Already-expired ones are skipped.
      const toShow = fresh
        .filter((item) => {
          const expiresAt = item.expiresAt?.toDate?.()
          return !expiresAt || expiresAt.getTime() > now
        })
        .slice(0, MAX_QUEUE)
        .reverse()
      if (toShow.length) setQueue((current) => [...current, ...toShow])
    }, (err) => console.warn('[announcements] alerts unavailable:', err.message))
  }, [userId, enabled])

  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), [])

  return { current: queue[0] || null, remaining: Math.max(0, queue.length - 1), dismiss }
}
