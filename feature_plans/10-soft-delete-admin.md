# Phase 10 — Soft-Delete Admin Endpoints (list + restore for Tickets & Projects)

> Small but important phase. Adds the four ADMIN-only endpoints from spec §3.5 — list deleted + restore — for both Tickets and Projects. Exercises `RolesGuard` + `@Roles(Role.ADMIN)` (built in Phase 2 but never used yet) and adds the `RESTORE` audit action (reserved in the enum since Phase 6).

## Goal

Four endpoints, each `@Roles(ADMIN)`-gated. Reuses TypeORM's built-in `softDelete` / `restore` semantics on the existing `@DeleteDateColumn` columns. No new entities. Audit emit on each restore. Route-ordering: `@Get('deleted')` declared before parametric `@Get(':ticketId')` / `@Get(':projectId')` (same pattern as Phase 9 `export`).

## Scope (in)

1. `ProjectsService`:
   - `findDeleted()` → list soft-deleted projects only.
   - `restore(id, ctx?)` → TypeORM `repo.restore(id)`; 404 if no row affected. Audit emit.
2. `TicketsService`:
   - `findDeletedByProject(projectId)` → list soft-deleted tickets for a project.
   - `restore(id, ctx?)` → same pattern. Audit emit.
3. `ProjectsController`:
   - `@Get('deleted')` + `@Roles(ADMIN)` (declared BEFORE `@Get(':projectId')`).
   - `@Post(':projectId/restore')` + `@Roles(ADMIN)`.
4. `TicketsController`:
   - `@Get('deleted')` + `@Roles(ADMIN)` (declared before `@Get(':ticketId')`, after the existing `@Get('export')`).
   - `@Post(':ticketId/restore')` + `@Roles(ADMIN)`.
5. Audit emits use the existing `AuditAction.RESTORE` value (reserved in Phase 6).
6. Unit tests for the new service methods + a small "RolesGuard blocks DEVELOPER" live probe pair.

## Scope (out — deferred)

- "Permanent delete" / purge — spec explicitly forbids it ("Permanent (hard) deletion is not exposed through the API").
- Cascade restore for related rows (comments, dependencies, attachments) — they were never soft-deleted; restoring a ticket simply makes it visible again with all its existing relations intact.

## API Contract (per README, literal)

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| `GET` | `/tickets/deleted?projectId={id}` | **ADMIN** | — | `200 [{ id, title, status, priority, type, projectId }]` / 400 / 403 |
| `POST` | `/tickets/:ticketId/restore` | **ADMIN** | — | `200` (empty) / 403 / 404 |
| `GET` | `/projects/deleted` | **ADMIN** | — | `200 [{ id, name, description, ownerId }]` / 403 |
| `POST` | `/projects/:projectId/restore` | **ADMIN** | — | `200` (empty) / 403 / 404 |

`403 Forbidden` (with `"Insufficient role"` from `RolesGuard`) when a non-ADMIN authenticated user calls any of these. 401 still applies when no token is presented.

## Service Behaviors

```ts
// ProjectsService
async findDeleted(): Promise<Project[]> {
  return this.projects.find({
    where: { deletedAt: Not(IsNull()) },
    withDeleted: true,
  });
}

async restore(id: number, ctx?: AuditContext): Promise<void> {
  const result = await this.projects.restore(id);
  if (!result.affected) {
    throw new NotFoundException(`Soft-deleted project ${id} not found`);
  }
  if (ctx) await this.audit.record({
    action: AuditAction.RESTORE,
    entityType: AuditEntityType.PROJECT,
    entityId: id,
    actor: ctx.actor,
    performedBy: ctx.performedBy,
  });
}
```

Tickets analog: same shape, `withDeleted: true` + `Not(IsNull())` filter, narrowed by `projectId`.

`Not(IsNull())` requires both imports from typeorm. Verified portable across Postgres + SQLite.

## File Layout

No new files. Modifications only:

