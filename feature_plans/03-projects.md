# Phase 3 — Projects CRUD

> First feature that exercises **soft delete** (per spec §3.5). Sets up the `Project` entity that `Ticket` (Phase 4) depends on. Membership for auto-assignment is **derived** (no separate table) per the revised locked decision.

## Goal

A `Projects` module matching the README contract literally — `GET / POST / PATCH / DELETE` (with `DELETE` as soft delete via TypeORM `@DeleteDateColumn`). No separate membership table — auto-assignment in Phase 13 will derive "users in the project" as `owner_id ∪ DISTINCT tickets.assignee_id`.

## Scope (in)

1. `Project` entity with `@DeleteDateColumn` (soft delete).
2. DTOs (`CreateProjectDto`, `UpdateProjectDto`) with `class-validator`.
3. Service:
   - `create` — verifies owner exists (→ 400 if not), persists project.
   - `findAll` / `findOne(id)` — both hide soft-deleted rows by default (TypeORM auto-applies `deletedAt IS NULL`).
   - `update(id)` — only `name` and `description`, returns updated. 404 if not found / soft-deleted.
   - `softDelete(id)` — `TypeORM.softDelete()`. 404 if not found.
4. Controller per README (`PATCH`, not `POST .../update/...`).
5. All endpoints **auth-required** (global guard from Phase 2). No `@Public()`.
6. Unit tests for service + DTO validation.

## Scope (out — deferred)

- `GET /projects/deleted` and `POST /projects/:id/restore` — Phase 10 (require `@Roles(ADMIN)`).
- Audit-log emission on create/update/delete — Phase 6 backfills.
- Membership queries — Phase 13 derives them; no table to populate here.

## Decision D5 — Resolved 2026-05-22

**Revised:** No `project_members` table. Membership is derived as `projects.owner_id ∪ DISTINCT tickets.assignee_id`. Equally spec-compliant (the spec defines no membership API; the explicit table would be a leaky abstraction). `IMPLEMENTATION_PLAN.md` and memory updated.

## API Contract (per README, literal)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `GET` | `/projects` | — | `200 [{ id, name, description, ownerId }]` | Soft-deleted hidden |
| `GET` | `/projects/:projectId` | — | `200 { id, name, description, ownerId }` / `404` | |
| `POST` | `/projects` | `{ name, description, ownerId }` | `200 { id, name, description, ownerId }` / `400` | 400 if `ownerId` doesn't exist; `@HttpCode(200)` |
| `PATCH` | `/projects/:projectId` | `{ name?, description? }` | `200` (empty) / `404` | README returns empty body |
| `DELETE` | `/projects/:projectId` | — | `200` (empty) / `404` | **Soft delete** per §3.5 |

## Entity Definitions

```ts
// src/projects/entities/project.entity.ts
@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 200 }) name: string;
  @Column({ type: 'text' }) description: string;
  @Column({ name: 'owner_id' }) ownerId: number;
  @CreateDateColumn({ name: 'created_at' }) @Exclude() createdAt: Date;
  @DeleteDateColumn({ name: 'deleted_at' }) @Exclude() deletedAt: Date | null;
}
```

No FK constraints in the schema. Two reasons: (1) simplifies cross-dialect compatibility (PG + SQLite tests) since we use `synchronize:true`, and (2) avoids cascading-delete complications when a user is hard-deleted (Phase 1 behavior). Owner existence is checked in the service at write time.

## DTOs

```ts
// CreateProjectDto
@IsString() @IsNotEmpty() @MaxLength(200) name: string;
@IsString() @IsNotEmpty() @MaxLength(2000) description: string;
@IsInt() @IsPositive() ownerId: number;

// UpdateProjectDto
@IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
@IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) description?: string;
```

Global pipe (whitelist + forbidNonWhitelisted) drops any unknown fields including `ownerId` on the update path.

## Service Behaviors

| Method | Behavior |
|---|---|
| `create(dto)` | Verifies owner via `UsersService.findOne(dto.ownerId).catch(() => null)`. If missing → `BadRequestException("Owner user N does not exist")`. Persists `Project`. Returns the project. |
| `findAll()` | `repo.find()` — soft-deleted automatically excluded. |
| `findOne(id)` | `repo.findOne({ where: { id } })`. Throws `NotFoundException("Project N not found")` if missing or soft-deleted. |
| `update(id, dto)` | Loads via `findOne(id)`. Applies only `name` / `description`. `repo.save`. Returns updated project. |
| `softDelete(id)` | `repo.softDelete(id)`. Throws `NotFoundException` if `affected === 0`. Phase 10 will expose restore. |

No member-management helpers in this phase. Phase 13 will derive membership from `owner_id ∪ tickets.assignee_id` via a raw query.

## File Layout

```
src/projects/
├── projects.module.ts
├── projects.controller.ts
├── projects.service.ts
├── projects.service.spec.ts
├── entities/
│   └── project.entity.ts
└── dto/
    ├── create-project.dto.ts
    ├── create-project.dto.spec.ts
    └── update-project.dto.ts
```

Modified:
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — import `ProjectsModule`.

## Unit Tests (Phase 3)

`projects.service.spec.ts` — mocked `Repository<Project>` and `UsersService`:

1. `create` persists project when owner exists.
2. `create` throws `BadRequestException` when owner does not exist.
3. `findAll` returns repository result.
4. `findOne` returns when found.
5. `findOne` throws `NotFoundException` when missing (covers soft-deleted indirectly — `findOne` returns null in both cases).
6. `update` applies only `name` and `description`.
7. `update` throws `NotFoundException` when missing.
8. `softDelete` calls `repo.softDelete(id)`.
9. `softDelete` throws `NotFoundException` when `affected === 0`.

`create-project.dto.spec.ts`:
10. Accepts a valid payload.
11. Rejects missing name.
12. Rejects missing description.
13. Rejects non-integer `ownerId` (string, negative).

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — 36 prior + ~13 new = **~49 total**.
- [ ] Curl probes (live, requires JWT):
  - `POST /projects` valid → 200, project created.
  - `POST /projects` with non-existent owner → 400 uniform shape.
  - `POST /projects` missing name → 400 with `details[]`.
  - `GET /projects` → 200 array, only non-deleted.
  - `GET /projects/:id` → 200 / 404.
  - `PATCH /projects/:id` → 200 empty body; subsequent `GET` shows changes.
  - `PATCH /projects/:id` with `ownerId` field → 400 (forbidNonWhitelisted).
  - `DELETE /projects/:id` → 200 empty; subsequent `GET /:id` → 404; row still present in DB with `deleted_at` set.
  - All routes without `Authorization` → 401.
- [ ] DB check (psql): `select id, name, deleted_at from projects;` shows the soft-deleted row with `deleted_at` populated.

## Risks / Notes

- **No membership table.** Per revised Decision D5. Membership derived in Phase 13. Documented in `run.md` (Phase 14).
- **Hard-delete of a user who owns projects** leaves `ownerId` dangling (no FK). Acceptable per assignment scope. Phase 6 (Audit Log) will record the discrepancy but won't enforce; Phase 14 docs will mention it.
- **`description` requirement.** Spec lists it as a creation field without nullability. Plan is to require non-empty. If the user actually wants `description` optional, easy to relax.
- **Soft-delete invisibility test.** Worth verifying directly: a `DELETE` followed by `GET /:id` must return 404, *and* the row must still exist in Postgres with `deleted_at IS NOT NULL`. The live probe list above includes both checks.
