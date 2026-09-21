import { useEffect, useMemo, useState } from 'react'
import { getApps, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signOut,
} from 'firebase/auth'
import { serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { jsPDF } from 'jspdf'
import { auth, firebaseConfig, functions } from './firebase'
import { hyacinthAttendanceAPI } from './api/hyacinthAttendance'
import { employeeDocument, subscribeToEmployees } from './services/employees'
import { syncEmployees } from './services/employees'
import { createPortalUser, subscribeToPortalUser, subscribeToPortalUsers } from './services/users'
import { createInvite, subscribeToInvites } from './services/invites'
import { getMustChangePassword, markMustChangePassword } from './services/accountFlags'
import { subscribeToPreferences, updatePreferences } from './services/preferences'
import { deleteCallsSheet, fetchHandlerCounts, fetchSheetMetadata, saveCallsSheet, subscribeToCallsSheets } from './services/callsSheet'
import { useTeamPresence } from './hooks/useTeamPresence'
import { PortalShell } from './PortalShell'
import { ROLES, roleLabel } from './roles'
import ChangePasswordForm from './ChangePasswordForm'
import ConfirmModal from './ConfirmModal'
import LoadingOverlay from './LoadingOverlay'
import PageLoading from './PageLoading'
import PanelSwitchBar from './PanelSwitchBar'
import { ClientDashboard } from './ClientView'
import './admin.css'
import './client.css'

const secondaryApp = getApps().find((item) => item.name === 'credential-creator') || initializeApp(firebaseConfig, 'credential-creator')
const credentialAuth = getAuth(secondaryApp)
const FIREBASE_AUTH_USERS_URL = `https://console.firebase.google.com/u/0/project/${firebaseConfig.projectId}/authentication/users`

const ADMIN_NAV_ITEMS = [['Dashboard', 'grid'], ['Employees', 'people'], ['Portal Users', 'people'], ['Calls Sheet', 'table']]

function makePassword() {
  return `${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}!${Math.floor(1000 + Math.random() * 9000)}`
}

function downloadCredentialsPdf(filenameBase, fields, password) {
  const pdf = new jsPDF()
  pdf.setFontSize(20)
  pdf.text('Salespace portal credentials', 20, 25)
  pdf.setFontSize(11)
  fields.forEach(([label, value], index) => pdf.text(`${label}: ${value}`, 20, 45 + index * 10))
  const passwordY = 45 + fields.length * 10 + 10
  pdf.text(`Temporary password: ${password}`, 20, passwordY)
  pdf.text('Please change this password after your first sign in.', 20, passwordY + 20)
  pdf.save(`${filenameBase.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-credentials.pdf`)
}

function ownPanelForRole(role) {
  return role === 'manager' || role === 'visitor' ? '/client' : '/'
}

function AddPortalUserForm({ currentRole, currentEmail, onCreated, onError }) {
  const assignableRoles = currentRole === 'super_admin' ? ROLES : ROLES.filter((item) => item.value === 'manager' || item.value === 'visitor')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(assignableRoles[0].value)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    onError('')
    setBusy(true)
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const password = makePassword()
    try {
      const result = await createUserWithEmailAndPassword(credentialAuth, trimmedEmail, password)
      await createPortalUser({ uid: result.user.uid, name: trimmedName, email: trimmedEmail, role, createdBy: currentEmail })
      await markMustChangePassword(result.user.uid)
      onCreated({ name: trimmedName, role, email: trimmedEmail, password })
      setName('')
      setEmail('')
    } catch (err) {
      onError(err.code === 'auth/email-already-in-use' ? 'This email already has a Firebase account.' : err.message)
    } finally {
      setBusy(false)
      await signOut(credentialAuth)
    }
  }

  return <form className="add-user-form" onSubmit={submit}><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{assignableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create user'}</button></form>
}

function InviteByEmailForm({ currentRole, currentEmail, invites, onError }) {
  const assignableRoles = currentRole === 'super_admin' ? ROLES : ROLES.filter((item) => item.value === 'manager' || item.value === 'visitor')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(assignableRoles[0].value)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState('')

  async function submit(event) {
    event.preventDefault()
    onError('')
    setSentTo('')
    const trimmedEmail = email.trim().toLowerCase()
    setBusy(true)
    try {
      await createInvite({ email: trimmedEmail, role, invitedBy: currentEmail })
      await sendSignInLinkToEmail(auth, trimmedEmail, { url: `${window.location.origin}/client`, handleCodeInApp: true })
      setSentTo(trimmedEmail)
      setEmail('')
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="invite-section">
    <form className="invite-form" onSubmit={submit}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{assignableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send invite'}</button></form>
    {sentTo && <div className="credential-result"><div><strong>Invite sent to {sentTo}</strong><small>They'll get a Firebase sign-in link by email and gain portal access the moment they click it.</small></div></div>}
    <div className="employee-table">
      <div className="table-head"><span>Email</span><span>Role</span><span>Status</span></div>
      {invites.length ? invites.map((invite) => <div className="employee-row" key={invite.id}><span>{invite.email}</span><span>{roleLabel(invite.role)}</span><span className={invite.status === 'accepted' ? 'registered' : 'pending'}>{invite.status === 'accepted' ? 'Accepted' : 'Pending'}</span></div>) : <p className="empty-table">No invites sent yet.</p>}
    </div>
  </div>
}

function CallsSheetSettings({ currentEmail }) {
  const [sheets, setSheets] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [titleInput, setTitleInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [sheetNamesInput, setSheetNamesInput] = useState('')
  const [tabGidsInput, setTabGidsInput] = useState({})
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [tabsLoading, setTabsLoading] = useState(false)
  const [tabsError, setTabsError] = useState('')
  const [lastFetchedUrl, setLastFetchedUrl] = useState('')
  const [handlerHeaderInput, setHandlerHeaderInput] = useState('Handler')
  const [handlerOptions, setHandlerOptions] = useState([])
  const [selectedHandlers, setSelectedHandlers] = useState([])
  const [availableLabels, setAvailableLabels] = useState([])
  const [handlersLoading, setHandlersLoading] = useState(false)
  const [handlersError, setHandlersError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletingSheet, setDeletingSheet] = useState(false)
  const [deleteSheetError, setDeleteSheetError] = useState('')

  useEffect(() => subscribeToCallsSheets(setSheets, (err) => setError(err.message)), [])

  function startNewSheet() {
    setEditingId(null)
    setTitleInput('')
    setUrlInput('')
    setSheetNamesInput('')
    setTabGidsInput({})
    setHandlerHeaderInput('Handler')
    setHandlerOptions([])
    setSelectedHandlers([])
    setAvailableLabels([])
    setLastFetchedUrl('')
    setResult(null)
    setError('')
    setTabsError('')
    setHandlersError('')
  }

  function startEditSheet(sheet) {
    setEditingId(sheet.id)
    setTitleInput(sheet.title || '')
    setUrlInput(sheet.url)
    setSheetNamesInput((sheet.sheetNames || []).join(', '))
    setTabGidsInput(sheet.tabGids || {})
    setHandlerHeaderInput(sheet.handlerHeader || 'Handler')
    setSelectedHandlers(sheet.validHandlers || [])
    setAvailableLabels(sheet.availableLabels || [])
    setHandlerOptions([...new Set([...(sheet.validHandlers || []), ...(sheet.availableLabels || [])])])
    setLastFetchedUrl(sheet.url)
    setResult(null)
    setError('')
    setTabsError('')
    setHandlersError('')
  }

  async function confirmRemoveSheet() {
    if (!deleteTarget) return
    setDeletingSheet(true)
    setDeleteSheetError('')
    try {
      await deleteCallsSheet(deleteTarget.id)
      if (editingId === deleteTarget.id) startNewSheet()
      setDeleteTarget(null)
    } catch (err) {
      setDeleteSheetError(err.message)
    } finally {
      setDeletingSheet(false)
    }
  }

  async function fetchMetadataForUrl(force = false) {
    const trimmedUrl = urlInput.trim()
    if (!trimmedUrl || (!force && trimmedUrl === lastFetchedUrl)) return
    setTabsError('')
    setTabsLoading(true)
    try {
      const { title, tabNames, tabGids } = await fetchSheetMetadata(trimmedUrl)
      setSheetNamesInput(tabNames.join(', '))
      // Only overwrite if the API lookup actually found something (it silently
      // returns {} when no key is configured or the lookup fails) — otherwise
      // keep whatever was already typed in rather than wiping it out.
      if (Object.keys(tabGids).length) setTabGidsInput(tabGids)
      if (!titleInput.trim()) setTitleInput(title)
      setLastFetchedUrl(trimmedUrl)
    } catch (err) {
      setTabsError(err.message)
    } finally {
      setTabsLoading(false)
    }
  }

  const sheetNames = sheetNamesInput.split(',').map((name) => name.trim()).filter(Boolean)

  function setTabGid(name, gid) {
    setTabGidsInput((current) => ({ ...current, [name]: gid }))
  }

  async function discoverHandlerNames() {
    const trimmedUrl = urlInput.trim()
    if (!trimmedUrl || !sheetNames.length) return
    setHandlersError('')
    setHandlersLoading(true)
    try {
      const scanResult = await fetchHandlerCounts(trimmedUrl, sheetNames, { handlerHeader: handlerHeaderInput.trim() || 'Handler' })
      setHandlerOptions((current) => [...new Set([...current, ...scanResult.allHandlerNames])].sort())
    } catch (err) {
      setHandlersError(err.message)
    } finally {
      setHandlersLoading(false)
    }
  }

  function toggleHandler(name) {
    setSelectedHandlers((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]))
  }

  function toggleAvailableLabel(name) {
    setAvailableLabels((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]))
  }

  async function submit(event) {
    event.preventDefault()
    const trimmedUrl = urlInput.trim()
    const trimmedHandlerHeader = handlerHeaderInput.trim() || 'Handler'
    const tabGids = Object.fromEntries(
      sheetNames
        .map((name) => [name, (tabGidsInput[name] || '').trim()])
        .filter(([, gid]) => gid),
    )
    setError('')
    setResult(null)
    setSaving(true)
    try {
      const testResult = await fetchHandlerCounts(trimmedUrl, sheetNames, { handlerHeader: trimmedHandlerHeader, validHandlers: selectedHandlers, availableLabels })
      const savedId = await saveCallsSheet({ id: editingId, url: trimmedUrl, sheetNames, tabGids, title: titleInput.trim() || 'Untitled sheet', updatedBy: currentEmail, handlerHeader: trimmedHandlerHeader, validHandlers: selectedHandlers, availableLabels })
      setEditingId(savedId)
      setHandlerOptions((current) => [...new Set([...current, ...testResult.allHandlerNames])].sort())
      setResult(testResult)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return <><div className="page-heading"><div><p className="eyebrow">Client dashboard</p><h1>Calls sheet</h1><p className="heading-copy">Connect Google Sheets (shared as "Anyone with the link can view") so the client dashboard can count calls per employee from their Handler columns. Connect more than one to let people switch between them from the dashboard.</p></div></div>
    <form className="calls-sheet-form-full" onSubmit={submit}>
      <label>Sheet name<input value={titleInput} onChange={(event) => setTitleInput(event.target.value)} placeholder="Auto-filled from the sheet once you paste a link" /></label>
      <label>Google Sheet link<div className="calls-sheet-link-row"><input type="url" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} onBlur={() => fetchMetadataForUrl()} placeholder="https://docs.google.com/spreadsheets/d/..." required /><button type="button" className="admin-link" disabled={!urlInput.trim() || tabsLoading} onClick={() => fetchMetadataForUrl(true)}>{tabsLoading ? 'Refreshing...' : 'Refresh tabs'}</button></div></label>
      <label>Tabs to scan (comma-separated — pull the real tabs from your sheet, then remove any summary tabs you don't want scanned){tabsLoading && ' · Reading sheet...'}<input value={sheetNamesInput} onChange={(event) => setSheetNamesInput(event.target.value)} placeholder="Paste the sheet link above to pull in its tabs" required /></label>
      {sheetNames.length > 0 && <div className="tab-gid-section">
        <p className="tab-gid-hint">Pulled in automatically when the sheet link is fetched — lets "Available to call" open the exact tab in Google Sheets. Only fill these in yourself if a tab is missing one below.</p>
        <div className="tab-gid-grid">{sheetNames.map((name) => <label key={name} className="tab-gid-row"><span>{name}</span><input value={tabGidsInput[name] || ''} onChange={(event) => setTabGid(name, event.target.value)} placeholder="gid (optional)" inputMode="numeric" /></label>)}</div>
      </div>}
      <label>Handler column header (which header names the column each tab's employee names live in — usually "Handler", but not always)<div className="calls-sheet-link-row"><input value={handlerHeaderInput} onChange={(event) => setHandlerHeaderInput(event.target.value)} placeholder="Handler" /><button type="button" className="admin-link" disabled={!urlInput.trim() || !sheetNames.length || handlersLoading} onClick={discoverHandlerNames}>{handlersLoading ? 'Scanning...' : 'Find names'}</button></div></label>
      {handlersError && <div className="form-error admin-error">{handlersError}</div>}
      {handlerOptions.length > 0 && <div className="tab-gid-section">
        <p className="tab-gid-hint">Which of these mean the row is open/unassigned rather than handled by someone (e.g. "Available to Call")? Checked ones count toward "Available to call" instead of the calls chart.</p>
        <div className="tab-gid-grid">{handlerOptions.map((name) => <label key={name} className="tab-gid-row"><input type="checkbox" checked={availableLabels.includes(name)} onChange={() => toggleAvailableLabel(name)} /><span>{name}</span></label>)}</div>
      </div>}
      {handlerOptions.length > 0 && <div className="tab-gid-section">
        <p className="tab-gid-hint">Of the rest, check the ones that are real employees. Unchecked names are left out of the calls chart and leaderboard on the client dashboard.</p>
        <div className="tab-gid-grid">{handlerOptions.filter((name) => !availableLabels.includes(name)).map((name) => <label key={name} className="tab-gid-row"><input type="checkbox" checked={selectedHandlers.includes(name)} onChange={() => toggleHandler(name)} /><span>{name}</span></label>)}</div>
      </div>}
      <button className="admin-primary" type="submit" disabled={saving}>{saving ? 'Testing...' : editingId ? 'Save changes' : 'Save & test'}</button>
    </form>
    {editingId && <button type="button" className="admin-link" onClick={startNewSheet}>+ Add another sheet</button>}
    {tabsError && <div className="form-error admin-error">{tabsError}</div>}
    {error && <div className="form-error admin-error">{error}</div>}
    {result && <div className="credential-result calls-sheet-result"><div><strong>Sheet connected</strong><small>Scanned {result.scanned.length} tab{result.scanned.length === 1 ? '' : 's'} — found {result.counts.length} distinct handler{result.counts.length === 1 ? '' : 's'} across {result.counts.reduce((sum, item) => sum + item.count, 0)} rows.</small>{result.skipped.length > 0 && <small>Skipped {result.skipped.length}: {result.skipped.map((item) => `${item.name} (${item.reason})`).join('; ')}</small>}</div></div>}
    {result && <section className="employee-table calls-per-tab-table"><div className="table-head"><span>Tab</span><span>Calls</span></div>{result.perTab.map((tab) => <div className="employee-row calls-per-tab-row" key={tab.name}><strong>{tab.name}</strong><span>{tab.total}</span></div>)}</section>}
    <div className="employee-table">
      <div className="table-head"><span>Sheet</span><span>Tabs</span><span>Updated by</span><span>Action</span></div>
      {sheets.length ? sheets.map((sheet) => <div className="employee-row" key={sheet.id}><div><strong>{sheet.title || 'Untitled sheet'}</strong><small>{sheet.url}</small></div><span>{(sheet.sheetNames || []).length} tabs</span><span>{sheet.updatedBy || '—'}</span><div className="row-actions"><button className="row-button" type="button" onClick={() => startEditSheet(sheet)}>Edit</button><button className="row-button row-button-danger" type="button" onClick={() => setDeleteTarget(sheet)}>Delete</button></div></div>) : <p className="empty-table">No sheets connected yet.</p>}
    </div>
    {deleteTarget && <ConfirmModal title="Delete calls sheet" message={`Remove "${deleteTarget.title || 'Untitled sheet'}" from the connected sheets? The client dashboard will no longer be able to count calls from it.`} confirmLabel="Delete" busy={deletingSheet} error={deleteSheetError} onConfirm={confirmRemoveSheet} onCancel={() => { setDeleteTarget(null); setDeleteSheetError('') }} />}
  </>
}

export default function AdminPage() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(null)
  const [profileDoc, setProfileDoc] = useState(undefined)
  const [activePage, setActivePage] = useState('Dashboard')
  const [darkMode, setDarkMode] = useState(false)
  const [savingDarkMode, setSavingDarkMode] = useState(false)
  const { people: teamPeople } = useTeamPresence(
    import.meta.env.VITE_HYACINTH_DEPARTMENT_ID,
  )
  const [employees, setEmployees] = useState([])
  const [portalUsers, setPortalUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [credentials, setCredentials] = useState(null)
  const [portalCredentials, setPortalCredentials] = useState(null)
  const [accessTarget, setAccessTarget] = useState(null)
  const [togglingAccess, setTogglingAccess] = useState(false)
  const [toggleAccessError, setToggleAccessError] = useState('')

  useEffect(() => onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthChecked(true) }), [])

  useEffect(() => {
    if (!user) return
    getMustChangePassword(user.uid).then(setMustChangePassword).catch((err) => setError(err.message))
  }, [user])

  useEffect(() => {
    if (!user || mustChangePassword !== false) return undefined
    return subscribeToPortalUser(user.uid, setProfileDoc, (err) => setError(err.message))
  }, [user, mustChangePassword])

  useEffect(() => {
    if (!user || mustChangePassword !== false) return undefined
    return subscribeToPreferences(user.uid, (prefs) => setDarkMode(Boolean(prefs.darkMode)))
  }, [user, mustChangePassword])

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

  const role = profileDoc?.role
  const hasAdminAccess = role === 'admin' || role === 'super_admin'
  const displayName = profileDoc?.name || user?.email?.split('@')[0] || ''
  const panelLinks = hasAdminAccess ? [
    { label: 'Admin panel', href: '/admin', active: true },
    { label: 'Client panel', href: '/client', active: false },
    { label: 'Employee panel', href: '/', active: false },
  ] : []

  useEffect(() => {
    if (!user || !hasAdminAccess) return undefined
    async function syncDepartment() {
      try {
        const departmentId = import.meta.env.VITE_HYACINTH_DEPARTMENT_ID
        const users = await hyacinthAttendanceAPI.getUsersByDepartment(departmentId)
        await syncEmployees(users, departmentId)
      } catch (err) {
        setError(`Hyacinth sync failed: ${err.message}`)
      }
    }
    syncDepartment()
    const unsubscribeEmployees = subscribeToEmployees(setEmployees, (err) => setError(err.message))
    const unsubscribeUsers = subscribeToPortalUsers(setPortalUsers, (err) => setError(err.message))
    const unsubscribeInvites = subscribeToInvites(setInvites, (err) => setError(err.message))
    return () => {
      unsubscribeEmployees()
      unsubscribeUsers()
      unsubscribeInvites()
    }
  }, [user, hasAdminAccess])

  const registeredCount = useMemo(() => employees.filter((employee) => employee.authUid || employee.registered).length, [employees])

  async function generateCredentials(employee) {
    const email = employee.email.trim()
    if (!email) {
      setError('This employee has no email address in Hyacinth.')
      return
    }
    setBusyId(employee.id)
    setError('')
    const password = makePassword()
    try {
      if (employee.authUid || employee.registered) {
        const targetEmail = employee.loginEmail || email
        const resetEmployeePassword = httpsCallable(functions, 'resetEmployeePassword')
        const result = await resetEmployeePassword({ uid: employee.authUid || null, email: targetEmail, newPassword: password })
        await setDoc(employeeDocument(employee.id), { registered: true, authUid: result.data.uid, loginEmail: targetEmail }, { merge: true })
        await markMustChangePassword(result.data.uid)
        setCredentials({ employee, email: targetEmail, password })
      } else {
        const result = await createUserWithEmailAndPassword(credentialAuth, email, password)
        await setDoc(employeeDocument(employee.id), { registered: true, authUid: result.user.uid, loginEmail: email, credentialsCreatedAt: serverTimestamp() }, { merge: true })
        await markMustChangePassword(result.user.uid)
        setCredentials({ employee, email, password })
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        await setDoc(employeeDocument(employee.id), { registered: true, loginEmail: email }, { merge: true })
        setError(`${email} already has a Firebase account. Click "Reset password" to link it to this employee and set a new password.`)
      } else {
        setError(err.message)
      }
    } finally {
      setBusyId('')
      await signOut(credentialAuth)
    }
  }

  async function toggleAccountAccess() {
    if (!accessTarget) return
    const nextDisabled = !accessTarget.accountDisabled
    setTogglingAccess(true)
    setToggleAccessError('')
    const targetUid = accessTarget.authUid || null
    const targetEmail = accessTarget.loginEmail || accessTarget.email || ''
    try {
      const setAccountDisabled = httpsCallable(functions, 'setEmployeeAccountDisabled')
      await setAccountDisabled({ uid: targetUid, email: targetEmail, disabled: nextDisabled })
      await setDoc(employeeDocument(accessTarget.id), { accountDisabled: nextDisabled }, { merge: true })
      setAccessTarget(null)
    } catch (err) {
      setToggleAccessError(`${err.message} You can also ${nextDisabled ? 'disable' : 'enable'} it manually at ${FIREBASE_AUTH_USERS_URL} (search for ${targetEmail || accessTarget.name}).`)
    } finally {
      setTogglingAccess(false)
    }
  }

  if (!authChecked) return null
  if (!user) {
    window.location.assign('/login')
    return null
  }
  if (mustChangePassword === null) return <PageLoading text="Loading your account...">{error && <div className="form-error admin-error">{error}</div>}</PageLoading>
  if (mustChangePassword) return <ChangePasswordForm onDone={() => setMustChangePassword(false)} />
  if (profileDoc === undefined) return <PageLoading text="Loading your account...">{error && <div className="form-error admin-error">{error}</div>}</PageLoading>
  if (!hasAdminAccess) {
    window.location.assign(ownPanelForRole(role))
    return null
  }

  return <>
    {savingDarkMode && <LoadingOverlay />}
    <PanelSwitchBar links={panelLinks} darkMode={darkMode} />
    <PortalShell rootLabel="Admin" activePage={activePage} navItems={ADMIN_NAV_ITEMS} hasPanelSwitch={panelLinks.length > 0} onNavigate={setActivePage} userName={displayName} userRole={roleLabel(role)} darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onSignOut={() => signOut(auth)}>
    {activePage === 'Dashboard' ? <ClientDashboard people={teamPeople} /> : <div className="content">
      {error && <div className="form-error admin-error">{error}</div>}
      {activePage === 'Employees' ? <><div className="page-heading"><div><p className="eyebrow">Hyacinth team</p><h1>Employee access</h1><p className="heading-copy">Manage portal credentials for your Hyacinth team.</p></div></div><section className="admin-stats"><div><strong>{employees.length}</strong><span>Saved employees</span></div><div><strong>{registeredCount}</strong><span>Registered accounts</span></div><div><strong>{employees.length - registeredCount}</strong><span>Awaiting access</span></div></section><section className="employee-table employees-list"><div className="table-head"><span>Employee</span><span>Department ID</span><span>Account status</span><span>Action</span></div>{employees.length ? employees.map((employee) => <div className="employee-row" key={employee.id}><div><strong>{employee.name}</strong><small>{employee.email || 'No email in Hyacinth'} · ID {employee.hyacinthUserId || employee.id}</small></div><span>{employee.departmentId || 'Not set'}</span><span className={employee.accountDisabled ? 'disabled-status' : employee.authUid || employee.registered ? 'registered' : 'pending'}>{employee.accountDisabled ? 'Disabled' : employee.authUid || employee.registered ? 'Registered' : 'Not registered'}</span><div className="row-actions"><button className="row-button" type="button" disabled={busyId === employee.id} onClick={() => generateCredentials(employee)}>{busyId === employee.id ? 'Working...' : employee.authUid || employee.registered ? 'Reset password' : 'Generate credentials'}</button>{(employee.authUid || employee.registered) && <button className={`row-button ${employee.accountDisabled ? '' : 'row-button-danger'}`} type="button" onClick={() => setAccessTarget(employee)}>{employee.accountDisabled ? 'Enable access' : 'Disable access'}</button>}</div></div>) : <p className="empty-table">No employees have been synced yet. Open the dashboard once to fetch the Hyacinth department.</p>}</section>{credentials && <ConfirmModal title={`Credentials created for ${credentials.employee.name}`} message={<>This password is shown once and is not stored anywhere — download the PDF now before closing this window.<code className="credential-password">{credentials.password}</code></>} confirmLabel="Download PDF" cancelLabel="Close" onConfirm={() => downloadCredentialsPdf(credentials.employee.name, [['Employee', credentials.employee.name], ['Employee ID', credentials.employee.hyacinthUserId || credentials.employee.id], ['Email', credentials.email]], credentials.password)} onCancel={() => setCredentials(null)} />}{accessTarget && <ConfirmModal title={accessTarget.accountDisabled ? 'Enable access' : 'Disable access'} message={accessTarget.accountDisabled ? `Restore portal access for ${accessTarget.name}? They'll be able to sign in with their existing credentials again.` : `Disable portal access for ${accessTarget.name}? They will no longer be able to sign in or use their credentials, but their name and activity will still appear throughout the app.`} confirmLabel={accessTarget.accountDisabled ? 'Enable access' : 'Disable access'} busy={togglingAccess} error={toggleAccessError} onConfirm={toggleAccountAccess} onCancel={() => { setAccessTarget(null); setToggleAccessError('') }} />}</> : activePage === 'Portal Users' ? <><div className="page-heading"><div><p className="eyebrow">Client portal</p><h1>Portal users</h1><p className="heading-copy">Create logins for admins, managers, and visitors on this client portal.</p></div></div><AddPortalUserForm currentRole={role} currentEmail={user.email} onCreated={setPortalCredentials} onError={setError} /><div className="employee-table"><div className="table-head"><span>Name</span><span>Email</span><span>Role</span><span>Added by</span></div>{portalUsers.length ? portalUsers.map((portalUser) => <div className="employee-row" key={portalUser.id}><div><strong>{portalUser.name}</strong></div><span>{portalUser.email}</span><span>{roleLabel(portalUser.role)}</span><span>{portalUser.createdBy || '—'}</span></div>) : <p className="empty-table">No portal users created yet.</p>}</div>{portalCredentials && <ConfirmModal title={`Credentials created for ${portalCredentials.name}`} message={<>This password is shown once and is not stored anywhere — download the PDF now before closing this window.<code className="credential-password">{portalCredentials.password}</code></>} confirmLabel="Download PDF" cancelLabel="Close" onConfirm={() => downloadCredentialsPdf(portalCredentials.name, [['Name', portalCredentials.name], ['Role', roleLabel(portalCredentials.role)], ['Email', portalCredentials.email]], portalCredentials.password)} onCancel={() => setPortalCredentials(null)} />}<div className="page-heading"><div><p className="eyebrow">Client portal</p><h1>Invite by email</h1><p className="heading-copy">Send a Firebase sign-in link instead — they get portal access the moment they click it, no password to hand off.</p></div></div><InviteByEmailForm currentRole={role} currentEmail={user.email} invites={invites} onError={setError} /></> : <CallsSheetSettings currentEmail={user.email} />}
    </div>}
    </PortalShell>
  </>
}
