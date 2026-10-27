import type { Note } from "../types";

/** One note: its title, a pin toggle and a delete button. */
export function NoteItem({ note, onTogglePin, onDelete }: { note: Note; onTogglePin: (note: Note) => void; onDelete: (id: number) => void }) {
  return (
    <li className={note.pinned ? "pinned" : undefined}>
      <span>{note.title}</span>
      {note.pinned && <span aria-label="Pinned"> 📌</span>}
      <button type="button" onClick={() => onTogglePin(note)}>
        {note.pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" onClick={() => onDelete(note.id)} aria-label={`Delete ${note.title}`}>
        Delete
      </button>
    </li>
  );
}
