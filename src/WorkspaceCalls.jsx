import { createContext, useContext, useMemo } from 'react'
import { TeamOnlinePanel, useCallsSheet } from './ClientView'
import { useCallerFilter } from './hooks/useCallerFilter'

// The employee workspace reads the connected calls sheet once and shares it: the quota donut
// needs today's calls, and the team panel needs the month's, for its tooltips and popups. It
// is mounted only after sign-in (the sheet list is a Firestore read that needs it).
const CallsContext = createContext(null)

// The shared result is already narrowed to the people in charge of calls, and `callers` says who
// they are, for the parts that list people rather than calls.
export function WorkspaceCallsProvider({ children, people = [] }) {
  const calls = useCallsSheet()
  const { result, configured, isCallerPerson } = useCallerFilter(calls.counts, people)
  const value = useMemo(() => ({ ...calls, counts: result, callers: { configured, isCallerPerson } }), [calls, result, configured, isCallerPerson])
  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceCalls() {
  return useContext(CallsContext)
}

export function WorkspaceTeamPanel({ people, className }) {
  const calls = useWorkspaceCalls()
  return <TeamOnlinePanel people={people} className={className} callsResult={calls?.counts} callsLoading={Boolean(calls?.loading)} />
}
