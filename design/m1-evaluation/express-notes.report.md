# express-notes: backend-standard

**13 steps** in 4 milestones · **9/13 steps (69%) with a check proven red → green** · 24 proven checks
Reference timeline: 12/13 steps build on their own · last step = original code: yes

## Foundation: Config & Errors

Set up the shared building blocks every other layer depends on: environment-based configuration and a consistent error model with Express middleware to surface those errors as JSON.

| Step | Checks | |
|---|---|---|
| 🔗 **s01** Load configuration from the environment<br>loadConfig() reads environment variables and returns a typed Config object (e.g. with a port) | — | doesn't build alone; merged into s02 |
| ✅ **s02** Define custom HTTP error classes<br>HttpError, NotFoundError, and ValidationError can be constructed and expose the right status code and message/details | `HttpError sets status, message, details`<br>`NotFoundError builds 404 message from subject`<br>`ValidationError is 400 and carries details array` |  |
| ✅ **s03** Add error-handling middleware<br>notFoundHandler turns unmatched requests into a 404 NotFoundError, and errorHandler converts any thrown HttpError into a JSON error response | `notFoundHandler yields 404 on unmatched route`<br>`errorHandler converts thrown HttpError to JSON with its status`<br>`errorHandler falls back to 500 for non-HttpError errors` |  |

## Note Model & In-Memory Storage

Define what a note looks like and build the in-memory store that performs full CRUD against it.

| Step | Checks | |
|---|---|---|
| ⚠️ **s04** Model the Note shape<br>The Note interface and NoteInput type compile and accurately describe a stored note vs. create/update input | — | no runtime check: This step only adds a TS interface and type alias, erased at compile time with no runtime code/exports. The compiled module is empty, so nothing callable exists to assert on; an impo |
| ✅ **s05** Read notes from the store<br>NotesStore.list() returns all notes (optionally filtered by tag) and NotesStore.get(id) returns the matching note or undefined | `NotesStore.list() returns empty array when no notes exist`<br>`NotesStore.get(id) returns undefined for unknown id` |  |
| ✅ **s06** Create notes in the store<br>NotesStore.create() adds a note with an auto-incremented id and a createdAt/updatedAt timestamp, retrievable via get() | `NotesStore creates notes with incrementing ids and timestamps`<br>`NotesStore filters by tag` |  |
| ✅ **s07** Update and remove notes in the store<br>NotesStore.update() changes an existing note's fields and refreshes updatedAt, and NotesStore.remove() deletes a note by id | `NotesStore updates and removes notes` |  |

## Validating Note Input

Guard the store from bad data by validating incoming request bodies before they reach it.

| Step | Checks | |
|---|---|---|
| ⚠️ **s08** Write a string-array type guard<br>isStringArray() returns true only for arrays whose every element is a string | — | no runtime check: The function added in this step (isStringArray) is not exported from notes.validation.ts (the module list confirms this file "exports nothing" at this step), so it cannot be imported |
| ✅ **s09** Validate note input for create and update<br>parseNoteInput() returns a clean NoteInput for valid POST bodies, accepts partial fields for PATCH, and throws ValidationError on invalid data | `parseNoteInput accepts a full note and normalizes tags`<br>`parseNoteInput allows partial input when patching`<br>`parseNoteInput defaults tags to an empty list`<br>`parseNoteInput rejects a missing title and a long title` |  |

## Routing, App & Server

Expose the notes feature over HTTP, assemble the Express app, and start the server so the whole API runs end to end.

| Step | Checks | |
|---|---|---|
| ⚠️ **s10** Parse note ids from the URL<br>parseId() returns a positive integer from a route param or throws ValidationError for anything else | — | no runtime check: parseId() is a private, non-exported function inside notes.routes.ts (exports listed as "nothing" at this step), so it can't be imported or called from a test. It's only testable onc |
| ✅ **s11** Build the notes CRUD router<br>notesRouter responds correctly to GET/POST/PATCH/DELETE on /notes and /notes/:id, backed by NotesStore and validation | `POST /notes creates a note and GET /notes/:id retrieves it`<br>`GET /notes filters by tag, PATCH updates, DELETE removes and returns 404 after`<br>`POST with invalid body returns 400, GET with bad id returns 400` |  |
| ✅ **s12** Assemble the Express app<br>createApp() returns an Express app with the notes router, 404 handler, and error handler mounted in the right order | `/notes creates, reads, lists, updates and deletes a note`<br>`/notes returns 400 for a non-numeric id`<br>`/notes returns 400 with details for invalid input`<br>`/notes returns 404 for unknown routes`<br>`GET /health returns ok` |  |
| ✅ **s13** Start the HTTP server<br>Running the entry point loads config, creates the app, and listens on the configured port so real HTTP requests succeed | `Real server (not just app) handles full /notes flow via config-loaded port` |  |

## Analysis

| Stage | Time | AI calls |
|---|---|---|
| Scan and code graph | 0 s | — |
| Summaries | 0 s | — |
| Learning path | 0 s | — |
| Reference timeline | 45 s | — |
| Checks | 295 s | 8 |
| **Total** | **340 s** | **8** |

Models: summaries `haiku`, planning `sonnet`, checks `sonnet`.
Tokens: 87611 in, 9987 out · provider estimate ≈ $0.22
