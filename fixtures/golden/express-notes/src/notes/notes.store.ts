import type { Note, NoteInput } from "./note.js";

export class NotesStore {
  private notes = new Map<number, Note>();
  private nextId = 1;

  constructor(private readonly now: () => Date = () => new Date()) {}

  list(tag?: string): Note[] {
    const all = [...this.notes.values()];
    return tag ? all.filter((note) => note.tags.includes(tag)) : all;
  }

  get(id: number): Note | undefined {
    return this.notes.get(id);
  }

  create(input: NoteInput): Note {
    const timestamp = this.now().toISOString();
    const note: Note = { id: this.nextId++, ...input, createdAt: timestamp, updatedAt: timestamp };
    this.notes.set(note.id, note);
    return note;
  }

  update(id: number, input: Partial<NoteInput>): Note | undefined {
    const existing = this.notes.get(id);
    if (!existing) return undefined;
    const updated: Note = { ...existing, ...input, updatedAt: this.now().toISOString() };
    this.notes.set(id, updated);
    return updated;
  }

  remove(id: number): boolean {
    return this.notes.delete(id);
  }
}
