import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isSignInWithEmailLink, signInWithEmailLink, signOut } from 'firebase/auth'
import './client.css'
import './admin.css'
import { auth } from './firebase'
import { useAuthGate } from './hooks/useAuthGate'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { useHashRoute } from './hooks/useHashRoute'
import { useTeamPresence } from './hooks/useTeamPresence'
import { ATTENDANCE_STATUSES, useAttendanceBreakdown } from './hooks/useAttendanceBreakdown'
import { hyacinthAttendanceAPI } from './api/hyacinthAttendance'
import { fetchClosedAppointments, fetchHandlerCounts, googleSheetTabUrl, setCallsSheetSelection, subscribeToCallsSheets, subscribeToCallsSheetSelection } from './services/callsSheet'
import { createPortalUser } from './services/users'
import { acceptInvite, getInvite } from './services/invites'
import { subscribeToPreferences, updatePreferences } from './services/preferences'
import { subscribeToCallQuota } from './services/quota'
import { Avatar, Icon } from './PortalShell'
import { initialsOf } from './utils/initials'
import { matchEmployeeByName } from './utils/matchEmployee'
import AnnouncementAlert from './AnnouncementAlert'
import QuotaAlert from './QuotaAlert'
import MentionAlert from './MentionAlert'
import AppointmentCelebration from './AppointmentCelebration'
import { exportCallsReport, exportCallsReportPdf } from './utils/exportCallsReport'
import { workDateKey, workMonth } from './shared/workCalendar'
import ChangePasswordForm from './ChangePasswordForm'
import CustomSelect from './CustomSelect'
import CallsTrendPanel from './CallsTrendPanel'
import { useCallerFilter } from './hooks/useCallerFilter'
import LoadingOverlay from './LoadingOverlay'
import PageLoading from './PageLoading'
import PanelSwitchBar from './PanelSwitchBar'
import SettingsPage from './SettingsPage'
import salesLogo from './assets/sales-logo-chrome.webp'

const EMAIL_FOR_SIGN_IN_KEY = 'emailForSignIn'

// How often the calls sheet is re-read while the dashboard is open. Calls are only
// recorded against a day when totals are fetched, so a longer gap means a longer window
// in which new calls are not yet attributed to anything.
const CALLS_AUTO_REFRESH_MS = 5 * 60 * 1000
const CALLS_TAB_RETURN_REFRESH_MS = 60 * 1000

