import { useEffect, useMemo, useState } from 'react'
import './quota.css'
import { Icon } from './PortalShell'
import { ringArc, useWorkDate } from './ClientView'
import { useWorkspaceCalls } from './WorkspaceCalls'
import { matchEmployeeByName } from './utils/matchEmployee'
import { setCallQuota, subscribeToCallQuota } from './services/quota'

const SIZE = 148
const STROKE = 16
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const QUOTA_MAX = 10000

// "42/130" is the donut's headline; the longer it is the smaller it is set, so it always fits the hole.
function ratioFontSize(calls, quota) {
  const length = `${calls}/${quota}`.length
  if (length <= 5) return 30
  if (length <= 7) return 24
  return 19
}

export function QuotaForm({ current, busy, error, onSubmit, onCancel }) {
  const [value, setValue] = useState(current ? String(current) : '')
  const quota = Number(value)
  const valid = Number.isInteger(quota) && quota >= 1 && quota <= QUOTA_MAX

  return <div className="modal-overlay" role="presentation" onClick={busy ? undefined : onCancel}>
    <form className="modal-card quota-modal" role="dialog" aria-modal="true" aria-label="Set daily call quota" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit(quota) }}>
      <h3>Daily call quota</h3>
      <p>The number of calls each employee aims for in a day. It's a target, not a limit — going beyond it is welcome, and the donut keeps counting past it.</p>
      <label>Target calls per day<input type="number" inputMode="numeric" min={1} max={QUOTA_MAX} step={1} value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. 50" autoFocus required /></label>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="admin-link" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="admin-primary" disabled={busy || !valid}>{busy ? 'Saving...' : 'Save quota'}</button></div>
    </form>
  </div>
}

// The heading of the workspace: a donut showing how many calls the signed-in employee has made
// today against the daily quota. The quota is a target — going beyond it is fine and shown: once
// the ring is full it starts a second lap in gold. Today's calls come from the connected sheet
// (rows dated today, under this employee's handler name); the quota is one team-wide number that
// managers and admins set.
export default function QuotaDonut({ user, people, todayLabel, canSetQuota, updaterName }) {
  const calls = useWorkspaceCalls()
  const todayKey = useWorkDate()
  const [quota, setQuota] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeToCallQuota(setQuota, (err) => console.warn('[quota] unavailable:', err.message)), [])

  // Which Hyacinth employee this account is, by email, then that person's calls today (the
  // sheet names a handler by a short name, which matchEmployeeByName resolves).
  const email = (user.email || '').trim().toLowerCase()
  const me = useMemo(() => people.find((person) => (person.email || '').trim().toLowerCase() === email) || null, [people, email])
  const callsToday = useMemo(() => {
    if (!me) return 0
    const dayCounts = calls?.counts?.daily?.[todayKey] || {}
    return Object.entries(dayCounts).reduce((sum, [name, count]) => (matchEmployeeByName(name, people)?.id === me.id ? sum + count : sum), 0)
  }, [calls?.counts, todayKey, me, people])

  const loadingCalls = Boolean(calls?.loading)
  const hasQuota = quota > 0
  const reached = hasQuota && callsToday >= quota
  const over = reached ? callsToday - quota : 0
  // The first lap is the quota itself; past it, a second lap (up to another full ring) shows
  // how far beyond the target the day has gone.
  const length = hasQuota ? Math.min(1, callsToday / quota) * CIRCUMFERENCE : 0
  const bonusRatio = hasQuota ? Math.min(1, Math.max(0, callsToday / quota - 1)) : 0
  const bonusLength = bonusRatio * CIRCUMFERENCE

  async function save(next) {
    setBusy(true)
    setError('')
    try {
      await setCallQuota(next, { previous: quota || 0, updatedBy: user.email || user.uid, updatedByName: updaterName })
      setEditing(false)
    } catch (err) {
      setError(err.code === 'permission-denied' ? "You don't have permission to set the quota." : err.message)
    } finally {
      setBusy(false)
    }
  }

  let status
  if (quota === null) status = 'Loading your quota...'
  else if (!hasQuota) status = canSetQuota ? 'No daily quota is set yet.' : 'No daily quota has been set yet.'
  else if (!me) status = "Your account isn't linked to a calls handler, so there's nothing to count."
  else if (calls?.callers?.configured && !calls.callers.isCallerPerson(me)) status = "You're not on the call team, so there's no call quota for you."
  else if (loadingCalls) status = "Counting today's calls..."
  else if (reached) status = over > 0 ? `Target reached — you're ${over} call${over === 1 ? '' : 's'} beyond it. Great work!` : 'Target reached. Keep going — there is no limit!'
  else status = `${quota - callsToday} more call${quota - callsToday === 1 ? '' : 's'} to reach today's target.`

  return <div className="quota-card" data-focus-id="quota">
    <div className={`quota-ring ${reached ? 'is-reached' : ''}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--blue-soft)" strokeWidth={STROKE} />
        {length > 0 && <circle key={`${callsToday}-${quota}`} {...ringArc({ circumference: CIRCUMFERENCE, strokeWidth: STROKE, offset: 0, length, gap: 0, whole: reached })} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={reached ? '#16a34a' : 'var(--blue)'} strokeWidth={STROKE} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />}
        {bonusLength > 0 && (() => {
          const arc = ringArc({ circumference: CIRCUMFERENCE, strokeWidth: STROKE, offset: 0, length: bonusLength, gap: 0, whole: bonusRatio >= 1 })
          // Drawn after the first lap has finished (its delay plus its duration).
          return <circle key={`bonus-${callsToday}-${quota}`} {...arc} style={{ ...arc.style, animationDelay: '1s' }} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#f59e0b" strokeWidth={STROKE} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
        })()}
      </svg>
      <div className="quota-ring-label" role="img" aria-label={hasQuota ? `${callsToday} calls today against a target of ${quota}` : 'No quota set'}>
        {hasQuota ? <><strong style={{ fontSize: ratioFontSize(callsToday, quota) }}>{callsToday}<span className="quota-of">/{quota}</span></strong><em className="quota-unit">{callsToday > 1 ? 'Calls' : 'Call'}</em></> : <small>No quota</small>}
      </div>
    </div>
    <div className="quota-info">
      <p className="eyebrow">{todayLabel}</p>
      <h1>Daily call quota</h1>
      <p className={`quota-status ${reached ? 'is-reached' : ''}`}>{status}</p>
      {canSetQuota && <button type="button" className="subtle-button quota-set" onClick={() => { setError(''); setEditing(true) }}><Icon name="pencil" size={15} /> {hasQuota ? 'Change quota' : 'Set quota'}</button>}
    </div>
    {editing && <QuotaForm current={quota} busy={busy} error={error} onSubmit={save} onCancel={() => setEditing(false)} />}
  </div>
}
