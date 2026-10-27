import type { Note } from "../types";
import { NoteItem } from "./NoteItem";

/** The notes, or a message when there are none. */
export function NoteList({ notes, onTogglePin, onDelete }: { notes: Note[]; onTogglePin: (note: Note) => void; onDelete: (id: number) => void }) {
  if (notes.length === 0) return <p>No notes yet.</p>;
  return (
    <ul aria-label="Notes">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} onTogglePin={onTogglePin} onDelete={onDelete} />
      ))}
    </ul>
  );
}
