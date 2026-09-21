import { collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

const invitesCollection = collection(db, 'invites')

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

export function inviteDocument(email) {
  return doc(invitesCollection, normalizeEmail(email))
}

export async function createInvite({ email, role, invitedBy }) {
  const normalizedEmail = normalizeEmail(email)
  await setDoc(inviteDocument(normalizedEmail), {
    email: normalizedEmail,
    role,
    invitedBy,
    invitedAt: serverTimestamp(),
    status: 'pending',
  })
}

export async function getInvite(email) {
  const snapshot = await getDoc(inviteDocument(email))
  return snapshot.exists() ? snapshot.data() : null
}

export async function acceptInvite(email, uid) {
  await updateDoc(inviteDocument(email), { status: 'accepted', acceptedAt: serverTimestamp(), acceptedUid: uid })
}

export function subscribeToInvites(onChange, onError) {
  return onSnapshot(
    invitesCollection,
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}
