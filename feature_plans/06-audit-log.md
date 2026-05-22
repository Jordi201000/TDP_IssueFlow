# Phase 6 — Audit Log (+ backfill emit points across all earlier services)

> First extended feature (§3.1). Lands the `AuditLog` module, then **backfills emit-points across every existing service** so all prior state-changing actions get recorded going forward. Sets up the SYSTEM-actor pattern that Phase 12 (escalation) and Phase 13 (auto-assign) will consume.

## Goal

A persistent, append-only audit log of every state-changing action. `GET /audit-logs` lists with optional **single-field** filter per the locked decision. Backfill emits in Users / Auth / Projects / Tickets / Comments services so the log starts being populated immediately. Schema designed so Phases 7–13 can extend with new `action` / `entityType` values without migrations.

## Scope (in)

1. `AuditLog` entity with `action`, `entityType`, `entityId`, `performedBy` (nullable), `actor` (USER | SYSTEM), `payload` (simple-json), `timestamp`.
2. Enums: `AuditAction` (CREATE, UPDATE, DELETE, RESTORE, LOGIN, AUTO_ASSIGN, AUTO_ESCALATE), `AuditActor` (USER, SYSTEM), `AuditEntityType` (USER, PROJECT, TICKET, COMMENT — extensible).
3. `AuditLogService.record(entry)` — synchronous, in the same flow as the originating call. Catches its own errors so a logging failure never breaks the business operation.
4. `AuditLogController` → `GET /audit-logs` with optional `entityType`, `entityId`, `action`, or `actor` query param. **At most one filter at a time** per locked decision (multiple → 400). Sorted newest-first. No pagination yet (assignment scope).
5. **Backfill across existing services** (the bulk of this phase):
   - **UsersService**: `create`, `update`, `remove` → record CREATE / UPDATE / DELETE on USER.
   - **AuthService**: `login` (successful only) → record LOGIN.
   - **ProjectsService**: `create`, `update`, `softDelete` → CREATE / UPDATE / DELETE on PROJECT.
   - **TicketsService**: `create`, `update`, `softDelete` → CREATE / UPDATE / DELETE on TICKET.
   - **CommentsService**: `create`, `update`, `remove` → CREATE / UPDATE / DELETE on COMMENT.
   - **System-only emits land in their own phases**: AUTO_ASSIGN (Phase 13), AUTO_ESCALATE (Phase 12), RESTORE (Phase 10).
6. **Actor propagation pattern** — explicit, not magical. Each backfilled service method gains an optional final parameter: `actor?: AuditContext`. Controllers pass `{ actor: 'USER', performedBy: currentUser.userId }` derived from `@CurrentUser()`. Background workers (Phases 12/13) will pass `{ actor: 'SYSTEM', performedBy: null }`. If `actor` is omitted entirely, the service skips recording (defensive — keeps tests that don't supply context green).
7. **Public registration (`POST /users` without a token)** — no `req.user`; the controller uses `{ actor: 'USER', performedBy: null }` and the audit row records the user being created as the `entityId`.
8. Unit tests for AuditLogService + controller filter contract; spot-check tests on one backfilled service (UsersService) verifying the emit path; **no need** to rewrite every existing service's test suite.

## Scope (out — deferred)

- RESTORE emits — Phase 10 lands the restore endpoints; its plan adds the audit emit.
- AUTO_ASSIGN — Phase 13.
- AUTO_ESCALATE — Phase 12.
- Multi-field filtering on `GET /audit-logs` — out per locked decision.
- Pagination on `GET /audit-logs` — out (assignment scope; can add if needed in Phase 14).

## API Contract (per README, literal)

| Method | Path | Query Params | Response | Notes |
|---|---|---|---|---|
| `GET` | `/audit-logs` | Optional **one of**: `entityType`, `entityId`, `action`, `actor` | `200 [{ id, action, entityType, entityId, performedBy, actor, timestamp }]` | Multiple filters → 400. Newest first. |

Auth required (global guard). No explicit `@Roles(ADMIN)` because spec §3.1 doesn't restrict — any authenticated user can read the log. (Spec also doesn't say it should be ADMIN-only; staying literal per your direction.)

