# Feature 04 — Tickets CRUD (+ status lifecycle, DONE lock, optimistic locking, soft delete)

**Plan:** [feature_plans/04-tickets.md](../feature_plans/04-tickets.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 83/83 unit tests pass. 16 live probes pass, including the full ETag chain (1→2→3) and the DB-level soft-delete confirmation.

## What this feature delivers

The core domain entity. Three new enums, an entity with `@VersionColumn` + `@DeleteDateColumn` + nullable `dueDate` + `isOverdue` flag, full CRUD per the README contract, forward-only status lifecycle with DONE lock, and **optimistic locking surfaced via HTTP `ETag` / `If-Match`** per the locked decision. The Ticket entity is the FK target for Comments (Phase 5), Dependencies (Phase 7), Attachments (Phase 8), Mentions (Phase 11), Escalation (Phase 12), and Auto-Assignment (Phase 13).

## Endpoints

| Method | Path | Auth | Status | Headers | Notes |
|---|---|---|---|---|---|
| `GET` | `/tickets?projectId=:id` | Required | 200 / 400 | — | Mandatory `projectId` query param; 400 if missing/non-numeric |
| `GET` | `/tickets/:ticketId` | Required | 200 / 404 | **`ETag: "<version>"`** | Response excludes `version`, `createdAt`, `updatedAt`, `deletedAt` |
| `POST` | `/tickets` | Required | 200 / 400 | **`ETag: "1"`** | `@HttpCode(200)`; required: title, description, status, priority, type, projectId. Optional: assigneeId, dueDate. 400 if project/assignee missing or enum invalid. |
| `PATCH` | `/tickets/:ticketId` | Required | 200 / 400 / 404 / **409** / **428** | Request: `If-Match: "<n>"` Response: new `ETag` | Empty body; only title/description/status/priority/assigneeId/dueDate accepted; DONE lock; forward-only transitions. |
| `DELETE` | `/tickets/:ticketId` | Required | 200 / 404 | — | **Soft delete** |

## Key Logic

- **Status lifecycle:** `TODO → IN_PROGRESS → IN_REVIEW → DONE`. Forward + skip-forward allowed (e.g., `TODO → DONE`). Backward rejected (400). Same-status no-op allowed. Once `status === DONE`, any update rejected with 400 (DONE lock).
- **Optimistic locking via HTTP ETag / If-Match:**
  - All `GET`/`POST` responses include `ETag: "<version>"`. Implemented by an `EtagInterceptor` registered at controller scope that reads the entity's `version` *before* the global `ClassSerializerInterceptor` strips it.
  - `PATCH` requires `If-Match: "<n>"`. Missing → **428 Precondition Required** (`PreconditionRequiredException`). Malformed → 400. Mismatch → **409 Conflict** (`ConflictException`).
  - `PATCH` response sets new `ETag` from the freshly-bumped version (TypeORM `@VersionColumn` auto-increments on `save`).
- **FK validation in the service** (no DB constraints): create rejects missing `projectId` (400) and missing `assigneeId` if provided (400). Update similarly rejects unknown `assigneeId`.
- **Allowed-update whitelist:** `update()` only mutates `title, description, status, priority, assigneeId, dueDate`. Even if a sneaky field passes the DTO (it won't — `forbidNonWhitelisted` catches it), the service ignores it.
- **Soft delete via `@DeleteDateColumn`**: same pattern as Projects. `repo.softDelete(id)` sets `deleted_at`; queries auto-hide soft-deleted rows.
- **`dueDate`** is accepted on create/update as an ISO-8601 string and stored as a `timestamp` column. **`isOverdue`** defaults to `false` and is never set by Phase 4 — Phase 12 will manage it.

## How Implemented

| File | Role |
|---|---|
| [src/common/enums/ticket-status.enum.ts](../issueflow-typescript/src/common/enums/ticket-status.enum.ts) | Enum + `TICKET_STATUS_ORDER` + `isForwardOrSame(from, to)` helper |
| [src/common/enums/ticket-priority.enum.ts](../issueflow-typescript/src/common/enums/ticket-priority.enum.ts) | `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` |
| [src/common/enums/ticket-type.enum.ts](../issueflow-typescript/src/common/enums/ticket-type.enum.ts) | `BUG`/`FEATURE`/`TECHNICAL` |
| [src/common/exceptions/precondition-required.exception.ts](../issueflow-typescript/src/common/exceptions/precondition-required.exception.ts) | `HttpException` subclass → 428 with `error: "PreconditionRequiredException"` |
| [src/tickets/entities/ticket.entity.ts](../issueflow-typescript/src/tickets/entities/ticket.entity.ts) | Entity with `@VersionColumn` + `@DeleteDateColumn` + `@Exclude` on `version`/timestamps; `dueDate type: 'timestamp'` |
| [src/tickets/dto/create-ticket.dto.ts](../issueflow-typescript/src/tickets/dto/create-ticket.dto.ts) | All status/priority/type required; `@IsISO8601()` on `dueDate?` |
| [src/tickets/dto/update-ticket.dto.ts](../issueflow-typescript/src/tickets/dto/update-ticket.dto.ts) | Only title/description/status/priority/assigneeId/dueDate; `type` & `projectId` not allowed |
| [src/tickets/helpers/if-match.ts](../issueflow-typescript/src/tickets/helpers/if-match.ts) | `parseIfMatch("<n>")` → number; throws `BadRequestException` on malformed |
| [src/tickets/interceptors/etag.interceptor.ts](../issueflow-typescript/src/tickets/interceptors/etag.interceptor.ts) | Sets `ETag: "<version>"` from response entity's `version` field |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | Project+assignee validation, version+DONE+transition checks, soft delete, `// TODO Phase 7: refuse if dto.status===DONE && hasOpenBlockers` |
| [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) | Literal README contract; `@Headers('if-match')` + `@Res({passthrough:true})` to set new ETag on PATCH |
| [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) | Imports `ProjectsModule` + `UsersModule`; exports `TicketsService` for Phases 5/7/11/12/13 |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `TicketsModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) | create-with-defaults, 400 on missing project, 400 on missing assignee, findAllByProject filter, findOne happy + 404, update 428 (no If-Match), update 409 (mismatch), update 400 (DONE lock), update 400 (backward), update no-op (same), update TODO→IN_PROGRESS, update TODO→DONE (skip), update 400 (missing assignee), update whitelist defense, softDelete happy + 404 | 16 |
| [src/tickets/dto/create-ticket.dto.spec.ts](../issueflow-typescript/src/tickets/dto/create-ticket.dto.spec.ts) | Valid full, valid minimal, bad status/priority/type (parameterized), missing title, bad ISO dueDate | 8 |
| [src/tickets/helpers/if-match.spec.ts](../issueflow-typescript/src/tickets/helpers/if-match.spec.ts) | undefined→undefined, `"5"`/`"0"`/`"42"`→ints, unquoted/empty/non-numeric/trailing-text all throw | 6 |
| [src/tickets/interceptors/etag.interceptor.spec.ts](../issueflow-typescript/src/tickets/interceptors/etag.interceptor.spec.ts) | Sets header with numeric version, skips without version, skips on null/undefined response | 3 |

`npm test` → **83/83 passing** (5 + 16 + 15 + 14 + 33).

## Live Verification (against Postgres on 5433)

16 probes — every one matched the plan. Key sequences:

**Full ETag chain across two PATCHes:**
```
POST /tickets        → 200 + ETag "1"
PATCH (If-Match "1") → 200 + ETag "2"   (TODO → IN_PROGRESS)
PATCH (If-Match "2") → 200 + ETag "3"   (IN_PROGRESS → DONE, skipping IN_REVIEW)
PATCH (If-Match "3") → 400 "Ticket is DONE and cannot be updated"
```

**DB state at end:**
```
 id |     title     | status | version | soft_deleted
 ---+---------------+--------+---------+-------------
  1 | Fix login bug | DONE   |       3 | f
  2 | deletable     | TODO   |       2 | t
```

Other verified behaviors: 400 with explicit message on missing project/assignee, 400 with `details[]` on bad enum, 400 on `GET /tickets` without `projectId`, 404 on missing/soft-deleted ticket, 428 on missing `If-Match`, 409 on stale `If-Match`, 400 on backward transition, 400 with `forbidNonWhitelisted` on `projectId` in PATCH body, soft-delete hidden from `GET` but row still present in DB with `deleted_at` set.

## Bug Caught + Fixed During Live Verify

**Problem:** Planned `type: 'datetime'` for `dueDate` doesn't exist in Postgres (it's MySQL/SQLite-only). Unit tests passed (mocked repos), but real DB init failed with `DataTypeNotSupportedError: Data type "datetime" in "Ticket.dueDate" is not supported by "postgres" database`.

**Fix:** Changed `type: 'datetime'` → `type: 'timestamp'`. Works in both Postgres (TIMESTAMP) and better-sqlite3. One-line change; all 83 unit tests still pass; live verification then proceeded cleanly.

**Lesson for future entities:** mocked-repo tests don't exercise schema validity. Live boot is the only check for column-type / dialect issues. Added to the implicit checklist for Phases 5+.

## Locked Decisions Confirmed

- **Forward-with-skip interpretation:** `TODO → DONE` allowed. Verified live.
- **428 on missing If-Match.** Verified live.
- **Interim gap on omitted `assigneeId`:** field stays `null` until Phase 13 lands auto-assignment. Acknowledged and accepted.

## Deviations / Notes

1. **`type: 'timestamp'` instead of `'datetime'` for `dueDate`** — plan deviation caught by live verify.
2. **No audit-log entry yet** on ticket CRUD. Phase 6 backfills.
3. **No dependency blocker check** when transitioning to DONE — `// TODO Phase 7` marker left at the relevant point in `update()`.
4. **No auto-assignment** on omitted `assigneeId` — Phase 13.
5. **`isOverdue` always `false`** until Phase 12 scheduler lands.

## Cross-cutting Hooks Available for Later Phases

- `TicketsService` exported by `TicketsModule` — Phase 5 uses `findOne(ticketId)` to validate parent on comment-create; Phase 7 uses it for dependencies; Phase 8 for attachments; Phase 11 for mention persistence; Phase 12 for escalation scan; Phase 13 for workload counts.
- `EtagInterceptor` + `parseIfMatch` — currently in `src/tickets/`; **will likely move to `src/common/` when Phase 5 (Comments) reuses them** (Comments also need optimistic locking per spec §2.5).
- `PreconditionRequiredException` already in `src/common/exceptions/`, ready for reuse.
- `Ticket.id` is the FK target for `Comment.ticketId` (5), `TicketDependency.{ticketId, blockerId}` (7), `Attachment.ticketId` (8).
- `TicketStatus.DONE` constant is the workload-counting filter for Phase 13 (`count WHERE status != DONE`).
- `TICKET_STATUS_ORDER` + `isForwardOrSame` available if any future feature needs lifecycle reasoning.
