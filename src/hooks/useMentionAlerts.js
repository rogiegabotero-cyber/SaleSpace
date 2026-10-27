import { useCallback, useEffect, useState } from 'react'
import { subscribeToNotes } from '../services/notes'
import { mentionsAccount } from '../utils/mentions'

// Pops up the moment a note mentions this account (or the whole team with @ALL). Firestore
// pushes new notes to every open page, so it arrives as it is posted. The ids of notes already
// seen are kept in this browser, so each note alerts once; notes you wrote yourself never do.
const MAX_QUEUE = 3
const MAX_STORED = 400

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

export function useMentionAlerts(userId, userEmail, enabled = true) {
  const [queue, setQueue] = useState([])

  useEffect(() => {
    if (!userId || !enabled) return undefined
    const storageKey = `noteMentionAlertsSeen:${userId}`
    // As with announcements: nothing is judged until the server (not just the browser's cache)
    // has answered, or every old note would look new.
    let serverAnswered = false

    return subscribeToNotes((notes, metadata) => {
      if (!serverAnswered) {
        if (metadata?.fromCache) return
        serverAnswered = true
      }
      const seen = readSeen(storageKey)
      if (!seen) {
        // First time on this browser: notes already posted aren't news.
        writeSeen(storageKey, notes.map((note) => note.id))
        return
      }
      const fresh = notes.filter((note) => !seen.has(note.id))
      if (!fresh.length) return
      writeSeen(storageKey, [...seen, ...fresh.map((note) => note.id)])
      // Newest first in; the alerts play oldest first.
      const toShow = fresh.filter((note) => note.authorUid !== userId && mentionsAccount(note, userEmail)).slice(0, MAX_QUEUE).reverse()
      if (toShow.length) setQueue((current) => [...current, ...toShow])
    }, (err) => console.warn('[mentions] alerts unavailable:', err.message))
  }, [userId, userEmail, enabled])

  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), [])

  return { current: queue[0] || null, remaining: Math.max(0, queue.length - 1), dismiss }
}
