import { useState, type FormEvent } from "react";

/** A title field and an Add button, disabled while the title is empty. */
export function NoteForm({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    await onAdd(title.trim());
    setTitle("");
  };

  return (
    <form onSubmit={submit} aria-label="New note">
      <label htmlFor="note-title">Title</label>
      <input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you want to remember?" />
      <button type="submit" disabled={!title.trim()}>
        Add
      </button>
    </form>
  );
}