## Entity

```ts
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 32 }) action: AuditAction;
  @Column({ name: 'entity_type', type: 'varchar', length: 32 }) entityType: AuditEntityType;
  @Column({ name: 'entity_id' }) entityId: number;
  @Column({ name: 'performed_by', type: 'int', nullable: true }) performedBy: number | null;
  @Column({ type: 'varchar', length: 16 }) actor: AuditActor;
  @Column({ type: 'simple-json', nullable: true }) payload: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) timestamp: Date;
}
```

`type: 'simple-json'` is TypeORM-portable across Postgres (JSONB-ish) and SQLite (TEXT). Verified in Phase 0 plan; first use here.

## Service Behaviors

```ts
@Injectable()
export class AuditLogService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async record(entry: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: number;
    actor: AuditActor;
    performedBy: number | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.repo.save(this.repo.create(entry));
    } catch (err) {
      // Never let an audit failure break the originating operation.
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findAll(filter: AuditFilter): Promise<AuditLog[]> {
    const where: Partial<AuditLog> = {};
    if (filter.entityType !== undefined) where.entityType = filter.entityType;
    if (filter.entityId !== undefined) where.entityId = filter.entityId;
    if (filter.action !== undefined) where.action = filter.action;
    if (filter.actor !== undefined) where.actor = filter.actor;
    return this.repo.find({ where, order: { timestamp: 'DESC' } });
  }
}
```

Controller enforces "at most one filter":
```ts
function countFilters(q): number { /* count defined keys */ }
if (countFilters(query) > 1) throw new BadRequestException(...);
```

## Actor Propagation — Concrete Shape

```ts
// src/audit-log/interfaces/audit-context.interface.ts
export interface AuditContext {
  actor: AuditActor;          // 'USER' | 'SYSTEM'
  performedBy: number | null; // null for SYSTEM / anonymous registration
}
```

**Controllers gain a single line at each entry point:**
```ts
@Post()
async create(@Body() dto: CreateXDto, @CurrentUser() user: AuthenticatedUser) {
  return this.xs.create(dto, { actor: AuditActor.USER, performedBy: user.userId });
}
```

For `POST /users` (public): `performedBy: null` (no token).
For `POST /auth/login`: `AuthService.login` resolves the user then records `{ actor: USER, performedBy: user.id }` itself.
For Phases 12/13: pass `{ actor: SYSTEM, performedBy: null }` from the scheduler/auto-assign code.

**Services that get the new optional parameter:**
- `UsersService.create(dto, ctx?)`
- `UsersService.update(id, dto, ctx?)`
- `UsersService.remove(id, ctx?)`
- `ProjectsService.create(dto, ctx?)`
- `ProjectsService.update(id, dto, ctx?)`
- `ProjectsService.softDelete(id, ctx?)`
- `TicketsService.create(dto, ctx?)`
- `TicketsService.update(id, dto, expectedVersion, ctx?)`
- `TicketsService.softDelete(id, ctx?)`
- `CommentsService.create(ticketId, dto, ctx?)`
- `CommentsService.update(ticketId, commentId, dto, expectedVersion, ctx?)`
- `CommentsService.remove(ticketId, commentId, ctx?)`

