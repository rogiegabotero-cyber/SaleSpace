import { useEffect, useState } from 'react'
import { hyacinthAttendanceAPI } from '../api/hyacinthAttendance'

export const ATTENDANCE_STATUSES = ['Early', 'On Time', 'Late', 'PTO', 'Absent', 'NCNS']

function emptyCounts() {
  return Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, []]))
}

export function useAttendanceBreakdown(people, dateISO) {
  const [counts, setCounts] = useState(emptyCounts)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setLoading(true) })
    Promise.all(people.map(async (person) => {
      try {
        const logs = await hyacinthAttendanceAPI.getAttendanceLogs({ userId: person.id, startDate: dateISO, endDate: dateISO })
        const inLog = (logs || []).find((log) => log.type === 'In' && ATTENDANCE_STATUSES.includes(log.status))
        return inLog ? { status: inLog.status, name: person.name } : null
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      const next = emptyCounts()
      entries.forEach((entry) => { if (entry) next[entry.status].push(entry.name) })
      setCounts(next)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [people, dateISO])

  return { counts, loading }
}
