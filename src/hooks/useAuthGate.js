import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { getMustChangePassword } from '../services/accountFlags'
import { fetchCurrentProfile } from '../services/profile'

export function useAuthGate() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(null)
  const [profile, setProfile] = useState(undefined)

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser)
    setAuthChecked(true)
  }), [])

  useEffect(() => {
    if (!user) return
    getMustChangePassword(user.uid).then(setMustChangePassword)
  }, [user])

  useEffect(() => {
    if (!user || mustChangePassword !== false) return
    fetchCurrentProfile(user.uid).then(setProfile)
  }, [user, mustChangePassword])

  return { user, authChecked, mustChangePassword, setMustChangePassword, profile }
}
