# Phase 0 — Foundation

> Pre-requisite for every other feature. No business endpoints yet — only platform wiring.

## Goal

A NestJS 11 application that boots, connects to PostgreSQL (via `compose.yml`) for dev and to SQLite-in-memory for tests, applies global validation and uniform error responses, and exposes a single `GET /health` route. All later features plug into this skeleton without modifying it.

## Scope (in)

1. Upgrade skeleton from NestJS 10 → 11.
2. Add runtime + dev dependencies needed across the project.
3. Env-driven configuration via `@nestjs/config`.
4. TypeORM wiring via `forRootAsync`, switchable between PG (runtime) and SQLite-in-memory (tests).
5. Global `ValidationPipe` (whitelist, forbidNonWhitelisted, transform).
6. Global `AllExceptionsFilter` → uniform JSON error shape.
7. `@Public()` and `@Roles()` decorators **(declarations only — guards land in Phase 2)**.
8. `GET /health` route returning `{ status: "ok", uptime, timestamp }`.
9. `.env.example`.

## Scope (out — explicitly deferred)

- JWT auth, guards (Phase 2).
- Any domain entity (Users start in Phase 1).
- Migrations (using `synchronize: true` per locked decisions).

## Dependency Changes

**Upgrade to ^11.0.0:** `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/typeorm`, `@nestjs/cli` (dev), `@nestjs/schematics` (dev), `@nestjs/testing` (dev).

**Add (runtime):**
- `@nestjs/config` — env loading
- `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` — JWT auth (added now; used in Phase 2)
- `@nestjs/schedule` — auto-escalation cron (used in Phase 12)
- `bcrypt` — password hashing (used in Phase 1)

**Add (dev):**
- `@types/passport-jwt`, `@types/bcrypt`
- `better-sqlite3` — test DB

## Configuration

`.env.example`:
```
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USER=issueflow
DB_PASS=issueflow
DB_NAME=issueflow

JWT_SECRET=change-me-in-prod
JWT_TTL_SECONDS=3600
```

Loader: `src/config/configuration.ts` returns a typed config object. `ConfigModule.forRoot({ isGlobal: true, load: [configuration] })` in `AppModule`.

## TypeORM Wiring

`TypeOrmModule.forRootAsync({ useFactory: (config) => ({ ... }) })`:
- Default factory reads `DB_*` envs → `type: 'postgres'`.
- When `NODE_ENV === 'test'` → returns `type: 'better-sqlite3'`, `database: ':memory:'`, `dropSchema: true`.
- `synchronize: true` (per locked decisions).
- `autoLoadEntities: true` so feature modules register entities via `TypeOrmModule.forFeature([...])` without central registration.

## File Layout (after Phase 0)

```
src/
├── main.ts                                  (rewritten — global pipe + filter + listen)
├── app.module.ts                            (rewritten — Config + TypeORM + Health)
├── app.controller.ts                        (deleted)
├── app.service.ts                           (deleted)
├── app.controller.spec.ts                   (deleted)
├── config/
│   └── configuration.ts                     (NEW)
├── common/
│   ├── filters/
│   │   ├── all-exceptions.filter.ts         (NEW)
│   │   └── all-exceptions.filter.spec.ts    (NEW — unit test)
│   ├── decorators/
│   │   ├── public.decorator.ts              (NEW — IS_PUBLIC_KEY metadata)
│   │   └── roles.decorator.ts               (NEW — ROLES_KEY metadata)
│   └── enums/
│       └── role.enum.ts                     (NEW — ADMIN, DEVELOPER)
└── health/
    ├── health.module.ts                     (NEW)
    ├── health.controller.ts                 (NEW)
    └── health.controller.spec.ts            (NEW — unit test)

.env.example                                 (NEW, in issueflow-typescript/)
```

## Uniform Error Shape

```json
{
  "statusCode": 400,
  "error": "BadRequestException",
  "message": "validation failed",
  "details": ["email must be an email"],
  "timestamp": "2026-05-22T10:00:00.000Z",
  "path": "/users"
}
```

`AllExceptionsFilter` rules:
- `HttpException` → reuse its status + message; extract validation `details` from `getResponse().message` when array.
- Unknown error → 500, `error: "InternalServerError"`, message redacted in prod (`NODE_ENV === 'production'`).

## Unit Tests (Phase 0)

1. **`all-exceptions.filter.spec.ts`** — mocks `ArgumentsHost`, asserts:
   - `HttpException(400, ...)` produces `{ statusCode: 400, error: 'BadRequestException', ... }`
   - Validation array message lands in `details`
   - Unknown `Error` produces 500 with `error: 'InternalServerError'`
2. **`health.controller.spec.ts`** — asserts `GET /health` returns `{ status: 'ok' }` and includes `uptime`/`timestamp`.

## Acceptance Criteria

- [ ] `npm install` succeeds against new `package.json`.
- [ ] `npm run build` succeeds (no TS errors).
- [ ] `docker compose up -d` brings up Postgres; `npm run start` boots without errors and logs DB connection.
- [ ] `curl http://localhost:3000/health` returns 200 with `{ status: 'ok', ... }`.
- [ ] `npm test` passes (filter + health tests).
- [ ] An invalid request to a (future) endpoint returns the uniform error JSON (verified indirectly via filter unit test in this phase).

## Risks / Notes

- **NestJS 11** changed the minimum Node to 20.11; will note in `run.md` later.
- `better-sqlite3` requires native build tools on the host — accepted cost for fast tests.
- `synchronize: true` is fine for this assignment but **never** for production; will note in `run.md`.
