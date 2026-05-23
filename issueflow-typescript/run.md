# IssueFlow — Setup, Build, Run, Test

Exact, copy-paste steps to get the system running on a fresh clone, with notes on the non-default choices.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **20.11+** (tested on 20.20.0) | NestJS 11 hard requirement — uses global `crypto.randomUUID()` added in Node 19 |
| npm | bundled with Node 20 | Package manager |
| Docker | recent | Runs the Postgres dev DB via `compose.yml` |

If your default Node is older (e.g. 16/18) and you use `nvm`:
```bash
nvm install 20            # one-time
nvm use 20.20.0
```

Confirm: `node --version` should print `v20.x.x`.

## 1. Install dependencies

```bash
cd issueflow-typescript
npm install
```

Note: a few warnings about deprecated transitive packages may appear (carried in from the skeleton). They don't affect runtime; not load-bearing.

## 2. Start the database

```bash
docker compose up -d
```

This brings up a PostgreSQL container exposing **host port `5433`** (mapped to container `5432`). The non-default host port is intentional — many dev machines already have a native Postgres listening on `5432`. Mapping to `5433` avoids the collision without disturbing your existing install.

Health-check:
```bash
docker exec issueflow-typescript-db-1 pg_isready -U issueflow -d issueflow
# /var/run/postgresql:5432 - accepting connections
```

## 3. Configure (optional — defaults work)

A `.env` file is **not required**; sensible defaults in `src/config/configuration.ts` will be used. To customize, copy the template:

```bash
cp .env.example .env
# edit as needed
```

Defaults:
```
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5433              # matches compose.yml host port
DB_USER=issueflow
DB_PASS=issueflow
DB_NAME=issueflow
JWT_SECRET=change-me-in-prod
JWT_TTL_SECONDS=3600
```

For production, **replace `JWT_SECRET`**. It's the only credential clients can't supply themselves.

## 4. Build

```bash
npm run build
```

Compiles TypeScript into `dist/`. Build succeeds even if the DB is down; runtime is the next step.

## 5. Run the application

```bash
npm run start           # production-style boot
# or
npm run start:dev       # file-watching for development
```

The app listens on `http://localhost:3000`. Verify:
```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":...,"timestamp":"..."}
```

## 6. Run the tests

```bash
npm test                # all unit tests
npm run test:cov        # with coverage
```

Expected: **221 tests passing across 32 suites** in ~6 seconds.

Tests use `better-sqlite3` in-memory (configured via `NODE_ENV=test` in `src/app.module.ts`), so they don't touch the Docker Postgres. No setup beyond `npm install` is needed for the test suite.

## 7. End-to-end manual verification

A full manual smoke-test runbook lives in [TESTING.md](TESTING.md). It walks through every implemented feature with copy-paste curl commands (~10 minutes, including a ~2-minute wait for the auto-escalation cron).

## Architectural notes worth knowing

- **`synchronize: true`** for TypeORM is the assignment-scope default — schema is rebuilt from entity decorators on every boot. **Not safe for production**; migrations would replace this in a real deployment.
- **`uploads/` is gitignored** — attachment files land at `uploads/<ticketId>/<uuid>-<filename>` on disk. A fresh clone has no upload history; existing DB rows would have dangling `storagePath`.
- **Stateless JWT** with short expiry — `POST /auth/logout` is a no-op (no server-side deny-list). Clients should drop the token. The token remains technically valid until `JWT_TTL_SECONDS` elapses.
- **Auto-escalation cron runs every 30 seconds** (`*/30 * * * * *`). Dev-friendly cadence; production would be 5+ minutes.
- **Audit log has no pagination** on `GET /audit-logs`. Long-running systems would accumulate; acceptable for assignment scope.
- **Foreign-key constraints are not enforced at the DB level** for `ownerId`, `assigneeId`, `authorId`, `projectId`, etc. — validated at write time in services. Cross-dialect simplicity over strict relational integrity.

## Stopping / cleanup

```bash
# In the npm start terminal: Ctrl+C

# Stop Postgres:
docker compose down

# Wipe uploaded attachment files:
rm -rf uploads/
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `crypto is not defined` at boot | Node < 20 | `nvm use 20.20.0` |
| `role "issueflow" does not exist` | Native Postgres on 5432 intercepting connection | `DB_PORT=5433` already in defaults; ensure no `.env` overrides it |
| `DataTypeNotSupportedError: "datetime"` | Stale dist/ from before a Phase 4 fix | `rm -rf dist && npm run build` |
| Port 3000 in use | Another local server | Set `PORT=3001` in `.env` |

## Project layout (high-level)

```
src/
├── attachments/          # multipart upload (Phase 8)
├── audit-log/            # append-only state-change log (Phase 6)
├── auth/                 # JWT login + guards + decorators (Phase 2)
├── comments/             # ticket comments + optimistic locking (Phase 5)
├── common/               # filters, decorators, helpers, enums, exceptions
├── config/               # env loader
├── dependencies/         # ticket blockers + DONE-blocker rule (Phase 7)
├── escalation/           # cron-driven priority escalation (Phase 12)
├── health/               # /health endpoint
├── mentions/             # @username persistence + lookups (Phase 11)
├── projects/             # project CRUD + soft delete (Phase 3)
├── tickets/              # ticket CRUD + lifecycle + CSV (Phases 4, 9)
├── users/                # user CRUD + password hashing (Phase 1)
├── workload/             # auto-assign + GET /projects/:id/workload (Phase 13)
├── app.module.ts         # root composition
└── main.ts               # bootstrap (global pipe, filter, interceptor)
```

Cross-cutting AI/architecture artifacts live one level up in the repo:
- `feature_plans/00-foundation.md` … `14-quality-docs.md` — per-phase plans
- `features_summary/00-foundation.md` … `13-auto-assignment.md` — per-phase retrospectives
- `IMPLEMENTATION_PLAN.md` — top-level plan + locked decisions
- `prompts.md` (this directory) — AI usage notes
- `AGENTS.md` (this directory) — cross-vendor agent instruction file
- `CLAUDE.md` (this directory) — Claude-specific orientation
