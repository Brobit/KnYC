import { useCallback, useEffect, useState } from "react";
import { createNote, deleteNote, fetchNotes, setPinned } from "../api";
import type { Note } from "../types";

/** The notes from the API, and the actions that change them; errors are shown, not thrown. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchNotes()
      .then((loaded) => live && setNotes(loaded))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const add = (title: string) =>
    run(async () => {
      const note = await createNote(title);
      setNotes((current) => [...current, note]);
    });

  const togglePin = (note: Note) =>
    run(async () => {
      const updated = await setPinned(note.id, !note.pinned);
      setNotes((current) => current.map((n) => (n.id === updated.id ? updated : n)));
    });

  const remove = (id: number) =>
    run(async () => {
      await deleteNote(id);
      setNotes((current) => current.filter((n) => n.id !== id));
    });

  return { notes, loading, error, add, togglePin, remove };
}
