# Feature 03 — Projects CRUD

**Plan:** [feature_plans/03-projects.md](../feature_plans/03-projects.md)
**Approved:** 2026-05-23
**Status:** Done. Build clean. 50/50 unit tests pass. All 14 live probes match the README contract; soft delete verified at the DB level.

## What this feature delivers

A `Projects` module with full CRUD per the README contract, plus the first end-to-end exercise of **soft delete** via TypeORM `@DeleteDateColumn`. Sets up the `Project` entity that the Tickets feature (Phase 4) will depend on. All endpoints are auth-required via the global `JwtAuthGuard` from Phase 2.

## Endpoints

| Method | Path | Auth | Status | Notes |
|---|---|---|---|---|
| `GET` | `/projects` | Required | 200 | Soft-deleted hidden by default |
| `GET` | `/projects/:projectId` | Required | 200 / 404 | 404 also covers soft-deleted |
| `POST` | `/projects` | Required | 200 / 400 | 400 if `ownerId` doesn't exist; `@HttpCode(200)` overrides Nest's default 201 |
| `PATCH` | `/projects/:projectId` | Required | 200 / 400 / 404 | Empty body; only `name` + `description` accepted; `ownerId` rejected by `forbidNonWhitelisted` |
| `DELETE` | `/projects/:projectId` | Required | 200 / 404 | **Soft delete** — row remains in DB with `deleted_at` populated |

## Key Logic

- **Soft delete** via TypeORM `@DeleteDateColumn` on the `Project` entity. `repo.find()` / `findOne()` automatically apply `deleted_at IS NULL`; soft-deleted rows are invisible to standard queries. `repo.softDelete(id)` sets the column. Restoration is Phase 10 work.
- **Owner validation** happens at the service layer: `UsersService.findOne(ownerId).catch(() => null)`. If the user doesn't exist, the service throws `BadRequestException("Owner user N does not exist")` — surfaced via the global filter as a uniform 400.
- **No FK constraints** on `owner_id` in the schema (per cross-dialect simplicity + the existing "hard-delete users" model). Owner integrity is checked at write time only.
- **Update path safety**: `UpdateProjectDto` declares only `name?` and `description?`. The global `ValidationPipe` (`whitelist + forbidNonWhitelisted`) rejects any other field (e.g. `ownerId`) with 400 + `details: ["property ownerId should not exist"]`.

## How Implemented

| File | Role |
|---|---|
| [src/projects/entities/project.entity.ts](../issueflow-typescript/src/projects/entities/project.entity.ts) | `id, name, description, ownerId, createdAt @Exclude, deletedAt @Exclude` |
| [src/projects/dto/create-project.dto.ts](../issueflow-typescript/src/projects/dto/create-project.dto.ts) | All three fields required; `name` ≤ 200, `description` ≤ 2000, `ownerId @IsInt @IsPositive` |
| [src/projects/dto/update-project.dto.ts](../issueflow-typescript/src/projects/dto/update-project.dto.ts) | Only `name?` + `description?` |
| [src/projects/projects.service.ts](../issueflow-typescript/src/projects/projects.service.ts) | Owner check, soft delete, NotFound on missing/soft-deleted |
| [src/projects/projects.controller.ts](../issueflow-typescript/src/projects/projects.controller.ts) | Literal README contract; `PATCH` (not `POST update`); `@HttpCode(200)` on `create`/`update`/`remove` |
| [src/projects/projects.module.ts](../issueflow-typescript/src/projects/projects.module.ts) | Wires entity + service; imports `UsersModule` for the owner check; exports `ProjectsService` for Phase 4 |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** registered `ProjectsModule` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/projects/projects.service.spec.ts](../issueflow-typescript/src/projects/projects.service.spec.ts) | create persists when owner exists; create → 400 on missing owner; findAll passthrough; findOne happy + NotFound (covers soft-deleted indirectly); update applies only name/description; update → NotFound on missing; softDelete calls `repo.softDelete`; softDelete → NotFound on `affected:0` | 9 |
| [src/projects/dto/create-project.dto.spec.ts](../issueflow-typescript/src/projects/dto/create-project.dto.spec.ts) | Valid; missing name; missing description; non-integer ownerId; non-positive ownerId | 5 |

`npm test` → **50/50 passing** (5 + 16 + 15 + 14).

## Live Verification (against Postgres on 5433)

14 probes — every behavior matched the plan. The critical soft-delete probe sequence:

```
DELETE /projects/1                              → 200 (empty body)
GET    /projects/1                              → 404 uniform shape
GET    /projects                                → []
psql>  select id, name, deleted_at from projects;
   id |  name   |         deleted_at
   ---+---------+----------------------------
    1 | Renamed | 2026-05-22 21:03:17.976565
```

Row still present, `deleted_at` populated, but invisible to all standard queries.

Other verified behaviors: 401 without token; 400 on missing owner with explicit message; 400 on missing name with validation `details[]`; PATCH with `ownerId` rejected by `forbidNonWhitelisted`; create returns `200` (not Nest's default 201).

## Decisions Resolved This Phase

- **D5 → REVISED** before implementation. Original locked decision was "explicit `project_members` join table"; revised to **derived membership** (`projects.owner_id ∪ DISTINCT tickets.assignee_id`). Equally spec-compliant since the spec defines no membership API; the explicit table would be a leaky abstraction maintained only by side-effects. Updates landed in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), [feature_plans/03-projects.md](../feature_plans/03-projects.md), and memory ([project-issueflow](file:///Users/idorabin/.claude/projects/-Users-idorabin-Downloads-TDP2026HW/memory/project_issueflow.md)).

## Deviations / Notes

1. **No `project_members` table.** Per the revised D5. Phase 13 will derive membership at query time.
2. **No audit-log entry yet** on project CRUD. Phase 6 backfills emit-points.
3. **Hard-delete of a user who owns projects** leaves `ownerId` dangling. Documented in `run.md` (Phase 14).
4. **`description` is required** at create time. Spec lists it without nullability; required is the safer default. Easy to relax if needed.

## Cross-cutting Hooks Available for Later Phases

- `ProjectsService` exported by `ProjectsModule` — Phase 4 uses `findOne(projectId)` to validate `projectId` on ticket create.
- `Project.id` is the foreign-key target for `Ticket.projectId` (Phase 4) and for soft-delete restore (Phase 10).
- Soft-delete pattern (`@DeleteDateColumn` + `repo.softDelete` + 404 on missing) is now a template the Ticket entity (Phase 4) will reuse verbatim.
- Phase 13's "users in the project" query will be: `SELECT owner_id FROM projects WHERE id = ? UNION SELECT DISTINCT assignee_id FROM tickets WHERE project_id = ? AND assignee_id IS NOT NULL`.
