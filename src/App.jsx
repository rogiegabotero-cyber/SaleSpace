import { useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import './App.css'
import './admin.css'
import { useTeamPresence } from './hooks/useTeamPresence'
import { useAuthGate } from './hooks/useAuthGate'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { useHashRoute } from './hooks/useHashRoute'
import { Avatar, Icon, PortalShell } from './PortalShell'
import { initialsOf } from './utils/initials'
import { auth } from './firebase'
import { subscribeToPreferences, updatePreferences } from './services/preferences'
import { createNote, subscribeToNotes } from './services/notes'
import { canPostAnnouncements, canSetCallQuota, isClientOnlyRole, roleLabel } from './roles'
import ChangePasswordForm from './ChangePasswordForm'
import LoadingOverlay from './LoadingOverlay'
import PageLoading from './PageLoading'
import PanelSwitchBar from './PanelSwitchBar'
import SettingsPage from './SettingsPage'
import NotesPage, { TimelineNote } from './NotesPage'
import AdminPage from './AdminPage'
import AnnouncementAlert from './AnnouncementAlert'
import QuotaAlert from './QuotaAlert'
import MentionAlert from './MentionAlert'
import Announcements from './Announcements'
import EasternClock from './EasternClock'
import MentionInput from './MentionInput'
import { extractMentions } from './utils/mentions'
import { listenForFocus } from './utils/focusTarget'
import AppointmentCelebration from './AppointmentCelebration'
import ClientView, { AttendanceLogPage, ClientDashboard } from './ClientView'
import ManagementPage from './ManagementPage'
import QuotaDonut from './QuotaDonut'
import { WorkspaceCallsProvider, WorkspaceTeamPanel } from './WorkspaceCalls'
import LoginPage from './LoginPage'
import VisitorLoginPage from './VisitorLoginPage'

const navItems = [['Dashboard', 'grid'], ['Notes', 'file']]
const manageItems = [['Settings', 'settings']]
// 'Management' is always a valid address so a refresh on it stays put; whether it is shown is
// decided by role below.
const EMPLOYEE_PAGES = [...navItems, ...manageItems].map(([label]) => label).concat('Management')
const DASHBOARD_VIEWS = ['Workspace', 'Overview', 'Attendance Log']
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
  const { user, authChecked, mustChangePassword, setMustChangePassword, profile } = useAuthGate()
  const [collapsed, setCollapsed] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [savingDarkMode, setSavingDarkMode] = useState(false)
  const { page: activePage, view: dashboardView, setPage: setActivePage, setView: setDashboardView } = useHashRoute({ pages: EMPLOYEE_PAGES, views: DASHBOARD_VIEWS })
  // Views stay mounted once opened and are only hidden when another is showing, so
  // switching tabs (or pages) and coming back doesn't refetch and reload them.
  const [openedViews, setOpenedViews] = useState(() => new Set(['Workspace']))
  const dashboardViewLabel = dashboardView === 'Overview' ? 'Work Overview' : dashboardView
  useDocumentTitle(mustChangePassword ? 'Change password' : activePage === 'Dashboard' ? dashboardViewLabel : activePage)
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

  const clientOnly = isClientOnlyRole(profile?.role)
  // Managers, admins and super admins get the Management page; everyone else is sent back.
  const canManage = canPostAnnouncements(profile?.role)
  useEffect(() => {
    if (profile !== undefined && activePage === 'Management' && !canManage) setActivePage('Dashboard')
  }, [profile, activePage, canManage, setActivePage])

  // A clicked notification can point at an announcement or note on this dashboard.
  useEffect(() => listenForFocus(), [])

  useEffect(() => {
    if (!user || mustChangePassword !== false || profile === undefined || clientOnly) return undefined
    return subscribeToNotes(setNotes, (err) => console.error('subscribeToNotes failed', err))
  }, [user, mustChangePassword, profile, clientOnly])

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

  function selectDashboardView(view) {
    setOpenedViews((opened) => (opened.has(view) ? opened : new Set(opened).add(view)))
    setDashboardView(view)
  }

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
        ...extractMentions(trimmed, people),
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
  if (clientOnly) {
    window.location.assign('/client')
    return null
  }

  return <>
    {savingDarkMode && <LoadingOverlay />}
    <PanelSwitchBar links={panelLinks} darkMode={darkMode} />
    <PortalShell userId={user.uid} userEmail={user.email} activePage={activePage} navItems={canManage ? [...navItems, ['Management', 'people']] : navItems} manageItems={manageItems} hasPanelSwitch={panelLinks.length > 0} onNavigate={setActivePage} userName={displayName} userRole={displayRole} userPhoto={profile?.photoUrl} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onSignOut={() => signOut(auth).then(() => window.location.assign('/login'))}>
    <WorkspaceCallsProvider people={people}>
    <AppointmentCelebration userId={user.uid} people={people} />
    <AnnouncementAlert userId={user.uid} />
    <QuotaAlert userId={user.uid} />
    <MentionAlert userId={user.uid} userEmail={user.email} />
    <div style={{ display: activePage === 'Dashboard' ? 'contents' : 'none' }}>
      <div className="dashboard-view-switch-wrap"><div className="dashboard-view-switch"><button type="button" className={`dashboard-view-tab ${dashboardView === 'Workspace' ? 'active' : ''}`} onClick={() => selectDashboardView('Workspace')}><Icon name="grid" size={15} /> Workspace</button><button type="button" className={`dashboard-view-tab ${dashboardView === 'Overview' ? 'active' : ''}`} onClick={() => selectDashboardView('Overview')}><Icon name="table" size={15} /> Work Overview</button><button type="button" className={`dashboard-view-tab ${dashboardView === 'Attendance Log' ? 'active' : ''}`} onClick={() => selectDashboardView('Attendance Log')}><Icon name="clock" size={15} /> Attendance Log</button></div><EasternClock /></div>
      <div style={{ display: dashboardView === 'Workspace' ? 'contents' : 'none' }}><div className="content"><div className="page-heading has-announcements"><QuotaDonut user={user} updaterName={displayName} people={people} todayLabel={todayLabel} canSetQuota={canSetCallQuota(profile?.role)} /><div className="page-heading-announcements"><Announcements user={user} authorName={displayName} canPost={canPostAnnouncements(profile?.role)} /></div></div>
      <div className="dashboard-grid"><section className="panel notes-panel"><div className="panel-heading"><div><h2>Overall notes</h2><p>Shared with everyone in your workspace</p></div><button type="button" className="subtle-button" onClick={() => document.querySelector('.note-composer input')?.focus()}><Icon name="plus" size={16} /> Add note</button></div><div className="note-composer">{profile?.photoUrl ? <img className="avatar avatar-photo avatar-small" src={profile.photoUrl} alt="" /> : <Avatar initials={displayInitials} color={colorFor(user.uid)} small />}<MentionInput value={note} onChange={setNote} onSubmit={postNote} people={people} placeholder="Share an update with the team... (type @ to mention)" /><button type="button" onClick={postNote} disabled={!note.trim() || postingNote}>Post</button></div><div className="note-list">{sortedNotes.length ? sortedNotes.map((item) => <TimelineNote key={item.id} note={item} currentUser={currentUser} />) : <p className="empty-table">No notes yet. Share the first update with your team.</p>}</div></section>
        {teamLoading ? <section className="panel online-mini-panel team-panel"><p className="team-status-message">Loading team status...</p></section> : teamError ? <section className="panel online-mini-panel team-panel"><p className="team-status-message team-status-error">Couldn't load team status: {teamError}</p></section> : <WorkspaceTeamPanel people={people} className="team-panel" />}</div>
    </div></div>
      {(openedViews.has('Overview') || dashboardView === 'Overview') && <div style={{ display: dashboardView === 'Overview' ? 'contents' : 'none' }}><div className="dashboard-overview-wrap"><ClientDashboard people={people} peopleLoading={teamLoading} /></div></div>}
      {(openedViews.has('Attendance Log') || dashboardView === 'Attendance Log') && <div style={{ display: dashboardView === 'Attendance Log' ? 'contents' : 'none' }}><AttendanceLogPage people={people} /></div>}
    </div>
    {activePage === 'Settings' ?<SettingsPage user={user} profile={profile} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} /> : activePage === 'Notes' ? <NotesPage people={people} user={user} displayName={displayName} displayInitials={displayInitials} photoUrl={profile?.photoUrl} /> : activePage === 'Management' ? (canManage ? <ManagementPage user={user} displayName={displayName} people={people} /> : null) : activePage === 'Dashboard' ? null : <div className="empty-page"><div className="empty-icon"><Icon name="check" size={28} /></div><p className="eyebrow">{activePage}</p><h1>{`${activePage} are coming together`}</h1><p>This view is ready for the next layer of your workspace. The dashboard is where your latest team activity lives.</p><button type="button" className="primary-button" onClick={() => setActivePage('Dashboard')}>Back to dashboard</button></div>}
    </WorkspaceCallsProvider>
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
