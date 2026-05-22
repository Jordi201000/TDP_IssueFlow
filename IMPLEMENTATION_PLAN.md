# IssueFlow — Implementation Plan (v1)

> Source of truth for the IssueFlow TDP 2026 home assignment.
> Spec: [TDP_issueflow_requirements.pdf](TDP_issueflow_requirements.pdf)
> API contract: [issueflow-typescript/README.md](issueflow-typescript/README.md)

## Locked Decisions

| Topic | Decision |
|---|---|
| Stack | NestJS 11 + TypeScript, TypeORM, PostgreSQL (via `compose.yml`) |
| Auth | JWT, stateless, short expiry; bcrypt password hashes |
| Password field | Extends `POST /users` body (not in original README, documented in `run.md`) |
| Concurrent-edit prevention | Optimistic locking — TypeORM `@VersionColumn` on Ticket & Comment, exposed via HTTP `ETag` / `If-Match`, `409` on conflict |
| Project membership | Explicit `project_members` join table (best practice; required for auto-assignment) |
| Audit log | Synchronous `auditService.record(...)` calls inside service methods (captures both USER and SYSTEM actors) |
| Audit log filter | One field at a time (`entityType` / `entityId` / `action` / `actor`) |
| Soft delete | TypeORM `@DeleteDateColumn` on Project & Ticket |
| Test DB | SQLite in-memory via `better-sqlite3`; AuditLog payload as `simple-json` for portability |
| AI model | Claude Opus 4.7 |

## Architecture

**Per-feature module shape:**
```
src/<feature>/
  <feature>.module.ts
  <feature>.controller.ts
  <feature>.service.ts
  entities/<feature>.entity.ts
  dto/create-<feature>.dto.ts
  dto/update-<feature>.dto.ts
  <feature>.service.spec.ts
  <feature>.controller.e2e-spec.ts (in /test)
```

**Cross-cutting (`src/common/`, `src/config/`):**
- `ConfigModule` (env-driven, `.env` + `.env.example`)
- Global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`
- Global `AllExceptionsFilter` → `{ statusCode, error, message, details? }`
- `JwtAuthGuard` registered globally with `@Public()` opt-out
- `RolesGuard` + `@Roles('ADMIN')` decorator
- `OptimisticLockInterceptor` reading `If-Match`, mapping `OptimisticLockVersionMismatchError` → 409

## Data Model

| Entity | Notes |
|---|---|
| `User` | `id, username (unique), email (unique), fullName, role, passwordHash, createdAt` |
| `Project` | `id, name, description, ownerId`, `@DeleteDateColumn` |
| `ProjectMember` | `projectId, userId` (composite PK) |
| `Ticket` | `id, title, description, status, priority, type, projectId, assigneeId?, dueDate?, isOverdue`, `@VersionColumn`, `@DeleteDateColumn` |
| `Comment` | `id, ticketId, authorId, content`, `@VersionColumn` |
| `TicketDependency` | `ticketId, blockerId` (composite PK) |
| `Attachment` | `id, ticketId, filename, contentType, sizeBytes, storagePath, uploadedById, createdAt` |
| `AuditLog` | `id, action, entityType, entityId, performedBy?, actor (USER\|SYSTEM), payload (simple-json), timestamp` |
| `CommentMention` | `commentId, mentionedUserId` |

TypeORM `synchronize: true` for assignment scope (no migrations).

## Status Lifecycle (Tickets)

- Allowed: `TODO → IN_PROGRESS → IN_REVIEW → DONE` only
- `DONE` tickets reject all updates (400)
- Transition to `DONE` blocked if open dependencies exist (400 + blockers list)

## Implementation Order

| # | Feature | Why this slot |
|---|---|---|
| 0 | **Foundation** — upgrade to Nest 11, add deps, ConfigModule, TypeORM wiring, global pipes/filters, `.env.example`, health route | Everything else depends on it |
| 1 | **Users CRUD** | Identity precedes auth |
| 2 | **Authentication** (JWT login/logout/me, guards, RolesGuard) | Gates all subsequent endpoints |
| 3 | **Projects CRUD** (+ soft delete entity flag, ProjectMember table) | Required by Tickets |
| 4 | **Tickets CRUD** (lifecycle, optimistic lock, DONE-lock, soft delete) | Core domain; required by everything after |
| 5 | **Comments CRUD** (optimistic lock) | Final core domain piece |
| 6 | **Audit log** | Built *before* later features so they emit audit events from day one |
| 7 | **Ticket Dependencies** (+ block-DONE-if-unresolved rule) | Independent; small surface |
| 8 | **Attachments** (Multer, MIME/size validation) | Independent |
| 9 | **CSV Export/Import** | Independent; uses complete Ticket model |
| 10 | **Soft-delete admin endpoints** (`/tickets/deleted`, `/projects/deleted`, `/restore`) | Entities already soft-delete from step 3/4; this just exposes ADMIN endpoints |
| 11 | **@Mentions** | Touches Comment + User only |
| 12 | **Auto-Escalation scheduler** (`@nestjs/schedule`) | Background job; independent |
| 13 | **Auto-Assignment** (+ `/projects/:id/workload`) | Last — depends on ProjectMember (3), Tickets (4), Audit log (6) all being complete |
| 14 | **Quality & docs** — tests fleshed out, `run.md`, `prompts.md`, `CLAUDE.md` instruction file, `simplify` + `security-review` pass | End-of-line polish |

Per-feature detailed plans (entities, DTOs, endpoints, edge cases, tests) are produced one phase at a time, before code is written for that phase.

## Tooling Decisions

- **`CLAUDE.md`** instruction file at `issueflow-typescript/CLAUDE.md` (codifies conventions; also satisfies spec §4.5)
- No custom slash commands or hooks unless friction appears during implementation
- Built-in skills available: `verify`, `simplify`, `run`, `review`, `security-review`

## Open Items Resolved

All five questions from the planning conversation are resolved (see Locked Decisions above).
