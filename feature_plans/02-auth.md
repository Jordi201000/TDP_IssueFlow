# Phase 2 — Authentication & Authorization (JWT)

> The spec (§2.2) says "The system must protect **all** API endpoints using JWT-based authentication." This phase makes that real — a global `JwtAuthGuard` that gates every route by default, with `@Public()` opting routes out and `@Roles(...)` adding RBAC on top. JWT is stateless with short expiry per the locked decision (no deny-list).

## Goal

Three endpoints from §2.2 — login, logout, me — plus the cross-cutting guard layer that protects every existing and future endpoint. After this phase, all the Phase 1 user endpoints (and `/health`) need to be explicitly classified as `@Public()` or auth-required.

## Scope (in)

1. `AuthModule` wired into `AppModule`.
2. `POST /auth/login` — accepts `{ username, password }`, bcrypt-compares against `User.passwordHash`, returns `{ accessToken, tokenType: "Bearer", expiresIn }`.
3. `POST /auth/logout` — stateless no-op returning 200 (documented).
4. `GET /auth/me` — returns the current user (sourced from JWT payload + DB lookup).
5. `JwtStrategy` (passport-jwt) extracting from `Authorization: Bearer <token>`.
6. **Global `JwtAuthGuard`** registered as `APP_GUARD` provider in `AppModule`.
7. **Global `RolesGuard`** registered as `APP_GUARD` provider (runs after `JwtAuthGuard`).
8. Mark `@Public()` on:
   - `GET /health`
   - `POST /auth/login`
   - `POST /users` (open registration — see Decisions below)
9. Add `req.user` typing helper (`AuthenticatedUser` interface).
10. Unit tests for `AuthService.login` (happy path + bad password + missing user), `JwtStrategy.validate`, `JwtAuthGuard` (public bypass + 401 on missing/invalid token), `RolesGuard` (403 when role missing, allow when present, allow when no `@Roles` set).

## Scope (out — deferred)

- Token deny-list / refresh tokens (out of scope per locked decisions).
- Password reset / email verification.
- Rate limiting on login.
- Audit-log entries for login/logout (Phase 6 backfills the emit-points).

## Decisions to Lock With User Before Coding

These ambiguities must be resolved before I implement — putting them up front rather than burying them in "Risks":

### D1. Is `POST /users` public (registration) or auth-required?

The spec says "protect **all** API endpoints" (§2.2) but also describes registration in §2.1 with no role restriction. If `POST /users` is auth-required, you need an `ADMIN` to bootstrap, but the spec defines no seed user. Options:

- **(A) `POST /users` public** — anyone can register, including as `ADMIN`. Simple. Matches the literal README. This is the recommended path.
- **(B) `POST /users` `@Roles(ADMIN)`-protected** — needs a seeded admin user at startup (would add a small `seed.ts` or boot-time check).
- **(C) `POST /users` public but `role` forced to `DEVELOPER`** — strays from the README body shape (role becomes server-controlled).

**My recommendation: A.** Cleanest, most literal to the README. Document the trust model in `run.md`.

### D2. RBAC on user CRUD beyond §3.5?

Spec only explicitly requires `ADMIN` for soft-delete list/restore (§3.5). Other endpoints don't mention roles. Options:

- **(A) Only enforce `@Roles(ADMIN)` where the spec explicitly demands it** (§3.5 endpoints in Phase 10). Everything else: any authenticated user. **Recommended — strict literal reading of the spec.**
- **(B) Also gate `DELETE /users/:id` and role changes on `ADMIN`** — sensible but not spec-mandated.

**My recommendation: A.** Per your "follow the assignment requirements exactly" direction.

### D3. JWT payload shape

Recommended: `{ sub: <userId>, username, role }` — `sub` is the JWT standard subject claim. `GET /auth/me` then re-fetches by `sub` to return fresh `fullName` / `email`. Confirm or override.

### D4. `expiresIn` default

Recommended: 3600 seconds (1 hour). Configurable via `JWT_TTL_SECONDS` env (already in Phase 0). Confirm or override.

## API Contract (per README)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/auth/login` | `{ username, password }` | `200 { accessToken, tokenType: "Bearer", expiresIn }` / `401` |
| `POST` | `/auth/logout` | — | `200` (empty) |
| `GET` | `/auth/me` | — | `200 { id, username, email, fullName, role }` / `401` |

Plus: every existing route gets the global guard applied automatically. Routes called without `Authorization: Bearer <token>` return `401` in the uniform error shape.

## Module / File Layout

```
src/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── auth.service.spec.ts          # unit
├── dto/
│   └── login.dto.ts
├── strategies/
│   └── jwt.strategy.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── jwt-auth.guard.spec.ts
│   ├── roles.guard.ts
│   └── roles.guard.spec.ts
├── interfaces/
│   └── authenticated-user.interface.ts
└── decorators/
    └── current-user.decorator.ts    # @CurrentUser() → req.user
```

