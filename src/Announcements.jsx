import { useEffect, useId, useRef, useState } from 'react'
import './announcements.css'
import { Icon } from './PortalShell'
import ConfirmModal from './ConfirmModal'
import { createAnnouncement, deleteAnnouncement, subscribeToAnnouncements, updateAnnouncement } from './services/announcements'

// Announcements are compact rows (title and the start of the message), newest first. The list
// shows two and a half before the rest are reached by scrolling; opening a row shows it in full.
const VISIBLE_ROWS = 2.5
const TITLE_MAX = 120
const TEXT_MAX = 2000
// How often expiry is re-checked while the page is open.
const EXPIRY_CHECK_MS = 30 * 1000

function formatDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(date) {
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

const pad = (value) => String(value).padStart(2, '0')

// The value format <input type="datetime-local"> uses (local time, no timezone).
function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function endOfToday() {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date
}

const EXPIRY_OPTIONS = [
  ['today', 'Today only'],
  ['date', 'Until a date and time'],
  ['never', 'No expiration'],
]

// Add and edit share this form. A new announcement lasts for today by default; editing starts
// from whatever expiry it already has.
export function AnnouncementForm({ item, busy, error, onSubmit, onCancel }) {
  const existingExpiry = item?.expiresAt?.toDate?.() || null
  const [title, setTitle] = useState(item?.title || '')
  const [text, setText] = useState(item?.text || '')
  const [mode, setMode] = useState(item ? (existingExpiry ? 'date' : 'never') : 'today')
  // Lazy initialisers: the clock is read once when the form opens, not on every render.
  const [when, setWhen] = useState(() => toLocalInputValue(existingExpiry || new Date(Date.now() + 24 * 60 * 60 * 1000)))
  const [earliest] = useState(() => toLocalInputValue(new Date()))
  const [localError, setLocalError] = useState('')

  function submit(event) {
    event.preventDefault()
    let expiresAt = null
    if (mode === 'today') expiresAt = endOfToday()
    else if (mode === 'date') {
      expiresAt = new Date(when)
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        setLocalError('Pick a date and time in the future.')
        return
      }
    }
    setLocalError('')
    onSubmit({ title: title.trim(), text: text.trim(), expiresAt })
  }

  return <div className="modal-overlay" role="presentation" onClick={busy ? undefined : onCancel}>
    <form className="modal-card announcement-modal" role="dialog" aria-modal="true" aria-label={item ? 'Edit announcement' : 'Add announcement'} onClick={(event) => event.stopPropagation()} onSubmit={submit}>
      <h3>{item ? 'Edit announcement' : 'Add announcement'}</h3>
      <label>Title <small>(optional)</small><input value={title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} placeholder="What's this about?" autoFocus /></label>
      <label>Message<textarea value={text} maxLength={TEXT_MAX} rows={5} onChange={(event) => setText(event.target.value)} placeholder="Share an update with the whole team..." required /></label>
      <p className="announcement-modal-count">{text.length}/{TEXT_MAX}</p>
      <fieldset className="announcement-expiry">
        <legend>Show it</legend>
        {EXPIRY_OPTIONS.map(([value, label]) => <label className="announcement-expiry-option" key={value}><input type="radio" name="announcement-expiry" value={value} checked={mode === value} onChange={() => { setMode(value); setLocalError('') }} />{label}</label>)}
        {mode === 'date' && <input className="announcement-expiry-when" type="datetime-local" value={when} min={earliest} onChange={(event) => setWhen(event.target.value)} required aria-label="Expires at" />}
        {mode === 'today' && <p className="announcement-expiry-note">It disappears at the end of today.</p>}
        {mode === 'never' && <p className="announcement-expiry-note">It stays until someone removes it.</p>}
      </fieldset>
      {(localError || error) && <div className="form-error">{localError || error}</div>}
      <div className="modal-actions"><button type="button" className="admin-link" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className="admin-primary" disabled={busy || !text.trim()}>{busy ? 'Saving...' : item ? 'Save changes' : 'Post announcement'}</button></div>
    </form>
  </div>
}

// A row shows one line of the message: newlines and runs of spaces collapsed.
const previewOf = (text) => text.replace(/\s+/g, ' ').trim()

// The whole announcement, opened by clicking its row.
function AnnouncementView({ item, canManage, onClose, onEdit, onDelete }) {
  const closeRef = useRef(null)
  const titleId = useId()
  const created = item.createdAt?.toDate?.()
  const expiresAt = item.expiresAt?.toDate?.()

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="modal-overlay" role="presentation" onClick={onClose}>
    <div className="modal-card announcement-view" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <div className="announcement-view-head">
        <span className="announcement-icon"><Icon name="bell" size={16} /></span>
        <div className="announcement-view-heading">
          <p className="eyebrow">{item.authorName || 'Announcement'}{created && ` · ${formatDate(created)}`}{item.editedAt && ' · edited'}</p>
          <h3 id={titleId}>{item.title || `Announcement from ${item.authorName || 'your team'}`}</h3>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <p className="announcement-view-text">{item.text}</p>
      {expiresAt && <p className="announcement-expiry-label">Expires {formatDateTime(expiresAt)}</p>}
      <div className="modal-actions">
        {canManage && <><button type="button" className="admin-link" onClick={onEdit}>Edit</button><button type="button" className="admin-link announcement-view-delete" onClick={onDelete}>Delete</button></>}
        <button type="button" className="admin-primary" ref={closeRef} onClick={onClose}>Close</button>
      </div>
    </div>
  </div>
}

