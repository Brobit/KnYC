# express-notes (golden fixture)

A small notes REST API, used to test the KnYC pipeline. Size: small (~200 lines), **with tests**.

## Architecture

```
src/server.ts            entry point: loads config, starts the app
src/app.ts               createApp(): JSON body parser, routes, error handling
src/config.ts            PORT, MAX_TITLE_LENGTH
src/errors.ts            HttpError classes + notFound / error middlewares
src/notes/note.ts        Note types
src/notes/notes.store.ts in-memory store (CRUD + tag filter)
src/notes/notes.validation.ts  request body validation
src/notes/notes.routes.ts      /notes router
```

Expected build order: types and config → errors → store → validation → routes → app → server.

## API

| Method | Path | |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| GET | /notes?tag= | list, optional tag filter |
| GET | /notes/:id | one note, 404 if missing |
| POST | /notes | create (title required) → 201 |
| PATCH | /notes/:id | partial update |
| DELETE | /notes/:id | 204 |

## Commands

```bash
npm install
npm run build
npm test
```
