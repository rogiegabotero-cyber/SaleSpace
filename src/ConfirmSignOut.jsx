import { useState } from 'react'
import ConfirmModal from './ConfirmModal'

// "Sign out?" confirmation shared by every place that offers a sign-out button, so a stray
// click on one doesn't end the session. `onSignOut` may be async (it usually redirects).
export default function ConfirmSignOut({ onSignOut, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onSignOut()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return <ConfirmModal title="Sign out" message="Are you sure you want to sign out?" confirmLabel="Sign out" busyLabel="Signing out..." busy={busy} error={error} onConfirm={confirm} onCancel={busy ? undefined : onCancel} />
}
