import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

function flagDocument(uid) {
  return doc(db, 'accountFlags', uid)
}

export async function markMustChangePassword(uid) {
  await setDoc(flagDocument(uid), { mustChangePassword: true }, { merge: true })
}

export async function clearMustChangePassword(uid) {
  await setDoc(flagDocument(uid), { mustChangePassword: false }, { merge: true })
}

export async function getMustChangePassword(uid) {
  const snapshot = await getDoc(flagDocument(uid))
  return Boolean(snapshot.exists() && snapshot.data().mustChangePassword)
}
