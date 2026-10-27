import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

const announcementsCollection = collection(db, 'announcements')

// Newest first. Expired ones are filtered out on the client (an expiry passes while the page
// is open), so this reads a few more than are ever shown.
export function subscribeToAnnouncements(onChange, onError) {
  return onSnapshot(
    query(announcementsCollection, orderBy('createdAt', 'desc'), limit(30)),
    // The metadata says whether this snapshot is only what the browser had cached (`fromCache`)
    // or has been confirmed by the server — the alert needs to tell those apart.
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), snapshot.metadata),
    onError,
  )
}

// `expiresAt` is a Date, or null for an announcement that never expires.
const toExpiry = (expiresAt) => (expiresAt ? Timestamp.fromDate(expiresAt) : null)

export async function createAnnouncement({ authorUid, authorName, title, text, expiresAt }) {
  await addDoc(announcementsCollection, { authorUid, authorName, title, text, expiresAt: toExpiry(expiresAt), createdAt: serverTimestamp() })
}

export async function updateAnnouncement(announcementId, { title, text, expiresAt }) {
  await updateDoc(doc(announcementsCollection, announcementId), { title, text, expiresAt: toExpiry(expiresAt), editedAt: serverTimestamp() })
}

export async function deleteAnnouncement(announcementId) {
  await deleteDoc(doc(announcementsCollection, announcementId))
}
