import { useState } from 'react'
import { deleteComment, updateComment } from '../services/notes'

export function useCommentEditor(noteId, comment, currentUid) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(comment.text)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const isOwn = comment.authorUid === currentUid

  function startEdit() {
    setEditText(comment.text)
    setEditing(true)
  }

  async function saveEdit() {
    const trimmed = editText.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await updateComment(noteId, comment.id, trimmed)
      setEditing(false)
    } catch (err) {
      console.error('updateComment failed', err)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteComment(noteId, comment.id)
      setConfirmingDelete(false)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  return {
    isOwn,
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
  }
}
