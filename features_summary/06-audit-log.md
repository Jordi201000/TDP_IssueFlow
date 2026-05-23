# Feature 06 — Audit Log (+ backfill across Users / Auth / Projects / Tickets / Comments)

**Plan:** [feature_plans/06-audit-log.md](../feature_plans/06-audit-log.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 117/117 unit tests pass. 11 audit rows produced across 10 distinct `entityType × action` pairs in live verify, all filters work as specified.

## What this feature delivers

An append-only `AuditLog` of every state-changing action (USER + SYSTEM), with backfilled emit-points across all 5 existing services. Single-field filter on `GET /audit-logs`. Schema designed so Phases 7–13 can extend with new `action`/`entityType` values without migrations. Sets up the SYSTEM-actor pattern that Phase 12 (escalation) and Phase 13 (auto-assign) will consume.

## Endpoints

| Method | Path | Auth | Query | Response |
|---|---|---|---|---|
| `GET` | `/audit-logs` | Required | Optional **one of**: `entityType`, `entityId`, `action`, `actor` | `200 [{ id, action, entityType, entityId, performedBy, actor, payload, timestamp }]` |

- Multiple filters → **400** with explicit message
- Invalid enum value → 400 with `details[]`
- `entityId` accepts string or int (coerced to number)
- Sorted newest first by `(timestamp DESC, id DESC)` for stable ordering at sub-second resolution

## Key Logic

- **Sync, in-flow emit**: each state-changing service method calls `this.audit.record(...)` after a successful DB write, inside the same request. Failure to write the audit log is logged at ERROR but **never breaks the originating operation** (try/catch wrapper in `AuditLogService.record`).
- **Actor propagation via explicit optional `ctx?: AuditContext`** parameter at every backfilled service method. The controller pulls `req.user` via `@CurrentUser()` and passes `{ actor: AuditActor.USER, performedBy: me.userId }`. If `ctx` is omitted (existing tests don't pass it), the service skips the audit call — backwards-compatible.
- **Public registration (`POST /users` without a token):** controller passes `{ actor: USER, performedBy: null }`. Audit row's `entityId` is the new user's id; `performedBy` is null since there's no caller identity.
- **`AuthService.login`** records the LOGIN action itself (not through controller), since the actor identity is resolved inside the login flow.
- **Cross-dialect `payload`** column: `simple-json` type — TypeORM serializes to TEXT on SQLite, native JSON-ish on Postgres. Phase 12/13 will extend the payload shape without schema changes.
- **Single-filter contract** enforced by the controller, not the DTO — the DTO allows any combo of optional fields; the controller counts defined fields and throws if > 1. This keeps the DTO simple and the error message specific.

## How Implemented

| File | Role |
|---|---|
| [src/audit-log/entities/audit-log.entity.ts](../issueflow-typescript/src/audit-log/entities/audit-log.entity.ts) | `id, action, entityType, entityId, performedBy?, actor, payload (simple-json), timestamp` |
| [src/audit-log/enums/audit-action.enum.ts](../issueflow-typescript/src/audit-log/enums/audit-action.enum.ts) | CREATE, UPDATE, DELETE, RESTORE, LOGIN, AUTO_ASSIGN, AUTO_ESCALATE |
| [src/audit-log/enums/audit-actor.enum.ts](../issueflow-typescript/src/audit-log/enums/audit-actor.enum.ts) | USER, SYSTEM |
| [src/audit-log/enums/audit-entity-type.enum.ts](../issueflow-typescript/src/audit-log/enums/audit-entity-type.enum.ts) | USER, PROJECT, TICKET, COMMENT, ATTACHMENT, TICKET_DEPENDENCY |
| [src/audit-log/interfaces/audit-context.interface.ts](../issueflow-typescript/src/audit-log/interfaces/audit-context.interface.ts) | `{ actor, performedBy }` |
| [src/audit-log/dto/audit-log-query.dto.ts](../issueflow-typescript/src/audit-log/dto/audit-log-query.dto.ts) | All filters `@IsOptional + @IsEnum`; `entityId` `@Transform(Number)` for string-coercion |
| [src/audit-log/audit-log.service.ts](../issueflow-typescript/src/audit-log/audit-log.service.ts) | `record()` (try/catch around save), `findAll(filter)` with DESC ordering |
| [src/audit-log/audit-log.controller.ts](../issueflow-typescript/src/audit-log/audit-log.controller.ts) | `GET /audit-logs`; single-filter check returning 400 |
| [src/audit-log/audit-log.module.ts](../issueflow-typescript/src/audit-log/audit-log.module.ts) | Exports `AuditLogService` for consumer modules |

**Backfilled (12 files):**
- `users.service.ts`, `users.controller.ts`, `users.module.ts` (imports AuditLogModule)
- `auth.service.ts`, `auth.module.ts`
- `projects.service.ts`, `projects.controller.ts`, `projects.module.ts`
- `tickets.service.ts`, `tickets.controller.ts`, `tickets.module.ts`
- `comments.service.ts`, `comments.controller.ts`, `comments.module.ts`
- `app.module.ts` (registers `AuditLogModule`)

Each service gained an optional `ctx?: AuditContext` parameter on each state-changing method; each controller pulls `@CurrentUser()` and passes the ctx.

## Payload Shapes (current)

| Action | Payload |
|---|---|
| `CREATE` | `{ snapshot: { ...redacted entity } }` — passwords stripped |
| `UPDATE` | `{ changes: <dto>, version?: <new version for Ticket/Comment> }` |
| `DELETE` | `null` |
| `LOGIN` | `null` (entityId = user id, performedBy = user id) |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/audit-log/audit-log.service.spec.ts](../issueflow-typescript/src/audit-log/audit-log.service.spec.ts) | record persists, record swallows errors, findAll empty filter, findAll narrows by each filter (parameterized) | 7 |
| [src/audit-log/audit-log.controller.spec.ts](../issueflow-typescript/src/audit-log/audit-log.controller.spec.ts) | empty filter passthrough, single filter passthrough, multi-filter throws BadRequestException | 3 |
| [src/audit-log/dto/audit-log-query.dto.spec.ts](../issueflow-typescript/src/audit-log/dto/audit-log-query.dto.spec.ts) | empty valid, all enums valid, bad action enum, entityId string→int coercion | 4 |
| [src/users/users.service.spec.ts](../issueflow-typescript/src/users/users.service.spec.ts) (spot-check additions) | create(dto, ctx) → audit.record called; create(dto) → audit.record NOT called | 2 |

`npm test` → **117/117 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16).

