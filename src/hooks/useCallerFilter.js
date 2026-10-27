import { useCallback, useEffect, useMemo, useState } from 'react'
import { subscribeToCallHandlers } from '../services/callHandlers'
import { filterCallsResult } from '../utils/callersFilter'
import { matchEmployeeByName } from '../utils/matchEmployee'

// Applies the "who is in charge of calls" setting to a calls-sheet result. While nobody has been
// picked every handler is kept; once some have, only their calls remain (a sheet handler is
// matched to an employee the same way the rest of the dashboard does, so one that matches nobody
// is left out). Also returns whether a given person is on the call team, for the places that list
// people rather than calls.
export function useCallerFilter(callsResult, people) {
  const [ids, setIds] = useState([])

  useEffect(() => subscribeToCallHandlers(setIds, (err) => console.warn('[callers] unavailable:', err.message)), [])

  const configured = ids.length > 0
  const idSet = useMemo(() => new Set(ids), [ids])

  const isCallerPerson = useCallback((person) => !configured || idSet.has(String(person.id)), [configured, idSet])
  const result = useMemo(() => {
    if (!configured) return callsResult
    return filterCallsResult(callsResult, (name) => {
      const person = matchEmployeeByName(name, people)
      return Boolean(person) && idSet.has(String(person.id))
    })
  }, [callsResult, configured, idSet, people])

  return { result, configured, isCallerPerson }
}
