import { createContext, useContext, useMemo } from 'react'
import { TeamOnlinePanel, useCallsSheet } from './ClientView'
import { useCallerFilter } from './hooks/useCallerFilter'
import CallsTrendPanel from './CallsTrendPanel'

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

// The calls trend graph for the signed-in employee alone, found among `people` by email.
export function WorkspaceTrendPanel({ people, userEmail }) {
  const calls = useWorkspaceCalls()
  const email = (userEmail || '').trim().toLowerCase()
  const me = useMemo(() => people.find((person) => (person.email || '').trim().toLowerCase() === email) || null, [people, email])
  if (!calls?.url || !me) return null
  return <CallsTrendPanel daily={calls.counts?.daily} people={people} loading={Boolean(calls.loading)} employee={me} />
}

export function WorkspaceTeamPanel({ people, className }) {
  const calls = useWorkspaceCalls()
  return <TeamOnlinePanel people={people} className={className} callsResult={calls?.counts} callsLoading={Boolean(calls?.loading)} />
}
