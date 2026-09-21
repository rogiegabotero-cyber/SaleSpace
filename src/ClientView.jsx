import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSignInWithEmailLink, signInWithEmailLink, signOut } from 'firebase/auth'
import './client.css'
import './admin.css'
import { auth } from './firebase'
import { useAuthGate } from './hooks/useAuthGate'
import { useTeamPresence } from './hooks/useTeamPresence'
import { ATTENDANCE_STATUSES, useAttendanceBreakdown } from './hooks/useAttendanceBreakdown'
import { hyacinthAttendanceAPI } from './api/hyacinthAttendance'
import { fetchHandlerCounts, googleSheetTabUrl, setCallsSheetSelection, subscribeToCallsSheets, subscribeToCallsSheetSelection } from './services/callsSheet'
import { recordDailyCallDeltas, subscribeToDailyCalls } from './services/dailyCalls'
import { createPortalUser } from './services/users'
import { acceptInvite, getInvite } from './services/invites'
import { subscribeToPreferences, updatePreferences } from './services/preferences'
import { Avatar, Icon } from './PortalShell'
import { initialsOf } from './utils/initials'
import ChangePasswordForm from './ChangePasswordForm'
import LoadingOverlay from './LoadingOverlay'
import PageLoading from './PageLoading'
import PanelSwitchBar from './PanelSwitchBar'
import SettingsPage from './SettingsPage'
import salesLogo from './assets/sales-logo2.webp'
import salesLogoGlow from './assets/sales-logo2-glow.webp'

const EMAIL_FOR_SIGN_IN_KEY = 'emailForSignIn'

