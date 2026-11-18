"use client";

import { useState } from "react";
import { useNotes } from "../hooks/useNotes";
import { countLabel, visibleNotes } from "../lib/notes";
import { NoteForm } from "./NoteForm";
import { NoteList } from "./NoteList";
import { SearchBox } from "./SearchBox";

/** The notes, their form and their search: runs in the browser, against the API routes. */
export function NotesApp() {
  const { notes, loading, error, add, togglePin, remove } = useNotes();
  const [query, setQuery] = useState("");
  const shown = visibleNotes(notes, query);

  return (
    <>
      <NoteForm onAdd={add} />
      <SearchBox value={query} onChange={setQuery} />
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Loading…</p> : <NoteList notes={shown} onTogglePin={togglePin} onDelete={remove} />}
      <footer>{countLabel(notes.length)}</footer>
    </>
  );
}
