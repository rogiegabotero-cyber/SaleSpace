import { useEffect, useId, useRef } from 'react'
import './announcements.css'
import { Icon } from './PortalShell'
import { useQuotaAlerts } from './hooks/useQuotaAlerts'

// The same card as the announcement pop-up, for a change to the daily call quota.
function QuotaModal({ change, onClose }) {
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

  const by = change.updatedByName || change.updatedBy
  const calls = (count) => `${count} call${count === 1 ? '' : 's'}`

  return <div className="announcement-alert-overlay" role="presentation" onClick={onClose}>
    <div className="announcement-alert-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <span className="announcement-alert-icon"><Icon name="trophy" size={26} /></span>
      <p className="announcement-alert-kicker">{change.previousValue > 0 ? 'Daily quota changed' : 'Daily quota set'}</p>
      <h3 id={titleId}>Your daily call quota is now {calls(change.value)}</h3>
      <p className="announcement-alert-author">{change.previousValue > 0 ? `It was ${calls(change.previousValue)}. ` : ''}{by ? `Set by ${by}.` : ''}</p>
      <p className="announcement-alert-text">{change.value > change.previousValue && change.previousValue > 0 ? "The target went up. Going beyond it is always welcome — it's a target, not a limit." : 'Your progress toward it shows in the donut on your workspace dashboard. Going beyond it is always welcome.'}</p>
      <button type="button" className="announcement-alert-button" ref={buttonRef} onClick={onClose}>Got it</button>
    </div>
  </div>
}

// Mounted once in each panel so the whole team — admins included — is told the moment the quota
// is changed. `enabled` is false for visitors, who have no call quota.
export default function QuotaAlert({ userId, enabled = true }) {
  const { change, dismiss } = useQuotaAlerts(userId, enabled)
  if (!change) return null
  return <QuotaModal key={change.updatedAt?.getTime()} change={change} onClose={dismiss} />
}
