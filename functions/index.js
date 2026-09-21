const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')

initializeApp()

// Roles are managed by the existing users/{uid} documents. This check runs
// with Admin SDK privileges and cannot be bypassed from the browser. Wrapped
// in its own try/catch so a Firestore-side problem (e.g. the function's
// service account missing IAM permissions) surfaces as a clean HttpsError
// instead of crashing the whole invocation with an opaque "internal" error.
async function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in.')
  }
  let role = null
  try {
    const caller = await getFirestore().doc(`users/${request.auth.uid}`).get()
    role = caller.exists ? caller.data().role : null
  } catch (error) {
    console.error('Admin role lookup failed:', error)
    throw new HttpsError('internal', 'Could not verify your admin role.')
  }
  if (role !== 'admin' && role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only administrators can do this.')
  }
}

exports.resetEmployeePassword = onCall({ region: 'us-central1', invoker: 'public' }, async (request) => {
  await requireAdmin(request)

  const uid = String(request.data?.uid || '').trim()
  const email = String(request.data?.email || '').trim().toLowerCase()
  const newPassword = String(request.data?.newPassword || '')
  if (!uid && !email) {
    throw new HttpsError('invalid-argument', 'The employee authentication UID or email is required.')
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    throw new HttpsError('invalid-argument', 'Password must be between 6 and 128 characters.')
  }

  try {
    const auth = getAuth()
    const user = await auth.updateUser(uid || (await auth.getUserByEmail(email)).uid, { password: newPassword })
    console.log(`Password reset by ${request.auth.uid} for ${user.uid}`)
    return { success: true, uid: user.uid, email: user.email || null }
  } catch (error) {
    console.error('Password reset error:', error)
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Firebase Authentication user was not found.')
    }
    throw new HttpsError('internal', 'Unable to reset the employee password.')
  }
})

// Disables (or re-enables) an employee's Firebase Authentication account
// without deleting it — a disabled account can no longer sign in, but its
// record (and the employee's data elsewhere in the app) is untouched.
exports.setEmployeeAccountDisabled = onCall({ region: 'us-central1', invoker: 'public' }, async (request) => {
  await requireAdmin(request)

  const uid = String(request.data?.uid || '').trim()
  const email = String(request.data?.email || '').trim().toLowerCase()
  const disabled = Boolean(request.data?.disabled)
  if (!uid && !email) {
    throw new HttpsError('invalid-argument', 'The employee authentication UID or email is required.')
  }

  try {
    const auth = getAuth()
    const resolvedUid = uid || (await auth.getUserByEmail(email)).uid
    await auth.updateUser(resolvedUid, { disabled })
    console.log(`Auth account ${resolvedUid} ${disabled ? 'disabled' : 're-enabled'} by ${request.auth.uid}`)
    return { success: true, uid: resolvedUid, disabled }
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Firebase Authentication user was not found.')
    }
    console.error('Set employee account disabled error:', error)
    throw new HttpsError('internal', 'Unable to update the employee authentication account.')
  }
})
