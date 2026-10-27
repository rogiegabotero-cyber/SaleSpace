import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './PortalShell'

// A themed replacement for <select>. The browser draws a native select's open list itself
// (its own font size, colours and chrome), so page CSS can only ever style the closed box;
// this renders the list as ordinary markup that follows the dashboard's light/dark theme.
// `options` is [{ value, label }]; `onChange` receives the chosen option's original value.
export default function CustomSelect({ value, onChange, options, ariaLabel, className = '', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const listId = useId()
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the keyboard-highlighted option in view when the list scrolls.
  useEffect(() => {
    if (!open) return
    menuRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function openMenu() {
    setActive(Math.max(0, selectedIndex))
    setOpen(true)
  }

  function choose(index) {
    onChange(options[index].value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onKeyDown(event) {
    const last = options.length - 1
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); setOpen(false) }
      return
    }
    if (event.key === 'Tab') { setOpen(false); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) { openMenu(); return }
      if (event.key === 'Home') setActive(0)
      else if (event.key === 'End') setActive(last)
      else setActive((index) => Math.min(last, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(active)
      else openMenu()
    }
  }

  return <div className={`custom-select ${className}`} ref={rootRef}>
    <button
      type="button"
      ref={triggerRef}
      className={`custom-select-trigger ${open ? 'is-open' : ''}`}
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onClick={() => (open ? setOpen(false) : openMenu())}
      onKeyDown={onKeyDown}
    >
      <span className="custom-select-label">{selected?.label ?? ''}</span>
      <Icon name="chevron" size={14} />
    </button>
    {open && <ul className={`custom-select-menu align-${align}`} id={listId} role="listbox" aria-label={ariaLabel} ref={menuRef}>
      {options.map((option, index) => <li
        key={String(option.value)}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === selectedIndex}
        className={`custom-select-option ${index === active ? 'is-active' : ''} ${index === selectedIndex ? 'is-selected' : ''}`}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(index)}
      >
        <span>{option.label}</span>
        {index === selectedIndex && <Icon name="check" size={14} />}
      </li>)}
    </ul>}
  </div>
}
