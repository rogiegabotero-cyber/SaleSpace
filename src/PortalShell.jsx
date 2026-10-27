import { useState } from 'react'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useAnnouncementNotifications } from './hooks/useAnnouncementNotifications'
import { useMentionNotifications } from './hooks/useMentionNotifications'
import { useQuotaNotifications } from './hooks/useQuotaNotifications'
import { goToFocus } from './utils/focusTarget'
import ConfirmSignOut from './ConfirmSignOut'
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  CircleCheck,
  EllipsisVertical,
  Clock,
  Eye,
  EyeOff,
  FileText,
  LayoutGrid,
  Menu,
  MessageSquare,
  Moon,
  PanelLeft,
  Pencil,
  Phone,
  PhoneCall,
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
import salesLogo from './assets/sales-logo-chrome.webp'

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
  'panel-left': PanelLeft,
  pencil: Pencil,
  x: X,
  clock: Clock,
  trophy: Trophy,
  table: Table,
  phone: Phone,
  'phone-call': PhoneCall,
  eye: Eye,
  'eye-off': EyeOff,
  pin: Pin,
  comment: MessageSquare,
  trash: Trash2,
  checkmark: Check,
  refresh: RefreshCw,
  more: EllipsisVertical,
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
  notifications: extraNotifications = [],
  userId,
  userEmail,
  onSignOut,
  collapsed: collapsedProp,
  onToggleCollapsed,
  darkMode: darkModeProp,
  onToggleDarkMode,
  children,
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [internalDarkMode, setInternalDarkMode] = useState(false)
  // Tablets and below always get the narrow icon rail (phones swap it for a bottom bar —
  // see responsive.css), so the wide sidebar and its toggle only exist on larger screens.
  const narrow = useMediaQuery('(max-width: 1024px)')
  const collapsed = (collapsedProp ?? internalCollapsed) || narrow
  const darkMode = darkModeProp ?? internalDarkMode
  const toggleCollapsed = onToggleCollapsed ?? (() => setInternalCollapsed((value) => !value))
  const toggleDarkMode = onToggleDarkMode ?? (() => setInternalDarkMode((value) => !value))
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  // The bell lists announcements and notes that mention you (or @ALL), newest first. Unread
  // ones stay highlighted, and the dot stays on the bell, until "Mark all as read" is pressed.
  const announcementNotes = useAnnouncementNotifications(userId)
  const mentionNotes = useMentionNotifications(userId, userEmail)
  const quotaNotes = useQuotaNotifications(userId)
  const unreadIds = [...announcementNotes.unreadIds, ...mentionNotes.unreadIds, ...quotaNotes.unreadIds]
  const unreadSet = new Set(unreadIds)
  const notifications = [
    ...[...announcementNotes.items, ...mentionNotes.items, ...quotaNotes.items].sort((a, b) => b.at - a.at).map((item) => ({ ...item, unread: unreadSet.has(item.id) })),
    ...extraNotifications,
  ]
  const hasUnread = unreadIds.length > 0 || extraNotifications.length > 0

  // Clicking an entry marks it read, closes the list, and takes you to the thing it is about
  // (from any page or panel), where it pulses so you can see which one it is.
  function openNotification(item) {
    if (item.kind === 'announcement') announcementNotes.markRead(item.id)
    else if (item.kind === 'note') mentionNotes.markRead(item.id)
    else if (item.kind === 'quota') quotaNotes.markRead(item.id)
    setNotificationsOpen(false)
    if (item.focus) goToFocus(item.focus)
  }

  function markAllNotificationsRead() {
    announcementNotes.markAllRead()
    mentionNotes.markAllRead()
    quotaNotes.markAllRead()
  }
  const [profile, setProfile] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const initials = initialsOf(userName)
  const userAvatar = userPhoto ? <img className="avatar avatar-photo avatar-small" src={userPhoto} alt="" /> : <Avatar initials={initials} color="green" small />
  const profileMenu = (extraClass = '') => profile && <div className={`popover profile-menu ${extraClass}`}><button type="button">My profile</button><button type="button">Account preferences</button><button type="button" className="sign-out" onClick={() => { setProfile(false); setConfirmingSignOut(true) }}>Sign out</button></div>

  return <div className={`portal ${collapsed ? 'sidebar-collapsed' : ''} ${darkMode ? 'dark-mode' : ''} ${hasPanelSwitch ? 'has-panel-switch' : ''}`}>
    <aside className={`sidebar ${profile ? 'menu-open' : ''}`}>
      <div className="brand">{collapsed ? <img className="brand-icon" src="/sales-icon.webp" alt="Salespace" /> : <img className="brand-logo" src={salesLogo} alt="Salespace" />}</div>
      <p className="nav-label">{rootLabel}</p>
      <nav>{navItems.map(([label, icon]) => <button type="button" className={`nav-item ${activePage === label ? 'active' : ''}`} key={label} onClick={() => onNavigate(label)}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      {manageItems.length > 0 && <>
        <p className="nav-label nav-label-space">Manage</p>
        {manageItems.map(([label, icon]) => <button type="button" className={`nav-item ${activePage === label ? 'active' : ''}`} key={label} onClick={() => onNavigate(label)}><Icon name={icon} /><span>{label}</span></button>)}
      </>}
      <div className="sidebar-bottom"><div className="user-card-wrap"><button type="button" className={`user-card ${profile ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={profile} onClick={() => setProfile(!profile)}>{userAvatar}<span className="user-card-info"><strong>{userName}</strong><small>{userRole}</small></span><Icon name="chevron" size={15} /></button>{profileMenu('sidebar-profile-menu')}</div>{!narrow && <button type="button" className="nav-item sidebar-toggle" onClick={toggleCollapsed} aria-label="Toggle sidebar" aria-pressed={collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Icon name="panel-left" /></button>}</div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>{rootLabel}</span><b>/</b><strong>{activePage}</strong></div><div className="topbar-actions"><button className="icon-button theme-toggle" type="button" onClick={toggleDarkMode} aria-label="Toggle dark mode"><Icon name={darkMode ? 'sun' : 'moon'} /></button><button className="icon-button notification-button" type="button" onClick={() => setNotificationsOpen(!notificationsOpen)} aria-label={hasUnread ? 'Notifications (unread)' : 'Notifications'} aria-expanded={notificationsOpen}>{hasUnread && <i />}<Icon name="bell" /></button><div className="user-card-wrap topbar-profile"><button className="icon-button topbar-profile-button" type="button" onClick={() => setProfile(!profile)} aria-label="Account menu">{userAvatar}</button>{profileMenu()}</div>{notificationsOpen && <div className="popover notifications"><div className="popover-heading"><strong>Notifications</strong>{unreadIds.length > 0 && <button type="button" onClick={markAllNotificationsRead}>Mark all as read</button>}</div>{notifications.length ? notifications.map((item, index) => item.focus
        ? <button type="button" key={item.id || index} className={`notification-item ${item.unread ? 'is-unread' : ''} ${item.important ? 'is-important' : ''}`} onClick={() => openNotification(item)}><b>{item.title}</b> {item.text}<small>{item.time}</small></button>
        : <p key={item.id || index} className={`${item.unread ? 'is-unread' : ''} ${item.important ? 'is-important' : ''}`}><b>{item.title}</b> {item.text}<small>{item.time}</small></p>) : <p>You are all caught up.</p>}</div>}</div></header>
      {children}
    </main>
    {confirmingSignOut && <ConfirmSignOut onSignOut={onSignOut} onCancel={() => setConfirmingSignOut(false)} />}
  </div>
}
