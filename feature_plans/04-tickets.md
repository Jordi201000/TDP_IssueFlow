# Phase 4 — Tickets CRUD (+ status lifecycle, DONE lock, optimistic locking, soft delete)

> Core domain entity. Bigger surface than Users/Projects: enum validation across three dimensions (status, priority, type), forward-only status lifecycle, "no updates on DONE", optimistic locking via `ETag`/`If-Match` per the locked decision, and soft delete via `@DeleteDateColumn`. The Ticket entity is the foreign-key target for Comments (Phase 5), Dependencies (Phase 7), Attachments (Phase 8), Mentions (Phase 11), Escalation (Phase 12), and Auto-Assignment (Phase 13), so getting the fields right now matters.

## Goal

A `Tickets` module matching the README contract literally for the 5 base endpoints (export/import are Phase 9). All endpoints auth-required (global guard). Optimistic locking surfaced through `ETag` (response) + `If-Match` (request) headers; mismatches return **409**; missing `If-Match` on `PATCH` returns **428**.

## Scope (in)

1. Three new enums in `src/common/enums/` (`TicketStatus`, `TicketPriority`, `TicketType`).
2. `Ticket` entity with `@VersionColumn`, `@DeleteDateColumn`, optional `dueDate`, `isOverdue` (default `false`).
3. DTOs (`CreateTicketDto`, `UpdateTicketDto`) — `Create` requires `status`/`priority`/`type` (per spec §2.4); `Update` permits only `title, description, status, priority, assigneeId, dueDate` (per spec §2.4 + README).
4. Service:
   - `create` — validates `projectId` exists (→ 400 if not); validates `assigneeId` exists when present (→ 400 if not). Default `isOverdue: false`. **No auto-assignment yet** (Phase 13).
   - `findAllByProject(projectId)` — soft-deleted hidden automatically.
   - `findOne(id)` — `NotFoundException` on missing/soft-deleted.
   - `update(id, dto, expectedVersion)` — sequence: require `expectedVersion`; load ticket; check `DONE` lock; check optimistic version match; check status transition (forward-only); validate `assigneeId` if provided; apply changes; `repo.save` (bumps version). **Dependencies "no DONE if blocked"** check stubbed until Phase 7.
   - `softDelete(id)` — same pattern as Projects.
5. Controller per README:
   - `GET /tickets?projectId=:projectId` (mandatory query param).
   - `GET /tickets/:ticketId` (sets `ETag` header).
   - `POST /tickets`.
   - `PATCH /tickets/:ticketId` (requires `If-Match`).
   - `DELETE /tickets/:ticketId`.
6. ETag/If-Match wiring:
   - `EtagInterceptor` (Tickets-only, controller-level) — reads `version` off the returned entity, sets `ETag: "<n>"` response header, lets global `ClassSerializerInterceptor` strip `version` from the body afterward.
   - `parseIfMatch(header)` helper — accepts `"<n>"` per HTTP convention; throws when malformed.
7. Unit tests covering: each error path (project/assignee 400, transition 400, DONE lock 400, version 409, missing If-Match 428), happy path on create + each forward transition, soft delete.

## Scope (out — deferred)

- **Auto-assignment when `assigneeId` is omitted** — Phase 13. For Phase 4, omitted assignee just stays `null` and we leave a TODO marker.
- **isOverdue auto-management** — Phase 12. The field exists from day one (response includes it per README) but is never set to `true` by Phase 4 code.
- **Audit-log emission** — Phase 6 backfills.
- **Dependencies + "no DONE if blocked"** — Phase 7. Phase 4 leaves an explicit extension point in `update()` (`// TODO Phase 7: refuse DONE if open blockers`).
- **CSV export/import** — Phase 9.
- **Soft-delete admin endpoints** (`GET /tickets/deleted`, `POST /tickets/:id/restore`) — Phase 10.

## API Contract (per README, literal)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `GET` | `/tickets?projectId=:id` | — | `200 [{...}]` | Required query param; 400 if missing |
| `GET` | `/tickets/:ticketId` | — | `200 {...}` / `404` | Response includes `ETag: "<version>"` header |
| `POST` | `/tickets` | `{ title, description, status, priority, type, projectId, assigneeId?, dueDate? }` | `200 {...}` / `400` | `@HttpCode(200)`. Response includes `ETag` |
| `PATCH` | `/tickets/:ticketId` | `{ title?, description?, status?, priority?, assigneeId?, dueDate? }` + **`If-Match: "<version>"` header** | `200` (empty body) + new `ETag` / `400` / `404` / `409` / `428` | DONE lock → 400; bad transition → 400; missing assignee → 400; version mismatch → 409; missing `If-Match` → 428 |
| `DELETE` | `/tickets/:ticketId` | — | `200` (empty) / `404` | Soft delete |

Response body for `GET` and `POST` excludes `version`, `createdAt`, `updatedAt`, `deletedAt`. README example fields: `id, title, description, status, priority, type, projectId, assigneeId, dueDate, isOverdue`.

