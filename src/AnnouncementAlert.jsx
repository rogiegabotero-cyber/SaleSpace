import { useEffect, useId, useRef } from 'react'
import './announcements.css'
import { Icon } from './PortalShell'
import { useAnnouncementAlerts } from './hooks/useAnnouncementAlerts'

function AlertModal({ announcement, remaining, onClose }) {
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

  const expiresAt = announcement.expiresAt?.toDate?.()

  return <div className="announcement-alert-overlay" role="presentation" onClick={onClose}>
    <div className="announcement-alert-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <span className="announcement-alert-icon"><Icon name="bell" size={26} /></span>
      <p className="announcement-alert-kicker">New announcement</p>
      <h3 id={titleId}>{announcement.title || `From ${announcement.authorName || 'your team'}`}</h3>
      {announcement.title && <p className="announcement-alert-author">Posted by {announcement.authorName || 'your team'}</p>}
      <p className="announcement-alert-text">{announcement.text}</p>
      {expiresAt && <p className="announcement-alert-expiry">Expires {expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, {expiresAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>}
      {remaining > 0 && <p className="announcement-alert-more">+{remaining} more</p>}
      <button type="button" className="announcement-alert-button" ref={buttonRef} onClick={onClose}>{remaining > 0 ? 'Next' : 'Got it'}</button>
    </div>
  </div>
}

// Mounted once in each panel so the whole team is told the moment an announcement is posted
// — the person who posted it included. `enabled` is false for visitors, who can't read them.
export default function AnnouncementAlert({ userId, enabled = true }) {
  const { current, remaining, dismiss } = useAnnouncementAlerts(userId, enabled)
  if (!current) return null
  // Keyed so each announcement in a queue gets a fresh card.
  return <AlertModal key={current.id} announcement={current} remaining={remaining} onClose={dismiss} />
}
