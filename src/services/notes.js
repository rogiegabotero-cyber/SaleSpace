import { addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

const notesCollection = collection(db, 'notes')

function noteDocument(noteId) {
  return doc(notesCollection, noteId)
}

function commentsCollection(noteId) {
  return collection(noteDocument(noteId), 'comments')
}

function commentDocument(noteId, commentId) {
  return doc(commentsCollection(noteId), commentId)
}

export function subscribeToNotes(onChange, onError) {
  return onSnapshot(
    query(notesCollection, orderBy('createdAt', 'desc'), limit(50)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}

export async function createNote({ authorUid, authorName, authorInitials, authorColor, authorPhoto, text }) {
  await addDoc(notesCollection, {
    authorUid,
    authorName,
    authorInitials,
    authorColor: authorColor || null,
    authorPhoto: authorPhoto || null,
    text,
    createdAt: serverTimestamp(),
  })
}

export async function updateNote(noteId, text) {
  await updateDoc(noteDocument(noteId), { text, editedAt: serverTimestamp() })
}

export async function deleteNote(noteId) {
  await deleteDoc(noteDocument(noteId))
}

export async function setNotePinned(noteId, pinned, uid) {
  await updateDoc(noteDocument(noteId), {
    pinned,
    pinnedAt: pinned ? serverTimestamp() : null,
    pinnedBy: pinned ? uid : null,
  })
}

export function subscribeToComments(noteId, onChange, onError) {
  return onSnapshot(
    query(commentsCollection(noteId), orderBy('createdAt', 'asc'), limit(200)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}

export async function createComment(noteId, { authorUid, authorName, authorInitials, authorColor, authorPhoto, text }) {
  await addDoc(commentsCollection(noteId), {
    authorUid,
    authorName,
    authorInitials,
    authorColor: authorColor || null,
    authorPhoto: authorPhoto || null,
    text,
    createdAt: serverTimestamp(),
  })
}

export async function updateComment(noteId, commentId, text) {
  await updateDoc(commentDocument(noteId, commentId), { text, editedAt: serverTimestamp() })
}

export async function deleteComment(noteId, commentId) {
  await deleteDoc(commentDocument(noteId, commentId))
}
