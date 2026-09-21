import { Icon } from './PortalShell'
import './App.css'

export default function PanelSwitchBar({ links = [], darkMode = false }) {
  if (!links.length) return null
  return <div className={`panel-switch-bar ${darkMode ? 'dark-mode' : ''}`}>
    <span className="panel-switch-label">Switch view</span>
    <div className="panel-switch-links">
      {links.map(({ label, href, active }) => active
        ? <span key={href} className="panel-switch-link active">{label}</span>
        : <a key={href} className="panel-switch-link" href={href}>{label} <Icon name="arrow" size={13} /></a>)}
    </div>
  </div>
}
