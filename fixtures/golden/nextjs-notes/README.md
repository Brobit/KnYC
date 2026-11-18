# nextjs-notes (golden fixture)

The notes app of `fullstack-notes`, as one Next.js app with the app router (#93): pages and client
components are the frontend track, the route handlers and the server store the backend track. Each
track is rebuilt with the other one in place; they only talk over HTTP (`/api/notes`).

```
app/layout.tsx                  the root layout
app/page.tsx                    a server component: the heading, and the client NotesApp
components/NotesApp.tsx         "use client": the form, search, list and count
components/NoteForm.tsx …       the components (as in fullstack-notes)
hooks/useNotes.ts               the notes and their actions
lib/api.ts, lib/notes.ts        the API client, the helpers; lib/types.ts is shared

app/api/health/route.ts         GET /api/health
app/api/notes/route.ts          GET, POST /api/notes
app/api/notes/[id]/route.ts     PATCH, DELETE /api/notes/:id
server/notes-store.ts           the notes in memory (on globalThis, across dev reloads)
```

```bash
npm ci
npm run build   # next build
npm test        # the route handlers and the helpers
npm run dev     # http://localhost:3000
```
