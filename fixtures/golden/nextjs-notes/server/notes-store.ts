import type { Note } from "../lib/types";

/** Notes kept in memory, on the server only. */
export class NotesStore {
  private readonly notes = new Map<number, Note>();
  private nextId = 1;

  list(): Note[] {
    return [...this.notes.values()].map((n) => ({ ...n }));
  }

  create(title: string, now: Date = new Date()): Note {
    const note: Note = { id: this.nextId++, title, pinned: false, createdAt: now.toISOString() };
    this.notes.set(note.id, note);
    return { ...note };
  }

  setPinned(id: number, pinned: boolean): Note | undefined {
    const note = this.notes.get(id);
    if (!note) return undefined;
    note.pinned = pinned;
    return { ...note };
  }

  remove(id: number): boolean {
    return this.notes.delete(id);
  }

  clear(): void {
    this.notes.clear();
    this.nextId = 1;
  }
}

// One store for the whole server: in development, Next.js reloads modules on change, so it lives on
// globalThis to keep the notes across reloads.
const shared = globalThis as typeof globalThis & { notesStore?: NotesStore };
export const store = (shared.notesStore ??= new NotesStore());
