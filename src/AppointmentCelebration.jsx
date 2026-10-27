import { useEffect, useId, useRef } from 'react'
import './celebration.css'
import { Icon } from './PortalShell'
import { initialsOf } from './utils/initials'
import { launchConfetti } from './utils/confetti'
import { matchEmployeeByName } from './utils/matchEmployee'
import { useClosedAppointmentAlerts } from './hooks/useClosedAppointmentAlerts'

const AVATAR_COLORS = ['coral', 'blue', 'purple', 'green']

function colorFor(seed) {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function CelebrationModal({ appointment, people, remaining, onClose }) {
  const canvasRef = useRef(null)
  const buttonRef = useRef(null)
  const titleId = useId()
  const match = matchEmployeeByName(appointment.handler, people)
  const name = match?.name || appointment.handler || 'A teammate'

  // Confetti, unless the person has asked their device for reduced motion.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !canvasRef.current) return undefined
    return launchConfetti(canvasRef.current)
  }, [])

  useEffect(() => {
    buttonRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const details = [
    ['Location', appointment.location],
    ['Point of contact', [appointment.pocName, appointment.pocPosition].filter(Boolean).join(' · ')],
    ['Appointment', appointment.appointment],
  ].filter(([, value]) => value)

  return <div className="celebration-overlay" role="presentation" onClick={onClose}>
    <div className="celebration-card" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
      <div className="celebration-photo">
        {match?.profileImg ? <img className="celebration-photo-img" src={match.profileImg} alt="" /> : <span className={`celebration-photo-img celebration-photo-initials avatar-${match?.color || colorFor(appointment.handler || appointment.practice)}`}>{initialsOf(name)}</span>}
        <span className="celebration-badge"><Icon name="trophy" size={15} /></span>
      </div>
      <p className="celebration-kicker">Appointment closed</p>
      <h3 id={titleId}>{name} just closed an appointment!</h3>
      <p className="celebration-practice">{appointment.practice}</p>
      {details.length > 0 && <dl className="celebration-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {remaining > 0 && <p className="celebration-more">+{remaining} more to celebrate</p>}
      <button type="button" className="celebration-button" ref={buttonRef} onClick={onClose}>{remaining > 0 ? 'Next' : 'Awesome!'}</button>
    </div>
    {/* Last, so the pieces fall in front of the card; it never takes clicks. */}
    <canvas className="celebration-confetti" ref={canvasRef} aria-hidden="true" />
  </div>
}

// Mounted once in each panel (employee, admin, client) so the whole team sees it: pops up
// over whatever they are doing whenever someone closes an appointment.
export default function AppointmentCelebration({ userId, people = [] }) {
  const { current, remaining, dismiss } = useClosedAppointmentAlerts(userId)
  if (!current) return null
  // Keyed so each appointment in a queue gets a fresh card and a fresh burst of confetti.
  return <CelebrationModal key={`${current.tab}-${current.order}-${current.practice}`} appointment={current} people={people} remaining={remaining} onClose={dismiss} />
}
