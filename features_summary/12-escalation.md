# Feature 12 — Auto-Escalation Scheduler (overdue tickets)

**Plan:** [feature_plans/12-escalation.md](../feature_plans/12-escalation.md)
**Approved:** 2026-05-23 (cron over on-write rescan, with reasoning documented)
**Status:** Done. Build clean. 207/207 unit tests pass. Live verification ran over ~5 minutes of real cron cycles and confirmed every §3.7 rule.

## What this feature delivers

A `@Cron('*/30 * * * * *')` background job that scans non-DONE, overdue tickets and bumps priority one step toward CRITICAL per cycle. Once CRITICAL and still overdue, flips `isOverdue=true`. Manual `PATCH` of `priority` clears the flag so the next cycle re-evaluates. First exercise of the `actor: SYSTEM` audit pattern (used again in Phase 13).

## Endpoints

**None added.** The escalation is invisible to clients except via:
- `priority` field changing on subsequent `GET /tickets/:id`
- `isOverdue: true` appearing when CRITICAL+overdue
- New `AUTO_ESCALATE` rows in `GET /audit-logs?action=AUTO_ESCALATE`

The cross-cutting addition: `PATCH /tickets/:id` with `priority` in the body now resets `isOverdue=false` (spec §3.7 "manual priority change resets the auto-escalation state").

## Key Logic

- **Cron cadence:** `CronExpression.EVERY_30_SECONDS` (`*/30 * * * * *`). Dev-friendly for grading; would be 5+ min in production.
- **`runEscalation()`** picks up where `@Cron` calls it. Public method so tests + (potential) future trigger paths share the same code.
- **Query filter:** `dueDate < now` AND `status != DONE`. NULL `dueDate` excluded by SQL semantics. Soft-deleted tickets excluded by TypeORM default.
- **State machine per ticket:**
  - `priority < CRITICAL` → `priority = nextPriority(priority)`; audit `{ from, to }`
  - `priority === CRITICAL && !isOverdue` → `isOverdue = true`; audit `{ priority: 'CRITICAL', isOverdue: true }`
  - `priority === CRITICAL && isOverdue` → no-op (idempotent — never escalated further)
- **Manual reset rule:** In `TicketsService.update`, when `dto.priority !== undefined`, set `ticket.isOverdue = false`. Lenient reading — any explicit touch of `priority` (even same value) clears the flag.
- **Audit emit:** Always `actor: SYSTEM, performedBy: null`. Only emits on actual mutations (no audit row for idempotent no-ops).
- **`@VersionColumn` bumps on escalation save.** A user's PATCH racing with an escalation would 409 — correct behavior (system changed state).
- **No `TicketsService` dependency** — `EscalationService` injects `Repository<Ticket>` directly. Same pattern as Phase 7 (DependenciesService). Avoids a circular import.

## How Implemented

| File | Role |
|---|---|
| [src/common/enums/ticket-priority.enum.ts](../issueflow-typescript/src/common/enums/ticket-priority.enum.ts) | **Modified:** added `PRIORITY_ORDER` + `nextPriority(p)` helper |
| [src/common/enums/next-priority.spec.ts](../issueflow-typescript/src/common/enums/next-priority.spec.ts) | Parameterized test for the helper |
| [src/escalation/escalation.service.ts](../issueflow-typescript/src/escalation/escalation.service.ts) | `@Cron('*/30 * * * * *') handleCron()` → `runEscalation()` |
| [src/escalation/escalation.module.ts](../issueflow-typescript/src/escalation/escalation.module.ts) | Registers `TypeOrmModule.forFeature([Ticket])` + `AuditLogModule` |
| [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) | **Modified:** 3-line manual-reset rule in `update()` |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** `ScheduleModule.forRoot()` + register `EscalationModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/common/enums/next-priority.spec.ts](../issueflow-typescript/src/common/enums/next-priority.spec.ts) | `LOW→MEDIUM`, `MEDIUM→HIGH`, `HIGH→CRITICAL`, `CRITICAL→CRITICAL` parameterized | 4 |
| [src/escalation/escalation.service.spec.ts](../issueflow-typescript/src/escalation/escalation.service.spec.ts) | No-overdue no-op; LOW→MEDIUM bump+audit; HIGH→CRITICAL; CRITICAL flag flip; CRITICAL idempotent; mixed batch | 6 |
| [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) (ext.) | Manual priority change clears `isOverdue` | 1 |

`npm test` → **207/207 passing** (5 + 16 + 15 + 14 + 33 + 18 + 16 + 15 + 20 + 13 + 8 + 23 + 11).

## Live Verification (against Postgres on 5433)

Real cron cycles over ~5 minutes:

```
T+0     LOW          (created with dueDate 5 min ago)
T+35    HIGH         (LOW→MEDIUM + MEDIUM→HIGH in two 30s ticks)
T+70    CRITICAL     (HIGH→CRITICAL)
T+105   CRITICAL+overdue=true  (flag flip)
T+140   no change    (idempotent)
T+175   no change    (idempotent)

Control ticket (future dueDate): stayed LOW throughout — only overdue tickets touched.

Manual reset:
  PATCH /tickets/1 {priority: HIGH}     → priority:HIGH, isOverdue:false
  +35s  → priority:CRITICAL, isOverdue:true  (re-bumped + re-flagged)
  +70s  → no change (idempotent again)

Audit (?action=AUTO_ESCALATE) shows 6 rows for ticket 1, all actor:SYSTEM, performedBy:null:
  payload {from:LOW, to:MEDIUM}
  payload {from:MEDIUM, to:HIGH}
  payload {from:HIGH, to:CRITICAL}
  payload {priority:CRITICAL, isOverdue:true}
  payload {from:HIGH, to:CRITICAL}            (after manual reset)
  payload {priority:CRITICAL, isOverdue:true} (re-flag)
```

## Locked Decisions

- **Cron over on-write rescan:** discussed and chosen. Spec wording ("auto-scheduling", "remain unresolved past a configured due date") implies time-based; on-read mutation breaks HTTP idempotency; untouched tickets would never escalate.
- **Lenient manual-reset trigger:** any `dto.priority !== undefined` clears `isOverdue`. Simpler and faithful to "the user touched the field".

## Deviations / Notes

1. **30s cadence is too aggressive for production.** Documented; would be 5+ min in real ops.
2. **`@VersionColumn` bump on escalation save** can cause client `If-Match` 409s on concurrent edits. Correct semantics; clients re-fetch.
3. **No manual-trigger HTTP endpoint** — not in the README. Tests + the cron path are sufficient.
4. **No distributed locking** — single-node deployment assumption.
5. **AUTO_ESCALATE audit volume** at 30s cadence × many overdue tickets could grow fast. Acceptable trade-off; audit log designed for this.

## Cross-cutting Hooks Available for Later Phases

- **`actor: SYSTEM, performedBy: null` audit pattern** proven end-to-end. Phase 13 (auto-assignment) will use the identical shape with `action: AUTO_ASSIGN`.
- **`@Cron` + `ScheduleModule`** infrastructure is in place. Any future background job can drop in a new `@Cron`-annotated method.
- **`nextPriority` helper** is reusable if any other feature ever needs to advance through the priority ladder.
- **Repo-direct injection pattern** (no `TicketsService` dependency) consistent with Phase 7 — proven solution to circular-import risk.