Modified:
- [src/app.module.ts](../issueflow-typescript/src/app.module.ts) — import `AuthModule`; register `APP_GUARD` providers (`JwtAuthGuard`, `RolesGuard`).
- [src/users/users.controller.ts](../issueflow-typescript/src/users/users.controller.ts) — `@Public()` on `create`.
- [src/users/users.service.ts](../issueflow-typescript/src/users/users.service.ts) — add `findByUsername(username)` helper for login lookup.
- [src/health/health.controller.ts](../issueflow-typescript/src/health/health.controller.ts) — already has `@Public()` from Phase 0.

## Key Logic

### Login (`AuthService.login`)

1. Look up user by `username` (via `UsersService.findByUsername` — new helper).
2. If missing → `UnauthorizedException('Invalid credentials')`. Same message for missing user vs bad password (no user-enumeration leak).
3. `bcrypt.compare(plain, passwordHash)`; on mismatch → same `UnauthorizedException`.
4. `JwtService.signAsync({ sub: user.id, username: user.username, role: user.role })`.
5. Return `{ accessToken, tokenType: "Bearer", expiresIn: ttlSeconds }`.

### Logout (`AuthController.logout`)

`@HttpCode(200)` no-op. Stateless: token remains technically valid until expiry. Acceptable per locked decisions. Comment in code references the decision.

### Me (`AuthController.me`)

`@CurrentUser() user: AuthenticatedUser` → call `UsersService.findOne(user.userId)` → return user (serializer strips `passwordHash`/`createdAt`).

### `JwtStrategy.validate(payload)`

Receives the decoded JWT. Returns `{ userId: payload.sub, username, role }` which Passport assigns to `req.user`. No DB call here — fast per-request validation. `GET /auth/me` does the DB lookup explicitly.

### `JwtAuthGuard`

Extends `AuthGuard('jwt')`. In `canActivate`:
- Read `IS_PUBLIC_KEY` via `Reflector` on handler + class.
- If public → `true` (skip JWT entirely).
- Else delegate to `super.canActivate(ctx)`.

### `RolesGuard`

Reads `ROLES_KEY` via `Reflector`. If no `@Roles(...)` set → allow. Else require `req.user.role` to be in the list, else `ForbiddenException`.

### Public route opt-out

The `@Public()` decorator already exists (Phase 0). Just apply it at the right places. Tests cover the bypass behavior.

## Unit Tests (Phase 2)

`auth.service.spec.ts`:
1. `login` returns token + ttl on valid credentials.
2. `login` calls `bcrypt.compare` (assertions about arg order).
3. `login` throws `UnauthorizedException` on missing user (same message as bad password — assert exact string).
4. `login` throws `UnauthorizedException` on bad password.
5. JWT payload contains `sub`, `username`, `role` (intercepted via mocked `JwtService.signAsync`).

`jwt.strategy.spec.ts`:
6. `validate(payload)` returns `{ userId, username, role }`.

`jwt-auth.guard.spec.ts`:
7. Bypasses on `@Public()` handler.
8. Bypasses on `@Public()` class.
9. Falls through to `super.canActivate` otherwise (assert by stubbing the super).

`roles.guard.spec.ts`:
10. Allows when no `@Roles(...)` metadata.
11. Allows when user role is in the required list.
12. Throws `ForbiddenException` when user role is missing or not in list.
13. Throws `ForbiddenException` when `req.user` is undefined.

`login.dto.spec.ts`:
14. Rejects missing username / missing password.

## Acceptance Criteria

- [ ] `npm run build` clean.
- [ ] `npm test` — all 21 prior tests still pass, plus ~14 new. **~35 total.**
- [ ] Curl probes (live):
  - `POST /auth/login` with valid creds → 200 with `accessToken`.
  - `POST /auth/login` with bad password → 401, uniform error.
  - `POST /auth/login` with missing user → 401, **same** error message.
  - `GET /auth/me` with valid `Bearer <token>` → 200 with user.
  - `GET /auth/me` without token → 401.
  - `GET /auth/me` with malformed/expired token → 401.
  - `POST /auth/logout` → 200 with empty body.
  - `GET /users` without token → 401 (proves global guard is on).
  - `GET /users` with valid token → 200.
  - `POST /users` without token → 200 (public registration works).
  - `GET /health` without token → 200 (public health works).

## Risks / Notes

- **`@Public()` proliferation.** Every public route must be marked explicitly. Easy to forget → easy to lock out legitimate clients. Mitigation: list of public routes maintained in this summary file.
- **Stateless logout is a real tradeoff.** Per locked decisions; if a token is leaked, it stays valid until expiry. Documented in `run.md`.
- **No login audit yet.** Phase 6 will backfill an emit-point in `AuthService.login` to record successful logins. Until then, login events leave no trace.
- **bcrypt timing.** `bcrypt.compare` is constant-time enough; the deliberate "same message" on missing user vs bad password closes the obvious enumeration vector. We do *not* run `compare` against a dummy hash on missing-user path → there is a tiny timing difference (no DB-hit time when user missing). Acceptable for this assignment scope.
