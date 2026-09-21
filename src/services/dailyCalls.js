import { collection, doc, onSnapshot, query, runTransaction, where } from 'firebase/firestore'
import { db } from '../firebase'

function snapshotDocument(sheetId) {
  return doc(db, 'callsSnapshots', sheetId)
}

function dayDocument(sheetId, date) {
  return doc(db, 'dailyCalls', sheetId, 'days', date)
}

// The calls sheet has no per-row date, so daily counts are tracked going forward
// from whenever this feature first sees a sheet, not backfilled historically: each
// time a client fetches fresh handler totals, this compares them against the last
// totals seen for that sheet and attributes any increase to today. A transaction
// keeps this correct if multiple people have the dashboard open at once — without
// it, two clients could both read the same "old" baseline and double-count the
// same new rows.
export async function recordDailyCallDeltas(sheetId, counts) {
  if (!sheetId) return
  const today = new Date().toISOString().slice(0, 10)
  const snapshotRef = snapshotDocument(sheetId)
  const dailyRef = dayDocument(sheetId, today)

  await runTransaction(db, async (transaction) => {
    // Firestore transactions require every read to happen before any write is
    // queued, so both docs are read up front regardless of whether the second
    // one ends up needed — reading it conditionally further down (after the
    // snapshot write below) throws at runtime.
    const snapshotSnap = await transaction.get(snapshotRef)
    const dailySnap = await transaction.get(dailyRef)
    const previousCounts = snapshotSnap.exists() ? snapshotSnap.data().counts || {} : null

    const nextSnapshot = {}
    const changes = {}
    for (const { name, count } of counts) {
      nextSnapshot[name] = count
      if (previousCounts) {
        const delta = count - (previousCounts[name] || 0)
        if (delta !== 0) changes[name] = delta
      }
    }
    // A handler present before but missing from this fetch entirely (e.g. its
    // last row was deleted, not just un-assigned) still needs its drop counted.
    if (previousCounts) {
      for (const name of Object.keys(previousCounts)) {
        if (!(name in nextSnapshot) && previousCounts[name]) changes[name] = -previousCounts[name]
      }
    }

    transaction.set(snapshotRef, { counts: nextSnapshot, updatedAt: new Date().toISOString() })

    // previousCounts is null only on the very first observation of this sheet —
    // skip recording a "day" for it, otherwise the entire historical backlog of
    // rows would get misattributed to whichever day someone first connects it.
    if (previousCounts && Object.keys(changes).length) {
      const existing = dailySnap.exists() ? dailySnap.data().counts || {} : {}
      const merged = { ...existing }
      for (const [name, delta] of Object.entries(changes)) {
        // A negative delta (a handler assignment got removed/corrected) reverts
        // today's count for that handler — this only actually undoes the count
        // if it was added today; an older day's count can't be identified and
        // reverted from here, since there's no per-row history to trace back to.
        merged[name] = Math.max(0, (merged[name] || 0) + delta)
      }
      transaction.set(dailyRef, { date: today, counts: merged, updatedAt: new Date().toISOString() }, { merge: true })
    }
  })
}

export function subscribeToDailyCalls(sheetId, startDate, endDate, onChange, onError) {
  if (!sheetId) {
    onChange({})
    return () => {}
  }
  const daysQuery = query(
    collection(db, 'dailyCalls', sheetId, 'days'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  )
  return onSnapshot(daysQuery, (snapshot) => {
    const byDate = {}
    snapshot.docs.forEach((item) => { byDate[item.id] = item.data().counts || {} })
    onChange(byDate)
  }, onError)
}
