# Phase 12 — Auto-Escalation Scheduler (overdue tickets)

> First and only background-job feature. Periodically scans non-DONE tickets whose `dueDate` has passed and bumps their priority one level toward CRITICAL. Once they hit CRITICAL and stay overdue, flips `isOverdue=true`. Implements the `SYSTEM` actor pattern that Phase 6 set up — first actually exercised here, then again in Phase 13.

## Goal

A `EscalationModule` with a `@Cron(...)`-scheduled service method that scans active overdue tickets and applies the §3.7 rules. Audit emits one `AUTO_ESCALATE` row per ticket changed, with `actor=SYSTEM` / `performedBy=null`. Manual priority change on `PATCH /tickets/:id` resets `is_overdue` to `false` so the next scheduler cycle re-evaluates from the new priority.

## Scope (in)

1. `EscalationModule` registering `EscalationService` and `ScheduleModule.forRoot()` (the latter actually lands in `AppModule` so it's available globally).
2. `EscalationService.runEscalation()` — public method, called both by the cron trigger and from tests. Pure logic on the `Ticket` repo (no `TicketsService` dependency → avoids circular dep with `TicketsModule`).
3. `@Cron('*/30 * * * * *')` annotation (every 30 seconds) for live demonstrability — configurable via env later if needed.
4. Helper `nextPriority(p: TicketPriority)` in `src/common/enums/ticket-priority.enum.ts` — returns the next level toward CRITICAL, or CRITICAL itself if already there.
5. **`TicketsService.update` change:** when `dto.priority !== undefined`, reset `ticket.isOverdue = false` per spec "a manual priority change ... resets the auto-escalation state". This is a small surgical change to existing `update()`.
6. Audit emit per actual mutation:
   - Bump: payload `{ from: oldPriority, to: newPriority }`.
   - CRITICAL flag flip: payload `{ priority: 'CRITICAL', isOverdue: true }`.
   - No emit for no-op (CRITICAL already flagged).
7. Unit tests for `nextPriority`, `runEscalation` behaviors, and the manual-priority-reset rule.

## Scope (out — deferred)

- **Manual trigger HTTP endpoint** — not in README; tests + the natural cron path are enough.
- **Configurable cron expression** via env — could add a `ScheduleRegistry`-based dynamic registration, but the spec is silent on cadence. Hard-coded 30s for assignment scope.
- **Distributed locking** — single-node assumption; not in scope.
- **Re-bump after manual reset within the same cycle** — manual reset clears `isOverdue` but doesn't trigger immediate escalation; happens on the next cron tick.

## API Surface

No new HTTP endpoints. The escalation is invisible to clients except via:
- `is_overdue: true` on `GET /tickets/:id` (when CRITICAL+overdue)
- Changed `priority` field (when bumped)
- New `AUTO_ESCALATE` rows in `GET /audit-logs?action=AUTO_ESCALATE`

## Spec Rules → Implementation Mapping

| Spec rule (§3.7) | Implementation |
|---|---|
| "For each overdue ticket whose priority is below CRITICAL, the priority is promoted one level" | If `dueDate < now` and `priority !== CRITICAL` → `priority = nextPriority(priority)` |
| "When a ticket reaches CRITICAL and is still overdue, its is_overdue flag is set to true" | If `priority === CRITICAL` and `dueDate < now` and `!isOverdue` → `isOverdue = true` |
| "Escalation is idempotent: a CRITICAL ticket is never escalated further" | When `priority === CRITICAL && isOverdue === true` → no-op |
| "Escalation only applies to tickets for which dueDate has been set" | SQL `dueDate < now` automatically excludes NULL |
| "A manual priority change ... resets the auto-escalation state" | `TicketsService.update`: if `dto.priority !== undefined`, set `ticket.isOverdue = false` |
| "Escalation does not transition a ticket's status field" | Service only writes `priority` and `isOverdue` |

## Service Behaviors (precise)

```ts
async runEscalation(): Promise<{ scanned: number; escalated: number }> {
  const now = new Date();
  const overdue = await this.tickets.find({
    where: {
      dueDate: LessThan(now),
      status: Not(TicketStatus.DONE),
    },
  });

  let escalated = 0;
  for (const t of overdue) {
    if (t.priority !== TicketPriority.CRITICAL) {
      const from = t.priority;
      t.priority = nextPriority(from);
      await this.tickets.save(t);                         // bumps @VersionColumn
      await this.audit.record({ ..., payload: { from, to: t.priority } });
      escalated++;
    } else if (!t.isOverdue) {
      t.isOverdue = true;
      await this.tickets.save(t);
      await this.audit.record({ ..., payload: { priority: 'CRITICAL', isOverdue: true } });
      escalated++;
    }
    // else: CRITICAL + isOverdue → idempotent no-op
  }
  return { scanned: overdue.length, escalated };
}
```

`@Cron('*/30 * * * * *')` wraps the call. Returns count for logging only.

## TicketsService.update Change

Inside `update()`, after the existing validation but before saving:

```ts
if (dto.priority !== undefined) {
  // Spec §3.7: manual priority change resets auto-escalation state.
  ticket.isOverdue = false;
}
```

This is a surgical addition. All existing tests pass because they don't assert on `isOverdue`.

## File Layout

```
src/escalation/
├── escalation.module.ts
├── escalation.service.ts
├── escalation.service.spec.ts
```

Modified:
- [src/common/enums/ticket-priority.enum.ts](../issueflow-typescript/src/common/enums/ticket-priority.enum.ts) — add `PRIORITY_ORDER` + `nextPriority(p)` helper.
- [src/common/enums/ticket-priority.enum.ts spec](../issueflow-typescript/src/common/enums/) — add `next-priority.spec.ts` for the helper.
- [src/tickets/tickets.service.ts](../issueflow-typescript/src/tickets/tickets.service.ts) — 1-line manual-reset in `update()`.
- [src/tickets/tickets.service.spec.ts](../issueflow-typescript/src/tickets/tickets.service.spec.ts) — 1 new test for the manual reset.
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — `ScheduleModule.forRoot()` + register `EscalationModule`.

## Unit Tests (Phase 12)

`next-priority.spec.ts`:
1. `LOW → MEDIUM`, `MEDIUM → HIGH`, `HIGH → CRITICAL`, `CRITICAL → CRITICAL` (parameterized).

`escalation.service.spec.ts` — mocked Ticket repo + AuditLogService:
2. `runEscalation` with no overdue tickets → `{ scanned: 0, escalated: 0 }`, no save, no audit.
3. Bumps LOW → MEDIUM and audits with `{ from: LOW, to: MEDIUM }`.
4. Bumps HIGH → CRITICAL and audits.
5. Sets `isOverdue=true` on CRITICAL not yet flagged; audits `{ priority: CRITICAL, isOverdue: true }`.
6. CRITICAL with `isOverdue=true` → no-op (no save, no audit, counts in `scanned` but not `escalated`).
7. Multiple tickets in one cycle handled correctly (mixed: some bumped, some flagged, some no-op).

`tickets.service.spec.ts` (extension — 1 new):
8. `update` with `dto.priority` set resets `isOverdue` to `false`.

Total new: **~8 tests.** Running total post-Phase 12: **~204.**

## Acceptance Criteria

- [ ] Build clean. 196 prior tests pass; ~8 new pass.
- [ ] Live probes (require JWT; uses 30s cron tick):
  - Create a ticket with `priority: LOW` and `dueDate` 1 minute in the past.
  - Wait one cron tick (≤30 s) → `GET /tickets/:id` shows `priority: MEDIUM`, `isOverdue: false`.
  - Wait another tick → `HIGH`. Another → `CRITICAL`, `isOverdue: false`. Another → `CRITICAL`, `isOverdue: true`. Another → no further change (idempotent).
  - `GET /audit-logs?action=AUTO_ESCALATE` shows 4 entries: 3 bumps + 1 flag flip, all with `actor: SYSTEM`, `performedBy: null`.
  - `PATCH /tickets/:id` with `{priority: HIGH}` (manual reset) → `isOverdue` cleared. Wait another tick → `CRITICAL`, `isOverdue: false`. Another → `CRITICAL`, `isOverdue: true` (re-flag).
  - Ticket without `dueDate` (and overdue tickets in DONE status) are never touched.

## Risks / Notes

- **30-second cron is dev-friendly but noisy in prod.** Real systems would run every 5+ minutes. Acceptable for the assignment; flag in `run.md`.
- **No `TicketsService` dependency** — `EscalationService` uses the `Ticket` repo directly (same pattern as Phase 7). Keeps the dependency graph clean.
- **`@VersionColumn` bumps on escalation save.** A user whose PATCH races with an escalation could hit a 409. Correct behavior — the system changed state under them.
- **Manual-reset spec interpretation:** "manual priority change by a user" — I treat any `dto.priority !== undefined` as manual (even setting to the same value). Simpler and faithful; the user explicitly touched the field.
- **AUTO_ESCALATE audit volume**: at 30s cadence, a fully-overdue system could emit many SYSTEM rows. Acceptable trade-off; audit log was designed for this in Phase 6.
- **Cron expression format**: `*/30 * * * * *` is the 6-field (with seconds) cron syntax that `@nestjs/schedule` supports. Standard 5-field syntax (`*/5 * * * *`) is the every-5-minutes case.