// The announcement banner at the top of the workspace. Everyone in the workspace reads it;
// managers and admins (`canPost`) get the Add announcement button and can edit or remove any. Each has an optional expiry, after which it drops off.
export default function Announcements({ user, authorName, canPost }) {
  const [items, setItems] = useState([])
  const [now, setNow] = useState(() => Date.now())
  // null: closed; { item: null }: adding; { item }: editing that announcement.
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  // The announcement open in full, if any.
  const [viewing, setViewing] = useState(null)
  const listRef = useRef(null)
  // Height of "two and a half rows" (null while there are no more rows than fit, so the list
  // just sizes to its content) and whether the list has been scrolled to its end.
  const [listMaxHeight, setListMaxHeight] = useState(null)
  const [scrolledToEnd, setScrolledToEnd] = useState(false)

  useEffect(() => subscribeToAnnouncements(setItems, (err) => console.error('subscribeToAnnouncements failed', err)), [])

  // An expiry can pass while the page is open, so the clock keeps ticking.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), EXPIRY_CHECK_MS)
    return () => clearInterval(interval)
  }, [])

  const active = items.filter((item) => {
    const expiresAt = item.expiresAt?.toDate?.()
    return !expiresAt || expiresAt.getTime() > now
  })

  // Rows can differ in height, so the cap is measured from the real ones: the first two
  // whole, plus half of the third as the hint that there is more.
  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const rows = [...list.querySelectorAll(':scope > .announcement-row')]
    const whole = Math.floor(VISIBLE_ROWS)
    function measure() {
      if (rows.length <= whole) { setListMaxHeight(null); return }
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0
      const shown = rows.slice(0, whole).reduce((sum, row) => sum + row.offsetHeight + gap, 0)
      setListMaxHeight(shown + rows[whole].offsetHeight * (VISIBLE_ROWS - whole))
      setScrolledToEnd(false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    rows.slice(0, whole + 1).forEach((row) => observer.observe(row))
    return () => observer.disconnect()
  }, [active.length])

  async function save({ title, text, expiresAt }) {
    if (!text) return
    setBusy(true)
    setError('')
    try {
      if (form.item) await updateAnnouncement(form.item.id, { title, text, expiresAt })
      else await createAnnouncement({ authorUid: user.uid, authorName, title, text, expiresAt })
      setForm(null)
    } catch (err) {
      setError(err.code === 'permission-denied' ? "You don't have permission to do that." : err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!deleteTarget) return
    setBusy(true)
    setError('')
    try {
      await deleteAnnouncement(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setError(err.code === 'permission-denied' ? "You don't have permission to do that." : err.message)
    } finally {
      setBusy(false)
    }
  }

  // With nothing to show the button sits in the middle of the empty banner; once there are
  // announcements it moves to a bar above them.
  const addButton = <button type="button" className="subtle-button announcement-add" onClick={() => { setError(''); setForm({ item: null }) }}><Icon name="plus" size={16} /> Add announcement</button>

  return <div className="announcements">
    <div className="announcements-head"><h2 className="announcements-title">Announcements{active.length > 0 && <span className="calls-scope-badge">{active.length}</span>}</h2>{canPost && active.length > 0 && addButton}</div>
    {active.length ? <div className={`announcements-list ${listMaxHeight && !scrolledToEnd ? 'has-more' : ''}`} ref={listRef} style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined} onScroll={(event) => { const el = event.currentTarget; setScrolledToEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2) }}>{active.map((item) => {
      const created = item.createdAt?.toDate?.()
      const canManage = canPost
      return <div className="announcement announcement-row" key={item.id} data-focus-id={`announcement:${item.id}`}>
        <button type="button" className="announcement-row-main" title="Read the full announcement" onClick={() => setViewing(item)}>
          <span className="announcement-icon"><Icon name="bell" size={16} /></span>
          <span className="announcement-row-text"><strong>{item.title || `From ${item.authorName || 'your team'}`}</strong><span className="announcement-row-preview">{previewOf(item.text)}</span></span>
          {created && <span className="announcement-row-date">{formatDate(created)}</span>}
        </button>
        {canManage && <div className="announcement-actions">
          <button type="button" className="icon-button" aria-label="Edit announcement" title="Edit" onClick={() => { setError(''); setForm({ item }) }}><Icon name="pencil" size={15} /></button>
          <button type="button" className="icon-button announcement-delete" aria-label="Delete announcement" title="Delete" onClick={() => { setError(''); setDeleteTarget(item) }}><Icon name="trash" size={15} /></button>
        </div>}
      </div>
    })}</div> : <section className="announcement announcement-empty"><div className="announcement-empty-inner"><p className="empty-table">No announcements right now.</p>{canPost && addButton}</div></section>}
    {viewing && <AnnouncementView item={viewing} canManage={canPost} onClose={() => setViewing(null)} onEdit={() => { setError(''); setForm({ item: viewing }); setViewing(null) }} onDelete={() => { setError(''); setDeleteTarget(viewing); setViewing(null) }} />}
    {form && <AnnouncementForm item={form.item} busy={busy} error={error} onSubmit={save} onCancel={() => setForm(null)} />}
    {deleteTarget && <ConfirmModal title="Delete announcement" message="This removes the announcement for everyone." confirmLabel="Delete" busyLabel="Deleting..." busy={busy} error={error} onConfirm={remove} onCancel={() => setDeleteTarget(null)} />}
  </div>
}
