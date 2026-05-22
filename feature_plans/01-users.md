# Phase 1 — Users CRUD

> Identity feature. Establishes the `User` entity that every later feature (auth, projects, tickets, comments, mentions, assignments, audit log) references. No auth yet — global guard is added in Phase 2; for now endpoints are reachable directly.

## Goal

A `Users` module with CRUD endpoints matching the README contract literally, plus a `password` field added per the locked decision (the spec requires `/auth/login` to accept a password but never defines the field). Passwords are bcrypt-hashed at rest and excluded from every response. Unique-constraint violations on `username` / `email` return `409 Conflict` in the uniform error shape, not 500.

## Scope (in)

1. `User` entity with role enum, unique `username` + `email`, hashed `passwordHash`, `createdAt`.
2. DTOs: `CreateUserDto`, `UpdateUserDto` (validated by global `ValidationPipe`).
3. Service with bcrypt hashing, conflict detection, `NotFoundException` for missing ids.
4. Controller matching README endpoints exactly (including the non-REST `POST /users/update/:userId`).
5. `ClassSerializerInterceptor` registered globally so `@Exclude()` on `passwordHash` strips it from every response automatically. _Foundation-adjacent retrofit; documented here so it's owned by Phase 1._
6. Unit tests for the service (CRUD + edge cases) and a DTO validation test.

## Scope (out — deferred)

- Auth/JWT guards (Phase 2). Endpoints are currently un-gated; `POST /users` becomes a public-registration endpoint and the rest become auth-required in Phase 2.
- RBAC (`ADMIN`-only for role changes / delete). Will be considered in Phase 2 when guards land.
- Audit log emission on user CRUD (Phase 6 — the audit log itself lands then, and we'll backfill emit-points in services).

## API Contract (per README, literal)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/users` | — | `200 [{ id, username, email, fullName, role }]` |
| `GET` | `/users/:userId` | — | `200 { id, username, email, fullName, role }` |
| `POST` | `/users` | `{ username, email, fullName, role, password }` | `200 { id, username, email, fullName, role }` |
| `POST` | `/users/update/:userId` | `{ fullName?, role? }` | `200` (empty body, matches README) |
| `DELETE` | `/users/:userId` | — | `200` (empty body) |

**Deviation from REST norms (`POST /users/update/:userId` vs `PATCH /users/:userId`):** intentional, README is the contract.

**Deviation from spec User schema (`password` added to `POST /users`):** intentional, required by `/auth/login`; documented in `run.md` (Phase 14).

## Entity

```ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true, length: 32 }) username: string;
  @Column({ unique: true, length: 254 }) email: string;
  @Column({ name: 'full_name', length: 120 }) fullName: string;
  @Column({ type: 'varchar', length: 16 }) role: Role;
  @Column({ name: 'password_hash' }) @Exclude() passwordHash: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
```

Why `type: 'varchar'` + length 16 for `role` instead of a Postgres enum: SQLite (used in tests) has no native enum; `varchar` + `class-validator @IsEnum(Role)` covers both dialects and keeps tests fast. Validation enforces the values.

## DTOs

```ts
// CreateUserDto
@IsString() @MinLength(3) @MaxLength(32) @Matches(/^[a-zA-Z0-9_-]+$/) username
@IsEmail() @MaxLength(254) email
@IsString() @IsNotEmpty() @MaxLength(120) fullName
@IsEnum(Role) role
@IsString() @MinLength(8) @MaxLength(128) password

// UpdateUserDto (README only mentions fullName + role)
@IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) fullName?
@IsOptional() @IsEnum(Role) role?
```

Global pipe (`whitelist + forbidNonWhitelisted`) auto-rejects unknown fields and surfaces validation errors as `400 + details[]` via the existing filter.

## Service Behaviors

| Method | Behavior |
|---|---|
| `create(dto)` | bcrypt-hash `password` (cost 10), persist, return entity. Catches `QueryFailedError` with unique-violation code → throws `ConflictException` with field name (`username` / `email`). |
| `findAll()` | Returns all users. |
| `findOne(id)` | Returns or throws `NotFoundException(\`User \${id} not found\`)`. |
| `update(id, dto)` | Loads, applies partial fields (`fullName`, `role` only), saves. `NotFoundException` if missing. Returns updated user. |
| `remove(id)` | Hard delete (soft delete only applies to Project / Ticket per spec §3.5). `NotFoundException` if missing. |

Unique-violation detection: TypeORM surfaces driver-specific codes. We branch on `err.driverError.code === '23505'` (Postgres) **or** `err.driverError.code === 'SQLITE_CONSTRAINT_UNIQUE'` (SQLite) for portability between runtime and test DB. Parses the constraint name to pick which field collided.

## File Layout

```
src/users/
├── users.module.ts
├── users.controller.ts
├── users.service.ts
├── users.service.spec.ts          # unit tests (this phase)
├── entities/
│   └── user.entity.ts
└── dto/
    ├── create-user.dto.ts
    └── update-user.dto.ts
```

Modified:
- `src/app.module.ts` — add `UsersModule` to `imports`
- `src/main.ts` — register `ClassSerializerInterceptor` globally
- `src/common/enums/role.enum.ts` — unchanged, already present (Phase 0)

## Unit Tests (Phase 1)

`users.service.spec.ts` — uses a mocked `Repository<User>` so no real DB needed:

1. `create()` hashes password (asserts bcrypt-compare of input vs stored hash), persists with hashed value, returns entity.
2. `create()` translates Postgres unique-violation on `username` → `ConflictException` with field name.
3. `create()` translates SQLite unique-violation on `email` → `ConflictException` with field name.
4. `findAll()` returns the repository's result.
5. `findOne()` returns the user when found.
6. `findOne()` throws `NotFoundException` when missing.
7. `update()` merges allowed fields only (passes `{ password: 'leak' }` and asserts it's ignored even if it sneaks past the DTO — defense in depth).
8. `update()` throws `NotFoundException` when missing.
9. `remove()` calls `delete(id)` and throws `NotFoundException` when affected = 0.

Plus one DTO validation test using `class-validator`'s `validate()`:
- `CreateUserDto` with bad role → validation errors include `isEnum`.
- `CreateUserDto` with password length 7 → validation errors include `minLength`.

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — all Phase 0 tests still pass plus new ones (~10 new tests, **15 total**).
- [ ] `POST /users` with valid body returns 200 with the canonical fields, no `passwordHash` or `createdAt` leaked (unless explicitly added later).
- [ ] `POST /users` with duplicate username returns 409 in the uniform error shape.
- [ ] `POST /users` with invalid email returns 400 with `details: ["email must be an email"]`.
- [ ] `GET /users/:id` with unknown id returns 404 in the uniform error shape.
- [ ] `POST /users/update/:userId` with `{ password: 'x' }` is rejected by the global pipe (`forbidNonWhitelisted`).

## Risks / Notes

- **No auth yet.** Any caller can create/list/delete users. Acceptable for this phase only; Phase 2 closes this.
- **Hard delete.** Spec §2.1 says "Delete a user" without qualification, and §3.5 only mandates soft delete for tickets/projects. So hard delete here is correct. If a deleted user is referenced by audit logs / mentions in later phases, those references will be left dangling — will revisit in Phase 6 when Audit Log lands.
- **bcrypt is a native module.** Already rebuilt for Node 20 in Phase 0.
