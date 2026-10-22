# express-no-tests: backend-standard

**13 steps** in 4 milestones · **10/13 steps (77%) with a check proven red → green** · 23 proven checks
Reference timeline: 12/13 steps build on their own · last step = original code: yes

## Foundation: Config, Errors, and Models

Set up the shared building blocks every other part of the app depends on: configuration loading, a typed HTTP error with its handler, and the Link data shape.

| Step | Checks | |
|---|---|---|
| 🔗 **s01** Load application configuration<br>loadConfig() reads environment variables and returns a Config object with the expected fields (e.g. port, base URL) | — | doesn't build alone; merged into s02 |
| ✅ **s02** Create HTTP error class and handler<br>errorHandler middleware catches a thrown HttpError (or generic error) and returns JSON with the correct status code | `errorHandler returns HttpError status and message as JSON`<br>`errorHandler returns 500 for a generic thrown error`<br>`loadConfig derives defaults and reads env overrides` |  |
| ⚠️ **s03** Define the Link data model<br>The project compiles with a Link interface describing all properties of a shortened link | — | no runtime check: This step only adds a TypeScript interface (Link), erased at compile time with no runtime code in dist/links/link.js. There's nothing callable to assert on, so no meaningful behavior |

## Code Generation and Storage

Build the pieces that create short codes and keep links somewhere: a random code/alias generator and an in-memory store.

| Step | Checks | |
|---|---|---|
| ✅ **s04** Generate short codes and validate aliases<br>generateCode() returns a random code of the requested length from the safe alphabet, and isValidAlias() correctly accepts/rejects alias strings | `generateCode returns correct length and alphabet`<br>`isValidAlias accepts/rejects per rules` |  |
| ✅ **s05** Build in-memory link storage<br>LinksStore can save a Link, retrieve it by code, check existence, list all links, and delete one by code | `save/get/has/all/delete roundtrip a Link`<br>`multiple links and overwrite by code` |  |

## Link Service: Business Rules

Combine storage, code generation, and validation into the service layer that creates, fetches, tracks visits on, and ranks links.

| Step | Checks | |
|---|---|---|
| ⚠️ **s06** Validate and normalize submitted URLs<br>parseUrl() normalizes a valid URL string and throws an HttpError (400) for malformed input | — | no runtime check: parseUrl is a private, non-exported function in links.service.ts; only the type-only interface CreateLinkInput is exported, which has no runtime representation after compilation. Not |
| ✅ **s07** Create links with alias and code generation<br>LinksService.create() returns a new Link, accepting a valid custom alias or generating a unique code, and rejects reserved, duplicate, or invalid aliases | `create() rejects reserved alias, duplicate alias, and invalid format`<br>`create() without alias generates unique code and computes expiresAt` |  |
| ✅ **s08** Fetch and remove links by code<br>LinksService.get() returns the stored Link or throws HttpError 404, and LinksService.remove() deletes a link by code | `LinksService.get() throws HttpError 404 for unknown code`<br>`LinksService.get() returns the stored link for an existing code`<br>`LinksService.remove() deletes a link, and removing twice throws 404` |  |
| ✅ **s09** Track visits and rank top links<br>LinksService.visit() increments the visit count and returns the destination URL, throwing HttpError 410 once a link has expired, and topLinks() returns links ordered by visit count | `visit() increments visits, sets lastVisitAt, returns url`<br>`visit() throws 410 for an expired link`<br>`topLinks() orders links by visit count and respects limit` |  |

## Routes and Server

Expose the service over HTTP with REST and redirect routes, wire everything into an Express app, and boot the server.

| Step | Checks | |
|---|---|---|
| ✅ **s10** Expose REST API routes for links<br>POST /api/links creates a link and returns 201 with a shortUrl field; GET /api/links/top, GET /api/links/:code, and DELETE /api/links/:code all respond correctly | `POST /api/links returns 201 with shortUrl`<br>`GET /api/links/top and GET /api/links/:code respond correctly`<br>`DELETE /api/links/:code removes the link and returns 204` |  |
| ✅ **s11** Add public redirect route<br>GET /:code redirects (302) to the link's destination URL and responds 410 when the link has expired | `GET /:code redirects 302 to destination URL`<br>`GET /:code responds 410 when link is expired` |  |
| ✅ **s12** Assemble the Express application<br>createApp() returns a fully wired Express app where the API router, the redirect router, and the error handler all work together on one instance | `errorHandler is wired: unknown code yields JSON 404 error`<br>`custom links instance passed to createApp is used by the wired app` |  |
| ✅ **s13** Boot the server<br>Running the entry point starts a listening server using the loaded configuration and logs a startup message with the service URL | `node dist/server.js listens and logs its URL` |  |

## Analysis

| Stage | Time | AI calls |
|---|---|---|
| Scan and code graph | 0 s | — |
| Summaries | 213 s | 5 |
| Learning path | 63 s | 1 |
| Reference timeline | 60 s | — |
| Checks | 376 s | 12 |
| **Total** | **712 s** | **18** |

Models: summaries `haiku`, planning `sonnet`, checks `sonnet`.
Tokens: 211763 in, 35740 out · provider estimate ≈ $0.58
