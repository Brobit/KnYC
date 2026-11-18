import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Note } from "../types";

const KEY = "vue-notes";

/** Notes kept in the browser (localStorage), shared by every page. */
export const useNotesStore = defineStore("notes", () => {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  const notes = ref<Note[]>(saved ? (JSON.parse(saved) as Note[]) : []);
  const nextId = computed(() => Math.max(0, ...notes.value.map((n) => n.id)) + 1);

  watch(notes, (value) => typeof localStorage !== "undefined" && localStorage.setItem(KEY, JSON.stringify(value)), { deep: true });

  function add(title: string, body = "", now = new Date()): Note {
    const note: Note = { id: nextId.value, title: title.trim(), body, pinned: false, createdAt: now.toISOString() };
    notes.value.push(note);
    return note;
  }

  function togglePin(id: number) {
    const note = notes.value.find((n) => n.id === id);
    if (note) note.pinned = !note.pinned;
  }

  function remove(id: number) {
    notes.value = notes.value.filter((n) => n.id !== id);
  }

  const byId = (id: number) => notes.value.find((n) => n.id === id);

  return { notes, add, togglePin, remove, byId };
});
