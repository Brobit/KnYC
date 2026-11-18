import { Injectable, computed, effect, signal } from "@angular/core";
import type { Note } from "./types";

const KEY = "angular-notes";

/** Notes kept in the browser (localStorage): one instance for the app, injected where needed. */
@Injectable({ providedIn: "root" })
export class NotesService {
  private readonly all = signal<Note[]>(load());
  readonly notes = this.all.asReadonly();
  private readonly nextId = computed(() => Math.max(0, ...this.all().map((n) => n.id)) + 1);

  constructor() {
    effect(() => localStorage.setItem(KEY, JSON.stringify(this.all())));
  }

  add(title: string, now = new Date()): Note {
    const note: Note = { id: this.nextId(), title: title.trim(), body: "", pinned: false, createdAt: now.toISOString() };
    this.all.update((notes) => [...notes, note]);
    return note;
  }

  togglePin(id: number) {
    this.all.update((notes) => notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  }

  remove(id: number) {
    this.all.update((notes) => notes.filter((n) => n.id !== id));
  }

  byId(id: number): Note | undefined {
    return this.all().find((n) => n.id === id);
  }
}

function load(): Note[] {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  return saved ? (JSON.parse(saved) as Note[]) : [];
}
