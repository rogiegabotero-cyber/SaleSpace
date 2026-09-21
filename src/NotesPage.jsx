import { useEffect, useMemo, useState } from 'react'
import { Avatar, Icon } from './PortalShell'
import { NoteAvatar, NoteComments, NoteEditForm, NoteMenu, NotePinButton } from './NoteControls'
import { useNoteEditor } from './hooks/useNoteEditor'
import { createNote, subscribeToNotes } from './services/notes'
import { timeAgo } from './utils/time'

const VIEW_MODES = [['Whiteboard', 'grid'], ['Timeline', 'clock'], ['Table', 'table']]
const AVATAR_COLORS = ['coral', 'blue', 'purple', 'green']

function colorFor(seed) {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function formatDateTime(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : null
  if (!date) return 'Just now'
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function sortPinnedFirst(notes) {
  return [...notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
}

export function TimelineNote({ note, currentUser }) {
  const editor = useNoteEditor(note, currentUser.uid)
  return <article className="note">
    <NoteAvatar note={note} />
    <div className="note-body">
      <div className="note-meta"><strong>{note.authorName}</strong><span>{timeAgo(note.createdAt)}</span>{note.editedAt && <span className="note-edited-tag">· edited</span>}</div>
      {editor.editing ? <NoteEditForm editor={editor} /> : <p>{note.text}</p>}
      <NoteComments noteId={note.id} currentUser={currentUser} trailing={<NotePinButton editor={editor} />} />
    </div>
    <NoteMenu editor={editor} />
  </article>
}

function WhiteboardNote({ note, currentUser }) {
  const editor = useNoteEditor(note, currentUser.uid)
  return <article className={`sticky-note sticky-${note.authorColor || 'blue'}`}>
    <div className="sticky-note-header">
      <NoteAvatar note={note} small />
      <div className="sticky-note-header-info"><strong>{note.authorName}</strong><span>{timeAgo(note.createdAt)}{note.editedAt ? ' · edited' : ''}</span></div>
      <NoteMenu editor={editor} />
    </div>
    {editor.editing ? <NoteEditForm editor={editor} /> : <p className="sticky-note-text">{note.text}</p>}
    <NoteComments noteId={note.id} currentUser={currentUser} trailing={<NotePinButton editor={editor} />} />
  </article>
}

function TableNoteRow({ note, currentUser }) {
  const editor = useNoteEditor(note, currentUser.uid)
  return <tr>
    <td><div className="table-note-author"><NoteAvatar note={note} small /><span>{note.authorName}</span></div></td>
    <td className="table-note-text">{editor.editing ? <NoteEditForm editor={editor} /> : <span>{note.text}{note.editedAt && <em className="note-edited-tag"> (edited)</em>}</span>}</td>
    <td className="table-note-date">{formatDateTime(note.createdAt)}</td>
    <td className="table-note-actions">
      <div className="table-note-actions-row">
        <NoteComments noteId={note.id} currentUser={currentUser} />
        <NoteMenu editor={editor} showPin />
      </div>
    </td>
  </tr>
}

export default function NotesPage({ user, displayName, displayInitials, photoUrl }) {
  const [mode, setMode] = useState('Whiteboard')
  const [notes, setNotes] = useState([])
  const [note, setNote] = useState('')
  const [postingNote, setPostingNote] = useState(false)

  useEffect(() => subscribeToNotes(setNotes, (err) => console.error('subscribeToNotes failed', err)), [])

  const currentUser = useMemo(() => ({
    uid: user.uid,
    name: displayName,
    initials: displayInitials,
    color: colorFor(user.uid),
    photoUrl: photoUrl || null,
  }), [user.uid, displayName, displayInitials, photoUrl])

  const sortedNotes = useMemo(() => sortPinnedFirst(notes), [notes])

  async function postNote() {
    const trimmed = note.trim()
    if (!trimmed || postingNote) return
    setPostingNote(true)
    try {
      await createNote({
        authorUid: currentUser.uid,
        authorName: currentUser.name,
        authorInitials: currentUser.initials,
        authorColor: currentUser.color,
        authorPhoto: currentUser.photoUrl,
        text: trimmed,
      })
      setNote('')
    } catch (err) {
      console.error('createNote failed', err)
    } finally {
      setPostingNote(false)
    }
  }

  return <div className="content notes-page">
    <div className="page-heading">
      <div><p className="eyebrow">Team feed</p><h1>Notes</h1><p className="heading-copy">Shared updates from everyone in your workspace.</p></div>
      <div className="dashboard-view-switch">{VIEW_MODES.map(([label, icon]) => <button type="button" key={label} className={`dashboard-view-tab ${mode === label ? 'active' : ''}`} onClick={() => setMode(label)}><Icon name={icon} size={15} /> {label}</button>)}</div>
    </div>
    <div className="note-composer notes-page-composer">
      {photoUrl ? <img className="avatar avatar-photo avatar-small" src={photoUrl} alt="" /> : <Avatar initials={displayInitials} color={currentUser.color} small />}
      <input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && postNote()} placeholder="Share an update with the team..." />
      <button type="button" onClick={postNote} disabled={!note.trim() || postingNote}>Post</button>
    </div>
    {sortedNotes.length ? <>
      {mode === 'Whiteboard' && <div className="notes-board">{sortedNotes.map((item) => <WhiteboardNote key={item.id} note={item} currentUser={currentUser} />)}</div>}
      {mode === 'Timeline' && <div className="panel notes-timeline"><div className="note-list">{sortedNotes.map((item) => <TimelineNote key={item.id} note={item} currentUser={currentUser} />)}</div></div>}
      {mode === 'Table' && <div className="panel notes-table-wrap"><table className="notes-table"><thead><tr><th>Author</th><th>Note</th><th>Posted</th><th>Action</th></tr></thead><tbody>{sortedNotes.map((item) => <TableNoteRow key={item.id} note={item} currentUser={currentUser} />)}</tbody></table></div>}
    </> : <p className="empty-table">No notes yet. Share the first update with your team.</p>}
  </div>
}