const NAV_ITEMS = [['Dashboard', 'grid'], ['Attendance Log', 'clock']]
// The pages the client panel can show: the nav items, plus Settings (opened from the header).
const CLIENT_PAGES = [...NAV_ITEMS.map(([label]) => label), 'Settings']
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

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`
}

// What explains an attendance log, shown under its row: how late a late time-in was, the
// employee's own note (e.g. "Timed in since 8:10"), and any edit an admin made to the entry
// with their reason. Late entries get an amber edge so the reason is easy to find.
function AttendanceLogDetails({ log }) {
  const note = attendanceNoteOf(log)
  const lateBy = log.type === 'In' && log.status === 'Late' && log.timeDiff > 0 ? log.timeDiff : null
  const override = log.isOverridden && log.overrideInfo ? log.overrideInfo : null
  const overrideReason = (override?.reason || '').trim()
  if (!note && !lateBy && !override) return null
  return <div className={`attendance-log-details ${log.status === 'Late' ? 'is-late' : ''}`}>
    {lateBy && <p className="attendance-log-late">Late by {formatMinutes(lateBy)}</p>}
    {note && <p><span>Note</span>{note}</p>}
    {override && <p className="attendance-log-override"><span>Edited</span>{override.overriddenBy ? `by ${override.overriddenBy}` : 'by an admin'}{overrideReason && ` — ${overrideReason}`}</p>}
  </div>
}

function colorFor(seed) {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// The sheet handler name (e.g. "Jane") that belongs to this employee, if any.
function agentNameFor(person, people, monthlyCallTotals) {
  return Object.keys(monthlyCallTotals).find((name) => matchEmployeeByName(name, people)?.id === person.id) || null
}

// The month filter's "All": both months it offers (last month and this one) together.
const ALL_MONTHS = 'all'
const ALL_MONTHS_LABEL = 'All months'

// "in October" / "in all months" — the label reads as a sentence fragment only when the
// "All months" label is lowercased.
function periodPhrase(label) {
  return label === ALL_MONTHS_LABEL ? 'all months' : label
}

function monthRange(monthOffset = 0) {
  const now = new Date()
  if (monthOffset === ALL_MONTHS) {
    return { startDate: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), endDate: now.toISOString().slice(0, 10) }
  }
  if (monthOffset === 0) {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const endDate = now.toISOString().slice(0, 10)
    return { startDate, endDate }
  }
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  return { startDate: dateKey(first), endDate: dateKey(last) }
}

// One status per day (the day's first "In" log, as in the attendance breakdown), tallied
// per status. `present` is the days actually worked: Absent, NCNS and PTO days carry an
// "In" log too but aren't days present.
function monthlyAttendanceStats(logs) {
  const statusByDay = new Map()
  const inLogs = (logs || []).filter((log) => log.type === 'In' && ATTENDANCE_STATUSES.includes(log.status))
  inLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  for (const log of inLogs) {
    const day = log.timestamp.slice(0, 10)
    if (!statusByDay.has(day)) statusByDay.set(day, log.status)
  }
  const stats = Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, 0]))
  for (const status of statusByDay.values()) stats[status] += 1
  stats.present = stats.Early + stats['On Time'] + stats.Late
  return stats
}

// Top attendance: anyone with a late day is out, and someone who never came in has
// nothing to rank. Of the rest, fewer absences (Absent + NCNS) wins first, then more
// early arrivals (early beats on time), then more days present.
function topAttendanceIdOf(statsById) {
  const ranked = Object.entries(statsById)
    .filter(([, stats]) => stats.present > 0 && stats.Late === 0)
    .sort(([, a], [, b]) => (a.Absent + a.NCNS) - (b.Absent + b.NCNS) || b.Early - a.Early || b.present - a.present)
  return ranked[0]?.[0] ?? null
}

function useMonthlyAttendance(people, monthOffset = 0) {
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // A manual refresh re-fetches without flipping `loading`, so the numbers on screen
  // stay up (with the button spinning) instead of dropping back to "Loading...".
  const reloadRequested = useRef(false)

  const refresh = useCallback(() => {
    reloadRequested.current = true
    setReloadKey((key) => key + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const isReload = reloadRequested.current
    reloadRequested.current = false
    queueMicrotask(() => {
      if (cancelled) return
      if (isReload) setRefreshing(true)
      else setLoading(true)
    })
    const { startDate, endDate } = monthRange(monthOffset)
    Promise.all(people.map(async (person) => {
      try {
        const logs = await hyacinthAttendanceAPI.getAttendanceLogs({ userId: person.id, startDate, endDate })
        return [person.id, monthlyAttendanceStats(logs)]
      } catch {
        return [person.id, monthlyAttendanceStats([])]
      }
    })).then((entries) => {
      if (!cancelled) {
        setCounts(Object.fromEntries(entries))
        setLoading(false)
        setRefreshing(false)
      }
    })
    return () => { cancelled = true }
  }, [people, monthOffset, reloadKey])

  return { counts, loading, refreshing, refresh }
}

// The current Eastern-time work date, re-evaluated every 30s so the calendar rolls over
// to the new day on its own instead of staying on the old one until a reload.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkDate() {
  const [dateKey, setDateKey] = useState(() => workDateKey())
  useEffect(() => {
    const interval = setInterval(() => setDateKey(workDateKey()), 30 * 1000)
    return () => clearInterval(interval)
  }, [])
  return dateKey
}

// `enabled: false` holds off reading the sheet (about a request per tab) until it's needed —
// the employee workspace only wants it once someone hovers or opens a team member.
// eslint-disable-next-line react-refresh/only-export-components
export function useCallsSheet({ enabled = true } = {}) {
  const [sheets, setSheets] = useState([])
  const [sheetsLoaded, setSheetsLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [counts, setCounts] = useState(null)
  const [closedAppointments, setClosedAppointments] = useState([])
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const syncRef = useRef({ lastAt: 0, busy: false })

  useEffect(() => subscribeToCallsSheets((next) => { setSheets(next); setSheetsLoaded(true) }, (err) => { setError(err.message); setSheetsLoaded(true) }), [])
  useEffect(() => subscribeToCallsSheetSelection(setSelectedId, (err) => setError(err.message)), [])

  const selectedSheet = useMemo(() => {
    if (!sheets.length) return null
    return sheets.find((sheet) => sheet.id === selectedId) || sheets[0]
  }, [sheets, selectedId])

  // Shared by the auto-load effect below and the manual refresh button, so a
  // refresh re-runs the exact same fetch path instead of drifting out of sync
  // with it. The Daily calls panel is read from the same result (each row's DATE
  // cell), so one fetch updates every panel at once.
  const loadCounts = useCallback((sheet, isCancelled) => {
    if (!sheet?.url) return Promise.resolve()
    syncRef.current.lastAt = Date.now()
    // Best-effort and independent of the counts: a closed-appointments tab that can't be
    // read shouldn't blank the calls panels.
    const closedTabs = sheet.closedAppointmentTabs || []
    const closedRequest = closedTabs.length
      ? fetchClosedAppointments(sheet.url, closedTabs).catch((err) => { console.warn('[callsSheet] closed appointments failed:', err.message); return null })
      : Promise.resolve([])
    closedRequest.then((rows) => { if (rows && !isCancelled()) setClosedAppointments(rows) })
    return fetchHandlerCounts(sheet.url, sheet.sheetNames, { handlerHeader: sheet.handlerHeader, validHandlers: sheet.validHandlers, availableLabels: sheet.availableLabels, excludeTabs: closedTabs })
      .then((result) => {
        if (isCancelled()) return undefined
        setCounts(result)
        setError('')
      })
      .catch((err) => { if (!isCancelled()) setError(err.message) })
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setCounts(null) })
    loadCounts(selectedSheet, () => cancelled)
    return () => { cancelled = true }
  }, [enabled, selectedSheet?.url, selectedSheet?.sheetNames, selectedSheet?.id, selectedSheet?.handlerHeader, selectedSheet?.validHandlers, selectedSheet?.availableLabels, selectedSheet?.closedAppointmentTabs, loadCounts])

  // Keeps the display current without anyone pressing refresh: a periodic re-read,
  // and one when the tab is brought back to the foreground.
  useEffect(() => {
    if (!enabled || !selectedSheet?.url) return undefined
    const state = syncRef.current
    async function sync() {
      if (state.busy) return
      state.busy = true
      try {
        await loadCounts(selectedSheet, () => false)
      } finally {
        state.busy = false
      }
    }
    function tick() {
      if (Date.now() - state.lastAt >= CALLS_AUTO_REFRESH_MS) sync()
    }
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - state.lastAt >= CALLS_TAB_RETURN_REFRESH_MS) sync()
    }
    const interval = setInterval(tick, 30 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, selectedSheet, loadCounts])

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

  const loading = enabled && Boolean(selectedSheet?.url) && counts === null && !error
  return { sheets, sheetsLoaded, selectedId: selectedSheet?.id || null, selectSheet, url: selectedSheet?.url, tabGids: selectedSheet?.tabGids || {}, counts, closedAppointments, hasClosedTabs: Boolean(selectedSheet?.closedAppointmentTabs?.length), loading, refreshing, refresh, error }
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// Calls per day come straight from the DATE column of the connected sheet (see
// fetchHandlerCounts), so there's nothing to record or store — a handled row with no
// date still counts toward the totals but has no day, so it isn't shown here.
function useDailyCalls(callsResult, monthOffset = 0) {
  const { year, month } = workMonth(monthOffset, useWorkDate())
  const monthStart = dateKey(new Date(year, month, 1))
  const monthEnd = dateKey(new Date(year, month + 1, 0))
  // The calendar also shows the month after the selected one, so the
  // subscription covers it too; per-month totals filter back down to
  // monthStart..monthEnd where they're computed.
  const rangeEnd = dateKey(new Date(year, month + 2, 0))

  const daily = callsResult?.daily
  const byDate = useMemo(() => {
    const inRange = {}
    for (const [date, counts] of Object.entries(daily || {})) {
      if (date >= monthStart && date <= rangeEnd) inRange[date] = counts
    }
    return inRange
  }, [daily, monthStart, rangeEnd])

  return { byDate, year, month, monthStart, monthEnd }
}

function ExcelFileIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#e7f4ec" stroke="#1d6f42" strokeWidth="1.2" />
    <path d="M14 2v5h5" fill="#bfe0cc" stroke="#1d6f42" strokeWidth="1.2" strokeLinejoin="round" />
    <rect x="2" y="10.5" width="12" height="9" rx="1.6" fill="#1d6f42" />
    <path d="M5.6 12.6l4.8 4.8m0-4.8l-4.8 4.8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
}

function PdfFileIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fdecea" stroke="#d93025" strokeWidth="1.2" />
    <path d="M14 2v5h5" fill="#f6c5c0" stroke="#d93025" strokeWidth="1.2" strokeLinejoin="round" />
    <rect x="2" y="11" width="15" height="8" rx="1.6" fill="#d93025" />
    <text x="9.5" y="17" textAnchor="middle" fontSize="5.6" fontWeight="800" fontFamily="Arial, Helvetica, sans-serif" fill="#fff">PDF</text>
  </svg>
}

const EXPORT_FORMATS = {
  pdf: { name: 'PDF', file: 'PDF document (.pdf)', Icon: PdfFileIcon },
  excel: { name: 'Excel', file: 'Excel workbook (.xlsx)', Icon: ExcelFileIcon },
}

function ExportConfirmModal({ format, monthLabel, employeeCount, busy, onConfirm, onCancel }) {
  const { name, file, Icon: FileIcon } = EXPORT_FORMATS[format]

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return <div className="modal-overlay" role="presentation" onClick={busy ? undefined : onCancel}>
    <div className="modal-card export-modal-card" role="dialog" aria-modal="true" aria-labelledby="export-modal-title" onClick={(event) => event.stopPropagation()}>
      <div className={`export-modal-icon ${format}`}><FileIcon size={34} /></div>
      <h3 id="export-modal-title">Export {name} report?</h3>
      <p>The calls report for {monthLabel} will be created and downloaded to your device.</p>
      <div className="export-modal-details">
        <div><span>Format</span><b>{file}</b></div>
        <div><span>Month</span><b>{monthLabel}</b></div>
        <div><span>Employees</span><b>{employeeCount}</b></div>
        <div><span>Includes</span><b>Calls per employee, daily and weekly calls</b></div>
      </div>
      <div className="export-modal-actions">
        <button type="button" className="admin-link" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className={`admin-primary export-modal-confirm ${format}`} disabled={busy} onClick={onConfirm}>{busy ? <><span className="export-modal-spinner" />Preparing...</> : `Export ${name}`}</button>
      </div>
    </div>
  </div>
}

function ClientHeader({ activePage, onNavigate, onOpenSettings, darkMode = false, onToggleDarkMode }) {
  return <header className="client-header">
    <img className="client-logo" src={salesLogo} alt="Salespace" />
    <nav className="client-nav">
      {NAV_ITEMS.map(([label, icon]) => <button type="button" key={label} className={`client-nav-item ${activePage === label ? 'active' : ''}`} onClick={() => onNavigate(label)}><Icon name={icon} size={15} /><span>{label}</span></button>)}
    </nav>
    <button type="button" className="icon-button theme-toggle" aria-label="Toggle dark mode" onClick={onToggleDarkMode}><Icon name={darkMode ? 'sun' : 'moon'} /></button>
    <button type="button" className={`icon-button ${activePage === 'Settings' ? 'active' : ''}`} aria-label="Settings" onClick={onOpenSettings}><Icon name="settings" /></button>
  </header>
}

const RING_DRAW_SECONDS = 0.9
const RING_DRAW_DELAY_SECONDS = 0.1

// Props for one arc of a donut, shared by every ring so they all fit and animate alike.
//  - Fit: a round end sticks out half the stroke width past where its dash stops, so the dash
//    is shortened by a full stroke width (one cap per end) plus `gap`, and started half a cap
//    in. The visible rounded shape then fills exactly its own share of the ring and never
//    covers the neighbouring arc. An arc that is the whole ring is a plain closed circle.
//  - Animation (.ring-segment): the arc draws itself along its own curve. It starts when the
//    arcs before it finish and takes time in proportion to its length, so the ring fills
//    clockwise without a wipe cutting across the arcs.
// `offset` and `length` are along the circumference, from 12 o'clock clockwise.
// eslint-disable-next-line react-refresh/only-export-components
export function ringArc({ circumference, strokeWidth, offset, length, gap = 3, whole = false }) {
  const dash = whole ? circumference : Math.max(0.01, length - strokeWidth - gap)
  const start = whole ? 0 : offset + strokeWidth / 2 + gap / 2
  return {
    className: 'ring-segment',
    strokeLinecap: whole ? 'butt' : 'round',
    strokeDasharray: `${dash} ${circumference}`,
    strokeDashoffset: -start,
    style: {
      '--circ': `${circumference}px`,
      '--dash': `${dash}px`,
      animationDuration: `${(length / circumference) * RING_DRAW_SECONDS}s`,
      animationDelay: `${RING_DRAW_DELAY_SECONDS + (offset / circumference) * RING_DRAW_SECONDS}s`,
    },
  }
}

function AttendanceBreakdownRing({ counts, total, size = 132 }) {
  const strokeWidth = Math.round(size * 0.12)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="breakdown-ring">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
    {total > 0 && ATTENDANCE_STATUSES.map((status) => {
      const count = counts[status].length
      if (!count) return null
      const length = (count / total) * circumference
      const segment = <circle key={status} {...ringArc({ circumference, strokeWidth, offset, length, whole: count === total })} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={ATTENDANCE_STATUS_COLORS[status]} strokeWidth={strokeWidth} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
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
  const length = (clamped / 100) * circumference

  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="percent-ring">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
    {clamped > 0 && <circle {...ringArc({ circumference, strokeWidth, offset: 0, length, gap: 0, whole: clamped >= 100 })} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue)" strokeWidth={strokeWidth} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
  </svg>
}

function CallsProgressRing({ handled, available }) {
  const size = 56
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = handled + available

  // Positioned by each slice's real share of the ring (ringArc then trims the ends to
  // fit). A tiny-but-nonzero slice still shows as a small rounded sliver rather than
  // vanishing.
  let offset = 0
  const segments = [
    { value: handled, color: 'var(--blue)' },
    { value: available, color: '#d97706' },
  ].map((segment) => {
    if (segment.value <= 0) return null
    const length = (segment.value / total) * circumference
    const arc = { ...segment, offset, length, whole: segment.value === total }
    offset += length
    return arc
  })

  // Painted in reverse (available first, handled last) so the handled slice
  // always sits on top of any overlap at the junction.
  const handledPercent = total > 0 ? `${((handled / total) * 100).toFixed(1)}%` : '0%'

  return <div className="calls-progress-ring-wrap">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="calls-progress-ring">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--blue-soft)" strokeWidth={strokeWidth} />
      {[...segments].reverse().map((segment, index) => segment && <circle key={index} {...ringArc({ circumference, strokeWidth, offset: segment.offset, length: segment.length, whole: segment.whole })} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={strokeWidth} transform={`rotate(-90 ${size / 2} ${size / 2})`} />)}
    </svg>
    <div className="calls-progress-ring-label">{handledPercent}</div>
  </div>
}

function AgentCallsSection({ agentName, displayName, perTab, agentCalls, monthTotal, monthLabel }) {
  const rows = useMemo(() => [...perTab]
    .map((tab) => ({ name: tab.name, count: agentName ? tab.counts.find((item) => item.name === agentName)?.count || 0 : 0 }))
    .filter((row) => row.count > 0)
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
      <div className="stat-modal-percent-info"><p>{displayName} handled <b>{agentCalls}</b> of <b>{monthTotal}</b> calls logged by the whole team in {periodPhrase(monthLabel)}.</p></div>
    </div>
    <div className="stat-modal-total"><span>Total calls (all tabs)</span><strong>{total}</strong></div>
    <div className="stat-modal-list">
      {rows.length ? rows.map((row) => <div className="stat-tab-row" key={row.name}><span className="stat-tab-name">{row.name}</span><div className="stat-tab-track"><div className="stat-tab-fill" style={{ width: `${(row.count / maxCount) * 100}%` }} /></div><span className="stat-tab-value">{row.count}</span></div>) : <p className="empty-table">{displayName} has no calls on any tab yet.</p>}
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
      <div className="attendance-modal-header">
        {person.profileImg ? <img className="avatar avatar-photo avatar-large" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} large />}
        <div className="attendance-modal-identity">
          <strong>{person.name}</strong>
          {person.email && <span className="attendance-modal-email">{person.email}</span>}
          {person.role && <div className="attendance-modal-pills"><span className="attendance-modal-pill">{person.role}</span></div>}
        </div>
        <button type="button" className="icon-button attendance-modal-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <AttendanceSection person={person} />
    </div>
  </div>
}

function EmployeeStatsModal({ person, people, monthlyCallTotals, todayCallTotals, monthTotal, monthLabel, perTab, onClose }) {
  const agentName = useMemo(
    () => Object.keys(monthlyCallTotals).find((name) => matchEmployeeByName(name, people)?.id === person.id) || null,
    [monthlyCallTotals, people, person.id],
  )
  const agentCalls = agentName ? monthlyCallTotals[agentName] : 0
  const [dailyQuota, setDailyQuota] = useState(null)
  useEffect(() => subscribeToCallQuota(setDailyQuota, (err) => console.warn('[quota] unavailable:', err.message)), [])
  const todayCalls = useMemo(
    () => Object.entries(todayCallTotals || {}).reduce((sum, [name, count]) => (matchEmployeeByName(name, people)?.id === person.id ? sum + count : sum), 0),
    [todayCallTotals, people, person.id],
  )
  const quotaReached = dailyQuota > 0 && todayCalls >= dailyQuota

  return <div className="modal-overlay" role="presentation" onClick={onClose}>
    <div className="modal-card stat-modal-card attendance-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="attendance-modal-header">
        <div className="attendance-modal-person">
          {person.profileImg ? <img className="avatar avatar-photo avatar-large" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} large />}
          <div className="attendance-modal-identity">
            <strong>{person.name}</strong>
            {person.email && <span className="attendance-modal-email">{person.email}</span>}
            {person.role && <div className="attendance-modal-pills"><span className="attendance-modal-pill">{person.role}</span></div>}
          </div>
        </div>
        <button type="button" className="icon-button attendance-modal-close" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        {dailyQuota > 0 && <div className={`quota-progress ${quotaReached ? 'is-reached' : ''}`}>
          <div className="quota-progress-head"><span>Calls today</span><strong>{todayCalls}<small> / {dailyQuota}</small></strong></div>
          <div className="quota-progress-track" role="progressbar" aria-label="Calls today against the daily quota" aria-valuemin={0} aria-valuemax={dailyQuota} aria-valuenow={Math.min(todayCalls, dailyQuota)}><div className="quota-progress-fill" style={{ width: `${Math.min(100, (todayCalls / dailyQuota) * 100)}%` }} /></div>
          <small className="quota-progress-note">{quotaReached ? (todayCalls > dailyQuota ? `Quota reached — ${todayCalls - dailyQuota} over` : 'Quota reached') : `${dailyQuota - todayCalls} more to reach the quota`}</small>
        </div>}
      </div>
      <p className="stat-modal-section-label">Attendance (last 7 days)</p>
      <AttendanceSection person={person} />
      <p className="stat-modal-section-label">Calls in {periodPhrase(monthLabel)}</p>
      <AgentCallsSection agentName={agentName} displayName={person.name} perTab={perTab} agentCalls={agentCalls} monthTotal={monthTotal} monthLabel={monthLabel} />
    </div>
  </div>
}

const DAILY_CALLS_NAME_COL_WIDTH = 220

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function DailyCallsCalendar({ people, callCounts, dailyByDate, year, month }) {
  const daysThisMonth = daysInMonth(year, month)
  const nextMonthDate = new Date(year, month + 1, 1)
  const daysNextMonth = daysInMonth(nextMonthDate.getFullYear(), nextMonthDate.getMonth())
  const totalColumns = daysThisMonth + daysNextMonth
  const dates = useMemo(() => Array.from({ length: totalColumns }, (_, index) => new Date(year, month, index + 1)), [year, month, totalColumns])
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const todayKey = useWorkDate()
  const scrollRef = useRef(null)
  const [view, setView] = useState('daily')

  // Keep today's column centered in the scrollable area (rather than off at
  // whichever edge the grid happens to start/end on) so it doesn't need to be
  // hunted for in a two-month-wide table.
  const centerToday = useCallback(() => {
    const container = scrollRef.current
    const todayCell = container?.querySelector('[data-today="true"]')
    if (!container || !todayCell) return
    const containerRect = container.getBoundingClientRect()
    const cellRect = todayCell.getBoundingClientRect()
    const cellCenter = (cellRect.left - containerRect.left) + container.scrollLeft + cellRect.width / 2
    const target = cellCenter - container.clientWidth / 2
    container.scrollLeft = Math.max(0, Math.min(target, container.scrollWidth - container.clientWidth))
  }, [])

  useEffect(() => {
    centerToday()
    const container = scrollRef.current
    if (!container) return undefined
    const observer = new ResizeObserver(centerToday)
    observer.observe(container)
    return () => observer.disconnect()
  }, [centerToday, todayKey, callCounts.length, totalColumns, view])

  return <section className="panel daily-calls">
    <div className="panel-heading">
      <div><h2>{view === 'daily' ? 'Daily calls' : 'Weekly calls'}</h2><p>{view === 'daily' ? `${monthLabel} · calls taken per employee per day, plus next month` : `${monthLabel} · calls taken per employee, week by week`}</p></div>
      <div className="view-toggle" role="group" aria-label="Calls view">
        <button type="button" className={`view-toggle-option ${view === 'daily' ? 'active' : ''}`} aria-pressed={view === 'daily'} onClick={() => setView('daily')}>Daily</button>
        <button type="button" className={`view-toggle-option ${view === 'weekly' ? 'active' : ''}`} aria-pressed={view === 'weekly'} onClick={() => setView('weekly')}>Weekly</button>
      </div>
    </div>
    {view === 'weekly' ? <WeeklyCallsTable people={people} callCounts={callCounts} dailyByDate={dailyByDate} year={year} month={month} /> : callCounts.length ? <div className="daily-calls-body">
      <div className="daily-calls-names" style={{ flexBasis: DAILY_CALLS_NAME_COL_WIDTH }}>
        <div className="daily-calls-corner" />
        {callCounts.map((item) => {
          const match = matchEmployeeByName(item.name, people)
          return <div className="daily-calls-name" key={item.name}>{match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || item.name)} color={match?.color || colorFor(item.name)} small />}<span>{match?.name || item.name}</span></div>
        })}
      </div>
      <div className="daily-calls-scroll" ref={scrollRef}>
        <div className="daily-calls-grid" style={{ gridTemplateColumns: `repeat(${totalColumns}, 32px)` }}>
        {dates.map((date) => {
          const isWeekend = [0, 6].includes(date.getDay())
          const isToday = dateKey(date) === todayKey
          const isNextMonth = date.getMonth() !== month
          const isMonthStart = isNextMonth && date.getDate() === 1
          return <div key={dateKey(date)} className={`daily-calls-day-head ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isNextMonth ? 'other-month' : ''} ${isMonthStart ? 'month-start' : ''}`} data-today={isToday || undefined}><small>{date.toLocaleDateString(undefined, { weekday: 'short' })}</small><strong>{date.getDate()}</strong></div>
        })}
        {callCounts.flatMap((item, rowIndex) => {
          const isLastRow = rowIndex === callCounts.length - 1
          return dates.map((date) => {
            const isWeekend = [0, 6].includes(date.getDay())
            const isToday = dateKey(date) === todayKey
            const isNextMonth = date.getMonth() !== month
            const isMonthStart = isNextMonth && date.getDate() === 1
            const count = dailyByDate[dateKey(date)]?.[item.name] || 0
            return <div key={`${item.name}-${dateKey(date)}`} className={`daily-calls-cell ${isWeekend ? 'weekend' : ''} ${count ? 'has-calls' : ''} ${isToday ? 'today' : ''} ${isToday && isLastRow ? 'today-last-row' : ''} ${isNextMonth ? 'other-month' : ''} ${isMonthStart ? 'month-start' : ''}`}>{count || ''}</div>
          })
        })}
        </div>
      </div>
    </div> : <p className="empty-table">No handler data yet.</p>}
  </section>
}

// Sunday-to-Saturday weeks clipped to the month, e.g. Oct 1 – Oct 3, Oct 4 – Oct 10.
function weeksOfMonth(year, month) {
  const lastDay = daysInMonth(year, month)
  const weeks = []
  let startDay = 1
  while (startDay <= lastDay) {
    const startDate = new Date(year, month, startDay)
    const endDay = Math.min(lastDay, startDay + (6 - startDate.getDay()))
    const endDate = new Date(year, month, endDay)
    const fmt = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    weeks.push({ startKey: dateKey(startDate), endKey: dateKey(endDate), label: `${fmt(startDate)} – ${fmt(endDate)}` })
    startDay = endDay + 1
  }
  return weeks
}

function WeeklyCallsTable({ people, callCounts, dailyByDate, year, month }) {
  const weeks = useMemo(() => weeksOfMonth(year, month), [year, month])
  const todayKey = useWorkDate()

  const rows = useMemo(() => callCounts.map((item) => {
    const perWeek = weeks.map((week) => {
      let sum = 0
      for (const [date, counts] of Object.entries(dailyByDate)) {
        if (date >= week.startKey && date <= week.endKey) sum += counts[item.name] || 0
      }
      return sum
    })
    return { name: item.name, perWeek, total: perWeek.reduce((a, b) => a + b, 0) }
  }), [callCounts, dailyByDate, weeks])
  const weekTotals = weeks.map((_, index) => rows.reduce((sum, row) => sum + row.perWeek[index], 0))
  const grandTotal = weekTotals.reduce((a, b) => a + b, 0)

  return <>
    {rows.length ? <div className="weekly-calls-scroll">
      <div className="weekly-calls-grid" style={{ '--weeks': weeks.length }}>
        <div className="weekly-calls-head weekly-calls-name-head">Employee</div>
        {weeks.map((week) => <div key={week.startKey} className={`weekly-calls-head ${todayKey >= week.startKey && todayKey <= week.endKey ? 'current' : ''}`}>{week.label}</div>)}
        <div className="weekly-calls-head weekly-calls-total-head">Total</div>
        {rows.map((row) => {
          const match = matchEmployeeByName(row.name, people)
          return [
            <div className="weekly-calls-name" key={`${row.name}-name`}>{match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || row.name)} color={match?.color || colorFor(row.name)} small />}<span>{match?.name || row.name}</span></div>,
            ...row.perWeek.map((count, index) => <div key={`${row.name}-${weeks[index].startKey}`} className={`weekly-calls-cell ${count ? 'has-calls' : ''}`}>{count || ''}</div>),
            <div className="weekly-calls-cell weekly-calls-total" key={`${row.name}-total`}>{row.total}</div>,
          ]
        })}
        <div className="weekly-calls-name weekly-calls-foot">Team total</div>
        {weekTotals.map((count, index) => <div key={weeks[index].startKey} className="weekly-calls-cell weekly-calls-foot">{count}</div>)}
        <div className="weekly-calls-cell weekly-calls-total weekly-calls-foot">{grandTotal}</div>
      </div>
    </div> : <p className="empty-table">No handler data yet.</p>}
  </>
}

const EMPLOYEE_TIP_WIDTH = 252
const EMPLOYEE_TIP_HEIGHT_ESTIMATE = 396
const EMPLOYEE_TIP_GAP = 12
const ATTENDANCE_CACHE_MS = 5 * 60 * 1000
// Hovering several rows back and forth shouldn't refetch the same month every time.
const attendanceTipCache = new Map()

function useMonthAttendanceCounts(personId, monthOffset) {
  const { startDate, endDate } = monthRange(monthOffset)
  const key = `${personId}|${startDate}|${endDate}`
  const [result, setResult] = useState(() => ({ key, ...(attendanceTipCache.get(key)?.value || {}) }))

  useEffect(() => {
    const cached = attendanceTipCache.get(key)
    if (cached && Date.now() - cached.at < ATTENDANCE_CACHE_MS) {
      queueMicrotask(() => setResult({ key, ...cached.value }))
      return undefined
    }
    let cancelled = false
    hyacinthAttendanceAPI.getAttendanceLogs({ userId: personId, startDate, endDate })
      .then((logs) => {
        const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, []]))
        for (const log of logs || []) { if (log.type === 'In' && counts[log.status]) counts[log.status].push(log) }
        const value = { counts }
        attendanceTipCache.set(key, { at: Date.now(), value })
        if (!cancelled) setResult({ key, ...value })
      })
      .catch((err) => { if (!cancelled) setResult({ key, error: err.message }) })
    return () => { cancelled = true }
  }, [key, personId, startDate, endDate])

  return result.key === key ? result : { key }
}

const TODAY_RING_SIZE = 46
const TODAY_RING_STROKE = 6
const TODAY_RING_RADIUS = (TODAY_RING_SIZE - TODAY_RING_STROKE) / 2
const TODAY_RING_CIRCUMFERENCE = 2 * Math.PI * TODAY_RING_RADIUS

// A small donut of one person's calls today against the daily quota: blue while under it, green
// once it is reached, and a gold second lap for calls beyond it (same colours as the workspace donut).
function TodayQuotaRing({ calls, quota }) {
  const reached = calls >= quota
  const first = Math.min(1, calls / quota) * TODAY_RING_CIRCUMFERENCE
  const bonus = Math.min(1, Math.max(0, calls / quota - 1)) * TODAY_RING_CIRCUMFERENCE
  const common = { cx: TODAY_RING_SIZE / 2, cy: TODAY_RING_SIZE / 2, r: TODAY_RING_RADIUS, fill: 'none', strokeWidth: TODAY_RING_STROKE, transform: `rotate(-90 ${TODAY_RING_SIZE / 2} ${TODAY_RING_SIZE / 2})` }
  return <svg className="employee-tip-today-ring" width={TODAY_RING_SIZE} height={TODAY_RING_SIZE} viewBox={`0 0 ${TODAY_RING_SIZE} ${TODAY_RING_SIZE}`} aria-hidden="true">
    <circle {...common} stroke="var(--blue-soft)" />
    {first > 0 && <circle {...common} stroke={reached ? '#16a34a' : 'var(--blue)'} strokeLinecap="round" strokeDasharray={`${first} ${TODAY_RING_CIRCUMFERENCE}`} />}
    {bonus > 0 && <circle {...common} stroke="#f59e0b" strokeLinecap="round" strokeDasharray={`${bonus} ${TODAY_RING_CIRCUMFERENCE}`} />}
  </svg>
}

function EmployeeHoverTip({ person, anchorRect, container, agentCalls, todayCalls, dailyQuota, monthTotal, monthLabel, monthOffset, loadingCalls = false }) {
  const { counts, error } = useMonthAttendanceCounts(person.id, monthOffset)
  const total = counts ? ATTENDANCE_STATUSES.reduce((sum, status) => sum + counts[status].length, 0) : 0
  const percent = monthTotal > 0 ? Math.round((agentCalls / monthTotal) * 100) : 0

  // Opens to the left of the row (the Online panel sits at the right edge of the
  // dashboard) and flips to the right when there isn't room.
  const fitsLeft = anchorRect.left - EMPLOYEE_TIP_WIDTH - EMPLOYEE_TIP_GAP >= 8
  const left = fitsLeft ? anchorRect.left - EMPLOYEE_TIP_WIDTH - EMPLOYEE_TIP_GAP : Math.min(anchorRect.right + EMPLOYEE_TIP_GAP, window.innerWidth - EMPLOYEE_TIP_WIDTH - 8)
  const top = Math.max(8, Math.min(anchorRect.top + anchorRect.height / 2 - EMPLOYEE_TIP_HEIGHT_ESTIMATE / 2, window.innerHeight - EMPLOYEE_TIP_HEIGHT_ESTIMATE - 8))

  // Rendered inside .client-shell rather than document.body so it picks up the
  // dark-mode colour variables, which are scoped to that element.
  return createPortal(<div className="employee-tip" role="tooltip" style={{ left, top, width: EMPLOYEE_TIP_WIDTH }}>
    <div className="employee-tip-head"><strong>{person.name}</strong>{person.role && <small>{person.role}</small>}</div>
    <div className="employee-tip-calls">
      <small>Total calls · {monthLabel}</small>
      <div><strong>{loadingCalls ? '…' : agentCalls}</strong><span>{loadingCalls ? 'Loading...' : `${percent}% of team`}</span></div>
    </div>
    {dailyQuota > 0 && <div className="employee-tip-today">
      <TodayQuotaRing calls={todayCalls} quota={dailyQuota} />
      <div>
        <small>Calls today</small>
        <strong>{loadingCalls ? '…' : todayCalls}<span> / {dailyQuota}</span></strong>
        <em>{loadingCalls ? 'Loading...' : todayCalls >= dailyQuota ? (todayCalls > dailyQuota ? `${todayCalls - dailyQuota} over the quota` : 'Quota reached') : `${dailyQuota - todayCalls} to go`}</em>
      </div>
    </div>}
    <div className="employee-tip-attendance">
      <small>Attendance · {monthLabel}</small>
      {error ? <p className="team-status-message team-status-error">Couldn't load.</p> : !counts ? <p className="team-status-message">Loading attendance...</p> : <>
        <div className="breakdown-ring-wrap employee-tip-ring">
          <AttendanceBreakdownRing counts={counts} total={total} size={104} />
          <div className="breakdown-ring-label"><small>Counted</small><strong className="breakdown-total">{total}</strong></div>
        </div>
        <div className="employee-tip-legend">{ATTENDANCE_STATUSES.map((status) => <span key={status}><i className="breakdown-dot" style={{ background: ATTENDANCE_STATUS_COLORS[status] }} />{status}<b>{counts[status].length}</b></span>)}</div>
      </>}
    </div>
  </div>, container)
}

// The online / offline list. In the client dashboard each row opens that person's call and
// attendance stats (and shows them on hover). Without `onSelectPerson` and the call totals —
// the employee workspace has neither — it is a plain read-only list.
export function OnlineEmployeesPanel({ people, onSelectPerson, monthlyCallTotals, todayCallTotals, monthTotal, monthLabel, monthOffset, className = '', onActivate, callsLoading = false }) {
  const interactive = Boolean(onSelectPerson && monthlyCallTotals)
  const [dailyQuota, setDailyQuota] = useState(null)
  useEffect(() => subscribeToCallQuota(setDailyQuota, (err) => console.warn('[quota] unavailable:', err.message)), [])
  const onlinePeople = useMemo(() => people.filter((person) => person.online), [people])
  const offlinePeople = useMemo(() => people.filter((person) => !person.online), [people])
  const scrollRef = useRef(null)
  const directionRef = useRef(1)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(null)

  function renderRow(person) {
    const content = <><div className="avatar-wrap">{person.profileImg ? <img className="avatar avatar-photo avatar-small" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} small />}<span className={`presence ${person.online ? 'is-online' : ''}`} /></div><span className="online-mini-name">{person.name}</span>{person.attendanceStatus && <span className="attendance-status online-mini-status" style={ATTENDANCE_STATUS_COLORS[person.attendanceStatus] ? { color: ATTENDANCE_STATUS_COLORS[person.attendanceStatus], background: `${ATTENDANCE_STATUS_COLORS[person.attendanceStatus]}1a` } : undefined}>{person.attendanceStatus}</span>}</>
    const rowClass = `online-mini-row ${person.online ? '' : 'is-offline'}`
    if (!interactive) return <div className={`${rowClass} is-static`} key={person.id}>{content}</div>
    return <button type="button" className={rowClass} key={person.id} onClick={() => { setHovered(null); onActivate?.(); onSelectPerson(person) }} onMouseEnter={(event) => showTip(person, event.currentTarget)} onMouseLeave={() => setHovered(null)} onFocus={(event) => showTip(person, event.currentTarget)} onBlur={() => setHovered(null)}>{content}</button>
  }

  function showTip(person, element) {
    // Rendered inside the theme root (the client shell, or the portal in the employee
    // workspace) so the tooltip picks up the dark-mode colour variables.
    onActivate?.()
    const container = element.closest('.client-shell, .portal')
    if (container) setHovered({ person, rect: element.getBoundingClientRect(), container })
  }

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
  }, [paused, people.length])

  return <section className={`panel online-mini-panel ${className}`}>
    <div className="online-mini-heading">
      <span className="online-mini-count"><span>Online</span><b>{onlinePeople.length}</b></span>
      <span className="online-mini-count"><span>Offline</span><b>{offlinePeople.length}</b></span>
    </div>
    <div className="online-mini-list" data-overlay-scroll="off" ref={scrollRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onTouchStart={() => setPaused(true)} onScroll={() => setHovered(null)}>
      {onlinePeople.length ? onlinePeople.map(renderRow) : <p className="empty-table">No one online right now.</p>}
      <div className="online-mini-divider" role="separator"><span>Offline</span></div>
      {offlinePeople.length ? offlinePeople.map(renderRow) : <p className="empty-table">{people.length ? 'Everyone is online.' : 'No employees yet.'}</p>}
    </div>
    {hovered && interactive && <EmployeeHoverTip loadingCalls={callsLoading} person={hovered.person} anchorRect={hovered.rect} container={hovered.container} agentCalls={monthlyCallTotals[agentNameFor(hovered.person, people, monthlyCallTotals)] || 0} todayCalls={todayCallTotals?.[agentNameFor(hovered.person, people, todayCallTotals || {})] || 0} dailyQuota={dailyQuota} monthTotal={monthTotal} monthLabel={monthLabel} monthOffset={monthOffset} />}
  </section>
}

// The online panel for pages that don't hold the calls data themselves (the employee workspace,
// which passes in the shared read of the sheet): same hover tip and same click-through stats
// popup as the client dashboard, for the current month.
export function TeamOnlinePanel({ people, className = '', callsResult, callsLoading = false }) {
  const [selectedPerson, setSelectedPerson] = useState(null)
  const { year, month, monthStart, monthEnd } = useDailyCalls(callsResult, 0)
  const todayKey = useWorkDate()
  const perTab = useMemo(() => callsResult?.perTab || [], [callsResult])
  const daily = callsResult?.daily
  const todayCallTotals = daily?.[todayKey]
  const monthlyCallTotals = useMemo(() => {
    const totals = {}
    for (const [date, dayCounts] of Object.entries(daily || {})) {
      if (date < monthStart || date > monthEnd) continue
      for (const [name, count] of Object.entries(dayCounts)) totals[name] = (totals[name] || 0) + count
    }
    return totals
  }, [daily, monthStart, monthEnd])
  const monthTotal = useMemo(() => Object.values(monthlyCallTotals).reduce((sum, count) => sum + count, 0), [monthlyCallTotals])
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long' })

  return <>
    <OnlineEmployeesPanel people={people} className={className} onSelectPerson={setSelectedPerson} callsLoading={callsLoading} monthlyCallTotals={monthlyCallTotals} todayCallTotals={todayCallTotals} monthTotal={monthTotal} monthLabel={monthLabel} monthOffset={0} />
    {selectedPerson && <EmployeeStatsModal person={selectedPerson} people={people} monthlyCallTotals={monthlyCallTotals} todayCallTotals={todayCallTotals} monthTotal={monthTotal} monthLabel={monthLabel} perTab={perTab} onClose={() => setSelectedPerson(null)} />}
  </>
}

function ClosedAppointmentsPanel({ appointments, people }) {
  const [expanded, setExpanded] = useState(false)
  const [atBottom, setAtBottom] = useState(false)
  const [overflows, setOverflows] = useState(false)
  // On phones each row is a card showing only the handler and practice; these are the
  // cards whose remaining details are opened. (On desktop the table shows everything.)
  const [openRows, setOpenRows] = useState(() => new Set())
  const bodyRef = useRef(null)

  function toggleRow(key) {
    setOpenRows((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const showFade = overflows && !expanded && !atBottom

  // Measured rather than counted: a row is far taller on a phone (where it stacks into a
  // card) than in the desktop table, so how many fit before the list scrolls varies.
  // Only measured while collapsed — expanded, nothing overflows, but "Show less" must stay.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || expanded) return undefined
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [appointments, expanded, openRows])

  // Whoever closed the most; a tie goes to the one with the more recent close
  // (appointments are already newest first, so the first to reach a count keeps it).
  const topCloser = useMemo(() => {
    const tally = new Map()
    for (const item of appointments) {
      const match = matchEmployeeByName(item.handler, people)
      const key = match?.id || item.handler.toLowerCase()
      if (!key) continue
      const entry = tally.get(key) || { match, handler: item.handler, count: 0 }
      entry.count += 1
      tally.set(key, entry)
    }
    return [...tally.values()].reduce((best, entry) => (!best || entry.count > best.count ? entry : best), null)
  }, [appointments, people])
  const topName = topCloser ? topCloser.match?.name || topCloser.handler : ''

  return <section className="panel closed-appointments-panel">
    <div className="panel-heading">
      <div><h2>Closed appointments <span className="calls-scope-badge">{appointments.length}</span></h2><p>Appointments booked by the team, from the closed appointments tab of the connected sheet.</p></div>
      {topCloser && <div className="top-closer" title={`${topName} has the most closed appointments`}>
        <div className="top-closer-photo">{topCloser.match?.profileImg ? <img className="top-closer-img" src={topCloser.match.profileImg} alt="" /> : <span className={`top-closer-img top-closer-initials avatar-${topCloser.match?.color || colorFor(topCloser.handler)}`}>{initialsOf(topName)}</span>}<span className="top-stat-badge"><Icon name="trophy" size={12} /></span></div>
        <div className="top-closer-info"><small>Most Appointments Closed</small><strong>{topName}</strong><span>{topCloser.count} appointment{topCloser.count === 1 ? '' : 's'} closed</span></div>
      </div>}
    </div>
    <div className="closed-appointments-table">
      <div className="closed-appointments-row closed-appointments-head"><span>Handler</span><span>Practice</span><span>Location</span><span>POC</span><span>Date closed</span><span>Appointment</span></div>
      <div className="closed-appointments-scroll">
      <div ref={bodyRef} className={`closed-appointments-body ${expanded ? 'is-expanded' : ''}`} onScroll={(event) => { const el = event.currentTarget; setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 2) }}>
        {appointments.length ? appointments.map((item) => {
          const match = matchEmployeeByName(item.handler, people)
          const handlerName = match?.name || item.handler || '—'
          const rowKey = `${item.tab}-${item.order}`
          const isOpen = openRows.has(rowKey)
          return <div className={`closed-appointments-row ${isOpen ? 'is-open' : ''}`} key={rowKey}>
            <span className="closed-appointments-handler">{match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(handlerName)} color={match?.color || colorFor(item.handler || item.practice)} small />}<span>{handlerName}</span></span>
            <strong className="closed-appointments-practice">{item.practice}</strong>
            <button type="button" className="closed-appointments-toggle" aria-expanded={isOpen} onClick={() => toggleRow(rowKey)}>{isOpen ? 'View less' : 'View more'}</button>
            <span data-label="Location">{item.location || '—'}</span>
            <span className="closed-appointments-poc" data-label="POC">{item.pocName || '—'}{item.pocPosition && <small>{item.pocPosition}</small>}</span>
            <span data-label="Date closed">{item.dateClosed || '—'}</span>
            <span data-label="Appointment">{item.appointment || '—'}</span>
          </div>
        }) : <p className="empty-table">No closed appointments yet.</p>}
      </div>
      {showFade && <div className="closed-appointments-fade"><button type="button" className="closed-appointments-more" onClick={() => setExpanded(true)}>View more</button></div>}
      </div>
      {overflows && expanded && <button type="button" className="closed-appointments-more closed-appointments-less" onClick={() => setExpanded(false)}>Show less</button>}
    </div>
  </section>
}

// Longest the first-load screen is allowed to cover the dashboard if a request hangs.
const DASHBOARD_LOADING_MAX_MS = 20 * 1000

// `tabsOpenByDefault`: whether the Calls per tab column starts open. It does in the client view;
// in the employee workspace and the admin panel it starts closed. Either way a person's own
// choice is remembered (separately for each, so one doesn't undo the other).
export function ClientDashboard({ people, peopleLoading = false, showOnlinePanel = false, tabsOpenByDefault = false }) {
  const { sheets: callsSheets, sheetsLoaded, selectedId: selectedSheetId, selectSheet, url: sheetUrl, tabGids, counts: allCallsResult, closedAppointments, hasClosedTabs, loading: callsLoading, refreshing: callsRefreshing, refresh: refreshCalls, error: callsError } = useCallsSheet()
  // Only the people in charge of calls (Management → Call team) appear in the call charts.
  const { result: callsResult } = useCallerFilter(allCallsResult, people)
  const [monthOffset, setMonthOffset] = useState(0)
  // The daily/weekly calendar and the export are month-shaped, so under "All" they stay
  // on the current month while the totals, top agent and attendance span both months.
  const calendarOffset = monthOffset === ALL_MONTHS ? 0 : monthOffset
  const { byDate: dailyByDate, year: dailyYear, month: dailyMonth, monthStart: dailyMonthStart, monthEnd: dailyMonthEnd } = useDailyCalls(callsResult, calendarOffset)
  const callCounts = callsResult?.counts || []
  const dailyCallCounts = callCounts.filter((item) => item.name.trim().toLowerCase() !== 'available to call')
  const maxCalls = Math.max(1, ...callCounts.map((item) => item.count))
  const perTab = useMemo(() => callsResult?.perTab || [], [callsResult])
  // Incomplete (still-available) tabs surface first so the tabs needing attention
  // aren't buried below ones that are already fully worked.
  const sortedPerTab = useMemo(() => [...perTab].sort((a, b) => Number(b.available > 0) - Number(a.available > 0)), [perTab])
  const totalAvailable = useMemo(() => perTab.reduce((sum, tab) => sum + tab.available, 0), [perTab])
  const totalHandled = useMemo(() => perTab.reduce((sum, tab) => sum + tab.total, 0), [perTab])
  // A tab counts as "completed" once it has no open/available rows left.
  const completedTabCount = useMemo(() => perTab.filter((tab) => tab.available === 0).length, [perTab])
  const [selectedTabName, setSelectedTabName] = useState(null)
  // Small screens only (see responsive.css): Calls per tab slides in as a sidebar.
  const [tabsSidebarOpen, setTabsSidebarOpen] = useState(false)
  // Desktop only: the Calls per tab column can be hidden to give the rest of the dashboard
  // (notably the online panel) more room. It starts open or closed depending on the view (see
  // tabsOpenByDefault above), and after that follows the person's own choice, which is saved to
  // their account — like the sidebar and dark mode — so it is the same in every browser and on
  // every device, and changing it in one updates the others. A copy kept in this browser lets it
  // open in the right state straight away, before the account's setting has loaded.
  const tabsPreferenceKey = tabsOpenByDefault ? 'callsPerTab:client' : 'callsPerTab:workspace'
  const tabsPreferenceField = tabsOpenByDefault ? 'callsPerTabHiddenClient' : 'callsPerTabHiddenWorkspace'
  const [tabsHidden, setTabsHidden] = useState(() => {
    try {
      const saved = window.localStorage.getItem(tabsPreferenceKey)
      if (saved === 'hidden') return true
      if (saved === 'shown') return false
    } catch { /* fall through to the default */ }
    return !tabsOpenByDefault
  })

  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return undefined
    return subscribeToPreferences(uid, (prefs) => {
      const saved = prefs[tabsPreferenceField]
      // Nothing saved yet means "never changed": keep the view's default.
      if (typeof saved !== 'boolean') return
      setTabsHidden(saved)
      // A tab's detail pane would otherwise be stranded with its column hidden.
      if (saved) setSelectedTabName(null)
      try { window.localStorage.setItem(tabsPreferenceKey, saved ? 'hidden' : 'shown') } catch { /* not cached */ }
    }, (err) => console.warn('[preferences] Calls per tab setting unavailable:', err.message))
  }, [tabsPreferenceField, tabsPreferenceKey])

  function toggleTabsHidden() {
    const next = !tabsHidden
    setTabsHidden(next)
    // An open tab's detail pane would otherwise be stranded with its column gone.
    if (next) setSelectedTabName(null)
    try { window.localStorage.setItem(tabsPreferenceKey, next ? 'hidden' : 'shown') } catch { /* not cached */ }
    const uid = auth.currentUser?.uid
    if (uid) updatePreferences(uid, { [tabsPreferenceField]: next }).catch((err) => console.warn('[preferences] could not save the Calls per tab setting:', err.message))
  }
  function closeTabsSidebar() {
    setTabsSidebarOpen(false)
    // The detail sheet belongs to the sidebar, so it goes away with it.
    setSelectedTabName(null)
  }
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

  function scrollTabListDown() {
    tabListRef.current?.scrollBy({ top: tabListRef.current.clientHeight * 0.8, behavior: 'smooth' })
  }

  function scrollTabListUp() {
    tabListRef.current?.scrollBy({ top: -tabListRef.current.clientHeight * 0.8, behavior: 'smooth' })
  }

  function openTabInSheet(name) {
    if (!sheetUrl) return
    try {
      window.open(googleSheetTabUrl(sheetUrl, tabGids[name]), '_blank', 'noopener')
    } catch (err) {
      console.error('[ClientView] could not open sheet tab:', err.message)
    }
  }
  const { counts: attendanceCounts, loading: attendanceLoading, refreshing: attendanceRefreshing, refresh: refreshAttendance } = useMonthlyAttendance(people, monthOffset)
  const dashboardRefreshing = callsRefreshing || attendanceRefreshing

  function refreshDashboard() {
    if (sheetUrl) refreshCalls()
    refreshAttendance()
  }

  // One centered loading screen for the first load, while the team, the calls sheet and
  // attendance are all still coming in, instead of every panel showing its own
  // "Loading..." line. It latches off once everything has arrived once, so a month
  // switch afterwards keeps the content up rather than covering it again. Only the
  // toolbar's refresh button brings the screen back (see dashboardRefreshing).
  const [firstLoadDone, setFirstLoadDone] = useState(false)
  const stillLoading = peopleLoading || !sheetsLoaded || callsLoading || attendanceLoading
  if (!firstLoadDone && !stillLoading) setFirstLoadDone(true)
  useEffect(() => {
    const timer = setTimeout(() => setFirstLoadDone(true), DASHBOARD_LOADING_MAX_MS)
    return () => clearTimeout(timer)
  }, [])
  // The dashboard itself is only mounted once the loading screen is gone, so every
  // panel, graph and donut runs its entrance animation at the moment it is displayed
  // (on first load, and again after a refresh).
  const showLoading = !firstLoadDone || dashboardRefreshing

  useEffect(() => {
    const list = tabListRef.current
    // The list only exists once the dashboard is shown, so re-measure when it appears.
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
  }, [sortedPerTab, showLoading])
  const topAttendanceId = useMemo(() => topAttendanceIdOf(attendanceCounts), [attendanceCounts])
  const topPerson = people.find((person) => person.id === topAttendanceId)
  const monthLabel = monthOffset === ALL_MONTHS ? ALL_MONTHS_LABEL : new Date(dailyYear, dailyMonth, 1).toLocaleDateString(undefined, { month: 'long' })
  const dailyToday = useWorkDate()
  const monthOptions = [0, -1].map((offset) => {
    const { year, month } = workMonth(offset, dailyToday)
    const date = new Date(year, month, 1)
    return { offset, label: `${date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}${offset === 0 ? ' (this month)' : ''}` }
  }).concat({ offset: ALL_MONTHS, label: 'All' })

  const allMonthsStart = useMemo(() => {
    const { year, month } = workMonth(-1, dailyToday)
    return dateKey(new Date(year, month, 1))
  }, [dailyToday])
  const callsRangeStart = monthOffset === ALL_MONTHS ? allMonthsStart : dailyMonthStart
  const daily = callsResult?.daily
  const monthlyCallTotals = useMemo(() => {
    const totals = {}
    for (const [date, dayCounts] of Object.entries(daily || {})) {
      if (date < callsRangeStart || date > dailyMonthEnd) continue
      for (const [name, count] of Object.entries(dayCounts)) totals[name] = (totals[name] || 0) + count
    }
    return totals
  }, [daily, callsRangeStart, dailyMonthEnd])
  const topAgentName = useMemo(() => {
    const entries = Object.entries(monthlyCallTotals)
    if (!entries.length) return null
    return entries.reduce((best, entry) => (entry[1] > (best?.[1] ?? -1) ? entry : best), null)?.[0]
  }, [monthlyCallTotals])
  const [exporting, setExporting] = useState(null)
  const [pendingExport, setPendingExport] = useState(null)
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false)
  const toolbarMenuRef = useRef(null)

  useEffect(() => {
    if (!toolbarMenuOpen) return undefined
    function onPointerDown(event) {
      if (!toolbarMenuRef.current?.contains(event.target)) setToolbarMenuOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setToolbarMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [toolbarMenuOpen])

  async function exportReport(format) {
    if (exporting) return
    setExporting(format)
    try {
      const displayName = (name) => matchEmployeeByName(name, people)?.name || name
      // The current month matches what the Calls per employee chart shows (live
      // sheet totals, undated rows included); a past month is counted from the rows
      // dated within it.
      const isCurrentMonth = calendarOffset === 0
      const perEmployee = (isCurrentMonth
        ? dailyCallCounts.map((item) => ({ key: item.name, count: item.count }))
        : Object.entries(monthlyCallTotals).filter(([name]) => name.trim().toLowerCase() !== 'available to call').map(([name, count]) => ({ key: name, count })))
        .sort((a, b) => b.count - a.count)
        .map((item) => ({ name: displayName(item.key), count: item.count }))
      const handlerKeys = new Set([...dailyCallCounts.map((item) => item.name), ...Object.keys(monthlyCallTotals).filter((name) => name.trim().toLowerCase() !== 'available to call')])
      const dailyRows = [...handlerKeys].map((key) => ({ key, name: displayName(key) })).sort((a, b) => a.name.localeCompare(b.name))
      const days = Array.from({ length: daysInMonth(dailyYear, dailyMonth) }, (_, index) => {
        const date = new Date(dailyYear, dailyMonth, index + 1)
        return { key: dateKey(date), label: index + 1, weekday: date.toLocaleDateString(undefined, { weekday: 'short' }), weekend: [0, 6].includes(date.getDay()) }
      })
      const exportFn = format === 'pdf' ? exportCallsReportPdf : exportCallsReport
      await exportFn({
        monthLabel: new Date(dailyYear, dailyMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        sourceNote: isCurrentMonth ? 'Source: handler totals from the connected calls sheet; daily counts include only rows with a date' : 'Source: rows with a date in the connected calls sheet',
        callsPerEmployee: perEmployee,
        dailyRows,
        days,
        weeks: weeksOfMonth(dailyYear, dailyMonth),
        dailyByDate,
        // Only the Excel report has a closed-appointments tab; null leaves it out when the
        // sheet has no closed-appointments tab connected.
        closedAppointments: hasClosedTabs ? closedAppointments.map((item) => ({
          handler: displayName(item.handler),
          practice: item.practice,
          location: item.location,
          pocName: item.pocName,
          pocPosition: item.pocPosition,
          dateClosed: item.dateClosed,
          appointment: item.appointment,
        })) : null,
      })
    } catch (err) {
      console.error('[ClientView] export failed:', err)
      window.alert(`Couldn't create the report: ${err.message}`)
    } finally {
      setExporting(null)
    }
  }

  const topAgentCalls = topAgentName ? monthlyCallTotals[topAgentName] : 0
  const topAgentMatch = topAgentName ? matchEmployeeByName(topAgentName, people) : null
  const monthlyTotalAllAgents = useMemo(() => Object.values(monthlyCallTotals).reduce((sum, count) => sum + count, 0), [monthlyCallTotals])

  return <div className="content client-dashboard">
    {showLoading && <div className="dashboard-loading" role="status" aria-live="polite"><span className="loading-spinner" /><p>Loading your dashboard...</p></div>}
    {!showLoading && <>
    <div className={`dashboard-toolbar ${tabsHidden ? 'is-closed' : ''}`}>
      <div className="dashboard-toolbar-left">
        {/* A tab on top of the Calls per tab column: joined to the panel while it is showing, a
            standalone button when it is hidden. It toggles the column either way. */}
        <button type="button" className={`calls-tab-handle ${tabsHidden ? '' : 'is-open'}`} aria-expanded={!tabsHidden} title={tabsHidden ? 'Show the Calls per tab column' : 'Hide the Calls per tab column'} onClick={toggleTabsHidden}><Icon name="phone-call" size={15} />{tabsHidden ? 'Show Calls per tab' : 'Hide Calls per tab'}</button>
      </div>
      <div className="dashboard-toolbar-actions">
        <button type="button" className="tabs-toggle" aria-expanded={tabsSidebarOpen} onClick={() => setTabsSidebarOpen(true)}><Icon name="phone-call" size={15} />Calls per tab</button>
        <div className="toolbar-menu" ref={toolbarMenuRef}>
          <button type="button" className={`icon-button toolbar-menu-trigger ${toolbarMenuOpen ? 'active' : ''}`} aria-label="More actions" aria-haspopup="menu" aria-expanded={toolbarMenuOpen} onClick={() => setToolbarMenuOpen((open) => !open)}><Icon name="more" size={18} /></button>
          {toolbarMenuOpen && <div className="toolbar-menu-list" role="menu">
            <button type="button" role="menuitem" className="toolbar-menu-item" disabled={Boolean(exporting) || (!sheetUrl && !callCounts.length)} onClick={() => { setToolbarMenuOpen(false); setPendingExport('excel') }}><ExcelFileIcon size={18} /><span>{exporting === 'excel' ? 'Preparing...' : 'Export as excel'}</span></button>
            <button type="button" role="menuitem" className="toolbar-menu-item" disabled={Boolean(exporting) || (!sheetUrl && !callCounts.length)} onClick={() => { setToolbarMenuOpen(false); setPendingExport('pdf') }}><PdfFileIcon size={18} /><span>{exporting === 'pdf' ? 'Preparing...' : 'Export as PDF'}</span></button>
          </div>}
        </div>
        <button type="button" className={`icon-button refresh-button ${dashboardRefreshing ? 'is-spinning' : ''}`} aria-label="Refresh the dashboard" title="Refresh dashboard" disabled={dashboardRefreshing} onClick={refreshDashboard}><Icon name="refresh" size={16} /></button>
      </div>
    </div>
    <div className={`dashboard-layout ${selectedTab ? 'tab-open' : ''} ${tabsHidden ? 'tabs-hidden' : ''}`}>
      {tabsSidebarOpen && <button type="button" className="tab-sidebar-backdrop" aria-label="Close Calls per tab" onClick={closeTabsSidebar} />}
      <aside className={`panel tab-sidebar ${selectedTab ? 'drawer-open' : ''} ${tabsSidebarOpen ? 'is-sidebar-open' : ''} ${tabsHidden ? 'is-hidden' : ''}`}>
        <button type="button" className="icon-button tab-sidebar-close" aria-label="Close Calls per tab" onClick={closeTabsSidebar}><Icon name="x" size={18} /></button>
        <div className="tab-sidebar-list-col">
          <div className="panel-heading panel-heading-stack">
            <div className="tab-sidebar-head">
              <div><h2>Calls per tab</h2><p>Click a tab to see its handlers</p></div>
            </div>
            <div className="calls-progress-summary">
              <CallsProgressRing handled={totalHandled} available={totalAvailable} />
              <div className="calls-progress-legend">
                <span><i className="calls-progress-dot handled" />Handled <b>{totalHandled}</b></span>
                <span><i className="calls-progress-dot available" />Available <b>{totalAvailable}</b></span>
              </div>
            </div>
            <p className="calls-tabs-completed">{completedTabCount} of {perTab.length} tabs completed</p>
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

      <div className="dashboard-main" data-overlay-scroll-align="window">
        <div className="dashboard-hero-row">
          <section className="panel calls-hero">
            <div className="panel-heading">
              <div><h2>Calls per employee <span className="calls-scope-badge">Overall</span></h2><p>{callsResult ? `Overall total, not filtered by month. Counted from the Handler column across ${callsResult.scanned.length} tab${callsResult.scanned.length === 1 ? '' : 's'}.` : 'Overall total, not filtered by month. Counted from the Handler column of the connected sheet.'}</p></div>
              <div className="panel-heading-actions">
                {callsSheets.length > 1 && <CustomSelect value={selectedSheetId || ''} onChange={selectSheet} options={callsSheets.map((sheet) => ({ value: sheet.id, label: sheet.title || sheet.url }))} ariaLabel="Switch calls sheet" align="right" />}
              </div>
            </div>
            <div className="calls-chart-bars">{!sheetUrl ? <p className="empty-table">No calls sheet connected yet. An admin can connect one from the Admin panel.</p> : callsLoading ? <p className="team-status-message">Loading calls data...</p> : callsError ? <p className="team-status-message team-status-error">{callsError}</p> : callCounts.length ? callCounts.map((item) => {
              const match = matchEmployeeByName(item.name, people)
              const barHeightPercent = (item.count / maxCalls) * 100
              // --bar is the bar's length as a share of the top agent's; the stylesheet applies it
              // as a height (vertical columns) or a width (the horizontal list on phones).
              return <div className="calls-bar-col" key={item.name} style={{ '--bar': `${barHeightPercent}%` }}>
                <div className="calls-bar-track">
                  <span className="calls-bar-value">{item.count}</span>
                  <div className="calls-bar-fill" />
                </div>
                {match?.profileImg ? <img className="avatar avatar-photo avatar-small" src={match.profileImg} alt="" /> : <Avatar initials={initialsOf(match?.name || item.name)} color={match?.color || colorFor(item.name)} small />}
                <span className="calls-bar-name">{match?.name || item.name}</span>
              </div>
            }) : <p className="empty-table">No handler data found in that sheet.</p>}</div>
          </section>
          {showOnlinePanel && <OnlineEmployeesPanel people={people} onSelectPerson={setSelectedPerson} monthlyCallTotals={monthlyCallTotals} todayCallTotals={daily?.[dailyToday]} monthTotal={monthlyTotalAllAgents} monthLabel={monthLabel} monthOffset={monthOffset} />}
        </div>
        {sheetUrl && <CallsTrendPanel daily={callsResult?.daily} people={people} loading={callsLoading} monthOffset={calendarOffset} />}
        {hasClosedTabs && <ClosedAppointmentsPanel appointments={closedAppointments} people={people} />}
        <hr className="dashboard-divider" />
        <div className="dashboard-month-row">
          <CustomSelect className="month-filter" value={monthOffset} onChange={setMonthOffset} options={monthOptions.map((option) => ({ value: option.offset, label: option.label }))} ariaLabel="Switch month" align="right" />
        </div>
        <section className="top-attendance-banner">
          {attendanceLoading ? <div className="top-stat"><p>Loading attendance...</p></div> : topPerson ? <button type="button" className="top-stat top-stat-clickable" onClick={() => setOpenStatModal('attendance')}><div className="avatar-wrap">{topPerson.profileImg ? <img className="avatar avatar-photo avatar-large" src={topPerson.profileImg} alt="" /> : <Avatar initials={topPerson.initials} color={topPerson.color} large />}<span className="top-stat-badge"><Icon name="trophy" size={14} /></span></div><div className="top-stat-info"><small className="top-stat-label">Top attendance</small><small className="top-stat-month">{monthLabel}</small><strong>{topPerson.name}</strong><div className="top-stat-metric"><Icon name="calendar" size={15} /><b>{attendanceCounts[topAttendanceId].present}</b><span>day{attendanceCounts[topAttendanceId].present === 1 ? '' : 's'} present</span></div></div></button> : <div className="top-stat"><p>No one has a late-free record yet.</p></div>}
          <div className="top-stat-divider" />
          {!sheetUrl ? <div className="top-stat"><p>No calls sheet connected yet.</p></div> : !topAgentName ? <div className="top-stat"><p>Not enough call data yet.</p></div> : <button type="button" className="top-stat top-stat-clickable" onClick={() => setOpenStatModal('agent')}><div className="avatar-wrap">{topAgentMatch?.profileImg ? <img className="avatar avatar-photo avatar-large" src={topAgentMatch.profileImg} alt="" /> : <Avatar initials={initialsOf(topAgentMatch?.name || topAgentName)} color={topAgentMatch?.color || colorFor(topAgentName)} large />}</div><div className="top-stat-info"><small className="top-stat-label">Top agent</small><small className="top-stat-month">{monthLabel}</small><strong>{topAgentMatch?.name || topAgentName}</strong><div className="top-stat-metric"><Icon name="phone" size={15} /><b>{topAgentCalls}</b><span>call{topAgentCalls === 1 ? '' : 's'}</span></div></div></button>}
        </section>

        {pendingExport && <ExportConfirmModal format={pendingExport} monthLabel={new Date(dailyYear, dailyMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} employeeCount={dailyCallCounts.length} busy={Boolean(exporting)} onCancel={() => setPendingExport(null)} onConfirm={async () => { await exportReport(pendingExport); setPendingExport(null) }} />}

        {selectedPerson && <EmployeeStatsModal person={selectedPerson} people={people} monthlyCallTotals={monthlyCallTotals} todayCallTotals={daily?.[dailyToday]} monthTotal={monthlyTotalAllAgents} monthLabel={monthLabel} perTab={perTab} onClose={() => setSelectedPerson(null)} />}

        {openStatModal === 'attendance' && topPerson && <TopAttendanceModal person={topPerson} onClose={() => setOpenStatModal(null)} />}
        {openStatModal === 'agent' && topAgentName && <TopAgentModal agentName={topAgentName} displayName={topAgentMatch?.name || topAgentName} avatar={topAgentMatch?.profileImg ? <img className="avatar avatar-photo avatar-large" src={topAgentMatch.profileImg} alt="" /> : <Avatar initials={initialsOf(topAgentMatch?.name || topAgentName)} color={topAgentMatch?.color || colorFor(topAgentName)} large />} perTab={perTab} agentCalls={topAgentCalls} monthTotal={monthlyTotalAllAgents} monthLabel={monthLabel} onClose={() => setOpenStatModal(null)} />}

        <DailyCallsCalendar people={people} callCounts={dailyCallCounts} dailyByDate={dailyByDate} year={dailyYear} month={dailyMonth} />
      </div>
    </div></>}
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
      <aside className="attendance-drawer">{selected && <><div className="attendance-drawer-header"><div><strong>{selected.name}</strong><small>{selected.role}</small></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setSelectedId(null)}><Icon name="x" size={18} /></button></div><div className="attendance-drawer-body">{loading ? <p className="team-status-message">Loading attendance...</p> : error ? <p className="team-status-message team-status-error">{error}</p> : logs.length ? logs.map((log, index) => <div className="attendance-log-row" key={index}><div className="attendance-log-row-main"><div className="attendance-log-badges"><span className={`attendance-type ${log.type === 'In' ? 'in' : 'out'}`}>{log.type}</span>{log.status && <span className="attendance-status" style={ATTENDANCE_STATUS_COLORS[log.status] ? { color: ATTENDANCE_STATUS_COLORS[log.status], background: `${ATTENDANCE_STATUS_COLORS[log.status]}1a` } : undefined}>{log.status}</span>}</div><span>{new Date(log.timestamp).toLocaleString()}</span></div><AttendanceLogDetails log={log} /></div>) : <p className="empty-table">No attendance logs this month.</p>}</div></>}</aside>
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
  const { people, loading: peopleLoading } = useTeamPresence(
    import.meta.env.VITE_HYACINTH_DEPARTMENT_ID,
  )
  const { page: activePage, setPage: setActivePage } = useHashRoute({ pages: CLIENT_PAGES })
  useDocumentTitle(invitePending ? 'Accept invite' : mustChangePassword ? 'Change password' : `Client · ${activePage}`)
  // The Dashboard and Attendance Log own a lot of fetched state (calls sheet, monthly
  // attendance, per-day breakdown), so they stay mounted once opened and are only
  // hidden while another page is showing. Unmounting them threw all of it away and
  // every return visit started from the loading state again.
  const [attendanceLogOpened, setAttendanceLogOpened] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [savingDarkMode, setSavingDarkMode] = useState(false)

  function navigate(page) {
    if (page === 'Attendance Log') setAttendanceLogOpened(true)
    setActivePage(page)
  }

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
    <ClientHeader activePage={activePage} onNavigate={navigate} onOpenSettings={() => navigate('Settings')} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
    <AppointmentCelebration userId={user.uid} people={people} />
    <AnnouncementAlert userId={user.uid} enabled={profile?.role !== 'visitor'} />
    <QuotaAlert userId={user.uid} enabled={profile?.role !== 'visitor'} />
    <MentionAlert userId={user.uid} userEmail={user.email} enabled={profile?.role !== 'visitor'} />
    <div style={{ display: activePage === 'Dashboard' ? 'contents' : 'none' }}><ClientDashboard people={people} peopleLoading={peopleLoading} showOnlinePanel tabsOpenByDefault /></div>
    {(attendanceLogOpened || activePage === 'Attendance Log') && <div style={{ display: activePage === 'Attendance Log' ? 'contents' : 'none' }}><AttendanceLogPage people={people} /></div>}
    {activePage === 'Settings' && <SettingsPage user={user} profile={profile} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onSignOut={() => signOut(auth).then(() => window.location.assign('/login'))} />}
  </div>
}
