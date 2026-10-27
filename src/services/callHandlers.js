import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

// Who is in charge of calls: the employees (Hyacinth user ids) whose calls the call charts show.
// An empty list means nobody has been picked, and every handler in the sheet is shown. Anyone
// signed in can read it; managers and admins change it (see firestore.rules).
const callHandlersDocument = doc(db, 'settings', 'callHandlers')

// Calls `onChange` with the list of ids (possibly empty).
export function subscribeToCallHandlers(onChange, onError) {
  return onSnapshot(callHandlersDocument, (snapshot) => {
    const ids = snapshot.exists() ? snapshot.data().employeeIds : []
    onChange(Array.isArray(ids) ? ids.map(String) : [])
  }, onError)
}

export async function setCallHandlers(employeeIds, updatedBy) {
  await setDoc(callHandlersDocument, { employeeIds, updatedBy, updatedAt: serverTimestamp() })
}
