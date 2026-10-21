# express-no-tests (golden fixture)

A URL shortener, used to test the KnYC pipeline. Size: small (~250 lines), **no tests at all**:
every check KnYC uses on this project has to be generated (HTTP requests, commands).

## Architecture

```
src/server.ts                  entry point
src/app.ts                     createApp(): JSON API, redirect route (last), error handler
src/config.ts                  PORT, BASE_URL, CODE_LENGTH
src/errors.ts                  HttpError + error middleware
src/links/link.ts              Link model
src/links/code-generator.ts    random short codes, alias rules, reserved codes
src/links/links.store.ts       in-memory store
src/links/links.service.ts     create (random code or alias, optional expiry), visit, stats, delete
src/links/links.routes.ts      /api/links router + public redirect router
```

## API

| Method | Path | |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| POST | /api/links | `{ url, alias?, expiresInMinutes? }` → 201 with `shortUrl` |
| GET | /api/links/top?limit= | most visited links |
| GET | /api/links/:code | link stats |
| DELETE | /api/links/:code | 204 |
| GET | /:code | 302 redirect, 404 unknown, 410 expired |

Errors: 400 invalid url / alias / expiry, 409 alias taken.

## Commands

```bash
npm install
npm run build
npm start
```
