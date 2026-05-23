# Feature 10 — Soft-Delete Admin Endpoints (list + restore for Tickets & Projects)

**Plan:** [feature_plans/10-soft-delete-admin.md](../feature_plans/10-soft-delete-admin.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 173/173 unit tests pass. 13 live probes pass — RBAC finally exercised end-to-end.

## What this feature delivers

Four ADMIN-only endpoints from spec §3.5 that complete the soft-delete story (list-deleted + restore for both Projects and Tickets). First feature that actually uses `@Roles(Role.ADMIN)` + `RolesGuard` — both were built in Phase 2 but no endpoint had triggered them until now. Adds the `RESTORE` audit action (reserved in the enum since Phase 6).

## Endpoints

| Method | Path | Auth | Status | Notes |
|---|---|---|---|---|
| `GET` | `/tickets/deleted?projectId={id}` | **ADMIN** | 200 / 400 / 403 | Lists soft-deleted tickets in the project |
| `POST` | `/tickets/:ticketId/restore` | **ADMIN** | 200 / 403 / 404 | Clears `deleted_at`; emits RESTORE audit |
| `GET` | `/projects/deleted` | **ADMIN** | 200 / 403 | Lists soft-deleted projects |
| `POST` | `/projects/:projectId/restore` | **ADMIN** | 200 / 403 / 404 | Clears `deleted_at`; emits RESTORE audit |

DEVELOPER caller → `403 Forbidden` with `"Insufficient role"` (from `RolesGuard`). No token → 401 from `JwtAuthGuard`.

## Key Logic

- **`findDeleted` / `findDeletedByProject`** use `repo.find({ where: { deletedAt: Not(IsNull()) }, withDeleted: true })`. Cross-dialect portable (verified on Postgres; the same `IS NOT NULL` semantics apply to SQLite).
- **`restore`** calls TypeORM's `repo.restore(id)` (clears `deleted_at` for the row). 404 if `affected === 0` (either the id never existed, or it was never soft-deleted).
- **`@Roles(Role.ADMIN)`** applied to each of the four endpoints; the globally-registered `RolesGuard` reads `ROLES_KEY` via Reflector and throws `ForbiddenException("Insufficient role")` when the JWT's role isn't in the list.
- **Route ordering:** `@Get('deleted')` declared before `@Get(':projectId')` / `@Get(':ticketId')`. Express's order-based router matches the literal segment first. Verified live: `GET /tickets/1` still routes to `findOne(:ticketId)`, not to `findDeleted` with a malformed query.
- **Audit emit on restore** with `AuditAction.RESTORE`, no payload. `performedBy` from the ADMIN's JWT.

## How Implemented

| File | Role |
|---|---|
| [src/projects/projects.service.ts](../issueflow-typescript/src/projects/projects.service.ts) | **Modified:** `findDeleted()` + `restore(id, ctx?)` |
| [src/projects/projects.controller.ts](../issueflow-typescript/src/projects/projects.controller.ts) | **Modified:** `@Get('deleted')` + `@Post(':projectId/restore')`, both `@Roles(ADMIN)` |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | **Modified:** `findDeletedByProject(projectId)` + `restore(id, ctx?)` |
| [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) | **Modified:** `@Get('deleted')` (after `export`, before `:ticketId`) + `@Post(':ticketId/restore')`, both `@Roles(ADMIN)` |

No new files. Pure surgery on existing services/controllers.

## Tests

| File | Coverage | # |
|---|---|---|
| [src/projects/projects.service.spec.ts](../issueflow-typescript/src/projects/projects.service.spec.ts) (ext.) | `findDeleted` uses `withDeleted`; `restore` happy + audit; `restore` 404; `restore` skips audit without ctx | 4 |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) (ext.) | Same 4 patterns for `findDeletedByProject` + `restore` | 4 |

Both spec files' `audit` mock was promoted from inline to a captured `let audit: { record: jest.Mock }` in `beforeEach` so the new tests can assert on it. Existing tests unaffected.

`npm test` → **173/173 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20 + 13 + 8).

## Live Verification (against Postgres on 5433)

13 probes, full ADMIN/DEVELOPER comparison:

```
DEVELOPER:
  GET /projects/deleted                     → 403 Insufficient role
  GET /tickets/deleted?projectId=1          → 403 Insufficient role
  POST /projects/1/restore                  → 403 Insufficient role
  POST /tickets/1/restore                   → 403 Insufficient role

ADMIN:
  GET /projects/deleted                     → 200 [{ id:1, name:"P", ... }]
  GET /tickets/deleted?projectId=1          → 200 [{ id:1, title:"T", status:"TODO", ... }]
  GET /tickets/1 (still soft-deleted)       → 404 (route-collision OK; "deleted" segment
                                                 didn't match :ticketId)
  POST /projects/1/restore                  → 200
  GET /projects (DEVELOPER token)           → [{ id:1, ... }]  (restore visible to all)
  POST /tickets/1/restore                   → 200
  GET /tickets/1 after restore              → 200
  POST /tickets/9999/restore                → 404 "Soft-deleted ticket 9999 not found"
  GET /projects/deleted after restore       → []

Audit log filter (?action=RESTORE):
  id:10 RESTORE TICKET    entityId:1 performedBy:13
  id: 9 RESTORE PROJECT   entityId:1 performedBy:13
```

## Deviations / Notes

1. **No cascade restore.** Restoring a project doesn't restore its tickets, and vice versa — they were always soft-deleted independently. Spec doesn't ask for cascading.
2. **A restored ticket under a still-deleted project** is visible via direct fetch. Edge case worth knowing about; will mention in `run.md`.
3. **Audit `payload` is null for RESTORE** — entityId + performedBy + timestamp are enough to reconstruct who restored what when.
4. **No bulk restore endpoint** — README only declares per-id restore.

## Cross-cutting Hooks Available for Later Phases

- `AuditAction.RESTORE` is now exercised live.
- `@Roles(Role.ADMIN)` + `RolesGuard` proven to produce 403 in production code paths. Any future endpoint that needs role-gating can drop the decorator in (e.g., if an admin-only `/users` deletion is later wanted).
- The literal-route-before-parametric pattern is now consistent across `TicketsController` (`export`, `import`, `deleted` all before `:ticketId`) and `ProjectsController` (`deleted` before `:projectId`).
