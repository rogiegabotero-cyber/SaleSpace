import { useEffect, useState } from 'react'
import { deleteNote, setNotePinned, updateNote } from '../services/notes'

export function useNoteEditor(note, currentUid) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(note.text)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pinning, setPinning] = useState(false)
  const isOwn = note.authorUid === currentUid
  const pinned = Boolean(note.pinned)

  useEffect(() => {
    if (!menuOpen) return undefined
    function handleClickOutside(event) {
      if (!event.target.closest('.note-menu-wrap')) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function startEdit() {
    setMenuOpen(false)
    setEditText(note.text)
    setEditing(true)
  }

  async function saveEdit() {
    const trimmed = editText.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await updateNote(note.id, trimmed)
      setEditing(false)
    } catch (err) {
      console.error('updateNote failed', err)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteNote(note.id)
      setConfirmingDelete(false)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  async function togglePinned() {
    if (pinning) return
    setMenuOpen(false)
    setPinning(true)
    try {
      await setNotePinned(note.id, !pinned, currentUid)
    } catch (err) {
      console.error('setNotePinned failed', err)
    } finally {
      setPinning(false)
    }
  }

  return {
    isOwn,
    menuOpen,
    setMenuOpen,
    editing,
    setEditing,
    editText,
    setEditText,
    saving,
    startEdit,
    saveEdit,
    confirmingDelete,
    setConfirmingDelete,
    deleting,
    deleteError,
    setDeleteError,
    confirmDelete,
    pinned,
    pinning,
    togglePinned,
  }
}
