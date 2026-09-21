import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import './App.css'
import './admin.css'
import { useTeamPresence } from './hooks/useTeamPresence'
import { useAuthGate } from './hooks/useAuthGate'
import { Avatar, Icon, PortalShell } from './PortalShell'
import { initialsOf } from './utils/initials'
import { auth } from './firebase'
import { subscribeToPreferences, updatePreferences } from './services/preferences'
import { createNote, subscribeToNotes } from './services/notes'
import { roleLabel } from './roles'
import ChangePasswordForm from './ChangePasswordForm'
import LoadingOverlay from './LoadingOverlay'
import PageLoading from './PageLoading'
import PanelSwitchBar from './PanelSwitchBar'
import SettingsPage from './SettingsPage'
import NotesPage, { TimelineNote } from './NotesPage'
import AdminPage from './AdminPage'
import ClientView, { AttendanceLogPage, ClientDashboard } from './ClientView'
import LoginPage from './LoginPage'
import VisitorLoginPage from './VisitorLoginPage'

const navItems = [['Dashboard', 'grid'], ['Tasks', 'check'], ['Notes', 'file']]
const manageItems = [['Settings', 'settings']]
const AVATAR_COLORS = ['coral', 'blue', 'purple', 'green']

function colorFor(seed) {
  let hash = 0
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function Dashboard() {
  const { people, loading: teamLoading, error: teamError } = useTeamPresence(
    import.meta.env.VITE_HYACINTH_DEPARTMENT_ID,
  )
  const onlineCount = people.filter((person) => person.online).length
  const { user, authChecked, mustChangePassword, setMustChangePassword, profile } = useAuthGate()
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [savingDarkMode, setSavingDarkMode] = useState(false)
  const [activePage, setActivePage] = useState('Dashboard')
  const [dashboardView, setDashboardView] = useState('Workspace')
  const [note, setNote] = useState('')
  const [notes, setNotes] = useState([])
  const [postingNote, setPostingNote] = useState(false)
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (!user || mustChangePassword !== false) return undefined
    return subscribeToPreferences(user.uid, (prefs) => {
      setCollapsed(Boolean(prefs.sidebarCollapsed))
      setDarkMode(Boolean(prefs.darkMode))
    })
  }, [user, mustChangePassword])

  useEffect(() => {
    if (!user || mustChangePassword !== false) return undefined
    return subscribeToNotes(setNotes, (err) => console.error('subscribeToNotes failed', err))
  }, [user, mustChangePassword])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    updatePreferences(user.uid, { sidebarCollapsed: next })
  }

  async function toggleDarkMode() {
    const next = !darkMode
    setDarkMode(next)
    setSavingDarkMode(true)
    try {
      await updatePreferences(user.uid, { darkMode: next })
    } finally {
      setSavingDarkMode(false)
    }
  }

  const displayName = profile?.name || user?.email?.split('@')[0] || ''
  const displayRole = profile?.role ? roleLabel(profile.role) : 'Team member'
  const displayInitials = initialsOf(displayName)
  const canSwitchPanels = profile?.role === 'admin' || profile?.role === 'super_admin'
  const panelLinks = canSwitchPanels ? [
    { label: 'Admin panel', href: '/admin', active: false },
    { label: 'Client panel', href: '/client', active: false },
    { label: 'Employee panel', href: '/', active: true },
  ] : []

  const currentUser = useMemo(() => (user ? {
    uid: user.uid,
    name: displayName,
    initials: displayInitials,
    color: colorFor(user.uid),
    photoUrl: profile?.photoUrl || null,
  } : null), [user, displayName, displayInitials, profile?.photoUrl])

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [notes])

  const postNote = async () => {
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

  if (!authChecked) return null
  if (!user) {
    window.location.assign('/login')
    return null
  }
  if (mustChangePassword === null) return <PageLoading text="Loading your account..." />
  if (mustChangePassword) return <ChangePasswordForm onDone={() => setMustChangePassword(false)} />
  if (profile === undefined) return <PageLoading text="Loading your account..." />

  return <>
    {savingDarkMode && <LoadingOverlay />}
    <PanelSwitchBar links={panelLinks} darkMode={darkMode} />
    <PortalShell activePage={activePage} navItems={navItems} manageItems={manageItems} hasPanelSwitch={panelLinks.length > 0} onNavigate={setActivePage} userName={displayName} userRole={displayRole} userPhoto={profile?.photoUrl} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onSignOut={() => signOut(auth).then(() => window.location.assign('/login'))}>
    {activePage === 'Dashboard' ? <>
      <div className="dashboard-view-switch-wrap"><div className="dashboard-view-switch"><button type="button" className={`dashboard-view-tab ${dashboardView === 'Workspace' ? 'active' : ''}`} onClick={() => setDashboardView('Workspace')}><Icon name="grid" size={15} /> Workspace</button><button type="button" className={`dashboard-view-tab ${dashboardView === 'Overview' ? 'active' : ''}`} onClick={() => setDashboardView('Overview')}><Icon name="table" size={15} /> Work Overview</button><button type="button" className={`dashboard-view-tab ${dashboardView === 'Attendance Log' ? 'active' : ''}`} onClick={() => setDashboardView('Attendance Log')}><Icon name="clock" size={15} /> Attendance Log</button></div></div>
      {dashboardView === 'Workspace' ? <div className="content"><div className="page-heading"><div><p className="eyebrow">{todayLabel}</p><h1>Good morning, {displayName.split(' ')[0]} <span>✦</span></h1><p className="heading-copy">Here is what is happening across your workspace today.</p></div><button type="button" className="primary-button" onClick={() => setActivePage('Tasks')}><Icon name="plus" size={17} /> New task</button></div>
      <section className="announcement announcement-empty"><p className="empty-table">No announcements right now.</p></section>
      <div className="dashboard-grid"><section className="panel notes-panel"><div className="panel-heading"><div><h2>Overall notes</h2><p>Shared with everyone in your workspace</p></div><button type="button" className="subtle-button" onClick={() => document.querySelector('.note-composer input')?.focus()}><Icon name="plus" size={16} /> Add note</button></div><div className="note-composer">{profile?.photoUrl ? <img className="avatar avatar-photo avatar-small" src={profile.photoUrl} alt="" /> : <Avatar initials={displayInitials} color={colorFor(user.uid)} small />}<input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && postNote()} placeholder="Share an update with the team..." /><button type="button" onClick={postNote} disabled={!note.trim() || postingNote}>Post</button></div><div className="note-list">{sortedNotes.length ? sortedNotes.map((item) => <TimelineNote key={item.id} note={item} currentUser={currentUser} />) : <p className="empty-table">No notes yet. Share the first update with your team.</p>}</div></section>
        <section className="panel team-panel"><div className="panel-heading"><div><h2>Team status</h2><p>{people.length} people in your workspace</p></div><button type="button" className="more-button" aria-label="More options">•••</button></div><div className="status-summary"><div><span className="status-dot online" /><strong>{onlineCount}</strong><small>Online</small></div><div><span className="status-dot away" /><strong>{people.length - onlineCount}</strong><small>Away today</small></div></div><div className="team-list">{teamLoading ? <p className="team-status-message">Loading team status...</p> : teamError ? <p className="team-status-message team-status-error">Couldn't load team status: {teamError}</p> : people.length ? people.map((person) => <div className="team-member" key={person.id}><div className="avatar-wrap">{person.profileImg ? <img className="avatar avatar-photo" src={person.profileImg} alt="" /> : <Avatar initials={person.initials} color={person.color} />}<span className={`presence ${person.online ? 'is-online' : ''}`} /></div><div><strong>{person.name}</strong><small>{person.role}</small></div><span className={person.online ? 'member-status online-text' : 'member-status'}>{person.online ? 'Online' : 'Away'}</span></div>) : <p className="team-status-message">No team members synced yet.</p>}</div><button type="button" className="view-all" onClick={() => setActivePage('Settings')}>View team settings <Icon name="arrow" size={15} /></button></section></div>
      <section className="panel focus-panel"><div className="panel-heading"><div><h2>Your focus</h2><p>Keep an eye on your priorities for today</p></div><button type="button" className="text-button" onClick={() => setActivePage('Tasks')}>View all tasks <Icon name="arrow" size={15} /></button></div><div className="focus-items"><p className="empty-table">No focus items yet.</p></div></section>
    </div> : dashboardView === 'Overview' ? <div className="dashboard-overview-wrap"><ClientDashboard people={people} /></div> : <AttendanceLogPage people={people} />}
    </> : activePage === 'Settings' ? <SettingsPage user={user} profile={profile} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} /> : activePage === 'Notes' ? <NotesPage user={user} displayName={displayName} displayInitials={displayInitials} photoUrl={profile?.photoUrl} /> : <div className="empty-page"><div className="empty-icon"><Icon name="check" size={28} /></div><p className="eyebrow">{activePage}</p><h1>{`${activePage} are coming together`}</h1><p>This view is ready for the next layer of your workspace. The dashboard is where your latest team activity lives.</p><button type="button" className="primary-button" onClick={() => setActivePage('Dashboard')}>Back to dashboard</button></div>}
    </PortalShell>
  </>
}

function App() {
  if (window.location.pathname === '/admin') return <AdminPage />
  if (window.location.pathname === '/login') return <LoginPage />
  if (window.location.pathname === '/visitor') return <VisitorLoginPage />
  if (window.location.pathname === '/client') return <ClientView />
  return <Dashboard />
}

export default App
