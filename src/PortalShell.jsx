import { useState } from 'react'
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  FileText,
  LayoutGrid,
  Menu,
  MessageSquare,
  Moon,
  Pencil,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  Table,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { initialsOf } from './utils/initials'
import salesLogo from './assets/sales-logo2.webp'
import salesLogoGlow from './assets/sales-logo2-glow.webp'

const ICONS = {
  grid: LayoutGrid,
  calendar: Calendar,
  check: CircleCheck,
  file: FileText,
  people: Users,
  settings: SettingsIcon,
  bell: Bell,
  moon: Moon,
  sun: Sun,
  chevron: ChevronDown,
  plus: Plus,
  arrow: ArrowRight,
  menu: Menu,
  pencil: Pencil,
  x: X,
  clock: Clock,
  trophy: Trophy,
  table: Table,
  phone: Phone,
  eye: Eye,
  'eye-off': EyeOff,
  pin: Pin,
  comment: MessageSquare,
  trash: Trash2,
  checkmark: Check,
  refresh: RefreshCw,
}

export function Icon({ name, size = 18 }) {
  const LucideIcon = ICONS[name]
  return <LucideIcon className="icon" size={size} strokeWidth={1.8} aria-hidden="true" />
}

export function Avatar({ initials, color, small = false, large = false }) {
  return <span className={`avatar avatar-${color} ${small ? 'avatar-small' : ''} ${large ? 'avatar-large' : ''}`}>{initials}</span>
}

export function PortalShell({
  rootLabel = 'Workspace',
  activePage,
  navItems,
  manageItems = [],
  hasPanelSwitch = false,
  onNavigate,
  userName,
  userRole,
  userPhoto,
  notifications = [],
  onSignOut,
  collapsed: collapsedProp,
  onToggleCollapsed,
  darkMode: darkModeProp,
  onToggleDarkMode,
  children,
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [internalDarkMode, setInternalDarkMode] = useState(false)
  const collapsed = collapsedProp ?? internalCollapsed
  const darkMode = darkModeProp ?? internalDarkMode
  const toggleCollapsed = onToggleCollapsed ?? (() => setInternalCollapsed((value) => !value))
  const toggleDarkMode = onToggleDarkMode ?? (() => setInternalDarkMode((value) => !value))
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profile, setProfile] = useState(false)
  const initials = initialsOf(userName)
  const userAvatar = userPhoto ? <img className="avatar avatar-photo avatar-small" src={userPhoto} alt="" /> : <Avatar initials={initials} color="green" small />

  return <div className={`portal ${collapsed ? 'sidebar-collapsed' : ''} ${darkMode ? 'dark-mode' : ''} ${hasPanelSwitch ? 'has-panel-switch' : ''}`}>
    <aside className={`sidebar ${profile ? 'menu-open' : ''}`}>
      <div className="brand">{collapsed ? <img className="brand-icon" src="/sales-icon.webp" alt="Salespace" /> : <img className="brand-logo" src={darkMode ? salesLogoGlow : salesLogo} alt="Salespace" />}</div>
      <p className="nav-label">{rootLabel}</p>
      <nav>{navItems.map(([label, icon]) => <button type="button" className={`nav-item ${activePage === label ? 'active' : ''}`} key={label} onClick={() => onNavigate(label)}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      {manageItems.length > 0 && <>
        <p className="nav-label nav-label-space">Manage</p>
        {manageItems.map(([label, icon]) => <button type="button" className={`nav-item ${activePage === label ? 'active' : ''}`} key={label} onClick={() => onNavigate(label)}><Icon name={icon} /><span>{label}</span></button>)}
      </>}
      <div className="sidebar-bottom"><div className="help-box"><span className="help-icon">?</span><span><strong>Need a hand?</strong><small>Visit our help center</small></span><Icon name="arrow" size={15} /></div><div className="user-card-wrap"><button type="button" className="user-card" onClick={() => setProfile(!profile)}>{userAvatar}<span className="user-card-info"><strong>{userName}</strong><small>{userRole}</small></span><Icon name="chevron" size={15} /></button>{profile && <div className="popover profile-menu sidebar-profile-menu"><button type="button">My profile</button><button type="button">Account preferences</button><button type="button" className="sign-out" onClick={onSignOut}>Sign out</button></div>}</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button" type="button" onClick={toggleCollapsed} aria-label="Toggle sidebar"><Icon name="menu" /></button><div className="breadcrumb"><span>{rootLabel}</span><b>/</b><strong>{activePage}</strong></div><div className="topbar-actions"><button className="icon-button theme-toggle" type="button" onClick={toggleDarkMode} aria-label="Toggle dark mode"><Icon name={darkMode ? 'sun' : 'moon'} /></button><button className="icon-button notification-button" type="button" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label="Notifications">{notifications.length > 0 && <i />}<Icon name="bell" /></button>{notificationsOpen && <div className="popover notifications"><div className="popover-heading"><strong>Notifications</strong></div>{notifications.length ? notifications.map((item, index) => <p key={index}><b>{item.title}</b> {item.text}<small>{item.time}</small></p>) : <p>You are all caught up.</p>}</div>}</div></header>
      {children}
    </main>
  </div>
}
