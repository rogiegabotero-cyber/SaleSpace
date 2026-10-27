import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToAnnouncements } from '../services/announcements'

// Feeds the bell's notification list with the announcements that are currently active, and
// tracks which of them this user has already looked at (kept in this browser, per user), so
// the bell can show an unread dot.
const EXPIRY_CHECK_MS = 30 * 1000
const MAX_STORED = 200
const PREVIEW_LENGTH = 140

function readRead(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeRead(storageKey, ids) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids].slice(-MAX_STORED)))
  } catch {
    // Storage can be unavailable (private window); the dot just reappears next visit.
  }
}

function timeAgo(date, now) {
  const minutes = Math.floor((now - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function useAnnouncementNotifications(userId) {
  const [announcements, setAnnouncements] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const storageKey = `announcementsRead:${userId}`
  const [readIds, setReadIds] = useState(() => (userId ? readRead(storageKey) : new Set()))

  useEffect(() => {
    if (!userId) return undefined
    return subscribeToAnnouncements(setAnnouncements, (err) => console.warn('[announcements] notifications unavailable:', err.message))
  }, [userId])

  // An announcement drops out of the list when it expires, and "5m ago" needs to keep ticking.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), EXPIRY_CHECK_MS)
    return () => clearInterval(interval)
  }, [])

  const items = useMemo(() => announcements
    .filter((item) => {
      const expiresAt = item.expiresAt?.toDate?.()
      return !expiresAt || expiresAt.getTime() > now
    })
    .map((item) => {
      const created = item.createdAt?.toDate?.()
      const text = item.text.length > PREVIEW_LENGTH ? `${item.text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : item.text
      return {
        id: item.id,
        title: item.title || `${item.authorName || 'Someone'} posted an announcement`,
        text: item.title ? `${item.authorName || 'Someone'}: ${text}` : text,
        time: created ? timeAgo(created, now) : 'Just now',
        at: created ? created.getTime() : now,
        kind: 'announcement',
        focus: `announcement:${item.id}`,
      }
    }), [announcements, now])

  const unreadIds = useMemo(() => items.filter((item) => !readIds.has(item.id)).map((item) => item.id), [items, readIds])

  const markAllRead = useCallback(() => {
    setReadIds((current) => {
      const next = new Set(current)
      items.forEach((item) => next.add(item.id))
      writeRead(storageKey, next)
      return next
    })
  }, [items, storageKey])

  // One entry read (when it is clicked), as opposed to all of them.
  const markRead = useCallback((id) => {
    setReadIds((current) => {
      const next = new Set(current).add(id)
      writeRead(storageKey, next)
      return next
    })
  }, [storageKey])

  return { items, unreadIds, markAllRead, markRead }
}
