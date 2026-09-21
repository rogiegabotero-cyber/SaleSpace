import { useEffect, useState } from 'react'
import { hyacinthAttendanceAPI } from '../api/hyacinthAttendance'
import { syncEmployees } from '../services/employees'

const COLORS = ['coral', 'blue', 'purple', 'green']
const REFRESH_MS = 60_000

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

async function isUserOnline(userId, signal) {
  const today = todayISO()
  const logs = await hyacinthAttendanceAPI.getAttendanceLogs(
    { userId, startDate: today, endDate: today },
    signal,
  )
  if (!logs?.length) return false
  const latest = [...logs].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  )[0]
  return latest.type === 'In'
}

async function safeIsUserOnline(userId, signal) {
  try {
    return await isUserOnline(userId, signal)
  } catch {
    return false
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
            const online = await safeIsUserOnline(user.userId, controller.signal)
            return {
              id: user.userId,
              initials: initialsOf(user.name || user.email || '?'),
              name: user.name,
              email: user.email || '',
              role: user.position || user.role,
              color: colorFor(user.userId),
              online,
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
