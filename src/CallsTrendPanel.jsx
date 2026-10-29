import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './trend.css'
import CustomSelect from './CustomSelect'
import { matchEmployeeByName } from './utils/matchEmployee'
import { subscribeToCallQuota } from './services/quota'
import { workDateKey, workMonth } from './shared/workCalendar'

// A line graph of calls over time, under the Calls per employee panel. Three views:
//   Daily    every day of the month the dashboard is showing
//   Weekly   the last 12 weeks, each labelled by its Monday (weeks run Monday to Sunday)
//   Monthly  the last 12 months
// for the whole team or one employee, with the daily quota drawn as a dashed line so the trend
// reads against the target. The quota counts working days (Monday to Friday): a day's line is
// the quota, a week's is five times it, a month's is its weekdays times it; for the whole team
// it is also multiplied by the number of employees.
const VIEWS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]
const TEAM = '__team'
const EMPLOYEE = '__employee'
const WEEKS_SHOWN = 12
const MONTHS_SHOWN = 12
const HEIGHT = 260
const SMALL_HEIGHT = 220
const MARGIN = { top: 16, right: 18, bottom: 30, left: 44 }
const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (value) => String(value).padStart(2, '0')
const keyOf = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
const parseKey = (key) => { const [year, month, day] = key.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)) }
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS)
const mondayOf = (date) => addDays(date, -((date.getUTCDay() + 6) % 7))
const isWeekday = (date) => date.getUTCDay() >= 1 && date.getUTCDay() <= 5
const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
const formatDay = (date, options) => date.toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })

function weekdaysIn(year, month) {
  let count = 0
  for (let day = 1; day <= daysInMonth(year, month); day++) if (isWeekday(new Date(Date.UTC(year, month, day)))) count++
  return count
}

// A y-axis ceiling that lands on tidy gridlines (four of them).
function niceMax(value) {
  const step = 10 ** Math.floor(Math.log10(Math.max(1, value)))
  const rounded = Math.ceil(value / step) * step
  return Math.max(4, Math.ceil(rounded / 4) * 4)
}

