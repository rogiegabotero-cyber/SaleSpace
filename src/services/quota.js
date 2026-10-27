import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

// The team's daily call quota: one number, shared by everyone. Anyone signed in can read it;
// only managers and admins can change it (see firestore.rules). Each change also records who
// made it and what it was before, so everyone can be told.
const quotaDocument = doc(db, 'settings', 'dailyCallQuota')

// Calls `onChange` with the quota, or 0 when none has been set.
export function subscribeToCallQuota(onChange, onError) {
  return onSnapshot(quotaDocument, (snapshot) => onChange(snapshot.exists() ? Number(snapshot.data().value) || 0 : 0), onError)
}

// Calls `onChange` with the whole record — { value, previousValue, updatedBy, updatedByName,
// updatedAt: Date | null } — or null when no quota has ever been set — and the snapshot's
// metadata (whether it is only the browser's cache, or a write still waiting for the server).
export function subscribeToCallQuotaDetails(onChange, onError) {
  return onSnapshot(quotaDocument, (snapshot) => {
    if (!snapshot.exists()) { onChange(null, snapshot.metadata); return }
    const data = snapshot.data()
    onChange({
      value: Number(data.value) || 0,
      previousValue: Number(data.previousValue) || 0,
      updatedBy: data.updatedBy || '',
      updatedByName: data.updatedByName || '',
      updatedAt: data.updatedAt?.toDate?.() || null,
    }, snapshot.metadata)
  }, onError)
}

export async function setCallQuota(value, { previous = 0, updatedBy, updatedByName } = {}) {
  await setDoc(quotaDocument, {
    value,
    previousValue: previous > 0 ? previous : null,
    updatedBy,
    updatedByName: updatedByName || null,
    updatedAt: serverTimestamp(),
  })
}
