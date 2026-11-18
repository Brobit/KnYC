# angular-notes (golden fixture)

A notes app in Angular 22 (#95): standalone components with inline templates, a service holding the
notes in signals (kept in localStorage, no backend) injected where it's needed, and router pages.
The frontend track is rebuilt step by step and checked in a real browser on `ng serve`; until the
app has its own `src/main.ts` (it comes last), a check's mount is that file.

```
src/app/types.ts, src/app/lib/notes.ts      Note; visibleNotes, countLabel
src/app/notes.service.ts                    the notes (signals): add, togglePin, remove, byId
src/app/components/note-form.component.ts   title field + Add (disabled while empty), output add
src/app/components/search-box.component.ts  a search field, model query
src/app/components/note-item.component.ts   a link to the note, Pin/Unpin, Delete (outputs)
src/app/components/note-list.component.ts   the list (@for), or "No notes yet."
src/app/pages/notes-page.component.ts       "/": form, search, list, count; injects the service
src/app/pages/note-page.component.ts        "/notes/:id": one note (the id as an input)
src/app/app.routes.ts, app.config.ts        the routes; provideRouter with input binding
src/app/app.component.ts, src/main.ts       the layout with router-outlet; bootstrapApplication
```

TypeScript is 6.0 here: Angular 22's compiler supports `>=6.0 <6.1`.

```bash
npm ci
npm run build       # ng build
npm run typecheck   # ngc --noEmit: the components and their templates
npm test            # the helpers
npm start           # ng serve, http://localhost:4200
```
