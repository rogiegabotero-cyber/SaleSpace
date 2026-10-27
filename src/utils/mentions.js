// @mentions in notes. A mention is "@" followed by a teammate's full name, inserted by the
// autocomplete in MentionInput; "@ALL" addresses the whole team and marks the note important.
// The note stores who was mentioned (name and lower-cased email, the email being how a
// signed-in account is matched to a person) and whether it was @ALL, so rendering and
// notifications never have to re-parse free text.

export const ALL_NAME = 'ALL'

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Which people (and @ALL) a note's text actually mentions, matched against the full names the
// autocomplete inserts. Typing "@Kyla" without picking her doesn't count as a mention. Longer
// names are matched first and blanked out of the working text, so "@Kyla G. Casa" can't also
// count as a mention of a different person who is simply named "Kyla".
export function extractMentions(text, people) {
  const seen = new Set()
  const mentions = []
  let remaining = text
  const byLongestName = [...people].filter((person) => person.name).sort((a, b) => b.name.length - a.name.length)
  for (const person of byLongestName) {
    if (seen.has(person.id)) continue
    const pattern = new RegExp(`(^|\\s)(@${escapeRegExp(person.name)})(?![\\w])`, 'i')
    const match = pattern.exec(remaining)
    if (!match) continue
    seen.add(person.id)
    mentions.push({ name: person.name, email: (person.email || '').trim().toLowerCase() })
    const from = match.index + match[1].length
    remaining = remaining.slice(0, from) + ' '.repeat(match[2].length) + remaining.slice(from + match[2].length)
  }
  const mentionAll = new RegExp(`(^|\\s)@${ALL_NAME}(?![\\w])`, 'i').test(remaining)
  return { mentions, mentionAll }
}

// Splits a note's text into plain and mention pieces, for highlighting:
// [{ text, mention: false }, { text: '@Kyla G. Casa', mention: true }, ...]
export function splitMentions(text, { mentions = [], mentionAll = false } = {}) {
  const names = mentions.map((item) => item.name).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp)
  if (mentionAll) names.push(ALL_NAME)
  if (!names.length) return [{ text, mention: false }]
  const pattern = new RegExp(`(^|\\s)(@(?:${names.join('|')}))(?![\\w])`, 'gi')
  const parts = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length
    if (start > last) parts.push({ text: text.slice(last, start), mention: false })
    parts.push({ text: match[2], mention: true })
    last = start + match[2].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false })
  return parts
}

// Whether a note is addressed to this account: @ALL, or the account's email is mentioned.
export function mentionsAccount(note, email) {
  if (note.mentionAll) return true
  const mine = (email || '').trim().toLowerCase()
  return Boolean(mine) && Array.isArray(note.mentions) && note.mentions.some((item) => item.email === mine)
}
