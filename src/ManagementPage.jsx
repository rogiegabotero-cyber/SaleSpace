import { useEffect, useState } from 'react'
import './management.css'
import { Avatar, Icon } from './PortalShell'
import ConfirmModal from './ConfirmModal'
import { AnnouncementForm } from './Announcements'
import { QuotaForm } from './QuotaDonut'
import { timeAgo } from './utils/time'
import { createAnnouncement, deleteAnnouncement, subscribeToAnnouncements, updateAnnouncement } from './services/announcements'
import { deleteNote, setNotePinned, subscribeToNotes } from './services/notes'
import { setCallQuota, subscribeToCallQuota } from './services/quota'
import { setCallHandlers, subscribeToCallHandlers } from './services/callHandlers'

// Managerial tools for managers, admins and super admins: announcements, notes, the daily
// call quota and who is in charge of calls. The page is only offered to those
// roles (App.jsx), and Firestore's rules enforce it for the data.
const TABS = [['Announcements', 'bell'], ['Notes', 'file'], ['Quota', 'trophy'], ['Call team', 'phone']]
const CLOCK_MS = 30 * 1000
const PREVIEW = 110

const oneLine = (text, max = PREVIEW) => {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}
const formatDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const formatDateTime = (date) => `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
const permissionOr = (err, message) => (err.code === 'permission-denied' ? message : err.message)

// ---------- Announcements ----------
function AnnouncementsManager({ user, authorName }) {
  const [items, setItems] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [form, setForm] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeToAnnouncements(setItems, (err) => console.warn('[management] announcements:', err.message)), [])
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => clearInterval(interval)
  }, [])

  const rows = items.map((item) => {
    const expiresAt = item.expiresAt?.toDate?.() || null
    return { item, expiresAt, created: item.createdAt?.toDate?.() || null, expired: Boolean(expiresAt && expiresAt.getTime() <= now) }
  })
  const activeCount = rows.filter((row) => !row.expired).length

  async function save({ title, text, expiresAt }) {
    if (!text) return
    setBusy(true)
    setError('')
    try {
      if (form.item) await updateAnnouncement(form.item.id, { title, text, expiresAt })
      else await createAnnouncement({ authorUid: user.uid, authorName, title, text, expiresAt })
      setForm(null)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to do that."))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await deleteAnnouncement(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to do that."))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="mgmt-toolbar">
      <p>{activeCount} active · {rows.length} total <span>(expired ones stay here so they can be edited and brought back)</span></p>
      <button type="button" className="subtle-button" onClick={() => { setError(''); setForm({ item: null }) }}><Icon name="plus" size={16} /> Add announcement</button>
    </div>
    <div className="panel mgmt-table">
      <div className="mgmt-row mgmt-head mgmt-announcements"><span>Announcement</span><span>Posted</span><span>Expires</span><span>Status</span><span>Actions</span></div>
      {rows.length ? rows.map(({ item, expiresAt, created, expired }) => <div className="mgmt-row mgmt-announcements" key={item.id}>
        <span className="mgmt-main"><strong>{item.title || 'Untitled'}</strong><small>{oneLine(item.text)}</small></span>
        <span data-label="Posted">{item.authorName || '—'}{created && <small>{formatDate(created)}</small>}</span>
        <span data-label="Expires">{expiresAt ? formatDateTime(expiresAt) : 'Never'}</span>
        <span data-label="Status"><i className={`mgmt-chip ${expired ? 'is-expired' : 'is-active'}`}>{expired ? 'Expired' : 'Active'}</i></span>
        <span className="mgmt-actions">
          <button type="button" className="row-button" onClick={() => { setError(''); setForm({ item }) }}>Edit</button>
          <button type="button" className="row-button row-button-danger" onClick={() => { setError(''); setDeleteTarget(item) }}>Delete</button>
        </span>
      </div>) : <p className="empty-table">No announcements yet.</p>}
    </div>
    {form && <AnnouncementForm item={form.item} busy={busy} error={error} onSubmit={save} onCancel={() => setForm(null)} />}
    {deleteTarget && <ConfirmModal title="Delete announcement" message={`Delete "${deleteTarget.title || oneLine(deleteTarget.text, 40)}" for everyone?`} confirmLabel="Delete" busyLabel="Deleting..." busy={busy} error={error} onConfirm={remove} onCancel={() => setDeleteTarget(null)} />}
  </>
}

// ---------- Notes ----------
function NotesManager({ user }) {
  const [notes, setNotes] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeToNotes(setNotes, (err) => console.warn('[management] notes:', err.message)), [])

  async function togglePin(note) {
    try {
      await setNotePinned(note.id, !note.pinned, user.uid)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to do that."))
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await deleteNote(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to delete notes. Ask an admin to deploy the latest rules."))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="mgmt-toolbar"><p>{notes.length} recent note{notes.length === 1 ? '' : 's'} <span>(the newest 50 are listed)</span></p></div>
    {error && !deleteTarget && <div className="form-error mgmt-error">{error}</div>}
    <div className="panel mgmt-table">
      <div className="mgmt-row mgmt-head mgmt-notes"><span>Note</span><span>Author</span><span>Posted</span><span>Flags</span><span>Actions</span></div>
      {notes.length ? notes.map((note) => <div className="mgmt-row mgmt-notes" key={note.id}>
        <span className="mgmt-main"><strong>{oneLine(note.text, 140)}</strong></span>
        <span data-label="Author">{note.authorName || '—'}</span>
        <span data-label="Posted">{timeAgo(note.createdAt)}</span>
        <span data-label="Flags" className="mgmt-flags">
          {note.pinned && <i className="mgmt-chip is-pinned">Pinned</i>}
          {note.mentionAll && <i className="mgmt-chip is-important">@ALL</i>}
          {!note.mentionAll && note.mentions?.length > 0 && <i className="mgmt-chip is-active">{note.mentions.length} mention{note.mentions.length === 1 ? '' : 's'}</i>}
          {!note.pinned && !note.mentionAll && !(note.mentions?.length > 0) && '—'}
        </span>
        <span className="mgmt-actions">
          <button type="button" className="row-button" onClick={() => togglePin(note)}>{note.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" className="row-button row-button-danger" onClick={() => { setError(''); setDeleteTarget(note) }}>Delete</button>
        </span>
      </div>) : <p className="empty-table">No notes yet.</p>}
    </div>
    {deleteTarget && <ConfirmModal title="Delete note" message={`Delete ${deleteTarget.authorName ? `${deleteTarget.authorName}'s` : 'this'} note for everyone? "${oneLine(deleteTarget.text, 80)}"`} confirmLabel="Delete" busyLabel="Deleting..." busy={busy} error={error} onConfirm={remove} onCancel={() => setDeleteTarget(null)} />}
  </>
}

// ---------- Quota ----------
function QuotaManager({ user, displayName }) {
  const [quota, setQuota] = useState(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeToCallQuota(setQuota, (err) => console.warn('[management] quota:', err.message)), [])

  async function save(next) {
    setBusy(true)
    setError('')
    try {
      await setCallQuota(next, { previous: quota || 0, updatedBy: user.email || user.uid, updatedByName: displayName })
      setEditing(false)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to set the quota."))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <section className="panel mgmt-quota">
      <div>
        <p className="eyebrow">Daily call quota (target)</p>
        <p className="mgmt-quota-value">{quota === null ? '…' : quota > 0 ? <><strong>{quota}</strong> calls per employee, per day</> : 'Not set'}</p>
        <p className="mgmt-quota-note">It's a target, not a limit: employees can go beyond it as far as they like. Everyone sees their own progress as a donut on their workspace dashboard, and the ring starts a gold second lap once they pass it. One number for the whole team.</p>
      </div>
      <button type="button" className="admin-primary" onClick={() => { setError(''); setEditing(true) }}>{quota > 0 ? 'Change quota' : 'Set quota'}</button>
    </section>
    {editing && <QuotaForm current={quota} busy={busy} error={error} onSubmit={save} onCancel={() => setEditing(false)} />}
  </>
}

// ---------- Call team ----------
function CallTeamManager({ user, people }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  useEffect(() => subscribeToCallHandlers(setSaved, (err) => console.warn('[management] call team:', err.message)), [])

  // The draft is what is ticked; until something is changed it is what is saved.
  const selected = draft ?? new Set(saved || [])
  const changed = saved !== null && (selected.size !== saved.length || saved.some((id) => !selected.has(id)))

  function toggle(id) {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setDraft(next)
    setJustSaved(false)
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await setCallHandlers([...selected], user.email || user.uid)
      setDraft(null)
      setJustSaved(true)
    } catch (err) {
      setError(permissionOr(err, "You don't have permission to change the call team."))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="mgmt-toolbar">
      <p>{selected.size ? `${selected.size} of ${people.length} in charge of calls` : 'Nobody picked — every handler in the calls sheet is shown'} <span>(the call charts only show the people ticked here)</span></p>
      <div className="mgmt-actions">
        <button type="button" className="row-button" onClick={() => { setDraft(new Set(people.map((person) => String(person.id)))); setJustSaved(false) }}>Select all</button>
        <button type="button" className="row-button" onClick={() => { setDraft(new Set()); setJustSaved(false) }}>Clear</button>
        <button type="button" className="admin-primary" disabled={!changed || busy} onClick={save}>{busy ? 'Saving...' : justSaved ? 'Saved' : 'Save call team'}</button>
      </div>
    </div>
    {error && <div className="form-error mgmt-error">{error}</div>}
    <div className="panel mgmt-table">
      <div className="mgmt-row mgmt-head mgmt-callteam"><span>Employee</span><span>Role</span><span>In charge of calls</span></div>
      {people.length ? people.map((person) => {
        const id = String(person.id)
        return <label className="mgmt-row mgmt-callteam mgmt-pick" key={id}>
          <span className="mgmt-person">{person.profileImg ? <img className="avatar avatar-photo avatar-small" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} small />}<span className="mgmt-main"><strong>{person.name}</strong></span></span>
          <span data-label="Role">{person.role || '—'}</span>
          <span data-label="In charge of calls"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={`${person.name} is in charge of calls`} /></span>
        </label>
      }) : <p className="empty-table">No team members yet.</p>}
    </div>
    <p className="mgmt-hint">Anyone who isn't ticked is left out of the Calls per employee chart, the daily and weekly calls, the trend, the quota and the exports. Leave everyone unticked to show every handler in the sheet.</p>
  </>
}

export default function ManagementPage({ user, displayName, people }) {
  const [tab, setTab] = useState(TABS[0][0])

  return <div className="content management-page">
    <div className="dashboard-view-switch-wrap mgmt-tabs"><div className="dashboard-view-switch">{TABS.map(([label, icon]) => <button type="button" key={label} className={`dashboard-view-tab ${tab === label ? 'active' : ''}`} onClick={() => setTab(label)}><Icon name={icon} size={15} /> {label}</button>)}</div></div>
    {tab === 'Announcements' && <AnnouncementsManager user={user} authorName={displayName} />}
    {tab === 'Notes' && <NotesManager user={user} />}
    {tab === 'Quota' && <QuotaManager user={user} displayName={displayName} />}
    {tab === 'Call team' && <CallTeamManager user={user} people={people} />}
  </div>
}