## Live Verification (against Postgres on 5433)

After registering a user, logging in twice, then full CRUD on project/ticket/comment (including a soft-delete cycle):

```
 entity_type | action | count
 ------------+--------+-------
 COMMENT     | CREATE |     1
 COMMENT     | DELETE |     1
 PROJECT     | CREATE |     1
 PROJECT     | DELETE |     1
 PROJECT     | UPDATE |     1
 TICKET      | CREATE |     1
 TICKET      | DELETE |     1
 TICKET      | UPDATE |     1
 USER        | CREATE |     1
 USER        | LOGIN  |     2
```

Filter probes:
- `?action=LOGIN` → 2 rows
- `?entityType=PROJECT` → 3 rows (CREATE/UPDATE/DELETE for project 1)
- `?entityId=1` → 8 rows (everything with `entity_id=1` across types)
- `?entityType=TICKET&action=UPDATE` → 400 `"At most one filter is allowed..."`
- `?action=BOGUS` → 400 `details: ["action must be one of: CREATE, UPDATE, DELETE, RESTORE, LOGIN, AUTO_ASSIGN, AUTO_ESCALATE"]`

Public-registration entry inspected: `performedBy: null`, `payload.snapshot` excludes `passwordHash`.

## Fixes During Implementation

1. **`@Type(() => Number)` broke test-isolation loading** for the query DTO — swapped to `@Transform(({ value }) => Number(value))`. Same effect, no test-runner issue.
2. **Controller spec used `await expect(...).rejects.toThrow`** but the multi-filter check throws synchronously — changed to sync `expect(() => ...).toThrow(BadRequestException)`.

## Deviations / Notes

1. **No pagination** on `GET /audit-logs`. Could return thousands of rows in long-running dev. Acceptable for grading; flagged for `run.md` (Phase 14).
2. **Auth-required, no `@Roles(ADMIN)`** — spec §3.1 doesn't restrict access; any authenticated user can read the log.
3. **`payload: null` on DELETE/LOGIN** — minimal info captured; entityId + performedBy + timestamp are enough to reconstruct who did what when. Could expand if needed.
4. **Audit failures swallowed** — a DB lock on `audit_logs` won't break business operations, but data is silently dropped. Logged at ERROR. Right tradeoff for assignment scope.
5. **No emit for** RESTORE (Phase 10), AUTO_ASSIGN (Phase 13), AUTO_ESCALATE (Phase 12) — each phase's plan will add the emit when it lands.

## Cross-cutting Hooks Available for Later Phases

- `AuditLogService` exported by `AuditLogModule` — Phases 7, 8, 10, 11, 12, 13 will consume it the same way (constructor inject + `record(...)` after each state change).
- `AuditContext` interface + `@CurrentUser()` decorator together form the standard "USER actor" pattern. Phases 12/13 will use `{ actor: SYSTEM, performedBy: null }` from scheduler/auto-assign code.
- `AuditEntityType` already has `ATTACHMENT` and `TICKET_DEPENDENCY` reserved — Phases 7/8 can use them with no enum changes.
- The `optional ctx` pattern keeps existing test suites unmodified — Phase 7+ can follow the same pattern.
