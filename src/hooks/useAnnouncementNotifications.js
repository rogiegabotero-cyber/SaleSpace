import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToAnnouncements } from '../services/announcements'
import { useSyncedReadIds } from './useSyncedReadIds'

// Feeds the bell's notification list with the announcements that are currently active, and
// tracks which of them this user has already looked at (kept on their account, so it is the same in every browser), so
// the bell can show an unread dot.
const EXPIRY_CHECK_MS = 30 * 1000
const MAX_STORED = 200
const PREVIEW_LENGTH = 140

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
  const { readIds, loaded, markRead, markManyRead } = useSyncedReadIds(userId, 'announcementsRead', `announcementsRead:${userId}`, MAX_STORED)

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

  // Nothing counts as unread until the account's list of what was read has arrived.
  const unreadIds = useMemo(() => (loaded ? items.filter((item) => !readIds.has(item.id)).map((item) => item.id) : []), [items, readIds, loaded])

  const markAllRead = useCallback(() => markManyRead(items.map((item) => item.id)), [items, markManyRead])

  return { items, unreadIds, markAllRead, markRead }
}
