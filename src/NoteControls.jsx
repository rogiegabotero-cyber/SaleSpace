import { useEffect, useState } from 'react'
import { Avatar, Icon } from './PortalShell'
import ConfirmModal from './ConfirmModal'
import { useCommentEditor } from './hooks/useCommentEditor'
import { createComment, subscribeToComments } from './services/notes'
import { timeAgo } from './utils/time'

export function NoteAvatar({ note, small = false, large = false }) {
  return note.authorPhoto
    ? <img className={`avatar avatar-photo ${small ? 'avatar-small' : ''} ${large ? 'avatar-large' : ''}`} src={note.authorPhoto} alt="" />
    : <Avatar initials={note.authorInitials} color={note.authorColor} small={small} large={large} />
}

export function NoteMenu({ editor, showPin = false }) {
  if (!editor.isOwn && !showPin) return null
  return <div className="note-menu-wrap">
    <button type="button" className="more-button" aria-label="More options" onClick={() => editor.setMenuOpen((open) => !open)}>•••</button>
    {editor.menuOpen && <div className="note-menu">
      {showPin && <button type="button" onClick={editor.togglePinned} disabled={editor.pinning}>{editor.pinned ? 'Unpin' : 'Pin'}</button>}
      {editor.isOwn && <button type="button" onClick={editor.startEdit}>Edit</button>}
      {editor.isOwn && <button type="button" className="note-menu-danger" onClick={() => { editor.setMenuOpen(false); editor.setConfirmingDelete(true) }}>Delete</button>}
    </div>}
    {editor.confirmingDelete && <ConfirmModal title="Delete note" message="Delete this note? This can't be undone." confirmLabel="Delete" busy={editor.deleting} error={editor.deleteError} onConfirm={editor.confirmDelete} onCancel={() => { editor.setConfirmingDelete(false); editor.setDeleteError('') }} />}
  </div>
}

export function NotePinButton({ editor }) {
  return <button type="button" className={`note-icon-button note-pin-button ${editor.pinned ? 'active' : ''}`} aria-label={editor.pinned ? 'Unpin note' : 'Pin note'} onClick={editor.togglePinned} disabled={editor.pinning}>
    <Icon name="pin" size={13} />
  </button>
}

export function NoteEditForm({ editor }) {
  return <div className="note-edit">
    <input value={editor.editText} onChange={(event) => editor.setEditText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') editor.saveEdit(); if (event.key === 'Escape') editor.setEditing(false) }} autoFocus />
    <div className="note-edit-actions">
      <button type="button" aria-label="Save" onClick={editor.saveEdit} disabled={!editor.editText.trim() || editor.saving}><Icon name="checkmark" size={11} /></button>
      <button type="button" aria-label="Cancel" onClick={() => editor.setEditing(false)} disabled={editor.saving}><Icon name="x" size={11} /></button>
    </div>
  </div>
}

function CommentItem({ noteId, comment, currentUser }) {
  const editor = useCommentEditor(noteId, comment, currentUser.uid)
  return <div className="note-comment">
    {comment.authorPhoto ? <img className="avatar avatar-photo avatar-small" src={comment.authorPhoto} alt="" /> : <Avatar initials={comment.authorInitials} color={comment.authorColor} small />}
    <div className="note-comment-body">
      <div className="note-comment-meta">
        <strong>{comment.authorName}</strong><span>{timeAgo(comment.createdAt)}</span>{comment.editedAt && <span className="note-edited-tag">· edited</span>}
      </div>
      {editor.editing ? <NoteEditForm editor={editor} /> : <p>{comment.text}</p>}
      {editor.isOwn && !editor.editing && <div className="note-comment-actions">
        <button type="button" aria-label="Edit comment" onClick={editor.startEdit}><Icon name="pencil" size={12} /></button>
        <button type="button" aria-label="Delete comment" onClick={() => editor.setConfirmingDelete(true)}><Icon name="trash" size={12} /></button>
      </div>}
    </div>
    {editor.confirmingDelete && <ConfirmModal title="Delete comment" message="Delete this comment? This can't be undone." confirmLabel="Delete" busy={editor.deleting} error={editor.deleteError} onConfirm={editor.confirmDelete} onCancel={() => { editor.setConfirmingDelete(false); editor.setDeleteError('') }} />}
  </div>
}

export function NoteComments({ noteId, currentUser, trailing }) {
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState(null)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => subscribeToComments(noteId, setComments, (err) => console.error('subscribeToComments failed', err)), [noteId])

  async function postComment() {
    const trimmed = text.trim()
    if (!trimmed || posting) return
    setPosting(true)
    try {
      await createComment(noteId, {
        authorUid: currentUser.uid,
        authorName: currentUser.name,
        authorInitials: currentUser.initials,
        authorColor: currentUser.color,
        authorPhoto: currentUser.photoUrl,
        text: trimmed,
      })
      setText('')
    } catch (err) {
      console.error('createComment failed', err)
    } finally {
      setPosting(false)
    }
  }

  return <div className="note-comments">
    <div className="note-toolbar">
      <button type="button" className="note-icon-button" aria-label={open ? 'Hide comments' : 'Show comments'} onClick={() => setOpen((value) => !value)}>
        <Icon name="comment" size={13} />{comments?.length ? ` ${comments.length}` : ''}
      </button>
      {trailing}
    </div>
    {open && <div className="note-comments-panel">
      <div className="note-comments-list">
        {comments === null
          ? <p className="note-comments-empty">Loading...</p>
          : comments.length
            ? comments.map((comment) => <CommentItem key={comment.id} noteId={noteId} comment={comment} currentUser={currentUser} />)
            : <p className="note-comments-empty">No comments yet.</p>}
      </div>
      <div className="note-comment-composer">
        {currentUser.photoUrl ? <img className="avatar avatar-photo avatar-small" src={currentUser.photoUrl} alt="" /> : <Avatar initials={currentUser.initials} color={currentUser.color} small />}
        <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && postComment()} placeholder="Write a comment..." />
        <button type="button" onClick={postComment} disabled={!text.trim() || posting}>Post</button>
      </div>
    </div>}
  </div>
}