## Enums (new)

```ts
// src/common/enums/ticket-status.enum.ts
export enum TicketStatus { TODO = 'TODO', IN_PROGRESS = 'IN_PROGRESS', IN_REVIEW = 'IN_REVIEW', DONE = 'DONE' }

// src/common/enums/ticket-priority.enum.ts
export enum TicketPriority { LOW = 'LOW', MEDIUM = 'MEDIUM', HIGH = 'HIGH', CRITICAL = 'CRITICAL' }

// src/common/enums/ticket-type.enum.ts
export enum TicketType { BUG = 'BUG', FEATURE = 'FEATURE', TECHNICAL = 'TECHNICAL' }
```

## Entity

```ts
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 200 }) title: string;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'varchar', length: 16 }) status: TicketStatus;
  @Column({ type: 'varchar', length: 16 }) priority: TicketPriority;
  @Column({ type: 'varchar', length: 16 }) type: TicketType;
  @Column({ name: 'project_id' }) projectId: number;
  @Column({ name: 'assignee_id', type: 'int', nullable: true }) assigneeId: number | null;
  @Column({ name: 'due_date', type: 'datetime', nullable: true }) dueDate: Date | null;
  @Column({ name: 'is_overdue', default: false }) isOverdue: boolean;
  @VersionColumn() @Exclude() version: number;
  @CreateDateColumn({ name: 'created_at' }) @Exclude() createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) @Exclude() updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at' }) @Exclude() deletedAt: Date | null;
}
```

`type: 'varchar'` for the enums (same reason as Users.role: cross-dialect, validated by `@IsEnum`).
`type: 'datetime'` for dueDate — TypeORM normalizes to TIMESTAMP on PG and TEXT on SQLite.

## Status Lifecycle Rules

```
TODO → IN_PROGRESS → IN_REVIEW → DONE
```

Allowed: any **forward** move (including skips, e.g., `TODO → DONE`) and no-op (same status).
Rejected: any backward move; **any** change while `status === DONE`.

```ts
const ORDER = [TODO, IN_PROGRESS, IN_REVIEW, DONE];
function isForward(from: TicketStatus, to: TicketStatus): boolean {
  return ORDER.indexOf(to) >= ORDER.indexOf(from);
}
```

I read §2.4 as: "forward in the lifecycle" + "Backward transitions are not allowed" → skip-forward is permitted. If the spec actually means strictly-sequential, the only change is `>` instead of `>=` and the skip tests flip.

## DTOs

```ts
// CreateTicketDto
@IsString() @IsNotEmpty() @MaxLength(200) title;
@IsString() @IsNotEmpty() @MaxLength(5000) description;
@IsEnum(TicketStatus) status;
@IsEnum(TicketPriority) priority;
@IsEnum(TicketType) type;
@IsInt() @IsPositive() projectId;
@IsOptional() @IsInt() @IsPositive() assigneeId?;
@IsOptional() @IsISO8601() dueDate?: string;  // transformed to Date in service

// UpdateTicketDto — per spec §2.4: only these fields
@IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?;
@IsOptional() @IsString() @IsNotEmpty() @MaxLength(5000) description?;
@IsOptional() @IsEnum(TicketStatus) status?;
@IsOptional() @IsEnum(TicketPriority) priority?;
@IsOptional() @IsInt() @IsPositive() assigneeId?;
@IsOptional() @IsISO8601() dueDate?: string;
```

Note: `type` and `projectId` are **not** updatable — per spec §2.4 they're not listed in the update set, and `forbidNonWhitelisted` will reject them with 400.

## Optimistic Locking (ETag / If-Match)

- **Reads:** `GET /tickets/:id` and `POST /tickets` set `ETag: "<version>"` on the response. `EtagInterceptor` (controller-scoped) reads `version` off the entity before `ClassSerializerInterceptor` strips it.
- **Writes:** `PATCH /tickets/:id` requires `If-Match: "<n>"` (HTTP-standard form: quoted integer).
  - Missing → `428 Precondition Required` (`"If-Match header required"`).
  - Malformed (not `"<digits>"`) → `400`.
  - Present and `n !== ticket.version` → `409 Conflict` (`"Ticket has been modified since last fetch"`).
  - Match: apply changes, `repo.save` bumps version, response sets new `ETag`.

## File Layout

```
src/tickets/
├── tickets.module.ts
├── tickets.controller.ts
├── tickets.service.ts
├── tickets.service.spec.ts
├── interceptors/
│   ├── etag.interceptor.ts
│   └── etag.interceptor.spec.ts
├── helpers/
│   └── if-match.ts                # parseIfMatch + spec
├── entities/
│   └── ticket.entity.ts
└── dto/
    ├── create-ticket.dto.ts
    ├── create-ticket.dto.spec.ts
    └── update-ticket.dto.ts

src/common/enums/
├── ticket-status.enum.ts
├── ticket-priority.enum.ts
└── ticket-type.enum.ts
```

