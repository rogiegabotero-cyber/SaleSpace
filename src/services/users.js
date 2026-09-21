import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

const usersCollection = collection(db, 'users')

export function userDocument(uid) {
  return doc(usersCollection, uid)
}

export async function createPortalUser({ uid, name, email, role, createdBy }) {
  await setDoc(userDocument(uid), { name, email, role, createdBy, createdAt: serverTimestamp() })
}

export function subscribeToPortalUser(uid, onChange, onError) {
  return onSnapshot(userDocument(uid), (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null), onError)
}

export function subscribeToPortalUsers(onChange, onError) {
  return onSnapshot(
    usersCollection,
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}
