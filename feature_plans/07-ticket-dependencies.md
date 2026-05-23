# Phase 7 — Ticket Dependencies (+ DONE-blocker integration in TicketsService)

> First Section-3 capability that touches an existing service's logic flow. Lands the `TicketDependency` entity + dedicated endpoints, then wires the long-standing `// TODO Phase 7` marker in `TicketsService.update` so a ticket cannot transition to `DONE` while it has unresolved (non-DONE) blockers.

## Goal

Three endpoints from spec §3.2 — add / list / remove. Both tickets must exist and belong to the same project (→ 400). The blocked-DONE constraint is enforced inside `TicketsService.update` (→ 400 with the list of open blockers). Standard audit emit on add/remove using `AuditEntityType.TICKET_DEPENDENCY` (already in the enum from Phase 6).

## Scope (in)

1. `TicketDependency` entity — composite PK `(ticketId, blockerId)`.
2. `AddDependencyDto` — `{ blockedBy: number }` per README.
3. `DependenciesService`:
   - `add(ticketId, blockerId, ctx?)` — validates both exist, same project, no self-dep, no cycle. Idempotent: if the edge already exists, returns silently (200 no-op).
   - `listBlockers(ticketId)` — verifies the parent ticket exists, returns a slim shape `[{ id, title, status }]` per README.
   - `remove(ticketId, blockerId, ctx?)` — composite delete; 404 if the edge isn't present.
4. `DependenciesController` nested under `/tickets/:ticketId/dependencies`.
5. **Wire into `TicketsService.update`**: when `dto.status === DONE`, query open blockers and throw 400 with the list if any are non-DONE. Replaces the `// TODO Phase 7` marker. Implemented by injecting `Repository<TicketDependency>` directly into `TicketsService` — avoids a circular module dep.
6. Audit emit on add/remove (`CREATE`/`DELETE`, `entityType: TICKET_DEPENDENCY`, `entityId: <ticketId>`, payload `{ blockerId }`).
7. Unit tests: service add/list/remove + cycle detection + same-project; integration test on `TicketsService.update` for the new DONE-blocker rule.

## Scope (out — deferred)

- Bulk dependency endpoints — not in README.
- Showing the inverse graph ("what does this ticket block?") — not in README.
- Auto-removing dependencies when a blocker is hard-deleted — tickets are soft-deleted, no hard-delete path; soft-delete leaves the row visible to direct queries via `withDeleted: true` if needed.

## API Contract (per README, literal)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/dependencies` | `{ "blockedBy": 42 }` | `200` (empty) / 400 / 404 | 404 if either ticket missing; 400 on cross-project / self / cycle; idempotent if edge exists |
| `GET` | `/tickets/:ticketId/dependencies` | — | `200 [{ id, title, status }]` / 404 | 404 if ticket missing/soft-deleted |
| `DELETE` | `/tickets/:ticketId/dependencies/:blockerId` | — | `200` (empty) / 404 | 404 if edge not present |

Plus the cross-cutting change:
| `PATCH /tickets/:id` with `{ status: "DONE" }` | New 400 case: `"Ticket cannot transition to DONE: open blockers [<ids>]"` |

## Entity

```ts
@Entity('ticket_dependencies')
export class TicketDependency {
  @PrimaryColumn({ name: 'ticket_id' }) ticketId: number;   // the blocked ticket
  @PrimaryColumn({ name: 'blocker_id' }) blockerId: number; // the ticket that blocks
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

No FKs (consistent with our existing model). Validation at write time only.

## DTOs

```ts
export class AddDependencyDto {
  @IsInt() @IsPositive() blockedBy: number;
}
```

## Service Behaviors (precise)

| Method | Behavior |
|---|---|
| `add(ticketId, blockerId, ctx?)` | 1) `ticketId !== blockerId` else 400 self-dep. 2) Load both via `TicketsService.findOne` → 404 if missing. 3) `ticket.projectId === blocker.projectId` else 400 cross-project. 4) Idempotent: if `(ticketId, blockerId)` exists → return silently. 5) `wouldCreateCycle(ticketId, blockerId)` → 400 cycle. 6) Insert + audit emit. |
| `listBlockers(ticketId)` | Load ticket (404 if missing). Find all `TicketDependency where ticket_id = ticketId`. Fetch the blocker tickets, return `[{ id, title, status }]`. |
| `remove(ticketId, blockerId, ctx?)` | `repo.delete({ ticketId, blockerId })`. If `affected === 0` → 404. Audit emit on success. |
| `hasOpenBlockers(ticketId)` (helper used by Tickets) | Returns `number[]` of blocker ids whose `status !== DONE`. Empty array = OK to mark DONE. |

**Cycle detection** — DFS from `blockerId` following `(ticketId → blockerId)` edges; if `ticketId` appears in the closure, the new edge would close a cycle.

## TicketsService Change

Replace this in `update()`:
```ts
// TODO Phase 7: when dto.status === DONE, refuse if open blockers exist.
```

With:
```ts
if (dto.status === TicketStatus.DONE) {
  const openBlockers = await this.openBlockerIds(id);
  if (openBlockers.length > 0) {
    throw new BadRequestException(
      `Ticket cannot transition to DONE: open blockers [${openBlockers.join(', ')}]`,
    );
  }
}
```

`openBlockerIds(id)` lives on `TicketsService` and queries `Repository<TicketDependency>` (injected directly via `TypeOrmModule.forFeature([Ticket, TicketDependency])` in `TicketsModule`). No circular import with `DependenciesModule`. Both modules can register the same entity safely.

## File Layout

```
src/dependencies/
├── dependencies.module.ts
├── dependencies.controller.ts
├── dependencies.service.ts
├── dependencies.service.spec.ts
├── entities/
│   └── ticket-dependency.entity.ts
└── dto/
    ├── add-dependency.dto.ts
    └── add-dependency.dto.spec.ts
