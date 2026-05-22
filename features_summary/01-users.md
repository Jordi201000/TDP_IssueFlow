# Feature 01 — Users CRUD

**Plan:** [feature_plans/01-users.md](../feature_plans/01-users.md)
**Approved:** 2026-05-22
**Status:** Done. Build clean. 21/21 unit tests pass. Every README endpoint verified live against Postgres.

## What this feature delivers

A `Users` module exposing the user registry that every later feature references. CRUD endpoints match the README contract literally, including the non-REST `POST /users/update/:userId`. Password support added per the locked decision (the spec requires `/auth/login` to accept a password but doesn't name the field).

## Endpoints

| Method | Path | Status | Body | Notes |
|---|---|---|---|---|
| `GET` | `/users` | 200 | — | List, no password leak |
| `GET` | `/users/:userId` | 200 / 404 | — | 404 in uniform error shape |
| `POST` | `/users` | 200 / 400 / 409 | `{ username, email, fullName, role, password }` | `@HttpCode(200)` to match README literally (Nest default 201 overridden); 409 on duplicate `username` or `email` |
| `POST` | `/users/update/:userId` | 200 / 400 / 404 | `{ fullName?, role? }` | Literal README path. Only `fullName` + `role` accepted; any other field (including `password`) is rejected by `forbidNonWhitelisted` |
| `DELETE` | `/users/:userId` | 200 / 404 | — | Hard delete (per spec §3.5, only Projects/Tickets soft-delete) |

## Key Logic

- **Passwords** hashed with bcrypt (cost 10) in `UsersService.create`. Plain `password` never persisted, never returned.
- **Response hygiene** via `@Exclude()` on `passwordHash` and `createdAt`, enforced by a global `ClassSerializerInterceptor` registered in [main.ts](../issueflow-typescript/src/main.ts). Adding the interceptor was a Phase-0-adjacent retrofit owned by this phase.
- **Unique-violation translation**: `QueryFailedError` thrown by TypeORM is mapped to `ConflictException` with the colliding field name in the message. Detection works across Postgres (`23505`), SQLite (`SQLITE_CONSTRAINT_UNIQUE`), and MySQL (`ER_DUP_ENTRY`) — so the same code path works for runtime Postgres and the in-memory SQLite test DB.
- **NotFound translation**: `findOne`/`update`/`remove` all throw `NotFoundException("User <id> not found")` when the row is missing, which the global filter renders as a uniform 404 JSON.
- **Validation**: `class-validator` decorators on DTOs run via the global `ValidationPipe`. `whitelist + forbidNonWhitelisted` strips unknown fields and rejects them with 400 + `details[]`.
- **Update path safety**: `UpdateUserDto` only declares `fullName?` and `role?`. Even if a client sneaks a `password` past validation, `UsersService.update` ignores it (defense in depth — covered by a unit test).

## How Implemented

| File | Role |
|---|---|
| [src/users/entities/user.entity.ts](../issueflow-typescript/src/users/entities/user.entity.ts) | Entity: `id, username (unique), email (unique), fullName, role, passwordHash @Exclude, createdAt @Exclude` |
| [src/users/dto/create-user.dto.ts](../issueflow-typescript/src/users/dto/create-user.dto.ts) | `IsEmail`, `IsEnum(Role)`, `@Matches` on username, password length 8–128 |
| [src/users/dto/update-user.dto.ts](../issueflow-typescript/src/users/dto/update-user.dto.ts) | Only `fullName?`, `role?` (matches README) |
| [src/users/users.service.ts](../issueflow-typescript/src/users/users.service.ts) | bcrypt hash, cross-dialect unique-violation detection, NotFound translation |
| [src/users/users.controller.ts](../issueflow-typescript/src/users/users.controller.ts) | Literal README endpoints + `@HttpCode(200)` on create/update/remove |
| [src/users/users.module.ts](../issueflow-typescript/src/users/users.module.ts) | Wires entity + service; exports `UsersService` for Phase 2 (auth) |
| [src/main.ts](../issueflow-typescript/src/main.ts) | **Modified:** added global `ClassSerializerInterceptor` |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `UsersModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/users/users.service.spec.ts](../issueflow-typescript/src/users/users.service.spec.ts) | bcrypt hashing, Postgres + SQLite unique-violation → 409, NotFound on findOne/update/remove, update ignores non-allowed fields, non-unique errors rethrown | 11 |
| [src/users/dto/create-user.dto.spec.ts](../issueflow-typescript/src/users/dto/create-user.dto.spec.ts) | Valid payload accepted; bad role, short password, invalid email, bad username characters all flagged | 5 |

`npm test` → **21/21 passing** (4 filter + 1 health + 11 service + 5 DTO).

## Live Verification (against Postgres on 5433)

12 probes covered the happy paths and every edge: valid create → 200 with no password leak, duplicate → 409, invalid role + short password → 400 with `details[]`, unknown field → 400 (`forbidNonWhitelisted`), missing id → 404 in uniform shape, update persists, update with `password` rejected, delete works, post-delete fetch returns 404. All matched README.

## Deviations / Notes

1. **`password` added to `POST /users` body** — required by `/auth/login`, not in the README schema. Pre-locked decision; documented again here so it's traceable.
2. **`@HttpCode(200)` on POST `create`/`update`/`remove`** — README explicitly says 200 OK; Nest defaults to 201/200/200, so only `create` needed the override.
3. **Hard delete** — Users are *not* soft-deleted; spec §3.5 reserves soft delete for Projects/Tickets.
4. **No auth yet** — Endpoints are wide open until Phase 2 lands `JwtAuthGuard` globally. Acceptable for this phase only.
5. **Skeleton e2e test orphaned** — [test/app.e2e-spec.ts](../issueflow-typescript/test/app.e2e-spec.ts) still references the deleted `AppController` and would fail under `npm run test:e2e`. To be replaced with per-feature e2e tests in Phase 14 (Quality & docs).

## Cross-cutting Hooks Available for Later Phases

- `UsersService` is exported by `UsersModule` — Phase 2 (Auth) consumes it for login lookups; later phases use `findOne(id)` to resolve `assigneeId` / `authorId` / mentions.
- `User` entity is the foreign-key target for: Project.ownerId (Phase 3), ProjectMember (Phase 3), Ticket.assigneeId (Phase 4), Comment.authorId (Phase 5), CommentMention.mentionedUserId (Phase 11), AuditLog.performedBy (Phase 6).
- `passwordHash` is the field Phase 2's login flow will bcrypt-compare against.
- Global `ClassSerializerInterceptor` is now active — every later entity can use `@Exclude()` and trust it'll be stripped from responses.
