export interface Note {
  id: number;
  title: string;
  pinned: boolean;
  createdAt: string;
}

/** Notes kept in memory. */
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
}
