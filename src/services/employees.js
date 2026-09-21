import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

const employeesCollection = collection(db, 'employees')

function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase()
}

function employeeIdOf(user) {
  return String(user.userId || user.employeeId || user.id || user.email || '')
}

export function employeeFromHyacinth(user, departmentId) {
  const id = employeeIdOf(user)
  const name = user.name || user.displayName || user.email || 'Unnamed employee'
  return {
    ...user,
    id,
    hyacinthUserId: id,
    departmentId: user.departmentId || departmentId,
    name,
    email: user.email || '',
    initials: initialsOf(name),
    registered: Boolean(user.registered),
    syncedAt: serverTimestamp(),
  }
}

export async function syncEmployees(users, departmentId) {
  await Promise.all(
    users.map((user) => {
      const employee = employeeFromHyacinth(user, departmentId)
      return setDoc(doc(employeesCollection, employee.id), employee, { merge: true })
    }),
  )
}

export function subscribeToEmployees(onChange, onError) {
  return onSnapshot(
    employeesCollection,
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}

export function employeeDocument(employeeId) {
  return doc(employeesCollection, employeeId)
}