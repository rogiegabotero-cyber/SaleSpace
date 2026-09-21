import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updateEmail, updatePassword } from 'firebase/auth'
import { updateDoc } from 'firebase/firestore'
import { auth } from './firebase'
import { Icon } from './PortalShell'
import { roleLabel } from './roles'
import ConfirmModal from './ConfirmModal'

function Toggle({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>
}

function EditableField({ label, value, editable, hint, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setDraft(value || '')
    setError('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError('')
  }

  async function confirmSave() {
    setBusy(true)
    setError('')
    try {
      await onSave(draft.trim())
      setConfirming(false)
      setEditing(false)
    } catch (err) {
      setError(err.code === 'auth/requires-recent-login' ? 'Please sign out and back in, then try again.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="settings-row">
    <div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    {editing
      ? <div className="settings-edit"><input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus /><button type="button" className="icon-button" aria-label="Cancel" onClick={cancelEdit}><Icon name="x" size={16} /></button><button type="button" className="icon-button" aria-label="Save" onClick={() => setConfirming(true)} disabled={!draft.trim() || draft.trim() === value}><Icon name="check" size={16} /></button></div>
      : <div className="settings-value"><span>{value || '—'}</span>{editable && <button type="button" className="icon-button" aria-label={`Edit ${label}`} onClick={startEdit}><Icon name="pencil" size={15} /></button>}</div>}
    {confirming && <ConfirmModal title={`Update ${label.toLowerCase()}`} message={`Save "${draft.trim()}" as your ${label.toLowerCase()}?`} busy={busy} error={error} onConfirm={confirmSave} onCancel={() => { setConfirming(false); setError('') }} />}
  </div>
}

function PasswordSection({ email }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (newPassword.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const credential = EmailAuthProvider.credential(email, currentPassword)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
    } catch (err) {
      setError(err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? 'Current password is incorrect.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <form className="settings-password-form" onSubmit={submit}><label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} /></label><label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} /></label>{error && <div className="form-error">{error}</div>}<button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button></form>
    {success && <ConfirmModal title="Password updated" message="Your password has been changed." confirmLabel="Done" onConfirm={() => setSuccess(false)} onCancel={() => setSuccess(false)} />}
  </>
}

export default function SettingsPage({ user, profile, darkMode, onToggleDarkMode, collapsed, onToggleCollapsed, onSignOut }) {
  const isPortalUser = profile?.source === 'portal'
  const [passwordOpen, setPasswordOpen] = useState(false)

  async function saveName(nextName) {
    await updateDoc(profile.ref, { name: nextName })
  }

  async function saveEmail(nextEmail) {
    await updateEmail(auth.currentUser, nextEmail)
    await updateDoc(profile.ref, { email: nextEmail })
  }

  return <div className="content">
    <div className="page-heading"><div><p className="eyebrow">Settings</p><h1>Workspace settings</h1><p className="heading-copy">Manage your appearance and account preferences.</p></div></div>
    <section className="panel settings-panel"><div className="panel-heading"><div><h2>Appearance</h2><p>Saved to your account and applied the next time you sign in.</p></div></div><div className="settings-row"><div><strong>Dark mode</strong><small>Use a dark color theme across the portal.</small></div><Toggle checked={darkMode} onChange={onToggleDarkMode} label="Toggle dark mode" /></div>{onToggleCollapsed && <div className="settings-row"><div><strong>Auto-hide sidebar</strong><small>Keep the sidebar collapsed to icons only.</small></div><Toggle checked={collapsed} onChange={onToggleCollapsed} label="Toggle sidebar auto-hide" /></div>}</section>
    <section className="panel settings-panel"><div className="panel-heading"><div><h2>Account details</h2><p>{isPortalUser ? 'Click the pencil to update a field.' : 'Synced from Hyacinth attendance — ask an administrator to update these.'}</p></div></div><EditableField label="Name" value={profile?.name} editable={isPortalUser} onSave={saveName} /><EditableField label="Email" value={profile?.email} editable={isPortalUser} onSave={saveEmail} /><div className="settings-row"><div><strong>Role</strong><small>Managed by an administrator.</small></div><div className="settings-value"><span>{roleLabel(profile?.role)}</span></div></div></section>
    <section className="panel settings-panel"><button type="button" className="panel-heading settings-disclosure" aria-expanded={passwordOpen} onClick={() => setPasswordOpen(!passwordOpen)}><div><h2>Password</h2><p>Change your account password.</p></div><Icon name="chevron" size={18} /></button>{passwordOpen && <PasswordSection email={user.email} />}</section>
    {onSignOut && <button type="button" className="admin-link" onClick={onSignOut}>Sign out</button>}
  </div>
}
