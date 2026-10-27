import { useCallback, useEffect, useState } from 'react'
import { subscribeToCallQuotaDetails } from '../services/quota'

// Pops up for everyone the moment the daily call quota is changed — whoever is online, admins
// and the person who changed it included. Firestore pushes the change to every open page. What
// each user has already been told is remembered in this browser (the time of the last change
// they saw), so a change alerts once; someone who was away is told when they next open the
// portal. A save that doesn't change the number alerts nobody.
function readSeen(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw === null ? null : Number(raw)
  } catch {
    return null
  }
}

function writeSeen(storageKey, millis) {
  try {
    window.localStorage.setItem(storageKey, String(millis))
  } catch {
    // Storage can be unavailable (private window); the worst case is a repeat alert.
  }
}

export function useQuotaAlerts(userId, enabled = true) {
  const [change, setChange] = useState(null)

  useEffect(() => {
    if (!userId || !enabled) return undefined
    const storageKey = `quotaChangeSeen:${userId}`
    // Nothing is judged until the server has answered (the first snapshot is often just the
    // browser's cache), and a write still waiting for the server is skipped, so the person who
    // saved gets exactly one alert — once the server has stamped the time.
    let serverAnswered = false

    return subscribeToCallQuotaDetails((data, metadata) => {
      if (!serverAnswered) {
        if (metadata?.fromCache) return
        serverAnswered = true
      }
      if (metadata?.hasPendingWrites) return
      const changedAt = data?.updatedAt ? data.updatedAt.getTime() : 0
      const seen = readSeen(storageKey)
      if (seen === null) {
        // First time on this browser: the current quota isn't news.
        writeSeen(storageKey, changedAt)
        return
      }
      if (!data || changedAt <= seen) return
      writeSeen(storageKey, changedAt)
      if (data.value !== data.previousValue) setChange(data)
    }, (err) => console.warn('[quota] alerts unavailable:', err.message))
  }, [userId, enabled])

  const dismiss = useCallback(() => setChange(null), [])

  return { change, dismiss }
}