- [src/projects/projects.service.ts](../issueflow-typescript/src/projects/projects.service.ts) — `findDeleted` + `restore` methods.
- [src/projects/projects.controller.ts](../issueflow-typescript/src/projects/projects.controller.ts) — `@Get('deleted')` (before `:projectId`) + `@Post(':projectId/restore')`, both `@Roles(ADMIN)`.
- [src/projects/projects.service.spec.ts](../issueflow-typescript/src/projects/projects.service.spec.ts) — 4 new tests.
- [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) — `findDeletedByProject` + `restore` methods.
- [src/tickets/tickets.controller.ts](../issueflow-typescript/src/tickets/tickets.controller.ts) — `@Get('deleted')` (after `export`, before `:ticketId`) + `@Post(':ticketId/restore')`, both `@Roles(ADMIN)`.
- [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) — 4 new tests.

## Unit Tests (Phase 10)

**`projects.service.spec.ts`:**
1. `findDeleted` queries with `withDeleted` + `Not(IsNull())`.
2. `restore` calls `repo.restore` + emits audit.
3. `restore` throws NotFound on `affected === 0`.
4. `restore` skips audit when ctx omitted.

**`tickets.service.spec.ts`:**
5. `findDeletedByProject` queries with `withDeleted` + `Not(IsNull())` + projectId filter.
6. `restore` calls `repo.restore` + emits audit.
7. `restore` throws NotFound on `affected === 0`.
8. `restore` skips audit when ctx omitted.

Total new: **~8 tests.** Running total post-Phase 10: **~173.**

## Acceptance Criteria

- [ ] Build clean. All 165 prior tests still pass; ~8 new pass.
- [ ] Live probes:
  - Register two users — one ADMIN, one DEVELOPER. Login as each, capture tokens.
  - Soft-delete a project and a ticket as ADMIN.
  - As DEVELOPER:
    - `GET /tickets/deleted?projectId=...` → **403** "Insufficient role"
    - `GET /projects/deleted` → 403
    - `POST /tickets/:id/restore` → 403
    - `POST /projects/:id/restore` → 403
  - As ADMIN:
    - `GET /projects/deleted` → 200 with the soft-deleted row visible
    - `GET /tickets/deleted?projectId=...` → 200 with the soft-deleted row
    - `POST /projects/:id/restore` → 200; subsequent `GET /projects/:id` (any user) → 200 (no longer hidden); subsequent `GET /projects/deleted` → without that row
    - `POST /tickets/:id/restore` → 200; subsequent `GET /tickets/:id` → 200; subsequent `GET /tickets/deleted` → without that row
    - `POST /tickets/9999/restore` (never soft-deleted, or doesn't exist) → 404
  - Route collision: with the new `GET /tickets/deleted`, `GET /tickets/1` must still work (the literal "deleted" segment shouldn't be parsed as ticketId).
  - Audit log shows two new `RESTORE` rows (one TICKET, one PROJECT) with `performedBy` = the admin user id.

## Risks / Notes

- **`Not(IsNull())` on `deletedAt`** is the cleanest cross-dialect filter; TypeORM compiles it to `IS NOT NULL` everywhere we run.
- **No state-merge surprises on restore** — restoring a project doesn't touch its tickets' `deleted_at` (tickets are soft-deleted independently). Spec doesn't ask for cascade restore.
- **`@Roles(Role.ADMIN)` finally exercised end-to-end** — `RolesGuard` was registered globally in Phase 2 but no endpoint had used the decorator until now. Live probes will confirm the `Insufficient role` 403 actually triggers.
- **Restoring a ticket whose project is still soft-deleted:** the ticket becomes visible to direct queries (`GET /tickets/:id`), but `GET /tickets?projectId=<deleted-project-id>` requires the project to be alive. Edge case worth verifying live: would currently still return 200-with-tickets even though the parent project is soft-deleted (we don't validate project existence on `findAllByProject`). Acceptable per spec; flagged for `run.md`.
