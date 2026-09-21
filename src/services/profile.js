import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'

export async function fetchCurrentProfile(uid) {
  const portalRef = doc(db, 'users', uid)
  const portalSnap = await getDoc(portalRef)
  if (portalSnap.exists()) {
    const data = portalSnap.data()
    return { name: data.name, email: data.email, role: data.role, photoUrl: null, source: 'portal', ref: portalRef }
  }

  const employeeQuery = query(collection(db, 'employees'), where('authUid', '==', uid))
  const employeeSnap = await getDocs(employeeQuery)
  if (!employeeSnap.empty) {
    const employeeDoc = employeeSnap.docs[0]
    const data = employeeDoc.data()
    return { name: data.name, email: data.loginEmail || data.email, role: 'employee', photoUrl: data.profileImg || null, source: 'employee', ref: employeeDoc.ref }
  }

  return null
}
