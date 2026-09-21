import { useState } from 'react'
import { updatePassword } from 'firebase/auth'
import { auth } from './firebase'
import { clearMustChangePassword } from './services/accountFlags'
import { Icon } from './PortalShell'
import './admin.css'

export default function ChangePasswordForm({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await updatePassword(auth.currentUser, password)
      await clearMustChangePassword(auth.currentUser.uid)
      onDone()
    } catch (err) {
      setError(err.code === 'auth/requires-recent-login' ? 'Please sign out and sign in again, then retry.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><p className="admin-kicker">Salespace portal</p><h1>Set a new password</h1><p>For your security, choose a new password before continuing.</p><label>New password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><Icon name={showPassword ? 'eye-off' : 'eye'} size={16} /></button></div></label><label>Confirm password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}><Icon name={showPassword ? 'eye-off' : 'eye'} size={16} /></button></div></label>{error && <div className="form-error">{error}</div>}<button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save password'}</button></form></main>
}
