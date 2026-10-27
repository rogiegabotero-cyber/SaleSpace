import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToCallQuotaDetails } from '../services/quota'
import { timeAgo } from '../utils/time'
import { useSyncedReadIds } from './useSyncedReadIds'

// The latest change to the daily call quota, as an entry for the bell's notification list, with
// unread tracking kept on the user's account. It stays listed for a few days.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const CLOCK_MS = 60 * 1000
const MAX_STORED = 50

export function useQuotaNotifications(userId) {
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const { readIds, loaded, markRead, markManyRead } = useSyncedReadIds(userId, 'quotaChangeRead', `quotaChangeRead:${userId}`, MAX_STORED)

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

  // Nothing counts as unread until the account's list of what was read has arrived.
  const unreadIds = useMemo(() => (loaded ? items.filter((item) => !readIds.has(item.id)).map((item) => item.id) : []), [items, readIds, loaded])

  const markAllRead = useCallback(() => markManyRead(items.map((item) => item.id)), [items, markManyRead])

  return { items, unreadIds, markAllRead, markRead }
}
