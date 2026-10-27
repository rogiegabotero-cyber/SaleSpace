import { useEffect, useState } from 'react'
import { hyacinthAttendanceAPI } from '../api/hyacinthAttendance'
import { syncEmployees } from '../services/employees'

const COLORS = ['coral', 'blue', 'purple', 'green']
// Attendance isn't needed live: each refresh costs one request per employee, and a new
// `people` list also makes the attendance breakdown and monthly counts refetch theirs.
const REFRESH_MS = 60 * 60_000

function initialsOf(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFor(seed) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Online state plus today's attendance status (Early / On Time / Late, ...), which the API
// stamps on the day's first "In" log — the same log the attendance breakdown reads.
async function getTodayPresence(userId, signal) {
  const today = todayISO()
  const logs = await hyacinthAttendanceAPI.getAttendanceLogs(
    { userId, startDate: today, endDate: today },
    signal,
  )
  if (!logs?.length) return { online: false, attendanceStatus: null }
  const byTime = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const firstIn = byTime.find((log) => log.type === 'In' && log.status)
  return {
    online: byTime[byTime.length - 1].type === 'In',
    attendanceStatus: firstIn?.status || null,
  }
}

async function safeGetTodayPresence(userId, signal) {
  try {
    return await getTodayPresence(userId, signal)
  } catch {
    return { online: false, attendanceStatus: null }
  }
}

export function useTeamPresence(departmentId) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(Boolean(departmentId))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!departmentId) return

    const controller = new AbortController()
    let cancelled = false

    async function load() {
      try {
        const users = await hyacinthAttendanceAPI.getUsersByDepartment(
          departmentId,
          controller.signal,
        )

        try {
          await syncEmployees(users, departmentId)
        } catch {
          // Persistence is intentionally best-effort for live presence.
        }

        const withPresence = await Promise.all(
          users.map(async (user) => {
            const { online, attendanceStatus } = await safeGetTodayPresence(user.userId, controller.signal)
            return {
              id: user.userId,
              initials: initialsOf(user.name || user.email || '?'),
              name: user.name,
              email: user.email || '',
              role: user.position || user.role,
              color: colorFor(user.userId),
              online,
              attendanceStatus,
              profileImg: user.profileImg,
            }
          }),
        )

        if (!cancelled) {
          setPeople(withPresence)
          setError(null)
        }
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, REFRESH_MS)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(interval)
    }
  }, [departmentId])

  return { people, loading, error }
}