Modified:
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — import `TicketsModule`.

## Service Behaviors (precise)

| Method | Behavior |
|---|---|
| `create(dto)` | Validate project (→ 400 on missing); validate assignee if present (→ 400). Persist with `isOverdue=false`. Return entity. |
| `findAllByProject(pid)` | `repo.find({ where: { projectId: pid } })`. Soft-deleted hidden. |
| `findOne(id)` | `repo.findOne({ where: { id } })`. 404 on null. |
| `update(id, dto, expectedVersion)` | 1) If `expectedVersion` undefined → 428. 2) Load. 3) If `version !== expectedVersion` → 409. 4) If `status===DONE` → 400 (DONE lock). 5) If `dto.status` set and `!isForward(current, dto.status)` → 400. 6) If `dto.assigneeId` set, validate exists → 400 if not. 7) `// TODO Phase 7: refuse if dto.status===DONE && hasOpenBlockers`. 8) Apply whitelisted fields. 9) `repo.save` (auto-bumps `version`). Return entity. |
| `softDelete(id)` | `repo.softDelete(id)`. 404 if `affected===0`. |

## Unit Tests (Phase 4)

`tickets.service.spec.ts` — mocked `Repository<Ticket>`, `ProjectsService`, `UsersService`:

1. `create` happy path persists with defaults (`isOverdue:false`, `assigneeId:null` when omitted, `dueDate:null` when omitted).
2. `create` → 400 when project missing.
3. `create` → 400 when explicit `assigneeId` doesn't exist.
4. `findAllByProject` filters by projectId.
5. `findOne` happy + 404.
6. `update` throws 428 when `expectedVersion` undefined.
7. `update` throws 409 on version mismatch.
8. `update` throws 400 when ticket already DONE.
9. `update` rejects backward transition (`IN_PROGRESS → TODO` → 400).
10. `update` allows same-status (`TODO → TODO`).
11. `update` allows `TODO → IN_PROGRESS`.
12. `update` allows `TODO → DONE` (skip).
13. `update` rejects unknown `assigneeId` (400).
14. `update` only mutates allowed fields (sneaky `projectId` ignored).
15. `softDelete` happy + 404.

`etag.interceptor.spec.ts` — 2 tests:
16. Sets `ETag: "<n>"` header when response has numeric `version`.
17. Skips when response lacks `version`.

`if-match.ts` spec — 3 tests:
18. Parses `"5"` → `5`.
19. Rejects `5` (unquoted) → throws.
20. Rejects `""` empty → throws.

`create-ticket.dto.spec.ts` — 4 tests:
21. Valid full payload.
22. Rejects invalid `status` / `priority` / `type` enums (parameterized).
23. Rejects missing required fields.
24. Accepts payload without optional `assigneeId` / `dueDate`.

Total new: **~24 tests.** Running total post-Phase 4: **~74.**

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — ~74 total passing.
- [ ] Live probes (against Postgres, requires JWT; assume a user `u1` and a project `p1` already exist):
  - `POST /tickets` valid → 200 with `ETag: "1"` header, body shape matches README.
  - `POST /tickets` with non-existent `projectId` → 400 explicit message.
  - `POST /tickets` with non-existent `assigneeId` → 400 explicit message.
  - `POST /tickets` with bad enum → 400 with `details[]`.
  - `GET /tickets?projectId=<p1>` → 200 array.
  - `GET /tickets` (no `projectId`) → 400.
  - `GET /tickets/1` → 200 with `ETag` header.
  - `GET /tickets/999` → 404 uniform.
  - `PATCH /tickets/1` without `If-Match` → 428.
  - `PATCH /tickets/1` with `If-Match: "999"` (stale) → 409.
  - `PATCH /tickets/1` with `If-Match: "1"` `{status:"IN_PROGRESS"}` → 200 with `ETag: "2"`; subsequent `GET` confirms.
  - `PATCH /tickets/1` `{status:"TODO"}` (backward) → 400.
  - PATCH to DONE then any further PATCH → 400 (DONE lock).
  - `PATCH /tickets/1` `{projectId:99}` → 400 (forbidNonWhitelisted).
  - `DELETE /tickets/1` → 200; `GET /tickets/1` → 404; row still in DB with `deleted_at` set.

## Risks / Notes

- **Forward-with-skip interpretation.** I'm reading §2.4 as "forward only, skips allowed". If you want strictly sequential, single-line change. Flagging.
- **`dueDate` column type.** Using `'datetime'` for cross-dialect. If Postgres `timestamptz` is preferred at the DB level, switch the column type — schema impact only.
- **No auto-assign on omitted `assigneeId`.** Tickets created without explicit assignee will have `assigneeId: null`, which violates the §3.8 "queries all DEVELOPER" requirement until Phase 13 lands. Documented in `run.md` as a known interim gap.
- **ETag noise on tests.** The interceptor needs unit testing in isolation (ctx mock). Live e2e tests in Phase 14 will exercise the full HTTP path.