```

Modified:
- [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) — register `TicketDependency` in `TypeOrmModule.forFeature`.
- [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) — inject `Repository<TicketDependency>`; add `openBlockerIds(id)`; replace TODO with DONE-blocker check.
- [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) — extend mock providers + add 2 tests for the new DONE-blocker rule.
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — register `DependenciesModule`.

## Audit Emits

| Action | Shape |
|---|---|
| `add` success (incl. idempotent no-op) | `CREATE, entityType: TICKET_DEPENDENCY, entityId: ticketId, payload: { blockerId }` (only emit on actual insert, not on no-op) |
| `remove` success | `DELETE, entityType: TICKET_DEPENDENCY, entityId: ticketId, payload: { blockerId }` |

## Unit Tests (Phase 7)

`dependencies.service.spec.ts` — mocked `Repository<TicketDependency>`, `TicketsService`, `AuditLogService`:

1. `add` happy: inserts when valid; calls `audit.record(CREATE)`.
2. `add` rejects self-dependency (`ticketId === blockerId`) → 400.
3. `add` rejects when ticket missing → 404.
4. `add` rejects when blocker missing → 404.
5. `add` rejects cross-project pair → 400 with explicit message.
6. `add` idempotent: existing edge → returns silently, no second insert, no audit emit.
7. `add` rejects cycle (B already blocks A, attempting A blocks B) → 400.
8. `listBlockers` returns slim `[{ id, title, status }]`.
9. `listBlockers` throws 404 when ticket missing.
10. `remove` happy: deletes + audit emit.
11. `remove` 404 when edge not present.

`add-dependency.dto.spec.ts`:
12. Valid; missing blockedBy; non-positive blockedBy.

`tickets.service.spec.ts` (extension — 2 new):
13. `update(..., { status: DONE })` throws 400 when `openBlockerIds` returns non-empty.
14. `update(..., { status: DONE })` succeeds when `openBlockerIds` returns empty.

Total new: **~14 tests.** Running total post-Phase 7: **~131.**

## Acceptance Criteria

- [ ] Build clean. All 117 prior tests still pass; ~14 new.
- [ ] Live probes (require JWT + a project with two tickets t1, t2 in it):
  - `POST /tickets/t1/dependencies` `{blockedBy: t2}` → 200, audit row inserted.
  - `POST` same again → 200 (idempotent, no second audit row).
  - `GET /tickets/t1/dependencies` → 200 with `[{id: t2, title, status}]`.
  - `POST` with `blockedBy: t1` (self) → 400.
  - `POST` with a blocker in a different project → 400 explicit message.
  - `POST` creating a cycle (t1↔t2) → 400.
  - `PATCH /tickets/t1 {status: DONE}` while t2 is still IN_PROGRESS → 400 `"open blockers [t2]"`.
  - Move t2 to DONE, then `PATCH /tickets/t1 {status: DONE}` → 200.
  - `DELETE /tickets/t1/dependencies/t2` → 200; subsequent `GET` returns `[]`; audit row recorded.
  - `DELETE` same again → 404.

## Risks / Notes

- **Cycle detection runs N queries.** Acceptable for assignment scale (graph is shallow). Production would precompute reachability or use a recursive CTE.
- **TicketsService now owns a small amount of "dependency awareness"** (`openBlockerIds`). Pragmatic over forwardRef. The dependency logic itself still lives in `DependenciesService`.
- **`TicketDependency` is hard-deleted via soft-deleted ticket?** When a ticket is soft-deleted, its dependency rows remain. `listBlockers` only resolves blocker tickets that are visible (not soft-deleted), so a deleted blocker effectively disappears from the list — but the DB row stays. Acceptable; flagged for `run.md`.
- **Idempotent add** chosen over 409 — matches the README's tone (no error response listed) and the practical reading of "add a dependency".
