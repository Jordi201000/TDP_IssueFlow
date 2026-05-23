# Phase 13 — Auto-Assignment + `GET /projects/:id/workload`

> Final phase. Closes the longest-standing interim gap: tickets created without an explicit `assigneeId` have been staying `null` since Phase 4. Now they get auto-assigned to the least-loaded DEVELOPER in the project. Adds the `GET /projects/:id/workload` endpoint. Membership is derived per revised D5 (`projects.owner_id ∪ DISTINCT tickets.assignee_id` — no separate table).

## Goal

Implement spec §3.8 in full. Two behaviors:

1. **Auto-assign on ticket creation** when `assigneeId` is absent: pick the DEVELOPER in the project with the fewest non-DONE tickets (in that project), tie-break by user registration order (oldest first). If no DEVELOPER is linked, leave `assigneeId = null` without error. Emit `AUTO_ASSIGN` audit with `actor: SYSTEM`.
2. **`GET /projects/:projectId/workload`** returns `[{ userId, username, openTicketCount }]` for all members (ADMIN + DEVELOPER), sorted by `openTicketCount` ascending.

## Scope (in)

1. `WorkloadModule` + `WorkloadService` + `WorkloadController`.
2. `WorkloadService`:
   - `getMemberIds(projectId)` — derived membership: `owner_id ∪ DISTINCT tickets.assignee_id (non-null)`.
   - `pickAutoAssignee(projectId)` — used by `TicketsService.create`. Returns `number | null`.
   - `getWorkload(projectId)` — public endpoint. Validates project exists → 404 if missing.
3. **`TicketsService.create` change:** when `dto.assigneeId` is absent, call `workload.pickAutoAssignee(projectId)`. If non-null, set `assigneeId` and emit one extra `AUTO_ASSIGN` audit (`actor: SYSTEM, performedBy: null`).
4. `GET /projects/:projectId/workload` endpoint mounted via `WorkloadController`.
5. Unit tests for `WorkloadService` (member derivation, pick + tie-break, no-devs, workload sort) and `TicketsService.create` extension (auto-assign emit, null when no devs).

## Scope (out — deferred)

- **Re-balance on ticket DONE** (a DONE ticket frees up a slot) — not in spec; happens naturally on the next create call.
- **Manual `/projects/:id/members` endpoints** — D5 keeps membership implicit.
- **Auto-assign on PATCH** — spec explicitly says "Auto-assignment is not triggered on ticket update, only on creation".

