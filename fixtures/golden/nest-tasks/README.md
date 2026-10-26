# nest-tasks (golden fixture)

A small task tracker API in NestJS 12, used to test the KnYC pipeline on a NestJS project (#96).
Size: small (~300 lines), **with tests**. It follows `nest new`'s ESM layout (`"type": "module"`,
`nodenext`, Vitest), built with plain `tsc`.

## Architecture

```
src/main.ts                      bootstrap: NestFactory, listens on PORT
src/app.module.ts                root module: ConfigModule, TasksModule, HealthController
src/config/config.ts             loadConfig() (PORT, API_KEY, MAX_TITLE_LENGTH), the APP_CONFIG token
src/config/config.module.ts      global module providing APP_CONFIG
src/health/health.controller.ts  GET /health
src/tasks/task.entity.ts         Task, TaskStatus and the allowed status moves
src/tasks/tasks.repository.ts    in-memory repository
src/tasks/tasks.service.ts       business rules: title length, status moves, 404s
src/tasks/dto/create-task.dto.ts DTOs and the pipes that validate them
src/auth/api-key.guard.ts        x-api-key guard for changes
src/tasks/tasks.controller.ts    /tasks routes
src/tasks/tasks.module.ts        the tasks feature module
```

Expected build order: config → bootstrap and root module → health → entity → repository →
service → pipes → controller and module → guard.

## API

| Method | Path | |
|---|---|---|
| GET | /health | `{ status: "ok" }` |
| GET | /tasks?status= | list, optional status filter |
| GET | /tasks/:id | one task; 400 if the id isn't a number, 404 if missing |
| POST | /tasks | create (x-api-key, title required) → 201 |
| PATCH | /tasks/:id/status | move to todo / doing / done (x-api-key); done is final |
| DELETE | /tasks/:id | 204 (x-api-key) |

## Commands

```bash
npm install
npm run build
npm test
```
