import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToCallQuotaDetails } from '../services/quota'
import { timeAgo } from '../utils/time'

// The latest change to the daily call quota, as an entry for the bell's notification list, with
// unread tracking kept in this browser per user. It stays listed for a few days.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const CLOCK_MS = 60 * 1000
const MAX_STORED = 50

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

export function useQuotaNotifications(userId) {
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const storageKey = `quotaChangeRead:${userId}`
  const [readIds, setReadIds] = useState(() => (userId ? readRead(storageKey) : new Set()))

  useEffect(() => {
    if (!userId) return undefined
    return subscribeToCallQuotaDetails(setData, (err) => console.warn('[quota] notifications unavailable:', err.message))
  }, [userId])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(interval)
  }, [])

  const items = useMemo(() => {
    if (!data?.updatedAt || data.value <= 0 || data.value === data.previousValue) return []
    if (now - data.updatedAt.getTime() > MAX_AGE_MS) return []
    const by = data.updatedByName || data.updatedBy || 'A manager'
    return [{
      id: `quota:${data.updatedAt.getTime()}`,
      title: data.previousValue > 0 ? 'Daily call quota changed' : 'Daily call quota set',
      text: `${by} set it to ${data.value} call${data.value === 1 ? '' : 's'} a day${data.previousValue > 0 ? ` (was ${data.previousValue})` : ''}.`,
      time: timeAgo({ toDate: () => data.updatedAt }),
      at: data.updatedAt.getTime(),
      kind: 'quota',
      focus: 'quota',
    }]
  }, [data, now])

  const unreadIds = useMemo(() => items.filter((item) => !readIds.has(item.id)).map((item) => item.id), [items, readIds])

  const markAllRead = useCallback(() => {
    setReadIds((current) => {
      const next = new Set(current)
      items.forEach((item) => next.add(item.id))
      writeRead(storageKey, next)
      return next
    })
  }, [items, storageKey])

  const markRead = useCallback((id) => {
    setReadIds((current) => {
      const next = new Set(current).add(id)
      writeRead(storageKey, next)
      return next
    })
  }, [storageKey])

  return { items, unreadIds, markAllRead, markRead }
}
