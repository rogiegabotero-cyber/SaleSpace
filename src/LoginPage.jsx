import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from './firebase'
import { getMustChangePassword } from './services/accountFlags'
import { fetchCurrentProfile } from './services/profile'
import ChangePasswordForm from './ChangePasswordForm'
import { Icon } from './PortalShell'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import './admin.css'

function destinationForRole(role) {
  return role === 'admin' || role === 'super_admin' ? '/admin' : '/'
}

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false)

  async function redirectAfterSignIn(uid) {
    const profile = await fetchCurrentProfile(uid)
    window.location.assign(destinationForRole(profile?.role))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      const result = await signInWithEmailAndPassword(auth, email, password)
      const needsChange = await getMustChangePassword(result.user.uid)
      if (needsChange) {
        setNeedsPasswordChange(true)
        return
      }
      await redirectAfterSignIn(result.user.uid)
    } catch {
      setError('The email or password is incorrect.')
    }
  }

  if (needsPasswordChange) return <ChangePasswordForm onDone={() => redirectAfterSignIn(auth.currentUser.uid)} />

  return <main className="auth-page"><form className="auth-card" onSubmit={submit}><p className="admin-kicker">Salespace portal</p><h1>Welcome back</h1><p>Sign in with the credentials provided by your administrator.</p><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}><Icon name={showPassword ? 'eye-off' : 'eye'} size={16} /></button></div></label>{error && <div className="form-error">{error}</div>}<button className="admin-primary" type="submit">Sign in</button></form></main>
}
