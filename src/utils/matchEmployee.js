function firstNameOf(name) {
  return (name || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
}

// Sheets name a handler by a short name ("Erica"); this finds the employee it stands for,
// or null when nobody (or more than one person) fits.
export function matchEmployeeByName(handlerName, people) {
  const target = firstNameOf(handlerName)
  if (!target) return null
  const byFirstName = people.filter((person) => firstNameOf(person.name) === target)
  if (byFirstName.length) return byFirstName.length === 1 ? byFirstName[0] : null
  // Nobody's first name matches, so the sheet may use a middle name or nickname
  // (e.g. handler "Von" for "Rashdi Von B. Hassan"). Accept it if exactly one person has it.
  const byAnyWord = people.filter((person) => (person.name || '').toLowerCase().split(/\s+/).includes(target))
  return byAnyWord.length === 1 ? byAnyWord[0] : null
}
