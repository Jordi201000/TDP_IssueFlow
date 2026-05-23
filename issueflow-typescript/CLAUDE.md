# Claude orientation

Brief context for a fresh Claude session opening this repo. Repo conventions, code style, build/test commands → see **[AGENTS.md](AGENTS.md)** (cross-vendor guide, applies here verbatim).

## What this codebase is

A NestJS 11 / TypeORM / Postgres backend for the IssueFlow TDP 2026 home assignment. Spec at `../TDP_issueflow_requirements.pdf`. API contract at `README.md`.

## How the build was done (and how to continue if extending)

Strict per-feature cadence — one feature at a time:
1. **Plan** at `../feature_plans/<NN>-<name>.md` (scope, decisions, API contract, file layout, tests, acceptance criteria, risks)
2. **Approve** with the user
3. **Implement** code + unit tests
4. **Live verify** against real Postgres
5. **Approve** again
6. **Summary** at `../features_summary/<NN>-<name>.md`

Never bundle features. Never code before plan approval.

## Where to look first

- `../IMPLEMENTATION_PLAN.md` — top-level plan + locked-decisions table (stack, auth model, optimistic locking, audit log, soft delete, derived membership)
- `../features_summary/` — what each phase actually built, the live probes that passed, deviations
- `TESTING.md` — manual smoke-test runbook (`curl` commands per feature)
- `run.md` — install/build/run/test
- `prompts.md` — model used + representative prompts
- `AGENTS.md` — repo conventions

## Locked patterns (consistent across the codebase)

- **Audit log:** optional `ctx?: AuditContext` on every state-changing service method. Controllers pass ctx from `@CurrentUser()`. SYSTEM-actor audits (auto-escalate, auto-assign) fire unconditionally on ctx.
- **Optimistic locking** on Tickets + Comments: `ETag` on responses, `If-Match` on `PATCH`, missing → 428, mismatch → 409.
- **Soft delete** only on Projects + Tickets (per spec §3.5). Everything else hard delete.
- **Literal routes before parametric** in controllers: `@Get('export')` declared before `@Get(':ticketId')` in the same class, otherwise Express's order-based matcher tries to `ParseIntPipe` the literal segment.
- **Cross-feature reads** via `Repository<X>` injection — never service-to-service imports — to avoid circular module deps. Examples: TicketsService injects `Repository<TicketDependency>`; WorkloadService injects all three repos directly.
- **DTOs** use `@Transform(({value}) => Number(value))` for numeric coercion, not `@Type(() => Number)` (the latter broke test-isolation in Phase 6).
- **Route ordering vs guards:** `JwtAuthGuard` + `RolesGuard` are global (`APP_GUARD` providers in `AppModule`). Opt out with `@Public()`; require admin with `@Roles(Role.ADMIN)`.

## Stack-specific gotchas

- **Node 20.11+ required** — NestJS 11 uses global `crypto.randomUUID()` added in Node 19. If `nvm use 16` is the default, boot fails with `crypto is not defined`.
- **Postgres on host port 5433**, not 5432 — collision avoidance with many dev machines' native Postgres. Container's internal port stays 5432.
- **TypeORM 0.3 query builder joins** need entity classes, not table-name strings. Phase 11 hit this; fixed by `.innerJoin(CommentMention, 'cm', 'cm.commentId = c.id')`.
- **`type: 'timestamp'` for cross-dialect** Date columns (`'datetime'` is MySQL/SQLite-only and barfs on Postgres).
- **`synchronize: true`** for TypeORM — dev-only; never production.
- **`better-sqlite3` for test DB** via `NODE_ENV=test` — `simple-json` over `jsonb` for portability in `AuditLog.payload`.