## API Contract (per README, literal)

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/projects/:projectId/workload` | Required | `200 [{ userId, username, openTicketCount }]` sorted ASC. 404 if project missing/soft-deleted. |

Plus cross-cutting change to `POST /tickets`:
- When `assigneeId` is omitted from the body, the response now contains a non-null `assigneeId` (the auto-pick) if any DEVELOPER is linked. Still `null` if none. No new error cases.

## Derived Membership Query

```ts
async getMemberIds(projectId: number): Promise<number[]> {
  const ids = new Set<number>();
  const project = await this.projects.findOne({ where: { id: projectId } });
  if (!project) return [];
  ids.add(project.ownerId);
  const ticketsWithAssignee = await this.tickets.find({
    where: { projectId, assigneeId: Not(IsNull()) },
    select: ['assigneeId'],
  });
  for (const t of ticketsWithAssignee) {
    if (t.assigneeId !== null) ids.add(t.assigneeId);
  }
  return [...ids];
}
```

Soft-deleted tickets excluded by TypeORM default. Soft-deleted projects also return `[]` (the `findOne` filter applies).

## Auto-Assign Algorithm

```ts
async pickAutoAssignee(projectId: number): Promise<number | null> {
  const memberIds = await this.getMemberIds(projectId);
  if (memberIds.length === 0) return null;

  // DEVELOPER members only, ordered oldest-first by user id (registration order).
  const devs = await this.users.find({
    where: { id: In(memberIds), role: Role.DEVELOPER },
    order: { id: 'ASC' },
  });
  if (devs.length === 0) return null;

  // Count non-DONE tickets assigned to each dev in THIS project.
  const tickets = await this.tickets.find({
    where: {
      projectId,
      status: Not(TicketStatus.DONE),
      assigneeId: In(devs.map((d) => d.id)),
    },
    select: ['assigneeId'],
  });
  const counts = new Map<number, number>();
  for (const d of devs) counts.set(d.id, 0);
  for (const t of tickets) {
    if (t.assigneeId !== null) {
      counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
    }
  }

  // devs already sorted by id ASC; iterate to find min, first-found wins ties.
  let pick = devs[0].id;
  let pickCount = counts.get(pick) ?? 0;
  for (const d of devs) {
    const c = counts.get(d.id) ?? 0;
    if (c < pickCount) {
      pick = d.id;
      pickCount = c;
    }
  }
  return pick;
}
```

Tie-break correctness depends on iterating in `id ASC` order and using `<` (not `<=`). Verified by unit test.

## Workload Endpoint

```ts
async getWorkload(projectId: number): Promise<WorkloadEntry[]> {
  await this.projects.findOne({ where: { id: projectId } }).then((p) => {
    if (!p) throw new NotFoundException(`Project ${projectId} not found`);
  });

  const memberIds = await this.getMemberIds(projectId);
  if (memberIds.length === 0) return [];

  const users = await this.users.find({
    where: { id: In(memberIds) },
    order: { id: 'ASC' },
  });

  const tickets = await this.tickets.find({
    where: {
      projectId,
      status: Not(TicketStatus.DONE),
      assigneeId: In(memberIds),
    },
    select: ['assigneeId'],
  });
  const counts = new Map<number, number>();
  for (const u of users) counts.set(u.id, 0);
  for (const t of tickets) {
    if (t.assigneeId !== null) {
      counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
    }
  }

  return users
    .map((u) => ({
      userId: u.id,
      username: u.username,
      openTicketCount: counts.get(u.id) ?? 0,
    }))
    .sort((a, b) => a.openTicketCount - b.openTicketCount);
}
```

Sort stable on count; ties keep user-id-ASC order (since `users` is pre-sorted).

## TicketsService.create Change

In `create()`, just before the `this.tickets.create({...})` block:

```ts
let assigneeId = dto.assigneeId ?? null;
let autoAssigned = false;
if (assigneeId === null) {
  assigneeId = await this.workload.pickAutoAssignee(dto.projectId);
  autoAssigned = assigneeId !== null;
}
// Keep the existing manual-assignee validation only for the manual path.
if (!autoAssigned && dto.assigneeId !== undefined && dto.assigneeId !== null) {
  ...existing validation...
}
```

Then after `repo.save(ticket)` returns `saved`, in addition to the existing `CREATE` audit:

```ts
if (autoAssigned) {
  await this.audit.record({
    action: AuditAction.AUTO_ASSIGN,
    entityType: AuditEntityType.TICKET,
    entityId: saved.id,
    actor: AuditActor.SYSTEM,
    performedBy: null,
    payload: { assigneeId: saved.assigneeId },
  });
}
```

The `AUTO_ASSIGN` emit is unconditional on `ctx` — it's a SYSTEM action with no user-actor source. Same pattern as Phase 12's `AUTO_ESCALATE` (which fires from cron, also unconditional on ctx).

## File Layout

```
src/workload/
├── workload.module.ts
├── workload.controller.ts
├── workload.service.ts
└── workload.service.spec.ts
```

Modified:
- [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) — inject `WorkloadService`; auto-assign + audit in `create()`.
- [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) — import `WorkloadModule`.
- [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) — add `WorkloadService` mock + 3 new tests.
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — register `WorkloadModule`.

`WorkloadModule` registers `TypeOrmModule.forFeature([Project, Ticket, User])` directly. No `TicketsModule` / `ProjectsModule` / `UsersModule` import → keeps the dependency graph acyclic (same pattern as Phase 7 + Phase 12).

## Unit Tests (Phase 13)

`workload.service.spec.ts`:

1. `getMemberIds` returns `[]` for missing project.
2. `getMemberIds` returns `[ownerId]` when no tickets exist.
3. `getMemberIds` unions owner with distinct ticket assignees.
4. `pickAutoAssignee` returns `null` when no devs in project.
5. `pickAutoAssignee` picks the only dev when one exists.
6. `pickAutoAssignee` picks the dev with the lowest open-ticket count.
7. `pickAutoAssignee` tie-breaks by registration order (oldest first by user id).
8. `pickAutoAssignee` ignores ADMIN members.
9. `getWorkload` includes ADMIN + DEVELOPER members.
10. `getWorkload` sorts by `openTicketCount` ascending.
11. `getWorkload` returns `[]` for project with only owner and no tickets and... actually owner counts, returns owner with 0. Adjust to: returns single-entry list when only owner.
12. `getWorkload` throws NotFound on missing project.

`tickets.service.spec.ts` (extension):

13. `create` calls `pickAutoAssignee` and sets `assigneeId` when omitted.
14. `create` emits `AUTO_ASSIGN` audit when auto-assigned, regardless of ctx.
15. `create` leaves `assigneeId = null` and skips audit when `pickAutoAssignee` returns null.

Total new: **~15 tests.** Running total post-Phase 13: **~222.**

## Acceptance Criteria

- [ ] Build clean. 207 prior tests pass; ~15 new pass.
- [ ] Live probes:
  - Register an ADMIN (alice) and two DEVELOPERs (bob, carol). Create a project owned by bob.
  - `POST /tickets` without `assigneeId` → auto-assigned to **bob** (only dev member, owner). Audit shows one `AUTO_ASSIGN` row.
  - `POST /tickets` with explicit `assigneeId: carol` → carol assigned manually (no AUTO_ASSIGN audit).
  - `POST /tickets` without `assigneeId` (3rd ticket) → carol now a member (added via explicit assign in step 2); bob has 1 open, carol has 1 open → tie → picks **bob** (oldest by registration). Audit `AUTO_ASSIGN`.
  - `POST /tickets` (4th) → bob has 2 open, carol has 1 → picks **carol**. Audit.
  - `GET /projects/<pid>/workload` → `[{userId:carol, count:2}, {userId:bob, count:2}]` (or `[{bob:2},{carol:2}]` depending on which gets the 4th — sorted by count, stable id ASC for ties).
  - Mark bob's ticket DONE: `PATCH ... {status:"DONE"}` (need to pass DONE-blocker check which is auto-empty here). Workload should update.
  - Create project owned by alice (ADMIN). `POST /tickets` without assignee → `assigneeId: null` (no DEVELOPER members). No AUTO_ASSIGN audit.
  - `GET /projects/<alice-pid>/workload` → `[{userId:alice, count:0}]` (alice IS a member as owner; she just can't be auto-assignee).
  - `GET /projects/9999/workload` → 404.
  - No-auth → 401.

## Risks / Notes

- **`pickAutoAssignee` queries 3 tables per create.** Acceptable at assignment scale. Production would batch or denormalize a workload counter.
- **Race condition:** two concurrent creates could pick the same dev. No locking. Acceptable for assignment scope; documented.
- **Soft-deleted tickets** don't count toward workload — verified by TypeORM default behavior.
- **DONE tickets** don't count — explicit `status: Not(DONE)` filter.
- **DONE'ing a ticket** doesn't trigger a re-assignment of other tickets; spec only mandates re-eval on create.
- **`AUTO_ASSIGN` audit emit is unconditional on ctx** — same exception as Phase 12's `AUTO_ESCALATE`. SYSTEM actions don't need a USER ctx.
- **First-ticket-in-project edge case:** if owner is ADMIN, no DEVELOPERs are linked → `assigneeId: null`. Spec-faithful.
- **Phase 4's "interim gap"** (omitted assignee stays null) is now closed.
