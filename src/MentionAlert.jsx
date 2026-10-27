import { useEffect, useId, useRef } from 'react'
import './announcements.css'
import { Icon } from './PortalShell'
import NoteText from './NoteText'
import { useMentionAlerts } from './hooks/useMentionAlerts'

// Same card as the announcement pop-up, for a note that mentions you. @ALL notes are marked
// as important.
function MentionModal({ note, remaining, onClose }) {
  const buttonRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    buttonRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="announcement-alert-overlay" role="presentation" onClick={onClose}>
    <div className="announcement-alert-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <span className={`announcement-alert-icon ${note.mentionAll ? 'is-important' : ''}`}><Icon name="bell" size={26} /></span>
      <p className={`announcement-alert-kicker ${note.mentionAll ? 'is-important' : ''}`}>{note.mentionAll ? 'Important note' : 'You were mentioned'}</p>
      <h3 id={titleId}>{note.mentionAll ? `${note.authorName || 'A teammate'} has an important note for everyone` : `${note.authorName || 'A teammate'} mentioned you in a note`}</h3>
      <p className="announcement-alert-text"><NoteText note={note} /></p>
      {remaining > 0 && <p className="announcement-alert-more">+{remaining} more</p>}
      <button type="button" className="announcement-alert-button" ref={buttonRef} onClick={onClose}>{remaining > 0 ? 'Next' : 'Got it'}</button>
    </div>
  </div>
}

// Mounted once in each panel, so a mention reaches the person wherever they are in the portal.
export default function MentionAlert({ userId, userEmail, enabled = true }) {
  const { current, remaining, dismiss } = useMentionAlerts(userId, userEmail, enabled)
  if (!current) return null
  return <MentionModal key={current.id} note={current} remaining={remaining} onClose={dismiss} />
}
