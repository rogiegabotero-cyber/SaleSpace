import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToNotes } from '../services/notes'
import { mentionsAccount } from '../utils/mentions'
import { timeAgo } from '../utils/time'
import { useSyncedReadIds } from './useSyncedReadIds'

// Notes that mention this account (or the whole team with @ALL), as entries for the bell's
// notification list, with unread tracking kept on the user's account. Your own notes never
// notify you. Only recent ones are listed.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
// How often the "5m ago" labels (and the 14-day cut-off) are refreshed while the page is open.
const CLOCK_MS = 60 * 1000
const MAX_STORED = 200
const PREVIEW_LENGTH = 140

export function useMentionNotifications(userId, userEmail) {
  const [notes, setNotes] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const { readIds, loaded, markRead, markManyRead } = useSyncedReadIds(userId, 'noteMentionsRead', `noteMentionsRead:${userId}`, MAX_STORED)

  useEffect(() => {
    if (!userId) return undefined
    return subscribeToNotes(setNotes, (err) => console.warn('[mentions] notifications unavailable:', err.message))
  }, [userId])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(interval)
  }, [])

  const items = useMemo(() => {
    const cutoff = now - MAX_AGE_MS
    return notes
      .filter((note) => note.authorUid !== userId && mentionsAccount(note, userEmail))
      .filter((note) => { const created = note.createdAt?.toDate?.(); return !created || created.getTime() >= cutoff })
      .map((note) => {
        const created = note.createdAt?.toDate?.()
        const text = note.text.length > PREVIEW_LENGTH ? `${note.text.slice(0, PREVIEW_LENGTH).trimEnd()}…` : note.text
        return {
          id: `note:${note.id}`,
          title: note.mentionAll ? `Important note from ${note.authorName || 'a teammate'}` : `${note.authorName || 'A teammate'} mentioned you`,
          text,
          time: timeAgo(note.createdAt),
          at: created ? created.getTime() : now,
          important: Boolean(note.mentionAll),
          kind: 'note',
          focus: `note:${note.id}`,
        }
      })
  }, [notes, userId, userEmail, now])

  // Nothing counts as unread until the account's list of what was read has arrived.
  const unreadIds = useMemo(() => (loaded ? items.filter((item) => !readIds.has(item.id)).map((item) => item.id) : []), [items, readIds, loaded])

  const markAllRead = useCallback(() => markManyRead(items.map((item) => item.id)), [items, markManyRead])

  return { items, unreadIds, markAllRead, markRead }
}