If `ctx` is omitted (existing tests don't pass it), service skips audit — keeps Phase 0–5 tests green without modification.

## Payload Shape (per action)

| Action | Payload contents |
|---|---|
| `CREATE` (any entity) | `{ snapshot: <the saved entity, redacted: passwordHash removed> }` |
| `UPDATE` | `{ changes: <dto>, version?: <new version for Ticket/Comment> }` |
| `DELETE` | `{}` |
| `LOGIN` | `{}` (just records the login event; performedBy = user id) |

Phase 12/13 will add their own payload shapes.

## File Layout

```
src/audit-log/
├── audit-log.module.ts
├── audit-log.controller.ts
├── audit-log.controller.spec.ts
├── audit-log.service.ts
├── audit-log.service.spec.ts
├── entities/
│   └── audit-log.entity.ts
├── enums/
│   ├── audit-action.enum.ts
│   ├── audit-actor.enum.ts
│   └── audit-entity-type.enum.ts
├── interfaces/
│   └── audit-context.interface.ts
└── dto/
    └── audit-log-query.dto.ts        # for GET /audit-logs query validation
```

Modified (every existing service gets the optional `ctx` param + an emit call):
- `src/users/users.{service,controller}.ts`
- `src/auth/auth.service.ts`
- `src/projects/projects.{service,controller}.ts`
- `src/tickets/tickets.{service,controller}.ts`
- `src/comments/comments.{service,controller}.ts`
- Each respective `*.module.ts` to import `AuditLogModule`
- `src/app.module.ts` to register `AuditLogModule`

## Unit Tests (Phase 6)

`audit-log.service.spec.ts` — 5 tests:
1. `record` persists the entry.
2. `record` swallows errors (mocked save throws → test asserts no throw + logger called).
3. `findAll` with no filter returns all, ordered DESC by timestamp.
4. `findAll` with `entityType` filter narrows correctly.
5. `findAll` with each of `entityId` / `action` / `actor` (parameterized) narrows correctly.

`audit-log.controller.spec.ts` (filter contract) — 3 tests:
6. Single filter passes through to service.
7. No filter passes empty object.
8. Multiple filters → `BadRequestException`.

`audit-log-query.dto.spec.ts` — 3 tests:
9. Validates enum values (`action`, `entityType`, `actor`).
10. Rejects unknown enum values.
11. Coerces `entityId` to integer.

**Spot-check on one backfilled service — `users.service.spec.ts`** (extension, not rewrite) — 2 new tests:
12. `create(dto, ctx)` calls `audit.record` with USER action / CREATE / new user id.
13. `create(dto)` (no ctx) does **not** call `audit.record` — preserves backwards compatibility for existing tests.

Total new: **~13 tests.** Running total post-Phase 6: **~114.**

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — Phase 0–5 tests still pass without modification (because `ctx` is optional and existing tests don't pass it); ~13 new tests pass.
- [ ] Live probes (require JWT):
  - Trigger `POST /users` then `GET /audit-logs?action=CREATE&entityType=USER` returns the entry with `performedBy: null, actor: USER`.
  - Trigger `POST /auth/login` then `GET /audit-logs?action=LOGIN` returns the entry with `performedBy: <user id>, actor: USER`.
  - Trigger `POST /projects` then `GET /audit-logs?entityType=PROJECT` returns the entry with `performedBy: <user id>`.
  - Trigger `PATCH /tickets/:id` (valid update) then `GET /audit-logs?entityType=TICKET&action=UPDATE` returns the entry.
  - Trigger `DELETE /tickets/:id` then `GET /audit-logs?entityType=TICKET&action=DELETE` returns the entry.
  - `GET /audit-logs?action=CREATE&actor=USER` (two filters) → 400 with explicit message.
  - `GET /audit-logs?action=BOGUS` → 400 enum validation.
  - `GET /audit-logs` no filter → 200 array of everything, newest first.

## Risks / Notes

- **Cross-module surgery.** Touching every existing service is the biggest churn this assignment will see. Strategy: keep `ctx` optional so the existing test suite is untouched; only the controllers and the audit module need adjusting in lockstep.
- **"Swallow errors" tradeoff.** A failing audit write doesn't break business operations, but it does silently drop data. Logged at ERROR level for diagnosis. This is the right tradeoff for this assignment — losing an audit row is preferable to a ticket update failing because the audit table is locked.
- **Schema growth.** `payload: simple-json` lets later phases add fields (e.g., escalation old/new priority) without migrations. Verified cross-dialect (PG + SQLite).
- **Performance.** Synchronous append on every state-change adds one round-trip per request. Acceptable at assignment scale; would batch/async in production.
- **No pagination yet** on `GET /audit-logs`. If the system runs for a while in dev, this can return thousands of rows. Acceptable for grading; flag in `run.md`.
