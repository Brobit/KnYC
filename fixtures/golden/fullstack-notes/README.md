# fullstack-notes (golden fixture)

A React (Vite) notes app against an Express API, in two npm workspaces (#92). Used to test the
KnYC pipeline on a full-stack project: the frontend track is rebuilt against the original API.
Size: small (~350 lines), **with tests** in both packages.

## Architecture

```
apps/api/src/notes.store.ts          in-memory notes: list, create, pin, remove
apps/api/src/app.ts                  createApp(): the routes under /api
apps/api/src/server.ts               listens on PORT (3000)

apps/web/vite.config.ts              React plugin; /api proxied to http://localhost:3000
apps/web/src/types.ts                Note
apps/web/src/api.ts                  fetch wrappers for /api/notes, ApiError
apps/web/src/lib/notes.ts            visibleNotes (search, pinned first), countLabel
apps/web/src/hooks/useNotes.ts       the notes and their actions, with errors
apps/web/src/components/NoteForm.tsx    title field + Add (disabled while empty)
apps/web/src/components/SearchBox.tsx   filters as you type
apps/web/src/components/NoteItem.tsx    title, Pin/Unpin, Delete
apps/web/src/components/NoteList.tsx    the list, or "No notes yet."
apps/web/src/App.tsx                 the page: form, search, list, count
apps/web/src/main.tsx                mounts App
```

Expected frontend build order: types → API client → helpers → hook → components → App → main.
Components come before App, so their UI checks mount them alone on a page of their own.

## Commands

```bash
npm install
npm run build
npm test
```

In development: `npm run start -w apps/api` and `npm run dev -w apps/web`.
