# vue-notes (golden fixture)

A notes app in Vue 3 with Vite (#94): single-file components, a Pinia store kept in the browser
(localStorage, no backend), and vue-router pages. The frontend track is rebuilt step by step and
checked in a real browser, components mounted alone until the app shows them.

```
src/types.ts                    Note
src/lib/notes.ts                visibleNotes (search, pinned first), countLabel
src/stores/notes.ts             the notes store: add, togglePin, remove, byId
src/components/NoteForm.vue     title field + Add (disabled while empty), emits add
src/components/SearchBox.vue    v-model on a search field
src/components/NoteItem.vue     a link to the note, Pin/Unpin, Delete (emits)
src/components/NoteList.vue     the list, or "No notes yet."
src/pages/NotesPage.vue         form, search, list and count, on the store
src/pages/NotePage.vue          one note (/notes/:id)
src/router.ts                   / and /notes/:id
src/App.vue, src/main.ts        the layout with RouterView; mounts the app with Pinia and the router
```

TypeScript is 5.9 here: vue-tsc uses TypeScript's JavaScript API, which TypeScript 7 doesn't have.

```bash
npm ci
npm run build   # vue-tsc --noEmit && vite build
npm test        # the helpers and the store
npm run dev
```
