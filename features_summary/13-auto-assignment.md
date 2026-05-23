# Feature 13 — Auto-Assignment + `GET /projects/:id/workload`

**Plan:** [feature_plans/13-auto-assignment.md](../feature_plans/13-auto-assignment.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 221/221 unit tests pass. 11 live probes pass, including the tie-break edge case (oldest dev wins) and ADMIN-only project (assignee stays null).

## What this feature delivers

Auto-assignment per spec §3.8: tickets created without an explicit `assigneeId` get assigned to the least-loaded DEVELOPER in the project; tie-break by oldest registration. `GET /projects/:projectId/workload` exposes the same workload view to clients. **Closes the Phase 4 interim gap** where omitted-assignee tickets stayed null forever. Second exercise of the `actor: SYSTEM` audit pattern (after Phase 12).

## Endpoints

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/projects/:projectId/workload` | Required | `200 [{ userId, username, openTicketCount }]` sorted ASC; 404 if project missing/soft-deleted |

Plus the cross-cutting change to `POST /tickets`:
- Body without `assigneeId` → response now contains the auto-picked DEVELOPER's id (or `null` if none linked). One extra `AUTO_ASSIGN` audit row emitted per actual auto-assignment.

## Key Logic

- **Membership derived per locked D5**: `projects.owner_id ∪ DISTINCT tickets.assignee_id (non-null)`. No `project_members` table. Soft-deleted projects/tickets auto-excluded by TypeORM.
- **`pickAutoAssignee(projectId)`** — get member ids, filter to DEVELOPER role (ordered by `id ASC` for tie-break), count non-DONE tickets per dev in *this* project, return the lowest. First-found wins ties because devs are pre-sorted. Returns `null` when no DEVELOPER is linked.
- **`getWorkload(projectId)`** — returns ALL members (ADMIN + DEVELOPER), not just devs. Spec §3.8 wording: "for all users in the project". Sorted by `openTicketCount` ASC; stable id-ASC for ties.
- **`AUTO_ASSIGN` audit emit is unconditional on `ctx`** — same pattern as Phase 12's `AUTO_ESCALATE`. SYSTEM-actor audits don't need a USER ctx; they always fire when the SYSTEM action occurs.
- **No `TicketsService` / `ProjectsService` / `UsersService` imports** in WorkloadModule — `Repository<Project, Ticket, User>` injected directly via `TypeOrmModule.forFeature`. Same circular-dep-avoidance pattern from Phases 7, 12.
- **No re-balance on DONE** — spec doesn't mandate it. Other tickets stay where they were; the next create call re-evaluates.

## How Implemented

| File | Role |
|---|---|
| [src/workload/workload.service.ts](../issueflow-typescript/src/workload/workload.service.ts) | `getMemberIds`, `pickAutoAssignee`, `getWorkload` |
| [src/workload/workload.controller.ts](../issueflow-typescript/src/workload/workload.controller.ts) | `GET /projects/:projectId/workload` |
| [src/workload/workload.module.ts](../issueflow-typescript/src/workload/workload.module.ts) | Imports `[Project, Ticket, User]`; exports `WorkloadService` for TicketsService |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | **Modified:** auto-assign block in `create()` + `AUTO_ASSIGN` audit emit |
| [src/tickets/tickets.module.ts](../issueflow-typescript/src/tickets/tickets.module.ts) | **Modified:** imports `WorkloadModule` |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) | **Modified:** mocks `WorkloadService` in providers + 3 new tests |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `WorkloadModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/workload/workload.service.spec.ts](../issueflow-typescript/src/workload/workload.service.spec.ts) | getMemberIds (missing/owner-only/union); pickAutoAssignee (no devs, single dev, least-loaded, tie-break, ADMIN-skipped); getWorkload (404, ADMIN+DEVELOPER sorted, defensive empty) | 11 |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) (ext.) | auto-pick wired; AUTO_ASSIGN audit fires without ctx; null pick → no audit | 3 |

`npm test` → **221/221 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20 + 13 + 8 + 23 + 11 + 14).

## Live Verification (against Postgres on 5433)

```
Users: alice (ADMIN, id 18), bob (DEV, id 19), carol (DEV, id 20)

P1 owner=bob (DEV)
  T1 no-assignee  → bob          (only dev member, auto)
  T2 explicit carol → carol       (manual, NO AUTO_ASSIGN audit)
  T3 no-assignee  → bob          (tie 1-vs-1, oldest by id wins)
  T4 no-assignee  → carol         (bob:2, carol:1 → least-loaded)

GET /projects/1/workload
  → [{bob, openTicketCount:2}, {carol, openTicketCount:2}]   sorted ASC; stable id order on tie

P2 owner=alice (ADMIN)
  T5 no-assignee  → null          (no devs linked)

GET /projects/2/workload → [{alice, openTicketCount:0}]      (ADMIN owner included, count 0)
GET /projects/9999/workload     → 404
GET /projects/1/workload no token → 401

Audit (?action=AUTO_ASSIGN) → 3 rows: T1, T3, T4. All actor:SYSTEM, performedBy:null, payload:{assigneeId}.
T2 (manual assign) produced NO AUTO_ASSIGN row — only the standard CREATE audit.
```

## Deviations / Notes

1. **No race-condition handling** — two concurrent creates could pick the same dev. Acceptable for assignment scope; would need transactional locking in prod.
2. **3 queries per `pickAutoAssignee` call** (project, users, tickets). Acceptable at this scale; would be batched/denormalized in prod.
3. **No re-balance on DONE** — only on create. Spec explicit on this.
4. **ADMIN-owned project with no other devs** → `assigneeId: null` on every auto-assign. Spec-faithful.
5. **Workload includes ADMINs** with count 0 (unless manually assigned tickets) — per locked D7.

## Cross-cutting Hooks (for Phase 14)

- **All 13 spec features are now implemented.** Audit pattern, SYSTEM actor, derived membership, optimistic locking, soft delete + restore, ETag/If-Match, multipart uploads, CSV roundtrip, cron, mentions, auto-assign — every architecture decision is live.
- **The Phase 4 interim gap is closed**: omitted-assignee tickets are now actually assigned.
- **221 unit tests** covering every service, every DTO validation, every key edge case.
- **No `// TODO Phase X` markers remain in the code.**