function useElementWidth(ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

// With `employee` (a person from `people`) the graph is that one person's: no picker, and the
// target is a single day's quota rather than the team's. The sheet can name one person under
// more than one handler name, so every name that resolves to them is counted.
export default function CallsTrendPanel({ daily, people, loading, monthOffset = 0, employee = null }) {
  const [view, setView] = useState('daily')
  const [scope, setScope] = useState(TEAM)
  const [quota, setQuota] = useState(0)
  const [todayKey, setTodayKey] = useState(() => workDateKey())
  const [hover, setHover] = useState(null)
  const chartRef = useRef(null)
  const width = useElementWidth(chartRef)
  const gradientId = useId()

  useEffect(() => subscribeToCallQuota(setQuota, () => {}), [])
  useEffect(() => {
    const interval = setInterval(() => setTodayKey(workDateKey()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Every handler that has any dated call, for the employee picker and for the team's size.
  const handlerNames = useMemo(() => {
    const names = new Set()
    for (const dayCounts of Object.values(daily || {})) {
      for (const name of Object.keys(dayCounts)) if (name.trim().toLowerCase() !== 'available to call') names.add(name)
    }
    return [...names]
  }, [daily])
  const scopeOptions = useMemo(() => [
    { value: TEAM, label: 'Whole team' },
    ...handlerNames.map((name) => ({ value: name, label: matchEmployeeByName(name, people)?.name || name })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [handlerNames, people])
  // A picked employee who no longer has calls falls back to the team rather than an empty chart.
  const activeScope = employee ? EMPLOYEE : scope === TEAM || handlerNames.includes(scope) ? scope : TEAM
  const employeeNames = useMemo(
    () => (employee ? handlerNames.filter((name) => matchEmployeeByName(name, people)?.id === employee.id) : []),
    [employee, handlerNames, people],
  )

  const { points, unit } = useMemo(() => {
    const valueOn = (key) => {
      const dayCounts = daily?.[key]
      if (!dayCounts) return 0
      if (activeScope === EMPLOYEE) return employeeNames.reduce((sum, name) => sum + (dayCounts[name] || 0), 0)
      if (activeScope !== TEAM) return dayCounts[activeScope] || 0
      return Object.entries(dayCounts).reduce((sum, [name, count]) => (name.trim().toLowerCase() === 'available to call' ? sum : sum + count), 0)
    }
    // The whole team's target is the quota times the people making calls.
    const perDay = quota > 0 ? quota * (activeScope === TEAM ? Math.max(1, handlerNames.length) : 1) : 0
    const today = parseKey(todayKey)

    if (view === 'weekly') {
      const thisMonday = mondayOf(today)
      const weeks = Array.from({ length: WEEKS_SHOWN }, (_, index) => {
        const start = addDays(thisMonday, -7 * (WEEKS_SHOWN - 1 - index))
        let total = 0
        for (let day = 0; day < 7; day++) total += valueOn(keyOf(addDays(start, day)))
        return {
          label: formatDay(start, { month: 'short', day: 'numeric' }),
          fullLabel: `Week of ${formatDay(start, { weekday: 'short', month: 'short', day: 'numeric' })}`,
          value: total,
          quota: perDay * 5,
        }
      })
      return { points: weeks, unit: 'week' }
    }

    if (view === 'monthly') {
      const { year, month } = workMonth(0, todayKey)
      const months = Array.from({ length: MONTHS_SHOWN }, (_, index) => {
        const shifted = new Date(Date.UTC(year, month - (MONTHS_SHOWN - 1 - index), 1))
        const y = shifted.getUTCFullYear()
        const m = shifted.getUTCMonth()
        const prefix = `${y}-${pad(m + 1)}-`
        let total = 0
        for (let day = 1; day <= daysInMonth(y, m); day++) total += valueOn(`${prefix}${pad(day)}`)
        return {
          label: m === 0 || index === 0 ? `${MONTH_NAMES[m]} ${String(y).slice(2)}` : MONTH_NAMES[m],
          fullLabel: `${MONTH_NAMES[m]} ${y}`,
          value: total,
          quota: perDay * weekdaysIn(y, m),
        }
      })
      return { points: months, unit: 'month' }
    }

    // Daily: each day of the month the dashboard is on; days still to come have no point.
    const { year, month } = workMonth(monthOffset, todayKey)
    const days = Array.from({ length: daysInMonth(year, month) }, (_, index) => {
      const date = new Date(Date.UTC(year, month, index + 1))
      const key = keyOf(date)
      return {
        label: String(index + 1),
        fullLabel: formatDay(date, { weekday: 'short', month: 'short', day: 'numeric' }),
        value: key > todayKey ? null : valueOn(key),
        quota: perDay,
      }
    })
    return { points: days, unit: 'day' }
  }, [daily, view, activeScope, employeeNames, quota, handlerNames, todayKey, monthOffset])

  const measured = points.filter((point) => point.value !== null)
  const total = measured.reduce((sum, point) => sum + point.value, 0)
  const average = measured.length ? Math.round(total / measured.length) : 0
  const best = measured.reduce((top, point) => (point.value > (top?.value ?? -1) ? point : top), null)

  // ---- geometry ----
  const height = width && width < 520 ? SMALL_HEIGHT : HEIGHT
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerHeight = height - MARGIN.top - MARGIN.bottom
  const top = niceMax(Math.max(...points.map((point) => Math.max(point.value ?? 0, point.quota || 0)), 1) * 1.08)
  const x = (index) => MARGIN.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
  const y = (value) => MARGIN.top + innerHeight - (value / top) * innerHeight
  const labelWidth = view === 'daily' ? 22 : view === 'weekly' ? 50 : 44
  const labelEvery = Math.max(1, Math.ceil(labelWidth / Math.max(1, innerWidth / Math.max(1, points.length - 1))))

  // The line is drawn in runs: it stops at today, and a gap in the data breaks it.
  const runs = []
  points.forEach((point, index) => {
    if (point.value === null) return
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1].index === index - 1) last.push({ index, value: point.value })
    else runs.push([{ index, value: point.value }])
  })
  const linePath = (run) => run.map((point, i) => `${i ? 'L' : 'M'}${x(point.index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ')
  const areaPath = (run) => `${linePath(run)} L${x(run[run.length - 1].index).toFixed(1)} ${y(0).toFixed(1)} L${x(run[0].index).toFixed(1)} ${y(0).toFixed(1)} Z`
  const quotaPath = quota > 0 ? points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.quota).toFixed(1)}`).join(' ') : ''

  function onPointerMove(event) {
    if (!innerWidth) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left - MARGIN.left) / innerWidth))
    setHover(points.length === 1 ? 0 : Math.round(ratio * (points.length - 1)))
  }
  const hovered = hover !== null ? points[hover] : null

  return <section className="panel calls-trend">
    <div className="panel-heading">
      <div><h2>Calls trend</h2><p>{view === 'daily' ? 'Calls per day this month' : view === 'weekly' ? `Calls per week for the last ${WEEKS_SHOWN} weeks (weeks start on Monday)` : `Calls per month for the last ${MONTHS_SHOWN} months`} · {activeScope === EMPLOYEE ? employee.name : activeScope === TEAM ? 'whole team' : scopeOptions.find((option) => option.value === activeScope)?.label}</p></div>
      <div className="panel-heading-actions calls-trend-controls">
        {!employee && <CustomSelect value={activeScope} onChange={setScope} options={scopeOptions} ariaLabel="Whose calls to show" align="right" />}
        <div className="view-toggle" role="group" aria-label="Trend period">
          {VIEWS.map(([value, label]) => <button type="button" key={value} className={`view-toggle-option ${view === value ? 'active' : ''}`} aria-pressed={view === value} onClick={() => { setView(value); setHover(null) }}>{label}</button>)}
        </div>
      </div>
    </div>
    <div className="calls-trend-stats">
      <span><small>Total</small><b>{total}</b></span>
      <span><small>Average per {unit}</small><b>{average}</b></span>
      <span><small>Best {unit}</small><b>{best ? best.value : 0}</b>{best && <em>{best.fullLabel}</em>}</span>
      <span className="calls-trend-legend"><i className="is-line" />Calls{quota > 0 && <><i className="is-quota" />Target</>}</span>
    </div>
    <div className="calls-trend-chart" ref={chartRef} style={{ height }}>
      {loading ? <p className="team-status-message">Loading calls...</p> : width > 0 && <>
        <svg width={width} height={height} role="img" aria-label="Calls trend line graph" onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((tick) => <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y((top / 4) * tick)} y2={y((top / 4) * tick)} className="trend-grid" />
            <text x={MARGIN.left - 8} y={y((top / 4) * tick) + 4} className="trend-axis" textAnchor="end">{Math.round((top / 4) * tick)}</text>
          </g>)}
          {points.map((point, index) => index % labelEvery === 0 && <text key={index} x={x(index)} y={height - 8} className="trend-axis" textAnchor="middle">{point.label}</text>)}
          {/* Keyed so changing the view or the person replays the draw-in. */}
          <g key={`${view}-${activeScope}-${monthOffset}`}>
            {quotaPath && <path d={quotaPath} className="trend-quota" />}
            {runs.map((run, index) => <path key={`area-${index}`} d={areaPath(run)} fill={`url(#${gradientId})`} className="trend-area" />)}
            {runs.map((run, index) => <path key={`line-${index}`} d={linePath(run)} pathLength="1" className="trend-line" />)}
            {measured.length <= 31 && points.map((point, index) => point.value !== null && <circle key={index} cx={x(index)} cy={y(point.value)} r={hover === index ? 5 : 3} className="trend-dot" />)}
          </g>
          {hovered && <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={y(0)} className="trend-guide" />}
        </svg>
        {hovered && <div className="calls-trend-tip" style={{ left: Math.min(Math.max(x(hover), 70), width - 70), top: hovered.value === null ? MARGIN.top : Math.max(0, y(hovered.value) - 12) }}>
          <strong>{hovered.fullLabel}</strong>
          {hovered.value === null ? <span>Not yet</span> : <span>{hovered.value} call{hovered.value === 1 ? '' : 's'}</span>}
          {quota > 0 && hovered.value !== null && hovered.quota > 0 && <small>{hovered.value >= hovered.quota ? `+${hovered.value - hovered.quota} over the target of ${hovered.quota}` : `${hovered.quota - hovered.value} short of the target of ${hovered.quota}`}</small>}
        </div>}
      </>}
    </div>
  </section>
}
