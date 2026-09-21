import { useState } from 'react'
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { acceptInvite, getInvite } from './services/invites'
import { createPortalUser } from './services/users'
import './admin.css'

export default function VisitorLoginPage() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signInWithGoogle() {
    setError('')
    setBusy(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      const { uid, email, displayName } = result.user

      const existingProfile = await getDoc(doc(db, 'users', uid))
      if (existingProfile.exists()) {
        window.location.assign('/client')
        return
      }

      const invite = await getInvite(email)
      if (!invite || invite.status === 'accepted') {
        await signOut(auth)
        setError('That Google account hasn\'t been invited yet. Ask an admin to send you an invite first.')
        return
      }

      await createPortalUser({ uid, name: displayName || email.split('@')[0], email, role: invite.role, createdBy: invite.invitedBy })
      await acceptInvite(email, uid)
      window.location.assign('/client')
    } catch (err) {
      setError(err.code === 'auth/popup-closed-by-user' ? '' : err.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <p className="admin-kicker">Salespace visitor access</p>
      <h1>Sign in with Google</h1>
      <p>Use the Google account your invite was sent to.</p>
      {error && <div className="form-error">{error}</div>}
      <button type="button" className="admin-primary" onClick={signInWithGoogle} disabled={busy}>{busy ? 'Signing in...' : 'Sign in with Google'}</button>
    </section>
  </main>
}
