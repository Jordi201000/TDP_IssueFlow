# Feature 00 — Foundation

**Plan:** [feature_plans/00-foundation.md](../feature_plans/00-foundation.md)
**Approved:** 2026-05-22
**Status:** Done. Live boot verified against Postgres.

## What this feature delivers

A bootable NestJS 11 application skeleton that every later feature plugs into without modifying. No business endpoints — only platform wiring + one `GET /health` route.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Liveness probe — returns `{ status, uptime, timestamp }` |

## Key Logic

- **Config:** `@nestjs/config` registered globally, loads typed `AppConfig` from env (`NODE_ENV`, `PORT`, `DB_*`, `JWT_*`). Defaults included so app boots without a `.env` file present.
- **Database:** `TypeOrmModule.forRootAsync` switches driver by `NODE_ENV`:
  - `test` → `better-sqlite3` in-memory, `dropSchema: true`
  - else → Postgres at `localhost:5433` (host port relocated, see below)
  - Both paths use `synchronize: true` and `autoLoadEntities: true` so feature modules just register entities via `TypeOrmModule.forFeature([...])` without central registration.
- **Validation:** Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` — every later DTO is enforced automatically.
- **Errors:** Global `AllExceptionsFilter` produces a uniform JSON shape: `{ statusCode, error, message, details?, timestamp, path }`. Validation arrays land in `details`. Unknown errors return 500 with redacted messages in production. 5xx errors logged via Nest `Logger`.
- **Auth decorators (declarations only, guards in Phase 2):** `@Public()` (sets `IS_PUBLIC_KEY` metadata), `@Roles(...roles)` (sets `ROLES_KEY` metadata). `Role` enum: `ADMIN`, `DEVELOPER`.

## How Implemented

| File | Role |
|---|---|
| [issueflow-typescript/package.json](../issueflow-typescript/package.json) | Upgraded all `@nestjs/*` packages to v11; added `@nestjs/config@4`, `@nestjs/jwt@11`, `@nestjs/passport@11`, `@nestjs/schedule@6`, `bcrypt`, `better-sqlite3`, type defs |
| [issueflow-typescript/src/config/configuration.ts](../issueflow-typescript/src/config/configuration.ts) | Typed env loader (`AppConfig` interface) |
| [issueflow-typescript/src/common/enums/role.enum.ts](../issueflow-typescript/src/common/enums/role.enum.ts) | `Role` enum |
| [issueflow-typescript/src/common/decorators/public.decorator.ts](../issueflow-typescript/src/common/decorators/public.decorator.ts) | `@Public()` metadata setter |
| [issueflow-typescript/src/common/decorators/roles.decorator.ts](../issueflow-typescript/src/common/decorators/roles.decorator.ts) | `@Roles(...)` metadata setter |
| [issueflow-typescript/src/common/filters/all-exceptions.filter.ts](../issueflow-typescript/src/common/filters/all-exceptions.filter.ts) | Global exception filter — uniform JSON shape |
| [issueflow-typescript/src/health/health.controller.ts](../issueflow-typescript/src/health/health.controller.ts) | `GET /health` |
| [issueflow-typescript/src/health/health.module.ts](../issueflow-typescript/src/health/health.module.ts) | Health module |
| [issueflow-typescript/src/main.ts](../issueflow-typescript/src/main.ts) | Bootstrap — `ValidationPipe` + `AllExceptionsFilter` + listen on config port |
| [issueflow-typescript/src/app.module.ts](../issueflow-typescript/src/app.module.ts) | `ConfigModule` global + `TypeOrmModule.forRootAsync` + `HealthModule` |
| [issueflow-typescript/.env.example](../issueflow-typescript/.env.example) | Template env file |
| [issueflow-typescript/compose.yml](../issueflow-typescript/compose.yml) | Postgres exposed on host `5433` (see note below) |

Removed: default `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`.

## Tests

| File | Coverage |
|---|---|
| [issueflow-typescript/src/common/filters/all-exceptions.filter.spec.ts](../issueflow-typescript/src/common/filters/all-exceptions.filter.spec.ts) | `HttpException` mapping, validation-array → `details`, unknown errors → 500, prod redaction |
| [issueflow-typescript/src/health/health.controller.spec.ts](../issueflow-typescript/src/health/health.controller.spec.ts) | `/health` returns status ok, valid uptime, valid timestamp |

`npm test` → **5/5 passing.**

## Live Verification

- `docker compose up -d` → Postgres on host `5433`
- `npm run start` (Node 20.20.0) → app boots, TypeORM connects
- `curl /health` → `{"status":"ok","uptime":3.48...,"timestamp":"..."}` (200)
- `curl /missing` → uniform 404 `{"statusCode":404,"error":"NotFoundException","message":"Cannot GET /missing","timestamp":"...","path":"/missing"}`

## Deviations / Notes for `run.md`

1. **Host port 5433 instead of 5432.** Native Postgres on many dev machines already binds `localhost:5432`, ahead of Docker. Container's internal port is still 5432 (Postgres convention); only the host mapping changed. `DB_PORT=5433` is the default in both `.env.example` and `configuration.ts`.
2. **Node 20.11+ required.** NestJS 11 hard requirement (uses global `crypto.randomUUID()` added in Node 19). Build succeeds on Node 16 but runtime fails — diagnostic to be included in `run.md`.
3. **Multer 1.x still pinned.** Has known CVEs; planned bump to 2.x in Phase 8 (Attachments) where it actually gets used.

## Cross-cutting Hooks Available for Later Phases

- `@Public()` decorator — used in Phase 2 to opt-out from the global `JwtAuthGuard`
- `@Roles(...)` decorator — used in Phase 2 by `RolesGuard` for ADMIN-only endpoints
- `Role` enum — referenced by every entity/DTO that needs the role concept
- `AllExceptionsFilter` — every later feature gets uniform errors for free
- `autoLoadEntities: true` — feature modules register their entities locally; no central entity list
