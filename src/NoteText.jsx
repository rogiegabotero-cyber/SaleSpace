import './mentions.css'
import { splitMentions } from './utils/mentions'

// A note's text with its @mentions highlighted (@ALL stands out more — it marks the note
// as important).
export default function NoteText({ note }) {
  return <>{splitMentions(note.text, note).map((part, index) => part.mention
    ? <span key={index} className={`mention ${part.text.toLowerCase() === '@all' ? 'mention-all' : ''}`}>{part.text}</span>
    : part.text)}</>
}
