import { useRef, useState } from 'react'
import './mentions.css'
import { Avatar } from './PortalShell'
import { ALL_NAME } from './utils/mentions'

const MAX_OPTIONS = 6
const MAX_QUERY = 30

// A text input that suggests teammates when you type "@". Picking one inserts their full name
// ("@Kyla G. Casa "); "@ALL" is offered first and notifies the whole team. Enter picks the
// highlighted suggestion while the list is open, and otherwise submits (`onSubmit`).
export default function MentionInput({ value, onChange, onSubmit, people = [], placeholder, disabled }) {
  const inputRef = useRef(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState(-1)

  // The "@something" the caret is in, if any: an "@" at the start or after whitespace, with
  // nothing but a short query between it and the caret.
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  const query = at !== -1 && (at === 0 || /\s/.test(before[at - 1])) && before.length - at - 1 <= MAX_QUERY ? before.slice(at + 1) : null

  let options = []
  if (query !== null && at !== dismissedAt) {
    const needle = query.toLowerCase()
    if (ALL_NAME.toLowerCase().startsWith(needle)) options.push({ id: '__all', name: ALL_NAME, role: 'Notify everyone — marks the note as important', all: true })
    options = options.concat(people.filter((person) => person.name && person.name.toLowerCase().includes(needle)).slice(0, MAX_OPTIONS))
  }
  const open = options.length > 0
  const highlighted = Math.min(active, Math.max(0, options.length - 1))

  function choose(option) {
    const insert = `@${option.name} `
    const next = `${value.slice(0, at)}${insert}${value.slice(caret)}`
    const position = at + insert.length
    onChange(next)
    setCaret(position)
    setActive(0)
    // The caret moves after React has put the new text in the field.
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(position, position)
    })
  }

  function onKeyDown(event) {
    if (open) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((highlighted + 1) % options.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((highlighted - 1 + options.length) % options.length); return }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(options[highlighted]); return }
      if (event.key === 'Escape') { event.preventDefault(); setDismissedAt(at); return }
    }
    if (event.key === 'Enter') onSubmit?.()
  }

  return <div className="mention-input">
    <input
      ref={inputRef}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
      onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setActive(0); setDismissedAt(-1) }}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
      onClick={(event) => setCaret(event.currentTarget.selectionStart)}
    />
    {open && <ul className="mention-menu" role="listbox" aria-label="Mention someone">
      {options.map((option, index) => <li
        key={option.id}
        role="option"
        aria-selected={index === highlighted}
        className={`mention-option ${index === highlighted ? 'is-active' : ''} ${option.all ? 'is-all' : ''}`}
        // mousedown, not click: the input must keep its focus and caret while a choice is made.
        onMouseDown={(event) => { event.preventDefault(); choose(option) }}
        onMouseEnter={() => setActive(index)}
      >
        {option.all ? <span className="mention-all-badge">@</span> : option.profileImg ? <img className="avatar avatar-photo avatar-small" src={option.profileImg} alt="" /> : <Avatar initials={option.initials} color={option.color} small />}
        <span className="mention-option-text"><strong>{option.all ? `@${option.name}` : option.name}</strong><small>{option.role}</small></span>
      </li>)}
    </ul>}
  </div>
}
