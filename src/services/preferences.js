import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

function preferencesDocument(uid) {
  return doc(db, 'preferences', uid)
}

export function subscribeToPreferences(uid, onChange, onError) {
  return onSnapshot(preferencesDocument(uid), (snapshot) => onChange(snapshot.exists() ? snapshot.data() : {}), onError)
}

export async function updatePreferences(uid, patch) {
  await setDoc(preferencesDocument(uid), patch, { merge: true })
}
