# Feature 07 — Ticket Dependencies (+ DONE-blocker integration)

**Plan:** [feature_plans/07-ticket-dependencies.md](../feature_plans/07-ticket-dependencies.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 132/132 unit tests pass. 11 live probes pass, including the cycle-detection DFS and the new DONE-blocker rule that closes the long-standing `// TODO Phase 7` marker in `TicketsService`.

## What this feature delivers

Three endpoints from spec §3.2 (add / list / remove blockers), plus the cross-cutting rule "a ticket cannot transition to DONE if it has unresolved blockers". First feature that **modifies the behavior of an existing service** (TicketsService.update) rather than just adding new endpoints. Adds `TICKET_DEPENDENCY` audit emit using the enum value reserved in Phase 6.

## Endpoints

| Method | Path | Body | Status | Notes |
|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/dependencies` | `{ blockedBy: number }` | 200 / 400 / 404 | `@HttpCode(200)`; idempotent on duplicate; 400 self/cross-project/cycle; 404 if either ticket missing |
| `GET` | `/tickets/:ticketId/dependencies` | — | 200 / 404 | Returns slim `[{ id, title, status }]` per README |
| `DELETE` | `/tickets/:ticketId/dependencies/:blockerId` | — | 200 / 404 | 404 if edge not present |

Plus the cross-cutting change to `PATCH /tickets/:id`:
- New 400 case: `"Ticket cannot transition to DONE: open blockers [<ids>]"` when `dto.status === DONE` and any blocker is non-DONE.

## Key Logic

- **Composite PK** `(ticket_id, blocker_id)`. No FK constraints (consistent with the rest of the model). Validation at write time only.
- **Same-project guard:** `add` rejects pairs where `ticket.projectId !== blocker.projectId` with an explicit 400. Per spec §3.2.
- **Self-dependency guard:** `ticketId === blockerId` → 400 short-circuit before any DB hit.
- **Idempotent add:** if the `(ticketId, blockerId)` row already exists, the service returns silently — no second insert, no second audit emit. Matches the README (which doesn't list a 409 response).
- **Cycle detection** via DFS: walk blockers-of-blockers starting at the proposed `blockerId`. If `ticketId` appears in the closure, adding the edge would close a cycle → 400.
- **DONE-blocker rule:** `TicketsService.update` calls `openBlockerIds(id)` when `dto.status === DONE`. The helper queries `Repository<TicketDependency>` directly (no `DependenciesService` import) — avoids a circular module dep without `forwardRef`. Returns `number[]` of blockers whose status is not DONE.
- **Audit emit** on actual insert / delete only (idempotent re-add does NOT emit). `entityType: TICKET_DEPENDENCY`, `entityId: ticketId`, `payload: { blockerId }`.

## How Implemented

| File | Role |
|---|---|
| [src/dependencies/entities/ticket-dependency.entity.ts](../issueflow-typescript/src/dependencies/entities/ticket-dependency.entity.ts) | `ticketId, blockerId` composite PK; `createdAt` |
| [src/dependencies/dto/add-dependency.dto.ts](../issueflow-typescript/src/dependencies/dto/add-dependency.dto.ts) | `blockedBy @IsInt @IsPositive` |
| [src/dependencies/dependencies.service.ts](../issueflow-typescript/src/dependencies/dependencies.service.ts) | add/listBlockers/remove + private `wouldCreateCycle` DFS |
| [src/dependencies/dependencies.controller.ts](../issueflow-typescript/src/dependencies/dependencies.controller.ts) | Nested under `/tickets/:ticketId/dependencies`; pulls `@CurrentUser()` for audit ctx |
| [src/dependencies/dependencies.module.ts](../issueflow-typescript/src/dependencies/dependencies.module.ts) | Imports `TicketsModule` + `AuditLogModule`; exports `DependenciesService` |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | **Modified:** `Repository<TicketDependency>` injected; new `openBlockerIds(id)` helper; `// TODO Phase 7` replaced with real check |
| [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) | **Modified:** registers `TicketDependency` in `TypeOrmModule.forFeature` |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `DependenciesModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/dependencies/dependencies.service.spec.ts](../issueflow-typescript/src/dependencies/dependencies.service.spec.ts) | add happy + audit, self-dep, missing ticket, cross-project, idempotent, cycle; listBlockers slim + 404; remove happy + 404 | 10 |
| [src/dependencies/dto/add-dependency.dto.spec.ts](../issueflow-typescript/src/dependencies/dto/add-dependency.dto.spec.ts) | Valid; missing; non-positive | 3 |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) (extension) | Rejects DONE when open blockers; allows DONE when blockers cleared | 2 |

`npm test` → **132/132 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15).

## Live Verification (against Postgres on 5433)

11 probes — every behavior matched the plan. Notable sequences:

```
POST /tickets/1/dependencies {blockedBy:2}                       → 200  (audit: CREATE)
POST same                                                        → 200  (idempotent — NO second audit row)
GET  /tickets/1/dependencies                                     → [{"id":2,"title":"T2","status":"TODO"}]
POST self ({blockedBy:1})                                        → 400  "A ticket cannot block itself"
POST cross-project ({blockedBy:3 where project differs})         → 400  "Tickets 1 and 3 belong to different projects"
POST cycle (T2 blocked by T1, while T1 already blocked by T2)    → 400  "Adding this dependency would create a cycle"
PATCH /tickets/1 {status:DONE} while T2 still TODO               → 400  "Ticket cannot transition to DONE: open blockers [2]"
(Move T2 → DONE, then) PATCH /tickets/1 {status:DONE}            → 200
DELETE /tickets/1/dependencies/2                                 → 200  (audit: DELETE)
GET  /tickets/1/dependencies                                     → []
DELETE same                                                      → 404
```

Audit log confirmed exactly 2 `TICKET_DEPENDENCY` rows (CREATE + DELETE) — idempotent re-add did not emit.

## Deviations / Notes

1. **Idempotent add** chosen over 409 — matches README's response listing (no error code shown).
2. **No `forwardRef`** between `TicketsModule` and `DependenciesModule`. `TicketsService` directly injects `Repository<TicketDependency>` for the DONE check; `DependenciesService` lives in its own module with its own copy of the same TypeORM repository binding.
3. **Dependency rows persist when a ticket is soft-deleted.** `listBlockers` filters out blockers that resolve to a missing/soft-deleted ticket (because `TicketsService.findOne` throws → caught), so the API surface stays clean even though the DB rows remain. Flagged for `run.md`.
4. **Cycle detection is N queries** in the worst case. Acceptable for the graph sizes this assignment exercises.

## Cross-cutting Hooks Available for Later Phases

- `TicketStatus.DONE` is now consumed by both `update()` (existing) and `openBlockerIds()` — same source of truth via `src/common/enums/ticket-status.enum.ts`.
- `DependenciesService` is exported but not currently consumed by any other module. Available for Phase 13 if auto-assignment ever needs to consider dependency graphs.
- `AuditEntityType.TICKET_DEPENDENCY` has now been exercised in production (already in the enum since Phase 6).
- Pattern for "service A needs to query B's table without circular import" — register the entity in A's `TypeOrmModule.forFeature` and inject the repo. Useful in Phase 11 (CommentsService needs CommentMention) and Phase 13 (Tickets workload query joins).
