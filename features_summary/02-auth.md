# Feature 02 — Authentication & Authorization (JWT)

**Plan:** [feature_plans/02-auth.md](../feature_plans/02-auth.md)
**Approved:** 2026-05-22
**Status:** Done. Build clean. 36/36 unit tests pass. All 12 live probes match spec §2.2.

## What this feature delivers

JWT-based authentication that protects every API endpoint by default (per spec §2.2 "protect all API endpoints"). Routes can opt out with `@Public()`. Role-based authorization is also wired (RolesGuard), ready for the §3.5 ADMIN gates that land in Phase 10. Logout is stateless per the locked decision — no deny-list, token expires naturally.

## Endpoints

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/auth/login` | **Public** | `{ username, password }` | `200 { accessToken, tokenType:"Bearer", expiresIn:3600 }` / `401` |
| `POST` | `/auth/logout` | Required | — | `200` (empty body, stateless no-op) |
| `GET` | `/auth/me` | Required | — | `200 { id, username, email, fullName, role }` / `401` |

**Cross-cutting effect:** every previously-existing route is now gated. `@Public()` is applied to:
- `GET /health` (Phase 0)
- `POST /auth/login` (this phase)
- `POST /users` (this phase — registration is open per Decision D1)

Everything else (e.g. `GET /users`, `GET /users/:id`, `POST /users/update/:id`, `DELETE /users/:id`) now requires a valid `Authorization: Bearer <token>`.

## Key Logic

- **Login flow:** `AuthService.login` looks up the user by `username`, bcrypt-compares the plaintext password, then signs a JWT with payload `{ sub: userId, username, role }` and TTL from `JWT_TTL_SECONDS` (default 3600). Returns `{ accessToken, tokenType:"Bearer", expiresIn }`.
- **No user-enumeration:** both "missing user" and "bad password" paths throw `UnauthorizedException("Invalid credentials")` with the **identical** message. Verified with unit tests + live probes.
- **JWT validation:** `JwtStrategy` (passport-jwt) extracts the token from `Authorization: Bearer <token>`, verifies signature + expiration, then `validate(payload)` returns `{ userId: payload.sub, username, role }` which Passport attaches to `req.user`. No DB hit per request — fast.
- **Global guard composition:** Both `JwtAuthGuard` and `RolesGuard` are registered via `APP_GUARD` providers in `AppModule`. Order of execution is: `JwtAuthGuard` (or `@Public()` bypass) → `RolesGuard` (allows if no `@Roles` set). When `@Public()` is on a handler, `JwtAuthGuard.canActivate` short-circuits to `true` and `RolesGuard` likewise allows (no `@Roles` metadata).
- **`@CurrentUser()` param decorator:** reads `req.user` typed as `AuthenticatedUser`. Used by `GET /auth/me`.
- **Stateless logout:** `POST /auth/logout` is an HTTP no-op returning 200. The token remains technically valid until `exp`. Documented in code with a reference to the locked decision.

## How Implemented

| File | Role |
|---|---|
| [src/auth/auth.module.ts](../issueflow-typescript/src/auth/auth.module.ts) | Wires `JwtModule.registerAsync` (secret + TTL from config), imports `UsersModule`, registers `JwtStrategy` |
| [src/auth/auth.controller.ts](../issueflow-typescript/src/auth/auth.controller.ts) | `/auth/login`, `/auth/logout`, `/auth/me`; `@Public()` only on login |
| [src/auth/auth.service.ts](../issueflow-typescript/src/auth/auth.service.ts) | bcrypt-compare + JWT signing; uniform "Invalid credentials" |
| [src/auth/strategies/jwt.strategy.ts](../issueflow-typescript/src/auth/strategies/jwt.strategy.ts) | passport-jwt, `Bearer` extractor, secret from config, `validate(payload)` |
| [src/auth/guards/jwt-auth.guard.ts](../issueflow-typescript/src/auth/guards/jwt-auth.guard.ts) | Extends `AuthGuard('jwt')`; bypasses on `IS_PUBLIC_KEY` |
| [src/auth/guards/roles.guard.ts](../issueflow-typescript/src/auth/guards/roles.guard.ts) | Reads `ROLES_KEY`; allows when missing/empty; else requires `req.user.role` in list |
| [src/auth/dto/login.dto.ts](../issueflow-typescript/src/auth/dto/login.dto.ts) | `@IsString @IsNotEmpty` on username + password |
| [src/auth/interfaces/authenticated-user.interface.ts](../issueflow-typescript/src/auth/interfaces/authenticated-user.interface.ts) | `{ userId, username, role }` |
| [src/auth/decorators/current-user.decorator.ts](../issueflow-typescript/src/auth/decorators/current-user.decorator.ts) | `@CurrentUser()` reads `req.user` |
| [src/app.module.ts](../issueflow-typescript/src/app.module.ts) | **Modified:** imports `AuthModule`; registers `JwtAuthGuard` + `RolesGuard` as `APP_GUARD` providers |
| [src/users/users.service.ts](../issueflow-typescript/src/users/users.service.ts) | **Modified:** added `findByUsername(username)` (returns `User \| null`, no throw) |
| [src/users/users.controller.ts](../issueflow-typescript/src/users/users.controller.ts) | **Modified:** `@Public()` on `create` |

## Tests

| File | Coverage | # |
|---|---|---|
| [src/auth/auth.service.spec.ts](../issueflow-typescript/src/auth/auth.service.spec.ts) | Valid login signs `{sub,username,role}` and returns ttl 3600; missing user → 401 "Invalid credentials"; bad password → 401 same message; `signAsync` not called on either failure | 3 |
| [src/auth/strategies/jwt.strategy.spec.ts](../issueflow-typescript/src/auth/strategies/jwt.strategy.spec.ts) | `validate(payload)` maps `sub→userId`, passes through `username`/`role` | 1 |
| [src/auth/guards/jwt-auth.guard.spec.ts](../issueflow-typescript/src/auth/guards/jwt-auth.guard.spec.ts) | `@Public()` bypass; reflector called with both handler+class; delegates to passport when not public | 3 |
| [src/auth/guards/roles.guard.spec.ts](../issueflow-typescript/src/auth/guards/roles.guard.spec.ts) | No-roles → allow; empty array → allow; role-in-list → allow; not-in-list → 403; missing user → 403 | 5 |
| [src/auth/dto/login.dto.spec.ts](../issueflow-typescript/src/auth/dto/login.dto.spec.ts) | Valid; missing username; missing password | 3 |

`npm test` → **36/36 passing** (5 Phase 0 + 16 Phase 1 + 15 Phase 2).

## Live Verification (against Postgres on 5433)

12 probes — every line matched the plan:

| Probe | Result |
|---|---|
| `GET /health` no token | 200 (public) |
| `POST /users` no token | 200 (public registration) |
| `GET /users` no token | 401 uniform |
| `POST /auth/login` valid | 200 with token, `expiresIn: 3600` |
| `POST /auth/login` bad password | 401 `"Invalid credentials"` |
| `POST /auth/login` unknown user | 401 `"Invalid credentials"` (identical) |
| `POST /auth/login` missing field | 400 with `details[]` |
| `GET /auth/me` valid token | 200 full profile |
| `GET /auth/me` no token | 401 |
| `GET /auth/me` garbage token | 401 |
| `POST /auth/logout` | 200 empty body |
| `GET /users` valid token | 200 array |

JWT decoded: `{ sub: 5, username: "jdoe", role: "DEVELOPER", iat, exp }` with `exp - iat = 3600` — matches Decisions D3 + D4.

## Locked Decisions Resolved

- **D1: `POST /users` is public** — open registration. Trust model documented in code; will be re-stated in `run.md` (Phase 14).
- **D2: Only enforce `@Roles(ADMIN)` where the spec explicitly demands it.** No other endpoint has role restrictions in this phase. The §3.5 ADMIN gates land in Phase 10 (Soft-delete admin endpoints).
- **D3: JWT payload = `{ sub, username, role }`.** Verified live.
- **D4: TTL = 3600s** (configurable via `JWT_TTL_SECONDS`). Verified live.

## Deviations / Notes

1. **No login audit-log entries yet.** Phase 6 will backfill a `auditService.record(...)` emit-point in `AuthService.login` for successful logins.
2. **Tiny timing-channel on user-enumeration:** the missing-user branch returns immediately, while bad-password runs `bcrypt.compare`. Closing this would require always running a dummy compare on missing-user — acceptable open trade-off for this scope; documented in the plan and code.

## Cross-cutting Hooks Available for Later Phases

- **`@Public()` already on:** `/health`, `/auth/login`, `POST /users`. Future public routes need explicit opt-out.
- **`@Roles(Role.ADMIN)`** ready for use in Phase 10 (soft-delete list / restore endpoints).
- **`@CurrentUser()`** is the canonical way to access the calling user. Future controllers will use it for `authorId` (Comments), `performedBy` (Audit Log), etc.
- **`AuthenticatedUser` interface** is the shape every later feature consumes for `req.user`.
- **`UsersService.findByUsername`** is exported via `UsersModule`; usable by any module that needs a username→user lookup.
