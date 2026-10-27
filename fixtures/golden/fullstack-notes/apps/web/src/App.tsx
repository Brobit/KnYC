import { useState } from "react";
import { NoteForm } from "./components/NoteForm";
import { NoteList } from "./components/NoteList";
import { SearchBox } from "./components/SearchBox";
import { useNotes } from "./hooks/useNotes";
import { countLabel, visibleNotes } from "./lib/notes";

export function App() {
  const { notes, loading, error, add, togglePin, remove } = useNotes();
  const [query, setQuery] = useState("");
  const shown = visibleNotes(notes, query);

  return (
    <main>
      <h1>Notes</h1>
      <NoteForm onAdd={add} />
      <SearchBox value={query} onChange={setQuery} />
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Loading…</p> : <NoteList notes={shown} onTogglePin={togglePin} onDelete={remove} />}
      <footer>{countLabel(notes.length)}</footer>
    </main>
  );
}