const NAV_ITEMS = [['Dashboard', 'grid'], ['Attendance Log', 'clock']]
const AVATAR_COLORS = ['coral', 'blue', 'purple', 'green']
const ATTENDANCE_STATUS_COLORS = {
  Early: '#2f6fed',
  'On Time': '#16a34a',
  Late: '#d97706',
  PTO: '#9333ea',
  Absent: '#dc2626',
  NCNS: '#52667a',
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function shiftISODate(dateISO, deltaDays) {
  const [year, month, day] = dateISO.split('-').map(Number)
  const next = new Date(year, month - 1, day + deltaDays)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function dayLabel(dateISO) {
  if (dateISO === todayISO()) return 'Today'
  if (dateISO === shiftISODate(todayISO(), -1)) return 'Yesterday'
  const [year, month, day] = dateISO.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The Hyacinth attendance API's exact field name for a log's note isn't
// documented anywhere in this repo, so this checks every name we've seen an
// attendance system use for the same thing rather than guessing wrong and
// silently showing nothing.
function attendanceNoteOf(log) {
  return (log.notes || log.note || log.remarks || log.remark || log.comment || log.comments || '').trim()
}

function firstNameOf(name) {
  return (name || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
}

function colorFor(seed) {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function matchEmployeeByName(handlerName, people) {
  const target = firstNameOf(handlerName)
  if (!target) return null
  const matches = people.filter((person) => firstNameOf(person.name) === target)
  return matches.length === 1 ? matches[0] : null
}

function monthRange() {
  const now = new Date()
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const endDate = now.toISOString().slice(0, 10)
  return { startDate, endDate }
}

function useMonthlyAttendance(people) {
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const { startDate, endDate } = monthRange()
    Promise.all(people.map(async (person) => {
      try {
        const logs = await hyacinthAttendanceAPI.getAttendanceLogs({ userId: person.id, startDate, endDate })
        const daysPresent = new Set((logs || []).filter((log) => log.type === 'In').map((log) => log.timestamp.slice(0, 10))).size
        return [person.id, daysPresent]
      } catch {
        return [person.id, 0]
      }
    })).then((entries) => {
      if (!cancelled) {
        setCounts(Object.fromEntries(entries))
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [people])

  return { counts, loading }
}

function useCallsSheet() {
  const [sheets, setSheets] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => subscribeToCallsSheets(setSheets, (err) => setError(err.message)), [])
  useEffect(() => subscribeToCallsSheetSelection(setSelectedId, (err) => setError(err.message)), [])

  const selectedSheet = useMemo(() => {
    if (!sheets.length) return null
    return sheets.find((sheet) => sheet.id === selectedId) || sheets[0]
  }, [sheets, selectedId])

  // Shared by the auto-load effect below and the manual refresh button, so a
  // refresh re-runs the exact same fetch-and-record path instead of drifting
  // out of sync with it. Awaits recordDailyCallDeltas (rather than firing it
  // and moving on) so the caller's "done" moment is once the Daily calls
  // panel's Firestore-backed data has actually been written too, not just
  // once the sheet counts have — otherwise the refresh button can report
  // done while that panel is still showing pre-refresh numbers.
  const loadCounts = useCallback((sheet, isCancelled) => {
    if (!sheet?.url) return Promise.resolve()
    return fetchHandlerCounts(sheet.url, sheet.sheetNames, { handlerHeader: sheet.handlerHeader, validHandlers: sheet.validHandlers, availableLabels: sheet.availableLabels })
      .then((result) => {
        if (isCancelled()) return undefined
        setCounts(result)
        setError('')
        return recordDailyCallDeltas(sheet.id, result.counts).catch((err) => console.error('recordDailyCallDeltas failed', err))
      })
      .catch((err) => { if (!isCancelled()) setError(err.message) })
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setCounts(null) })
    loadCounts(selectedSheet, () => cancelled)
    return () => { cancelled = true }
  }, [selectedSheet?.url, selectedSheet?.sheetNames, selectedSheet?.id, selectedSheet?.handlerHeader, selectedSheet?.validHandlers, selectedSheet?.availableLabels, loadCounts])

  async function refresh() {
    if (!selectedSheet?.url || refreshing) return
    setRefreshing(true)
    try {
      // Keeps whatever's already on screen up during the refetch, rather than
      // clearing it and flashing every sheet-fed panel back to a loading state.
      await loadCounts(selectedSheet, () => false)
    } finally {
      setRefreshing(false)
    }
  }

  function selectSheet(id) {
    setCallsSheetSelection(id).catch((err) => setError(err.message))
  }

  const loading = Boolean(selectedSheet?.url) && counts === null && !error
  return { sheets, selectedId: selectedSheet?.id || null, selectSheet, url: selectedSheet?.url, tabGids: selectedSheet?.tabGids || {}, counts, loading, refreshing, refresh, error }
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function useDailyCalls(sheetId) {
  const [byDate, setByDate] = useState({})
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`

  useEffect(() => subscribeToDailyCalls(sheetId, monthStart, monthEnd, setByDate, () => {}), [sheetId, monthStart, monthEnd])

  return { byDate, year, month, monthStart, monthEnd }
}

function ClientHeader({ activePage, onNavigate, onOpenSettings, darkMode = false, onToggleDarkMode }) {
  return <header className="client-header">
    <img className="client-logo" src={darkMode ? salesLogoGlow : salesLogo} alt="Salespace" />
    <nav className="client-nav">
      {NAV_ITEMS.map(([label, icon]) => <button type="button" key={label} className={`client-nav-item ${activePage === label ? 'active' : ''}`} onClick={() => onNavigate(label)}><Icon name={icon} size={15} /><span>{label}</span></button>)}
    </nav>
    <button type="button" className="icon-button theme-toggle" aria-label="Toggle dark mode" onClick={onToggleDarkMode}><Icon name={darkMode ? 'sun' : 'moon'} /></button>
    <button type="button" className={`icon-button ${activePage === 'Settings' ? 'active' : ''}`} aria-label="Settings" onClick={onOpenSettings}><Icon name="settings" /></button>
  </header>
}

function AttendanceBreakdownRing({ counts, total }) {
  const size = 132
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const gap = total > 1 ? 2 : 0
  let offset = 0

  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="breakdown-ring">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
    {total > 0 && ATTENDANCE_STATUSES.map((status) => {
      const count = counts[status].length
      if (!count) return null
      const length = (count / total) * circumference
      const dash = Math.max(0, length - gap)
      const segment = <circle key={status} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={ATTENDANCE_STATUS_COLORS[status]} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      offset += length
      return segment
    })}
  </svg>
}

function AttendanceBreakdown({ people }) {
  const [selectedDate, setSelectedDate] = useState(todayISO)
  const { counts, loading } = useAttendanceBreakdown(people, selectedDate)
  const total = ATTENDANCE_STATUSES.reduce((sum, status) => sum + counts[status].length, 0)
  const maxRows = Math.max(1, ...ATTENDANCE_STATUSES.map((status) => counts[status].length))
  const isToday = selectedDate === todayISO()

  return <section className="panel attendance-breakdown">
    <div className="panel-heading"><div><h2>Attendance Breakdown</h2></div></div>
    {loading ? <p className="team-status-message">Loading attendance...</p> : <>
      <div className="breakdown-body">
        <div className="breakdown-ring-wrap">
          <AttendanceBreakdownRing counts={counts} total={total} />
          <div className="breakdown-ring-label"><small>Range</small><strong>{selectedDate} → {selectedDate}</strong><small>Total Counted</small><strong className="breakdown-total">{total}</strong></div>
        </div>
        <div className="breakdown-table-wrap">
          <div className="breakdown-legend">{ATTENDANCE_STATUSES.map((status) => <span className="breakdown-legend-item" key={status}><i className="breakdown-dot" style={{ background: ATTENDANCE_STATUS_COLORS[status] }} />{status} {counts[status].length}</span>)}</div>
          <div className="breakdown-table">
            <div className="breakdown-table-head">{ATTENDANCE_STATUSES.map((status) => <span key={status}>{status}</span>)}</div>
            {Array.from({ length: maxRows }).map((_, rowIndex) => <div className="breakdown-table-row" key={rowIndex}>{ATTENDANCE_STATUSES.map((status) => <span key={status}>{counts[status][rowIndex] || '-'}</span>)}</div>)}
          </div>
        </div>
      </div>
      <div className="breakdown-footer">
        <span>Employees: {people.length} · Eligible Days: {people.length}</span>
        <div className="breakdown-nav">
          <button type="button" className="breakdown-nav-arrow" aria-label="Previous day" onClick={() => setSelectedDate((date) => shiftISODate(date, -1))}>‹</button>
          <button type="button" className={`breakdown-today ${isToday ? 'active' : ''}`} aria-label="Jump to today" onClick={() => setSelectedDate(todayISO())}>{dayLabel(selectedDate)}</button>
          <button type="button" className="breakdown-nav-arrow" aria-label="Next day" disabled={isToday} onClick={() => setSelectedDate((date) => shiftISODate(date, 1))}>›</button>
        </div>
      </div>
    </>}
  </section>
}

function PercentageRing({ percent }) {
  const size = 92
  const strokeWidth = 11
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const dash = (clamped / 100) * circumference

  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="percent-ring">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
    {clamped > 0 && <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue)" strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${dash} ${circumference - dash}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
  </svg>
}

function CallsProgressRing({ handled, available }) {
  const size = 56
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = handled + available
  const gap = total > 0 ? 3 : 0

  // Positioned by what's actually drawn (dash, below), not the raw proportional
  // length — a flat gap subtraction can shrink a tiny-but-nonzero slice's raw
  // length below zero, so it's floored to a small visible sliver instead. Using
  // the raw length for the *next* segment's start (rather than this floored
  // value) let that segment's start creep back before this one's drawn end,
  // and since it paints on top, it silently covered this slice completely.
  let offset = 0
  const segments = [
    { value: handled, color: 'var(--blue)' },
    { value: available, color: '#d97706' },
  ].map((segment) => {
    if (segment.value <= 0) return null
    const rawLength = (segment.value / total) * circumference
    const dash = Math.max(2, rawLength - gap)
    const circle = { ...segment, dash, dashOffset: -offset }
    offset += dash + gap
    return circle
  })

  // Painted in reverse (available first, handled last) so the handled slice
  // always sits on top — its rounded stroke cap can slightly overshoot its
  // nominal length, and whichever segment paints last wins that overlap.
  const handledPercent = total > 0 ? `${((handled / total) * 100).toFixed(1)}%` : '0%'

  return <div className="calls-progress-ring-wrap">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="calls-progress-ring">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
      {[...segments].reverse().map((segment, index) => segment && <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={`${segment.dash} ${circumference - segment.dash}`} strokeDashoffset={segment.dashOffset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />)}
    </svg>
    <div className="calls-progress-ring-label">{handledPercent}</div>
  </div>
}

function AgentCallsSection({ agentName, displayName, perTab, agentCalls, monthTotal, monthLabel }) {
  const rows = useMemo(() => [...perTab]
    .map((tab) => ({ name: tab.name, count: agentName ? tab.counts.find((item) => item.name === agentName)?.count || 0 : 0 }))
    .sort((a, b) => b.count - a.count), [perTab, agentName])
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const maxCount = Math.max(1, ...rows.map((row) => row.count))
  const percent = monthTotal > 0 ? Math.round((agentCalls / monthTotal) * 100) : 0

  if (!agentName) return <p className="empty-table">No call data for {displayName} yet.</p>

  return <>
    <div className="stat-modal-percent">
      <div className="percent-ring-wrap">
        <PercentageRing percent={percent} />
        <div className="percent-ring-label"><strong>{percent}%</strong><small>of monthly calls</small></div>
      </div>
      <div className="stat-modal-percent-info"><p>{displayName} handled <b>{agentCalls}</b> of <b>{monthTotal}</b> calls logged by the whole team in {monthLabel}.</p></div>
    </div>
    <div className="stat-modal-total"><span>Total calls (all tabs)</span><strong>{total}</strong></div>
    <div className="stat-modal-list">
      {rows.length ? rows.map((row) => <div className="stat-tab-row" key={row.name}><span className="stat-tab-name">{row.name}</span><div className="stat-tab-track"><div className="stat-tab-fill" style={{ width: `${(row.count / maxCount) * 100}%` }} /></div><span className="stat-tab-value">{row.count}</span></div>) : <p className="empty-table">No tab data yet.</p>}
    </div>
  </>
}

function AttendanceSection({ person }) {
  const [logs, setLogs] = useState(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const endDate = todayISO()
  const startDate = shiftISODate(endDate, -6)

  useEffect(() => {
    let cancelled = false
    hyacinthAttendanceAPI.getAttendanceLogs({ userId: person.id, startDate, endDate })
      .then((result) => {
        if (cancelled) return
        setLogs([...(result || [])].filter((log) => log.type === 'In').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)))
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [person.id, startDate, endDate])

  const counts = useMemo(() => {
    const next = Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, []]))
    for (const log of logs || []) { if (next[log.status]) next[log.status].push(log) }
    return next
  }, [logs])
  const total = ATTENDANCE_STATUSES.reduce((sum, status) => sum + counts[status].length, 0)
  const filteredLogs = (logs || []).filter((log) => statusFilter === 'All' || log.status === statusFilter)

  if (logs === null) return <p className="team-status-message">Loading attendance...</p>
  if (error) return <p className="team-status-message team-status-error">{error}</p>

  return <div className="attendance-modal-grid">
    <div className="attendance-modal-info-card">
      <h4>Basic Employee Info</h4>
      <div className="breakdown-ring-wrap">
        <AttendanceBreakdownRing counts={counts} total={total} />
        <div className="breakdown-ring-label"><small>Range</small><strong>{startDate} → {endDate}</strong><small>Total Counted</small><strong className="breakdown-total">{total}</strong></div>
      </div>
      <div className="attendance-modal-legend-list">{ATTENDANCE_STATUSES.map((status) => <div className="attendance-modal-legend-row" key={status}><span className="breakdown-dot" style={{ background: ATTENDANCE_STATUS_COLORS[status] }} />{status}<b>{counts[status].length}</b></div>)}</div>
    </div>
    <div className="attendance-modal-logs-card">
      <div className="attendance-modal-logs-head">
        <h4>Weekly Attendance Logs</h4>
        <div className="attendance-modal-filters">
          <span className="attendance-modal-filters-label">Status</span>
          <button type="button" className={`attendance-filter-chip ${statusFilter === 'All' ? 'active' : ''}`} onClick={() => setStatusFilter('All')}>All</button>
          {ATTENDANCE_STATUSES.map((status) => <button type="button" key={status} className={`attendance-filter-chip ${statusFilter === status ? 'active' : ''}`} style={ATTENDANCE_STATUS_COLORS[status] ? { color: ATTENDANCE_STATUS_COLORS[status], background: `${ATTENDANCE_STATUS_COLORS[status]}1a` } : undefined} onClick={() => setStatusFilter(status)}>{status}</button>)}
        </div>
      </div>
      <div className="attendance-modal-table">
        <div className="attendance-modal-row attendance-modal-head"><span>Employee</span><span>Day</span><span>Time</span><span>Status</span><span>Notes</span></div>
        <div className="attendance-modal-rows">
          {filteredLogs.length ? filteredLogs.map((log, index) => <div className="attendance-modal-row" key={index}>
            <span>{person.name}</span>
            <span>{new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(log.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
            <span className="attendance-status" style={ATTENDANCE_STATUS_COLORS[log.status] ? { color: ATTENDANCE_STATUS_COLORS[log.status], background: `${ATTENDANCE_STATUS_COLORS[log.status]}1a` } : undefined}>{log.status}</span>
            <span>{attendanceNoteOf(log) || '-'}</span>
          </div>) : <p className="empty-table">No attendance logs for this range.</p>}
        </div>
      </div>
    </div>
  </div>
}

function TopAgentModal({ agentName, displayName, avatar, perTab, agentCalls, monthTotal, monthLabel, onClose }) {
  return <div className="modal-overlay" role="presentation" onClick={onClose}>
    <div className="modal-card stat-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="stat-modal-header">
        {avatar}
        <div><h3>{displayName}</h3><p>Top agent · calls per tab</p></div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <AgentCallsSection agentName={agentName} displayName={displayName} perTab={perTab} agentCalls={agentCalls} monthTotal={monthTotal} monthLabel={monthLabel} />
    </div>
  </div>
}

function TopAttendanceModal({ person, onClose }) {
  return <div className="modal-overlay" role="presentation" onClick={onClose}>
    <div className="modal-card stat-modal-card attendance-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="icon-button attendance-modal-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      <div className="attendance-modal-header">
        {person.profileImg ? <img className="avatar avatar-photo avatar-large" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} large />}
        <div className="attendance-modal-identity">
          <strong>{person.name}</strong>
          {person.email && <span className="attendance-modal-email">{person.email}</span>}
          {person.role && <div className="attendance-modal-pills"><span className="attendance-modal-pill">{person.role}</span></div>}
        </div>
      </div>
      <AttendanceSection person={person} />
    </div>
  </div>
}

function EmployeeStatsModal({ person, people, monthlyCallTotals, monthTotal, monthLabel, perTab, onClose }) {
  const agentName = useMemo(
    () => Object.keys(monthlyCallTotals).find((name) => matchEmployeeByName(name, people)?.id === person.id) || null,
    [monthlyCallTotals, people, person.id],
  )
  const agentCalls = agentName ? monthlyCallTotals[agentName] : 0

  return <div className="modal-overlay" role="presentation" onClick={onClose}>
    <div className="modal-card stat-modal-card attendance-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="icon-button attendance-modal-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      <div className="attendance-modal-header">
        {person.profileImg ? <img className="avatar avatar-photo avatar-large" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} large />}
        <div className="attendance-modal-identity">
          <strong>{person.name}</strong>
          {person.email && <span className="attendance-modal-email">{person.email}</span>}
          {person.role && <div className="attendance-modal-pills"><span className="attendance-modal-pill">{person.role}</span></div>}
        </div>
      </div>
      <p className="stat-modal-section-label">Calls this month</p>
      <AgentCallsSection agentName={agentName} displayName={person.name} perTab={perTab} agentCalls={agentCalls} monthTotal={monthTotal} monthLabel={monthLabel} />
      <p className="stat-modal-section-label">Attendance (last 7 days)</p>
      <AttendanceSection person={person} />
    </div>
  </div>
}

function DailyCallsCalendar({ people, callCounts, dailyByDate, year, month }) {
  const total = daysInMonth(year, month)
  const days = Array.from({ length: total }, (_, index) => index + 1)
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return <section className="panel daily-calls">
    <div className="panel-heading"><div><h2>Daily calls</h2><p>{monthLabel} · calls taken per employee per day</p></div></div>
    {callCounts.length ? <div className="daily-calls-scroll">
      <div className="daily-calls-grid" style={{ gridTemplateColumns: `220px repeat(${total}, 32px)` }}>
        <div className="daily-calls-corner" />
        {days.map((day) => {
          const isWeekend = [0, 6].includes(new Date(year, month, day).getDay())
          return <div key={day} className={`daily-calls-day-head ${isWeekend ? 'weekend' : ''}`}><small>{new Date(year, month, day).toLocaleDateString(undefined, { weekday: 'short' })}</small><strong>{day}</strong></div>
        })}
        {callCounts.map((item) => {
          const match = matchEmployeeByName(item.name, people)
          return <Fragment key={item.name}>
            <div className="daily-calls-name">{match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || item.name)} color={match?.color || colorFor(item.name)} small />}<span>{match?.name || item.name}</span></div>
            {days.map((day) => {
              const dateISO = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isWeekend = [0, 6].includes(new Date(year, month, day).getDay())
              const count = dailyByDate[dateISO]?.[item.name] || 0
              return <div key={day} className={`daily-calls-cell ${isWeekend ? 'weekend' : ''} ${count ? 'has-calls' : ''}`}>{count || ''}</div>
            })}
          </Fragment>
        })}
      </div>
    </div> : <p className="empty-table">No handler data yet.</p>}
  </section>
}

function OnlineEmployeesPanel({ people, onSelectPerson }) {
  const onlinePeople = useMemo(() => people.filter((person) => person.online), [people])
  const scrollRef = useRef(null)
  const directionRef = useRef(1)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return undefined
    const interval = setInterval(() => {
      const el = scrollRef.current
      if (!el) return
      const maxScroll = el.scrollHeight - el.clientHeight
      if (maxScroll <= 0) return
      let next = el.scrollTop + directionRef.current
      if (next >= maxScroll) { next = maxScroll; directionRef.current = -1 }
      else if (next <= 0) { next = 0; directionRef.current = 1 }
      el.scrollTop = next
    }, 40)
    return () => clearInterval(interval)
  }, [paused, onlinePeople.length])

  return <section className="panel online-mini-panel">
    <div className="online-mini-heading"><span>Online</span><b>{onlinePeople.length}</b></div>
    <div className="online-mini-list" ref={scrollRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {onlinePeople.length ? onlinePeople.map((person) => <button type="button" className="online-mini-row" key={person.id} onClick={() => onSelectPerson(person)}><div className="avatar-wrap">{person.profileImg ? <img className="avatar avatar-photo avatar-small" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} small />}<span className="presence is-online" /></div><span className="online-mini-name">{person.name}</span></button>) : <p className="empty-table">No one online right now.</p>}
    </div>
  </section>
}

export function ClientDashboard({ people, showOnlinePanel = false }) {
  const { sheets: callsSheets, selectedId: selectedSheetId, selectSheet, url: sheetUrl, tabGids, counts: callsResult, loading: callsLoading, refreshing: callsRefreshing, refresh: refreshCalls, error: callsError } = useCallsSheet()
  const { byDate: dailyByDate, year: dailyYear, month: dailyMonth } = useDailyCalls(selectedSheetId)
  const callCounts = callsResult?.counts || []
  const dailyCallCounts = callCounts.filter((item) => item.name.trim().toLowerCase() !== 'available to call')
  const maxCalls = Math.max(1, ...callCounts.map((item) => item.count))
  const perTab = useMemo(() => callsResult?.perTab || [], [callsResult])
  // Incomplete (still-available) tabs surface first so the tabs needing attention
  // aren't buried below ones that are already fully worked.
  const sortedPerTab = useMemo(() => [...perTab].sort((a, b) => Number(b.available > 0) - Number(a.available > 0)), [perTab])
  const totalAvailable = useMemo(() => perTab.reduce((sum, tab) => sum + tab.available, 0), [perTab])
  const totalHandled = useMemo(() => perTab.reduce((sum, tab) => sum + tab.total, 0), [perTab])
  const [selectedTabName, setSelectedTabName] = useState(null)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [openStatModal, setOpenStatModal] = useState(null)
  const [expandedHandlerName, setExpandedHandlerName] = useState(null)
  const selectedTab = perTab.find((tab) => tab.name === selectedTabName) || null
  const maxHandlerCalls = Math.max(1, ...(selectedTab?.counts || []).map((item) => item.count))

  function selectTab(name) {
    setSelectedTabName((current) => (current === name ? null : name))
    setExpandedHandlerName(null)
  }

  function toggleHandlerStatus(name) {
    setExpandedHandlerName((current) => (current === name ? null : name))
  }

  const tabListRef = useRef(null)
  const [tabListOverflows, setTabListOverflows] = useState(false)
  const [tabListScrolled, setTabListScrolled] = useState(false)

  useEffect(() => {
    const list = tabListRef.current
    if (!list) return undefined
    function updateOverflow() {
      setTabListOverflows(list.scrollHeight - list.scrollTop - list.clientHeight > 8)
      setTabListScrolled(list.scrollTop > 8)
    }
    updateOverflow()
    list.addEventListener('scroll', updateOverflow)
    window.addEventListener('resize', updateOverflow)
    return () => {
      list.removeEventListener('scroll', updateOverflow)
      window.removeEventListener('resize', updateOverflow)
    }
  }, [sortedPerTab])

  function scrollTabListDown() {
    tabListRef.current?.scrollBy({ top: tabListRef.current.clientHeight * 0.8, behavior: 'smooth' })
  }

  function scrollTabListUp() {
    tabListRef.current?.scrollBy({ top: -tabListRef.current.clientHeight * 0.8, behavior: 'smooth' })
  }

  function openTabInSheet(name) {
    if (!sheetUrl) return
    window.open(googleSheetTabUrl(sheetUrl, tabGids[name]), '_blank', 'noopener')
  }
  const { counts: attendanceCounts, loading: attendanceLoading } = useMonthlyAttendance(people)
  const topAttendanceId = useMemo(() => {
    const entries = Object.entries(attendanceCounts)
    if (!entries.length) return null
    return entries.reduce((best, entry) => (entry[1] > (best?.[1] ?? -1) ? entry : best), null)?.[0]
  }, [attendanceCounts])
  const topPerson = people.find((person) => person.id === topAttendanceId)
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' })

  const monthlyCallTotals = useMemo(() => {
    const totals = {}
    for (const dayCounts of Object.values(dailyByDate)) {
      for (const [name, count] of Object.entries(dayCounts)) totals[name] = (totals[name] || 0) + count
    }
    return totals
  }, [dailyByDate])
  const topAgentName = useMemo(() => {
    const entries = Object.entries(monthlyCallTotals)
    if (!entries.length) return null
    return entries.reduce((best, entry) => (entry[1] > (best?.[1] ?? -1) ? entry : best), null)?.[0]
  }, [monthlyCallTotals])
  const topAgentCalls = topAgentName ? monthlyCallTotals[topAgentName] : 0
  const topAgentMatch = topAgentName ? matchEmployeeByName(topAgentName, people) : null
  const monthlyTotalAllAgents = useMemo(() => Object.values(monthlyCallTotals).reduce((sum, count) => sum + count, 0), [monthlyCallTotals])

  return <div className="content client-dashboard">
    <div className={`dashboard-layout ${selectedTab ? 'tab-open' : ''}`}>
      <aside className={`panel tab-sidebar ${selectedTab ? 'drawer-open' : ''}`}>
        <div className="tab-sidebar-list-col">
          <div className="panel-heading panel-heading-stack">
            <div><h2>Calls per tab</h2><p>Click a tab to see its handlers</p></div>
            <div className="calls-progress-summary">
              <CallsProgressRing handled={totalHandled} available={totalAvailable} />
              <div className="calls-progress-legend">
                <span><i className="calls-progress-dot handled" />Handled <b>{totalHandled}</b></span>
                <span><i className="calls-progress-dot available" />Available <b>{totalAvailable}</b></span>
              </div>
            </div>
          </div>
          <div className="tab-sidebar-list-wrap">
            <div className="tab-sidebar-list" ref={tabListRef}>{!sheetUrl ? <p className="empty-table">Not connected.</p> : callsLoading ? <p className="team-status-message">Loading...</p> : callsError ? <p className="team-status-message team-status-error">Couldn't load.</p> : sortedPerTab.length ? sortedPerTab.map((tab) => <button type="button" key={tab.name} className={`tab-sidebar-row ${selectedTabName === tab.name ? 'active' : ''}`} onClick={() => selectTab(tab.name)}><span className="tab-sidebar-name" title={tab.name}>{tab.name}</span><div className="tab-sidebar-track">{tab.total > 0 && <div className="tab-sidebar-fill" style={{ width: `${(tab.total / Math.max(1, tab.total + tab.available)) * 100}%` }} />}</div><span className="tab-sidebar-value">{tab.total}/{tab.total + tab.available}</span></button>) : <p className="empty-table">No tabs scanned yet.</p>}</div>
            {tabListScrolled && <button type="button" className="tab-sidebar-scroll-hint scroll-up" aria-label="Scroll up" onClick={scrollTabListUp}><Icon name="chevron" size={16} /></button>}
            {tabListOverflows && <button type="button" className="tab-sidebar-scroll-hint scroll-down" aria-label="Scroll down for more tabs" onClick={scrollTabListDown}><Icon name="chevron" size={16} /></button>}
          </div>
        </div>
        <div className="tab-detail-drawer">{selectedTab && <>
          <div className="tab-detail-header"><div><strong>{selectedTab.name}</strong><small>{selectedTab.total} call{selectedTab.total === 1 ? '' : 's'} logged</small></div><div className="tab-detail-header-actions"><button type="button" className="admin-link" onClick={() => openTabInSheet(selectedTab.name)}>Open in Sheets ↗</button><button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedTabName(null)}><Icon name="x" size={18} /></button></div></div>
          <div className="calls-progress-summary">
            <CallsProgressRing handled={selectedTab.total} available={selectedTab.available} />
            <div className="calls-progress-legend">
              <span><i className="calls-progress-dot handled" />Handled <b>{selectedTab.total}</b></span>
              <span><i className="calls-progress-dot available" />Available <b>{selectedTab.available}</b></span>
            </div>
          </div>
          <div className="tab-detail-body">
            <p className="tab-detail-label">Handlers</p>
            {selectedTab.counts.length ? selectedTab.counts.map((item) => {
              const match = matchEmployeeByName(item.name, people)
              const statuses = selectedTab.statusByHandler[item.name] || []
              const isExpanded = expandedHandlerName === item.name
              return <div className="calls-row-wrap" key={item.name}>
                <button type="button" className="calls-row" onClick={() => toggleHandlerStatus(item.name)} aria-expanded={isExpanded}>
                  {match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || item.name)} color={match?.color || colorFor(item.name)} small />}
                  <span className="calls-name">{item.name}</span>
                  <div className="calls-track"><div className="calls-fill" style={{ width: `${(item.count / maxHandlerCalls) * 100}%` }} /></div>
                  <span className="calls-value">{item.count}</span>
                  <Icon name="chevron" size={14} />
                </button>
                {isExpanded && <div className="calls-status-breakdown">{statuses.length ? statuses.map((entry) => <div className="calls-status-row" key={entry.status}><span className="calls-status-name">{entry.status}</span><span className="calls-status-value">{entry.count}</span></div>) : <p className="empty-table">No "Status" column found on this tab.</p>}</div>}
              </div>
            }) : <p className="empty-table">No handlers logged on this tab yet.</p>}
          </div>
        </>}</div>
      </aside>

      <div className="dashboard-main">
        <div className="dashboard-hero-row">
          <section className="top-attendance-banner">
            {attendanceLoading ? <div className="top-stat"><p>Loading attendance...</p></div> : topPerson ? <button type="button" className="top-stat top-stat-clickable" onClick={() => setOpenStatModal('attendance')}><div className="avatar-wrap">{topPerson.profileImg ? <img className="avatar avatar-photo avatar-large" src={topPerson.profileImg} alt="" /> : <Avatar initials={topPerson.initials} color={topPerson.color} large />}<span className="top-stat-badge"><Icon name="trophy" size={14} /></span></div><div className="top-stat-info"><small className="top-stat-label">Top attendance</small><small className="top-stat-month">{monthLabel}</small><strong>{topPerson.name}</strong><div className="top-stat-metric"><Icon name="calendar" size={15} /><b>{attendanceCounts[topAttendanceId]}</b><span>day{attendanceCounts[topAttendanceId] === 1 ? '' : 's'} present</span></div></div></button> : <div className="top-stat"><p>Not enough attendance data yet.</p></div>}
            <div className="top-stat-divider" />
            {!sheetUrl ? <div className="top-stat"><p>No calls sheet connected yet.</p></div> : !topAgentName ? <div className="top-stat"><p>Not enough call data yet.</p></div> : <button type="button" className="top-stat top-stat-clickable" onClick={() => setOpenStatModal('agent')}><div className="avatar-wrap">{topAgentMatch?.profileImg ? <img className="avatar avatar-photo avatar-large" src={topAgentMatch.profileImg} alt="" /> : <Avatar initials={initialsOf(topAgentMatch?.name || topAgentName)} color={topAgentMatch?.color || colorFor(topAgentName)} large />}</div><div className="top-stat-info"><small className="top-stat-label">Top agent</small><small className="top-stat-month">{monthLabel}</small><strong>{topAgentMatch?.name || topAgentName}</strong><div className="top-stat-metric"><Icon name="phone" size={15} /><b>{topAgentCalls}</b><span>call{topAgentCalls === 1 ? '' : 's'}</span></div></div></button>}
          </section>
          {showOnlinePanel && <OnlineEmployeesPanel people={people} onSelectPerson={setSelectedPerson} />}
        </div>

        {selectedPerson && <EmployeeStatsModal person={selectedPerson} people={people} monthlyCallTotals={monthlyCallTotals} monthTotal={monthlyTotalAllAgents} monthLabel={monthLabel} perTab={perTab} onClose={() => setSelectedPerson(null)} />}

        {openStatModal === 'attendance' && topPerson && <TopAttendanceModal person={topPerson} onClose={() => setOpenStatModal(null)} />}
        {openStatModal === 'agent' && topAgentName && <TopAgentModal agentName={topAgentName} displayName={topAgentMatch?.name || topAgentName} avatar={topAgentMatch?.profileImg ? <img className="avatar avatar-photo avatar-large" src={topAgentMatch.profileImg} alt="" /> : <Avatar initials={initialsOf(topAgentMatch?.name || topAgentName)} color={topAgentMatch?.color || colorFor(topAgentName)} large />} perTab={perTab} agentCalls={topAgentCalls} monthTotal={monthlyTotalAllAgents} monthLabel={monthLabel} onClose={() => setOpenStatModal(null)} />}

        <section className="panel calls-hero">
          <div className="panel-heading">
            <div><h2>Calls per employee</h2><p>{callsResult ? `Counted from the Handler column across ${callsResult.scanned.length} tab${callsResult.scanned.length === 1 ? '' : 's'}.` : 'Counted from the Handler column of the connected sheet.'}</p></div>
            <div className="panel-heading-actions">
              {callsSheets.length > 1 && <select className="calls-sheet-switcher" value={selectedSheetId || ''} onChange={(event) => selectSheet(event.target.value)} aria-label="Switch calls sheet">{callsSheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.title || sheet.url}</option>)}</select>}
              <button type="button" className={`icon-button refresh-button ${callsRefreshing ? 'is-spinning' : ''}`} aria-label="Refresh calls data from the sheet" title="Refresh from sheet" disabled={!sheetUrl || callsRefreshing} onClick={refreshCalls}><Icon name="refresh" size={16} /></button>
            </div>
          </div>
          <div className="calls-chart-bars">{!sheetUrl ? <p className="empty-table">No calls sheet connected yet. An admin can connect one from the Admin panel.</p> : callsLoading ? <p className="team-status-message">Loading calls data...</p> : callsError ? <p className="team-status-message team-status-error">{callsError}</p> : callCounts.length ? callCounts.map((item) => {
            const match = matchEmployeeByName(item.name, people)
            const barHeightPercent = (item.count / maxCalls) * 100
            return <div className="calls-bar-col" key={item.name}>
              <div className="calls-bar-track">
                <span className="calls-bar-value" style={{ bottom: `calc(${barHeightPercent}% + 5px)` }}>{item.count}</span>
                <div className="calls-bar-fill" style={{ height: `${barHeightPercent}%` }} />
              </div>
              {match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || item.name)} color={match?.color || colorFor(item.name)} small />}
              <span className="calls-bar-name">{match?.name || item.name}</span>
            </div>
          }) : <p className="empty-table">No handler data found in that sheet.</p>}</div>
        </section>

        <DailyCallsCalendar people={people} callCounts={dailyCallCounts} dailyByDate={dailyByDate} year={dailyYear} month={dailyMonth} />
      </div>
    </div>
  </div>
}

export function AttendanceLogPage({ people }) {
  const [selectedId, setSelectedId] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selected = people.find((person) => person.id === selectedId)

  function selectPerson(id) {
    setSelectedId(id)
    setLoading(true)
    setError('')
    setLogs([])
  }

  useEffect(() => {
    if (!selectedId) return undefined
    let cancelled = false
    const { startDate, endDate } = monthRange()
    hyacinthAttendanceAPI.getAttendanceLogs({ userId: selectedId, startDate, endDate })
      .then((result) => { if (!cancelled) setLogs([...(result || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  return <div className={`content attendance-layout ${selected ? 'drawer-open' : ''}`}>
    <div className="page-heading"><div><p className="eyebrow">Employees</p><h1>Attendance log</h1><p className="heading-copy">Select an employee to view their attendance history for this month.</p></div></div>
    <AttendanceBreakdown people={people} />
    <div className="attendance-split">
      <section className="panel attendance-list">{people.length ? people.map((person) => <button type="button" key={person.id} className={`attendance-row ${selectedId === person.id ? 'active' : ''}`} onClick={() => selectPerson(person.id)}>{person.profileImg ? <img className="avatar avatar-photo avatar-small" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} small />}<div><strong>{person.name}</strong><small>{person.role}</small></div><span className={person.online ? 'member-status online-text' : 'member-status'}>{person.online ? 'Online' : 'Away'}</span></button>) : <p className="empty-table">No employees synced yet.</p>}</section>
      <aside className="attendance-drawer">{selected && <><div className="attendance-drawer-header"><div><strong>{selected.name}</strong><small>{selected.role}</small></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedId(null)}><Icon name="x" size={18} /></button></div><div className="attendance-drawer-body">{loading ? <p className="team-status-message">Loading attendance...</p> : error ? <p className="team-status-message team-status-error">{error}</p> : logs.length ? logs.map((log, index) => <div className="attendance-log-row" key={index}><div className="attendance-log-row-main"><div className="attendance-log-badges"><span className={`attendance-type ${log.type === 'In' ? 'in' : 'out'}`}>{log.type}</span>{log.status && <span className="attendance-status" style={ATTENDANCE_STATUS_COLORS[log.status] ? { color: ATTENDANCE_STATUS_COLORS[log.status], background: `${ATTENDANCE_STATUS_COLORS[log.status]}1a` } : undefined}>{log.status}</span>}</div><span>{new Date(log.timestamp).toLocaleString()}</span></div>{attendanceNoteOf(log) && <p className="attendance-log-note">{attendanceNoteOf(log)}</p>}</div>) : <p className="empty-table">No attendance logs this month.</p>}</div></>}</aside>
    </div>
  </div>
}

function InviteAcceptance() {
  const [needsEmail, setNeedsEmail] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [error, setError] = useState('')

  async function complete(email) {
    try {
      const result = await signInWithEmailLink(auth, email, window.location.href)
      const invite = await getInvite(email)
      if (!invite || invite.status === 'accepted') {
        await signOut(auth)
        setError('This invite link is invalid or has already been used. Ask an admin to send a new one.')
        return
      }
      await createPortalUser({ uid: result.user.uid, name: email.split('@')[0], email, role: invite.role, createdBy: invite.invitedBy })
      await acceptInvite(email, result.user.uid)
      window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY)
      window.history.replaceState(null, '', '/client')
      // Reload rather than flip local state — useAuthGate's own effects react to
      // the auth-state change immediately and would otherwise race the profile
      // doc being created above, permanently caching a stale/missing profile.
      window.location.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      const storedEmail = window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY)
      if (storedEmail) complete(storedEmail)
      else setNeedsEmail(true)
    })
  }, [])

  function submitEmail(event) {
    event.preventDefault()
    setNeedsEmail(false)
    complete(emailInput.trim().toLowerCase())
  }

  if (error) return <main className="auth-page"><section className="auth-card"><p className="admin-kicker">Salespace</p><h1>Invite link problem</h1><p>{error}</p></section></main>
  if (needsEmail) return <main className="auth-page"><form className="auth-card" onSubmit={submitEmail}><p className="admin-kicker">Salespace</p><h1>Confirm your email</h1><p>Enter the email address this invite was sent to, to finish signing in.</p><label>Email<input type="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} required /></label><button className="admin-primary" type="submit">Continue</button></form></main>

  return <main className="admin-page"><p>Completing your invite...</p></main>
}

export default function ClientView() {
  const invitePending = isSignInWithEmailLink(auth, window.location.href)
  const { user, authChecked, mustChangePassword, setMustChangePassword, profile } = useAuthGate()
  const { people } = useTeamPresence(
    import.meta.env.VITE_HYACINTH_DEPARTMENT_ID,
  )
  const [activePage, setActivePage] = useState('Dashboard')
  const [darkMode, setDarkMode] = useState(false)
  const [savingDarkMode, setSavingDarkMode] = useState(false)

  useEffect(() => {
    if (!user || mustChangePassword !== false) return undefined
    return subscribeToPreferences(user.uid, (prefs) => setDarkMode(Boolean(prefs.darkMode)))
  }, [user, mustChangePassword])

  async function toggleDarkMode() {
    const next = !darkMode
    setDarkMode(next)
    setSavingDarkMode(true)
    try {
      await updatePreferences(user.uid, { darkMode: next })
    } finally {
      setSavingDarkMode(false)
    }
  }

  if (invitePending) return <InviteAcceptance />
  if (!authChecked) return null
  if (!user) {
    window.location.assign('/visitor')
    return null
  }
  if (mustChangePassword === null) return <PageLoading text="Loading your account..." />
  if (mustChangePassword) return <ChangePasswordForm onDone={() => setMustChangePassword(false)} />
  if (profile === undefined) return <PageLoading text="Loading your account..." />

  const canSwitchPanels = profile?.role === 'admin' || profile?.role === 'super_admin'
  const panelLinks = canSwitchPanels ? [
    { label: 'Admin panel', href: '/admin', active: false },
    { label: 'Client panel', href: '/client', active: true },
    { label: 'Employee panel', href: '/', active: false },
  ] : []

  return <div className={`client-shell ${darkMode ? 'dark-mode' : ''} ${panelLinks.length > 0 ? 'has-panel-switch' : ''}`}>
    {savingDarkMode && <LoadingOverlay />}
    <PanelSwitchBar links={panelLinks} darkMode={darkMode} />
    <ClientHeader activePage={activePage} onNavigate={setActivePage} onOpenSettings={() => setActivePage('Settings')} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
    {activePage === 'Dashboard' ? <ClientDashboard people={people} showOnlinePanel />
      : activePage === 'Attendance Log' ? <AttendanceLogPage people={people} />
      : <SettingsPage user={user} profile={profile} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onSignOut={() => signOut(auth).then(() => window.location.assign('/login'))} />}
  </div>
}
