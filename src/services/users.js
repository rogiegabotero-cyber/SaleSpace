import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

const usersCollection = collection(db, 'users')

export function userDocument(uid) {
  return doc(usersCollection, uid)
}

export async function createPortalUser({ uid, name, email, role, createdBy }) {
  await setDoc(userDocument(uid), { name, email, role, createdBy, createdAt: serverTimestamp() })
}

// Only the role changes; Firestore rules decide who may do it (a super admin for any role,
// an admin only between manager and visitor).
export async function updatePortalUserRole(uid, role) {
  await updateDoc(userDocument(uid), { role })
}

// Removes a portal account. For a promoted employee this is "remove manager": they have no
// portal record again, so they are an ordinary employee.
export async function deletePortalUser(uid) {
  await deleteDoc(userDocument(uid))
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
