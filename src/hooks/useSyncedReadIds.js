import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeToPreferences, updatePreferences } from '../services/preferences'

// The ids of the notifications a user has already read, kept on their account (the same
// preferences document that holds the sidebar and dark-mode settings) so a notification read in
// one browser stays read in every other browser and device. A copy in this browser lets the bell
// render at once, and whatever was only ever remembered here is carried up to the account the
// first time, so nothing already read comes back as unread.
//
// `loaded` turns true once the account's list has arrived; until then a fresh browser would
// otherwise flash everything as unread.
function readCache(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeCache(storageKey, ids) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids]))
  } catch {
    // Storage can be unavailable (private window); the account copy still holds the list.
  }
}

export function useSyncedReadIds(userId, field, storageKey, maxStored) {
  const [readIds, setReadIds] = useState(() => (userId ? readCache(storageKey) : new Set()))
  const [loaded, setLoaded] = useState(false)
  const idsRef = useRef(readIds)

  const commit = useCallback((ids) => {
    const trimmed = new Set([...ids].slice(-maxStored))
    idsRef.current = trimmed
    setReadIds(trimmed)
    writeCache(storageKey, trimmed)
    return trimmed
  }, [maxStored, storageKey])

  const save = useCallback((ids) => {
    if (!userId) return
    updatePreferences(userId, { [field]: [...ids] })
      .catch((err) => console.warn('[notifications] could not save what you have read:', err.message))
  }, [userId, field])

  useEffect(() => {
    if (!userId) return undefined
    return subscribeToPreferences(userId, (prefs) => {
      const remote = new Set(Array.isArray(prefs[field]) ? prefs[field] : [])
      // Reads made in another browser arrive here; anything read only in this one is kept too.
      const merged = commit(new Set([...remote, ...idsRef.current]))
      if ([...merged].some((id) => !remote.has(id))) save(merged)
      setLoaded(true)
    }, (err) => {
      console.warn('[notifications] read state unavailable:', err.message)
      setLoaded(true)
    })
  }, [userId, field, commit, save])

  const markRead = useCallback((id) => {
    if (idsRef.current.has(id)) return
    save(commit(new Set(idsRef.current).add(id)))
  }, [commit, save])

  const markManyRead = useCallback((ids) => {
    if (!ids.length || ids.every((id) => idsRef.current.has(id))) return
    save(commit(new Set([...idsRef.current, ...ids])))
  }, [commit, save])

  return { readIds, loaded, markRead, markManyRead }
}
